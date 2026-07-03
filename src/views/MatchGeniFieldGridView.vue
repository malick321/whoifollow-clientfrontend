<script setup lang="ts">
// MatchGeniFieldGridView
// ----------------------
// Field-grid-driven scoring surface — alternative to the list-
// based `MatchGeniScoringView` (which stays around at
// `/matchgeni/scoring`). Layout: park dropdown on top + a single
// park's time × field grid filling the rest of the page. Cells
// for games the caller is PERMITTED to score get the primary-
// tinted highlight; non-permitted cells stay dimmed (visible for
// situational awareness, but inert). Tapping a permitted cell
// opens `ScoringGameActionsModal` with Start / Delay / Enter
// inning / Upload scan actions.
//
// Why this view exists (vs the list-based scoring view): a
// tournament director responsible for one park (8 fields × 12
// time slots = ~96 games) can scan their day at a glance in the
// grid, whereas the same workload in a flat list requires
// scrolling through every game. The grid also generalises
// cleanly to the umpire surface later — same component, narrower
// `permittedGameIds` set, same modal.
//
// Park dropdown is the VIEWPORT selector — NOT a permission
// filter. The user can browse any park; the highlight encodes
// what they can act on. The scope chip next to the dropdown
// names the permission tier so the mental model is explicit.
//
// CSS class prefix `.field-grid-page__*` — distinct from the
// underlying `MatchGeniFieldGrid` component's `.field-grid__*`
// scoped classes so a reader can tell "page chrome" apart from
// "the grid component itself" without checking the file.

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import MatchGeniHeader from '../components/MatchGeniHeader.vue'
import MatchGeniFieldGrid from '../components/MatchGeniFieldGrid.vue'
import MatchGeniGameCard from '../components/MatchGeniGameCard.vue'
import MatchGeniParkPicker from '../components/MatchGeniParkPicker.vue'
import ScoringGameDetailsDrawer, { type ScoringDrawerAction } from '../components/ScoringGameDetailsDrawer.vue'
import SchedulerCreateGameModal from '../components/SchedulerCreateGameModal.vue'
import WeatherWidget, { type WeatherCondition } from '../components/WeatherWidget.vue'
import { fetchMatchGeniScheduler, buildFieldGridFromResources } from '../api/matchGeniScheduler'
import { fetchEventResources } from '../api/events'
import { currentAssociation } from '../constants/associations'
import { matchGeniContext, canMatchGeniWrite } from '../matchgeni-context'
import type {
  Division,
  MatchGeniSchedulerPayload,
  SchedulerGame,
  SchedulerPark
} from '../types'

const route = useRoute()

const associationShortName = computed(() =>
  (route.params.associationShortName as string | undefined) ?? ''
)
const eventId = computed(() =>
  (route.params.eventId as string | undefined) ?? ''
)

const loading = ref(true)
const errorMessage = ref<string | null>(null)
const payload = ref<MatchGeniSchedulerPayload | null>(null)

const catalogueDivisions = ref<Division[]>([])

// ── Resources-driven hydration (parks only) ──────────────────────
// This page has NO division-selection UI, so it fetches the §9
// Event Resources endpoint with `type=parks` — parks (fields +
// per-day windows) are real; games are synthesized to fit until the
// games API ships. `mockPayload` is kept as a BLURRED BACKDROP shown
// behind the "why this isn't enabled" overlay when the event has no
// parks (or a park isn't fully set up), so the page still renders a
// representative grid with a clear explanation rather than a blank.
const mockPayload = ref<MatchGeniSchedulerPayload | null>(null)
/** Count of parks the live resources call returned. */
const resourceParkCount = ref(0)
/** True once the resources fetch resolved (even if empty); false on
 *  network / auth error so the overlay copy can distinguish "nothing
 *  configured yet" from "couldn't load". */
const resourcesLoaded = ref(false)

/** A configure-action link in the overlay. Rendered only when the
 *  caller holds the relevant write permission. */
interface ResourceCta {
  label: string
  permission: 'manage_parks'
  kind: 'park' | 'fields' | 'window'
}
interface DisabledReason {
  title: string
  body: string
  /** `'all'` blurs the WHOLE surface (toolbar included — no park to
   *  pick); `'grid'` keeps the park toolbar live and blurs only the
   *  grid below. */
  scope: 'all' | 'grid'
  ctas?: ResourceCta[]
}

/** Why the grid can't be used for the selected park, or `null` when
 *  it's good to go. Mirrors the scheduler's grid-pane reason, minus
 *  the division pane (this page has no divisions). */
const gridDisabledReason = computed<DisabledReason | null>(() => {
  if (resourceParkCount.value === 0) {
    return resourcesLoaded.value
      ? {
          title: 'No parks added yet',
          body: 'Add a park to this event — with its fields and a daily scheduling window — to see its field grid.',
          scope: 'all',
          ctas: [{ label: 'Add a park', permission: 'manage_parks', kind: 'park' }]
        }
      : {
          title: 'Couldn’t load parks',
          body: 'We couldn’t reach the event resources, so the grid below is sample data.',
          scope: 'all'
        }
  }
  const park = selectedPark.value
  if (!park) return null
  const missingFields = park.fields.length === 0
  const missingWindow = park.days.length === 0
  if (missingFields || missingWindow) {
    const parts: string[] = []
    if (missingFields) parts.push('no fields are selected')
    if (missingWindow) parts.push('no scheduling window is set')
    const both = missingFields && missingWindow
    const ctas: ResourceCta[] = []
    if (missingFields) ctas.push({ label: 'Select fields', permission: 'manage_parks', kind: 'fields' })
    if (missingWindow) ctas.push({ label: 'Scheduling Window', permission: 'manage_parks', kind: 'window' })
    return {
      title: 'Park setup incomplete',
      body: `For “${park.name}”, ${parts.join(' and ')}. Configure ${both ? 'them' : 'it'} to see this park's field grid.`,
      scope: 'grid',
      ctas
    }
  }
  return null
})

/** CTA router — single isolated swap point for park-config
 *  destinations. Playing Facilities sub-page covers park + fields +
 *  scheduling window; falls back to a stub toast until routing is
 *  confirmed. */
function onConfigureResource(cta: ResourceCta) {
  if (!canMatchGeniWrite(cta.permission)) return
  // TODO(routing): confirm Playing Facilities covers park + fields +
  // scheduling-window setup, then router.push there.
  showToast('Playing Facilities setup — coming soon.')
}

// ── Toast (parks-config CTA stub) ────────────────────────────────
const toastMessage = ref<string>('')
let toastTimer: ReturnType<typeof setTimeout> | null = null
function showToast(message: string) {
  toastMessage.value = message
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastMessage.value = '' }, 4000)
}

