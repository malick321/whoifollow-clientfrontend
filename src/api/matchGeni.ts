import type {
  EventTournament,
  MatchGeniDashboard,
  MatchGeniForecastDay,
  MatchGeniPlayingFacility,
  MatchGeniScheduleDay,
  MatchGeniStats,
  MatchGeniTeamsSummary
} from '../types'

/**
 * MatchGeni dashboard mock API. v1 ships without a real backend —
 * `fetchMatchGeniDashboard` returns deterministic mock data after a
 * short delay so the UI feels async. Call signature mirrors the
 * future endpoint shape:
 *
 *   GET /v2/association/{associationShortName}/events/{eventId}/matchgeni
 *
 * The backend route will return the same payload composed from:
 *   - `team_events` (event identity)
 *   - `event_tournaments` aggregate (division pool/seed/bracket status)
 *   - `event_joined_team` aggregate (teams-participating summary)
 *   - `event_parks` + linked schedule rows (playing facility)
 *   - `event_officials` count + `event_umpires` count + active-game
 *     count + overall progress aggregate
 *
 * Swapping mock → real HTTP is a body-only change inside this
 * function; the page consumes the typed return value as-is.
 */

const SIMULATED_LATENCY_MS = 280

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), SIMULATED_LATENCY_MS))
}

const MOCK_TOURNAMENTS_BY_EVENT: Record<string, EventTournament[]> = {}

/** Stable seed-based mock data — same event id yields the same
 *  tournament list across renders so the dashboard's row order
 *  doesn't shuffle as the user navigates between pages. */
function seedTournaments(eventKey: string): EventTournament[] {
  const cached = MOCK_TOURNAMENTS_BY_EVENT[eventKey]
  if (cached) return cached

  const divisions = [
    "Men's 65+ Division",
    "Men's 70/75-Platinum",
    "Men's 70-Silver",
    "Men's 75/80-Gold",
    "Men's 40-Major",
    "Men's 40-AAA",
    "Men's 50/55-Major+",
    "Men's 50-Major",
    "Men's 50-AAA",
    "Men's 55-Major",
    "Men's 60-Major",
    "Men's 60-AAA"
  ]
  // Each division is parked at a different point in the lifecycle so
  // the division-detail drawer's workflow-action button cycles through
  // every variant (Generate Pool Play → Regenerate → Generate Seed →
  // Initiate Bracket → Undo Initiate → no-action). Cycled across the
  // division list via `idx % STATES.length`.
  const STATES: Pick<
    EventTournament,
    'poolStatus' | 'seedStatus' | 'bracketsStatus' | 'progressPercent'
  >[] = [
    // Pool not generated yet → "Generate Pool Play"
    { poolStatus: 'pending', seedStatus: 'pending', bracketsStatus: 'pending', progressPercent: 0 },
    // Pool generated → "Regenerate Pool Play"
    { poolStatus: 'generated', seedStatus: 'pending', bracketsStatus: 'pending', progressPercent: 15 },
    // Pool play underway → no action
    { poolStatus: 'in_progress', seedStatus: 'pending', bracketsStatus: 'pending', progressPercent: 38 },
    // Pool done, seeds not generated → "Generate Seed"
    { poolStatus: 'completed', seedStatus: 'pending', bracketsStatus: 'pending', progressPercent: 58 },
    // Seeds generated, bracket not initiated → "Initiate Bracket"
    { poolStatus: 'completed', seedStatus: 'generated', bracketsStatus: 'pending', progressPercent: 72 },
    // Bracket initiated (not yet in progress) → "Undo Initiate"
    { poolStatus: 'completed', seedStatus: 'generated', bracketsStatus: 'generated', progressPercent: 84 },
    // First bracket game scored → bracket in progress → no action
    { poolStatus: 'completed', seedStatus: 'locked', bracketsStatus: 'in_progress', progressPercent: 93 },
    // Everything wrapped → no action
    { poolStatus: 'completed', seedStatus: 'locked', bracketsStatus: 'completed', progressPercent: 100 }
  ]
  const rows: EventTournament[] = divisions.map((name, idx) => {
    const state = STATES[idx % STATES.length]
    return {
      id: String(7000 + idx),
      guid: `tournament-${eventKey}-${idx}`,
      tournamentName: name,
      // Backend renders this server-side per the events contract
      // §9 spec — full label with weekdays + year. Mock mirrors
      // that format so the UI gets a realistic preview locally.
      dateRangeLabel: idx < 4
        ? 'Tue, May 12 – Thu, May 14, 2026'
        : 'Fri, May 15 – Sun, May 17, 2026',
      teamCount: 4 + (idx % 4),
      poolStatus: state.poolStatus,
      seedStatus: state.seedStatus,
      // No brackets created until the bracket is initiated; once
      // generated, 1–2 brackets so the per-bracket lines + multi-row
      // case are both exercised.
      bracketsCount: state.bracketsStatus === 'pending' ? 0 : 1 + (idx % 2),
      bracketsStatus: state.bracketsStatus,
      progressPercent: state.progressPercent
    }
  })
  MOCK_TOURNAMENTS_BY_EVENT[eventKey] = rows
  return rows
}

