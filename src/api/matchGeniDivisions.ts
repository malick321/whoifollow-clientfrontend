import { getJson, postJson, patchJson, deleteJson } from './client'
import type {
  CreateDivisionPayload,
  CreateDivisionResult,
  MatchGeniDivisionBracketSummary,
  MatchGeniDivisionDetail,
  MatchGeniDivisionSummary,
  MatchGeniDivisionTeam
} from '../types'

// MatchGeni Divisions API
// -----------------------
// Create / update a division (an `event_tournaments` row + its
// `tournament_seed_criteria` children) in ONE atomic call. Backs the
// Add/Edit Division wizard. See `docs/api/matchgeni-division-api-contract.md`.
//
//   - Create: POST  /v2/association/events/{associationId}/{eventId}/divisions
//   - Update: PATCH /v2/association/events/{associationId}/{eventId}/divisions/{divisionId}
//
// Field config lives on the same `event_tournaments` row as the division
// info, and the seed criteria are child rows — so the backend writes the
// row + the seed-criteria set in a single transaction. No partial
// divisions, no multi-call orchestration on the client.
//
// Dates are plain `YYYY-MM-DD` (no timezone): a division boundary is a
// calendar date, so we store it as-is and avoid browser-tz drift.

/** Standard v2 envelope. */
interface ResponseEnvelope<T> {
  responseStatus?: { statusCode: number; message?: string; text?: string }
  data: T
}

/** Raw create/update response — the created/updated row's identity in the
 *  v2 envelope. (The backend seeds a default pool too, but its id isn't
 *  surfaced — no client surface consumes it.) */
interface RawCreateDivisionResult {
  tournament_id: number
  tournament_guid: string
}

function mapResult(raw: RawCreateDivisionResult): CreateDivisionResult {
  return {
    tournamentId: raw.tournament_id,
    tournamentGuid: raw.tournament_guid
  }
}

/** Create a new division under an event. */
export async function createDivision(
  associationId: string,
  eventId: string,
  payload: CreateDivisionPayload
): Promise<CreateDivisionResult> {
  const path =
    `/association/events/${encodeURIComponent(associationId)}` +
    `/${encodeURIComponent(eventId)}/divisions`
  const envelope = await postJson<ResponseEnvelope<RawCreateDivisionResult>>(path, payload)
  return mapResult(envelope.data)
}

/** Update an existing division (replaces the row's fields + reconciles
 *  its seed-criteria set). */
export async function updateDivision(
  associationId: string,
  eventId: string,
  divisionId: string,
  payload: CreateDivisionPayload
): Promise<CreateDivisionResult> {
  const path =
    `/association/events/${encodeURIComponent(associationId)}` +
    `/${encodeURIComponent(eventId)}/divisions/${encodeURIComponent(divisionId)}`
  const envelope = await patchJson<ResponseEnvelope<RawCreateDivisionResult>>(path, payload)
  return mapResult(envelope.data)
}

// ── Division Details (§5) + Division Teams (§6) ──────────────────
// Two separate reads (see `docs/api/matchgeni-division-api-contract.md`):
//   §5 GET …/divisions/{id}        → detail-page shell: config + pools (meta)
//                                     + brackets (meta + LIGHT team identity).
//   §6 GET …/divisions/{id}/teams  → reusable roster: full team info + seed
//                                     + pool-play win/loss record + poolId.
// Brackets carry only id/name/avatar so they render standalone; the heavy
// roster + pool-play aggregate lives on §6 and is fetched in parallel.
// Mock-first behind their own flags — flip to true when each route ships;
// the live branches read the standard v2 envelope (`data` / `data.list`).
const DIVISION_DETAIL_ENDPOINT_LIVE = false
const DIVISION_TEAMS_ENDPOINT_LIVE = false

