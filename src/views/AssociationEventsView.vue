<script setup lang="ts">
// AssociationEventsView
// ---------------------
// /association/:associationShortName/portal/events.
//
// Layout: sticky toolbar (count + search + Create button + filter
// row), continuous-scroll pagination, per-row ellipsis menu
// (Edit / Cancel). Permission-gated by `manage_events` at the route
// level via meta.requiresPermission.
//
// Filter row carries three controls (left-to-right):
//   - Year native select  — distinct years that have events
//                            (fetched from /years endpoint). Defaults
//                            to the server-supplied `defaultYear`.
//   - Event Type dropdown — single-value substring filter against
//                            `eventType` column.
//   - Past Events toggle  — when ON, listing flips to past events
//                            (sorted desc by end date).
//
// Row layout: 80×80 hero image (or placeholder) · middle stack
// (date range + name + sport + director + address + stats row) ·
// ⋯ ellipsis menu (Edit / Cancel).
//
// Clicking a row does nothing in v1 — the event-detail page is a
// follow-up branch.

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import AssociationSidebar from '../components/AssociationSidebar.vue'
import MatchGeniEventFormModal from '../components/MatchGeniEventFormModal.vue'
import EventShareModal from '../components/EventShareModal.vue'
import MultiSelectDropdown from '../components/MultiSelectDropdown.vue'
import StatusBadge from '../components/StatusBadge.vue'
import {
  EVENT_TYPES_CATALOGUE,
  eventTypeLabel,
  fetchEvents,
  fetchEventYears,
  toEventSummary,
  transitionEventStatus
} from '../api/events'
import { buildEventDetailUrl, buildPublicEventDetailUrl } from '../api/config'
import { fetchMatchGeniAccess } from '../api/matchGeniAccess'
import {
  getMatchGeniMenuAccess,
  setMatchGeniMenuAccess,
  type MatchGeniMenuAccess
} from '../matchgeni-context'
import { currentAssociation } from '../constants/associations'
import { themeMode } from '../theme'
import { lockBodyScroll, unlockBodyScroll } from '../body-scroll-lock'
import { pushToast } from '../toast-center'
import { formatCompact } from '../utils/formatNumber'
import type { Event, EventStatus, EventSummary, EventType } from '../types'

const route = useRoute()
const router = useRouter()
const associationShortName = computed(() =>
  (route.params.associationShortName as string | undefined) ?? ''
)

// Server-side paginated list state. Rows are `EventSummary` (slim
// shape) — the full `Event` is fetched on demand by EventFormModal
// when the admin clicks Edit. See contract §1 / §11.
const events = ref<EventSummary[]>([])
const loading = ref(true)
const loadingMore = ref(false)
const search = ref('')

// Filter state — mirrors the teams page filter contract:
//   - Year is single-value, ALWAYS selected (defaults to the server's
//     `defaultYear`). 'all' is the explicit no-filter sentinel.
//   - Event Type is SINGLE-select: one of the catalogue keys
//     (`tournament` / `online_meeting` / `league` / `other`), or
//     null for no constraint.
//   - Status is SINGLE-select: one of the lifecycle values
//     (`draft` / `published` / `completed` / `cancelled`), or null
//     for no constraint.
//   - Past Events is a binary toggle (own button, not a dropdown).
const yearFilter = ref<number | 'all' | null>(null)
const yearOptions = ref<number[]>([])
/** True while `fetchEventYears()` is in flight. Drives the year-filter
 *  shimmer placeholder — the dropdown can't usefully render until we
 *  know which years exist + which one to default-select, so we swap
 *  it for a same-sized shimmer block during the request. */
const yearsLoading = ref(false)
const eventTypeFilter = ref<EventType | null>(null)
const statusFilter = ref<EventStatus | null>(null)
const pastEventsFilter = ref<boolean>(false)

const STATUS_OPTIONS: EventStatus[] = ['draft', 'published', 'completed', 'cancelled']
// Status labels are capitalised for display; the bridge below maps
// back to the lowercase `EventStatus` enum the API expects.
function statusLabel(s: EventStatus): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
const STATUS_LABELS = STATUS_OPTIONS.map(statusLabel)
// Event-type dropdown options — labels only; selection bridges back
// to the catalogue key via `EVENT_TYPES_CATALOGUE`.
const EVENT_TYPE_LABELS = EVENT_TYPES_CATALOGUE.map((t) => t.label)

// Server pagination.
const PAGE_SIZE = 25
const currentPage = ref(0)
const lastPage = ref(1)
const totalCount = ref(0)

// Create / Edit modal — same component handles both modes. In edit
// mode the view passes only the event id; the modal fetches the
// full record on open (the row only carries an `EventSummary`).
const modalOpen = ref(false)
const modalEventId = ref<string | null>(null)

// Create / Edit open the MatchGeni event wizard (`MatchGeniEventFormModal`).
function openCreateModal() {
  closeMenu()
  modalEventId.value = null
  modalOpen.value = true
}

function openEditModal(summary: EventSummary) {
  closeMenu()
  modalEventId.value = summary.id
  modalOpen.value = true
}

function openMatchGeni(summary: EventSummary) {
  closeMenu()
  router.push({
    name: 'matchgeni-dashboard',
    params: {
      associationShortName: associationShortName.value,
      // MatchGeni's URL now carries the numeric event id (not the
      // guid) — see comment on the route definition in `router.ts`
      // for the rationale. `EventSummary.id` is the numeric PK string.
      eventId: summary.id
    }
  })
}

/** Open the event's authed-user detail page in a new browser tab.
 *  Lives on the main site (whoifollow.tech / .com per the active
 *  API environment) — this app is the admin portal, the detail
 *  page is a separate route on the parent site. `noopener` +
 *  `noreferrer` are standard hygiene for any `target="_blank"`
 *  link to a different origin. */
