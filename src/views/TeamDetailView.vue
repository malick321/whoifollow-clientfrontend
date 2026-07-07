<script setup lang="ts">
// TeamDetailView
// --------------
// Member-facing team page opened from the chat team info panel (rows +
// Statistics button route here). Header shows team identity + association +
// record; 4 tabs mirror the legacy team page:
//   Events · Teammates · Player Statistics · Team Statistics
// Header + Team Statistics reuse fetchTeamDetail; the other tabs lazy-load
// their own lean v2 endpoints on first activation.

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import TeamAvatar from '../components/TeamAvatar.vue'
import StatusBadge from '../components/StatusBadge.vue'
import { fetchTeamDetail, type ChatTeamDetail } from '../api/chat'
import {
  fetchTeamAssociation,
  fetchTeamEvents,
  fetchTeamGameStats,
  fetchTeamMembers,
  fetchTeamPlayerStats,
  type TeamAssociation,
  type TeamEventItem,
  type TeamGameStats,
  type TeamMemberItem,
  type TeamPlayerStat
} from '../api/teamDetail'

type TabKey = 'events' | 'teammates' | 'player-stats' | 'team-stats'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'events', label: 'Events' },
  { key: 'teammates', label: 'Teammates' },
  { key: 'player-stats', label: 'Player Statistics' },
  { key: 'team-stats', label: 'Team Statistics' }
]

const route = useRoute()
const router = useRouter()
const teamId = computed(() => String(route.params.teamId ?? ''))

// Teammate row ellipsis menu (one open at a time; closes on outside click).
const openMemberMenu = ref<string | null>(null)
function toggleMemberMenu(id: string) {
  openMemberMenu.value = openMemberMenu.value === id ? null : id
}
function viewPlayerStats(userId: string | null | undefined) {
  openMemberMenu.value = null
  if (userId) router.push({ name: 'player-passport', params: { playerId: userId } })
}
function closeMemberMenu() { openMemberMenu.value = null }

// Header actions — Message Team / Settings live in the chat surface.
function goToChat() { router.push({ name: 'chat' }) }

const detail = ref<ChatTeamDetail | null>(null)
const association = ref<TeamAssociation | null>(null)
const loadingHeader = ref(true)

const activeTab = ref<TabKey>('events')

// Per-tab state
const events = ref<TeamEventItem[]>([])
const members = ref<TeamMemberItem[]>([])
const players = ref<TeamPlayerStat[]>([])
const teamGameStats = ref<TeamGameStats>({ games: [], total: null })
const loaded = ref<Record<TabKey, boolean>>({ events: false, teammates: false, 'player-stats': false, 'team-stats': false })
const loadingTab = ref(false)

// Team Statistics table columns (per-game) + click-to-sort.
const STAT_COLS: { key: string; label: string }[] = [
  { key: 'onbase', label: 'Onbase %' }, { key: 'avg', label: 'Average' },
  { key: 'ab', label: 'AB' }, { key: 'h', label: 'H' }, { key: 'one_b', label: '1B' },
  { key: 'two_b', label: '2B' }, { key: 'three_b', label: '3B' }, { key: 'hr', label: 'HR' },
  { key: 'rbi', label: 'RBI' }, { key: 'r', label: 'R' }, { key: 'bb', label: 'BB' },
  { key: 'sac', label: 'SAC' }, { key: 'e', label: 'E' }
]
const statSort = ref<string>('')
const statDir = ref<'asc' | 'desc'>('desc')
function sortByCol(key: string) {
  if (statSort.value === key) statDir.value = statDir.value === 'desc' ? 'asc' : 'desc'
  else { statSort.value = key; statDir.value = 'desc' }
}
const sortedGameStats = computed(() => {
  const rows = teamGameStats.value.games
  if (!statSort.value) return rows
  const key = statSort.value
  const num = (row: Record<string, unknown>) =>
    key === 'onbase' || key === 'avg' ? parseFloat(String(row[key])) : Number(row[key])
  return [...rows].sort((a, b) =>
    statDir.value === 'desc'
      ? num(b as unknown as Record<string, unknown>) - num(a as unknown as Record<string, unknown>)
      : num(a as unknown as Record<string, unknown>) - num(b as unknown as Record<string, unknown>)
  )
})

