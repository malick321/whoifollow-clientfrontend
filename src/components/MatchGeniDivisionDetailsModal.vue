<script setup lang="ts">
// MatchGeniDivisionDetailsModal
// -----------------------------
// Slide-in details drawer for a single division (`event_tournaments`
// row), opened by clicking a row on the MatchGeni dashboard's
// divisions list. Layout, top → bottom:
//
//   - Header: division name (title) + date range (eyebrow), with a
//     3-dot actions menu pinned to the header's right edge.
//   - Stats strip: Pool / Seed / Brackets phase pills + an overall
//     progress bar.
//   - Root-level lifecycle CTA (conditional):
//       · "Generate Pool"  — when the pool isn't generated yet.
//       · "Start Bracket"  — when seeds are generated but the bracket
//         hasn't started.
//   - Team pools list: seed / win / loss + team identity, reusing the
//     participation portal's `.division-standings` list item (global
//     classes in styles.css) so the two surfaces read identically.
//
// Actions menu (gated by `manage_divisions`):
//     Edit Division · Seed Criteria
//     ───────────────────────────────────────
//     Add Bracket · Regenerate Pool · Manage Seed
//     ───────────────────────────────────────
//     Delete Division (danger)
//
// All actions emit up to the parent; backend wiring lands in a
// follow-up (the parent stubs them with toasts for now).

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import SlideModal from './SlideModal.vue'
import TeamAvatar from './TeamAvatar.vue'
import { canMatchGeniWrite } from '../matchgeni-context'
import { fetchDivisionOverviewStandings } from '../api/divisionOverview'
import type { DivisionStandingEntry, EventTournament, SchedulerGame } from '../types'

const props = withDefaults(defineProps<{
  modelValue: boolean
  division: EventTournament | null
  /** Parent event name — shown as the header subtitle. */
  eventName?: string
}>(), {
  division: null,
  eventName: ''
})

export type DivisionDetailsAction =
  | 'edit-division'
  | 'add-bracket'
  | 'regenerate-pool'
  | 'manage-team-pools'
  // Lifebook menu (header button)
  | 'attach-lifebook'
  | 'replace-lifebook'
  | 'detach-lifebook'
  // Workflow-action button (single contextual CTA next to the
  // progress bar) — one of these depending on lifecycle state.
  | 'generate-pool'
  | 'generate-seed'
  | 'initiate-bracket'
  | 'undo-initiate'

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'action', action: DivisionDetailsAction, division: EventTournament): void
}>()

// ── Phase helpers (mirror MatchGeniDivisionList) ─────────────────
// Status → StatusBadge tone (same mapping as the dashboard division
// list): pending→neutral, generated→warning, in_progress→success,
// completed→primary, locked→danger.
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

// ── Permission gate for the header actions (Edit / Add Bracket) ──
const canManageDivisions = computed(() => canMatchGeniWrite('manage_divisions'))

// ── Division workflow action ─────────────────────────────────────
// One contextual CTA shown next to the progress bar, driven by where
// the division sits in its lifecycle:
//   pool pending      → Generate Pool Play
//   pool generated    → Regenerate Pool Play
//   pool in progress  → (no action — games are being played)
//   pool completed
//     seed pending    → Generate Seed
//     seed generated/locked
//       bracket pending   → Initiate Bracket
//       bracket generated → Undo Initiate (only until the first game
//                           is scored, when bracket flips to in
//                           progress automatically)
//       bracket in progress / completed → (no action)
// Gated by `manage_divisions`; returns null when there's nothing to do.
const workflowAction = computed<{ label: string; action: DivisionDetailsAction } | null>(() => {
  const div = props.division
  if (!div || !canManageDivisions.value) return null
  switch (div.poolStatus) {
    case 'pending': return { label: 'Generate Pool Play', action: 'generate-pool' }
    case 'generated': return { label: 'Regenerate Pool Play', action: 'regenerate-pool' }
    case 'in_progress': return null
  }
  // poolStatus === 'completed'
  if (div.seedStatus === 'pending') return { label: 'Generate Seed', action: 'generate-seed' }
  // seeds generated / locked → bracket stage
  if (div.bracketsStatus === 'pending') return { label: 'Initiate Bracket', action: 'initiate-bracket' }
  if (div.bracketsStatus === 'generated') return { label: 'Undo Initiate', action: 'undo-initiate' }
  return null
})

// ── Header actions ───────────────────────────────────────────────
function onAction(action: DivisionDetailsAction) {
  if (props.division) emit('action', action, props.division)
}