// Display bindings — swap to the mock backdrop for a disabled grid so
// the blurred surface always has representative content behind the
// overlay. When `scope === 'all'` (no park at all), the toolbar park
// picker is also driven off the mock so it isn't an empty dropdown.
const gridPark = computed<SchedulerPark | null>(() =>
  gridDisabledReason.value
    ? (mockPayload.value?.parks[0] ?? null)
    : (selectedPark.value ?? null)
)
const gridGames = computed<SchedulerGame[]>(() =>
  gridDisabledReason.value ? (mockPayload.value?.games ?? []) : allGames.value
)
const mockDateAnchor = ref<string>('')
/** Active-date binding for the field grid — the real selected date
 *  normally, the throwaway mock anchor while a disabled backdrop is
 *  showing (so swapping to the backdrop doesn't clobber the user's
 *  real date selection). */
const gridActiveDate = computed<string>({
  get: () => (gridDisabledReason.value ? mockDateAnchor.value : activeDate.value),
  set: (v: string) => {
    if (gridDisabledReason.value) mockDateAnchor.value = v
    else activeDate.value = v
  }
})

// ── Park viewport ─────────────────────────────────────────────────
// The dropdown is UNRESTRICTED — any park the event uses can be
// selected. This is the viewport selector, not the permission
// scope. The highlight layer (below) encodes what the user can
// actually score.
//
// Park dropdown is sourced from the scheduler payload's parks
// array for now — the §9 Event Resources API returns parks as
// `{ id, name }` only, but the field grid also needs the per-park
// `fields` / `days` / `slots` to render. Will switch the dropdown
// to the §9 source once the backend extends that endpoint with
// the grid-rendering details.

const selectedParkId = ref<string | null>(null)
const activeDate = ref<string>('')

const allGames = computed<SchedulerGame[]>(() =>
  payload.value?.games ?? []
)
const allParks = computed<SchedulerPark[]>(() =>
  payload.value?.parks ?? []
)
const selectedPark = computed<SchedulerPark | null>(() =>
  allParks.value.find((p) => p.id === selectedParkId.value) ?? null
)
/** Park "City, ST" shown beside the picker (empty when not on file). */
const selectedParkLocation = computed(() => selectedPark.value?.location?.trim() || '')

/** Breaks on the selected park, filtered to the active date.
 *  Passed straight through to `MatchGeniFieldGrid` so lunch /
 *  rain-delay / field-maintenance blocks render on this read-
 *  only surface identically to the editable scheduler. The
 *  field-grid view shows breaks but offers no Edit / Remove
 *  affordances — `cellInteraction="click"` gates that. */
const activeParkBreaks = computed(() => {
  const park = selectedPark.value
  if (!park || !park.breaks || !activeDate.value) return []
  return park.breaks.filter((b) => b.date === activeDate.value)
})

/** Lookup: divisionId → division name. Renders inside the cell pill
 *  + on the actions modal header. Built off the unfiltered
 *  catalogue so that a parks-scoped user still sees division names
 *  on dimmed cells. */
const divisionNameById = computed<Map<string, string>>(() => {
  const map = new Map<string, string>()
  for (const d of catalogueDivisions.value) map.set(d.id, d.name)
  return map
})

/** Status → human label + StatusBadge tone. Mirrors the helper
 *  pair in ParticipationV2 (`gameStatusBadgeLabel` +
 *  `gameStatusBadgeTone`) so the same status reads as the same
 *  badge across the two surfaces — a "Live" pill on the field
 *  grid carries the same red `danger` tone as the "Live" pill on
 *  a participation game card. */
/* `statusBadgeLabel` / `statusBadgeTone` / `showScores` /
 * `showStatusBadge` / `showYetToBegin` helpers removed — they
 * all moved into `MatchGeniGameCard.vue` along with the cell-
 * pill markup itself, since they're pure functions of game
 * state with no view-specific dependencies. */

// ── Park weather (mock) ──────────────────────────────────────────
// Deterministic per-(park × date) forecast — the widget on the
// toolbar reflects the weather for whichever DATE the user has
// active on the strip below. That's the only honest framing:
// a multi-day tournament has different weather each day, and a
// static "current at this park" value misleads the TD when
// they're navigating the date strip to plan ahead.
//
// When backend ships `/weather?parkId=…&date=…` (or a per-day
// forecast endpoint), this function becomes the result of that
// fetch keyed off `(selectedParkId, activeDate)`. The widget
// downstream doesn't care which path produced the data.
const MOCK_WEATHER_CONDITIONS: WeatherCondition[] = [
  'sunny', 'partly-cloudy', 'cloudy', 'rainy', 'windy', 'thunderstorm'
]
function mockWeatherFor(
  parkId: string,
  date: string
): {
  temperature: number
  condition: WeatherCondition
  description: string
  high: number
  low: number
} {
  // Hash `(parkId, date)` into a stable seed so the same park-day
  // combination shows the same forecast across reloads (no random
  // jitter that would confuse demos / screenshots).
  let h = 0
  const src = `${parkId}|${date}`
  for (let i = 0; i < src.length; i++) {
    h = (h * 31 + src.charCodeAt(i)) >>> 0
  }
  const condition = MOCK_WEATHER_CONDITIONS[h % MOCK_WEATHER_CONDITIONS.length]
  // Temperature: 58–86°F band, biased a few degrees lower for
  // overcast / rainy / stormy conditions.
  const baseTemp = 58 + (h % 28)
  const cooler = condition === 'rainy' || condition === 'thunderstorm' || condition === 'cloudy'
  const temperature = cooler ? Math.max(54, baseTemp - 6) : baseTemp
  // Daily range — high is `temperature + 4..10`, low is
  // `temperature - 6..14`. Hash-derived so each park-day pair
  // has a stable but varied range.
  const high = temperature + 4 + ((h >> 3) % 7)
  const low = Math.max(40, temperature - 6 - ((h >> 7) % 9))
  const DESCRIPTIONS: Record<WeatherCondition, string> = {
    sunny: 'Sunny · clear skies',
    'partly-cloudy': 'Partly cloudy · light breeze',
    cloudy: 'Overcast',
    rainy: 'Light rain · 8 mph NW',
    windy: 'Windy · 15 mph SW',
    thunderstorm: 'Thunderstorm watch',
    // Not in the rotation today (no spring snow at mock parks),
    // but mapped for type completeness so adding `'snowy'` to
    // `MOCK_WEATHER_CONDITIONS` later doesn't break the lookup.
    snowy: 'Snow flurries'
  }
  return { temperature, condition, description: DESCRIPTIONS[condition], high, low }
}

