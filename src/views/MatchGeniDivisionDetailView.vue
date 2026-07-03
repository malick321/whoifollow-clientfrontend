<script setup lang="ts">
// MatchGeniDivisionDetailView
// ---------------------------
// /association/:associationShortName/portal/events/:eventId/matchgeni/division/:divisionId
//
// Two-column division screen, gated by `manage_divisions`:
//   LEFT  — sticky sidebar listing every division of the event
//           (sourced from the §9 Event Resources API, divisions-only).
//   RIGHT — the selected division's detail panel (MatchGeniDivisionDetail).
//
// The `:divisionId` route param drives the selection; switching the
// sidebar pushes a new `:divisionId` so the URL stays shareable. The
// division being viewed is default-selected (falls back to the first
// division when the param doesn't match — e.g. a stale deep link).
//
// Resources `Division` is a slim `{ id, name, dateRange… }` shape; the
// detail panel needs the richer `EventTournament` (team count + phase
// statuses), so each division is adapted with deterministic mock
// statuses until the real division payload carries them.

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import MatchGeniHeader from '../components/MatchGeniHeader.vue'
import MatchGeniDivisionDetail, { type DivisionDetailAction } from '../components/MatchGeniDivisionDetail.vue'
import BracketDivisionSwitcher from '../components/BracketDivisionSwitcher.vue'
import MatchGeniDivisionFormModal, { type DivisionSavedEvent } from '../components/MatchGeniDivisionFormModal.vue'
import MatchGeniManagePoolsModal from '../components/MatchGeniManagePoolsModal.vue'
import { deleteDivision } from '../api/matchGeniDivisions'
import { fetchEventResources } from '../api/events'
import { currentAssociation } from '../constants/associations'
import { canMatchGeniWrite, ensureMatchGeniAccess, matchGeniContext } from '../matchgeni-context'
import type { Division, EventTournament } from '../types'

const route = useRoute()
const router = useRouter()

const associationShortName = computed(() => (route.params.associationShortName as string | undefined) ?? '')
const eventId = computed(() => (route.params.eventId as string | undefined) ?? '')
const divisionId = computed(() => (route.params.divisionId as string | undefined) ?? '')

const loading = ref(true)
const errorMessage = ref<string | null>(null)
const tournaments = ref<EventTournament[]>([])

// Sidebar division search — filters the list (by name) without touching
// the selected division. Mirrors the dashboard division-list search.
const divisionSearch = ref('')
const filteredTournaments = computed(() => {
  const q = divisionSearch.value.trim().toLowerCase()
  if (!q) return tournaments.value
  return tournaments.value.filter((t) => t.tournamentName.toLowerCase().includes(q))
})

// True while the detail pane's bracket canvas is open — the page goes
// full-screen (sidebar hidden, edge-to-edge), like the game scheduler.
const bracketFullscreen = ref(false)

const eventName = computed(() => matchGeniContext.value?.event?.eventName ?? '')
// Event-level seeds for the Add/Edit Division wizard (from the
// `/my-permissions` access payload).
const eventStartDate = computed(() => matchGeniContext.value?.event?.startDate ?? '')
const eventEndDate = computed(() => matchGeniContext.value?.event?.endDate ?? '')
const eventTimeZone = computed(() => matchGeniContext.value?.event?.timeZone ?? null)
const eventSportsTypeId = computed(() => matchGeniContext.value?.event?.sportsTypeId ?? null)
const eventDefaults = computed(() => matchGeniContext.value?.event?.defaults ?? null)

/** The selected division — matched by the route param, falling back to
 *  the first division when the id isn't found. */
const selectedDivision = computed<EventTournament | null>(() =>
  tournaments.value.find((t) => t.id === divisionId.value) ?? tournaments.value[0] ?? null
)

// Deterministic lifecycle states cycled across the divisions so the
// detail panel's workflow button + phase pills show every variant.
// TODO: real phase statuses + team count from the division payload.
const STATES: Pick<EventTournament, 'poolStatus' | 'seedStatus' | 'bracketsStatus' | 'progressPercent'>[] = [
  { poolStatus: 'pending', seedStatus: 'pending', bracketsStatus: 'pending', progressPercent: 0 },
  { poolStatus: 'generated', seedStatus: 'pending', bracketsStatus: 'pending', progressPercent: 15 },
  { poolStatus: 'in_progress', seedStatus: 'pending', bracketsStatus: 'pending', progressPercent: 38 },
  { poolStatus: 'completed', seedStatus: 'pending', bracketsStatus: 'pending', progressPercent: 58 },
  { poolStatus: 'completed', seedStatus: 'generated', bracketsStatus: 'pending', progressPercent: 72 },
  { poolStatus: 'completed', seedStatus: 'generated', bracketsStatus: 'generated', progressPercent: 84 },
  { poolStatus: 'completed', seedStatus: 'locked', bracketsStatus: 'in_progress', progressPercent: 93 },
  { poolStatus: 'completed', seedStatus: 'locked', bracketsStatus: 'completed', progressPercent: 100 }
]

// Fallback date ranges for divisions whose resources payload has no
// `dateRangeLabel` yet (so the sidebar + header still show dates).
const MOCK_DATE_RANGES = [
  'Tue, May 12 – Thu, May 14, 2026',
  'Fri, May 15 – Sun, May 17, 2026'
]

// Spread the few live divisions across lifecycle states so the
// bracket-bearing ones AND a generated-pool one (Regenerate Pool CTA)
// are demonstrable — the raw `idx % STATES.length` only ever hit the
// first four pending-bracket states. Drop when real phase data lands.
// idx0 → generated pool (Regenerate demo); 1–3 → bracket states.
const STATE_PRESENTATION_ORDER = [1, 6, 7, 5]