// ── Lifebook menu (header button) ────────────────────────────────
// Mock attachment state — some divisions arrive with a lifebook
// attached so both menu shapes (attach vs replace/detach) are visible.
// TODO: source the attached lifebook from the division payload.
const lifebookName = ref<string | null>(null)
const lifebookAttached = computed(() => !!lifebookName.value)
const lifebookCount = computed(() => (lifebookAttached.value ? 1 : 0))
const lifebookMenuOpen = ref(false)
const lifebookMenuRootRef = ref<HTMLElement | null>(null)

function resetLifebook(division: EventTournament | null) {
  // Even-id divisions start with a lifebook attached (mock).
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
function onLifebook(action: DivisionDetailsAction) {
  closeLifebookMenu()
  // Demo: reflect the change locally so the menu flips immediately.
  if (action === 'attach-lifebook') lifebookName.value = 'WIF Lifebook 2026'
  else if (action === 'replace-lifebook') lifebookName.value = 'WIF Lifebook 2027'
  else if (action === 'detach-lifebook') lifebookName.value = null
  if (props.division) emit('action', action, props.division)
}

function onDocumentMouseDown(event: MouseEvent) {
  const target = event.target as Node | null
  if (lifebookMenuOpen.value && lifebookMenuRootRef.value && target && !lifebookMenuRootRef.value.contains(target)) {
    closeLifebookMenu()
  }
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && lifebookMenuOpen.value) {
    event.stopPropagation()
    closeLifebookMenu()
  }
}

// ── Standings (team pools) ───────────────────────────────────────
const standings = ref<DivisionStandingEntry[]>([])
const isSeedGenerated = ref(false)
const standingsLoading = ref(false)
let loadToken = 0

// Group the flat standings into pools rendered as tabs (scheduler
// pill style). Chunked by `POOL_SIZE` — the live standings payload
// doesn't carry per-team pool assignments yet, so this client-side
// grouping stands in; swap to the backend's pool grouping when it
// flows through. A division with one chunk shows a single "Pool 1"
// tab.
const POOL_SIZE = 4
const activePoolIndex = ref(0)
const pools = computed<{ name: string; teams: DivisionStandingEntry[] }[]>(() => {
  const list = standings.value
  const groups: { name: string; teams: DivisionStandingEntry[] }[] = []
  for (let i = 0; i < list.length; i += POOL_SIZE) {
    groups.push({ name: `Pool ${groups.length + 1}`, teams: list.slice(i, i + POOL_SIZE) })
  }
  return groups
})
const activePoolTeams = computed(() => pools.value[activePoolIndex.value]?.teams ?? [])

/** The pools bar (tabs + "Manage Team Pools") renders once standings
 *  resolve and there's something to show in it — the tabs (>1 pool)
 *  and/or the manage button (permission-gated). */
const showPoolsBar = computed(() =>
  !standingsLoading.value &&
  pools.value.length > 0 &&
  (pools.value.length > 1 || canManageDivisions.value)
)

// Seed criteria — the backend value (`tieBreakerText`), shown verbatim.
// Fallback is comma-separated (not "x then y then z").
const FALLBACK_SEED_CRITERIA = 'Win %, head-to-head, run differential'
const seedCriteriaText = ref(FALLBACK_SEED_CRITERIA)

// Pool-play guarantee + bracket format mocks. TODO: source
// `poolPlayGuaranteedGames` + `bracketFormat` from the division
// payload once they flow through (EventTournament doesn't carry them
// yet).
const MOCK_POOL_GAMES = 3
const MOCK_BRACKET_FORMAT = 'Single Elimination'
const MOCK_BRACKET_NAMES = ['Gold', 'Silver', 'Bronze', 'Platinum', 'Open']
/** Pool-play guarantee shown inside the Pool stat card, as
 *  "{N} game round robin". */
const poolPlayText = computed(() => `${MOCK_POOL_GAMES} game round robin`)
/** Bracket type shown inside the Brackets stat card when the division
 *  has NO brackets yet (just the format, no seed ranges). */
const bracketTypeText = computed(() => MOCK_BRACKET_FORMAT)

/** Number of top seeds that advance into the bracket(s). TODO: source
 *  from the bracket payload; mocked as (teams − 1) for the demo. */
const bracketSeedCount = computed(() =>
  props.division ? Math.max(2, props.division.teamCount - 1) : 0
)
/** "X Teams, Y Games" shown in the Pool Play card. Y mocked as
 *  pool-play games (each team plays MOCK_POOL_GAMES) + single-elim
 *  bracket games. TODO: real game count from the schedule. */