const selectedParkWeather = computed(() => {
  if (!selectedParkId.value || !activeDate.value) return null
  return mockWeatherFor(selectedParkId.value, activeDate.value)
})

/** Active day's display label ("Wed, Apr 29") — shown next to the
 *  weather widget so the toolbar names WHICH day the forecast is
 *  for instead of relying on the user inferring it from the date
 *  strip below. Composed from the active SchedulerParkDay's
 *  weekday + day + month labels. Returns the empty string when
 *  no park / active day is resolved (loading / mid-switch). */
const activeDateLabel = computed<string>(() => {
  const day = selectedPark.value?.days.find((d) => d.date === activeDate.value)
  if (!day) return ''
  return `${day.weekdayLabel}, ${day.monthLabel} ${day.dayLabel}`
})

/* `isWinner` helper removed — moved into `MatchGeniGameCard.vue`
 * as an internal computed alongside the other game-state helpers
 * (statusBadge / showScores / showYetToBegin). */

// ── Permission scope → permitted game ids ─────────────────────────
// FC users → every game is permitted (full control). For scope-
// restricted users we intersect by parkId / divisionId from the
// scoring scope. The set drives the cell highlight class + the
// click-handler's "open modal vs ignore" branch.

const permittedGameIds = computed<Set<string>>(() => {
  const access = matchGeniContext.value?.access
  // Defensive — until access loads, permit nothing. FC takes over
  // as soon as access resolves.
  if (!access) return new Set()
  if (access.fullControl) return new Set(allGames.value.map((g) => g.id))
  // Hard gate: no `manage_scoring` permission → no permitted games,
  // period. Without this check a matchgeni user with only umpires /
  // officials / scheduling rights would fall through to the `!scope`
  // branch below and see every cell light up as "permitted", which
  // misrepresents what they can actually act on (any score-write
  // attempt would be rejected at the backend anyway). Mirrors the
  // same gate in `canScoreGame()` in matchgeni-context.ts so the
  // bulk-computed permitted set and the per-game helper agree.
  if (!access.permissions.includes('manage_scoring')) return new Set()
  const scope = access.scoringScope
  if (!scope || scope.mode === 'all') {
    return new Set(allGames.value.map((g) => g.id))
  }
  if (scope.mode === 'parks') {
    const parks = new Set(scope.parkIds)
    return new Set(
      allGames.value
        .filter((g) => g.parkId != null && parks.has(g.parkId))
        .map((g) => g.id)
    )
  }
  if (scope.mode === 'divisions') {
    const divs = new Set(scope.divisionIds)
    return new Set(
      allGames.value
        .filter((g) => divs.has(g.divisionId))
        .map((g) => g.id)
    )
  }
  return new Set()
})

/** Scope-badge label — mirrors the wording used on
 *  `MatchGeniScoringCard` so the user sees the same scope chip on
 *  the dashboard entry point AND on the surface they navigate
 *  into. Keeps the permission story consistent across both pages
 *  (and makes the badge feel like an identifier, not a one-off
 *  caption). */
const scopeLabel = computed<string>(() => {
  const access = matchGeniContext.value?.access
  if (!access) return ''
  if (access.fullControl) return 'All games (Full Control)'
  const scope = access.scoringScope
  if (!scope || scope.mode === 'all') return 'All parks · All divisions'
  if (scope.mode === 'parks') {
    const n = scope.parkIds.length
    return n === 1 ? '1 park in scope' : `${n} parks in scope`
  }
  if (scope.mode === 'divisions') {
    const n = scope.divisionIds.length
    return n === 1 ? '1 division in scope' : `${n} divisions in scope`
  }
  return ''
})

// ── Actions modal state ──────────────────────────────────────────

const actionsModalGame = ref<SchedulerGame | null>(null)

interface CellClickPayload {
  date: string
  time: string
  field: { id: string; name: string }
  game: SchedulerGame | null
}

function onCellClick(p: CellClickPayload) {
  // No-op while a disabled backdrop is showing — the blurred grid is
  // mock sample data, not actionable.
  if (gridDisabledReason.value) return
  if (!p.game) return
  // Dimmed cells are inert in v1. Future iteration: a read-only
  // info popup so a TD walking the park can still see what's
  // playing on adjacent fields they can't score.
  if (!permittedGameIds.value.has(p.game.id)) return
  actionsModalGame.value = p.game
}

function closeActionsModal() {
  actionsModalGame.value = null
}

/** v-model bridge for the drawer's `modelValue` — opens when
 *  `actionsModalGame` is set, closes (clears game) when the
 *  drawer emits false. Single source of truth: the game ref. */
const drawerOpen = computed({
  get: () => actionsModalGame.value !== null,
  set: (v: boolean) => { if (!v) closeActionsModal() }
})

function onAction(_id: ScoringDrawerAction) {
  // v1 stub — backend endpoints land in a follow-up. The id is
  // already on the wire (drawer emits it) so wiring is one
  // switch-statement away. Closes the drawer on every action so
  // the operator's intent reads as "do this thing, return me to
  // the grid" without an extra dismiss step.
  closeActionsModal()
}

// ── Edit pool game (from the drawer's "Edit game") ───────────────
// The drawer renders its own permission-gated "Edit game" button; this
// surface just provides the form + applies the change to the game.
const DEFAULT_TIME_LIMIT_BY_TYPE: Record<SchedulerGame['type'], number> = { pool: 65, bracket: 70 }
const gameEditOpen = ref(false)
const editGame = ref<SchedulerGame | null>(null)

/** Distinct team labels for the editing game's division (across all
 *  games), used as the searchable team options. Skips placeholders. */
const editGameTeamOptions = computed<string[]>(() => {
  const divId = editGame.value?.divisionId
  if (!divId) return []
  const set = new Set<string>()
  for (const g of allGames.value) {
    if (g.divisionId !== divId) continue
    for (const label of [g.team1Label, g.team2Label]) {
      if (!label) continue
      if (/^(winner|loser)\b/i.test(label)) continue
      set.add(label)
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b))
})

/** "Fri, May 22, 2026" from an ISO date string. */
function formatGameDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

function onDrawerEdit() {
  const g = actionsModalGame.value
  if (!g || g.type !== 'pool') return
  editGame.value = g
  closeActionsModal()
  gameEditOpen.value = true
}

