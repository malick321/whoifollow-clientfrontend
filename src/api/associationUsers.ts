import { getAuthHeaders } from '../auth-session'
import { buildV2ApiUrl } from './config'
import { interceptApiError } from './api-error-interceptor'
import type {
  AssociationPermissionKey,
  AssociationUser,
  AssociationUsersListParams,
  AssociationUserStatus,
  InviteStatus,
  LaravelPaginator,
  SaveAssociationUserPayload
} from '../types'

/**
 * Production client + remaining mocks for the Association Users portal.
 *
 * Three endpoints have been wired to the real backend per the contract
 * in `docs/api/association-users-api-contract.md`:
 *   - `fetchAssociationUsers`   → `GET    /v2/association/users/{associationId}`
 *   - `inviteAssociationUser`   → `POST   /v2/association/users/{associationId}/invite`
 *   - `updateAssociationUser`   → `PATCH  /v2/association/users/{associationId}/{userId}`
 *
 * The remaining three (`deleteAssociationUser`, `resendAssociationUserInvite`,
 * `cancelAssociationUserInvite`) still resolve against the in-memory
 * `mockUsers` array — their backend endpoints are not ready yet. They keep
 * their existing signatures so the swap will be a per-function body
 * replacement when the endpoints land.
 *
 * Wire envelopes: every `/v2` endpoint wraps its payload in
 * `{ responseStatus, data }` per `docs/api/conventions.md`. The wired
 * functions unwrap to return the inner `data` so call sites stay agnostic.
 * Mocked functions still return raw inner data directly. Both paths
 * normalize errors via `AssociationUsersApiError` so call sites can
 * branch on `err.code` (HTTP status) uniformly.
 */

/** Standard v2 response wrapper. */
interface ResponseEnvelope<T> {
  responseStatus: {
    statusCode: number
    message?: string
    text?: string
  }
  data: T
}

/**
 * Error thrown by the wired endpoints. Carries the HTTP status on
 * `.code` so callers can branch — e.g. 401 (re-auth via handoff),
 * 409 (duplicate email), 422 (validation). Plain `Error` is no longer
 * thrown from the wired paths; legacy mock functions still throw
 * unstructured `Error` until they're swapped to the real backend.
 */
export class AssociationUsersApiError extends Error {
  code: number
  data: unknown

  constructor(code: number, message: string, data: unknown = null) {
    super(message)
    this.code = code
    this.data = data
  }
}

/**
 * Internal fetch helper for the three wired endpoints. Attaches the
 * bearer token, JSON content-type, unwraps the response envelope, and
 * maps non-2xx responses to `AssociationUsersApiError` so callers can
 * branch on status. Network failures surface with `.code = 0`.
 */
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
    throw new AssociationUsersApiError(
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
    throw new AssociationUsersApiError(response.status, message, body)
  }

  if (!body || !('data' in body)) {
    throw new AssociationUsersApiError(
      response.status,
      'Malformed response — missing "data" envelope field.'
    )
  }

  return (body as ResponseEnvelope<T>).data
}

const SIMULATED_LATENCY_MS = 320

function delay<T>(value: T, ms = SIMULATED_LATENCY_MS): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), ms)
  })
}

/**
 * Generates a varied set of 209 fictional users so the list, filters,
 * and pagination have enough volume to feel realistic. Names are drawn
 * from common-name pools (no real people) and emails always use the
 * IANA-reserved `example.{com,org,net}` domains so they can never be
 * mistaken for a real address.
 *
 * The generator is seeded by index, so the order is deterministic
 * across reloads — useful when verifying pagination during dev.
 */
