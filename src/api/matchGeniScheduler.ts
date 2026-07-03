// MatchGeni Scheduler API (mock)
// -------------------------------
// Mock layer for the drag-drop scheduler sub-page. Returns the
// composite payload the view needs in one call — divisions list,
// games (pool + bracket) keyed by division, and the per-park
// schedule (days the park is in use + time-slot grid).
//
// Backend swap point: when the real `/v2/association/events/{eventId}/scheduler`
// endpoint ships, replace `fetchMatchGeniScheduler` body with a
// `fetchEnvelope` call. The mock shape is intentionally identical
// to the planned wire shape so the swap is body-only.

import type {
  MatchGeniSchedulerPayload,
  SchedulerDivision,
  SchedulerGame,
  SchedulerPark,
  SchedulerParkDay,
  SchedulerBreak,
  Park,
  Division
} from '../types'
import { minutesFromMidnight } from './schedulerTimeAxis'
import { getMockBracketsForDivision } from './mockBrackets'

const SIMULATED_LATENCY_MS = 240

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), SIMULATED_LATENCY_MS))
}

// ─── Mock divisions ──────────────────────────────────────────────
const MOCK_DIVISIONS: SchedulerDivision[] = [
  { id: 'div_1', name: "divsion 7 teams second", dateRangeLabel: 'Apr 29 – May 3', teamCount: 7, hasPool: true, hasBracket: true,
    poolRoundRobinCount: 1, poolGamesPerTeam: 2, poolStatus: 'in_progress', tieBreakerText: 'Head to head', bracketGameGuarantee: 3, bracketCount: 1,
    bracketNames: ["Men's 65 Gold"], bracketStatuses: ['in_progress'] },
  { id: 'div_2', name: "Men's 65+ Division",     dateRangeLabel: 'Apr 29 – May 1', teamCount: 4, hasPool: true, hasBracket: true,
    poolRoundRobinCount: 1, poolGamesPerTeam: 3, poolStatus: 'generated', tieBreakerText: 'Run differential', bracketGameGuarantee: 2, bracketCount: 2,
    bracketNames: ["Men's 65+ Gold", "Men's 65+ Silver"], bracketStatuses: ['initiated', 'pending'] },
  { id: 'div_3', name: "Men's 70/75-Platinum",   dateRangeLabel: 'Apr 30 – May 3', teamCount: 5, hasPool: true, hasBracket: true,
    poolRoundRobinCount: 1, poolGamesPerTeam: 4, poolStatus: 'completed', tieBreakerText: 'Head to head', bracketGameGuarantee: 3, bracketCount: 2,
    bracketNames: ["Men's 70/75 Gold", "Men's 70/75 Silver"], bracketStatuses: ['completed', 'in_progress'] },
  { id: 'div_4', name: "Men's 70-Silver",        dateRangeLabel: 'May 1 – May 4', teamCount: 6, hasPool: true, hasBracket: true,
    poolRoundRobinCount: 1, poolGamesPerTeam: 5, poolStatus: 'in_progress', tieBreakerText: 'Runs allowed', bracketGameGuarantee: 3, bracketCount: 1,
    bracketNames: ["Men's 70 Silver"], bracketStatuses: ['initiated'] },
  { id: 'div_5', name: "Men's 75/80-Gold",       dateRangeLabel: 'May 2 – May 5', teamCount: 7, hasPool: true, hasBracket: false,
    poolRoundRobinCount: 1, poolGamesPerTeam: 6, poolStatus: 'generated', tieBreakerText: 'Head to head', bracketGameGuarantee: 0, bracketCount: 0,
    bracketNames: [], bracketStatuses: [] }
]

// ─── Mock games (pool + bracket) ─────────────────────────────────
// Built programmatically by `buildScheduledGames()` below so the
// field-grid view paints a DENSELY populated day (most cells
// filled, deterministic gaps left empty) with games spanning all
// 5 divisions. Variety drives two needs:
//   1. A TD viewing their day sees a realistic operational
//      picture — most fields running concurrently, a few open
//      slots between rounds — instead of a near-empty grid.
//   2. The highlight layer (scoring scope) gets exercised against
//      a meaningful mix — a parks-scoped or divisions-scoped user
//      sees their permitted subset stand out against the rest.
//
// Field-label format: `'F<n> - <park abbrev>'` — the field-grid
// component matches by prefix against `field.name` after stripping
// the `'Field '` prefix (e.g. `'F1 - H1 Park'` matches the field
// named `'Field 1'`).
//
// Team-name pools per division — the builder picks two distinct
// teams from the division's pool by deterministic index. Pools
// are sized so two distinct picks always exist (≥ 3 teams each).
const TEAM_POOLS: Record<string, string[]> = {
  div_1: [
    '#6: GENESIS/ONYX/BG', '#4: G2G', '#3: FRSTeam/Rogue',
    '#1: Front Row/Spartan Bat Co', '#5: Getnutz',
    '#2: Friars 671 Guam', '#7: Gigantes O.C. 40s'
  ],
  div_2: [
    '#1: Silver Foxes', '#4: Diamond Kings',
    '#2: Long Ball Legends', '#3: Hardball Heroes'
  ],
  div_3: [
    '#1: Veterans United', '#5: Old Guard', '#2: Iron Men',
    '#4: Steel Curtain', '#3: Diamond Cutters'
  ],
  div_4: [
    '#1: Sluggers', '#6: Heavy Hitters', '#2: Power Play',
    '#5: Grand Slammers', '#3: Bench Warmers', '#4: Hot Corner'
  ],
  div_5: [
    '#1: Hall of Famers', '#7: Legends', '#2: Greybeards',
    '#6: Wise Guys', '#3: Old Timers', '#5: Boys of Summer',
    '#4: Gold Standard'
  ]
}
const DIVISION_IDS = ['div_1', 'div_2', 'div_3', 'div_4', 'div_5'] as const

interface MockParkConfig {
  parkId: string
  /** Abbreviation embedded in `scheduledFieldLabel` (e.g. `'H1 Park'`
   *  → `'F1 - H1 Park'`). Field-grid component matches by prefix
   *  against `field.name.replace('Field ', 'F')`. */
  fieldAbbrev: string
  fieldCount: number
  slots: string[]
  /** Slot-cadence length (minutes) for this park — also the
   *  conflict-placement duration fallback when a game has no own
   *  `durationMinutes`. Mirrors the park's `defaultGameDurationMinutes`. */
  defaultDurationMinutes: number
  days: string[]
  /** Per-day fill ratio (0–1). Index aligned to `days`. Defines
   *  the share of (field × slot) cells the builder fills on that
   *  day. Pool-play days run densely (~0.9); finals days run
   *  sparse (~0.3) so the user sees the natural tournament arc. */
  density: number[]
}

