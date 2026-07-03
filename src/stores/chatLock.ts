// chatLock store (server-backed)
// ------------------------------
// Account-scoped chat PIN lock via `/v2/chat/lock` (src/api/chatLock.ts), so it
// works across web / Android / iOS: the PIN + the set of locked conversations
// live on the server. The *unlocked session* (appUnlocked / convUnlocked) is
// per-device/per-tab and lives only in memory — you unlock on each device.

import { defineStore } from 'pinia'
import {
  changePinApi,
  disableLockApi,
  enableLockApi,
  fetchLockStatus,
  setConversationLockApi,
  updateAutoLockApi,
  verifyPinApi
} from '../api/chatLock'

interface ChatLockState {
  enabled: boolean
  autoLockMinutes: number
  lockedConversationIds: string[]
  loaded: boolean
  /** Session flags (per device, not persisted). */
  appUnlocked: boolean
  convUnlocked: Record<string, boolean>
  lastActive: number
}

export const useChatLockStore = defineStore('chatLock', {
  state: (): ChatLockState => ({
    enabled: false,
    autoLockMinutes: 5,
    lockedConversationIds: [],
    loaded: false,
    // Before status loads we don't gate (isAppLocked requires `loaded`).
    appUnlocked: false,
    convUnlocked: {},
    lastActive: Date.now()
  }),

  getters: {
    isAppLocked: (s): boolean => s.loaded && s.enabled && !s.appUnlocked,
    isConversationLocked: (s) => (id: string): boolean =>
      s.enabled && s.lockedConversationIds.includes(id) && !s.convUnlocked[id],
    conversationHasLock: (s) => (id: string): boolean =>
      s.enabled && s.lockedConversationIds.includes(id)
  },

  actions: {
    /** Load lock status from the server (call on chat mount). */
    async load() {
      try {
        const status = await fetchLockStatus()
        this.enabled = status.enabled
        this.autoLockMinutes = status.autoLockMinutes
        this.lockedConversationIds = status.lockedConversationIds
        // No lock → nothing to unlock; lock present → require the PIN.
        this.appUnlocked = !status.enabled
      } catch {
        // Treat a failed status fetch as "no lock" so chat stays usable.
        this.enabled = false
        this.appUnlocked = true
      } finally {
        this.loaded = true
      }
    },

    async enable(pin: string, autoLockMinutes: number): Promise<boolean> {
      try {
        const status = await enableLockApi(pin, autoLockMinutes)
        this.enabled = status.enabled
        this.autoLockMinutes = status.autoLockMinutes
        this.lockedConversationIds = status.lockedConversationIds
        this.appUnlocked = true
        return true
      } catch {
        return false
      }
    },

    async changePin(currentPin: string, newPin: string): Promise<boolean> {
      return changePinApi(currentPin, newPin)
    },

    async disable(pin: string): Promise<boolean> {
      const ok = await disableLockApi(pin)
      if (ok) {
        this.enabled = false
        this.lockedConversationIds = []
        this.appUnlocked = true
        this.convUnlocked = {}
      }
      return ok
    },

    async updateAutoLock(minutes: number) {
      try {
        const status = await updateAutoLockApi(minutes)
        this.autoLockMinutes = status.autoLockMinutes
      } catch {
        /* non-fatal */
      }
    },

    /** Unlock the whole app for this session. */
    async unlockApp(pin: string): Promise<boolean> {
      const ok = await verifyPinApi(pin)
      if (ok) {
        this.appUnlocked = true
        this.touch()
      }
      return ok
    },

    /** Unlock a single locked conversation for this session. */
    async unlockConversation(id: string, pin: string): Promise<boolean> {
      const ok = await verifyPinApi(pin)
      if (ok) {
        this.convUnlocked = { ...this.convUnlocked, [id]: true }
        this.touch()
      }
      return ok
    },

    /** Lock a conversation (optimistic; syncs to the server). */
    async lockConversation(id: string) {
      if (this.lockedConversationIds.includes(id)) return
      this.lockedConversationIds = [...this.lockedConversationIds, id]
      try {
        const status = await setConversationLockApi(id, true)
        this.lockedConversationIds = status.lockedConversationIds
      } catch {
        this.lockedConversationIds = this.lockedConversationIds.filter((x) => x !== id)
      }
    },

    /** Unlock (remove the per-chat lock) a conversation. */
    async removeConversationLock(id: string) {
      const prev = this.lockedConversationIds
      this.lockedConversationIds = prev.filter((x) => x !== id)
      const { [id]: _drop, ...rest } = this.convUnlocked
      this.convUnlocked = rest
      try {
        const status = await setConversationLockApi(id, false)
        this.lockedConversationIds = status.lockedConversationIds
      } catch {
        this.lockedConversationIds = prev
      }
    },

    /** Re-lock everything (auto-lock / manual). */
    lockNow() {
      if (!this.enabled) return
      this.appUnlocked = false
      this.convUnlocked = {}
    },

    touch() {
      this.lastActive = Date.now()
    },

    maybeAutoLock() {
      if (!this.enabled || !this.appUnlocked || this.autoLockMinutes <= 0) return
      if (Date.now() - this.lastActive > this.autoLockMinutes * 60_000) {
        this.lockNow()
      }
    }
  }
})