function onGameEditSubmit(p: {
  name: string
  team1Label: string
  team2Label: string
  durationMinutes: number
  timeLimitMinutes: number
}) {
  const target = allGames.value.find((g) => g.id === editGame.value?.id)
  if (target) {
    target.label = p.name
    target.team1Label = p.team1Label
    target.team2Label = p.team2Label
    target.durationMinutes = p.durationMinutes
    target.timeLimitMinutes = p.timeLimitMinutes
  }
  gameEditOpen.value = false
  editGame.value = null
}

// ── Boot ─────────────────────────────────────────────────────────

async function load() {
  loading.value = true
  errorMessage.value = null
  try {
    // NOTE: matchgeni entry-access is verified by the router's
    // `beforeEach` guard via `resolveMatchGeniAccess` BEFORE this
    // view mounts (see `src/router.ts`), and the resolver
    // pre-warms `matchGeniContext`. We do NOT re-check here:
    // Field Grid is open to every matchgeni user (no per-page
    // permission required); the read-only / interactive split
    // happens inside the view via `permittedGameIds` (users
    // without `manage_scoring` get an empty permitted set →
    // every cell renders dimmed, no actions modal). Re-running a
    // permission check here would push a stale denial toast for
    // non-scoring users who are legitimately browsing.
    const access = matchGeniContext.value?.access
    if (!access) {
      errorMessage.value = 'You do not have access to MatchGeni for this event.'
      loading.value = false
      return
    }
    // Two parallel fetches. The §9 resources endpoint is the
    // canonical source for the event's PARKS (fields + per-day
    // windows) — fetched with `type=parks` only, since this page has
    // no division-selection UI. The mock scheduler payload is fetched
    // in parallel purely as the blurred backdrop for the
    // not-configured overlay AND as the mock-divisions stand-in the
    // synthesized games belong to (until the games API ships).
    const associationId = currentAssociation.value?.id ?? ''
    const resourcesPromise = fetchEventResources(associationId, eventId.value, ['parks'])
      .catch((err) => {
        if (typeof console !== 'undefined') {
          // eslint-disable-next-line no-console
          console.warn('[field-grid] fetchEventResources failed; falling back to mock backdrop.', err)
        }
        return null
      })
    const [resources, schedulerPayload] = await Promise.all([
      resourcesPromise,
      fetchMatchGeniScheduler(associationShortName.value, eventId.value)
    ])

    mockPayload.value = schedulerPayload
    mockDateAnchor.value = schedulerPayload.parks[0]?.days[0]?.date ?? ''
    resourcesLoaded.value = resources !== null

    const resParks = resources?.parks ?? []
    resourceParkCount.value = resParks.length

    if (resParks.length > 0) {
      // Build the real payload from live resources parks (games
      // synthesized against the mock divisions to fit).
      payload.value = buildFieldGridFromResources(resParks)
    } else {
      // No parks (or load failed) — fall back to the full mock so the
      // page renders representative content behind the overlay.
      payload.value = schedulerPayload
    }

    catalogueDivisions.value = (payload.value?.divisions ?? []).map(
      (d) => ({ id: d.id, name: d.name })
    )

    // Default park selection — first park the event uses. For
    // parks-scoped users we lean the default toward a permitted
    // park so the highlight isn't empty on first paint, but the
    // dropdown still lets them browse anywhere.
    if (!selectedParkId.value && allParks.value.length > 0) {
      const access2 = matchGeniContext.value?.access
      const scope = access2?.scoringScope
      let preferred: string | null = null
      if (
        scope &&
        scope.mode === 'parks' &&
        scope.parkIds.length > 0
      ) {
        const match = allParks.value.find((p) => scope.parkIds.includes(p.id))
        if (match) preferred = match.id
      }
      selectedParkId.value = preferred ?? allParks.value[0].id
    }
    // Default active date — first day of the selected park.
    if (selectedPark.value && selectedPark.value.days.length > 0) {
      activeDate.value = selectedPark.value.days[0].date
    }
  } catch (e: unknown) {
    errorMessage.value = e instanceof Error ? e.message : 'Failed to load field grid.'
  } finally {
    loading.value = false
  }
}

// When park changes, snap the active-date to that park's first
// day (unless the previously-selected date happens to also exist
// on the new park — uncommon but worth preserving for the user).
watch(selectedPark, (next) => {
  if (next && next.days.length > 0) {
    const stillValid = next.days.some((d) => d.date === activeDate.value)
    if (!stillValid) activeDate.value = next.days[0].date
  }
})

// ── Toolbar height publisher ─────────────────────────────────────
// Same ResizeObserver + Math.floor pattern MatchGeniHeader uses to
// publish its own height. The embedded MatchGeniFieldGrid reads
// `--matchgeni-field-grid-top` to figure out where to chain-stick
// its date strip; that calc adds the header height + this
// toolbar's height. Without live measurement the field-grid date
// strip ends up below the toolbar's bottom edge by whatever the
// hardcoded guess was off by (the badge wraps on narrow viewports,
// the dropdown's intrinsic height varies by platform), leaving a
// visible band of page content leaking through the gap.

const toolbarRef = ref<HTMLElement | null>(null)
let toolbarResizeObserver: ResizeObserver | null = null

function publishToolbarHeight() {
  const el = toolbarRef.value
  if (!el) return
  const h = el.getBoundingClientRect().height
  // `Math.floor` so the published height is always ≤ actual
  // rendered height — chained sticky elements overlap by 0–1px
  // (harmless, both rows are opaque) instead of leaving a hairline
  // gap. Same lesson the header + date-strip publishers learned.
  document.documentElement.style.setProperty(
    '--field-grid-page-toolbar-height', `${Math.floor(h)}px`
  )
}

onMounted(() => {
  load()
  if (typeof ResizeObserver !== 'undefined' && toolbarRef.value) {
    toolbarResizeObserver = new ResizeObserver(() => publishToolbarHeight())
    toolbarResizeObserver.observe(toolbarRef.value)
  }
  // Initial paint may finish AFTER mount if the loading skeleton
  // is in the tree — re-measure once the real toolbar renders.
  nextTick(publishToolbarHeight)
  window.addEventListener('resize', publishToolbarHeight)
})

onBeforeUnmount(() => {
  toolbarResizeObserver?.disconnect()
  window.removeEventListener('resize', publishToolbarHeight)
})

// Re-measure once the loading skeleton flips to the real toolbar.
watch(loading, async (isLoading) => {
  if (!isLoading) {
    await nextTick()
    publishToolbarHeight()
  }
})
</script>

