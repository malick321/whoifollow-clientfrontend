export type ApiEnvironment = 'staging' | 'live'

const API_ORIGINS: Record<ApiEnvironment, string> = {
  staging: 'https://api.whoifollow.tech',
  live: 'https://api.whoifollow.com'
}

const CDN_ORIGINS: Record<ApiEnvironment, string> = {
  staging: 'https://cdn.whoifollow.tech',
  live: 'https://cdn.whoifollow.com'
}

/** Public web-app origins (the parent site this app is embedded in
 *  on team-participation routes, and the destination for outbound
 *  "view on the public site" links — event detail page, public
 *  profile pages, etc.). Mirrors the `.tech` vs `.com` split used
 *  for the API + CDN origins so all three swap in lockstep when
 *  VITE_API_ENV flips. */
const WEB_ORIGINS: Record<ApiEnvironment, string> = {
  staging: 'https://whoifollow.tech',
  live: 'https://whoifollow.com'
}

function resolveApiEnvironment(): ApiEnvironment {
  const raw = import.meta.env.VITE_API_ENV as string | undefined

  if (raw === undefined || raw === '') {
    return 'staging'
  }

  if (raw === 'staging' || raw === 'live') {
    return raw
  }

  console.warn(
    `[api/config] Invalid VITE_API_ENV value "${raw}". Expected "staging" or "live". Falling back to "staging".`
  )
  return 'staging'
}

export const ACTIVE_API_ENV: ApiEnvironment = resolveApiEnvironment()
const USE_DEV_PROXY = import.meta.env.DEV

function normalizePath(path: string) {
  if (!path) return ''
  return path.startsWith('/') ? path : `/${path}`
}

export function getApiOrigin(environment: ApiEnvironment = ACTIVE_API_ENV) {
  return API_ORIGINS[environment]
}

export function getLegacyApiBase(environment: ApiEnvironment = ACTIVE_API_ENV) {
  return `${getApiOrigin(environment)}/api`
}

export function getV2ApiBase(environment: ApiEnvironment = ACTIVE_API_ENV) {
  return `${getApiOrigin(environment)}/api/v2`
}

export function buildLegacyApiUrl(path: string, environment: ApiEnvironment = ACTIVE_API_ENV) {
  if (USE_DEV_PROXY && environment === ACTIVE_API_ENV) {
    return `/api${normalizePath(path)}`
  }

  return `${getLegacyApiBase(environment)}${normalizePath(path)}`
}

export function buildV2ApiUrl(path: string, environment: ApiEnvironment = ACTIVE_API_ENV) {
  if (USE_DEV_PROXY && environment === ACTIVE_API_ENV) {
    return `/api/v2${normalizePath(path)}`
  }

  return `${getV2ApiBase(environment)}${normalizePath(path)}`
}

export function getCdnOrigin(environment: ApiEnvironment = ACTIVE_API_ENV) {
  return CDN_ORIGINS[environment]
}

export function getWebOrigin(environment: ApiEnvironment = ACTIVE_API_ENV) {
  return WEB_ORIGINS[environment]
}

/** Build the public-web event-detail URL for the given GUID. Used
 *  by the events listing's "View Event" menu item, which opens
 *  the event's authed-user detail page on the main site in a new
 *  tab. */
export function buildEventDetailUrl(
  eventGuid: string,
  environment: ApiEnvironment = ACTIVE_API_ENV
): string {
  return `${getWebOrigin(environment)}/event/detail/${encodeURIComponent(eventGuid)}`
}

/** Build the PUBLIC-share event URL for the given event slug/GUID.
 *  This is the unauthenticated landing page anyone can hit — it maps
 *  to the `public-event` route (`/public/event/:eventSlug`, served by
 *  `PublicEventView`), which `meta.public` exempts from the auth
 *  guards. Used by the events listing's "Share" menu item / header
 *  Share button (`EventShareModal`) to surface a copy-to-clipboard URL. */
export function buildPublicEventDetailUrl(
  eventSlug: string,
  environment: ApiEnvironment = ACTIVE_API_ENV
): string {
  return `${getWebOrigin(environment)}/public/event/${encodeURIComponent(eventSlug)}`
}

