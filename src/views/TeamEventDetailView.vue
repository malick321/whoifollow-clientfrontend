<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import TeamAvatar from '../components/TeamAvatar.vue'
import CreateGameModal from '../components/CreateGameModal.vue'
import GameLineupModal from '../components/GameLineupModal.vue'
import { pushToast } from '../toast-center'
import { confirmDialog } from '../confirm-center'
import { deleteTeamEventGame } from '../api/teamEventGames'
import {
  fetchEventBoxscores,
  fetchEventPlayerStats,
  fetchEventTeamStats,
  fetchTeamEventOverview,
  updateEventAttendance
} from '../api/teamEventDetail'
import type {
  EventAttendanceStatus,
  EventBattingStats,
  EventBoxscore,
  EventPlayerStat,
  EventTeamStats,
  TeamEventOverview
} from '../api/contracts/teamEventDetail'

type TabKey = 'boxscores' | 'player-stats' | 'team-stats'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'boxscores', label: 'Boxscores' },
  { key: 'player-stats', label: 'Player Statistics' },
  { key: 'team-stats', label: 'Team Statistics' }
]

const route = useRoute()
const router = useRouter()
const teamId = computed(() => String(route.params.teamId ?? ''))
const eventId = computed(() => String(route.params.eventId ?? ''))
const activeTab = ref<TabKey>('boxscores')
const overview = ref<TeamEventOverview | null>(null)
const games = ref<EventBoxscore[]>([])
const players = ref<EventPlayerStat[]>([])
const teamStats = ref<EventTeamStats>({ games: [], total: null })
const loadingOverview = ref(true)
const loadingTab = ref(false)
const loadError = ref('')
const attendanceSaving = ref(false)
const gameFormOpen = ref(false)
const gameStatus = ref<'all' | EventBoxscore['status']>('all')
const playerSearch = ref('')
const playerSort = ref<'onbase' | 'average' | 'games' | 'hr' | 'rbi'>('onbase')
const playerLineup = ref('all')
const playerRole = ref('all')
const playerView = ref('standard')
const teamDateRange = ref('all')
const teamSplit = ref('all')
const teamOpponent = ref('all')
const rosterView = ref<'going' | 'not_responded'>('going')
let requestId = 0

const visibleGames = computed(() =>
  gameStatus.value === 'all' ? games.value : games.value.filter((game) => game.status === gameStatus.value)
)
const visiblePlayers = computed(() => {
  const query = playerSearch.value.trim().toLowerCase()
  return [...players.value]
    .filter((player) => {
      if (query && !player.name.toLowerCase().includes(query)) return false
      if (playerRole.value !== 'all' && player.role !== playerRole.value) return false
      return true
    })
    .sort((a, b) => {
      const key = playerSort.value
      return key === 'onbase' || key === 'average'
        ? Number.parseFloat(b[key]) - Number.parseFloat(a[key])
        : b[key] - a[key]
    })
})
const playerRoles = computed(() => [...new Set(players.value.map((player) => player.role).filter(Boolean))])
const teamOpponents = computed(() => [...new Set(teamStats.value.games.map((game) => game.opponentName).filter(Boolean))].sort())
const visibleTeamGames = computed(() => {
  let rows = [...teamStats.value.games]
  if (teamSplit.value === 'won' || teamSplit.value === 'lost') {
    rows = rows.filter((game) => game.result === teamSplit.value)
  }
  if (teamOpponent.value !== 'all') {
    rows = rows.filter((game) => game.opponentName === teamOpponent.value)
  }
  if (teamDateRange.value === 'last3') rows = rows.slice(-3)
  if (teamDateRange.value === 'last7') rows = rows.slice(-7)
  return rows
})
const attendanceMembers = computed(() => {
  const status = rosterView.value === 'going' ? 'going' : 'not_responded'
  return overview.value?.attendance.members.filter((member) => member.status === status) ?? []
})
const goingPct = computed(() => {
  const c = overview.value?.attendance.counts
  if (!c) return 0
  const total = c.going + c.maybe + c.notGoing + c.notResponded
  return total ? Math.round((c.going / total) * 100) : 0
})
const defaultStats = (): EventBattingStats => ({
  games: 0, onbase: '0.000', average: '0.000', ab: 0, h: 0,
  oneB: 0, twoB: 0, threeB: 0, hr: 0, rbi: 0, runs: 0, bb: 0, sac: 0, errors: 0
})
const playerTotals = computed<EventBattingStats>(() => {
  if (!players.value.length) return defaultStats()
  const total = players.value.reduce((sum, player) => {
    for (const key of ['games', 'ab', 'h', 'oneB', 'twoB', 'threeB', 'hr', 'rbi', 'runs', 'bb', 'sac', 'errors'] as const) {
      sum[key] += player[key]
    }
    return sum
  }, defaultStats())
  total.games = overview.value?.record.games ?? total.games
  total.onbase = (players.value.reduce((sum, player) => sum + Number(player.onbase), 0) / players.value.length).toFixed(3)
  total.average = (players.value.reduce((sum, player) => sum + Number(player.average), 0) / players.value.length).toFixed(3)
  return total
})
const visibleTeamTotals = computed<EventBattingStats>(() => {
  if (!visibleTeamGames.value.length) return defaultStats()
  const total = visibleTeamGames.value.reduce((sum, game) => {
    for (const key of ['games', 'ab', 'h', 'oneB', 'twoB', 'threeB', 'hr', 'rbi', 'runs', 'bb', 'sac', 'errors'] as const) {
      sum[key] += game[key]
    }
    return sum
  }, defaultStats())
  const hits = total.oneB + total.twoB + total.threeB + total.hr
  total.average = total.ab > 0 ? (hits / total.ab).toFixed(3) : '0.000'
  total.onbase = total.ab > 0 ? ((hits + total.bb + total.errors) / total.ab).toFixed(3) : '0.000'
  total.games = visibleTeamGames.value.length
  return total
})
const activeStats = computed(() => activeTab.value === 'player-stats'
  ? playerTotals.value
  : visibleTeamTotals.value)
