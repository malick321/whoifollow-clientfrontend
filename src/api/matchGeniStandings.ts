import type {
  BracketCancellation,
  BracketStatus,
  DivisionStandings,
  SetUnitStandingsPayload,
  StandingPlacement,
  StandingUnit,
  StandingUnitPlay
} from '../types'

// MatchGeni Division Standings (winners) API — mock
// -------------------------------------------------
// Final placements (winners) for a division, modelled as a set of
// per-UNIT results. A unit is an existing **bracket** or an existing
// **pool** (referenced by id — never a new grouping):
//   - A team is decided by the BRACKET it's selected into UNLESS that
//     bracket was cancelled; otherwise by its POOL. So a pool is a unit
//     for its teams NOT claimed by a non-cancelled bracket (one team →
//     exactly one unit).
//   - Bracket units are READ-ONLY: a `completed` bracket materialises AUTO
//     winners; pending/initiated/in_progress show status only (no result
//     yet); a `cancelled` bracket is informational (its teams announce via
//     their pool). There is NO manual override of a bracket here — fixing a
//     completed result happens by reopening the game (future revision).
//   - Pool units are always manual (best-of-3 / association-announced /
//     rain fallback). Each can independently be announced or declared
//     no-result, incrementally.
//
// v1 is mock-only; the real endpoints (see
// `docs/api/matchgeni-division-api-contract.md` §5) read/write the
// `event_tournament_standings` table (the single source of truth — auto
// AND manual rows live there, keyed by `bracket_id` OR `pool_id`):
//
//   GET …/divisions/{divisionId}/standings
//   PUT …/divisions/{divisionId}/units/{kind}/{refId}/standings  (per-unit)

const SIMULATED_LATENCY_MS = 220

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), SIMULATED_LATENCY_MS))
}

/** Eligible-team shape the caller hands in for a bracket / pool. */
export interface StandingsTeam {
  teamId?: string
  teamName: string
  imageUrl?: string
  /** Pre-joined gender / age-group / rating line (display). */
  teamMeta?: string
  /** City, ST. */
  location?: string
}

/** A bracket or pool the result can be announced on. */
export interface StandingsGroupSource {
  id: string
  name: string
  /** Per-bracket lifecycle status (drives auto/read-only/cancelled). Unused
   *  for pools. */
  status?: BracketStatus
  /** Set when a bracket was cancelled — surfaced on its read-only unit. */
  cancellation?: BracketCancellation
  teams: StandingsTeam[]
}

/** Context the caller supplies so the mock can derive units + auto winners
 *  (the real GET reads the table directly and needs none of this). */
export interface DivisionStandingsContext {
  /** Division play is finished → winners are meaningful. */
  complete: boolean
  /** Brackets in display order; `status === 'completed'` → auto winners. */
  brackets: StandingsGroupSource[]
  /** Team pools (each contributes a unit for its non-bracket teams). */
  pools: StandingsGroupSource[]
}

function rankLabel(rank: number, coChampion?: boolean): string {
  if (coChampion) return 'Champions'
  return rank === 1 ? '1st' : rank === 2 ? '2nd' : rank === 3 ? '3rd' : `${rank}th`
}

/** Auto podium — first three (seed-ordered) teams of a completed bracket. */
function placementsFromTeams(teams: StandingsTeam[]): StandingPlacement[] {
  return teams.slice(0, 3).map((t, i) => ({
    rank: i + 1,
    rankLabel: rankLabel(i + 1),
    teamId: t.teamId,
    teamName: t.teamName,
    imageUrl: t.imageUrl,
    teamMeta: t.teamMeta,
    location: t.location
  }))
}

/** One unit's persisted manual announce (mock store). Absence means the
 *  unit is still pending. Used by POOL units and by IN-PROGRESS bracket
 *  units (a bracket called manually before it auto-completes). Completed /
 *  cancelled / pending / initiated brackets are never stored — they're
 *  read-only, derived from the bracket's own state. */
interface StoredUnit {
  placements: StandingPlacement[]
  noResult: boolean
}

// Per-division store, keyed by `${kind}:${refId}` (pool + in-progress
// bracket units).
const STORE: Record<string, Record<string, StoredUnit>> = {}
function unitKey(kind: 'bracket' | 'pool', refId: string): string {
  return `${kind}:${refId}`
}

/** Bracket lifecycle status → the unit's surfaced play state. */
function bracketPlay(status: BracketStatus | undefined): StandingUnitPlay {
  switch (status) {
    case 'completed': return 'complete'
    case 'in_progress': return 'in_progress'
    case 'initiated': return 'initiated'
    case 'cancelled': return 'cancelled'
    default: return 'not_started'
  }
}

