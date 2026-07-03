// chatLock API
// ------------
// Account-scoped chat PIN lock (`/v2/chat/lock`). Server-side so the lock and
// the set of locked conversations follow the user across web / Android / iOS.
// The PIN is sent over HTTPS and hashed server-side (bcrypt); `verify` is
// rate-limited on the server.

import { buildV2ApiUrl } from './config'
import { getAuthHeaders } from '../auth-session'

export interface ChatLockStatus {
  enabled: boolean
  autoLockMinutes: number
  lockedConversationIds: string[]
}

interface Envelope<T> {
  responseStatus?: { message?: string; statusCode?: number }
  data?: T
}

function jsonHeaders() {
  return { ...getAuthHeaders(), Accept: 'application/json', 'Content-Type': 'application/json' }
}

function normalize(data: Partial<ChatLockStatus> | undefined): ChatLockStatus {
  return {
    enabled: !!data?.enabled,
    autoLockMinutes: typeof data?.autoLockMinutes === 'number' ? data.autoLockMinutes : 5,
    lockedConversationIds: Array.isArray(data?.lockedConversationIds)
      ? data!.lockedConversationIds!.map(String)
      : []
  }
}

async function readEnvelope<T>(res: Response): Promise<Envelope<T>> {
  return (await res.json().catch(() => ({}))) as Envelope<T>
}

export async function fetchLockStatus(): Promise<ChatLockStatus> {
  const res = await fetch(buildV2ApiUrl('/chat/lock'), {
    headers: { ...getAuthHeaders(), Accept: 'application/json' }
  })
  const env = await readEnvelope<ChatLockStatus>(res)
  if (!res.ok) throw new Error(env?.responseStatus?.message || 'Failed to load lock status.')
  return normalize(env.data)
}

export async function enableLockApi(pin: string, autoLockMinutes: number): Promise<ChatLockStatus> {
  const res = await fetch(buildV2ApiUrl('/chat/lock/enable'), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ pin, autoLockMinutes })
  })
  const env = await readEnvelope<ChatLockStatus>(res)
  if (!res.ok) throw new Error(env?.responseStatus?.message || 'Failed to enable chat lock.')
  return normalize(env.data)
}

/** Verify the PIN. Returns true/false (never throws for a wrong PIN). */
export async function verifyPinApi(pin: string): Promise<boolean> {
  const res = await fetch(buildV2ApiUrl('/chat/lock/verify'), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ pin })
  })
  const env = await readEnvelope<{ ok?: boolean }>(res)
  return res.ok && !!env?.data?.ok
}

/** Change PIN. Returns false when the current PIN is wrong. */
export async function changePinApi(currentPin: string, newPin: string): Promise<boolean> {
  const res = await fetch(buildV2ApiUrl('/chat/lock/change'), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ currentPin, newPin })
  })
  return res.ok
}

/** Disable the lock. Returns false when the PIN is wrong. */
export async function disableLockApi(pin: string): Promise<boolean> {
  const res = await fetch(buildV2ApiUrl('/chat/lock/disable'), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ pin })
  })
  return res.ok
}

export async function updateAutoLockApi(autoLockMinutes: number): Promise<ChatLockStatus> {
  const res = await fetch(buildV2ApiUrl('/chat/lock/settings'), {
    method: 'PATCH',
    headers: jsonHeaders(),
    body: JSON.stringify({ autoLockMinutes })
  })
  const env = await readEnvelope<ChatLockStatus>(res)
  if (!res.ok) throw new Error(env?.responseStatus?.message || 'Failed to update settings.')
  return normalize(env.data)
}

export async function setConversationLockApi(
  conversationId: string,
  locked: boolean
): Promise<ChatLockStatus> {
  const res = await fetch(buildV2ApiUrl('/chat/lock/conversation'), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ conversationId, locked })
  })
  const env = await readEnvelope<ChatLockStatus>(res)
  if (!res.ok) throw new Error(env?.responseStatus?.message || 'Failed to update conversation lock.')
  return normalize(env.data)
}