function openEventDetailExternal(summary: EventSummary) {
  closeMenu()
  // Prefer the SEO-friendly public slug URL (the same one the Share dialog
  // composes). Fall back to the legacy authed `/event/detail/<guid>` link
  // until the backend ships `slug` on the event list.
  const url = summary.slug
    ? buildPublicEventDetailUrl(summary.slug)
    : summary.guid
      ? buildEventDetailUrl(summary.guid)
      : ''
  if (!url) return
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** Open the Share popup — surfaces the public (unauthenticated)
 *  share URL for the event so the admin can copy and forward it
 *  to anyone. The URL follows the `/public/event/detail/<guid>`
 *  prefix the parent site uses for shareable read-only views. */
// Share modal state — opens the shared `EventShareModal` popup
// when non-null. URL build + clipboard logic + transition all
// live inside that component now; this view just toggles open /
// closed.
const sharingEvent = ref<EventSummary | null>(null)

function openShareModal(summary: EventSummary) {
  closeMenu()
  if (!summary.guid) return
  sharingEvent.value = summary
}

function closeShareModal() {
  sharingEvent.value = null
}

/** Merge a saved/updated `Event` into the list — no toast, no modal side
 *  effects. Shared by the create/edit modal save AND the status-transition
 *  confirm, so the transition flow doesn't fire the generic "Event updated"
 *  toast on top of its own status toast. */
function applyEventToList(saved: Event) {
  const summary = toEventSummary(saved)
  const index = events.value.findIndex((e) => e.id === saved.id)
  if (index !== -1) {
    events.value = [
      ...events.value.slice(0, index),
      summary,
      ...events.value.slice(index + 1)
    ]
    // Auto-reconcile against the active filters: if the updated row
    // no longer matches the current Status or Event Type filter, drop
    // it immediately rather than leaving a mismatched badge until
    // the next refetch. (Mirrors the users-page reconcile behavior.)
    const statusMismatch =
      statusFilter.value !== null && statusFilter.value !== summary.eventStatus
    const typeMismatch =
      eventTypeFilter.value !== null && eventTypeFilter.value !== summary.eventType
    if (statusMismatch || typeMismatch) {
      events.value = events.value.filter((e) => e.id !== saved.id)
      totalCount.value = Math.max(0, totalCount.value - 1)
    }
  } else {
    events.value = [summary, ...events.value]
    totalCount.value += 1
  }
}

function onEventSaved(saved: Event) {
  const isUpdate = events.value.some((e) => e.id === saved.id)
  pushToast(isUpdate
    ? { tone: 'success', title: 'Event updated', message: 'Your changes have been saved.' }
    : { tone: 'success', title: 'Event created', message: 'Saved as a draft — publish it when you’re ready.' })
  applyEventToList(saved)
  modalEventId.value = null
}

/** Resolve the lifecycle menu items to render for a given event's
 *  current status. Mirrors the allowed-transitions table documented
 *  in `association-events-api-contract.md` §6, minus same-status
 *  self-transitions (they'd be visual noop) and minus the
 *  `completed` / `cancelled` rows (terminal states — no further
 *  transitions). The danger flag drives the destructive-styling
 *  class on the menu item. */
function allowedTransitionsFor(
  status: EventStatus
): { target: EventStatus; label: string; danger?: boolean }[] {
  switch (status) {
    case 'draft':
      return [
        { target: 'published', label: 'Publish Event' },
        { target: 'cancelled', label: 'Cancel Event', danger: true }
      ]
    case 'published':
      return [
        { target: 'completed', label: 'Mark Completed' },
        { target: 'cancelled', label: 'Cancel Event', danger: true }
      ]
    case 'completed':
    case 'cancelled':
    default:
      return []
  }
}

/** Pending lifecycle-transition confirmation. Open whenever the
 *  admin picks a transition from the row's ⋯ menu; cleared by either
 *  Cancel (no-op) or Confirm (fires the API). The shape carries
 *  everything the modal + the eventual API call need so the user's
 *  click on a menu item is purely a "show modal" action — no
 *  irreversible state changes happen until they confirm. */
const confirmingTransition = ref<{
  event: EventSummary
  target: EventStatus
  label: string
  danger: boolean
} | null>(null)
const confirmTransitionSaving = ref(false)
// Cancellation reason — REQUIRED when the target is `cancelled` (submitted to
// the cancel API). `cancelReasonTouched` gates the inline error so it only
// shows after a submit attempt.
const cancelReason = ref('')
const cancelReasonTouched = ref(false)
const cancelReasonError = computed(() =>
  confirmingTransition.value?.target === 'cancelled' &&
  cancelReasonTouched.value &&
  !cancelReason.value.trim()
)

function transitionEvent(
  evt: EventSummary,
  target: EventStatus
) {
  closeMenu()
  const meta = allowedTransitionsFor(evt.eventStatus).find(
    (t) => t.target === target
  )
  if (!meta) return
  cancelReason.value = ''
  cancelReasonTouched.value = false
  confirmingTransition.value = {
    event: evt,
    target,
    label: meta.label,
    danger: meta.danger === true
  }
}

function cancelTransition() {
  if (confirmTransitionSaving.value) return // ignore Cancel mid-save
  confirmingTransition.value = null
}

function onTransitionBackdrop(event: MouseEvent) {
  if (event.target === event.currentTarget) cancelTransition()
}

async function confirmTransition() {
  const pending = confirmingTransition.value
  if (!pending) return
  // Cancelling requires a reason — block until one is entered.
  if (pending.target === 'cancelled' && !cancelReason.value.trim()) {
    cancelReasonTouched.value = true
    return
  }
  confirmTransitionSaving.value = true
  try {
    const updated = await transitionEventStatus(
      currentAssociation.value?.id ?? '',
      associationShortName.value,
      pending.event.id,
      pending.target,
      pending.target === 'cancelled' ? { reason: cancelReason.value.trim() } : {}
    )
    // Silent list update (no generic "Event updated" toast) — the status
    // toast below is the only one we want for a transition.
    applyEventToList(updated)
    confirmingTransition.value = null
    pushToast({
      tone: 'success',
      title:
        pending.target === 'cancelled'
          ? 'Event cancelled'
          : pending.target === 'published'
            ? 'Event published'
            : pending.target === 'completed'
              ? 'Event completed'
              : 'Event updated'
    })
  } catch (err) {
    pushToast({
      tone: 'warning',
      title: 'Could not update event',
      message: err instanceof Error ? err.message : 'Please try again.'
    })
    // Keep the dialog open on error so the admin can retry or cancel.
  } finally {
    confirmTransitionSaving.value = false
  }
}

/** Body-text copy keyed to the target state — each transition has a
 *  different consequence, so the message specifies what'll happen. */
function transitionConfirmCopy(target: EventStatus): string {
  switch (target) {
    case 'published':
      return 'Publish this event? It will become visible to teams and registration controls will activate per the registration window.'
    case 'completed':
      return 'Mark this event as completed? This is a terminal state — no further status changes will be possible.'
    case 'cancelled':
      return 'Cancel this event? Teams will be notified, registration will close, and no further changes can be made.'
    default:
      return 'Confirm the status change for this event?'
  }
}

watch(confirmingTransition, (next, prev) => {
  if (next && !prev) lockBodyScroll()
  else if (!next && prev) unlockBodyScroll()
})

// Body-scroll lock for the share modal moved into the
// `EventShareModal` component itself, so this watcher is no
// longer needed here — any other modal still managed locally
// keeps its own scroll-lock watcher.

// Sticky toolbar drop-shadow.
const toolbarStuck = ref(false)
const stickySentinelRef = ref<HTMLElement | null>(null)
let stickyObserver: IntersectionObserver | null = null

// Per-row ellipsis menu — only one row's menu open at a time.
const openMenuId = ref<string | null>(null)

// MatchGeni-access gate per event row, session-cached.
// ----------------------------------------------------
// Goal: the MatchGeni menu item only renders for users who can
// actually enter MatchGeni for that specific event. Logic:
//   - Association-FC users → MatchGeni always shown (no fetch).
//   - Everyone else → on first menu open for an event, hit
//     `/my-permissions` for that event. If the response carries
//     `fullControl: true` OR any permission in `permissions`,
//     cache `'allowed'`; otherwise cache `'denied'`. 403 / 404 /
//     409 / 5xx all collapse to `'denied'` (no MatchGeni).
//
// Cache lives on `matchgeni-context.ts` (lifted out of this view)
// so the global 403 interceptor can flush it during permission
// reconciliation — items recompute against fresh data after a
// permission change instead of showing stale verdicts.
/** Resolve which UI state the MatchGeni menu item should show
 *  for the given event row. Reads the shared cache + the
 *  association FC short-circuit. */
function matchGeniMenuStateFor(eventId: string): MatchGeniMenuAccess | 'fc-allowed' {
  if (currentAssociation.value?.fullControl) return 'fc-allowed'
  return getMatchGeniMenuAccess(eventId) ?? 'denied'
}

/** Fire-and-forget access fetch for one event row. Idempotent —
 *  no-op when a result is already cached (including a `'loading'`
 *  in-flight entry). Triggered from `toggleMenu` so the request
 *  starts the moment the user opens the row's ⋯ menu. */
async function ensureMatchGeniMenuAccess(eventId: string) {
  if (currentAssociation.value?.fullControl) return
  if (getMatchGeniMenuAccess(eventId)) return // already cached / in flight

  const associationId = currentAssociation.value?.id
  if (!associationId) {
    setMatchGeniMenuAccess(eventId, 'denied')
    return
  }

  setMatchGeniMenuAccess(eventId, 'loading')

  try {
    const payload = await fetchMatchGeniAccess(associationId, eventId)
    const allowed = payload.access.fullControl
      || payload.access.permissions.length > 0
    setMatchGeniMenuAccess(eventId, allowed ? 'allowed' : 'denied')
  } catch {
    setMatchGeniMenuAccess(eventId, 'denied')
  }
}

function toggleMenu(id: string) {
  const next = openMenuId.value === id ? null : id
  openMenuId.value = next
  // Kick off the matchgeni access fetch on open. The cache + the
  // FC short-circuit keep this snappy after the first open.
  if (next) ensureMatchGeniMenuAccess(next)
}
function closeMenu() {
  openMenuId.value = null
}
function onDocClick(event: MouseEvent) {
  if (!openMenuId.value) return
  const target = event.target as HTMLElement
  if (
    !target.closest('.association-users__row-menu') &&
    !target.closest('.association-users__row-menu-btn')
  ) {
    openMenuId.value = null
  }
}

let fetchToken = 0

async function loadPage(mode: 'reset' | 'append') {
  if (yearFilter.value === null) return
  // The events list endpoint is keyed on the ASSOCIATION'S NUMERIC PK
  // (not the URL slug). `currentAssociation` is populated by the
  // router beforeEach guard before this view mounts; defensive bail
  // if somehow it isn't set yet.
  const associationId = currentAssociation.value?.id
  if (!associationId) return
  const myToken = ++fetchToken
  const nextPage = mode === 'reset' ? 1 : currentPage.value + 1
  if (mode === 'reset') loading.value = true
  else loadingMore.value = true
  try {
    const result = await fetchEvents(associationId, {
      year: yearFilter.value,
      pastEvents: pastEventsFilter.value,
      // Event Type + Status are both single-select; pass through
      // the catalogue key (`tournament` / `online_meeting` / ...) or
      // the lifecycle enum value (`draft` / `published` / ...). Omit
      // when null so the backend's defaults apply.
      eventType: eventTypeFilter.value ?? undefined,
      eventStatus: statusFilter.value ?? undefined,
      search: search.value,
      page: nextPage,
      per_page: PAGE_SIZE
    })
    if (myToken !== fetchToken) return
    if (mode === 'reset') events.value = result.data
    else events.value = [...events.value, ...result.data]
    currentPage.value = result.current_page
    lastPage.value = result.last_page
    totalCount.value = result.total
  } catch (error) {
    if (myToken !== fetchToken) return
    pushToast({
      tone: 'warning',
      title: 'Could not load events',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
    if (mode === 'reset') events.value = []
  } finally {
    if (myToken === fetchToken) {
      if (mode === 'reset') loading.value = false
      else loadingMore.value = false
    }
  }
}

async function loadYears() {
  const associationId = currentAssociation.value?.id
  if (!associationId) return
  yearsLoading.value = true
  try {
    const result = await fetchEventYears(associationId)
    yearOptions.value = result.years
    // Only set the default if the user hasn't already touched the
    // filter (e.g. via deep-linked URL state in the future).
    if (yearFilter.value === null) yearFilter.value = result.defaultYear
  } catch {
    // Years endpoint is nice-to-have; if it fails, seed with the
    // current calendar year so the dropdown still has a selection.
    const cy = new Date().getFullYear()
    yearOptions.value = [cy]
    if (yearFilter.value === null) yearFilter.value = cy
  } finally {
    yearsLoading.value = false
  }
}

/** Filter-watcher gate. Set true once the initial `load()` flow has
 *  fired its explicit first `loadPage('reset')`. Until then the
 *  watcher below skips, so the year-default assignment inside
 *  `loadYears()` doesn't double-fire the listing endpoint
 *  (assigning `yearFilter.value = defaultYear` is a deliberate
 *  internal step, not a user filter change). */
const filterWatcherReady = ref(false)

async function load() {
  // Re-gate the filter watcher for the duration of the initial flow.
  // Covers both first mount AND the slug-change path below (which
  // resets yearFilter before re-running load() — without re-gating
  // the watcher would fire on that reset and double-call the list
  // endpoint).
  filterWatcherReady.value = false
  // Show the listing shimmer the moment `load()` starts — not just
  // when `loadPage('reset')` runs further down. On association
  // switch this matters: the old association's rows would otherwise
  // stay painted until `fetchEventYears()` resolved + `fetchEvents`
  // kicked off. Setting `loading` true up front + clearing `events`
  // gives the user immediate feedback that the page is loading
  // fresh data. `loadPage('reset')` sets these again, harmlessly.
  loading.value = true
  events.value = []
  totalCount.value = 0
  await loadYears()
  await loadPage('reset')
  filterWatcherReady.value = true
}

// Debounced search.
const SEARCH_DEBOUNCE_MS = 500
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null
watch(search, () => {
  if (!filterWatcherReady.value) return
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  searchDebounceTimer = setTimeout(() => {
    searchDebounceTimer = null
    loadPage('reset')
  }, SEARCH_DEBOUNCE_MS)
})

// Auto-sync `pastEventsFilter` with the picked year — viewing a
// prior year and "upcoming events" is contradictory (there are no
// upcoming events in a past year), and conversely viewing the
// current or any future year with "past events" ON would either
// hide rows the user expects to see or surface an empty bucket.
// So we mirror the year directly:
//   year <  currentYear  → pastEventsFilter = true
//   year >= currentYear  → pastEventsFilter = false
// 'all' / null are left alone — those are explicit user choices.
//
// Both yearFilter and pastEventsFilter feed the combined watcher
// below; Vue batches the two mutations into a single refetch.
watch(yearFilter, (year) => {
  if (!filterWatcherReady.value) return
  if (typeof year !== 'number') return // 'all' / null — no auto-flip
  const currentYear = new Date().getFullYear()
  const shouldBePast = year < currentYear
  if (pastEventsFilter.value !== shouldBePast) {
    pastEventsFilter.value = shouldBePast
  }
})

// Immediate refetch on filter changes (deliberate clicks).
watch([yearFilter, pastEventsFilter, eventTypeFilter, statusFilter], () => {
  if (!filterWatcherReady.value) return
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer)
    searchDebounceTimer = null
  }
  loadPage('reset')
})

// Continuous-scroll sentinel.
const loadMoreSentinelRef = ref<HTMLElement | null>(null)
let loadMoreObserver: IntersectionObserver | null = null
const hasMore = computed(() => currentPage.value < lastPage.value)

watch(loadMoreSentinelRef, (el, prev) => {
  if (loadMoreObserver && prev) loadMoreObserver.unobserve(prev)
  if (!el || typeof IntersectionObserver === 'undefined') return
  if (!loadMoreObserver) {
    loadMoreObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && hasMore.value && !loadingMore.value && !loading.value) {
            void loadPage('append')
          }
        }
      },
      { rootMargin: '200px 0px', threshold: 0 }
    )
  }
  loadMoreObserver.observe(el)
})

