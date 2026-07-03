import event1Image from '../assets/events/1.png'
import event2Image from '../assets/events/2.png'
import event3Image from '../assets/events/3.png'
import event4Image from '../assets/events/4.jpg'
import event5Image from '../assets/events/5.png'
import event6Image from '../assets/events/6.png'
import { getAuthHeaders } from '../auth-session'
import { buildV2ApiUrl } from './config'
import { interceptApiError } from './api-error-interceptor'
import type {
  Division,
  EventPermissionKey,
  LaravelPaginator,
  LineupSummaryPlayer,
  OfficialEvent,
  Park,
  ScoringScope,
  ScoringScopeMode,
  TeamParticipationStatus,
  UserOfficialEventsListParams
} from '../types'

/** Standard v2 response envelope — every `/v2` endpoint wraps its
 *  payload in `{ responseStatus, data }` per docs/api/conventions.md. */
interface ResponseEnvelope<T> {
  responseStatus: { statusCode: number; message?: string; text?: string }
  data: T
}

/** Typed error for the wired endpoints in this file. Mirrors the
 *  `AssociationUsersApiError` / `EventsApiError` pattern so consumers
 *  can branch on `.code` for HTTP status (401 → re-auth, 403/404 →
 *  not-found, etc.). `.code = 0` means network failure. */
export class OfficialEventsApiError extends Error {
  code: number
  data: unknown
  constructor(code: number, message: string, data: unknown = null) {
    super(message)
    this.code = code
    this.data = data
  }
}

/** Internal fetch helper for the wired endpoints. Attaches the
 *  bearer token, unwraps the response envelope, and maps non-2xx
 *  responses to `OfficialEventsApiError`. Same shape used in
 *  `associationUsers.ts` + `events.ts`. */
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
    throw new OfficialEventsApiError(
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
    throw new OfficialEventsApiError(response.status, message, body)
  }

  if (!body || !('data' in body)) {
    throw new OfficialEventsApiError(
      response.status,
      'Malformed response — missing "data" envelope field.'
    )
  }

  return (body as ResponseEnvelope<T>).data
}

// Pre-baked event-permission "preset" buckets the mock pulls from
// so each (user, event) tuple gets a deterministic, varied subset.
// `fullControl: true` short-circuits the permissions list at the
// presentation layer — the backend will hold the same shape (boolean
// + array) so toggling FC off later restores prior selections.
interface EventPermissionPreset {
  fullControl: boolean
  permissions: EventPermissionKey[]
}

const EVENT_PERMISSION_PRESETS: EventPermissionPreset[] = [
  { fullControl: false, permissions: [] },
  { fullControl: false, permissions: ['manage_scoring'] },
  { fullControl: false, permissions: ['manage_scoring', 'manage_umpires'] },
  { fullControl: false, permissions: ['edit_event', 'manage_divisions', 'manage_parks'] },
  { fullControl: false, permissions: ['manage_team_participation'] },
  { fullControl: false, permissions: ['manage_sponsors', 'manage_hotels'] },
  // Full Control presets — the user has every event-level permission.
  // Distinct from manually-checked-all because the persisted list
  // is empty (or arbitrary) and FC overrides at render time. Spread
  // across the array so the preset-cycling formula in
  // ensureRoster() actually lands on them for various users.
  { fullControl: true, permissions: [] },
  { fullControl: false, permissions: ['manage_parks', 'manage_scoring'] },
  { fullControl: false, permissions: ['manage_divisions', 'manage_team_participation', 'manage_scheduling'] },
  { fullControl: true, permissions: [] },
  { fullControl: false, permissions: ['manage_hotels'] },
  { fullControl: false, permissions: ['manage_umpires', 'manage_scheduling'] },
  { fullControl: true, permissions: ['edit_event', 'manage_scoring'] },
  { fullControl: false, permissions: ['edit_event', 'manage_team_participation', 'manage_scoring'] },
  { fullControl: false, permissions: ['manage_scheduling'] },
  { fullControl: true, permissions: [] }
]

// Pool of 6 dummy event posters provided as design stand-ins. Mock
// events are assigned one of these on a round-robin basis so the
// modal renders varied imagery without needing a per-event asset.
// Real backend will return each event's own hero image URL.
const EVENT_IMAGES = [event1Image, event2Image, event3Image, event4Image, event5Image, event6Image]

/**
 * Mock layer for the per-user "Events as Official" listing surfaced
 * inside the user-row event-count chip's slide modal. v1 has no
 * backend — every association_user is deterministically mapped to a
 * subset of `EVENT_POOL` based on their numeric id, so reloads show
 * the same selection.
 *
 * When the real backend lands, swap `fetchUserOfficialEvents` for a
 * proper endpoint call and `removeUserFromEvent` for an event-staff
 * delete; the modal doesn't need to know.
 */

const SIMULATED_LATENCY_MS = 220

