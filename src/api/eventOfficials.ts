import { getAuthHeaders } from '../auth-session'
import { buildV2ApiUrl } from './config'
import { interceptApiError } from './api-error-interceptor'
import type {
  EventOfficial,
  EventOfficialsListParams,
  EventPermissionKey,
  LaravelPaginator,
  SaveEventOfficialPayload,
  ScoringScope
} from '../types'

/**
 * Wired client for per-event grant management. Endpoint surface
 * (all rooted under
 * `/v2/association/events/{associationId}/{eventId}/officials` —
 * `associationId` is the ASSOCIATION's numeric PK, not the URL slug):
 *
 *   - `fetchEventOfficials`       → GET     list (paginated)
 *   - `fetchEventOfficial`        → GET     {officialId}
 *   - `createEventOfficial`       → POST    .
 *   - `updateEventOfficial`       → PUT     {officialId}
 *   - `revokeEventOfficial`       → DELETE  {officialId}
 *
 * Contract: `docs/api/matchgeni-officials-api-contract.md` (§1 list, §2 get-one,
 * §3 add, §4 invite, §5 update, §6 revoke).
 */

const SIMULATED_LATENCY_MS = 240

function delay<T>(value: T, ms = SIMULATED_LATENCY_MS): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

interface ResponseEnvelope<T> {
  responseStatus: { statusCode: number; message?: string; text?: string }
  data: T
}

export class EventOfficialsApiError extends Error {
  code: number
  data: unknown
  constructor(code: number, message: string, data: unknown = null) {
    super(message)
    this.code = code
    this.data = data
  }
}

/** Standard envelope unwrapper. Mirrors the helper in associationUsers /
 *  events / officialEvents — attaches auth, parses `{ responseStatus,
 *  data }`, maps non-2xx to `EventOfficialsApiError` carrying the HTTP
 *  status on `.code`. */
async function fetchEnvelope<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    const hasJsonBody = init.body !== undefined
    response = await fetch(buildV2ApiUrl(path), {
      ...init,
      headers: {
        ...getAuthHeaders(),
        Accept: 'application/json',
        ...(hasJsonBody ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {})
      }
    })
  } catch (networkErr) {
    throw new EventOfficialsApiError(
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
    throw new EventOfficialsApiError(response.status, message, body)
  }

  if (!body || !('data' in body)) {
    throw new EventOfficialsApiError(
      response.status,
      'Malformed response — missing "data" envelope field.'
    )
  }

  return (body as ResponseEnvelope<T>).data
}

/** Seed — 18 officials for the events portal mock. Names and emails
 *  intentionally varied so the listing has filter / search surface
 *  to exercise + enough rows to demonstrate scroll behaviour and the
 *  sticky header. `userId` values intersect with the mock association
 *  users (1001-series ids) so the future search-existing flow can
 *  resolve them. */
