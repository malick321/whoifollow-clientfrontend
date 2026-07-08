import axios from 'axios'
import { computed, ref } from 'vue'

const DEVICE_TOKEN_STORAGE_KEY = 'wif_device_token'
const AUTH_EMAIL_STORAGE_KEY = 'wif_auth_email'
const AUTH_USER_CHAT_ID_STORAGE_KEY = 'wif_auth_user_chat_id'
const AUTH_USER_NAME_STORAGE_KEY = 'wif_auth_user_name'
const AUTH_USER_AVATAR_URL_STORAGE_KEY = 'wif_auth_user_avatar_url'

const initialDeviceToken =
  typeof window !== 'undefined' ? window.localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY) ?? '' : ''
const initialEmail =
  typeof window !== 'undefined' ? window.localStorage.getItem(AUTH_EMAIL_STORAGE_KEY) ?? '' : ''
const initialUserChatId =
  typeof window !== 'undefined'
    ? window.localStorage.getItem(AUTH_USER_CHAT_ID_STORAGE_KEY) ?? ''
    : ''
const initialUserName =
  typeof window !== 'undefined' ? window.localStorage.getItem(AUTH_USER_NAME_STORAGE_KEY) ?? '' : ''
const initialUserAvatarUrl =
  typeof window !== 'undefined'
    ? window.localStorage.getItem(AUTH_USER_AVATAR_URL_STORAGE_KEY) ?? ''
    : ''

export const authDeviceToken = ref(initialDeviceToken)
export const authEmail = ref(initialEmail)
/** The current user's `users.chat_id` — the identity the chat socket handshake,
 *  receipts and presence events key on. Empty string when unknown. */
export const authUserChatId = ref(initialUserChatId)
/** The current user's display name (for the socket handshake query). */
export const authUserName = ref(initialUserName)
/** The current user's profile image, when the backend exposes one. */
export const authUserAvatarUrl = ref(initialUserAvatarUrl)
export const isAuthenticated = computed(() => !!authDeviceToken.value)

export function getAuthUserChatId(): string {
  return authUserChatId.value
}

export function getAuthUserName(): string {
  return authUserName.value
}

export function getAuthUserAvatarUrl(): string {
  return authUserAvatarUrl.value
}

function persistSession() {
  if (typeof window === 'undefined') return

  if (authDeviceToken.value) {
    window.localStorage.setItem(DEVICE_TOKEN_STORAGE_KEY, authDeviceToken.value)
  } else {
    window.localStorage.removeItem(DEVICE_TOKEN_STORAGE_KEY)
  }

  if (authEmail.value) {
    window.localStorage.setItem(AUTH_EMAIL_STORAGE_KEY, authEmail.value)
  } else {
    window.localStorage.removeItem(AUTH_EMAIL_STORAGE_KEY)
  }

  if (authUserChatId.value) {
    window.localStorage.setItem(AUTH_USER_CHAT_ID_STORAGE_KEY, authUserChatId.value)
  } else {
    window.localStorage.removeItem(AUTH_USER_CHAT_ID_STORAGE_KEY)
  }

  if (authUserName.value) {
    window.localStorage.setItem(AUTH_USER_NAME_STORAGE_KEY, authUserName.value)
  } else {
    window.localStorage.removeItem(AUTH_USER_NAME_STORAGE_KEY)
  }

  if (authUserAvatarUrl.value) {
    window.localStorage.setItem(AUTH_USER_AVATAR_URL_STORAGE_KEY, authUserAvatarUrl.value)
  } else {
    window.localStorage.removeItem(AUTH_USER_AVATAR_URL_STORAGE_KEY)
  }
}

function syncAxiosHeaders() {
  const token = authDeviceToken.value

  if (token) {
    axios.defaults.headers.common.Authorization = `Bearer ${token}`
  } else {
    delete axios.defaults.headers.common.Authorization
  }
}

export function getAuthHeaders() {
  const token = authDeviceToken.value
  if (!token) return {} as Record<string, string>

  return {
    Authorization: `Bearer ${token}`
  } as Record<string, string>
}

/**
 * Decode the `sub` claim from the JWT device token. Used to identify "me" in
 * endpoints whose response doesn't surface a `loggedInUserAttendee` wrapper
 * (e.g. /event/eventAttendeeListing). No signature verification — we trust
 * the backend because every protected call is re-authenticated server-side
 * via the same token, so a client-forged sub cannot grant unauthorized data.
 *
 * Returns null when the token is missing, malformed, not base64, or has no
 * `sub` claim. Callers must degrade gracefully.
 */
export function getAuthUserId(): string | null {
  const token = authDeviceToken.value
  if (!token) return null
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(padded))
    return payload?.sub != null ? String(payload.sub) : null
  } catch {
    return null
  }
}

export function setAuthSession(payload: {
  email: string
  deviceToken: string
  /** `users.chat_id` — needed for the chat socket handshake. Optional for
   *  backward compatibility with callers that don't have it yet. */
  userChatId?: string
  /** Display name — needed for the chat socket handshake query. */
  userName?: string
  /** Profile image URL, when available. */
  userAvatarUrl?: string | null
}) {
  authEmail.value = payload.email
  authDeviceToken.value = payload.deviceToken
  // Only overwrite identity fields when provided, so partial callers don't
  // wipe a previously-persisted chat identity.
  if (payload.userChatId !== undefined) authUserChatId.value = payload.userChatId
  if (payload.userName !== undefined) authUserName.value = payload.userName
  if (payload.userAvatarUrl !== undefined) authUserAvatarUrl.value = payload.userAvatarUrl ?? ''
  persistSession()
  syncAxiosHeaders()
}

/** Set just the chat identity (userChatId + display name) without touching the
 *  token/email. Used when it wasn't captured at login (older session) and is
 *  resolved later via `GET /v2/me`. Reactive — updates own/other message
 *  alignment + unblocks the socket handshake the moment it lands. */
export function setChatIdentity(userChatId: string, userName?: string, userAvatarUrl?: string | null) {
  if (userChatId) authUserChatId.value = userChatId
  if (userName !== undefined && userName !== '') authUserName.value = userName
  if (userAvatarUrl !== undefined) authUserAvatarUrl.value = userAvatarUrl ?? ''
  persistSession()
}

export function clearAuthSession() {
  authEmail.value = ''
  authDeviceToken.value = ''
  authUserChatId.value = ''
  authUserName.value = ''
  authUserAvatarUrl.value = ''
  persistSession()
  syncAxiosHeaders()
}

syncAxiosHeaders()