onMounted(() => {
  document.addEventListener('mousedown', onDocClick)
  if (typeof IntersectionObserver !== 'undefined' && stickySentinelRef.value) {
    stickyObserver = new IntersectionObserver(
      ([entry]) => {
        toolbarStuck.value = !entry.isIntersecting
      },
      { rootMargin: '0px', threshold: 0 }
    )
    stickyObserver.observe(stickySentinelRef.value)
  }
  void load()
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocClick)
  if (stickyObserver) stickyObserver.disconnect()
  if (loadMoreObserver) loadMoreObserver.disconnect()
})

watch(associationShortName, () => {
  if (associationShortName.value) {
    yearFilter.value = null
    void load()
  }
})

// Bridge computed for the Year filter — single-value, follows the
// teams-page Status pattern. Options are the dynamic year list only;
// no "All Years" sentinel. Default selection is the server's
// `defaultYear`, so the dropdown trigger always reads the chosen
// year (e.g. "2026") and never a placeholder.
const yearFilterAsArray = computed<string[]>({
  get: () => {
    if (yearFilter.value === null || yearFilter.value === 'all') return []
    return [String(yearFilter.value)]
  },
  set: (next) => {
    if (next.length === 0) return
    const n = Number(next[next.length - 1])
    if (Number.isFinite(n)) yearFilter.value = n
  }
})
const yearOptionLabels = computed<string[]>(() =>
  yearOptions.value.map((y) => String(y))
)

