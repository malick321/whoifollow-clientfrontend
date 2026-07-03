import { getAuthHeaders } from '../auth-session'
import { buildV2ApiUrl } from './config'
import { interceptApiError } from './api-error-interceptor'
import type { MyAssociation } from '../types'

/**
 * Production client for the `/v2/my/associations` endpoints that
 * drive portal access:
 *
 *   - `GET /v2/my/associations`        → fetchMyAssociations() (list)
 *   - `GET /v2/my/associations/{slug}` → fetchMyAssociation(slug) (one)
 *
 * Contract: `docs/api/my-associations-api-contract.md`.
 *
 * Both endpoints return the `ResponseEnvelope` shape documented in
 * `docs/api/conventions.md` (top-level `responseStatus` + `data`).
 * These functions unwrap to return the inner `data` payload so call
 * sites (router guard, sidebar, switcher) don't have to know about
 * the envelope.
 *
 * Errors are mapped to a typed `MyAssociationsApiError` carrying the
 * HTTP status on `.code` — the router's beforeEach guard branches on
 * `err.code === 403 / 404` to route to NotFoundView. Any other status
 * re-throws as a normal Error so the unhandled-rejection bubbles up
 * to devtools.
 */

/** Wire envelope every `/v2` endpoint returns on success. */
interface ResponseEnvelope<T> {
  responseStatus: {
    statusCode: number
    message?: string
    text?: string
  }
  data: T
}

/**
 * Error shape consumed by the router beforeEach guard. The `.code`
 * field carries the HTTP status so the guard can branch on
 * `err.code === 403 || err.code === 404` → NotFoundView.
 */
export class MyAssociationsApiError extends Error {
  code: number
  data: unknown

  constructor(code: number, message: string, data: unknown = null) {
    super(message)
    this.code = code
    this.data = data
  }
}

/**
 * Internal fetch wrapper. Calls the v2 endpoint, attaches the bearer
 * token from the auth session, unwraps the response envelope, and
 * maps non-2xx responses to a `MyAssociationsApiError` so the router
 * guard can branch on status code.
 */
async function fetchEnvelope<T>(path: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(buildV2ApiUrl(path), {
      method: 'GET',
      headers: {
        ...getAuthHeaders(),
        Accept: 'application/json'
      }
    })
  } catch (networkErr) {
    // Network-level failures (offline, CORS preflight reject, DNS) — not
    // HTTP errors. Re-throw with a 0 code so the guard treats it as a
    // generic failure rather than a 403/404.
    throw new MyAssociationsApiError(
      0,
      networkErr instanceof Error ? networkErr.message : 'Network request failed.'
    )
  }

  // Try to parse a JSON body either way; servers SHOULD return the
  // envelope shape even on errors (per conventions.md §Common error codes).
  let body: ResponseEnvelope<T> | { responseStatus?: { message?: string } } | null = null
  try {
    body = await response.json()
  } catch {
    // Non-JSON response body (rare — proxy / gateway HTML error page).
    body = null
  }

  if (!response.ok) {
    const message =
      body && 'responseStatus' in body && body.responseStatus?.message?.trim()
        ? body.responseStatus.message.trim()
        : `Request failed with status ${response.status}.`
    await interceptApiError(response.status, body)
    throw new MyAssociationsApiError(response.status, message, body)
  }

  if (!body || !('data' in body)) {
    throw new MyAssociationsApiError(
      response.status,
      'Malformed response — missing "data" envelope field.'
    )
  }

  return (body as ResponseEnvelope<T>).data
}

/**
 * `GET /v2/my/associations` — list every association the logged-in
 * user has live access to. The backend returns them sorted by
 * `shortName ASC`; we don't re-sort client-side.
 *
 * Empty array is a valid result (200 with `data: []`) — not an error.
 * Used by the sidebar's association switcher modal.
 */
export async function fetchMyAssociations(): Promise<MyAssociation[]> {
  return fetchEnvelope<MyAssociation[]>('/my/associations')
}

/**
 * `GET /v2/my/associations/{slug}` — verify access + return the
 * access record for one association. Called by the router beforeEach
 * guard on every `/association/:slug/portal/*` navigation.
 *
 * Throws:
 *   - 403 (slug exists, user has no live `association_users` row on it)
 *   - 404 (slug doesn't match any `associations.username`, or the
 *     association is soft-deleted)
 *
 * The router guard handles both by routing to NotFoundView — same UX
 * for "isn't yours" and "doesn't exist" so we don't leak slug-existence
 * info.
 */
export async function fetchMyAssociation(slug: string): Promise<MyAssociation> {
  return fetchEnvelope<MyAssociation>(`/my/associations/${encodeURIComponent(slug)}`)
}
