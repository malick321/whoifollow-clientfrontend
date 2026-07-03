<script setup lang="ts">
// AssociationEventSummaryReportView
// ---------------------------------
// /association/:associationShortName/portal/reports/event-summary.
//
// Prints the per-game scoresheet roll-up for a selected event:
//   division · game · date · time · team1 reg# · team1 name ·
//   team1 score · team1 HR · team2 reg# · team2 name · team2 score ·
//   team2 HR
//
// Sort order matches the backend payload (re-asserted defensively on
// the client):
//   1. Division name (asc)
//   2. Game date + time (asc)
//   3. Game type — pool play first, then bracket
//
// Layout mirrors the rest of the portal: sidebar + sticky toolbar
// (count + event picker) + a virtualized-feeling table that scrolls
// horizontally on narrow viewports without breaking the sticky
// header.

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AssociationSidebar from '../components/AssociationSidebar.vue'
import { fetchEvents } from '../api/events'
import { fetchEventSummaryReport } from '../api/associationReports'
import { currentAssociation } from '../constants/associations'
import { formatCompact } from '../utils/formatNumber'
import { pushToast } from '../toast-center'
import type { EventSummary, EventSummaryReportRow } from '../types'

const route = useRoute()
const associationShortName = computed(
  () => (route.params.associationShortName as string | undefined) ?? ''
)
void associationShortName // route param read for parity with sibling views

// ── Event picker (search-as-you-type combobox) ──────────────────
// The picker is a typeahead against the same listing endpoint the
// Events page uses (`GET /v2/association/events/{associationId}`),
// passing only the `search` filter (no year, no past/upcoming gate).
// Behavior:
//   - Min input length = 3 characters before any request fires
//     (avoids burning calls on partial guesses).
//   - 500ms debounce after the user stops typing (avoids firing on
//     every keystroke during a fast burst).
//   - The mock layer returns upcoming OR past depending on the
//     `pastEvents` flag, so we issue both calls in parallel and
//     merge/dedupe by id — admins commonly run this report on a
//     finished tournament, so past events must be searchable too.
//
// Selection:
//   - Picking a suggestion stores the full `EventSummary` in
//     `selectedEvent` (so we don't have to re-derive name + date
//     range from an id later) and clears the search input.
//   - The chip rendered in place of the input carries the event
//     name + date span; an inline × button clears the selection and
//     re-opens the search input.
const selectedEvent = ref<EventSummary | null>(null)
const selectedEventId = computed(() => selectedEvent.value?.id ?? '')

/** Live input text for the typeahead. Empty when no search is in
 *  flight or an event is already selected. */
const searchInput = ref('')
const suggestionsOpen = ref(false)
const suggestions = ref<EventSummary[]>([])
const suggestionsLoading = ref(false)
/** Tracks whether the most recent search call returned zero rows so
 *  we can surface a friendly "no matches" empty state in the
 *  suggestion panel instead of leaving it blank. */
const suggestionsEmpty = ref(false)

/** Refs for the picker root + input so we can:
 *   - close the suggestion panel on outside-click (root ref),
 *   - re-focus the input when the user clears the chip (input ref). */
const pickerRef = ref<HTMLElement | null>(null)
const searchInputRef = ref<HTMLInputElement | null>(null)

/** Milliseconds of typing-quiet before we actually fire the search
 *  call. Each new keystroke clears the prior timer, so the request
 *  only goes out after the user has been idle this long — bursts
 *  of fast typing produce ONE request total, not one per key. */
const SEARCH_DEBOUNCE_MS = 500
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null
/** Generation counter — increments on every new search request.
 *  Used to discard stale responses: if the user types fast enough
 *  that two requests are in flight, the older one's response is
 *  dropped on the floor when its generation no longer matches. */
let searchGeneration = 0

watch(searchInput, (value) => {
  // Always reset the timer — a new keystroke means the user isn't
  // done typing yet.
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer)
    searchDebounceTimer = null
  }
  const q = value.trim()
  if (q.length < 3) {
    suggestions.value = []
    suggestionsLoading.value = false
    suggestionsEmpty.value = false
    // Keep the panel open while the user is still typing (so the
    // "type at least 3 characters" hint stays visible). Close it
    // only when the field is fully empty so the picker collapses
    // cleanly on blur-then-clear flows.
    suggestionsOpen.value = q.length > 0
    return
  }
  suggestionsOpen.value = true
  // Don't flip `suggestionsLoading` yet — that drives the shimmer
  // and we only want it visible while the BACKEND call is actually
  // in flight, not during the 500ms typing-quiet wait. The shimmer
  // is toggled on inside `searchEvents()` right before the await.
  suggestionsEmpty.value = false
  searchDebounceTimer = setTimeout(() => {
    void searchEvents(q)
  }, SEARCH_DEBOUNCE_MS)
})

