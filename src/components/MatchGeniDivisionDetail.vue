<script setup lang="ts">
// MatchGeniDivisionDetail
// -----------------------
// Self-contained division-detail panel — the right pane of the
// MatchGeni division page (`MatchGeniDivisionDetailView`). Renders, top
// → bottom:
//   - Header row: date range (eyebrow) + division name + event name,
//     with Edit Division / Lifebook / Add Bracket actions on the right.
//   - Overview card: Pool Play / Seed / Brackets stats split by
//     vertical dividers + an overall-progress bar with a contextual
//     workflow CTA.
//   - Team pools: pool tabs + the standings list item (shared global
//     `.division-standings` classes).
//   - Games: date-grouped timeline (team-participation-portal style).
//
// Presentational + self-loading: it fetches its own standings for the
// passed `division`. All actions emit up via `action`; mock-data
// generators stand in until the real division/games/bracket APIs ship.

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import TeamAvatar from './TeamAvatar.vue'
import AppIcon from './AppIcon.vue'
import MatchGeniBracket from './MatchGeniBracket.vue'
import MatchGeniBracketFormModal from './MatchGeniBracketFormModal.vue'
import MatchGeniBracketRail, { type BracketRailItem } from './MatchGeniBracketRail.vue'
import { canMatchGeniWrite } from '../matchgeni-context'
import { lockBodyScroll, unlockBodyScroll } from '../body-scroll-lock'
import { fetchDivisionOverviewStandings } from '../api/divisionOverview'
import {
  fetchDivisionStandings,
  setUnitStandings,
  type DivisionStandingsContext,
  type StandingsGroupSource,
  type StandingsTeam
} from '../api/matchGeniStandings'
import AnnounceResultModal from './AnnounceResultModal.vue'
import CancelBracketModal, { type CancelBracketReason } from './CancelBracketModal.vue'
import ScoringGameDetailsDrawer, { type ScoringDrawerAction } from './ScoringGameDetailsDrawer.vue'
import SchedulerCreateGameModal from './SchedulerCreateGameModal.vue'
import PoolPlayGames from './poolplay/PoolPlayGames.vue'
import MatchGeniPoolPlayGameItem from './MatchGeniPoolPlayGameItem.vue'
import { bracketCancellations, cancelBracket } from '../api/matchGeniBrackets'
import { bracketStatusLabel, bracketStatusTone } from '../lib/bracketStatus'
import type {
  BracketCancellation,
  BracketStatus,
  DivisionStandings,
  EventTournamentBracketStatus,
  SetUnitStandingsPayload,
  StandingUnit
} from '../types'
import { getMockBracket, getMockBracketsForDivision } from '../api/mockBrackets'
import type { BracketModel, DivisionStandingEntry, EventTournament, SchedulerGame } from '../types'

const props = withDefaults(defineProps<{
  division: EventTournament | null
  /** Parent event name — shown under the division name in the header. */
  eventName?: string
  /** All divisions of the event — powers the bracket-canvas division
   *  switcher (passed from the host; no refetch here). */
  divisions?: EventTournament[]
}>(), {
  division: null,
  eventName: '',
  divisions: () => []
})

export type DivisionDetailAction =
  | 'edit-division'
  | 'add-bracket'
  | 'edit-bracket'
  | 'edit-matchup'
  | 'game-notes'
  | 'assign-umpires'
  | 'regenerate-pool'
  | 'manage-team-pools'
  | 'notify-teams'
  | 'attach-lifebook'
  | 'replace-lifebook'
  | 'detach-lifebook'
  | 'generate-pool'
  | 'generate-seed'
  | 'initiate-bracket'
  | 'undo-initiate'

const emit = defineEmits<{
  (event: 'action', action: DivisionDetailAction, division: EventTournament): void
  /** Fires when the bracket canvas stage opens / closes, so the host
   *  page can go full-screen (hide the sidebar + edge-to-edge). */
  (event: 'bracket-open', open: boolean): void
  /** Bracket-canvas division switcher picked another division — the
   *  host changes the selection (navigates). */
  (event: 'select-division', divisionId: string): void
}>()

// ── Phase helpers ────────────────────────────────────────────────
function phaseToneClass(status: string): string {
  switch (status) {
    case 'generated': return 'mg-div-detail__pill--warning'
    case 'in_progress': return 'mg-div-detail__pill--success'
    case 'completed': return 'mg-div-detail__pill--primary'
    case 'locked': return 'mg-div-detail__pill--danger'
    case 'pending':
    default: return 'mg-div-detail__pill--neutral'
  }
}
function phaseLabel(status: string): string {
  switch (status) {
    case 'generated': return 'Generated'
    case 'in_progress': return 'In progress'
    case 'completed': return 'Completed'
    case 'locked': return 'Locked'
    case 'pending':
    default: return 'Pending'
  }
}

const canManageDivisions = computed(() => canMatchGeniWrite('manage_divisions'))

// ── Workflow action ──────────────────────────────────────────────
const workflowAction = computed<{ label: string; action: DivisionDetailAction } | null>(() => {
  const div = props.division
  if (!div || !canManageDivisions.value) return null
  switch (div.poolStatus) {
    case 'pending': return { label: 'Generate Pool Play', action: 'generate-pool' }
    // Regenerate is only offered while the pool is generated but NOT yet
    // in progress; once games start it's gone for good.
    case 'generated': return { label: 'Regenerate Pool Play', action: 'regenerate-pool' }
    case 'in_progress': return null
  }
  if (div.seedStatus === 'pending') return { label: 'Generate Seed', action: 'generate-seed' }
  if (div.bracketsStatus === 'pending') return { label: 'Initiate Bracket', action: 'initiate-bracket' }
  if (div.bracketsStatus === 'generated') return { label: 'Undo Initiate', action: 'undo-initiate' }
  return null
})

function onAction(action: DivisionDetailAction) {
  if (props.division) emit('action', action, props.division)
}

// ── Lifebook menu ────────────────────────────────────────────────
const lifebookName = ref<string | null>(null)
const lifebookAttached = computed(() => !!lifebookName.value)
const lifebookCount = computed(() => (lifebookAttached.value ? 1 : 0))
const lifebookMenuOpen = ref(false)

function resetLifebook(division: EventTournament | null) {
  const n = Number(division?.id ?? 0)
  lifebookName.value = division && Number.isFinite(n) && n % 2 === 0
    ? 'WIF Lifebook 2026'
    : null
}
function toggleLifebookMenu() {
  lifebookMenuOpen.value = !lifebookMenuOpen.value
}
function closeLifebookMenu() {
  lifebookMenuOpen.value = false
}
function onLifebook(action: DivisionDetailAction) {
  closeLifebookMenu()
  if (action === 'attach-lifebook') lifebookName.value = 'WIF Lifebook 2026'
  else if (action === 'replace-lifebook') lifebookName.value = 'WIF Lifebook 2027'
  else if (action === 'detach-lifebook') lifebookName.value = null
  if (props.division) emit('action', action, props.division)
}
function onDocumentMouseDown(event: MouseEvent) {
  // Class-based (not a single ref) so the lifebook menu works from both
  // the hero and the condensed sticky bar, which share its open state.
  const target = event.target as HTMLElement | null
  if (lifebookMenuOpen.value && (!target || !target.closest('.mg-div-detail__menu-root'))) {
    closeLifebookMenu()
  }
  if (gameMenuOpenId.value && (!target || !target.closest('.mg-div-detail__tl-menu-root'))) {
    closeGameMenu()
  }
}
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  if (lifebookMenuOpen.value) {
    event.stopPropagation()
    closeLifebookMenu()
  }
  if (gameMenuOpenId.value) {
    event.stopPropagation()
    closeGameMenu()
  }
}

// ── Standings (team pools) ───────────────────────────────────────
const standings = ref<DivisionStandingEntry[]>([])
const isSeedGenerated = ref(false)
const standingsLoading = ref(false)
let loadToken = 0

// Fallback chunk size when a standings payload carries no pool info.
const POOL_SIZE = 4
// Team-pool paging: a page shows up to this many columns side-by-side
// (collapsing to 1 on narrow screens via CSS). How many teams fit in a
// column is computed from the available height (see `rowsPerColumn`),
// not a fixed number — so taller screens show more per column before
// spilling to column 2 / the next page.
const COLUMNS_PER_PAGE = 2
const rowsPerColumn = ref(5)

// Games column phase tab — pool-play timeline vs bracket-play cards.
const activeGamesTab = ref<'pool' | 'bracket'>('pool')

// Team-pools search — filters the team rows (by name) across all pools;
// empty pools drop out and the pager re-counts. Reset on division switch.
const teamSearch = ref('')

interface TeamPool { id: string; name: string; teams: DivisionStandingEntry[] }
// All pools, shown stacked (no tab switching). Group by the standings'
// `poolName`/`poolId` when present (real data); otherwise fall back to
// chunking the flat list into `POOL_SIZE` groups (mock / legacy).
const pools = computed<TeamPool[]>(() => {
  const q = teamSearch.value.trim().toLowerCase()
  const list = q
    ? standings.value.filter((t) => t.teamName.toLowerCase().includes(q))
    : standings.value
  const hasPoolInfo = list.some((t) => t.poolName || t.poolId)
  if (hasPoolInfo) {
    const order: string[] = []
    const byKey = new Map<string, TeamPool>()
    for (const t of list) {
      const key = t.poolId ?? t.poolName ?? 'Pool'
      if (!byKey.has(key)) {
        byKey.set(key, { id: key, name: t.poolName ?? key, teams: [] })
        order.push(key)
      }
      byKey.get(key)!.teams.push(t)
    }
    return order.map((k) => byKey.get(k)!)
  }
  const groups: TeamPool[] = []
  for (let i = 0; i < list.length; i += POOL_SIZE) {
    const n = groups.length + 1
    groups.push({ id: `p${n}`, name: `Pool ${n}`, teams: list.slice(i, i + POOL_SIZE) })
  }
  return groups
})
// Flatten every pool into height-fitted columns (≤ `rowsPerColumn`
// teams); columns never span two pools, so each carries its identity.
interface PoolColumn { poolId: string; poolName: string; poolTeamCount: number; teams: DivisionStandingEntry[] }
const poolColumns = computed<PoolColumn[]>(() => {
  const size = Math.max(1, rowsPerColumn.value)
  const cols: PoolColumn[] = []
  for (const pool of pools.value) {
    if (pool.teams.length === 0) continue
    for (let i = 0; i < pool.teams.length; i += size) {
      cols.push({
        poolId: pool.id,
        poolName: pool.name,
        poolTeamCount: pool.teams.length,
        teams: pool.teams.slice(i, i + size)
      })
    }
  }
  return cols
})
const teamPage = ref(0)
const teamPageCount = computed(() =>
  Math.max(1, Math.ceil(poolColumns.value.length / COLUMNS_PER_PAGE))
)
const visibleTeamColumns = computed<PoolColumn[]>(() => {
  const cols = poolColumns.value
  // Clamp the window so the final page never shows a lone column — when
  // the total is odd, the last page shifts back one so the second-to-last
  // column stays visible on the left beside the last.
  const maxStart = Math.max(0, cols.length - COLUMNS_PER_PAGE)
  const start = Math.min(teamPage.value * COLUMNS_PER_PAGE, maxStart)
  return cols.slice(start, start + COLUMNS_PER_PAGE)
})
function teamPagePrev() { if (teamPage.value > 0) teamPage.value-- }
function teamPageNext() { if (teamPage.value < teamPageCount.value - 1) teamPage.value++ }
// Clamp the page if the column count shrinks (division switch / reload).
watch(teamPageCount, (n) => { if (teamPage.value > n - 1) teamPage.value = 0 })

// ── Height-fit: how many team rows fit in one column ─────────────
// The pools column is full-height; measure the columns region + a row's
// rendered height and fit as many rows as possible before spilling to
// column 2 / the next page. Re-measured on resize. On the stacked
// narrow layout (no fixed height) we fall back to a sensible default.
const colsRegionRef = ref<HTMLElement | null>(null)
const MOBILE_ROWS_DEFAULT = 6
let colsResizeObserver: ResizeObserver | null = null
function recomputeRowsPerColumn() {
  const region = colsRegionRef.value
  if (!region) return
  // Stacked layout (≤1080, incl. mobile) — column height is
  // content-driven, so a measured fit would be circular; use a fixed
  // default. Keeps the paged columns + the prev/next pager on mobile.
  if (typeof window !== 'undefined' && window.innerWidth <= 1080) {
    rowsPerColumn.value = MOBILE_ROWS_DEFAULT
    return
  }
  // `clientHeight` includes the region's own vertical padding, which is
  // NOT usable for rows — subtract it so we don't overestimate the fit
  // (the overestimate was clipping the final row of tall columns).
  const cs = typeof window !== 'undefined' ? window.getComputedStyle(region) : null
  const padY = cs ? parseFloat(cs.paddingTop || '0') + parseFloat(cs.paddingBottom || '0') : 0
  const regionH = region.clientHeight - padY
  if (regionH <= 0) return
  // Subtract the per-column pool heading + the Seed/Win/Loss header —
  // both are present on every column, so the row area (and the fitted
  // count) stays identical on every page.
  const labelEl = region.querySelector<HTMLElement>('.mg-div-detail__pool-label')
  const headerEl = region.querySelector<HTMLElement>('.division-standings__header')
  const rowEl = region.querySelector<HTMLElement>('.division-standings__row')
  const labelH = labelEl ? labelEl.getBoundingClientRect().height : 28
  const headerH = headerEl ? headerEl.getBoundingClientRect().height : 28
  const rowH = rowEl ? rowEl.getBoundingClientRect().height : 52
  if (rowH <= 0) return
  // 2px safety margin so sub-pixel rounding never leaves a partial row
  // peeking at the bottom — better to push it to the next column.
  rowsPerColumn.value = Math.max(3, Math.floor((regionH - labelH - headerH - 2) / rowH))
}
watch(colsRegionRef, (el) => {
  colsResizeObserver?.disconnect()
  if (el && colsResizeObserver) colsResizeObserver.observe(el)
  void nextTick(recomputeRowsPerColumn)
})
watch(standings, () => void nextTick(recomputeRowsPerColumn))

const showPoolsBar = computed(() =>
  // Show whenever the division has teams — keyed off the UNFILTERED
  // standings so the bar (and its search box) stays visible even when a
  // search filters every team out. The Manage button + pager are
  // conditional within.
  !standingsLoading.value && standings.value.length > 0
)

const FALLBACK_SEED_CRITERIA = 'Win %, head-to-head, run differential'
const seedCriteriaText = ref(FALLBACK_SEED_CRITERIA)

const MOCK_POOL_GAMES = 3
const MOCK_BRACKET_FORMAT = 'Single Elimination'
const MOCK_BRACKET_NAMES = ['Gold', 'Silver', 'Bronze', 'Platinum', 'Open']
const poolPlayText = computed(() => `${MOCK_POOL_GAMES} game round robin`)

const bracketSeedCount = computed(() =>
  props.division ? Math.max(2, props.division.teamCount - 1) : 0
)

// Dedicated mock fixture: the rain/pool scenario the user specified — 16
// teams across 3 pools (A:6, B:6, C:4) feeding 5 brackets whose statuses
// span the full lifecycle (completed / in_progress / cancelled / initiated
// / pending). The cancelled bracket's teams fall back to their pool for a
// manual announce. Detected by its distinctive shape (no generic mock
// division is 16 teams / 5 brackets). Drives both the pool split
// (`buildMockStandings`) and the bracket→pool team mapping (`bracketCards`)
// so the announce "claimed" set lines up.
const isPoolBracketFixture = computed(() =>
  !!props.division && props.division.teamCount === 16 && props.division.bracketsCount === 5
)

// ── Bracket cancellations (mock, session-persistent) ─────────────
// A cancelled bracket can't produce winners → its teams are announced via
// their pool. Hydrated from the mock store on division load; updated after
// a Cancel action so `bracketCards` re-derive (status → 'cancelled').
const bracketCancels = ref<Record<string, BracketCancellation>>({})

/** Map the division-level bracket phase onto the per-bracket lifecycle
 *  enum (mock fallback when a division has no explicit per-bracket list). */
function mapDivBracketStatus(s: EventTournamentBracketStatus): BracketStatus {
  return s === 'generated' ? 'initiated' : s
}
/** Effective status for bracket index `i`: a live cancellation wins;
 *  otherwise the division's explicit per-bracket status, else the mapped
 *  division phase. */
function bracketStatusAt(div: EventTournament, i: number, id: string): BracketStatus {
  if (bracketCancels.value[id]) return 'cancelled'
  return div.bracketStatuses?.[i] ?? mapDivBracketStatus(div.bracketsStatus)
}

// ── Division games (timeline) ────────────────────────────────────
const GAME_CITY_TEAMS = ['Dallas Hawks', 'Austin Bandits', 'Phoenix Storm', 'Denver Rangers', 'Tampa Aces', 'Reno Lions', 'Mesa Bulls', 'Boise Owls']
const GAME_DATES = ['2026-05-12', '2026-05-13', '2026-05-14']
const GAME_TIMES = ['09:00 AM', '10:30 AM', '12:00 PM', '01:30 PM', '03:00 PM']
const GAME_FIELDS = ['Field 1', 'Field 2', 'Field 3', 'Field 4']
const GAME_PARKS = ['Memorial Park', 'Riverside Complex', 'Eastside Fields']
const GAME_STATUSES: NonNullable<SchedulerGame['status']>[] = ['final', 'final', 'live', 'delayed', 'scheduled', 'scheduled']