function delay<T>(value: T, ms = SIMULATED_LATENCY_MS): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

// Pool of 35 fictional events. Names + directors are made up, dates
// span 2024–2026 across multiple time zones. Real backend will return
// each event's own image; mock layer reuses the existing softball-
// field asset so we don't ship dummy event hero images.
// Static event metadata — `imageUrl` is added by hydrateEvent based
// on the round-robin pool below, and `fullControl` + `permissions`
// are per-(user, event) so they live in `userEventGrants` not here.
const EVENT_POOL: Array<Omit<OfficialEvent, 'imageUrl' | 'permissions' | 'fullControl'>> = [
  { id: 'evt-1',  dateRange: 'Mar 8 to Mar 10, 2024 (Central Time)',     name: 'Bart Adams March Madness II',           location: 'Polk County, FL',     subtitle: 'SSUSA - Softball (Slow Pitch) Tournament',   director: 'Tom Whitesides' },
  { id: 'evt-2',  dateRange: 'Apr 19 to Apr 21, 2024 (Eastern Time)',    name: 'Spring Classic Open',                   location: 'Charlotte, NC',       subtitle: 'SSUSA - Softball (Slow Pitch) Tournament',   director: 'Lisa Trent' },
  { id: 'evt-3',  dateRange: 'May 3 to May 5, 2024 (Pacific Time)',      name: 'West Coast Showdown',                   location: 'Sacramento, CA',      subtitle: 'SSUSA - Softball (Slow Pitch) Regional',     director: 'Marcus Holloway' },
  { id: 'evt-4',  dateRange: 'May 24 to May 26, 2024 (Central Time)',    name: 'Memorial Cup',                          location: 'Tulsa, OK',           subtitle: 'SSUSA - Softball (Slow Pitch) Tournament',   director: 'Patricia Vance' },
  { id: 'evt-5',  dateRange: 'Jun 7 to Jun 9, 2024 (Mountain Time)',     name: 'Rocky Mountain Roundup',                location: 'Denver, CO',          subtitle: 'SSUSA - Softball (Slow Pitch) Regional',     director: 'Diego Mendez' },
  { id: 'evt-6',  dateRange: 'Jun 21 to Jun 23, 2024 (Eastern Time)',    name: 'Summer Slam',                           location: 'Orlando, FL',         subtitle: 'SSUSA - Softball (Slow Pitch) Tournament',   director: 'Olivia Sutton' },
  { id: 'evt-7',  dateRange: 'Jul 12 to Jul 14, 2024 (Central Time)',    name: 'Independence Invitational',             location: 'Kansas City, MO',     subtitle: 'SSUSA - Softball (Slow Pitch) Tournament',   director: 'Ryan Calloway' },
  { id: 'evt-8',  dateRange: 'Jul 26 to Jul 28, 2024 (Pacific Time)',    name: 'Pacific Northwest Championship',        location: 'Portland, OR',        subtitle: 'SSUSA - Softball (Slow Pitch) Championship', director: 'Hannah Brooks' },
  { id: 'evt-9',  dateRange: 'Aug 9 to Aug 11, 2024 (Eastern Time)',     name: 'Liberty Bell Classic',                  location: 'Philadelphia, PA',    subtitle: 'SSUSA - Softball (Slow Pitch) Tournament',   director: 'Garrett Holman' },
  { id: 'evt-10', dateRange: 'Aug 23 to Aug 25, 2024 (Central Time)',    name: 'Heartland Heat',                        location: 'Des Moines, IA',      subtitle: 'SSUSA - Softball (Slow Pitch) Tournament',   director: 'Sandra Whitlock' },
  { id: 'evt-11', dateRange: 'Sep 6 to Sep 8, 2024 (Mountain Time)',     name: 'Mile High Classic',                     location: 'Colorado Springs, CO', subtitle: 'SSUSA - Softball (Slow Pitch) Regional',    director: 'Kenneth Bartlett' },
  { id: 'evt-12', dateRange: 'Sep 20 to Sep 22, 2024 (Eastern Time)',    name: 'Autumn Faceoff',                        location: 'Raleigh, NC',         subtitle: 'SSUSA - Softball (Slow Pitch) Tournament',   director: 'Maya Esposito' },
  { id: 'evt-13', dateRange: 'Oct 4 to Oct 6, 2024 (Pacific Time)',      name: 'Harvest Cup',                           location: 'Eugene, OR',          subtitle: 'SSUSA - Softball (Slow Pitch) Regional',     director: 'Frank Rasmussen' },
  { id: 'evt-14', dateRange: 'Oct 18 to Oct 20, 2024 (Central Time)',    name: 'Pumpkin Patch Open',                    location: 'Springfield, IL',     subtitle: 'SSUSA - Softball (Slow Pitch) Tournament',   director: 'Beverly Stratton' },
  { id: 'evt-15', dateRange: 'Nov 1 to Nov 3, 2024 (Eastern Time)',      name: 'Gridiron Classic',                      location: 'Atlanta, GA',         subtitle: 'SSUSA - Softball (Slow Pitch) Tournament',   director: 'Curtis Faulkner' },
  { id: 'evt-16', dateRange: 'Feb 14 to Feb 16, 2025 (Central Time)',    name: 'Sweetheart Slowpitch',                  location: 'Houston, TX',         subtitle: 'SSUSA - Softball (Slow Pitch) Tournament',   director: 'Janelle Ortega' },
  { id: 'evt-17', dateRange: 'Mar 7 to Mar 9, 2025 (Pacific Time)',      name: 'Bart Adams March Madness III',          location: 'San Diego, CA',       subtitle: 'SSUSA - Softball (Slow Pitch) Tournament',   director: 'Tom Whitesides' },
  { id: 'evt-18', dateRange: 'Mar 28 to Mar 30, 2025 (Mountain Time)',   name: 'Cactus Classic',                        location: 'Phoenix, AZ',         subtitle: 'SSUSA - Softball (Slow Pitch) Regional',     director: 'Roger Dunbar' },
  { id: 'evt-19', dateRange: 'Apr 11 to Apr 13, 2025 (Eastern Time)',    name: 'Dogwood Tournament',                    location: 'Knoxville, TN',       subtitle: 'SSUSA - Softball (Slow Pitch) Tournament',   director: 'Wendy Hartwell' },
  { id: 'evt-20', dateRange: 'Apr 25 to Apr 27, 2025 (Central Time)',    name: 'Bluebonnet Bash',                       location: 'Austin, TX',          subtitle: 'SSUSA - Softball (Slow Pitch) Tournament',   director: 'Hugh Northcutt' },
  { id: 'evt-21', dateRange: 'May 16 to May 18, 2025 (Pacific Time)',    name: 'Golden State Showdown',                 location: 'Los Angeles, CA',     subtitle: 'SSUSA - Softball (Slow Pitch) Regional',     director: 'Imani Beaumont' },
  { id: 'evt-22', dateRange: 'May 30 to Jun 1, 2025 (Eastern Time)',     name: 'Liberty Park Tournament',               location: 'Newark, NJ',          subtitle: 'SSUSA - Softball (Slow Pitch) Tournament',   director: 'Phil Castellanos' },
  { id: 'evt-23', dateRange: 'Jun 13 to Jun 15, 2025 (Mountain Time)',   name: 'Aspen Classic',                         location: 'Aspen, CO',           subtitle: 'SSUSA - Softball (Slow Pitch) Tournament',   director: 'Renata Solano' },
  { id: 'evt-24', dateRange: 'Jun 27 to Jun 29, 2025 (Central Time)',    name: 'Riverside Roundup',                     location: 'Memphis, TN',         subtitle: 'SSUSA - Softball (Slow Pitch) Tournament',   director: 'Donovan Pemberton' },
  { id: 'evt-25', dateRange: 'Jul 18 to Jul 20, 2025 (Eastern Time)',    name: 'Mid-Atlantic Open',                     location: 'Baltimore, MD',       subtitle: 'SSUSA - Softball (Slow Pitch) Championship', director: 'Adriana Forrester' },
  { id: 'evt-26', dateRange: 'Aug 1 to Aug 3, 2025 (Pacific Time)',      name: 'Cascade Cup',                           location: 'Seattle, WA',         subtitle: 'SSUSA - Softball (Slow Pitch) Regional',     director: 'Brett Easton' },
  { id: 'evt-27', dateRange: 'Aug 22 to Aug 24, 2025 (Central Time)',    name: 'Late Summer Lights',                    location: 'St. Louis, MO',       subtitle: 'SSUSA - Softball (Slow Pitch) Tournament',   director: 'Karina Whitlock' },
  { id: 'evt-28', dateRange: 'Sep 5 to Sep 7, 2025 (Mountain Time)',     name: 'High Country Hardball',                 location: 'Boise, ID',           subtitle: 'SSUSA - Softball (Slow Pitch) Tournament',   director: 'Theo Ridley' },
  { id: 'evt-29', dateRange: 'Sep 19 to Sep 21, 2025 (Eastern Time)',    name: 'Atlantic Classic',                      location: 'Virginia Beach, VA',  subtitle: 'SSUSA - Softball (Slow Pitch) Tournament',   director: 'Mira Bancroft' },
  { id: 'evt-30', dateRange: 'Oct 10 to Oct 12, 2025 (Pacific Time)',    name: 'Sunset Coast Tournament',               location: 'San Luis Obispo, CA', subtitle: 'SSUSA - Softball (Slow Pitch) Regional',     director: 'Jasper Larkin' },
  { id: 'evt-31', dateRange: 'Oct 24 to Oct 26, 2025 (Central Time)',    name: 'Fall Finale',                           location: 'Minneapolis, MN',     subtitle: 'SSUSA - Softball (Slow Pitch) Championship', director: 'Soren Ito' },
  { id: 'evt-32', dateRange: 'Mar 6 to Mar 8, 2026 (Eastern Time)',      name: 'Bart Adams March Madness IV',           location: 'Polk County, FL',     subtitle: 'SSUSA - Softball (Slow Pitch) Tournament',   director: 'Tom Whitesides' },
  { id: 'evt-33', dateRange: 'Apr 17 to Apr 19, 2026 (Mountain Time)',   name: 'Spring Awakening',                      location: 'Salt Lake City, UT',  subtitle: 'SSUSA - Softball (Slow Pitch) Tournament',   director: 'Coral Goodwin' },
  { id: 'evt-34', dateRange: 'May 1 to May 3, 2026 (Central Time)',      name: 'Magnolia Open',                         location: 'New Orleans, LA',     subtitle: 'SSUSA - Softball (Slow Pitch) Tournament',   director: 'Bram Caldwell' },
  { id: 'evt-35', dateRange: 'May 22 to May 24, 2026 (Pacific Time)',    name: 'Coastal Showdown',                      location: 'Long Beach, CA',      subtitle: 'SSUSA - Softball (Slow Pitch) Regional',     director: 'Vera Hadley' }
]