/** Bridge — Event Type filter is single-select on the wire (catalogue
 *  key), but the MultiSelectDropdown component speaks in `string[]`
 *  of labels. The getter maps the current key → its label (1-entry
 *  array, or empty when null). The setter takes the latest entry and
 *  resolves it back to a catalogue key. Same shape as the year
 *  filter bridge above. */
const eventTypeFilterAsArray = computed<string[]>({
  get: () => {
    if (eventTypeFilter.value === null) return []
    return [eventTypeLabel(eventTypeFilter.value)]
  },
  set: (next) => {
    if (next.length === 0) {
      eventTypeFilter.value = null
      return
    }
    const label = next[next.length - 1]
    const hit = EVENT_TYPES_CATALOGUE.find((t) => t.label === label)
    eventTypeFilter.value = hit?.key ?? null
  }
})

/** Bridge — Status filter mirrors the Event Type pattern. The
 *  underlying enum is `'draft' | 'published' | ...`; the dropdown
 *  shows capitalised labels (`'Draft'` etc.). */
const statusFilterAsArray = computed<string[]>({
  get: () => {
    if (statusFilter.value === null) return []
    return [statusLabel(statusFilter.value)]
  },
  set: (next) => {
    if (next.length === 0) {
      statusFilter.value = null
      return
    }
    const label = next[next.length - 1]
    const key = label.toLowerCase() as EventStatus
    statusFilter.value = STATUS_OPTIONS.includes(key) ? key : null
  }
})

const hasFilterChanges = computed(() =>
  pastEventsFilter.value ||
  eventTypeFilter.value !== null ||
  statusFilter.value !== null
)

/** True when the picked year is strictly in the past — viewing a
 *  prior year implies past events by definition, so the Past Events
 *  toggle becomes a forced-ON readonly indicator. Future years
 *  similarly force the toggle OFF (handled by the auto-sync watch),
 *  so we lock the control in that direction too. The current year
 *  and the 'all' / null states leave the toggle freely clickable. */
const pastToggleLocked = computed(() => {
  const year = yearFilter.value
  if (typeof year !== 'number') return false
  const currentYear = new Date().getFullYear()
  return year !== currentYear
})

function resetFilters() {
  pastEventsFilter.value = false
  eventTypeFilter.value = null
  statusFilter.value = null
}

function statusBadgeTone(status: EventStatus): 'success' | 'warning' | 'neutral' | 'danger' | 'primary' {
  switch (status) {
    case 'published': return 'success'
    case 'draft': return 'neutral'
    case 'completed': return 'primary'
    case 'cancelled': return 'danger'
    default: return 'neutral'
  }
}