const divisionGames = computed<SchedulerGame[]>(() => {
  const div = props.division
  if (!div) return []
  const teamCount = Math.max(div.teamCount, 2)
  const teams = Array.from({ length: teamCount }, (_, i) => `#${i + 1} ${GAME_CITY_TEAMS[i % GAME_CITY_TEAMS.length]}`)
  const total = Math.max(3, Math.ceil((teamCount * MOCK_POOL_GAMES) / 2))
  const games: SchedulerGame[] = []
  for (let g = 0; g < total; g++) {
    const t1 = g % teamCount
    let t2 = (t1 + 1 + (g % Math.max(1, teamCount - 1))) % teamCount
    if (t2 === t1) t2 = (t1 + 1) % teamCount
    const status = GAME_STATUSES[g % GAME_STATUSES.length]
    const scored = status === 'final' || status === 'live'
    games.push({
      id: `dg_${div.id}_${g}`,
      divisionId: div.id,
      parkId: null,
      type: 'pool',
      label: `Pool ${g + 1}`,
      team1Label: teams[t1],
      team2Label: teams[t2],
      scheduledDate: GAME_DATES[g % GAME_DATES.length],
      scheduledTime: GAME_TIMES[g % GAME_TIMES.length],
      scheduledFieldLabel: GAME_FIELDS[g % GAME_FIELDS.length],
      status,
      durationMinutes: 90,
      team1Score: scored ? 3 + ((g * 2) % 5) : undefined,
      team2Score: scored ? 1 + ((g * 3) % 4) : undefined
    })
  }
  games.push({
    id: `dg_${div.id}_uns`,
    divisionId: div.id,
    parkId: null,
    type: 'bracket',
    label: 'Final',
    team1Label: 'Winner Semi A',
    team2Label: 'Winner Semi B',
    scheduledDate: null,
    scheduledTime: null,
    scheduledFieldLabel: null,
    status: 'scheduled'
  })
  // Apply in-session edits (Edit Matchup) + deletions made via the card's
  // options menu, so they persist on top of the regenerated mock list.
  return games
    .filter((g) => !deletedGameIds.value.has(g.id))
    .map((g) => (gameOverrides.value[g.id] ? { ...g, ...gameOverrides.value[g.id] } : g))
})

// In-session game edits/deletes (mock — overlaid on the generated list above).
const gameOverrides = ref<Record<string, Partial<SchedulerGame>>>({})
const deletedGameIds = ref<Set<string>>(new Set())

// Pool-play games only — the timeline section shows the round-robin
// pool schedule; bracket games are surfaced as bracket cards below it.
const poolGames = computed<SchedulerGame[]>(() =>
  divisionGames.value.filter((g) => g.type === 'pool')
)

// Bracket cards — rendered below the pool-play timeline once pool play
// ends. One card per bracket: name, format, and the seeded teams that
// feed it. Seed→team mapping reuses the standings/teams mock so the
// names line up with the pool-play teams.
interface BracketCard {
  id: string
  name: string
  format: string
  status: BracketStatus
  cancellation?: BracketCancellation
  teams: string[]
}
const bracketCards = computed<BracketCard[]>(() => {
  const div = props.division
  if (!div || div.bracketsCount <= 0) return []
  const count = div.bracketsCount
  const poolList = pools.value
  // Real pool teams, by pool name → so a bracket's teams are the SAME
  // strings as the pool entries. The announce flow derives "claimed"
  // (bracketed) teams by name; if bracket names were synthetic they'd
  // never intersect the pools and every pool would wrongly become its
  // own result unit.
  const poolTeams = (name: string): string[] =>
    poolList.find((p) => p.name === name)?.teams.map((t) => t.teamName) ?? []
  const mk = (i: number, name: string, teams: string[]): BracketCard => {
    const id = `bk_${div.id}_${i}`
    return {
      id,
      name: `${name} Bracket`,
      format: MOCK_BRACKET_FORMAT,
      status: bracketStatusAt(div, i, id),
      cancellation: bracketCancels.value[id],
      teams
    }
  }

  // (b) The 16-team / 3-pool / 5-bracket fixture: pools A(6) / B(6) / C(4).
  //   Gold     = Pool A #1-4   (completed → auto podium)
  //   Silver   = Pool A #5-6 + Pool B #1-2  (in_progress → read-only + Cancel)
  //   Bronze   = Pool B #3-6   (cancelled → its teams fall back to Pool B)
  //   Platinum = Pool C #1-2   (initiated)
  //   Open     = Pool C #3-4   (pending)
  // Statuses come from `div.bracketStatuses` (set by the view fixture);
  // a live cancellation overrides to 'cancelled' (see `bracketStatusAt`).
  if (isPoolBracketFixture.value) {
    const a = poolTeams('Pool A')
    const b = poolTeams('Pool B')
    const c = poolTeams('Pool C')
    return [
      mk(0, MOCK_BRACKET_NAMES[0], a.slice(0, 4)),
      mk(1, MOCK_BRACKET_NAMES[1], [...a.slice(4, 6), ...b.slice(0, 2)]),
      mk(2, MOCK_BRACKET_NAMES[2], b.slice(2, 6)),
      mk(3, MOCK_BRACKET_NAMES[3], c.slice(0, 2)),
      mk(4, MOCK_BRACKET_NAMES[4], c.slice(2, 4))
    ]
  }

  // (a) Generic: distribute the division's actual pool teams across its
  // brackets (every team bracketed → no leftover pool units, the common
  // "auto winners from completed brackets" case). Falls back to synthetic
  // names only before standings/pools have loaded.
  const flat = poolList.flatMap((p) => p.teams.map((t) => t.teamName))
  const source = flat.length > 0
    ? flat
    : Array.from({ length: bracketSeedCount.value }, (_, s) => `#${s + 1} ${GAME_CITY_TEAMS[s % GAME_CITY_TEAMS.length]}`)
  const perBracket = Math.max(1, Math.ceil(source.length / count))
  const cards: BracketCard[] = []
  let start = 0
  for (let i = 0; i < count; i++) {
    const end = Math.min(source.length, start + perBracket)
    const name = MOCK_BRACKET_NAMES[i] ?? `Bracket ${i + 1}`
    cards.push(mk(i, name, source.slice(start, end)))
    start = end
  }
  return cards
})

// ── Bracket canvas stage ─────────────────────────────────────────
// Clicking a bracket card opens the reusable `MatchGeniBracket`
// (zoom/pan canvas) full-width in place of the two columns, with a
// switch to move between the division's brackets and a close that
// returns to the card list. Bracket models are mock (by division id
// then name) until the bracket API ships; a deterministic format pick
// is the fallback for an unknown (live-resources) division.
const openBracketIndex = ref<number | null>(null)
const mockBracketModels = computed<BracketModel[]>(() => {
  const div = props.division
  if (!div) return []
  return getMockBracketsForDivision({ id: div.id, name: div.tournamentName })
})
function bracketModelForIndex(index: number): BracketModel {
  const list = mockBracketModels.value
  if (list.length > 0) return list[index] ?? list[0]
  const types: BracketModel['type'][] = ['single', 'double', '3gg']
  const seed = String(props.division?.id ?? '')
    .split('')
    .reduce((sum, ch) => sum + ch.charCodeAt(0), 0)
  const base = getMockBracket(types[(seed + index) % types.length])
  return { ...base, name: bracketCards.value[index]?.name ?? base.name }
}
const stageBracket = computed<BracketModel | null>(() =>
  (openBracketIndex.value === null || bracketCards.value.length === 0)
    ? null
    : bracketModelForIndex(openBracketIndex.value)
)
function openBracket(index: number) {
  openBracketIndex.value = index
}
/** The bracket card currently framed on the canvas — feeds the status pill
 *  shown under the stats line. */
const activeBracketCard = computed<BracketCard | null>(() =>
  openBracketIndex.value === null ? null : bracketCards.value[openBracketIndex.value] ?? null
)

// ── Bracket rail (shared MatchGeniBracketRail) ───────────────────
// Adapt the mock bracket cards to the rail's item shape (teams as
// objects so the avatar stack reads them); open / see-all / add map back
// to the existing handlers by bracket id.
const railBrackets = computed<BracketRailItem[]>(() =>
  bracketCards.value.map((b) => ({
    id: b.id,
    name: b.name,
    format: b.format,
    status: b.status,
    teamCount: b.teams.length,
    teams: b.teams.map((teamName) => ({ teamName }))
  }))
)
function onRailOpen(id: string) {
  const i = bracketCards.value.findIndex((b) => b.id === id)
  if (i >= 0) openBracket(i)
}
function onRailSeeAll(id: string) {
  const card = bracketCards.value.find((b) => b.id === id)
  if (card) openSeeAllTeams(card)
}

// ── See-all teams modal ──────────────────────────────────────────
const seeAllBracket = ref<BracketCard | null>(null)
const seeAllSearch = ref('')
/** Local (client-side) filter of the bracket's teams by the search box. */
const seeAllFilteredTeams = computed(() => {
  const teams = seeAllBracket.value?.teams ?? []
  const q = seeAllSearch.value.trim().toLowerCase()
  return q ? teams.filter((t) => t.toLowerCase().includes(q)) : teams
})
function openSeeAllTeams(bracket: BracketCard) {
  seeAllSearch.value = ''
  seeAllBracket.value = bracket
}
function closeSeeAllTeams() {
  seeAllBracket.value = null
}
// Lock the page scroll while the See-all modal is open.
watch(seeAllBracket, (open) => {
  if (open) lockBodyScroll()
  else unlockBodyScroll()
})
function onSeeAllBackdrop(event: MouseEvent) {
  if (event.target === event.currentTarget) closeSeeAllTeams()
}

function closeBracket() {
  openBracketIndex.value = null
}
// Tell the host page when the canvas stage opens/closes so it can
// hide the division sidebar + go edge-to-edge (full-screen).
watch(openBracketIndex, (v) => emit('bracket-open', v !== null))

// ── Add / Edit Bracket modal ─────────────────────────────────────
// Same `MatchGeniBracketFormModal` the game scheduler uses.
// `bracketFormEditId` null → New Bracket; non-null → Edit that bracket.
const bracketFormOpen = ref(false)
const bracketFormEditId = ref<string | null>(null)
const bracketFormName = ref('')
// Whether the bracket being edited can be cancelled (initiated/in_progress)
// — drives the "Cancel bracket" action inside the edit popup.
const bracketFormCancellable = ref(false)
// Placeholder roster for the modal's custom-team picker (no per-division
// roster endpoint yet) — same shape the scheduler passes.
const bracketTeamOptions = computed<string[]>(() => {
  const count = props.division?.teamCount ?? 0
  return Array.from({ length: count }, (_, i) => `Team ${i + 1}`)
})
function openAddBracket() {
  bracketFormEditId.value = null
  bracketFormName.value = ''
  bracketFormOpen.value = true
}
function openEditBracket(index: number) {
  const card = bracketCards.value[index]
  // Use the REAL bracket id so the modal's Cancel-bracket action targets
  // the right unit (was a synthetic 1-based string).
  bracketFormEditId.value = card?.id ?? String(index + 1)
  bracketFormName.value = card?.name ?? ''
  bracketFormCancellable.value = !!card && (card.status === 'initiated' || card.status === 'in_progress')
  bracketFormOpen.value = true
}
/** Edit popup asked to cancel the bracket → close it, open the shared
 *  Cancel-bracket reason form for that bracket. */
function onBracketFormCancelBracket(bracketId: string) {
  bracketFormOpen.value = false
  requestCancelBracket(bracketId)
}
function onBracketFormSaved() {
  // TODO — refetch the division's brackets once the create/update
  // endpoint ships so the cards reflect the change.
  bracketFormOpen.value = false
}
function onBracketFormDeleted() {
  bracketFormOpen.value = false
}

interface GameDateGroup { key: string; label: string; games: SchedulerGame[] }
const gameGroups = computed<GameDateGroup[]>(() => {
  const byDate = new Map<string, GameDateGroup>()
  const unscheduled: SchedulerGame[] = []
  for (const game of poolGames.value) {
    if (!game.scheduledDate) { unscheduled.push(game); continue }
    if (!byDate.has(game.scheduledDate)) {
      byDate.set(game.scheduledDate, { key: game.scheduledDate, label: formatGameDate(game.scheduledDate), games: [] })
    }
    byDate.get(game.scheduledDate)!.games.push(game)
  }
  const dated = Array.from(byDate.values()).sort((a, b) => a.key.localeCompare(b.key))
  if (unscheduled.length === 0) return dated
  return [...dated, { key: 'unscheduled', label: 'Unscheduled', games: unscheduled }]
})
function formatGameDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}
// Standings meta line — gender/age + rating (source dash dropped) with
// the location appended after a dash, on one line:
// "Men's 50+ AA - Dallas, TX". One line keeps each row compact.
function teamMetaLocation(entry: DivisionStandingEntry): string {
  const meta = (entry.teamMeta ?? '').replace(/\s*-\s*/g, ' ').trim()
  const loc = (entry.location ?? '').trim()
  return meta && loc ? `${meta} - ${loc}` : (meta || loc)
}
function gameHasScore(game: SchedulerGame): boolean {
  return game.team1Score != null && game.team2Score != null
}
function gameTimeMain(game: SchedulerGame): string {
  return game.scheduledTime ?? 'TBD'
}
function gameTimeSub(game: SchedulerGame): string {
  switch (game.status) {
    case 'live': return 'Live'
    case 'final': return 'Final'
    case 'delayed': return 'Delayed'
    default: return game.scheduledDate ? 'Scheduled' : ''
  }
}
function gameSlotTone(game: SchedulerGame): string {
  if (!game.scheduledDate) return 'muted'
  switch (game.status) {
    case 'live': return 'live'
    case 'final': return 'final'
    case 'delayed': return 'warning'
    default: return ''
  }
}
function gameDotTone(game: SchedulerGame): string {
  switch (game.status) {
    case 'live': return 'live'
    case 'final': return 'final'
    case 'delayed': return 'warning'
    default: return 'pending'
  }
}

// ── Game card meta (participation-v2 schedule-card style) ─────────
function gameIsStarted(game: SchedulerGame): boolean {
  return game.status === 'final' || game.status === 'live' || game.status === 'delayed'
}
/** Start line — "Started 9:00 AM" once underway, else the scheduled
 *  time; empty for an unscheduled game. */
function gameStartLabel(game: SchedulerGame): string {
  if (!game.scheduledTime) return ''
  return gameIsStarted(game) ? `Started ${game.scheduledTime}` : game.scheduledTime
}
/** Time-limit subline — "90 min limit". */
function gameTimeLimitLabel(game: SchedulerGame): string {
  return game.durationMinutes ? `${game.durationMinutes} min limit` : ''
}
/** Mock park name (no park field on the game yet) — derived from the id. */
function gameParkLabel(game: SchedulerGame): string {
  const n = game.id.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0)
  return GAME_PARKS[n % GAME_PARKS.length]
}

// Per-card actions menu (Edit Game / Mark Not Needed).
const gameMenuOpenId = ref<string | null>(null)
function toggleGameMenu(id: string) {
  gameMenuOpenId.value = gameMenuOpenId.value === id ? null : id
}
function closeGameMenu() {
  gameMenuOpenId.value = null
}
function buildMockStandings(division: EventTournament): DivisionStandingEntry[] {
  const cities = [
    ['Dallas', 'TX'], ['Austin', 'TX'], ['Phoenix', 'AZ'], ['Denver', 'CO'],
    ['Tampa', 'FL'], ['Reno', 'NV'], ['Mesa', 'AZ'], ['Boise', 'ID']
  ]
  const count = Math.max(division.teamCount, 0)
  const seeded = division.seedStatus !== 'pending'
  // Mock pool assignment (stands in for `tournament_teams.pool_id`).
  // The 16-team fixture (b) → three pools A:6 / B:6 / C:4 feeding the five
  // mixed-status brackets. Big demo division (51 teams) → Pool A 21 + Pool
  // B 30 to exercise large multi-column paging; smaller divisions → first
  // 10 Pool A, overflow Pool B.
  const fixture = isPoolBracketFixture.value
  const POOL_A_MAX = count >= 50 ? 21 : 10
  function poolFor(i: number): { poolId: string; poolName: string } {
    if (fixture) {
      if (i < 6) return { poolId: 'pool_a', poolName: 'Pool A' }
      if (i < 12) return { poolId: 'pool_b', poolName: 'Pool B' }
      return { poolId: 'pool_c', poolName: 'Pool C' }
    }
    return i < POOL_A_MAX
      ? { poolId: 'pool_a', poolName: 'Pool A' }
      : { poolId: 'pool_b', poolName: 'Pool B' }
  }
  return Array.from({ length: count }, (_, i) => {
    const [city, state] = cities[i % cities.length]
    const pool = poolFor(i)
    return {
      seed: seeded ? i + 1 : 0,
      wins: (i * 3 + 2) % 6,
      losses: (i * 2 + 1) % 5,
      teamName: `#${i + 1}: ${city} ${['Hawks', 'Bandits', 'Storm', 'Rangers', 'Aces', 'Lions'][i % 6]}`,
      teamMeta: "Men's 50+ - AA",
      location: `${city}, ${state}`,
      imageUrl: undefined,
      poolId: pool.poolId,
      poolName: pool.poolName
    }
  })
}

