<script setup lang="ts">
// UserEventsModal
// ---------------
// Slide-in modal that lists every event the selected user is
// rostered on as an Official. Triggered from the "Official in N
// events" chip on each row of the association users list.
//
// Each row shows the event thumbnail + date + name + subtitle +
// director on the left, and a danger-light "Remove" button on the
// right that pulls the user off that event's official roster.
// Removal is per-event; the modal stays open so an admin can clean
// up multiple events in one sitting.
//
// The modal emits a `count-changed` event whenever a removal lands
// so the parent listing can update the chip's count (and hide the
// chip when the count drops to zero) without a refetch.

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import EventOfficialAccessModal from './EventOfficialAccessModal.vue'
import SlideModal from './SlideModal.vue'
import {
  fetchUserOfficialEvents,
  removeUserFromEvent
} from '../api/officialEvents'
import { currentAssociation } from '../constants/associations'
import { EVENT_PERMISSIONS } from '../constants/eventPermissions'
import { themeMode } from '../theme'
import { pushToast } from '../toast-center'
import type { AssociationUser, EventPermissionKey, OfficialEvent } from '../types'

/** Deterministic colored-tile palette for events that don't have a
 *  banner image — same six hue families used in the association
 *  events listing (`AssociationEventsView.eventHeroStyle`) so the
 *  same event lands on the same colour across both surfaces. */
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
function eventHeroStyle(name: string | null | undefined): Record<string, string> {
  const safe = name ?? ''
  const hash = Array.from(safe).reduce((sum, c) => sum + c.charCodeAt(0), 0)
  const palette = themeMode.value === 'dark' ? darkEventHeroPalette : lightEventHeroPalette
  const choice = palette[hash % palette.length]
  return {
    '--avatar-bg': choice.bg,
    '--avatar-fg': choice.fg
  }
}

/** True when an OfficialEvent has a usable image URL string. The
 *  real backend returns `null` (or omits the field) for events
 *  without a banner; the mock returns a bundled-asset URL string.
 *  Trim guards against empty strings sneaking through. */
function hasEventImage(evt: OfficialEvent): boolean {
  return typeof evt.imageUrl === 'string' && evt.imageUrl.trim() !== ''
}

const props = withDefaults(defineProps<{
  modelValue: boolean
  /** The user whose event roster we're listing. `null` when the
   *  modal isn't open — keeps the prop type honest. */
  user?: AssociationUser | null
  /** Association name used as the modal eyebrow for context. */
  associationName?: string
}>(), {
  user: null,
  associationName: ''
})

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  /** Fired after a removal lands so the parent can sync the user
   *  row's eventOfficialCount and chip. */
  (event: 'count-changed', payload: { userId: string; newCount: number }): void
}>()

const events = ref<OfficialEvent[]>([])
const loading = ref(false)
const removingIds = ref<Set<string>>(new Set())

// Per-row ellipsis menu state — only one row's menu is open at a
// time. Mirrors the pattern used by the user list's row menu.
const openMenuEventId = ref<string | null>(null)
function toggleMenu(eventId: string) {
  openMenuEventId.value = openMenuEventId.value === eventId ? null : eventId
}
function closeMenu() {
  openMenuEventId.value = null
}

function onDocClick(event: MouseEvent) {
  if (!openMenuEventId.value) return
  const target = event.target as HTMLElement
  if (
    !target.closest('.user-events-modal__row-menu') &&
    !target.closest('.user-events-modal__row-menu-btn')
  ) {
    closeMenu()
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onDocClick)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocClick)
  if (loadMoreObserver) {
    loadMoreObserver.disconnect()
    loadMoreObserver = null
  }
})

watch(
  () => props.modelValue,
  (open) => {
    if (open && props.user) void load()
    if (!open) {
      // Reset on close so the next open doesn't flash stale rows.
      events.value = []
    }
  }
)

watch(
  () => props.user,
  (next) => {
    if (props.modelValue && next) void load()
  }
)