function divisionToTournament(d: Division, idx: number): EventTournament {
  const state = STATES[STATE_PRESENTATION_ORDER[idx % STATE_PRESENTATION_ORDER.length]]
  return {
    id: d.id,
    guid: d.id,
    tournamentName: d.name,
    dateRangeLabel: d.dateRangeLabel || MOCK_DATE_RANGES[idx % MOCK_DATE_RANGES.length],
    // Demo team counts — varied so the team-pools view shows a small
    // single pool, a mid two-pool division, and a large 51-team
    // division (Pool A 21 + Pool B 30) for multi-column paging.
    // Replace with the real count.
    teamCount: [6, 9, 51, 12][idx % 4],
    poolStatus: state.poolStatus,
    seedStatus: state.seedStatus,
    // Completed divisions get four brackets so the brackets rail +
    // Winners panel demonstrate the multi-bracket carousel; others
    // vary 1–2.
    bracketsCount:
      state.bracketsStatus === 'pending'
        ? 0
        : state.bracketsStatus === 'completed'
          ? 4
          : 1 + (idx % 2),
    bracketsStatus: state.bracketsStatus,
    progressPercent: state.progressPercent
  }
}

// Dedicated demo fixture (the rain/pool scenario): a division of 16 teams
// in 3 pools (A:6, B:6, C:4) feeding 5 brackets whose statuses span the
// full lifecycle, so the Announce-result gating is fully exercised:
//   Gold     completed   → auto podium (read-only)
//   Silver   in_progress → read-only + "Cancel bracket"
//   Bronze   cancelled   → its Pool B teams fall back to a manual Pool B announce
//   Platinum initiated   → read-only "Initiated"
//   Open     pending     → read-only "Not started"
// The detail component keys its 3-pool split + bracket→pool team mapping
// off the distinctive 16-team / 5-bracket shape. Appended after the live
// (resources) divisions so it's always present in dev.
function fixtureTournament(): EventTournament {
  return {
    id: 'fixture-pool-bracket-16',
    guid: 'fixture-pool-bracket-16',
    tournamentName: "Men's 60-Major+ (Pool → Bracket)",
    dateRangeLabel: 'Fri, May 15 – Sun, May 17, 2026',
    teamCount: 16,
    poolStatus: 'completed',
    seedStatus: 'locked',
    bracketsCount: 5,
    bracketsStatus: 'in_progress',
    bracketStatuses: ['completed', 'in_progress', 'cancelled', 'initiated', 'pending'],
    progressPercent: 92
  }
}

async function load() {
  loading.value = true
  errorMessage.value = null
  try {
    const associationId = currentAssociation.value?.id ?? ''
    const [accessOk, resources] = await Promise.all([
      ensureMatchGeniAccess(
        router,
        associationId,
        eventId.value,
        associationShortName.value,
        'manage_divisions',
        'Division Details'
      ),
      // Divisions-only slice of the §9 resources endpoint.
      fetchEventResources(associationId, eventId.value, ['divisions']).catch((err) => {
        if (typeof console !== 'undefined') {
          console.warn('[division-detail] fetchEventResources(divisions) failed.', err)
        }
        return null
      })
    ])
    if (!accessOk) return
    tournaments.value = [
      ...(resources?.divisions ?? []).map(divisionToTournament),
      fixtureTournament()
    ]
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : 'Could not load divisions.'
    tournaments.value = []
  } finally {
    loading.value = false
  }
}

// Bracket-canvas division switcher picked another division (by id) —
// route to it (keeps the canvas open; the detail re-frames).
function onSelectDivisionById(id: string) {
  const t = tournaments.value.find((d) => d.id === id)
  if (t) selectDivision(t)
}

// Navigate to another division (updates the URL; the selection is
// derived from the route param).
function selectDivision(t: EventTournament) {
  if (t.id === divisionId.value) return
  router.push({
    name: 'matchgeni-division-detail',
    params: {
      associationShortName: associationShortName.value,
      eventId: eventId.value,
      divisionId: t.id
    }
  })
}

// ── Toast (stubbed division actions) ─────────────────────────────
const toastMessage = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null
const ACTION_LABELS: Record<DivisionDetailAction, string> = {
  'edit-division': 'Edit Division',
  'add-bracket': 'Add Bracket',
  'edit-bracket': 'Edit Bracket',
  'edit-matchup': 'Edit Matchup',
  'game-notes': 'Game Notes',
  'assign-umpires': 'Assign Umpires',
  'regenerate-pool': 'Regenerate Pool Play',
  'manage-team-pools': 'Manage Team Pools',
  'notify-teams': 'Notify Teams',
  'attach-lifebook': 'Attach Lifebook',
  'replace-lifebook': 'Replace Lifebook',
  'detach-lifebook': 'Detach Lifebook',
  'generate-pool': 'Generate Pool Play',
  'generate-seed': 'Generate Seed',
  'initiate-bracket': 'Initiate Bracket',
  'undo-initiate': 'Undo Initiate'
}
function showToast(message: string) {
  toastMessage.value = message
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastMessage.value = '' }, 4000)
}
function onAction(action: DivisionDetailAction) {
  // Edit Division opens the add/edit wizard (edit mode); Manage Team
  // Pools opens the drag-and-drop pool builder. Everything else toasts.
  if (action === 'edit-division') {
    openDivisionForm(selectedDivision.value)
    return
  }
  if (action === 'manage-team-pools') {
    if (selectedDivision.value) poolsModalOpen.value = true
    return
  }
  showToast(`${ACTION_LABELS[action]} — coming soon.`)
}

// ── Manage Team Pools modal ──────────────────────────────────────
const poolsModalOpen = ref(false)
function onPoolsSaved() {
  showToast('Team pools saved.')
}

const canManageDivisions = computed(() => canMatchGeniWrite('manage_divisions'))

// ── Add / Edit Division wizard ───────────────────────────────────
const divisionFormOpen = ref(false)
// The division being edited (null → Add flow).
const editingDivision = ref<EventTournament | null>(null)
const editingDivisionId = computed(() => editingDivision.value?.id ?? null)
function openDivisionForm(division: EventTournament | null) {
  editingDivision.value = division
  divisionFormOpen.value = true
}
function onAddDivision() {
  openDivisionForm(null)
}
// Association numeric id for the create/update path.
const associationIdValue = computed(() => currentAssociation.value?.id ?? '')
function onDivisionSaved(payload: DivisionSavedEvent) {
  divisionFormOpen.value = false
  showToast(`Division "${payload.name}" ${payload.isEdit ? 'updated' : 'created'}.`)
  // Refresh the division list so the new/edited division reflects.
  void load()
}
// Delete confirmation — a centered popup (the shared
// `.association-confirm-panel` used by the Users / Officials surfaces),
// NOT a browser `window.confirm`. The form modal's "Delete Division"
// emits `delete`; we stash the target and open the popup. Confirming
// performs the API delete; cancelling just dismisses the popup and
// leaves the edit form open.
const confirmDeleteDivision = ref<{ id: string; label: string } | null>(null)
const deletingDivision = ref(false)