const MOCK_PARK_CONFIGS: MockParkConfig[] = [
  {
    parkId: 'park_1',
    fieldAbbrev: 'H1 Park',
    fieldCount: 8,
    // 90-min cadence on the hour/half-hour (08:00 start).
    slots: [
      '08:00 AM', '09:30 AM', '11:00 AM', '12:30 PM',
      '02:00 PM', '03:30 PM', '05:00 PM', '06:30 PM'
    ],
    defaultDurationMinutes: 90,
    days: [
      '2026-04-29', '2026-04-30', '2026-05-01',
      '2026-05-02', '2026-05-03'
    ],
    density: [0.95, 0.88, 0.72, 0.55, 0.35]
  },
  {
    parkId: 'park_2',
    fieldAbbrev: 'WC',
    fieldCount: 4,
    // 75-min cadence from a 9:15 day start → exercises :15/:45
    // starts and a mid-hour window (the whole reason for 5-min grain).
    slots: [
      '09:15 AM', '10:30 AM', '11:45 AM', '01:00 PM', '02:15 PM'
    ],
    defaultDurationMinutes: 75,
    days: ['2026-04-29', '2026-04-30', '2026-05-01'],
    density: [0.9, 0.75, 0.5]
  }
]

/** Deterministic cell-skip hash. Mixes the three indices + a
 *  per-park salt so park_1 and park_2 don't have IDENTICAL gap
 *  patterns at the same indices (would read as a visible vertical
 *  band of empties to the user). Returns 0–99; cells with
 *  `hash >= density * 100` get skipped. */
function cellHash(
  dayIdx: number,
  slotIdx: number,
  fieldIdx: number,
  parkSalt: number
): number {
  return (dayIdx * 37 + slotIdx * 17 + fieldIdx * 7 + parkSalt) % 100
}