async function searchEvents(q: string) {
  const associationId = currentAssociation.value?.id
  if (!associationId) {
    suggestionsLoading.value = false
    return
  }
  const generation = ++searchGeneration
  // Shimmer is bound to this flag — flip it on at the moment the
  // backend round-trip starts so it's only visible while the user
  // is actually waiting on the network, not during the debounce.
  suggestionsLoading.value = true
  try {
    // Reports only make sense for events that have already
    // happened — game-by-game scores aren't generated for upcoming
    // events. Always pass `pastEvents=true` so the search results
    // exclude future/in-flight events the user can't run a report
    // on yet.
    const result = await fetchEvents(associationId, {
      search: q,
      per_page: 25,
      pastEvents: true
    })
    // Drop stale responses — the user typed again before this
    // round-trip finished, so a newer search has already started.
    if (generation !== searchGeneration) return
    const sorted = [...result.data].sort((a, b) =>
      a.eventName.localeCompare(b.eventName)
    )
    suggestions.value = sorted
    suggestionsEmpty.value = sorted.length === 0
  } catch (err) {
    if (generation !== searchGeneration) return
    pushToast({
      tone: 'warning',
      title: 'Could not search events',
      message: err instanceof Error ? err.message : 'Please try again.'
    })
    suggestions.value = []
    suggestionsEmpty.value = true
  } finally {
    if (generation === searchGeneration) {
      suggestionsLoading.value = false
    }
  }
}

/** User clicks a suggestion → commit it as the selected event. */
function pickEvent(evt: EventSummary) {
  selectedEvent.value = evt
  searchInput.value = ''
  suggestions.value = []
  suggestionsOpen.value = false
  suggestionsEmpty.value = false
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer)
    searchDebounceTimer = null
  }
}

/** User clicks the chip's × → drop the selected event and put the
 *  user back into search mode. */
function clearSelectedEvent() {
  selectedEvent.value = null
  rows.value = []
  // Hand focus back to the input so the user can immediately
  // resume typing without a second click.
  void nextTick(() => {
    searchInputRef.value?.focus()
  })
}

/** Close the suggestion panel when the user clicks outside the
 *  picker. Mouse-up handler at the document level so we don't
 *  fight click delegation from inside the panel itself. */
function onDocumentMouseDown(event: MouseEvent) {
  if (!pickerRef.value) return
  const target = event.target as Node | null
  if (target && !pickerRef.value.contains(target)) {
    suggestionsOpen.value = false
  }
}

// ── Report rows ─────────────────────────────────────────────────
const rows = ref<EventSummaryReportRow[]>([])
const rowsLoading = ref(false)

async function loadRows() {
  if (!selectedEventId.value) {
    rows.value = []
    return
  }
  rowsLoading.value = true
  try {
    const associationId = currentAssociation.value?.id || ''
    rows.value = await fetchEventSummaryReport(associationId, selectedEventId.value)
  } catch (err) {
    pushToast({
      tone: 'warning',
      title: 'Could not load report',
      message: err instanceof Error ? err.message : 'Please refresh and try again.'
    })
    rows.value = []
  } finally {
    rowsLoading.value = false
  }
}

watch(selectedEventId, () => {
  void loadRows()
})

// ── Sticky container-header drop-shadow on scroll ───────────────
// The toolbar that pins to the top of the report container needs a
// subtle visual cue when it has actually become "stuck" (scrolled
// past its natural position). We watch a zero-height sentinel that
// sits just above the sticky bar — once the sentinel leaves the
// viewport, the bar is stuck and gets its drop-shadow.
const headerStuck = ref(false)
const stickySentinelRef = ref<HTMLElement | null>(null)
let stickyObserver: IntersectionObserver | null = null

