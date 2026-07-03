<script setup lang="ts">
// NewGameTimeFollowingEventsView
// ------------------------------
// "New Game Time" → Events › Following list. The Discover view with the
// fetcher swapped to GET /v2/discover/events/following (auth required) —
// events the current user follows. Optimised replacement for the legacy
// customerfrontend NewGameTime/Events/FollowingEvents.vue
// (`eventfollower/getEventFollowers`).
//
// Mirrors NewGameTimeDiscoverEventsView EXACTLY: same sticky toolbar +
// filter row + continuous-scroll list + event-hero rows, same REUSED global
// classes (.association-users__* / .association-events__* /
// .association-teams__*) + shared components (AppIcon, MultiSelectDropdown).
// No invented UI. The Follow toggle stays: unfollowing here drops the card
// from the list (it no longer belongs in "Following").
//
// Data: src/api/discoverEvents.ts → fetchFollowingEvents.
// Contract: docs/api/newgametime-discover-events-api-contract.md.

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import MultiSelectDropdown from '../components/MultiSelectDropdown.vue'
import {
  fetchFollowingEvents,
  fetchEventYears,
  followDiscoverEvent,
  unfollowDiscoverEvent,
  type DiscoverEvent
} from '../api/discoverEvents'
import NgtEventCard from '../components/gametime/NgtEventCard.vue'
import NgtViewToggle from '../components/gametime/NgtViewToggle.vue'
import { gameTimeView } from '../game-time-view'
import { themeMode } from '../theme'
import { pushToast } from '../toast-center'
import { formatCompact } from '../utils/formatNumber'

const events = ref<DiscoverEvent[]>([])
const loading = ref(true)
const loadingMore = ref(false)
const search = ref('')

const PAGE_SIZE = 25
const currentPage = ref(0)
const lastPage = ref(1)
const totalCount = ref(0)
const availableYears = ref<number[]>([])

// Filters — Year (single, always set) + Past Events toggle.
const currentYear = new Date().getFullYear()
const yearFilter = ref<number>(currentYear)
const pastEventsFilter = ref(false)

const userTimezone =
  typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined

// Bridge for MultiSelectDropdown (speaks string[]).
const yearFilterAsArray = computed<string[]>({
  get: () => [String(yearFilter.value)],
  set: (next) => {
    if (!next.length) return
    const n = Number(next[next.length - 1])
    if (Number.isFinite(n)) yearFilter.value = n
  }
})
const yearOptionLabels = computed<string[]>(() => {
  const years = availableYears.value.length ? availableYears.value : [currentYear]
  return years.map((y) => String(y))
})

let fetchToken = 0

async function loadPage(mode: 'reset' | 'append') {
  const myToken = ++fetchToken
  const nextPage = mode === 'reset' ? 1 : currentPage.value + 1
  if (mode === 'reset') loading.value = true
  else loadingMore.value = true
  try {
    const result = await fetchFollowingEvents({
      year: yearFilter.value,
      pastEvents: pastEventsFilter.value,
      search: search.value,
      page: nextPage,
      perPage: PAGE_SIZE,
      timezone: userTimezone
    })
    if (myToken !== fetchToken) return
    events.value = mode === 'reset' ? result.events : [...events.value, ...result.events]
    currentPage.value = result.currentPage
    lastPage.value = result.lastPage
    totalCount.value = result.total
    // Available years come from the separate /years endpoint (see onMounted).
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

// Debounced search.
const SEARCH_DEBOUNCE_MS = 500
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null
watch(search, () => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  searchDebounceTimer = setTimeout(() => {
    searchDebounceTimer = null
    loadPage('reset')
  }, SEARCH_DEBOUNCE_MS)
})

// Viewing a past year implies past events; future/current leaves the toggle free.
watch(yearFilter, (year) => {
  const shouldBePast = year < currentYear
  if (pastEventsFilter.value !== shouldBePast) pastEventsFilter.value = shouldBePast
})

watch([yearFilter, pastEventsFilter], () => {
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer)
    searchDebounceTimer = null
  }
  loadPage('reset')
})

