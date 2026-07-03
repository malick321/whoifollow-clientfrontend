// Auth-handoff message contract + status types.
//
// The parent app (whoifollow.tech / whoifollow.com) embeds this app as an
// iframe. When our iframe page needs to authenticate a user, it posts a
// request message to the parent, and the parent replies with a short-lived
// handoff token (1 min TTL) that we exchange server-side for a real auth
// token.
//
// Message type strings are namespaced with `wif:` so they don't collide with
// unrelated messages the parent page may emit (analytics SDKs, etc.).

export const HANDOFF_REQUEST_TYPE = 'wif:request-handoff-token' as const
export const HANDOFF_TOKEN_TYPE = 'wif:handoff-token' as const
export const HANDOFF_ERROR_TYPE = 'wif:handoff-error' as const

export type HandoffRequestMessage = {
  type: typeof HANDOFF_REQUEST_TYPE
  source: 'matchgeni'
  participationId: string
}

export type HandoffTokenMessage = {
  type: typeof HANDOFF_TOKEN_TYPE
  token: string
  participationId?: string
}

export type HandoffErrorCode = 'not_authenticated' | 'expired' | 'unknown'

export type HandoffErrorMessage = {
  type: typeof HANDOFF_ERROR_TYPE
  code: HandoffErrorCode
  message?: string
}

export type HandoffInboundMessage = HandoffTokenMessage | HandoffErrorMessage

// Allowed parent window origins. event.origin on inbound messages and
// targetOrigin on outbound posts are validated against this list.
//
// Live parent is hosted at the `www` subdomain, so it must be in the
// allowlist explicitly — strict equality matching means the apex entry
// `https://whoifollow.com` does NOT cover `https://www.whoifollow.com`.
// Staging parent (whoifollow.tech) currently runs at the apex, so no
// `www.whoifollow.tech` counterpart is needed; add one if/when staging
// also moves to a www subdomain.
//
// Dev origins are appended at runtime when import.meta.env.DEV is true.
export const ALLOWED_PARENT_ORIGINS: readonly string[] = [
  'https://whoifollow.tech',
  'https://whoifollow.com',
  'https://www.whoifollow.com'
]

// Visible to the user via status copy. See HandoffView.vue for the
// status → message map. Never name the mechanism ("handoff", "auth", "token")
// in user-facing copy — the experience should feel like ambient app loading.
export type HandoffStatus =
  | 'getting-ready'
  | 'waiting'
  | 'verifying'
  | 'loading-data'
  | 'error'

export function isHandoffInboundMessage(data: unknown): data is HandoffInboundMessage {
  if (!data || typeof data !== 'object') return false
  const type = (data as { type?: unknown }).type
  return type === HANDOFF_TOKEN_TYPE || type === HANDOFF_ERROR_TYPE
}