async function loadStandings(division: EventTournament | null) {
  if (!division) {
    standings.value = []
    isSeedGenerated.value = false
    return
  }
  const myToken = ++loadToken
  standingsLoading.value = true
  standings.value = []
  teamPage.value = 0
  teamSearch.value = ''
  isSeedGenerated.value = division.seedStatus !== 'pending'
  seedCriteriaText.value = FALLBACK_SEED_CRITERIA
  try {
    const overview = await fetchDivisionOverviewStandings(division.guid)
    if (myToken !== loadToken) return
    if (overview.tieBreakerText.trim()) seedCriteriaText.value = overview.tieBreakerText.trim()
    if (overview.standings.length > 0) {
      standings.value = overview.standings
      isSeedGenerated.value = overview.isSeedGenerated ?? isSeedGenerated.value
    } else {
      standings.value = buildMockStandings(division)
    }
  } catch {
    if (myToken !== loadToken) return
    standings.value = buildMockStandings(division)
  } finally {
    if (myToken === loadToken) standingsLoading.value = false
  }
}

// ── Winners / final standings ────────────────────────────────────
// Once a division is complete, the left overview card swaps the
// progress bar for a Winners panel (placements grouped by bracket).
// A division is "complete" when its brackets are done, or — for a
// pool-only division (no brackets) — when pool play is done.
const divisionComplete = computed(() => {
  const d = props.division
  if (!d) return false
  return d.bracketsCount > 0 ? d.bracketsStatus === 'completed' : d.poolStatus === 'completed'
})
const divisionStandings = ref<DivisionStandings | null>(null)
let winnersToken = 0

// Team display info by name (avatar + gender/age/rating + location) so the
// announce podium can show rich rows. Sourced from the pool standings,
// which carry `teamMeta` / `location` / `imageUrl`.
const teamInfoByName = computed(() => {
  const m = new Map<string, DivisionStandingEntry>()
  standings.value.forEach((t) => m.set(t.teamName, t))
  return m
})
function toStandingsTeam(name: string): StandingsTeam {
  const e = teamInfoByName.value.get(name)
  return { teamName: name, imageUrl: e?.imageUrl, teamMeta: e?.teamMeta, location: e?.location }
}

// Announce-result group sources — the brackets and the team pools the
// admin can pick winners from (each becomes a podium group).
const bracketSources = computed<StandingsGroupSource[]>(() =>
  bracketCards.value.map((b) => ({
    id: b.id,
    name: b.name,
    status: b.status,
    cancellation: b.cancellation,
    teams: b.teams.map<StandingsTeam>(toStandingsTeam)
  }))
)
const poolSources = computed<StandingsGroupSource[]>(() =>
  pools.value.map((p) => ({
    id: p.id,
    name: p.name,
    teams: p.teams.map<StandingsTeam>((t) => ({
      teamName: t.teamName,
      imageUrl: t.imageUrl,
      teamMeta: t.teamMeta,
      location: t.location
    }))
  }))
)

/** Context for the standings mock: brackets + pools (with their teams) +
 *  completion. The real GET reads the table and needs none of this; the
 *  mock uses it to derive auto winners. */
function buildStandingsCtx(): DivisionStandingsContext {
  return {
    complete: divisionComplete.value,
    brackets: bracketSources.value,
    pools: poolSources.value
  }
}
async function loadWinners(division: EventTournament | null) {
  if (!division) {
    divisionStandings.value = null
    return
  }
  const token = ++winnersToken
  try {
    const result = await fetchDivisionStandings('', '', division.id, buildStandingsCtx())
    if (token === winnersToken) divisionStandings.value = result
  } catch {
    if (token === winnersToken) divisionStandings.value = null
  }
}
// Pools load asynchronously (via `standings`), so the first `loadWinners`
// in the division watch runs before `poolSources` is populated — that
// would yield bracket units only. Re-derive the winners/units once the
// pools resolve so pool units (their non-bracket teams) appear. The mock
// store persists manual announces across the reload.
watch(pools, () => {
  if (props.division) void loadWinners(props.division)
})
const winnerUnits = computed<StandingUnit[]>(() => divisionStandings.value?.units ?? [])
// Winners panel renders ONLY units that actually have placements — so
// it never flashes an empty "announce" row before data resolves.
const winnerGroupsWithPlacements = computed(() => winnerUnits.value.filter((u) => u.placements.length > 0))
const hasWinners = computed(() => winnerGroupsWithPlacements.value.length > 0)
/** Eligible teams per unit, keyed `${kind}:${refId}`. A pool's eligible
 *  teams are those NOT claimed by a non-cancelled bracket (leftover +
 *  cancelled-bracket teams) — mirrors `buildUnits` so the modal's pickers
 *  match the rendered units. Bracket entries are kept for completeness
 *  (brackets are read-only, so unused in the modal). */
const eligibleTeamsMap = computed<Record<string, StandingsTeam[]>>(() => {
  const map: Record<string, StandingsTeam[]> = {}
  const claimed = new Set<string>()
  bracketSources.value.forEach((b) => {
    if (b.status !== 'cancelled') b.teams.forEach((t) => claimed.add(t.teamName))
  })
  bracketSources.value.forEach((b) => { map[`bracket:${b.id}`] = b.teams })
  poolSources.value.forEach((p) => {
    map[`pool:${p.id}`] = p.teams.filter((t) => !claimed.has(t.teamName))
  })
  return map
})

// ── Winners carousel (only when >1 bracket has winners) ──────────
// Multiple bracket groups page horizontally one-at-a-time, mirroring
// the brackets rail's parks-carousel behaviour + nav arrows.
const winnersRailRef = ref<HTMLElement | null>(null)
const winnersRailCanPrev = ref(false)
const winnersRailCanNext = ref(false)
function updateWinnersRailArrows() {
  const el = winnersRailRef.value
  if (!el) {
    winnersRailCanPrev.value = false
    winnersRailCanNext.value = false
    return
  }
  winnersRailCanPrev.value = el.scrollLeft > 2
  winnersRailCanNext.value = el.scrollLeft < el.scrollWidth - el.clientWidth - 2
}
function stepWinnersRail(dir: -1 | 1) {
  const el = winnersRailRef.value
  if (!el) return
  const slot = el.querySelector<HTMLElement>('.mg-div-detail__winners-group')
  const step = slot ? slot.offsetWidth + 16 : el.clientWidth
  el.scrollBy({ left: dir * step, behavior: 'smooth' })
}
// Reset to the first group + recompute arrows when the winner set changes.
watch(winnerGroupsWithPlacements, () => void nextTick(() => {
  if (winnersRailRef.value) winnersRailRef.value.scrollLeft = 0
  updateWinnersRailArrows()
}), { immediate: true })

// ── Announce result ──────────────────────────────────────────────
// The admin announces a division's result once pool play is done. The
// action lives here in the left panel (not on the bracket chips); the
// modal asks for the basis (bracket / pool / none) then the winners.
// Stays available afterwards so a result can be edited / re-announced.
const announceModalOpen = ref(false)
const poolPlayCompleted = computed(() => props.division?.poolStatus === 'completed')
const canAnnounceResult = computed(() => canManageDivisions.value && poolPlayCompleted.value)
/** True once every result unit is declared no-result (and there's at
 *  least one) — i.e. the whole division was announced with no winners. */
const noResultAnnounced = computed(() => {
  const units = divisionStandings.value?.units ?? []
  return units.length > 0 && units.every((u) => u.status === 'no_result')
})
function openAnnounceResult() {
  announceModalOpen.value = true
}
function closeAnnounceResult() {
  announceModalOpen.value = false
}
/** Per-unit, incremental — the modal stays open so the admin can finalise
 *  the other units (brackets / pools) one at a time. */
async function onAnnounceUnit(payload: SetUnitStandingsPayload) {
  const d = props.division
  if (!d) return
  divisionStandings.value = await setUnitStandings('', '', d.id, payload, buildStandingsCtx())
}

// ── Cancel bracket ───────────────────────────────────────────────
// A bracket that can't finish (rain/other) is cancelled with a tracked
// reason; its teams then announce via their pool. Triggered from BOTH the
// Announce modal (per-bracket unit) and the bracket canvas (active pill).
const cancelTargetId = ref<string | null>(null)
const cancelTargetCard = computed(() =>
  bracketCards.value.find((b) => b.id === cancelTargetId.value) ?? null
)
function requestCancelBracket(bracketId: string) {
  cancelTargetId.value = bracketId
}
function closeCancelBracket() {
  cancelTargetId.value = null
}
async function onCancelBracketConfirm(reason: CancelBracketReason) {
  const d = props.division
  const id = cancelTargetId.value
  if (!d || !id) return
  await cancelBracket(d.id, id, reason)
  bracketCancels.value = { ...bracketCancellations(d.id) }
  cancelTargetId.value = null
  await loadWinners(d)
}

// ── Game details drawer ──────────────────────────────────────────
// Clicking a pool-play timeline card opens the same right-edge
// ScoringGameDetailsDrawer used on the scheduler field grid.
const gameDrawerOpen = ref(false)
const gameDrawerGame = ref<SchedulerGame | null>(null)
function openGameDrawer(game: SchedulerGame) {
  gameDrawerGame.value = game
  gameDrawerOpen.value = true
}
function onGameDrawerAction(_action: ScoringDrawerAction) {
  // Downstream wiring (start/score/upload/delay) lands with the games
  // API; the drawer manages its own close on most actions.
}

// ── Edit pool game (from the drawer's "Edit game") ───────────────
// Reuses the shared SchedulerCreateGameModal in edit mode. Edits are
// overlaid via `gameOverrides` (same channel as Edit Matchup), so they
// persist on top of the regenerated mock list.
const DEFAULT_TIME_LIMIT_BY_TYPE: Record<SchedulerGame['type'], number> = { pool: 65, bracket: 70 }
const gameEditOpen = ref(false)
const editGame = ref<SchedulerGame | null>(null)

/** Distinct team labels for this division (across all pool games), used as
 *  the searchable team options. Skips bracket placeholders. */
const divisionTeamOptions = computed<string[]>(() => {
  const set = new Set<string>()
  for (const g of divisionGames.value) {
    for (const label of [g.team1Label, g.team2Label]) {
      if (!label) continue
      if (/^(winner|loser)\b/i.test(label)) continue
      set.add(label)
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b))
})

function openEditGameFromDrawer() {
  const g = gameDrawerGame.value
  if (!g || g.type !== 'pool') return
  editGame.value = g
  gameDrawerOpen.value = false
  gameEditOpen.value = true
}

function onGameEditSubmit(p: {
  name: string
  team1Label: string
  team2Label: string
  durationMinutes: number
  timeLimitMinutes: number
}) {
  const g = editGame.value
  if (g) {
    gameOverrides.value = {
      ...gameOverrides.value,
      [g.id]: {
        ...(gameOverrides.value[g.id] ?? {}),
        label: p.name,
        team1Label: p.team1Label,
        team2Label: p.team2Label,
        durationMinutes: p.durationMinutes,
        timeLimitMinutes: p.timeLimitMinutes
      }
    }
  }
  gameEditOpen.value = false
  editGame.value = null
}

watch(
  () => props.division,
  (division) => {
    // Hydrate session cancellations BEFORE loading winners so the first
    // unit derivation already reflects any cancelled brackets.
    bracketCancels.value = division ? bracketCancellations(division.id) : {}
    loadStandings(division)
    loadWinners(division)
    resetLifebook(division)
    activeGamesTab.value = 'pool'
    // If the bracket canvas is open (full-screen) when the division
    // changes — only reachable via the in-canvas division switcher,
    // since the sidebar is hidden in full-screen — KEEP it open and
    // re-frame to the new division's first bracket. If the new division
    // has no brackets, the stage shows a "no bracket yet" placeholder
    // (see the `#empty` slot) rather than closing. No-op when the canvas
    // is already closed (normal navigation stays closed).
    if (openBracketIndex.value !== null) {
      openBracketIndex.value = 0
    }
  },
  { immediate: true }
)

// ── Condensed sticky header on scroll ───────────────────────────
// Mirrors ParticipationV2: the full hero is a normal rounded card that
// scrolls away; once it clears the matchgeni page header a compact
// edge-to-edge bar (`--condensed`) fades in and pins to the top. The
// games' date headers + the sticky stats/pools column pin BELOW that
// bar (fixed `--mg-div-condensed-h` offset in CSS). `heroRef` is the
// scroll sentinel — when its bottom passes above the header, flip on.
const heroRef = ref<HTMLElement | null>(null)
const gamesRef = ref<HTMLElement | null>(null)
const poolsBarRef = ref<HTMLElement | null>(null)
const condensedVisible = ref(false)
// Toggle a `--stuck` class on whichever timeline date header is pinned,
// so the drop shadow shows only while it's stuck (CSS has no :stuck).
// A header is stuck when its top has reached its resolved sticky `top`.
function updateStuckDates() {
  const root = gamesRef.value
  if (!root) return
  const dates = root.querySelectorAll<HTMLElement>('.mg-div-detail__tl-date')
  dates.forEach((el) => {
    const stickyTop = parseFloat(getComputedStyle(el).top) || 0
    const stuck = el.getBoundingClientRect().top <= stickyTop + 1
    el.classList.toggle('mg-div-detail__tl-date--stuck', stuck)
  })
}
function handleScroll() {
  const el = heroRef.value
  if (el) {
    const headerH = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--matchgeni-header-height'),
    ) || 56
    condensedVisible.value = el.getBoundingClientRect().bottom < headerH + 8
  } else {
    condensedVisible.value = false
  }
  // Pin state of the tab bar — drives the extra padding above the
  // buttons (and the date-header offset) while it's stuck. Toggle this
  // BEFORE measuring dates so they read the bumped `--mg-div-tabs-h`.
  const games = gamesRef.value
  if (games) {
    const tabs = games.querySelector<HTMLElement>('.mg-div-detail__games-tabs')
    if (tabs) {
      const tabsTop = parseFloat(getComputedStyle(tabs).top) || 0
      games.classList.toggle(
        'mg-div-detail__games--tabs-stuck',
        tabs.getBoundingClientRect().top <= tabsTop + 1,
      )
    }
  }
  updateStuckDates()
  // Team-pools header drop shadow while it's pinned (mobile only — it's
  // only `position: sticky` there). Same stuck test as the date rows.
  const bar = poolsBarRef.value
  if (bar) {
    const cs = getComputedStyle(bar)
    if (cs.position === 'sticky') {
      const barTop = parseFloat(cs.top) || 0
      bar.classList.toggle(
        'mg-div-detail__pools-bar--stuck',
        bar.getBoundingClientRect().top <= barTop + 1,
      )
    } else {
      bar.classList.remove('mg-div-detail__pools-bar--stuck')
    }
  }
}

function onWindowResize() {
  handleScroll()
  recomputeRowsPerColumn()
}
onMounted(() => {
  document.addEventListener('mousedown', onDocumentMouseDown)
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('scroll', handleScroll, { passive: true })
  window.addEventListener('resize', onWindowResize)
  if (typeof ResizeObserver !== 'undefined') {
    colsResizeObserver = new ResizeObserver(() => recomputeRowsPerColumn())
    if (colsRegionRef.value) colsResizeObserver.observe(colsRegionRef.value)
  }
  void nextTick(() => { handleScroll(); recomputeRowsPerColumn() })
})
watch(() => props.division, () => void nextTick(() => { handleScroll(); recomputeRowsPerColumn() }))
watch(activeGamesTab, () => void nextTick(handleScroll))
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentMouseDown)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('scroll', handleScroll)
  window.removeEventListener('resize', onWindowResize)
  colsResizeObserver?.disconnect()
  // Safety: release the scroll lock if we unmount with a modal open.
  unlockBodyScroll()
})
</script>