function buildMockOfficials(eventId: string): EventOfficial[] {
  const baseDate = new Date('2026-04-15T12:00:00Z')
  const rows: Array<Omit<EventOfficial, 'eventId' | 'createdAt' | 'updatedAt'>> = [
    {
      id: 'eo_001',
      associationUserId: 'au_1001',
      userId: 'u_1001',
      name: 'Glen Hennessy',
      email: 'glen@ssusa.org',
      avatarUrl: undefined,
      fullControl: true,
      permissions: [],
      scoringScope: null,
      createdByUserId: 'u_42'
    },
    {
      id: 'eo_002',
      associationUserId: 'au_1004',
      userId: 'u_1004',
      name: 'Maria Ortega',
      email: 'maria@ssusa.org',
      avatarUrl: undefined,
      fullControl: false,
      permissions: ['manage_scheduling', 'manage_scoring', 'manage_umpires'],
      scoringScope: { mode: 'all', parkIds: [], divisionIds: [] },
      createdByUserId: 'u_42'
    },
    {
      id: 'eo_003',
      associationUserId: 'au_1007',
      userId: 'u_1007',
      name: 'David Carrillo',
      email: 'david@ssusa.org',
      avatarUrl: undefined,
      fullControl: false,
      permissions: ['manage_team_participation', 'manage_divisions'],
      scoringScope: null,
      createdByUserId: 'u_42'
    },
    {
      id: 'eo_004',
      associationUserId: 'au_1010',
      userId: 'u_1010',
      name: 'Linda Marsh',
      email: 'linda@ssusa.org',
      avatarUrl: undefined,
      fullControl: false,
      permissions: ['manage_scoring'],
      scoringScope: { mode: 'parks', parkIds: ['p_1', 'p_2'], divisionIds: [] },
      createdByUserId: 'u_42'
    },
    {
      id: 'eo_005',
      associationUserId: 'au_1013',
      userId: 'u_1013',
      name: 'Tom Whitfield',
      email: 'tom@ssusa.org',
      avatarUrl: undefined,
      fullControl: false,
      permissions: ['manage_scoring', 'manage_umpires'],
      scoringScope: { mode: 'divisions', parkIds: [], divisionIds: ['d_1', 'd_3'] },
      createdByUserId: 'u_42'
    },
    {
      id: 'eo_006',
      associationUserId: 'au_1016',
      userId: 'u_1016',
      name: 'Frank Yeo',
      email: 'frank@ssusa.org',
      avatarUrl: undefined,
      fullControl: false,
      permissions: ['manage_team_participation', 'manage_hotels', 'manage_sponsors'],
      scoringScope: null,
      createdByUserId: 'u_42'
    },
    {
      id: 'eo_007',
      associationUserId: 'au_1019',
      userId: 'u_1019',
      name: 'Lisa Brown',
      email: 'lisa@ssusa.org',
      avatarUrl: undefined,
      fullControl: false,
      permissions: ['edit_event', 'manage_team_participation'],
      scoringScope: null,
      createdByUserId: 'u_42'
    },
    {
      id: 'eo_008',
      associationUserId: 'au_1022',
      userId: 'u_1022',
      name: 'Anita Reyes',
      email: 'anita@ssusa.org',
      avatarUrl: undefined,
      fullControl: false,
      permissions: ['manage_parks', 'manage_scheduling'],
      scoringScope: null,
      createdByUserId: 'u_42'
    },
    {
      id: 'eo_009',
      associationUserId: 'au_1025',
      userId: 'u_1025',
      name: 'Karen Cole',
      email: 'karen@ssusa.org',
      avatarUrl: undefined,
      fullControl: false,
      permissions: ['manage_umpires', 'manage_scheduling'],
      scoringScope: null,
      createdByUserId: 'u_42'
    },
    {
      id: 'eo_010',
      associationUserId: 'au_1028',
      userId: 'u_1028',
      name: 'Eric Pace',
      email: 'eric@ssusa.org',
      avatarUrl: undefined,
      fullControl: false,
      permissions: ['manage_scoring'],
      scoringScope: { mode: 'parks', parkIds: ['p_3'], divisionIds: [] },
      createdByUserId: 'u_42'
    },
    {
      id: 'eo_011',
      associationUserId: 'au_1031',
      userId: 'u_1031',
      name: 'Olivia Trent',
      email: 'olivia@ssusa.org',
      avatarUrl: undefined,
      fullControl: false,
      permissions: ['edit_event', 'manage_sponsors'],
      scoringScope: null,
      createdByUserId: 'u_42'
    },
    {
      id: 'eo_012',
      associationUserId: 'au_1034',
      userId: 'u_1034',
      name: 'Brandon Yu',
      email: 'brandon@ssusa.org',
      avatarUrl: undefined,
      fullControl: false,
      permissions: ['manage_team_participation', 'manage_scoring'],
      scoringScope: { mode: 'divisions', parkIds: [], divisionIds: ['d_2'] },
      createdByUserId: 'u_42'
    },
    {
      id: 'eo_013',
      associationUserId: 'au_1037',
      userId: 'u_1037',
      name: 'Sophia Martin',
      email: 'sophia@ssusa.org',
      avatarUrl: undefined,
      fullControl: false,
      permissions: ['manage_hotels'],
      scoringScope: null,
      createdByUserId: 'u_42'
    },
    {
      id: 'eo_014',
      associationUserId: 'au_1040',
      userId: 'u_1040',
      name: 'Marcus King',
      email: 'marcus@ssusa.org',
      avatarUrl: undefined,
      fullControl: false,
      permissions: ['manage_divisions', 'manage_parks'],
      scoringScope: null,
      createdByUserId: 'u_42'
    },
    {
      id: 'eo_015',
      associationUserId: 'au_1043',
      userId: 'u_1043',
      name: 'Priya Shah',
      email: 'priya@ssusa.org',
      avatarUrl: undefined,
      fullControl: false,
      permissions: ['manage_scoring', 'manage_umpires', 'manage_scheduling'],
      scoringScope: { mode: 'all', parkIds: [], divisionIds: [] },
      createdByUserId: 'u_42'
    },
    {
      id: 'eo_016',
      associationUserId: 'au_1046',
      userId: 'u_1046',
      name: 'Daniel Foster',
      email: 'daniel@ssusa.org',
      avatarUrl: undefined,
      fullControl: false,
      permissions: ['manage_scoring'],
      scoringScope: { mode: 'parks', parkIds: ['p_1', 'p_2', 'p_4'], divisionIds: [] },
      createdByUserId: 'u_42'
    },
    {
      id: 'eo_017',
      associationUserId: 'au_1049',
      userId: 'u_1049',
      name: 'Rachel Singh',
      email: 'rachel@ssusa.org',
      avatarUrl: undefined,
      fullControl: false,
      permissions: ['edit_event', 'manage_team_participation', 'manage_sponsors'],
      scoringScope: null,
      createdByUserId: 'u_42'
    },
    {
      id: 'eo_018',
      associationUserId: 'au_1052',
      userId: 'u_1052',
      name: 'Jamal Carter',
      email: 'jamal@ssusa.org',
      avatarUrl: undefined,
      fullControl: false,
      permissions: ['manage_parks', 'manage_hotels', 'manage_sponsors'],
      scoringScope: null,
      createdByUserId: 'u_42'
    }
  ]
  return rows.map((r, idx) => ({
    ...r,
    eventId,
    createdAt: new Date(baseDate.getTime() - (rows.length - idx) * 86400000).toISOString(),
    updatedAt: new Date(baseDate.getTime() - (rows.length - idx) * 86400000 + 3600000).toISOString()
  }))
}