function buildScheduledGames(): SchedulerGame[] {
  const games: SchedulerGame[] = []
  // Per-division running pool counter — keeps the in-cell labels
  // ("Pool 12", "Pool 13", ...) monotonically increasing within
  // a division across days, matching how a real tournament's
  // game-number ladder grows.
  const poolNumByDiv: Record<string, number> = {}
  let idSeed = 1000

  // Conflict-tracking map for placement validation. Keyed by
  // `${date}|${fieldName}` → list of [startMin, endMin] ranges of
  // games already placed there. Each candidate game is interval-
  // checked against this list (and against the park's breaks on
  // the same date / field scope) BEFORE being pushed. Prevents
  // the calendar-axis grid from rendering visually overlapping
  // cards when the legacy 90-min slot grid plus the new per-game
  // durations + park breaks would otherwise create stacked
  // collisions (e.g. an 08:30 game with 90-min duration
  // colliding with the next slot at 09:30, or any game at the
  // 12:30 lunch slot colliding with the lunch break itself). */
  const placedByField: Record<string, { startMin: number; endMin: number }[]> = {}

  for (const park of MOCK_PARK_CONFIGS) {
    // Park salt — derived from the park id's last char so each
    // park has a different gap pattern (see `cellHash`).
    const salt = park.parkId.charCodeAt(park.parkId.length - 1)
    park.days.forEach((date, dayIdx) => {
      const fillThreshold = park.density[dayIdx] * 100
      // Late-tournament days flip from pool → bracket so the
      // label / type reflects the natural progression.
      const isBracketDay = dayIdx >= park.days.length - 2
      for (let slotIdx = 0; slotIdx < park.slots.length; slotIdx++) {
        for (let fieldIdx = 0; fieldIdx < park.fieldCount; fieldIdx++) {
          if (cellHash(dayIdx, slotIdx, fieldIdx, salt) >= fillThreshold) continue
          // Cycle divisions across cells so each day surfaces a
          // mix — drives the highlight contrast for scope-restricted
          // users (only their division's cells light up). The
          // `slotIdx * 2 + fieldIdx + dayIdx` formula spreads
          // divisions roughly evenly without clustering.
          const divIdx = (dayIdx + slotIdx * 2 + fieldIdx) % DIVISION_IDS.length
          const divId = DIVISION_IDS[divIdx]
          const teams = TEAM_POOLS[divId]
          const t1Idx = (slotIdx + fieldIdx) % teams.length
          let t2Idx = (t1Idx + 2 + dayIdx) % teams.length
          if (t2Idx === t1Idx) t2Idx = (t1Idx + 1) % teams.length
          poolNumByDiv[divId] = (poolNumByDiv[divId] ?? 0) + 1
          // Status assignment — deterministic per cell, weighted so
          // EVERY day surfaces a mix of every status (so the demo
          // shows F / Live / Delayed / Yet-to-begin on whichever
          // day the user lands on, not just bracket days). The
          // earlier "finals only on last 2 days" gating made `F`
          // invisible on the default landing day. Roughly:
          //   5% live · 10% delayed · 25% final · 60% yet-to-begin
          const statusH = (cellHash(dayIdx, slotIdx, fieldIdx, salt) * 3 + idSeed) % 20
          let status: 'scheduled' | 'live' | 'delayed' | 'final'
          if (statusH < 1) status = 'live'
          else if (statusH < 3) status = 'delayed'
          else if (statusH < 8) status = 'final'
          else status = 'scheduled'

          // Scores — only present for games that have started.
          // `scheduled` games leave the fields undefined so the
          // cell template cleanly skips the score render.
          //
          // Live / delayed games show in-progress inning scores
          // (partial game). Final games show closing inning
          // scores (full 7-inning game). Per-inning totals drive
          // both the cell pill (sum) and the drawer's line-score
          // table (per-inning breakdown).
          let team1Score: number | undefined
          let team2Score: number | undefined
          let team1InningScores: number[] | undefined
          let team2InningScores: number[] | undefined
          // Delay reason — only meaningful when status is 'delayed';
          // deterministic pick from a small pool so demos surface
          // a varied mix of common operational reasons.
          let delayReason: string | undefined
          if (status === 'delayed') {
            const DELAY_REASONS = [
              'Rain delay',
              'Lightning in area',
              'Field unavailable',
              'Late team arrival',
              'Equipment issue',
              'Awaiting umpire'
            ]
            const r = cellHash(dayIdx, slotIdx, fieldIdx, salt + 13)
            delayReason = DELAY_REASONS[r % DELAY_REASONS.length]
          }
          if (status === 'live' || status === 'delayed') {
            const seed = cellHash(dayIdx, slotIdx, fieldIdx, salt + 1)
            // Mid-game: 3 innings completed so far.
            team1InningScores = [seed % 3, (seed >> 2) % 4, (seed >> 4) % 3]
            team2InningScores = [(seed >> 1) % 4, (seed >> 3) % 3, (seed >> 5) % 4]
            team1Score = team1InningScores.reduce((a, b) => a + b, 0)
            team2Score = team2InningScores.reduce((a, b) => a + b, 0)
          } else if (status === 'final') {
            const seed = cellHash(dayIdx, slotIdx, fieldIdx, salt + 7)
            // Full 7-inning game.
            team1InningScores = Array.from({ length: 7 }, (_, i) =>
              ((seed >> (i * 2)) + i * 3) % 4
            )
            team2InningScores = Array.from({ length: 7 }, (_, i) =>
              ((seed >> (i * 2 + 1)) + i * 5 + 2) % 4
            )
            team1Score = team1InningScores.reduce((a, b) => a + b, 0)
            team2Score = team2InningScores.reduce((a, b) => a + b, 0)
            // Force a winner — when the random pair collides, bump
            // one side's last inning by 2 runs deterministically.
            if (team1Score === team2Score) {
              if (seed % 2 === 0) {
                team1InningScores[6] += 2
                team1Score += 2
              } else {
                team2InningScores[6] += 2
                team2Score += 2
              }
            }
          }
          // Per-game duration — drives the calendar-axis row span.
          // Demoes the rain-delay scenario: from 2026-05-01 onwards
          // we model "association reduced future games from 90 → 60
          // min" — unlocked games on/after that date carry an explicit
          // `durationMinutes: 60`, while locked / final games keep
          // 90 (already played at the original cadence; their stored
          // duration is authoritative). Games before the rain-delay
          // date leave `durationMinutes` undefined → consumers fall
          // back to the park's `defaultGameDurationMinutes` (90).
          const isRainDelayDate = date >= '2026-05-01'
          // Demo the MINI card variant — squeeze a handful of
          // 30-min games into the schedule on 2026-05-03 so the
          // calendar's single-row card layout is exercisable
          // from the mock without manual editing. Mixes naturally
          // with the rain-delay 60-min and locked 90-min games
          // on neighboring days so the user sees all three card
          // sizes (full / compact / mini) side-by-side as they
          // page through the dates.
          const isMiniDemoDate = date === '2026-05-03'
          const isLocked = status === 'final'
          let durationMinutes: number | undefined
          if (isLocked) durationMinutes = 90
          else if (isMiniDemoDate) durationMinutes = 30
          else if (isRainDelayDate) durationMinutes = 60

          // Half-hour-start demo — one cell on park_1 / 2026-04-29 /
          // first slot / Field 1 gets bumped from 08:00 to 08:30 so
          // the calendar axis is exercised with a game NOT aligned
          // to the hour anchor.
          const startTime =
            park.parkId === 'park_1' &&
            date === '2026-04-29' &&
            slotIdx === 0 &&
            fieldIdx === 0
              ? '08:30 AM'
              : park.slots[slotIdx]

          // ── Calendar-axis conflict validation ──────────────────
          // Skip this candidate when its [startMin, endMin] range
          // would overlap (a) a break on the same date affecting
          // this field, or (b) a game already placed on the same
          // (date, fieldName). Without this, the legacy slot grid
          // produced visible overlaps in the new calendar-axis
          // rendering — e.g. an 08:30 override with 90-min
          // duration colliding with the next slot at 09:30, OR
          // every Field-N game at 12:30 PM landing under the
          // park-wide lunch break. The validation is intentionally
          // local to the mock builder so prod data (which assumes
          // the backend already enforces these invariants) stays
          // untouched.
          const startMin = minutesFromMidnight(startTime)
          // Conflict-placement duration: the game's own override, else
          // the park's slot cadence (90 for park_1, 75 for park_2) so
          // bumper-to-bumper slots don't false-positive as overlaps.
          const effectiveDuration = durationMinutes ?? park.defaultDurationMinutes
          const endMin = startMin + effectiveDuration
          const fieldName = `Field ${fieldIdx + 1}`
          // Break conflict — park-scope blocks the whole date;
          // field-scope blocks only its named field.
          const parkBreaks = park.parkId === 'park_1' ? MOCK_PARK_1_BREAKS : []
          const conflictsBreak = parkBreaks.some((b) => {
            if (b.date !== date) return false
            if (b.scope === 'field' && b.fieldName !== fieldName) return false
            const bStart = minutesFromMidnight(b.startTime)
            const bEnd = bStart + b.durationMinutes
            return startMin < bEnd && endMin > bStart
          })
          if (conflictsBreak) continue
          // Same-field game conflict — interval-overlap against
          // every game already placed on (date, fieldName).
          const placeKey = `${date}|${fieldName}`
          const placed = placedByField[placeKey] ?? []
          const conflictsGame = placed.some(
            (p) => startMin < p.endMin && endMin > p.startMin
          )
          if (conflictsGame) continue
          // Commit — record the placement so subsequent slots
          // on the same field check against this game's range.
          placedByField[placeKey] = [...placed, { startMin, endMin }]

          games.push({
            id: `g_mock_${idSeed++}`,
            divisionId: divId,
            parkId: park.parkId,
            type: isBracketDay ? 'bracket' : 'pool',
            label: isBracketDay ? `G${poolNumByDiv[divId]}` : `Pool ${poolNumByDiv[divId]}`,
            team1Label: teams[t1Idx],
            team2Label: teams[t2Idx],
            scheduledDate: date,
            scheduledTime: startTime,
            scheduledFieldLabel: `F${fieldIdx + 1} - ${park.fieldAbbrev}`,
            status,
            team1Score,
            team2Score,
            team1InningScores,
            team2InningScores,
            delayReason,
            locked: isLocked,
            durationMinutes
          })
        }
      }
    })
  }
  return games
}

/** Unscheduled games — surface only in the scheduler's left-list
 *  pool (no scheduledDate/time/field). Sprinkled across divisions
 *  so the scheduler keeps its "still to schedule" experience. */
