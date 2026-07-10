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

import { getLegacyJson, postJson } from './client'
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

// ── Invite a friend to join the platform ────────────────────────────
// Faithful rebuild of the legacy "Invite Friend to join Who I Follow" modal,
// backed by `POST /v2/friends/invite` (wraps legacy /invite/sendSocialInvite —
// Email via Mailable + SMS via Twilio). Contract: docs/api/invite-friend-api-contract.md.

/** Friend-connection state of an already-registered invitee, mirroring the
 *  legacy `friend_status` codes so the modal can offer the right action. */
export type FriendStatus = 0 | 1 | 3 // 0 = not friends, 1 = friends, 3 = request pending

/** The minimal invitee profile returned when the target is already registered. */
export interface InvitedFriendSummary {
  id: string | null
  name: string
  avatarUrl: string | null
  userLink: string | null
}

/** What the caller sends. At least one of `phone` / `email` must be present
 *  (the modal enforces this before calling). */
export interface InviteFriendPayload {
  countryCode?: string
  phone?: string
  email?: string
}

/** Discriminated result of an invite attempt:
 *  - `sent`               — invitation delivered.
 *  - `already_registered` — target already has an account; carries their
 *                           friend-connection status + a profile summary.
 *  - `blocked`            — a soft business rejection (already invited, can't
 *                           invite yourself, …); `message` is display-ready. */
export type InviteFriendResult =
  | { outcome: 'sent'; message: string }
  | {
      outcome: 'already_registered'
      message: string
      friendStatus: FriendStatus
      user: InvitedFriendSummary | null
    }
  | { outcome: 'blocked'; message: string }

interface RawInvitedUser {
  id?: string | null
  name?: string | null
  avatarUrl?: string | null
  userLink?: string | null
}

interface InviteEnvelope {
  responseStatus?: { message?: string | null; statusCode?: number | null } | null
  data?: {
    outcome?: string | null
    message?: string | null
    friendStatus?: number | null
    user?: RawInvitedUser | null
  } | null
}

function adaptInvitedUser(raw: RawInvitedUser | null | undefined): InvitedFriendSummary | null {
  if (!raw) return null
  return {
    id: raw.id != null ? String(raw.id) : null,
    name: raw.name?.trim() || 'Member',
    avatarUrl: buildUserAvatarUrl(raw.avatarUrl ?? undefined) ?? null,
    userLink: raw.userLink ?? null
  }
}

/** Send a platform invite by phone (with country code) and/or email.
 *  Resolves to a discriminated `InviteFriendResult`; throws only on genuine
 *  transport / server errors (the expected business outcomes come back as data). */
export async function inviteFriend(payload: InviteFriendPayload): Promise<InviteFriendResult> {
  const body = {
    email: payload.email?.trim() || '',
    number: payload.phone?.trim() || '',
    countryCode: payload.countryCode?.trim() || '+1'
  }
  const envelope = await postJson<InviteEnvelope>('/friends/invite', body)
  const data = envelope?.data ?? null
  const message = (data?.message ?? envelope?.responseStatus?.message ?? '').trim()

  if (data?.outcome === 'already_registered') {
    return {
      outcome: 'already_registered',
      message: message || 'This person is already on Who I Follow.',
      friendStatus: (data.friendStatus ?? 0) as FriendStatus,
      user: adaptInvitedUser(data.user)
    }
  }
  if (data?.outcome === 'blocked') {
    return { outcome: 'blocked', message: message || 'Invitation could not be sent.' }
  }
  return { outcome: 'sent', message: message || 'Invitation has been sent successfully.' }
}