/**
 * In-memory mapping from `userId` → ordered list of event ids the
 * user is currently rostered as an Official on. Built lazily on first
 * access — once a user's roster is computed it sticks for the
 * session, so subsequent fetches are stable AND removals persist.
 */
const userEventRosters = new Map<string, string[]>()

/**
 * Per-(userId, eventId) event-level grants — both Full Control and
 * the underlying permissions array. Keyed as `${userId}::${eventId}`.
 * Built alongside the roster the first time a user's events are
 * fetched and cached for the session.
 */
interface EventGrant {
  fullControl: boolean
  permissions: EventPermissionKey[]
  /** Scope of the user's `manage_scoring` permission for this
   *  event. Only meaningful when `manage_scoring` is in the
   *  permissions array; ignored otherwise. Default is "all
   *  games" — see `defaultScoringScope`. */
  scoringScope?: ScoringScope
}

const defaultScoringScope: ScoringScope = {
  mode: 'all',
  parkIds: [],
  divisionIds: []
}
const userEventGrants = new Map<string, EventGrant>()
function permissionKey(userId: string, eventId: string): string {
  return `${userId}::${eventId}`
}

// HMR — wipe the in-memory caches whenever this module hot-reloads so
// preset/seed changes are picked up immediately without a full page
// refresh. Vite injects `import.meta.hot` only in dev; production
// builds skip this block entirely.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    userEventRosters.clear()
    userEventGrants.clear()
  })
}