<template>
  <main class="field-grid-page">
    <MatchGeniHeader
      variant="sub-page"
      title="Field Grid"
      :subtitle="matchGeniContext?.event.eventName ?? ''"
      :event-id="eventId"
      :loading="loading"
    >
      <!-- Scoring permission badge — rendered into the header's
           `title-suffix` slot so it sits right next to the
           "Field Grid" page title rather than under the toolbar.
           Hidden while the page is still loading (the loading
           state shows shimmer placeholders for the title row). -->
      <template v-if="!loading && scopeLabel" #title-suffix>
        <span class="field-grid-page__scope-badge">{{ scopeLabel }}</span>
      </template>
    </MatchGeniHeader>

    <!-- Skeleton — mirrors the post-load shape (park toolbar +
         date strip + time × field table) so the page doesn't
         shift when the fetches resolve. Cell heights match the
         real field-grid cells so the vertical extent stays
         identical across loading → loaded. -->
    <div v-if="loading" class="field-grid-page__skeleton" aria-busy="true">
      <header class="field-grid-page__skeleton-toolbar">
        <div class="shimmer-block field-grid-page__skeleton-park-pill"></div>
        <div class="shimmer-block field-grid-page__skeleton-scope-badge"></div>
      </header>
      <div class="field-grid-page__skeleton-date-strip">
        <div class="shimmer-block field-grid-page__skeleton-date-arrow"></div>
        <div class="field-grid-page__skeleton-date-list">
          <div
            v-for="n in 7"
            :key="`day-${n}`"
            class="shimmer-block field-grid-page__skeleton-date-cell"
          ></div>
        </div>
        <div class="shimmer-block field-grid-page__skeleton-date-arrow"></div>
      </div>
      <div class="field-grid-page__skeleton-grid-table">
        <!-- Header row — Time + 6 field headers. Same column count
             choice as the scheduler's skeleton (6 fields, not 8
             — we don't know the real park's count yet). -->
        <div class="field-grid-page__skeleton-grid-row field-grid-page__skeleton-grid-row--head">
          <div class="shimmer-block field-grid-page__skeleton-grid-th"></div>
          <div
            v-for="n in 6"
            :key="`th-${n}`"
            class="shimmer-block field-grid-page__skeleton-grid-th"
          ></div>
        </div>
        <div
          v-for="row in 10"
          :key="`row-${row}`"
          class="field-grid-page__skeleton-grid-row"
        >
          <div class="shimmer-block field-grid-page__skeleton-grid-time"></div>
          <div
            v-for="n in 6"
            :key="`cell-${row}-${n}`"
            class="shimmer-block field-grid-page__skeleton-grid-cell"
          ></div>
        </div>
      </div>
    </div>

    <div v-else-if="errorMessage" class="field-grid-page__error">
      <p>{{ errorMessage }}</p>
      <button type="button" class="field-grid-page__retry" @click="load">Retry</button>
    </div>

    <div v-else class="field-grid-page__content">
      <!-- Park dropdown (viewport selector) + scope badge.
           Sticky so it stays visible while the grid scrolls;
           publishes its height to `--field-grid-page-toolbar-height`
           so the chained sticky stack inside MatchGeniFieldGrid
           offsets correctly. -->
      <header
        ref="toolbarRef"
        class="field-grid-page__toolbar"
        :class="{ 'field-grid-page__toolbar--blurred': gridDisabledReason?.scope === 'all' }"
        :inert="gridDisabledReason?.scope === 'all'"
      >
        <!-- Park icon — 28px park-twotone glyph kept as a visual
             anchor before the dropdown so the affordance reads as
             "this picker controls the PARK" at a glance. The
             "Park" caps-label that used to live next to the icon
             is gone now (the floating-input label below carries
             that semantic), but the icon itself stays for visual
             continuity. Painted via CSS mask so it tints with
             theme-aware colors. -->
        <span
          class="field-grid-page__park-leader-icon"
          aria-hidden="true"
        ></span>
        <!-- Park picker — uses the shared `.floating-input` /
             `.floating-input__control--select` pattern (same one
             AssociationProfileModal, EventFormModal, etc. use) so
             the toolbar affordance matches every modal form in
             the portal. The label is permanently floated via
             `floating-input__label--floated` because the select
             always carries a value (the active park) — that
             prevents the label from sliding back down over the
             current option text. The select retains its own caret
             via the shared `:has(.floating-input__control--select)`
             rule in styles.css. -->
        <MatchGeniParkPicker
          id="field-grid-park-picker"
          v-model="selectedParkId"
          :parks="allParks"
          class="field-grid-page__park-picker"
        />
        <!-- Park location — "City, ST" beside the picker. On mobile it
             drops to its own row alongside the weather block (see the
             ≤720px rules). -->
        <span
          v-if="selectedParkLocation"
          class="field-grid-page__park-location"
        >
          <span class="field-grid-page__park-location-icon" aria-hidden="true"></span>
          {{ selectedParkLocation }}
        </span>
        <!-- Scope badge moved out of this toolbar — now rendered
             into the `MatchGeniHeader`'s `title-suffix` slot
             (see the `<MatchGeniHeader>` invocation above) so it
             sits inline with the "Field Grid" page title. -->
        <!-- Right-side weather block — date label + reusable
             `WeatherWidget` driven off the (selected park × active
             date) mock forecast. Date label sits to the LEFT of
             the icon so the user reads it as "weather FOR Wed,
             Apr 29: 74°F partly cloudy" instead of having to
             guess which day the temperature represents. The
             `margin-left:auto` on the wrapper bumps the whole
             block to the row's right edge regardless of which
             other toolbar elements are present. -->
        <div v-if="selectedParkWeather" class="field-grid-page__weather">
          <span
            v-if="activeDateLabel"
            class="field-grid-page__weather-date"
          >{{ activeDateLabel }}</span>
          <WeatherWidget
            :temperature="selectedParkWeather.temperature"
            :condition="selectedParkWeather.condition"
            :description="selectedParkWeather.description"
            :high="selectedParkWeather.high"
            :low="selectedParkWeather.low"
          />
        </div>
      </header>

      <!-- Field grid with click interaction. `#cell` slot renders
           this page's permitted/dimmed pill; cell clicks bubble
           up to `onCellClick` which decides whether to open the
           actions modal.

           When the live resources call yields no usable park (none
           added, or the selected park has no fields / no scheduling
           window), the grid renders the MOCK payload BLURRED as a
           backdrop with a centered overlay explaining why — same
           treatment as the scheduler's grid pane. The grid binds to
           `gridPark` / `gridGames` / `gridActiveDate`, which swap to
           the mock backdrop while disabled so the real selection
           isn't clobbered. `:inert` + the `onCellClick` guard make
           the blurred cards non-interactive even if the blur is
           stripped in devtools. -->
      <div
        class="field-grid-page__grid-region"
        :class="{ 'field-grid-page__grid-region--disabled': !!gridDisabledReason }"
      >
        <div
          class="field-grid-page__grid-content"
          :inert="!!gridDisabledReason"
        >
      <MatchGeniFieldGrid
        :park="gridPark"
        :games="gridGames"
        v-model:active-date="gridActiveDate"
        cell-interaction="click"
        :park-breaks="activeParkBreaks"
        class="field-grid-page__field-grid"
        @cell-click="onCellClick"
      >
        <template #cell="{ game, size, durationMinutes }">
          <!-- Shared `MatchGeniGameCard` — single source of truth
               for the cell-pill markup across the scoring + admin
               scheduling surfaces. The view supplies the
               permission gating + the resolved division name; the
               card owns everything else (status badge, scores,
               winner highlighting, "Yet to Begin" placeholder).
               `toned-by-division` colour-codes the card so every
               game in a division reads as the same colour group
               on the calendar grid (palette matches `TeamAvatar`). -->
          <MatchGeniGameCard
            :game="game"
            :division-name="divisionNameById.get(game.divisionId) ?? ''"
            :permitted="permittedGameIds.has(game.id)"
            :size="(size as 'full' | 'compact' | 'mini')"
            :duration-minutes="durationMinutes"
            toned-by-division
          />
        </template>
        <!-- Override the default empty-cell render (the scheduler's
             "Invalid Date for Division" placeholder) with NOTHING.
             On the field-grid scoring surface an empty slot just
             means no game is scheduled there — surfacing it as a
             placeholder confuses TDs into thinking something's
             wrong. -->
        <template #empty-cell><span /></template>
      </MatchGeniFieldGrid>
        </div>

        <!-- Not-configured overlay — centered card explaining why the
             grid isn't usable, with permission-gated config CTAs.
             Sibling of the blurred content so it stays sharp +
             clickable. -->
        <div
          v-if="gridDisabledReason"
          class="field-grid-page__region-overlay"
        >
          <div class="field-grid-page__region-overlay-card">
            <h3 class="field-grid-page__region-overlay-title">{{ gridDisabledReason.title }}</h3>
            <p class="field-grid-page__region-overlay-body">{{ gridDisabledReason.body }}</p>
            <div
              v-if="gridDisabledReason.ctas && gridDisabledReason.ctas.length"
              class="field-grid-page__region-overlay-actions"
            >
              <button
                v-for="c in gridDisabledReason.ctas"
                v-show="canMatchGeniWrite(c.permission)"
                :key="c.kind"
                type="button"
                class="field-grid-page__region-overlay-cta"
                @click="onConfigureResource(c)"
              >{{ c.label }}</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Toast — bottom-center fixed banner for the parks-config CTA
         stub. Auto-dismissed after 4s by `showToast()`. -->
    <div
      v-if="toastMessage"
      class="field-grid-page__toast"
      role="status"
      aria-live="polite"
    >{{ toastMessage }}</div>

    <ScoringGameDetailsDrawer
      v-model="drawerOpen"
      :game="actionsModalGame"
      :division-name="
        actionsModalGame
          ? divisionNameById.get(actionsModalGame.divisionId) ?? ''
          : ''
      "
      @action="onAction"
      @edit="onDrawerEdit"
    />

    <!-- Edit pool game — same shared add/edit form used on the scheduler /
         division page. Opened from the drawer's permission-gated "Edit
         game"; edits mutate the game in place. -->
    <SchedulerCreateGameModal
      v-model="gameEditOpen"
      mode="edit"
      :division-name="editGame ? (divisionNameById.get(editGame.divisionId) ?? '') : ''"
      :date-label="formatGameDate(editGame?.scheduledDate)"
      :time-label="editGame?.scheduledTime ?? ''"
      :field-name="editGame?.scheduledFieldLabel ?? ''"
      :park-name="(editGame && allParks.find((p) => p.id === editGame!.parkId)?.name) || ''"
      :team-options="editGameTeamOptions"
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
  </main>