// ── Filters / sort (client-side, on already-loaded tab data) ─────────────────
const filterYear = ref('all')
const filterType = ref('all')
const filterAssoc = ref('all')
const filterState = ref('all')
const showPast = ref(true)
const memberRole = ref<'all' | 'admins' | 'players' | 'fans'>('all')
const memberSearch = ref('')
type PlayerSortKey = 'obp' | 'avg' | 'hr' | 'rbi' | 'r' | 'ab' | 'games'
const playerSort = ref<PlayerSortKey>('obp')
const PLAYER_SORTS: { key: PlayerSortKey; label: string }[] = [
  { key: 'obp', label: 'OBP' }, { key: 'avg', label: 'AVG' }, { key: 'hr', label: 'HR' },
  { key: 'rbi', label: 'RBI' }, { key: 'r', label: 'Runs' }, { key: 'ab', label: 'At Bats' },
  { key: 'games', label: 'Games' }
]
function eventYear(e: TeamEventItem): string {
  const m = String(e.dateRangeLabel || '').match(/\b(20\d{2})\b/)
  return m ? m[1] : ''
}
function eventState(e: TeamEventItem): string {
  const parts = String(e.location || '').split(',').map((s) => s.trim()).filter(Boolean)
  return parts.length > 1 ? parts[parts.length - 1] : ''
}
const eventYears = computed(() => [...new Set(events.value.map(eventYear).filter(Boolean))].sort().reverse())
const eventTypes = computed(() => [...new Set(events.value.map((e) => e.eventType).filter(Boolean))] as string[])
const eventAssocs = computed(() => [...new Set(events.value.map((e) => e.association).filter(Boolean))] as string[])
const eventStates = computed(() => [...new Set(events.value.map(eventState).filter(Boolean))])

const MEMBER_ROLES: { key: 'all' | 'admins' | 'players' | 'fans'; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'admins', label: 'Admins' },
  { key: 'players', label: 'Players' }, { key: 'fans', label: 'Fans' }
]

const filteredEvents = computed(() =>
  events.value.filter((e) => {
    if (filterYear.value !== 'all' && eventYear(e) !== filterYear.value) return false
    if (filterType.value !== 'all' && e.eventType !== filterType.value) return false
    if (filterAssoc.value !== 'all' && e.association !== filterAssoc.value) return false
    if (filterState.value !== 'all' && eventState(e) !== filterState.value) return false
    if (!showPast.value && e.statusLabel === 'Completed') return false
    return true
  })
)

const filteredMembers = computed(() => {
  const q = memberSearch.value.trim().toLowerCase()
  return members.value.filter((m) => {
    if (memberRole.value === 'admins' && !m.isAdmin) return false
    if (memberRole.value === 'players' && !m.isPlayer) return false
    if (memberRole.value === 'fans' && !m.isFan) return false
    if (q && !m.name.toLowerCase().includes(q)) return false
    return true
  })
})

const sortedPlayers = computed(() => {
  const key = playerSort.value
  const num = (p: TeamPlayerStat) =>
    key === 'avg' || key === 'obp' ? parseFloat(p[key]) : (p[key] as number)
  return [...players.value].sort((a, b) => num(b) - num(a))
})

function eventTone(status: string): 'success' | 'neutral' | 'secondary' {
  if (status === 'Ongoing') return 'success'
  if (status === 'Completed') return 'secondary'
  return 'neutral'
}

async function loadTab(tab: TabKey) {
  if (loaded.value[tab]) return
  loadingTab.value = true
  try {
    if (tab === 'events') events.value = await fetchTeamEvents(teamId.value)
    else if (tab === 'teammates') members.value = await fetchTeamMembers(teamId.value)
    else if (tab === 'player-stats') players.value = await fetchTeamPlayerStats(teamId.value)
    else if (tab === 'team-stats') teamGameStats.value = await fetchTeamGameStats(teamId.value)
    loaded.value[tab] = true
  } finally {
    loadingTab.value = false
  }
}

function setTab(tab: TabKey) {
  activeTab.value = tab
  void loadTab(tab)
}

watch(activeTab, (t) => { void loadTab(t) })