function onDivisionDelete(divisionId: string) {
  const target = tournaments.value.find((t) => t.id === divisionId) ?? editingDivision.value
  confirmDeleteDivision.value = {
    id: divisionId,
    label: target?.tournamentName ?? 'this division'
  }
}

function cancelDeleteDivision() {
  if (deletingDivision.value) return
  confirmDeleteDivision.value = null
}

function onDeleteBackdrop(event: MouseEvent) {
  if (event.target === event.currentTarget) cancelDeleteDivision()
}

async function performDeleteDivision() {
  const pending = confirmDeleteDivision.value
  if (!pending) return
  const associationId = associationIdValue.value
  if (!associationId || !eventId.value) return
  deletingDivision.value = true
  try {
    await deleteDivision(associationId, eventId.value, pending.id)
    confirmDeleteDivision.value = null
    divisionFormOpen.value = false
    showToast(`Division "${pending.label}" deleted.`)
    await load()
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Could not delete the division.')
  } finally {
    deletingDivision.value = false
  }
}

// ── Per-row settings menu (sidebar) ──────────────────────────────
// Each division row has a settings button opening a menu with Edit
// Division + the Lifebook options for THAT division. Lifebook
// attachment is mocked per division (even ids start attached) —
// mirrors the detail panel.
const rowMenuId = ref<string | null>(null)
function toggleRowMenu(id: string) {
  rowMenuId.value = rowMenuId.value === id ? null : id
}
function closeRowMenu() {
  rowMenuId.value = null
}
function isLifebookAttached(t: EventTournament): boolean {
  const n = Number(t.id)
  return Number.isFinite(n) && n % 2 === 0
}
function lifebookNameFor(_t: EventTournament): string {
  return 'WIF Lifebook 2026'
}
function onRowAction(action: DivisionDetailAction, t: EventTournament) {
  closeRowMenu()
  if (action === 'edit-division') {
    openDivisionForm(t)
    return
  }
  showToast(`${ACTION_LABELS[action]}: ${t.tournamentName} — coming soon.`)
}
function onDocumentMouseDown(event: MouseEvent) {
  if (!rowMenuId.value) return
  const target = event.target as HTMLElement | null
  if (target && !target.closest('.mg-division-page__row-menu-root')) closeRowMenu()
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && rowMenuId.value) {
    event.stopPropagation()
    closeRowMenu()
  }
}

// Drop-shadow on the (sticky) division tab strip once the page scrolls —
// only visually relevant in the ≤1024 horizontal-tab layout, but the
// flag is cheap to keep in sync everywhere.
const sidebarStuck = ref(false)
function onWindowScroll() {
  sidebarStuck.value = (window.scrollY || document.documentElement.scrollTop || 0) > 4
}

// In pill mode (≤1024) the division pills are a sticky band at the top.
// Publish their height as `--mg-div-pills-h` so the detail pane's own
// sticky tabs (Pool/Bracket + date row) pin BELOW the pills instead of
// under them. `0px` outside pill mode (the desktop sidebar isn't a top
// band).
const listRef = ref<HTMLElement | null>(null)
const pillsHeightVar = ref('0px')
function updatePillsHeight() {
  const pill = typeof window !== 'undefined' && window.innerWidth <= 1024
  pillsHeightVar.value = pill && listRef.value && !bracketFullscreen.value
    ? `${Math.round(listRef.value.offsetHeight)}px`
    : '0px'
}

// ── Scroll-nav (up/down on desktop, hidden scrollbar) — same affordance
//    as the public divisions list. Arrows show only when the list
//    overflows in that direction; selecting centres the active row. ──
const canUp = ref(false)
const canDown = ref(false)
function updateArrows() {
  const el = listRef.value
  if (!el) { canUp.value = false; canDown.value = false; return }
  // Only relevant in the vertical (desktop sidebar) layout; in the ≤1024
  // horizontal pill rail the arrows are hidden via CSS.
  canUp.value = el.scrollTop > 2
  canDown.value = el.scrollTop < el.scrollHeight - el.clientHeight - 2
}
function stepList(dir: 1 | -1) {
  const el = listRef.value
  if (!el) return
  el.scrollBy({ top: dir * el.clientHeight * 0.85, behavior: 'smooth' })
}

/** Centre the active division in the list — axis-aware: vertical in the
 *  desktop sidebar, horizontal in the ≤1024 pill rail. Keeps the selected
 *  division visible after a click without jumping the page. */
function ensureActivePillVisible(smooth = false) {
  const el = listRef.value
  const item = el?.querySelector<HTMLElement>('.mg-division-page__item--active')
  if (!el || !item) { updateArrows(); return }
  const lr = el.getBoundingClientRect()
  const ir = item.getBoundingClientRect()
  const behavior: ScrollBehavior = smooth ? 'smooth' : 'auto'
  if (el.scrollWidth > el.clientWidth + 4) {
    const delta = (ir.left - lr.left) - (el.clientWidth - item.clientWidth) / 2
    el.scrollTo({ left: el.scrollLeft + delta, behavior })
  } else {
    const delta = (ir.top - lr.top) - (el.clientHeight - item.clientHeight) / 2
    el.scrollTo({ top: el.scrollTop + delta, behavior })
  }
  void nextTick(updateArrows)
}

let listRo: ResizeObserver | null = null
function onListResize() { updatePillsHeight(); updateArrows() }
onMounted(() => {
  document.addEventListener('mousedown', onDocumentMouseDown)
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('scroll', onWindowScroll, { passive: true })
  window.addEventListener('resize', onListResize)
  onWindowScroll()
  void nextTick(() => { updatePillsHeight(); ensureActivePillVisible(); updateArrows() })
  if (typeof ResizeObserver !== 'undefined' && listRef.value) {
    listRo = new ResizeObserver(updateArrows)
    listRo.observe(listRef.value)
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentMouseDown)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('scroll', onWindowScroll)
  window.removeEventListener('resize', onListResize)
  listRo?.disconnect()
})
// Recompute the pill-strip height when the division set or bracket
// full-screen state changes (the band appears / disappears / re-wraps).
watch([tournaments, bracketFullscreen], () => void nextTick(updatePillsHeight))

