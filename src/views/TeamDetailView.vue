<script setup lang="ts">
// TeamDetailView
// --------------
// Member-facing team page opened from the chat team info panel (rows +
// Statistics button route here). Header shows team identity + association +
// record; 4 tabs mirror the legacy team page:
//   Events · Teammates · Player Statistics · Team Statistics
// Header + Team Statistics reuse fetchTeamDetail; the other tabs lazy-load
// their own lean v2 endpoints on first activation.

import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import TeamAvatar from '../components/TeamAvatar.vue'
import StatusBadge from '../components/StatusBadge.vue'
import { fetchTeamDetail, type ChatTeamDetail } from '../api/chat'
import {
  fetchTeamAssociation,
  fetchTeamEvents,
  fetchTeamMembers,
  fetchTeamPlayerStats,
  type TeamAssociation,
  type TeamEventItem,
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

const detail = ref<ChatTeamDetail | null>(null)
const association = ref<TeamAssociation | null>(null)
const loadingHeader = ref(true)

const activeTab = ref<TabKey>('events')

// Per-tab state
const events = ref<TeamEventItem[]>([])
const members = ref<TeamMemberItem[]>([])
const players = ref<TeamPlayerStat[]>([])
const loaded = ref<Record<TabKey, boolean>>({ events: false, teammates: false, 'player-stats': false, 'team-stats': true })
const loadingTab = ref(false)

const winPct = computed(() => {
  const s = detail.value?.stats
  if (!s || s.games <= 0) return '—'
  return `${Math.round((s.won / s.games) * 100)}%`
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
})

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push({ name: 'chat' })
}
</script>

<template>
  <main class="team-detail">
    <!-- Header -->
    <header class="team-detail__hero">
      <button type="button" class="team-detail__back" @click="goBack">
        <AppIcon name="close" :size="16" /> Back
      </button>

      <div v-if="loadingHeader" class="team-detail__hero-body">
        <span class="shimmer-circle team-detail__sk-avatar"></span>
        <span class="shimmer-block team-detail__sk-line"></span>
      </div>

      <div v-else-if="detail" class="team-detail__hero-body">
        <TeamAvatar :name="detail.name" :image-url="detail.logoUrl ?? undefined" size="lg" />
        <div class="team-detail__identity">
          <h1 class="team-detail__name">{{ detail.name }}</h1>
          <p class="team-detail__meta">
            <span v-if="detail.categoryLabel">{{ detail.categoryLabel }}</span>
            <span v-if="detail.ageGenderLabel" class="team-detail__dot">·</span>
            <span v-if="detail.ageGenderLabel">{{ detail.ageGenderLabel }}</span>
          </p>
          <p v-if="association" class="team-detail__assoc">
            <AppIcon name="award" :size="14" />
            <span>{{ association.name }}</span>
            <span v-if="association.registrationNo" class="team-detail__assoc-reg">#{{ association.registrationNo }}</span>
          </p>
        </div>

        <div class="team-detail__record">
          <span class="team-detail__record-item"><b>{{ detail.stats.games }}</b>Games</span>
          <span class="team-detail__record-item"><b>{{ detail.stats.won }}</b>Won</span>
          <span class="team-detail__record-item"><b>{{ detail.stats.lost }}</b>Lost</span>
        </div>
      </div>

      <div v-else class="team-detail__hero-body team-detail__empty">Team not found.</div>
    </header>

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
      <p v-if="loadingTab" class="team-detail__loading">Loading…</p>

      <!-- Events -->
      <template v-else-if="activeTab === 'events'">
        <ul v-if="events.length" class="team-detail__events">
          <li v-for="ev in events" :key="ev.id" class="td-event">
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
        <p v-else class="team-detail__empty">No events yet.</p>
      </template>

      <!-- Teammates -->
      <template v-else-if="activeTab === 'teammates'">
        <ul v-if="members.length" class="team-detail__members">
          <li v-for="m in members" :key="m.memberId" class="td-member">
            <TeamAvatar :name="m.name" :image-url="m.avatarUrl ?? undefined" size="sm" />
            <span class="td-member__copy">
              <span class="td-member__name">{{ m.name }}</span>
              <span class="td-member__role">
                <template v-if="m.isAdmin">Admin</template>
                <template v-else-if="m.isFan">Fan</template>
                <template v-else>Member</template>
              </span>
            </span>
            <span v-if="m.uniformNo" class="td-member__uniform">#{{ m.uniformNo }}</span>
          </li>
        </ul>
        <p v-else class="team-detail__empty">No teammates yet.</p>
      </template>

      <!-- Player Statistics -->
      <template v-else-if="activeTab === 'player-stats'">
        <div v-if="players.length" class="team-detail__table-wrap">
          <table class="team-detail__table">
            <thead>
              <tr>
                <th class="td-l">Player</th><th>G</th><th>AB</th><th>H</th>
                <th>HR</th><th>RBI</th><th>R</th><th>BB</th><th>AVG</th><th>OBP</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in players" :key="p.userId">
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

      <!-- Team Statistics -->
      <template v-else-if="activeTab === 'team-stats'">
        <div v-if="detail" class="team-detail__stat-tiles">
          <div class="td-stat"><b>{{ detail.stats.games }}</b><span>Games</span></div>
          <div class="td-stat td-stat--win"><b>{{ detail.stats.won }}</b><span>Won</span></div>
          <div class="td-stat td-stat--loss"><b>{{ detail.stats.lost }}</b><span>Lost</span></div>
          <div class="td-stat"><b>{{ winPct }}</b><span>Win %</span></div>
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

/* Hero */
.team-detail__hero {
  background: var(--surface-card);
  border: 1px solid var(--border-divider);
  border-radius: 16px;
  padding: 14px 18px 18px;
  box-shadow: var(--shadow-soft);
}
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
  padding: 2px 0 10px;
}
.team-detail__back:hover { color: var(--primary); }
.team-detail__hero-body {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.team-detail__identity { flex: 1 1 auto; min-width: 0; }
.team-detail__name { margin: 0; font-size: 1.3rem; font-weight: 500; color: var(--text); }
.team-detail__meta { margin: 3px 0 0; color: var(--secondary); font-size: 0.86rem; }
.team-detail__dot { margin: 0 6px; opacity: 0.6; }
.team-detail__assoc {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 6px 0 0;
  color: var(--primary);
  font-size: 0.82rem;
}
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
.team-detail__sk-avatar { width: 64px; height: 64px; }
.team-detail__sk-line { display: block; height: 16px; width: 200px; border-radius: 6px; }

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
.team-detail__loading,
.team-detail__empty { color: var(--secondary); font-size: 0.9rem; padding: 24px 4px; text-align: center; }

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

/* Player stats table */
.team-detail__table-wrap { overflow-x: auto; }
.team-detail__table { width: 100%; border-collapse: collapse; font-size: 0.84rem; }
.team-detail__table th, .team-detail__table td { padding: 8px 6px; text-align: center; white-space: nowrap; }
.team-detail__table th { color: var(--secondary); font-weight: 600; border-bottom: 1px solid var(--border-divider); font-size: 0.72rem; text-transform: uppercase; }
.team-detail__table td { border-bottom: 1px solid var(--border-divider); color: var(--text); font-variant-numeric: tabular-nums; }
.team-detail__table .td-l { text-align: left; }
.team-detail__table tbody tr:hover { background: var(--surface-pill); }

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