const FIRST_NAMES = [
  'Aaron', 'Alex', 'Amelia', 'Andre', 'Aria', 'Ashton', 'Avery', 'Beatrice',
  'Brandon', 'Brooke', 'Caleb', 'Camille', 'Carter', 'Charlotte', 'Chase',
  'Chloe', 'Cody', 'Colin', 'Daisy', 'Dakota', 'Damian', 'Daphne', 'Dean',
  'Delilah', 'Devon', 'Dorian', 'Edward', 'Elena', 'Elias', 'Emery',
  'Emmett', 'Esme', 'Felix', 'Finley', 'Fiona', 'Garrett', 'Genevieve',
  'Grant', 'Hadley', 'Harper', 'Hayden', 'Hazel', 'Holden', 'Ian', 'Imogen',
  'Isaac', 'Ivy', 'Jasper', 'Jenna', 'Jordan', 'Josephine', 'Kai', 'Kara',
  'Keenan', 'Kendra', 'Kieran', 'Lana', 'Landon', 'Lara', 'Lennox',
  'Liana', 'Logan', 'Lorelei', 'Luca', 'Mabel', 'Maddox', 'Maeve',
  'Marcus', 'Margot', 'Mason', 'Maya', 'Micah', 'Mira', 'Nadia', 'Nash',
  'Nathan', 'Nina', 'Nolan', 'Nora', 'Oakley', 'Olive', 'Oscar', 'Paige',
  'Parker', 'Penny', 'Phoebe', 'Quinn', 'Rafael', 'Reagan', 'Reed',
  'Remy', 'River', 'Rohan', 'Rosalie', 'Rowan', 'Sage', 'Saoirse',
  'Sasha', 'Scarlett', 'Seth', 'Silas', 'Sloane', 'Soren', 'Stella',
  'Tate', 'Thalia', 'Theo', 'Tobias', 'Vera', 'Vincent', 'Violet',
  'Wesley', 'Willa', 'Wren', 'Xavier', 'Yasmin', 'Zane', 'Zara'
]

const LAST_NAMES = [
  'Abbott', 'Alvarez', 'Ashford', 'Bancroft', 'Barlow', 'Beaumont',
  'Bellamy', 'Blackwell', 'Brennan', 'Burnham', 'Caldwell', 'Carmichael',
  'Carrington', 'Castellanos', 'Chen', 'Cho', 'Clayton', 'Cole', 'Collier',
  'Conway', 'Crawford', 'Dalton', 'Davenport', 'Delgado', 'Donovan',
  'Dunbar', 'Easton', 'Eastwood', 'Edwards', 'Ellsworth', 'Emerson',
  'Espinoza', 'Everett', 'Fairfax', 'Farrell', 'Faulkner', 'Fitzgerald',
  'Fletcher', 'Forrester', 'Galloway', 'Garrison', 'Gillespie', 'Goodwin',
  'Granger', 'Greenwood', 'Hadley', 'Hampton', 'Hargrove', 'Hartley',
  'Hawthorne', 'Hayward', 'Hendricks', 'Hollister', 'Holloway', 'Huxley',
  'Ibarra', 'Ingram', 'Ito', 'Jansen', 'Jeffries', 'Kasten', 'Kavanagh',
  'Kessler', 'Kingsley', 'Klein', 'Lambert', 'Langston', 'Larkin',
  'Lassiter', 'Leblanc', 'Levine', 'Lockhart', 'Macias', 'Mancini',
  'Marlowe', 'Marsden', 'McAllister', 'Mendez', 'Merritt', 'Monroe',
  'Montague', 'Nakamura', 'Navarro', 'Nguyen', 'Northcutt', 'Okafor',
  'Ortega', 'Paxton', 'Pemberton', 'Pettigrew', 'Prescott', 'Quincy',
  'Rasmussen', 'Redding', 'Reyes', 'Ridley', 'Rivers', 'Rosen',
  'Saunders', 'Sawyer', 'Schroeder', 'Shaw', 'Sheridan', 'Sinclair',
  'Solano', 'Stratton', 'Sutherland', 'Talbot', 'Tanaka', 'Thatcher',
  'Thornton', 'Trent', 'Underwood', 'Vance', 'Vaughn', 'Vega',
  'Walsh', 'Westbrook', 'Whitlock', 'Winslow', 'Yates', 'Zimmerman'
]

