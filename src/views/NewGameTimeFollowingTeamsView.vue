<script setup lang="ts">
// NewGameTimeFollowingTeamsView
// -----------------------------
// "New Game Time" → Teams › Following list. Optimised replacement for the
// legacy customerfrontend NewGameTime/Teams/FollowingTeams.vue.
//
// Same layout/classes as NewGameTimeDiscoverTeamsView — every row is a team
// the current user follows, so the Follow toggle starts in the "Following"
// state and unfollowing removes the row from the list. Auth required.
//
// Data: src/api/discoverTeams.ts → GET /v2/discover/teams/following.
// Contract: docs/api/newgametime-teams-api-contract.md.

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import TeamAvatar from '../components/TeamAvatar.vue'
import {
  fetchFollowingTeams,
  followTeam,
  unfollowTeam,
  type DiscoverTeam
} from '../api/discoverTeams'
import NgtTeamCard from '../components/gametime/NgtTeamCard.vue'
import NgtViewToggle from '../components/gametime/NgtViewToggle.vue'
import { gameTimeView } from '../game-time-view'
import { pushToast } from '../toast-center'
import { formatCompact } from '../utils/formatNumber'

const teams = ref<DiscoverTeam[]>([])
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
    const result = await fetchFollowingTeams({
      search: search.value,
      page: nextPage,
      perPage: PAGE_SIZE
    })
    if (myToken !== fetchToken) return
    teams.value = mode === 'reset' ? result.teams : [...teams.value, ...result.teams]
    currentPage.value = result.currentPage
    lastPage.value = result.lastPage
    totalCount.value = result.total
  } catch (error) {
    if (myToken !== fetchToken) return
    pushToast({
      tone: 'warning',
      title: 'Could not load teams',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
    if (mode === 'reset') teams.value = []
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

// ── Follow / unfollow ────────────────────────────────────────────────
// Unfollowing here removes the row from the Following list (after a brief
// busy state), matching the legacy FollowingTeams behavior.
const followBusy = ref<Set<string>>(new Set())

async function toggleFollow(team: DiscoverTeam) {
  if (followBusy.value.has(team.id)) return
  followBusy.value = new Set(followBusy.value).add(team.id)
  const wasFollowing = team.isFollowing
  try {
    if (wasFollowing) {
      await unfollowTeam(team.id)
      teams.value = teams.value.filter((t) => t.id !== team.id)
      totalCount.value = Math.max(0, totalCount.value - 1)
    } else {
      const followId = await followTeam(team.id)
      team.isFollowing = true
      team.followId = followId
    }
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: wasFollowing ? 'Could not unfollow' : 'Could not follow',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    const next = new Set(followBusy.value)
    next.delete(team.id)
    followBusy.value = next
  }
}

function metaLine(team: DiscoverTeam): string {
  return [team.ageGroup, team.rating, team.gender].filter(Boolean).join(' · ')
}
function locationLabel(team: DiscoverTeam): string {
  return [team.city, team.state].filter(Boolean).join(', ')
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
  <section class="association-users__main">
    <div ref="stickySentinelRef" class="association-users__sticky-sentinel" aria-hidden="true"></div>
    <div
      class="association-teams__sticky-stack"
      :class="{ 'association-teams__sticky-stack--stuck': toolbarStuck }"
    >
      <header class="association-users__header">
        <p class="association-users__count">
          <strong :title="`${totalCount} teams`">{{ formatCompact(totalCount) }}</strong>
          <span>following</span>
        </p>
        <div class="association-teams__header-actions">
          <label class="association-users__search">
            <AppIcon name="search" :size="14" />
            <input
              v-model="search"
              type="search"
              placeholder="Search teams"
              class="association-users__search-input"
            />
          </label>
          <NgtViewToggle />
        </div>
      </header>
    </div>

    <!-- Loading skeleton -->
    <div v-if="loading" class="association-users__list">
      <div v-for="i in 6" :key="'skeleton-' + i" class="association-users__row association-users__row--skeleton">
        <div class="association-users__row-identity">
          <span class="shimmer-circle association-users__skeleton-avatar"></span>
          <div class="association-users__skeleton-stack">
            <span class="shimmer-block association-users__skeleton-name"></span>
            <span class="shimmer-block association-users__skeleton-email"></span>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="teams.length === 0" class="association-users__empty">
      <p v-if="search.trim()">No followed teams match "{{ search }}".</p>
      <p v-else>You're not following any teams yet. Head over to Discover Teams to find some.</p>
    </div>

    <template v-else>
      <!-- Card view -->
      <div v-if="gameTimeView === 'card'" class="ngt-cards">
        <NgtTeamCard
          v-for="team in teams"
          :key="team.id"
          :team="team"
          :follow-busy="followBusy.has(team.id)"
          @toggle-follow="toggleFollow"
        />
      </div>
      <!-- List view — the original row layout -->
      <div v-else class="association-users__list">
        <div
          v-for="team in teams"
          :key="team.id"
          class="association-users__row association-teams__row"
        >
          <div class="association-users__row-identity">
            <TeamAvatar :name="team.name" :image-url="team.avatarUrl" size="md" />
            <div class="association-users__row-copy">
              <div class="association-users__row-name-line">
                <strong class="association-users__row-name">{{ team.name }}</strong>
              </div>
              <span v-if="metaLine(team)" class="association-teams__row-division">{{ metaLine(team) }}</span>
              <span v-if="team.sportType" class="association-teams__row-division">{{ team.sportType }}</span>
              <span v-if="locationLabel(team)" class="association-teams__row-location">
                <span class="association-teams__row-icon association-teams__row-icon--location" aria-hidden="true"></span>
                {{ locationLabel(team) }}
              </span>
            </div>
          </div>
          <div class="association-events__row-middle">
            <button
              type="button"
              class="association-events__follow-btn"
              :class="{ 'association-events__follow-btn--following': team.isFollowing }"
              :disabled="followBusy.has(team.id)"
              :aria-pressed="team.isFollowing ? 'true' : 'false'"
              @click="toggleFollow(team)"
            >
              <span class="association-events__follow-icon" aria-hidden="true"></span>
              {{ team.isFollowing ? 'Following' : 'Follow' }}
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
      <span>Loading more teams…</span>
    </div>
  </section>
</template>

<style scoped>
/* Attractive team card grid (cards are the shared NgtTeamCard component). */
.ngt-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 18px;
  padding: 4px 0 8px;
}
.ngt-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px 0 8px;
}

.association-teams__row.association-users__row {
  grid-template-columns: minmax(0, 1fr) auto;
}
.association-users__row-identity { align-items: flex-start; gap: 14px; }
.association-events__row-middle {
  display: flex; flex-direction: column; align-items: flex-end;
  align-self: stretch; min-width: 0; gap: 12px; justify-content: center;
}
.association-events__follow-btn {
  appearance: none; display: inline-flex; align-items: center; height: 34px;
  padding: 0 16px; border: 1px solid var(--border-divider); border-radius: 5px;
  background: var(--surface-btn-solid); color: var(--text);
  font-family: var(--font-body); font-size: 0.85rem; font-weight: 500;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
}
.association-events__follow-btn:hover:not(:disabled) { border-color: var(--border-accent-hover); }
.association-events__follow-btn:disabled { opacity: 0.65; cursor: progress; }
.association-events__follow-btn--following {
  background: var(--primary-light-3); border-color: var(--primary-light-2); color: var(--text);
}
</style>
