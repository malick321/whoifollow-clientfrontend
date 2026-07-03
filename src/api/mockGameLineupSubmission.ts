// Mock game-lineup-submission fetcher
// -----------------------------------
// V1 stand-in for the production `fetchGameLineupSubmission` API
// in `src/api/gameLineupSubmission.ts`. Returns the EXACT same
// `GameLineupSubmissionDetail` shape so consumers (the
// field-lineup preview modal in particular) treat the mock and
// the real API identically — when backend ships the production
// game-details endpoint with the embedded lineup details, the
// preview modal just imports the real fetcher and this file
// becomes deletable.
//
// Determinism: every output is hashed off the `(gameId, teamId)`
// pair so reloading the demo surfaces the SAME lineup for the
// same game, the same crew of position assignments, the same
// jersey numbers. No randomness — keeps screenshots / demos
// stable.
//
// Field config x/y coordinates: aligned to the `viewBox="0 -50
// 460 460"` of the `<svg>` inside `FieldLineupPreview.vue` so
// pins land on plausible softball positions over the
// `softball-field.png` artwork. The real backend will ship its
// own coordinate map per field configuration — these values are
// just a sensible default for the slow-pitch 10-player layout.

import type {
  FieldConfigPosition,
  GameLineupPlayer,
  GameLineupSubmission,
  GameLineupSubmissionDetail
} from '../types'

const SIMULATED_LATENCY_MS = 160

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), SIMULATED_LATENCY_MS))
}

// ── Mock player-name pool ────────────────────────────────────────
// Pulled deterministically by hash to fill the 10 starting + 1–2
// bench slots per team. Pool is intentionally generic — production
// will ship real teammate identities via the API. Mix of common
// US softball first/last names so the preview reads realistically
// against any team label.
const PLAYER_NAME_POOL = [
  'James Carter', 'Robert Hayes', 'Michael Brooks', 'David Lopez',
  'Daniel Wright', 'Christopher Reed', 'Anthony Bell', 'Steven Hughes',
  'Brian Foster', 'Kevin Russell', 'Mark Stevens', 'Jason Watts',
  'Eric Bennett', 'Paul Hampton', 'Greg Mitchell', 'Tony Powell',
  'Larry Walsh', 'Carl Burton', 'Dennis Cole', 'Wayne Phillips'
]

/** Per-position layout for the slow-pitch 10-player field config.
 *  x/y align to the `viewBox="0 -50 460 460"` in
 *  FieldLineupPreview's svg so pins land on the right spots over
 *  the field artwork. `EH` is the batting-only Extra Hitter — no
 *  field position, lands in the off-field roster list. */
const MOCK_FIELD_POSITIONS: FieldConfigPosition[] = [
  { code: 'P',  label: 'Pitcher',      area: 'battery', xAxis: 230, yAxis: 240, status: 1, positionNumber: 1 },
  { code: 'C',  label: 'Catcher',      area: 'battery', xAxis: 230, yAxis: 380, status: 1, positionNumber: 2 },
  { code: '1B', label: 'First Base',   area: 'infield', xAxis: 340, yAxis: 270, status: 1, positionNumber: 3 },
  { code: '2B', label: 'Second Base',  area: 'infield', xAxis: 285, yAxis: 195, status: 1, positionNumber: 4 },
  { code: '3B', label: 'Third Base',   area: 'infield', xAxis: 120, yAxis: 270, status: 1, positionNumber: 5 },
  { code: 'SS', label: 'Shortstop',    area: 'infield', xAxis: 175, yAxis: 195, status: 1, positionNumber: 6 },
  { code: 'LF', label: 'Left Field',   area: 'outfield', xAxis: 85,  yAxis: 110, status: 1, positionNumber: 7 },
  { code: 'LC', label: 'Left Center',  area: 'outfield', xAxis: 175, yAxis: 50,  status: 1, positionNumber: 8 },
  { code: 'RC', label: 'Right Center', area: 'outfield', xAxis: 285, yAxis: 50,  status: 1, positionNumber: 9 },
  { code: 'RF', label: 'Right Field',  area: 'outfield', xAxis: 375, yAxis: 110, status: 1, positionNumber: 10 },
  // EH — batting-only; no x/y so FieldLineupPreview routes the
  // player into the off-field roster list instead of pinning
  // them on the field.
  { code: 'EH', label: 'Extra Hitter', area: 'flex', status: 1, positionNumber: 11 }
]