load()
watch([associationShortName, eventId], load)
// Close any open row menu + centre the newly-selected pill when the
// route (selected division) changes.
watch(divisionId, () => {
  closeRowMenu()
  // Smooth-scroll the newly-selected division to centre.
  void nextTick(() => ensureActivePillVisible(true))
})
// After the division list (re)loads, centre the active pill.
watch(tournaments, () => void nextTick(ensureActivePillVisible))
</script>

<template>
  <main class="matchgeni mg-division-page" :style="{ '--mg-div-pills-h': pillsHeightVar }">
    <MatchGeniHeader
      variant="sub-page"
      :title="selectedDivision?.tournamentName || 'Divisions'"
      :subtitle="bracketFullscreen ? '' : eventName"
      :event-id="eventId"
      :loading="loading"
    >
      <!-- When the bracket canvas is fullscreen the sidebar division list
           is hidden, so the division switcher moves into the header here
           (replacing the static title) — no duplicate switcher on the
           canvas. -->
      <template v-if="bracketFullscreen && selectedDivision" #title-main>
        <BracketDivisionSwitcher
          variant="header"
          :divisions="tournaments.map((d) => ({ id: d.id, name: d.tournamentName, dateLabel: d.dateRangeLabel }))"
          :selected-id="selectedDivision.id"
          @select="onSelectDivisionById"
        />
      </template>
    </MatchGeniHeader>

    <!-- Loading — full-page skeleton mirroring the real layout (sidebar
         division list + hero + 60/40 stats-pools / games split) so the
         shimmer foreshadows where content will land. -->
    <div v-if="loading" class="matchgeni__content" aria-busy="true">
      <div class="mg-division-page__layout">
        <aside class="mg-division-page__sidebar">
          <header class="mg-division-page__sidebar-head">
            <span class="shimmer-block mg-division-page__sk-line mg-division-page__sk-line--head"></span>
          </header>
          <ul class="mg-division-page__list">
            <li v-for="n in 6" :key="n" class="mg-division-page__sk-item">
              <span class="shimmer-block mg-division-page__sk-line mg-division-page__sk-line--lg"></span>
              <span class="shimmer-block mg-division-page__sk-line mg-division-page__sk-line--sm"></span>
            </li>
          </ul>
        </aside>

        <div class="mg-division-page__main">
          <div class="mg-division-page__sk-detail">
            <!-- Hero -->
            <div class="mg-division-page__sk-hero">
              <div class="mg-division-page__sk-stack">
                <span class="shimmer-block mg-division-page__sk-line mg-division-page__sk-title"></span>
                <span class="shimmer-block mg-division-page__sk-line mg-division-page__sk-line--sm"></span>
              </div>
              <div class="mg-division-page__sk-hero-actions">
                <span class="shimmer-block mg-division-page__sk-btn"></span>
                <span class="shimmer-block mg-division-page__sk-btn mg-division-page__sk-btn--icon"></span>
              </div>
            </div>

            <!-- 60 / 40 split -->
            <div class="mg-division-page__sk-split">
              <!-- Left: stats card + pools card -->
              <div class="mg-division-page__sk-col">
                <div class="mg-division-page__sk-card">
                  <div class="mg-division-page__sk-stats">
                    <span class="shimmer-block mg-division-page__sk-stat"></span>
                    <span class="shimmer-block mg-division-page__sk-stat"></span>
                    <span class="shimmer-block mg-division-page__sk-stat"></span>
                  </div>
                  <span class="shimmer-block mg-division-page__sk-bar"></span>
                </div>
                <div class="mg-division-page__sk-card">
                  <span class="shimmer-block mg-division-page__sk-line mg-division-page__sk-line--md"></span>
                  <div v-for="n in 4" :key="n" class="mg-division-page__sk-standing">
                    <span class="shimmer-circle mg-division-page__sk-avatar"></span>
                    <div class="mg-division-page__sk-stack">
                      <span class="shimmer-block mg-division-page__sk-line mg-division-page__sk-line--lg"></span>
                      <span class="shimmer-block mg-division-page__sk-line mg-division-page__sk-line--sm"></span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Right: tabs + timeline -->
              <div class="mg-division-page__sk-col">
                <div class="mg-division-page__sk-tabs">
                  <span class="shimmer-block mg-division-page__sk-pill"></span>
                  <span class="shimmer-block mg-division-page__sk-pill"></span>
                </div>
                <div v-for="n in 4" :key="n" class="mg-division-page__sk-game">
                  <span class="shimmer-block mg-division-page__sk-slot"></span>
                  <div class="mg-division-page__sk-gamecard">
                    <span class="shimmer-block mg-division-page__sk-line mg-division-page__sk-line--md"></span>
                    <span class="shimmer-block mg-division-page__sk-line mg-division-page__sk-line--lg"></span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="errorMessage" class="matchgeni__content">
      <div class="mg-division-page__error">
        <p>{{ errorMessage }}</p>
        <button type="button" class="mg-division-page__retry" @click="load">Retry</button>
      </div>
    </div>

    <div v-else class="matchgeni__content">
      <div
        class="mg-division-page__layout"
        :class="{ 'mg-division-page__layout--bracket': bracketFullscreen }"
      >
        <!-- Sticky sidebar — all event divisions. Hidden while a bracket
             canvas is open so it covers the full content (full-screen). -->
        <aside
          v-show="!bracketFullscreen"
          class="mg-division-page__sidebar"
          :class="{ 'mg-division-page__sidebar--stuck': sidebarStuck }"
        >
          <header class="mg-division-page__sidebar-head">
            <span class="mg-division-page__sidebar-count">
              <strong>{{ tournaments.length }}</strong>
              <span>{{ tournaments.length === 1 ? 'division' : 'divisions' }}</span>
            </span>
            <button
              v-if="canManageDivisions"
              type="button"
              class="matchgeni-tool-btn matchgeni-tool-btn--ghost"
              @click="onAddDivision"
            >
              <span class="mg-division-page__add-division-icon" aria-hidden="true"></span>
              <span>New</span>
            </button>
          </header>
          <!-- Sticky search — fixed above the (scrolling) list so it stays
               visible while the divisions scroll beneath it. -->
          <div v-if="tournaments.length" class="mg-division-page__search">
            <label class="mg-division-page__search-field">
              <AppIcon name="search" :size="14" />
              <input
                v-model="divisionSearch"
                type="search"
                placeholder="Search divisions"
                class="mg-division-page__search-input"
                aria-label="Search divisions"
              />
            </label>
          </div>
          <!-- Up nav — appears only when there's content scrolled above. -->
          <button
            v-show="canUp"
            type="button"
            class="mg-division-page__nav mg-division-page__nav--up"
            aria-label="Scroll up"
            @click="stepList(-1)"
          >
            <span class="mg-division-page__nav-chev mg-division-page__nav-chev--up" aria-hidden="true"></span>
          </button>
          <ul
            v-if="filteredTournaments.length"
            ref="listRef"
            class="mg-division-page__list"
            @scroll="updateArrows"
          >
            <li
              v-for="t in filteredTournaments"
              :key="t.id"
              class="mg-division-page__item"
              :class="{ 'mg-division-page__item--active': t.id === selectedDivision?.id }"
              role="button"
              tabindex="0"
              @click="selectDivision(t)"
              @keydown.enter="selectDivision(t)"
              @keydown.space.prevent="selectDivision(t)"
            >
              <!-- Same identity stack as the dashboard division list:
                   date (eyebrow) → name. Team count is intentionally
                   omitted — the §9 resources division object doesn't
                   carry it. -->
              <div class="mg-division-page__item-id">
                <span v-if="t.dateRangeLabel" class="mg-division-page__item-dates">{{ t.dateRangeLabel }}</span>
                <strong class="mg-division-page__item-name">{{ t.tournamentName }}</strong>
              </div>

              <!-- Per-row settings menu — Edit Division + Lifebook.
                   Hidden until the row is active / hovered / menu open. -->
              <div
                class="mg-division-page__row-menu-root"
                :class="{ 'mg-division-page__row-menu-root--open': rowMenuId === t.id }"
              >
                <button
                  type="button"
                  class="mg-division-page__row-settings"
                  aria-label="Division options"
                  :aria-expanded="rowMenuId === t.id ? 'true' : 'false'"
                  aria-haspopup="menu"
                  @click.stop="toggleRowMenu(t.id)"
                >
                  <span class="mg-division-page__settings-icon" aria-hidden="true"></span>
                </button>
                <div
                  v-if="rowMenuId === t.id"
                  class="association-users__row-menu mg-division-page__row-menu"
                  role="menu"
                  @click.stop
                >
                  <button type="button" class="association-users__row-menu-item" role="menuitem" @click="onRowAction('edit-division', t)">Edit Division</button>
                  <div class="association-users__row-menu-divider" role="separator"></div>
                  <button
                    v-if="!isLifebookAttached(t)"
                    type="button"
                    class="association-users__row-menu-item"
                    role="menuitem"
                    @click="onRowAction('attach-lifebook', t)"
                  >Attach Lifebook</button>
                  <template v-else>
                    <div class="mg-division-page__lifebook-current">
                      <span class="mg-division-page__lifebook-eyebrow">Current Lifebook</span>
                      <span class="mg-division-page__lifebook-name">{{ lifebookNameFor(t) }}</span>
                    </div>
                    <button type="button" class="association-users__row-menu-item" role="menuitem" @click="onRowAction('replace-lifebook', t)">Replace Lifebook</button>
                    <button type="button" class="association-users__row-menu-item association-users__row-menu-item--danger" role="menuitem" @click="onRowAction('detach-lifebook', t)">Detach Lifebook</button>
                  </template>
                </div>
              </div>
            </li>
          </ul>
          <p v-else class="mg-division-page__sidebar-empty">
            {{ tournaments.length ? `No divisions match “${divisionSearch.trim()}”.` : 'No divisions yet.' }}
          </p>
          <!-- Down nav — appears only when there's more content below. -->
          <button
            v-show="canDown"
            type="button"
            class="mg-division-page__nav mg-division-page__nav--down"
            aria-label="Scroll down"
            @click="stepList(1)"
          >
            <span class="mg-division-page__nav-chev mg-division-page__nav-chev--down" aria-hidden="true"></span>
          </button>
        </aside>

        <!-- Right pane — selected division detail. -->
        <div
          class="mg-division-page__main"
          :class="{ 'mg-division-page__main--bracket': bracketFullscreen }"
        >
          <MatchGeniDivisionDetail
            v-if="selectedDivision"
            :division="selectedDivision"
            :divisions="tournaments"
            :event-name="eventName"
            @action="onAction"
            @bracket-open="bracketFullscreen = $event"
            @select-division="onSelectDivisionById"
          />
          <div v-else class="mg-division-page__empty">
            <h3>No divisions</h3>
            <p>This event doesn't have any divisions yet.</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Add / Edit Division wizard (Division Info → Seed Criteria →
         Field Config; no Teams step — pool/team assignment lives behind
         "Manage Team Pools"). -->
    <MatchGeniDivisionFormModal
      v-model="divisionFormOpen"
      :association-id="associationIdValue"
      :event-id="eventId"
      :division-id="editingDivisionId"
      :division="editingDivision"
      :event-name="eventName"
      :event-start-date="eventStartDate"
      :event-end-date="eventEndDate"
      :event-time-zone="eventTimeZone"
      :sports-type-id="eventSportsTypeId"
      :defaults="eventDefaults"
      @saved="onDivisionSaved"
      @delete="onDivisionDelete"
    />

    <!-- Manage Team Pools — drag/drop pool builder for the selected
         division (Available column + horizontal pools). -->
    <MatchGeniManagePoolsModal
      v-if="selectedDivision"
      v-model="poolsModalOpen"
      :association-id="associationIdValue"
      :event-id="eventId"
      :division-id="selectedDivision.id"
      :division-name="selectedDivision.tournamentName"
      :continuous-serial="selectedDivision.continuousTeamSrNo ?? true"
      @saved="onPoolsSaved"
    />

    <!-- Delete-division confirmation — shared centered popup
         (`.association-confirm-panel`) used by the Users / Officials
         surfaces, replacing the browser `window.confirm`. Renders above
         the open edit wizard (z-index 200 vs the modal's 80). -->
    <Transition name="slide-modal-backdrop">
      <div
        v-if="confirmDeleteDivision"
        class="association-switcher-backdrop"
        role="presentation"
        @click="onDeleteBackdrop"
      >
        <div
          class="association-switcher-panel association-confirm-panel"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="delete-division-title"
        >
          <header class="association-switcher-panel__header">
            <h2 id="delete-division-title" class="association-switcher-panel__title">Delete Division</h2>
            <button
              type="button"
              class="association-switcher-panel__close"
              aria-label="Close"
              @click="cancelDeleteDivision"
            >
              <AppIcon name="close" :size="16" />
            </button>
          </header>
          <div class="association-confirm-panel__body">
            <p class="association-confirm-panel__copy">
              Delete <strong>{{ confirmDeleteDivision.label }}</strong>?
              This removes the division and its pools, seeds, and brackets, and can't be undone.
            </p>
          </div>
          <footer class="association-confirm-panel__footer">
            <button class="secondary-button" type="button" :disabled="deletingDivision" @click="cancelDeleteDivision">Cancel</button>
            <button class="danger-light-button" type="button" :disabled="deletingDivision" @click="performDeleteDivision">
              {{ deletingDivision ? 'Deleting…' : 'Yes, delete' }}
            </button>
          </footer>
        </div>
      </div>
    </Transition>

    <div
      v-if="toastMessage"
      class="mg-division-page__toast"
      role="status"
      aria-live="polite"
    >{{ toastMessage }}</div>
  </main>
</template>

<style scoped>
.matchgeni {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
/* No page padding on the content wrapper — the sidebar hugs the
   left/top/bottom edges (scheduler-style); the right pane carries its
   own padding (see `__main`). Loading / error states bring their own. */
.matchgeni__content {
  padding: 0;
}

.mg-division-page__layout {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: 0;
  align-items: start;
}
/* Bracket full-screen — sidebar hidden, single column so the detail
   pane (hosting the bracket canvas) spans the whole content area. */
.mg-division-page__layout--bracket {
  grid-template-columns: minmax(0, 1fr);
}
/* Drop the pane padding so the canvas goes edge-to-edge (the stage
   sizes itself to the full viewport height below the page header).
   Descendant selector (0,2,0) so it beats the later base
   `.mg-division-page__main` padding rule regardless of source order. */
.mg-division-page__layout--bracket .mg-division-page__main {
  padding: 0;
}

/* Flush sticky sidebar — hugs the viewport edge with no top / left /
   bottom gaps (same treatment as the game scheduler's source column).
   Only the right border separates it from the detail pane; it pins
   under the matchgeni header and fills the viewport height, scrolling
   internally when the division list is long. */
.mg-division-page__sidebar {
  position: sticky;
  top: var(--matchgeni-header-height, 56px);
  height: calc(100vh - var(--matchgeni-header-height, 56px));
  /* Flex column so the header stays fixed and ONLY the list below
     scrolls — the scrollbar lives inside the list body, not alongside
     the header. */
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: transparent;
  border: 0;
  border-right: 1px solid var(--border-divider);
  border-radius: 0;
}
.mg-division-page__sidebar-head {
  /* Fixed header — never scrolls (the list below is the scroll area). */
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-divider);
  font-size: 14px;
  color: var(--secondary);
}
.mg-division-page__sidebar-count {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}
.mg-division-page__sidebar-head strong {
  font-size: 16px;
  color: var(--text);
}
/* Add Division — quiet bordered action on the right of the header. */
/* Add Division uses the shared `.matchgeni-tool-btn--ghost` (same as the
   dashboard Game Scheduler button); only the masked icon is local. */
.mg-division-page__add-division-icon {
  width: 16px;
  height: 16px;
  background-color: currentColor;
  mask: url('../assets/add.svg') center / contain no-repeat;
  -webkit-mask: url('../assets/add.svg') center / contain no-repeat;
}
/* Search row — a fixed band between the head and the scrolling list, so
   it stays put (effectively sticky) while the divisions scroll beneath. */
.mg-division-page__search {
  flex: 0 0 auto;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-divider);
}
/* Search pill — matches the dashboard division-list search affordance. */
.mg-division-page__search-field {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  height: 36px;
  border-radius: 5px;
  background: var(--white);
  border: 1px solid var(--border-divider);
  color: var(--secondary);
}
html.dark-mode .mg-division-page__search-field {
  background: rgba(255, 255, 255, 0.04);
}
.mg-division-page__search-input {
  flex: 1 1 auto;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  font: inherit;
  color: var(--text);
}
.mg-division-page__list {
  list-style: none;
  margin: 0;
  padding: 0;
  /* The sole scroll area of the sidebar — fills the space under the
     fixed header. Scrollbar hidden; the up/down nav buttons page through
     instead (same affordance as the public divisions list). */
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: none;
}
.mg-division-page__list::-webkit-scrollbar { display: none; }
/* Up / down nav — thin full-width bars with a theme arrow, shown only
   when the list overflows in that direction (vertical sidebar only;
   hidden in the ≤1024 pill rail). */