</template>

<style scoped>
.field-grid-page {
  /* Cumulative chain-sticky offset for the embedded field grid.
     Header (~74px) + this view's toolbar (~62px) = the field
     grid's date strip sticks below the toolbar, table thead below
     the date strip — same pattern the scheduler view uses.
     Both `--matchgeni-header-height` AND
     `--field-grid-page-toolbar-height` are published live via
     ResizeObserver (the header by MatchGeniHeader, the toolbar by
     this view's mount hook) so the offset tracks the real
     rendered heights instead of a guess that drifts and leaves a
     visible gap between sticky rows. */
  --matchgeni-field-grid-top: calc(
    var(--matchgeni-header-height, 56px)
    + var(--field-grid-page-toolbar-height, 62px)
  );
}

.field-grid-page__content {
  display: block;
  /* Solid white card surface — matches the scheduler page's
     `.scheduler__grid-shell` so the sticky thead's drop-shadow
     reads with the same contrast on both pages. Without this the
     table sits flush against the page background and the shadow
     loses visual weight against the page-level color. */
  background: var(--white);
}
html.dark-mode .field-grid-page__content {
  background: var(--surface-card);
}

/* Toolbar — sticky to just below the page header so the park
   dropdown stays accessible while the grid scrolls. */
.field-grid-page__toolbar {
  position: sticky;
  /* No `-1px` subtraction here — unlike the date strip + thead
     below, the toolbar pins directly under the matchgeni header
     which has `z-index: 50` (this toolbar is z=4). The header
     always paints OVER any sub-pixel overlap, so we don't need
     the `-1px` overlap-guarantee for visual continuity with the
     row above. What we DO need: a sticky threshold high enough
     that natural-flow position is always `<= threshold`, so
     sticky engages from scroll=0 and the toolbar never visibly
     "snaps" when the user first starts scrolling.
     With `top: floor(H_actual)` and `margin-top: -1` (natural y
     = H_actual - 1), diff = (H_actual - 1) - floor(H_actual) =
     fractional_part - 1, which is ALWAYS `< 0`. Stuck from the
     first paint. Subtracting another `1px` here (the old behavior)
     made diff = fractional_part >= 0, which left the toolbar
     un-stuck at scroll=0 whenever the header rendered at a
     non-integer pixel height (i.e. virtually always) — the toolbar
     would then snap upward by ~1px on the first scroll wheel
     event, which read as "the row moves a little". */
  top: var(--matchgeni-header-height, 56px);
  /* `-1px` natural-flow shift — pulls the toolbar's top edge 1px
     into the matchgeni header's bottom edge, hiding any sub-pixel
     hairline between them. The high-z-index header covers this
     overlap, so the toolbar's top 1px is never visible. Also
     ensures `natural y <= threshold` (see comment above) so
     sticky pinning kicks in immediately from scroll=0. */
  margin-top: -1px;
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  /* Same multi-layer gradient `body` uses (two top radial glows
     + a vertical fade) so the toolbar reads as a continuation of
     the page surface instead of a hard-edged flat strip pasted
     on top of the white card content below. The radial glows are
     anchored to the toolbar's own top edges (not the viewport's)
     since this is a per-element background — the local "depth-
     of-field" treatment gives the toolbar the same soft tint the
     rest of the page surface has when the toolbar's sticky pin
     puts it visually adjacent to the page background. */
  background:
    radial-gradient(circle at top left, rgba(45, 140, 240, 0.18), transparent 26%),
    radial-gradient(circle at top right, rgba(111, 146, 187, 0.22), transparent 24%),
    linear-gradient(180deg, #fbfdff 0%, var(--body-bg) 40%, #eef3f8 100%);
  border-bottom: 1px solid var(--border-divider);
}
html.dark-mode .field-grid-page__toolbar {
  background:
    radial-gradient(circle at top left, rgba(79, 163, 255, 0.12), transparent 26%),
    radial-gradient(circle at top right, rgba(126, 168, 217, 0.12), transparent 24%),
    linear-gradient(180deg, #0f1419 0%, var(--body-bg) 40%, #0b0f14 100%);
}

/* `.field-grid-page__park-leader` container + `__park-leader-label`
   caps text removed — the "Park" identifier now lives inside the
   floating-input dropdown (as its floated label) so the visual
   leader collapses to JUST the park glyph beside the dropdown.
   `__park-select` rules also removed (replaced by the shared
   `.floating-input__control--select` styles). */

/* Park-twotone glyph — kept as a visual anchor before the
   floating-input dropdown. 28px masked SVG painted via
   `background-color` so it themes per mode (navy in light,
   lighter primary blue in dark) without an `<img>` fill. */
.field-grid-page__park-leader-icon {
  display: inline-block;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  /* Light mode: matches the matchgeni header's navy
     (`#254c72`) so the park glyph reads as part of the same
     visual family as the page header above. Dark mode keeps
     the lighter primary blue so the icon stays visible against
     the dark surface. */
  background-color: #254c72;
  -webkit-mask-image: url('../assets/park-twotone.svg');
  mask-image: url('../assets/park-twotone.svg');
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}
html.dark-mode .field-grid-page__park-leader-icon {
  background-color: #7fb0e8;
}

/* Park picker container — constrains the floating-input wrapper's
   width so the dropdown doesn't stretch edge-to-edge when the
   right-side weather widget + scope badge are absent. Same 360px
   cap the scheduler's `.scheduler__park-picker` uses so both
   surfaces stay visually identical. */
.field-grid-page__park-picker {
  width: 100%;
  max-width: 360px;
  flex: 0 0 auto;
}

/* Scope badge — same primary-tinted chip the dashboard's Game
   Scoring card uses, so the permission identifier reads as a
   consistent visual cue across the dashboard entry point and
   the surface the user navigates into. */
/* Scope badge — matches the event-officials row's
   "Scoring: …" chip (`.association-users__row-event-chip` in
   `styles.css`) so the permission indicator reads as the same
   affordance across the portal. Warning-amber palette in both
   themes — the dark-mode override mirrors the source chip's
   brighter amber so the badge stays legible against the slate
   surface. */
.field-grid-page__scope-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  font-family: var(--font-body);
  font-size: 0.78rem;
  font-weight: 500;
  letter-spacing: normal;
  color: #8c6500;
  background: var(--light-warning);
  border: 1px solid rgba(140, 101, 0, 0.25);
  border-radius: 5px;
  white-space: nowrap;
}
html.dark-mode .field-grid-page__scope-badge {
  color: #f7a120;
  background: rgba(247, 161, 32, 0.14);
  border-color: rgba(247, 161, 32, 0.32);
}

/* Weather block — date label + widget grouped, pinned right via
   `margin-left: auto`. The wrapper carries the spacing so the
   inner widget stays a focused presentational component. */
.field-grid-page__weather {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
}
.field-grid-page__weather-date {
  font-size: 12px;
  font-weight: 600;
  color: var(--secondary);
  white-space: nowrap;
}

/* Park location — "City, ST" beside the picker. A small location pin
   precedes it (masked SVG so it tints with the theme text color). */
.field-grid-page__park-location {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  font-size: 12px;
  font-weight: 600;
  color: var(--secondary);
  white-space: nowrap;
}
.field-grid-page__park-location-icon {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  background-color: currentColor;
  -webkit-mask: url('../assets/location.svg') center / contain no-repeat;
  mask: url('../assets/location.svg') center / contain no-repeat;
}

/* `.field-grid-page__pill*` cell-pill rules all moved into the
   shared `MatchGeniGameCard.vue` component along with the markup
   itself. The component owns the cell's visual identity now;
   this view just renders `<MatchGeniGameCard>` inside the
   MatchGeniFieldGrid `#cell` slot and supplies the per-cell
   permission + division-name props. */

/* ─── Skeleton ────────────────────────────────────────────────
   Mirrors the post-load layout 1:1 — same toolbar pill + scope
   chip, same date-strip arrows + cells, same time × field grid.
   Cell heights match the real field-grid so the page doesn't
   jump on resolve. Same structural strategy as the scheduler's
   skeleton (where this pattern lives canonically). */
.field-grid-page__skeleton-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--white);
  border-bottom: 1px solid var(--border-divider);
}
html.dark-mode .field-grid-page__skeleton-toolbar {
  background: #1a2028;
}
.field-grid-page__skeleton-park-pill {
  width: 100%;
  max-width: 360px;
  height: 38px;
  border-radius: 8px;
}
.field-grid-page__skeleton-scope-badge {
  width: 160px;
  height: 24px;
  border-radius: 5px;
  flex: 0 0 auto;
}