/** Position order — first 10 = starters mapped to their fielding
 *  pin; #11 (EH) is a batting-only starter; #12+ are bench. */
const STARTER_POSITION_ORDER = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'LC', 'RC', 'RF', 'EH']

/** Hash a string into a stable 32-bit unsigned int. Same scheme
 *  the field-grid drawer uses for its umpire / weather / time-
 *  limit mocks — keeps every mock generator on the same
 *  deterministic foundation. */
function hashSeed(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0
  }
  return h
}

/** Build the 11 + 1-bench lineup for one team. Names + jerseys
 *  are hashed off `(gameId, teamId)` so the same team in the
 *  same game always shows the same crew. */
function buildLineupForTeam(gameId: string, teamId: string): GameLineupPlayer[] {
  const seed = hashSeed(`${gameId}|${teamId}`)
  const players: GameLineupPlayer[] = []
  // 11 starters (10 field + 1 EH).
  for (let i = 0; i < STARTER_POSITION_ORDER.length; i++) {
    const nameIdx = ((seed >>> (i * 3)) + i * 7) % PLAYER_NAME_POOL.length
    const jerseyNum = (((seed >>> (i * 2)) + i * 13) % 90) + 10  // 10–99
    players.push({
      id: `mock_${teamId}_p${i + 1}`,
      playerName: PLAYER_NAME_POOL[nameIdx],
      jerseyNumber: String(jerseyNum),
      battingOrder: i + 1,
      positionCode: STARTER_POSITION_ORDER[i],
      isStarter: true,
      isBench: false,
      isSubstitute: false,
      isActive: true,
      playerSourceType: 'team_member'
    })
  }
  // 1 bench player — gives the off-field "Benched" roster
  // something to show under the grouped-roster mode.
  const benchNameIdx = ((seed >>> 17) + 5) % PLAYER_NAME_POOL.length
  const benchJersey = (((seed >>> 11) + 7) % 90) + 10
  players.push({
    id: `mock_${teamId}_bench_1`,
    playerName: PLAYER_NAME_POOL[benchNameIdx],
    jerseyNumber: String(benchJersey),
    battingOrder: 12,
    positionCode: null,
    isStarter: false,
    isBench: true,
    isSubstitute: false,
    isActive: false,
    playerSourceType: 'team_member'
  })
  return players
}

/** Mock production fetcher signature. Drop-in replacement for
 *  `fetchGameLineupSubmission(gameId, teamId)` — same return
 *  shape (`GameLineupSubmissionDetail`), same async interface.
 *  Call sites can swap the import without any other changes
 *  when backend ships the real endpoint. */
export async function mockFetchGameLineupSubmission(
  gameId: string,
  teamId: string
): Promise<GameLineupSubmissionDetail> {
  const players = buildLineupForTeam(gameId, teamId)
  const submission: GameLineupSubmission = {
    id: `mock_sub_${gameId}_${teamId}`,
    status: 'submitted',
    approvalMode: 'auto',
    sourceType: 'manual',
    submittedAt: new Date().toISOString(),
    approvedAt: new Date().toISOString(),
    rejectionReason: null,
    notes: '',
    players
  }
  return delay({
    hasExistingSubmission: true,
    submission,
    players,
    templateLineup: undefined,
    fieldConfig: {
      name: 'Slow Pitch 10 Player',
      positions: MOCK_FIELD_POSITIONS
    }
  })
}