const EMAIL_DOMAINS = ['example.com', 'example.org', 'example.net']

const PERMISSION_PRESETS: Array<{ fullControl: boolean; permissions: AssociationPermissionKey[] }> = [
  { fullControl: true, permissions: [] },
  { fullControl: false, permissions: ['manage_umpires'] },
  { fullControl: false, permissions: ['manage_events'] },
  { fullControl: false, permissions: ['manage_financials'] },
  { fullControl: false, permissions: ['manage_events', 'manage_followers'] },
  { fullControl: false, permissions: ['manage_users'] },
  { fullControl: false, permissions: ['manage_followers'] },
  { fullControl: false, permissions: ['manage_settings'] },
  { fullControl: false, permissions: ['manage_events', 'manage_financials'] },
  { fullControl: false, permissions: ['manage_umpires', 'manage_users'] },
  { fullControl: false, permissions: [] },
  { fullControl: false, permissions: ['manage_events', 'manage_users', 'manage_umpires'] },
  { fullControl: false, permissions: ['manage_players'] },
  { fullControl: false, permissions: ['manage_umpires', 'manage_players'] },
  { fullControl: false, permissions: ['manage_teams'] },
  { fullControl: false, permissions: ['manage_teams', 'manage_players', 'manage_umpires'] },
  { fullControl: false, permissions: ['manage_events', 'manage_teams'] },
  { fullControl: false, permissions: ['manage_products'] },
  { fullControl: false, permissions: ['manage_products', 'manage_orders'] },
  { fullControl: false, permissions: ['manage_orders'] },
  { fullControl: false, permissions: ['manage_products', 'manage_orders', 'manage_financials'] }
]

/** Map an association membership status to a sensible cached invite
 *  status for seeded mock users. Real backend would source this from
 *  `invites.status` directly. */
function inviteStatusForSeed(status: AssociationUserStatus): InviteStatus {
  if (status === 'pending') return 'pending'
  // Both 'active' and 'inactive' implies the invite was accepted at
  // some point — admins toggle 'inactive' after the fact.
  return 'accepted'
}

function buildMockUsers(): AssociationUser[] {
  const baseDate = new Date('2026-01-15T00:00:00Z').getTime()
  const dayMs = 24 * 60 * 60 * 1000
  const total = 209
  const usedEmails = new Set<string>()
  const list: AssociationUser[] = []

  for (let i = 0; i < total; i++) {
    const first = FIRST_NAMES[i % FIRST_NAMES.length]
    const last = LAST_NAMES[(i * 7 + 3) % LAST_NAMES.length]
    const name = `${first} ${last}`

    // Build a unique fake email — restricted to example.{com,org,net}
    // so the address is guaranteed to never resolve to a real inbox.
    const domain = EMAIL_DOMAINS[i % EMAIL_DOMAINS.length]
    const local = `${first}.${last}`.toLowerCase().replace(/[^a-z0-9.]/g, '')
    let email = `${local}@${domain}`
    if (usedEmails.has(email)) {
      email = `${local}${i}@${domain}`
    }
    usedEmails.add(email)

    // Status mix: ~1-in-5 inactive, ~1-in-7 still pending an invite
    // accept (no joinedAt), the rest active. Gives the filter buttons
    // something meaningful to do without overwhelming the default
    // "active" view.
    let status: AssociationUserStatus
    if ((i * 13 + 5) % 5 === 0) status = 'inactive'
    else if ((i * 17 + 9) % 7 === 0) status = 'pending'
    else status = 'active'
    const preset = PERMISSION_PRESETS[(i * 11 + 2) % PERMISSION_PRESETS.length]

    // Event-official count distribution (deterministic per index):
    //   ~40% no events (clean rows / pure admins),
    //   ~35% 1–10 events,
    //   ~20% 18–23 events,
    //    ~5% 31+ events (the heavy contributors).
    // Pending invites are forced to 0 — they haven't accepted yet so
    // they can't be on any event roster.
    let eventOfficialCount: number
    if (status === 'pending') {
      eventOfficialCount = 0
    } else {
      const officialSeed = (i * 23 + 7) % 100
      if (officialSeed < 40) eventOfficialCount = 0
      else if (officialSeed < 75) eventOfficialCount = Math.max(1, Math.floor(officialSeed / 7))
      else if (officialSeed < 95) eventOfficialCount = Math.floor(officialSeed / 4)
      else eventOfficialCount = Math.floor(officialSeed / 3)
    }

    list.push({
      id: `assoc-user-${i + 1}`,
      name,
      email,
      status,
      fullControl: preset.fullControl,
      permissions: [...preset.permissions],
      invitedAt: new Date(baseDate - (i + 1) * dayMs).toISOString(),
      // Pending invites haven't been accepted — leave joinedAt
      // unset so the row renders the right "still waiting" UX.
      joinedAt: status === 'pending'
        ? undefined
        : new Date(baseDate - (i + 1) * dayMs + dayMs / 2).toISOString(),
      // Mock invite metadata. `inviteId` is opaque — the real backend
      // would point to a row in the central `invites` table.
      inviteId: `inv-${i + 1}`,
      inviteStatus: inviteStatusForSeed(status),
      eventOfficialCount
    })
  }

  return list
}