onMounted(async () => {
  const q = String(route.query.tab ?? '')
  if (TABS.some((t) => t.key === q)) activeTab.value = q as TabKey

  // Header (identity + record) + association in parallel with the first tab.
  const [d, a] = await Promise.all([
    fetchTeamDetail(teamId.value).catch(() => null),
    fetchTeamAssociation(teamId.value).catch(() => null)
  ])
  detail.value = d
  association.value = a
  loadingHeader.value = false

  void loadTab(activeTab.value)
  document.addEventListener('click', closeMemberMenu)
})

onBeforeUnmount(() => document.removeEventListener('click', closeMemberMenu))
</script>

<template>
  <main class="team-detail">
    <!-- Header — reuses the finalized global `.hero` design system. -->
    <section class="hero team-detail__hero">
      <div class="hero__main">
        <p class="eyebrow">Team Details</p>
        <div class="team-heading">
          <template v-if="loadingHeader">
            <span class="shimmer-circle td-sk__avatar" aria-hidden="true"></span>
            <span class="shimmer-block td-sk__title" aria-hidden="true"></span>
          </template>
          <template v-else>
            <TeamAvatar :name="detail?.name || 'Team'" :image-url="detail?.logoUrl ?? undefined" size="lg" />
            <h1>{{ detail?.name || 'Team' }}</h1>
          </template>
        </div>

        <template v-if="loadingHeader">
          <span class="shimmer-block td-sk__line" aria-hidden="true"></span>
          <span class="shimmer-block td-sk__line td-sk__line--short" aria-hidden="true"></span>
        </template>
        <template v-else>
          <p v-if="detail && (detail.categoryLabel || detail.ageGenderLabel)" class="hero-team-meta">
            {{ [detail.categoryLabel, detail.ageGenderLabel].filter(Boolean).join(' · ') }}
          </p>
          <p v-if="association" class="hero-copy team-detail__assoc">
            <AppIcon name="award" :size="14" />
            <span>{{ association.name }}</span>
            <span v-if="association.registrationNo" class="team-detail__assoc-reg">· #{{ association.registrationNo }}</span>
          </p>
        </template>
      </div>

      <div class="hero-status">
        <div class="team-detail__hero-actions">
          <button type="button" class="td-hero-btn" @click="goToChat">
            <AppIcon name="message" :size="14" /> Message Team
          </button>
          <button type="button" class="td-hero-btn" @click="goToChat">Settings</button>
        </div>
        <div class="team-detail__record">
          <template v-if="loadingHeader">
            <span v-for="n in 3" :key="n" class="shimmer-block td-sk__tile" aria-hidden="true"></span>
          </template>
          <template v-else>
            <span class="team-detail__record-item"><b>{{ detail?.stats.games ?? 0 }}</b>Games</span>
            <span class="team-detail__record-item"><b>{{ detail?.stats.won ?? 0 }}</b>Won</span>
            <span class="team-detail__record-item"><b>{{ detail?.stats.lost ?? 0 }}</b>Lost</span>
          </template>
        </div>
      </div>
    </section>

    <!-- Tabs -->
    <nav class="team-detail__tabs" role="tablist">
      <button
        v-for="t in TABS"
        :key="t.key"
        type="button"
        class="team-detail__tab"
        :class="{ 'team-detail__tab--active': activeTab === t.key }"
        role="tab"
        :aria-selected="activeTab === t.key"
        @click="setTab(t.key)"
      >{{ t.label }}</button>
    </nav>

    <section class="team-detail__panel">
      <div v-if="loadingTab" class="td-sk-list" aria-busy="true">
        <div v-for="n in 5" :key="`tsk-${n}`" class="td-sk-row">
          <span class="shimmer-circle td-sk-row__avatar"></span>
          <span class="td-sk-row__lines">
            <span class="shimmer-block td-sk-row__l1"></span>
            <span class="shimmer-block td-sk-row__l2"></span>
          </span>
        </div>
      </div>

      <!-- Events -->
      <template v-else-if="activeTab === 'events'">
        <div v-if="events.length" class="td-filter td-filter--wrap">
          <select v-model="filterYear" class="td-select" aria-label="Year">
            <option value="all">Year</option>
            <option v-for="y in eventYears" :key="y" :value="y">{{ y }}</option>
          </select>
          <select v-model="filterType" class="td-select" aria-label="Type">
            <option value="all">Type</option>
            <option v-for="t in eventTypes" :key="t" :value="t">{{ t }}</option>
          </select>
          <select v-model="filterAssoc" class="td-select" aria-label="Association">
            <option value="all">Association</option>
            <option v-for="a in eventAssocs" :key="a" :value="a">{{ a }}</option>
          </select>
          <select v-model="filterState" class="td-select" aria-label="State">
            <option value="all">State</option>
            <option v-for="s in eventStates" :key="s" :value="s">{{ s }}</option>
          </select>
          <button
            type="button"
            class="td-filter__chip"
            :class="{ 'td-filter__chip--active': showPast }"
            @click="showPast = !showPast"
          >Past Events</button>
        </div>
        <ul v-if="filteredEvents.length" class="team-detail__events">
          <li v-for="ev in filteredEvents" :key="ev.id" class="td-event">
            <div class="td-event__top">
              <StatusBadge :label="ev.statusLabel" :tone="eventTone(ev.statusLabel)" />
              <span class="td-event__date">{{ ev.dateRangeLabel }}</span>
            </div>
            <h3 class="td-event__name">{{ ev.name }}</h3>
            <p v-if="ev.association || ev.eventType" class="td-event__sub">
              {{ [ev.association, ev.eventType].filter(Boolean).join(' · ') }}
            </p>
            <p v-if="ev.location" class="td-event__loc"><AppIcon name="home" :size="13" /> {{ ev.location }}</p>
          </li>
        </ul>
        <p v-else class="team-detail__empty">{{ events.length ? 'No events match this filter.' : 'No events yet.' }}</p>
      </template>

      <!-- Teammates -->
      <template v-else-if="activeTab === 'teammates'">
        <div v-if="members.length" class="td-members-head">
          <span class="td-members-count">{{ filteredMembers.length }} {{ filteredMembers.length === 1 ? 'Teammate' : 'Teammates' }}</span>
          <input v-model="memberSearch" type="search" class="td-search" placeholder="Search teammates" aria-label="Search teammates" />
        </div>
        <div v-if="members.length" class="td-filter">
          <button
            v-for="r in MEMBER_ROLES"
            :key="r.key"
            type="button"
            class="td-filter__chip"
            :class="{ 'td-filter__chip--active': memberRole === r.key }"
            @click="memberRole = r.key"
          >{{ r.label }}</button>
        </div>
        <ul v-if="filteredMembers.length" class="team-detail__members">
          <li v-for="m in filteredMembers" :key="m.memberId" class="td-member">
            <TeamAvatar :name="m.name" :image-url="m.avatarUrl ?? undefined" size="sm" />
            <span class="td-member__copy">
              <span class="td-member__name">{{ m.name }}</span>
              <span class="td-member__badges">
                <span v-if="m.isAdmin" class="td-badge td-badge--admin">Admin</span>
                <span v-if="m.isFan" class="td-badge td-badge--fan">Fan</span>
                <span v-if="!m.isAdmin && !m.isFan" class="td-badge">Member</span>
              </span>
            </span>
            <span v-if="m.isPlayer && m.uniformNo" class="td-member__jersey" title="Jersey number">#{{ m.uniformNo }}</span>
            <div class="td-member__menu" @click.stop>
              <button
                type="button"
                class="td-ellipsis"
                :aria-expanded="openMemberMenu === m.memberId"
                aria-label="Teammate options"
                @click="toggleMemberMenu(m.memberId)"
              >⋯</button>
              <ul v-if="openMemberMenu === m.memberId" class="td-menu">
                <li>
                  <button type="button" :disabled="!m.userId" @click="viewPlayerStats(m.userId)">
                    View player stats
                  </button>
                </li>
              </ul>
            </div>
          </li>
        </ul>
        <p v-else class="team-detail__empty">{{ members.length ? 'No teammates match.' : 'No teammates yet.' }}</p>
      </template>

      <!-- Player Statistics -->
      <template v-else-if="activeTab === 'player-stats'">
        <div v-if="players.length" class="td-filter">
          <span class="td-filter__label">Sort by</span>
          <button
            v-for="s in PLAYER_SORTS"
            :key="s.key"
            type="button"
            class="td-filter__chip"
            :class="{ 'td-filter__chip--active': playerSort === s.key }"
            @click="playerSort = s.key"
          >{{ s.label }}</button>
        </div>
        <div v-if="players.length" class="team-detail__table-wrap">
          <table class="team-detail__table">
            <thead>
              <tr>
                <th class="td-l">Player</th><th>G</th><th>AB</th><th>H</th>
                <th>HR</th><th>RBI</th><th>R</th><th>BB</th><th>AVG</th><th>OBP</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in sortedPlayers" :key="p.userId">
                <td class="td-l">{{ p.name }}</td>
                <td>{{ p.games }}</td><td>{{ p.ab }}</td><td>{{ p.h }}</td>
                <td>{{ p.hr }}</td><td>{{ p.rbi }}</td><td>{{ p.r }}</td><td>{{ p.bb }}</td>
                <td>{{ p.avg }}</td><td>{{ p.obp }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="team-detail__empty">No player statistics yet.</p>
      </template>

      <!-- Team Statistics — per-game batting table + Total row (legacy layout) -->
      <template v-else-if="activeTab === 'team-stats'">
        <div v-if="teamGameStats.games.length" class="team-detail__table-wrap">
          <table class="team-detail__table team-detail__stats-table">
            <thead>
              <tr>
                <th class="td-l">Game</th>
                <th
                  v-for="c in STAT_COLS"
                  :key="c.key"
                  class="td-sortable"
                  :class="{ 'td-sorted': statSort === c.key }"
                  @click="sortByCol(c.key)"
                >{{ c.label }}<span v-if="statSort === c.key" class="td-sortarrow">{{ statDir === 'desc' ? '▾' : '▴' }}</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="teamGameStats.total" class="td-total-row">
                <td class="td-l"><b>Total</b></td>
                <td v-for="c in STAT_COLS" :key="c.key"><b>{{ (teamGameStats.total as Record<string, unknown>)[c.key] }}</b></td>
              </tr>
              <tr v-for="row in sortedGameStats" :key="row.gameId">
                <td class="td-l">
                  <span class="td-game__date">{{ row.date || '—' }}</span>
                  <span class="td-game__line">
                    <StatusBadge
                      v-if="row.result"
                      :label="row.result === 'won' ? 'Won' : 'Lost'"
                      :tone="row.result === 'won' ? 'success' : 'danger'"
                    />
                    <span class="td-game__opp">vs {{ row.opponentName }}</span>
                  </span>
                  <span v-if="row.eventName" class="td-game__event">{{ row.eventName }}</span>
                </td>
                <td v-for="c in STAT_COLS" :key="c.key">{{ (row as unknown as Record<string, unknown>)[c.key] }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="team-detail__empty">No team statistics yet.</p>
      </template>
    </section>
  </main>
</template>

<style scoped>
.team-detail {
  width: min(100%, 900px);
  margin: 0 auto;
  padding: 20px 16px 42px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Hero — layout handled by the global `.hero` / `.hero__main` / `.hero-status`
   design system; only the extras below are local. */
.team-detail__back {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: none;
  background: none;
  color: var(--secondary);
  font: inherit;
  font-size: 0.82rem;
  cursor: pointer;
}
.team-detail__back:hover { color: var(--primary); }
.team-detail__assoc { display: inline-flex; align-items: center; gap: 6px; color: var(--primary); }
.team-detail__assoc-reg { color: var(--text-light); }
.team-detail__record { display: flex; gap: 18px; }
.team-detail__record-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  color: var(--secondary);
  font-size: 0.72rem;
}
.team-detail__record-item b { color: var(--text); font-size: 1.15rem; font-weight: 600; }

/* Tabs */
.team-detail__tabs {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  border-bottom: 1px solid var(--border-divider);
}
.team-detail__tab {
  flex: 0 0 auto;
  appearance: none;
  border: none;
  background: none;
  padding: 10px 14px;
  color: var(--secondary);
  font: inherit;
  font-size: 0.88rem;
  font-weight: 500;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  white-space: nowrap;
}
.team-detail__tab:hover { color: var(--primary); }
.team-detail__tab--active { color: var(--primary); border-bottom-color: var(--primary); }

/* Panel */
.team-detail__panel { min-height: 120px; }
.team-detail__empty { color: var(--secondary); font-size: 0.9rem; padding: 24px 4px; text-align: center; }

/* Filter / sort bars */
.td-filter {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}
.td-filter--split { justify-content: space-between; }
.td-filter--wrap { flex-wrap: wrap; }
.td-select {
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--border-divider);
  border-radius: 8px;
  background: var(--surface-card);
  color: var(--text);
  font: inherit;
  font-size: 0.82rem;
  cursor: pointer;
  outline: none;
}
.td-select:focus { border-color: var(--primary); }
.team-detail__hero-actions { display: flex; gap: 8px; margin-bottom: 10px; justify-content: flex-end; flex-wrap: wrap; }
.td-hero-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--border-divider);
  background: var(--surface-card);
  color: var(--text);
  font: inherit;
  font-size: 0.82rem;
  font-weight: 500;
  padding: 6px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}