// ── Table-header sticky offset ──────────────────────────────────
// The table's <thead> sticks BELOW the page-level sticky stack
// (title + Export + picker + count). That stack's height varies
// by viewport and by whether the Export button wraps, so we
// measure it at runtime and feed the value to CSS via the
// `--report-thead-offset` custom property on the section root.
// The thead's CSS reads `top: var(--report-thead-offset)`.
const stickyStackRef = ref<HTMLElement | null>(null)
const reportSectionRef = ref<HTMLElement | null>(null)
let stackResizeObserver: ResizeObserver | null = null

// ── Floating thead clone ────────────────────────────────────────
// Position: sticky on the real <thead> can't escape the table-wrap
// (which is a horizontal scroll container) to anchor to the
// viewport. So we render a fixed-positioned mirror of the thead
// as a sibling above the wrap, show it once the real thead has
// scrolled out of view, and keep its left/width + horizontal
// scroll offset synced with the wrap. Net result: viewport-sticky
// column headers WITH contained horizontal scroll, and no inner
// vertical scrollbar.
const tableWrapRef = ref<HTMLElement | null>(null)
const realTheadRef = ref<HTMLElement | null>(null)
const floatingTheadHostRef = ref<HTMLElement | null>(null)
const floatingTheadScrollerRef = ref<HTMLElement | null>(null)
const theadFloating = ref(false)
let theadIntersectionObserver: IntersectionObserver | null = null
let wrapResizeObserver: ResizeObserver | null = null

/** Sync the floating thead host's left + width to the wrap's
 *  bounding rect, and its inner scroller's transform to the
 *  wrap's scrollLeft. Called on mount, scroll, resize. */
function refreshFloatingTheadGeometry() {
  const host = floatingTheadHostRef.value
  const wrap = tableWrapRef.value
  const scroller = floatingTheadScrollerRef.value
  if (!host || !wrap || !scroller) return
  const rect = wrap.getBoundingClientRect()
  host.style.left = `${rect.left}px`
  host.style.width = `${rect.width}px`
  scroller.style.transform = `translateX(${-wrap.scrollLeft}px)`
}

function onWindowResizeForOffset() {
  refreshTheadOffset()
  rebindTheadIntersectionObserver()
}

function refreshTheadOffset() {
  const section = reportSectionRef.value
  const stack = stickyStackRef.value
  if (!section || !stack) return
  // Topbar height comes from the global `--topbar-height` var
  // (set on `.app-shell`); we add the sticky stack's measured
  // bounding height. The stack itself sticks at top:0 of the
  // viewport (under the global topbar), so its own height + the
  // topbar height = the y-coordinate where the thead should pin.
  const stackHeight = stack.getBoundingClientRect().height
  section.style.setProperty('--report-thead-offset',
    `calc(var(--topbar-height, 0px) + ${stackHeight}px)`)
}

onMounted(() => {
  if (typeof IntersectionObserver !== 'undefined' && stickySentinelRef.value) {
    stickyObserver = new IntersectionObserver(
      ([entry]) => {
        headerStuck.value = !entry.isIntersecting
      },
      { rootMargin: '0px', threshold: 0 }
    )
    stickyObserver.observe(stickySentinelRef.value)
  }
  document.addEventListener('mousedown', onDocumentMouseDown)

  // Measure the sticky-stack height now + on every resize so the
  // thead's offset stays in sync (e.g. Export button wrapping on
  // narrow viewports changes the stack height).
  refreshTheadOffset()
  if (typeof ResizeObserver !== 'undefined' && stickyStackRef.value) {
    stackResizeObserver = new ResizeObserver(() => {
      refreshTheadOffset()
      // Sticky-stack height changed → the IntersectionObserver's
      // rootMargin (which encodes the offset in pixels) is now
      // stale. Rebind it.
      rebindTheadIntersectionObserver()
    })
    stackResizeObserver.observe(stickyStackRef.value)
  }
  window.addEventListener('resize', onWindowResizeForOffset)

  // Floating thead — geometry + visibility wiring.
  refreshFloatingTheadGeometry()
  window.addEventListener('resize', refreshFloatingTheadGeometry)
  window.addEventListener('scroll', refreshFloatingTheadGeometry, { passive: true })
  if (tableWrapRef.value) {
    tableWrapRef.value.addEventListener('scroll', refreshFloatingTheadGeometry, { passive: true })
    if (typeof ResizeObserver !== 'undefined') {
      wrapResizeObserver = new ResizeObserver(() => refreshFloatingTheadGeometry())
      wrapResizeObserver.observe(tableWrapRef.value)
    }
  }
})

