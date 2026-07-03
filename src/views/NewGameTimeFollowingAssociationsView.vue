<script setup lang="ts">
// NewGameTimeFollowingAssociationsView
// ------------------------------------
// Authed "New Game Time" → Associations › Following list. Optimised
// replacement for the legacy customerfrontend
// NewGameTime/Associations/FollowingAssociations.vue.
//
// Mirrors NewGameTimeDiscoverAssociationsView exactly; the only behavioral
// difference is the data source (GET /v2/discover/associations/following) and
// that unfollowing a row removes it from this list (it's the "following" tab).
// REUSES his global classes + shared components. No invented UI.
//
// Data: src/api/discoverAssociations.ts.
// Contract: docs/api/newgametime-associations-api-contract.md.

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import NgtAssociationCard from '../components/gametime/NgtAssociationCard.vue'
import {
  fetchFollowingAssociations,
  unfollowDiscoverAssociation,
  type DiscoverAssociation
} from '../api/discoverAssociations'
import { pushToast } from '../toast-center'
import { formatCompact } from '../utils/formatNumber'

const associations = ref<DiscoverAssociation[]>([])
const loading = ref(true)
const loadingMore = ref(false)
const search = ref('')

const PAGE_SIZE = 25
const currentPage = ref(0)
const lastPage = ref(1)
const totalCount = ref(0)

let fetchToken = 0

async function loadPage(mode: 'reset' | 'append') {
  const myToken = ++fetchToken
  const nextPage = mode === 'reset' ? 1 : currentPage.value + 1
  if (mode === 'reset') loading.value = true
  else loadingMore.value = true
  try {
    const result = await fetchFollowingAssociations({
      search: search.value,
      page: nextPage,
      perPage: PAGE_SIZE
    })
    if (myToken !== fetchToken) return
    associations.value =
      mode === 'reset' ? result.associations : [...associations.value, ...result.associations]
    currentPage.value = result.currentPage
    lastPage.value = result.lastPage
    totalCount.value = result.total
  } catch (error) {
    if (myToken !== fetchToken) return
    pushToast({
      tone: 'warning',
      title: 'Could not load associations',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
    if (mode === 'reset') associations.value = []
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

// ── Unfollow — removes the row from this "following" list ─────────────
const followBusy = ref<Set<string>>(new Set())

async function unfollow(assoc: DiscoverAssociation) {
  if (followBusy.value.has(assoc.id)) return
  followBusy.value = new Set(followBusy.value).add(assoc.id)
  try {
    await unfollowDiscoverAssociation(assoc.id)
    associations.value = associations.value.filter((a) => a.id !== assoc.id)
    totalCount.value = Math.max(0, totalCount.value - 1)
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not unfollow',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    const next = new Set(followBusy.value)
    next.delete(assoc.id)
    followBusy.value = next
  }
}

function metaLabel(assoc: DiscoverAssociation): string {
  return [assoc.city, assoc.state].filter(Boolean).join(', ')
}

onMounted(() => {
  void loadPage('reset')
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
       are owned by NewGameTimeLayout; this view renders only column 2. -->
  <section class="association-users__main">
    <div ref="stickySentinelRef" class="association-users__sticky-sentinel" aria-hidden="true"></div>
    <div
      class="association-teams__sticky-stack"
      :class="{ 'association-teams__sticky-stack--stuck': toolbarStuck }"
    >
      <header class="association-users__header">
        <p class="association-users__count">
          <strong :title="`${totalCount} associations`">{{ formatCompact(totalCount) }}</strong>
          <span>following</span>
        </p>
        <div class="association-teams__header-actions">
          <label class="association-users__search">
            <AppIcon name="search" :size="14" />
            <input
              v-model="search"
              type="search"
              placeholder="Search associations"
              class="association-users__search-input"
            />
          </label>
        </div>
      </header>
    </div>

    <!-- Loading skeleton -->
    <div v-if="loading" class="ngt-acards">
      <div v-for="i in 8" :key="'skeleton-' + i" class="shimmer-block ngt-acards__skel"></div>
    </div>

    <div v-else-if="associations.length === 0" class="association-users__empty">
      <p v-if="search.trim()">No followed associations match "{{ search }}".</p>
      <p v-else>You're not following any associations yet.</p>
    </div>

    <div v-else class="ngt-acards">
      <NgtAssociationCard
        v-for="assoc in associations"
        :key="assoc.id"
        :association="assoc"
        :follow-busy="followBusy.has(assoc.id)"
        @toggle-follow="unfollow"
      />
    </div>

    <div
      v-if="!loading && hasMore"
      ref="loadMoreSentinelRef"
      class="association-users__load-more"
      aria-hidden="true"
    >
      <span class="association-users__load-more-spinner"></span>
      <span>Loading more associations…</span>
    </div>
  </section>
</template>

<style scoped>
/* Association card grid (cards are the shared NgtAssociationCard component). */
.ngt-acards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 18px;
  padding: 4px 0 8px;
}
.ngt-acards__skel { height: 320px; border-radius: 16px; }
</style>