// Server-driven pagination state. Mirrors the pattern used by the
// main users list — the contract paginates this endpoint too, so
// we exercise it the same way (page 1 on open, load more on scroll
// if the user has > PAGE_SIZE events). Most users will fit in a
// single page; the load-more sentinel only mounts when hasMore.
const PAGE_SIZE = 25
const currentPage = ref(0)
const lastPage = ref(1)

async function load() {
  if (!props.user) return
  // The endpoint keys on the ASSOCIATION's numeric PK (from
  // `currentAssociation`), not on the URL slug — same convention
  // used by every other portal listing call. Defensive bail if
  // somehow the router-guard's membership fetch hasn't landed yet.
  const associationId = currentAssociation.value?.id
  if (!associationId) return
  loading.value = true
  try {
    const result = await fetchUserOfficialEvents(
      associationId,
      props.user.id,
      { page: 1, perPage: PAGE_SIZE }
    )
    events.value = result.data
    currentPage.value = result.current_page
    lastPage.value = result.last_page
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not load events',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
    events.value = []
    currentPage.value = 0
    lastPage.value = 1
  } finally {
    loading.value = false
  }
}

const loadingMore = ref(false)
const hasMore = computed(() => currentPage.value < lastPage.value)

async function loadMore() {
  if (!props.user || loadingMore.value || !hasMore.value) return
  const associationId = currentAssociation.value?.id
  if (!associationId) return
  loadingMore.value = true
  try {
    const result = await fetchUserOfficialEvents(
      associationId,
      props.user.id,
      { page: currentPage.value + 1, perPage: PAGE_SIZE }
    )
    events.value = [...events.value, ...result.data]
    currentPage.value = result.current_page
    lastPage.value = result.last_page
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not load more events',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    loadingMore.value = false
  }
}

const loadMoreSentinelRef = ref<HTMLElement | null>(null)
let loadMoreObserver: IntersectionObserver | null = null

watch(loadMoreSentinelRef, (el, prev) => {
  if (loadMoreObserver && prev) loadMoreObserver.unobserve(prev)
  if (!el || typeof IntersectionObserver === 'undefined') return
  if (!loadMoreObserver) {
    loadMoreObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && hasMore.value && !loadingMore.value) {
            void loadMore()
          }
        }
      },
      { rootMargin: '200px 0px', threshold: 0 }
    )
  }
  loadMoreObserver.observe(el)
})

async function onRemove(event: OfficialEvent) {
  if (!props.user || removingIds.value.has(event.id)) return
  if (!event.officialId) {
    pushToast({
      tone: 'warning',
      title: 'Cannot remove access',
      message: 'This event row is missing its grant id; please reload the modal and try again.'
    })
    return
  }
  closeMenu()
  removingIds.value.add(event.id)
  try {
    const { newCount } = await removeUserFromEvent(
      currentAssociation.value?.id ?? '',
      event.id,
      event.officialId
    )
    events.value = events.value.filter((e) => e.id !== event.id)
    emit('count-changed', { userId: props.user.id, newCount })
    pushToast({
      tone: 'success',
      title: 'Removed from event',
      message: `${props.user.name} is no longer an Official on ${event.name}.`
    })
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not remove',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    removingIds.value.delete(event.id)
  }
}

/** Resolve a permission key set to a stable, sorted list of display
 *  labels — matches the order in EVENT_PERMISSIONS so chips render
 *  in the catalog's canonical sequence regardless of how the
 *  backend returns the array. */
/** Permission labels surfaced as neutral chips. We intentionally
 *  skip `manage_scoring` here — when granted, it's surfaced via the
 *  warning-tone scoring chip below (which also carries the scope:
 *  "Scoring: All games" / "Scoring: 3 parks" / etc.) so the two
 *  representations don't duplicate each other. */
function permissionLabelsForEvent(keys: EventPermissionKey[]): string[] {
  return EVENT_PERMISSIONS
    .filter((p) => keys.includes(p.key) && p.key !== 'manage_scoring')
    .map((p) => p.label)
}

