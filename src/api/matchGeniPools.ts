import { getJson, putJson } from './client'
import type { DivisionPool, DivisionPoolsData, ManagePoolTeam } from '../types'

// MatchGeni Team Pools API
// ------------------------
// Backs the **Manage Team Pools** modal on the division page. See
// `docs/api/matchgeni-division-api-contract.md` §7. Two endpoints:
//
//   GET /v2/association/events/{associationId}/{eventId}/divisions/{divisionId}/pools
//   PUT /v2/association/events/{associationId}/{eventId}/divisions/{divisionId}/pools
//
// The GET composes:
//   - eligible teams = `event_joined_team` rows for the event, filtered
//     by the division's age-group / rating restrictions;
//   - their current placement = `tournament_teams.pool_id` (NULL → the
//     "Available" column);
//   - the division's `continuous_team_sr_no` flag.
//
// The PUT is a SINGLE bulk reconcile of the modal's whole working copy —
// the body is the complete desired state (every pool + its ordered team
// ids); the backend diffs vs. current rows and reconciles create / rename
// / delete / placement in one transaction (§7.2). Atomic + Cancel-safe,
// which is why the modal saves once rather than firing granular CRUD.
//
// Mock-first behind `POOLS_ENDPOINT_LIVE`; flip to true when the routes
// ship — the live branches map the standard v2 envelope. The modal
// consumes the typed shapes as-is.
const POOLS_ENDPOINT_LIVE = false

/** Standard v2 envelope. */
interface PoolsEnvelope {
  responseStatus?: { statusCode: number; message?: string; text?: string }
  data: DivisionPoolsData
}

/** Coerce a raw envelope `data` into a `DivisionPoolsData` with safe
 *  defaults (the live shape is already camelCase per §7.1). */
function mapPoolsData(raw: Partial<DivisionPoolsData> | null | undefined): DivisionPoolsData {
  return {
    available: raw?.available ?? [],
    pools: raw?.pools ?? [],
    continuousSerial: raw?.continuousSerial ?? true,
    restrictTeams: raw?.restrictTeams ?? false,
    ageGroups: raw?.ageGroups ?? [],
    ratings: raw?.ratings ?? []
  }
}

/** Build the §7.2 bulk-save body: the complete desired layout. New pools
 *  (modal `new-*` working-copy ids) are sent as `id: null`; existing pools
 *  send their real id. `teamIds` order = placement order. */
function buildSaveBody(data: DivisionPoolsData): { pools: { id: string | null; name: string; teamIds: string[] }[] } {
  return {
    pools: data.pools.map((p) => ({
      id: p.id.startsWith('new-') ? null : p.id,
      name: p.name,
      teamIds: p.teams.map((t) => t.id)
    }))
  }
}

function poolsPath(associationId: string, eventId: string, divisionId: string): string {
  return (
    `/association/events/${encodeURIComponent(associationId)}` +
    `/${encodeURIComponent(eventId)}/divisions/${encodeURIComponent(divisionId)}/pools`
  )
}

const SIMULATED_LATENCY_MS = 240

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), SIMULATED_LATENCY_MS))
}

const MOCK_POOLS_BY_DIVISION: Record<string, DivisionPoolsData> = {}

const MOCK_TEAM_NAMES = [
  'Thunder', 'Mavericks', 'Riptide', 'Sluggers', 'Outlaws', 'Renegades',
  'Cyclones', 'Diamonds', 'Pioneers', 'Express', 'Legends', 'Aces',
  'Titans', 'Bandits', 'Crushers', 'Storm'
]
const MOCK_AGE_GROUPS = ["Men's 50", "Men's 55", "Men's 60", "Men's 65", "Men's 40", "Men's 70"]
const MOCK_RATINGS = ['Major+', 'Major', 'AAA', 'AA']
const MOCK_CITIES = [
  'Raleigh, NC', 'Austin, TX', 'Tampa, FL', 'Phoenix, AZ', 'Denver, CO',
  'Reno, NV', 'Mesa, AZ', 'Dallas, TX', 'Orlando, FL', 'Charlotte, NC'
]