<template>
  <div v-if="division" class="mg-div-detail">
    <!-- Condensed sticky bar — hidden until the hero scrolls past the
         page header, then fades in edge-to-edge and pins to the top
         (ParticipationV2 pattern). Name + dates on the left; the same
         Edit Division / Lifebook tool buttons as the hero on the right
         (they share the lifebook menu state). -->
    <div
      class="mg-div-detail__condensed"
      :class="{ 'mg-div-detail__condensed--visible': condensedVisible }"
    >
      <div class="mg-div-detail__condensed-id">
        <h2 class="mg-div-detail__condensed-title">{{ division.tournamentName }}</h2>
        <span v-if="division.dateRangeLabel" class="mg-div-detail__condensed-dates">{{ division.dateRangeLabel }}</span>
      </div>

      <div class="mg-div-detail__condensed-actions">
        <button
          v-if="canManageDivisions"
          type="button"
          class="mg-div-detail__icon-btn"
          aria-label="Edit Division"
          @click="onAction('edit-division')"
        >
          <span class="mg-div-detail__edit-icon" aria-hidden="true"></span>
          <span>Edit Division</span>
        </button>

        <div class="mg-div-detail__menu-root">
          <button
            type="button"
            class="mg-div-detail__icon-btn mg-div-detail__lifebook-btn"
            aria-label="Lifebook"
            :aria-expanded="lifebookMenuOpen ? 'true' : 'false'"
            aria-haspopup="menu"
            @click="toggleLifebookMenu"
          >
            <span class="mg-div-detail__lifebook-icon" aria-hidden="true"></span>
            <span class="mg-div-detail__lifebook-count">{{ lifebookCount }}</span>
          </button>
          <div
            v-if="lifebookMenuOpen"
            class="association-users__row-menu mg-div-detail__menu"
            role="menu"
          >
            <button
              v-if="!lifebookAttached"
              type="button"
              class="association-users__row-menu-item"
              role="menuitem"
              @click="onLifebook('attach-lifebook')"
            >Attach Lifebook</button>
            <template v-else>
              <div class="mg-div-detail__lifebook-current">
                <span class="mg-div-detail__lifebook-eyebrow">Current Lifebook</span>
                <span class="mg-div-detail__lifebook-name">{{ lifebookName }}</span>
              </div>
              <button type="button" class="association-users__row-menu-item" role="menuitem" @click="onLifebook('replace-lifebook')">Replace Lifebook</button>
              <button type="button" class="association-users__row-menu-item association-users__row-menu-item--danger" role="menuitem" @click="onLifebook('detach-lifebook')">Detach Lifebook</button>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- Hero card — division header (name / dates / actions). Scrolls
         away normally; the condensed bar above takes over on scroll. -->
    <section ref="heroRef" class="mg-div-detail__hero">
    <!-- Header row — date / name / event on the left, actions right. -->
    <header class="mg-div-detail__header">
      <div class="mg-div-detail__header-id">
        <h2 class="mg-div-detail__header-title">{{ division.tournamentName }}</h2>
        <span v-if="division.dateRangeLabel" class="mg-div-detail__header-dates">{{ division.dateRangeLabel }}</span>
      </div>

      <div class="mg-div-detail__header-actions">
        <button
          v-if="canManageDivisions"
          type="button"
          class="mg-div-detail__icon-btn"
          aria-label="Edit Division"
          @click="onAction('edit-division')"
        >
          <span class="mg-div-detail__edit-icon" aria-hidden="true"></span>
          <span>Edit Division</span>
        </button>

        <div class="mg-div-detail__menu-root">
          <button
            type="button"
            class="mg-div-detail__icon-btn mg-div-detail__lifebook-btn"
            aria-label="Lifebook"
            :aria-expanded="lifebookMenuOpen ? 'true' : 'false'"
            aria-haspopup="menu"
            @click="toggleLifebookMenu"
          >
            <span class="mg-div-detail__lifebook-icon" aria-hidden="true"></span>
            <span class="mg-div-detail__lifebook-count">{{ lifebookCount }}</span>
          </button>
          <div
            v-if="lifebookMenuOpen"
            class="association-users__row-menu mg-div-detail__menu"
            role="menu"
          >
            <button
              v-if="!lifebookAttached"
              type="button"
              class="association-users__row-menu-item"
              role="menuitem"
              @click="onLifebook('attach-lifebook')"
            >Attach Lifebook</button>
            <template v-else>
              <div class="mg-div-detail__lifebook-current">
                <span class="mg-div-detail__lifebook-eyebrow">Current Lifebook</span>
                <span class="mg-div-detail__lifebook-name">{{ lifebookName }}</span>
              </div>
              <button type="button" class="association-users__row-menu-item" role="menuitem" @click="onLifebook('replace-lifebook')">Replace Lifebook</button>
              <button type="button" class="association-users__row-menu-item association-users__row-menu-item--danger" role="menuitem" @click="onLifebook('detach-lifebook')">Detach Lifebook</button>
            </template>
          </div>
        </div>
      </div>
    </header>
    </section>

    <!-- Below the hero — stats / pools column (left, sticky) + the
         games timeline (right, scrolls). Visual order is set via CSS
         `order` on the grid items; DOM order is games-then-rightcol.
         Replaced full-width by the bracket canvas stage when a bracket
         card is opened. -->
    <div v-if="openBracketIndex === null" class="mg-div-detail__split">
      <!-- Pool-play games timeline (CSS order: right column). Bracket
           play now lives in the overview's brackets scroller, so this
           column is single-purpose — no phase tabs. -->
      <section ref="gamesRef" class="mg-div-detail__games">
        <div class="mg-div-detail__games-tabs">
          <h3 class="mg-div-detail__games-heading">Pool Play</h3>
        </div>

        <!-- Pool format + seed tie-breaker — primary banner: round-robin
             format + status pill on the title row, team/game count + tie-
             breaker on the rows beneath. -->
        <div class="app-banner app-banner--primary mg-div-detail__games-banner">
          <div class="app-banner__text">
            <span class="mg-div-detail__games-banner-titlerow">
              <strong class="app-banner__title">{{ poolPlayText }}</strong>
              <span class="mg-div-detail__pill" :class="phaseToneClass(division.poolStatus)">{{ phaseLabel(division.poolStatus) }}</span>
            </span>
            <span class="mg-div-detail__games-banner-count">{{ division.teamCount }} {{ division.teamCount === 1 ? 'team' : 'teams' }} · {{ poolGames.length }} {{ poolGames.length === 1 ? 'game' : 'games' }}</span>
            <span class="app-banner__sub">Tie breaker - {{ seedCriteriaText }}</span>
          </div>
        </div>

        <!-- Date-grouped Pool Play — shared list shell + interactive admin
             game cards (list style; the timeline card is preserved in
             MatchGeniPoolPlayTimelineItem.vue for a future timeline view).
             No #header (the Pool/Bracket tab bar above is the sticky head);
             date rows pin below it via `--poolplay-stick-top`. `--poolplay-
             bleed` = the games column's 10px inline padding. -->
        <p v-if="poolGames.length === 0" class="mg-div-detail__empty">No pool play games scheduled yet.</p>
        <PoolPlayGames
          v-else
          :groups="gameGroups"
          :style="{ '--poolplay-stick-top': 'calc(var(--matchgeni-header-height, 56px) + var(--mg-div-condensed-h, 48px) + var(--mg-div-pills-h, 0px) + var(--mg-div-tabs-h, 48px))', '--poolplay-bleed': '10px', '--poolplay-inset': '10px' }"
        >
          <template #game="{ game }">
            <MatchGeniPoolPlayGameItem
              :game="game"
              :park-label="gameParkLabel(game)"
              @open="openGameDrawer"
            />
          </template>
        </PoolPlayGames>
      </section>

      <!-- Stats / progress card, then the team pools (CSS order: left column). -->
      <div class="mg-div-detail__rightcol">
      <!-- Overview — two cards side by side: progress + lifecycle on
           the left, the brackets scroller on the right. -->
      <section class="mg-div-detail__overview">
        <!-- LEFT card — Winners once complete, else progress + lifecycle. -->
        <div class="mg-div-detail__overview-card mg-div-detail__progress-card">
          <!-- WINNERS — shown once any group has recorded placements.
               Only groups WITH winners render here; announcing / editing
               the result is the left-panel action below. -->
          <div v-if="hasWinners" class="mg-div-detail__winners">
            <!-- Head: label + edit-result action + (when >1 group) arrows. -->
            <div class="mg-div-detail__winners-head">
              <button
                v-if="canAnnounceResult"
                type="button"
                class="mg-div-detail__winners-edit"
                @click="openAnnounceResult"
              >Edit result</button>
              <div
                v-if="winnerGroupsWithPlacements.length > 1"
                class="mg-div-detail__bracket-nav"
              >
                <button
                  type="button"
                  class="mg-div-detail__bracket-nav-arrow"
                  aria-label="Previous winners"
                  :disabled="!winnersRailCanPrev"
                  @click="stepWinnersRail(-1)"
                ><span class="mg-div-detail__bracket-nav-icon mg-div-detail__bracket-nav-icon--prev" aria-hidden="true"></span></button>
                <button
                  type="button"
                  class="mg-div-detail__bracket-nav-arrow"
                  aria-label="Next winners"
                  :disabled="!winnersRailCanNext"
                  @click="stepWinnersRail(1)"
                ><span class="mg-div-detail__bracket-nav-icon" aria-hidden="true"></span></button>
              </div>
            </div>
            <div
              ref="winnersRailRef"
              class="mg-div-detail__winners-groups"
              :class="{ 'mg-div-detail__winners-groups--carousel': winnerGroupsWithPlacements.length > 1 }"
              @scroll="updateWinnersRailArrows"
            >
              <div
                v-for="group in winnerGroupsWithPlacements"
                :key="`${group.kind}:${group.refId}`"
                class="mg-div-detail__winners-group"
              >
                <div class="mg-div-detail__winners-group-head">
                  <span class="mg-div-detail__winners-group-name">{{ group.name }}</span>
                  <span
                    class="mg-div-detail__winners-tag"
                    :class="`mg-div-detail__winners-tag--${group.source}`"
                  >{{ group.source === 'auto' ? 'Auto' : 'Announced' }}</span>
                </div>
                <ul class="mg-div-detail__winners-list">
                  <li
                    v-for="p in group.placements"
                    :key="`${p.rank}-${p.teamName}`"
                    class="mg-div-detail__winners-row"
                  >
                    <span v-if="p.rank === 1" class="mg-div-detail__winners-cup" aria-hidden="true"></span>
                    <span v-else class="mg-div-detail__winners-rank" :data-rank="p.rank">{{ p.rankLabel }}</span>
                    <TeamAvatar v-if="p.rank === 1" :name="p.teamName" :image-url="p.imageUrl" size="sm" />
                    <span class="mg-div-detail__winners-team">{{ p.teamName }}</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <!-- PROGRESS — shown while in progress (or complete but winners
               not yet recorded). -->
          <template v-else>
            <div class="mg-div-detail__progress" :aria-label="`${division.progressPercent}% complete`">
              <div class="mg-div-detail__progress-head">
                <span>Overall progress</span>
                <strong>{{ division.progressPercent }}%</strong>
              </div>
              <div class="mg-div-detail__progress-track">
                <div class="mg-div-detail__progress-fill" :style="{ width: `${division.progressPercent}%` }"></div>
              </div>
            </div>
            <!-- Footer actions — the lifecycle CTA and, once pool play is
                 done, the Announce-result action (asks basis, then
                 winners). Both can show during that window. -->
            <div class="mg-div-detail__progress-actions">
              <p v-if="noResultAnnounced" class="mg-div-detail__no-result">No result declared for this division.</p>
              <button
                v-if="workflowAction"
                type="button"
                class="mg-div-detail__workflow-cta"
                @click="onAction(workflowAction.action)"
              >{{ workflowAction.label }}</button>
              <button
                v-if="canAnnounceResult"
                type="button"
                class="mg-div-detail__workflow-cta mg-div-detail__workflow-cta--ghost"
                @click="openAnnounceResult"
              >{{ noResultAnnounced ? 'Edit result' : 'Announce result' }}</button>
            </div>
          </template>
        </div>

        <!-- RIGHT card — brackets rail (shared MatchGeniBracketRail).
             Chips open the canvas; header Add / trailing Create card add. -->
        <div class="mg-div-detail__overview-card mg-div-detail__brackets-card">
          <MatchGeniBracketRail
            :brackets="railBrackets"
            interactive
            :show-add="canManageDivisions"
            @open="onRailOpen"
            @see-all="onRailSeeAll"
            @add="openAddBracket"
          />
        </div>
      </section>

      <!-- Team pools — all pools shown stacked with a group label (no
           tab switching); a pool past the split threshold renders as
           two side-by-side standings sub-lists. -->
      <section class="mg-div-detail__teams">
      <div v-if="showPoolsBar" ref="poolsBarRef" class="mg-div-detail__pools-bar">
        <!-- Team search — the team count now lives in its placeholder. -->
        <label class="mg-div-detail__pools-search">
          <AppIcon name="search" :size="14" />
          <input
            v-model="teamSearch"
            type="search"
            :placeholder="`Search ${division.teamCount} ${division.teamCount === 1 ? 'team' : 'teams'}`"
            class="mg-div-detail__pools-search-input"
            aria-label="Search teams"
          />
        </label>
        <button
          v-if="canManageDivisions"
          type="button"
          class="matchgeni-tool-btn matchgeni-tool-btn--ghost mg-div-detail__pools-manage"
          @click="onAction('manage-team-pools')"
        >Manage Team Pools</button>
        <!-- Page nav lives in the header (right) — prev / X of Y / next. -->
        <div v-if="teamPageCount > 1" class="mg-div-detail__pool-pager">
          <button
            type="button"
            class="mg-div-detail__pool-pager-btn"
            aria-label="Previous teams"
            :disabled="teamPage === 0"
            @click="teamPagePrev"
          >
            <span class="mg-div-detail__pool-pager-icon mg-div-detail__pool-pager-icon--prev" aria-hidden="true"></span>
          </button>
          <span class="mg-div-detail__pool-pager-label">{{ teamPage + 1 }} / {{ teamPageCount }}</span>
          <button
            type="button"
            class="mg-div-detail__pool-pager-btn"
            aria-label="Next teams"
            :disabled="teamPage === teamPageCount - 1"
            @click="teamPageNext"
          >
            <span class="mg-div-detail__pool-pager-icon" aria-hidden="true"></span>
          </button>
        </div>
      </div>

      <div
        v-if="standingsLoading && standings.length === 0"
        class="mg-div-detail__teams-skeleton"
        aria-busy="true"
      >
        <!-- Pool column header (name + team count) — mirrors
             `.mg-div-detail__pool-label--col`. -->
        <div class="mg-div-detail__team-skel-poolhead">
          <span class="shimmer-block mg-div-detail__team-skel-poolname"></span>
          <span class="shimmer-block mg-div-detail__team-skel-poolcount"></span>
        </div>
        <!-- Seed / Win / Loss column header — same grid as the rows. -->
        <div class="mg-div-detail__team-skel-headrow">
          <span class="shimmer-block mg-div-detail__team-skel-stat"></span>
          <span class="shimmer-block mg-div-detail__team-skel-stat"></span>
          <span class="shimmer-block mg-div-detail__team-skel-stat"></span>
          <span aria-hidden="true"></span>
        </div>
        <div
          v-for="n in 7"
          :key="`team-skel-${n}`"
          class="mg-div-detail__team-skel-row"
        >
          <span class="shimmer-block mg-div-detail__team-skel-stat"></span>
          <span class="shimmer-block mg-div-detail__team-skel-stat"></span>
          <span class="shimmer-block mg-div-detail__team-skel-stat"></span>
          <span class="mg-div-detail__team-skel-copy">
            <span class="shimmer-block mg-div-detail__team-skel-name"></span>
            <span class="shimmer-block mg-div-detail__team-skel-meta"></span>
          </span>
        </div>
      </div>

      <p v-else-if="standings.length === 0" class="mg-div-detail__empty">No teams in this division yet.</p>

      <p v-else-if="pools.length === 0" class="mg-div-detail__empty">No teams match “{{ teamSearch.trim() }}”.</p>

      <div v-else class="mg-div-detail__pools-paged">
        <div
          ref="colsRegionRef"
          class="mg-div-detail__pool-cols"
          :class="{ 'mg-div-detail__pool-cols--split': visibleTeamColumns.length > 1 }"
        >
          <!-- Each column carries its own pool heading — keeps the
               column layout (and the height-fit row count) identical
               on every page regardless of single vs multi pool. -->
          <div
            v-for="(col, ci) in visibleTeamColumns"
            :key="`col-${teamPage}-${ci}`"
            class="mg-div-detail__pool-col"
          >
            <div class="mg-div-detail__pool-label mg-div-detail__pool-label--col">
              <span class="mg-div-detail__pool-label-name">{{ col.poolName }}</span>
              <span class="mg-div-detail__pool-label-count">{{ col.poolTeamCount }} {{ col.poolTeamCount === 1 ? 'team' : 'teams' }}</span>
            </div>
            <div
              class="division-standings"
              :class="{ 'division-standings--no-seed': !isSeedGenerated }"
            >
              <div class="division-standings__header">
                <span v-if="isSeedGenerated">Seed</span>
                <span>Win</span>
                <span>Loss</span>
              </div>
              <div
                v-for="entry in col.teams"
                :key="`${entry.seed}-${entry.teamName}`"
                class="division-standings__row"
              >
                <span v-if="isSeedGenerated">{{ entry.seed }}</span>
                <span>{{ entry.wins }}</span>
                <span>{{ entry.losses }}</span>
                <div class="division-standings__team">
                  <div class="division-standings__copy">
                    <strong :title="entry.teamName">{{ entry.teamName }}</strong>
                    <span :title="teamMetaLocation(entry)">{{ teamMetaLocation(entry) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
    </div>
    </div>

    <!-- Bracket canvas stage — full content width, replaces the two
         columns when a bracket card is opened. Same zoom/pan
         `MatchGeniBracket` the scheduler uses; the close (X) returns to
         the bracket card list, the switch moves between brackets. -->
    <div v-else class="mg-div-detail__bracket-stage">
      <MatchGeniBracket
        :bracket="stageBracket"
        closable
        close-label="Close brackets"
        hide-name-fallback
        @close="closeBracket"
      >
        <!-- Bracket lifecycle status pill, under the stats line. -->
        <template v-if="activeBracketCard" #status>
          <span
            class="mg-div-detail__pill mg-div-detail__bracket-status-pill"
            :class="`mg-div-detail__pill--${bracketStatusTone(activeBracketCard.status)}`"
          >{{ bracketStatusLabel(activeBracketCard.status) }}</span>
        </template>
        <template v-if="bracketCards.length" #switch>
          <div class="mg-div-detail__bracket-switch" role="tablist">
            <!-- Each pill is the tab itself (click switches). The ACTIVE
                 pill expands to reveal an inline Edit button that opens the
                 edit-bracket popup — the edit affordance was removed from
                 the bracket cards and lives here now. The edit is a nested
                 button (so it can't be a real <button> tab — the tab is a
                 div with role=tab + keyboard handlers). -->
            <div
              v-for="(b, i) in bracketCards"
              :key="b.id"
              role="tab"
              tabindex="0"
              class="mg-div-detail__tab mg-div-detail__bracket-switch-tab"
              :class="{ 'mg-div-detail__tab--active': i === openBracketIndex }"
              :aria-selected="i === openBracketIndex"
              @click="openBracket(i)"
              @keydown.enter="openBracket(i)"
              @keydown.space.prevent="openBracket(i)"
            >
              <span class="mg-div-detail__bracket-switch-label">{{ b.name }}</span>
              <!-- Active pill carries only the Edit icon (no tooltip). The
                   Cancel-bracket action lives inside the edit popup. -->
              <button
                v-if="i === openBracketIndex && canManageDivisions"
                type="button"
                class="mg-div-detail__bracket-switch-edit"
                aria-label="Edit Bracket"
                @click.stop="openEditBracket(i)"
              >
                <span class="mg-div-detail__edit-icon" aria-hidden="true"></span>
              </button>
            </div>
          </div>
        </template>
        <!-- No bracket for the switched-to division — centered
             placeholder + Create Bracket (instead of closing the
             canvas). -->
        <template #empty>
          <div class="mg-div-detail__bracket-placeholder">
            <p class="mg-div-detail__bracket-placeholder-title">No bracket for this division yet.</p>
            <button
              v-if="canManageDivisions"
              type="button"
              class="matchgeni-tool-btn matchgeni-tool-btn--ghost"
              @click="openAddBracket"
            >
              <span class="mg-div-detail__add-icon" aria-hidden="true"></span>
              <span>Create Bracket</span>
            </button>
          </div>
        </template>
      </MatchGeniBracket>
    </div>

    <!-- Add / Edit Bracket — same modal the game scheduler uses. -->
    <MatchGeniBracketFormModal
      v-model="bracketFormOpen"
      :division-name="division.tournamentName"
      :bracket-id="bracketFormEditId"
      :bracket-name="bracketFormName"
      :can-cancel="bracketFormCancellable"
      :team-options="bracketTeamOptions"
      @saved="onBracketFormSaved"
      @delete="onBracketFormDeleted"
      @cancel-bracket="onBracketFormCancelBracket"
    />

    <!-- See-all teams — full roster of a bracket (opened from the
         "See all" link on a bracket chip when not all avatars fit). -->
    <Teleport to="body">
    <Transition name="slide-modal-backdrop">
      <div
        v-if="seeAllBracket"
        class="association-switcher-backdrop"
        role="presentation"
        @click="onSeeAllBackdrop"
      >
        <div class="association-switcher-panel mg-div-detail__seeall" role="dialog" aria-modal="true" aria-label="Bracket teams">
          <header class="association-switcher-panel__header">
            <div class="mg-div-detail__seeall-titles">
              <span class="mg-div-detail__seeall-eyebrow">{{ seeAllBracket.teams.length }} {{ seeAllBracket.teams.length === 1 ? 'team' : 'teams' }} · {{ seeAllBracket.format }}</span>
              <h2 class="association-switcher-panel__title">{{ seeAllBracket.name }}</h2>
            </div>
            <button type="button" class="association-switcher-panel__close" aria-label="Close" @click="closeSeeAllTeams">
              <AppIcon name="close" :size="16" />
            </button>
          </header>
          <label class="mg-div-detail__seeall-search">
            <AppIcon name="search" :size="14" />
            <input v-model="seeAllSearch" type="search" placeholder="Search teams" class="mg-div-detail__seeall-search-input" />
          </label>
          <ul class="mg-div-detail__seeall-list">
            <li v-for="team in seeAllFilteredTeams" :key="team" class="mg-div-detail__seeall-row">
              <TeamAvatar :name="team" size="sm" />
              <span class="mg-div-detail__seeall-name">{{ team }}</span>
            </li>
            <li v-if="seeAllFilteredTeams.length === 0" class="mg-div-detail__seeall-empty">
              No teams match "{{ seeAllSearch.trim() }}".
            </li>
          </ul>
        </div>
      </div>
    </Transition>
    </Teleport>

    <!-- Announce winners — per-unit (each bracket / pool), incremental. -->
    <AnnounceResultModal
      v-if="announceModalOpen"
      :units="winnerUnits"
      :eligible-teams="eligibleTeamsMap"
      :division-name="division?.tournamentName"
      @save="onAnnounceUnit"
      @cancel-bracket="requestCancelBracket"
      @close="closeAnnounceResult"
    />

    <!-- Cancel bracket — shared reason form (opened from the Announce
         modal OR the bracket canvas). -->
    <CancelBracketModal
      :model-value="cancelTargetId !== null"
      :bracket-name="cancelTargetCard?.name"
      @update:model-value="(v: boolean) => { if (!v) closeCancelBracket() }"
      @confirm="onCancelBracketConfirm"
    />

    <!-- Game details — same drawer as the scheduler field grid. -->
    <ScoringGameDetailsDrawer
      v-model="gameDrawerOpen"
      :game="gameDrawerGame"
      :division-name="division?.tournamentName ?? ''"
      @action="onGameDrawerAction"
      @edit="openEditGameFromDrawer"
    />

    <!-- Edit pool game — same shared add/edit form used on the scheduler.
         Opened from the drawer's "Edit game"; edits overlay via gameOverrides. -->
    <SchedulerCreateGameModal
      v-model="gameEditOpen"
      mode="edit"
      :division-name="division?.tournamentName ?? ''"
      :date-label="editGame?.scheduledDate ? formatGameDate(editGame.scheduledDate) : ''"
      :time-label="editGame?.scheduledTime ?? ''"
      :field-name="editGame?.scheduledFieldLabel ?? ''"
      park-name=""
      :team-options="divisionTeamOptions"
      :default-duration="90"
      :max-duration="0"
      :default-time-limit="DEFAULT_TIME_LIMIT_BY_TYPE.pool"
      :initial-name="editGame?.label ?? ''"
      :initial-team1="editGame?.team1Label ?? ''"
      :initial-team2="editGame?.team2Label ?? ''"
      :initial-duration="editGame?.durationMinutes ?? 0"
      :initial-time-limit="editGame?.timeLimitMinutes ?? 0"
      @submit="onGameEditSubmit"
    />

  </div>
</template>

<style scoped>
.mg-div-detail {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Hero card — division header (name / dates / actions). A normal
   rounded card that scrolls away with the page; the condensed bar
   below takes over the pinned-to-top role on scroll.
   TEMPORARILY HIDDEN (per request) — the markup + condensed-bar JS are
   kept intact. To re-enable: remove the `display: none` here and on
   `.mg-div-detail__condensed`, and restore `--mg-div-condensed-h` to
   56px on `.mg-div-detail__split`. */
.mg-div-detail__hero {
  display: none;
  background: var(--white);
  border: 1px solid var(--border-divider);
  border-radius: 8px;
  overflow: hidden;
}
html.dark-mode .mg-div-detail__hero {
  background: var(--surface-card);
}

/* Condensed sticky bar — the only element that pins to the top on
   scroll. Edge-to-edge like ParticipationV2's condensed-team-header:
   cancels the page gutter (`margin-inline: -24px`) so it spans the
   content area end-to-end. Collapsed to zero height + faded out at
   rest (no layout impact); `--visible` expands + fades it in. */
.mg-div-detail__condensed {
  position: sticky;
  top: var(--matchgeni-header-height, 56px);
  z-index: 6;
  margin-inline: -24px;
  display: flex;
  align-items: center;
  gap: 10px;
  max-height: 0;
  /* 16px content inset to match the sidebar header
     (`.mg-division-page__sidebar-head` padding: 14px 16px) — the bleed
     cancels the page gutter, so the content inset equals the padding. */
  padding: 0 16px;
  overflow: hidden;
  background: var(--white);
  border-bottom: 1px solid transparent;
  /* No shadow at rest; the drop shadow fades in with `--visible`. */
  box-shadow: none;
  opacity: 0;
  pointer-events: none;
  transform: translate3d(0, -10px, 0);
  transition: opacity 160ms ease, transform 200ms cubic-bezier(0.22, 1, 0.36, 1),
    max-height 180ms ease, padding 180ms ease, border-color 180ms ease,
    box-shadow 180ms ease;
}
html.dark-mode .mg-div-detail__condensed {
  background: var(--surface-card);
}
/* TEMPORARILY HIDDEN with the hero — delete this one rule (and the
   `display: none` on `.mg-div-detail__hero`, and restore
   `--mg-div-condensed-h` to 56px) to re-enable the sticky condensed bar. */
.mg-div-detail__condensed {
  display: none;
}
.mg-div-detail__condensed--visible {
  max-height: var(--mg-div-condensed-h, 56px);
  min-height: var(--mg-div-condensed-h, 56px);
  padding: 14px 16px;
  border-bottom-color: var(--border-divider);
  /* Drop shadow while pinned, so the sticky bar lifts off the content
     scrolling beneath it. */
  box-shadow: 0 6px 18px rgba(36, 60, 91, 0.16);
  /* Let the lifebook dropdown escape the pinned bar (clipped at rest
     so the collapsed content never spills). */
  overflow: visible;
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}
html.dark-mode .mg-div-detail__condensed--visible {
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
}
/* Left identity group — name + dates share one baseline. */
.mg-div-detail__condensed-id {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
/* Right tool buttons — mirror the hero, compacted to the bar height. */
.mg-div-detail__condensed-actions {
  margin-left: auto;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.mg-div-detail__condensed-actions .mg-div-detail__icon-btn {
  min-width: 28px;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  font-size: 13px;
  gap: 6px;
}
.mg-div-detail__condensed-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.mg-div-detail__condensed-dates {
  font-size: 12px;
  color: var(--secondary);
  white-space: nowrap;
  flex: 0 0 auto;
}
@media (max-width: 720px) {
  /* Keep the 16px content inset (sidebar-header parity); only the bleed
     follows the narrower mobile page gutter. */
  .mg-div-detail__condensed {
    margin-inline: -14px;
  }
}

/* Below the hero — two equal columns. DOM order is games-then-rightcol;
   `order` flips them visually so the sticky stats/pools column sits on
   the LEFT and the scrolling games timeline on the RIGHT.
   `--mg-div-condensed-h` is the pinned condensed-bar height that the
   sticky column + date headers offset below. */
.mg-div-detail__split {
  /* Pinned condensed-bar height — matched to the sidebar header
     (`.mg-division-page__sidebar-head`) so the two top bars align.
     The sticky stats column + the games' date headers pin flush to
     the bottom of that bar. Set to 0 while the condensed bar is hidden
     so those sticky elements pin directly under the matchgeni header
     (no empty gap). Restore to 56px when re-enabling the condensed bar. */
  --mg-div-condensed-h: 0px;
  display: grid;
  /* Left (stats / pools, order:1) 60% — right (games, order:2) 40%. */
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  gap: 16px;
  align-items: start;
}
/* Stretch to the row height so the games/bracket card fills its column
   and no empty gap shows beside the taller stats/pools column (e.g. the
   Bracket Play tab with only a couple of brackets). */
.mg-div-detail__games { order: 2; align-self: stretch; }
/* Stats / progress card stacked above the team pools; pins below the
   condensed bar (left column) while the games column scrolls. */
.mg-div-detail__rightcol {
  order: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
  position: sticky;
  top: calc(var(--matchgeni-header-height, 56px) + var(--mg-div-condensed-h, 48px));
  align-self: start;
  /* Full height — the stats card sits at the top and the team-pools
     card fills the rest, so the pool list can fit as many rows as the
     viewport allows (then spill to column 2 / the next page). */
  height: calc(100vh - var(--matchgeni-header-height, 56px) - var(--mg-div-condensed-h, 0px));
  min-height: 0;
}
@media (max-width: 1080px) {
  .mg-div-detail__split {
    grid-template-columns: minmax(0, 1fr);
  }
  /* Stacked single column — don't pin the right column (it sits below
     the games and there's nothing to scroll past it). */
  .mg-div-detail__rightcol {
    position: static;
    height: auto;
  }
}

/* ── Header row (hero card body) ── */
.mg-div-detail__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
}
.mg-div-detail__header-id {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.mg-div-detail__header-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.2;
}
.mg-div-detail__header-dates {
  font-size: 13px;
  color: var(--secondary);
}
.mg-div-detail__header-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.mg-div-detail__menu-root {
  position: relative;
}
/* Standard medium button — matches the portal's medium control height
   (38px) used by primary/secondary actions, vs the old compact 32px. */
.mg-div-detail__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 38px;
  height: 38px;
  padding: 0 14px;
  border-radius: 8px;
  background: transparent;
  border: 1px solid var(--border-divider);
  color: var(--secondary);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}
.mg-div-detail__icon-btn:hover {
  background: var(--surface-muted, #f4f7fb);
  color: var(--text);
}
html.dark-mode .mg-div-detail__icon-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}
.mg-div-detail__lifebook-icon {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  background-color: currentColor;
  -webkit-mask: url('../assets/mylifebook.svg') center / contain no-repeat;
  mask: url('../assets/mylifebook.svg') center / contain no-repeat;
}
.mg-div-detail__lifebook-count {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}
.mg-div-detail__edit-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  background-color: currentColor;
  -webkit-mask: url('../assets/edit.svg') center / contain no-repeat;
  mask: url('../assets/edit.svg') center / contain no-repeat;
}
.mg-div-detail__add-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  background-color: currentColor;
  -webkit-mask: url('../assets/add.svg') center / contain no-repeat;
  mask: url('../assets/add.svg') center / contain no-repeat;
}
.mg-div-detail__refresh-icon {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  background-color: currentColor;
  -webkit-mask: url('../assets/refresh.svg') center / contain no-repeat;
  mask: url('../assets/refresh.svg') center / contain no-repeat;
}
.mg-div-detail__menu {
  min-width: 180px;
}
.mg-div-detail__lifebook-current {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 14px 8px;
  border-bottom: 1px solid var(--border-divider);
}
.mg-div-detail__lifebook-eyebrow {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--secondary);
}
.mg-div-detail__lifebook-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