// In-memory state. Initialized on module load and mutated by the
// update / invite functions so the UI sees consistent values within a
// single session.
let mockUsers: AssociationUser[] = buildMockUsers()

/**
 * Fetch a paginated, optionally-filtered, optionally-sorted page of
 * users in the association. Implements the filtering / sorting that
 * a real backend would do — so the UI can be tested against the
 * exact same inputs and behaviours it'll see in production.
 *
 * **Slug → GUID flow (planned)**: the URL carries an association
 * short-name slug (e.g. `ssusa`) for clean shareable links. When the
 * real backend lands, the page-level loader will resolve that slug
 * into the association's GUID once per page load (cached for the
 * session) and pass the GUID to this function. The param name stays
 * `associationId` here because the receiver is opaque about the
 * identifier shape — only the call site needs to know whether it's
 * passing a slug, a GUID, or something else.
 */
export async function fetchAssociationUsers(
  associationId: string,
  params: AssociationUsersListParams = {}
): Promise<LaravelPaginator<AssociationUser>> {
  // Build the query string in conventions-spec form: snake_case for
  // `per_page` (per conventions.md), camelCase / single-word for the
  // rest. Omit fields the user didn't set so the backend applies its
  // own defaults; the contract documents `search=''`, `status='all'`,
  // `sort='name'`, `order='asc'`, `page=1`, `per_page=25` defaults.
  const query = new URLSearchParams()
  if (params.search && params.search.trim()) {
    query.set('search', params.search.trim())
  }
  if (params.status && params.status !== 'all') {
    query.set('status', params.status)
  }
  if (params.sort) {
    query.set('sort', params.sort)
  }
  if (params.order) {
    query.set('order', params.order)
  }
  if (typeof params.page === 'number') {
    query.set('page', String(Math.max(1, params.page)))
  }
  if (typeof params.perPage === 'number') {
    query.set('per_page', String(Math.min(100, Math.max(1, params.perPage))))
  }

  const qs = query.toString()
  const path = `/association/users/${encodeURIComponent(associationId)}${qs ? `?${qs}` : ''}`
  return fetchEnvelope<LaravelPaginator<AssociationUser>>(path)
}

/**
 * Update an existing user's role / permissions / status. The contract
 * documents this as a PARTIAL update — any field omitted is left
 * unchanged on the backend — so we forward exactly what the caller
 * sent (the existing UI always sends the complete form, but the
 * function shape is partial-friendly for future flows).
 *
 * `payload.id` becomes the URL path segment; the body carries only
 * the writable fields. Maps to:
 *   `PATCH /v2/association/users/{associationId}/{userId}`.
 */