function statusBadgeLabel(status: EventStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

/* Multi-color initial palette for the row hero — same six-pair
 * hash-driven palette TeamAvatar uses, so an event with no uploaded
 * banner gets a deterministic colored tile (red / blue / green /
 * orange / purple / teal) matching its name. Light entries are pale
 * pastels with a darker AA-contrast initial; dark entries are deep
 * tints with a brighter initial that reads on the slate page.
 * Selection index is computed from the event name's char-code sum
 * so the same event keeps its color across renders + theme flips. */
const lightEventHeroPalette = [
  { bg: '#fbe4e6', fg: '#bb5964' },
  { bg: '#e7f1ff', fg: '#477bb2' },
  { bg: '#eaf8eb', fg: '#468957' },
  { bg: '#fff0df', fg: '#b57a34' },
  { bg: '#efe8ff', fg: '#7360b7' },
  { bg: '#e4f7f6', fg: '#3c8e89' }
]
const darkEventHeroPalette = [
  { bg: '#4a2530', fg: '#ff8a98' },
  { bg: '#2a3a52', fg: '#7fb0e8' },
  { bg: '#243d2c', fg: '#7ad48a' },
  { bg: '#4a3320', fg: '#e8b075' },
  { bg: '#33294a', fg: '#b29bdc' },
  { bg: '#1d3a3a', fg: '#6ec9c1' }
]

function eventHeroStyle(
  name: string | null | undefined
): Record<string, string> {
  const safe = name ?? ''
  const hash = Array.from(safe).reduce(
    (sum, c) => sum + c.charCodeAt(0),
    0
  )
  const palette =
    themeMode.value === 'dark' ? darkEventHeroPalette : lightEventHeroPalette
  const choice = palette[hash % palette.length]
  return {
    '--avatar-bg': choice.bg,
    '--avatar-fg': choice.fg
  }
}

/** Display the registration status as a compact pill string. */
/** Format a YYYY-MM-DD date string to "Apr 12, 2026" for inline
 *  display alongside the director / entry-fee label pairs. */
function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function setModalOpen(value: boolean) {
  modalOpen.value = value
}
</script>

<template>
  <main class="association-users">
    <AssociationSidebar active-key="events" />
    <section class="association-users__main">
      <!-- Sticky stack — count + search + Create button + filter row -->
      <div ref="stickySentinelRef" class="association-users__sticky-sentinel" aria-hidden="true"></div>
      <div
        class="association-teams__sticky-stack"
        :class="{ 'association-teams__sticky-stack--stuck': toolbarStuck }"
      >
        <header class="association-users__header">
          <p class="association-users__count">
            <strong :title="`${totalCount} events`">{{ formatCompact(totalCount) }}</strong>
            <span>events</span>
          </p>
          <div class="association-teams__header-actions">
            <label class="association-users__search">
              <AppIcon name="search" :size="14" />
              <input
                v-model="search"
                type="search"
                placeholder="Search events"
                class="association-users__search-input"
              />
            </label>
            <button class="association-users__invite-btn" type="button" @click="openCreateModal">
              <span class="association-users__invite-icon association-events__create-icon" aria-hidden="true"></span>
              <span>New Event</span>
            </button>
          </div>
        </header>

        <div class="association-users__toolbar association-teams__toolbar">
          <!-- Filter row mirrors the teams-page pattern:
               - Year is single-value (always carries one value, like
                 Status on teams). Defaults to the server's
                 `defaultYear` so the trigger shows the year on first
                 paint (no placeholder).
               - Event Type is multi-select; empty array = no filter,
                 trigger shows the "Event Type" placeholder (like
                 Age Group / Rating / Gender / State on teams).
               - Past Events is a standalone toggle button — clicking
                 it flips the listing between upcoming and past. -->
          <div class="association-teams__filters">
            <!-- Shimmer placeholder while `fetchEventYears()` is in
                 flight. Sized to match the real dropdown trigger
                 (36px tall, ~72px wide for a year like "2026" + the
                 chevron) so the toolbar doesn't reflow when the
                 shimmer swaps out for the dropdown. -->
            <span
              v-if="yearsLoading"
              class="shimmer-block association-events__year-shimmer"
              aria-hidden="true"
            ></span>
            <MultiSelectDropdown
              v-else
              v-model="yearFilterAsArray"
              :options="yearOptionLabels"
              placeholder="Year"
              single
              :searchable="false"
            />
            <MultiSelectDropdown
              v-model="eventTypeFilterAsArray"
              :options="EVENT_TYPE_LABELS"
              placeholder="Event Type"
              single
              :searchable="false"
            />
            <MultiSelectDropdown
              v-model="statusFilterAsArray"
              :options="STATUS_LABELS"
              placeholder="Status"
              single
              :searchable="false"
            />
            <button
              type="button"
              class="association-events__past-toggle"
              :class="{
                'association-events__past-toggle--on': pastEventsFilter,
                'association-events__past-toggle--locked': pastToggleLocked
              }"
              role="switch"
              :aria-checked="pastEventsFilter ? 'true' : 'false'"
              :aria-disabled="pastToggleLocked ? 'true' : 'false'"
              :disabled="pastToggleLocked"
              :title="pastToggleLocked
                ? (pastEventsFilter
                    ? 'Past events is required when viewing a previous year.'
                    : 'Past events is not available for a future year.')
                : ''"
              @click="pastEventsFilter = !pastEventsFilter"
            >Past Events</button>
            <button
              v-if="hasFilterChanges"
              type="button"
              class="association-teams__filter-reset"
              @click="resetFilters"
            >Reset filter</button>
          </div>
        </div>
      </div>

      <!-- Loading skeleton -->
      <div v-if="loading" class="association-users__list">
        <div v-for="i in 6" :key="'skeleton-' + i" class="association-users__row association-users__row--skeleton">
          <div class="association-users__row-identity">
            <span class="shimmer-block association-events__skeleton-hero"></span>
            <div class="association-users__skeleton-stack">
              <span class="shimmer-block association-users__skeleton-name"></span>
              <span class="shimmer-block association-users__skeleton-email"></span>
            </div>
          </div>
          <div class="association-users__row-permissions">
            <span class="shimmer-block association-users__skeleton-pill"></span>
            <span class="shimmer-block association-users__skeleton-pill"></span>
          </div>
          <span class="shimmer-block association-users__skeleton-pill association-users__skeleton-pill--action"></span>
        </div>
      </div>


      <div v-else-if="events.length === 0" class="association-users__empty">
        <p v-if="search.trim()">No events match "{{ search }}".</p>
        <p v-else-if="pastEventsFilter">No past events match the current filters.</p>
        <p v-else>No events yet. Click "New Event" to add the first one.</p>
      </div>

      <div v-else class="association-users__list">
        <div
          v-for="evt in events"
          :key="evt.id"
          class="association-users__row association-teams__row association-events__row"
        >
          <!-- LEFT (identity column): 80×80 hero thumbnail + copy stack.
               Sits inside the `.association-users__row-identity` flex
               container so the underlying 3-column grid still works
               (identity 1fr · middle 1fr · actions auto). -->
          <div class="association-users__row-identity association-events__row-identity">
            <!-- Hero tile. With an uploaded banner: cropped to fill.
                 Without: a deterministic colored tile carrying the
                 event's first letter (palette matches TeamAvatar so
                 the colored-tile vocabulary reads consistently across
                 users, teams, and events). -->
            <div
              v-if="evt.avatarUrl"
              class="association-events__row-hero"
              aria-hidden="true"
            >
              <img
                :src="evt.avatarUrl"
                :alt="evt.eventName"
                class="association-events__row-hero-img"
              />
            </div>
            <div
              v-else
              class="association-events__row-hero association-events__row-hero--initial"
              :style="eventHeroStyle(evt.eventName)"
              aria-hidden="true"
            >
              <!-- Same calendar SVG the sidebar's "Events" nav item
                   uses (`src/assets/calendar.svg`), rendered via the
                   CSS mask trick so we can paint it with the
                   per-event accent tone (`var(--avatar-fg)`) instead
                   of being locked to the asset's authored color. -->
              <span
                class="association-events__row-hero-icon"
                aria-hidden="true"
              ></span>
            </div>
            <div class="association-users__row-copy">
              <span class="association-teams__row-regline">
                {{ evt.dateRangeLabel || '—' }}
              </span>
              <div class="association-users__row-name-line">
                <StatusBadge
                  :label="statusBadgeLabel(evt.eventStatus)"
                  :tone="statusBadgeTone(evt.eventStatus)"
                />
                <strong class="association-users__row-name">{{ evt.eventName }}</strong>
              </div>
              <span v-if="evt.sportsTypeName || evt.eventType" class="association-teams__row-division">
                {{ evt.sportsTypeName }}<template v-if="evt.sportsTypeName && evt.eventType"> · </template>{{ evt.eventType }}
              </span>
              <span v-if="evt.city || evt.state" class="association-teams__row-location">
                <span class="association-teams__row-icon association-teams__row-icon--location" aria-hidden="true"></span>
                {{ evt.city }}<template v-if="evt.city && evt.state">, </template>{{ evt.state }}
              </span>
              <!-- Director — sits BELOW location in the identity stack
                   (moved out of the right column). -->
              <span v-if="evt.directorName" class="association-teams__row-location">
                <span class="association-teams__row-contact-label">Director</span>
                &nbsp;{{ evt.directorName }}
              </span>
            </div>
          </div>

          <!-- MIDDLE column — entry-fee / deadline lines on top
               (label-value style), team-count breakdown below. -->
          <div class="association-teams__row-contact association-events__row-middle">
            <div class="association-events__row-info">
              <span
                v-if="evt.paymentRequired && evt.entryFee"
                class="association-teams__row-contact-line"
              >
                <span class="association-teams__row-contact-text">
                  <span class="association-teams__row-contact-label">Entry Fee</span>
                  ${{ evt.entryFee }}
                </span>
              </span>
              <span
                v-if="evt.entryFeeDeadline"
                class="association-teams__row-contact-line"
              >
                <span class="association-teams__row-contact-text">
                  <span class="association-teams__row-contact-label">Entry Deadline</span>
                  {{ formatDate(evt.entryFeeDeadline) }}
                </span>
              </span>
            </div>
            <div class="association-events__row-stats">
              <div class="association-events__stat-cell">
                <strong>{{ evt.teamCounts.pending }}</strong>
                <span>Pending</span>
              </div>
              <div class="association-events__stat-cell">
                <strong>{{ evt.teamCounts.confirmed }}</strong>
                <span>Confirmed</span>
              </div>
              <div class="association-events__stat-cell">
                <strong>{{ evt.teamCounts.waitlisted }}</strong>
                <span>Waitlist</span>
              </div>
              <div class="association-events__stat-cell">
                <strong>{{ evt.teamCounts.withdrawn }}</strong>
                <span>Withdrawn</span>
              </div>
            </div>
          </div>

          <!-- RIGHT: ellipsis menu -->
          <div class="association-users__row-actions">
            <button
              type="button"
              class="association-users__row-menu-btn"
              :aria-label="`Actions for ${evt.eventName}`"
              :aria-expanded="openMenuId === evt.id ? 'true' : 'false'"
              @click.stop="toggleMenu(evt.id)"
            >
              <AppIcon name="ellipsis" :size="16" />
            </button>
            <div v-if="openMenuId === evt.id" class="association-users__row-menu" role="menu">
              <button
                type="button"
                class="association-users__row-menu-item"
                role="menuitem"
                @click="openEditModal(evt)"
              >Edit Event</button>
              <!-- MatchGeni — gated by per-event access. Three
                   visual states drive what renders:
                     - Association-FC user (`fc-allowed`) or
                       cached `'allowed'` → clickable menu item.
                     - Cached `'loading'` → shimmer placeholder
                       sized to match the live item so the menu
                       doesn't jump when the fetch resolves.
                     - Cached `'denied'` → nothing renders.
                   The cache is populated on `toggleMenu` open
                   via `ensureMatchGeniMenuAccess` so the fetch
                   begins the moment the user opens the menu. -->
              <button
                v-if="matchGeniMenuStateFor(evt.id) === 'fc-allowed'
                  || matchGeniMenuStateFor(evt.id) === 'allowed'"
                type="button"
                class="association-users__row-menu-item"
                role="menuitem"
                @click="openMatchGeni(evt)"
              >MatchGeni</button>
              <div
                v-else-if="matchGeniMenuStateFor(evt.id) === 'loading'"
                class="shimmer-block association-users__row-menu-item-skeleton"
                aria-hidden="true"
              ></div>
              <!-- Separator before View Event Details. Always
                   rendered since View Event Details is always
                   shown — groups it visually as a navigation-out
                   action distinct from Edit / MatchGeni above. -->
              <div
                class="association-users__row-menu-divider"
                role="separator"
                aria-hidden="true"
              ></div>
              <!-- View on the public site (opens whoifollow.tech /
                   .com /event/detail/<guid> in a new tab). The
                   external-link glyph (arrow leaving a box) hints
                   that the click leaves the admin portal. -->
              <button
                type="button"
                class="association-users__row-menu-item association-users__row-menu-item--external"
                role="menuitem"
                @click="openEventDetailExternal(evt)"
              >
                <span>View Event</span>
                <!-- External-link glyph — shared `external-link.svg`
                     from the design library. The `--link` modifier
                     paints it via CSS mask so this menu item and
                     the MatchGeni header's "View Event" button
                     share the same asset. The generic
                     `…-external-icon` base class is kept so the
                     existing `--external` hover rules still apply;
                     the modifier overrides the `color` transition
                     with `background-color` since masks tint via
                     `background-color`, not text color. -->
                <span
                  class="association-users__row-menu-item-external-icon association-users__row-menu-item-external-icon--link"
                  aria-hidden="true"
                ></span>
              </button>
              <!-- Share — opens a copy-to-clipboard popup with the
                   PUBLIC (unauthenticated) URL for this event so the
                   admin can forward it to anyone. URL pattern:
                   `<webOrigin>/public/event/detail/<guid>`. -->
              <button
                type="button"
                class="association-users__row-menu-item association-users__row-menu-item--external"
                role="menuitem"
                @click="openShareModal(evt)"
              >
                <span>Share</span>
                <!-- Shared `assets/share.svg` from the design library
                     — same source the matchgeni header's Share
                     button uses, painted via CSS mask in the
                     `--share` modifier so the glyph tints with
                     the menu item's `currentColor`. Replaces the
                     inline three-dot SVG that used to live here. -->
                <span
                  class="association-users__row-menu-item-external-icon association-users__row-menu-item-external-icon--share"
                  aria-hidden="true"
                ></span>
              </button>
              <!-- Separator between the navigation entries (Edit /
                   MatchGeni / View Event Details) and the
                   lifecycle-transition entries below. Only rendered
                   when there ARE transitions to show — terminal-state
                   events skip the divider too so the menu doesn't
                   end with a dangling line. -->
              <div
                v-if="allowedTransitionsFor(evt.eventStatus).length > 0"
                class="association-users__row-menu-divider"
                role="separator"
                aria-hidden="true"
              ></div>
              <!-- Allowed lifecycle transitions for this event's
                   current status — see `allowedTransitionsFor()` and
                   the table in `association-events-api-contract.md`
                   §6. Terminal-state events (completed / cancelled)
                   render no transition entries. -->
              <button
                v-for="t in allowedTransitionsFor(evt.eventStatus)"
                :key="t.target"
                type="button"
                class="association-users__row-menu-item"
                :class="{ 'association-users__row-menu-item--danger': t.danger }"
                role="menuitem"
                @click="transitionEvent(evt, t.target)"
              >{{ t.label }}</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Continuous-scroll sentinel -->
      <div
        v-if="!loading && hasMore"
        ref="loadMoreSentinelRef"
        class="association-users__load-more"
        aria-hidden="true"
      >
        <span class="association-users__load-more-spinner"></span>
        <span>Loading more events…</span>
      </div>
    </section>

    <MatchGeniEventFormModal
      :model-value="modalOpen"
      :association-id="currentAssociation?.id ?? ''"
      :association-name="associationShortName"
      :event-id="modalEventId"
      @update:modelValue="setModalOpen($event)"
      @saved="onEventSaved"
    />

    <!-- Lifecycle-transition confirmation. Renders when the admin
         picks Publish / Mark Completed / Cancel from a row's ⋯ menu;
         the API call only fires after Confirm. Markup mirrors the
         existing remove-user confirm panel on the Users page for
         visual + interaction parity. -->
    <Transition name="slide-modal-backdrop">
      <div
        v-if="confirmingTransition"
        class="association-switcher-backdrop"
        role="presentation"
        @click="onTransitionBackdrop"
      >
        <div
          class="association-switcher-panel association-confirm-panel"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="event-transition-title"
        >
          <header class="association-switcher-panel__header">
            <h2 id="event-transition-title" class="association-switcher-panel__title">
              {{ confirmingTransition.label }}
            </h2>
            <button
              type="button"
              class="association-switcher-panel__close"
              aria-label="Close"
              :disabled="confirmTransitionSaving"
              @click="cancelTransition"
            >
              <AppIcon name="close" :size="16" />
            </button>
          </header>
          <div class="association-confirm-panel__body">
            <p class="association-confirm-panel__copy">
              <strong>{{ confirmingTransition.event.eventName }}</strong> —
              {{ transitionConfirmCopy(confirmingTransition.target) }}
            </p>
            <div
              v-if="confirmingTransition.target === 'cancelled'"
              class="floating-input association-events__cancel-reason"
              :class="{ 'floating-input--invalid': cancelReasonError }"
            >
              <textarea
                id="event-cancel-reason"
                v-model="cancelReason"
                rows="3"
                maxlength="500"
                class="floating-input__control association-events__cancel-reason-input"
                :class="{ 'floating-input__control--has-value': !!cancelReason }"
                placeholder=" "
                :disabled="confirmTransitionSaving"
                @blur="cancelReasonTouched = true"
              ></textarea>
              <label for="event-cancel-reason" class="floating-input__label" :class="{ 'floating-input__label--floated': !!cancelReason }">Reason for cancelling</label>
              <span v-if="cancelReasonError" class="floating-input__error-corner">Required</span>
            </div>
          </div>
          <footer class="association-confirm-panel__footer">
            <button
              type="button"
              class="secondary-button"
              :disabled="confirmTransitionSaving"
              @click="cancelTransition"
            >Cancel</button>
            <button
              v-if="confirmingTransition.danger"
              type="button"
              class="danger-light-button"
              :disabled="confirmTransitionSaving"
              @click="confirmTransition"
            >{{ confirmTransitionSaving ? 'Saving…' : `Yes, ${confirmingTransition.label.toLowerCase()}` }}</button>
            <button
              v-else
              type="button"
              class="primary-button association-events__confirm-btn"
              :disabled="confirmTransitionSaving"
              @click="confirmTransition"
            >{{ confirmTransitionSaving ? 'Saving…' : confirmingTransition.label }}</button>
          </footer>
        </div>
      </div>
    </Transition>

    <!-- Share popup — surfaces the public-share URL for the event
         so the admin can copy it. Reuses the switcher-panel chrome
         (backdrop + centered card) so the modal feels native to
         the rest of the portal's confirmation popups. -->
    <!-- Share Event popup — extracted into the shared
         `EventShareModal` component (also used by `MatchGeniHeader`)
         so the same UX powers every Share affordance in the
         portal. Local state still owns the open/closed toggle
         via `sharingEvent`. -->
    <EventShareModal :event="sharingEvent" @close="closeShareModal" />

  </main>
