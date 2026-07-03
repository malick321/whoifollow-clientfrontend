<script setup lang="ts">
// NewGameTimeMyTeamsView
// ----------------------
// "New Game Time" → Teams › My Teams list. Optimised replacement for the
// legacy customerfrontend NewGameTime/Teams/MyTeams.vue.
//
// Same layout/classes as NewGameTimeDiscoverTeamsView — every row is a team
// the current user belongs to (membership), so there is no Follow toggle.
// Auth required. Unlike Discover, the `mine` endpoint enriches each card with
// Games / Won / Lost stats + a teammate avatar cluster (matching the legacy
// My Teams card). Filters (Age Group / Rating / Sport Type / Gender) mirror
// Discover Teams.
//
// Data: src/api/discoverTeams.ts → GET /v2/discover/teams/mine.
// Contract: docs/api/newgametime-teams-api-contract.md.

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import TeamAvatar from '../components/TeamAvatar.vue'
import MultiSelectDropdown from '../components/MultiSelectDropdown.vue'
import { fetchMyTeams, TEAM_TYPES, type DiscoverTeam } from '../api/discoverTeams'
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

const PAGE_SIZE = 25
const currentPage = ref(0)
const lastPage = ref(1)
const totalCount = ref(0)

// ── Filters (selected display names) ─────────────────────────────────
const ageFilter = ref<string[]>([])
const ratingFilter = ref<string[]>([])
const teamTypeFilter = ref<string[]>([])
const genderFilter = ref<string[]>([])

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

const hasFilters = computed(
  () =>
    ageFilter.value.length > 0 ||
    ratingFilter.value.length > 0 ||
    teamTypeFilter.value.length > 0 ||
    genderFilter.value.length > 0
)
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
    const result = await fetchMyTeams({
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

function metaLine(team: DiscoverTeam): string {
  return [team.ageGroup, team.rating, team.gender].filter(Boolean).join(' · ')
}
function locationLabel(team: DiscoverTeam): string {
  return [team.city, team.state].filter(Boolean).join(', ')
}
const MATES_CAP = 5
function matesLabel(team: DiscoverTeam): string {
  const n = team.memberCount ?? team.members?.length ?? 0
  return `${n} Teammate${n === 1 ? '' : 's'}`
}
function extraMates(team: DiscoverTeam): number {
  return Math.max(0, (team.memberCount ?? 0) - MATES_CAP)
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
          >Reset filter</button>
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
      <p v-else>You're not on any teams yet.</p>
    </div>

    <template v-else>
      <!-- Card view -->
      <div v-if="gameTimeView === 'card'" class="ngt-cards">
        <NgtTeamCard
          v-for="team in teams"
          :key="team.id"
          :team="team"
          hide-follow
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

          <div class="ngt-team__meta">
            <div v-if="team.members?.length" class="ngt-team__mates">
              <span class="ngt-team__mates-label">{{ matesLabel(team) }}</span>
              <div class="ngt-team__mates-avatars">
                <TeamAvatar
                  v-for="m in team.members.slice(0, MATES_CAP)"
                  :key="m.name"
                  class="ngt-team__mate"
                  :name="m.name"
                  :image-url="m.avatarUrl ?? undefined"
                  size="sm"
                />
                <span v-if="extraMates(team) > 0" class="ngt-team__mate-more">+{{ extraMates(team) }}</span>
              </div>
            </div>
            <div v-if="team.totalGames !== undefined" class="ngt-team__stats">
              <div class="ngt-team__stat">
                <span class="ngt-team__stat-value">{{ team.totalGames ?? 0 }}</span>
                <span class="ngt-team__stat-label">Games</span>
              </div>
              <div class="ngt-team__stat">
                <span class="ngt-team__stat-value">{{ team.won ?? 0 }}</span>
                <span class="ngt-team__stat-label">Won</span>
              </div>
              <div class="ngt-team__stat">
                <span class="ngt-team__stat-value">{{ team.lost ?? 0 }}</span>
                <span class="ngt-team__stat-label">Lost</span>
              </div>
            </div>
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

.association-teams__row.association-users__row {
  grid-template-columns: minmax(0, 1fr) auto;
}
.association-users__row-identity { align-items: flex-start; gap: 14px; }

/* Right meta column — teammate avatar cluster + Games/Won/Lost stat trio.
   Built from existing tokens (no bold; secondary labels) to match the
   portal's finalised typography, since there's no pre-existing in-row
   stat/cluster component to reuse. */
.ngt-team__meta {
  display: flex;
  align-items: center;
  gap: 28px;
  align-self: center;
}
.ngt-team__mates { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.ngt-team__mates-label { font-size: 0.8rem; color: var(--secondary); }
.ngt-team__mates-avatars { display: flex; align-items: center; }
.ngt-team__mate {
  display: inline-flex;
  margin-left: -8px;
  border-radius: 50%;
  box-shadow: 0 0 0 2px var(--white);
}
.ngt-team__mate:first-child { margin-left: 0; }
.ngt-team__mate-more { margin-left: 8px; font-size: 0.8rem; color: var(--secondary); }
.ngt-team__stats { display: flex; gap: 22px; }
.ngt-team__stat { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.ngt-team__stat-label { font-size: 0.72rem; color: var(--secondary); }
.ngt-team__stat-value { font-size: 1.1rem; color: var(--text); font-weight: 500; line-height: 1.1; }

@media (max-width: 720px) {
  .ngt-team__meta { gap: 16px; flex-wrap: wrap; }
  .ngt-team__stats { gap: 16px; }
}
</style>