.td-hero-btn:hover { color: var(--primary); border-color: var(--border-accent-hover, var(--primary-light-2)); }
.td-filter__chips { display: flex; flex-wrap: wrap; gap: 8px; }
.td-filter__label { color: var(--secondary); font-size: 0.78rem; margin-right: 2px; }
.td-filter__chip {
  appearance: none;
  border: 1px solid var(--border-divider);
  background: var(--surface-btn-solid, var(--surface-card));
  color: var(--secondary);
  font: inherit;
  font-size: 0.8rem;
  font-weight: 500;
  padding: 5px 12px;
  border-radius: 999px;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}
.td-filter__chip:hover { color: var(--primary); border-color: var(--border-accent-hover, var(--primary-light-2)); }
.td-filter__chip--active {
  background: var(--primary-light-3);
  border-color: var(--primary-light-2);
  color: var(--primary);
}
.td-search {
  flex: 0 1 220px;
  min-width: 0;
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--border-divider);
  border-radius: 8px;
  background: var(--surface-card);
  color: var(--text);
  font: inherit;
  font-size: 0.84rem;
  outline: none;
}
.td-search:focus { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-light-3); }

/* Skeletons (shimmer comes from the global .shimmer-block / .shimmer-circle) */
.td-sk__avatar { width: 56px; height: 56px; border-radius: 999px; display: block; }
.td-sk__title { display: block; width: 200px; max-width: 60%; height: 22px; border-radius: 7px; }
.td-sk__line { display: block; width: 240px; max-width: 70%; height: 12px; border-radius: 6px; margin-top: 10px; }
.td-sk__line--short { width: 150px; }
.td-sk__tile { width: 46px; height: 40px; border-radius: 8px; }
.td-sk-list { display: flex; flex-direction: column; gap: 14px; padding-top: 4px; }
.td-sk-row { display: flex; align-items: center; gap: 12px; }
.td-sk-row__avatar { width: 40px; height: 40px; border-radius: 999px; flex: 0 0 auto; }
.td-sk-row__lines { display: flex; flex-direction: column; gap: 7px; flex: 1 1 auto; }
.td-sk-row__l1 { display: block; height: 13px; width: 45%; border-radius: 6px; }
.td-sk-row__l2 { display: block; height: 11px; width: 65%; border-radius: 6px; }