.field-grid-page__skeleton-date-strip {
  display: grid;
  grid-template-columns: 30px 1fr 30px;
  gap: 6px;
  align-items: center;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-divider);
}
.field-grid-page__skeleton-date-arrow {
  width: 30px;
  height: 30px;
  border-radius: 999px;
}
.field-grid-page__skeleton-date-list {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 6px;
}
.field-grid-page__skeleton-date-cell {
  height: 44px;
  border-radius: 6px;
}

.field-grid-page__skeleton-grid-table {
  border-top: 1px solid var(--border-divider);
  display: flex;
  flex-direction: column;
}
.field-grid-page__skeleton-grid-row {
  display: grid;
  /* Time column fixed at 120px, then 6 equal-width field columns
     — matches the real field grid's structure. Picking 6 (not
     the real park's 8) because the skeleton can't know the
     count yet. */
  grid-template-columns: 120px repeat(6, minmax(0, 1fr));
}
.field-grid-page__skeleton-grid-row--head .field-grid-page__skeleton-grid-th {
  height: 44px;
}
.field-grid-page__skeleton-grid-th {
  height: 44px;
  border-right: 1px solid var(--border-divider);
  border-bottom: 1px solid var(--border-divider);
  /* `shimmer-block` paints the fill; explicit `border-radius: 0`
     keeps the cells looking like table cells, not chips. */
  border-radius: 0;
}
.field-grid-page__skeleton-grid-time,
.field-grid-page__skeleton-grid-cell {
  height: 92px;
  border-right: 1px solid var(--border-divider);
  border-bottom: 1px solid var(--border-divider);
  border-radius: 0;
}
.field-grid-page__skeleton-grid-time {
  background: var(--surface-card);
}

