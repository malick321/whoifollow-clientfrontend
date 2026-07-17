<script setup lang="ts">
// NewGameTimeDiscoverTeamsView
// ----------------------------
// Public "New Game Time" → Teams › Discover list. Optimised replacement
// for the legacy customerfrontend NewGameTime/Teams/DiscoverTeams.vue.
//
// Mirrors the colleague's AssociationTeamsView row/card layout (avatar +
// name + meta line + location) and the NewGameTimeDiscoverEventsView
// toolbar/follow pattern, REUSING his global classes
// (.association-users__* / .association-teams__* / .association-events__*)
// + shared components (AppIcon, TeamAvatar, MultiSelectDropdown) so it
// drops into his design system unchanged. No invented UI.
//
// Data: src/api/discoverTeams.ts → GET /v2/discover/teams (auth-aware).
// Contract: docs/api/newgametime-teams-api-contract.md.

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import TeamAvatar from '../components/TeamAvatar.vue'
import MultiSelectDropdown from '../components/MultiSelectDropdown.vue'
import {
  fetchDiscoverTeams,
  followTeam,
  unfollowTeam,
  TEAM_TYPES,
  type DiscoverTeam
} from '../api/discoverTeams'
import NgtTeamCard from '../components/gametime/NgtTeamCard.vue'
import NgtViewToggle from '../components/gametime/NgtViewToggle.vue'
import { gameTimeView } from '../game-time-view'
import { fetchAgeGroups, fetchAllRatings } from '../api/ageRatingCatalogue'
import { GENDERS } from '../api/associationTeams'
import { pushToast } from '../toast-center'
import { formatCompact } from '../utils/formatNumber'

const teams = ref<DiscoverTeam[]>([])
const loading = ref(true)
const loadingMore = ref(false)
const search = ref('')

const PAGE_SIZE = 50
const currentPage = ref(0)
const lastPage = ref(1)
const totalCount = ref(0)

// ── Filters (selected display names) ─────────────────────────────────
const ageFilter = ref<string[]>([])
const ratingFilter = ref<string[]>([])
const teamTypeFilter = ref<string[]>([])
const genderFilter = ref<string[]>([])

// Catalogue option labels + name→id maps (the backend matches the stored
// columns, so selected labels are translated to catalogue ids before the
// request — see namesToIds). Team type + gender are fixed local lists.
const ageOptions = ref<string[]>([])
const ratingOptions = ref<string[]>([])
const teamTypeOptions = TEAM_TYPES as readonly string[]
const genderOptions = GENDERS as readonly string[]
let ageNameToId = new Map<string, string>()
let ratingNameToId = new Map<string, string>()

function namesToIds(names: string[], map: Map<string, string>): string[] {
  return names.map((n) => map.get(n) ?? n)
}

async function loadFilterCatalogues() {
  const [ages, rates] = await Promise.all([fetchAgeGroups(), fetchAllRatings()])
  ageOptions.value = ages.map((a) => a.name)
  ageNameToId = new Map(ages.map((a) => [a.name, a.id]))
  ratingOptions.value = rates.map((r) => r.rate)
  ratingNameToId = new Map(rates.map((r) => [r.rate, r.id]))
}

const activeFilterCount = computed(
  () =>
    ageFilter.value.length +
    ratingFilter.value.length +
    teamTypeFilter.value.length +
    genderFilter.value.length
)
const hasFilters = computed(() => activeFilterCount.value > 0)
function resetFilters() {
  ageFilter.value = []
  ratingFilter.value = []
  teamTypeFilter.value = []
  genderFilter.value = []
}

let fetchToken = 0

async function loadPage(mode: 'reset' | 'append') {
  const myToken = ++fetchToken
  const nextPage = mode === 'reset' ? 1 : currentPage.value + 1
  if (mode === 'reset') loading.value = true
  else loadingMore.value = true
  try {
    const result = await fetchDiscoverTeams({
      search: search.value,
      ageGroup: namesToIds(ageFilter.value, ageNameToId),
      rating: namesToIds(ratingFilter.value, ratingNameToId),
      teamType: teamTypeFilter.value,
      gender: genderFilter.value,
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

// Filter changes reload page 1 immediately.
watch([ageFilter, ratingFilter, teamTypeFilter, genderFilter], () => {
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
const followBusy = ref<Set<string>>(new Set())

async function toggleFollow(team: DiscoverTeam) {
  if (followBusy.value.has(team.id)) return
  followBusy.value = new Set(followBusy.value).add(team.id)
  const wasFollowing = team.isFollowing
  try {
    if (wasFollowing) {
      await unfollowTeam(team.id)
      team.isFollowing = false
      team.followId = undefined
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
  void loadFilterCatalogues()
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
          <strong :title="`${totalCount} teams`">{{ formatCompact(totalCount) }}</strong>
          <span>teams</span>
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
        </div>
      </header>

      <div class="association-users__toolbar association-teams__toolbar">
        <div class="association-teams__filters">
          <MultiSelectDropdown v-model="ageFilter" :options="ageOptions" placeholder="Age Group" />
          <MultiSelectDropdown v-model="ratingFilter" :options="ratingOptions" placeholder="Rating" />
          <MultiSelectDropdown
            v-model="teamTypeFilter"
            :options="teamTypeOptions"
            placeholder="Team Type"
            :searchable="false"
          />
          <MultiSelectDropdown
            v-model="genderFilter"
            :options="genderOptions"
            placeholder="Gender"
            :searchable="false"
          />
          <button
            v-if="hasFilters"
            type="button"
            class="association-teams__filter-reset"
            @click="resetFilters"
          >Reset filters ({{ activeFilterCount }})</button>
        </div>
        <NgtViewToggle />
      </div>
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
      <p v-if="search.trim()">No teams match "{{ search }}".</p>
      <p v-else>No teams found. Try broadening your search.</p>
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
.association-teams__toolbar {
  justify-content: space-between;
  align-items: center;
}

/* Mirror of the events view's right-aligned middle column + follow toggle
   treatment, restated here against the same shared global row classes. */
.association-teams__row.association-users__row {
  grid-template-columns: minmax(0, 1fr) auto;
}
.association-users__row-identity { align-items: flex-start; gap: 14px; }
.association-events__row-middle {
  display: flex; flex-direction: column; align-items: flex-end;
  align-self: stretch; min-width: 0; gap: 12px; justify-content: center;
}

/* Follow toggle — reuses the events follow-btn vocabulary so it reads as
   part of the same finalised control set. "Following" uses the applied-blue
   state; "Follow" is the neutral solid. The bell icon + gap come from the
   shared rules in styles.css. */
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