// ── Watch the real thead for mount/unmount (table appears / hides
//    when rows load) and (re)attach the IntersectionObserver that
//    flips `theadFloating` on. The thead lives inside a `v-else`,
//    so its DOM node only exists after rows arrive. ──────────────
/** Resolve `--report-thead-offset` to a real pixel number. The CSS
 *  value is a `calc()` expression, which `IntersectionObserver`'s
 *  `rootMargin` can't parse. We read it off a probe element by
 *  setting `margin-top: var(--report-thead-offset)` and measuring
 *  the resulting computed pixel value. */
function resolveTheadOffsetPx(): number {
  const stack = stickyStackRef.value
  if (!stack) return 0
  // Easier path — use the values directly:
  //   topbar-height (from .app-shell) + sticky-stack measured height.
  const root = document.documentElement
  const topbarRaw = getComputedStyle(root).getPropertyValue('--topbar-height').trim() || '0px'
  const topbar = parseFloat(topbarRaw) || 0
  const stackHeight = stack.getBoundingClientRect().height
  return topbar + stackHeight
}

/** (Re)create the IntersectionObserver that toggles `theadFloating`.
 *  Re-runs whenever the real thead mounts/unmounts (rows-loading vs
 *  rows-loaded swap) OR the offset changes (sticky-stack resize). */
function rebindTheadIntersectionObserver() {
  if (theadIntersectionObserver) {
    theadIntersectionObserver.disconnect()
    theadIntersectionObserver = null
  }
  const thead = realTheadRef.value
  if (!thead || typeof IntersectionObserver === 'undefined') return
  const offsetPx = resolveTheadOffsetPx()
  theadIntersectionObserver = new IntersectionObserver(
    ([entry]) => {
      // Show the floating clone whenever the real thead has scrolled
      // ABOVE the offset line. We check `boundingClientRect.top` <
      // offset because `isIntersecting` alone would also fire true
      // when the thead is scrolled BELOW the viewport bottom.
      const top = entry.boundingClientRect.top
      theadFloating.value = top < offsetPx
      if (theadFloating.value) refreshFloatingTheadGeometry()
    },
    { rootMargin: `-${offsetPx}px 0px 0px 0px`, threshold: [0, 1] }
  )
  theadIntersectionObserver.observe(thead)
}

watch(realTheadRef, () => rebindTheadIntersectionObserver(), { flush: 'post' })

onBeforeUnmount(() => {
  if (stickyObserver) stickyObserver.disconnect()
  if (stackResizeObserver) stackResizeObserver.disconnect()
  if (theadIntersectionObserver) theadIntersectionObserver.disconnect()
  if (wrapResizeObserver) wrapResizeObserver.disconnect()
  window.removeEventListener('resize', onWindowResizeForOffset)
  window.removeEventListener('resize', refreshFloatingTheadGeometry)
  window.removeEventListener('scroll', refreshFloatingTheadGeometry)
  if (tableWrapRef.value) {
    tableWrapRef.value.removeEventListener('scroll', refreshFloatingTheadGeometry)
  }
  document.removeEventListener('mousedown', onDocumentMouseDown)
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
})

// ── Derived state ──────────────────────────────────────────────
const totalCount = computed(() => rows.value.length)

/** Format `YYYY-MM-DD` → "Apr 19, 2026" for the report row. The
 *  underlying string is local-date (no timezone), so we parse it as
 *  UTC midnight to avoid the day shifting in negative offsets. */
function fmtDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' })
}

