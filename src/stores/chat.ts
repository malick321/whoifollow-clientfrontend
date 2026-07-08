// Pinia store for the new WhatsApp-style chat.
//
// Owns the socket.io connection to the `chat-microservice`, presence/typing,
// receipt reconciliation, optimistic send, and cache-first loading from
// IndexedDB. REST history/contacts come from src/api/chat.ts; live events
// arrive over the socket and are merged into state + IndexedDB.
//
// Realtime event reference: chat-microservice/src/chat.gateway.ts.
//   Client emits: join-conversation, leave-conversation, send-message,
//     send-message-with-files, mark-delivered, bulk-mark-delivered, mark-read,
//     mark-read-batch, typing, delete-message, get-online-users.
//   Server emits: message.sent ({message}), message.delivered, message.read,
//     message.read.batch, typing, user.status, online-users,
//     offline-messages-sync, message.deleted, user.tagged,
//     message-sent-success, message-deleted-success, message-error.
//
// NOTE: the gateway sends receipt/presence/typing payloads in snake_case
// (conversation_id, message_id, user_chat_id, ...) but `message.sent` /
// `offline-messages-sync` carry the §13 Message wire shape (adapted via
// adaptMessage, which also tolerates snake_case).

import { defineStore } from 'pinia'
import { io, type Socket } from 'socket.io-client'
import { authDeviceToken, getAuthUserChatId, getAuthUserName, setChatIdentity } from '../auth-session'
import { adaptMessage } from '../api/adapters/chat'
import type { ApiMessage } from '../api/contracts/chat'
import {
  bulkMarkDelivered as bulkMarkDeliveredRest,
  deleteMessageRest,
  fetchConversation,
  fetchConversations,
  fetchMessages,
  getOrCreateIndividualConversation,
  sendMessageRest,
  togglePin as togglePinRest,
  type ChatConversation,
  type ChatMessage,
  type ChatMessageStatus
} from '../api/chat'
import { fetchCurrentUser } from '../api/me'
import {
  cacheConversations,
  cacheMessages,
  getCachedConversations,
  getCachedMessages,
  getHiddenMessageIds,
  hideMessageLocally,
  removeMessage as removeCachedMessage,
  setMessageStatus as setCachedMessageStatus,
  upsertMessage as upsertCachedMessage
} from '../lib/chat-db'

const HISTORY_PAGE_SIZE = 30
const CACHE_RENDER_LIMIT = 50

function resolveSocketUrl(): string {
  const fromEnv = import.meta.env.VITE_CHAT_SOCKET_URL as string | undefined
  if (fromEnv && fromEnv.trim()) return fromEnv.trim()
  // Dev builds default to a local chat-microservice (PORT || 3000); production
  // builds default to the live public socket server — the same host the legacy
  // frontend uses (VUE_APP_NESTJS_URL || 'https://socket.whoifollow.tech').
  // Either default is overridable via VITE_CHAT_SOCKET_URL at build time.
  if (import.meta.env.DEV) return 'http://localhost:3000'
  return 'https://socket.whoifollow.tech'
}

function roomFor(conversationId: string): string {
  return `conversation.${conversationId}`
}

function genClientId(): string {
  const rand = Math.random().toString(36).slice(2, 10)
  return `tmp_${Date.now().toString(36)}_${rand}`
}

/** Build the quoted-reply preview shown inside a bubble from the message being
 *  replied to. Used to populate the optimistic message so the reply context is
 *  visible instantly — before (and regardless of whether) the server echoes a
 *  `parentMessage` back. Mirrors the composer's reply-banner preview. */
function parentPreview(parent?: ChatMessage | null): ChatMessage['parentMessage'] {
  if (!parent) return null
  return {
    id: parent.id,
    senderName: parent.senderName,
    preview: parent.content || (parent.hasFile ? '📎 File' : '')
  }
}

export interface TypingState {
  userChatId: string
  userName: string
}

interface ChatStoreState {
  conversations: ChatConversation[]
  activeConversationId: string | null
  messagesByConversation: Record<string, ChatMessage[]>
  /** message-id cursor to pass as `before` for the next older page; null = no more. */
  cursorByConversation: Record<string, string | null>
  hasMoreByConversation: Record<string, boolean>
  onlineUserChatIds: Set<string>
  typingByConversation: Record<string, TypingState[]>
  connected: boolean
  loadingConversations: boolean
  loadingOlderByConversation: Record<string, boolean>
  /** Message ids the viewer hid via "Delete for me" — persisted in IndexedDB,
   *  loaded on connect, and filtered out everywhere messages are surfaced. */
  hiddenMessageIds: Set<string>
}