/* ── Overview ── */
/* Overview — standalone stats / progress card at the top of the right
   column. */
/* Two cards side by side: a fixed-ish progress/lifecycle card on the
   left + the flexible brackets card on the right. */
.mg-div-detail__overview {
  display: grid;
  /* 30 / 70 split — progress/winners card on the left, brackets on the right. */
  grid-template-columns: minmax(0, 3fr) minmax(0, 7fr);
  gap: 14px;
  align-items: stretch;
}
.mg-div-detail__overview-card {
  background: var(--white);
  border: 1px solid var(--border-divider);
  border-radius: 8px;
  padding: 16px;
}
html.dark-mode .mg-div-detail__overview-card {
  background: var(--surface-card);
}
/* Left card — progress at top, lifecycle CTA pinned to the bottom so
   the card reads as a compact square block beside the brackets. */
.mg-div-detail__progress-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 16px;
}
/* Brackets card — column so the stat fills the card height. No card
   padding (the rail runs edge-to-edge so the cut shadows sit at the
   card's edges); only the header row carries inset padding. */
.mg-div-detail__brackets-card {
  display: flex;
  flex-direction: column;
  padding: 0;
}
.mg-div-detail__stat--brackets .mg-div-detail__stat-head--row {
  padding: 16px 16px 0;
}
.mg-div-detail__stat--brackets {
  flex: 1 1 auto;
}
/* Rail wrapper — grows to take the card's leftover height (below the
   head) and vertically centres the horizontal scroller within it.
   `min-height: 0` keeps the scroller's content from blowing the box out. */