const MOCK_UNSCHEDULED_GAMES: SchedulerGame[] = [
  {
    id: 'g_unsched_d1_1', divisionId: 'div_1', parkId: 'park_1', type: 'bracket',
    label: 'Final',
    team1Label: 'Winner Semis A', team2Label: 'Winner Semis B',
    scheduledDate: null, scheduledTime: null, scheduledFieldLabel: null
  },
  {
    id: 'g_unsched_d2_1', divisionId: 'div_2', parkId: 'park_1', type: 'bracket',
    label: 'Final',
    team1Label: 'Winner G3', team2Label: 'Winner G4',
    scheduledDate: null, scheduledTime: null, scheduledFieldLabel: null
  },
  {
    id: 'g_unsched_d3_1', divisionId: 'div_3', parkId: 'park_1', type: 'bracket',
    label: 'Final',
    team1Label: 'Winner Bracket A', team2Label: 'Winner Bracket B',
    scheduledDate: null, scheduledTime: null, scheduledFieldLabel: null
  },
  {
    id: 'g_unsched_d4_1', divisionId: 'div_4', parkId: 'park_1', type: 'pool',
    label: 'Pool TBD',
    team1Label: '#1: Sluggers', team2Label: '#6: Heavy Hitters',
    scheduledDate: null, scheduledTime: null, scheduledFieldLabel: null
  },
  {
    id: 'g_unsched_d5_1', divisionId: 'div_5', parkId: 'park_1', type: 'bracket',
    label: 'Final',
    team1Label: '#1: Hall of Famers', team2Label: '#2: Greybeards',
    scheduledDate: null, scheduledTime: null, scheduledFieldLabel: null
  }
]
// Legacy hand-written games array — kept for reference of the
// original divisions / dates / labels but no longer wired into
// the API response (the builder above generates a denser, more
// representative day). Deletable once team is happy with the
// generated mock.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _LEGACY_HAND_WRITTEN_GAMES: SchedulerGame[] = [
  // ── DIV 1 — "divsion 7 teams second" — park_1, Apr 29 + Apr 30 ──
  {
    id: 'g_d1_pool_1', divisionId: 'div_1', parkId: 'park_1', type: 'pool',
    label: 'Pool 1',
    team1Label: '#6: GENESIS/ONYX/BG', team2Label: '#4: G2G',
    scheduledDate: '2026-04-29', scheduledTime: '08:00 AM',
    scheduledFieldLabel: 'F1 - H1 Park'
  },
  {
    id: 'g_d1_pool_2', divisionId: 'div_1', parkId: 'park_1', type: 'pool',
    label: 'Pool 2',
    team1Label: '#3: FRSTeam/Rogue', team2Label: '#1: Front Row/Spartan Bat Co',
    scheduledDate: '2026-04-29', scheduledTime: '08:00 AM',
    scheduledFieldLabel: 'F2 - H1 Park'
  },
  {
    id: 'g_d1_pool_3', divisionId: 'div_1', parkId: 'park_1', type: 'pool',
    label: 'Pool 3',
    team1Label: '#5: Getnutz', team2Label: '#2: Friars 671 Guam',
    scheduledDate: '2026-04-29', scheduledTime: '09:30 AM',
    scheduledFieldLabel: 'F1 - H1 Park'
  },
  {
    id: 'g_d1_pool_4', divisionId: 'div_1', parkId: 'park_1', type: 'pool',
    label: 'Pool 4',
    team1Label: '#7: Gigantes O.C. 40s', team2Label: '#4: G2G',
    scheduledDate: '2026-04-29', scheduledTime: '09:30 AM',
    scheduledFieldLabel: 'F2 - H1 Park'
  },
  {
    id: 'g_d1_bracket_1', divisionId: 'div_1', parkId: 'park_1', type: 'bracket',
    label: 'G1',
    team1Label: '#4: Gigantes O.C. 40s', team2Label: '#5: Front Row/Spartan Bat Co',
    scheduledDate: '2026-04-30', scheduledTime: '11:00 AM',
    scheduledFieldLabel: 'F1 - H1 Park'
  },
  {
    id: 'g_d1_bracket_2', divisionId: 'div_1', parkId: 'park_1', type: 'bracket',
    label: 'G2',
    team1Label: '#3: FRSTeam/Rogue', team2Label: '#6: Getnutz',
    scheduledDate: '2026-04-30', scheduledTime: '12:30 PM',
    scheduledFieldLabel: 'F1 - H1 Park'
  },
  // Unscheduled — surface in the scheduler's left list.
  {
    id: 'g_d1_pool_unsched_1', divisionId: 'div_1', parkId: 'park_1', type: 'pool',
    label: 'Pool 5',
    team1Label: '#1: Front Row/Spartan Bat Co', team2Label: '#2: Friars 671 Guam',
    scheduledDate: null, scheduledTime: null, scheduledFieldLabel: null
  },

  // ── DIV 2 — "Men's 65+ Division" — park_1, Apr 29 mid-day ──────
  {
    id: 'g_d2_pool_1', divisionId: 'div_2', parkId: 'park_1', type: 'pool',
    label: 'Pool 1',
    team1Label: '#1: Silver Foxes', team2Label: '#4: Diamond Kings',
    scheduledDate: '2026-04-29', scheduledTime: '11:00 AM',
    scheduledFieldLabel: 'F3 - H1 Park'
  },
  {
    id: 'g_d2_pool_2', divisionId: 'div_2', parkId: 'park_1', type: 'pool',
    label: 'Pool 2',
    team1Label: '#2: Long Ball Legends', team2Label: '#3: Hardball Heroes',
    scheduledDate: '2026-04-29', scheduledTime: '12:30 PM',
    scheduledFieldLabel: 'F3 - H1 Park'
  },
  {
    id: 'g_d2_bracket_1', divisionId: 'div_2', parkId: 'park_1', type: 'bracket',
    label: 'G1',
    team1Label: 'Winner Pool A', team2Label: 'Winner Pool B',
    scheduledDate: '2026-04-30', scheduledTime: '02:00 PM',
    scheduledFieldLabel: 'F3 - H1 Park'
  },

  // ── DIV 3 — "Men's 70/75-Platinum" — park_1, Apr 29 evening ────
  {
    id: 'g_d3_pool_1', divisionId: 'div_3', parkId: 'park_1', type: 'pool',
    label: 'Pool 1',
    team1Label: '#1: Veterans United', team2Label: '#5: Old Guard',
    scheduledDate: '2026-04-29', scheduledTime: '03:30 PM',
    scheduledFieldLabel: 'F4 - H1 Park'
  },
  {
    id: 'g_d3_pool_2', divisionId: 'div_3', parkId: 'park_1', type: 'pool',
    label: 'Pool 2',
    team1Label: '#2: Iron Men', team2Label: '#4: Steel Curtain',
    scheduledDate: '2026-04-29', scheduledTime: '03:30 PM',
    scheduledFieldLabel: 'F5 - H1 Park'
  },
  {
    id: 'g_d3_pool_3', divisionId: 'div_3', parkId: 'park_1', type: 'pool',
    label: 'Pool 3',
    team1Label: '#3: Diamond Cutters', team2Label: '#5: Old Guard',
    scheduledDate: '2026-04-29', scheduledTime: '05:00 PM',
    scheduledFieldLabel: 'F4 - H1 Park'
  },

  // ── DIV 4 — "Men's 70-Silver" — park_1, Apr 30 ─────────────────
  {
    id: 'g_d4_pool_1', divisionId: 'div_4', parkId: 'park_1', type: 'pool',
    label: 'Pool 1',
    team1Label: '#1: Sluggers', team2Label: '#6: Heavy Hitters',
    scheduledDate: '2026-04-30', scheduledTime: '08:00 AM',
    scheduledFieldLabel: 'F4 - H1 Park'
  },
  {
    id: 'g_d4_pool_2', divisionId: 'div_4', parkId: 'park_1', type: 'pool',
    label: 'Pool 2',
    team1Label: '#2: Power Play', team2Label: '#5: Grand Slammers',
    scheduledDate: '2026-04-30', scheduledTime: '09:30 AM',
    scheduledFieldLabel: 'F4 - H1 Park'
  },
  {
    id: 'g_d4_pool_3', divisionId: 'div_4', parkId: 'park_1', type: 'pool',
    label: 'Pool 3',
    team1Label: '#3: Bench Warmers', team2Label: '#4: Hot Corner',
    scheduledDate: '2026-04-30', scheduledTime: '11:00 AM',
    scheduledFieldLabel: 'F5 - H1 Park'
  },

  // ── DIV 5 — "Men's 75/80-Gold" — park_1, May 1 + park_2 ────────
  {
    id: 'g_d5_pool_1', divisionId: 'div_5', parkId: 'park_1', type: 'pool',
    label: 'Pool 1',
    team1Label: '#1: Hall of Famers', team2Label: '#7: Legends',
    scheduledDate: '2026-05-01', scheduledTime: '08:00 AM',
    scheduledFieldLabel: 'F6 - H1 Park'
  },
  {
    id: 'g_d5_pool_2', divisionId: 'div_5', parkId: 'park_1', type: 'pool',
    label: 'Pool 2',
    team1Label: '#2: Greybeards', team2Label: '#6: Wise Guys',
    scheduledDate: '2026-05-01', scheduledTime: '09:30 AM',
    scheduledFieldLabel: 'F6 - H1 Park'
  },
  {
    id: 'g_d5_pool_3', divisionId: 'div_5', parkId: 'park_1', type: 'pool',
    label: 'Pool 3',
    team1Label: '#3: Old Timers', team2Label: '#5: Boys of Summer',
    scheduledDate: '2026-05-01', scheduledTime: '11:00 AM',
    scheduledFieldLabel: 'F7 - H1 Park'
  },

  // ── Park 2 — Walnut Creek Softball Complex ─────────────────────
  // Smaller park, fewer fields + slots, but the field-grid view
  // should still show variety here when the user switches parks.
  {
    id: 'g_d2_wc_1', divisionId: 'div_2', parkId: 'park_2', type: 'pool',
    label: 'Pool 3',
    team1Label: '#5: Silver Streak', team2Label: '#6: Pewter Pounders',
    scheduledDate: '2026-04-29', scheduledTime: '09:00 AM',
    scheduledFieldLabel: 'F1 - WC'
  },
  {
    id: 'g_d3_wc_1', divisionId: 'div_3', parkId: 'park_2', type: 'pool',
    label: 'Pool 4',
    team1Label: '#4: Platinum Cup', team2Label: '#6: Diamond Dust',
    scheduledDate: '2026-04-29', scheduledTime: '10:30 AM',
    scheduledFieldLabel: 'F2 - WC'
  },
  {
    id: 'g_d4_wc_1', divisionId: 'div_4', parkId: 'park_2', type: 'pool',
    label: 'Pool 4',
    team1Label: '#5: Silver Bullets', team2Label: '#1: Sluggers',
    scheduledDate: '2026-04-30', scheduledTime: '12:00 PM',
    scheduledFieldLabel: 'F3 - WC'
  },
  {
    id: 'g_d5_wc_1', divisionId: 'div_5', parkId: 'park_2', type: 'pool',
    label: 'Pool 4',
    team1Label: '#4: Gold Standard', team2Label: '#7: Legends',
    scheduledDate: '2026-04-30', scheduledTime: '01:30 PM',
    scheduledFieldLabel: 'F4 - WC'
  },
  {
    id: 'g_d2_wc_2', divisionId: 'div_2', parkId: 'park_2', type: 'bracket',
    label: 'G2',
    team1Label: '#3: Hardball Heroes', team2Label: 'Loser of G1',
    scheduledDate: '2026-05-01', scheduledTime: '09:00 AM',
    scheduledFieldLabel: 'F1 - WC'
  },

  // ── Unscheduled (no scheduledDate) — left-list only ────────────
  {
    id: 'g_d3_unsched_1', divisionId: 'div_3', parkId: 'park_1', type: 'bracket',
    label: 'G2',
    team1Label: 'Winner Pool 1', team2Label: 'Winner Pool 2',
    scheduledDate: null, scheduledTime: null, scheduledFieldLabel: null
  },
  {
    id: 'g_d5_unsched_1', divisionId: 'div_5', parkId: 'park_1', type: 'pool',
    label: 'Pool 4',
    team1Label: '#4: Gold Standard', team2Label: '#5: Boys of Summer',
    scheduledDate: null, scheduledTime: null, scheduledFieldLabel: null
  }
]

