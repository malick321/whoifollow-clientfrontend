// IndexedDB cache for chat (DB `wif-chat`) via `idb`.
//
// Two stores:
//   - `conversations` (keyPath `id`)
//   - `messages` (keyPath `id`, index `by-conversation` on
//     [conversationId, createdAt] for ordered per-conversation reads)
//
// Used by the Pinia store for CACHE-FIRST render, offline history, and
// optimistic-send persistence. Every helper is resilient: if IndexedDB is
// unavailable (SSR, private mode, blocked) it resolves to an empty/no-op
// result instead of throwing, so the UI never breaks on cache failure.

import { openDB } from 'idb'
import type { DBSchema, IDBPDatabase } from 'idb'
import type { ChatConversation, ChatMessage, ChatMessageStatus } from '../api/chat'

const DB_NAME = 'wif-chat'
// v2 adds the `hidden` store backing "Delete for me" — message ids the viewer
// has hidden locally. Survives reload + refetch (filtered out client-side).
const DB_VERSION = 2
const CONVERSATIONS_STORE = 'conversations'
const MESSAGES_STORE = 'messages'
const HIDDEN_STORE = 'hidden'
const BY_CONVERSATION_INDEX = 'by-conversation'

interface HiddenRow {
  id: string
}

interface ChatDbSchema extends DBSchema {
  conversations: {
    key: string
    value: ChatConversation
  }
  messages: {
    key: string
    value: ChatMessage
    indexes: { 'by-conversation': [string, string] }
  }
  hidden: {
    key: string
    value: HiddenRow
  }
}

let dbPromise: Promise<IDBPDatabase<ChatDbSchema> | null> | null = null

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined'
}

function getDb(): Promise<IDBPDatabase<ChatDbSchema> | null> {
  if (!hasIndexedDb()) return Promise.resolve(null)
  if (!dbPromise) {
    dbPromise = openDB<ChatDbSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(CONVERSATIONS_STORE)) {
          db.createObjectStore(CONVERSATIONS_STORE, { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains(MESSAGES_STORE)) {
          const store = db.createObjectStore(MESSAGES_STORE, { keyPath: 'id' })
          store.createIndex(BY_CONVERSATION_INDEX, ['conversationId', 'createdAt'])
        }
        if (!db.objectStoreNames.contains(HIDDEN_STORE)) {
          db.createObjectStore(HIDDEN_STORE, { keyPath: 'id' })
        }
      }
    }).catch((err) => {
      console.warn('[chat-db] Failed to open IndexedDB; caching disabled.', err)
      return null
    })
  }
  return dbPromise
}

// ── Conversations ─────────────────────────────────────────────────────────

export async function cacheConversations(conversations: ChatConversation[]): Promise<void> {
  try {
    const db = await getDb()
    if (!db) return
    const tx = db.transaction(CONVERSATIONS_STORE, 'readwrite')
    for (const conv of conversations) {
      await tx.store.put(conv)
    }
    await tx.done
  } catch (err) {
    console.warn('[chat-db] cacheConversations failed', err)
  }
}

export async function getCachedConversations(): Promise<ChatConversation[]> {
  try {
    const db = await getDb()
    if (!db) return []
    const all = await db.getAll(CONVERSATIONS_STORE)
    // Mirror the server ordering: pinned first, then newest activity.
    return all.sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
      const at = a.lastMessageAt ?? ''
      const bt = b.lastMessageAt ?? ''
      return bt.localeCompare(at)
    })
  } catch (err) {
    console.warn('[chat-db] getCachedConversations failed', err)
    return []
  }
}

// ── Messages ──────────────────────────────────────────────────────────────

export async function cacheMessages(_convId: string, msgs: ChatMessage[]): Promise<void> {
  try {
    const db = await getDb()
    if (!db) return
    const tx = db.transaction(MESSAGES_STORE, 'readwrite')
    for (const msg of msgs) {
      await tx.store.put(msg)
    }
    await tx.done
  } catch (err) {
    console.warn('[chat-db] cacheMessages failed', err)
  }
}

/** Cached messages for a conversation, oldest→newest. `limit` keeps the most
 *  recent N (the tail) so the thread renders the latest window instantly. */
export async function getCachedMessages(convId: string, limit?: number): Promise<ChatMessage[]> {
  try {
    const db = await getDb()
    if (!db) return []
    const range = IDBKeyRange.bound([convId, ''], [convId, '￿'])
    const rows = await db.getAllFromIndex(MESSAGES_STORE, BY_CONVERSATION_INDEX, range)
    // Index sorts by [conversationId, createdAt] → already oldest→newest.
    if (limit && limit > 0 && rows.length > limit) {
      return rows.slice(rows.length - limit)
    }
    return rows
  } catch (err) {
    console.warn('[chat-db] getCachedMessages failed', err)
    return []
  }
}

export async function upsertMessage(msg: ChatMessage): Promise<void> {
  try {
    const db = await getDb()
    if (!db) return
    await db.put(MESSAGES_STORE, msg)
  } catch (err) {
    console.warn('[chat-db] upsertMessage failed', err)
  }
}

export async function removeMessage(messageId: string): Promise<void> {
  try {
    const db = await getDb()
    if (!db) return
    await db.delete(MESSAGES_STORE, messageId)
  } catch (err) {
    console.warn('[chat-db] removeMessage failed', err)
  }
}

export async function setMessageStatus(
  messageId: string,
  status: ChatMessageStatus,
  patch?: { deliveredTo?: string[]; readBy?: string[] }
): Promise<void> {
  try {
    const db = await getDb()
    if (!db) return
    const existing = await db.get(MESSAGES_STORE, messageId)
    if (!existing) return
    existing.status = status
    if (patch?.deliveredTo) existing.deliveredTo = patch.deliveredTo
    if (patch?.readBy) existing.readBy = patch.readBy
    await db.put(MESSAGES_STORE, existing)
  } catch (err) {
    console.warn('[chat-db] setMessageStatus failed', err)
  }
}

// ── Hidden messages ("Delete for me") ──────────────────────────────────────

/** Persist a message id as locally hidden so it stays removed across reloads
 *  and REST refetches (no backend change — purely client-side). */
export async function hideMessageLocally(messageId: string): Promise<void> {
  try {
    const db = await getDb()
    if (!db) return
    await db.put(HIDDEN_STORE, { id: String(messageId) })
  } catch (err) {
    console.warn('[chat-db] hideMessageLocally failed', err)
  }
}

/** All locally-hidden message ids. Loaded on store init/connect so the active
 *  thread + history merges can filter them out. */
export async function getHiddenMessageIds(): Promise<string[]> {
  try {
    const db = await getDb()
    if (!db) return []
    return await db.getAllKeys(HIDDEN_STORE)
  } catch (err) {
    console.warn('[chat-db] getHiddenMessageIds failed', err)
    return []
  }
}

export async function clearChatDb(): Promise<void> {
  try {
    const db = await getDb()
    if (!db) return
    await db.clear(CONVERSATIONS_STORE)
    await db.clear(MESSAGES_STORE)
    await db.clear(HIDDEN_STORE)
  } catch (err) {
    console.warn('[chat-db] clearChatDb failed', err)
  }
}