/** Warning-tone scoring chip — shown whenever the user holds
 *  `manage_scoring`. Label folds the scope into the chip so an admin
 *  sees both the grant + its reach at a glance:
 *    - `mode: 'all'`       → "Scoring: All games"
 *    - `mode: 'parks'`     → "Scoring: 3 parks"
 *    - `mode: 'divisions'` → "Scoring: 2 divisions"
 *  Returns `null` when scoring isn't granted (or fullControl is on
 *  — that case already collapses to a single "Full Control" chip). */
function scopeSummaryForEvent(event: OfficialEvent): string | null {
  if (event.fullControl) return null
  if (!event.permissions.includes('manage_scoring')) return null
  const scope = event.scoringScope
  if (!scope || scope.mode === 'all') return 'Scoring: All games'
  if (scope.mode === 'parks') {
    return `Scoring: ${scope.parkIds.length} park${scope.parkIds.length === 1 ? '' : 's'}`
  }
  return `Scoring: ${scope.divisionIds.length} division${scope.divisionIds.length === 1 ? '' : 's'}`
}

// Edit Access flow — opens the EventOfficialAccessModal pre-filled
// with the clicked event's current grant. Saving updates the event
// in this modal's list without a refetch.
const accessModalOpen = ref(false)
const accessModalEvent = ref<OfficialEvent | null>(null)

function openEditAccess(event: OfficialEvent) {
  closeMenu()
  accessModalEvent.value = event
  accessModalOpen.value = true
}

function onAccessSaved(updated: OfficialEvent) {
  const index = events.value.findIndex((e) => e.id === updated.id)
  if (index !== -1) {
    events.value = [
      ...events.value.slice(0, index),
      updated,
      ...events.value.slice(index + 1)
    ]
  }
  accessModalEvent.value = null
}
</script>