// ─── Mock breaks (per-park, per-day) ─────────────────────────────
// Demoes the three flavours the calendar-axis grid renders:
//   1. Lunch (park-wide, 12:30 PM, 30 min) on 2026-04-29 —
//      blocks every field column with a striped band.
//   2. Rain delay (park-wide, 2:00 PM, 45 min) on 2026-05-01 —
//      pairs with the rain-delay-shrunk game durations on that
//      date so the cause + effect are visible together.
//   3. Field 2 maintenance (field-scoped, 10:00 AM, 60 min) on
//      2026-04-30 — single-column band so the user can compare
//      park-wide vs single-field break visuals.
const MOCK_PARK_1_BREAKS: SchedulerBreak[] = [
  {
    id: 'brk_p1_lunch_0429',
    date: '2026-04-29',
    startTime: '12:30',
    durationMinutes: 30,
    label: 'Lunch',
    scope: 'park'
  },
  {
    id: 'brk_p1_rain_0501',
    date: '2026-05-01',
    startTime: '14:00',
    durationMinutes: 45,
    label: 'Rain delay',
    scope: 'park'
  },
  {
    id: 'brk_p1_maint_0430',
    date: '2026-04-30',
    startTime: '10:00',
    durationMinutes: 60,
    label: 'Field 2 maintenance',
    scope: 'field',
    fieldName: 'Field 2'
  }
]

