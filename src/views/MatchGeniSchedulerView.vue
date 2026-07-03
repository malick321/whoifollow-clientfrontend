<script setup lang="ts">
// MatchGeniSchedulerView
// ----------------------
// /association/:associationShortName/portal/events/:eventId/matchgeni/scheduler
//
// Drag-drop game scheduler. Two-column layout:
//   LEFT  — division picker + Pool Play / Brackets tabs + scrollable
//           list of game cards. Each card is the drag source.
//   RIGHT — park picker + date strip + time × field grid. Each cell
//           is a drop target.
//
// This is the UI scaffolding pass. Drag/drop is not yet wired (cards
// have `draggable="true"` to telegraph affordance + cursor, but
// no `dragstart` / `dragover` / `drop` handlers fire any state
// change yet). Real backend hooks land in a follow-up.

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import MatchGeniHeader from '../components/MatchGeniHeader.vue'
import MatchGeniFieldGrid from '../components/MatchGeniFieldGrid.vue'
import MatchGeniGameCard from '../components/MatchGeniGameCard.vue'
import MatchGeniParkPicker from '../components/MatchGeniParkPicker.vue'
import MatchGeniGameListPanel from '../components/MatchGeniGameListPanel.vue'
import SchedulerGameCard from '../components/SchedulerGameCard.vue'
import SchedulerShiftConfirmModal from '../components/SchedulerShiftConfirmModal.vue'
import SchedulerBreakConflictModal from '../components/SchedulerBreakConflictModal.vue'
import SchedulerCreateGameModal from '../components/SchedulerCreateGameModal.vue'
import SchedulerAddSlotModal from '../components/SchedulerAddSlotModal.vue'
import SchedulerMoveModal from '../components/SchedulerMoveModal.vue'
import SchedulerMarkDelayedModal from '../components/SchedulerMarkDelayedModal.vue'
import SchedulerBreakForm from '../components/SchedulerBreakForm.vue'
import SchedulerBulkDurationModal from '../components/SchedulerBulkDurationModal.vue'
import ScoringGameDetailsDrawer from '../components/ScoringGameDetailsDrawer.vue'
import MatchGeniBracket from '../components/MatchGeniBracket.vue'
import MatchGeniBracketFormModal from '../components/MatchGeniBracketFormModal.vue'
import BracketDivisionSwitcher from '../components/BracketDivisionSwitcher.vue'
import { getMockBracket, getMockBracketsForDivision } from '../api/mockBrackets'
import { fetchMatchGeniScheduler, buildSchedulerFromResources } from '../api/matchGeniScheduler'
import { fetchEventResources } from '../api/events'
import { bracketStatusLabel, bracketStatusTone } from '../lib/bracketStatus'
import {
  findConflicts,
  effectiveGameDurationMinutes,
  fieldCadenceStarts,
  snapStartToCadence,
  cascadeFollowingGames,
  minutesFromMidnight,
  minutesToHHMM,
  ROW_GRANULARITY_MINUTES,
  formatTimeRange,
  packGamesToDestination
} from '../api/schedulerTimeAxis'
import { useRouter } from 'vue-router'
import { pushToast, type ToastTone } from '../toast-center'
import { currentAssociation } from '../constants/associations'
import { ensureMatchGeniAccess, matchGeniContext, canMatchGeniWrite } from '../matchgeni-context'
import type {
  MatchGeniSchedulerPayload,
  SchedulerBreak,
  SchedulerDivision,
  SchedulerGame,
  SchedulerPark,
  BracketModel
} from '../types'

const route = useRoute()
const router = useRouter()

const associationShortName = computed(() =>
  (route.params.associationShortName as string | undefined) ?? ''
)
const eventId = computed(() =>
  (route.params.eventId as string | undefined) ?? ''
)

const payload = ref<MatchGeniSchedulerPayload | null>(null)
/** Event-level default game-slot length — baseline of the duration
 *  chain (game → park → event → fallback). Named accessor so it's
 *  reachable inside handlers that shadow `payload` with a local param. */
const eventDefaultDuration = computed(() => payload.value?.eventDefaultGameDurationMinutes)
const loading = ref(true)
const errorMessage = ref<string | null>(null)

// ── Resources-driven hydration state ─────────────────────────────
// The §9 Event Resources endpoint (LIVE) supplies parks (fields +
// per-day schedule) + divisions; games are synthesized to fit until
// the games API ships. `mockPayload` is kept as a BLURRED BACKDROP
// rendered behind the "why this isn't enabled" overlays — so when a
// park has no fields / no schedule, or the event has no parks /
// divisions, the user still sees a representative (blurred) grid +
// list with a clear explanation instead of a blank panel.
const mockPayload = ref<MatchGeniSchedulerPayload | null>(null)
/** Count of parks the live resources call returned (independent of
 *  whether each is fully configured). */
const resourceParkCount = ref(0)
/** Count of divisions the live resources call returned. */
const resourceDivisionCount = ref(0)
/** True once the resources fetch resolved (even if empty); false on
 *  network / auth error so the overlay copy can distinguish "nothing
 *  configured yet" from "couldn't load". */
const resourcesLoaded = ref(false)
/** A throwaway active-date for the mock backdrop grid (kept separate
 *  from `visibleDateAnchor` so swapping to the backdrop doesn't
 *  clobber the real selected date). */
const mockDateAnchor = ref('')

// ── Sticky-stack height publishers ──────────────────────────────
// The chained sticky stack (park-select → date-strip → table
// thead) needs each subsequent element's `top:` to add the
// height of every element above it in the chain. The date-strip +
// table thead now live inside `MatchGeniFieldGrid` (which owns
// its own ResizeObserver and publishes
// `--matchgeni-field-grid-date-strip-height`); here we only
// measure the park-select bar and publish
// `--scheduler-park-height` so the field-grid component can
// chain-stick beneath it via `--matchgeni-field-grid-top`.
const parkSelectRef = ref<HTMLElement | null>(null)
let parkResizeObserver: ResizeObserver | null = null

// ── Game-cards rail (mobile horizontal scroll) ──────────────────
// On ≤720px the vertical card stack flips to a horizontal rail
// with overlay prev/next arrows — same pattern the dashboard's
// playing-facility schedule list uses. Visibility of the arrows is
// JS-driven from the rail's scroll position so they appear only
// when there's actually content to scroll to in that direction.
// At desktop widths the rail is a plain column (CSS), so these
// refs stay populated but `syncGameRailArrows` short-circuits when
// the rail isn't actually horizontally overflowing.
const gameRailRef = ref<HTMLElement | null>(null)
const gameRailPrevVisible = ref(false)

// ── Bracket toolbar stuck-only band ──────────────────────────────
// The bracket pager toolbar is `position: sticky` at the top of the
// `.scheduler__game-grid` scroll container and is otherwise
// transparent; it only paints its background once pinned. Detect
// "stuck" the same way the date headers do — compare the toolbar's
// viewport top against the scroll container's top.
const gameGridRef = ref<HTMLElement | null>(null)
let gridScrollBound = false
function updateBracketStuck() {
  const grid = gameGridRef.value
  if (!grid) return
  const toolbar = grid.querySelector<HTMLElement>('.scheduler__bracket-toolbar')
  if (!toolbar) return
  const stuck = toolbar.getBoundingClientRect().top <= grid.getBoundingClientRect().top + 1.5
  toolbar.classList.toggle('scheduler__bracket-toolbar--stuck', stuck)
}

// Mobile-viewport ref — drives which game-list render path the
// template uses. At ≤720px we keep the existing horizontal-rail
// (flat list, scroll-snap cards) because date grouping inside a
// horizontal rail doesn't read as a natural shape. At wider
// widths we swap in `MatchGeniGameListPanel` for the vertical
// date-grouped list with sticky headers. Same `matchMedia`
// pattern the matchgeni header uses for its compact-mode flag.
const isCompactViewport = ref(false)
let compactMql: MediaQueryList | null = null
function syncCompactViewport(eventOrList: MediaQueryListEvent | MediaQueryList) {
  isCompactViewport.value = eventOrList.matches
}
const gameRailNextVisible = ref(false)

function syncGameRailArrows() {
  const rail = gameRailRef.value
  if (!rail) {
    gameRailPrevVisible.value = false
    gameRailNextVisible.value = false
    return
  }
  // No horizontal overflow → not in mobile-rail mode → hide both
  // arrows regardless of `scrollLeft` (avoids a stray "next" arrow
  // at desktop when the rail is just a vertical column).
  const horizontallyOverflowing = rail.scrollWidth - rail.clientWidth > 2
  if (!horizontallyOverflowing) {
    gameRailPrevVisible.value = false
    gameRailNextVisible.value = false
    return
  }
  gameRailPrevVisible.value = rail.scrollLeft > 2
  gameRailNextVisible.value = rail.scrollLeft < rail.scrollWidth - rail.clientWidth - 2
}

function onGameRailScroll(direction: -1 | 1) {
  const rail = gameRailRef.value
  if (!rail) return
  // Step by ONE card width + gap — matches the rail's
  // `scroll-snap-align: center` behavior on mobile, so each click
  // advances by exactly one slot and the snap can settle the
  // active card in the centre with prev / next peek slivers on
  // either side. Two-card steps would skip the centred middle
  // card and conflict with the snap. Falls back to 82% of the
  // rail's viewport when no card is rendered yet (same heuristic
  // the dashboard's facility-carousel scroll helper uses). */
  const firstCard = rail.querySelector<HTMLElement>('.scheduler__game-card')
  const step = firstCard ? firstCard.offsetWidth + 12 : rail.clientWidth * 0.82
  rail.scrollBy({ left: step * direction, behavior: 'smooth' })
}

function publishStickyHeights() {
  // `Math.floor` (NOT `ceil` or `round`) so the published height
  // is always <= the actual rendered height. The chained sticky
  // elements use these as `top:` offsets — an under-estimate
  // causes a harmless 0–1px overlap (every sticky surface is
  // opaque so overlap is invisible), while an over-estimate
  // leaves a sub-pixel gap of page background bleeding through
  // between the rows. Earlier this used `ceil`, which was the
  // wrong direction and produced the visible band the user
  // reported between park-select, date-strip, and thead.
  if (parkSelectRef.value) {
    const h = parkSelectRef.value.getBoundingClientRect().height
    document.documentElement.style.setProperty(
      '--scheduler-park-height', `${Math.floor(h)}px`
    )
  }
  // `--scheduler-date-strip-height` is published by the
  // `MatchGeniFieldGrid` component now (it owns the date strip);
  // the scheduler view no longer measures it directly.
}

const selectedDivisionId = ref<string>('')
const activePhase = ref<'pool' | 'bracket'>('pool')
/** 1-based index of which bracket the bracket-pager is showing.
 *  Resets to 1 whenever the active division changes (different
 *  divisions have different bracket counts). Future: filter
 *  `filteredGames` by this bracket index once the mock games
 *  carry a `bracketIndex` field. */
const activeBracketIndex = ref<number>(1)

function stepBracket(direction: -1 | 1) {
  const total = selectedDivision.value?.bracketCount ?? 1
  const next = activeBracketIndex.value + direction
  if (next < 1 || next > total) return
  activeBracketIndex.value = next
}

/** Display name of the currently-active bracket — sourced from
 *  the division's `bracketNames` list (1-based index). Falls back
 *  to a generic "Bracket {n}" if the names list is missing or
 *  too short for the active index. */
const activeBracketName = computed<string>(() => {
  const names = selectedDivision.value?.bracketNames ?? []
  return names[activeBracketIndex.value - 1] ?? `Bracket ${activeBracketIndex.value}`
})

watch(selectedDivisionId, () => {
  activeBracketIndex.value = 1
})

// ── Pool info banner (mirrors the division-detail pool banner) ────
type BannerTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary' | 'secondary'
/** Pool-status pill — same label + tone mapping as the division-detail
 *  banner (generated→warning, in_progress→success, completed→primary,
 *  locked→danger, pending→neutral). */
const poolStatusBadge = computed<{ label: string; tone: BannerTone }>(() => {
  switch (selectedDivision.value?.poolStatus) {
    case 'generated': return { label: 'Generated', tone: 'warning' }
    case 'in_progress': return { label: 'In progress', tone: 'success' }
    case 'completed': return { label: 'Completed', tone: 'primary' }
    case 'locked': return { label: 'Locked', tone: 'danger' }
    default: return { label: 'Pending', tone: 'neutral' }
  }
})
/** Pool game count for the selected division (all pool-type games). */
const poolGameCount = computed<number>(() =>
  (payload.value?.games ?? []).filter(
    (g) => g.divisionId === selectedDivisionId.value && g.type === 'pool'
  ).length
)
/** Active bracket's status pill — dot + tooltip in the bracket banner.
 *  Indexed in step with `bracketNames` via the pager's active index. */
const activeBracketStatusBadge = computed<{ label: string; tone: BannerTone }>(() => {
  const status = selectedDivision.value?.bracketStatuses?.[activeBracketIndex.value - 1] ?? 'pending'
  return { label: bracketStatusLabel(status), tone: bracketStatusTone(status) }
})
const selectedParkId = ref<string>('')
const visibleDateAnchor = ref<string>('')  // YYYY-MM-DD of the day shown in the date strip's "active" cell

/** Left-source-column collapsed state. When `true`, the source
 *  column shrinks to 0 width (CSS handles the transition + hides
 *  the inner content) so the right column reclaims the full
 *  viewport for schedule adjustments. The collapse/expand toggle
 *  lives ON the column border (see template) so the affordance
 *  is reachable in either state — half on the left rail when
 *  expanded, all on the right column when collapsed. */
const sourceCollapsed = ref<boolean>(false)
function toggleSourceCollapsed() {
  sourceCollapsed.value = !sourceCollapsed.value
}

const selectedDivision = computed<SchedulerDivision | undefined>(() =>
  payload.value?.divisions.find((d) => d.id === selectedDivisionId.value)
)

/** Lookup map for resolving a game's `divisionId` → division name.
 *  Used by the embedded `<MatchGeniGameCard>` inside the grid's
 *  cell slot — the card displays the division eyebrow but the
 *  view owns the catalogue, so the view does the resolution and
 *  passes the resolved string. Recomputes whenever the divisions
 *  list changes (rare — usually only on initial payload load). */
const divisionNameById = computed<Map<string, string>>(() => {
  const m = new Map<string, string>()
  for (const d of payload.value?.divisions ?? []) {
    m.set(d.id, d.name)
  }
  return m
})

/** Park id → name, so a scheduled game card can show "Field · Park". */
const parkNameById = computed<Map<string, string>>(() => {
  const m = new Map<string, string>()
  for (const p of payload.value?.parks ?? []) {
    m.set(p.id, p.name)
  }
  return m
})

const selectedPark = computed<SchedulerPark | undefined>(() =>
  payload.value?.parks.find((p) => p.id === selectedParkId.value)
)

/** Games filtered to the active division + phase. Pool games render
 *  under the Pool Play tab; bracket games under Brackets. */
const filteredGames = computed<SchedulerGame[]>(() => {
  if (!payload.value || !selectedDivisionId.value) return []
  return payload.value.games.filter(
    (g) => g.divisionId === selectedDivisionId.value && g.type === activePhase.value
  )
})

// ── Resources "not configured" overlays ──────────────────────────
// When the live resources call returns but a slice isn't usable yet
// (no parks, a park with no fields / empty window, or no divisions),
// the affected pane renders the MOCK payload BLURRED as a backdrop
// with an overlay explaining why scheduling isn't enabled. Reasons
// are independent for the right (grid) and left (divisions) panes.

/** A configure-action link in an overlay. Rendered only when the
 *  caller holds `permission`. `kind` lets `onConfigureResource`
 *  pick the exact destination (the swap point pending product). */
interface ResourceCta {
  label: string
  permission: 'manage_divisions' | 'manage_parks'
  kind: 'park' | 'fields' | 'window' | 'division'
}

/** A "this pane isn't usable yet" descriptor.
 *  - `scope` (grid pane only): `'all'` blurs the ENTIRE right column
 *    (park row included — used when no park exists); `'grid'` keeps
 *    the park row interactive (so the user can switch parks) and
 *    blurs only the calendar area. The left pane ignores `scope`.
 *  - `ctas`: zero or more permission-gated action links; transient
 *    load errors carry none (nothing to configure — just retry). */
interface DisabledReason {
  title: string
  body: string
  scope?: 'all' | 'grid'
  ctas?: ResourceCta[]
}

/** Why the right-hand grid can't be scheduled for the selected park,
 *  or `null` when it's good to go. */
const gridDisabledReason = computed<DisabledReason | null>(() => {
  if (resourceParkCount.value === 0) {
    // No park at all → blur the WHOLE right column (park row too).
    return resourcesLoaded.value
      ? {
          title: 'No parks added yet',
          body: 'Add a park to this event — with its fields and a daily scheduling window — to start placing games.',
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
  // Park exists but isn't fully set up → keep the park row live (so
  // the user can pick another park) and blur only the calendar.
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
      body: `For “${park.name}”, ${parts.join(' and ')}. Configure ${both ? 'them' : 'it'} to schedule games on this park.`,
      scope: 'grid',
      ctas
    }
  }
  return null
})

/** Why the left-hand division list isn't usable, or `null`. */
const divisionsDisabledReason = computed<DisabledReason | null>(() => {
  if (resourceDivisionCount.value === 0) {
    return resourcesLoaded.value
      ? {
          title: 'No divisions yet',
          body: 'Add divisions to this event to schedule their pool and bracket games.',
          ctas: [{ label: 'Add a division', permission: 'manage_divisions', kind: 'division' }]
        }
      : {
          title: 'Couldn’t load divisions',
          body: 'We couldn’t reach the event resources, so the list is sample data.'
        }
  }
  return null
})

/** CTA router — single isolated swap point for the "configure
 *  resource" destinations. Park config lives on the Playing
 *  Facilities sub-page; the create-division destination is pending
 *  product input, so both fall back to a stub toast for now. */
function onConfigureResource(cta: ResourceCta) {
  if (!canMatchGeniWrite(cta.permission)) return
  switch (cta.kind) {
    case 'park':
    case 'fields':
    case 'window':
      // TODO(routing): confirm Playing Facilities covers park +
      // fields + scheduling-window setup, then enable the push below.
      // router.push({ name: 'matchgeni-facilities', params: {
      //   associationShortName: associationShortName.value, eventId: eventId.value } })
      showToast('Playing Facilities setup — coming soon.')
      break
    case 'division':
      // TODO(routing): wire to the create-division route/modal once provided.
      showToast('Add division — coming soon.')
      break
  }
}

// Display bindings — swap to the mock backdrop for a disabled region
// so the blurred panel always has representative content behind the
// overlay message.
const gridPark = computed<SchedulerPark | null>(() =>
  gridDisabledReason.value
    ? (mockPayload.value?.parks[0] ?? null)
    : (selectedPark.value ?? null)
)
const gridGames = computed<SchedulerGame[]>(() =>
  gridDisabledReason.value
    ? (mockPayload.value?.games ?? [])
    : (payload.value?.games ?? [])
)
const gridActiveDate = computed<string>({
  get: () => (gridDisabledReason.value ? mockDateAnchor.value : visibleDateAnchor.value),
  set: (v) => {
    if (gridDisabledReason.value) mockDateAnchor.value = v
    else visibleDateAnchor.value = v
  }
})
const gridBreaks = computed<SchedulerBreak[]>(() => {
  if (gridDisabledReason.value) {
    const mp = mockPayload.value?.parks[0]
    if (!mp?.breaks) return []
    return mp.breaks.filter((b) => b.date === mockDateAnchor.value)
  }
  return activeParkBreaks.value
})
/** Games for the left list — mock backdrop when divisions aren't
 *  configured, else the real filtered set. */
const listGames = computed<SchedulerGame[]>(() => {
  if (!divisionsDisabledReason.value) return filteredGames.value
  const mp = mockPayload.value
  if (!mp) return []
  const firstDiv = mp.divisions[0]?.id
  return mp.games.filter((g) => g.divisionId === firstDiv && g.type === activePhase.value)
})

/* `activeDay`, `scheduledByCell`, `cellKey` were moved into
   `MatchGeniFieldGrid` along with the date strip + table markup —
   the component now derives the active day from its `activeDate`
   prop and computes the cell lookup internally from `props.games`.
   This view's only remaining responsibility around the grid is
   to pass the chosen park + the full game list + the v-model on
   the active date. */

/** Format a `YYYY-MM-DD` ISO date as `Fri April 20, 2026` for the
 *  game-card slot row. Parses as a local-date (not UTC) so the
 *  weekday doesn't shift across timezone boundaries — appending
 *  `T00:00:00` keeps the Date constructor in local time. Returns
 *  the raw input unchanged when the value isn't a parseable ISO
 *  date (defensive: mock payload always sends ISO but real wire
 *  may eventually surface `null` / variant strings). */
function formatGameDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}