.mg-division-page__nav {
  flex: 0 0 auto;
  appearance: none;
  border: none;
  width: 100%;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  background: var(--surface-raised, #f4f8fd);
  color: var(--secondary);
  transition: background-color 120ms ease, color 120ms ease;
}
.mg-division-page__nav:hover { background: var(--primary-light-3, #e5f1ff); color: var(--primary); }
.mg-division-page__nav--up { border-bottom: 1px solid var(--border-divider); }
.mg-division-page__nav--down { border-top: 1px solid var(--border-divider); }
.mg-division-page__nav-chev {
  width: 15px;
  height: 15px;
  display: block;
  background-color: currentColor;
  -webkit-mask: url('../assets/arrow-left.svg') center / contain no-repeat;
  mask: url('../assets/arrow-left.svg') center / contain no-repeat;
}
.mg-division-page__nav-chev--up { transform: rotate(90deg); }
.mg-division-page__nav-chev--down { transform: rotate(-90deg); }
.mg-division-page__item {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-divider);
  cursor: pointer;
  border-right: 4px solid transparent;
  transition: background-color 120ms ease;
}
/* Name + dates stack — the left side of the row; the settings
   button sits on the right. min-width:0 lets long names ellipsize
   instead of pushing the button off the row. */
.mg-division-page__item-id {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.mg-division-page__item:first-child {
  border-top: none;
}
.mg-division-page__item:hover {
  background: rgba(45, 140, 240, 0.04);
}
html.dark-mode .mg-division-page__item:hover {
  background: rgba(45, 140, 240, 0.08);
}
.mg-division-page__item--active {
  background: var(--primary-light-3);
  border-right-color: var(--primary);
}
.mg-division-page__item--active:hover {
  background: var(--primary-light-3);
}
html.dark-mode .mg-division-page__item--active {
  background: rgba(45, 140, 240, 0.16);
}
/* Identity stack mirrors the dashboard division row: date eyebrow,
   bold name, team count. */
.mg-division-page__item-dates {
  font-size: 12px;
  color: var(--text);
}
html.dark-mode .mg-division-page__item-dates {
  color: var(--secondary);
}
.mg-division-page__item-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

/* Per-row settings button + its dropdown. The root is the
   positioning context for the absolutely-placed menu. */
.mg-division-page__row-menu-root {
  position: relative;
  flex: 0 0 auto;
  /* Hidden by default — revealed on the active row, on hover, or while
     its menu is open. `visibility` (not display) keeps the row height
     stable so nothing shifts on hover. */
  visibility: hidden;
  opacity: 0;
  transition: opacity 120ms ease;
}
/* Settings icon shows ONLY on the active row, on hover, or while its
   menu is open — on every screen size. (No `@media (hover: none)`
   always-visible override: on touch, tapping a row selects it → it
   becomes `--active` and the icon appears, keeping the selected-only
   behavior consistent everywhere.) */
.mg-division-page__item:hover .mg-division-page__row-menu-root,
.mg-division-page__item--active .mg-division-page__row-menu-root,
.mg-division-page__row-menu-root--open {
  visibility: visible;
  opacity: 1;
}
/* Round icon-only button — matches the design library's quiet
   round action buttons (border, secondary tint, subtle hover). */
.mg-division-page__row-settings {
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
.mg-division-page__row-settings:hover {
  background: rgba(45, 140, 240, 0.08);
  color: var(--text);
}
html.dark-mode .mg-division-page__row-settings:hover {
  background: rgba(45, 140, 240, 0.16);
}
/* Line-icon glyph — masked so it inherits the button's color
   (inline mask-image doesn't resolve Vite URLs reliably). */
.mg-division-page__settings-icon {
  width: 16px;
  height: 16px;
  background-color: currentColor;
  mask: url('../assets/settings.svg') center / contain no-repeat;
  -webkit-mask: url('../assets/settings.svg') center / contain no-repeat;
}
.mg-division-page__row-menu {
  min-width: 180px;
}
/* Lifebook "currently attached" block inside the row menu —
   mirrors the detail component's lifebook-current treatment. */
.mg-division-page__lifebook-current {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
}
.mg-division-page__lifebook-eyebrow {
  font-size: 11px;
  color: var(--secondary);
}
.mg-division-page__lifebook-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.mg-division-page__sidebar-empty {
  margin: 0;
  padding: 24px 16px;
  text-align: center;
  font-size: 13px;
  color: var(--secondary);
}

.mg-division-page__main {
  min-width: 0;
  /* The content wrapper has no page padding now (the sidebar is
     flush), so the detail pane carries its own. */
  padding: 20px 24px;
}
.mg-division-page__empty {
  padding: 60px 24px;
  text-align: center;
  color: var(--secondary);
  background: var(--white);
  border: 1px solid var(--border-divider);
  border-radius: 8px;
}
html.dark-mode .mg-division-page__empty {
  background: var(--surface-card);
}

/* Loading + error. */
/* ── Loading skeleton ── */
/* Generic shimmer line — sizes via modifiers below. */
.mg-division-page__sk-line {
  display: block;
  height: 12px;
  border-radius: 6px;
}
.mg-division-page__sk-line--head { width: 84px; height: 16px; }
.mg-division-page__sk-line--lg { width: 70%; height: 14px; }
.mg-division-page__sk-line--md { width: 50%; height: 12px; }
.mg-division-page__sk-line--sm { width: 40%; height: 10px; }
.mg-division-page__sk-title { width: 180px; height: 20px; }

/* Sidebar list rows — match the real `.mg-division-page__item` padding
   + divider, without the interactive cursor/hover. */
.mg-division-page__sk-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
  border-top: 1px solid var(--border-divider);
}
.mg-division-page__sk-item:first-child { border-top: none; }

.mg-division-page__sk-detail {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
/* Hero bar. */
.mg-division-page__sk-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
  background: var(--white);
  border: 1px solid var(--border-divider);
  border-radius: 8px;
}
html.dark-mode .mg-division-page__sk-hero { background: var(--surface-card); }
.mg-division-page__sk-stack { display: flex; flex-direction: column; gap: 8px; min-width: 0; flex: 1 1 auto; }
.mg-division-page__sk-hero-actions { display: inline-flex; gap: 8px; flex: 0 0 auto; }
.mg-division-page__sk-btn { width: 120px; height: 38px; border-radius: 8px; }
.mg-division-page__sk-btn--icon { width: 56px; }

/* 60 / 40 split — same ratio as the loaded view. */
.mg-division-page__sk-split {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  gap: 16px;
  align-items: start;
}
.mg-division-page__sk-col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.mg-division-page__sk-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  background: var(--white);
  border: 1px solid var(--border-divider);
  border-radius: 8px;
}
html.dark-mode .mg-division-page__sk-card { background: var(--surface-card); }
.mg-division-page__sk-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.mg-division-page__sk-stat { height: 48px; border-radius: 8px; }
.mg-division-page__sk-bar { height: 8px; border-radius: 999px; }

/* Standings rows. */
.mg-division-page__sk-standing { display: flex; align-items: center; gap: 12px; }
.mg-division-page__sk-avatar { width: 36px; height: 36px; flex: 0 0 auto; }

/* Games column — tabs + timeline rows. */
.mg-division-page__sk-tabs { display: flex; gap: 8px; }
.mg-division-page__sk-pill { width: 96px; height: 36px; border-radius: 999px; }
.mg-division-page__sk-game { display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: 12px; align-items: start; }
.mg-division-page__sk-slot { height: 44px; border-radius: 8px; }
.mg-division-page__sk-gamecard {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--border-divider);
  border-radius: 8px;
}
.mg-division-page__error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 80px 24px;
  color: var(--secondary);
  text-align: center;
}
.mg-division-page__retry {
  appearance: none;
  border: 1px solid var(--border-divider);
  background: var(--surface-muted, #eef3fb);
  color: var(--text);
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

/* Toast. */
.mg-division-page__toast {
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
html.dark-mode .mg-division-page__toast {
  background: #2a3340;
}

/* Tablet (landscape + portrait) and below — the division sidebar
   collapses to a horizontal, scrollable pill-tab strip across the top
   (same pattern as the association left-nav's small-view transform).
   The head (count + Add Division) sits above the tab row. */
@media (max-width: 1024px) {
  .mg-division-page__layout {
    grid-template-columns: minmax(0, 1fr);
  }
  /* Dissolve the sidebar box so the head (count + Add Division) and the
     pill list become direct rows of the single-column layout. This lets
     ONLY the pill list stick (its containing block is the page), while
     the head scrolls away normally. */
  .mg-division-page__sidebar {
    display: contents;
  }
  /* Pill rail (horizontal) — the up/down scroll-nav buttons don't apply. */
  .mg-division-page__nav { display: none; }
  .mg-division-page__sidebar-head {
    /* Scrolls away with the page (not pinned). */
    background: var(--white);
  }
  html.dark-mode .mg-division-page__sidebar-head {
    background: var(--surface-card);
  }
  /* The pill list is the ONLY sticky band — pinned below the matchgeni
     header; an opaque background lets content scroll under it. It's a
     horizontal scroller (scrollbar hidden; touch/drag still works). */
  .mg-division-page__list {
    position: sticky;
    top: var(--matchgeni-header-height, 56px);
    z-index: 20;
    display: flex;
    flex-direction: row;
    flex-wrap: nowrap;
    gap: 8px;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    padding: 12px 16px;
    background: var(--white);
    border-bottom: 1px solid var(--border-divider);
    transition: box-shadow 140ms ease;
  }
  html.dark-mode .mg-division-page__list {
    background: var(--surface-card);
  }
  /* Drop shadow once the page is scrolled (stuck flag toggled in JS). */
  .mg-division-page__sidebar--stuck .mg-division-page__list {
    box-shadow: 0 6px 12px -6px rgba(36, 60, 91, 0.28);
  }
  html.dark-mode .mg-division-page__sidebar--stuck .mg-division-page__list {
    box-shadow: 0 6px 12px -6px rgba(0, 0, 0, 0.5);
  }
  .mg-division-page__list::-webkit-scrollbar {
    display: none;
  }
  /* Each division becomes a rounded pill tab — drop the row separators,
     the right-edge accent, and the stacked date/team lines (the name is
     the tab label). */
  .mg-division-page__item {
    flex: 0 0 auto;
    padding: 8px 14px;
    border: 1px solid var(--border-divider);
    border-top: 1px solid var(--border-divider);
    border-right: 1px solid var(--border-divider);
    border-radius: 999px;
    background: var(--white);
    white-space: nowrap;
  }
  html.dark-mode .mg-division-page__item {
    background: var(--surface-card);
  }
  .mg-division-page__item:first-child {
    border-top: 1px solid var(--border-divider);
  }
  .mg-division-page__item--active,
  .mg-division-page__item--active:hover {
    background: var(--primary, #2d8cf0);
    border-color: var(--primary, #2d8cf0);
  }
  /* Dark mode — outline style (surface bg + primary border/text) instead
     of the bright primary fill, matching the other tabs' dark treatment. */
  html.dark-mode .mg-division-page__item--active,
  html.dark-mode .mg-division-page__item--active:hover {
    background: var(--surface-card);
    border-color: var(--primary);
  }
  /* Show only the division name as the tab label. */
  .mg-division-page__item-dates {
    display: none;
  }
  .mg-division-page__item-id {
    flex-direction: row;
    gap: 0;
  }
  .mg-division-page__item-name {
    font-weight: 500;
    white-space: nowrap;
  }
  /* Light mode — white label on the bright primary fill. */
  .mg-division-page__item--active .mg-division-page__item-name {
    color: #ffffff;
  }
  /* Dark mode — primary-colored label on the outlined pill. */
  html.dark-mode .mg-division-page__item--active .mg-division-page__item-name {
    color: var(--primary);
  }
  /* The per-row settings menu doesn't fit a pill — hide it here (Edit
     Division stays available from the detail pane). */
  .mg-division-page__row-menu-root {
    display: none;
  }

  /* ── Loading skeleton — match the pill/single-column layout ── */
  /* Sidebar skeleton rows become pill shimmers in the horizontal strip
     (the `display: contents` + horizontal `.mg-division-page__list`
     rules above already apply to the skeleton markup too). */
  .mg-division-page__sk-item {
    flex: 0 0 auto;
    flex-direction: row;
    align-items: center;
    gap: 0;
    padding: 8px 14px;
    border: 1px solid var(--border-divider);
    border-top: 1px solid var(--border-divider);
    border-radius: 999px;
  }
  .mg-division-page__sk-item:first-child {
    border-top: 1px solid var(--border-divider);
  }
  /* One pill-label shimmer per item (drop the stacked second line). */
  .mg-division-page__sk-item .mg-division-page__sk-line--sm {
    display: none;
  }
  .mg-division-page__sk-item .mg-division-page__sk-line--lg {
    width: 64px;
    height: 12px;
  }
  /* Detail skeleton stacks to a single column (no 60/40 split), like the
     real content on small screens. */
  .mg-division-page__sk-split {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 720px) {
  .mg-division-page__main {
    padding: 12px 14px;
  }
  .mg-division-page__layout--bracket .mg-division-page__main {
    padding: 0;
  }
}
</style>