/** Build the deterministic event roster for a user the first time
 *  it's requested. Uses the user's index (parsed from the id) and a
 *  count clamped to the requested `eventOfficialCount` so the mock
 *  matches what the user-row chip displays. */
function ensureRoster(userId: string, eventOfficialCount: number): string[] {
  if (userEventRosters.has(userId)) return userEventRosters.get(userId)!

  // assoc-user-{N} → numeric index. Generated users follow this
  // shape; invited users use a Date.now()-based id so they don't.
  const match = /assoc-user-(\d+)/.exec(userId)
  const index = match ? Number(match[1]) : 1

  const count = Math.min(eventOfficialCount, EVENT_POOL.length)
  const roster: string[] = []
  for (let i = 0; i < count; i++) {
    // Walk the pool with a stride seeded by the user's index so two
    // different users get visibly different (but deterministic)
    // event sets.
    const eventIndex = (index * 7 + i * 3) % EVENT_POOL.length
    const eventId = EVENT_POOL[eventIndex].id
    if (!roster.includes(eventId)) roster.push(eventId)

    // Seed event-level Full Control + permissions for this
    // (user, event) tuple. The first event in each user's roster
    // is FORCED to a Full Control preset (so every user with any
    // event has at least one FC chip visible — guarantees the
    // FC variant always appears in the demo without depending on
    // the seed math landing on it). Subsequent events use the
    // cycling formula across all 16 presets for variety.
    let preset: EventPermissionPreset
    if (i === 0) {
      preset = { fullControl: true, permissions: [] }
    } else {
      const presetIndex = (index * 11 + i * 5 + eventIndex * 3) % EVENT_PERMISSION_PRESETS.length
      preset = EVENT_PERMISSION_PRESETS[presetIndex]
    }
    // Seed the scoring scope when this preset includes
    // `manage_scoring`. Distribution across the rostered events:
    //   - 50% all games          (mode: 'all')
    //   - 30% specific parks     (mode: 'parks', 1–2 parks picked)
    //   - 20% specific divisions (mode: 'divisions', 1–2 divisions picked)
    // The dist + picks are seeded by `(index, eventIndex)` so
    // reloads stay stable. Events without parks fall back to
    // `divisions` (and vice versa) so the picked mode always has
    // something selectable.
    let scoringScope: ScoringScope | undefined
    if (preset.permissions.includes('manage_scoring')) {
      scoringScope = buildSeededScoringScope(eventIndex, index)
    }
    userEventGrants.set(permissionKey(userId, eventId), {
      fullControl: preset.fullControl,
      permissions: [...preset.permissions],
      scoringScope
    })
  }
  userEventRosters.set(userId, roster)
  return roster
}