const teamsGamesText = computed(() => {
  const div = props.division
  if (!div) return ''
  const poolGames = Math.ceil((div.teamCount * MOCK_POOL_GAMES) / 2)
  const bracketGames = Math.max(0, bracketSeedCount.value - 1)
  const total = poolGames + bracketGames
  return `${div.teamCount} Teams, ${total} Games`
})

/** Per-bracket descriptor lines shown inside the Brackets stat card —
 *  one per bracket: "#x to #y play <name> <type> bracket". The seed
 *  pool (#1…#bracketSeedCount) is split across the brackets. Empty
 *  when the division has no brackets (the card then shows just the
 *  bracket type). TODO: real bracket name / type / seed ranges from
 *  the bracket payload. */
const bracketLines = computed<string[]>(() => {
  const div = props.division
  if (!div || div.bracketsCount <= 0) return []
  const count = div.bracketsCount
  const totalSeeds = bracketSeedCount.value
  const perBracket = Math.max(1, Math.ceil(totalSeeds / count))
  const lines: string[] = []
  let start = 1
  for (let i = 0; i < count; i++) {
    const end = Math.min(totalSeeds, start + perBracket - 1)
    const name = MOCK_BRACKET_NAMES[i] ?? `Bracket ${i + 1}`
    lines.push(`#${start} to #${end} play ${name} ${MOCK_BRACKET_FORMAT} bracket`)
    start = end + 1
  }
  return lines
})

// ── Division games (timeline) ────────────────────────────────────
// Mock games for the division, rendered below the team pools as a
// date-grouped timeline (same visual language as the team
// participation portal's schedule). TODO: source real games from the
// games API; `EventTournament` carries no games yet.
const GAME_CITY_TEAMS = ['Dallas Hawks', 'Austin Bandits', 'Phoenix Storm', 'Denver Rangers', 'Tampa Aces', 'Reno Lions', 'Mesa Bulls', 'Boise Owls']
const GAME_DATES = ['2026-05-12', '2026-05-13', '2026-05-14']
const GAME_TIMES = ['09:00 AM', '10:30 AM', '12:00 PM', '01:30 PM', '03:00 PM']
const GAME_FIELDS = ['Field 1', 'Field 2', 'Field 3', 'Field 4']
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
      team1Score: scored ? 3 + ((g * 2) % 5) : undefined,
      team2Score: scored ? 1 + ((g * 3) % 4) : undefined
    })
  }
  // One still-unscheduled game so the "Unscheduled" group renders.
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
  return games
})