// ─── Loading ──────────────────────────────────────────────────────
async function load() {
  loading.value = true
  errorMessage.value = null
  try {
    // Fire access verification + scheduler hydrate in parallel,
    // matching the pattern `MatchGeniDashboardView` uses. The
    // shared `ensureMatchGeniAccess` helper handles:
    //   - cache hit (no re-fetch when nav lands here from another
    //     matchgeni sub-page for the same event)
    //   - 403 / 404 / 409 → toast + redirect to `not-found`
    //   - 5xx / network → redirect to `not-found` (defensive)
    // If access fails the redirect fires inside the helper; the
    // scheduler payload that comes back in parallel is then
    // discarded by the unmount the route change triggers.
    const associationId = currentAssociation.value?.id ?? ''
    // Resources (LIVE) drives parks + divisions; the mock scheduler
    // payload is fetched in parallel purely as the blurred backdrop
    // for the not-configured overlays + the games-API stand-in.
    const [accessOk, resources, mock] = await Promise.all([
      ensureMatchGeniAccess(
        router,
        associationId,
        eventId.value,
        associationShortName.value,
        'manage_scheduling',
        'Game Scheduler'
      ),
      fetchEventResources(associationId, eventId.value, ['parks', 'divisions']).catch((err) => {
        if (typeof console !== 'undefined') {
          console.warn('[scheduler] fetchEventResources failed; using mock backdrop.', err)
        }
        return null
      }),
      fetchMatchGeniScheduler(associationShortName.value, eventId.value)
    ])
    if (!accessOk) return

    mockPayload.value = mock
    mockDateAnchor.value = mock.parks[0]?.days[0]?.date ?? ''
    resourcesLoaded.value = resources !== null

    const resParks = resources?.parks ?? []
    const resDivisions = resources?.divisions ?? []
    resourceParkCount.value = resParks.length
    resourceDivisionCount.value = resDivisions.length

    if (resParks.length > 0 || resDivisions.length > 0) {
      // Build the real payload from live resources (games synthesized
      // to fit until the games API ships).
      payload.value = buildSchedulerFromResources(resParks, resDivisions)
    } else {
      // Nothing configured (or load failed) — fall back to the full
      // mock so the page still renders something behind the overlay.
      payload.value = mock
    }

    const result = payload.value
    // Seed selectors so the user lands on populated columns
    // immediately. They can swap via the dropdowns.
    if (!selectedDivisionId.value && result.divisions.length > 0) {
      selectedDivisionId.value = result.divisions[0].id
    }
    if (!selectedParkId.value && result.parks.length > 0) {
      selectedParkId.value = result.parks[0].id
      visibleDateAnchor.value = result.parks[0].days[0]?.date ?? ''
    }
  } catch (err) {
    if (typeof console !== 'undefined') console.error('Scheduler load failed:', err)
    errorMessage.value = err instanceof Error ? err.message : 'Could not load the scheduler.'
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch([associationShortName, eventId], load)

// When the user switches park, reset the date strip to the new
// park's first day.
watch(selectedParkId, (parkId) => {
  const park = payload.value?.parks.find((p) => p.id === parkId)
  visibleDateAnchor.value = park?.days[0]?.date ?? ''
})

/* `stepDay` was relocated into `MatchGeniFieldGrid` — the date
   strip's prev/next arrows are now inside the component and step
   via its own `stepDay` helper, emitting `update:activeDate` so
   `visibleDateAnchor` here stays in sync via v-model. */

// ─── Drag/drop wiring ─────────────────────────────────────────────
// Real HTML5 drag-and-drop now wired up against the calendar-axis
// grid. The source `<SchedulerGameCard>` emits `dragstart` with the
// game id; the drop strip on `MatchGeniFieldGrid` emits `cell-drop`
// with `{ date, time, field }` (no game payload — drop strips are
// invisible empty targets). On drop we run `findConflicts` against
// the current games + breaks; clean → mutate the game's
// `scheduledDate/Time/FieldLabel`; conflict → flash toast +
// reject. Backend endpoint swap point is `commitGameMove()` below.

/** Tracks the game id being dragged. Used by `onCellDrop` to look
 *  up the game in the local payload mutation step. */
const draggedGameId = ref<string | null>(null)

/** Scheduler notifications now go through the shared app-level toast
 *  (`pushToast`) — the dark bottom-center toast this view originally
 *  pioneered. Tone defaults to success; messages mentioning a rejection
 *  surface as a warning, and callers can pass an explicit tone. */
function showToast(message: string, tone?: ToastTone) {
  pushToast({
    tone: tone ?? (message.toLowerCase().includes('reject') ? 'warning' : 'success'),
    title: message
  })
}

function onDragStart({ event, game }: { event: DragEvent; game: SchedulerGame }) {
  // Defense-in-depth: when a pane is showing the blurred "not
  // configured" backdrop, its cards are MOCK — block drags even if
  // the blur/inert are stripped in devtools.
  if (gridDisabledReason.value || divisionsDisabledReason.value) {
    event.preventDefault()
    return
  }
  if (!event.dataTransfer) return
  draggedGameId.value = game.id
  event.dataTransfer.setData('text/plain', game.id)
  event.dataTransfer.effectAllowed = 'move'
}

function onCellDrop(dropPayload: {
  date: string
  time: string
  field: { name: string }
  game: SchedulerGame | null
  event: DragEvent
}) {
  if (gridDisabledReason.value) return
  if (!dropPayload.event.dataTransfer) return
  const raw = dropPayload.event.dataTransfer.getData('text/plain') || ''
  const park = selectedPark.value
  if (!park) return

  // Drop payload may be a prefixed tag (`game:<id>` /
  // `break:<id>`) set by the field-grid's dragstart handlers, or
  // an UNPREFIXED game id when the drag originated from the
  // source-list card (`SchedulerGameCard` sets plain id). Falling
  // back to the legacy `draggedGameId` ref covers the same
  // unprefixed case if the dataTransfer payload is missing.
  if (raw.startsWith('break:')) {
    const breakId = raw.slice('break:'.length)
    handleBreakDrop(breakId, dropPayload.date, dropPayload.time, dropPayload.field.name)
    draggedGameId.value = null
    return
  }
  const id = raw.startsWith('game:')
    ? raw.slice('game:'.length)
    : raw || draggedGameId.value
  if (!id) return
  const games = payload_games_or_empty()
  const target = games.find((g) => g.id === id)
  if (!target) return
  const duration = effectiveGameDurationMinutes(target, park, eventDefaultDuration.value)
  // Phase 2 — cadence magnet: snap the dropped start to the field's
  // next back-to-back slot when within ~15 min; an off-cadence drop
  // (e.g. a delayed game) stays exactly where it was dropped.
  const dropTime = minutesToHHMM(
    snapStartToCadence(
      minutesFromMidnight(dropPayload.time),
      fieldCadenceStarts(
        games, park.breaks ?? [], park,
        dropPayload.field.name, dropPayload.date, eventDefaultDuration.value, target.id
      )
    )
  )
  const conflicts = findConflicts(
    {
      startTime: dropTime,
      durationMinutes: duration,
      date: dropPayload.date,
      fieldName: dropPayload.field.name,
      ignoreGameId: target.id
    },
    games,
    park.breaks ?? [],
    park,
    eventDefaultDuration.value
  )
  if (conflicts.outOfWindow) {
    showToast('Drop rejected — outside park hours.')
    return
  }
  if (conflicts.breaks.length > 0) {
    showToast(`Drop rejected — conflicts with ${conflicts.breaks[0].label ?? 'a break'}.`)
    return
  }
  if (conflicts.games.length > 0) {
    // Phase 3 — delay cascade. When EVERY colliding game starts at or
    // after the drop (they're LATER games on this field), absorb the
    // delay by pushing them back by the overlap, instead of rejecting.
    // A collision with an earlier game that overruns into the drop is
    // still a hard reject (can't cascade backwards).
    const dropStartMin = minutesFromMidnight(dropTime)
    const dropEndMin = dropStartMin + duration
    const startOf = (g: SchedulerGame) => minutesFromMidnight(g.scheduledTime ?? '')
    const allFollowing = conflicts.games.every((g) => startOf(g) >= dropStartMin)
    if (!allFollowing) {
      showToast(`Drop rejected — overlaps ${conflicts.games[0].label}.`)
      return
    }
    const earliest = Math.min(...conflicts.games.map(startOf))
    const delta = dropEndMin - earliest
    const { shifts, overflow, breakBlocked } = cascadeFollowingGames(
      games, park, dropPayload.field.name, dropPayload.date,
      earliest, delta, eventDefaultDuration.value, target.id, park.breaks ?? []
    )
    if (overflow) {
      showToast('Drop rejected — shifting the later games would run past park hours.')
      return
    }
    if (breakBlocked) {
      showToast('Drop rejected — shifting the later games would collide with a break.')
      return
    }
    // A no-op shift set (shouldn't happen once there's a collision) just
    // commits the move directly. Otherwise hold the move + the computed
    // shifts as a pending confirmation: the admin sees the impacted games
    // (old → new time) and proceeds before anything is mutated.
    if (!shifts.length) {
      commitGameMove(target, dropPayload.date, dropTime, dropPayload.field.name)
      return
    }
    const rows = shifts.map((sh) => {
      const g = games.find((x) => x.id === sh.gameId)
      return {
        label: g?.label ?? sh.gameId,
        teams: g ? `${g.team1Label ?? 'TBD'} vs ${g.team2Label ?? 'TBD'}` : '',
        oldTime: g?.scheduledTime ?? '—',
        newTime: to12h(sh.startTime)
      }
    })
    pendingShift.value = {
      target,
      date: dropPayload.date,
      dropTime,
      fieldName: dropPayload.field.name,
      shifts,
      delta,
      movedNewTime: to12h(dropTime),
      fieldPark: [dropPayload.field.name, park.name].filter(Boolean).join(' · '),
      rows
    }
    shiftConfirmOpen.value = true
    return
  }
  commitGameMove(target, dropPayload.date, dropTime, dropPayload.field.name)
}

// ─── Drag-cascade confirmation ────────────────────────────────────
// When a drop would shift the later games on a field, the move is held
// here until the admin confirms it in `SchedulerShiftConfirmModal`.
interface PendingShift {
  target: SchedulerGame
  date: string
  dropTime: string // 'HH:MM'
  fieldName: string
  shifts: { gameId: string; startTime: string }[]
  delta: number
  movedNewTime: string // 12h label for the dragged game's new slot
  fieldPark: string
  rows: { label: string; teams: string; oldTime: string; newTime: string }[]
}
const pendingShift = ref<PendingShift | null>(null)
const shiftConfirmOpen = ref(false)

/** Apply the held move + cascade once the admin confirms. */
function onConfirmShift() {
  const pend = pendingShift.value
  if (!pend) return
  const games = payload_games_or_empty()
  commitGameMove(pend.target, pend.date, pend.dropTime, pend.fieldName)
  for (const sh of pend.shifts) {
    const g = games.find((x) => x.id === sh.gameId)
    if (g) g.scheduledTime = to12h(sh.startTime)
  }
  showToast(
    `Shifted ${pend.shifts.length} later game${pend.shifts.length === 1 ? '' : 's'} +${pend.delta} min to absorb the delay.`
  )
  shiftConfirmOpen.value = false
  pendingShift.value = null
}

/** Back out of the move — nothing is mutated. */
function onCancelShift() {
  shiftConfirmOpen.value = false
  pendingShift.value = null
}

/** Helper — payload is `Ref<MatchGeniSchedulerPayload | null>`, so
 *  every consumer that needs the games array goes through this
 *  guard. */
function payload_games_or_empty(): SchedulerGame[] {
  return payload.value?.games ?? []
}

/** 24h `'HH:MM'` → the 12h `'hh:MM AM/PM'` shape `scheduledTime` uses. */
function to12h(time24: string): string {
  const [hStr, mStr] = time24.split(':')
  const h24 = Number.parseInt(hStr, 10)
  const m = Number.parseInt(mStr, 10)
  const meridiem = h24 >= 12 ? 'PM' : 'AM'
  let h12 = h24 % 12
  if (h12 === 0) h12 = 12
  return `${h12.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${meridiem}`
}

function commitGameMove(
  game: SchedulerGame,
  date: string,
  time24: string, // 'HH:MM'
  fieldName: string
) {
  // Format 24h → 12h for the existing `scheduledTime` shape. Other
  // places (cards, lookup keys) consume the 12h variant.
  const time12 = to12h(time24)

  // Field label format mirrors mock convention `'F<n> - <abbrev>'`.
  // Strip 'Field ' prefix if present so the abbreviated form is
  // emitted; otherwise pass the raw name through.
  const fieldShort = fieldName.startsWith('Field ')
    ? `F${fieldName.slice('Field '.length)}`
    : fieldName
  // Match abbrev from the park (e.g. 'H1 Park' for park_1). Look up
  // any other game on the same park to copy the format from.
  const sample = payload_games_or_empty().find(
    (g) => g.parkId === game.parkId && g.scheduledFieldLabel
  )
  const abbrev = sample?.scheduledFieldLabel?.split(' - ')[1] ?? ''
  const fullFieldLabel = abbrev ? `${fieldShort} - ${abbrev}` : fieldShort

  game.scheduledDate = date
  game.scheduledTime = time12
  game.scheduledFieldLabel = fullFieldLabel
  draggedGameId.value = null
  // Toast shows time + field (NOT date) — the date is already
  // implicit in the user's selected day on the date strip, so
  // re-stating it adds noise. Field name + start time pinpoint
  // the new placement uniquely within the visible grid.
  showToast(`Moved ${game.label} to ${time12} on ${fieldName}.`)
}

/** Reschedule a break by drag — fired from `onCellDrop` when the
 *  dragged item carries a `break:` prefix. Mirrors the
 *  game-move flow: conflict-check first, commit only when the
 *  proposed placement is clear; otherwise toast + revert.
 *
 *  Conflict semantics differ by scope:
 *    - Park-wide break: target time must be free on EVERY
 *      field column for the full duration. Field name in the
 *      drop payload is ignored (the break stays park-wide; only
 *      the start time changes).
 *    - Field-scope break: target (fieldName, time) must be free.
 *      Both startTime AND fieldName may change. */
function handleBreakDrop(
  breakId: string,
  date: string,
  time24: string,
  fieldName: string
) {
  const park = selectedPark.value
  if (!park || !park.breaks) return
  const brk = park.breaks.find((b) => b.id === breakId)
  if (!brk) return
  const games = payload_games_or_empty()
  const otherBreaks = park.breaks.filter((b) => b.id !== brk.id)
  const fieldsToCheck = brk.scope === 'park'
    ? park.fields.map((f) => f.name)
    : [fieldName]
  for (const checkField of fieldsToCheck) {
    const conflicts = findConflicts(
      {
        startTime: time24,
        durationMinutes: brk.durationMinutes,
        date,
        fieldName: checkField
      },
      games,
      otherBreaks,
      park,
      payload.value?.eventDefaultGameDurationMinutes
    )
    if (conflicts.outOfWindow) {
      showToast('Drop rejected — outside park hours.')
      return
    }
    if (conflicts.games.length > 0) {
      showToast(`Drop rejected — conflicts with ${conflicts.games[0].label}.`)
      return
    }
    if (conflicts.breaks.length > 0) {
      showToast(`Drop rejected — conflicts with ${conflicts.breaks[0].label ?? 'another break'}.`)
      return
    }
  }
  // Commit — mutate the break's date + startTime in place.
  // For field-scope breaks, also update the affected field.
  brk.date = date
  brk.startTime = time24
  if (brk.scope === 'field') brk.fieldName = fieldName
  showToast(
    brk.scope === 'field'
      ? `Moved break "${brk.label ?? 'Break'}" to ${time24} on ${fieldName}.`
      : `Moved break "${brk.label ?? 'Break'}" to ${time24}.`
  )
}


// ─── Breaks CRUD ──────────────────────────────────────────────────

/** Form mount state. `null` = closed; `{ kind: 'create' }` opens for
 *  a new break at the hovered start time; `{ kind: 'edit', brk }`
 *  opens pre-filled with an existing break's fields. */
const breakForm = ref<
  | {
      kind: 'create'
      date: string
      startTime: string
      scope?: 'park' | 'field'
      fieldName?: string
      durationMinutes?: number
    }
  | { kind: 'edit'; brk: SchedulerBreak }
  | null
>(null)

function onBreakAddRequest(payload: { date: string; startTime: string }) {
  if (gridDisabledReason.value) return
  breakForm.value = { kind: 'create', date: payload.date, startTime: payload.startTime }
}

function onBreakEditRequest(brk: SchedulerBreak) {
  if (gridDisabledReason.value) return
  breakForm.value = { kind: 'edit', brk }
}
function onBreakDelete(brk: SchedulerBreak) {
  if (gridDisabledReason.value) return
  const park = selectedPark.value
  if (!park || !park.breaks) return
  park.breaks = park.breaks.filter((b) => b.id !== brk.id)
  showToast(`Removed break "${brk.label ?? 'Break'}".`)
}
/** Delete fired from the Edit-break popup's footer button.
 *  Same logic as `onBreakDelete`, but ALSO closes the popup
 *  since the user is acting from inside it. */
function onBreakDeleteFromForm(brk: SchedulerBreak) {
  onBreakDelete(brk)
  breakForm.value = null
}
function onBreakFormClose() {
  breakForm.value = null
}
// ─── Break placement + conflict resolution ───────────────────────
// Adding OR editing a break runs the same rules: reject if it lands
// outside park hours or on an already-underway game; commit cleanly if
// it fits; otherwise offer the admin a choice (move the later games, or
// shorten the break) via SchedulerBreakConflictModal.

interface BreakMoveRow {
  label: string
  teams: string
  oldTime: string
  newTime: string
}

type BreakDecision =
  | { kind: 'commit' }
  | { kind: 'reject'; message: string }
  | {
      kind: 'conflict'
      canMove: boolean
      moveShifts: { gameId: string; startTime: string }[]
      moveRows: BreakMoveRow[]
      canShorten: boolean
      shortenTo: number
      conflictLabel: string
      fieldPark: string
    }

/** Build the move-preview rows (old → new + teams) from a shift set.
 *  Read before any mutation. */
function buildBreakMoveRows(
  shifts: { gameId: string; startTime: string }[],
  games: SchedulerGame[]
): BreakMoveRow[] {
  return shifts.map((sh) => {
    const g = games.find((x) => x.id === sh.gameId)
    return {
      label: g?.label ?? sh.gameId,
      teams: g ? `${g.team1Label ?? 'TBD'} vs ${g.team2Label ?? 'TBD'}` : '',
      oldTime: g?.scheduledTime ?? '—',
      newTime: to12h(sh.startTime)
    }
  })
}

/** Decide what happens when a break with `payload` is placed on `park`.
 *  `excludeBreakId` drops the break being edited from the conflict set so
 *  it never collides with its own previous footprint. */
function evaluateBreakPlacement(
  park: SchedulerPark,
  payload: Omit<SchedulerBreak, 'id'>,
  excludeBreakId?: string
): BreakDecision {
  const games = payload_games_or_empty()
  const otherBreaks = (park.breaks ?? []).filter((b) => b.id !== excludeBreakId)
  const breakStart = minutesFromMidnight(payload.startTime)
  const breakEnd = breakStart + payload.durationMinutes
  const fieldNames = payload.scope === 'park'
    ? park.fields.map((f) => f.name)
    : [payload.fieldName ?? '']

  // Gather overlapping games across the affected field(s), tracking each
  // field's earliest overlapping game start (anchor for both resolutions).
  const overlappingGames: SchedulerGame[] = []
  const earliestByField = new Map<string, number>()
  for (const fieldName of fieldNames) {
    const conflicts = findConflicts(
      { startTime: payload.startTime, durationMinutes: payload.durationMinutes, date: payload.date, fieldName },
      games, otherBreaks, park, eventDefaultDuration.value
    )
    if (conflicts.outOfWindow) {
      return { kind: 'reject', message: 'Break rejected — outside park hours.' }
    }
    for (const g of conflicts.games) {
      overlappingGames.push(g)
      const s = minutesFromMidnight(g.scheduledTime ?? '')
      const cur = earliestByField.get(fieldName)
      if (cur === undefined || s < cur) earliestByField.set(fieldName, s)
    }
  }

  if (overlappingGames.length === 0) return { kind: 'commit' }

  // A break landing on a game already underway (starts BEFORE the break)
  // can't be fixed by trimming the end or pushing later games.
  const allFollowing = overlappingGames.every(
    (g) => minutesFromMidnight(g.scheduledTime ?? '') >= breakStart
  )
  if (!allFollowing) {
    return { kind: 'reject', message: `Break rejected — overlaps ${overlappingGames[0].label}.` }
  }

  // Option A — move later games: cascade each field so its first
  // overlapping game clears the break end.
  const moveShifts: { gameId: string; startTime: string }[] = []
  let canMove = true
  for (const [fieldName, earliest] of earliestByField) {
    const { shifts, overflow, breakBlocked } = cascadeFollowingGames(
      games, park, fieldName, payload.date, earliest, breakEnd - earliest,
      eventDefaultDuration.value, undefined, otherBreaks
    )
    if (overflow || breakBlocked || shifts.length === 0) { canMove = false; break }
    moveShifts.push(...shifts)
  }

  // Option B — shorten to the smallest gap before a following game.
  let shortenTo = Infinity
  for (const earliest of earliestByField.values()) {
    shortenTo = Math.min(shortenTo, earliest - breakStart)
  }
  const canShorten = Number.isFinite(shortenTo) && shortenTo >= ROW_GRANULARITY_MINUTES

  if (!canMove && !canShorten) {
    return { kind: 'reject', message: `Break rejected — overlaps ${overlappingGames[0].label}.` }
  }

  const fieldPark = payload.scope === 'field'
    ? [payload.fieldName, park.name].filter(Boolean).join(' · ')
    : park.name
  return {
    kind: 'conflict',
    canMove,
    moveShifts: canMove ? moveShifts : [],
    moveRows: canMove ? buildBreakMoveRows(moveShifts, payload_games_or_empty()) : [],
    canShorten,
    shortenTo: Number.isFinite(shortenTo) ? shortenTo : 0,
    conflictLabel: overlappingGames[0].label,
    fieldPark
  }
}

function onBreakFormCreate(payload: Omit<SchedulerBreak, 'id'>) {
  const park = selectedPark.value
  if (!park) return
  const decision = evaluateBreakPlacement(park, payload)
  if (decision.kind === 'reject') { showToast(decision.message, 'warning'); return }
  if (decision.kind === 'commit') {
    pushBreak(park, payload)
    showToast(`Added break "${payload.label ?? 'Break'}".`)
    return
  }
  const { kind: _k, ...rest } = decision
  pendingBreakConflict.value = { mode: 'create', payload, ...rest }
  breakConflictOpen.value = true
}

function onBreakFormUpdate(brk: SchedulerBreak) {
  const park = selectedPark.value
  if (!park) return
  const decision = evaluateBreakPlacement(park, brk, brk.id)
  if (decision.kind === 'reject') { showToast(decision.message, 'warning'); return }
  if (decision.kind === 'commit') {
    replaceBreak(park, brk.id, brk)
    showToast(`Updated break "${brk.label ?? 'Break'}".`)
    return
  }
  const { kind: _k, ...rest } = decision
  pendingBreakConflict.value = { mode: 'edit', editId: brk.id, payload: brk, ...rest }
  breakConflictOpen.value = true
}

/** Create + append a break (optionally with a trimmed duration) and close
 *  the break form. No toast — callers message per resolution. */
function pushBreak(
  park: SchedulerPark,
  payload: Omit<SchedulerBreak, 'id'>,
  durationOverride?: number
) {
  const newBreak: SchedulerBreak = {
    id: `brk_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    ...payload,
    ...(durationOverride != null ? { durationMinutes: durationOverride } : {})
  }
  park.breaks = [...(park.breaks ?? []), newBreak]
  breakForm.value = null
}

/** Replace an existing break in place (preserving its id), optionally with
 *  a trimmed duration. */
function replaceBreak(
  park: SchedulerPark,
  id: string,
  payload: Omit<SchedulerBreak, 'id'>,
  durationOverride?: number
) {
  park.breaks = (park.breaks ?? []).map((b) =>
    b.id === id
      ? { ...b, ...payload, id, ...(durationOverride != null ? { durationMinutes: durationOverride } : {}) }
      : b
  )
  breakForm.value = null
}

interface PendingBreakConflict {
  mode: 'create' | 'edit'
  editId?: string
  payload: Omit<SchedulerBreak, 'id'>
  canMove: boolean
  moveShifts: { gameId: string; startTime: string }[]
  moveRows: BreakMoveRow[]
  canShorten: boolean
  shortenTo: number
  conflictLabel: string
  fieldPark: string
}
const pendingBreakConflict = ref<PendingBreakConflict | null>(null)
const breakConflictOpen = ref(false)

function onBreakConflictMove() {
  const pend = pendingBreakConflict.value
  const park = selectedPark.value
  if (!pend || !park) return
  const games = payload_games_or_empty()
  for (const sh of pend.moveShifts) {
    const g = games.find((x) => x.id === sh.gameId)
    if (g) g.scheduledTime = to12h(sh.startTime)
  }
  if (pend.mode === 'edit' && pend.editId) replaceBreak(park, pend.editId, pend.payload)
  else pushBreak(park, pend.payload)
  showToast(
    `${pend.mode === 'edit' ? 'Updated' : 'Added'} break "${pend.payload.label ?? 'Break'}" — shifted ${pend.moveShifts.length} later game${pend.moveShifts.length === 1 ? '' : 's'}.`
  )
  closeBreakConflict()
}

function onBreakConflictShorten() {
  const pend = pendingBreakConflict.value
  const park = selectedPark.value
  if (!pend || !park) return
  if (pend.mode === 'edit' && pend.editId) replaceBreak(park, pend.editId, pend.payload, pend.shortenTo)
  else pushBreak(park, pend.payload, pend.shortenTo)
  showToast(
    `${pend.mode === 'edit' ? 'Updated' : 'Added'} break "${pend.payload.label ?? 'Break'}" — shortened to ${pend.shortenTo} min.`
  )
  closeBreakConflict()
}

function closeBreakConflict() {
  breakConflictOpen.value = false
  pendingBreakConflict.value = null
}

// ─── Empty-slot "add" popover ─────────────────────────────────────
// Clicking an empty grid cell opens a small popover anchored at the
// click with two entry points: add a break here, or create a new pool
// game here. The slot context (date / time / field / available gap) is
// captured so both flows open pre-filled.
interface EmptySlotCtx {
  x: number
  y: number
  date: string
  time: string // 'HH:MM' 24h
  fieldName: string
  availableMinutes: number
}
const emptySlotMenu = ref<EmptySlotCtx | null>(null)

function onCellEmptyClick(p: {
  date: string
  time: string
  field: { name: string }
  availableMinutes: number
  x: number
  y: number
}) {
  if (gridDisabledReason.value) return
  emptySlotMenu.value = {
    x: p.x,
    y: p.y,
    date: p.date,
    time: p.time,
    fieldName: p.field.name,
    availableMinutes: p.availableMinutes
  }
}
function closeEmptySlotMenu() { emptySlotMenu.value = null }

/** Slot range label for the add-slot popup — collapsed-meridiem range
 *  (e.g. "1:30 – 3:00 PM"), matching the grid cards. */
const addSlotRangeLabel = computed<string>(() => {
  const m = emptySlotMenu.value
  if (!m) return ''
  const startMin = minutesFromMidnight(m.time)
  return formatTimeRange(startMin, startMin + m.availableMinutes)
})
/** Date label for the add-slot popup — e.g. "Sun, May 24". */
const addSlotDateLabel = computed<string>(() => {
  const m = emptySlotMenu.value
  if (!m) return ''
  const d = new Date(`${m.date}T00:00:00`)
  if (Number.isNaN(d.getTime())) return m.date
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
})

/** Formatted active date — header context for the selection-mode popups. */
const selectionDateLabel = computed<string>(() => {
  if (!gridActiveDate.value) return ''
  const d = new Date(`${gridActiveDate.value}T00:00:00`)
  if (Number.isNaN(d.getTime())) return gridActiveDate.value
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
})

/** "Add break" from the slot popover → open the break form pre-filled
 *  with the clicked field (field-scope) + start time, duration seeded to
 *  the gap (capped at 30). */
function addBreakFromSlot() {
  const m = emptySlotMenu.value
  if (!m) return
  breakForm.value = {
    kind: 'create',
    date: m.date,
    startTime: m.time,
    scope: 'field',
    fieldName: m.fieldName,
    durationMinutes: Math.max(ROW_GRANULARITY_MINUTES, Math.min(m.availableMinutes, 30))
  }
  closeEmptySlotMenu()
}

// ─── Create-game flow (new matchup from an empty slot) ────────────

/** Distinct team labels per division, derived from existing games
 *  (the scheduler payload carries no team roster). Skips bracket
 *  placeholder labels ("Winner of …" / "Loser of …") + empty slots. */
const teamLabelsByDivision = computed<Record<string, string[]>>(() => {
  const out: Record<string, Set<string>> = {}
  for (const g of payload_games_or_empty()) {
    const bucket = (out[g.divisionId] ??= new Set<string>())
    for (const label of [g.team1Label, g.team2Label]) {
      if (!label) continue
      if (/^(winner|loser) of /i.test(label)) continue
      bucket.add(label)
    }
  }
  const result: Record<string, string[]> = {}
  for (const [divId, set] of Object.entries(out)) {
    result[divId] = [...set].sort((a, b) => a.localeCompare(b))
  }
  return result
})

/** Default official TIME LIMIT (min) per game type — the regulation game
 *  length defined at the EVENT level (pool/bracket/championship). Games copy
 *  this at creation; it's distinct from the grid time slot (`durationMinutes`)
 *  and is what the live-scoring surface uses for remaining / over-time. The
 *  scheduler payload doesn't carry an event-level time-limit config yet, so
 *  these stand in as the event defaults. */
const DEFAULT_TIME_LIMIT_BY_TYPE: Record<SchedulerGame['type'], number> = {
  pool: 65,
  bracket: 70
}

/** "Fri, May 22, 2026" from an ISO date string. */
function formatDateLong(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

// The add/edit pool-game modal is a single instance driven by this state.
// `mode` switches title/CTA + commit path; `place*` carries the slot the
// new game drops onto (create only); `gameId` is the target (edit only).
interface GameModalState {
  mode: 'create' | 'edit'
  divisionId: string
  divisionName: string
  dateLabel: string
  timeLabel: string
  fieldName: string
  parkName: string
  teamOptions: string[]
  defaultDuration: number
  maxDuration: number
  defaultTimeLimit: number
  initialName: string
  initialTeam1: string
  initialTeam2: string
  initialDuration: number
  initialTimeLimit: number
  placeDate: string | null
  placeTime: string | null // 'HH:MM' 24h
  placeField: string | null
  gameId: string | null
}
const gameModalOpen = ref(false)
const gameModal = ref<GameModalState | null>(null)

/** "Add pool game" from the empty-slot popover — division is fixed to the
 *  one selected on the scheduler screen. */
function addGameFromSlot() {
  const m = emptySlotMenu.value
  const park = selectedPark.value
  const div = selectedDivision.value
  if (!m || !park || !div) return
  const games = payload_games_or_empty()
  const poolCount = games.filter((g) => g.divisionId === div.id && g.type === 'pool').length
  gameModal.value = {
    mode: 'create',
    divisionId: div.id,
    divisionName: div.name,
    dateLabel: formatDateLong(m.date),
    timeLabel: to12h(m.time),
    fieldName: m.fieldName,
    parkName: park.name,
    teamOptions: teamLabelsByDivision.value[div.id] ?? [],
    defaultDuration: park.defaultGameDurationMinutes ?? 90,
    maxDuration: m.availableMinutes,
    defaultTimeLimit: DEFAULT_TIME_LIMIT_BY_TYPE.pool,
    initialName: `Pool ${poolCount + 1}`,
    initialTeam1: '',
    initialTeam2: '',
    initialDuration: 0,
    initialTimeLimit: 0,
    placeDate: m.date,
    placeTime: m.time,
    placeField: m.fieldName,
    gameId: null
  }
  gameModalOpen.value = true
  closeEmptySlotMenu()
}

/** "Edit game" from the game-details drawer — pool games only. */
function openEditGame(game: SchedulerGame) {
  if (game.type !== 'pool') return
  const park = payload.value?.parks.find((p) => p.id === game.parkId) ?? selectedPark.value
  gameModal.value = {
    mode: 'edit',
    divisionId: game.divisionId,
    divisionName: divisionNameById.value.get(game.divisionId) ?? '',
    dateLabel: formatDateLong(game.scheduledDate),
    timeLabel: game.scheduledTime ?? '',
    fieldName: game.scheduledFieldLabel ?? '',
    parkName: park?.name ?? '',
    teamOptions: teamLabelsByDivision.value[game.divisionId] ?? [],
    defaultDuration: park?.defaultGameDurationMinutes ?? 90,
    maxDuration: 0, // edit: no slot cap
    defaultTimeLimit: DEFAULT_TIME_LIMIT_BY_TYPE[game.type] ?? DEFAULT_TIME_LIMIT_BY_TYPE.pool,
    initialName: game.label,
    initialTeam1: game.team1Label ?? '',
    initialTeam2: game.team2Label ?? '',
    initialDuration: game.durationMinutes ?? 0,
    initialTimeLimit: game.timeLimitMinutes ?? 0,
    placeDate: null,
    placeTime: null,
    placeField: null,
    gameId: game.id
  }
  drawerOpen.value = false
  gameModalOpen.value = true
}

/** Commit the add/edit form. Create drops a new matchup onto the clicked
 *  slot (a known-empty gap the modal capped the duration to, so it always
 *  fits — no cascade). Edit updates the existing game in place. */
function onGameModalSubmit(p: {
  name: string
  team1Label: string
  team2Label: string
  durationMinutes: number
  timeLimitMinutes: number
}) {
  const s = gameModal.value
  if (!s) return

  if (s.mode === 'edit' && s.gameId) {
    const game = payload_games_or_empty().find((g) => g.id === s.gameId)
    if (game) {
      game.label = p.name
      game.team1Label = p.team1Label
      game.team2Label = p.team2Label
      game.durationMinutes = p.durationMinutes
      game.timeLimitMinutes = p.timeLimitMinutes
      showToast(`Updated ${p.name} (${p.team1Label} vs ${p.team2Label}).`)
    }
    gameModalOpen.value = false
    gameModal.value = null
    return
  }

  // Create
  const park = selectedPark.value
  if (!park || !s.placeDate || !s.placeTime || !s.placeField) return
  const games = payload_games_or_empty()
  const newGame: SchedulerGame = {
    id: `game_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    divisionId: s.divisionId,
    parkId: park.id,
    type: 'pool',
    label: p.name,
    team1Label: p.team1Label,
    team2Label: p.team2Label,
    scheduledDate: null,
    scheduledTime: null,
    scheduledFieldLabel: null,
    status: 'scheduled',
    durationMinutes: p.durationMinutes,
    timeLimitMinutes: p.timeLimitMinutes,
    matchupEditable: true
  }
  if (payload.value) payload.value.games = [...games, newGame]
  // Place it on the slot (sets date/time/field label + parkId-derived
  // field abbrev) via the shared mover.
  commitGameMove(newGame, s.placeDate, s.placeTime, s.placeField)
  showToast(`Added ${newGame.label} (${p.team1Label} vs ${p.team2Label}).`)
  gameModalOpen.value = false
  gameModal.value = null
}

// ─── Bulk duration modal ─────────────────────────────────────────

// ── Game-details drawer ─────────────────────────────────────────
//
// Clicking a game card on the grid opens the same
// `ScoringGameDetailsDrawer` the division page + field-grid
// scoring page use. The drawer decides which controls to render
// from the caller's MatchGeni permissions for the game (NOT from
// this surface): scoring lifecycle for `manage_scoring`, "Edit
// game" for `manage_scheduling`/`manage_divisions`, umpire
// assignment for `manage_umpires`. A user who can score / edit
// here doesn't have to detour to another page to do it.
//
// Browser routes click vs drag natively: a quick mousedown +
// mouseup with no movement fires `click`; mousedown + drag
// past the ~3-5px threshold fires `dragstart` and suppresses
// the trailing `click`. No flag-based gating needed.

const drawerOpen = ref(false)
const drawerGame = ref<SchedulerGame | null>(null)

function onCellClick(payload: { game: SchedulerGame | null }) {
  if (gridDisabledReason.value) return
  if (!payload.game) return
  // In selection mode, clicking a selectable card toggles it instead of
  // opening the drawer.
  if (selectionActive.value && isGameSelectable(payload.game)) {
    toggleSelectGame(payload.game)
    return
  }
  drawerGame.value = payload.game
  drawerOpen.value = true
}

/** Clicking a source-column game card opens the same details drawer. */
function onGameCardOpen(game: SchedulerGame) {
  if (gridDisabledReason.value) return
  drawerGame.value = game
  drawerOpen.value = true
}

const bulkModalOpen = ref(false)
/** When true, the bulk-duration modal operates on the current SELECTION
 *  (from the selection bar's "Modify › Slot duration"). */
const bulkSelectionMode = ref(false)
function closeBulkModal() { bulkModalOpen.value = false; bulkSelectionMode.value = false }

function onBulkApply(payload: {
  date: string
  durationMinutes: number
  affectedGameIds: string[]
  skippedCount: number
}) {
  const games = payload_games_or_empty()
  const affectedSet = new Set(payload.affectedGameIds)
  for (const g of games) {
    if (affectedSet.has(g.id)) g.durationMinutes = payload.durationMinutes
  }
  bulkModalOpen.value = false
  if (bulkSelectionMode.value) { bulkSelectionMode.value = false; clearSelection() }
  const verb = payload.affectedGameIds.length === 1 ? 'game' : 'games'
  showToast(
    `Set ${payload.affectedGameIds.length} ${verb} to ${payload.durationMinutes} min.` +
    (payload.skippedCount > 0 ? ` Skipped ${payload.skippedCount} locked.` : '')
  )
}

// ─── Selection mode (bulk event-day management) ───────────────────
// Hovering a non-final game on the grid reveals a checkbox; selecting
// games enters selection mode (a top bar with bulk actions). Scope is
// the current park + date — selection clears on park/date change + Esc.
const selectedGameIds = ref<Set<string>>(new Set())
const selectionActive = computed(() => selectedGameIds.value.size > 0)

function isGameSelectable(g: SchedulerGame): boolean {
  return g.status !== 'final' && !g.locked
}
function toggleSelectGame(g: SchedulerGame) {
  if (!isGameSelectable(g)) return
  const next = new Set(selectedGameIds.value)
  if (next.has(g.id)) next.delete(g.id)
  else next.add(g.id)
  selectedGameIds.value = next
}
function clearSelection() {
  if (selectedGameIds.value.size) selectedGameIds.value = new Set()
}
const selectedGames = computed<SchedulerGame[]>(() => {
  const ids = selectedGameIds.value
  return payload_games_or_empty().filter((g) => ids.has(g.id))
})
const selectionIdsArray = computed<string[]>(() => [...selectedGameIds.value])

// Scope guard — drop the selection whenever the visible park or date
// changes (you can only act on what you can see).
watch([selectedParkId, visibleDateAnchor], () => clearSelection())

/** Build a `F<n> - <abbrev>` / `<name> - <abbrev>` field label for a
 *  park (abbrev copied from any existing game on that park). Shared by
 *  the cross-park move apply. */
function fieldLabelForPark(parkId: string, fieldName: string): string {
  const fieldShort = fieldName.startsWith('Field ')
    ? `F${fieldName.slice('Field '.length)}`
    : fieldName
  const sample = payload_games_or_empty().find(
    (g) => g.parkId === parkId && g.scheduledFieldLabel
  )
  const abbrev = sample?.scheduledFieldLabel?.split(' - ')[1] ?? ''
  return abbrev ? `${fieldShort} - ${abbrev}` : fieldShort
}

// ── Action: Modify › Slot duration (reuses the bulk-duration modal) ──
function openModifyDurationForSelection() {
  if (!selectionActive.value) return
  bulkSelectionMode.value = true
  bulkModalOpen.value = true
}

// ── Action: Move (cross-park, keep times) ───────────────────────────
const moveModalOpen = ref(false)
const moveTargetParks = computed<SchedulerPark[]>(() =>
  (payload.value?.parks ?? []).filter((p) => p.id !== selectedParkId.value)
)
function openMoveForSelection() {
  if (!selectionActive.value || !moveTargetParks.value.length) return
  moveModalOpen.value = true
}
function onMoveConfirm(p: { targetParkId: string; date: string; durationOverride?: number }) {
  const target = (payload.value?.parks ?? []).find((pk) => pk.id === p.targetParkId)
  if (!target) return
  // Day-windowed target for the packer (mirrors the modal's preview).
  const day = target.days.find((d) => d.date === p.date)
  const destDayPark = day?.startTime && day?.endTime
    ? { ...target, dayStartTime: day.startTime, dayEndTime: day.endTime }
    : target
  const result = packGamesToDestination(
    selectedGames.value, destDayPark, payload_games_or_empty(),
    p.date, eventDefaultDuration.value, p.durationOverride
  )
  for (const pl of result.placements) {
    const g = pl.game
    g.parkId = target.id
    g.scheduledDate = p.date
    g.scheduledTime = to12h(pl.startTime)
    g.scheduledFieldLabel = fieldLabelForPark(target.id, pl.fieldName)
    if (p.durationOverride && p.durationOverride > 0) g.durationMinutes = p.durationOverride
  }
  const skipped = result.unplaced.length
  moveModalOpen.value = false
  clearSelection()
  selectedParkId.value = target.id // jump the view to the destination park
  visibleDateAnchor.value = p.date // …and to the chosen date
  showToast(
    `Moved ${result.placements.length} game${result.placements.length === 1 ? '' : 's'} to ${target.name}` +
    (skipped > 0 ? ` — ${skipped} didn't fit.` : '.')
  )
}

// ── Action: Unschedule (return to pool) — lightweight confirm ────────
const unscheduleConfirmOpen = ref(false)
function openUnscheduleForSelection() {
  if (!selectionActive.value) return
  unscheduleConfirmOpen.value = true
}
function confirmUnscheduleSelection() {
  const n = selectedGames.value.length
  for (const g of selectedGames.value) {
    g.scheduledDate = null
    g.scheduledTime = null
    g.scheduledFieldLabel = null
  }
  unscheduleConfirmOpen.value = false
  clearSelection()
  showToast(`Un-scheduled ${n} game${n === 1 ? '' : 's'}.`)
}

// ── Action: Mark delayed ────────────────────────────────────────────
const markDelayedOpen = ref(false)
function openMarkDelayedForSelection() {
  if (!selectionActive.value) return
  markDelayedOpen.value = true
}
function onMarkDelayedConfirm(p: { reason: string }) {
  let n = 0
  for (const g of selectedGames.value) {
    if (g.status === 'final') continue
    g.status = 'delayed'
    g.delayReason = p.reason || undefined
    n++
  }
  markDelayedOpen.value = false
  clearSelection()
  showToast(`Marked ${n} game${n === 1 ? '' : 's'} delayed.`)
}

/** Breaks on the active park for the active date — passed into
 *  `MatchGeniFieldGrid` via `:park-breaks`. Pre-filtered here so
 *  the grid doesn't need to know about the `date === activeDate`
 *  rule. */
const activeParkBreaks = computed<SchedulerBreak[]>(() => {
  const park = selectedPark.value
  if (!park || !park.breaks || !visibleDateAnchor.value) return []
  return park.breaks.filter((b) => b.date === visibleDateAnchor.value)
})

/** Phase-settings dropdown menu — opens off the cog in the
 *  info banner. Different menu items per phase:
 *    Pool:    Regenerate Pool / Auto Schedule
 *    Bracket: Add Bracket / Edit Bracket / [div] / Delete Bracket
 *
 *  (Preview Bracket lives on the toolbar's standalone eye-icon
 *  button next to the bracket pager — see the toolbar block in
 *  the template for the affordance.) */
// (Removed: per-phase settings cog menu + its open/close state +
// outside-click handler. The Pool tab now shows a single
// "Regenerate Pool" icon button on the info banner, and the
// Bracket tab shows "Edit Bracket" — both direct one-click
// affordances. Auto Schedule + bulk operations live in the
// park-head's "More actions" dropdown.)

function onPoolRegenerate() {
  // TODO — wire POST `/v2/.../pool/regenerate` when shipped.
}
function onNewPoolGame() {
  // TODO — open the "New Pool Game" creation modal when shipped.
  // Adds a single ad-hoc pool game to the active division
  // (outside the auto-generated round-robin set).
}
/** Dispatches to the right phase-aware endpoint based on
 *  `activePhase`. Pool path: POST `/v2/.../pool/auto-schedule`.
 *  Bracket path: POST `/v2/.../bracket/{id}/auto-schedule`. */
// ── Add / Edit Bracket modal ─────────────────────────────────────
// `bracketFormEditId` null → New Bracket; non-null → Edit Bracket for
// that bracket index (stringified for the form's id-driven mode).
const bracketFormOpen = ref(false)
const bracketFormEditId = ref<string | null>(null)

/** Team-label catalogue for the modal's "Custom Team Selection"
 *  picker. There's no per-division roster endpoint yet, so derive a
 *  placeholder set from the division's `teamCount`. Swap for the real
 *  roster when the teams API lands. */
const bracketTeamOptions = computed<string[]>(() => {
  const count = selectedDivision.value?.teamCount ?? 0
  return Array.from({ length: count }, (_, i) => `Team ${i + 1}`)
})

/** Name/format prefill for the Edit flow — sourced from the active
 *  bracket's switch item (mock). Real values arrive with the bracket
 *  detail endpoint. */
const bracketFormPrefillName = computed(() => {
  if (bracketFormEditId.value === null) return ''
  const item = previewSwitchItems.value.find((s) => String(s.index) === bracketFormEditId.value)
  return item?.name ?? ''
})

function onBracketAdd() {
  bracketFormEditId.value = null
  bracketFormOpen.value = true
}
function onBracketEdit() {
  // Edit the currently-active bracket (the pager's active index).
  bracketFormEditId.value = String(activeBracketIndex.value)
  bracketFormOpen.value = true
}
function onBracketFormSaved() {
  // TODO — refetch the division's brackets after the create/update
  // endpoint ships so the pager + preview reflect the change.
  bracketFormOpen.value = false
}
function onBracketFormDeleted() {
  // TODO — wire DELETE `/v2/.../brackets/{id}` + refetch when shipped.
  bracketFormOpen.value = false
}
// ── Bracket preview drawer ───────────────────────────────────────
// Opens the reusable `MatchGeniBracket` renderer in a full-height
// right-side drawer. Bracket data is mock until the bracket API
// ships; the format is picked deterministically per division so the
// demo surfaces all three layouts (single / double / 3gg) as the
// user switches divisions.
const bracketPreviewOpen = ref(false)
const previewBracket = ref<BracketModel | null>(null)

/** The active (mock) division's brackets — some divisions run 2
 *  (Gold/Silver), some 1, mixed formats incl. 3-game-guarantee.
 *  Empty for a live resources division (unknown id). */
const previewBracketList = computed(() => getMockBracketsForDivision(selectedDivision.value ?? null))

/** How many brackets the active division has (drives the preview's
 *  in-card prev/next navigation). Prefer the explicit mock list;
 *  fall back to the division's `bracketCount`. */
const previewBracketCount = computed(() => {
  const n = previewBracketList.value.length
  return n > 0 ? n : Math.max(selectedDivision.value?.bracketCount ?? 1, 1)
})

/** Segments for the preview's bracket switch — one per bracket
 *  (1-based index + display name). Falls back to the active
 *  bracket's own name when the division has no explicit mock list. */
const previewSwitchItems = computed<{ index: number; name: string }[]>(() => {
  const list = previewBracketList.value
  if (list.length > 0) return list.map((b, i) => ({ index: i + 1, name: b.name }))
  const names = selectedDivision.value?.bracketNames ?? []
  return Array.from({ length: previewBracketCount.value }, (_, i) => ({
    index: i + 1,
    name: names[i] ?? previewBracket.value?.name ?? `Bracket ${i + 1}`
  }))
})

/** Switch to a specific bracket index. */
function selectPreviewBracket(index: number) {
  if (index === activeBracketIndex.value) return
  activeBracketIndex.value = index
  buildPreviewBracket()
}

/** Resolve the bracket model for the active division + bracket index.
 *  Uses the per-division mock list when available; otherwise (live
 *  resources division) falls back to a deterministic format pick so
 *  the demo still renders. */
function buildPreviewBracket() {
  const idx = Math.min(Math.max(activeBracketIndex.value, 1), previewBracketCount.value)
  const list = previewBracketList.value
  if (list.length > 0) {
    previewBracket.value = list[idx - 1] ?? list[0]
    return
  }
  const div = selectedDivision.value
  const types: BracketModel['type'][] = ['single', 'double', '3gg']
  const seed = (selectedDivisionId.value || '')
    .split('')
    .reduce((sum, ch) => sum + ch.charCodeAt(0), 0)
  const base = getMockBracket(types[(seed + idx) % types.length])
  const name = div?.bracketNames?.[idx - 1] ?? base.name
  previewBracket.value = { ...base, name }
}

function onBracketPreview() {
  buildPreviewBracket()
  bracketPreviewOpen.value = true
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    clearSelection()
  }
}
onMounted(() => {
  document.addEventListener('keydown', onDocumentKeydown)

  // Initial publish + observer wiring for the chained sticky
  // stack heights — runs once content paints and on every
  // resize so the thead's `top:` stays glued to the bottom of
  // the date strip.
  publishStickyHeights()
  if (typeof ResizeObserver !== 'undefined') {
    if (parkSelectRef.value) {
      parkResizeObserver = new ResizeObserver(() => publishStickyHeights())
      parkResizeObserver.observe(parkSelectRef.value)
    }
  }
  window.addEventListener('resize', publishStickyHeights)
  window.addEventListener('resize', syncGameRailArrows)
  window.addEventListener('resize', updateBracketStuck)
  // Compact-viewport tracker — drives the desktop-panel vs
  // mobile-rail switch for the game list. Same matchMedia
  // pattern the matchgeni header uses.
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    /* Threshold set to 1024px so the horizontal game-card rail
       is used on every viewport AT OR BELOW that width — covers
       mobile, tablet portrait + landscape, AND the iPad Pro 12.9"
       portrait orientation (which renders at exactly 1024px and
       was previously falling just outside an earlier `1023.98px`
       boundary, dropping it into the side-by-side desktop layout
       even though the column sizing was too tight there). Above
       1024px the side-by-side scheduler layout has the horizontal
       real estate for the vertical date-grouped panel. */
    compactMql = window.matchMedia('(max-width: 1024px)')
    isCompactViewport.value = compactMql.matches
    if (compactMql.addEventListener) {
      compactMql.addEventListener('change', syncCompactViewport)
    } else {
      compactMql.addListener(syncCompactViewport)
    }
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onDocumentKeydown)
  if (parkResizeObserver) parkResizeObserver.disconnect()
  window.removeEventListener('resize', publishStickyHeights)
  window.removeEventListener('resize', syncGameRailArrows)
  window.removeEventListener('resize', updateBracketStuck)
  if (gameGridRef.value && gridScrollBound) {
    gameGridRef.value.removeEventListener('scroll', updateBracketStuck)
    gridScrollBound = false
  }
  if (compactMql) {
    if (compactMql.removeEventListener) {
      compactMql.removeEventListener('change', syncCompactViewport)
    } else {
      compactMql.removeListener(syncCompactViewport)
    }
    compactMql = null
  }
})