// Parks + divisions catalogue per event. Deterministic per
// event index so reloads show the same lists. Both lists are
// always ≥ 5 entries so the access modal's multi-pick controls
// always have several options to choose from in the demo.
const PARK_NAME_POOL = [
  'Riverside Park',
  'Oak Hill Park',
  'Sunset Field',
  'Maple Grove Park',
  'Cypress Sports Complex',
  'Lakefront Diamond',
  'Heritage Athletic Park',
  'North Ridge Field'
]

const DIVISION_NAME_POOL = [
  "Men's 50+ Major+",
  "Men's 65+ AAA",
  "Women's 40+ Major",
  "Coed 35+ AAA",
  "Men's 70+ AA",
  "Women's 50+ Major+",
  "Men's 55+ Major",
  "Coed 60+ AAA"
]

export function buildParksFor(eventIndex: number): Park[] {
  // 5–8 parks per event, deterministic via index.
  const count = 5 + ((eventIndex * 7 + 3) % 4)
  const parks: Park[] = []
  for (let i = 0; i < count; i++) {
    const name = PARK_NAME_POOL[(eventIndex + i) % PARK_NAME_POOL.length]
    parks.push({ id: `evt-${eventIndex}-park-${i}`, name })
  }
  return parks
}

export function buildDivisionsFor(eventIndex: number): Division[] {
  // 5–8 divisions per event, deterministic via index.
  const count = 5 + ((eventIndex * 11 + 5) % 4)
  const divisions: Division[] = []
  for (let i = 0; i < count; i++) {
    const name = DIVISION_NAME_POOL[(eventIndex + i) % DIVISION_NAME_POOL.length]
    divisions.push({ id: `evt-${eventIndex}-div-${i}`, name })
  }
  return divisions
}

/** Generate a deterministic scoring scope for a (user, event)
 *  tuple. Distribution: 50% all / 30% parks / 20% divisions —
 *  with intelligent fallback if the chosen mode has no entities
 *  to pick (e.g. drop to 'all' for events with no parks AND
 *  'divisions' was rolled, etc.). Picks 1–2 entities at random
 *  from the event's catalogue so the modal demos a partial
 *  selection rather than always-all-or-always-one. */
function buildSeededScoringScope(eventIndex: number, userIndex: number): ScoringScope {
  const parks = buildParksFor(eventIndex)
  const divisions = buildDivisionsFor(eventIndex)

  // Mode roll: 0–49 = all, 50–79 = parks, 80–99 = divisions.
  const roll = (userIndex * 13 + eventIndex * 17 + 5) % 100
  let mode: ScoringScopeMode
  if (roll < 50) mode = 'all'
  else if (roll < 80) mode = 'parks'
  else mode = 'divisions'

  // Fallbacks when the rolled mode has no entities.
  if (mode === 'parks' && parks.length === 0) {
    mode = divisions.length > 0 ? 'divisions' : 'all'
  } else if (mode === 'divisions' && divisions.length === 0) {
    mode = parks.length > 0 ? 'parks' : 'all'
  }

  if (mode === 'all') {
    return { mode: 'all', parkIds: [], divisionIds: [] }
  }

  // Pick 1–2 entities from the chosen list.
  const list = mode === 'parks' ? parks : divisions
  const pickCount = Math.min(list.length, 1 + ((userIndex + eventIndex) % 2))
  const picked: string[] = []
  for (let i = 0; i < pickCount; i++) {
    const idx = (userIndex * 5 + eventIndex * 3 + i * 7) % list.length
    if (!picked.includes(list[idx].id)) picked.push(list[idx].id)
  }
  if (mode === 'parks') {
    return { mode: 'parks', parkIds: picked, divisionIds: [] }
  }
  return { mode: 'divisions', parkIds: [], divisionIds: picked }
}

/** Build the deterministic `event_officials.id` for a (user, event)
 *  pair. The production backend hands back a real PK; the mock
 *  fabricates a stable composite so we can round-trip through the
 *  event-scoped write endpoints from both the user-portal modal and
 *  the MatchGeni Officials list. Parseable by `parseOfficialId`. */
function buildOfficialId(userId: string, eventId: string): string {
  return `eo::${userId}::${eventId}`
}

