// MatchGeni Access API
// --------------------
// Wired client for `GET /v2/association/events/{associationId}/{eventId}/my-permissions`
// per `docs/api/matchgeni-access-api-contract.md` §1.
//
// Used as the router-guard / loader for every
// `/portal/events/<event-guid>/matchgeni*` route — the response
// decides whether the user can enter MatchGeni at all, and if so,
// which actions inside MatchGeni they can perform (view vs add /
// edit / delete / alter).
//
// `{eventId}` on the contract accepts EITHER the numeric event id
// OR the event GUID — backend detects format. This is a contract
// concession specific to this endpoint (every other event
// endpoint stays strict-numeric) so the router guard doesn't have
// to chain a guid→id resolve hop before the gate fires.

import { getAuthHeaders } from '../auth-session'
import { buildV2ApiUrl } from './config'
import { interceptApiError } from './api-error-interceptor'
import type { MatchGeniAccessPayload } from '../types'

/** Standard v2 envelope. */
interface ResponseEnvelope<T> {
  responseStatus: { statusCode: number; message?: string; text?: string }
  data: T
}

/** Typed error for the matchgeni access endpoint. `.code` carries
 *  the HTTP status so the router guard can branch on 401 / 403 /
 *  404 / 409 (the four documented failure modes). */
export class MatchGeniAccessApiError extends Error {
  code: number
  data: unknown
  constructor(code: number, message: string, data: unknown = null) {
    super(message)
    this.code = code
    this.data = data
  }
}

/** Internal fetch helper. Same shape used in associationReports /
 *  events / officials clients. */
async function fetchEnvelope<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(buildV2ApiUrl(path), {
      ...init,
      headers: {
        ...getAuthHeaders(),
        Accept: 'application/json',
        ...(init.headers ?? {})
      }
    })
  } catch (networkErr) {
    throw new MatchGeniAccessApiError(
      0,
      networkErr instanceof Error ? networkErr.message : 'Network request failed.'
    )
  }

  let body: ResponseEnvelope<T> | { responseStatus?: { message?: string } } | null = null
  try {
    body = await response.json()
  } catch {
    body = null
  }

  if (!response.ok) {
    const message =
      body && 'responseStatus' in body && body.responseStatus?.message?.trim()
        ? body.responseStatus.message.trim()
        : `Request failed with status ${response.status}.`
    await interceptApiError(response.status, body)
    throw new MatchGeniAccessApiError(response.status, message, body)
  }

  if (!body || !('data' in body)) {
    throw new MatchGeniAccessApiError(
      response.status,
      'Malformed response — missing "data" envelope field.'
    )
  }

  return (body as ResponseEnvelope<T>).data
}

/**
 * `GET /v2/association/events/{associationId}/{eventId}/my-permissions`
 * — resolve the caller's MatchGeni entry gate + per-action
 *   permission set for one event. See `matchgeni-access-api-contract.md` §1.
 *
 *   - `associationId` is the association's numeric PK string (NOT the slug).
 *   - `eventIdOrGuid` accepts either the event's numeric PK or its
 *     GUID — backend detects format. Hyphenated values go through
 *     the guid-lookup path; pure-digit values go through the id-lookup
 *     path.
 *   - Success (`200`) returns `{ event, access }`. The presence of
 *     the payload IS the entry gate — there's no boolean to check.
 *   - Error codes the caller should branch on:
 *       `403` → user has no path into MatchGeni for this event
 *       `404` → event missing / soft-deleted / belongs to another association
 *       `409` → event is team-owned (MatchGeni doesn't apply)
 */
export async function fetchMatchGeniAccess(
  associationId: string,
  eventIdOrGuid: string
): Promise<MatchGeniAccessPayload> {
  if (!associationId || !eventIdOrGuid) {
    throw new MatchGeniAccessApiError(
      400,
      'fetchMatchGeniAccess requires associationId + eventIdOrGuid.'
    )
  }
  const path =
    `/association/events/${encodeURIComponent(associationId)}` +
    `/${encodeURIComponent(eventIdOrGuid)}/my-permissions`
  return fetchEnvelope<MatchGeniAccessPayload>(path)
}