// Reset the bulk-actions menu when switching tab/division so a
// stale menu doesn't linger after the underlying context
// changed. (The per-phase cog menu was retired in favour of
// the direct icon buttons on the info banner.)

// The right-column grid (and therefore `parkSelectRef`) only
// mounts inside the `v-else` branch after `payload` resolves —
// so the observer wired in `onMounted` would see a `null` ref
// on the first paint and never fire. Watch `payload` and (re)wire
// on the next tick so the chained-sticky height publishers
// reflect the real rendered heights as soon as the grid appears.
// Without this, `--scheduler-park-height` stays at its fallback
// `64px` (set in `.scheduler__grid-shell`'s
// `--matchgeni-field-grid-top` calc) and the field-grid
// component's sticky `top:` lands inside the park-head row
// instead of below it — which was the "date row goes behind the
// park row" symptom seen earlier. The fallback `64px` matches
// the actual rendered park-head height (13px+13px vertical
// padding + ~38px dropdown), so even if the observer ever
// failed to wire up, the initial sticky math stays correct.
watch(payload, async (next) => {
  if (!next) return
  await nextTick()
  publishStickyHeights()
  if (typeof ResizeObserver !== 'undefined') {
    if (parkSelectRef.value && !parkResizeObserver) {
      parkResizeObserver = new ResizeObserver(() => publishStickyHeights())
      parkResizeObserver.observe(parkSelectRef.value)
    }
  }
  // Wire the rail's scroll listener once the cards mount (the
  // rail lives inside the `v-else` branch, so `gameRailRef.value`
  // is `null` during `onMounted` and the listener would no-op).
  if (gameRailRef.value) {
    gameRailRef.value.addEventListener('scroll', syncGameRailArrows, { passive: true })
    syncGameRailArrows()
  }
  // Wire the game-grid scroll listener for the bracket toolbar's
  // stuck-only band (grid also mounts only in the `v-else` branch).
  if (gameGridRef.value && !gridScrollBound) {
    gameGridRef.value.addEventListener('scroll', updateBracketStuck, { passive: true })
    gridScrollBound = true
  }
  updateBracketStuck()
})