<template>
  <!-- Single root required by Vue 2.7's template compiler. Both
       children are position:fixed (their backdrops cover the
       viewport), so this wrapper has zero layout impact. -->
  <div>
  <SlideModal
    :model-value="modelValue"
    :title="user ? `${user.name}'s Events` : 'Events as Official'"
    :subtitle="user ? `${user.name} is rostered as an Official on the following events.` : ''"
    :eyebrow="associationName"
    @update:modelValue="emit('update:modelValue', $event)"
  >
    <section class="user-events-modal__section">
      <!-- Skeleton state — shimmer rows mirror the real row's
           layout (thumbnail + stacked meta lines + remove button)
           so the modal doesn't visibly reflow when data lands. -->
      <ul v-if="loading" class="user-events-modal__list" aria-hidden="true">
        <li
          v-for="n in 5"
          :key="`skeleton-${n}`"
          class="user-events-modal__row user-events-modal__row--skeleton"
        >
          <div class="user-events-modal__event">
            <span class="shimmer-block user-events-modal__skeleton-thumbnail"></span>
            <div class="user-events-modal__skeleton-stack">
              <span class="shimmer-block user-events-modal__skeleton-line user-events-modal__skeleton-line--date"></span>
              <span class="shimmer-block user-events-modal__skeleton-line user-events-modal__skeleton-line--name"></span>
              <span class="shimmer-block user-events-modal__skeleton-line user-events-modal__skeleton-line--location"></span>
              <span class="shimmer-block user-events-modal__skeleton-line user-events-modal__skeleton-line--director"></span>
            </div>
          </div>
          <span class="shimmer-block user-events-modal__skeleton-button"></span>
        </li>
      </ul>
      <div v-else-if="events.length === 0" class="user-events-modal__empty">
        <p>No events to show — this user is not currently rostered on any event.</p>
      </div>
      <ul v-else class="user-events-modal__list">
        <li
          v-for="event in events"
          :key="event.id"
          class="user-events-modal__row"
        >
          <!-- LEFT: event thumbnail + meta block. Events without a
               banner image fall back to a deterministic colored
               tile carrying the calendar glyph — same palette +
               icon treatment as the association events listing so
               an event looks identical across both surfaces. -->
          <div class="user-events-modal__event">
            <img
              v-if="hasEventImage(event)"
              :src="event.imageUrl"
              alt=""
              aria-hidden="true"
              class="user-events-modal__thumbnail"
            />
            <div
              v-else
              class="user-events-modal__thumbnail user-events-modal__thumbnail--initial"
              :style="eventHeroStyle(event.name)"
              aria-hidden="true"
            >
              <span class="user-events-modal__thumbnail-icon" aria-hidden="true"></span>
            </div>
            <div class="user-events-modal__meta">
              <span class="user-events-modal__date">{{ event.dateRange }}</span>
              <strong class="user-events-modal__name">{{ event.name }}</strong>
              <span class="user-events-modal__location">{{ event.location }}</span>
              <span class="user-events-modal__subtitle">{{ event.subtitle }}</span>
              <span class="user-events-modal__director">Director: {{ event.director }}</span>
              <!-- Event-scoped grants for THIS user on THIS event.
                   Full Control short-circuits to a single highlighted
                   chip. Otherwise: per-permission chips, or the
                   italic empty-state copy if neither applies. Same
                   render rules as the association-user permissions
                   column for consistency. -->
              <div class="user-events-modal__permissions">
                <template v-if="event.fullControl">
                  <span class="user-events-modal__permission-chip user-events-modal__permission-chip--full">
                    Full Control · all permissions
                  </span>
                </template>
                <template v-else-if="event.permissions.length > 0">
                  <span
                    v-for="label in permissionLabelsForEvent(event.permissions)"
                    :key="label"
                    class="user-events-modal__permission-chip"
                  >{{ label }}</span>
                </template>
                <template v-else>
                  <span class="user-events-modal__permission-empty">No event permissions assigned</span>
                </template>
                <!-- Scoring scope summary — same warning-tone chip
                     used on the MatchGeni officials row so the two
                     surfaces read consistently. Only shows when the
                     user holds `manage_scoring` AND the scope is
                     restricted to parks / divisions. -->
                <span
                  v-if="scopeSummaryForEvent(event)"
                  class="association-users__row-event-chip"
                >{{ scopeSummaryForEvent(event) }}</span>
              </div>
            </div>
          </div>
          <!-- RIGHT: ellipsis menu — opens a small popover with the
               destructive "Remove Access" action. Mirrors the user-
               list row menu so the interaction feels consistent. -->
          <div class="user-events-modal__row-actions">
            <button
              type="button"
              class="user-events-modal__row-menu-btn"
              :aria-label="`Actions for ${event.name}`"
              :aria-expanded="openMenuEventId === event.id ? 'true' : 'false'"
              :disabled="removingIds.has(event.id)"
              @click.stop="toggleMenu(event.id)"
            >
              <AppIcon name="ellipsis" :size="16" />
            </button>
            <div
              v-if="openMenuEventId === event.id"
              class="user-events-modal__row-menu"
              role="menu"
            >
              <button
                type="button"
                class="user-events-modal__row-menu-item"
                role="menuitem"
                @click="openEditAccess(event)"
              >Edit Access</button>
              <button
                type="button"
                class="user-events-modal__row-menu-item user-events-modal__row-menu-item--danger"
                role="menuitem"
                :disabled="removingIds.has(event.id)"
                @click="onRemove(event)"
              >{{ removingIds.has(event.id) ? 'Removing…' : 'Remove Access' }}</button>
            </div>
          </div>
        </li>
      </ul>
      <!-- Load-more sentinel — only mounts when the server reports
           more pages. Mirrors the pattern in the main users list. -->
      <div
        v-if="!loading && hasMore"
        ref="loadMoreSentinelRef"
        class="user-events-modal__load-more"
        aria-hidden="true"
      >
        <span>{{ loadingMore ? 'Loading…' : '' }}</span>
      </div>
    </section>

  </SlideModal>

  <!-- Mounted as a sibling of SlideModal so it slides in OVER the
       user-events panel. The user-events panel stays open behind it. -->
  <EventOfficialAccessModal
    :model-value="accessModalOpen"
    :user="user"
    :event="accessModalEvent"
    :association-name="associationName"
    @update:modelValue="accessModalOpen = $event"
    @saved="onAccessSaved"
  />
  </div>
</template>