</template>

<style scoped>
/* Flat solid primary (no gradient) for the publish / complete confirm
   button — matches the flat Done buttons used elsewhere. */
.association-events__confirm-btn { background: var(--primary); }
.association-events__confirm-btn:hover:not(:disabled) { background: var(--primary); filter: brightness(1.05); }

/* Cancellation-reason textarea inside the transition confirm dialog. */
.association-events__cancel-reason { margin-top: 14px; }
.association-events__cancel-reason-input { height: auto; min-height: 78px; resize: vertical; line-height: 1.4; padding-top: 12px; }

/* Events-specific styles overlay the shared `.association-users` /
   `.association-teams` skeleton. The shared row uses a
   `1fr · 1fr · auto` grid; for events we widen the identity track
   so longer event names get room (the middle column carries just
   director + entry-fee labels + the registration badge, which need
   far less space). */
.association-events__row.association-users__row {
  /* Identity track gets the slack remaining after the stats column
     sizes to its contents — keeps "Confirmed" / "Withdrawn" labels
     from overflowing the stat cells when window narrows. */
  grid-template-columns: minmax(0, 1fr) auto auto;
}

.association-events__row-identity {
  align-items: flex-start;
  gap: 14px;
}

/* Make the date-range line read dark + comfortable — the shared
   `.association-teams__row-regline` uses the secondary (orange) tone
   at 12px which is hard to read on the listing's tinted background. */