// Re-evaluate arrow visibility whenever the filtered card list
// changes (phase toggle, division change, bracket pager step) —
// content width shifts, so the right arrow may need to appear /
// disappear without any user scroll.
watch(filteredGames, async () => {
  await nextTick()
  syncGameRailArrows()
  updateBracketStuck()
}, { flush: 'post' })

// The bracket toolbar only renders in the bracket phase; re-check
// its stuck state when the phase toggles (it may appear / vanish).
watch(activePhase, async () => {
  await nextTick()
  updateBracketStuck()
})
</script>

<template>
  <main class="matchgeni">
    <MatchGeniHeader
      variant="sub-page"
      title="Game Scheduler"
      :subtitle="bracketPreviewOpen ? '' : (matchGeniContext?.event.eventName ?? '')"
      :event-id="eventId"
    >
      <!-- While the bracket canvas is open the division switcher lives in
           the header (the canvas no longer hosts it). -->
      <template v-if="bracketPreviewOpen" #title-main>
        <BracketDivisionSwitcher
          variant="header"
          :divisions="(payload?.divisions ?? []).map((d) => ({ id: d.id, name: d.name, dateLabel: d.dateRangeLabel }))"
          :selected-id="selectedDivisionId"
          @select="selectedDivisionId = $event"
        />
      </template>
    </MatchGeniHeader>

    <!-- Loading skeleton — paints during the access check + the
         scheduler fetch. Mirrors the real two-column layout so the
         loading state previews the structure of what's coming
         (division dropdown + tabs + cards on the left; park bar +
         date strip + time × field grid on the right) instead of
         dropping a pair of generic shimmer boxes. The container
         reuses `.scheduler` so the grid template + column sizing
         match the real surface 1:1 — the user shouldn't see a
         layout jump when the data lands. -->
    <div v-if="loading" class="scheduler scheduler--loading" aria-busy="true">
      <!-- LEFT COLUMN skeleton — division select bar, tabs row +
           Auto Schedule chip, info banner, then a stack of game-card
           placeholders. -->
      <section class="scheduler__source scheduler__source--skeleton">
        <header class="scheduler__source-head">
          <div class="shimmer-block scheduler__skeleton-select"></div>
          <div class="scheduler__skeleton-tabs-row">
            <div class="scheduler__skeleton-tabs">
              <div class="shimmer-block scheduler__skeleton-tab"></div>
              <div class="shimmer-block scheduler__skeleton-tab"></div>
            </div>
            <div class="shimmer-block scheduler__skeleton-cta"></div>
          </div>
        </header>
        <div class="scheduler__skeleton-grid">
          <div class="shimmer-block scheduler__skeleton-info"></div>
          <!-- 6 game-card placeholders — same logic as the grid
               rows: enough to fill the source column's vertical
               space at typical desktop heights so the skeleton
               doesn't read as a half-page preview. -->
          <div
            v-for="n in 6"
            :key="`game-${n}`"
            class="shimmer-block scheduler__skeleton-game-card"
          ></div>
        </div>
      </section>

      <!-- RIGHT COLUMN skeleton — centered park-pill bar, date
           strip with prev/next arrow placeholders + day cells,
           then the time × field grid. The grid mirrors the real
           layout: a Time column + 6 field columns, 5 slot rows. -->
      <section class="scheduler__grid-shell scheduler__grid-shell--skeleton">
        <header class="scheduler__skeleton-park-head">
          <div class="shimmer-block scheduler__skeleton-park-pill"></div>
        </header>
        <div class="scheduler__skeleton-date-strip">
          <div class="shimmer-block scheduler__skeleton-date-arrow"></div>
          <div class="scheduler__skeleton-date-list">
            <div
              v-for="n in 7"
              :key="`day-${n}`"
              class="shimmer-block scheduler__skeleton-date-cell"
            ></div>
          </div>
          <div class="shimmer-block scheduler__skeleton-date-arrow"></div>
        </div>
        <div class="scheduler__skeleton-grid-table">
          <!-- Header row — Time column header + 6 field headers. -->
          <div class="scheduler__skeleton-grid-row scheduler__skeleton-grid-row--head">
            <div class="shimmer-block scheduler__skeleton-grid-th"></div>
            <div
              v-for="n in 6"
              :key="`th-${n}`"
              class="shimmer-block scheduler__skeleton-grid-th"
            ></div>
          </div>
          <!-- Body rows — slot rows, each with the time cell on
               the left + 6 field cells. Row count bumped from 5
               to 10 so the skeleton fills the viewport vertically;
               the real park has 8 time slots and the rest of the
               column is dead-space until data lands. -->
          <div
            v-for="row in 10"
            :key="`row-${row}`"
            class="scheduler__skeleton-grid-row"
          >
            <div class="shimmer-block scheduler__skeleton-grid-time"></div>
            <div
              v-for="n in 6"
              :key="`cell-${row}-${n}`"
              class="shimmer-block scheduler__skeleton-grid-cell"
            ></div>
          </div>
        </div>
      </section>
    </div>

    <!-- Error banner — same retry affordance the dashboard uses. -->
    <div v-else-if="errorMessage" class="scheduler__error">
      <p>{{ errorMessage }}</p>
      <button type="button" class="scheduler__retry" @click="load">Retry</button>
    </div>

    <div
      v-else
      class="scheduler"
      :class="{
        'scheduler--source-collapsed': sourceCollapsed,
        'scheduler--bracket-open': bracketPreviewOpen
      }"
    >
      <!-- Collapse / expand toggle — circular chip pinned to the
           RIGHT edge of the source column, half overlapping the
           left rail and half overlapping the grid column behind
           it (centered on the column border). Rendered as a
           DIRECT CHILD of `.scheduler` (not inside `__source`)
           so `position: absolute` isn't clipped by the source
           column's `overflow: hidden`. Vertically aligned with
           the division dropdown's center.
           The two-tone arrow icon flips direction based on state —
           points LEFT when expanded ("click to collapse the
           rail"), RIGHT when collapsed ("click to expand it
           back"). -->
      <!-- `v-if="!isCompactViewport"` — the toggle only renders on
           DESKTOP (≥1024px). At <1024px the layout collapses to a
           single column with a horizontal game-card rail, so
           there's no source/grid column boundary for the chip to
           straddle and "collapse the source column" has no
           meaningful action. Removing the button from the DOM
           below the breakpoint is bulletproof regardless of any
           CSS specificity quirks. -->
      <button
        v-if="!isCompactViewport && !bracketPreviewOpen"
        type="button"
        class="scheduler__source-toggle app-tooltip app-tooltip--top"
        :aria-label="sourceCollapsed ? 'Expand' : 'Collapse'"
        :aria-expanded="!sourceCollapsed"
        :data-tooltip="sourceCollapsed ? 'Expand' : 'Collapse'"
        @click="toggleSourceCollapsed"
      >
        <span
          class="scheduler__source-toggle-icon"
          :class="sourceCollapsed
            ? 'scheduler__source-toggle-icon--expand'
            : 'scheduler__source-toggle-icon--collapse'"
          aria-hidden="true"
        ></span>
      </button>
      <!-- LEFT COLUMN — division picker, phase tabs, game list -->
      <section
        v-show="!bracketPreviewOpen"
        class="scheduler__source"
        :class="{ 'scheduler__source--disabled': !!divisionsDisabledReason }"
      >
        <header class="scheduler__source-head" :inert="!!divisionsDisabledReason">
          <!-- Division picker — uses the shared `.floating-input` /
               `.floating-input__control--select` pattern so it
               reads the same as the park picker above (and every
               other form select across the portal). The label is
               permanently floated since the select always carries
               a value (the active division). -->
          <div class="floating-input scheduler__division-picker">
            <select
              id="scheduler-division-picker"
              v-model="selectedDivisionId"
              class="floating-input__control floating-input__control--select"
            >
              <option v-for="d in payload?.divisions ?? []" :key="d.id" :value="d.id">
                {{ d.name }}
              </option>
            </select>
            <label
              for="scheduler-division-picker"
              class="floating-input__label floating-input__label--floated"
            >Division</label>
          </div>
          <!-- Tabs row — Pool / Brackets tabs share the row 50/50.
               The "Auto Schedule" CTA moved BACK into each phase's
               settings cog menu (see `.scheduler__phase-menu`
               below) so the tab row stays compact and the
               destructive / configuration affordances all live
               in one place behind the cog. -->
          <div class="scheduler__tabs-row" role="tablist">
            <button
              type="button"
              role="tab"
              class="scheduler__tab"
              :class="{ 'scheduler__tab--active': activePhase === 'pool' }"
              :aria-selected="activePhase === 'pool'"
              @click="activePhase = 'pool'"
            >Pool Play</button>
            <button
              type="button"
              role="tab"
              class="scheduler__tab"
              :class="{ 'scheduler__tab--active': activePhase === 'bracket' }"
              :aria-selected="activePhase === 'bracket'"
              @click="activePhase = 'bracket'"
            >Brackets</button>
          </div>
        </header>

        <div ref="gameGridRef" class="scheduler__game-grid" :inert="!!divisionsDisabledReason">
          <!-- Info banner — first item in the list. Scrolls with the
               cards. Copy switches by phase:
                 Pool:    "N games round robin"
                          "T teams played G games each"
                 Bracket: "T Teams"
                          "M Game Guarantee"
               Right-aligned settings cog opens the per-phase
               settings panel (re-generate, configure, etc.). -->
          <div
            v-if="selectedDivision"
            class="app-banner app-banner--primary scheduler__game-info"
            :class="{ 'scheduler__game-info--pool': activePhase === 'pool' }"
          >
            <div class="app-banner__text">
              <template v-if="activePhase === 'pool'">
                <!-- Mirrors the finalized division-detail pool banner, but with
                     the status as a colour dot + tooltip before the title (no
                     room for a full pill), team/game count below, and the tie-
                     breaker on its own full-width row beneath (see grid CSS). -->
                <strong class="app-banner__title">
                  <span
                    class="scheduler__game-info-dot app-tooltip app-tooltip--top scheduler__game-info-dot--tip-left"
                    :data-tone="poolStatusBadge.tone"
                    :data-tooltip="poolStatusBadge.label"
                    tabindex="0"
                    role="img"
                    :aria-label="`Pool status: ${poolStatusBadge.label}`"
                  ></span>
                  {{ selectedDivision.poolRoundRobinCount }} game round robin
                </strong>
                <span class="scheduler__game-info-count">
                  {{ selectedDivision.teamCount }} {{ selectedDivision.teamCount === 1 ? 'team' : 'teams' }} · {{ poolGameCount }} {{ poolGameCount === 1 ? 'game' : 'games' }}
                </span>
              </template>
              <template v-else>
                <strong class="app-banner__title">
                  <span
                    class="scheduler__game-info-dot app-tooltip app-tooltip--top scheduler__game-info-dot--tip-left"
                    :data-tone="activeBracketStatusBadge.tone"
                    :data-tooltip="activeBracketStatusBadge.label"
                    tabindex="0"
                    role="img"
                    :aria-label="`Bracket status: ${activeBracketStatusBadge.label}`"
                  ></span>
                  {{ activeBracketName }}
                </strong>
                <span class="app-banner__sub">
                  {{ selectedDivision.teamCount }} Teams &mdash; {{ selectedDivision.bracketGameGuarantee }} Game Guarantee
                </span>
              </template>
            </div>
            <div
              class="app-banner__actions scheduler__game-info-menu-root"
            >
              <!-- Preview Bracket — only visible on the Bracket
                   tab. Sits right next to the settings cog so
                   the user finds it where they expect for the
                   active phase. Replaces the standalone button
                   that used to live next to the bracket pager
                   below. -->
              <button
                v-if="activePhase === 'bracket'"
                type="button"
                class="scheduler__game-info-preview app-tooltip app-tooltip--top scheduler__game-info-action--tip-right"
                aria-label="Preview bracket"
                data-tooltip="Preview Bracket"
                @click="onBracketPreview"
              >
                <span class="scheduler__game-info-preview-icon" aria-hidden="true"></span>
              </button>
              <!-- Pool tab — two icon buttons: New Pool Game (add)
                   + Regenerate Pool (refresh). Both are direct
                   one-click affordances rather than items hidden
                   behind a popover. -->
              <button
                v-if="activePhase === 'pool'"
                type="button"
                class="scheduler__game-info-action app-tooltip app-tooltip--top scheduler__game-info-action--tip-right"
                aria-label="New pool game"
                data-tooltip="New Pool Game"
                @click="onNewPoolGame"
              >
                <span class="scheduler__game-info-action-icon scheduler__game-info-action-icon--add" aria-hidden="true"></span>
              </button>
              <button
                v-if="activePhase === 'pool'"
                type="button"
                class="scheduler__game-info-action app-tooltip app-tooltip--top scheduler__game-info-action--tip-right"
                aria-label="Regenerate pool"
                data-tooltip="Regenerate Pool"
                @click="onPoolRegenerate"
              >
                <span class="scheduler__game-info-action-icon scheduler__game-info-action-icon--refresh" aria-hidden="true"></span>
              </button>
              <!-- Bracket tab — single icon button: Edit Bracket.
                   `Delete Bracket` moved into the Edit modal as a
                   secondary destructive action, so the banner here
                   shows just Edit + (above) Preview. -->
              <button
                v-else
                type="button"
                class="scheduler__game-info-action app-tooltip app-tooltip--top scheduler__game-info-action--tip-right"
                aria-label="Edit bracket"
                data-tooltip="Edit Bracket"
                @click="onBracketEdit"
              >
                <span class="scheduler__game-info-action-icon scheduler__game-info-action-icon--edit" aria-hidden="true"></span>
              </button>
            </div>
            <!-- Pool tie-breaker — full-width row beneath the title/count +
                 buttons (grid row 2). -->
            <span
              v-if="activePhase === 'pool'"
              class="app-banner__sub scheduler__game-info-tiebreak"
            >Tie breaker - {{ selectedDivision.tieBreakerText }}</span>
          </div>

          <!-- Bracket pager — sticky at the top of the scroll region
               when the user is on the Bracket tab. Lets the admin
               step between multiple brackets in the division
               (currently mocked at 1; future divisions split Gold /
               Silver / Bronze brackets and this widget pages them). -->
          <!-- Bracket pager row — pill-shaped pager pinned to the
               sticky scroll top, with two trailing icon buttons
               on the right: Add Bracket + Preview Bracket. Both
               icon buttons are gated by `manage_divisions`
               (creating / previewing a bracket is a divisions-
               write action, same as adding the bracket from the
               settings cog menu). -->
          <div
            v-if="activePhase === 'bracket' && selectedDivision && selectedDivision.bracketCount > 0"
            class="scheduler__bracket-toolbar"
          >
            <div class="scheduler__bracket-pager">
              <button
                type="button"
                class="scheduler__bracket-pager-arrow"
                aria-label="Previous bracket"
                :disabled="activeBracketIndex <= 1"
                @click="stepBracket(-1)"
              >
                <span class="scheduler__bracket-pager-arrow-icon scheduler__bracket-pager-arrow-icon--prev" aria-hidden="true"></span>
              </button>
              <span class="scheduler__bracket-pager-label">
                Bracket {{ activeBracketIndex }} of {{ selectedDivision.bracketCount }}
              </span>
              <button
                type="button"
                class="scheduler__bracket-pager-arrow"
                aria-label="Next bracket"
                :disabled="activeBracketIndex >= selectedDivision.bracketCount"
                @click="stepBracket(1)"
              >
                <span class="scheduler__bracket-pager-arrow-icon" aria-hidden="true"></span>
              </button>
            </div>
            <!-- Trailing action buttons. Both reuse the
                 `.scheduler__bracket-action-btn` style so they
                 read as a matched pair against the pager pill.
                 Each button renders icon + label; the label is
                 hidden on the DESKTOP layout (icon-only round
                 chip with tooltip via `.app-tooltip`) and
                 revealed below 1024px where the toolbar has the
                 horizontal real estate to show the verb beside
                 the glyph. The tooltip is still set so the
                 affordance reads on the desktop icon-only chip;
                 it just doesn't pop when the label is already
                 visible. -->
            <button
              type="button"
              class="scheduler__bracket-action-btn app-tooltip app-tooltip--left"
              aria-label="Add bracket"
              data-tooltip="Add Bracket"
              @click="onBracketAdd"
            >
              <span class="scheduler__bracket-action-icon scheduler__bracket-action-icon--add" aria-hidden="true"></span>
              <span class="scheduler__bracket-action-label">Add Bracket</span>
            </button>
            <!-- Preview Bracket moved up to the info banner
                 (next to the settings cog). The toolbar here
                 keeps only the Add Bracket affordance + the
                 bracket pager. -->
          </div>

          <!-- Game cards — two render paths driven by viewport:
                 - Desktop / tablet (>720px): `MatchGeniGameListPanel`
                   with date grouping + sticky headers. Cards
                   provided via the `#game-row` slot using the
                   extracted `<SchedulerGameCard>` component.
                 - Mobile (≤720px): existing horizontal-rail
                   markup (scroll-snap, overlay prev/next arrows)
                   — date grouping doesn't make sense in a
                   horizontal rail, so the mobile path stays flat. -->
          <div class="scheduler__list-region">
          <MatchGeniGameListPanel
            v-if="!isCompactViewport"
            :games="listGames"
            group-by="date"
            unscheduled-placement="top"
            empty-message="No games for this phase yet."
            class="scheduler__game-panel"
            :internal-scroll="false"
          >
            <template #game-row="{ game }">
              <SchedulerGameCard
                :game="game"
                :date-label="game.scheduledDate ? formatGameDate(game.scheduledDate) : ''"
                :park-label="game.parkId ? (parkNameById.get(game.parkId) ?? '') : ''"
                @dragstart="onDragStart"
                @open="onGameCardOpen"
              />
            </template>
          </MatchGeniGameListPanel>

          <!-- Mobile horizontal rail — preserved from the original
               scheduler layout so phone users keep their familiar
               swipe-through card UX. Same `<SchedulerGameCard>`
               component as the desktop panel; the difference is
               the wrapping container + scroll axis. -->
          <div v-else class="scheduler__game-rail-wrap">
            <button
              v-show="gameRailPrevVisible"
              type="button"
              class="scheduler__game-rail-arrow scheduler__game-rail-arrow--prev"
              aria-label="Previous games"
              @click="onGameRailScroll(-1)"
            >
              <span class="scheduler__game-rail-arrow-icon scheduler__game-rail-arrow-icon--prev" aria-hidden="true"></span>
            </button>
            <div ref="gameRailRef" class="scheduler__game-rail">
              <SchedulerGameCard
                v-for="game in listGames"
                :key="game.id"
                :game="game"
                :date-label="game.scheduledDate ? formatGameDate(game.scheduledDate) : ''"
                :park-label="game.parkId ? (parkNameById.get(game.parkId) ?? '') : ''"
                @dragstart="onDragStart"
                @open="onGameCardOpen"
              />
            </div>
            <button
              v-show="gameRailNextVisible"
              type="button"
              class="scheduler__game-rail-arrow scheduler__game-rail-arrow--next"
              aria-label="Next games"
              @click="onGameRailScroll(1)"
            >
              <span class="scheduler__game-rail-arrow-icon" aria-hidden="true"></span>
            </button>
          </div>
          </div>
        </div>
        <!-- Footer ("N games round robin") removed — the count
             surfaces in the dashboard already; here it just chewed
             vertical space the game-grid could use to fit more
             cards above the scroll boundary. -->

        <!-- Full-pane "not configured" overlay — sibling of the
             blurred content (header + game-grid), so the message +
             CTA stay sharp and clickable. Centered, no scroll. -->
        <div
          v-if="divisionsDisabledReason"
          class="scheduler__region-overlay scheduler__region-overlay--centered"
          role="status"
        >
          <div class="scheduler__region-overlay-card">
            <span class="scheduler__region-overlay-icon" aria-hidden="true"></span>
            <h3 class="scheduler__region-overlay-title">{{ divisionsDisabledReason.title }}</h3>
            <p class="scheduler__region-overlay-body">{{ divisionsDisabledReason.body }}</p>
            <div
              v-if="divisionsDisabledReason.ctas && divisionsDisabledReason.ctas.length"
              class="scheduler__region-overlay-actions"
            >
              <button
                v-for="c in divisionsDisabledReason.ctas"
                v-show="canMatchGeniWrite(c.permission)"
                :key="c.kind"
                type="button"
                class="scheduler__region-overlay-cta"
                @click="onConfigureResource(c)"
              >{{ c.label }}</button>
            </div>
          </div>
        </div>
      </section>

      <!-- RIGHT COLUMN — park picker, date strip, time × field grid.
           Kept mounted (`v-show`) while the bracket stage is open so
           closing the bracket restores the grid instantly with its
           scroll/state intact (no reload / remount). -->
      <section v-show="!bracketPreviewOpen" class="scheduler__grid-shell">
        <!-- Park picker — uses the shared `.floating-input` /
             `.floating-input__control--select` pattern + the
             `park-twotone.svg` glyph leader on the left, matching
             the field-grid page's toolbar exactly so both surfaces
             read as the same affordance. The "Park" identifier
             text lives inside the dropdown's floated label tag. -->
        <header
          ref="parkSelectRef"
          class="scheduler__park-head"
          :class="{
            'scheduler__park-head--blurred': gridDisabledReason?.scope === 'all'
          }"
          :inert="gridDisabledReason?.scope === 'all'"
        >
          <!-- Default toolbar — park picker. Swapped for the selection bar
               (same sticky element + ref, so the date strip's chained-sticky
               offset stays stable) while a bulk selection is in progress. -->
          <template v-if="!selectionActive">
            <!-- Park-twotone glyph — same 28px masked icon the
                 field-grid page uses before its dropdown. Themes
                 navy in light / lighter primary blue in dark. -->
            <span
              class="scheduler__park-icon"
              aria-hidden="true"
            ></span>
            <MatchGeniParkPicker
              id="scheduler-park-picker"
              v-model="selectedParkId"
              :parks="payload?.parks ?? []"
              class="scheduler__park-picker"
            />
          </template>

          <!-- Selection bar — bulk event-day actions on the selected games. -->
          <template v-else>
            <span class="scheduler__selection-count">
              <strong>{{ selectedGameIds.size }}</strong>
              <span>selected</span>
            </span>
            <div class="scheduler__selection-actions">
              <button
                type="button"
                class="scheduler__selection-action"
                :disabled="!moveTargetParks.length"
                @click="openMoveForSelection"
              >Move</button>
              <button
                type="button"
                class="scheduler__selection-action"
                @click="openModifyDurationForSelection"
              >Modify duration</button>
              <button
                type="button"
                class="scheduler__selection-action"
                @click="openUnscheduleForSelection"
              >Unschedule</button>
              <button
                type="button"
                class="scheduler__selection-action"
                @click="openMarkDelayedForSelection"
              >Mark delayed</button>
              <button
                type="button"
                class="scheduler__selection-clear"
                @click="clearSelection"
              >Clear Selection</button>
            </div>
          </template>
        </header>

        <!-- Date strip + time × field grid extracted to the shared
             `MatchGeniFieldGrid` component (`src/components/
             MatchGeniFieldGrid.vue`) so the same surface can drive
             the public event page's audience-facing schedule in
             view-only mode. Scheduler passes the full game list +
             the active day + the chosen park; the component
             computes `scheduledByCell` internally and emits
             `update:activeDate` on day clicks / prev-next arrows.
             `--matchgeni-field-grid-top` sets the cumulative
             chain-sticky offset so the date strip glues right
             under the park-picker bar above. -->
        <div
          class="scheduler__grid-region"
          :class="{ 'scheduler__grid-region--disabled': !!gridDisabledReason }"
        >
        <MatchGeniFieldGrid
          :park="gridPark"
          :games="gridGames"
          v-model:active-date="gridActiveDate"
          cell-interaction="drop"
          :park-breaks="gridBreaks"
          :event-default-game-duration-minutes="payload?.eventDefaultGameDurationMinutes"
          :dragging-game-id="draggedGameId"
          :add-slot-disabled="selectionActive"
          :inert="!!gridDisabledReason"
          class="scheduler__field-grid"
          @cell-click="onCellClick"
          @cell-drop="onCellDrop"
          @cell-empty-click="onCellEmptyClick"
          @game-dragstart="onDragStart"
          @break-add-request="onBreakAddRequest"
          @break-edit-request="onBreakEditRequest"
          @break-delete="onBreakDelete"
        >
          <!-- Shared `MatchGeniGameCard` — same component the
               field-grid scoring surface uses. No `permitted`
               prop here (defaults to `true`) since the scheduler
               doesn't carry permission gating; every scheduled
               game on this admin surface is editable. -->
          <template #cell="{ game, size, durationMinutes }">
            <MatchGeniGameCard
              :game="game"
              :division-name="divisionNameById.get(game.divisionId) ?? ''"
              :size="(size as 'full' | 'compact' | 'mini')"
              :duration-minutes="durationMinutes"
              toned-by-division
              :selectable="isGameSelectable(game)"
              :selected="selectedGameIds.has(game.id)"
              :selection-active="selectionActive"
              @toggle-select="toggleSelectGame(game)"
            />
          </template>
        </MatchGeniFieldGrid>
          <!-- "Why scheduling isn't enabled" overlay — blurs the
               grid backdrop (mock sample) and explains what the
               admin needs to configure (park / fields / window). -->
          <div
            v-if="gridDisabledReason"
            class="scheduler__region-overlay scheduler__region-overlay--centered"
            role="status"
          >
            <div class="scheduler__region-overlay-card">
              <span class="scheduler__region-overlay-icon" aria-hidden="true"></span>
              <h3 class="scheduler__region-overlay-title">{{ gridDisabledReason.title }}</h3>
              <p class="scheduler__region-overlay-body">{{ gridDisabledReason.body }}</p>
              <div
                v-if="gridDisabledReason.ctas && gridDisabledReason.ctas.length"
                class="scheduler__region-overlay-actions"
              >
                <button
                  v-for="c in gridDisabledReason.ctas"
                  v-show="canMatchGeniWrite(c.permission)"
                  :key="c.kind"
                  type="button"
                  class="scheduler__region-overlay-cta"
                  @click="onConfigureResource(c)"
                >{{ c.label }}</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Bracket preview — covers the full scheduler content (both
           panes) with the reusable zoom/pan `MatchGeniBracket`. The
           panes above stay mounted (v-show) so closing restores the
           grid instantly. Close (X) returns to the two-pane view. -->
      <div v-if="bracketPreviewOpen" class="scheduler__bracket-stage">
        <MatchGeniBracket
          :bracket="previewBracket"
          closable
          close-label="Close brackets"
          hide-name-fallback
          @close="bracketPreviewOpen = false"
        >
          <template v-if="previewBracketCount >= 1" #switch>
            <div class="scheduler__bracket-switch" role="tablist">
              <button
                v-for="item in previewSwitchItems"
                :key="item.index"
                type="button"
                role="tab"
                class="scheduler__tab scheduler__bracket-switch-tab"
                :class="{ 'scheduler__tab--active': item.index === activeBracketIndex }"
                :aria-selected="item.index === activeBracketIndex"
                @click="selectPreviewBracket(item.index)"
              >{{ item.name }}</button>
            </div>
          </template>
        </MatchGeniBracket>
      </div>
    </div>

    <!-- Break form modal — opens on a `break-add-request` (the
         "+ Break" pill on a time-column hour row) OR on a
         `break-edit-request` (clicking Edit on an existing break
         block). The form runs no conflict math itself; this view
         calls `findConflicts` on save and surfaces a toast if the
         placement collides with games or breaks on the affected
         fields. -->
    <SchedulerBreakForm
      :open="breakForm !== null"
      :date="
        breakForm?.kind === 'edit'
          ? breakForm.brk.date
          : breakForm?.kind === 'create'
            ? breakForm.date
            : visibleDateAnchor
      "
      :fields="selectedPark?.fields ?? []"
      :day-start-time="selectedPark?.dayStartTime ?? '00:00'"
      :day-end-time="selectedPark?.dayEndTime ?? '24:00'"
      :editing="breakForm?.kind === 'edit' ? breakForm.brk : null"
      :initial-start-time="breakForm?.kind === 'create' ? breakForm.startTime : '12:00'"
      :initial-scope="breakForm?.kind === 'create' ? (breakForm.scope ?? 'park') : 'park'"
      :initial-field-name="breakForm?.kind === 'create' ? (breakForm.fieldName ?? '') : ''"
      :initial-duration-minutes="breakForm?.kind === 'create' ? (breakForm.durationMinutes ?? 0) : 0"
      @close="onBreakFormClose"
      @create="onBreakFormCreate"
      @update="onBreakFormUpdate"
      @delete="onBreakDeleteFromForm"
    />

    <!-- Empty-slot "add" popup — centered selection dialog showing the slot
         context (start / end / duration / field / park) + the two add
         options. Picking one opens the relevant form pre-filled. -->
    <SchedulerAddSlotModal
      :model-value="!!emptySlotMenu"
      :date-label="addSlotDateLabel"
      :slot-label="addSlotRangeLabel"
      :duration-minutes="emptySlotMenu?.availableMinutes ?? 0"
      :field-name="emptySlotMenu?.fieldName ?? ''"
      :park-name="selectedPark?.name ?? ''"
      @update:model-value="(v) => { if (!v) closeEmptySlotMenu() }"
      @add-break="addBreakFromSlot"
      @add-game="addGameFromSlot"
    />

    <!-- Add / edit pool-game modal — create drops a new matchup on the
         clicked slot; edit (from the drawer) updates an existing pool game.
         Division is fixed (eyebrow) — never a picker. -->
    <SchedulerCreateGameModal
      v-model="gameModalOpen"
      :mode="gameModal?.mode ?? 'create'"
      :division-name="gameModal?.divisionName ?? ''"
      :date-label="gameModal?.dateLabel ?? ''"
      :time-label="gameModal?.timeLabel ?? ''"
      :field-name="gameModal?.fieldName ?? ''"
      :park-name="gameModal?.parkName ?? ''"
      :team-options="gameModal?.teamOptions ?? []"
      :default-duration="gameModal?.defaultDuration ?? 90"
      :max-duration="gameModal?.maxDuration ?? 0"
      :default-time-limit="gameModal?.defaultTimeLimit ?? 65"
      :initial-name="gameModal?.initialName ?? ''"
      :initial-team1="gameModal?.initialTeam1 ?? ''"
      :initial-team2="gameModal?.initialTeam2 ?? ''"
      :initial-duration="gameModal?.initialDuration ?? 0"
      :initial-time-limit="gameModal?.initialTimeLimit ?? 0"
      @submit="onGameModalSubmit"
    />

    <!-- Bulk duration modal — opens from the "Reduce remaining…"
         button in the park-head toolbar. Affects only unfinished
         games on the active date; reports skipped (locked) count
         on success. -->
    <SchedulerBulkDurationModal
      :open="bulkModalOpen"
      :date="visibleDateAnchor"
      :games="payload?.games ?? []"
      :default-duration="selectedPark?.defaultGameDurationMinutes ?? 90"
      :selection-ids="bulkSelectionMode ? selectionIdsArray : null"
      :division-name-by-id="divisionNameById"
      :park-name="selectedPark?.name ?? ''"
      @close="closeBulkModal"
      @apply="onBulkApply"
    />

    <!-- Bulk Move (cross-park, intelligent repack) — selection-bar "Move". -->
    <template v-if="selectedPark">
      <SchedulerMoveModal
        v-model="moveModalOpen"
        :selected-games="selectedGames"
        :source-park="selectedPark"
        :target-parks="moveTargetParks"
        :all-games="payload?.games ?? []"
        :source-date="gridActiveDate"
        :event-default-minutes="payload?.eventDefaultGameDurationMinutes"
        :division-name-by-id="divisionNameById"
        @confirm="onMoveConfirm"
      />
    </template>

    <!-- Bulk Mark delayed — selection-bar "Mark delayed". -->
    <SchedulerMarkDelayedModal
      v-model="markDelayedOpen"
      :count="selectedGameIds.size"
      :park-name="selectedPark?.name ?? ''"
      :date-label="selectionDateLabel"
      @confirm="onMarkDelayedConfirm"
    />

    <!-- Bulk Unschedule confirm — reuses the centered-confirm chrome. -->
    <Transition name="slide-modal-backdrop">
      <div
        v-if="unscheduleConfirmOpen"
        class="association-switcher-backdrop"
        role="presentation"
        @click.self="unscheduleConfirmOpen = false"
      >
        <div class="association-switcher-panel association-confirm-panel" role="alertdialog" aria-modal="true">
          <header class="association-switcher-panel__header">
            <span class="scheduler-unsched__heading">
              <span v-if="selectedPark?.name" class="eyebrow scheduler-unsched__head-eyebrow">{{ selectedPark.name }}</span>
              <span class="scheduler-unsched__titlerow">
                <h2 class="association-switcher-panel__title">
                  Un-schedule {{ selectedGameIds.size }} game{{ selectedGameIds.size === 1 ? '' : 's' }}?
                </h2>
                <span v-if="selectionDateLabel" class="scheduler-unsched__title-date">{{ selectionDateLabel }}</span>
              </span>
            </span>
            <button type="button" class="association-switcher-panel__close" aria-label="Close" @click="unscheduleConfirmOpen = false">
              <AppIcon name="close" :size="16" />
            </button>
          </header>
          <div class="association-confirm-panel__body">
            <p class="association-confirm-panel__copy">
              The selected games return to the unscheduled pool (their date,
              time, and field are cleared). You can re-add them later.
            </p>
          </div>
          <footer class="association-confirm-panel__footer">
            <button class="secondary-button" type="button" @click="unscheduleConfirmOpen = false">Cancel</button>
            <span style="flex:1 1 auto"></span>
            <button class="danger-light-button" type="button" @click="confirmUnscheduleSelection">Un-schedule {{ selectedGameIds.size }} game{{ selectedGameIds.size === 1 ? '' : 's' }}</button>
          </footer>
        </div>
      </div>
    </Transition>

    <!-- Game-details drawer — opens on click of any game card in the
         grid. The SAME component used by the division page + field-grid
         scoring page; it renders its own controls purely from the
         caller's MatchGeni permissions for the game (scoring lifecycle
         via scope-aware `manage_scoring`, "Edit game" via
         `manage_scheduling`/`manage_divisions`, umpire assignment via
         `manage_umpires`) — the surface no longer dictates what shows.
         `@edit` opens the shared add/edit pool-game form. -->
    <ScoringGameDetailsDrawer
      v-model="drawerOpen"
      :game="drawerGame"
      :division-name="drawerGame ? (divisionNameById.get(drawerGame.divisionId) ?? '') : ''"
      @edit="drawerGame && openEditGame(drawerGame)"
    />

    <!-- Drag-cascade confirmation — shown before a drop that pushes the
         later games on a field back. Lists each impacted game's old → new
         time; only on confirm is the move + shift applied (onConfirmShift). -->
    <SchedulerShiftConfirmModal
      v-model="shiftConfirmOpen"
      :moved-label="pendingShift?.target.label ?? ''"
      :moved-new-time="pendingShift?.movedNewTime ?? ''"
      :delta-minutes="pendingShift?.delta ?? 0"
      :field-park="pendingShift?.fieldPark ?? ''"
      :rows="pendingShift?.rows ?? []"
      @confirm="onConfirmShift"
      @update:model-value="(v) => { if (!v) onCancelShift() }"
    />

    <!-- Break-conflict resolver — shown when a new break overlaps games it
         can fit beside. Offers "move later games" and/or "shorten the
         break"; the break form stays open underneath so Cancel returns to
         it without losing the entry. -->
    <SchedulerBreakConflictModal
      v-model="breakConflictOpen"
      :break-label="pendingBreakConflict?.payload.label ?? 'Break'"
      :break-duration-minutes="pendingBreakConflict?.payload.durationMinutes ?? 0"
      :conflict-game-label="pendingBreakConflict?.conflictLabel ?? ''"
      :field-park="pendingBreakConflict?.fieldPark ?? ''"
      :can-move="pendingBreakConflict?.canMove ?? false"
      :move-rows="pendingBreakConflict?.moveRows ?? []"
      :can-shorten="pendingBreakConflict?.canShorten ?? false"
      :shorten-to-minutes="pendingBreakConflict?.shortenTo ?? 0"
      @move="onBreakConflictMove"
      @shorten="onBreakConflictShorten"
    />

    <!-- Add / Edit Bracket form drawer — opened from the Brackets
         tab's "Add Bracket" toolbar button and the info-banner
         "Edit Bracket" action. Bracket format options come from the
         live /getBracketFormats catalogue; custom team selection
         reveals the shared TagsMultiSelect picker. -->
    <MatchGeniBracketFormModal
      v-model="bracketFormOpen"
      :division-name="selectedDivision?.name ?? ''"
      :bracket-id="bracketFormEditId"
      :bracket-name="bracketFormPrefillName"
      :team-options="bracketTeamOptions"
      @saved="onBracketFormSaved"
      @delete="onBracketFormDeleted"
    />

    <!-- Notifications go through the shared app-level toast (pushToast),
         rendered by the App shell — no local toast surface here. -->
  </main>