function mockTeam(divisionId: string, idx: number): ManagePoolTeam {
  // Meta reads "age group · rating - location" — the joined fields the
  // real endpoint will surface from `event_joined_team`.
  const age = MOCK_AGE_GROUPS[idx % MOCK_AGE_GROUPS.length]
  const rating = MOCK_RATINGS[idx % MOCK_RATINGS.length]
  const city = MOCK_CITIES[idx % MOCK_CITIES.length]
  return {
    id: `${divisionId}-team-${idx}`,
    name: `${MOCK_TEAM_NAMES[idx % MOCK_TEAM_NAMES.length]} ${60 + (idx % 6) * 5}`,
    meta: `${age} · ${rating} - ${city}`
  }
}

/** Deterministic per-division mock — a default pool pre-filled with a
 *  few teams plus a handful of unassigned (Available) teams. Stable per
 *  division id so the layout doesn't reshuffle across opens. The
 *  returned object is deep-cloned on read so the modal can mutate its
 *  working copy without corrupting the cache. */
function seedPools(divisionId: string, continuousSerial: boolean): DivisionPoolsData {
  if (!MOCK_POOLS_BY_DIVISION[divisionId]) {
    const total = 8
    const teams = Array.from({ length: total }, (_, i) => mockTeam(divisionId, i))
    const defaultPool: DivisionPool = {
      id: `${divisionId}-pool-default`,
      name: 'Pool A',
      isDefault: true,
      teams: teams.slice(0, 4)
    }
    MOCK_POOLS_BY_DIVISION[divisionId] = {
      available: teams.slice(4),
      pools: [defaultPool],
      continuousSerial,
      // Mock division restricts to specific ages + ratings so the
      // header's eligibility line exercises the restricted branch.
      restrictTeams: true,
      ageGroups: ['40+', '50+', '55+'],
      ratings: ['AA', 'AAA']
    }
  }
  return MOCK_POOLS_BY_DIVISION[divisionId]
}

function clone(data: DivisionPoolsData): DivisionPoolsData {
  return {
    continuousSerial: data.continuousSerial,
    available: data.available.map((t) => ({ ...t })),
    pools: data.pools.map((p) => ({ ...p, teams: p.teams.map((t) => ({ ...t })) })),
    restrictTeams: data.restrictTeams,
    ageGroups: [...data.ageGroups],
    ratings: [...data.ratings]
  }
}

/** Fetch the division's pools + eligible teams for the Manage Team
 *  Pools modal. `continuousSerial` seeds the mock's flag (the real
 *  endpoint reads it off the division row). */
export async function fetchDivisionPools(
  associationId: string,
  eventId: string,
  divisionId: string,
  continuousSerial = true
): Promise<DivisionPoolsData> {
  if (POOLS_ENDPOINT_LIVE) {
    const envelope = await getJson<PoolsEnvelope>(poolsPath(associationId, eventId, divisionId))
    return mapPoolsData(envelope.data)
  }
  return delay(clone(seedPools(divisionId, continuousSerial)))
}

/** Persist the pool layout (membership + ordering + names). Mock just
 *  echoes the submitted layout back into the per-division cache so a
 *  re-open reflects the last save. */
export async function saveDivisionPools(
  associationId: string,
  eventId: string,
  divisionId: string,
  data: DivisionPoolsData
): Promise<DivisionPoolsData> {
  if (POOLS_ENDPOINT_LIVE) {
    // Bulk reconcile (§7.2): PUT the whole desired layout; the response is
    // the refreshed state with real ids for any newly-created pools.
    const envelope = await putJson<PoolsEnvelope>(
      poolsPath(associationId, eventId, divisionId),
      buildSaveBody(data)
    )
    return mapPoolsData(envelope.data)
  }
  MOCK_POOLS_BY_DIVISION[divisionId] = clone(data)
  return delay(clone(data))
}