// Continuous scroll.
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

// ── Sticky toolbar — paints a solid background + shadow once pinned ───
const toolbarStuck = ref(false)
const stickySentinelRef = ref<HTMLElement | null>(null)
let stickyObserver: IntersectionObserver | null = null

// ── Follow / unfollow ────────────────────────────────────────────────
// In the Following list, unfollowing removes the card (it no longer belongs).
const followBusy = ref<Set<string>>(new Set())

async function toggleFollow(evt: DiscoverEvent) {
  if (followBusy.value.has(evt.id)) return
  followBusy.value = new Set(followBusy.value).add(evt.id)
  const wasFollowing = evt.isFollowing
  try {
    if (wasFollowing) {
      await unfollowDiscoverEvent(evt.id)
      events.value = events.value.filter((e) => e.id !== evt.id)
      totalCount.value = Math.max(0, totalCount.value - 1)
    } else {
      const followId = await followDiscoverEvent(evt.id)
      evt.isFollowing = true
      evt.followId = followId
    }
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: wasFollowing ? 'Could not unfollow' : 'Could not follow',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    const next = new Set(followBusy.value)
    next.delete(evt.id)
    followBusy.value = next
  }
}

function openExternal(url?: string) {
  if (url) window.open(url, '_blank', 'noopener,noreferrer')
}

function mapsUrl(evt: DiscoverEvent): string {
  const { lat, lng, city, state } = evt.location
  const q = lat && lng ? `${lat},${lng}` : [city, state].filter(Boolean).join(', ')
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
}
function locationLabel(evt: DiscoverEvent): string {
  return [evt.location.city, evt.location.state].filter(Boolean).join(', ')
}

// Event-hero initial-tile palette — copied from AssociationEventsView so
// no-banner events get the same deterministic colored tile vocabulary.
const lightEventHeroPalette = [
  { bg: '#fbe4e6', fg: '#bb5964' }, { bg: '#e7f1ff', fg: '#477bb2' },
  { bg: '#eaf8eb', fg: '#468957' }, { bg: '#fff0df', fg: '#b57a34' },
  { bg: '#efe8ff', fg: '#7360b7' }, { bg: '#e4f7f6', fg: '#3c8e89' }
]
const darkEventHeroPalette = [
  { bg: '#4a2530', fg: '#ff8a98' }, { bg: '#2a3a52', fg: '#7fb0e8' },
  { bg: '#243d2c', fg: '#7ad48a' }, { bg: '#4a3320', fg: '#e8b075' },
  { bg: '#33294a', fg: '#b29bdc' }, { bg: '#1d3a3a', fg: '#6ec9c1' }
]
function eventHeroStyle(name: string): Record<string, string> {
  const hash = Array.from(name).reduce((sum, c) => sum + c.charCodeAt(0), 0)
  const palette = themeMode.value === 'dark' ? darkEventHeroPalette : lightEventHeroPalette
  const choice = palette[hash % palette.length]
  return { '--avatar-bg': choice.bg, '--avatar-fg': choice.fg }
}

onMounted(() => {
  void loadPage('reset')
  void fetchEventYears('following').then((y) => { if (y.length) availableYears.value = y })
  if (typeof IntersectionObserver !== 'undefined' && stickySentinelRef.value) {
    stickyObserver = new IntersectionObserver(
      ([entry]) => {
        toolbarStuck.value = !entry.isIntersecting
      },
      { rootMargin: '0px', threshold: 0 }
    )
    stickyObserver.observe(stickySentinelRef.value)
  }
})
onBeforeUnmount(() => {
  if (loadMoreObserver) loadMoreObserver.disconnect()
  if (stickyObserver) stickyObserver.disconnect()
})
</script>