/** Inverse of `buildOfficialId` — recovers (userId, eventId) from
 *  the composite. Returns null when the input doesn't match the
 *  mock shape (e.g. a real backend id during a partial swap), so
 *  callers can fall back to a different lookup strategy. */
function parseOfficialId(officialId: string): { userId: string; eventId: string } | null {
  const match = /^eo::(.+)::(evt-\d+)$/.exec(officialId)
  if (!match) return null
  return { userId: match[1], eventId: match[2] }
}

function hydrateEvent(eventId: string, userId: string): OfficialEvent | null {
  const index = EVENT_POOL.findIndex((event) => event.id === eventId)
  if (index === -1) return null
  const grant = userEventGrants.get(permissionKey(userId, eventId))
    ?? { fullControl: false, permissions: [] }
  const parks = buildParksFor(index)
  const divisions = buildDivisionsFor(index)
  return {
    ...EVENT_POOL[index],
    officialId: buildOfficialId(userId, eventId),
    imageUrl: EVENT_IMAGES[index % EVENT_IMAGES.length],
    fullControl: grant.fullControl,
    permissions: [...grant.permissions],
    parks,
    divisions,
    scoringScope: grant.scoringScope
      ? {
          mode: grant.scoringScope.mode,
          parkIds: [...grant.scoringScope.parkIds],
          divisionIds: [...grant.scoringScope.divisionIds]
        }
      : { ...defaultScoringScope, parkIds: [], divisionIds: [] }
  }
}

/** Build the standard Laravel paginator wrapper for a sliced list of
 *  events. Mirrors the helper in `associationUsers.ts` so both list
 *  endpoints emit the exact same shape the production backend will. */
function buildEventsPaginator(
  rows: OfficialEvent[],
  total: number,
  page: number,
  perPage: number,
  basePath: string
): LaravelPaginator<OfficialEvent> {
  const lastPage = Math.max(1, Math.ceil(total / perPage))
  const from = total === 0 ? null : (page - 1) * perPage + 1
  const to = total === 0 ? null : Math.min(total, page * perPage)
  const pageUrl = (n: number) => `${basePath}?page=${n}`

  const links: LaravelPaginator<OfficialEvent>['links'] = []
  links.push({
    url: page > 1 ? pageUrl(page - 1) : null,
    label: '&laquo; Previous',
    active: false
  })
  for (let i = 1; i <= lastPage; i++) {
    links.push({ url: pageUrl(i), label: String(i), active: i === page })
  }
  links.push({
    url: page < lastPage ? pageUrl(page + 1) : null,
    label: 'Next &raquo;',
    active: false
  })

  return {
    current_page: page,
    data: rows,
    first_page_url: pageUrl(1),
    from,
    last_page: lastPage,
    last_page_url: pageUrl(lastPage),
    links,
    next_page_url: page < lastPage ? pageUrl(page + 1) : null,
    path: basePath,
    per_page: perPage,
    prev_page_url: page > 1 ? pageUrl(page - 1) : null,
    to,
    total
  }
}

/**
 * `GET /v2/association/users/{associationId}/{userId}/events`
 * — paginated list of events the supplied user is rostered on as an
 * Official within the given association. Backend joins
 * `event_officials` → `team_events` → enriches with each grant's
 * `fullControl` + `permissions` + `scoringScope` so the modal can
 * render the per-event access state without a second call.
 *
 * Query parameters (per the listing-endpoint convention used across
 * the portal):
 *   - `search` (string)        — case-insensitive substring on
 *                                 event name
 *   - `page`   (int, 1-based)  — Laravel paginator page
 *   - `per_page` (int, snake_case) — page size (capped at 100)
 *
 * Returns the standard Laravel paginator envelope wrapping
 * `OfficialEvent[]`.
 *
 * Path params:
 *   - `associationId` — the ASSOCIATION's numeric PK (from
 *     `currentAssociation.value.id`), NOT the URL slug.
 *   - `userId`        — the `association_users.id` for the row whose
 *     events chip was tapped.
 */
export async function fetchUserOfficialEvents(
  associationId: string,
  userId: string,
  params: UserOfficialEventsListParams = {}
): Promise<LaravelPaginator<OfficialEvent>> {
  const query = new URLSearchParams()
  if (params.search && params.search.trim()) {
    query.set('search', params.search.trim())
  }
  const page = Math.max(1, params.page ?? 1)
  if (page > 1) query.set('page', String(page))
  if (typeof params.perPage === 'number') {
    const perPage = Math.min(100, Math.max(1, params.perPage))
    query.set('per_page', String(perPage))
  }

  const qs = query.toString()
  const path = `/association/users/${encodeURIComponent(associationId)}/${encodeURIComponent(userId)}/events${qs ? `?${qs}` : ''}`
  return fetchEnvelope<LaravelPaginator<OfficialEvent>>(path)
}