const MOCK_FORECAST: MatchGeniForecastDay[] = [
  { date: '2026-05-11', label: 'Mon, May 11', conditionText: 'Sunny', high: 99, low: 57 },
  { date: '2026-05-12', label: 'Tue, May 12', conditionText: 'Sunny', high: 88, low: 60 },
  { date: '2026-05-13', label: 'Wed, May 13', conditionText: 'Sunny', high: 80, low: 56 },
  { date: '2026-05-14', label: 'Thu, May 14', conditionText: 'Sunny', high: 86, low: 53 },
  { date: '2026-05-15', label: 'Fri, May 15', conditionText: 'Sunny', high: 89, low: 56 }
]

const MOCK_SCHEDULE: MatchGeniScheduleDay[] = [
  { date: '2026-05-12', label: 'Tue May 12', windowLabel: '08:30 AM - 04:00 PM' },
  { date: '2026-05-13', label: 'Wed May 13', windowLabel: '08:00 AM - 06:30 PM' },
  { date: '2026-05-14', label: 'Thu May 14', windowLabel: '08:00 AM - 03:30 PM' },
  { date: '2026-05-15', label: 'Fri May 15', windowLabel: '08:00 AM - 06:30 PM' },
  { date: '2026-05-16', label: 'Sat May 16', windowLabel: '08:00 AM - 09:30 PM' },
  { date: '2026-05-17', label: 'Sun May 17', windowLabel: '08:00 AM - 05:00 PM' }
]

function mockFacilities(): MatchGeniPlayingFacility[] {
  return [
    {
      id: 'p_1',
      name: 'Walnut Creek Softball Complex',
      address: '1201 Sunnybrook Rd, Raleigh, NC 27610, USA',
      divisionsPlaying: [
        "Men's 65+ Division",
        "Men's 70/75-Platinum",
        "Men's 70-Silver",
        "Men's 40-Major",
        "Men's 40-AAA"
      ],
      gamesScheduled: 241,
      fieldsInUse: ['Field 1', 'Field 2', 'Field 3', 'Field 4', 'Field 5', 'Field 6', 'Field 7', 'Field 8', 'Field 9'],
      forecast: MOCK_FORECAST,
      schedule: MOCK_SCHEDULE
    },
    {
      id: 'p_2',
      name: 'Brier Creek Athletic Park',
      address: '8800 Brier Creek Pkwy, Raleigh, NC 27617, USA',
      divisionsPlaying: [
        "Men's 50-Major",
        "Men's 50-AAA",
        "Men's 55-Major"
      ],
      gamesScheduled: 178,
      fieldsInUse: ['Field 1', 'Field 2', 'Field 3', 'Field 4', 'Field 5', 'Field 6'],
      forecast: MOCK_FORECAST,
      schedule: MOCK_SCHEDULE
    },
    {
      id: 'p_3',
      name: 'North Hills Sports Park',
      address: '4421 Six Forks Rd, Raleigh, NC 27609, USA',
      divisionsPlaying: [
        "Men's 60-Major",
        "Men's 60-AAA",
        "Men's 75/80-Gold",
        "Men's 50/55-Major+"
      ],
      gamesScheduled: 96,
      fieldsInUse: ['Field 1', 'Field 2', 'Field 3', 'Field 4'],
      forecast: MOCK_FORECAST,
      schedule: MOCK_SCHEDULE
    }
  ]
}

function mockStats(tournaments: EventTournament[]): MatchGeniStats {
  return {
    playingFacilities: 3,
    eventUmpires: 0,
    eventOfficials: 76,
    activeGames: 0,
    delayedGames: 0,
    overallProgressPercent: tournaments.length === 0
      ? 0
      : Math.round(tournaments.reduce((acc, t) => acc + t.progressPercent, 0) / tournaments.length)
  }
}

function mockTeamsSummary(): MatchGeniTeamsSummary {
  // Mirrors the screenshot — 76 teams total across the four
  // participation_status buckets. The real backend will compute
  // from `event_joined_team` by status (the same source that
  // feeds `EventTeamCounts` on the event-list endpoint).
  return {
    total: 76,
    pending: 3,
    confirmed: 70,
    waitlisted: 2,
    withdrawn: 1
  }
}

/**
 * `GET /v2/association/{associationShortName}/events/{eventId}/matchgeni`
 *
 * Returns the aggregate dashboard payload. The event row is
 * re-fetched via `fetchEvent` (cheap PK lookup) so the page header
 * stays in sync without duplicating the event lookup endpoint.
 *
 * `eventId` is the event's numeric PK (string-serialized). The
 * matchgeni URL carries this id directly — see the route definition
 * in `src/router.ts` for the rationale.
 */
export async function fetchMatchGeniDashboard(
  associationShortName: string,
  eventId: string
): Promise<MatchGeniDashboard> {
  void associationShortName
  // Event identity is sourced from the `my-permissions` endpoint
  // (see `fetchMatchGeniAccess` + `matchgeni-context.ts`) — the
  // matchgeni dashboard view reads its header from that payload
  // now, NOT from `dashboard.event` below. So this mock just emits
  // stub event-display fields (id correct + the rest placeholder)
  // and skips the previous `fetchEvent` call entirely. Previously
  // that call hit the mock seed and 404'd for real backend event
  // ids, which surfaced as a full-page "Event not found" banner
  // even when the access check itself succeeded.
  const tournaments = seedTournaments(eventId)
  return delay({
    stats: mockStats(tournaments),
    event: {
      id: eventId,
      guid: '',
      eventName: '',
      dateRangeLabel: '',
      timeZone: '',
      eventStatus: 'published' as const
    },
    tournaments,
    teamsSummary: mockTeamsSummary(),
    facilities: mockFacilities()
  })
}