/** Deterministic mock detail shell for one division (stable per id). */
function mockDivisionDetail(divisionId: string): MatchGeniDivisionDetail {
  const lite = (id: string, name: string) => ({
    id,
    name,
    avatarUrl: `https://cdn.whoifollow.tech/teams/${id}.png`
  })
  return {
    division: {
      id: divisionId,
      guid: `division-${divisionId}`,
      tournamentName: "Men's 65+ Division",
      startDate: '2026-05-12',
      endDate: '2026-05-14',
      dateRangeLabel: 'Tue, May 12 – Thu, May 14, 2026',
      customFormat: true,
      poolPlayGuarantee: 3,
      bracketFormatId: '1',
      bracketFormatName: 'Single Elimination',
      useEventSeed: false,
      seedCriteria: [
        { seedingCriteriaId: '1', order: 1 },
        { seedingCriteriaId: '3', order: 2 }
      ],
      useEventFieldConfig: false,
      fieldConfigId: '10',
      fieldConfigName: 'Softball',
      poolPlayTime: 65,
      bracketTime: 70,
      championshipTime: 80,
      continuousTeamSrNo: true,
      restrictTeamsEntry: true,
      ageGroups: ['65 Older'],
      ratings: ['AAA', 'Major'],
      notes: '',
      teamCount: 6,
      bracketCount: 2
    },
    pools: [
      { id: 'pool_a', name: 'Pool A', seedCount: 3 },
      { id: 'pool_b', name: 'Pool B', seedCount: 3 }
    ],
    brackets: [
      {
        id: 'bk_1',
        guid: `bracket-${divisionId}-1`,
        divisionId,
        name: 'Gold Bracket',
        description: 'Top seeds, single elimination to the final.',
        bracketFormatId: '1',
        bracketFormatName: 'Single Elimination',
        status: 'in_progress',
        teams: [lite('55', 'Thunder 65'), lite('61', 'Mavericks 65'), lite('48', 'Outlaws 65')]
      },
      {
        id: 'bk_2',
        guid: `bracket-${divisionId}-2`,
        divisionId,
        name: 'Silver Bracket',
        description: null,
        bracketFormatId: '1',
        bracketFormatName: 'Single Elimination',
        status: 'pending',
        teams: [lite('70', 'Drifters 65'), lite('72', 'Legends 65'), lite('77', 'Cyclones 65')]
      }
    ]
  }
}

/** Deterministic mock roster for one division (stable per id). */
function mockDivisionTeams(_divisionId: string): MatchGeniDivisionTeam[] {
  const team = (
    id: string,
    name: string,
    city: string,
    state: string,
    rating: string,
    seed: number | null,
    poolId: string,
    poolName: string,
    wins: number,
    losses: number
  ): MatchGeniDivisionTeam => ({
    id,
    name,
    avatarUrl: `https://cdn.whoifollow.tech/teams/${id}.png`,
    gender: 'Male',
    ageGroup: '65 Older',
    rating,
    city,
    state,
    seed,
    poolId,
    poolName,
    record: { wins, losses, ties: 0 }
  })
  return [
    team('55', 'Thunder 65', 'Phoenix', 'AZ', 'Major', 1, 'pool_a', 'Pool A', 3, 0),
    team('61', 'Mavericks 65', 'Dallas', 'TX', 'Major', 2, 'pool_a', 'Pool A', 2, 1),
    team('48', 'Outlaws 65', 'Denver', 'CO', 'AAA', 3, 'pool_a', 'Pool A', 1, 2),
    team('70', 'Drifters 65', 'Reno', 'NV', 'AAA', 4, 'pool_b', 'Pool B', 2, 1),
    team('72', 'Legends 65', 'Boise', 'ID', 'Major', 5, 'pool_b', 'Pool B', 1, 2),
    team('77', 'Cyclones 65', 'Tucson', 'AZ', 'AAA', 6, 'pool_b', 'Pool B', 0, 3)
  ]
}

/** §5 — full detail for one division (config + pools meta + brackets with
 *  light team identity). Backs `MatchGeniDivisionDetailView`. */
export async function fetchMatchGeniDivisionDetails(
  associationId: string,
  eventId: string,
  divisionId: string
): Promise<MatchGeniDivisionDetail> {
  if (!DIVISION_DETAIL_ENDPOINT_LIVE) return mockDivisionDetail(divisionId)
  const path =
    `/association/events/${encodeURIComponent(associationId)}` +
    `/${encodeURIComponent(eventId)}/divisions/${encodeURIComponent(divisionId)}`
  const envelope = await getJson<ResponseEnvelope<MatchGeniDivisionDetail>>(path)
  return envelope.data
}

/** §6 — the division's team roster with seed + pool-play record. Reusable
 *  (detail Pool Play, Participating Teams, portal / client pages). */