/** Format `HH:MM:SS` → "8:00 AM". */
function fmtTime(hms: string): string {
  if (!hms) return ''
  const [hStr, mStr] = hms.split(':')
  const h = Number(hStr)
  const m = Number(mStr)
  if (Number.isNaN(h) || Number.isNaN(m)) return ''
  const period = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`
}

/** Map a number-or-null score/HR to a display string. Null means
 *  the game wasn't played / wasn't scored yet — render as "—". */
function fmtNumOrDash(value: number | null): string {
  return value === null || value === undefined ? '—' : String(value)
}

/** Compact date span for the chip — "May 17, 2026" or
 *  "May 17 – May 20, 2026". The mock backend already returns a
 *  human-readable `dateRangeLabel` (e.g. "May 17 to May 20, 2026
 *  (Pacific Time)") and we just want the date portion without the
 *  trailing timezone parenthetical. */
function eventDateChip(evt: EventSummary): string {
  if (!evt.dateRangeLabel) return ''
  return evt.dateRangeLabel.replace(/\s*\([^)]*\)\s*$/, '').trim()
}

// ── Export ──────────────────────────────────────────────────────
// The Export button writes a CSV the browser downloads via a
// throwaway <a download> click. CSV (not native .xlsx) keeps the
// feature dependency-free — Excel opens it cleanly with each column
// preserved. If we ever need real .xlsx (multiple sheets, styled
// headers, formulas) the export call swaps out for SheetJS without
// changing the button wiring.

/** True iff the user has both committed an event AND we have rows
 *  in hand. Drives the export button's enabled state — clicking
 *  when there's nothing to export would generate an empty file. */
const canExport = computed(() => selectedEvent.value !== null && rows.value.length > 0)

/** Escape a single CSV cell. Wraps in quotes when the value carries
 *  a delimiter, a quote, or a newline; doubles up internal quotes
 *  per RFC 4180. Numbers / nulls are coerced to strings first. */
function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/** Sanitize the event name into a filename-safe slug. Trims to a
 *  reasonable length so OSes with short-filename limits don't
 *  truncate the trailing date. */
function fileSafeName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
}

function exportToExcel() {
  if (!canExport.value || !selectedEvent.value) return

  const header = [
    'Division',
    'Game',
    'Game Type',
    'Date',
    'Time',
    'Team 1 Ext#',
    'Team 1',
    'Team 1 Score',
    'Team 1 HR',
    'Team 2 Ext#',
    'Team 2',
    'Team 2 Score',
    'Team 2 HR'
  ]

  const body = rows.value.map((row) => [
    row.divisionName,
    row.gameName,
    row.gameType === 'pool' ? 'Pool' : 'Bracket',
    fmtDate(row.gameDate),
    fmtTime(row.gameTime),
    row.team1RegNo,
    row.team1Name,
    row.team1Score,
    row.team1HR,
    row.team2RegNo,
    row.team2Name,
    row.team2Score,
    row.team2HR
  ])

  // Prepend a UTF-8 BOM so Excel auto-detects the encoding when the
  // file is opened by double-click on Windows. Without it, Excel
  // sometimes mojibakes non-ASCII characters in event / team names.
  const csv =
    '﻿' +
    [header, ...body]
      .map((line) => line.map(csvEscape).join(','))
      .join('\r\n')

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const filename = `event-summary-${fileSafeName(selectedEvent.value.eventName)}.csv`

  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Free the blob after the click has had a chance to start the
  // download. Some browsers race here without the timeout.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
</script>

<template>
  <main class="association-users">
    <AssociationSidebar active-key="reports" />
    <section
      ref="reportSectionRef"
      class="association-users__main association-users__main--wide"
    >
      <!-- Sticky-stack pattern (mirrors AssociationUsersView /
           AssociationTeamsView exactly):
             - Sentinel ABOVE the wrapper drives `headerStuck`.
             - `.association-teams__sticky-stack` is the sticky
               positioner; `--stuck` toggles the lift shadow + the
               merge animation between the two inner rows.
             - Row 1 (.association-users__header): page title +
               Export to Excel button (analog to count + Invite).
             - Row 2 (.association-users__toolbar): event search
               picker + game count (analog to the filter row).
           At rest the two rows have a 16px gap; when stuck they
           collapse to 4px and the toolbar's top border / radius /
           padding all squeeze in so the two rows read as one
           coordinated sticky bar. -->
      <div ref="stickySentinelRef" class="association-users__sticky-sentinel" aria-hidden="true"></div>
      <div
        ref="stickyStackRef"
        class="association-teams__sticky-stack"
        :class="{ 'association-teams__sticky-stack--stuck': headerStuck }"
      >
        <header class="association-users__header">
          <div class="association-reports__page-heading">
            <h1 class="association-reports__title">Event Summary</h1>
            <p class="association-reports__subtitle">
              Game-by-game scores grouped by division.
            </p>
          </div>
          <!-- Export button — disabled until both gates are met:
               (a) an event is selected, (b) the report has rows. -->
          <button
            type="button"
            class="association-reports__export"
            :disabled="!canExport"
            :title="canExport
              ? 'Download the report as a CSV file (opens in Excel)'
              : 'Select an event with game data to enable export'"
            @click="exportToExcel"
          >Export to Excel</button>
        </header>

        <div class="association-users__toolbar association-teams__toolbar association-reports__toolbar">
          <div
            ref="pickerRef"
            class="association-reports__picker"
          >
            <!-- Combobox shell. Two visual states:
                   • selected → name+date chip with × clear button
                   • empty   → search input that opens a suggestion
                               panel once the user types 3+ chars -->
            <div
              class="association-reports__combobox"
              :class="{ 'association-reports__combobox--open': suggestionsOpen && !selectedEvent }"
              role="combobox"
              aria-haspopup="listbox"
              :aria-expanded="suggestionsOpen && !selectedEvent ? 'true' : 'false'"
              aria-label="Search events"
            >
              <template v-if="selectedEvent">
                <span class="association-reports__chip">
                  <span class="association-reports__chip-name">{{ selectedEvent.eventName }}</span>
                  <span
                    v-if="eventDateChip(selectedEvent)"
                    class="association-reports__chip-date"
                  >{{ eventDateChip(selectedEvent) }}</span>
                  <button
                    type="button"
                    class="association-reports__chip-clear"
                    aria-label="Clear selected event"
                    @click="clearSelectedEvent"
                  >×</button>
                </span>
              </template>
              <template v-else>
                <input
                  ref="searchInputRef"
                  v-model="searchInput"
                  type="search"
                  class="association-reports__combobox-input"
                  placeholder="Search events by name…"
                  autocomplete="off"
                  @focus="suggestionsOpen = searchInput.trim().length > 0"
                />
              </template>
            </div>

            <!-- Suggestion panel. Absolute-positioned so it floats
                 over the report body without reflowing the sticky
                 toolbar's height while the user types. -->
            <div
              v-if="suggestionsOpen && !selectedEvent"
              class="association-reports__suggestions"
              role="listbox"
            >
              <p
                v-if="searchInput.trim().length < 3"
                class="association-reports__suggestions-hint"
              >Type at least 3 characters to search.</p>
              <div
                v-else-if="suggestionsLoading"
                class="association-reports__suggestions-loading"
              >
                <span class="shimmer-block association-reports__suggestion-skeleton"></span>
                <span class="shimmer-block association-reports__suggestion-skeleton"></span>
                <span class="shimmer-block association-reports__suggestion-skeleton"></span>
              </div>
              <p
                v-else-if="suggestionsEmpty"
                class="association-reports__suggestions-hint"
              >No events match "{{ searchInput.trim() }}".</p>
              <ul v-else class="association-reports__suggestions-list">
                <li
                  v-for="evt in suggestions"
                  :key="evt.id"
                  role="option"
                  class="association-reports__suggestion"
                  @click="pickEvent(evt)"
                >
                  <span class="association-reports__suggestion-name">{{ evt.eventName }}</span>
                  <span
                    v-if="eventDateChip(evt)"
                    class="association-reports__suggestion-date"
                  >{{ eventDateChip(evt) }}</span>
                </li>
              </ul>
            </div>
          </div>
          <p class="association-users__count association-reports__count">
            <strong :title="`${totalCount} games`">{{ formatCompact(totalCount) }}</strong>
            <span>games</span>
          </p>
        </div>
      </div>

      <!-- Loading state: 6 shimmer rows -->
      <div v-if="rowsLoading" class="association-reports__table-shell">
        <div class="association-reports__table-wrap">
          <table class="association-reports__table">
            <thead>
              <tr>
                <th class="association-reports__th">Division</th>
                <th class="association-reports__th">Game</th>
                <th class="association-reports__th">Date</th>
                <th class="association-reports__th">Time</th>
                <th class="association-reports__th">Team 1 Ext#</th>
                <th class="association-reports__th">Team 1</th>
                <th class="association-reports__th association-reports__th--num">Score</th>
                <th class="association-reports__th association-reports__th--num">HR</th>
                <th class="association-reports__th">Team 2 Ext#</th>
                <th class="association-reports__th">Team 2</th>
                <th class="association-reports__th association-reports__th--num">Score</th>
                <th class="association-reports__th association-reports__th--num">HR</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="i in 6" :key="`sk-${i}`" class="association-reports__row association-reports__row--skeleton">
                <td v-for="c in 12" :key="`sk-${i}-${c}`" class="association-reports__td">
                  <span class="shimmer-block association-reports__cell-skeleton"></span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Empty states -->
      <div
        v-else-if="!selectedEventId"
        class="association-users__empty association-reports__empty"
      >
        <p>Search for an event by name to view its game summary.</p>
      </div>
      <div
        v-else-if="rows.length === 0"
        class="association-users__empty association-reports__empty"
      >
        <p>No games scored for this event yet.</p>
      </div>

      <!-- Report table -->
      <div v-else class="association-reports__table-shell">
        <!-- Floating thead clone — fixed-positioned mirror of the
             real <thead>. Visible only once the real thead has
             scrolled past the sticky toolbar. JS keeps its
             left/width aligned with the wrap and its transform
             in sync with the wrap's scrollLeft. -->
        <div
          ref="floatingTheadHostRef"
          class="association-reports__floating-thead-host"
          :class="{ 'association-reports__floating-thead-host--visible': theadFloating }"
          aria-hidden="true"
        >
          <div ref="floatingTheadScrollerRef" class="association-reports__floating-thead-scroller">
            <table class="association-reports__table">
              <thead>
                <tr>
                  <th class="association-reports__th">Division</th>
                  <th class="association-reports__th">Game</th>
                  <th class="association-reports__th">Date</th>
                  <th class="association-reports__th">Time</th>
                  <th class="association-reports__th">Team 1 Ext#</th>
                  <th class="association-reports__th">Team 1</th>
                  <th class="association-reports__th association-reports__th--num">Score</th>
                  <th class="association-reports__th association-reports__th--num">HR</th>
                  <th class="association-reports__th">Team 2 Ext#</th>
                  <th class="association-reports__th">Team 2</th>
                  <th class="association-reports__th association-reports__th--num">Score</th>
                  <th class="association-reports__th association-reports__th--num">HR</th>
                </tr>
              </thead>
            </table>
          </div>
        </div>
        <div ref="tableWrapRef" class="association-reports__table-wrap">
          <table class="association-reports__table">
            <thead ref="realTheadRef">
              <tr>
                <th class="association-reports__th">Division</th>
                <th class="association-reports__th">Game</th>
                <th class="association-reports__th">Date</th>
                <th class="association-reports__th">Time</th>
                <th class="association-reports__th">Team 1 Ext#</th>
                <th class="association-reports__th">Team 1</th>
                <th class="association-reports__th association-reports__th--num">Score</th>
                <th class="association-reports__th association-reports__th--num">HR</th>
                <th class="association-reports__th">Team 2 Ext#</th>
                <th class="association-reports__th">Team 2</th>
                <th class="association-reports__th association-reports__th--num">Score</th>
                <th class="association-reports__th association-reports__th--num">HR</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in rows"
                :key="row.id"
                class="association-reports__row"
              >
                <td class="association-reports__td association-reports__td--division">{{ row.divisionName }}</td>
                <td class="association-reports__td">
                  <span class="association-reports__game-name">{{ row.gameName }}</span>
                  <span
                    class="association-reports__game-type-chip"
                    :class="row.gameType === 'pool' ? 'association-reports__game-type-chip--pool' : 'association-reports__game-type-chip--bracket'"
                  >{{ row.gameType === 'pool' ? 'Pool' : 'Bracket' }}</span>
                </td>
                <td class="association-reports__td">{{ fmtDate(row.gameDate) }}</td>
                <td class="association-reports__td">{{ fmtTime(row.gameTime) }}</td>
                <td class="association-reports__td association-reports__td--reg">{{ row.team1RegNo }}</td>
                <td class="association-reports__td">{{ row.team1Name }}</td>
                <td class="association-reports__td association-reports__td--num">{{ fmtNumOrDash(row.team1Score) }}</td>
                <td class="association-reports__td association-reports__td--num">{{ fmtNumOrDash(row.team1HR) }}</td>
                <td class="association-reports__td association-reports__td--reg">{{ row.team2RegNo }}</td>
                <td class="association-reports__td">{{ row.team2Name }}</td>
                <td class="association-reports__td association-reports__td--num">{{ fmtNumOrDash(row.team2Score) }}</td>
                <td class="association-reports__td association-reports__td--num">{{ fmtNumOrDash(row.team2HR) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Spacer so the last row doesn't sit flush against the
           viewport bottom — same vertical breathing the other
           portal pages have. -->
      <div aria-hidden="true" style="height: 24px;"></div>
    </section>
  </main>
</template>