/** Fetch every event a team has participated in. v1 mock: derives a
 *  roster deterministically from the team's id (we extract the
 *  numeric index when the id matches `assoc-team-{N}`). The team's
 *  event-level permissions/grants don't apply here — this is a flat
 *  list of events for read-only display in the team-details modal. */
export async function fetchTeamEvents(teamId: string): Promise<OfficialEvent[]> {
  const match = /assoc-team-(\d+)/.exec(teamId)
  const seed = match ? Number(match[1]) : Math.abs(hashString(teamId))
  // Each team gets between 10 and 18 events depending on the seed —
  // the team-details Participations tab needs enough rows to make
  // the sticky-header behaviour feel natural when scrolling.
  const minEvents = 10
  const eventCount = Math.min(EVENT_POOL.length, minEvents + ((seed * 13 + 5) % 9))
  const events: OfficialEvent[] = []
  // Stride must be coprime with EVENT_POOL.length so the walk covers
  // every slot before wrapping. Using stride 1 with a seeded start
  // offset is the simplest guarantee — pool order varies per team,
  // and we always get `eventCount` unique events.
  const start = ((seed * 5 + 3) % EVENT_POOL.length + EVENT_POOL.length) % EVENT_POOL.length
  let cursor = 0
  while (events.length < eventCount && cursor < EVENT_POOL.length * 2) {
    const eventIndex = (start + cursor) % EVENT_POOL.length
    cursor++
    const eventId = EVENT_POOL[eventIndex].id
    const hydrated = hydrateEvent(eventId, `team-${teamId}`)
    if (!hydrated) continue
    if (events.some((e) => e.id === hydrated.id)) continue
    // Seed participation metadata: deterministic ref number + status
    // so reloads stay stable. The format mirrors the live backend
    // shape (e.g. "PVG-179-R8G").
    const refIndex = events.length
    hydrated.participationNo = buildParticipationNo(seed, eventIndex, refIndex)
    hydrated.participationStatus = pickParticipationStatus(seed, eventIndex, refIndex)
    hydrated.lineupSummary = buildTeamEventLineup(seed, eventIndex, refIndex)
    events.push(hydrated)
  }
  return delay(events)
}

/** Tiny deterministic hash for non-numeric team ids. */
function hashString(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0
  }
  return hash
}

/** Build a participation reference number in the form "PVG-179-R8G".
 *  Deterministic for a (team, event, slot) tuple so reloads don't
 *  shuffle the displayed numbers. */
function buildParticipationNo(seed: number, eventIndex: number, slot: number): string {
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ' // omit I/O for legibility
  const ALNUM = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const prefixA = ALPHA[(seed * 7 + slot * 3) % ALPHA.length]
  const prefixB = ALPHA[(seed * 13 + eventIndex * 5 + 2) % ALPHA.length]
  const prefixC = ALPHA[(seed * 17 + slot * 11 + 9) % ALPHA.length]
  const middle = (((seed * 31 + eventIndex * 23 + slot * 7) % 900) + 100) // 100-999
  const tailA = ALNUM[(seed * 19 + slot * 5 + eventIndex) % ALNUM.length]
  const tailB = ((seed * 11 + slot * 3 + eventIndex * 2) % 9) + 1 // 1-9
  const tailC = ALNUM[(seed * 23 + slot * 7 + eventIndex * 3 + 4) % ALNUM.length]
  return `${prefixA}${prefixB}${prefixC}-${middle}-${tailA}${tailB}${tailC}`
}

const PARTICIPATION_STATUSES: TeamParticipationStatus[] = [
  'initiated',
  'pending_approval',
  'confirmed',
  'waitlisted',
  'withdrawn',
  'cancelled'
]

/** Distribution-weighted pick: most participations are confirmed
 *  (real-world skew), with a smaller scattering of the other
 *  states so every status renders somewhere in the demo data. */
function pickParticipationStatus(seed: number, eventIndex: number, slot: number): TeamParticipationStatus {
  const roll = (seed * 29 + eventIndex * 17 + slot * 11) % 100
  if (roll < 55) return 'confirmed'
  if (roll < 70) return 'pending_approval'
  if (roll < 80) return 'initiated'
  if (roll < 88) return 'waitlisted'
  if (roll < 95) return 'withdrawn'
  return 'cancelled'
}

// Names + positions used to fabricate a believable per-event lineup
// for the team-details Participations tab. The pool is intentionally
// small — the lineup card is meant to be a quick-glance, not a
// fully unique roster per event.
const LINEUP_NAMES = [
  'Mike Carter', 'Joe Reyes', 'Tony Marsh', 'Frank Albright', 'Ed Patel',
  'Greg Lin', 'Bobby Vega', 'Steve Hunter', 'Dale Burke', 'Walt Sanchez',
  'Carl Nguyen', 'Hank Brooks', 'Russ Patton', 'Phil Donovan', 'Manny Ortiz',
  'Pete Sullivan', 'Don Whitley', 'Vince Garber', 'Lenny Cook', 'Sal Pruitt',
  'Aaron Kelley', 'Bruce Foley', 'Dave Howell'
]
const LINEUP_POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'LC', 'RC', 'RF']