export async function fetchMatchGeniDivisionTeams(
  associationId: string,
  eventId: string,
  divisionId: string
): Promise<MatchGeniDivisionTeam[]> {
  if (!DIVISION_TEAMS_ENDPOINT_LIVE) return mockDivisionTeams(divisionId)
  const path =
    `/association/events/${encodeURIComponent(associationId)}` +
    `/${encodeURIComponent(eventId)}/divisions/${encodeURIComponent(divisionId)}/teams`
  const envelope = await getJson<ResponseEnvelope<{ list: MatchGeniDivisionTeam[] }>>(path)
  return envelope.data?.list ?? []
}

// ── List Divisions (dashboard) ───────────────────────────────────
// The MatchGeni dashboard's division list is a fast, navigation-only
// surface — NOT the rich per-division breakdown the detail page shows.
// It reads from a dedicated list endpoint that returns each division's
// config (all on the one `event_tournaments` row) plus two cheap
// compute-on-read counts. No phase statuses / progress / game count —
// see `docs/api/matchgeni-division-api-contract.md` §4 for the
// rationale (high-churn aggregates would force per-row multi-table
// joins for a list of 50–60 rows).
//
//   GET /v2/association/events/{associationId}/{eventId}/divisions
//
// v1 ships without this backend route, so a failed/absent fetch falls
// back to deterministic mock rows (same pattern the dashboard uses for
// the live-vs-mock playing-facility carousel). Swapping mock → real is
// then a no-op on the client: the live payload simply takes over.

/** Raw list row — camelCase mirror of the `event_tournaments` row
 *  plus the two computed counts, inside the v2 envelope. */
interface RawDivisionSummary {
  id: number | string
  guid?: string
  tournamentName: string
  dateRangeLabel?: string
  startDate?: string | null
  endDate?: string | null
  teamCount?: number
  bracketCount?: number
  poolPlayGuarantee?: number | null
  bracketFormat?: string | null
  poolTieBreaker?: string | null
  brackets?: MatchGeniDivisionBracketSummary[]
}

function mapDivisionSummary(raw: RawDivisionSummary): MatchGeniDivisionSummary {
  return {
    id: String(raw.id),
    guid: raw.guid,
    name: raw.tournamentName,
    dateRangeLabel: raw.dateRangeLabel ?? '',
    startDate: raw.startDate ?? null,
    endDate: raw.endDate ?? null,
    teamCount: raw.teamCount ?? 0,
    bracketCount: raw.bracketCount ?? 0,
    poolPlayGuarantee: raw.poolPlayGuarantee ?? null,
    bracketFormat: raw.bracketFormat ?? null,
    poolTieBreaker: raw.poolTieBreaker ?? null,
    brackets: raw.brackets ?? []
  }
}

const MOCK_DIVISIONS_BY_EVENT: Record<string, MatchGeniDivisionSummary[]> = {}

/** Deterministic mock list — same event id yields the same rows across
 *  renders so the dashboard's order doesn't shuffle on navigation. */