/** Cache the seed per event so re-renders don't reshuffle. */
const STORE: Record<string, EventOfficial[]> = {}
function ensureMock(eventId: string): EventOfficial[] {
  if (!STORE[eventId]) STORE[eventId] = buildMockOfficials(eventId)
  return STORE[eventId]
}

/** Auto-incrementing id for newly-created grants. */
let nextOfficialId = 9000

function matchesPermissionFilter(row: EventOfficial, key?: EventPermissionKey): boolean {
  if (!key) return true
  if (row.fullControl) return true
  return row.permissions.includes(key)
}

/**
 * `GET /v2/association/events/{associationId}/{eventId}/officials` —
 * paginated list of officials currently rostered on the event.
 */
export async function fetchEventOfficials(
  associationId: string,
  eventId: string,
  params: EventOfficialsListParams = {}
): Promise<LaravelPaginator<EventOfficial>> {
  const query = new URLSearchParams()
  if (params.search && params.search.trim()) {
    query.set('search', params.search.trim())
  }
  if (params.permission) {
    query.set('permission', params.permission)
  }
  if (params.sort) query.set('sort', params.sort)
  if (params.order) query.set('order', params.order)
  if (typeof params.page === 'number') {
    query.set('page', String(Math.max(1, params.page)))
  }
  if (typeof params.per_page === 'number') {
    query.set('per_page', String(Math.min(100, Math.max(1, params.per_page))))
  }
  const qs = query.toString()
  const path = `/association/events/${encodeURIComponent(associationId)}/${encodeURIComponent(eventId)}/officials${qs ? `?${qs}` : ''}`
  return fetchEnvelope<LaravelPaginator<EventOfficial>>(path)
}