const metricCards = computed(() => [
  { label: activeTab.value === 'player-stats' ? 'Games Played' : 'Onbase %', value: activeTab.value === 'player-stats' ? activeStats.value.games : activeStats.value.onbase, hint: activeTab.value === 'player-stats' ? 'Total' : 'Event average', icon: 'game' as const, tone: 'blue' },
  { label: activeTab.value === 'player-stats' ? 'Onbase %' : 'Average', value: activeTab.value === 'player-stats' ? activeStats.value.onbase : activeStats.value.average, hint: 'Event average', icon: 'trophy' as const, tone: 'violet' },
  { label: activeTab.value === 'player-stats' ? 'Average' : 'At Bats', value: activeTab.value === 'player-stats' ? activeStats.value.average : activeStats.value.ab.toLocaleString(), hint: 'Event total', icon: 'award' as const, tone: 'violet' },
  { label: activeTab.value === 'player-stats' ? 'At Bats' : 'Hits', value: activeTab.value === 'player-stats' ? activeStats.value.ab.toLocaleString() : activeStats.value.h.toLocaleString(), hint: 'Event total', icon: 'game' as const, tone: 'blue' },
  { label: activeTab.value === 'player-stats' ? 'Hits' : 'Home Runs', value: activeTab.value === 'player-stats' ? activeStats.value.h.toLocaleString() : activeStats.value.hr.toLocaleString(), hint: 'Event total', icon: 'like' as const, tone: 'green' },
  { label: activeTab.value === 'player-stats' ? 'Home Runs' : 'Runs', value: activeTab.value === 'player-stats' ? activeStats.value.hr.toLocaleString() : activeStats.value.runs.toLocaleString(), hint: 'Event total', icon: 'award' as const, tone: 'orange' }
])
const offenseStyle = computed(() => {
  const total = Math.max(activeStats.value.h, 1)
  const one = activeStats.value.oneB / total * 100
  const two = one + activeStats.value.twoB / total * 100
  const three = two + activeStats.value.threeB / total * 100
  return { background: `conic-gradient(#2688ff 0 ${one}%, #8b43ef ${one}% ${two}%, #f4b317 ${two}% ${three}%, #16bd78 ${three}% 100%)` }
})
const chartLines = computed(() => {
  const rows = visibleTeamGames.value.slice(0, 8)
  const points = (key: 'onbase' | 'average') => {
    if (!rows.length) return key === 'onbase' ? '20,76 140,58 260,64 380,40 500,55 620,38 740,52' : '20,88 140,78 260,84 380,67 500,75 620,60 740,68'
    const max = Math.max(...rows.map((row) => Number(row[key])), 0.001)
    return rows.map((row, index) => {
      const x = rows.length === 1 ? 380 : 20 + index * (720 / (rows.length - 1))
      const y = 96 - Number(row[key]) / max * 68
      return `${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
  }
  return { onbase: points('onbase'), average: points('average') }
})
const mapUrl = computed(() => {
  const lat = overview.value?.location.lat
  const lng = overview.value?.location.lng
  if (lat == null || lng == null) return ''
  const delta = 0.018
  const bbox = [lng - delta, lat - delta, lng + delta, lat + delta].join('%2C')
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lng}`
})
const directionsUrl = computed(() => {
  const location = overview.value?.location
  if (!location) return '#'
  const query = location.lat != null && location.lng != null
    ? `${location.lat},${location.lng}`
    : location.label || ''
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
})

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}
function gameStatusLabel(status: EventBoxscore['status']): string {
  return status === 'ongoing' ? 'Ongoing' : status === 'final' ? 'Final' : 'Scheduled'
}
// Redesign helpers: status chip class (amber for ongoing) + compact date rail.
function gameChip(status: EventBoxscore['status']): 'a' | 'n' | 'b' {
  return status === 'ongoing' ? 'a' : status === 'final' ? 'n' : 'b'
}
function gameRail(label: string | null | undefined): { dow: string; mon: string; day: string } {
  const s = String(label || '')
  const m = s.match(/([A-Za-z]{3,}),?\s+([A-Za-z]{3,})\s+(\d{1,2})/)
  if (m) return { dow: m[1].slice(0, 3), mon: m[2].slice(0, 3), day: m[3] }
  const m2 = s.match(/([A-Za-z]{3,})\s+(\d{1,2})/)
  return m2 ? { dow: '', mon: m2[1].slice(0, 3), day: m2[2] } : { dow: '', mon: '', day: '—' }
}
function resetPlayerFilters() {
  playerLineup.value = 'all'
  playerRole.value = 'all'
  playerSort.value = 'onbase'
  playerView.value = 'standard'
  playerSearch.value = ''
}
function resetTeamFilters() {
  teamDateRange.value = 'all'
  teamSplit.value = 'all'
  teamOpponent.value = 'all'
}
function exportPlayerStats() {
  const header = ['Player', 'Games', 'Onbase %', 'Average', 'AB', 'H', 'HR', 'RBI', 'Runs']
  const rows = visiblePlayers.value.map((player) => [
    player.name, player.games, player.onbase, player.average, player.ab,
    player.h, player.hr, player.rbi, player.runs
  ])
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${overview.value?.name || 'event'}-player-statistics.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}
function setTab(tab: TabKey) {
  if (tab === activeTab.value) return
  activeTab.value = tab
  router.replace({ query: { ...route.query, tab } })
  void loadActiveTab()
}
async function loadActiveTab() {
  const id = ++requestId
  loadingTab.value = true
  loadError.value = ''
  try {
    if (activeTab.value === 'boxscores') games.value = await fetchEventBoxscores(teamId.value, eventId.value)
    else if (activeTab.value === 'player-stats') players.value = await fetchEventPlayerStats(teamId.value, eventId.value)
    else teamStats.value = await fetchEventTeamStats(teamId.value, eventId.value)
  } catch (error) {
    if (id === requestId) loadError.value = error instanceof Error ? error.message : 'Could not load this tab.'
  } finally {
    if (id === requestId) loadingTab.value = false
  }
}
async function setAttendance(status: Exclude<EventAttendanceStatus, 'not_responded'>) {
  if (!overview.value || attendanceSaving.value) return
  attendanceSaving.value = true
  try {
    overview.value.attendance = await updateEventAttendance(teamId.value, eventId.value, status)
    pushToast({ tone: 'success', title: 'Attendance updated' })
  } catch (error) {
    pushToast({ tone: 'warning', title: 'Could not update attendance', message: error instanceof Error ? error.message : 'Please try again.' })
  } finally {
    attendanceSaving.value = false
  }
}

// Condensed sticky header (matches ParticipationV2 — visible after 140px scroll).
const condensedHeaderVisible = ref(false)
function handleScroll() { condensedHeaderVisible.value = window.scrollY > 140 }

// Attendee row ⋯ menu (one open at a time; closes on outside click).
const openMemberMenu = ref<string | null>(null)
function toggleMemberMenu(id: string) {
  openMemberMenu.value = openMemberMenu.value === id ? null : id
}
function closeMemberMenu() { openMemberMenu.value = null }

// Game card ⋯ menu + edit/lineup modal state.
const openGameMenu = ref<string | null>(null)
function toggleGameMenu(id: string) { openGameMenu.value = openGameMenu.value === id ? null : id }
const editingGame = ref<EventBoxscore | null>(null)
const lineupOpen = ref(false)
const lineupGameId = ref('')

function onDocumentClick() { closeMemberMenu(); openGameMenu.value = null }

function openScoring(game: EventBoxscore) {
  openGameMenu.value = null
  router.push({ name: 'game-scoring', params: { teamId: teamId.value, eventId: eventId.value, gameId: game.id } })
}
function editGame(game: EventBoxscore) {
  openGameMenu.value = null
  editingGame.value = game
  gameFormOpen.value = true
}
function openLineup(game: EventBoxscore) {
  openGameMenu.value = null
  lineupGameId.value = game.id
  lineupOpen.value = true
}
async function deleteGame(game: EventBoxscore) {
  openGameMenu.value = null
  const ok = await confirmDialog({
    title: 'Delete game?',
    message: `"${game.name}" and its scores will be permanently removed.`,
    confirmLabel: 'Delete',
    danger: true
  })
  if (!ok) return
  try {
    await deleteTeamEventGame(teamId.value, eventId.value, game.id)
    pushToast({ tone: 'success', title: 'Game deleted' })
    await onGameCreated()
  } catch (error) {
    pushToast({ tone: 'warning', title: 'Could not delete game', message: error instanceof Error ? error.message : 'Please try again.' })
  }
}
function onGameFormClosed(open: boolean) {
  gameFormOpen.value = open
  if (!open) editingGame.value = null
}

function viewMemberStats(userId: string) {
  closeMemberMenu()
  if (userId) router.push({ name: 'player-passport', params: { playerId: userId } })
}

async function setMemberAttendance(memberId: string, status: Exclude<EventAttendanceStatus, 'not_responded'>) {
  closeMemberMenu()
  if (!overview.value || attendanceSaving.value) return
  attendanceSaving.value = true
  try {
    overview.value.attendance = await updateEventAttendance(teamId.value, eventId.value, status, memberId)
    pushToast({ tone: 'success', title: 'Attendance updated' })
  } catch (error) {
    pushToast({ tone: 'warning', title: 'Could not update attendance', message: error instanceof Error ? error.message : 'Please try again.' })
  } finally {
    attendanceSaving.value = false
  }
}

async function onGameCreated() {
  // Refresh the boxscores list + the Games/Won/Lost record.
  overview.value = await fetchTeamEventOverview(teamId.value, eventId.value).catch(() => overview.value)
  if (activeTab.value === 'boxscores') void loadActiveTab()
}

watch(() => route.query.tab, (value) => {
  if (TABS.some((tab) => tab.key === value) && value !== activeTab.value) {
    activeTab.value = value as TabKey
    void loadActiveTab()
  }
})

onMounted(async () => {
  document.addEventListener('click', onDocumentClick)
  handleScroll()
  window.addEventListener('scroll', handleScroll, { passive: true })
  const requested = String(route.query.tab ?? '')
  if (TABS.some((tab) => tab.key === requested)) activeTab.value = requested as TabKey
  try {
    overview.value = await fetchTeamEventOverview(teamId.value, eventId.value)
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : 'Could not load this event.'
  } finally {
    loadingOverview.value = false
  }
  void loadActiveTab()
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  window.removeEventListener('scroll', handleScroll)
})
</script>

<template>
  <main class="event-detail rd">
    <!-- Sticky 64px identity bar (redesign shell). -->
    <div class="bar"><div class="bar-in">
      <template v-if="loadingOverview">
        <span class="shimmer-circle" style="width:38px;height:38px" aria-hidden="true"></span>
        <span class="shimmer-block" style="width:220px;height:20px;border-radius:6px" aria-hidden="true"></span>
      </template>
      <template v-else-if="overview">
        <button type="button" class="btn ic" aria-label="Back to team" @click="router.push({ name: 'team-detail', params: { teamId } })">‹</button>
        <TeamAvatar :name="overview.name" :image-url="overview.avatarUrl ?? overview.team.logoUrl ?? undefined" size="md" />
        <div class="id">
          <h1>{{ overview.name }}</h1>
          <p>
            <span v-if="overview.eventType" class="chip n">{{ overview.eventType }}</span>
            {{ overview.team.name }} · {{ overview.dates.label }}<template v-if="overview.dates.timezone"> · {{ overview.dates.timezone }}</template>
            <template v-if="overview.association"> · {{ overview.association }}</template>
          </p>
        </div>
        <div class="rec">
          <span class="n"><b :class="{ z: !overview.record.games }">{{ overview.record.games }}</b><i>GP</i></span>
          <span class="n"><b :class="overview.record.won ? 'w' : 'z'">{{ overview.record.won }}</b><i>W</i></span>
          <span class="n"><b :class="overview.record.lost ? 'l' : 'z'">{{ overview.record.lost }}</b><i>L</i></span>
        </div>
      </template>
    </div></div>

    <div class="shell">
    <nav v-if="overview" class="utabs" role="tablist" aria-label="Event detail">
      <button v-for="tab in TABS" :key="tab.key" type="button" role="tab" :aria-selected="activeTab === tab.key" @click="setTab(tab.key)">
        {{ tab.label }}
        <span v-if="tab.key === 'boxscores' && games.length" class="cnt n">{{ games.length }}</span>
        <span v-else-if="tab.key === 'player-stats' && players.length" class="cnt n">{{ players.length }}</span>
      </button>
    </nav>

    <div v-if="loadError && !overview" class="ed-error">
      <AppIcon name="help" :size="24" />
      <h2>Event could not be loaded</h2>
      <p>{{ loadError }}</p>
      <button type="button" @click="router.push({ name: 'team-detail', params: { teamId } })">Back to team</button>
    </div>

    <template v-else-if="overview">
      <div v-if="loadingTab" class="ed-tab-loading" aria-busy="true">
        <span v-for="n in 5" :key="n" class="ed-shimmer ed-shimmer--row"></span>
      </div>
      <div v-else-if="loadError" class="ed-empty"><h2>Could not load this tab</h2><p>{{ loadError }}</p><button type="button" @click="loadActiveTab">Try again</button></div>

      <div v-else-if="activeTab === 'boxscores'" class="cols">
        <div class="card">
          <header>
            <h2>Boxscores</h2>
            <div class="sp">
              <div class="seg" role="group" aria-label="Filter games">
                <button v-for="status in (['all', 'ongoing', 'final'] as const)" :key="status" type="button" :aria-pressed="gameStatus === status" @click="gameStatus = status">{{ status === 'all' ? 'All' : gameStatusLabel(status) }}</button>
              </div>
              <button v-if="overview?.isAdmin" type="button" class="btn pri sm" @click="gameFormOpen = true">Add game</button>
            </div>
          </header>
          <div class="pad">
            <template v-if="visibleGames.length">
              <article v-for="game in visibleGames" :key="game.id" class="game" :class="game.status === 'ongoing' ? 'on' : (game.status === 'final' ? 'fin' : '')">
                <div class="grail">
                  <span>{{ gameRail(game.dateLabel).dow || gameRail(game.dateLabel).mon }}</span>
                  <b class="n">{{ gameRail(game.dateLabel).day }}</b>
                  <span>{{ gameRail(game.dateLabel).mon }}</span>
                </div>
                <div class="gbody">
                  <div style="display:flex;align-items:center;gap:9px">
                    <span class="chip" :class="gameChip(game.status)"><span v-if="game.status === 'ongoing'" class="live"></span>{{ gameStatusLabel(game.status) }}</span>
                    <b style="font-size:14.5px">{{ game.name }}</b>
                    <span v-if="game.timeLabel" class="n" style="margin-left:auto;font-size:12.5px;color:var(--mu)">{{ game.timeLabel }}</span>
                    <div class="ed-game__menu" :style="game.timeLabel ? '' : 'margin-left:auto'" @click.stop>
                      <button type="button" class="kebab" style="opacity:1" :aria-expanded="openGameMenu === game.id" aria-label="Game options" @click="toggleGameMenu(game.id)">⋯</button>
                      <ul v-if="openGameMenu === game.id" class="ed-menu ed-game-menu">
                        <li><button type="button" @click="openScoring(game)">Scoring</button></li>
                        <template v-if="overview?.isAdmin">
                          <li><button type="button" @click="editGame(game)">Edit game</button></li>
                          <li><button type="button" @click="openLineup(game)">Lineup</button></li>
                          <li><button type="button" class="is-danger" @click="deleteGame(game)">Delete game</button></li>
                        </template>
                      </ul>
                    </div>
                  </div>
                  <div class="vs">
                    <div class="t"><span class="av" style="width:26px;height:26px;font-size:9px">{{ initials(game.opponent.name) }}</span><span>{{ game.opponent.name }}</span></div>
                    <div style="text-align:center">
                      <span class="sc n" :class="{ d: game.status !== 'final', win: game.status === 'final' && game.opponent.score > game.team.score }">{{ game.opponent.score }}</span>
                      <span class="mid" style="display:inline-block;padding:0 9px">–</span>
                      <span class="sc n" :class="{ d: game.status !== 'final', win: game.status === 'final' && game.team.score > game.opponent.score }">{{ game.team.score }}</span>
                      <div class="mid">{{ game.status === 'ongoing' ? 'in progress' : (game.status === 'final' ? 'final' : 'not started') }}</div>
                    </div>
                    <div class="t r"><TeamAvatar :name="game.team.name" :image-url="game.team.logoUrl ?? undefined" size="sm" /><span>{{ game.team.name }}</span></div>
                  </div>
                  <p v-if="game.venue" style="margin:8px 0 0;font-size:12px;color:var(--mu-2)">{{ game.venue }}</p>
                </div>
              </article>
            </template>
            <div v-else class="empty">
              <span class="ring"><AppIcon name="game" :size="20" /></span>
              <h3>No games here yet</h3>
              <p>Games added to this event appear in this boxscore list.</p>
              <button v-if="overview?.isAdmin" type="button" class="btn pri sm" @click="gameFormOpen = true">Add game</button>
            </div>
          </div>
        </div>

        <div class="stack-v">
          <div class="card">
            <header><h2>Are you going?</h2></header>
            <div class="pad">
              <div class="rsvp">
                <button type="button" :disabled="attendanceSaving" :aria-pressed="overview.attendance.currentStatus === 'going'" @click="setAttendance('going')">Going</button>
                <button type="button" :disabled="attendanceSaving" :aria-pressed="overview.attendance.currentStatus === 'maybe'" @click="setAttendance('maybe')">Maybe</button>
                <button type="button" :disabled="attendanceSaving" :aria-pressed="overview.attendance.currentStatus === 'not_going'" @click="setAttendance('not_going')">Can't go</button>
              </div>
              <div class="sbar" style="margin-top:14px">
                <div :style="{ width: goingPct + '%', background: 'var(--green)' }"></div>
                <div :style="{ width: (100 - goingPct) + '%', background: 'var(--card-3)' }"></div>
              </div>
              <div class="keys">
                <div><span class="sw" style="background:var(--green)"></span><span class="lb">Going</span><span class="pc n">{{ goingPct }}%</span><span class="vl n">{{ overview.attendance.counts.going }}</span></div>
                <div><span class="sw" style="background:var(--card-3)"></span><span class="lb">Not responded</span><span class="vl n">{{ overview.attendance.counts.notResponded }}</span></div>
              </div>
            </div>
            <div class="ed-roster-tabs" style="padding:0 16px">
              <button type="button" :class="{ 'is-active': rosterView === 'going' }" @click="rosterView = 'going'">Going <b>{{ overview.attendance.counts.going }}</b></button>
              <button type="button" :class="{ 'is-active': rosterView === 'not_responded' }" @click="rosterView = 'not_responded'">Not responded <b>{{ overview.attendance.counts.notResponded }}</b></button>
            </div>
            <div v-for="member in attendanceMembers.slice(0, 8)" :key="member.userId" class="mrow">
              <span v-if="!member.avatarUrl" class="av" style="width:34px;height:34px;font-size:12px">{{ initials(member.name) }}</span>
              <img v-else :src="member.avatarUrl" :alt="member.name" style="width:34px;height:34px;border-radius:50%;object-fit:cover" />
              <div><div class="nm">{{ member.name }}</div><div class="rl">{{ member.uniformNo ? `#${member.uniformNo} · ` : '' }}{{ member.role }}</div></div>
              <div class="sp">
                <div class="ed-person__menu" @click.stop>
                  <button type="button" class="kebab" :aria-expanded="openMemberMenu === member.userId" aria-label="Member options" @click="toggleMemberMenu(member.userId)">⋯</button>
                  <ul v-if="openMemberMenu === member.userId" class="ed-menu">
                    <li><button type="button" @click="viewMemberStats(member.userId)">View player stats</button></li>
                    <template v-if="overview.isAdmin">
                      <li class="ed-menu__label">Set attendance</li>
                      <li><button type="button" @click="setMemberAttendance(member.userId, 'going')">Going</button></li>
                      <li><button type="button" @click="setMemberAttendance(member.userId, 'not_going')">Not going</button></li>
                      <li><button type="button" @click="setMemberAttendance(member.userId, 'maybe')">Maybe</button></li>
                    </template>
                  </ul>
                </div>
              </div>
            </div>
            <p v-if="!attendanceMembers.length" style="margin:0;padding:0 16px 16px;color:var(--mu-2);font-size:13px">No members in this group.</p>
          </div>

          <div class="card">
            <header>
              <h2>{{ overview.location.type === 'online' ? 'Online event' : 'Location' }}</h2>
              <div v-if="overview.location.type !== 'online' && overview.location.label" class="sp"><a :href="directionsUrl" target="_blank" rel="noopener" style="font-size:12.5px">Directions</a></div>
            </header>
            <div class="pad">
              <p v-if="overview.location.label" style="margin:0 0 11px;font-size:13px;line-height:1.55">{{ overview.location.label }}</p>
              <a v-if="overview.location.type === 'online' && overview.location.onlineUrl" class="btn pri blk" :href="overview.location.onlineUrl" target="_blank" rel="noopener">Join online event</a>
              <div v-if="mapUrl && overview.location.type !== 'online'" class="map"><iframe :src="mapUrl" title="Event location map" loading="lazy" style="width:100%;height:150px;border:0"></iframe></div>
              <div v-if="overview.director.name" style="border-top:1px solid var(--line);padding-top:12px;margin-top:12px;display:flex;flex-direction:column;gap:2px">
                <small style="color:var(--mu)">Event director</small><b>{{ overview.director.name }}</b>
                <a v-if="overview.director.email" :href="`mailto:${overview.director.email}`" style="font-size:12.5px">{{ overview.director.email }}</a>
              </div>
            </div>
          </div>
        </div>
      </div>

      <section v-else class="ed-stats-view">
        <div v-if="activeTab === 'player-stats'" class="ed-stats-toolbar ed-stats-toolbar--player">
          <label class="ed-select-control">
            <span><AppIcon name="people" :size="15" /><small>Lineup Type</small></span>
            <select v-model="playerLineup" aria-label="Lineup type"><option value="all">All Lineups</option></select>
          </label>
          <label class="ed-select-control">
            <span><AppIcon name="award" :size="15" /><small>Role</small></span>
            <select v-model="playerRole" aria-label="Player role">
              <option value="all">All Roles</option>
              <option v-for="role in playerRoles" :key="role" :value="role">{{ role }}</option>
            </select>
          </label>
          <label class="ed-select-control">
            <span><AppIcon name="text" :size="15" /><small>Sort By</small></span>
            <select v-model="playerSort" aria-label="Sort player statistics">
              <option value="games">Games Played</option><option value="onbase">Onbase %</option><option value="average">Average</option><option value="hr">Home Runs</option><option value="rbi">RBI</option>
            </select>
          </label>
          <label class="ed-select-control">
            <span><AppIcon name="document" :size="15" /><small>View</small></span>
            <select v-model="playerView" aria-label="Statistics view"><option value="standard">Standard</option><option value="compact">Compact</option></select>
          </label>
          <div class="ed-toolbar-spacer"></div>
          <div class="ed-search">
            <AppIcon name="search" :size="16" /><input v-model="playerSearch" type="search" placeholder="Search players..." aria-label="Search players" />
          </div>
          <button type="button" class="ed-square-btn" title="Reset filters" aria-label="Reset filters" @click="resetPlayerFilters"><AppIcon name="task" :size="18" /></button>
          <button type="button" class="ed-export-btn" @click="exportPlayerStats"><AppIcon name="document" :size="17" />Export</button>
        </div>
        <div v-else class="ed-stats-toolbar ed-stats-toolbar--team">
          <label class="ed-select-control">
            <small>Scope</small>
            <select aria-label="Statistics scope"><option>Event</option></select>
          </label>
          <label class="ed-select-control">
            <small>Date Range</small>
            <select v-model="teamDateRange" aria-label="Date range"><option value="all">All Games</option><option value="last3">Last 3 Games</option><option value="last7">Last 7 Games</option></select>
          </label>
          <label class="ed-select-control">
            <small>Split</small>
            <select v-model="teamSplit" aria-label="Result split"><option value="all">All</option><option value="won">Won</option><option value="lost">Lost</option></select>
          </label>
          <label class="ed-select-control ed-select-control--wide">
            <small>Opponent</small>
            <select v-model="teamOpponent" aria-label="Opponent"><option value="all">All</option><option v-for="opponent in teamOpponents" :key="opponent" :value="opponent">{{ opponent }}</option></select>
          </label>
          <div class="ed-toolbar-spacer"></div>
          <button type="button" class="ed-reset-btn" @click="resetTeamFilters"><AppIcon name="task" :size="17" />Reset Filters</button>
        </div>

        <div class="ed-metrics">
          <article v-for="metric in metricCards" :key="metric.label" :class="`is-${metric.tone}`">
            <span><AppIcon :name="metric.icon" :size="20" /></span>
            <div><small>{{ metric.label }}</small><b>{{ metric.value }}</b><p>{{ metric.hint }}</p></div>
          </article>
        </div>

        <div v-if="activeTab === 'player-stats'" class="ed-player-grid">
          <section class="ed-panel ed-table-panel">
            <div class="ed-side-title"><h2>Player Statistics</h2><span>{{ visiblePlayers.length }} players</span></div>
            <div class="ed-table-scroll">
              <table :class="{ 'is-compact': playerView === 'compact' }">
                <thead><tr><th>Player</th><th>Games</th><th>Onbase %</th><th>Average</th><th>AB</th><th>H</th><th>HR</th><th>RBI</th><th>R</th></tr></thead>
                <tbody>
                  <tr v-for="(player, index) in visiblePlayers" :key="player.userId">
                    <td><span class="ed-rank">{{ index + 1 }}</span><span v-if="!player.avatarUrl" class="ed-table-avatar">{{ initials(player.name) }}</span><img v-else :src="player.avatarUrl" :alt="player.name" /><span><b>{{ player.name }}</b><small>{{ player.role }}</small></span></td>
                    <td>{{ player.games }}</td><td>{{ player.onbase }}</td><td>{{ player.average }}</td><td>{{ player.ab }}</td><td>{{ player.h }}</td><td>{{ player.hr }}</td><td>{{ player.rbi }}</td><td>{{ player.runs }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="!visiblePlayers.length" class="ed-empty ed-empty--inside"><h2>No player statistics yet</h2><p>Completed scoresheets will populate this table.</p></div>
          </section>
          <aside class="ed-side">
            <section class="ed-panel ed-top-list"><div class="ed-side-title"><h2>Top Performers</h2></div><div v-for="(player, index) in visiblePlayers.slice(0, 5)" :key="player.userId" class="ed-top-row"><b>{{ index + 1 }}</b><span>{{ player.name }}</span><strong>{{ player.onbase }}<small>Onbase %</small></strong></div></section>
            <section class="ed-panel ed-chart-card"><div class="ed-side-title"><h2>Performance Trend</h2><span>Event</span></div><svg viewBox="0 0 760 120" role="img" aria-label="Performance trend"><polyline :points="chartLines.onbase" class="line-blue" /><polyline :points="chartLines.average" class="line-violet" /></svg><div class="ed-legend"><span><i class="is-blue"></i>Onbase %</span><span><i class="is-violet"></i>Average</span></div></section>
          </aside>
        </div>

        <template v-else>
          <div class="ed-team-insights">
            <section class="ed-panel ed-performance">
              <div class="ed-side-title"><h2>Team Performance Trend</h2><span>All event games</span></div>
              <svg viewBox="0 0 760 120" role="img" aria-label="Team performance trend"><line v-for="n in 4" :key="n" x1="20" :y1="n * 24" x2="740" :y2="n * 24" /><polyline :points="chartLines.onbase" class="line-blue" /><polyline :points="chartLines.average" class="line-violet" /></svg>
              <div class="ed-legend"><span><i class="is-blue"></i>Onbase %</span><span><i class="is-violet"></i>Average</span></div>
            </section>
            <section class="ed-panel ed-offense">
              <div class="ed-side-title"><h2>Offense Breakdown</h2></div>
              <div class="ed-offense__body">
                <div class="ed-donut" :style="offenseStyle"><span><b>{{ activeStats.h.toLocaleString() }}</b><small>Total Hits</small></span></div>
                <div class="ed-offense__legend"><span><i class="is-blue"></i>Singles <b>{{ activeStats.oneB }}</b></span><span><i class="is-violet"></i>Doubles <b>{{ activeStats.twoB }}</b></span><span><i class="is-yellow"></i>Triples <b>{{ activeStats.threeB }}</b></span><span><i class="is-green"></i>Home Runs <b>{{ activeStats.hr }}</b></span></div>
              </div>
            </section>
          </div>
          <section class="ed-panel ed-table-panel">
            <div class="ed-side-title"><h2>Event Team Statistics</h2><span>{{ visibleTeamGames.length }} games</span></div>
            <div class="ed-table-scroll">
              <table class="ed-team-table">
                <thead><tr><th>Game</th><th>Result</th><th>Onbase %</th><th>Average</th><th>AB</th><th>H</th><th>1B</th><th>2B</th><th>3B</th><th>HR</th><th>RBI</th><th>R</th><th>BB</th></tr></thead>
                <tbody>
                  <tr v-for="game in visibleTeamGames" :key="game.gameId"><td><b>{{ game.opponentName }}</b><small>{{ game.dateLabel }}</small></td><td><span class="ed-result" :class="game.result === 'won' ? 'is-won' : 'is-lost'">{{ game.result || 'Pending' }}</span></td><td>{{ game.onbase }}</td><td>{{ game.average }}</td><td>{{ game.ab }}</td><td>{{ game.h }}</td><td>{{ game.oneB }}</td><td>{{ game.twoB }}</td><td>{{ game.threeB }}</td><td>{{ game.hr }}</td><td>{{ game.rbi }}</td><td>{{ game.runs }}</td><td>{{ game.bb }}</td></tr>
                </tbody>
              </table>
            </div>
            <div v-if="!visibleTeamGames.length" class="ed-empty ed-empty--inside"><h2>{{ teamStats.games.length ? 'No matching games' : 'No team statistics yet' }}</h2><p>{{ teamStats.games.length ? 'Reset or change the filters to see more games.' : 'Completed scoresheets will populate this event table.' }}</p></div>
          </section>
        </template>
      </section>
    </template>
    </div>

    <CreateGameModal
      v-if="overview"
      :model-value="gameFormOpen"
      :team-id="teamId"
      :event-id="eventId"
      :game="editingGame"
      @update:model-value="onGameFormClosed"
      @saved="onGameCreated"
    />

    <GameLineupModal
      v-if="overview && lineupGameId"
      v-model="lineupOpen"
      :team-id="teamId"
      :event-id="eventId"
      :game-id="lineupGameId"
      @saved="() => pushToast({ tone: 'success', title: 'Lineup saved' })"
    />
  </main>
</template>

<style scoped>
.event-detail{--ed-bg:var(--body-bg);--ed-panel:var(--surface-card);--ed-panel-2:var(--surface-raised);--ed-border:var(--border-divider);--ed-text:var(--text);--ed-muted:var(--secondary);--ed-blue:var(--primary);--ed-violet:#8b43ef;--ed-green:var(--success);--ed-red:var(--highlight);color:var(--ed-text);width:100%;margin:0;padding:0;min-height:calc(100vh - 64px);letter-spacing:0}
/* Redesign shell: pin the sticky .bar below the member top bar. */
.event-detail .bar{top:56px}
@media(max-width:720px){.event-detail .bar{top:52px}}
.ed-hero,.ed-panel,.ed-stats-toolbar,.ed-metrics article{background:var(--ed-panel);border:1px solid var(--ed-border);border-radius:8px}
.ed-hero{min-height:138px;padding:24px 30px;display:flex;align-items:center;justify-content:space-between;gap:28px}
.ed-identity{display:flex;align-items:center;gap:20px;min-width:0}.ed-back,.ed-icon-btn{width:40px;height:40px;border:1px solid var(--ed-border);background:var(--surface-raised);color:var(--ed-text);display:grid;place-items:center;border-radius:8px;cursor:pointer}.ed-back span{font-size:32px;line-height:1;margin-top:-4px}.ed-identity__copy{min-width:0}.ed-identity__copy p{margin:0 0 7px;color:var(--ed-muted);font-size:14px}.ed-identity__copy h1{margin:0;font-size:29px;line-height:1.2;letter-spacing:0;overflow-wrap:anywhere}.ed-tags{display:flex;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap}.ed-tags>span,.ed-tags button{border:1px solid #21446c;background:#0a2748;color:var(--primary);padding:4px 10px;border-radius:6px;font-size:12px}.ed-tags>span:nth-child(2){background:#271454;border-color:#543198;color:#bf8cff}.ed-tags button{display:inline-flex;align-items:center;gap:6px;background:transparent;color:var(--ed-text);cursor:pointer}
.ed-record{display:grid;grid-template-columns:repeat(3,96px);align-self:stretch}.ed-record span{display:flex;flex-direction:column;align-items:center;justify-content:center;border-left:1px solid var(--ed-border)}.ed-record small{color:var(--ed-muted);font-size:12px}.ed-record b{font-size:26px;margin-top:8px}.ed-record .is-won b{color:var(--ed-green)}.ed-record .is-lost b{color:var(--ed-red)}
.ed-tabs{height:54px;border-bottom:1px solid var(--ed-border);display:flex;gap:20px;align-items:end;padding:0 10px;margin-bottom:16px;overflow-x:auto}.ed-tabs button{height:54px;padding:0 20px;border:0;border-bottom:3px solid transparent;background:transparent;color:var(--ed-muted);font-weight:700;white-space:nowrap;cursor:pointer}.ed-tabs button.is-active{color:var(--primary);border-bottom-color:var(--ed-blue);text-shadow:0 0 18px #2688ff}
.ed-boxscore-layout,.ed-player-grid{display:grid;grid-template-columns:minmax(0,1.75fr) minmax(310px,.95fr);gap:16px}.ed-panel{min-width:0}.ed-panel-toolbar{display:flex;align-items:center;justify-content:space-between;padding:16px;border-bottom:1px solid var(--ed-border)}.ed-segments{display:flex;gap:8px}.ed-segments button,.ed-rsvp button{border:1px solid var(--ed-border);background:var(--surface-raised);color:var(--ed-text);padding:8px 22px;border-radius:7px;cursor:pointer}.ed-segments button.is-active,.ed-rsvp button.is-active{border-color:var(--primary);background:var(--primary);box-shadow:0 0 12px rgba(24,125,255,.26)}.ed-count{color:var(--ed-muted);font-size:13px}
.ed-games{display:grid;gap:10px;padding:12px}.ed-game{min-height:158px;display:grid;grid-template-columns:98px minmax(0,1fr) 40px;border:1px solid var(--ed-border);border-radius:8px;background:var(--surface-card);overflow:hidden}.ed-game.is-live{border-color:#356dea;box-shadow:inset 0 0 0 1px #7a32dd}.ed-game__date{border-right:1px solid var(--ed-border);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:10px}.ed-game__date small{color:var(--ed-muted)}.ed-game__date b{font-size:17px;margin:5px 0 18px}.ed-game__body{padding:14px 20px;min-width:0}.ed-game__heading{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px}.ed-game__heading>b{font-size:16px}.ed-game__heading>small{color:var(--ed-muted)}.ed-status{font-size:11px;padding:4px 9px;border-radius:12px;border:1px solid var(--ed-border)}.ed-status.is-ongoing{color:#ffbe54;border-color:#855a21;background:#352616}.ed-status.is-final{color:#c4cfdf}.ed-status.is-scheduled{color:var(--primary);border-color:#235e9d;background:#0a2948}.ed-matchup{display:grid;grid-template-columns:38px minmax(90px,1fr) 42px 1px 42px 38px minmax(90px,1fr);align-items:center;gap:10px;margin:18px 0}.ed-matchup strong{font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ed-matchup>b{font-size:24px;text-align:center}.ed-matchup>i{height:28px;background:var(--ed-border)}.ed-team-mark,.ed-table-avatar,.ed-person__avatar{display:grid;place-items:center;border-radius:50%;background:#223959;color:#d9e9ff;font-weight:800}.ed-team-mark{width:36px;height:36px;font-size:11px}.ed-game__body>p{display:flex;align-items:center;gap:7px;margin:0;color:var(--ed-muted);font-size:12px}.ed-game>.ed-icon-btn{margin:12px 10px 0 0;width:32px;height:32px}
.ed-side{display:grid;align-content:start;gap:12px}.ed-attendance,.ed-location{padding:18px}.ed-attendance__head,.ed-side-title{display:flex;justify-content:space-between;align-items:center;gap:12px}.ed-attendance h2,.ed-side-title h2{margin:0;font-size:17px}.ed-rsvp{display:flex;gap:6px}.ed-rsvp button{padding:8px 12px}.ed-roster-tabs{display:flex;gap:20px;border-bottom:1px solid var(--ed-border);margin-top:16px}.ed-roster-tabs button{border:0;border-bottom:3px solid transparent;background:none;color:var(--ed-muted);padding:10px 0;cursor:pointer}.ed-roster-tabs button.is-active{color:var(--primary);border-color:var(--ed-blue)}.ed-roster-tabs b{background:var(--surface-raised);border-radius:10px;padding:2px 6px}.ed-roster{display:grid;gap:8px;margin-top:12px}.ed-person{display:grid;grid-template-columns:36px 1fr 18px;align-items:center;gap:10px;min-height:43px}.ed-person img,.ed-person__avatar{width:36px;height:36px;object-fit:cover}.ed-person__avatar{font-size:11px}.ed-person span:nth-child(2){display:flex;flex-direction:column;min-width:0}.ed-person b{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ed-person small{color:var(--ed-muted);font-size:11px;margin-top:3px}.ed-side-title>a{color:var(--primary);font-size:12px}.ed-side-title>span{color:var(--ed-muted);font-size:12px}.ed-location>p{display:flex;align-items:flex-start;gap:8px;color:var(--ed-muted);font-size:13px}.ed-location iframe{width:100%;height:220px;border:0;border-radius:7px;margin-top:10px;filter:saturate(.75) brightness(.7) contrast(1.1)}.ed-map-empty{height:150px;margin-top:10px;border:1px dashed var(--ed-border);display:grid;place-content:center;justify-items:center;gap:8px;color:var(--ed-muted);font-size:12px}.ed-join-link{display:flex;align-items:center;justify-content:center;gap:8px;padding:12px;background:var(--primary);color:#fff;text-decoration:none;border-radius:7px;margin:15px 0}.ed-director{display:flex;flex-direction:column;border-top:1px solid var(--ed-border);padding-top:12px;margin-top:12px}.ed-director small{color:var(--ed-muted)}.ed-director a{color:var(--primary);font-size:12px;margin-top:3px}.ed-side-empty{color:var(--ed-muted);font-size:13px}
/* Add Game button (games panel toolbar + empty-state CTA). */
.ed-panel-toolbar{display:flex;align-items:center;gap:12px}
.ed-add-game{margin-left:auto;display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border:1px solid #235e9d;border-radius:7px;background:var(--primary);color:#fff;font-size:13px;font-weight:500;cursor:pointer}
.ed-add-game:hover{filter:brightness(1.06)}
.ed-add-game--cta{margin:14px 0 0}
/* Attendee row ⋯ menu (matches the page's ed- dark idiom). */
.ed-person{grid-template-columns:36px 1fr auto}
.ed-person__menu{position:relative}
.ed-person__more{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:0;background:none;color:var(--ed-muted);border-radius:6px;cursor:pointer}
.ed-person__more:hover,.ed-person__more[aria-expanded=true]{background:var(--surface-raised);color:var(--text)}
.ed-menu{position:absolute;top:28px;right:0;z-index:20;min-width:172px;margin:0;padding:6px;list-style:none;background:var(--surface-chrome);border:1px solid var(--ed-border);border-radius:9px;box-shadow:0 12px 28px rgba(0,0,0,.45)}
.ed-menu li{list-style:none}
.ed-menu__label{padding:6px 10px 2px;color:var(--ed-muted);font-size:10px;text-transform:uppercase;letter-spacing:.05em}
.ed-menu button{width:100%;text-align:left;border:0;background:none;color:var(--text);font-size:13px;padding:8px 10px;border-radius:6px;cursor:pointer}
.ed-menu button:hover{background:var(--surface-raised)}
.ed-menu button.is-danger{color:var(--highlight)}
.ed-menu button svg,.ed-menu button :deep(svg){margin-right:2px;vertical-align:-2px}
/* Game card ⋯ menu — absolute top-right; card must not clip the dropdown. */
.ed-game{position:relative;overflow:visible}
.ed-game__heading{padding-right:30px}
.ed-game__menu{position:absolute;top:8px;right:8px;z-index:6}
.ed-game__menu .ed-icon-btn{width:30px;height:30px}
.ed-game-menu{top:34px}
.ed-stats-view{display:grid;gap:14px}.ed-stats-toolbar{min-height:66px;padding:9px 12px;display:flex;align-items:center;gap:9px}.ed-select-control{height:48px;min-width:160px;border:1px solid var(--ed-border);background:var(--surface-raised);border-radius:7px;padding:5px 10px;display:flex;flex-direction:column;justify-content:center}.ed-select-control>span{display:flex;align-items:center;gap:6px;color:var(--ed-muted)}.ed-select-control small{color:var(--ed-muted);font-size:10px}.ed-select-control select{width:100%;height:23px;border:0;background:transparent;color:var(--ed-text);font-weight:700;font-size:12px;outline:none;padding:0}.ed-select-control select option{background:var(--surface-card)}.ed-select-control--wide{min-width:190px}.ed-toolbar-spacer{flex:1}.ed-search{border:1px solid var(--ed-border);display:flex;align-items:center;gap:7px;padding:0 12px;height:40px;border-radius:7px;min-width:220px;background:var(--surface-raised)}.ed-search input{border:0;background:transparent;color:var(--ed-text);outline:none;width:100%}.ed-square-btn,.ed-export-btn,.ed-reset-btn{height:40px;border:1px solid var(--ed-border);border-radius:7px;color:var(--ed-text);background:var(--surface-raised);display:inline-flex;align-items:center;justify-content:center;gap:7px;cursor:pointer;white-space:nowrap}.ed-square-btn{width:40px}.ed-export-btn{padding:0 18px;background:var(--primary);border-color:#5571ff;font-weight:700}.ed-reset-btn{padding:0 16px}.ed-reset-btn:hover,.ed-square-btn:hover{border-color:#3b8ee9;color:#56aaff}
.ed-metrics{display:grid;grid-template-columns:repeat(6,minmax(130px,1fr));gap:12px}.ed-metrics article{min-height:116px;padding:15px;display:flex;gap:12px;align-items:flex-start}.ed-metrics article>span{width:38px;height:38px;display:grid;place-items:center;border-radius:50%;background:#0d3c7d;color:var(--primary)}.ed-metrics article.is-violet>span{background:#311b68;color:#b36dff}.ed-metrics article.is-green>span{background:#063f34;color:#23d893}.ed-metrics article.is-orange>span{background:#442515;color:#ff8b32}.ed-metrics article div{display:flex;flex-direction:column}.ed-metrics small,.ed-metrics p{color:var(--ed-muted);font-size:11px;margin:0}.ed-metrics b{font-size:22px;margin:5px 0}.ed-table-panel{padding:16px}.ed-table-scroll{overflow-x:auto;margin-top:12px;border:1px solid var(--ed-border);border-radius:7px}table{border-collapse:collapse;width:100%;min-width:820px}th,td{text-align:left;padding:12px;border-bottom:1px solid var(--ed-border);font-size:12px;white-space:nowrap}th{color:var(--text);background:var(--surface-raised);font-weight:700}td{color:var(--text)}td:first-child{display:flex;align-items:center;gap:9px}.ed-rank{color:var(--ed-muted);width:18px}.ed-table-avatar,td:first-child>img{width:34px;height:34px;object-fit:cover}.ed-table-avatar{font-size:10px}td:first-child>span:last-child{display:flex;flex-direction:column}td:first-child small{color:var(--primary);margin-top:3px}.ed-top-list,.ed-chart-card{padding:16px}.ed-top-row{display:grid;grid-template-columns:24px 1fr auto;align-items:center;min-height:48px;border-bottom:1px solid var(--ed-border);font-size:12px}.ed-top-row>b{color:var(--ed-muted)}.ed-top-row strong{display:flex;flex-direction:column;text-align:right}.ed-top-row small{color:var(--ed-muted);font-weight:400}.ed-chart-card svg,.ed-performance svg{width:100%;height:auto;margin-top:12px;overflow:visible}.ed-chart-card polyline,.ed-performance polyline{fill:none;stroke-width:2}.line-blue{stroke:#2788ff}.line-violet{stroke:#9248ee}.ed-performance line{stroke:#1b2c40;stroke-width:1}.ed-legend{display:flex;justify-content:center;gap:20px;color:var(--ed-muted);font-size:11px}.ed-legend span,.ed-offense__legend span{display:flex;align-items:center;gap:6px}.ed-legend i,.ed-offense__legend i{width:9px;height:9px;border-radius:50%}.is-blue{background:#2688ff}.is-violet{background:#9149ee}.is-yellow{background:#f4b317}.is-green{background:#15bd78}
.ed-team-insights{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(310px,.9fr);gap:14px}.ed-performance,.ed-offense{padding:18px}.ed-offense__body{display:flex;align-items:center;justify-content:center;gap:34px;padding:14px}.ed-donut{width:150px;aspect-ratio:1;border-radius:50%;display:grid;place-items:center}.ed-donut:before{content:"";grid-area:1/1;width:96px;aspect-ratio:1;background:var(--surface-card);border-radius:50%}.ed-donut span{grid-area:1/1;z-index:1;display:flex;flex-direction:column;align-items:center}.ed-donut b{font-size:22px}.ed-donut small{color:var(--ed-muted)}.ed-offense__legend{display:grid;gap:14px;font-size:12px}.ed-offense__legend b{margin-left:auto}.ed-team-table td:first-child{display:table-cell}.ed-team-table td:first-child b,.ed-team-table td:first-child small{display:block}.ed-team-table td:first-child small{color:var(--ed-muted);margin-top:3px}.ed-result{display:inline-block;text-transform:capitalize;padding:4px 12px;border-radius:12px}.ed-result.is-won{color:#23d893;background:#09362c}.ed-result.is-lost{color:#ff6370;background:#3b1821}
.ed-empty,.ed-error{display:grid;place-items:center;text-align:center;min-height:300px;color:var(--ed-muted)}.ed-empty h2,.ed-error h2{color:var(--ed-text);margin:8px 0 0}.ed-empty p,.ed-error p{margin:6px 0 14px}.ed-empty button,.ed-error button{background:var(--ed-blue);border:0;color:white;padding:9px 18px;border-radius:7px}.ed-empty--inside{min-height:220px}.ed-tab-loading{display:grid;gap:10px}.ed-shimmer{display:block;background:linear-gradient(90deg,var(--shimmer-start),var(--shimmer-mid),var(--shimmer-end));background-size:220% 100%;animation:participation-shimmer 1.5s linear infinite}.ed-shimmer--avatar{width:78px;height:78px;border-radius:50%}.ed-shimmer--title{width:280px;height:30px;border-radius:6px}.ed-shimmer--row{height:120px;border-radius:8px}
.event-detail{background:var(--ed-bg)}
@media(max-width:1100px){.ed-metrics{grid-template-columns:repeat(3,1fr)}.ed-boxscore-layout,.ed-player-grid{grid-template-columns:minmax(0,1fr) 320px}.ed-team-insights{grid-template-columns:1fr}}
@media(max-width:820px){.event-detail{padding:12px 12px 90px}.ed-hero{align-items:flex-start;padding:18px;flex-direction:column}.ed-identity{gap:12px}.ed-back{width:34px;height:34px}.ed-identity__copy h1{font-size:23px}.ed-record{width:100%;height:74px;grid-template-columns:repeat(3,1fr)}.ed-record span:first-child{border-left:0}.ed-boxscore-layout,.ed-player-grid{grid-template-columns:1fr}.ed-side{grid-template-columns:1fr}.ed-stats-toolbar{flex-wrap:wrap}.ed-search{margin-left:0;flex:1}.ed-metrics{grid-template-columns:repeat(2,1fr)}.ed-team-insights{grid-template-columns:1fr}.ed-game{grid-template-columns:78px minmax(0,1fr)}.ed-game>.ed-icon-btn{display:none}.ed-matchup{grid-template-columns:32px minmax(70px,1fr) 30px 1px 30px 32px minmax(70px,1fr);gap:6px}.ed-matchup strong{font-size:12px}.ed-attendance__head{align-items:flex-start;flex-direction:column}.ed-rsvp{width:100%}.ed-rsvp button{flex:1}.ed-offense__body{gap:20px}}
@media(max-width:520px){.event-detail{padding-inline:8px}.ed-hero{padding:14px}.ed-identity{align-items:flex-start}.ed-identity>:deep(.team-avatar){flex:0 0 auto}.ed-identity__copy p{font-size:12px}.ed-tags{gap:5px}.ed-tabs{gap:0;padding:0}.ed-tabs button{padding:0 14px}.ed-panel-toolbar{align-items:flex-start;gap:10px;flex-direction:column}.ed-segments{width:100%}.ed-segments button{flex:1;padding:8px}.ed-game{grid-template-columns:1fr}.ed-game__date{border-right:0;border-bottom:1px solid var(--ed-border);display:grid;grid-template-columns:auto 1fr auto;gap:8px;text-align:left;justify-items:start}.ed-game__date b{font-size:13px;margin:0}.ed-game__body{padding:12px}.ed-game__heading{grid-template-columns:auto 1fr}.ed-game__heading>small{grid-column:2}.ed-matchup{grid-template-columns:30px minmax(60px,1fr) 24px 1px 24px 30px minmax(60px,1fr);margin:14px 0}.ed-matchup>b{font-size:19px}.ed-metrics{gap:8px}.ed-metrics article{min-height:108px;padding:12px;gap:8px}.ed-metrics article>span{width:32px;height:32px}.ed-metrics b{font-size:18px}.ed-filter-block{min-width:calc(50% - 6px)}.ed-search{min-width:100%}.ed-stats-toolbar select{width:100%}.ed-offense__body{flex-direction:column}.ed-side{grid-template-columns:minmax(0,1fr)}}
table.is-compact th,table.is-compact td{padding-block:7px}
@media(max-width:820px){.ed-stats-toolbar{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:stretch}.ed-select-control,.ed-select-control--wide{min-width:0}.ed-toolbar-spacer{display:none}.ed-stats-toolbar--player .ed-search{grid-column:1/-1}.ed-stats-toolbar--player .ed-export-btn{grid-column:2}.ed-stats-toolbar--team .ed-reset-btn{grid-column:1/-1}.ed-search{margin-left:0;min-width:0}}
@media(max-width:520px){.ed-stats-toolbar{grid-template-columns:1fr}.ed-stats-toolbar--player .ed-search,.ed-stats-toolbar--player .ed-export-btn,.ed-stats-toolbar--team .ed-reset-btn{grid-column:1}.ed-square-btn{width:100%}.ed-search{min-width:100%}}
</style>