function mockDivisions(eventId: string): MatchGeniDivisionSummary[] {
  const cached = MOCK_DIVISIONS_BY_EVENT[eventId]
  if (cached) return cached

  const names = [
    "Men's 65+ Division",
    "Men's 70/75-Platinum",
    "Men's 70-Silver",
    "Men's 75/80-Gold",
    "Men's 75/80 AAA",
    "Men's 40-Major",
    "Men's 40-AAA",
    "Men's 50/55-Major+",
    "Men's 50-Major",
    "Men's 50-AAA",
    "Men's 55-Major",
    "Men's 60-Major",
    "Men's 60-AAA"
  ]
  // Explicit per-division bracket team counts (overrides the generic
  // split). Keyed by division name.
  const BRACKET_TEAM_OVERRIDES: Record<string, number[]> = {
    "Men's 75/80 AAA": [16, 12, 8, 5]
  }
  const formats = ['Single Elimination', 'Double Elimination', '3 Game Guarantee']
  const tieBreakers = [
    'Win %, head-to-head, run differential',
    'Head-to-head, run differential, runs scored',
    'Win %, runs allowed, coin toss'
  ]
  const bracketNames = ['Gold', 'Silver', 'Bronze', 'Platinum']
  // Bracket lifecycle states + tones (canonical mapping in
  // `src/lib/bracketStatus.ts`; mirrored here for the listing's mock rows).
  const bracketStatuses: { status: string; statusTone: MatchGeniDivisionBracketSummary['statusTone'] }[] = [
    { status: 'Pending', statusTone: 'neutral' },
    { status: 'Initiated', statusTone: 'warning' },
    { status: 'In progress', statusTone: 'success' },
    { status: 'Completed', statusTone: 'primary' },
    { status: 'Cancelled', statusTone: 'danger' }
  ]
  const rows: MatchGeniDivisionSummary[] = names.map((name, idx) => {
    const override = BRACKET_TEAM_OVERRIDES[name]
    // Vary bracket counts 0–4 across the list so the row's Brackets
    // section exercises none / single / multi (incl. 3- and 4-bracket).
    const bracketCount = override ? override.length : idx % 5
    const bracketFormat = formats[idx % formats.length]
    // Per-bracket team counts: an explicit override when set, else split
    // the division's teams roughly evenly across its brackets.
    const genericTeamCount = Math.max(4, bracketCount * 2) + (idx % 4)
    const brackets: MatchGeniDivisionBracketSummary[] = Array.from(
      { length: bracketCount },
      (_, b) => ({
        name: `${bracketNames[b] ?? `Bracket ${b + 1}`} Bracket`,
        teamCount: override
          ? override[b]
          : Math.max(2, Math.round(genericTeamCount / bracketCount)),
        format: bracketFormat,
        ...bracketStatuses[(idx + b) % bracketStatuses.length]
      })
    )
    // Division team count = sum of its bracket team counts (override) or
    // the generic figure.
    const teamCount = override
      ? override.reduce((sum, n) => sum + n, 0)
      : genericTeamCount
    return {
      id: String(7000 + idx),
      guid: `tournament-${eventId}-${idx}`,
      name,
      dateRangeLabel: idx < 4
        ? 'Tue, May 12 – Thu, May 14, 2026'
        : 'Fri, May 15 – Sun, May 17, 2026',
      startDate: idx < 4 ? '2026-05-12' : '2026-05-15',
      endDate: idx < 4 ? '2026-05-14' : '2026-05-17',
      teamCount,
      bracketCount,
      poolPlayGuarantee: 1 + (idx % 5),
      bracketFormat,
      poolTieBreaker: tieBreakers[idx % tieBreakers.length],
      brackets
    }
  })
  MOCK_DIVISIONS_BY_EVENT[eventId] = rows
  return rows
}

/** `true` once the backend ships the §4 List Divisions route. While
 *  `false`, `fetchMatchGeniDivisions` returns mock rows WITHOUT hitting
 *  the network — the route 401s today, and the client's global auth
 *  handler logs the user out on a 401 before any local `.catch` can
 *  swallow it. So we don't fire the request at all yet; the dashboard
 *  shows a "coming soon" toast to signal the list is placeholder data.
 *  Flip this to `true` (and nothing else) when the endpoint is live. */
const LIST_DIVISIONS_ENDPOINT_LIVE = true

/** Whether the last `fetchMatchGeniDivisions` call served mock rows
 *  (endpoint not live yet). The dashboard reads this to decide whether
 *  to flash its "coming soon" toast. */
export function isDivisionListMocked(): boolean {
  return !LIST_DIVISIONS_ENDPOINT_LIVE
}

/** Fetch the dashboard division list. Returns the live list once the
 *  backend route exists; until then returns deterministic mock rows
 *  WITHOUT a network call (see `LIST_DIVISIONS_ENDPOINT_LIVE`). */
export async function fetchMatchGeniDivisions(
  associationId: string,
  eventId: string
): Promise<MatchGeniDivisionSummary[]> {
  if (!LIST_DIVISIONS_ENDPOINT_LIVE) {
    return mockDivisions(eventId)
  }
  const path =
    `/association/events/${encodeURIComponent(associationId)}` +
    `/${encodeURIComponent(eventId)}/divisions`
  try {
    const envelope = await getJson<ResponseEnvelope<RawDivisionSummary[]>>(path)
    const rows = envelope?.data
    if (Array.isArray(rows) && rows.length > 0) return rows.map(mapDivisionSummary)
    // Empty/absent payload → mock so the surface isn't blank in dev.
    return mockDivisions(eventId)
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.warn('[divisions] fetchMatchGeniDivisions failed; using mock rows.', err)
    }
    return mockDivisions(eventId)
  }
}

/** Soft-delete a division (and its child seed-criteria rows). */
export async function deleteDivision(
  associationId: string,
  eventId: string,
  divisionId: string
): Promise<void> {
  const path =
    `/association/events/${encodeURIComponent(associationId)}` +
    `/${encodeURIComponent(eventId)}/divisions/${encodeURIComponent(divisionId)}`
  await deleteJson<ResponseEnvelope<unknown>>(path)
}