.association-events__row-identity .association-teams__row-regline {
  color: var(--text);
  font-size: 14px;
  font-weight: 500;
}

.association-events__row-hero {
  flex: 0 0 80px;
  width: 80px;
  height: 80px;
  border-radius: 12px;
  /* Fallback surface for image rows (visible briefly while the image
     loads, or if it 404s). Token-driven so it flips with the theme. */
  background: var(--surface-pill);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  color: var(--text-light);
}

.association-events__row-hero-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* Initial-tile variant — used when there's no uploaded banner. The
   per-event color is set inline via the `eventHeroStyle()` helper,
   which writes `--avatar-bg` and `--avatar-fg` CSS custom properties
   (same convention as TeamAvatar). The palette has light + dark
   pairs picked from `themeMode`, so the tile flips with the theme. */
.association-events__row-hero--initial {
  background: var(--avatar-bg);
  /* Kept on the container so any future text inside (e.g. an
     accessibility-only label) also reads in the accent tone. */
  color: var(--avatar-fg);
}

/* Calendar icon rendered via CSS mask of `src/assets/calendar.svg`
   — same asset the sidebar's "Events" nav item paints. Mask + a
   solid `background-color` lets us tint the icon to the per-event
   accent (`var(--avatar-fg)`) without forking the asset. */
.association-events__row-hero-icon {
  width: 32px;
  height: 32px;
  display: block;
  background-color: var(--avatar-fg);
  -webkit-mask-image: url('../assets/calendar.svg');
  mask-image: url('../assets/calendar.svg');
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}

/* Middle column carries entry-fee / deadline lines on top and the
   team-count stats grid pinned to the bottom — info hugs the
   row's top edge, stats hug its bottom edge regardless of how
   tall the identity column on the left grows. */