.mg-div-detail__bracket-rail-wrap {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
/* Edge "cut" shadows — an inset drop-shadow on each side makes the rail
   read as sliding BEHIND the card edge there. Each side only shows when
   there's scrollable content that way (driven by the rail's prev/next
   state): right-only at the start, both in the middle (framing the
   current chip), left-only at the end. */
.mg-div-detail__bracket-rail-wrap::before,
.mg-div-detail__bracket-rail-wrap::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 28px;
  pointer-events: none;
  opacity: 0;
  transition: opacity 120ms ease;
  z-index: 2;
  /* Fade the shadow out toward the top + bottom so it reads as a soft
     central "cut" rather than a hard full-height bar. */
  -webkit-mask: linear-gradient(to bottom, transparent, #000 28%, #000 72%, transparent);
  mask: linear-gradient(to bottom, transparent, #000 28%, #000 72%, transparent);
}
.mg-div-detail__bracket-rail-wrap::before {
  left: 0;
  box-shadow: inset 14px 0 12px -12px rgba(20, 40, 80, 0.45);
}
.mg-div-detail__bracket-rail-wrap::after {
  right: 0;
  box-shadow: inset -14px 0 12px -12px rgba(20, 40, 80, 0.45);
}
/* Dark mode — a darker shadow reads against the dark card surface (the
   light-mode navy tint would vanish). */
html.dark-mode .mg-div-detail__bracket-rail-wrap::before {
  box-shadow: inset 14px 0 14px -12px rgba(0, 0, 0, 0.7);
}
html.dark-mode .mg-div-detail__bracket-rail-wrap::after {
  box-shadow: inset -14px 0 14px -12px rgba(0, 0, 0, 0.7);
}
.mg-div-detail__bracket-rail-wrap--fade-start::before { opacity: 1; }
.mg-div-detail__bracket-rail-wrap--fade-end::after { opacity: 1; }
@media (max-width: 720px) {
  .mg-div-detail__overview {
    grid-template-columns: minmax(0, 1fr);
  }
  /* Full-width stretched cards on mobile read as flush bands — drop the
     corner rounding and the left/right borders (they run edge-to-edge,
     so only the top/bottom rules read). */
  .mg-div-detail__overview-card {
    border-radius: 0;
    border-left: none;
    border-right: none;
  }
}
.mg-div-detail__stats {
  display: grid;
  /* Single column now — the Brackets scroller is the only overview
     stat; Pool Play info moved to the games timeline header + the
     team-pools bar. */
  grid-template-columns: minmax(0, 1fr);
}
.mg-div-detail__stat {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  gap: 8px;
  min-width: 0;
  padding: 0 16px;
  text-align: left;
}
.mg-div-detail__stat:first-child { padding-left: 0; }
.mg-div-detail__stat:last-child { padding-right: 0; }
.mg-div-detail__stat + .mg-div-detail__stat {
  border-left: 1px solid var(--border-divider);
}
/* Head row variant — label + badge / Add on one centered row.
   Dual-class so it beats the base `.mg-div-detail__stat-head`
   (`flex-direction: column`) regardless of source order. */
.mg-div-detail__stat-head.mg-div-detail__stat-head--row {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}
.mg-div-detail__stat-sub--tiebreak {
  color: var(--secondary);
  margin-top: 2px;
}

/* ── Bracket scroller nav (header arrows, parks-header style) ── */
.mg-div-detail__bracket-nav {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.mg-div-detail__bracket-nav-arrow {
  appearance: none;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  border: 1px solid var(--border-divider);
  background: var(--surface-card);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  transition: background-color 120ms ease, opacity 120ms ease;
}
.mg-div-detail__bracket-nav-arrow:hover:not(:disabled) {
  background: var(--surface-raised, rgba(45, 140, 240, 0.08));
}
.mg-div-detail__bracket-nav-arrow:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
/* Tablet-portrait and smaller — hide the rail paging arrows (brackets +
   winners rails); touch users swipe. Matches the dashboard rails. The
   "+ Add" bracket button in the same row stays. */
@media (max-width: 1080px) {
  .mg-div-detail__bracket-nav-arrow {
    display: none;
  }
}
.mg-div-detail__bracket-nav-icon {
  width: 12px;
  height: 12px;
  background-color: var(--secondary);
  -webkit-mask: url('../assets/arrow-right.svg') center / contain no-repeat;
  mask: url('../assets/arrow-right.svg') center / contain no-repeat;
}
.mg-div-detail__bracket-nav-icon--prev { transform: scaleX(-1); }
/* Add button — icon + "Add" label, the same medium size (36px tall,
   6px radius) + primary-outline ghost treatment as the Manage-Team-Pools
   button (transparent fill, primary border + glyph, light hover fill).
   Sits before the prev/next nav arrows. */
.mg-div-detail__bracket-add-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--primary, #2d8cf0);
  background: transparent;
  color: var(--primary, #2d8cf0);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 120ms ease, border-color 120ms ease;
}
.mg-div-detail__bracket-add-btn:hover {
  background: var(--primary-light-3, #e5f1ff);
  border-color: var(--primary, #2d8cf0);
}
html.dark-mode .mg-div-detail__bracket-add-btn:hover {
  background: rgba(45, 140, 240, 0.12);
}
.mg-div-detail__bracket-add-icon {
  font-size: 18px;
  line-height: 1;
  font-weight: 400;
}

/* ── Bracket horizontal scroller (parks-carousel pattern) ── */
.mg-div-detail__bracket-rail {
  display: flex;
  /* `align-items: stretch` so every chip matches the tallest card's
     height — same as the parks carousel. */
  align-items: stretch;
  gap: 10px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scroll-behavior: smooth;
  scrollbar-width: none;
  /* Vertical padding gives the chip's hover lift (-1px) + drop shadow
     room inside the rail's clip box — `overflow-x: auto` also clips the
     Y axis, so without this the lifted card's top hides under the
     header. Inline padding insets the first chip from the left + last
     chip from the right (a lone chip gets both); scroll-padding keeps
     snap positions aligned to that inset. */
  padding: 16px;
  scroll-padding-inline: 16px;
}
.mg-div-detail__bracket-rail::-webkit-scrollbar { display: none; }
/* Chip = a parks-style slot: 80% of the rail width so the next chip
   peeks in, center-snapped so the active card lands in the middle. */
.mg-div-detail__bracket-chip {
  position: relative;
  flex: 0 0 80%;
  scroll-snap-align: center;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--border-divider);
  border-radius: 8px;
  background: var(--surface-muted, #f4f7fb);
  cursor: pointer;
  text-align: left;
  transition: border-color 120ms ease, box-shadow 120ms ease,
    background-color 120ms ease, transform 120ms ease;
}
/* Edge alignment — first snaps to start (no left peek at the start),
   last snaps to end; a lone chip fills the full rail width. */
.mg-div-detail__bracket-chip:first-child { scroll-snap-align: start; }
.mg-div-detail__bracket-chip:last-child { scroll-snap-align: end; }
.mg-div-detail__bracket-chip:only-child { flex-basis: 100%; }
html.dark-mode .mg-div-detail__bracket-chip {
  background: rgba(255, 255, 255, 0.04);
}
.mg-div-detail__bracket-chip:hover {
  border-color: var(--primary);
  background: var(--primary-light-3, #f0f6ff);
  box-shadow: 0 4px 14px rgba(20, 40, 80, 0.10);
  transform: translateY(-1px);
}
html.dark-mode .mg-div-detail__bracket-chip:hover {
  background: rgba(45, 140, 240, 0.08);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
}
.mg-div-detail__bracket-chip:active {
  transform: translateY(0);
}
.mg-div-detail__bracket-chip:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
/* Eyebrow — "N teams · format" above the bracket name. */
.mg-div-detail__bracket-chip-eyebrow {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mg-div-detail__bracket-chip-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.mg-div-detail__bracket-chip-name {
  /* Shrink-to-content (with ellipsis) so the status badge sits right
     after the name; the edit pencil is pushed to the far right. */
  flex: 0 1 auto;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mg-div-detail__bracket-chip-head .mg-div-detail__pill {
  flex: 0 0 auto;
}
/* Edit pencil — pinned to the chip's top-right corner, aligned with
   the eyebrow row rather than flowing inside the name row. */
.mg-div-detail__bracket-chip-head .mg-div-detail__bracket-iconbtn {
  position: absolute;
  top: 10px;
  right: 12px;
}
/* Footer row — team avatars on the left, the Announce-winners action
   pushed to the right edge, both vertically centered on one line. */
.mg-div-detail__bracket-chip-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
  min-width: 0;
}
.mg-div-detail__bracket-chip-avatars {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
/* Overlapping avatar stack — the overlap is scoped to the stack so it
   never pulls the trailing See-all button behind the last avatar. */
.mg-div-detail__bracket-avatar-stack {
  display: flex;
  align-items: center;
  flex: 0 1 auto;
  min-width: 0;
}
.mg-div-detail__bracket-avatar {
  display: inline-flex;
}
.mg-div-detail__bracket-avatar-stack > :not(:first-child) {
  margin-left: -6px;
}
/* Tooltip anchoring — the rail clips overflow on both sides, so the
   default centred bubble gets cut off for the left-most (and right-most)
   avatars. Avatars cluster on the LEFT of each chip with room to the
   right, so anchor the bubble + arrow to the avatar's left edge: it
   opens rightward into the chip and never crosses the rail's side
   edges. Stays above (`--top`) to clear the rail's bottom clip. */
.mg-div-detail__bracket-avatar.app-tooltip::after {
  left: 0;
  transform: translateX(0) translateY(2px);
}
.mg-div-detail__bracket-avatar.app-tooltip:hover::after,
.mg-div-detail__bracket-avatar.app-tooltip:focus-visible::after {
  transform: translateX(0) translateY(0);
}
.mg-div-detail__bracket-avatar.app-tooltip::before {
  left: 14px;
}
/* See-all — text button (same border / hover chrome as the Edit button)
   that opens the full team list. Rounded rectangle, auto width.
   Dual-class so it beats the base `.mg-div-detail__bracket-iconbtn`
   circle (30px / 50% radius) defined later in the file. */
.mg-div-detail__bracket-iconbtn.mg-div-detail__bracket-seeall {
  flex: 0 0 auto;
  width: auto;
  height: 28px;
  padding: 0 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}
.mg-div-detail__eye-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  background-color: currentColor;
  -webkit-mask: url('../assets/eye.svg') center / contain no-repeat;
  mask: url('../assets/eye.svg') center / contain no-repeat;
}
/* Announce winners — appears on a bracket chip when its winners still
   need to be recorded (in-progress / completed, manual). */
.mg-div-detail__bracket-announce {
  margin-left: auto;
  flex: 0 0 auto;
  appearance: none;
  border: 1px solid var(--primary);
  background: transparent;
  color: var(--primary);
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 999px;
  cursor: pointer;
  white-space: nowrap;
}
.mg-div-detail__bracket-announce:hover {
  background: var(--primary);
  color: #ffffff;
}

/* See-all teams modal. */
.mg-div-detail__seeall { width: min(420px, 100%); }
.mg-div-detail__seeall-titles {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.mg-div-detail__seeall-eyebrow {
  font-size: 0.72rem;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--secondary);
}
/* Local team search — same control as the Manage Pools / Umpires
   search field. */
.mg-div-detail__seeall-search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 16px 0;
  padding: 0 10px;
  height: 32px;
  border-radius: 6px;
  border: 1px solid var(--border-divider);
  background: var(--white);
  color: var(--secondary);
}
html.dark-mode .mg-div-detail__seeall-search {
  background: rgba(255, 255, 255, 0.04);
}
.mg-div-detail__seeall-search-input {
  flex: 1 1 auto;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font: inherit;
  color: var(--text);
}
.mg-div-detail__seeall-list {
  list-style: none;
  margin: 0;
  padding: 8px 16px 16px;
  max-height: 60vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.mg-div-detail__seeall-empty {
  padding: 16px 0;
  font-size: 13px;
  color: var(--secondary);
  text-align: center;
}
.mg-div-detail__seeall-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-top: 1px solid var(--border-divider);
}
.mg-div-detail__seeall-row:first-child { border-top: none; }
.mg-div-detail__seeall-seed {
  flex: 0 0 auto;
  width: 22px;
  font-size: 12px;
  font-weight: 700;
  color: var(--secondary);
  text-align: center;
}
.mg-div-detail__seeall-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Add-bracket card — the trailing slot in the rail (and the only slot
   when there are no brackets). Dashed, centered, primary-tinted. */
.mg-div-detail__bracket-add-card {
  appearance: none;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 4px;
  border-style: dashed;
  background: transparent;
  color: var(--primary);
}
.mg-div-detail__bracket-add-card:hover {
  border-color: var(--primary);
  background: var(--primary-light-3, #e5f1ff);
}
html.dark-mode .mg-div-detail__bracket-add-card:hover {
  background: rgba(45, 140, 240, 0.10);
}
.mg-div-detail__bracket-add-plus {
  font-size: 22px;
  line-height: 1;
  font-weight: 400;
}
.mg-div-detail__bracket-add-label {
  font-size: 13px;
  font-weight: 600;
}
.mg-div-detail__bracket-add-sub {
  font-size: 11px;
  color: var(--secondary);
}

@media (max-width: 720px) {
  /* Stack the two overview columns; drop the dividing border. */
  .mg-div-detail__stats {
    grid-template-columns: minmax(0, 1fr);
    gap: 14px;
  }
  .mg-div-detail__stat {
    padding: 0;
  }
  .mg-div-detail__stat + .mg-div-detail__stat {
    border-left: 0;
    border-top: 1px solid var(--border-divider);
    padding-top: 14px;
  }
}
.mg-div-detail__stat-head {
  /* Label on top, badge(s)/counter stacked below it. */
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}
.mg-div-detail__stat-sub {
  font-size: 12px;
  line-height: 1.35;
  color: var(--text);
}
/* In-card "Add Bracket" button — sits in the Brackets stat head row,
   pushed to the right edge. */
/* Tab-bar action icons (refresh / add) sized for the shared
   `.matchgeni-tool-btn` shell. */
.mg-div-detail__games-add .mg-div-detail__add-icon,
.mg-div-detail__games-add .mg-div-detail__refresh-icon {
  width: 14px;
  height: 14px;
}
.mg-div-detail__progress {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mg-div-detail__workflow-cta {
  /* Full-width within the left card, anchored at its bottom. */
  width: 100%;
  text-align: center;
  white-space: nowrap;
  appearance: none;
  border: none;
  border-radius: 6px;
  background: var(--primary, #2563eb);
  color: var(--white, #ffffff);
  font-weight: 600;
  font-size: 13px;
  padding: 9px 16px;
  cursor: pointer;
  transition: filter 120ms ease;
}
.mg-div-detail__workflow-cta:hover { filter: brightness(1.06); }
/* Ghost variant — the secondary Announce/Edit-result action that sits
   beneath the primary lifecycle CTA. */
.mg-div-detail__workflow-cta--ghost {
  background: transparent;
  border: 1px solid var(--primary, #2563eb);
  color: var(--primary, #2563eb);
}
.mg-div-detail__workflow-cta--ghost:hover { filter: none; background: var(--primary-light-3, #e5f1ff); }
html.dark-mode .mg-div-detail__workflow-cta--ghost:hover { background: rgba(45, 140, 240, 0.12); }
.mg-div-detail__progress-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mg-div-detail__no-result {
  margin: 0;
  font-size: 12px;
  color: var(--secondary);
}
/* Edit-result link in the Winners head. */
.mg-div-detail__winners-edit {
  appearance: none;
  border: none;
  background: transparent;
  padding: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--primary);
  cursor: pointer;
  white-space: nowrap;
}
.mg-div-detail__winners-edit:hover { text-decoration: underline; }
.mg-div-detail__progress-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-size: 12px;
  color: var(--secondary);
}
.mg-div-detail__progress-head strong {
  font-size: 14px;
  color: var(--text);
}
.mg-div-detail__progress-track {
  height: 8px;
  border-radius: 999px;
  background: var(--border-divider);
  overflow: hidden;
}
.mg-div-detail__progress-fill {
  height: 100%;
  border-radius: 999px;
  background: #22a06b;
  transition: width 240ms ease;
}

/* ── Winners panel (replaces progress once complete) ── */
.mg-div-detail__winners {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}
.mg-div-detail__winners-head {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
.mg-div-detail__winners-groups {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  overflow-y: auto;
}
/* Carousel — when >1 bracket has winners, page groups horizontally one
   at a time (parks pattern); scrollbar hidden, arrows drive it. */
.mg-div-detail__winners-groups--carousel {
  flex-direction: row;
  flex-wrap: nowrap;
  gap: 16px;
  overflow-x: auto;
  overflow-y: hidden;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.mg-div-detail__winners-groups--carousel::-webkit-scrollbar { display: none; }
.mg-div-detail__winners-groups--carousel > .mg-div-detail__winners-group {
  flex: 0 0 100%;
  min-width: 0;
  scroll-snap-align: start;
}
.mg-div-detail__winners-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mg-div-detail__winners-group-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mg-div-detail__winners-group-name {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mg-div-detail__winners-tag {
  margin-left: auto;
  flex: 0 0 auto;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 7px;
  border-radius: 999px;
}
.mg-div-detail__winners-tag--auto {
  background: var(--success-light, #e3f6ea);
  color: #16763a;
}
html.dark-mode .mg-div-detail__winners-tag--auto {
  background: rgba(34, 160, 107, 0.18);
  color: #7ad48a;
}
.mg-div-detail__winners-tag--manual {
  background: var(--primary-light-3, #e5f1ff);
  color: var(--primary);
}
html.dark-mode .mg-div-detail__winners-tag--manual {
  background: rgba(45, 140, 240, 0.16);
  color: #7fb0e8;
}
.mg-div-detail__winners-set {
  margin-left: auto;
  appearance: none;
  border: 1px solid var(--primary);
  background: transparent;
  color: var(--primary);
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 999px;
  cursor: pointer;
  white-space: nowrap;
}
.mg-div-detail__winners-set:hover {
  background: var(--primary);
  color: #ffffff;
}
.mg-div-detail__winners-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mg-div-detail__winners-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
/* Rank chip — gold / silver / bronze by place. */
.mg-div-detail__winners-rank {
  flex: 0 0 auto;
  min-width: 30px;
  text-align: center;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--surface-muted, #eef2f7);
  color: var(--secondary);
}
.mg-div-detail__winners-rank[data-rank='1'] { background: #fde6c4; color: #8a6400; }
.mg-div-detail__winners-rank[data-rank='2'] { background: #e7ebf1; color: #5f7186; }
.mg-div-detail__winners-rank[data-rank='3'] { background: #f3e1d2; color: #9a5a2b; }
html.dark-mode .mg-div-detail__winners-rank[data-rank='1'] { background: #4a3a1a; color: #e8c47a; }
html.dark-mode .mg-div-detail__winners-rank[data-rank='2'] { background: #2c3340; color: #b6c2d2; }
html.dark-mode .mg-div-detail__winners-rank[data-rank='3'] { background: #43301f; color: #d6a06f; }
.mg-div-detail__winners-team {
  flex: 1 1 auto;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Champion trophy — same `cup.svg` the ParticipationV2 winning team
   uses; replaces the rank chip on the 1st-place row. Matches the rank
   chip's 30px slot so avatars/names stay aligned across rows. */
.mg-div-detail__winners-cup {
  flex: 0 0 auto;
  min-width: 30px;
  height: 18px;
  background: center / 18px 18px no-repeat url('../assets/cup.svg');
}
.mg-div-detail__winners-pending {
  margin: 0;
  font-size: 12px;
  color: var(--secondary);
}
@media (max-width: 520px) {
  .mg-div-detail__stats { grid-template-columns: 1fr; }
  .mg-div-detail__stat { padding: 12px 0; }
  .mg-div-detail__stat:first-child { padding-top: 0; }
  .mg-div-detail__stat:last-child { padding-bottom: 0; }
  .mg-div-detail__stat + .mg-div-detail__stat {
    border-left: 0;
    border-top: 1px solid var(--border-divider);
  }
}
.mg-div-detail__phase-label {
  font-size: 14px;
  color: var(--secondary);
}
/* Heading variant — matches the "Pool Play" games heading above the
   timeline (16px / 600 / --text). */
.mg-div-detail__phase-label--heading {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}
.mg-div-detail__phase-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.mg-div-detail__pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}
/* Status pill floating on the bracket canvas (under the stats line) — a
   soft shadow so the tinted pill reads as lifted over the dotted canvas,
   matching the name / stats pills above it. */
.mg-div-detail__bracket-status-pill {
  align-self: flex-start;
  padding: 4px 12px;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.12);
}
.mg-div-detail__pill--count {
  background: var(--surface-muted, #eef3fb);
  color: var(--text);
  border: 1px solid var(--border-divider);
  min-width: 26px;
  justify-content: center;
}
html.dark-mode .mg-div-detail__pill--count {
  background: rgba(255, 255, 255, 0.06);
}
.mg-div-detail__pill--neutral { background: #eef2f7; color: #5f7186; }
.mg-div-detail__pill--warning { background: var(--light-warning); color: #8c6500; }
.mg-div-detail__pill--success { background: var(--success-light); color: #16763a; }
.mg-div-detail__pill--primary { background: var(--primary-light-3); color: var(--primary); }
.mg-div-detail__pill--danger { background: var(--danger-light); color: #aa2b37; }
html.dark-mode .mg-div-detail__pill--neutral { background: rgba(255, 255, 255, 0.06); color: var(--secondary); }
html.dark-mode .mg-div-detail__pill--warning { color: #f7a120; }
html.dark-mode .mg-div-detail__pill--success { color: #7ad48a; }
html.dark-mode .mg-div-detail__pill--primary { color: #7fb0e8; }
html.dark-mode .mg-div-detail__pill--danger { color: var(--highlight, #ff6b78); }

/* ── Teams (right column card, below the stats card) ── */
/* No body padding — the standings list runs edge-to-edge (zebra rows
   carry their own inset); only the header bar (tabs + Manage) is
   padded. `overflow: hidden` clips the list to the rounded corners. */
.mg-div-detail__teams {
  padding: 0;
  background: var(--white);
  border: 1px solid var(--border-divider);
  border-radius: 8px;
  overflow: hidden;
  /* Fill the remaining height under the stats card so the pool list
     can size its columns to the available space. */
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}
html.dark-mode .mg-div-detail__teams {
  background: var(--surface-card);
}
/* Mobile only — stretch the stats + team-pools cards edge-to-edge
   (cancel the page main's 14px horizontal padding) and drop the
   rounding + side borders so they read as full-width bands. */
@media (max-width: 720px) {
  .mg-div-detail__overview,
  .mg-div-detail__teams {
    margin-inline: -14px;
    border-radius: 0;
    border-left: 0;
    border-right: 0;
  }
  /* Don't clip the teams section — lets the sticky pools header release
     cleanly as the card scrolls past (the paged columns + pager stay). */
  .mg-div-detail__teams,
  .mg-div-detail__pools-paged,
  .mg-div-detail__pool-cols {
    overflow: visible;
    min-height: 0;
  }
  /* Sticky team-pools header — pins just below the division pills while
     the team list is in view, so the Manage / pager controls stay
     reachable. Releases (scrolls up) as the card ends, where the games
     Pool/Bracket tabs + date rows take over the sticky slot. */
  .mg-div-detail__pools-bar {
    position: sticky;
    top: calc(var(--matchgeni-header-height, 56px) + var(--mg-div-pills-h, 0px));
    z-index: 7;
    background: var(--white);
    transition: box-shadow 140ms ease;
  }
  html.dark-mode .mg-div-detail__pools-bar {
    background: var(--surface-card);
  }
  /* Drop shadow only while the header is pinned (stuck class toggled in
     JS, same as the date rows). */
  .mg-div-detail__pools-bar--stuck {
    box-shadow: 0 6px 12px -6px rgba(36, 60, 91, 0.28);
  }
  html.dark-mode .mg-div-detail__pools-bar--stuck {
    box-shadow: 0 6px 12px -6px rgba(0, 0, 0, 0.5);
  }
  /* Games section full-bleed (cancel the page main's 14px padding) so
     the sticky tab + date bars span edge-to-edge; their content is
     re-inset 14px so it doesn't hug the screen edge. */
  .mg-div-detail__games {
    padding: 0;
    margin-inline: -14px;
  }
  .mg-div-detail__games-tabs,
  .mg-div-detail__games--tabs-stuck .mg-div-detail__games-tabs,
  .mg-div-detail__tl-date,
  .mg-div-detail__tl-date--stuck {
    padding-inline: 14px;
  }
  .mg-div-detail__tl-item {
    padding-inline: 14px;
  }
  /* No condensed bar on mobile — drop the stuck tabs' top breathing
     band (desktop-only) so the tab bar sits flush under the division
     pills instead of leaving a gap; keep the date row flush below it. */
  .mg-div-detail__games--tabs-stuck {
    --mg-div-tabs-h: 48px;
  }
  .mg-div-detail__games--tabs-stuck .mg-div-detail__games-tabs {
    padding-top: 0;
  }
}
.mg-div-detail__pools-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
}
.mg-div-detail__pools-manage,
.mg-div-detail__pools-notify {
  flex: 0 0 auto;
  white-space: nowrap;
  /* Compact — match the pager nav buttons' height (don't tower over
     them). */
  height: 28px;
  padding: 0 12px;
  font-size: 13px;
}
/* Primary-outline ghost — same treatment as the Announce-result CTA
   (transparent fill, primary border + label, light hover fill). */
.mg-div-detail__pools-manage.matchgeni-tool-btn--ghost,
.mg-div-detail__pools-notify.matchgeni-tool-btn--ghost {
  border: 1px solid var(--primary, #2563eb);
  background: transparent;
  color: var(--primary, #2563eb);
}
.mg-div-detail__pools-manage.matchgeni-tool-btn--ghost:hover,
.mg-div-detail__pools-notify.matchgeni-tool-btn--ghost:hover {
  background: var(--primary-light-3, #e5f1ff);
  border-color: var(--primary, #2563eb);
}
html.dark-mode .mg-div-detail__pools-manage.matchgeni-tool-btn--ghost:hover,
html.dark-mode .mg-div-detail__pools-notify.matchgeni-tool-btn--ghost:hover {
  background: rgba(45, 140, 240, 0.12);
}
/* Team count — leads the team-pools bar, before Manage. Counter +
   label style (bold number + secondary label), matching the
   dashboard's quick-link heading. */
.mg-div-detail__pools-teams {
  flex: 0 0 auto;
  /* Count leads on the left; the search field beside it takes the slack
     and pushes Manage + the pager to the right edge of the bar. */
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  font-size: 14px;
  color: var(--secondary);
  white-space: nowrap;
}
/* Team search — sits next to the count and flexes to fill the bar. Reuses
   the search-pill look from the division-list / dashboard toolbars. */
.mg-div-detail__pools-search {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 12px;
  border-radius: 5px;
  background: var(--white);
  border: 1px solid var(--border-divider);
  color: var(--secondary);
}
html.dark-mode .mg-div-detail__pools-search {
  background: rgba(255, 255, 255, 0.04);
}
.mg-div-detail__pools-search-input {
  flex: 1 1 auto;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  font: inherit;
  font-size: 13px;
  color: var(--text);
}
.mg-div-detail__pools-teams strong {
  /* No font-weight override — inherits the global `strong { 400 }` so
     the count matches the dashboard quick-link heading (18px, not
     bold). */
  font-size: 18px;
  color: var(--text);
}

/* Paged team pools — fixed-height columns (≤ COLUMN_SIZE teams) shown
   2-up, prev/next to page through. */
.mg-div-detail__pools-paged {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}
/* Pool heading band — full-width when the page is a single pool. */
.mg-div-detail__pool-label {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 8px 20px;
  background: var(--surface-muted, #f4f7fb);
}
html.dark-mode .mg-div-detail__pool-label {
  background: rgba(255, 255, 255, 0.04);
}
/* Per-column heading (multi-pool page) — tighter inline padding so it
   sits over its column. */
.mg-div-detail__pool-label--col {
  padding-inline: 12px;
}
.mg-div-detail__pool-label-name {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--secondary);
}
.mg-div-detail__pool-label-count {
  font-size: 12px;
  color: var(--secondary);
}
.mg-div-detail__pool-cols {
  padding: 6px 0;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}
.mg-div-detail__pool-col {
  min-width: 0;
}
.mg-div-detail__pool-cols--split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  column-gap: 14px;
}
/* Narrow screens — stack the two columns into one. */
@media (max-width: 640px) {
  .mg-div-detail__pool-cols--split {
    grid-template-columns: minmax(0, 1fr);
    row-gap: 6px;
  }
}
/* Pager — prev / "X of Y" / next. Lives on the right of the header bar. */
.mg-div-detail__pool-pager {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
}
.mg-div-detail__pool-pager-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1px solid var(--border-divider);
  background: transparent;
  color: var(--secondary);
  cursor: pointer;
}
.mg-div-detail__pool-pager-btn:hover:not(:disabled) {
  background: rgba(45, 140, 240, 0.08);
  color: var(--text);
}
.mg-div-detail__pool-pager-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.mg-div-detail__pool-pager-icon {
  width: 14px;
  height: 14px;
  background-color: currentColor;
  -webkit-mask: url('../assets/arrow-right.svg') center / contain no-repeat;
  mask: url('../assets/arrow-right.svg') center / contain no-repeat;
}
.mg-div-detail__pool-pager-icon--prev {
  -webkit-mask-image: url('../assets/arrow-left.svg');
  mask-image: url('../assets/arrow-left.svg');
}
.mg-div-detail__pool-pager-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--secondary);
  min-width: 44px;
  text-align: center;
}
/* Tight on mobile — drop the "x / y" page count to save space. */
@media (max-width: 720px) {
  .mg-div-detail__pool-pager-label { display: none; }
}
.mg-div-detail__tab {
  appearance: none;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  padding: 0 18px;
  min-height: 36px;
  background: var(--white);
  border: 1px solid var(--border-divider);
  border-radius: 999px;
  cursor: pointer;
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}
.mg-div-detail__tab:hover:not(.mg-div-detail__tab--active) {
  background: rgba(45, 140, 240, 0.06);
}
.mg-div-detail__tab--active {
  background: var(--primary, #2d8cf0);
  border-color: var(--primary, #2d8cf0);
  color: var(--white, #ffffff);
}
.mg-div-detail__tab--active:hover { background: var(--primary, #2d8cf0); }
html.dark-mode .mg-div-detail__tab { background: var(--surface-card); }
/* Dark mode active tab — outline only (primary border + primary text)
   instead of the bright primary fill, which is too heavy on dark. */
html.dark-mode .mg-div-detail__tab--active {
  background: var(--surface-card);
  border-color: var(--primary);
  color: var(--primary);
}
html.dark-mode .mg-div-detail__tab--active:hover {
  background: var(--surface-card);
}
.mg-div-detail__empty {
  margin: 12px 0 0;
  font-size: 13px;
  color: var(--secondary);
}

/* ── Games timeline (left column card) ── */
.mg-div-detail__games {
  /* Sticky tab-bar band height (36px pills + 12px padding-bottom) — the
     date headers pin below header + condensed bar + this. */
  --mg-div-tabs-h: 48px;
  padding: 0 0 20px;
}
/* Pool Play / Bracket Play tab bar — tabs on the left, the contextual
   Add Bracket action pinned to the right (Bracket Play tab only). Pins
   to the top below the condensed bar on scroll; the timeline date
   headers pin directly beneath it (`--mg-div-tabs-h` offset). Solid
   background + bottom padding (not margin) so the timeline scrolls
   cleanly under the whole band with no see-through gap. */
.mg-div-detail__games-tabs {
  position: sticky;
  /* `--mg-div-pills-h` is non-zero only in the ≤1024 pill layout, where
     the division pills are a sticky band above this — so the tabs pin
     below them. It's 0 on desktop. */
  top: calc(var(--matchgeni-header-height, 56px) + var(--mg-div-condensed-h, 48px) + var(--mg-div-pills-h, 0px));
  /* Above the Pool Play shell's sticky date rows (z-index 4) so a date row
     being pushed up by the next one scrolls BEHIND this bar instead of
     overlapping it. Still below the condensed header (z-index 6). */
  z-index: 5;
  display: flex;
  align-items: center;
  /* Fixed border-box height EQUAL to the `--mg-div-tabs-h` offset the
     date row pins at — so the date row sits flush against this bar's
     bottom in both rest + stuck states (no gap, regardless of the
     heading's intrinsic height or box-sizing). */
  box-sizing: border-box;
  height: var(--mg-div-tabs-h, 48px);
  gap: 10px;
  padding-inline: 10px;
}
/* Single "Pool Play" heading (replaces the old phase tabs — bracket
   play moved to the overview's bracket scroller). */
.mg-div-detail__games-heading {
  /* Match the timeline date-row label (16px / 600 / --text). */
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}
/* Game count — pushed to the right of the Pool Play header row. Same
   plain uppercase treatment as the timeline date-row count. */
.mg-div-detail__games-count {
  margin-left: auto;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--secondary);
  line-height: 1.15;
  white-space: nowrap;
}
/* Format + seed tie-breaker, below the Pool Play title. Negative top
   margin pulls it up into the header band's padding-bottom so the gap
   to the title row is tight (the band's padding can't shrink — it sets
   the sticky `--mg-div-tabs-h` offset). */
.mg-div-detail__games-sub {
  margin: -8px 0 8px;
  padding-inline: 10px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--secondary);
}
/* Pool-format banner — sits just below the Pool Play heading row. Negative
   top margin pulls it up into the header band's padding (matching the old
   sub-line); the 10px inline margins align it with the games column. */
.mg-div-detail__games-banner {
  margin: -4px 10px 10px;
}
/* Banner title row — round-robin format + status pill side by side. */
.mg-div-detail__games-banner-titlerow {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
/* Game count — left-aligned line inside the banner text stack, between the
   round-robin title and the tie-breaker line. */
.mg-div-detail__games-banner-count {
  font-size: 12px;
  font-weight: 700;
  color: var(--primary, #2d8cf0);
}
/* While the tab bar is pinned, add breathing room above the buttons
   (between the condensed bar and the tabs). The band height grows, so
   `--mg-div-tabs-h` bumps in step to keep the date headers flush below
   it. Toggled in JS (no CSS :stuck). */
/* Stuck — only adds the opaque background so timeline rows scroll
   cleanly under the pinned bar. The band height stays `--mg-div-tabs-h`
   (no bump / no extra padding) so the date row pins flush beneath. */
.mg-div-detail__games--tabs-stuck .mg-div-detail__games-tabs {
  background: var(--white);
}
html.dark-mode .mg-div-detail__games--tabs-stuck .mg-div-detail__games-tabs {
  background: var(--surface-card);
}
.mg-div-detail__games-tablist {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}
/* Positioning only — the button shell comes from the shared
   `.matchgeni-tool-btn--ghost` (dashboard Game Scheduler style). */
.mg-div-detail__games-add {
  margin-left: auto;
  flex: 0 0 auto;
}
.mg-div-detail__brackets {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
/* One card per bracket — name + format on the head row, the seeded
   teams that feed it below. */
.mg-div-detail__bracket-card {
  border: 1px solid var(--border-divider);
  border-radius: 8px;
  padding: 12px 14px;
  background: var(--white);
}
/* The whole card is a button that opens the bracket canvas. */
.mg-div-detail__bracket-card--clickable {
  cursor: pointer;
  transition: border-color 120ms ease, background-color 120ms ease, box-shadow 120ms ease;
}
.mg-div-detail__bracket-card--clickable:hover {
  border-color: var(--primary);
  box-shadow: 0 4px 14px rgba(36, 60, 91, 0.08);
}
html.dark-mode .mg-div-detail__bracket-card--clickable:hover {
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
}
.mg-div-detail__bracket-card--clickable:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

/* Bracket canvas stage — full-screen (the host page hides the sidebar
   + drops the main padding to go edge-to-edge), the zoom/pan
   `MatchGeniBracket` fills the viewport below the page header. */
.mg-div-detail__bracket-stage {
  display: flex;
  flex-direction: column;
  height: calc(100vh - var(--matchgeni-header-height, 56px));
  min-height: 460px;
  overflow: hidden;
  /* No background — the canvas paints its own dotted gradient
     (same as the scheduler stage). */
}
/* Empty-state placeholder shown on the canvas when the switched-to
   division has no bracket yet (via MatchGeniBracket's `#empty` slot,
   which already centres it). */
.mg-div-detail__bracket-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 24px;
  text-align: center;
}
.mg-div-detail__bracket-placeholder-title {
  margin: 0;
  font-size: 15px;
  font-weight: 500;
  color: var(--text);
}
/* Canvas overlay context label (top-left name + dates) + the bracket
   switch — mirrors the scheduler's preview overlay. */
.mg-div-detail__bracket-ctx-name {
  max-width: 100%;
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
}
.mg-div-detail__bracket-ctx-dates {
  font-size: 12px;
  font-weight: 400;
  color: var(--secondary);
}
html.dark-mode .mg-div-detail__bracket-ctx-name {
  text-shadow: 0 0 4px #000, 0 0 10px #000, 0 0 18px #000;
}
/* The bracket switch is a horizontal pills RAIL that fills the available
   width on the left of the canvas top bar (the close button takes the
   right). It uses whatever space the bar gives it and scrolls when the
   pills overflow — at every breakpoint, not just mobile — so a division
   with 4-5 brackets never wraps or pushes the close button around.
   Scrollbar hidden (drag / swipe to page), matching the app's other rails. */
.mg-div-detail__bracket-switch {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 8px;
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  scroll-snap-type: x proximity;
  scrollbar-width: none;
  /* The pills carry a soft drop-shadow; an overflow scroller would clip it
     at the top/bottom edges. Pad the rail so the shadow has room to render
     (extra on the bottom for the downward offset), then pull the box back
     with matching negative margins so the rail still lines up with the
     bar's left edge and the meta pill below. */
  padding: 6px 6px 12px;
  margin: -6px -6px -12px;
}
.mg-div-detail__bracket-switch::-webkit-scrollbar {
  display: none;
}
.mg-div-detail__bracket-switch-tab {
  flex: 0 0 auto;
  scroll-snap-align: start;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.12);
  /* The pill is a div now (so it can host the nested edit button); keep
     the gap between the name and the inline edit icon when active. */
  gap: 8px;
}
.mg-div-detail__bracket-switch-label {
  white-space: nowrap;
}
/* Inline edit affordance — only on the active pill. Transparent so it
   inherits the active pill's text colour (white in light mode, primary in
   dark mode); a faint hover wash for feedback. */
.mg-div-detail__bracket-switch-edit {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  margin-right: -6px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition: background-color 120ms ease;
}
.mg-div-detail__bracket-switch-edit:hover {
  background: rgba(255, 255, 255, 0.22);
}
html.dark-mode .mg-div-detail__bracket-switch-edit:hover {
  background: rgba(45, 140, 240, 0.16);
}
.mg-div-detail__bracket-switch-edit .mg-div-detail__edit-icon {
  width: 14px;
  height: 14px;
}
html.dark-mode .mg-div-detail__bracket-card {
  background: var(--surface-card);
}
.mg-div-detail__bracket-head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 10px;
}
/* Type (eyebrow) on row 1; name + status badge on row 2. */
.mg-div-detail__bracket-id {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.mg-div-detail__bracket-eyebrow {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--secondary);
}
.mg-div-detail__bracket-nameline {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.mg-div-detail__bracket-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
/* Icon-only round actions (Edit / Preview), pinned to the right of
   the bracket id block. Tooltips via the shared `.app-tooltip`. */
.mg-div-detail__bracket-actions {
  margin-left: auto;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.mg-div-detail__bracket-iconbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1px solid var(--border-divider);
  background: transparent;
  color: var(--secondary);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}
.mg-div-detail__bracket-iconbtn:hover {
  background: rgba(45, 140, 240, 0.08);
  color: var(--text);
}
html.dark-mode .mg-div-detail__bracket-iconbtn:hover {
  background: rgba(45, 140, 240, 0.16);
}
.mg-div-detail__bracket-iconbtn .mg-div-detail__edit-icon {
  width: 16px;
  height: 16px;
}
.mg-div-detail__bracket-teams {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
}
.mg-div-detail__bracket-team {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.mg-div-detail__bracket-team-name {
  font-size: 13px;
  color: var(--text);
  white-space: nowrap;
}
.mg-div-detail__tl-group {
  display: flex;
  flex-direction: column;
}
.mg-div-detail__tl-date {
  position: sticky;
  /* Below the page header + (pill band, ≤1024) + condensed bar + the
     sticky tab bar. */
  top: calc(var(--matchgeni-header-height, 56px) + var(--mg-div-condensed-h, 48px) + var(--mg-div-pills-h, 0px) + var(--mg-div-tabs-h, 48px));
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  /* 10px inline padding always (matches the stuck state) so the date
     header stays put when it pins. */
  padding: 10px 10px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}
/* Drop shadow only while the date row is pinned (toggled in JS). The
   bleed + clip keeps the shadow on the bottom edge only and lets it
   span the card's horizontal padding so it reads as a full-width
   divider under the pinned date. */
.mg-div-detail__tl-date--stuck {
  padding-inline: 10px;
  /* Opaque so game cards scroll cleanly under the pinned header. */
  background: var(--white);
  box-shadow: 0 6px 10px -6px rgba(36, 60, 91, 0.22);
}
html.dark-mode .mg-div-detail__tl-date--stuck {
  background: var(--surface-card);
  box-shadow: 0 6px 10px -6px rgba(0, 0, 0, 0.45);
}
/* Plain uppercase count (no pill) — same treatment as ParticipationV2's
   day-heading count. */
.mg-div-detail__tl-date-count {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--secondary);
  line-height: 1.15;
}
.mg-div-detail__tl-item {
  display: grid;
  /* Slot snug to the time pill (no dead space on its right), then the
     rail, then the card takes the rest — so the timeline line sits just
     past the pill and the card reclaims the freed width. Fixed (not
     auto) so the rail line stays perfectly vertical across rows. */
  grid-template-columns: 80px 24px minmax(0, 1fr);
  align-items: stretch;
  /* Same inline inset as the date header / tabs so the timeline lines
     up with them. */
  padding-inline: 10px;
}
.mg-div-detail__tl-slot {
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  padding: 14px 0 0 0;
}
.mg-div-detail__tl-time {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 76px;
  padding: 7px 10px;
  border-radius: 12px;
  border: 1px solid var(--border-divider);
  background: var(--surface-card);
  color: var(--secondary);
  font-size: 12px;
  line-height: 1.15;
  text-align: center;
}
.mg-div-detail__tl-time[data-tone='live'] {
  background: var(--danger-light);
  border-color: rgba(255, 90, 104, 0.24);
  color: #aa2b37;
}
.mg-div-detail__tl-time[data-tone='final'] {
  background: var(--primary-light-3);
  border-color: rgba(45, 140, 240, 0.22);
  color: var(--primary);
}
.mg-div-detail__tl-time[data-tone='warning'] {
  background: var(--light-warning);
  border-color: rgba(255, 212, 90, 0.42);
  color: #8c6500;
}
html.dark-mode .mg-div-detail__tl-time[data-tone='live'] { color: var(--highlight, #ff6b78); }
html.dark-mode .mg-div-detail__tl-time[data-tone='final'] { color: #7fb0e8; }
html.dark-mode .mg-div-detail__tl-time[data-tone='warning'] { color: #f7a120; }
.mg-div-detail__tl-time-main { font-weight: 600; }
.mg-div-detail__tl-time[data-tone='muted'] .mg-div-detail__tl-time-main {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.mg-div-detail__tl-time-sub {
  margin-top: 3px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.mg-div-detail__tl-rail {
  position: relative;
}
.mg-div-detail__tl-rail::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 2px;
  transform: translateX(-50%);
  background: var(--border-divider);
}
.mg-div-detail__tl-dot {
  position: absolute;
  top: 20px;
  left: 50%;
  width: 11px;
  height: 11px;
  transform: translateX(-50%);
  border-radius: 999px;
  background: var(--secondary);
  box-shadow: 0 0 0 4px var(--white, #fff);
}
.mg-div-detail__tl-dot[data-tone='live'] { background: #ff5a68; }
.mg-div-detail__tl-dot[data-tone='final'] { background: var(--primary); }
.mg-div-detail__tl-dot[data-tone='warning'] { background: #f0a728; }
.mg-div-detail__tl-dot[data-tone='pending'] { background: var(--secondary); }
.mg-div-detail__tl-card {
  margin: 8px 0;
  padding: 12px 14px;
  border: 1px solid var(--border-divider);
  border-radius: 10px;
  background: var(--surface-card);
  display: flex;
  flex-direction: column;
  /* No gap between the head + meta rows; the teams block adds its own
     top margin to separate from them. */
  gap: 0;
}
/* Whole card is a click target opening the game-details drawer. */
.mg-div-detail__tl-card--clickable {
  cursor: pointer;
  transition: border-color 120ms ease, box-shadow 120ms ease,
    background-color 120ms ease, transform 120ms ease;
}
.mg-div-detail__tl-card--clickable:hover {
  border-color: var(--primary);
  background: var(--primary-light-3, #f0f6ff);
  box-shadow: 0 4px 14px rgba(20, 40, 80, 0.10);
  transform: translateY(-1px);
}
html.dark-mode .mg-div-detail__tl-card--clickable:hover {
  background: rgba(45, 140, 240, 0.08);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
}
.mg-div-detail__tl-card--clickable:active {
  transform: translateY(0);
}
.mg-div-detail__tl-card--clickable:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.mg-div-detail__tl-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 24px;
}
.mg-div-detail__tl-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--primary);
}
/* Actions ellipsis (Edit Game / Mark Not Needed). */
.mg-div-detail__tl-menu-root {
  position: relative;
  flex: 0 0 auto;
}
.mg-div-detail__tl-menu-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: 0;
  background: transparent;
  color: var(--secondary);
  cursor: pointer;
}
.mg-div-detail__tl-menu-btn:hover {
  background: rgba(45, 140, 240, 0.08);
  color: var(--text);
}
html.dark-mode .mg-div-detail__tl-menu-btn:hover {
  background: rgba(45, 140, 240, 0.16);
}
/* Horizontal 3-dot glyph painted with the center dot + two shadows. */
.mg-div-detail__tl-menu-dots,
.mg-div-detail__tl-menu-dots::before,
.mg-div-detail__tl-menu-dots::after {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: currentColor;
}
.mg-div-detail__tl-menu-dots {
  position: relative;
}
.mg-div-detail__tl-menu-dots::before,
.mg-div-detail__tl-menu-dots::after {
  content: '';
  position: absolute;
  top: 0;
}
.mg-div-detail__tl-menu-dots::before { left: -5px; }
.mg-div-detail__tl-menu-dots::after { left: 5px; }
.mg-div-detail__tl-menu { min-width: 170px; }

/* Meta — start/time-limit row, then field + park row, each with a
   masked line icon (participation-v2 schedule-card style). */
.mg-div-detail__tl-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}
.mg-div-detail__tl-meta-item {
  display: inline-flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 12px;
  color: var(--secondary);
  min-width: 0;
}
.mg-div-detail__tl-meta-icon {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  margin-top: 1px;
  background-color: var(--secondary);
}
.mg-div-detail__tl-meta-icon--time {
  -webkit-mask: url('../assets/timer-start.svg') center / contain no-repeat;
  mask: url('../assets/timer-start.svg') center / contain no-repeat;
}
.mg-div-detail__tl-meta-icon--field {
  -webkit-mask: url('../assets/field-line.svg') center / contain no-repeat;
  mask: url('../assets/field-line.svg') center / contain no-repeat;
}
.mg-div-detail__tl-meta-copy {
  display: inline-flex;
  flex-direction: column;
  min-width: 0;
}
.mg-div-detail__tl-meta-sub {
  font-size: 11px;
  color: var(--secondary);
  opacity: 0.85;
}
.mg-div-detail__tl-teams {
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* Separate the teams/score block from the head + meta rows above. */
  margin-top: 10px;
}
.mg-div-detail__tl-team {
  display: flex;
  align-items: center;
  gap: 10px;
}
.mg-div-detail__tl-team-name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mg-div-detail__tl-score {
  flex: 0 0 auto;
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
}

/* Standings loading skeleton — mirrors the new pool-column standings
   layout (pool header → Seed/Win/Loss header → rows with 3 narrow stat
   columns + stacked name/meta; no avatar). */
.mg-div-detail__teams-skeleton {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  /* Side padding so the shimmers aren't flush to the (now unpadded)
     card edges. */
  padding-inline: 20px;
}
/* Pool label row — name (wide) + count (narrow), like
   `.mg-div-detail__pool-label--col`. */
.mg-div-detail__team-skel-poolhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 7px 10px;
}
.mg-div-detail__team-skel-poolname {
  height: 14px;
  width: 90px;
  border-radius: 4px;
}
.mg-div-detail__team-skel-poolcount {
  height: 12px;
  width: 52px;
  border-radius: 4px;
}
/* Header + rows share the real standings grid so the stat columns line
   up exactly: 26px Seed / 26px Win / 26px Loss / team copy. */
.mg-div-detail__team-skel-headrow,
.mg-div-detail__team-skel-row {
  display: grid;
  grid-template-columns: 26px 26px 26px minmax(0, 1fr);
  gap: 6px;
  align-items: center;
  padding: 9px 7px;
}
.mg-div-detail__team-skel-row {
  border-top: 1px solid var(--border-divider);
}
.mg-div-detail__team-skel-headrow .mg-div-detail__team-skel-stat {
  height: 10px;
}
.mg-div-detail__team-skel-stat {
  width: 16px;
  height: 13px;
  border-radius: 4px;
}
.mg-div-detail__team-skel-copy {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.mg-div-detail__team-skel-name {
  height: 13px;
  width: 60%;
  border-radius: 4px;
}
.mg-div-detail__team-skel-meta {
  height: 11px;
  width: 40%;
  border-radius: 4px;
}

/* No row separators on the division-details standings — use a zebra
   (alternating row tint) instead. Scoped override of the shared
   `.division-standings__row` border (doesn't affect Participation V2).
   Slight horizontal padding so the tint band reads as an inset row. */
.division-standings__row {
  /* Row dividers (border between rows) — matches the MatchGeni dashboard
     division listing, replacing the zebra striping. The top border also
     separates the first row from the Seed/Win/Loss header. */
  border-top: 1px solid var(--border-divider);
  border-bottom: none;
  /* Tighter than the shared default (was 14px / 12px) — 5px less on
     each side so more rows fit per paged column. */
  padding: 9px 7px;
}
/* Narrower stat columns + gap (vs the shared 32px / 10px) so the team
   cell keeps enough width for the name + combined meta/location line in
   the 2-up paged layout. Header shares the grid so it stays aligned. */
.division-standings__header,
.division-standings__row {
  grid-template-columns: 26px 26px 26px minmax(0, 1fr);
  gap: 6px;
}
.division-standings--no-seed .division-standings__header,
.division-standings--no-seed .division-standings__row {
  grid-template-columns: 26px 26px minmax(0, 1fr);
}
/* Avatar removed — collapse the team cell's avatar+copy grid to a plain
   block so the copy takes the full cell width (otherwise it lands in the
   old narrow avatar track and truncates to nothing). */
.division-standings__team {
  display: block;
  min-width: 0;
}
/* Keep name + meta to one line each (truncate) so a narrow column
   never blows a row up to several wrapped lines. */
.division-standings__copy strong,
.division-standings__copy span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.division-standings__copy strong {
  font-size: 14px;
}
/* Team meta line (e.g. "Men's 50+ AA - Dallas, TX") — 12px on the
   division-detail standings (overrides the shared 14px). */
.division-standings__copy span {
  font-size: 12px;
}
/* Match the rows' horizontal inset (7px) so the Seed/Win/Loss labels
   stay column-aligned with the row cells; smaller label font so the
   words fit inside the narrow stat columns and read centered. */
.division-standings__header {
  padding: 8px 7px;
  border-bottom: none;
  font-size: 10px;
}
/* Seed / Win / Loss count numbers (the row's direct stat spans). */
.division-standings__row > span {
  font-size: 14px;
}
/* Dark-mode fixes for the shared `.division-standings` list item. */
html.dark-mode .division-standings__header,
html.dark-mode .division-standings__row {
  color: #c4d2e4;
}
html.dark-mode .division-standings__copy span {
  color: #9bb4d2;
}
</style>