<template>
  <!-- Root = the grid's main column. The `.association-users` shell + sidebar
       are owned by NewGameTimeLayout; this view renders only column 2, which
       his global CSS caps at `max-width: 1024px; margin: 0 auto` (centered
       content with right-side space). -->
  <section class="association-users__main">
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
          </div>
        </header>

        <div class="association-users__toolbar association-teams__toolbar">
          <div class="association-teams__filters">
            <MultiSelectDropdown
              v-model="yearFilterAsArray"
              :options="yearOptionLabels"
              placeholder="Year"
              single
              :searchable="false"
            />
            <button
              type="button"
              class="association-events__past-toggle"
              :class="{ 'association-events__past-toggle--on': pastEventsFilter }"
              role="switch"
              :aria-checked="pastEventsFilter ? 'true' : 'false'"
              @click="pastEventsFilter = !pastEventsFilter"
            >Past Events</button>
          </div>
          <NgtViewToggle />
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
        </div>
      </div>

      <div v-else-if="events.length === 0" class="association-users__empty">
        <p v-if="search.trim()">No followed events match "{{ search }}".</p>
        <p v-else-if="pastEventsFilter">No past followed events match the current filters.</p>
        <p v-else>No followed events found. Head over to Discover Events to find something interesting.</p>
      </div>

      <template v-else>
        <!-- Card view -->
        <div v-if="gameTimeView === 'card'" class="ngt-cards">
          <NgtEventCard
            v-for="evt in events"
            :key="evt.id"
            :event="evt"
            :follow-busy="followBusy.has(evt.id)"
            @toggle-follow="toggleFollow"
          />
        </div>
        <!-- List view — the original row layout -->
        <div v-else class="association-users__list">
          <div
            v-for="evt in events"
            :key="evt.id"
            class="association-users__row association-teams__row association-events__row"
          >
            <div class="association-users__row-identity association-events__row-identity">
              <div v-if="evt.avatarUrl" class="association-events__row-hero" aria-hidden="true">
                <img :src="evt.avatarUrl" :alt="evt.name" class="association-events__row-hero-img" />
              </div>
              <div
                v-else
                class="association-events__row-hero association-events__row-hero--initial"
                :style="eventHeroStyle(evt.name)"
                aria-hidden="true"
              >
                <span class="association-events__row-hero-icon" aria-hidden="true"></span>
              </div>
              <div class="association-users__row-copy">
                <span class="association-teams__row-regline">{{ evt.dateRangeLabel || '—' }}</span>
                <div class="association-users__row-name-line">
                  <strong class="association-users__row-name">{{ evt.name }}</strong>
                </div>
                <span v-if="evt.association.name || evt.eventType" class="association-teams__row-division">
                  {{ evt.association.name }}<template v-if="evt.association.name && evt.eventType"> · </template>{{ evt.eventType }}
                </span>
                <span v-if="evt.directorName" class="association-teams__row-location">
                  <span class="association-teams__row-contact-label">Director</span>
                  &nbsp;{{ evt.directorName }}
                </span>
              </div>
            </div>

            <div class="association-events__row-middle">
              <div class="association-events__row-info">
                <button
                  v-if="evt.status === '2' && evt.externalUrl"
                  type="button"
                  class="association-teams__row-location association-events__row-link"
                  @click="openExternal(evt.externalUrl)"
                >{{ evt.externalUrl }}</button>
                <button
                  v-else-if="locationLabel(evt)"
                  type="button"
                  class="association-teams__row-location association-events__row-link"
                  @click="openExternal(mapsUrl(evt))"
                >
                  <span class="association-teams__row-icon association-teams__row-icon--location" aria-hidden="true"></span>
                  {{ locationLabel(evt) }}
                </button>
              </div>
              <button
                type="button"
                class="association-events__follow-btn"
                :class="{ 'association-events__follow-btn--following': evt.isFollowing }"
                :disabled="followBusy.has(evt.id)"
                :aria-pressed="evt.isFollowing ? 'true' : 'false'"
                @click="toggleFollow(evt)"
              >
                <span class="association-events__follow-icon" aria-hidden="true"></span>
                {{ evt.isFollowing ? 'Following' : 'Follow' }}
              </button>
            </div>
          </div>
        </div>
      </template>

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
</template>