/* ─── Not-configured (parks) blurred backdrop + overlay ───────────
   When the live resources call yields no usable park, the grid (and,
   for `scope: all`, the toolbar) renders the mock payload BLURRED
   behind a centered explanatory overlay. Mirrors the scheduler's
   grid-pane treatment. The blur + pointer-events are the first
   (cosmetic) layer; `:inert` on the content wrapper + the
   `onCellClick` guard are the real non-interactive gates. */
.field-grid-page__toolbar--blurred {
  filter: blur(3px) saturate(0.85);
  opacity: 0.7;
  pointer-events: none;
  user-select: none;
}
.field-grid-page__grid-region {
  position: relative;
}
.field-grid-page__grid-region--disabled .field-grid-page__grid-content {
  filter: blur(3px) saturate(0.85);
  opacity: 0.7;
  pointer-events: none;
  user-select: none;
}
.field-grid-page__region-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  z-index: 6;
  pointer-events: none;
}
.field-grid-page__region-overlay-card {
  pointer-events: auto;
  max-width: 360px;
  text-align: center;
  background: var(--white, #fff);
  border: 1px solid var(--border-divider, rgba(15, 23, 42, 0.12));
  border-radius: 14px;
  padding: 22px 22px 20px;
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.18);
}
.field-grid-page__region-overlay-title {
  margin: 0 0 6px;
  font-size: 16px;
  font-weight: 500;
  color: var(--text-strong, #0f172a);
}
.field-grid-page__region-overlay-body {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--text-muted, #64748b);
}
html.dark-mode .field-grid-page__region-overlay-card {
  background: #1a2028;
  border-color: rgba(255, 255, 255, 0.12);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.5);
}
html.dark-mode .field-grid-page__region-overlay-title {
  color: #f1f5f9;
}
html.dark-mode .field-grid-page__region-overlay-body {
  color: #b7c2d0;
}
.field-grid-page__region-overlay-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin-top: 16px;
}
.field-grid-page__region-overlay-cta {
  flex: 1 1 0;
  min-width: 0;
  white-space: nowrap;
  appearance: none;
  border: none;
  border-radius: 8px;
  background: var(--primary, #2563eb);
  color: #fff;
  font-weight: 600;
  font-size: 13.5px;
  padding: 9px 18px;
  cursor: pointer;
  transition: filter 120ms ease;
}
.field-grid-page__region-overlay-cta:hover {
  filter: brightness(1.06);
}
.field-grid-page__region-overlay-cta:focus-visible {
  outline: 2px solid var(--primary, #2563eb);
  outline-offset: 2px;
}

/* Toast — bottom-center fixed pill (parks-config CTA stub). Same
   shape the scheduler uses. */
.field-grid-page__toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 250;
  background: var(--text, #1a2028);
  color: #ffffff;
  padding: 10px 18px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 500;
  box-shadow: 0 8px 24px rgba(13, 30, 58, 0.32);
  max-width: 90vw;
  text-align: center;
}
html.dark-mode .field-grid-page__toast {
  background: #2a3340;
}

.field-grid-page__error {
  padding: 32px 16px;
  text-align: center;
  color: var(--secondary);
}
.field-grid-page__retry {
  appearance: none;
  background: var(--primary);
  color: #ffffff;
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  font-weight: 600;
  margin-top: 8px;
  cursor: pointer;
}

/* Tablet (landscape + portrait) — keep the desktop SINGLE-ROW
   layout (park icon + picker + scope badge + weather) but trim
   the weather widget to icon + temperature + date label so the
   row fits comfortably in the tablet viewport without the weather
   block being clipped off the right edge. The high/low range and
   the wordy condition description are hidden at this tier; the
   essentials (current temp + date) stay visible.
   1080px threshold matches the `compact` viewport tier defined
   in `CLAUDE.md`. */
@media (max-width: 1080px) {
  .field-grid-page__weather :deep(.weather-widget__range),
  .field-grid-page__weather :deep(.weather-widget__desc) {
    display: none;
  }
}

/* Mobile only — toolbar breaks into TWO rows because the
   single-row layout (even with the trimmed weather above) can't
   fit park icon + picker + scope badge + temperature in less
   than 720px without crowding. Switching to `display: grid` with
   named template areas so the row break is explicit:
     row 1: [park icon] [park picker spans remaining cols]
     row 2: [weather spans left 2 cols]  [scope badge — right] */
@media (max-width: 720px) {
  /* Mobile toolbar → TWO rows: the park picker fills row 1; row 2
     carries the park location (left) and the weather block (right) on
     the SAME line, per the compact layout. */
  .field-grid-page__toolbar {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-areas:
      'picker picker'
      'location weather';
    column-gap: 12px;
    row-gap: 8px;
    align-items: center;
  }
  /* Park icon hidden on mobile — limited horizontal real estate
     is better spent on the picker label + dropdown caret. The
     "Park" identifier is already inside the floating-input
     dropdown's floated label tag, so the leader glyph is
     redundant at this width. Desktop keeps the icon. */
  .field-grid-page__park-leader-icon {
    display: none;
  }
  .field-grid-page__park-picker {
    grid-area: picker;
    /* `max-width: none` releases the desktop 360px cap so the
       dropdown stretches to fill the row inside its grid cell. */
    max-width: none;
    width: 100%;
  }
  .field-grid-page__park-location {
    grid-area: location;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* Weather stays in the toolbar on mobile — sharing row 2 with the
     location (no longer relocated into the date card). Reset the
     desktop right-push; the grid area + `justify-self` handle it. */
  .field-grid-page__weather {
    grid-area: weather;
    margin-left: 0;
    justify-self: end;
  }
}
</style>