interface GameDateGroup { key: string; label: string; games: SchedulerGame[] }
const gameGroups = computed<GameDateGroup[]>(() => {
  const byDate = new Map<string, GameDateGroup>()
  const unscheduled: SchedulerGame[] = []
  for (const game of divisionGames.value) {
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
function gameHasScore(game: SchedulerGame): boolean {
  return game.team1Score != null && game.team2Score != null
}
/** Time-pill main label. */
function gameTimeMain(game: SchedulerGame): string {
  return game.scheduledTime ?? 'TBD'
}
/** Time-pill sub label = status. */
function gameTimeSub(game: SchedulerGame): string {
  switch (game.status) {
    case 'live': return 'Live'
    case 'final': return 'Final'
    case 'delayed': return 'Delayed'
    default: return game.scheduledDate ? 'Scheduled' : ''
  }
}
/** Time-pill tone (participation timeline tones). */
function gameSlotTone(game: SchedulerGame): string {
  if (!game.scheduledDate) return 'muted'
  switch (game.status) {
    case 'live': return 'live'
    case 'final': return 'final'
    case 'delayed': return 'warning'
    default: return ''
  }
}
/** Rail-dot tone. */
function gameDotTone(game: SchedulerGame): string {
  switch (game.status) {
    case 'live': return 'live'
    case 'final': return 'final'
    case 'delayed': return 'warning'
    default: return 'pending'
  }
}

/** Deterministic mock standings used as a fallback when the live
 *  `getSelectedTournamentTeams` lookup returns nothing (the dashboard
 *  mock divisions don't resolve against the live endpoint). Keeps the
 *  list populated for the demo; swap point disappears once the real
 *  divisions flow through. */
function buildMockStandings(division: EventTournament): DivisionStandingEntry[] {
  const cities = [
    ['Dallas', 'TX'], ['Austin', 'TX'], ['Phoenix', 'AZ'], ['Denver', 'CO'],
    ['Tampa', 'FL'], ['Reno', 'NV'], ['Mesa', 'AZ'], ['Boise', 'ID']
  ]
  const count = Math.max(division.teamCount, 0)
  const seeded = division.seedStatus !== 'pending'
  return Array.from({ length: count }, (_, i) => {
    const wins = (i * 3 + 2) % 6
    const losses = (i * 2 + 1) % 5
    const [city, state] = cities[i % cities.length]
    return {
      seed: seeded ? i + 1 : 0,
      wins,
      losses,
      teamName: `#${i + 1}: ${city} ${['Hawks', 'Bandits', 'Storm', 'Rangers', 'Aces', 'Lions'][i % 6]}`,
      teamMeta: "Men's 50+ - AA",
      location: `${city}, ${state}`,
      imageUrl: undefined
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
  // Clear any standings from a previously-opened division so the
  // shimmer skeleton shows (instead of stale rows) while this fetch
  // is in flight. Reset the active pool tab too.
  standings.value = []
  activePoolIndex.value = 0
  // Seed the seed-column visibility from the division's own status so
  // the header renders correctly even before the standings resolve.
  isSeedGenerated.value = division.seedStatus !== 'pending'
  // Reset seed criteria to the demo fallback for each open; the fetch
  // below overrides it when the payload carries real text.
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

watch(
  () => [props.modelValue, props.division] as const,
  ([open]) => {
    if (open) {
      loadStandings(props.division)
      resetLifebook(props.division)
    } else {
      closeLifebookMenu()
    }
  }
)

onMounted(() => {
  document.addEventListener('mousedown', onDocumentMouseDown)
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentMouseDown)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <SlideModal
    :model-value="modelValue"
    :title="division?.tournamentName ?? 'Division'"
    :eyebrow="division?.dateRangeLabel ?? ''"
    :subtitle="eventName"
    @update:modelValue="emit('update:modelValue', $event)"
  >
    <!-- Header actions — Edit + Lifebook + Add, pinned to the header's
         right edge via the SlideModal `#header-actions` slot. -->
    <template v-if="division" #header-actions>
      <div class="mg-div-detail__header-actions">
        <!-- Edit Division -->
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

        <!-- Lifebook button — icon + attachment counter. The menu
             offers Attach (when none) or Replace + Detach (when a
             lifebook is attached, with the current name as an eyebrow). -->
        <div ref="lifebookMenuRootRef" class="mg-div-detail__menu-root">
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

        <!-- Add Bracket — single direct action (no dropdown). -->
        <button
          v-if="canManageDivisions"
          type="button"
          class="mg-div-detail__icon-btn"
          aria-label="Add Bracket"
          @click="onAction('add-bracket')"
        >
          <span class="mg-div-detail__add-icon" aria-hidden="true"></span>
          <span>Add Bracket</span>
        </button>
      </div>
    </template>

    <div v-if="division" class="mg-div-detail">
      <!-- Overview card — one bordered card. Row 1: the three phase
           stats (Pool / Seed / Brackets) split by vertical dividers
           (no per-stat borders). Row 2: the overall-progress bar. -->
      <section class="mg-div-detail__overview">
        <div class="mg-div-detail__stats">
          <div class="mg-div-detail__stat">
            <div class="mg-div-detail__stat-head">
              <span class="mg-div-detail__phase-label">Pool Play</span>
              <span class="mg-div-detail__pill" :class="phaseToneClass(division.poolStatus)">{{ phaseLabel(division.poolStatus) }}</span>
            </div>
            <span class="mg-div-detail__stat-sub">{{ poolPlayText }}</span>
            <span class="mg-div-detail__stat-sub">{{ teamsGamesText }}</span>
          </div>
          <div class="mg-div-detail__stat">
            <div class="mg-div-detail__stat-head">
              <span class="mg-div-detail__phase-label">Seed</span>
              <span class="mg-div-detail__pill" :class="phaseToneClass(division.seedStatus)">{{ phaseLabel(division.seedStatus) }}</span>
            </div>
            <span class="mg-div-detail__stat-sub">{{ seedCriteriaText }}</span>
          </div>
          <div class="mg-div-detail__stat">
            <div class="mg-div-detail__stat-head">
              <span class="mg-div-detail__phase-label">Brackets</span>
              <span class="mg-div-detail__phase-row">
                <span class="mg-div-detail__pill mg-div-detail__pill--count">{{ division.bracketsCount }}</span>
                <span class="mg-div-detail__pill" :class="phaseToneClass(division.bracketsStatus)">{{ phaseLabel(division.bracketsStatus) }}</span>
              </span>
            </div>
            <!-- No brackets yet → just the bracket type; otherwise one
                 "#x to #y play <name> <type> bracket" line per bracket. -->
            <span v-if="bracketLines.length === 0" class="mg-div-detail__stat-sub">{{ bracketTypeText }}</span>
            <span
              v-for="line in bracketLines"
              v-else
              :key="line"
              class="mg-div-detail__stat-sub"
            >{{ line }}</span>
          </div>
        </div>

        <!-- Progress row — straight bar on the left, the contextual
             workflow-action CTA on the right. -->
        <div class="mg-div-detail__progress-row">
          <div class="mg-div-detail__progress" :aria-label="`${division.progressPercent}% complete`">
            <div class="mg-div-detail__progress-head">
              <span>Overall progress</span>
              <strong>{{ division.progressPercent }}%</strong>
            </div>
            <div class="mg-div-detail__progress-track">
              <div class="mg-div-detail__progress-fill" :style="{ width: `${division.progressPercent}%` }"></div>
            </div>
          </div>
          <button
            v-if="workflowAction"
            type="button"
            class="mg-div-detail__workflow-cta"
            @click="onAction(workflowAction.action)"
          >{{ workflowAction.label }}</button>
        </div>
      </section>

      <!-- Team pools — each pool is a tab (scheduler pill style); the
           active pool's teams render in the participation portal's
           `.division-standings` list item (global classes). -->
      <section class="mg-div-detail__teams">
        <!-- Pools bar — tabs on the left (only when the division runs
             MORE than one pool), "Manage Team Pools" button on the
             right (permission-gated). -->
        <div v-if="showPoolsBar" class="mg-div-detail__pools-bar">
          <div
            v-if="pools.length > 1"
            class="mg-div-detail__pool-tabs"
            role="tablist"
            aria-label="Team pools"
          >
            <button
              v-for="(pool, i) in pools"
              :key="pool.name"
              type="button"
              role="tab"
              class="mg-div-detail__tab"
              :class="{ 'mg-div-detail__tab--active': i === activePoolIndex }"
              :aria-selected="i === activePoolIndex"
              @click="activePoolIndex = i"
            >{{ pool.name }}</button>
          </div>
          <button
            v-if="canManageDivisions"
            type="button"
            class="secondary-button mg-div-detail__pools-manage"
            @click="onAction('manage-team-pools')"
          >Manage Team Pools</button>
        </div>

        <!-- Shimmer placeholders while the standings fetch is in
             flight — mirrors the standings row shape (stat blocks +
             avatar + two text lines) so the list paints in place. -->
        <div
          v-if="standingsLoading && standings.length === 0"
          class="mg-div-detail__teams-skeleton"
          aria-busy="true"
        >
          <div
            v-for="n in 5"
            :key="`team-skel-${n}`"
            class="mg-div-detail__team-skel-row"
          >
            <span class="shimmer-block mg-div-detail__team-skel-stat"></span>
            <span class="shimmer-block mg-div-detail__team-skel-stat"></span>
            <span class="shimmer-circle mg-div-detail__team-skel-avatar"></span>
            <span class="mg-div-detail__team-skel-copy">
              <span class="shimmer-block mg-div-detail__team-skel-name"></span>
              <span class="shimmer-block mg-div-detail__team-skel-meta"></span>
            </span>
          </div>
        </div>

        <p v-else-if="standings.length === 0" class="mg-div-detail__empty">No teams in this division yet.</p>

        <div
          v-else
          class="division-standings"
          :class="{ 'division-standings--no-seed': !isSeedGenerated }"
        >
          <div class="division-standings__header">
            <span v-if="isSeedGenerated">Seed</span>
            <span>Win</span>
            <span>Loss</span>
          </div>
          <div
            v-for="entry in activePoolTeams"
            :key="`${entry.seed}-${entry.teamName}`"
            class="division-standings__row"
          >
            <span v-if="isSeedGenerated">{{ entry.seed }}</span>
            <span>{{ entry.wins }}</span>
            <span>{{ entry.losses }}</span>
            <div class="division-standings__team">
              <TeamAvatar :name="entry.teamName" :image-url="entry.imageUrl" size="md" />
              <div class="division-standings__copy">
                <strong>{{ entry.teamName }}</strong>
                <span>{{ entry.teamMeta }}</span>
                <span>{{ entry.location }}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Games — date-grouped timeline (same visual language as the
           team participation portal's schedule). -->
      <section class="mg-div-detail__games">
        <h3 class="mg-div-detail__games-title">Games</h3>
        <p v-if="divisionGames.length === 0" class="mg-div-detail__empty">No games scheduled yet.</p>
        <div v-else class="mg-div-detail__tl">
          <div
            v-for="group in gameGroups"
            :key="group.key"
            class="mg-div-detail__tl-group"
          >
            <div class="mg-div-detail__tl-date">
              <span class="mg-div-detail__tl-date-label">{{ group.label }}</span>
              <span class="mg-div-detail__tl-date-count">{{ group.games.length }}</span>
            </div>
            <div
              v-for="game in group.games"
              :key="game.id"
              class="mg-div-detail__tl-item"
            >
              <div class="mg-div-detail__tl-slot">
                <span class="mg-div-detail__tl-time" :data-tone="gameSlotTone(game)">
                  <span class="mg-div-detail__tl-time-main">{{ gameTimeMain(game) }}</span>
                  <span v-if="gameTimeSub(game)" class="mg-div-detail__tl-time-sub">{{ gameTimeSub(game) }}</span>
                </span>
              </div>
              <div class="mg-div-detail__tl-rail" aria-hidden="true">
                <span class="mg-div-detail__tl-dot" :data-tone="gameDotTone(game)"></span>
              </div>
              <article class="mg-div-detail__tl-card">
                <div class="mg-div-detail__tl-card-head">
                  <span class="mg-div-detail__tl-label">{{ game.label }}</span>
                  <span v-if="game.scheduledFieldLabel" class="mg-div-detail__tl-venue">{{ game.scheduledFieldLabel }}</span>
                </div>
                <div class="mg-div-detail__tl-teams">
                  <div class="mg-div-detail__tl-team">
                    <TeamAvatar :name="game.team1Label ?? ''" size="md" />
                    <span class="mg-div-detail__tl-team-name">{{ game.team1Label }}</span>
                    <span v-if="gameHasScore(game)" class="mg-div-detail__tl-score">{{ game.team1Score }}</span>
                  </div>
                  <div class="mg-div-detail__tl-team">
                    <TeamAvatar :name="game.team2Label ?? ''" size="md" />
                    <span class="mg-div-detail__tl-team-name">{{ game.team2Label }}</span>
                    <span v-if="gameHasScore(game)" class="mg-div-detail__tl-score">{{ game.team2Score }}</span>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </div>
      </section>
    </div>
  </SlideModal>
</template>

<!-- Non-scoped, but tightly qualified to THIS drawer via `:has()`.
     1. The shared SlideModal body reserves a stable scrollbar gutter
        (`scrollbar-gutter: stable`) to avoid layout shift on tall
        forms. This drawer's content is usually short (few teams) so
        it never scrolls — the reserved gutter then reads as empty
        space on the right. Drop it here so the content sits
        symmetrically.
     2. Zero the body padding so the overview card can sit flush to the
        top/left/right edges; per-section padding (20px) is applied
        inside `.mg-div-detail` instead. -->
<style>
.slide-modal-panel__body:has(.mg-div-detail) {
  scrollbar-gutter: auto;
  padding: 0;
}
</style>

<style scoped>
.mg-div-detail {
  display: flex;
  flex-direction: column;
  gap: 20px;
  /* Body padding is zeroed for this drawer (see the global `:has`
     rule) so the overview card can sit flush at the top/sides. The
     bottom gets the standard 20px inset; sections below the overview
     add their own 20px horizontal padding. */
  padding-bottom: 20px;
}

/* ── Header actions (Lifebook + Edit + 3-dot) ── */
.mg-div-detail__header-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.mg-div-detail__menu-root {
  position: relative;
}
/* Shared bordered icon button (edit / 3-dot / lifebook). */
.mg-div-detail__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 32px;
  height: 32px;
  padding: 0 10px;
  border-radius: 6px;
  background: transparent;
  border: 1px solid var(--border-divider);
  color: var(--secondary);
  font-size: 13px;
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
/* Lifebook glyph — masked so it tints to `currentColor`. */
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
/* Edit glyph (theme edit.svg), masked to `currentColor`. */
.mg-div-detail__edit-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  background-color: currentColor;
  -webkit-mask: url('../assets/edit.svg') center / contain no-repeat;
  mask: url('../assets/edit.svg') center / contain no-repeat;
}
/* Add glyph (theme add.svg), masked to `currentColor`. */
.mg-div-detail__add-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  background-color: currentColor;
  -webkit-mask: url('../assets/add.svg') center / contain no-repeat;
  mask: url('../assets/add.svg') center / contain no-repeat;
}
/* Pin the menu below the trigger; min-width fits the longer labels. */
.mg-div-detail__menu {
  min-width: 180px;
}
/* Current-lifebook header inside the lifebook menu (eyebrow + name). */
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

/* ── Overview card — full-bleed banner at the top of the drawer
   (flush to the header bottom + both side edges, no top/left/right
   padding). Only the bottom border separates it from the content
   below. Holds the three phase stats (row 1, split by vertical
   dividers) + the progress bar (row 2). Internal horizontal padding
   is 20px so its content lines up with the sections below. */
.mg-div-detail__overview {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px 20px;
  border: 0;
  border-bottom: 1px solid var(--border-divider);
  border-radius: 0;
  background: var(--surface-card, #fff);
}
html.dark-mode .mg-div-detail__overview {
  background: rgba(255, 255, 255, 0.03);
}
/* Row 1 — three phase stats. No per-stat borders; a vertical divider
   sits between adjacent stats. */
.mg-div-detail__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
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
.mg-div-detail__stat:first-child {
  padding-left: 0;
}
.mg-div-detail__stat:last-child {
  padding-right: 0;
}
.mg-div-detail__stat + .mg-div-detail__stat {
  border-left: 1px solid var(--border-divider);
}
/* Stat head — label on the left, status / counter badges on the
   right, on a single row. */
.mg-div-detail__stat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
/* Contextual sub-line inside each phase stat. Primary text color
   (theme-aware var(--text) handles dark mode automatically). */
.mg-div-detail__stat-sub {
  font-size: 11.5px;
  line-height: 1.35;
  color: var(--text);
}
/* Progress row — bar (left) + workflow CTA (right), second row of the
   overview card, set off by a top divider. */
.mg-div-detail__progress-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--border-divider);
}
.mg-div-detail__progress {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
/* Contextual workflow CTA (Generate Pool Play / Generate Seed /
   Initiate Bracket / Undo Initiate …). Primary pill, hugs its width. */
.mg-div-detail__workflow-cta {
  flex: 0 0 auto;
  white-space: nowrap;
  appearance: none;
  border: none;
  border-radius: 8px;
  background: var(--primary, #2563eb);
  /* `var(--white)` flips to dark text on the bright-blue primary in
     dark mode — matches the dashboard's "Add Division" button. */
  color: var(--white, #ffffff);
  font-weight: 600;
  font-size: 13px;
  padding: 9px 16px;
  cursor: pointer;
  transition: filter 120ms ease;
}
.mg-div-detail__workflow-cta:hover {
  filter: brightness(1.06);
}
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
/* Narrow panels — stack the three stats vertically with horizontal
   dividers (the long seed-criteria sub-line needs the full width). */
@media (max-width: 520px) {
  .mg-div-detail__stats {
    grid-template-columns: 1fr;
  }
  .mg-div-detail__stat {
    padding: 12px 0;
  }
  .mg-div-detail__stat:first-child {
    padding-top: 0;
  }
  .mg-div-detail__stat:last-child {
    padding-bottom: 0;
  }
  .mg-div-detail__stat + .mg-div-detail__stat {
    border-left: 0;
    border-top: 1px solid var(--border-divider);
  }
}
.mg-div-detail__phase-label {
  font-size: 12px;
  color: var(--secondary);
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
/* Tone tints mirror the StatusBadge palette (same mapping as the
   dashboard division list). pending→neutral, generated→warning,
   in_progress→success, completed→primary, locked→danger. */
.mg-div-detail__pill--neutral {
  background: #eef2f7;
  color: #5f7186;
}
.mg-div-detail__pill--warning {
  background: var(--light-warning);
  color: #8c6500;
}
.mg-div-detail__pill--success {
  background: var(--success-light);
  color: #16763a;
}
.mg-div-detail__pill--primary {
  background: var(--primary-light-3);
  color: var(--primary);
}
.mg-div-detail__pill--danger {
  background: var(--danger-light);
  color: #aa2b37;
}
html.dark-mode .mg-div-detail__pill--neutral {
  background: rgba(255, 255, 255, 0.06);
  color: var(--secondary);
}
html.dark-mode .mg-div-detail__pill--warning {
  color: #f7a120;
}
html.dark-mode .mg-div-detail__pill--success {
  color: #7ad48a;
}
html.dark-mode .mg-div-detail__pill--primary {
  color: #7fb0e8;
}
html.dark-mode .mg-div-detail__pill--danger {
  color: var(--highlight, #ff6b78);
}

/* ── Teams ── */
/* Standard 20px horizontal inset for the team-pools section (the
   overview card above is full-bleed; everything else is inset). */
.mg-div-detail__teams {
  padding: 0 20px;
}
/* Pools bar — tabs (left) + "Manage Team Pools" button (right). */
.mg-div-detail__pools-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}
.mg-div-detail__pools-manage {
  /* Pin the button to the row's right edge regardless of whether the
     tabs (left) are present. */
  margin-left: auto;
  flex: 0 0 auto;
  white-space: nowrap;
}
/* Pool tabs — same pill style as the scheduler's Pool / Brackets
   tabs (`.scheduler__tab`). One pill per team pool. */
.mg-div-detail__pool-tabs {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
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
  /* `var(--white)` (not hardcoded #fff) so the label flips to dark
     text on the bright-blue primary in dark mode — same treatment as
     the dashboard's "Add Division" button. */
  color: var(--white, #ffffff);
}
.mg-div-detail__tab--active:hover {
  background: var(--primary, #2d8cf0);
}
html.dark-mode .mg-div-detail__tab {
  background: var(--surface-card);
}
/* Active tab in dark mode — must re-assert the bright primary fill so
   it beats the `html.dark-mode .mg-div-detail__tab` rule above (the
   active button also carries the base `__tab` class). The bright-blue
   fill keeps the dark `var(--white)` label readable. */
html.dark-mode .mg-div-detail__tab--active {
  background: var(--primary);
  border-color: var(--primary);
}
.mg-div-detail__empty {
  margin: 12px 0 0;
  font-size: 13px;
  color: var(--secondary);
}

/* ── Games timeline (date-grouped, team-participation-portal style) ── */
.mg-div-detail__games {
  padding: 0 20px;
}
.mg-div-detail__games-title {
  margin: 0 0 4px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--secondary);
}
.mg-div-detail__tl-group {
  display: flex;
  flex-direction: column;
}
.mg-div-detail__tl-date {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 0 4px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.mg-div-detail__tl-date-count {
  background: var(--primary-light-3);
  color: var(--secondary);
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}
html.dark-mode .mg-div-detail__tl-date-count {
  background: rgba(45, 140, 240, 0.18);
  color: var(--text);
}
/* Three-column timeline row: time pill | rail + dot | card. */
.mg-div-detail__tl-item {
  display: grid;
  grid-template-columns: 92px 24px minmax(0, 1fr);
  align-items: stretch;
}
.mg-div-detail__tl-slot {
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  padding: 14px 12px 0 0;
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
html.dark-mode .mg-div-detail__tl-time[data-tone='live'] {
  color: var(--highlight, #ff6b78);
}
html.dark-mode .mg-div-detail__tl-time[data-tone='final'] {
  color: #7fb0e8;
}
html.dark-mode .mg-div-detail__tl-time[data-tone='warning'] {
  color: #f7a120;
}
.mg-div-detail__tl-time-main {
  font-weight: 600;
}
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
/* Rail with a status dot. */
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
/* Game card. */
.mg-div-detail__tl-card {
  margin: 8px 0;
  padding: 12px 14px;
  border: 1px solid var(--border-divider);
  border-radius: 10px;
  background: var(--surface-card);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mg-div-detail__tl-card-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.mg-div-detail__tl-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--primary);
}
.mg-div-detail__tl-venue {
  font-size: 12px;
  color: var(--secondary);
}
.mg-div-detail__tl-teams {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mg-div-detail__tl-team {
  display: flex;
  align-items: center;
  gap: 10px;
}
.mg-div-detail__tl-team-name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
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

/* Standings loading skeleton — one shimmer row per team, shaped like
   the real `.division-standings__row` (two stat blocks + avatar +
   stacked name/meta) so the list doesn't jump when data resolves. */
.mg-div-detail__teams-skeleton {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
}
.mg-div-detail__team-skel-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 0;
  border-bottom: 1px solid var(--border-divider);
}
.mg-div-detail__team-skel-stat {
  width: 18px;
  height: 14px;
  border-radius: 4px;
  flex: 0 0 auto;
}
.mg-div-detail__team-skel-avatar {
  width: 36px;
  height: 36px;
  border-radius: 999px;
  flex: 0 0 auto;
  margin-left: 4px;
}
.mg-div-detail__team-skel-copy {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1 1 auto;
  min-width: 0;
}
.mg-div-detail__team-skel-name {
  height: 13px;
  width: 55%;
  border-radius: 4px;
}
.mg-div-detail__team-skel-meta {
  height: 11px;
  width: 35%;
  border-radius: 4px;
}

/* Dark-mode fixes for the shared `.division-standings` list item.
   Those global classes (styles.css) hardcode light-mode colors
   (#334a66 text, #cfe0f2 borders, #446a98 meta) that are unreadable
   on the dark drawer surface. Scoped overrides win on specificity
   (the [data-v] attr adds a class-tier) so they only affect this
   drawer's copy of the list. */
html.dark-mode .division-standings__header,
html.dark-mode .division-standings__row {
  color: #c4d2e4;
  border-bottom-color: rgba(255, 255, 255, 0.10);
}
/* Scope to the copy block (team meta + location) — NOT
   `.division-standings__team span`, which would also catch the
   `.team-avatar-mark__initial` span and override the avatar's own
   palette foreground color. */
html.dark-mode .division-standings__copy span {
  color: #9bb4d2;
}
</style>