<style scoped>
/* Attractive event card grid (cards are the shared NgtEventCard component). */
.ngt-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(258px, 1fr));
  gap: 18px;
  padding: 4px 0 8px;
}
.ngt-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px 0 8px;
}
.association-teams__toolbar {
  justify-content: space-between;
  align-items: center;
}

/* Reuse the events row hero + past-toggle treatment from
   AssociationEventsView (those rules are component-scoped there, so the
   handful we depend on are restated here against the same shared global
   row classes). */
.association-events__row.association-users__row {
  grid-template-columns: minmax(0, 1fr) auto;
}
.association-events__row-identity { align-items: flex-start; gap: 14px; }
.association-events__row-identity .association-teams__row-regline {
  color: var(--text); font-size: 14px; font-weight: 500;
}
.association-events__row-hero {
  flex: 0 0 80px; width: 80px; height: 80px; border-radius: 12px;
  background: var(--surface-pill); display: flex; align-items: center;
  justify-content: center; overflow: hidden; color: var(--text-light);
}
.association-events__row-hero-img { width: 100%; height: 100%; object-fit: cover; }
.association-events__row-hero--initial { background: var(--avatar-bg); color: var(--avatar-fg); }
.association-events__row-hero-icon {
  width: 32px; height: 32px; display: block; background-color: var(--avatar-fg);
  -webkit-mask-image: url('../assets/calendar.svg'); mask-image: url('../assets/calendar.svg');
  -webkit-mask-position: center; mask-position: center;
  -webkit-mask-size: contain; mask-size: contain;
  -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
}
.association-events__row-middle {
  display: flex; flex-direction: column; align-items: flex-end;
  align-self: stretch; min-width: 0; gap: 12px;
}
.association-events__row-info { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.association-events__row-link {
  appearance: none; background: none; border: none; padding: 0;
  cursor: pointer; color: var(--text-light); font: inherit; text-align: right;
}
.association-events__row-link:hover { color: var(--primary); }

/* Follow toggle — reuses the past-toggle pill treatment so it reads as
   part of the same finalised control vocabulary. "Following" uses the
   applied-blue state; "Follow" is the neutral solid. */
.association-events__follow-btn {
  appearance: none; display: inline-flex; align-items: center; height: 34px;
  padding: 0 16px; border: 1px solid var(--border-divider); border-radius: 5px;
  background: var(--surface-btn-solid); color: var(--text);
  font-family: var(--font-body); font-size: 0.85rem; font-weight: 500;
  cursor: pointer; margin-top: auto;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
}
.association-events__follow-btn:hover:not(:disabled) { border-color: var(--border-accent-hover); }
.association-events__follow-btn:disabled { opacity: 0.65; cursor: progress; }
.association-events__follow-btn--following {
  background: var(--primary-light-3); border-color: var(--primary-light-2); color: var(--text);
}

.association-events__past-toggle {
  appearance: none; display: inline-flex; align-items: center; height: 36px;
  padding: 0 14px; border: 1px solid var(--border-divider); border-radius: 5px;
  background: var(--surface-btn-solid); color: var(--text);
  font-family: var(--font-body); font-size: 0.85rem; font-weight: 500; cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
}
.association-events__past-toggle:hover { border-color: var(--border-accent-hover); }
.association-events__past-toggle--on {
  background: var(--primary-light-3); border-color: var(--primary-light-2); color: var(--text);
}
.association-events__skeleton-hero { width: 80px; height: 80px; border-radius: 12px; }
</style>