function buildUnits(divisionId: string, ctx: DivisionStandingsContext): StandingUnit[] {
  const store = STORE[divisionId] ?? {}
  // A team is decided by its bracket UNLESS that bracket was cancelled — a
  // cancelled bracket releases its teams back to their pool. So only
  // non-cancelled brackets "claim" their teams.
  const claimed = new Set<string>()
  ctx.brackets.forEach((b) => {
    if (b.status !== 'cancelled') b.teams.forEach((t) => claimed.add(t.teamName))
  })

  const units: StandingUnit[] = []

  // ── Bracket units (always READ-ONLY) ──
  for (const b of ctx.brackets) {
    const playStatus = bracketPlay(b.status)
    if (b.status === 'completed') {
      // Clean completion → auto winners (read-only).
      units.push({
        kind: 'bracket',
        refId: b.id,
        name: b.name,
        teamCount: b.teams.length,
        playStatus: 'complete',
        source: 'auto',
        status: 'announced',
        editable: false,
        placements: placementsFromTeams(b.teams)
      })
    } else if (b.status === 'cancelled') {
      // Informational — its teams are announced under their pool. Carries
      // the cancellation reason for display; needs no action of its own.
      units.push({
        kind: 'bracket',
        refId: b.id,
        name: b.name,
        teamCount: b.teams.length,
        playStatus: 'cancelled',
        source: 'manual',
        status: 'no_result',
        editable: false,
        cancellation: b.cancellation,
        placements: []
      })
    } else if (b.status === 'in_progress') {
      // Reached a callable stage → the admin can ANNOUNCE the result from
      // the bracket's own teams (manual), or Cancel it (rain → pool). Any
      // stored podium is surfaced here (read/edit), like a pool unit.
      const stored = store[unitKey('bracket', b.id)]
      units.push({
        kind: 'bracket',
        refId: b.id,
        name: b.name,
        teamCount: b.teams.length,
        playStatus: 'in_progress',
        source: 'manual',
        status: stored ? (stored.noResult ? 'no_result' : stored.placements.length ? 'announced' : 'pending') : 'pending',
        editable: true,
        placements: (stored?.placements ?? []).map((p) => ({ ...p }))
      })
    } else {
      // pending / initiated → result not ready; read-only status (a Cancel
      // action may still be offered by the modal for initiated brackets).
      units.push({
        kind: 'bracket',
        refId: b.id,
        name: b.name,
        teamCount: b.teams.length,
        playStatus,
        source: 'manual',
        status: 'pending',
        editable: false,
        placements: []
      })
    }
  }

  // ── Pool units (manual) ──
  // A pool announces every team NOT claimed by a non-cancelled bracket —
  // i.e. never-bracketed (leftover) teams PLUS teams whose bracket was
  // cancelled (each team falls back to its own pool).
  for (const p of ctx.pools) {
    const announceable = p.teams.filter((t) => !claimed.has(t.teamName))
    if (announceable.length === 0) continue // fully advanced to live brackets → not a unit
    const stored = store[unitKey('pool', p.id)]
    units.push({
      kind: 'pool',
      refId: p.id,
      name: p.name,
      teamCount: announceable.length,
      playStatus: ctx.complete ? 'complete' : 'in_progress',
      source: 'manual',
      status: stored ? (stored.noResult ? 'no_result' : stored.placements.length ? 'announced' : 'pending') : 'pending',
      editable: true,
      placements: (stored?.placements ?? []).map((p2) => ({ ...p2 }))
    })
  }

  return units
}

function build(divisionId: string, ctx: DivisionStandingsContext): DivisionStandings {
  const units = buildUnits(divisionId, ctx)
  return {
    divisionId,
    complete: ctx.complete,
    needsManual: units.some((u) => u.status === 'pending'),
    units
  }
}

/** Fetch a division's winners as per-unit results. `ctx` supplies the
 *  brackets/pools the mock derives units + auto winners from (the real GET
 *  reads `event_tournament_standings` and needs none of it). */
export async function fetchDivisionStandings(
  _associationId: string,
  _eventId: string,
  divisionId: string,
  ctx: DivisionStandingsContext
): Promise<DivisionStandings> {
  return delay(build(divisionId, ctx))
}

/** Announce / edit ONE unit's result (per-unit, incremental). Only pool
 *  units are announced manually (brackets are read-only). `noResult`
 *  records the unit with no winners. Returns the refreshed standings. */
export async function setUnitStandings(
  _associationId: string,
  _eventId: string,
  divisionId: string,
  payload: SetUnitStandingsPayload,
  ctx: DivisionStandingsContext
): Promise<DivisionStandings> {
  const store = (STORE[divisionId] ??= {})
  const key = unitKey(payload.kind, payload.refId)
  const noResult = payload.noResult === true
  const placements: StandingPlacement[] = noResult
    ? []
    : payload.placements
        .filter((p) => p.teamName)
        .map((p) => ({
          rank: p.rank,
          rankLabel: rankLabel(p.rank, p.coChampion),
          teamId: p.teamId,
          teamName: p.teamName,
          coChampion: p.coChampion
        }))
  store[key] = { placements, noResult }
  return delay(build(divisionId, ctx))
}

/** Clear a unit's manual override (revert a bracket to auto, or a pool to
 *  pending). Optional helper for "undo / re-open". */
export async function clearUnitStandings(
  _associationId: string,
  _eventId: string,
  divisionId: string,
  kind: 'bracket' | 'pool',
  refId: string,
  ctx: DivisionStandingsContext
): Promise<DivisionStandings> {
  const store = STORE[divisionId]
  if (store) delete store[unitKey(kind, refId)]
  return delay(build(divisionId, ctx))
}