function buildTeamEventLineup(seed: number, eventIndex: number, slot: number): LineupSummaryPlayer[] {
  const lineupSeed = seed * 37 + eventIndex * 19 + slot * 7
  // Roughly 80% of participations have a submitted lineup so the
  // empty-state copy still appears occasionally in the demo.
  if (lineupSeed % 5 === 0) return []
  const starterCount = LINEUP_POSITIONS.length // one per position
  const benchCount = 3 + (lineupSeed % 3) // 3-5 bench players
  const players: LineupSummaryPlayer[] = []
  for (let i = 0; i < starterCount; i++) {
    const nameIndex = (lineupSeed + i * 13) % LINEUP_NAMES.length
    players.push({
      jerseyNumber: String(((lineupSeed + i * 7) % 89) + 10),
      name: LINEUP_NAMES[nameIndex],
      position: LINEUP_POSITIONS[i],
      isStarter: true,
      isActive: true,
      isBench: false
    })
  }
  for (let i = 0; i < benchCount; i++) {
    const nameIndex = (lineupSeed + starterCount * 13 + i * 11 + 5) % LINEUP_NAMES.length
    players.push({
      jerseyNumber: String(((lineupSeed + i * 5 + 91) % 89) + 10),
      name: LINEUP_NAMES[nameIndex],
      position: 'BN',
      isStarter: false,
      isActive: true,
      isBench: true
    })
  }
  return players
}

/** Update the event-level grant (Full Control + permissions) for a
 *  single `event_officials.id`. Mirrors the production endpoint
 *  `PUT /v2/association/events/{associationId}/{eventId}/officials/{officialId}`
 *  per [`matchgeni-officials-api-contract.md` §5](../../docs/api/matchgeni-officials-api-contract.md).
 *  Used by:
 *    - the Edit Access flow in the user-portal `UserEventsModal`
 *    - the Edit drawer in the MatchGeni Officials list
 *    - the Add-Existing-User flow in `EventOfficialAccessModal`
 *
 *  Auto-upserts: when no grant exists yet (officialId carries an
 *  unseen user/event pair), this doubles as the Invite/Assign path
 *  by appending the event to the user's roster. Returns the freshly-
 *  hydrated OfficialEvent so the caller can splice without a refetch. */
export async function updateEventOfficialAccess(
  associationId: string,
  eventId: string,
  officialId: string,
  payload: {
    fullControl: boolean
    permissions: EventPermissionKey[]
    /** Optional — only meaningful when `manage_scoring` is in the
     *  permissions array. When omitted, the server preserves the
     *  existing scope (or the default "all games" scope). */
    scoringScope?: ScoringScope
  }
): Promise<OfficialEvent> {
  return fetchEnvelope<OfficialEvent>(
    `/association/events/${encodeURIComponent(associationId)}/${encodeURIComponent(eventId)}/officials/${encodeURIComponent(officialId)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        fullControl: payload.fullControl,
        permissions: payload.fullControl ? [] : payload.permissions,
        // Only send the scope when manage_scoring is granted, so
        // the server isn't asked to compute a scope for a
        // permission the user doesn't even hold.
        scoringScope: payload.permissions.includes('manage_scoring')
          ? payload.scoringScope ?? null
          : null
      })
    }
  )
}

/** Revoke a grant by `event_officials.id`. Mirrors the production
 *  endpoint
 *  `DELETE /v2/association/events/{associationId}/{eventId}/officials/{officialId}`
 *  per [`matchgeni-officials-api-contract.md` §6](../../docs/api/matchgeni-officials-api-contract.md).
 *  Returns the user's NEW `event_officials` count so the caller can
 *  update the user-row chip without a refetch. */
export async function removeUserFromEvent(
  associationId: string,
  eventId: string,
  officialId: string
): Promise<{ newCount: number; associationUserId: string }> {
  // Server returns `{ newCount, associationUserId }` on success so
  // the caller can refresh the user-row chip without a follow-up
  // fetch. The endpoint is the same DELETE the MatchGeni officials
  // page hits via `revokeEventOfficial`, but the response shape is
  // different (the per-user surface needs the new count).
  return fetchEnvelope<{ newCount: number; associationUserId: string }>(
    `/association/events/${encodeURIComponent(associationId)}/${encodeURIComponent(eventId)}/officials/${encodeURIComponent(officialId)}`,
    { method: 'DELETE' }
  )
}

// Mock helpers above (ensureRoster, hydrateEvent, userEventRosters,
// userEventGrants, etc.) are retained for `fetchTeamEvents` — the
// only consumer that still lives on the mock layer until its
// dedicated endpoint ships. Everything else in this file is wired
// to the real backend.