.association-events__row-middle {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  align-self: stretch;
  min-width: 0;
}

.association-events__row-info {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

/* Create Event icon — override the shared invite-icon mask with the
   generic `add.svg` (plus sign). The shared class keeps the size /
   color treatment; only the mask URL changes. */
.association-events__create-icon {
  -webkit-mask-image: url('../assets/add.svg');
  mask-image: url('../assets/add.svg');
}

/* Team-count stats grid — 4 mini stat cells (pending / confirmed /
   waitlist / withdrawn) at the top of the right column. Each cell
   is a big number + small label below, mirroring the SummaryCard
   pattern used elsewhere in the portal but compact enough to fit
   in the row's middle track. */
.association-events__row-stats {
  display: flex;
  gap: 6px;
  /* Push the stats grid to the bottom of the middle column. Combined
     with `align-self: stretch` on `.row-middle`, this anchors info
     to the top + stats to the bottom regardless of column height. */
  margin-top: auto;
  justify-content: flex-end;
}

.association-events__stat-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  /* Min-width still covers "Confirmed" / "Withdrawn" without truncation
     at the smaller label font. */
  min-width: 64px;
  padding: 5px 8px;
  border-radius: 8px;
  /* Light values restored to the pre-dark-mode hardcoded originals
     for visual parity with the finalised light theme. The dark-mode
     overrides at the bottom of this scoped block re-paint the cell
     with token-driven slate colours. */
  background: #f4f7fb;
}

.association-events__stat-cell strong {
  font-size: 14px;
  font-weight: 600;
  color: #1f2a3d;
  line-height: 1.1;
}

.association-events__stat-cell span {
  font-size: 10px;
  color: #5b6b80;
  letter-spacing: 0.02em;
  margin-top: 2px;
  white-space: nowrap;
}

/* Dark-mode overrides for the stat-cell — light values above are
   the finalised originals; these tokens flip the cell to a lifted
   slate surface with token text colours for readability. Vue's
   scoped-style compiler appends the data-v hash to `.stat-cell`
   automatically; `html.dark-mode` is unscoped and just selects
   the document root. */
html.dark-mode .association-events__stat-cell {
  background: var(--surface-pill);
}

html.dark-mode .association-events__stat-cell strong {
  color: var(--text);
}

html.dark-mode .association-events__stat-cell span {
  color: var(--text-light);
}

/* Past Events toggle — visually matches the MultiSelectDropdown
   trigger so the filter row reads as a uniform strip. The "on"
   state borrows the same applied-blue treatment used when a
   dropdown filter is active. */
.association-events__past-toggle {
  appearance: none;
  display: inline-flex;
  align-items: center;
  height: 36px;
  padding: 0 14px;
  border: 1px solid var(--border-divider);
  border-radius: 5px;
  background: var(--surface-btn-solid);
  color: var(--text);
  font-family: var(--font-body);
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
}

.association-events__past-toggle:hover {
  border-color: var(--border-accent-hover);
}

.association-events__past-toggle--on {
  background: var(--primary-light-3);
  border-color: var(--primary-light-2);
  color: var(--text);
}

/* Locked state — past-events choice is forced by the picked year
   (past year → forced ON, future year → forced OFF). Reads as
   muted + non-interactive without losing the on/off visual so the
   user can still see which side the lock landed on. */
.association-events__past-toggle--locked {
  cursor: not-allowed;
  opacity: 0.65;
}
.association-events__past-toggle--locked:hover {
  border-color: var(--border-divider);
}

.association-events__skeleton-hero {
  width: 80px;
  height: 80px;
  border-radius: 12px;
}

/* Year-filter shimmer placeholder. Dimensions mirror the
   `.multi-select__trigger` button (36px tall + just enough width for
   "2026 ⌄") so swapping shimmer → dropdown doesn't reflow the
   filter row when the years endpoint resolves. */
.association-events__year-shimmer {
  display: inline-block;
  width: 88px;
  height: 36px;
  border-radius: 5px;
  flex: 0 0 auto;
}

/* Responsive — at ≤840px (same breakpoint where the shared
   `.association-users__row` collapses) drop to a 2-column grid:
   identity sits top-left, ellipsis top-right, and the middle column
   (director / entry fee / entry deadline / registration badge)
   wraps to a full-width row below. */
@media (max-width: 840px) {
  .association-events__row.association-users__row {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      "identity actions"
      "middle   middle";
    row-gap: 12px;
  }
  .association-events__row .association-users__row-identity { grid-area: identity; }
  .association-events__row .association-events__row-middle  { grid-area: middle; align-items: flex-start; }
  .association-events__row .association-users__row-actions  { grid-area: actions; align-self: flex-start; }

  /* Once the middle column spans the row, left-align its contents
     so director / entry-fee / deadline read naturally top-down. */
  .association-events__row-info {
    align-items: flex-start;
  }
}

/* Mobile (≤720px) — the row becomes a single edge-to-edge card.
   The 16:9 hero sits flush against the row's top / left / right
   edges with no rounded corners; the copy block + 3-dot ellipsis
   share the next row (date on the left, ellipsis on the right);
   middle column (director / fees / badge) wraps to its own row
   underneath. Achieved by collapsing the `.row-identity` wrapper
   with `display: contents` so the hero + copy participate in the
   outer grid directly. */
@media (max-width: 720px) {
  .association-events__row.association-users__row {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      "hero   hero"
      "copy   actions"
      "middle middle";
    padding: 0;
    column-gap: 12px;
    row-gap: 0;
    /* Reset the desktop grid-template-columns override (3fr 1fr auto). */
    align-items: stretch;
  }

  .association-events__row .association-users__row-identity {
    display: contents;
  }

  .association-events__row .association-events__row-hero {
    grid-area: hero;
    flex: none;
    width: 100%;
    height: auto;
    aspect-ratio: 16 / 9;
    border-radius: 0;
  }

  .association-events__row .association-events__row-hero-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .association-events__row .association-users__row-copy {
    grid-area: copy;
    padding: 14px 0 0 18px;
    min-width: 0;
  }

  .association-events__row .association-users__row-actions {
    grid-area: actions;
    align-self: start;
    padding: 14px 18px 0 0;
  }

  .association-events__row .association-events__row-middle {
    grid-area: middle;
    padding: 12px 18px 14px;
    align-items: flex-start;
  }

  /* Stats grid expands edge-to-edge inside the row's content area;
     each cell flexes to an equal share of the available width. */
  .association-events__row-stats {
    width: 100%;
    justify-content: stretch;
  }
  .association-events__stat-cell {
    flex: 1 1 0;
    min-width: 0;
  }
}

/* Share popup — readonly URL field + inline copy button rendered
   as ONE unified control. The wrapper holds the border, the
   field is borderless and stretches, the button sits flush at
   the right edge inside the same shell so the two read as a
   single composite input. */
/* `.association-share-url*` rules moved into the shared
   `EventShareModal` component's scoped block when the inline
   share modal was extracted. The classes themselves stay the
   same — only the location changed. */
</style>