// ─── Mock parks + per-day grid ───────────────────────────────────
const MOCK_PARKS: SchedulerPark[] = [
  {
    id: 'park_1',
    name: 'park no.1',
    location: 'Carson City, NV',
    // Calendar-axis scheduling window. The visual axis pads to
    // clean hour boundaries (08:00 → 20:00); games / breaks are
    // placed by their HH:MM start + per-game duration.
    dayStartTime: '08:00',
    dayEndTime: '20:00',
    defaultGameDurationMinutes: 90,
    breaks: MOCK_PARK_1_BREAKS,
    fields: [
      { id: 'f_1', name: 'Field 1' },
      { id: 'f_2', name: 'Field 2' },
      { id: 'f_3', name: 'Field 3' },
      { id: 'f_4', name: 'Field 4' },
      { id: 'f_5', name: 'Field 5' },
      { id: 'f_6', name: 'Field 6' },
      { id: 'f_7', name: 'Field 7' },
      { id: 'f_8', name: 'Field 8' }
    ],
    days: [
      { date: '2026-04-29', weekdayLabel: 'Wed', dayLabel: '29', monthLabel: 'Apr' },
      { date: '2026-04-30', weekdayLabel: 'Thu', dayLabel: '30', monthLabel: 'Apr' },
      { date: '2026-05-01', weekdayLabel: 'Fri', dayLabel: '1',  monthLabel: 'May' },
      { date: '2026-05-02', weekdayLabel: 'Sat', dayLabel: '2',  monthLabel: 'May' },
      { date: '2026-05-03', weekdayLabel: 'Sun', dayLabel: '3',  monthLabel: 'May' },
      { date: '2026-05-04', weekdayLabel: 'Mon', dayLabel: '4',  monthLabel: 'May' },
      { date: '2026-05-05', weekdayLabel: 'Tue', dayLabel: '5',  monthLabel: 'May' }
    ],
    slots: [
      { startTime: '08:00', label: '08:00 AM' },
      { startTime: '09:30', label: '09:30 AM' },
      { startTime: '11:00', label: '11:00 AM' },
      { startTime: '12:30', label: '12:30 PM' },
      { startTime: '14:00', label: '02:00 PM' },
      { startTime: '15:30', label: '03:30 PM' },
      { startTime: '17:00', label: '05:00 PM' },
      { startTime: '18:30', label: '06:30 PM' }
    ]
  },
  {
    id: 'park_2',
    name: 'Walnut Creek Softball Complex',
    location: 'Walnut Creek, CA',
    // Mid-hour 9:15 day start + 75-min game slots (vs park_1's 8:00 /
    // 90-min) — exercises the 5-min grain end to end.
    dayStartTime: '09:15',
    dayEndTime: '17:00',
    defaultGameDurationMinutes: 75,
    breaks: [],
    fields: [
      { id: 'wc_1', name: 'Field 1' },
      { id: 'wc_2', name: 'Field 2' },
      { id: 'wc_3', name: 'Field 3' },
      { id: 'wc_4', name: 'Field 4' }
    ],
    days: [
      { date: '2026-04-29', weekdayLabel: 'Wed', dayLabel: '29', monthLabel: 'Apr' },
      { date: '2026-04-30', weekdayLabel: 'Thu', dayLabel: '30', monthLabel: 'Apr' },
      { date: '2026-05-01', weekdayLabel: 'Fri', dayLabel: '1',  monthLabel: 'May' }
    ],
    slots: [
      { startTime: '09:00', label: '09:00 AM' },
      { startTime: '10:30', label: '10:30 AM' },
      { startTime: '12:00', label: '12:00 PM' },
      { startTime: '13:30', label: '01:30 PM' },
      { startTime: '15:00', label: '03:00 PM' }
    ]
  }
]

/** `GET /v2/association/events/{associationId}/{eventId}/scheduler`
 *  — composite payload for the scheduler sub-page. Mock layer for v1;
 *  replace body with a `fetchEnvelope` call once the backend endpoint
 *  ships. Returned shape matches the planned wire shape exactly so the
 *  swap is body-only. */
export async function fetchMatchGeniScheduler(
  associationShortName: string,
  eventId: string
): Promise<MatchGeniSchedulerPayload> {
  void associationShortName
  void eventId
  return delay({
    divisions: MOCK_DIVISIONS,
    // Scheduled games come from the deterministic builder (dense
    // multi-day grid across all 5 divisions); unscheduled games
    // hand-written above for the scheduler's left-list pool.
    games: [...buildScheduledGames(), ...MOCK_UNSCHEDULED_GAMES],
    parks: MOCK_PARKS,
    eventDefaultGameDurationMinutes: 90
  })
}

/* ════════════════════════════════════════════════════════════════
   Resources-driven scheduler hydration
   ────────────────────────────────────────────────────────────────
   The §9 Event Resources endpoint (`fetchEventResources`) is LIVE
   (real backend), returning parks (with `fieldsInUse` + per-day
   `schedule`) and divisions. The games API is not shipped yet, so
   we synthesize mock games that FIT whatever resources returns —
   keyed to the real park/field/division ids + per-day windows — so
   the grid renders populated against real structure. When the games
   API ships, swap `buildMockGamesForResources` for the real fetch;
   the adapters below stay.
   ════════════════════════════════════════════════════════════════ */