// socket.io payload shapes (gateway → client). Snake_case for receipts/presence.
interface MessageSentPayload {
  message: ApiMessage
}
interface DeliveredPayload {
  conversation_id: string
  message_id: string
  user_chat_id: string
  user_name?: string
  delivered_at?: string
}
interface ReadPayload {
  conversation_id: string
  message_id: string
  user_chat_id: string
  user_name?: string
  read_at?: string
}
interface ReadBatchPayload {
  conversation_id: string
  message_ids: string[]
  user_chat_id: string
  user_name?: string
  read_at?: string
}
interface TypingPayload {
  conversation_id: string
  user_chat_id: string
  user_name?: string
  is_typing: boolean
}
interface UserStatusPayload {
  user_chat_id: string
  user_name?: string
  status: 'online' | 'offline'
}
interface OnlineUsersPayload {
  users: Array<{ user_chat_id: string; user_name?: string; status?: string }>
}
interface OfflineSyncPayload {
  success?: boolean
  messages?: ApiMessage[]
  messagesByConversation?: Record<string, ApiMessage[]>
}
interface DeletedPayload {
  conversation_id: string
  message_id: string
}

// Module-scoped socket (not reactive — sockets shouldn't be deeply observed).
let socket: Socket | null = null

export const useChatStore = defineStore('chat', {
  state: (): ChatStoreState => ({
    conversations: [],
    activeConversationId: null,
    messagesByConversation: {},
    cursorByConversation: {},
    hasMoreByConversation: {},
    onlineUserChatIds: new Set<string>(),
    typingByConversation: {},
    connected: false,
    loadingConversations: false,
    loadingOlderByConversation: {},
    hiddenMessageIds: new Set<string>()
  }),

  getters: {
    /** Total unread across all conversations (for a global badge). */
    totalUnread(state): number {
      return state.conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0)
    },
    /** Messages for the active conversation (oldest→newest), excluding any
     *  the viewer hid locally via "Delete for me"; [] when none. */
    activeMessages(state): ChatMessage[] {
      const id = state.activeConversationId
      if (!id) return []
      const list = state.messagesByConversation[id] ?? []
      if (state.hiddenMessageIds.size === 0) return list
      return list.filter((m) => !state.hiddenMessageIds.has(m.id))
    },
    isOnline(state) {
      return (userChatId: string): boolean => state.onlineUserChatIds.has(userChatId)
    },
    /** Other participants currently typing in a conversation (excludes self). */
    typingIn(state) {
      return (conversationId: string): TypingState[] =>
        state.typingByConversation[conversationId] ?? []
    },
    conversationById(state) {
      return (id: string): ChatConversation | undefined =>
        state.conversations.find((c) => c.id === id)
    }
  },

  actions: {
    // ── Connection ────────────────────────────────────────────────────────

    /** Load the persisted "Delete for me" set from IndexedDB into state, then
     *  prune any matching ids already in memory. Idempotent. */
    async loadHiddenMessageIds() {
      const ids = await getHiddenMessageIds()
      if (ids.length) this.hiddenMessageIds = new Set(ids)
      if (this.hiddenMessageIds.size === 0) return
      for (const convId of Object.keys(this.messagesByConversation)) {
        const list = this.messagesByConversation[convId]
        if (list) {
          this.messagesByConversation[convId] = list.filter(
            (m) => !this.hiddenMessageIds.has(m.id)
          )
        }
      }
    },

    async connect() {
      // Restore hidden ("delete for me") set before any message render so the
      // first cache-first paint already excludes them.
      await this.loadHiddenMessageIds()
      if (socket && socket.connected) return
      const token = authDeviceToken.value
      if (!token) {
        console.warn('[chat] connect skipped — missing token')
        return
      }
      let userChatId = getAuthUserChatId()
      // Self-heal the chat identity if it wasn't captured at login (older
      // session, or a login response without chat_id). Resolves own/other
      // message alignment + unblocks the socket handshake.
      if (!userChatId) {
        try {
          const me = await fetchCurrentUser()
          if (me?.userChatId) {
            setChatIdentity(me.userChatId, me.name, me.avatarUrl)
            userChatId = me.userChatId
          }
        } catch (err) {
          console.warn('[chat] could not resolve chat identity', err)
        }
      }
      if (!userChatId) {
        console.warn('[chat] connect skipped — missing userChatId')
        return
      }
      const userName = getAuthUserName()

      if (socket) {
        socket.removeAllListeners()
        socket.disconnect()
        socket = null
      }

      socket = io(resolveSocketUrl(), {
        auth: { token },
        query: { userChatId, userName: userName || 'User' },
        transports: ['websocket', 'polling'],
        reconnection: true
      })

      this.registerSocketHandlers(socket)
    },

    disconnect() {
      if (socket) {
        socket.removeAllListeners()
        socket.disconnect()
        socket = null
      }
      this.connected = false
    },

    registerSocketHandlers(s: Socket) {
      s.on('connect', () => {
        this.connected = true
        // Re-join the active conversation's room after a (re)connect.
        if (this.activeConversationId) {
          s.emit('join-conversation', roomFor(this.activeConversationId))
        }
        s.emit('get-online-users')
      })

      s.on('disconnect', () => {
        this.connected = false
      })

      s.on('message.sent', (payload: MessageSentPayload) => {
        if (!payload?.message) return
        void this.onIncomingMessage(adaptMessage(payload.message))
      })

      // Sender's own confirmation (carries the persisted message + clientId).
      s.on(
        'message-sent-success',
        (payload: { success?: boolean; data?: ApiMessage | { messages?: ApiMessage[] } }) => {
          const data = payload?.data
          if (!data) return
          const maybe = data as { messages?: ApiMessage[] }
          const rows = Array.isArray(maybe.messages) ? maybe.messages : [data as ApiMessage]
          for (const row of rows) {
            if (row && (row.id || row.clientId || row.client_id)) {
              void this.onIncomingMessage(adaptMessage(row))
            }
          }
        }
      )

      s.on('message.delivered', (p: DeliveredPayload) => {
        this.applyReceipt(p.conversation_id, [p.message_id], p.user_chat_id, 'delivered')
      })

      s.on('message.read', (p: ReadPayload) => {
        this.applyReceipt(p.conversation_id, [p.message_id], p.user_chat_id, 'read')
      })

      s.on('message.read.batch', (p: ReadBatchPayload) => {
        this.applyReceipt(p.conversation_id, p.message_ids ?? [], p.user_chat_id, 'read')
      })

      s.on('typing', (p: TypingPayload) => {
        this.applyTyping(p)
      })

      s.on('user.status', (p: UserStatusPayload) => {
        if (!p?.user_chat_id) return
        if (p.status === 'online') this.onlineUserChatIds.add(String(p.user_chat_id))
        else this.onlineUserChatIds.delete(String(p.user_chat_id))
      })

      s.on('online-users', (p: OnlineUsersPayload) => {
        const next = new Set<string>()
        for (const u of p?.users ?? []) {
          if (u?.user_chat_id) next.add(String(u.user_chat_id))
        }
        this.onlineUserChatIds = next
      })

      s.on('offline-messages-sync', (p: OfflineSyncPayload) => {
        void this.onOfflineSync(p)
      })

      s.on('message.deleted', (p: DeletedPayload) => {
        void this.onMessageDeleted(p.conversation_id, p.message_id)
      })

      s.on('message-deleted-success', (p: DeletedPayload) => {
        void this.onMessageDeleted(p.conversation_id, p.message_id)
      })

      s.on('message-error', (p: { message?: string }) => {
        console.warn('[chat] message-error', p?.message)
      })
    },

    // ── Conversations (cache-first) ─────────────────────────────────────────

    async loadConversations(opts: { type?: ChatConversation['type']; search?: string } = {}) {
      // 1. Render cache immediately.
      const cached = await getCachedConversations()
      if (cached.length && this.conversations.length === 0) {
        this.conversations = cached
      }

      // 2. Fetch authoritative list and reconcile.
      this.loadingConversations = true
      try {
        const page = await fetchConversations({ type: opts.type, search: opts.search })
        this.conversations = page.conversations
        void cacheConversations(page.conversations)
      } catch (err) {
        console.warn('[chat] loadConversations failed', err)
      } finally {
        this.loadingConversations = false
      }
    },

    upsertConversation(conv: ChatConversation) {
      const idx = this.conversations.findIndex((c) => c.id === conv.id)
      if (idx >= 0) this.conversations.splice(idx, 1, conv)
      else this.conversations.unshift(conv)
      void cacheConversations([conv])
    },

    async openIndividualConversation(userChatId: string): Promise<string | null> {
      const conv = await getOrCreateIndividualConversation(userChatId)
      if (!conv) return null
      this.upsertConversation(conv)
      await this.openConversation(conv.id)
      return conv.id
    },

    // ── Open / history ──────────────────────────────────────────────────────

    async openConversation(id: string) {
      this.activeConversationId = id

      if (socket && socket.connected) {
        socket.emit('join-conversation', roomFor(id))
      }

      // Cache-first: render cached tail instantly (minus hidden ids).
      const cached = await getCachedMessages(id, CACHE_RENDER_LIMIT)
      const visibleCached = this.hiddenMessageIds.size
        ? cached.filter((m) => !this.hiddenMessageIds.has(m.id))
        : cached
      if (visibleCached.length && !this.messagesByConversation[id]?.length) {
        this.messagesByConversation[id] = visibleCached
      }

      // Then fetch the latest page.
      try {
        const page = await fetchMessages(id, { limit: HISTORY_PAGE_SIZE })
        this.mergeMessages(id, page.messages)
        this.cursorByConversation[id] = page.nextCursor
        this.hasMoreByConversation[id] = page.hasMore
        void cacheMessages(id, page.messages)
      } catch (err) {
        console.warn('[chat] openConversation fetch failed', err)
      }

      // Ensure participants are loaded (info panel + status derivation).
      void this.ensureConversationDetail(id)

      // Mark visible messages read.
      this.markConversationRead(id)
    },

    closeConversation(id: string) {
      if (socket && socket.connected) {
        socket.emit('leave-conversation', roomFor(id))
      }
      if (this.activeConversationId === id) this.activeConversationId = null
    },

    async ensureConversationDetail(id: string) {
      const existing = this.conversationById(id)
      if (existing && existing.participants.length) return
      try {
        const conv = await fetchConversation(id)
        if (conv) this.upsertConversation(conv)
      } catch {
        /* non-fatal */
      }
    },

    async loadOlder(id: string) {
      const cursor = this.cursorByConversation[id]
      if (cursor === null) return // no more
      if (this.loadingOlderByConversation[id]) return
      this.loadingOlderByConversation[id] = true
      try {
        const page = await fetchMessages(id, {
          before: cursor ?? undefined,
          limit: HISTORY_PAGE_SIZE
        })
        const current = this.messagesByConversation[id] ?? []
        const existingIds = new Set(current.map((m) => m.id))
        const prepend = page.messages.filter(
          (m) => !existingIds.has(m.id) && !this.hiddenMessageIds.has(m.id)
        )
        this.messagesByConversation[id] = [...prepend, ...current]
        this.cursorByConversation[id] = page.nextCursor
        this.hasMoreByConversation[id] = page.hasMore
        void cacheMessages(id, page.messages)
      } catch (err) {
        console.warn('[chat] loadOlder failed', err)
      } finally {
        this.loadingOlderByConversation[id] = false
      }
    },

    // ── Sending (optimistic) ─────────────────────────────────────────────────

    sendMessage(id: string, content: string, parent?: ChatMessage | null): string {
      const clientId = genClientId()
      const userChatId = getAuthUserChatId()
      const now = new Date().toISOString()
      const temp: ChatMessage = {
        id: clientId, // temp id == clientId until the server row arrives
        clientId,
        conversationId: id,
        senderChatId: userChatId,
        senderName: getAuthUserName() || 'You',
        senderAvatarUrl: null,
        content,
        hasFile: false,
        files: [],
        parentMessage: parentPreview(parent),
        isPinned: false,
        isDeleted: false,
        createdAt: now,
        status: 'sent',
        deliveredTo: [],
        readBy: []
      }
      this.appendMessage(id, temp)
      void upsertCachedMessage(temp)

      const payload = {
        conversation_id: id,
        content,
        parent_message_id: parent?.id,
        clientId
      }

      if (socket && socket.connected) {
        socket.emit('send-message', payload)
      } else {
        // REST fallback when the socket is down.
        void sendMessageRest(id, { content, parentMessageId: parent?.id, clientId })
          .then((msgs) => {
            for (const m of msgs) void this.onIncomingMessage(m)
          })
          .catch((err) => console.warn('[chat] sendMessage REST fallback failed', err))
      }
      return clientId
    },

    sendFiles(
      id: string,
      files: Array<{ base64: string; name: string; type: string; size: number }>,
      content = '',
      parent?: ChatMessage | null
    ): string {
      const clientId = genClientId()
      const userChatId = getAuthUserChatId()
      const now = new Date().toISOString()
      const temp: ChatMessage = {
        id: clientId,
        clientId,
        conversationId: id,
        senderChatId: userChatId,
        senderName: getAuthUserName() || 'You',
        senderAvatarUrl: null,
        content,
        hasFile: files.length > 0,
        files: files.map((f) => ({
          name: f.name,
          type: f.type,
          url: '',
          size: f.size,
          thumbnailUrl: null
        })),
        parentMessage: parentPreview(parent),
        isPinned: false,
        isDeleted: false,
        createdAt: now,
        status: 'sent',
        deliveredTo: [],
        readBy: []
      }
      this.appendMessage(id, temp)
      void upsertCachedMessage(temp)

      if (socket && socket.connected) {
        socket.emit('send-message-with-files', {
          conversation_id: id,
          content,
          parent_message_id: parent?.id,
          files,
          clientId
        })
      } else {
        console.warn(
          '[chat] sendFiles: socket offline; file upload requires the socket/REST multipart path'
        )
      }
      return clientId
    },

    deleteMessage(conversationId: string, messageId: string) {
      // Optimistic tombstone.
      void this.onMessageDeleted(conversationId, messageId)
      if (socket && socket.connected) {
        socket.emit('delete-message', { conversation_id: conversationId, message_id: messageId })
      } else {
        void deleteMessageRest(messageId).catch((err) =>
          console.warn('[chat] deleteMessage REST fallback failed', err)
        )
      }
    },

    /** "Delete for me" — hide a message locally only (no backend call, no
     *  tombstone broadcast). Adds to the persisted hidden set, removes it from
     *  state, and drops it from the cache so it stays gone across reloads. */
    deleteForMe(conversationId: string, messageId: string) {
      const id = String(messageId)
      this.hiddenMessageIds.add(id)
      void hideMessageLocally(id)
      const list = this.messagesByConversation[conversationId]
      if (list) {
        const idx = list.findIndex((m) => m.id === id)
        if (idx >= 0) list.splice(idx, 1)
      }
      void removeCachedMessage(id)
    },

    async togglePin(messageId: string, pinned: boolean) {
      try {
        const updated = await togglePinRest(messageId, pinned)
        if (updated) {
          const list = this.messagesByConversation[updated.conversationId]
          if (list) {
            const idx = list.findIndex((m) => m.id === updated.id)
            if (idx >= 0) list.splice(idx, 1, updated)
          }
          void upsertCachedMessage(updated)
        }
      } catch (err) {
        console.warn('[chat] togglePin failed', err)
      }
    },

    setTyping(id: string, isTyping: boolean) {
      if (!socket || !socket.connected) return
      socket.emit('typing', {
        conversation_id: id,
        user_chat_id: getAuthUserChatId(),
        user_name: getAuthUserName() || 'User',
        is_typing: isTyping
      })
    },

    // ── Read state ────────────────────────────────────────────────────────

    markConversationRead(id: string) {
      const me = getAuthUserChatId()
      const list = this.messagesByConversation[id] ?? []
      const unreadIds = list
        .filter((m) => m.senderChatId !== me && !m.readBy.includes(me) && !m.isDeleted)
        .map((m) => m.id)

      // Advance the local unread count immediately.
      const conv = this.conversationById(id)
      if (conv) conv.unreadCount = 0

      if (unreadIds.length === 0) return
      if (socket && socket.connected) {
        socket.emit('mark-read-batch', { conversation_id: id, message_ids: unreadIds })
      }
    },

    // ── Socket event appliers ────────────────────────────────────────────────

    async onIncomingMessage(msg: ChatMessage) {
      const convId = msg.conversationId

      // A message the viewer hid via "Delete for me" — never re-surface it in
      // the thread or cache, but still let the conversation preview/unread
      // below reflect that activity happened.
      if (this.hiddenMessageIds.has(msg.id)) {
        const conv = this.conversationById(convId)
        if (conv) {
          conv.lastMessage = {
            id: msg.id,
            senderChatId: msg.senderChatId,
            senderName: msg.senderName,
            preview: msg.content || (msg.hasFile ? '📎 File' : ''),
            hasFile: msg.hasFile,
            createdAt: msg.createdAt
          }
          conv.lastMessageAt = msg.createdAt
          void cacheConversations([conv])
        }
        return
      }

      const list = this.messagesByConversation[convId] ?? []

      // Reconcile an optimistic temp by clientId, else by id.
      let idx = -1
      if (msg.clientId) idx = list.findIndex((m) => m.clientId === msg.clientId)
      if (idx < 0) idx = list.findIndex((m) => m.id === msg.id)

      // Fallback reconcile when clientId didn't round-trip (older deployed
      // socket server, or a backend that doesn't echo clientId): the sender
      // receives its own message via BOTH the room's `message.sent` broadcast
      // and the direct `message-sent-success` ack. Without a clientId match the
      // optimistic bubble would be left orphaned beside the real row and the
      // message appears twice. Collapse the real echo onto the oldest still-
      // optimistic (`tmp_…` id) message with identical content/attachment.
      // `tmp_` rows are inherently *our own* optimistic sends, so we don't gate
      // on senderChatId equality — the server sometimes returns the sender id in
      // a different shape than getAuthUserChatId(), which is exactly what left
      // the duplicate in place before.
      if (idx < 0 && !msg.id.startsWith('tmp_')) {
        idx = list.findIndex(
          (m) =>
            m.id.startsWith('tmp_') &&
            m.content === msg.content &&
            m.hasFile === msg.hasFile
        )
      }

      if (idx >= 0) {
        const prevTemp = list[idx]
        // Keep the optimistic reply quote when the server echo omits it (the
        // gateway/backend doesn't always round-trip parentMessage) so the
        // bubble doesn't lose its "replying to…" context on reconcile.
        if (!msg.parentMessage && prevTemp.parentMessage) {
          msg = { ...msg, parentMessage: prevTemp.parentMessage }
        }
        list.splice(idx, 1, msg)
        if (prevTemp.id !== msg.id) void removeCachedMessage(prevTemp.id)
      } else {
        list.push(msg)
        this.messagesByConversation[convId] = list
      }
      void upsertCachedMessage(msg)

      // Update the conversation preview + unread.
      const conv = this.conversationById(convId)
      if (conv) {
        conv.lastMessage = {
          id: msg.id,
          senderChatId: msg.senderChatId,
          senderName: msg.senderName,
          preview: msg.content || (msg.hasFile ? '📎 File' : ''),
          hasFile: msg.hasFile,
          createdAt: msg.createdAt
        }
        conv.lastMessageAt = msg.createdAt
        const me = getAuthUserChatId()
        const isActive = this.activeConversationId === convId
        if (msg.senderChatId !== me && !isActive) {
          conv.unreadCount = (conv.unreadCount || 0) + 1
        }
        void cacheConversations([conv])
      }

      // If active + incoming from someone else, mark it read right away.
      const me = getAuthUserChatId()
      if (this.activeConversationId === convId && msg.senderChatId !== me && !msg.isDeleted) {
        if (socket && socket.connected) {
          socket.emit('mark-read-batch', { conversation_id: convId, message_ids: [msg.id] })
        }
      }
    },

    applyReceipt(
      conversationId: string,
      messageIds: string[],
      userChatId: string,
      kind: 'delivered' | 'read'
    ) {
      const list = this.messagesByConversation[conversationId]
      if (!list) return
      const ids = new Set(messageIds.map(String))
      const actor = String(userChatId)

      for (const m of list) {
        if (!ids.has(m.id)) continue
        if (kind === 'delivered') {
          if (!m.deliveredTo.includes(actor)) m.deliveredTo.push(actor)
        } else {
          if (!m.readBy.includes(actor)) m.readBy.push(actor)
          if (!m.deliveredTo.includes(actor)) m.deliveredTo.push(actor)
        }
        const nextStatus = this.deriveStatus(conversationId, m)
        m.status = nextStatus
        void setCachedMessageStatus(m.id, nextStatus, {
          deliveredTo: m.deliveredTo,
          readBy: m.readBy
        })
      }
    },

    /** Derive the viewer-facing status for one of the viewer's own messages:
     *  read if every OTHER participant has read, else delivered if every other
     *  has a delivery receipt, else sent. Falls back gracefully when the
     *  participant roster isn't loaded yet. */
    deriveStatus(conversationId: string, msg: ChatMessage): ChatMessageStatus {
      const me = getAuthUserChatId()
      if (msg.senderChatId !== me) return msg.status
      const conv = this.conversationById(conversationId)
      const others = (conv?.participants ?? [])
        .map((p) => p.userChatId)
        .filter((uid) => uid !== me)

      if (others.length > 0) {
        const allRead = others.every((uid) => msg.readBy.includes(uid))
        if (allRead) return 'read'
        const allDelivered = others.every((uid) => msg.deliveredTo.includes(uid))
        if (allDelivered) return 'delivered'
        return 'sent'
      }

      // No roster — fall back to any-receipt heuristic.
      if (msg.readBy.some((uid) => uid !== me)) return 'read'
      if (msg.deliveredTo.some((uid) => uid !== me)) return 'delivered'
      return 'sent'
    },

    applyTyping(p: TypingPayload) {
      const me = getAuthUserChatId()
      const actor = String(p.user_chat_id)
      if (actor === me) return
      const convId = p.conversation_id
      const current = this.typingByConversation[convId] ?? []
      const without = current.filter((t) => t.userChatId !== actor)
      if (p.is_typing) {
        without.push({ userChatId: actor, userName: p.user_name || 'Someone' })
      }
      this.typingByConversation[convId] = without
    },

    async onOfflineSync(p: OfflineSyncPayload) {
      const flat = p?.messages ?? []
      const byConv = p?.messagesByConversation ?? {}

      const all: ApiMessage[] = flat.length
        ? flat
        : Object.values(byConv).reduce<ApiMessage[]>((acc, arr) => acc.concat(arr ?? []), [])

      if (all.length === 0) return

      const adapted = all.map(adaptMessage)
      const idsByConversation: Record<string, string[]> = {}

      for (const msg of adapted) {
        this.mergeMessages(msg.conversationId, [msg])
        void upsertCachedMessage(msg)
        ;(idsByConversation[msg.conversationId] ??= []).push(msg.id)
      }

      // Auto bulk-mark-delivered for each conversation's synced messages
      // (excluding the viewer's own messages).
      const me = getAuthUserChatId()
      for (const [convId, ids] of Object.entries(idsByConversation)) {
        const mineIds = new Set(
          adapted.filter((m) => m.senderChatId === me).map((m) => m.id)
        )
        const toAck = ids.filter((id) => !mineIds.has(id))
        if (toAck.length === 0) continue
        if (socket && socket.connected) {
          socket.emit('bulk-mark-delivered', { conversationId: convId, messageIds: toAck })
        } else {
          void bulkMarkDeliveredRest(toAck).catch(() => undefined)
        }
      }
    },

    async onMessageDeleted(conversationId: string, messageId: string) {
      const list = this.messagesByConversation[conversationId]
      if (list) {
        const idx = list.findIndex((m) => m.id === String(messageId))
        if (idx >= 0) {
          const tombstone: ChatMessage = {
            ...list[idx],
            content: '',
            isDeleted: true,
            files: [],
            hasFile: false
          }
          list.splice(idx, 1, tombstone)
          void upsertCachedMessage(tombstone)
        }
      }
    },

    // ── Internal merge helpers ───────────────────────────────────────────────

    appendMessage(conversationId: string, msg: ChatMessage) {
      const list = this.messagesByConversation[conversationId] ?? []
      list.push(msg)
      this.messagesByConversation[conversationId] = list
    },

    mergeMessages(conversationId: string, incoming: ChatMessage[]) {
      const current = this.messagesByConversation[conversationId] ?? []
      const byId = new Map(current.map((m) => [m.id, m]))
      const byClientId = new Map(
        current.filter((m) => m.clientId).map((m) => [m.clientId as string, m])
      )

      for (const msg of incoming) {
        // Drop anything the viewer hid via "Delete for me" so REST history /
        // offline-sync refetches never resurrect it.
        if (this.hiddenMessageIds.has(msg.id)) continue
        const existing =
          byId.get(msg.id) ?? (msg.clientId ? byClientId.get(msg.clientId) : undefined)
        if (existing) {
          const idx = current.indexOf(existing)
          if (idx >= 0) current.splice(idx, 1, msg)
          if (existing.id !== msg.id) void removeCachedMessage(existing.id)
        } else {
          current.push(msg)
        }
        byId.set(msg.id, msg)
      }

      current.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      this.messagesByConversation[conversationId] = current
    }
  }
})