function buildCdnAssetUrl(
  fileName: string | null | undefined,
  pathPrefix: string,
  environment: ApiEnvironment
): string | undefined {
  if (!fileName) return undefined
  const trimmed = fileName.trim()
  if (!trimmed) return undefined
  if (/^(https?:)?\/\//i.test(trimmed) || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return trimmed
  }
  const cleaned = trimmed.replace(/^\/+/, '')
  const normalizedPrefix = pathPrefix.replace(/^\/+/, '').replace(/\/+$/, '')
  if (cleaned === normalizedPrefix || cleaned.startsWith(`${normalizedPrefix}/`)) {
    return `${getCdnOrigin(environment)}/${cleaned}`
  }
  return `${getCdnOrigin(environment)}/${normalizedPrefix}/${cleaned}`
}

/**
 * Convert a backend-returned team/group avatar filename (optionally with an
 * AWS S3 presigned query string) into a loadable CDN URL.
 *
 * - `null` / empty input → `undefined` (callers hand this to TeamAvatar which
 *   gracefully falls back to initials).
 * - Already-absolute `http(s)://` / `data:` URLs → returned unchanged, so this
 *   is safe to apply defensively to sources that may or may not pre-prefix.
 * - Leading slashes on the filename are stripped to avoid double-slashing.
 *
 * Team/group avatars live at `{cdnOrigin}/chat/groupAvatar/{fileName}`.
 */
export function buildTeamAvatarUrl(
  fileName: string | null | undefined,
  environment: ApiEnvironment = ACTIVE_API_ENV
): string | undefined {
  return buildCdnAssetUrl(fileName, 'chat/groupAvatar', environment)
}

/**
 * Convert a backend-returned user/player avatar filename (profile photo) into
 * a loadable CDN URL. Same defensive behavior as `buildTeamAvatarUrl`.
 *
 * User / player avatars live at `{cdnOrigin}/users/avatar/{fileName}`.
 */
export function buildUserAvatarUrl(
  fileName: string | null | undefined,
  environment: ApiEnvironment = ACTIVE_API_ENV
): string | undefined {
  return buildCdnAssetUrl(fileName, 'users/avatar', environment)
}

/**
 * Convert an association logo filename/path into the public CDN location used
 * by legacy and v2 association cards: `{cdnOrigin}/associations/logo/{guid}/{fileName}`.
 */
export function buildAssociationLogoUrl(
  fileName: string | null | undefined,
  guid?: string | null,
  environment: ApiEnvironment = ACTIVE_API_ENV
): string | undefined {
  const trimmed = fileName?.trim()
  if (!trimmed) return undefined
  if (/^(https?:)?\/\//i.test(trimmed) || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return trimmed
  }

  const cleaned = trimmed.replace(/^\/+/, '')
  if (cleaned.startsWith('associations/logo/')) {
    return `${getCdnOrigin(environment)}/${cleaned}`
  }

  const normalizedGuid = guid?.trim().replace(/^\/+|\/+$/g, '')
  return normalizedGuid
    ? `${getCdnOrigin(environment)}/associations/logo/${normalizedGuid}/${cleaned}`
    : `${getCdnOrigin(environment)}/associations/logo/${cleaned}`
}

/**
 * Convert a task attachment filename/path into the public CDN location used by
 * the legacy Tasks surface: `{cdnOrigin}/user_tasks/{fileName}`.
 */
export function buildTaskMediaUrl(
  fileName: string | null | undefined,
  environment: ApiEnvironment = ACTIVE_API_ENV
): string | undefined {
  const trimmed = fileName?.trim()
  if (trimmed && /^https?:\/\//i.test(trimmed) && !trimmed.startsWith(getCdnOrigin(environment))) {
    try {
      const url = new URL(trimmed)
      if (url.pathname.includes('/user_tasks/')) {
        const file = url.pathname.split('/').filter(Boolean).pop()
        if (file) return `${getCdnOrigin(environment)}/user_tasks/${file}`
      }
    } catch {
      // Fall through to the generic CDN helper.
    }
  }

  return buildCdnAssetUrl(fileName, 'user_tasks', environment)
}