function minutesToHHMM(min: number): string {
  const norm = ((Math.round(min) % 1440) + 1440) % 1440
  const h = Math.floor(norm / 60)
  const m = norm % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function deriveDayLabels(dateIso: string): {
  weekdayLabel: string
  dayLabel: string
  monthLabel: string
} {
  const d = new Date(`${dateIso}T00:00:00`)
  if (Number.isNaN(d.getTime())) {
    return { weekdayLabel: '', dayLabel: dateIso, monthLabel: '' }
  }
  return {
    weekdayLabel: d.toLocaleDateString('en-US', { weekday: 'short' }),
    dayLabel: d.toLocaleDateString('en-US', { day: 'numeric' }),
    monthLabel: d.toLocaleDateString('en-US', { month: 'short' })
  }
}

/** Small stable string hash → non-negative int. Seeds the synthetic
 *  division meta so the same division always renders the same
 *  team-count / bracket shape across reloads. */
function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

/** Map §9 resource parks → `SchedulerPark[]`. `fieldsInUse` →
 *  `fields`; `schedule[]` → `days[]` carrying each day's own window;
 *  park-level `dayStartTime`/`dayEndTime` = envelope of all per-day
 *  windows (drives the visual-axis padding + the fallback when a day
 *  lacks its own window). `breaks` start empty (resources doesn't
 *  carry them — break CRUD is client-side); `slots` is the deprecated
 *  legacy field, left empty. */
export function adaptResourceParks(parks: Park[]): SchedulerPark[] {
  return parks.map((p) => {
    const schedule = p.schedule ?? []
    const days: SchedulerParkDay[] = schedule.map((s) => ({
      date: s.date,
      ...deriveDayLabels(s.date),
      startTime: s.startTime,
      endTime: s.endTime
    }))
    const starts = schedule
      .map((s) => minutesFromMidnight(s.startTime))
      .filter((n) => Number.isFinite(n))
    const ends = schedule
      .map((s) => minutesFromMidnight(s.endTime))
      .filter((n) => Number.isFinite(n))
    const minStart = starts.length ? Math.min(...starts) : 8 * 60
    const maxEnd = ends.length ? Math.max(...ends) : 20 * 60
    return {
      id: p.id,
      name: p.name,
      location: [p.city, p.state].filter(Boolean).join(', '),
      fields: (p.fieldsInUse ?? []).map((f) => ({ id: f.id, name: f.name })),
      days,
      dayStartTime: minutesToHHMM(minStart),
      dayEndTime: minutesToHHMM(maxEnd),
      defaultGameDurationMinutes: 90,
      breaks: [],
      slots: []
    }
  })
}

/** Map §9 resource divisions → `SchedulerDivision[]`. Resources only
 *  carries id + name + date range; the rich pool/bracket meta the
 *  left-column banner needs is SYNTHESIZED deterministically (per-id
 *  hash) until the games API ships the real structure. */
export function adaptResourceDivisions(divisions: Division[]): SchedulerDivision[] {
  return divisions.map((d) => {
    const seed = hashString(`${d.id}|${d.name}`)
    const teamCount = 4 + (seed % 5) // 4..8
    // Prefer the per-division mock bracket list (keyed by name for
    // live resources divisions) so the division's bracket COUNT +
    // NAMES match what the preview actually renders — some divisions
    // run 2 brackets, some 1, incl. 3-game-guarantee. Falls back to
    // the synthesized single bracket when the division isn't in the
    // mock map.
    const mockBrackets = getMockBracketsForDivision({ id: d.id, name: d.name })
    const synthHasBracket = seed % 3 !== 0
    const hasBracket = mockBrackets.length > 0 ? true : synthHasBracket
    return {
      id: d.id,
      name: d.name,
      dateRangeLabel: d.dateRangeLabelShort || d.dateRangeLabel || undefined,
      teamCount,
      hasPool: true,
      hasBracket,
      poolRoundRobinCount: 1,
      poolGamesPerTeam: Math.max(2, teamCount - 1),
      poolStatus: (['generated', 'in_progress', 'completed'] as const)[seed % 3],
      tieBreakerText: (['Head to head', 'Run differential', 'Runs allowed'] as const)[seed % 3],
      bracketGameGuarantee: hasBracket ? 2 + (seed % 2) : 0,
      bracketCount: mockBrackets.length > 0
        ? mockBrackets.length
        : (synthHasBracket ? 1 : 0),
      bracketNames: mockBrackets.length > 0
        ? mockBrackets.map((b) => b.name)
        : (synthHasBracket ? [`${d.name} Gold`] : []),
      bracketStatuses: mockBrackets.length > 0
        ? mockBrackets.map((_, i) => (['initiated', 'in_progress', 'completed', 'pending'] as const)[(seed + i) % 4])
        : (synthHasBracket ? [(['initiated', 'in_progress', 'completed', 'pending'] as const)[seed % 4]] : [])
    }
  })
}

/** Synthetic team-label pool sized to the division. */
function synthTeamPool(div: SchedulerDivision): string[] {
  const n = Math.max(3, div.teamCount)
  return Array.from({ length: n }, (_, i) => `#${i + 1} Seed`)
}

/** Generate mock games filling the adapted parks' fields × per-day
 *  windows. Same deterministic status/score/duration flavor as the
 *  legacy `buildScheduledGames`, but driven entirely by the resource
 *  structure (real ids, fields, dates, per-day windows) so games
 *  always line up with what the grid renders. */
export function buildMockGamesForResources(
  parks: SchedulerPark[],
  divisions: SchedulerDivision[]
): SchedulerGame[] {
  const games: SchedulerGame[] = []
  if (divisions.length === 0) return games
  const poolNumByDiv: Record<string, number> = {}
  let idSeed = 5000
  const placedByField: Record<string, { startMin: number; endMin: number }[]> = {}
  const teamPools: Record<string, string[]> = {}
  for (const d of divisions) teamPools[d.id] = synthTeamPool(d)

  parks.forEach((park, parkIdx) => {
    const salt = (park.id.charCodeAt(park.id.length - 1) || 7) + parkIdx
    const duration = park.defaultGameDurationMinutes || 90
    park.days.forEach((day, dayIdx) => {
      const winStart = minutesFromMidnight(day.startTime ?? park.dayStartTime)
      const winEnd = minutesFromMidnight(day.endTime ?? park.dayEndTime)
      if (!Number.isFinite(winStart) || !Number.isFinite(winEnd)) return
      const slotStarts: number[] = []
      for (let m = winStart; m + duration <= winEnd; m += duration) slotStarts.push(m)
      const isBracketDay = park.days.length > 1 && dayIdx >= park.days.length - 2
      const density = Math.max(0.3, 0.95 - dayIdx * 0.12)
      const fillThreshold = density * 100

      slotStarts.forEach((startMin, slotIdx) => {
        park.fields.forEach((field, fieldIdx) => {
          if (cellHash(dayIdx, slotIdx, fieldIdx, salt) >= fillThreshold) return
          const div = divisions[(dayIdx + slotIdx * 2 + fieldIdx) % divisions.length]
          const teams = teamPools[div.id]
          const t1 = (slotIdx + fieldIdx) % teams.length
          let t2 = (t1 + 2 + dayIdx) % teams.length
          if (t2 === t1) t2 = (t1 + 1) % teams.length
          poolNumByDiv[div.id] = (poolNumByDiv[div.id] ?? 0) + 1

          const statusH = (cellHash(dayIdx, slotIdx, fieldIdx, salt) * 3 + idSeed) % 20
          let status: 'scheduled' | 'live' | 'delayed' | 'final'
          if (statusH < 1) status = 'live'
          else if (statusH < 3) status = 'delayed'
          else if (statusH < 8) status = 'final'
          else status = 'scheduled'

          let team1Score: number | undefined
          let team2Score: number | undefined
          let team1InningScores: number[] | undefined
          let team2InningScores: number[] | undefined
          let delayReason: string | undefined
          if (status === 'delayed') {
            const DELAY_REASONS = [
              'Rain delay', 'Lightning in area', 'Field unavailable',
              'Late team arrival', 'Equipment issue', 'Awaiting umpire'
            ]
            delayReason = DELAY_REASONS[cellHash(dayIdx, slotIdx, fieldIdx, salt + 13) % DELAY_REASONS.length]
          }
          if (status === 'live' || status === 'delayed') {
            const seed = cellHash(dayIdx, slotIdx, fieldIdx, salt + 1)
            team1InningScores = [seed % 3, (seed >> 2) % 4, (seed >> 4) % 3]
            team2InningScores = [(seed >> 1) % 4, (seed >> 3) % 3, (seed >> 5) % 4]
            team1Score = team1InningScores.reduce((a, b) => a + b, 0)
            team2Score = team2InningScores.reduce((a, b) => a + b, 0)
          } else if (status === 'final') {
            const seed = cellHash(dayIdx, slotIdx, fieldIdx, salt + 7)
            team1InningScores = Array.from({ length: 7 }, (_, i) => ((seed >> (i * 2)) + i * 3) % 4)
            team2InningScores = Array.from({ length: 7 }, (_, i) => ((seed >> (i * 2 + 1)) + i * 5 + 2) % 4)
            team1Score = team1InningScores.reduce((a, b) => a + b, 0)
            team2Score = team2InningScores.reduce((a, b) => a + b, 0)
            if (team1Score === team2Score) {
              if (seed % 2 === 0) { team1InningScores[6] += 2; team1Score += 2 }
              else { team2InningScores[6] += 2; team2Score += 2 }
            }
          }

          const isLocked = status === 'final'
          // Locked/final games store their played duration; others
          // fall through to the park default at render time.
          const durationMinutes: number | undefined = isLocked ? duration : undefined
          const startTime = minutesToHHMM(startMin)
          const endMin = startMin + (durationMinutes ?? duration)
          const placeKey = `${day.date}|${field.name}`
          const placed = placedByField[placeKey] ?? []
          if (placed.some((p) => startMin < p.endMin && endMin > p.startMin)) return
          placedByField[placeKey] = [...placed, { startMin, endMin }]

          games.push({
            id: `g_res_${idSeed++}`,
            divisionId: div.id,
            parkId: park.id,
            type: isBracketDay ? 'bracket' : 'pool',
            label: isBracketDay ? `G${poolNumByDiv[div.id]}` : `Pool ${poolNumByDiv[div.id]}`,
            team1Label: teams[t1],
            team2Label: teams[t2],
            scheduledDate: day.date,
            scheduledTime: startTime,
            scheduledFieldLabel: field.name,
            status,
            team1Score,
            team2Score,
            team1InningScores,
            team2InningScores,
            delayReason,
            locked: isLocked,
            durationMinutes
          })
        })
      })
    })
  })
  return games
}

/** A couple of unscheduled games per division so the scheduler's
 *  left-list pool isn't empty. */
function buildUnscheduledForResources(
  divisions: SchedulerDivision[],
  firstParkId: string | null
): SchedulerGame[] {
  return divisions.map((d, i) => ({
    id: `g_res_unsched_${d.id}_${i}`,
    divisionId: d.id,
    parkId: firstParkId,
    type: d.hasBracket ? 'bracket' : 'pool',
    label: d.hasBracket ? 'Final' : 'Pool TBD',
    team1Label: d.hasBracket ? 'Winner Semis A' : '#1 Seed',
    team2Label: d.hasBracket ? 'Winner Semis B' : '#2 Seed',
    scheduledDate: null,
    scheduledTime: null,
    scheduledFieldLabel: null
  }))
}

/** Compose a full scheduler payload from the LIVE §9 resources
 *  (parks + divisions), filling in mock games until the games API
 *  ships. Returns `null` when resources carries no usable parks so
 *  the caller can show its blurred-fallback state. */
export function buildSchedulerFromResources(
  parks: Park[],
  divisions: Division[]
): MatchGeniSchedulerPayload {
  const adaptedParks = adaptResourceParks(parks)
  const adaptedDivs = adaptResourceDivisions(divisions)
  const games = [
    ...buildMockGamesForResources(adaptedParks, adaptedDivs),
    ...buildUnscheduledForResources(adaptedDivs, adaptedParks[0]?.id ?? null)
  ]
  return { divisions: adaptedDivs, games, parks: adaptedParks, eventDefaultGameDurationMinutes: 90 }
}

/** Compose a scheduler payload from the LIVE §9 resources **parks
 *  only** — the field-grid scoring surface has no division-selection
 *  UI, so it fetches `type=parks` and never the division catalogue.
 *
 *  Parks (fields + per-day windows) are real; games are still
 *  synthesized to fit until the games API ships, and they need a
 *  division catalogue to belong to — so the MOCK divisions stand in
 *  purely as the games' division grouping + the cell pills' division
 *  names. No unscheduled games are produced (the field grid has no
 *  left-hand pool list to hold them). */
export function buildFieldGridFromResources(
  parks: Park[]
): MatchGeniSchedulerPayload {
  const adaptedParks = adaptResourceParks(parks)
  const games = buildMockGamesForResources(adaptedParks, MOCK_DIVISIONS)
  return { divisions: MOCK_DIVISIONS, games, parks: adaptedParks, eventDefaultGameDurationMinutes: 90 }
}
