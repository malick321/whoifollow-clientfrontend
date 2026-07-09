// friends
// -------
// Thin client over the legacy `GET /api/friends/friendList?search=…` endpoint
// (no `/v2` prefix) — the current user's accepted friend connections, used by
// the chat "Add Team" + "Invite to Team" flows to pick people to add.
//
// The legacy backend returns `{ data: { friends: [...] }, statusCode, message }`
// where each friend row carries `id`, `user_name`, `fname`, `lname`,
// `profile_avatar` (CDN URL or null) and a `picture` ("yes"/other) flag. We map
// to a small camelCase `ChatFriend` domain shape, resolving the avatar URL via
// the shared CDN helper (which passes already-absolute URLs through unchanged).

import { getLegacyJson } from './client'
import { buildUserAvatarUrl } from './config'

/** A friend option as consumed by the team add / invite friend pickers.
 *  `userChatId` carries the friend's chat identity (the legacy `id`), which
 *  the team-create / invite-friends endpoints expect as the member key. */
export interface ChatFriend {
  userChatId: string
  userId: string | null
  name: string
  avatarUrl: string | null
}

interface RawFriend {
  id?: number | string | null
  user_id?: number | string | null
  chat_id?: string | null
  user_id_firebase?: string | null
  fname?: string | null
  lname?: string | null
  user_name?: string | null
  picture?: string | null
  profile_avatar?: string | null
}

interface FriendListEnvelope {
  statusCode?: number | null
  message?: string | null
  data?: {
    friends?: RawFriend[] | null
  } | null
}

function buildName(raw: RawFriend): string {
  const composed = [raw.fname ?? '', raw.lname ?? '']
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
  if (composed) return composed
  const userName = raw.user_name?.trim()
  return userName || 'Friend'
}

function adaptFriend(raw: RawFriend): ChatFriend | null {
  const chatId = raw.chat_id ?? raw.user_id_firebase ?? raw.id
  if (chatId == null) return null
  return {
    userChatId: String(chatId),
    userId: raw.user_id != null ? String(raw.user_id) : (raw.id != null ? String(raw.id) : null),
    name: buildName(raw),
    avatarUrl: buildUserAvatarUrl(raw.profile_avatar ?? undefined) ?? null
  }
}

/** Fetch the current user's friend list, optionally filtered by `search`.
 *  Resolves to `[]` on any error so a picker degrades to "no matches"
 *  rather than blocking the surrounding modal. */
export async function fetchFriends(search = ''): Promise<ChatFriend[]> {
  try {
    const qs = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '?search='
    const payload = await getLegacyJson<FriendListEnvelope>(`/friends/friendList${qs}`)
    const rows = payload?.data?.friends ?? []
    const seen = new Set<string>()
    return rows
      .map(adaptFriend)
      .filter((friend): friend is ChatFriend => friend !== null)
      .filter((friend) => {
        const key = friend.userId ? `user:${friend.userId}` : `chat:${friend.userChatId}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
  } catch (error) {
    if (typeof console !== 'undefined') {
      console.warn('[friends] fetchFriends failed — returning empty list', error)
    }
    return []
  }
}