/**
 * `GET /v2/association/events/{associationId}/{eventId}/officials/{officialId}`
 * — single official by id.
 */
export async function fetchEventOfficial(
  associationId: string,
  eventId: string,
  officialId: string
): Promise<EventOfficial> {
  return fetchEnvelope<EventOfficial>(
    `/association/events/${encodeURIComponent(associationId)}/${encodeURIComponent(eventId)}/officials/${encodeURIComponent(officialId)}`
  )
}

/**
 * `POST /v2/association/events/{associationId}/{eventId}/officials`
 *
 * Mock requires `associationUserId` + optional display-name override
 * (the real backend joins the user table on insert; here we accept
 * the display fields directly so the page can build a row without
 * a second lookup). Validation mirrors the contract.
 */
export async function createEventOfficial(
  associationId: string,
  eventId: string,
  payload: SaveEventOfficialPayload & {
    name: string
    email: string
    avatarUrl?: string
  }
): Promise<EventOfficial> {
  // Server-side validation handles the contract's invariants
  // (duplicate user, '*' in permissions, etc.) and returns the
  // appropriate 4xx via `EventOfficialsApiError`.
  return fetchEnvelope<EventOfficial>(
    `/association/events/${encodeURIComponent(associationId)}/${encodeURIComponent(eventId)}/officials`,
    {
      method: 'POST',
      body: JSON.stringify({
        associationUserId: payload.associationUserId,
        name: payload.name,
        email: payload.email,
        avatarUrl: payload.avatarUrl,
        fullControl: payload.fullControl,
        permissions: payload.fullControl ? [] : payload.permissions,
        scoringScope: normalizeScope(payload.scoringScope)
      })
    }
  )
}

/**
 * `PUT /v2/association/events/{associationId}/{eventId}/officials/{officialId}`
 * — edit an existing grant.
 */
export async function updateEventOfficial(
  associationId: string,
  eventId: string,
  officialId: string,
  payload: SaveEventOfficialPayload
): Promise<EventOfficial> {
  return fetchEnvelope<EventOfficial>(
    `/association/events/${encodeURIComponent(associationId)}/${encodeURIComponent(eventId)}/officials/${encodeURIComponent(officialId)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        fullControl: payload.fullControl,
        permissions: payload.fullControl ? [] : payload.permissions,
        scoringScope: normalizeScope(payload.scoringScope)
      })
    }
  )
}

/**
 * `DELETE /v2/association/events/{associationId}/{eventId}/officials/{officialId}`
 * — soft-revoke. Server flips `deleted_at` so re-granting can re-use
 * the row. 204 (no body) on success.
 */
export async function revokeEventOfficial(
  associationId: string,
  eventId: string,
  officialId: string
): Promise<void> {
  await fetchEnvelope<unknown>(
    `/association/events/${encodeURIComponent(associationId)}/${encodeURIComponent(eventId)}/officials/${encodeURIComponent(officialId)}`,
    { method: 'DELETE' }
  ).catch((err: unknown) => {
    if (
      err instanceof EventOfficialsApiError &&
      err.code >= 200 &&
      err.code < 300 &&
      String(err.message).includes('Malformed response')
    ) {
      return
    }
    throw err
  })
}

/** Trim a scope object to only the ids relevant to its mode so the
 *  wire shape never carries unused selections (matches contract §3
 *  validation behavior). */
function normalizeScope(scope: ScoringScope | null): ScoringScope | null {
  if (!scope) return null
  switch (scope.mode) {
    case 'all':
      return { mode: 'all', parkIds: [], divisionIds: [] }
    case 'parks':
      return { mode: 'parks', parkIds: [...scope.parkIds], divisionIds: [] }
    case 'divisions':
      return { mode: 'divisions', parkIds: [], divisionIds: [...scope.divisionIds] }
    default:
      return null
  }
}