/* Events */
.team-detail__events { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.td-event {
  border: 1px solid var(--border-divider);
  border-radius: 12px;
  padding: 12px 14px;
  background: var(--surface-card);
}
.td-event__top { display: flex; align-items: center; gap: 10px; }
.td-event__date { color: var(--text-light); font-size: 0.78rem; }
.td-event__name { margin: 6px 0 0; font-size: 1rem; font-weight: 500; color: var(--text); }
.td-event__sub { margin: 2px 0 0; color: var(--secondary); font-size: 0.82rem; }
.td-event__loc { display: inline-flex; align-items: center; gap: 4px; margin: 4px 0 0; color: var(--text-light); font-size: 0.8rem; }

/* Members */
.team-detail__members { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.td-member {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 4px;
  border-top: 1px solid var(--border-divider);
}
.td-member:first-child { border-top: none; }
.td-member__copy { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; }
.td-member__name { color: var(--text); font-size: 0.9rem; }
.td-member__role { color: var(--secondary); font-size: 0.76rem; }
.td-member__uniform { color: var(--text-light); font-size: 0.82rem; font-variant-numeric: tabular-nums; }
.td-members-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.td-members-count { color: var(--text); font-weight: 500; font-size: 0.95rem; }
.td-member__badges { display: flex; gap: 6px; margin-top: 2px; }
.td-badge { font-size: 0.68rem; font-weight: 500; padding: 1px 7px; border-radius: 999px; background: var(--surface-pill); color: var(--secondary); }
.td-badge--admin { background: var(--primary-light-3); color: var(--primary); }
.td-badge--fan { background: #fff0df; color: #b57a34; }
.td-member__jersey { color: var(--text-light); font-size: 0.8rem; font-variant-numeric: tabular-nums; background: var(--surface-pill); padding: 2px 8px; border-radius: 6px; }
.td-member__menu { position: relative; flex: 0 0 auto; }
.td-ellipsis { appearance: none; border: none; background: none; color: var(--secondary); font-size: 1.2rem; line-height: 1; cursor: pointer; padding: 4px 8px; border-radius: 6px; }
.td-ellipsis:hover { background: var(--surface-pill); color: var(--primary); }
.td-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: 20;
  list-style: none;
  margin: 0;
  padding: 4px;
  min-width: 170px;
  background: var(--surface-card);
  border: 1px solid var(--border-divider);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.16);
}
.td-menu button {
  display: block;
  width: 100%;
  text-align: left;
  appearance: none;
  border: none;
  background: none;
  font: inherit;
  font-size: 0.84rem;
  color: var(--text);
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
}
.td-menu button:hover:not(:disabled) { background: var(--surface-pill); color: var(--primary); }
.td-menu button:disabled { color: var(--text-light); cursor: default; }

/* Player stats table */
.team-detail__table-wrap { overflow-x: auto; }
.team-detail__table { width: 100%; border-collapse: collapse; font-size: 0.84rem; }
.team-detail__table th, .team-detail__table td { padding: 8px 6px; text-align: center; white-space: nowrap; }
.team-detail__table th { color: var(--secondary); font-weight: 600; border-bottom: 1px solid var(--border-divider); font-size: 0.72rem; text-transform: uppercase; }
.team-detail__table td { border-bottom: 1px solid var(--border-divider); color: var(--text); font-variant-numeric: tabular-nums; }
.team-detail__table .td-l { text-align: left; }
.team-detail__table tbody tr:hover { background: var(--surface-pill); }

/* Team Statistics per-game table */
.team-detail__stats-table th.td-sortable { cursor: pointer; user-select: none; }
.team-detail__stats-table th.td-sortable:hover { color: var(--primary); }
.team-detail__stats-table th.td-sorted { color: var(--primary); }
.td-sortarrow { margin-left: 2px; }
.team-detail__stats-table .td-total-row td { background: var(--surface-pill); border-bottom: 2px solid var(--border-divider); }
.team-detail__stats-table .td-l { min-width: 190px; }
.td-game__date { display: block; color: var(--text-light); font-size: 0.72rem; }
.td-game__line { display: inline-flex; align-items: center; gap: 6px; margin-top: 2px; }
.td-game__opp { color: var(--text); font-weight: 500; }
.td-game__event { display: block; color: var(--secondary); font-size: 0.74rem; margin-top: 2px; }

/* Team stat tiles */
.team-detail__stat-tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.td-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 16px 8px;
  border: 1px solid var(--border-divider);
  border-radius: 12px;
  background: var(--surface-card);
}
.td-stat b { font-size: 1.5rem; font-weight: 600; color: var(--text); }
.td-stat span { color: var(--secondary); font-size: 0.76rem; }
.td-stat--win b { color: #2f9e56; }
.td-stat--loss b { color: #d1495b; }
@media (max-width: 560px) {
  .team-detail__stat-tiles { grid-template-columns: repeat(2, 1fr); }
}
</style>