export async function updateAssociationUser(
  associationId: string,
  payload: SaveAssociationUserPayload
): Promise<AssociationUser> {
  if (!payload.id) {
    throw new AssociationUsersApiError(0, 'updateAssociationUser requires payload.id')
  }
  const { id, ...body } = payload
  return fetchEnvelope<AssociationUser>(
    `/association/users/${encodeURIComponent(associationId)}/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(body)
    }
  )
}

/**
 * Invite a new user — creates a pending association membership and
 * dispatches the invite email. Server returns the full new user
 * record (same shape as a list row) with `status: 'pending'` and
 * `inviteStatus: 'pending'`. Maps to:
 *   `POST /v2/association/users/{associationId}/invite`.
 *
 * Only the four writable fields go on the wire; any `id` on the
 * caller's payload is ignored (server generates the membership id).
 */
export async function inviteAssociationUser(
  associationId: string,
  payload: SaveAssociationUserPayload
): Promise<AssociationUser> {
  const body = {
    name: payload.name,
    email: payload.email,
    fullControl: payload.fullControl,
    permissions: payload.permissions
  }
  return fetchEnvelope<AssociationUser>(
    `/association/users/${encodeURIComponent(associationId)}/invite`,
    {
      method: 'POST',
      body: JSON.stringify(body)
    }
  )
}

/**
 * `DELETE /v2/association/users/{associationId}/{userId}` — soft-
 * remove the user from the association. Cascade-revokes any per-
 * event grants the user holds within this association's events.
 * The server returns 204 (no body) on success; we treat any 2xx
 * as a success and resolve void.
 */
export async function deleteAssociationUser(
  associationId: string,
  userId: string
): Promise<void> {
  await fetchEnvelope<unknown>(
    `/association/users/${encodeURIComponent(associationId)}/${encodeURIComponent(userId)}`,
    { method: 'DELETE' }
  ).catch((err: unknown) => {
    // 204-no-body responses pass through `fetchEnvelope`'s
    // "missing data field" guard as a thrown error. Swallow that
    // specific shape and let any other error propagate.
    if (
      err instanceof AssociationUsersApiError &&
      err.code >= 200 &&
      err.code < 300 &&
      String(err.message).includes('Malformed response')
    ) {
      return
    }
    throw err
  })
}

/**
 * `POST /v2/association/users/{associationId}/{userId}/invites/resend`
 * — re-fire the pending-invite email. Server returns the new
 * `sentAt` timestamp so the UI can stamp the success toast with a
 * real time. 409 when the user isn't in `pending` status.
 */
export async function resendAssociationUserInvite(
  associationId: string,
  userId: string
): Promise<{ sentAt: string }> {
  return fetchEnvelope<{ sentAt: string }>(
    `/association/users/${encodeURIComponent(associationId)}/${encodeURIComponent(userId)}/invites/resend`,
    { method: 'POST' }
  )
}

/**
 * `DELETE /v2/association/users/{associationId}/{userId}/invites` —
 * cancel a pending invitation. Drops the membership row (or marks
 * it `cancelled` server-side) and the user disappears from the
 * pending tab. 204 (no body) on success.
 */
export async function cancelAssociationUserInvite(
  associationId: string,
  userId: string
): Promise<void> {
  await fetchEnvelope<unknown>(
    `/association/users/${encodeURIComponent(associationId)}/${encodeURIComponent(userId)}/invites`,
    { method: 'DELETE' }
  ).catch((err: unknown) => {
    if (
      err instanceof AssociationUsersApiError &&
      err.code >= 200 &&
      err.code < 300 &&
      String(err.message).includes('Malformed response')
    ) {
      return
    }
    throw err
  })
}