</template>

<style scoped>
/* Unschedule confirm header — park eyebrow, then title + date on one row
   (mirrors the Move / Modify / Mark-delayed popup headers). */
.scheduler-unsched__heading { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.scheduler-unsched__head-eyebrow {
  margin: 0;
  font-size: 0.64rem;
  letter-spacing: 0.1em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.scheduler-unsched__titlerow {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 10px;
  min-width: 0;
}
.scheduler-unsched__title-date { font-size: 0.88rem; color: var(--secondary); white-space: nowrap; }

.scheduler {
  display: grid;
  /* Two-column layout: a sticky source column hugging the
     viewport edge + the main scroll surface on the right.
     `--scheduler-source-width` is a CSS variable so the
     collapse toggle can flip the column to 48px with one rule
     on the parent (see `.scheduler--source-collapsed` below). */
  --scheduler-source-width: 340px;
  grid-template-columns: var(--scheduler-source-width) minmax(0, 1fr);
  padding: 0;
  gap: 0;
  align-items: start;
  /* `position: relative` so the absolute-positioned collapse
     toggle anchors to this grid's content box, not to the page. */
  position: relative;
  /* `overflow-x: clip` clamps any horizontal overflow originating
     from grid children (the bumped-up game-card fonts, the
     park-head toolbar's button cluster, anything inside the
     calendar that didn't fully respect `minmax(0, 1fr)`) to
     this container — preventing page-level horizontal scroll.
     `clip` (NOT `hidden`) per CSS Overflow spec does NOT
     create a scrolling box, so sticky descendants (the source
     column at `top: 56px`, the park-head / date strip /
     calendar header) keep resolving against the page viewport
     rather than getting re-anchored to this container. */
  overflow-x: clip;
}

/* Collapsed state — source column shrinks to a 48px-wide rail
   (NOT a full collapse). The narrow bar stays visible as a
   visual anchor for the left section even when its contents are
   hidden, so the user always sees WHERE the panel lives + still
   has the column boundary to click the expand toggle on.
   `.scheduler__source` keeps its background + right border at
   48px width; the inner sections (`__source-head`, game list)
   are hidden via `visibility: hidden` so they don't peek through
   the narrow rail. The grid-template-columns recomputes via the
   CSS variable so the right column reclaims most of the freed
   space (full source width − 48px). */
.scheduler--source-collapsed {
  --scheduler-source-width: 48px;
}
/* Bracket-open mode — the two panes are hidden (v-show) and the
   bracket stage covers the full content area. Switch off the grid
   layout so the single stage child fills the width. */
.scheduler--bracket-open {
  display: block;
}
/* Full-content bracket stage — hosts the zoom/pan `MatchGeniBracket`,
   sized to the viewport below the matchgeni header. */
.scheduler__bracket-stage {
  display: flex;
  flex-direction: column;
  height: calc(100vh - var(--matchgeni-header-height, 56px));
  min-height: 460px;
}
.scheduler--source-collapsed .scheduler__source > * {
  visibility: hidden;
}
/* Collapsed-rail surface — no gradient or fill. The collapsed bar
   reads as a plain transparent strip (just the toggle chip floats on
   it); only the base `.scheduler__source` right border remains. */
.scheduler--source-collapsed .scheduler__source {
  background: none;
  /* Border inherits the base `.scheduler__source { border-right:
     1px solid var(--border-divider) }` — no override here so the
     collapsed rail's right edge uses the SAME divider tone the
     expanded column does, in both light and dark themes. */
}
/* ─── LEFT COLUMN ────────────────────────────────────────────── */

.scheduler__source {
  display: flex;
  flex-direction: column;
  /* Light mode: no fill — the source column reads on the page
     background (only the right border separates it). Dark mode keeps
     the `--white` slate surface (override below). */
  background: transparent;
  /* Flush sidebar — no border radius, no top/left/bottom gaps.
     Only the right border separates it from the main content
     column. Internal sections (header, game grid) carry their
     own horizontal padding. */
  border: 0;
  border-right: 1px solid var(--border-divider);
  border-radius: 0;
  padding: 0;
  min-width: 0;
  /* Sticky-pin to the bottom of the matchgeni header. The
     source itself is a flex column with `overflow: hidden`;
     the inner game-grid carries its own `overflow-y: auto` so
     the scrollbar appears on the games list itself. */
  position: sticky;
  top: var(--matchgeni-header-height, 56px);
  height: calc(100vh - var(--matchgeni-header-height, 56px));
  overflow: hidden;
  /* Width-collapse transition for the source-collapse toggle.
     The `--scheduler-source-width` variable flips between 340px
     and 48px when the user toggles; this transitions the grid
     track's resolved width smoothly. */
  transition: width 220ms ease;
}
/* Dark mode keeps the slate surface fill (light mode is transparent). */
html.dark-mode .scheduler__source {
  background: var(--white);
}

/* Source header — stacked column now (division dropdown on
   the first line, Pool Play / Brackets tabs on the second)
   instead of the previous single-row flex. The dropdown gets
   the full width of the source column; the tabs sit below
   with a centered divider underneath. `flex: 0 0 auto` pins
   the header to the top of the source column (no sticky needed
   because `.scheduler__source` uses `overflow: hidden` + flex
   to give the game-grid its own scroll container below). */
/* Collapse / expand toggle — circular chip pinned to the column
   boundary between the source rail and the grid shell.
   Pinned `top: 14px` from the source-head's top so it sits in
   the row's vertical breathing space ABOVE the division
   dropdown (not centered against it) — keeps the dropdown's
   own click target clean while the toggle reads as its own
   distinct affordance.
   Horizontally anchored to the SOURCE COLUMN'S RIGHT EDGE via
   `left: var(--scheduler-source-width)`, then `translateX(-50%)`
   centers the chip ON the border so half sits over the source
   rail and half over the grid column.
   Prominent primary-tinted chrome — this is NOT a hidden
   utility button. Solid primary background + white icon paints
   it as a deliberate "I am clickable, click me" affordance in
   both light and dark modes. */
.scheduler__source-toggle {
  appearance: none;
  /* `position: fixed` (NOT `absolute`) — `.scheduler` (the
     button's previous containing block) grows TALLER than the
     viewport because the right-column game grid scrolls forever
     vertically. `position: absolute; bottom: 30px` against that
     tall container placed the chip 30px above `.scheduler`'s
     actual bottom edge, which sat far below the visible viewport,
     so the button rendered off-screen / invisible. `position:
     fixed` anchors against the VIEWPORT instead, so `bottom:
     30px` lands 30px above the visible-area's bottom edge —
     always on-screen at the column boundary. */
  position: fixed;
  bottom: 30px;
  top: auto;
  /* Center the chip on the VISIBLE column divider. The source
     column carries a 1px `border-right`, so the divider line
     sits at `source-width - 0.5px` (the border's visual middle).
     `calc(... - 0.5px)` nudges the anchor half a pixel left so
     the icon lands visually centered on the divider stroke
     rather than reading biased toward the right column. */
  /* `position: fixed` measures `left` from the VIEWPORT edge, but the
     scheduler content is inset by the fixed left nav rail. Add the rail's
     content-inset width (`--mg-rail-width`, published by MatchGeniEventLayout;
     0 when the rail isn't present) so the chip lands on the column divider
     INSIDE the inset content, not behind the rail. */
  left: calc(var(--mg-rail-width, 0px) + var(--scheduler-source-width) - 0.5px);
  transform: translateX(-50%);
  /* Above the matchgeni-header (z=50) is overkill — the button
     sits at the viewport bottom, never overlapping the header at
     top. z=20 keeps it above any scrolling content / overlays
     INSIDE the scheduler surface without competing with the
     page-level navigation chrome. */
  z-index: 20;
  /* 24×24 — small utility chip. Tight footprint reads as a quiet
     panel-toggle affordance rather than a primary CTA. */
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 999px;
  /* INSIDE border — `box-shadow: inset 0 0 0 2px` paints a ring
     INSIDE the chip's bounds, against the primary-tinted fill,
     so the icon sits inside a clear ringed badge. Combined with
     the soft outer glow shadow below, the chip reads as a
     primary-action affordance with deliberate chrome. */
  background: var(--primary, #2d8cf0);
  color: #ffffff;
  border: none;
  cursor: pointer;
  box-shadow:
    inset 0 0 0 2px rgba(255, 255, 255, 0.55),
    0 2px 6px rgba(45, 140, 240, 0.45);
  transition: left 220ms ease, background 120ms ease, box-shadow 120ms ease, transform 120ms ease;
}
.scheduler__source-toggle:hover {
  background: var(--primary-dark, #1f78d4);
  transform: translateX(-50%) scale(1.08);
}
.scheduler__source-toggle:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
/* Dark mode — keep the primary-blue fill but calm the chrome so the chip
   sits quietly against the dark scheduler surface instead of reading as a
   loud target/badge: the inner white ring drops to a subtle 1px rim, and
   the bright-blue glow is swapped for the neutral dark drop-shadow used
   elsewhere in dark mode (matches the sticky-header shadow preference). */
html.dark-mode .scheduler__source-toggle {
  background: var(--primary, #2d8cf0);
  color: #ffffff;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.22),
    0 2px 8px rgba(0, 0, 0, 0.45);
}
html.dark-mode .scheduler__source-toggle:hover {
  background: #4aa0ff;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.3),
    0 3px 10px rgba(0, 0, 0, 0.5);
}

/* Icon inside the toggle — 16×16 masked twotone SVG, picks up
   the button's `currentColor`. Two variant assets:
     `arrow-left-section-twotone.svg`  — expanded state (click to collapse).
     `arrow-right-section-twotone.svg` — collapsed state (click to expand). */
.scheduler__source-toggle-icon {
  display: inline-block;
  /* 14×14 in the 24×24 chip — paired with the thicker SVG stroke
     (2.6 in a 24 viewBox) so the white chevron reads clearly against
     the primary-blue fill in BOTH light and dark mode. The earlier
     12px + hairline 1.6 stroke rendered a ~0.8px line that washed out
     on the blue. */
  width: 14px;
  height: 14px;
  /* White chevron in light mode (reads fine on the primary-blue chip).
     Dark mode flips it to deep navy below — a thin white glyph washed out
     against the chip on the darker surroundings. */
  background-color: #ffffff;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}
.scheduler__source-toggle-icon--collapse {
  -webkit-mask-image: url('../assets/arrow-left-section-twotone.svg');
  mask-image: url('../assets/arrow-left-section-twotone.svg');
}
.scheduler__source-toggle-icon--expand {
  -webkit-mask-image: url('../assets/arrow-right-section-twotone.svg');
  mask-image: url('../assets/arrow-right-section-twotone.svg');
}
/* Dark mode — deep-navy chevron (white washes out on the chip against the
   dark surroundings). Light mode keeps the white base above. */
html.dark-mode .scheduler__source-toggle-icon {
  background-color: #0c2745;
}

.scheduler__source-head {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  /* Internal padding moved here from the section wrapper so the
     section itself reaches the viewport edges. Horizontal 14px
     mirrors the game-grid's padding below — header + cards share
     the same content column.
     `padding-right` bumped to `30px` so the division dropdown
     leaves room for the collapse toggle chip sitting on the
     column boundary (the chip is 28px wide; half overlaps the
     source rail by ~14px). Without this extra padding the
     dropdown caret arrow would visually collide with the toggle. */
  /* Equal `14px` horizontal padding on both sides — earlier the
     right padding was bumped to 30px to leave room for the
     collapse toggle chip when it sat at the top of this header.
     The toggle has since moved to `bottom: 30px` of the viewport
     (see `.scheduler__source-toggle`), so the extra right inset
     here is no longer needed. */
  padding: 14px 14px 12px;
  border-bottom: 1px solid var(--border-divider);
  /* No background fill (both light + dark) — the header reads on the
     source column / page background; only the bottom border separates
     it from the games list. */
  background: transparent;
  /* `flex: 0 0 auto` keeps the header at its natural content
     height (no shrink, no grow) at the top of the source's
     flex column. The game-grid below claims the remaining
     space and owns the scrolling. */
  flex: 0 0 auto;
}

.scheduler__division-picker {
  /* Stretch to the full width of the section so the dropdown
     fills the first row of the header. */
  width: 100%;
  min-width: 0;
  max-width: none;
}

/* `.scheduler__select` rules removed — the only consumer was
   `.scheduler__division-picker`'s inner `<select>`, which now uses
   the shared `.floating-input__control--select` pattern. */

.scheduler__tabs-row {
  /* Left-aligned flex row across ALL viewports — pills sit at
     their content width (with a `min-width: 120px` floor on each
     tab below so the pair reads as equal-sized) anchored to the
     left edge of the source-rail. Previously this used a
     `grid-template-columns: 1fr 1fr` layout that stretched each
     pill to half the row; user prefers the consistent left-
     aligned look at every screen size. */
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  min-width: 0;
}

/* `.scheduler__tabs` wrapper rule + the `.scheduler__auto-schedule`
   button rule were removed — the wrapper element is gone from the
   template (tabs now sit directly inside `.scheduler__tabs-row`),
   and the standalone Auto Schedule button moved back into the
   phase-settings cog popover as a menu item. */
.scheduler__tab {
  appearance: none;
  /* `display: flex` + `justify-content: center` keeps the label
     centered inside the pill. `flex: 0 0 auto` so the tab is
     content-sized inside the left-aligned flex row (NOT
     stretching to fill the row the way a 1fr grid cell would).
     No `min-width` — each pill hugs its own label width with
     the horizontal padding providing the breathing room on
     either side, so "Pool Play" and "Brackets" render at their
     natural sizes rather than being floored to a fixed pill
     length. */
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  padding: 0 18px;
  /* `min-height: 36px` matches the lineup tabs on the game-
     details popup so both surfaces share the same pill scale. */
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
.scheduler__tab:hover:not(.scheduler__tab--active) {
  background: rgba(45, 140, 240, 0.06);
}
.scheduler__tab--active {
  background: var(--primary, #2d8cf0);
  border-color: var(--primary, #2d8cf0);
  /* `var(--white)` → dark text on the bright-blue primary in dark
     mode (same pattern as the dashboard "Add Division" button). */
  color: var(--white, #ffffff);
}
.scheduler__tab--active:hover {
  background: var(--primary, #2d8cf0);
}
html.dark-mode .scheduler__tab {
  background: var(--surface-card);
}
/* Active tab in dark mode — outline only (primary border + primary
   text) instead of the bright primary fill, which is too heavy on
   dark. Beats the `html.dark-mode .scheduler__tab` rule above. */
html.dark-mode .scheduler__tab--active {
  background: var(--surface-card);
  border-color: var(--primary);
  color: var(--primary);
}
html.dark-mode .scheduler__tab--active:hover {
  background: var(--surface-card);
}

/* `.scheduler__auto-schedule` CSS removed — the standalone Auto
   Schedule button was retired; the action lives inside each
   phase-settings cog popover as a regular menu item now. */

.scheduler__game-grid {
  display: grid;
  /* One card per row — the source list reads as a vertical stack
     of full-width cards, with the right column getting the rest
     of the viewport for the grid. */
  grid-template-columns: 1fr;
  /* Pack rows at the TOP. The grid is `flex: 1 1 0` so it fills the
     column height; without this the default `align-content: stretch`
     grows the auto rows to fill the leftover space, stretching a
     short list (few bracket / pool games) down the whole pane. */
  align-content: start;
  gap: 12px;
  /* The games list IS the scroll container. `flex: 1 1 0` (NOT
     `flex: 1 1 auto`) is the critical bit — basis `0` means the
     grid starts at zero size and grows to fill the available
     flex space, so its content can be longer than the flex
     allotment and `overflow-y: auto` activates. With basis
     `auto`, the grid's flex basis was its content height (taller
     than the section), and the parent's overflow: hidden ended
     up clipping the extra cards instead of letting them scroll —
     which is the bug you saw on the pool tab with 9 games. */
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  /* `padding-top: 0` (was 12px) — `position: sticky` pins
     against the scroll container's PADDING EDGE, so a non-zero
     `padding-top` would render as a visible empty gap above the
     sticky date headers when they're pinned. The first child
     (the info banner) carries its own `margin-top: 12px` below
     so the visual 12px breathing space above it is preserved
     while the gap-above-sticky-header bug stays fixed. */
  padding: 0 12px 12px;
  /* Sticky-offset for the embedded `MatchGeniGameListPanel` —
     its date-group headers anchor against THIS scroll container.
     `0` covers the pool tab (no pager above). On the bracket
     tab the toolbar (bracket pager + add/preview buttons)
     also sticks to `top: 0` inside this scroll — see the
     `.scheduler__bracket-toolbar` rule's effective height
     (~40px including padding + border). Date headers on the
     bracket tab inherit the override below. */
  --game-list-sticky-top: 0px;
  /* The grid owns the 12px side gutter (padding above); tell the
     embedded panel's date band to bleed out to the column edges by
     that same amount so the banded header has no left/right gap. */
  --game-list-bleed: 12px;
}

/* Restore the 12px visual gap above the info banner that used to
   come from the scroll container's `padding-top`. As a margin on
   the banner itself, the gap scrolls AWAY with the banner when
   the user scrolls down — leaving the sticky date header flush
   with the scroll viewport's top, no padding-derived empty band
   leaking through. */
.scheduler__game-grid > .scheduler__game-info:first-child {
  margin-top: 12px;
}
/* Bracket tab — toolbar pinned at the top of the same scroll
   container means the panel's sticky date headers need to clear
   it. Roughly the toolbar's rendered height (40-48px). */
.scheduler__game-grid:has(.scheduler__bracket-toolbar) {
  --game-list-sticky-top: 48px;
}

/* Info banner — first child of the game-grid scroll region.
   Scrolls with the cards. Flex row: stacked title + sub-line on
   the left, settings cog button on the right. */
/* `.scheduler__game-info` (+ its `__text` / `__title` / `__sub`
   modifiers) were absorbed into the shared `.app-banner` /
   `.app-banner--primary` utility in `styles.css`. The banner
   markup still carries the `scheduler__game-info` class as a
   namespacing hook for the settings-cog menu root that lives at
   the right end of the row, but the visual rules are global now. */

/* Pool info banner — 2-row grid so the action buttons align (vertically
   centred) against the title + count rows, and the tie-breaker drops to
   its own full-width row beneath. Bracket phase keeps the base
   `.app-banner` flex layout (no `--pool` modifier). */
.app-banner.scheduler__game-info--pool {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 10px;
  row-gap: 2px;
}
.scheduler__game-info--pool .app-banner__text { grid-column: 1; grid-row: 1; }
.scheduler__game-info--pool .app-banner__actions { grid-column: 2; grid-row: 1; }
.scheduler__game-info--pool .scheduler__game-info-tiebreak { grid-column: 1 / -1; grid-row: 2; }

/* Team/game count line — between the round-robin title and the
   tie-breaker row (mirrors `.mg-div-detail__games-banner-count`). */
.scheduler__game-info-count {
  font-size: 12px;
  font-weight: 700;
  color: var(--primary, #2d8cf0);
}

/* Pool status dot — colour-coded circle before the title with a tooltip
   (replaces the pill where there's no horizontal room). Tone palette
   mirrors the status-badge / `.mg-div-detail__pill` families. */
.scheduler__game-info-dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  margin-right: 7px;
  border-radius: 50%;
  vertical-align: middle;
  background: var(--secondary);
  cursor: default;
}
.scheduler__game-info-dot[data-tone='success'] { background: var(--success, #2bb673); }
.scheduler__game-info-dot[data-tone='warning'] { background: #e8a020; }
.scheduler__game-info-dot[data-tone='primary'] { background: var(--primary, #2d8cf0); }
.scheduler__game-info-dot[data-tone='danger'] { background: var(--danger, #d9534f); }
.scheduler__game-info-dot[data-tone='neutral'] { background: var(--secondary); }
/* Tooltip on top but LEFT-anchored (bubble's left edge at the dot) so it
   doesn't overflow the banner's left edge. Overrides the centered
   `.app-tooltip--top` placement; the arrow stays centered on the dot. */
.scheduler__game-info-dot--tip-left.app-tooltip--top::after {
  left: 0;
  transform: translateY(2px);
}
.scheduler__game-info-dot--tip-left.app-tooltip--top:hover::after,
.scheduler__game-info-dot--tip-left.app-tooltip--top:focus-visible::after {
  transform: translateY(0);
}
/* Add / Regenerate buttons — tooltip on top but RIGHT-anchored (bubble's
   right edge at the button) so it doesn't overflow the banner's right
   edge. Arrow stays centered on the button. */
.scheduler__game-info-action--tip-right.app-tooltip--top::after {
  left: auto;
  right: 0;
  transform: translateY(2px);
}
.scheduler__game-info-action--tip-right.app-tooltip--top:hover::after,
.scheduler__game-info-action--tip-right.app-tooltip--top:focus-visible::after {
  transform: translateY(0);
}

/* Settings cog — opens the per-phase (pool / bracket) settings
   panel. Same icon-button shape used by the matchgeni header's
   settings button: small circular chip with the shared
   `assets/settings.svg` glyph rendered via CSS mask so the icon
   inherits the button's `currentColor` and themes correctly in
   light + dark. */
/* Wrapper around the cog + dropdown so the menu can absolute-
   position relative to the trigger without escaping into the
   info card's flex layout. */
.scheduler__game-info-menu-root {
  position: relative;
  flex: 0 0 auto;
  /* Settings cog + (Bracket tab only) Preview button sit
     side-by-side. Inline-flex with a small gap keeps them as
     a tight cluster at the right end of the info banner. */
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

/* Banner action icon buttons — Preview Bracket (always on the
   Bracket tab) + the phase-specific second button:
     Pool tab    → Regenerate Pool (refresh.svg)
     Bracket tab → Edit Bracket    (edit.svg)
   All share one circular chip chrome so the cluster reads as
   a matched icon-button pair on the right end of the banner. */
.scheduler__game-info-action,
.scheduler__game-info-preview {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  flex: 0 0 auto;
  border-radius: 999px;
  border: 1px solid var(--border-divider);
  background: var(--surface-card);
  color: var(--secondary);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}
.scheduler__game-info-action:hover,
.scheduler__game-info-preview:hover {
  background: var(--surface-raised);
  color: var(--primary);
}

/* Icon glyphs — each variant masks a different SVG. The icon
   itself inherits the button's `currentColor` so themed
   palettes flow through without per-icon dark-mode overrides. */
.scheduler__game-info-preview-icon,
.scheduler__game-info-action-icon {
  display: inline-block;
  width: 14px;
  height: 14px;
  background-color: currentColor;
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
}
.scheduler__game-info-preview-icon {
  -webkit-mask-image: url('../assets/eye.svg');
  mask-image: url('../assets/eye.svg');
}
.scheduler__game-info-action-icon--refresh {
  -webkit-mask-image: url('../assets/refresh.svg');
  mask-image: url('../assets/refresh.svg');
}
.scheduler__game-info-action-icon--edit {
  -webkit-mask-image: url('../assets/edit.svg');
  mask-image: url('../assets/edit.svg');
}
.scheduler__game-info-action-icon--add {
  -webkit-mask-image: url('../assets/add.svg');
  mask-image: url('../assets/add.svg');
}

/* (Banner-actions cluster styles merged into the
   `.scheduler__game-info-menu-root` rule above.) */
/* (Removed: `.scheduler__phase-menu` + `.scheduler__game-info-
   settings*` rules — the per-phase cog popover was retired in
   favour of direct icon buttons on the info banner.) */

/* Bracket toolbar — outer row that hosts the pager pill on the
   left + the trailing icon-button actions on the right (Add /
   Preview). Replaces the previous standalone pager: now the
   sticky pinning + soft shadow live on this wrapper so the whole
   row stays anchored together. Only rendered on the Bracket tab. */
.scheduler__bracket-toolbar {
  position: sticky;
  /* `top: 0` of the game-grid scroll container — pins below the
     info banner once that banner has scrolled past. */
  top: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 8px;
  /* Top/bottom padding only — gives the pager pill + trailing
     action buttons vertical breathing room when the toolbar
     pins, without adding any horizontal inset (the scroll
     container's own `padding: 0 14px` already provides the
     side gutter, so adding it again here would double up). */
  /* Transparent in normal flow — no background. The band only paints
     once it pins to the top (see `--stuck` below), matching the date
     headers' stuck-only behaviour. The horizontal bleed is reserved
     here (negative margin + matching padding) so the pinned band can
     stretch to the scroll container's edges without shifting the
     pager pill, which stays aligned with the cards. */
  margin-left: calc(-1 * var(--game-list-bleed, 0px));
  margin-right: calc(-1 * var(--game-list-bleed, 0px));
  padding: 8px var(--game-list-bleed, 0px);
  background: transparent;
  transition: background-color 140ms ease;
}
/* Pinned state (toggled in JS) — paint the same dedicated sticky-
   header surface token the date rows use (`--surface-chrome`, 0.96
   alpha so scrolling cards don't bleed through), stretched full-bleed
   via the bleed margins above. No border / shadow — just the fill. */
.scheduler__bracket-toolbar--stuck {
  background: var(--surface-chrome);
}

/* Pager pill — sits as the leftmost child of the toolbar. Keeps
   its own background + pill chrome so it reads as one widget.
   Vertical padding kept at `0` so the pill's height matches the
   32px arrow buttons inside (and the 32px Add / Preview action
   buttons next to it on the right) — was `10px 12px` earlier
   which pushed the pill ~20px taller than the trailing action
   icons and the toolbar row read as visually mismatched. */
.scheduler__bracket-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  /* Zero vertical padding so the pill's height comes entirely
     from the 32px arrow buttons inside — keeps the pill the
     same height as the 32px Add / Preview action buttons next
     to it on the right. The label sits centered between the
     arrow buttons with the `gap: 16px` providing the inside
     spacing the old `padding: 10px 12px` contributed. */
  padding: 0 12px;
  background: var(--white);
  border: 1px solid var(--border-divider);
  border-radius: 999px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  /* Soft drop shadow so the bar reads as lifted over the game
     cards scrolling past behind it. */
  box-shadow: 0 2px 6px rgba(13, 30, 58, 0.08);
  /* `flex: 1 1 auto` lets the pill grow to fill the row while
     the action buttons hug their fixed 32px width on the right.
     `min-width: 0` keeps the label from forcing the pill wider
     than available space. */
  flex: 1 1 auto;
  min-width: 0;
}

/* Add / Preview action buttons — sibling to the pager pill.
   Circular 32px chips matching the pager arrow buttons' geometry
   so the trailing icons read as part of the same toolbar family. */
.scheduler__bracket-action-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 999px;
  border: 1px solid var(--border-divider);
  background: var(--white);
  color: var(--secondary);
  cursor: pointer;
  flex: 0 0 auto;
  /* Same lift as the pager pill so the whole toolbar reads as
     one elevated row. */
  box-shadow: 0 2px 6px rgba(13, 30, 58, 0.08);
  transition: background-color 120ms ease, color 120ms ease;
}
.scheduler__bracket-action-btn:hover {
  background: var(--surface-raised);
  color: var(--primary);
}
.scheduler__bracket-action-btn:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

/* Action-button icons — painted via CSS mask off the shared
   design-library SVGs so they tint with the button's
   `currentColor` (which the hover rule above shifts to primary). */
.scheduler__bracket-action-icon {
  display: inline-block;
  width: 16px;
  height: 16px;
  background-color: currentColor;
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
}
.scheduler__bracket-action-icon--add {
  -webkit-mask-image: url('../assets/add.svg');
  mask-image: url('../assets/add.svg');
}
.scheduler__bracket-action-icon--eye {
  -webkit-mask-image: url('../assets/eye.svg');
  mask-image: url('../assets/eye.svg');
}

/* Action-button label — hidden on desktop (the buttons are
   icon-only 32×32 round chips with tooltips). At <1024px the
   horizontal-rail layout has room for the verb beside the icon,
   so the label renders and the button expands to its content
   width — see the responsive override at the bottom of this
   stylesheet. */
.scheduler__bracket-action-label {
  display: none;
}
@media (max-width: 1024px) {
  /* Reshape the round icon-chip into a labeled pill: drop the
     fixed `32×32` square + `border-radius: 999px` for a content-
     sized pill with padding + 6px border-radius matching the
     other portal buttons. The icon stays via `currentColor`
     mask; the label sits next to it with an 8px gap. Tooltips
     are redundant once the label is visible — the `.app-tooltip`
     class stays on the markup but the pseudo-bubble doesn't pop
     because the cursor doesn't need it to identify the action. */
  .scheduler__bracket-action-btn {
    width: auto;
    height: auto;
    min-height: 32px;
    padding: 0 12px;
    border-radius: 6px;
    gap: 8px;
    font-size: 13px;
    font-weight: 500;
  }
  .scheduler__bracket-action-label {
    display: inline;
    white-space: nowrap;
  }
  /* Suppress the tooltip bubble on the labeled variant — the
     visible label already names the action. */
  .scheduler__bracket-action-btn.app-tooltip::after,
  .scheduler__bracket-action-btn.app-tooltip::before {
    display: none;
  }
}
.scheduler__bracket-pager-label {
  flex: 0 1 auto;
}
.scheduler__bracket-pager-arrow {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* Bumped from 28x28 → 32x32 + larger icon so the
     arrow-right.svg chevron's thin stroke is clearly visible
     against the disabled state at the page's "Bracket 1 of 1"
     default — the smaller size made the glyph read as a faint
     dash. */
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 999px;
  border: none;
  background: var(--surface-card);
  color: var(--secondary);
  cursor: pointer;
  transition: background-color 120ms ease, opacity 120ms ease;
}
.scheduler__bracket-pager-arrow:hover:not(:disabled) {
  background: var(--surface-raised);
}
.scheduler__bracket-pager-arrow:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.scheduler__bracket-pager-arrow-icon {
  display: inline-block;
  width: 16px;
  height: 16px;
  background-color: currentColor;
  -webkit-mask-image: url('../assets/arrow-right.svg');
  mask-image: url('../assets/arrow-right.svg');
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
}
.scheduler__bracket-pager-arrow-icon--prev {
  transform: scaleX(-1);
}

/* Cards rail — desktop default. Wrapper + inner rail both behave
   as full-width vertical stacks so the cards look the same as
   before: one card per row, parent `.scheduler__game-grid` handles
   vertical scroll. `position: relative` on the wrap so the mobile
   overlay arrows (hidden via `v-show` at desktop) have a positioned
   ancestor when they do appear. */
.scheduler__game-rail-wrap {
  position: relative;
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}
.scheduler__game-rail {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
  min-width: 0;
}

/* Card chrome rules (`.scheduler__game-card*`,
   `.scheduler__game-handle`, `.scheduler__game-body`,
   `.scheduler__game-header / label / menu`,
   `.scheduler__game-teams / team`, `.scheduler__game-slot*`,
   `.scheduler__game-unlink`) moved into the
   `src/components/SchedulerGameCard.vue` scoped block when the
   card was extracted. The card's class names are kept identical
   so the visual output is byte-for-byte the same — only the file
   the styles live in changed. */

/* `.scheduler__source-footer` rule removed — the footer element
   itself is no longer rendered. Kept this stub comment so future
   spelunking in git history makes the removal obvious. */

/* ─── RIGHT COLUMN ───────────────────────────────────────────── */

/* ── Resources "not configured" region overlays ─────────────────
   When the live §9 resources call returns no parks / a park without
   fields or a window / no divisions, the affected pane renders the
   mock sample BLURRED behind an explanatory overlay so the admin
   sees a representative layout + a clear next step instead of a
   blank panel. */
.scheduler__grid-region,
.scheduler__list-region {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}
/* Blur the disabled grid; blur ALL of the disabled left pane
   (header + game-grid) EXCEPT the overlay, which stays sharp. */
.scheduler__grid-region--disabled .scheduler__field-grid,
.scheduler__source--disabled > :not(.scheduler__region-overlay) {
  filter: blur(3px) saturate(0.85);
  pointer-events: none;
  user-select: none;
  opacity: 0.7;
}
/* No scroll while the left pane is disabled — the game list's own
   scroll container is frozen so the centered message reads as a
   single static panel. */
.scheduler__source--disabled .scheduler__game-grid {
  overflow: hidden;
}
/* Disabled grid-region becomes a fixed-height, non-scrolling panel
   (the grid-shell otherwise flows with the page) so the centered
   message lands in the viewport and the blurred backdrop can't be
   scrolled. Height = viewport minus the matchgeni header + park
   row that sit above it. */
.scheduler__grid-region--disabled {
  height: calc(100vh - var(--matchgeni-field-grid-top, 120px));
  overflow: hidden;
}
/* The fixed-height + `overflow: hidden` above turns the disabled
   region into a scroll container, which would re-anchor the field
   grid's internal `position: sticky` date strip / field bar / time
   labels to THIS box (pushing them down by their `top:` offset).
   The backdrop is blurred + inert, so sticky serves no purpose
   here — flatten it back to normal flow so the date strip + thead
   keep their original position behind the overlay. */
.scheduler__grid-region--disabled :deep(.field-grid__date-strip),
.scheduler__grid-region--disabled :deep(.field-grid__field-bar),
.scheduler__grid-region--disabled :deep(.field-grid__cal-time-label) {
  position: static;
}
/* Scope 'all' (no park) — blur the park row too. Scope 'grid'
   leaves the row sharp so the user can switch parks. */
.scheduler__park-head--blurred {
  filter: blur(3px) saturate(0.85);
  opacity: 0.7;
  pointer-events: none;
  user-select: none;
}
.scheduler__region-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 56px 20px 20px;
  z-index: 6;
  pointer-events: none;
}
.scheduler__region-overlay-card {
  pointer-events: auto;
  max-width: 360px;
  text-align: center;
  background: var(--white, #fff);
  border: 1px solid var(--border-divider, rgba(15, 23, 42, 0.12));
  border-radius: 14px;
  padding: 22px 22px 20px;
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.18);
}
.scheduler__region-overlay-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  margin-bottom: 12px;
  background: var(--primary-light-4, rgba(37, 99, 235, 0.12));
  color: var(--primary, #2563eb);
  font-weight: 700;
  font-size: 22px;
}
.scheduler__region-overlay-icon::before {
  content: 'i';
  font-style: italic;
  font-family: Georgia, 'Times New Roman', serif;
}
.scheduler__region-overlay-title {
  margin: 0 0 6px;
  font-size: 16px;
  font-weight: 500;
  color: var(--text-strong, #0f172a);
}
.scheduler__region-overlay-body {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--text-muted, #64748b);
}
html.dark-mode .scheduler__region-overlay-card {
  background: #1a2028;
  border-color: rgba(255, 255, 255, 0.12);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.5);
}
/* Title uses a dark token by default (readable on the light card);
   on the dark card it needs a light color or it vanishes. */
html.dark-mode .scheduler__region-overlay-title {
  color: #f1f5f9;
}
html.dark-mode .scheduler__region-overlay-body {
  color: #b7c2d0;
}
/* Centered variant — used by the fixed-height left pane (the
   source column is `100vh − header` tall, so the message lands
   in the visual center). The grid overlay keeps the default
   top-alignment since the grid is tall + scrollable. */
.scheduler__region-overlay--centered {
  align-items: center;
  padding-top: 20px;
}
/* Action-link row — one or more permission-gated CTA buttons
   (e.g. "Select fields" + "Set scheduling window" when both are
   missing). Wraps + centers under the message. */
.scheduler__region-overlay-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin-top: 16px;
}
/* Permission-gated CTA button in the overlay card. `flex: 1 1 0`
   so when two buttons show (Select fields + Scheduling Window) they
   share the row in equal widths regardless of label length. */
.scheduler__region-overlay-cta {
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
.scheduler__region-overlay-cta:hover {
  filter: brightness(1.06);
}
.scheduler__region-overlay-cta:focus-visible {
  outline: 2px solid var(--primary, #2563eb);
  outline-offset: 2px;
}

.scheduler__grid-shell {
  display: flex;
  flex-direction: column;
  gap: 0;
  background: none;
  /* `--matchgeni-field-grid-top` tells the embedded
     `MatchGeniFieldGrid` where to chain-stick its date strip
     under the page header + park-head bar combo. The grid thead
     stacks under that via the component's own
     `--matchgeni-field-grid-date-strip-height` measurement. */
  /* `--scheduler-park-height` fallback bumped from 38px → 64px
     after the park-head's vertical padding grew (8px → 13px each
     side + ~38px dropdown = ~64px total). The runtime
     `ResizeObserver` on `parkSelectRef` publishes the live floored
     height, but until that fires (initial paint / first render)
     the fallback drives the chained sticky offsets — a stale 38px
     here let the date strip + thead pin too HIGH and the park bar
     ended up painting OVER them. 64px matches the new rendered
     height so the chained-sticky math stays correct from frame 1. */
  --matchgeni-field-grid-top: calc(
    var(--matchgeni-header-height, 56px)
    + var(--scheduler-park-height, 64px)
  );
  /* Flush with the viewport — no top / right / bottom gaps, no
     border-radius, no outer margin. The column stretches to the
     full available area so the table's scrollbar (when the grid
     overflows horizontally) sits right against the viewport's
     right edge. Inner sections add their own padding for
     breathing room. */
  border: 0;
  border-radius: 0;
  margin: 0;
  min-width: 0;
  /* NO `overflow: hidden` — would clip the chained sticky park
     / date / thead headers below from sticking to the page
     viewport. The section flows with the page; its internal
     headers stick as the user scrolls past them. */
  overflow: visible;
}

/* Park / date / thead form a chained sticky stack on the page
   scroll — each anchors to the viewport at a `top:` offset
   that accounts for the matchgeni header plus the heights of
   the headers above it in the chain. Heights are published at
   runtime by `publishStickyHeights()` (ResizeObserver on the
   park-select + date-strip elements) so the chain stays glued
   together no matter how the row heights drift; the fallback
   values mirror the previous hardcoded estimates. */
/* The outer header wrapping the park-select pill is the sticky
   element now (the select itself sits inside it as a centered
   pill). Subtract 1px from every chained-sticky `top:` so each
   row OVERLAPS the row above by 1px, guaranteeing no sub-pixel
   gap can ever appear between them — regardless of how the
   browser rounds fractional CSS-pixel heights. The overlap is
   invisible because every sticky surface is opaque and the
   upper row's z-index is higher. */
.scheduler__park-head {
  position: sticky;
  /* No `-1px` subtraction — the matchgeni header above this bar
     has `z-index: 50` (park-head is z=4), so any sub-pixel overlap
     is invisibly painted over by the header. The threshold equals
     the published `--matchgeni-header-height` (a `Math.floor`d
     integer); combined with the natural-flow `-1px` margin-top
     below, natural y = H_actual - 1 is ALWAYS `<= threshold` for
     any fractional H_actual. So sticky engages from scroll=0 and
     the park bar never visibly "snaps" on first scroll. The
     same trick the field-grid page's park toolbar uses. */
  top: var(--matchgeni-header-height, 56px);
  /* `-1px` natural-flow shift — pulls the park bar's top 1px
     UNDER the matchgeni header's bottom edge, hiding the
     `border-bottom` divider line that would otherwise paint a
     visible 1px "gap" between the header and the park bar at
     scroll=0. The high-z-index header covers the overlap; also
     ensures natural y <= sticky threshold so sticky pins from
     scroll=0 (see comment above). */
  margin-top: -1px;
  z-index: 4;
  display: flex;
  align-items: center;
  /* Left-aligned cluster — park icon + dropdown sit at the left
     edge of the muted bar. Matches the field-grid page's
     toolbar layout exactly. */
  justify-content: flex-start;
  min-width: 0;
  gap: 12px;
  /* Vertical padding bumped from 8px → 13px so the park-head's
     bottom border lines up with the left column's `__source-head`
     bottom border (the line below the Pool Play / Brackets tab
     row). Math: left column = `padding-top 14 + dropdown ~38 +
     gap 8 + tabs 36 + padding-bottom 12 = ~108px` from
     `__source-head`'s top to its border. Right column had
     `padding 8 + dropdown ~38 + padding 8 = ~54px` in the
     park-head alone — bumping vertical padding to 13px brings
     the park-head closer to that left-column height so the
     bottom dividers visually align across the two columns. */
  padding: 13px 14px;
  /* Frosted-glass strip — no fill in light mode; the `backdrop-filter`
     blur alone makes the grid scrolling UNDER this sticky bar read as a
     soft blurred wash. The `saturate` keeps the blurred backdrop from
     going flat/grey. `-webkit-` prefix for Safari. (Dark mode adds a
     translucent fill below for legibility.) */
  background: transparent;
  -webkit-backdrop-filter: blur(10px) saturate(1.3);
  backdrop-filter: blur(10px) saturate(1.3);
  border-bottom: 1px solid var(--border-divider);
}
/* Dark mode — translucent deep-slate fill tuned to the scheduler's
   dark surface so the frosted bar stays legible over blurred content. */
html.dark-mode .scheduler__park-head {
  background: rgba(14, 22, 33, 0.62);
}

/* Park-twotone glyph — same 28px masked icon the field-grid page
   shows before its dropdown. Themes navy in light / lighter
   primary blue in dark via `background-color`. */
.scheduler__park-icon {
  display: inline-block;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
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
html.dark-mode .scheduler__park-icon {
  background-color: #7fb0e8;
}

/* Park picker container — constrains the floating-input wrapper's
   width inside the muted-bar header. Same 360px cap the field-grid
   toolbar uses so both surfaces stay visually identical. */
.scheduler__park-picker {
  width: 100%;
  max-width: 360px;
  flex: 0 1 360px;
}

/* Selection bar — swaps into the park-head while a bulk selection is
   active. Count on the left, actions pushed to the right. */
/* Count — same format as the division sidebar counter (bold number +
   muted label). */
.scheduler__selection-count {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  flex: 0 0 auto;
}
.scheduler__selection-count strong {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
}
.scheduler__selection-count span {
  font-size: 13px;
  color: var(--secondary);
}
.scheduler__selection-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.scheduler__selection-action {
  appearance: none;
  display: inline-flex;
  align-items: center;
  /* Match the portal's standard button height (`.primary/.secondary-button`
     → min-height 36px, line-height 1). */
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid var(--primary);
  background: var(--surface-card);
  color: var(--primary);
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  flex: 0 0 auto;
  transition: background 120ms ease;
}
.scheduler__selection-action:hover:not(:disabled) { background: var(--primary-light-3); }
.scheduler__selection-action:disabled { opacity: 0.4; cursor: not-allowed; }
/* Clear — neutral (non-primary) bordered button, same height as the
   action pills. */
.scheduler__selection-clear {
  appearance: none;
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid var(--border-divider);
  border-radius: 6px;
  background: var(--surface-card);
  color: var(--secondary);
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  flex: 0 0 auto;
  transition: background 120ms ease, color 120ms ease;
}
.scheduler__selection-clear:hover { background: var(--surface-muted, #f4f7fb); color: var(--text); }
html.dark-mode .scheduler__selection-clear:hover { background: rgba(255, 255, 255, 0.06); }

/* ── Mobile (≤720px) park-head ──
   Drop the decorative park glyph (toolbar space is tight). */
@media (max-width: 720px) {
  .scheduler__park-icon { display: none; }
}

/* Scheduler notifications use the shared app-level toast (pushToast) —
   the local `.scheduler__toast` surface was removed. */

/* `.scheduler__date-strip`, `.scheduler__date-*`,
   `.scheduler__grid-*`, `.scheduler__grid-th*`,
   `.scheduler__grid-time`, `.scheduler__grid-cell*`,
   `.scheduler__grid-empty`, `.scheduler__grid-pill*` rules were
   moved into `src/components/MatchGeniFieldGrid.vue` (renamed
   `field-grid__*` there) along with the date-strip + table
   markup, so the same surface can drive the public event page's
   audience-facing schedule view. The dark-mode overrides for
   those classes were removed alongside them. */

/* `.scheduler__select--park` rules removed — replaced by the
   shared `.floating-input__control--select` pattern from
   `styles.css` so the dropdown reads the same as every form
   select across the portal (and matches the field-grid page's
   park picker). */

/* ─── Loading skeleton + error banner ────────────────────────── */

/* Skeleton reuses `.scheduler` for the two-column grid template
   so the loading state lines up 1:1 with the real layout —
   identical column widths, identical alignment, identical sticky
   sidebar behaviour. `pointer-events: none` prevents accidental
   clicks on the placeholder elements before the data arrives. */
.scheduler--loading {
  pointer-events: none;
}

/* ── Left column placeholders ── */
.scheduler__source--skeleton {
  /* No sticky / `height: 100vh` overrides — inherits the real
     `.scheduler__source` rules above so the skeleton column
     sits in the exact frame the real source column will occupy. */
}
.scheduler__skeleton-select {
  /* Matches the division `<select>`'s rendered height + radius. */
  height: 38px;
  border-radius: 8px;
}
.scheduler__skeleton-tabs-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
}
.scheduler__skeleton-tabs {
  display: inline-flex;
  gap: 18px;
}
.scheduler__skeleton-tab {
  width: 64px;
  height: 18px;
  border-radius: 4px;
}
.scheduler__skeleton-cta {
  /* Mirrors the Auto Schedule pill on the real tabs row. */
  width: 96px;
  height: 28px;
  border-radius: 6px;
}
.scheduler__skeleton-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 14px;
}
.scheduler__skeleton-info {
  /* Same footprint the `.app-banner` info card has on the real
     screen — two-line block of context. */
  height: 56px;
  border-radius: 8px;
}
.scheduler__skeleton-game-card {
  /* Approximates the game-card height: handle + 2-line team
     block + 3-line slot block + Unlink chip = ~150px. */
  height: 150px;
  border-radius: 8px;
}

/* ── Right column placeholders ── */
.scheduler__grid-shell--skeleton {
  /* No sticky-stack offset on the skeleton — its date strip /
     thead are static placeholders that don't need to chain-stick
     because they're not paired with a separate scrolling content
     area. */
}
.scheduler__skeleton-park-head {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 14px;
  background: var(--surface-muted, #f4f7fb);
  border-bottom: 1px solid var(--border-divider);
}
html.dark-mode .scheduler__skeleton-park-head {
  background: #131c2e;
}
.scheduler__skeleton-park-pill {
  width: 100%;
  max-width: 360px;
  height: 38px;
  border-radius: 8px;
}
.scheduler__skeleton-date-strip {
  display: grid;
  grid-template-columns: 30px 1fr 30px;
  gap: 6px;
  align-items: center;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-divider);
}
.scheduler__skeleton-date-arrow {
  width: 30px;
  height: 30px;
  border-radius: 999px;
}
.scheduler__skeleton-date-list {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(56px, 1fr);
  gap: 6px;
}
.scheduler__skeleton-date-cell {
  /* Matches the height of a real day cell — weekday + day + month
     stacked with 4px vertical padding. */
  height: 44px;
  border-radius: 6px;
}
.scheduler__skeleton-grid-table {
  border-top: 1px solid var(--border-divider);
  display: flex;
  flex-direction: column;
}
.scheduler__skeleton-grid-row {
  display: grid;
  /* Same shape as the real `<table>`: a fixed Time column + 6
     equal-width field columns. Picking 6 here (not the real
     park's 8) because the skeleton doesn't yet know how many
     fields the chosen park has — 6 is a reasonable preview. */
  grid-template-columns: 120px repeat(6, minmax(0, 1fr));
}
.scheduler__skeleton-grid-row--head .scheduler__skeleton-grid-th {
  /* Header row cells are shorter than slot cells. */
  height: 44px;
}
.scheduler__skeleton-grid-th {
  height: 44px;
  border-right: 1px solid var(--border-divider);
  border-bottom: 1px solid var(--border-divider);
  /* `shimmer-block` paints the placeholder fill; the box's own
     `border-radius: 0` keeps the table cells looking like cells
     (not chips). */
  border-radius: 0;
}
.scheduler__skeleton-grid-time,
.scheduler__skeleton-grid-cell {
  height: 92px;
  border-right: 1px solid var(--border-divider);
  border-bottom: 1px solid var(--border-divider);
  border-radius: 0;
}
.scheduler__skeleton-grid-time {
  background: var(--surface-card);
}

.scheduler__error {
  grid-column: 1 / -1;
  margin: 32px 24px;
  padding: 24px 28px;
  border-radius: 10px;
  background: var(--surface-card);
  border: 1px solid var(--border-divider);
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
  text-align: center;
}
.scheduler__error p {
  margin: 0;
  font-size: 14px;
  color: var(--text);
}
.scheduler__retry {
  appearance: none;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.scheduler__retry:hover {
  background: var(--primary-light);
}

/* ─── Mobile ─────────────────────────────────────────────────── */
@media (max-width: 1080px) {
  .scheduler {
    grid-template-columns: 1fr;
  }
}

/* ≤720px — flip the game-cards rail from a vertical stack to a
   horizontal scroller with overlay prev/next arrows. Same pattern
   the dashboard's `MatchGeniPlayingFacility` schedule rail uses.
   The wrap gets horizontal breathing room so the overlay arrows
   sit at the rail's edges without clipping the first / last card.
   `.scheduler__game-card` flips to a fixed-min-width column so it
   stops stretching to the rail's full width. */
/* Threshold raised from 720px → 1024px so the horizontal rail
   layout applies on EVERY viewport below desktop (mobile + tablet
   portrait + tablet landscape). Matches the JS `isCompactViewport`
   matchMedia query above — the CSS layout flip and the JS panel/
   rail switch stay in sync at the same breakpoint. */
@media (max-width: 1024px) {
  /* Collapse / expand toggle hidden below desktop — the source
     column stacks ABOVE the grid shell (single-column vertical
     layout, no side-by-side split) so there's no column boundary
     for the toggle to straddle, and "collapse the source column"
     doesn't have a meaningful action at this width. The button
     has nothing to control and would just float over content. */
  .scheduler__source-toggle {
    display: none;
  }

  /* Release the source column from its sticky-full-viewport mode.
     At desktop the source pins to the viewport so its own scroll
     container can run independent of the page; on mobile the
     layout stacks (source above grid-shell) and the source MUST
     shrink to fit its content — otherwise the section keeps
     stealing `calc(100vh - header)` worth of vertical space and
     pushes the field-grid way below the fold. `position: static`
     drops the sticky behavior, `height: auto` lets the section
     size to its children, and `overflow: visible` undoes the
     `hidden` that was needed only to clip the desktop scroll
     container. */
  .scheduler__source {
    position: static;
    top: auto;
    height: auto;
    overflow: visible;
    border-right: 0;
    border-bottom: 1px solid var(--border-divider);
  }
  /* When the left pane shows its "not configured" overlay, the
     mobile `position: static` above would let the absolute overlay
     escape to `.scheduler` and float over the PARK section stacked
     below. Re-anchor it to THIS section and cap it to the viewport
     so the message centers over the top (divisions) section, with
     no scroll — mirroring the desktop behavior. */
  .scheduler__source--disabled {
    position: relative;
    height: calc(100vh - var(--matchgeni-header-height, 56px));
    overflow: hidden;
  }
  .scheduler__game-rail {
    display: flex;
    flex-direction: row;
    gap: 12px;
    overflow-x: auto;
    scroll-behavior: smooth;
    scrollbar-width: none;
    scroll-snap-type: x mandatory;
    padding-bottom: 4px;
  }
  .scheduler__game-rail::-webkit-scrollbar {
    display: none;
  }
  /* Card sizing mirrors the dashboard's facility-carousel slot —
     each card occupies ~80% of the rail's width and snap-aligns to
     `center`, so when the user steps to a middle card it sits in
     the centre of the scrollport with the previous + next cards
     peeking in from the left + right edges. First/last cards snap
     to `start`/`end` instead, so the rail doesn't leave empty
     space at the extremes when fully scrolled either way. */
  /* Card width — viewport-responsive so the rail shows the right
     "N full + 1 peek" pattern at every screen size:
       - mobile      (≤720px):     ~80% per card → 1 full + 1 small peek
       - tablet (721-840px):       ~46% per card → 2 full + 1 small peek
       - tablet land (841-1023px): ~32% per card → 3 full + 1 small peek
     The card width is set on the BASE rule here (matches mobile)
     and bumped down at each breakpoint via overrides below. `:deep()`
     so the parent's scoped block can still target the card element
     after the card was extracted into its own component. */
  :deep(.scheduler__game-card) {
    flex: 0 0 80%;
    min-width: 0;
    scroll-snap-align: center;
  }
  :deep(.scheduler__game-card:first-child) {
    scroll-snap-align: start;
  }
  :deep(.scheduler__game-card:last-child) {
    scroll-snap-align: end;
  }
  /* Game-grid no longer scrolls vertically when the rail flips
     horizontal — the rail owns the scroll axis now. Drop the
     `flex: 1 1 0` + `overflow-y: auto` so the section sizes to
     the rail height + the static info / pager rows above.
     Lives in the main `≤1024px` block (not the tablet-
     landscape sub-block) so it applies at mobile + tablet
     portrait + tablet landscape — every viewport where the rail
     is the active games layout. Without this rule at the smaller
     tiers, the game-grid kept its desktop `flex: 1 1 0` mode
     which collapsed the rail's rendered height to zero and the
     horizontal cards were invisible. */
  .scheduler__game-grid {
    flex: 0 0 auto;
    overflow-y: visible;
  }
}

/* Tablet portrait — 721-840px gets ~46% cards (2 full + 1 peek).
   `min-width: 720.01px` ensures we don't clobber the mobile 80%
   rule above. */
@media (min-width: 720.01px) and (max-width: 840px) {
  .scheduler__game-rail :deep(.scheduler__game-card) {
    flex: 0 0 46%;
  }
}

/* Below desktop (where the games list becomes the horizontal
   rail), the source-head reflows to a SINGLE-ROW layout:
     [Division dropdown ───────────] [Pool Play] [Brackets]
   Division dropdown takes the remaining space on the left, the
   tabs cluster sits on the right. At desktop the head stacks
   vertically — dropdown on row 1, tabs on row 2 — because the
   source column is too narrow (340px) to fit both inline. The
   horizontal-rail layout uses the full viewport width below
   1024px, so the head has room to inline both. */
@media (max-width: 1024px) {
  .scheduler__source-head {
    flex-direction: row;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
  }
  .scheduler__division-picker {
    /* Grow to fill the row's remaining space while leaving the
       tabs cluster at its natural right-aligned width. `flex: 1
       1 240px` floors the picker at 240px so the dropdown text
       isn't crammed when the row has to wrap to multiple lines
       on narrower tablets. */
    flex: 1 1 240px;
    width: auto;
  }
  .scheduler__tabs-row {
    flex: 0 0 auto;
  }
}

/* Tablet landscape — 841-1024px gets ~32% cards (3 full + 1
   peek). The rail is still horizontal at this width because the
   layout is single-column stacked (matchgeni context).
   (The `.scheduler__game-grid` release rule used to live here
   too; moved into the main `≤1024px` block so it applies at
   ALL sub-tiers, not just tablet landscape.) */
@media (min-width: 840.01px) and (max-width: 1024px) {
  .scheduler__game-rail :deep(.scheduler__game-card) {
    flex: 0 0 32%;
  }
}

/* Overlay prev / next arrows for the mobile horizontal rail.
   Hidden by `v-show="false"` at desktop because the rail isn't
   horizontally overflowing; CSS positioning + styling shared
   across breakpoints so the arrows look identical to the
   dashboard's facility-schedule arrows when they do appear. */
.scheduler__game-rail-arrow {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 30px;
  height: 30px;
  border-radius: 999px;
  border: 1px solid var(--border-divider);
  background: var(--primary-light-3, #e5f1ff);
  color: var(--primary);
  font-size: 16px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 6px rgba(13, 30, 58, 0.10);
  transition: background-color 120ms ease, transform 120ms ease;
  padding: 0;
}
.scheduler__game-rail-arrow:hover {
  background: var(--primary-light-2, #c9e1fc);
  transform: translateY(-50%) scale(1.04);
}
.scheduler__game-rail-arrow:active {
  transform: translateY(-50%) scale(0.96);
}
.scheduler__game-rail-arrow--prev {
  left: -6px;
}
.scheduler__game-rail-arrow--next {
  right: -6px;
}
.scheduler__game-rail-arrow-icon {
  display: inline-block;
  width: 12px;
  height: 12px;
  background-color: currentColor;
  -webkit-mask-image: url('../assets/arrow-right.svg');
  mask-image: url('../assets/arrow-right.svg');
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
}
.scheduler__game-rail-arrow-icon--prev {
  transform: scaleX(-1);
}
html.dark-mode .scheduler__game-rail-arrow {
  background: var(--primary-light-3);
  color: #7fb0e8;
  border-color: var(--primary-light-2);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
}
html.dark-mode .scheduler__game-rail-arrow:hover {
  background: var(--primary-light-2);
}

/* ─── Dark mode ──────────────────────────────────────────────── */
html.dark-mode .scheduler__source,
html.dark-mode .scheduler__grid-shell {
  background: none;
}
/* Dark-mode overrides for the date strip + grid cells / pills
   moved into `MatchGeniFieldGrid.vue` with the rest of those
   styles. */

/* Bracket-preview context — two SEPARATE pills, top-left on the
   canvas (the popup header was removed): division name (+ date
   range inline) and event name. */
/* Plain text (no pill) — `--text` keeps it dark in light mode / light
   in dark mode, and a contrast text-shadow keeps it readable over the
   canvas in both themes. */
.scheduler__bracket-ctx-name {
  max-width: 100%;
  font-size: 16px;
  color: var(--text);
  white-space: nowrap;
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  font-weight: 600;
  /* No `overflow: hidden` here — it clips the text-shadow. A dense,
     spread halo (layered shadows) keeps the text readable over the
     canvas in both themes. */
  text-shadow:
    0 0 4px #fff, 0 0 4px #fff,
    0 0 10px #fff, 0 0 10px #fff,
    0 0 18px #fff,
    0 0 26px rgba(255, 255, 255, 0.95);
}
.scheduler__bracket-ctx-dates {
  font-size: 12px;
  color: var(--secondary);
}
html.dark-mode .scheduler__bracket-ctx-name {
  text-shadow:
    0 0 4px #000, 0 0 4px #000,
    0 0 10px #000, 0 0 10px #000,
    0 0 18px #000,
    0 0 26px rgba(0, 0, 0, 0.95);
}

/* Bracket-preview drawer header — division name + its date range
   inline (smaller), with the bracket format/teams/games subline. */
.scheduler__bracket-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.scheduler__bracket-title strong {
  font-size: 18px;
  color: var(--text);
}
.scheduler__bracket-title-dates {
  font-size: 13px;
  font-weight: 500;
  color: var(--secondary);
}
.scheduler__bracket-title-sub {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--secondary);
}

/* Bracket-preview switch — reuses the left-pane tab pills (Pool Play
   / Brackets style): independent rounded pills in a row, active =
   primary, with their own light/dark handling. Lives in the bracket
   canvas's top-center overlay. */
.scheduler__bracket-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
}
/* Lift the tabs over the canvas — the left-pane tabs sit on a solid
   panel and don't need this. */
.scheduler__bracket-switch-tab {
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.12);
}
</style>
