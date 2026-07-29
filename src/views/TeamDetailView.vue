<script setup lang="ts">
// TeamDetailView
// --------------
// Member-facing team page opened from the chat team info panel (rows +
// Statistics button route here). Header shows team identity + association +
// record; 4 tabs mirror the legacy team page:
//   Events · Teammates · Player Statistics · Team Statistics
// Header + Team Statistics reuse fetchTeamDetail; the other tabs lazy-load
// their own lean v2 endpoints on first activation.

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import EditTeamModal from '../components/chat/EditTeamModal.vue'
import MatchGeniEventFormModal from '../components/MatchGeniEventFormModal.vue'
import MultiSelectDropdown from '../components/MultiSelectDropdown.vue'
import InviteToTeamModal from '../components/chat/InviteToTeamModal.vue'
import MessageComposer from '../components/chat/MessageComposer.vue'
import TeamAvatar from '../components/TeamAvatar.vue'
import StatusBadge from '../components/StatusBadge.vue'
import ToggleSwitch from '../components/ToggleSwitch.vue'
import { getAuthUserChatId } from '../auth-session'
import { confirmDialog } from '../confirm-center'
import {
  archiveTeam,
  fetchTeamDetail,
  leaveTeam,
  removeTeamMember,
  reportTeam,
  updateTeamMemberRole,
  updateTeamSettings,
  type ChatMessage,
  type ChatTeamDetail
} from '../api/chat'
import {
  fetchTeamAssociation,
  fetchTeamEvents,
  fetchTeamEventsData,
  fetchTeamGameStats,
  fetchTeamMembers,
  fetchTeamPlayerStats,
  type TeamAssociation,
  type TeamEventItem,
  type TeamEventFilterOptions,
  type TeamGameStats,
  type TeamMemberItem,
  type TeamPlayerStat,
  type TeamStatsFilters
} from '../api/teamDetail'
import { useChatStore } from '../stores/chat'
import { formatFileSize, formatTime, isAudioFile, isImageFile, isVideoFile } from '../components/chat/chat-format'
import { pushToast } from '../toast-center'

type TabKey = 'events' | 'teammates' | 'player-stats' | 'team-stats'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'events', label: 'Events' },
  { key: 'teammates', label: 'Teammates' },
  { key: 'player-stats', label: 'Player Statistics' },
  { key: 'team-stats', label: 'Team Statistics' }
]

const route = useRoute()
const router = useRouter()
const chatStore = useChatStore()
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
function onDocumentClick(event: MouseEvent) {
  closeMemberMenu()
  const target = event.target as Node | null
  if (settingsOpen.value && settingsWrap.value && target && !settingsWrap.value.contains(target)) {
    settingsOpen.value = false
  }
}

// Header/settings/actions.
const settingsOpen = ref(false)
const settingsWrap = ref<HTMLElement | null>(null)
const inviteOpen = ref(false)
const editOpen = ref(false)
const eventFormOpen = ref(false)
const currentChatId = computed(() => getAuthUserChatId())

function openCreateEvent() {
  settingsOpen.value = false
  eventFormOpen.value = true
}
async function onEventCreated() {
  pushToast({ tone: 'success', title: 'Event created' })
  await loadTab('events')
}

function goToChat(conversationId = detail.value?.conversationId ?? null) {
  router.push({
    name: 'chat',
    query: conversationId ? { conversationId } : undefined
  })
}
function openTeamSettings() {
  settingsOpen.value = !settingsOpen.value
}

const detail = ref<ChatTeamDetail | null>(null)
const association = ref<TeamAssociation | null>(null)
const loadingHeader = ref(true)

const activeTab = ref<TabKey>('events')

// Per-tab state
const events = ref<TeamEventItem[]>([])
const members = ref<TeamMemberItem[]>([])
const players = ref<TeamPlayerStat[]>([])
const teamGameStats = ref<TeamGameStats>({ games: [], total: null })
const loadingTab = ref(false)
// Monotonic token so out-of-order tab responses (from rapid switching) are
// ignored — the latest switch always wins. See loadTab().
let tabReqId = 0

// Count badges on each tab (matchgeni pattern). Shown only when > 0.
const tabCounts = computed<Record<TabKey, number>>(() => ({
  events: events.value.length,
  teammates: members.value.length,
  'player-stats': players.value.length,
  'team-stats': teamGameStats.value.games.length
}))

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

// ── Filters / sort ───────────────────────────────────────────────────────────
const currentYear = new Date().getFullYear()
const filterYear = ref(String(currentYear))
const filterType = ref('all')
const filterAssoc = ref('all')
const filterState = ref('all')
const showPast = ref(false)
const eventFilterOptions = ref<TeamEventFilterOptions>({
  availableYears: [currentYear],
  eventTypes: [],
  associations: [],
  states: [],
  defaultYear: currentYear,
  selectedYear: currentYear,
  past: false,
  pastLocked: false
})
const memberRole = ref<'all' | 'admins' | 'players' | 'fans'>('all')
const memberSearch = ref('')
const statEvent = ref('all')
const statType = ref('all')
const statAssoc = ref('all')
type PlayerSortKey = 'obp' | 'avg' | 'hr' | 'rbi' | 'r' | 'ab' | 'games'
const playerSort = ref<PlayerSortKey>('obp')
const PLAYER_SORTS: { key: PlayerSortKey; label: string }[] = [
  { key: 'obp', label: 'OBP' }, { key: 'avg', label: 'AVG' }, { key: 'hr', label: 'HR' },
  { key: 'rbi', label: 'RBI' }, { key: 'r', label: 'Runs' }, { key: 'ab', label: 'At Bats' },
  { key: 'games', label: 'Games' }
]
const eventYears = computed(() => eventFilterOptions.value.availableYears.map(String))
const eventTypes = computed(() => eventFilterOptions.value.eventTypes)
const eventAssocs = computed(() => eventFilterOptions.value.associations)
const eventStates = computed(() => eventFilterOptions.value.states)
const pastEventsLocked = computed(() => Number(filterYear.value) !== currentYear)
const eventFiltersChanged = computed(() =>
  filterYear.value !== String(currentYear) ||
  filterType.value !== 'all' ||
  filterAssoc.value !== 'all' ||
  filterState.value !== 'all' ||
  showPast.value
)

// MultiSelectDropdown (colleague's filter component) uses a string[] v-model;
// our filters are single 'all'-or-value strings, so adapt array <-> string.
function selectAdapter(state: { value: string }) {
  return computed<string[]>({
    get: () => (state.value === 'all' ? [] : [state.value]),
    set: (v) => { state.value = v[0] ?? 'all' }
  })
}
const filterYearArr = selectAdapter(filterYear)
const filterTypeArr = selectAdapter(filterType)
const filterAssocArr = selectAdapter(filterAssoc)
const filterStateArr = selectAdapter(filterState)

// Stats-tab filter adapters. Type/Association store the label (value == label).
// Event stores an id but must DISPLAY the event name — map both ways.
const statTypeArr = selectAdapter(statType)
const statAssocArr = selectAdapter(statAssoc)
const eventNameOptions = computed(() => events.value.map((e) => e.name))
const statEventArr = computed<string[]>({
  get: () => {
    if (statEvent.value === 'all') return []
    const hit = events.value.find((e) => e.id === statEvent.value)
    return hit ? [hit.name] : []
  },
  set: (v) => {
    const hit = v[0] ? events.value.find((e) => e.name === v[0]) : null
    statEvent.value = hit ? hit.id : 'all'
  }
})
const statFilterPayload = computed<TeamStatsFilters>(() => ({
  eventId: statEvent.value,
  eventType: statType.value,
  association: statAssoc.value
}))

const MEMBER_ROLES: { key: 'all' | 'admins' | 'players' | 'fans'; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'admins', label: 'Admins' },
  { key: 'players', label: 'Players' }, { key: 'fans', label: 'Fans' }
]

const filteredEvents = computed(() => events.value)

function resetEventFilters() {
  filterYear.value = String(currentYear)
  filterType.value = 'all'
  filterAssoc.value = 'all'
  filterState.value = 'all'
  showPast.value = false
}

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
const excludedMemberChatIds = computed(() =>
  members.value.map((m) => m.userChatId).filter((id): id is string => !!id)
)

const sortedPlayers = computed(() => {
  const key = playerSort.value
  const query = memberSearch.value.trim().toLowerCase()
  const num = (p: TeamPlayerStat) =>
    key === 'avg' || key === 'obp' ? parseFloat(p[key]) : (p[key] as number)
  return players.value
    .filter((player) => !query || player.name.toLowerCase().includes(query))
    .sort((a, b) => num(b) - num(a))
})

const memberBreakdown = computed(() => {
  const admins = members.value.filter((member) => member.isAdmin).length
  const fans = members.value.filter((member) => member.isFan).length
  const playersCount = members.value.filter((member) => member.isPlayer && !member.isAdmin).length
  return { admins, players: playersCount, fans }
})

const memberRingStyle = computed(() => {
  const total = Math.max(members.value.length, 1)
  const adminStop = (memberBreakdown.value.admins / total) * 100
  const playerStop = adminStop + (memberBreakdown.value.players / total) * 100
  return {
    background: `conic-gradient(#8b5cf6 0 ${adminStop}%, #2d8cf0 ${adminStop}% ${playerStop}%, #20c77a ${playerStop}% 100%)`
  }
})

const playerTotals = computed(() => players.value.reduce((totals, player) => ({
  games: totals.games + player.games,
  ab: totals.ab + player.ab,
  h: totals.h + player.h,
  hr: totals.hr + player.hr,
  rbi: totals.rbi + player.rbi,
  r: totals.r + player.r
}), { games: 0, ab: 0, h: 0, hr: 0, rbi: 0, r: 0 }))

const playerAverages = computed(() => {
  const count = Math.max(players.value.length, 1)
  const average = (key: 'avg' | 'obp') =>
    (players.value.reduce((sum, player) => sum + Number.parseFloat(player[key] || '0'), 0) / count).toFixed(3)
  return { avg: average('avg'), obp: average('obp') }
})

const teamTotals = computed(() => teamGameStats.value.total ?? {
  onbase: '0.000', avg: '0.000', ab: 0, h: 0, one_b: 0, two_b: 0,
  three_b: 0, hr: 0, rbi: 0, r: 0, bb: 0, sac: 0, e: 0
})

const teamMetricCards = computed(() => [
  { label: 'Onbase %', value: teamTotals.value.onbase, hint: 'League average', icon: 'target', tone: 'blue' },
  { label: 'Average', value: teamTotals.value.avg, hint: 'Team batting', icon: 'trend', tone: 'violet' },
  { label: 'AB', value: teamTotals.value.ab.toLocaleString(), hint: 'At bats', icon: 'edit', tone: 'blue' },
  { label: 'Hits', value: teamTotals.value.h.toLocaleString(), hint: 'Total hits', icon: 'award', tone: 'violet' },
  { label: 'HR', value: teamTotals.value.hr.toLocaleString(), hint: 'Home runs', icon: 'activity', tone: 'green' },
  { label: 'Runs', value: teamTotals.value.r.toLocaleString(), hint: 'Total runs', icon: 'people', tone: 'blue' }
])

const playerMetricCards = computed(() => [
  { label: 'Games Played', value: String(detail.value?.stats.games ?? playerTotals.value.games), hint: 'Team total', icon: 'calendar', tone: 'blue' },
  { label: 'Onbase %', value: playerAverages.value.obp, hint: 'League avg', icon: 'target', tone: 'violet' },
  { label: 'Average', value: playerAverages.value.avg, hint: 'League avg', icon: 'trend', tone: 'violet' },
  { label: 'AB', value: playerTotals.value.ab.toLocaleString(), hint: 'Total', icon: 'edit', tone: 'blue' },
  { label: 'Hits', value: playerTotals.value.h.toLocaleString(), hint: 'Total', icon: 'award', tone: 'green' },
  { label: 'HR', value: playerTotals.value.hr.toLocaleString(), hint: 'Total', icon: 'activity', tone: 'orange' }
])

const performancePoints = computed(() => {
  const games = teamGameStats.value.games.slice(0, 10)
  if (!games.length) return '0,54 90,46 180,50 270,34 360,42 450,28 540,38 630,24 720,36'
  const max = Math.max(...games.map((game) => Number.parseFloat(game.onbase || '0')), 1)
  return games.map((game, index) => {
    const x = games.length === 1 ? 360 : (index / (games.length - 1)) * 720
    const y = 72 - (Number.parseFloat(game.onbase || '0') / max) * 56
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
})

function memberRoleLabel(member: TeamMemberItem): string {
  if (member.isAdmin) return 'Admin'
  if (member.isFan) return 'Fan'
  if (member.isPlayer) return 'Player'
  return 'Member'
}

function eventTone(status: string): 'success' | 'neutral' | 'secondary' {
  if (status === 'Ongoing') return 'success'
  if (status === 'Completed') return 'secondary'
  return 'neutral'
}

function openEventDetail(eventId: string) {
  router.push({ name: 'team-event-detail', params: { teamId: teamId.value, eventId } })
}

// Always refetch on tab activation — the user wants fresh data on every switch,
// never a stale cached view. A per-call token guards against out-of-order
// responses when switching quickly (only the newest call commits + clears the
// loader). Shimmer shows for the duration of each fetch.
async function loadTab(tab: TabKey) {
  const reqId = ++tabReqId
  loadingTab.value = true
  try {
    if (tab === 'events') {
      const data = await fetchTeamEventsData(teamId.value, {
        year: filterYear.value,
        eventType: filterType.value,
        association: filterAssoc.value,
        state: filterState.value,
        past: showPast.value
      })
      if (reqId !== tabReqId) return
      events.value = data.events
      eventFilterOptions.value = data.filters
    } else if (tab === 'teammates') {
      const data = await fetchTeamMembers(teamId.value)
      if (reqId !== tabReqId) return
      members.value = data
    } else if (tab === 'player-stats') {
      // Events power the stat filter dropdowns; fetch both fresh.
      const [evs, ps] = await Promise.all([
        fetchTeamEvents(teamId.value),
        fetchTeamPlayerStats(teamId.value, statFilterPayload.value)
      ])
      if (reqId !== tabReqId) return
      events.value = evs
      players.value = ps
    } else if (tab === 'team-stats') {
      const [evs, gs] = await Promise.all([
        fetchTeamEvents(teamId.value),
        fetchTeamGameStats(teamId.value, statFilterPayload.value)
      ])
      if (reqId !== tabReqId) return
      events.value = evs
      teamGameStats.value = gs
    }
  } finally {
    // Only the latest request clears the loader.
    if (reqId === tabReqId) loadingTab.value = false
  }
}

function setTab(tab: TabKey) {
  if (tab === activeTab.value) return
  activeTab.value = tab
  void loadTab(tab)
}

async function refreshHeader() {
  const [d, a] = await Promise.all([
    fetchTeamDetail(teamId.value).catch(() => null),
    fetchTeamAssociation(teamId.value).catch(() => null)
  ])
  detail.value = d
  association.value = a
}

async function onTeamEdited() {
  await refreshHeader()
  members.value = await fetchTeamMembers(teamId.value)
}

async function onInviteSent() {
  members.value = await fetchTeamMembers(teamId.value)
  await refreshHeader()
}

async function setSetting(key: keyof ChatTeamDetail['settings'], value: boolean) {
  if (!detail.value) return
  const previous = detail.value.settings[key]
  detail.value.settings[key] = value
  try {
    detail.value.settings = await updateTeamSettings(teamId.value, { [key]: value })
  } catch (error) {
    if (detail.value) detail.value.settings[key] = previous
    pushToast({ tone: 'warning', title: 'Could not update setting', message: error instanceof Error ? error.message : 'Please try again.' })
  }
}

async function printTeamInfo() {
  settingsOpen.value = false
  const roster = members.value.length ? members.value : await fetchTeamMembers(teamId.value)
  if (!members.value.length) {
    members.value = roster
  }
  const popup = window.open('', '_blank', 'width=860,height=700')
  if (!popup) {
    pushToast({ tone: 'warning', title: 'Print blocked', message: 'Please allow popups to print team info.' })
    return
  }
  const rows = roster.map((m, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${m.name}</td>
      <td>${m.isAdmin ? 'Admin' : (m.isFan ? 'Fan' : 'Teammate')}</td>
      <td>${m.isPlayer ? 'Yes' : 'No'}</td>
      <td>${m.uniformNo || ''}</td>
    </tr>
  `).join('')
  popup.document.write(`
    <html>
      <head>
        <title>${detail.value?.name || 'Team'} Info</title>
        <style>
          body{font-family:Arial,sans-serif;padding:24px;color:#172033}
          h1{font-size:22px;margin:0 0 4px}
          p{margin:0 0 18px;color:#526477}
          table{width:100%;border-collapse:collapse;font-size:13px}
          th,td{border-bottom:1px solid #d8e1ec;padding:9px;text-align:left}
          th{background:#f4f8fd;color:#2f5f98}
        </style>
      </head>
      <body>
        <h1>${detail.value?.name || 'Team'}</h1>
        <p>${[detail.value?.categoryLabel, detail.value?.ageGenderLabel].filter(Boolean).join(' - ')}</p>
        <table>
          <thead><tr><th>#</th><th>Name</th><th>Role</th><th>Player</th><th>Uniform</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </body>
    </html>
  `)
  popup.document.close()
  popup.focus()
  popup.print()
}

function canManageMember(member: TeamMemberItem): boolean {
  return !!detail.value?.isAdmin && !!member.userChatId && member.userChatId !== currentChatId.value
}

async function changeMemberRole(member: TeamMemberItem, role: 'admin' | 'teammate' | 'fan') {
  if (!member.userId) return
  try {
    await updateTeamMemberRole(teamId.value, {
      userId: member.userId,
      userIdFirebase: member.userChatId ?? null
    }, {
      role,
      markAsPlayer: role !== 'fan' ? member.isPlayer : false
    })
    members.value = await fetchTeamMembers(teamId.value)
    pushToast({ tone: 'success', title: 'Member updated' })
  } catch (error) {
    pushToast({ tone: 'warning', title: 'Could not update member', message: error instanceof Error ? error.message : 'Please try again.' })
  } finally {
    openMemberMenu.value = null
  }
}

async function removeMemberFromTeam(member: TeamMemberItem) {
  if (!member.userChatId) return
  const ok = await confirmDialog({
    title: 'Remove member?',
    message: `${member.name} will be removed from this team.`,
    confirmLabel: 'Remove',
    danger: true
  })
  if (!ok) return
  try {
    await removeTeamMember(teamId.value, member.userChatId)
    members.value = await fetchTeamMembers(teamId.value)
    await refreshHeader()
    pushToast({ tone: 'success', title: 'Member removed' })
  } catch (error) {
    pushToast({ tone: 'warning', title: 'Could not remove member', message: error instanceof Error ? error.message : 'Please try again.' })
  } finally {
    openMemberMenu.value = null
  }
}

async function archiveCurrentTeam() {
  try {
    await archiveTeam(teamId.value, true)
    pushToast({ tone: 'success', title: 'Team archived' })
    settingsOpen.value = false
  } catch (error) {
    pushToast({ tone: 'warning', title: 'Could not archive team', message: error instanceof Error ? error.message : 'Please try again.' })
  }
}

async function reportCurrentTeam() {
  await reportTeam(teamId.value)
  pushToast({ tone: 'success', title: 'Team reported', message: 'Thanks. Our team will review it.' })
  settingsOpen.value = false
}

async function exitCurrentTeam() {
  const ok = await confirmDialog({
    title: 'Exit team?',
    message: `You will leave ${detail.value?.name || 'this team'}.`,
    confirmLabel: 'Exit team',
    danger: true
  })
  if (!ok) return
  await leaveTeam(teamId.value)
  pushToast({ tone: 'success', title: 'Left team' })
  router.push({ name: 'chat' })
}

type MessageTarget =
  | { type: 'team'; title: string; conversationId: string | null; avatarUrl: string | null }
  | { type: 'dm'; title: string; userChatId: string; avatarUrl: string | null }

const messageOpen = ref(false)
const messageTarget = ref<MessageTarget | null>(null)
const messageConversationId = ref<string | null>(null)
const messageLoading = ref(false)
const messageError = ref('')
const messageBody = ref<HTMLElement | null>(null)
const widgetMessages = computed<ChatMessage[]>(() =>
  messageConversationId.value ? (chatStore.messagesByConversation[messageConversationId.value] ?? []) : []
)
const widgetIsTeam = computed(() => messageTarget.value?.type === 'team')
const widgetSubtitle = computed(() =>
  messageTarget.value?.type === 'team' ? 'Team chat' : 'Direct message'
)

async function openTeamMessage() {
  messageTarget.value = {
    type: 'team',
    title: detail.value?.name || 'Team',
    conversationId: detail.value?.conversationId ?? null,
    avatarUrl: detail.value?.logoUrl ?? null
  }
  await openMessageWidget()
}

async function openMemberMessage(member: TeamMemberItem) {
  if (!member.userChatId) return
  openMemberMenu.value = null
  messageTarget.value = {
    type: 'dm',
    title: member.name,
    userChatId: member.userChatId,
    avatarUrl: member.avatarUrl ?? null
  }
  await openMessageWidget()
}

async function resolveMessageConversationId(): Promise<string | null> {
  const target = messageTarget.value
  if (!target) return null
  if (target.type === 'team') return target.conversationId
  return chatStore.openIndividualConversation(target.userChatId)
}

async function openMessageWidget() {
  messageOpen.value = true
  messageConversationId.value = null
  messageError.value = ''
  messageLoading.value = true
  try {
    const conversationId = await resolveMessageConversationId()
    if (!conversationId) throw new Error('Conversation was not found.')
    messageConversationId.value = conversationId
    await chatStore.openConversation(conversationId)
    await scrollMessageWidgetToBottom()
  } catch (error) {
    messageError.value = error instanceof Error ? error.message : 'Could not open chat.'
  } finally {
    messageLoading.value = false
  }
}

function closeMessageWidget() {
  messageOpen.value = false
}

async function scrollMessageWidgetToBottom() {
  await nextTick()
  const el = messageBody.value
  if (el) el.scrollTop = el.scrollHeight
}

function onWidgetSent() {
  void scrollMessageWidgetToBottom()
}

function isOwnMessage(message: ChatMessage): boolean {
  return message.senderChatId === currentChatId.value
}

function messageStatusLabel(message: ChatMessage): string {
  if (!isOwnMessage(message) || message.isDeleted) return ''
  return message.status === 'sent' ? '✓' : '✓✓'
}

function openTargetChat() {
  if (messageConversationId.value) goToChat(messageConversationId.value)
}

// Stat filter changes re-fetch the active stats tab. (Tab switches load via
// setTab / onMounted, so no activeTab watcher is needed — that would double-fire.)
watch([filterYear, filterType, filterAssoc, filterState, showPast], ([year]) => {
  const selectedYear = Number(year)
  const forcedPast = selectedYear < currentYear
  const forcedUpcoming = selectedYear > currentYear
  if ((forcedPast && !showPast.value) || (forcedUpcoming && showPast.value)) {
    showPast.value = forcedPast
    return
  }
  if (activeTab.value === 'events') void loadTab('events')
})

watch([statEvent, statType, statAssoc], () => {
  if (activeTab.value !== 'player-stats' && activeTab.value !== 'team-stats') return
  void loadTab(activeTab.value)
})

watch(
  () => widgetMessages.value[widgetMessages.value.length - 1]?.id,
  () => {
    if (messageOpen.value) void scrollMessageWidgetToBottom()
  }
)

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
  chatStore.connect()

  void loadTab(activeTab.value)
  document.addEventListener('click', onDocumentClick)
})

onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick))
</script>

<template>
  <main class="team-detail">
    <section class="team-detail__hero">
      <div class="team-detail__identity">
        <div class="team-heading">
          <template v-if="loadingHeader">
            <span class="shimmer-circle td-sk__avatar" aria-hidden="true"></span>
            <span class="shimmer-block td-sk__title" aria-hidden="true"></span>
          </template>
          <template v-else>
            <TeamAvatar :name="detail?.name || 'Team'" :image-url="detail?.logoUrl ?? undefined" size="lg" />
            <div class="team-detail__identity-copy">
              <h1>{{ detail?.name || 'Team' }}</h1>
              <p v-if="detail && (detail.categoryLabel || detail.ageGenderLabel)" class="hero-team-meta">
                {{ [detail.ageGenderLabel, detail.categoryLabel].filter(Boolean).join(' · ') }}
              </p>
              <p v-if="association" class="team-detail__assoc">
                <span>{{ association.name }}</span>
                <span v-if="association.registrationNo" class="team-detail__assoc-reg">· #{{ association.registrationNo }}</span>
              </p>
            </div>
          </template>
        </div>
      </div>

      <div ref="settingsWrap" class="team-detail__hero-actions" @click.stop>
          <button type="button" class="td-hero-btn" @click="openTeamMessage">
            <span class="td-asset-icon td-asset-icon--chat" aria-hidden="true"></span>
            <span>Message Team</span>
          </button>
          <button type="button" class="td-hero-btn" :class="{ 'is-active': settingsOpen }" @click="openTeamSettings">
            <span class="td-asset-icon td-asset-icon--settings" aria-hidden="true"></span>
            <span>Settings</span>
          </button>
          <div v-if="settingsOpen" class="td-settings-menu">
            <div class="td-settings-menu__section">
              <button v-if="detail?.isAdmin" type="button" class="td-settings-menu__item" @click="editOpen = true; settingsOpen = false">
                <AppIcon name="text" :size="16" />
                <span>Edit Team Details</span>
              </button>
              <button type="button" class= "td-settings-menu__item" @click="inviteOpen = true; settingsOpen = false">
                <AppIcon name="people" :size="16" />
                <span>Invite To Team</span>
              </button>
              <button type="button" class="td-settings-menu__item" @click="printTeamInfo">
                <AppIcon name="document" :size="16" />
                <span>Print Team Info</span>
              </button>
            </div>
            <div class="td-settings-menu__section">
              <div class="td-settings-menu__toggle">
                <span>SMS Notification</span>
                <ToggleSwitch :model-value="detail?.settings.smsNotification ?? false" @update:model-value="setSetting('smsNotification', $event)" />
              </div>
              <div class="td-settings-menu__toggle">
                <span>Push Notification</span>
                <ToggleSwitch :model-value="detail?.settings.pushNotification ?? false" @update:model-value="setSetting('pushNotification', $event)" />
              </div>
              <div v-if="detail?.isAdmin" class="td-settings-menu__toggle">
                <span>Show On Base % as Average</span>
                <ToggleSwitch :model-value="detail?.settings.showOnBaseAvg ?? false" @update:model-value="setSetting('showOnBaseAvg', $event)" />
              </div>
              <div v-if="detail?.isAdmin" class="td-settings-menu__toggle">
                <span>Show average for top 5 players</span>
                <ToggleSwitch :model-value="detail?.settings.showTop5Avg ?? false" @update:model-value="setSetting('showTop5Avg', $event)" />
              </div>
            </div>
            <div class="td-settings-menu__section td-settings-menu__section--danger">
              <button type="button" class="td-settings-menu__item td-settings-menu__item--danger" @click="archiveCurrentTeam">
                <AppIcon name="folder" :size="16" />
                <span>Archive Team</span>
              </button>
              <button type="button" class="td-settings-menu__item td-settings-menu__item--danger" @click="reportCurrentTeam">
                <AppIcon name="help" :size="16" />
                <span>Report Team</span>
              </button>
              <button type="button" class="td-settings-menu__item td-settings-menu__item--danger" @click="exitCurrentTeam">
                <AppIcon name="close" :size="16" />
                <span>Exit Team</span>
              </button>
            </div>
            <p v-if="detail?.createdByName" class="td-settings-menu__created">
              Created by {{ detail.createdByName }}
            </p>
          </div>
      </div>

      <div class="team-detail__record">
        <span class="team-detail__record-item"><b>{{ detail?.stats.games ?? 0 }}</b><small>Games</small></span>
        <span class="team-detail__record-item team-detail__record-item--won"><b>{{ detail?.stats.won ?? 0 }}</b><small>Won</small></span>
        <span class="team-detail__record-item team-detail__record-item--lost"><b>{{ detail?.stats.lost ?? 0 }}</b><small>Lost</small></span>
      </div>
    </section>

    <nav class="team-detail__tabs" role="tablist">
      <button
        v-for="(t, index) in TABS"
        :key="t.key"
        type="button"
        class="team-detail__tab"
        :class="{ 'team-detail__tab--active': activeTab === t.key }"
        role="tab"
        :aria-selected="activeTab === t.key"
        @click="setTab(t.key)"
      >
        <AppIcon :name="(['calendar', 'people', 'document', 'award'] as const)[index]" :size="16" />
        {{ t.label }}
      </button>
    </nav>

    <section class="team-detail__panel">
      <!-- Per-tab shimmer: shows on EVERY switch while fresh data loads (no
           stale content), shaped to match the tab's real layout. -->
      <div v-if="loadingTab" class="td-sk" aria-busy="true">
        <div v-if="activeTab === 'events' || activeTab === 'teammates'" class="td-sk-list">
          <div v-for="n in 6" :key="`tsk-${n}`" class="td-sk-row">
            <span class="shimmer-circle td-sk-row__avatar"></span>
            <span class="td-sk-row__lines">
              <span class="shimmer-block td-sk-row__l1"></span>
              <span class="shimmer-block td-sk-row__l2"></span>
            </span>
          </div>
        </div>
        <div v-else class="td-sk-table">
          <div v-for="n in 8" :key="`tskt-${n}`" class="td-sk-trow">
            <span class="shimmer-circle td-sk-trow__lead"></span>
            <span v-for="c in 6" :key="`tskc-${n}-${c}`" class="shimmer-block td-sk-trow__cell"></span>
          </div>
        </div>
      </div>

      <!-- Events -->
      <template v-else-if="activeTab === 'events'">
        <div class="td-tab-heading">
          <span class="td-tab-heading__icon"><AppIcon name="calendar" :size="24" /></span>
          <span>
            <h2>Events</h2>
            <p>Explore upcoming competitions, matches and showcases.</p>
          </span>
          <button
            v-if="detail?.isAdmin"
            type="button"
            class="association-users__invite-btn td-tab-heading__action"
            @click="openCreateEvent"
          >
            <span class="association-users__invite-icon association-teams__create-icon" aria-hidden="true"></span>
            <span>Add Event</span>
          </button>
        </div>
        <div class="td-content-grid">
          <section class="td-content-card td-content-card--main">
        <div class="association-teams__filters td-events-filters">
          <MultiSelectDropdown v-model="filterYearArr" :options="eventYears" placeholder="Year" single :searchable="false" aria-label="Year" />
          <MultiSelectDropdown v-model="filterTypeArr" :options="eventTypes" placeholder="Type" single :searchable="false" aria-label="Type" />
          <MultiSelectDropdown v-model="filterAssocArr" :options="eventAssocs" placeholder="Association" single :searchable="false" aria-label="Association" />
          <MultiSelectDropdown v-model="filterStateArr" :options="eventStates" placeholder="State" single :searchable="false" aria-label="State" />
          <button
            type="button"
            class="association-events__past-toggle"
            :class="{ 'association-events__past-toggle--on': showPast }"
            :disabled="pastEventsLocked"
            role="switch"
            :aria-checked="showPast ? 'true' : 'false'"
            @click="showPast = !showPast"
          >Past Events</button>
          <button v-if="eventFiltersChanged" type="button" class="td-events-reset" @click="resetEventFilters">
            <AppIcon name="task" :size="15" />Reset Filters
          </button>
        </div>
        <ul v-if="filteredEvents.length" class="team-detail__events">
          <li
            v-for="ev in filteredEvents"
            :key="ev.id"
            class="td-event td-event--clickable"
            role="link"
            tabindex="0"
            @click="openEventDetail(ev.id)"
            @keydown.enter="openEventDetail(ev.id)"
          >
            <div class="td-event__top">
              <StatusBadge :label="ev.statusLabel" :tone="eventTone(ev.statusLabel)" />
              <span class="td-event__date">{{ ev.dateRangeLabel }}</span>
            </div>
            <h3 class="td-event__name">{{ ev.name }}</h3>
            <p v-if="ev.association || ev.eventType" class="td-event__sub">
              {{ [ev.association, ev.eventType].filter(Boolean).join(' · ') }}
            </p>
            <p v-if="ev.locationType === 'online'" class="td-event__loc">
              <AppIcon name="message" :size="13" />
              {{ ev.mediumTypeLabel || 'Online event' }}
            </p>
            <p v-else-if="ev.location" class="td-event__loc"><AppIcon name="home" :size="13" /> {{ ev.location }}</p>
            <p v-if="ev.directorName" class="td-event__director">
              <AppIcon name="people" :size="13" />
              Director: {{ ev.directorName }}
              <span v-if="ev.directorEmail">· {{ ev.directorEmail }}</span>
            </p>
            <div v-if="ev.goingCount || ev.record" class="td-event__foot">
              <span v-if="ev.goingCount" class="td-event__going">
                <AppIcon name="people" :size="13" /> {{ ev.goingCount }} going
              </span>
              <span v-if="ev.record" class="td-event__record">
                <span><b>{{ ev.record.games }}</b> Games</span>
                <span><b>{{ ev.record.won }}</b> Won</span>
                <span><b>{{ ev.record.lost }}</b> Lost</span>
              </span>
            </div>
          </li>
        </ul>
        <div v-else class="matchgeni-placeholder">
          <h3 class="matchgeni-placeholder__title">{{ events.length ? 'No matching events' : 'No events yet' }}</h3>
          <p class="matchgeni-placeholder__copy">{{ events.length ? 'No events match the current filters. Try broadening them.' : 'This team has not been added to any events yet.' }}</p>
          <button
            v-if="!events.length && detail?.isAdmin"
            type="button"
            class="association-users__invite-btn td-placeholder-action"
            @click="openCreateEvent"
          >
            <span class="association-users__invite-icon association-teams__create-icon" aria-hidden="true"></span>
            <span>Create the first event</span>
          </button>
        </div>
          </section>
          <aside class="td-side-stack">
            <section class="td-side-card">
              <div class="td-side-card__head"><h3>Upcoming Highlights</h3><span>{{ events.length }} events</span></div>
              <div v-if="events.length" class="td-highlight-list">
                <button v-for="event in events.slice(0, 3)" :key="`highlight-${event.id}`" type="button" class="td-highlight" @click="openEventDetail(event.id)">
                  <span class="td-highlight__icon"><AppIcon name="trophy" :size="17" /></span>
                  <span><b>{{ event.name }}</b><small>{{ event.dateRangeLabel }}</small></span>
                  <StatusBadge :label="event.statusLabel" :tone="eventTone(event.statusLabel)" />
                </button>
              </div>
              <p v-else class="td-side-empty">Highlights appear when events are added.</p>
            </section>
            <section class="td-side-card">
              <div class="td-side-card__head"><h3>Attendance Overview</h3><span>This year</span></div>
              <div class="td-attendance">
                <div class="td-mini-ring"><b>{{ events.reduce((sum, event) => sum + (event.goingCount || 0), 0) }}</b><small>Total going</small></div>
                <div class="td-attendance__copy">
                  <span><i class="is-green"></i>Going <b>{{ events.reduce((sum, event) => sum + (event.goingCount || 0), 0) }}</b></span>
                  <span><i class="is-blue"></i>Events <b>{{ events.length }}</b></span>
                  <span><i class="is-violet"></i>Past <b>{{ events.filter((event) => event.statusLabel === 'Completed').length }}</b></span>
                </div>
              </div>
            </section>
            <section class="td-side-card">
              <div class="td-side-card__head"><h3>Quick Actions</h3></div>
              <div class="td-quick-actions">
                <button type="button" @click="router.push({ name: 'calendar' })"><AppIcon name="calendar" :size="20" /><span>View Calendar</span></button>
                <button type="button" @click="printTeamInfo"><AppIcon name="document" :size="20" /><span>Print Schedule</span></button>
              </div>
            </section>
          </aside>
        </div>
      </template>

      <!-- Teammates -->
      <template v-else-if="activeTab === 'teammates'">
        <div class="td-content-grid">
          <section class="td-content-card td-content-card--main">
            <div class="td-section-title">
              <span><h2>Teammates</h2><p>Manage players, admins and team followers.</p></span>
              <b><AppIcon name="people" :size="18" /> {{ filteredMembers.length }} Members</b>
            </div>
        <div v-if="members.length" class="td-members-head">
          <div class="td-members-actions">
            <label class="td-search-wrap">
              <AppIcon name="search" :size="15" />
              <input v-model="memberSearch" type="search" class="td-search" placeholder="Search teammates" aria-label="Search teammates" />
            </label>
            <button type="button" class="td-toolbar-btn" @click="printTeamInfo">
              <span class="td-asset-icon td-asset-icon--print" aria-hidden="true"></span>
              <span>Print Team Info</span>
            </button>
            <button type="button" class="td-toolbar-btn" @click="inviteOpen = true">
              <span class="td-asset-icon td-asset-icon--invite" aria-hidden="true"></span>
              <span>Invite To Team</span>
            </button>
          </div>
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
              <span class="td-member__sub">{{ m.uniformNo ? `Jersey #${m.uniformNo}` : memberRoleLabel(m) }}</span>
            </span>
            <span class="td-member__role-pill" :class="`is-${memberRoleLabel(m).toLowerCase()}`">{{ memberRoleLabel(m) }}</span>
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
                  <button type="button" :disabled="!m.userChatId" @click="openMemberMessage(m)">
                    Send Direct Message
                  </button>
                </li>
                <li>
                  <button type="button" :disabled="!m.userId" @click="viewPlayerStats(m.userId)">
                    View Player Stats
                  </button>
                </li>
                <li v-if="canManageMember(m) && (m.isAdmin || m.isFan)">
                  <button type="button" @click="changeMemberRole(m, 'teammate')">
                    Make Team Member
                  </button>
                </li>
                <li v-if="canManageMember(m) && !m.isAdmin">
                  <button type="button" @click="changeMemberRole(m, 'admin')">
                    Make Team Admin
                  </button>
                </li>
                <li v-if="canManageMember(m) && !m.isFan">
                  <button type="button" @click="changeMemberRole(m, 'fan')">
                    Make Fan
                  </button>
                </li>
                <li v-if="canManageMember(m)">
                  <button type="button" class="is-danger" @click="removeMemberFromTeam(m)">
                    Remove From Team
                  </button>
                </li>
              </ul>
            </div>
          </li>
        </ul>
        <div v-else class="matchgeni-placeholder">
          <h3 class="matchgeni-placeholder__title">{{ members.length ? 'No matching teammates' : 'No teammates yet' }}</h3>
          <p class="matchgeni-placeholder__copy">{{ members.length ? 'No teammates match your search or filter.' : 'Invite people to build out this team roster.' }}</p>
        </div>
          </section>
          <aside class="td-side-stack">
            <section class="td-side-card">
              <div class="td-side-card__head"><h3>Team Overview</h3></div>
              <div class="td-overview">
                <div class="td-member-ring" :style="memberRingStyle">
                  <span><b>{{ members.length }}</b><small>Members</small></span>
                </div>
                <div class="td-overview__legend">
                  <span><i class="is-violet"></i>Admins <b>{{ memberBreakdown.admins }}</b></span>
                  <span><i class="is-blue"></i>Players <b>{{ memberBreakdown.players }}</b></span>
                  <span><i class="is-green"></i>Fans <b>{{ memberBreakdown.fans }}</b></span>
                </div>
              </div>
            </section>
            <section class="td-side-card">
              <div class="td-side-card__head"><h3>Quick Actions</h3></div>
              <div class="td-action-list">
                <button type="button" @click="inviteOpen = true"><span class="td-action-list__icon"><AppIcon name="people" :size="18" /></span><span><b>Invite via Link</b><small>Share join link with others</small></span><b>›</b></button>
                <button type="button" @click="inviteOpen = true"><span class="td-action-list__icon is-violet"><AppIcon name="people" :size="18" /></span><span><b>Bulk Invite</b><small>Invite multiple members</small></span><b>›</b></button>
                <button type="button" @click="openTeamSettings"><span class="td-action-list__icon"><AppIcon name="task" :size="18" /></span><span><b>Manage Roles</b><small>Update roles and permissions</small></span><b>›</b></button>
              </div>
            </section>
            <section class="td-side-card td-help-card">
              <AppIcon name="help" :size="34" />
              <span><h3>Need Help?</h3><p>Learn how to manage your team.</p></span>
            </section>
          </aside>
        </div>
      </template>

      <!-- Player Statistics -->
      <template v-else-if="activeTab === 'player-stats'">
        <div class="td-stats-toolbar">
        <div v-if="events.length" class="association-teams__filters td-stats-filters">
          <MultiSelectDropdown v-model="statEventArr" :options="eventNameOptions" placeholder="Event" single :searchable="false" aria-label="Event" />
          <MultiSelectDropdown v-model="statTypeArr" :options="eventTypes" placeholder="Type" single :searchable="false" aria-label="Type" />
          <MultiSelectDropdown v-model="statAssocArr" :options="eventAssocs" placeholder="Association" single :searchable="false" aria-label="Association" />
        </div>
          <label class="td-search-wrap td-search-wrap--stats">
            <AppIcon name="search" :size="15" />
            <input v-model="memberSearch" type="search" class="td-search" placeholder="Search players..." aria-label="Search players" />
          </label>
        </div>
        <div class="td-metric-grid">
          <article v-for="metric in playerMetricCards" :key="metric.label" class="td-metric-card" :class="`is-${metric.tone}`">
            <span class="td-metric-card__icon"><AppIcon name="trophy" :size="20" /></span>
            <span><small>{{ metric.label }}</small><b>{{ metric.value }}</b><em>{{ metric.hint }}</em></span>
            <i></i>
          </article>
        </div>
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
        <div v-if="players.length" class="td-stats-layout">
          <section class="td-content-card td-content-card--table">
            <div class="td-side-card__head"><h3>Player Statistics</h3><span>{{ players.length }} players</span></div>
        <div class="team-detail__table-wrap">
          <table class="team-detail__table">
            <thead>
              <tr>
                <th class="td-l">Player</th><th>G</th><th>AB</th><th>H</th>
                <th>HR</th><th>RBI</th><th>R</th><th>BB</th><th>AVG</th><th>OBP</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(p, i) in sortedPlayers" :key="p.userId" :class="{ 'td-leader': i === 0 }">
                <td class="td-l"><span v-if="i === 0" class="td-leader-mark" aria-hidden="true">★</span>{{ p.name }}</td>
                <td>{{ p.games }}</td><td>{{ p.ab }}</td><td>{{ p.h }}</td>
                <td>{{ p.hr }}</td><td>{{ p.rbi }}</td><td>{{ p.r }}</td><td>{{ p.bb }}</td>
                <td>{{ p.avg }}</td><td>{{ p.obp }}</td>
              </tr>
            </tbody>
          </table>
        </div>
          </section>
          <aside class="td-side-stack">
            <section class="td-side-card">
              <div class="td-side-card__head"><h3>Top Performers</h3><span>View all</span></div>
              <ol class="td-performers">
                <li v-for="(player, index) in sortedPlayers.slice(0, 5)" :key="`top-${player.userId}`">
                  <b>{{ index + 1 }}</b><span>{{ player.name }}</span><strong>{{ index === 0 ? player.obp : index === 1 ? player.avg : player.h }}</strong>
                </li>
              </ol>
            </section>
            <section class="td-side-card">
              <div class="td-side-card__head"><h3>Performance Trend</h3><span>30D</span></div>
              <svg class="td-trend" viewBox="0 0 720 90" preserveAspectRatio="none" aria-label="Performance trend">
                <polyline points="0,62 90,45 180,58 270,30 360,52 450,26 540,46 630,22 720,38" />
                <polyline class="is-violet" points="0,72 90,62 180,68 270,48 360,60 450,42 540,58 630,38 720,52" />
              </svg>
            </section>
          </aside>
        </div>
        <div v-else class="matchgeni-placeholder">
          <h3 class="matchgeni-placeholder__title">No player statistics yet</h3>
          <p class="matchgeni-placeholder__copy">Batting stats will show here once this team’s games are scored.</p>
        </div>
      </template>

      <!-- Team Statistics — per-game batting table + Total row (legacy layout) -->
      <template v-else-if="activeTab === 'team-stats'">
        <div class="td-stats-toolbar">
        <div v-if="events.length" class="association-teams__filters td-stats-filters">
          <MultiSelectDropdown v-model="statEventArr" :options="eventNameOptions" placeholder="Event" single :searchable="false" aria-label="Event" />
          <MultiSelectDropdown v-model="statTypeArr" :options="eventTypes" placeholder="Type" single :searchable="false" aria-label="Type" />
          <MultiSelectDropdown v-model="statAssocArr" :options="eventAssocs" placeholder="Association" single :searchable="false" aria-label="Association" />
        </div>
        </div>
        <div class="td-metric-grid">
          <article v-for="metric in teamMetricCards" :key="metric.label" class="td-metric-card" :class="`is-${metric.tone}`">
            <span class="td-metric-card__icon"><AppIcon name="trophy" :size="20" /></span>
            <span><small>{{ metric.label }}</small><b>{{ metric.value }}</b><em>{{ metric.hint }}</em></span>
            <i></i>
          </article>
        </div>
        <div v-if="teamGameStats.games.length" class="td-team-insights">
          <section class="td-side-card td-trend-card">
            <div class="td-side-card__head"><h3>Team Performance Trend</h3><span>Last 6 Events</span></div>
            <div class="td-chart-legend"><span><i class="is-blue"></i>Onbase %</span><span><i class="is-violet"></i>Average</span></div>
            <svg class="td-trend td-trend--large" viewBox="0 0 720 90" preserveAspectRatio="none" aria-label="Team performance trend">
              <polyline :points="performancePoints" />
              <polyline class="is-violet" points="0,65 90,58 180,64 270,52 360,61 450,48 540,56 630,43 720,50" />
            </svg>
          </section>
          <section class="td-side-card">
            <div class="td-side-card__head"><h3>Offense Breakdown</h3></div>
            <div class="td-offense">
              <div class="td-offense-ring"><span><b>{{ teamTotals.h }}</b><small>Total Hits</small></span></div>
              <div class="td-overview__legend">
                <span><i class="is-blue"></i>Singles <b>{{ teamTotals.one_b }}</b></span>
                <span><i class="is-violet"></i>Doubles <b>{{ teamTotals.two_b }}</b></span>
                <span><i class="is-orange"></i>Triples <b>{{ teamTotals.three_b }}</b></span>
                <span><i class="is-green"></i>Home Runs <b>{{ teamTotals.hr }}</b></span>
              </div>
            </div>
          </section>
        </div>
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
        <div v-else class="matchgeni-placeholder">
          <h3 class="matchgeni-placeholder__title">No team statistics yet</h3>
          <p class="matchgeni-placeholder__copy">Per-game team stats appear here once games are scored.</p>
        </div>
      </template>
    </section>

    <InviteToTeamModal
      v-if="teamId && detail"
      v-model="inviteOpen"
      :team-id="teamId"
      :team-name="detail.name"
      :team-logo-url="detail.logoUrl"
      :excluded-user-chat-ids="excludedMemberChatIds"
      @sent="onInviteSent"
    />

    <EditTeamModal
      v-if="teamId"
      v-model="editOpen"
      :team-id="teamId"
      :detail="detail"
      @saved="onTeamEdited"
    />

    <!-- Create a team-owned event (colleague's wizard in team mode). -->
    <MatchGeniEventFormModal
      v-if="teamId"
      v-model="eventFormOpen"
      :team-id="teamId"
      :event-id="null"
      @saved="onEventCreated"
    />

    <section v-if="messageOpen" class="td-chat-widget" aria-label="Quick chat" @click.stop>
      <header class="td-chat-widget__header">
        <TeamAvatar
          :name="messageTarget?.title || 'Chat'"
          :image-url="messageTarget?.avatarUrl ?? undefined"
          size="sm"
        />
        <span class="td-chat-widget__title">
          <b>{{ messageTarget?.title || 'Chat' }}</b>
          <small>{{ widgetSubtitle }}</small>
        </span>
        <button
          type="button"
          class="td-chat-widget__icon"
          title="Open full chat"
          aria-label="Open full chat"
          :disabled="!messageConversationId"
          @click="openTargetChat"
        >
          <AppIcon name="message" :size="16" />
        </button>
        <button
          type="button"
          class="td-chat-widget__icon"
          title="Close"
          aria-label="Close quick chat"
          @click="closeMessageWidget"
        >
          <AppIcon name="close" :size="16" />
        </button>
      </header>

      <div ref="messageBody" class="td-chat-widget__body">
        <p v-if="messageLoading" class="td-chat-widget__state">Loading chat...</p>
        <p v-else-if="messageError" class="td-chat-widget__state td-chat-widget__state--error">
          {{ messageError }}
        </p>
        <p v-else-if="!widgetMessages.length" class="td-chat-widget__state">
          No messages yet.
        </p>
        <template v-else>
          <article
            v-for="message in widgetMessages"
            :key="message.id"
            class="td-chat-message"
            :class="{ 'td-chat-message--own': isOwnMessage(message), 'td-chat-message--deleted': message.isDeleted }"
          >
            <span v-if="widgetIsTeam && !isOwnMessage(message)" class="td-chat-message__sender">
              {{ message.senderName }}
            </span>
            <p v-if="message.isDeleted" class="td-chat-message__deleted">This message was deleted</p>
            <template v-else>
              <div v-if="message.files.length" class="td-chat-message__files">
                <template v-for="(file, idx) in message.files" :key="`${message.id}-${idx}`">
                  <a
                    v-if="isImageFile(file.type, file.name) && (file.thumbnailUrl || file.url)"
                    class="td-chat-message__image"
                    :href="file.url"
                    target="_blank"
                    rel="noopener"
                  >
                    <img :src="file.thumbnailUrl || file.url" :alt="file.name" />
                  </a>
                  <video
                    v-else-if="isVideoFile(file.type, file.name) && file.url"
                    class="td-chat-message__video"
                    :src="file.url"
                    :poster="file.thumbnailUrl || undefined"
                    controls
                    playsinline
                    preload="metadata"
                  />
                  <audio
                    v-else-if="isAudioFile(file.type, file.name) && file.url"
                    class="td-chat-message__audio"
                    :src="file.url"
                    controls
                    preload="metadata"
                  />
                  <a
                    v-else
                    class="td-chat-message__file"
                    :href="file.url"
                    target="_blank"
                    rel="noopener"
                  >
                    <AppIcon name="document" :size="16" />
                    <span>
                      <b>{{ file.name || 'Attachment' }}</b>
                      <small v-if="file.size">{{ formatFileSize(file.size) }}</small>
                    </span>
                  </a>
                </template>
              </div>
              <p v-if="message.content" class="td-chat-message__text">{{ message.content }}</p>
            </template>
            <span class="td-chat-message__meta">
              {{ formatTime(message.createdAt) }}
              <span v-if="messageStatusLabel(message)" class="td-chat-message__status">
                {{ messageStatusLabel(message) }}
              </span>
            </span>
          </article>
        </template>
      </div>

      <MessageComposer
        v-if="messageConversationId"
        :conversation-id="messageConversationId"
        :recipient-name="messageTarget?.title"
        @sent="onWidgetSent"
      />
    </section>
  </main>
</template>

<style scoped>
.team-detail {
  width: min(100%, 1380px);
  margin: 0 auto;
  padding: 22px 24px 48px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.team-detail__hero {
  position: relative;
  z-index: 20;
  min-height: 132px;
  display: grid;
  grid-template-columns: minmax(300px, 1fr) auto auto;
  align-items: center;
  gap: 30px;
  padding: 20px 28px;
  overflow: visible;
  border: 1px solid var(--border-divider);
  border-left-color: var(--primary);
  border-radius: 8px;
  background: var(--surface-card);
  box-shadow: 0 16px 40px rgba(2, 15, 31, 0.05);
}

.team-detail__identity,
.team-heading,
.team-detail__identity-copy {
  min-width: 0;
}
.team-heading {
  display: flex;
  align-items: center;
  gap: 18px;
}
.team-heading :deep(.team-avatar-mark) {
  width: 84px;
  height: 84px;
  flex: 0 0 84px;
  border: 3px solid var(--surface-card);
  box-shadow: 0 0 0 1px var(--primary), 0 10px 24px rgba(8, 31, 54, 0.18);
}
.team-detail__identity-copy h1 {
  margin: 0;
  color: var(--text);
  font-size: clamp(1.55rem, 2.2vw, 2rem);
  line-height: 1.12;
  font-weight: 700;
}
.hero-team-meta,
.team-detail__assoc {
  margin: 7px 0 0;
  color: var(--secondary);
  font-size: 0.88rem;
}
.team-detail__assoc {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--primary);
}
.team-detail__assoc-reg { color: var(--text-light); }
.team-detail__record {
  display: grid;
  grid-template-columns: repeat(3, 96px);
  border-left: 1px solid var(--border-divider);
}
.team-detail__record-item {
  display: flex;
  min-height: 76px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border-right: 1px solid var(--border-divider);
}
.team-detail__record-item:last-child { border-right: 0; }
.team-detail__record-item b {
  color: var(--text);
  font-size: 1.55rem;
  line-height: 1;
  font-weight: 700;
}
.team-detail__record-item small {
  color: var(--secondary);
  font-size: 0.72rem;
  text-transform: uppercase;
}
.team-detail__record-item--won b { color: #20c77a; }
.team-detail__record-item--lost b { color: #f15b66; }

.team-detail__tabs {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 52px;
  padding: 0 4px;
  overflow-x: auto;
  border-bottom: 1px solid var(--border-divider);
}
.team-detail__tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 118px;
  min-height: 38px;
  padding: 0 18px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--secondary);
  font: inherit;
  font-size: 0.84rem;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}
.team-detail__tab:hover {
  color: var(--text);
  background: var(--surface-pill);
}
.team-detail__tab--active {
  border-color: var(--primary);
  color: #fff;
  background: var(--primary);
  box-shadow: 0 4px 12px rgba(45, 140, 240, 0.22);
}

.team-detail__panel { min-height: 360px; }
/* Empty states use the shared `.matchgeni-placeholder` (colleague's project)
   pattern from styles.css — no custom empty style here. */

/* Filter / sort bars */
.td-filter {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}
.td-filter--split { justify-content: space-between; }
/* Events + stats filter rows — colleague's MultiSelectDropdown pills; wrap on mobile. */
.td-events-filters,
.td-stats-filters { margin: 0 0 14px; flex-wrap: wrap; }
/* "Past Events" toggle — match the MultiSelectDropdown pill triggers
   (same height/border/radius); active = solid primary (no gradient). */
.association-events__past-toggle {
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
.association-events__past-toggle:hover:not(.association-events__past-toggle--on) {
  border-color: var(--primary);
  color: var(--primary);
}
.association-events__past-toggle--on {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}
.association-events__past-toggle:disabled {
  cursor: not-allowed;
  opacity: 0.72;
}
.td-events-reset {
  min-height: 36px;
  margin-left: auto;
  padding: 0 12px;
  border: 1px solid var(--border-divider);
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  cursor: pointer;
}
.td-events-reset:hover {
  border-color: var(--primary);
  color: var(--primary);
}
@media (max-width: 720px) {
  .td-events-filters, .td-stats-filters { gap: 8px; }
  .td-events-filters > *, .td-stats-filters > * { flex: 1 1 calc(50% - 8px); }
}
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
.team-detail__hero-actions { position: relative; display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; }
.td-hero-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 42px;
  border: 1px solid var(--border-divider);
  background: var(--surface-card);
  color: var(--text);
  font: inherit;
  font-size: 0.82rem;
  font-weight: 500;
  padding: 0 18px;
  border-radius: 999px;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}
.td-hero-btn:hover,
.td-hero-btn.is-active { color: var(--primary); border-color: var(--border-accent-hover, var(--primary-light-2)); }
.td-asset-icon {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
  display: inline-block;
  background: currentColor;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
}
.td-asset-icon--chat {
  -webkit-mask-image: url('../assets/chat.svg');
  mask-image: url('../assets/chat.svg');
}
.td-asset-icon--settings {
  -webkit-mask-image: url('../assets/settings.svg');
  mask-image: url('../assets/settings.svg');
}
.td-asset-icon--invite {
  -webkit-mask-image: url('../assets/add-user.svg');
  mask-image: url('../assets/add-user.svg');
}
.td-asset-icon--print {
  -webkit-mask-image: url('../assets/print.svg');
  mask-image: url('../assets/print.svg');
}
.td-settings-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 80;
  width: min(340px, 92vw);
  max-height: min(520px, calc(100vh - 120px));
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--border-divider);
  border-radius: var(--radius-md, 8px);
  background: var(--surface-card);
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.24);
}
.td-settings-menu__section {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-divider);
}
.td-settings-menu__section:last-of-type {
  padding-bottom: 0;
  border-bottom: none;
}
.td-settings-menu__section--danger {
  gap: 0;
}
.td-settings-menu__item {
  min-height: 34px;
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 0 10px;
  border: none;
  border-radius: var(--radius-md, 6px);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 0.84rem;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
}
.td-settings-menu__item:hover {
  background: var(--surface-pill);
  color: var(--primary);
}
.td-settings-menu__item--danger {
  color: #c1413a;
}
.td-settings-menu__toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 38px;
  padding: 6px 10px;
  color: var(--text);
  font-size: 0.82rem;
}
.td-settings-menu__toggle span {
  min-width: 0;
  line-height: 1.25;
}
.td-settings-menu__created {
  margin: 0 8px 2px;
  color: var(--text-light);
  font-size: 0.72rem;
  line-height: 1.35;
}
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
  flex: 1 1 auto;
  min-width: 0;
  width: 100%;
  height: 34px;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 0.84rem;
  outline: none;
}
.td-search-wrap {
  flex: 1 1 260px;
  min-width: 180px;
  max-width: 360px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 11px;
  border: 1px solid var(--border-divider);
  border-radius: 8px;
  background: var(--surface-card);
  color: var(--secondary);
}
.td-search-wrap:focus-within {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-light-3);
}
.td-search-wrap:focus-within .app-icon {
  color: var(--primary);
}

.td-tab-heading,
.td-section-title,
.td-side-card__head,
.td-stats-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}
.td-tab-heading {
  justify-content: flex-start;
  padding: 18px 20px;
  border: 1px solid var(--border-divider);
  border-bottom: 0;
  border-radius: 8px 8px 0 0;
  background: var(--surface-card);
}
/* "Add Event" action pinned to the right of the events tab heading. */
.td-tab-heading__action {
  margin-left: auto;
  align-self: center;
  flex: 0 0 auto;
}
/* CTA inside the empty-state placeholder. */
.td-placeholder-action {
  margin-top: 14px;
}
.td-tab-heading__icon {
  width: 48px;
  height: 48px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 48px;
  border: 1px solid rgba(139, 92, 246, 0.28);
  border-radius: 50%;
  color: #8b5cf6;
  background: rgba(139, 92, 246, 0.1);
}
.td-tab-heading h2,
.td-section-title h2 {
  margin: 0;
  color: var(--text);
  font-size: 1.12rem;
}
.td-tab-heading p,
.td-section-title p {
  margin: 4px 0 0;
  color: var(--secondary);
  font-size: 0.8rem;
}
.td-content-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(260px, 330px);
  gap: 16px;
}
.td-content-card,
.td-side-card {
  min-width: 0;
  border: 1px solid var(--border-divider);
  border-radius: 8px;
  background: var(--surface-card);
}
.td-content-card--main { padding: 16px; }
.td-tab-heading + .td-content-grid .td-content-card--main {
  border-top-left-radius: 0;
}
.td-side-stack {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.td-side-card { padding: 16px; }
.td-side-card__head {
  margin-bottom: 14px;
}
.td-side-card__head h3 {
  margin: 0;
  color: var(--text);
  font-size: 0.92rem;
}
.td-side-card__head > span {
  color: var(--primary);
  font-size: 0.72rem;
}
.td-filter--surface {
  margin: -16px -16px 14px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-divider);
}
.td-highlight-list,
.td-action-list {
  display: flex;
  flex-direction: column;
}
.td-highlight {
  min-height: 52px;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  padding: 7px 0;
  border: 0;
  border-bottom: 1px solid var(--border-divider);
  background: transparent;
  color: var(--text);
  text-align: left;
}
.td-highlight:last-child { border-bottom: 0; }
.td-highlight__icon,
.td-action-list__icon {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  color: #fff;
  background: var(--primary);
}
.td-highlight > span:nth-child(2),
.td-action-list button > span:nth-child(2) {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.td-highlight b,
.td-action-list b {
  overflow: hidden;
  color: var(--text);
  font-size: 0.78rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.td-highlight small,
.td-action-list small {
  margin-top: 2px;
  color: var(--secondary);
  font-size: 0.68rem;
}
.td-side-empty {
  margin: 0;
  color: var(--secondary);
  font-size: 0.8rem;
}
.td-attendance,
.td-overview,
.td-offense {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 24px;
}
.td-mini-ring,
.td-member-ring,
.td-offense-ring {
  position: relative;
  width: 118px;
  height: 118px;
  flex: 0 0 118px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: conic-gradient(#20c77a 0 52%, #2588ff 52% 82%, #8b5cf6 82% 100%);
}
.td-mini-ring::after,
.td-member-ring::after,
.td-offense-ring::after {
  content: '';
  position: absolute;
  inset: 14px;
  border-radius: inherit;
  background: var(--surface-card);
}
.td-mini-ring > *,
.td-member-ring > *,
.td-offense-ring > * {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.td-mini-ring b,
.td-member-ring b,
.td-offense-ring b {
  color: var(--text);
  font-size: 1.4rem;
}
.td-mini-ring small,
.td-member-ring small,
.td-offense-ring small {
  color: var(--secondary);
  font-size: 0.68rem;
}
.td-attendance__copy,
.td-overview__legend {
  min-width: 126px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.td-attendance__copy span,
.td-overview__legend span,
.td-chart-legend span {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--secondary);
  font-size: 0.76rem;
}
.td-attendance__copy b,
.td-overview__legend b { margin-left: auto; color: var(--text); }
.td-attendance__copy i,
.td-overview__legend i,
.td-chart-legend i {
  width: 9px;
  height: 9px;
  flex: 0 0 9px;
  border-radius: 50%;
  background: #2588ff;
}
i.is-green { background: #20c77a; }
i.is-blue { background: #2588ff; }
i.is-violet { background: #8b5cf6; }
i.is-orange { background: #f5a300; }
.td-quick-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.td-quick-actions button {
  min-height: 74px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid var(--border-divider);
  border-radius: 7px;
  background: var(--surface-pill);
  color: var(--secondary);
  font: inherit;
  font-size: 0.72rem;
  cursor: pointer;
}
.td-section-title {
  padding: 4px 0 16px;
}
.td-section-title > b {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--primary);
  font-size: 0.82rem;
}
.td-action-list button {
  min-height: 64px;
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border: 0;
  border-bottom: 1px solid var(--border-divider);
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.td-action-list button:last-child { border-bottom: 0; }
.td-action-list__icon.is-violet { background: #6f45ff; }
.td-help-card {
  display: flex;
  align-items: center;
  gap: 14px;
  color: var(--primary);
}
.td-help-card h3 { margin: 0; color: var(--text); font-size: 0.92rem; }
.td-help-card p { margin: 4px 0 0; color: var(--secondary); font-size: 0.75rem; }
.td-stats-toolbar {
  margin-bottom: 14px;
}
.td-stats-toolbar .td-filter { margin-bottom: 0; }
.td-search-wrap--stats { max-width: 250px; flex-basis: 220px; }
.td-metric-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}
.td-metric-card {
  position: relative;
  min-width: 0;
  min-height: 124px;
  display: flex;
  align-items: flex-start;
  gap: 11px;
  padding: 16px 14px 20px;
  overflow: hidden;
  border: 1px solid var(--border-divider);
  border-radius: 8px;
  background: var(--surface-card);
}
.td-metric-card__icon {
  width: 38px;
  height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 38px;
  border: 1px solid rgba(37, 136, 255, 0.3);
  border-radius: 50%;
  color: #2588ff;
  background: rgba(37, 136, 255, 0.1);
}
.td-metric-card > span:nth-child(2) {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.td-metric-card small { color: var(--secondary); font-size: 0.72rem; }
.td-metric-card b { margin-top: 6px; color: var(--text); font-size: 1.3rem; }
.td-metric-card em { margin-top: 5px; color: var(--text-light); font-size: 0.66rem; font-style: normal; }
.td-metric-card > i {
  position: absolute;
  right: 14px;
  bottom: 12px;
  left: 14px;
  height: 2px;
  background: linear-gradient(90deg, #2588ff 0 48%, var(--border-divider) 48% 100%);
}
.td-metric-card.is-violet .td-metric-card__icon { color: #8b5cf6; border-color: rgba(139,92,246,.3); background: rgba(139,92,246,.1); }
.td-metric-card.is-violet > i { background: linear-gradient(90deg, #8b5cf6 0 62%, var(--border-divider) 62% 100%); }
.td-metric-card.is-green .td-metric-card__icon { color: #20c77a; border-color: rgba(32,199,122,.3); background: rgba(32,199,122,.1); }
.td-metric-card.is-green > i { background: linear-gradient(90deg, #20c77a 0 70%, var(--border-divider) 70% 100%); }
.td-metric-card.is-orange .td-metric-card__icon { color: #f07c22; border-color: rgba(240,124,34,.3); background: rgba(240,124,34,.1); }
.td-metric-card.is-orange > i { background: linear-gradient(90deg, #f07c22 0 55%, var(--border-divider) 55% 100%); }
.td-stats-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(270px, 390px);
  gap: 14px;
}
.td-content-card--table { padding: 14px; }
.td-content-card--table .team-detail__table-wrap { border-radius: 6px; }
.td-performers {
  list-style: none;
  margin: 0;
  padding: 0;
}
.td-performers li {
  min-height: 40px;
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid var(--border-divider);
  color: var(--secondary);
  font-size: 0.75rem;
}
.td-performers li:last-child { border-bottom: 0; }
.td-performers span { overflow: hidden; color: var(--text); text-overflow: ellipsis; white-space: nowrap; }
.td-performers strong { color: var(--text); font-size: 0.9rem; }
.td-trend {
  width: 100%;
  height: 104px;
  overflow: visible;
}
.td-trend polyline {
  fill: none;
  stroke: #2588ff;
  stroke-width: 3;
  vector-effect: non-scaling-stroke;
}
.td-trend polyline.is-violet { stroke: #8b5cf6; }
.td-team-insights {
  display: grid;
  grid-template-columns: minmax(0, 1.65fr) minmax(300px, 0.9fr);
  gap: 14px;
  margin-bottom: 14px;
}
.td-trend-card { min-height: 210px; }
.td-chart-legend {
  display: flex;
  gap: 18px;
  margin-bottom: 8px;
}
.td-trend--large { height: 126px; }
.td-offense-ring { background: conic-gradient(#2588ff 0 57%, #8b5cf6 57% 81%, #f5a300 81% 85%, #20c77a 85% 100%); }

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
/* Table-shaped skeleton for the Player / Team statistics tabs. */
.td-sk-table { display: flex; flex-direction: column; gap: 12px; padding-top: 4px; }
.td-sk-trow { display: flex; align-items: center; gap: 12px; }
.td-sk-trow__lead { width: 32px; height: 32px; border-radius: 999px; flex: 0 0 auto; }
.td-sk-trow__cell { flex: 1 1 0; height: 14px; border-radius: 6px; }
.td-sk-trow__cell:first-of-type { flex: 2 1 0; }

/* Events */
.team-detail__events { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.td-event {
  position: relative;
  border: 1px solid var(--border-divider);
  border-radius: 8px;
  padding: 16px 18px 16px 106px;
  min-height: 146px;
  background: var(--surface-card);
}
.td-event--clickable {
  cursor: pointer;
  transition: border-color 0.18s ease, transform 0.18s ease;
}
.td-event--clickable:hover,
.td-event--clickable:focus-visible {
  border-color: #338df0;
  transform: translateY(-1px);
  outline: none;
}
.td-event::before {
  content: '';
  position: absolute;
  left: 20px;
  top: 24px;
  width: 62px;
  height: 62px;
  border: 1px solid #6f45ff;
  border-radius: 50%;
  background: rgba(45, 140, 240, 0.10);
  box-shadow: inset 0 0 24px rgba(111, 69, 255, .14);
}
.td-event::after {
  content: '';
  position: absolute;
  left: 38px;
  top: 42px;
  width: 26px;
  height: 22px;
  border: 3px solid #9a6bff;
  border-top: 0;
  border-radius: 4px 4px 10px 10px;
}
.td-event__top { display: flex; align-items: center; gap: 10px; }
.td-event__date { color: var(--text-light); font-size: 0.78rem; }
.td-event__name { margin: 8px 0 0; font-size: 1.08rem; font-weight: 600; color: var(--text); }
.td-event__sub { margin: 2px 0 0; color: var(--secondary); font-size: 0.82rem; }
.td-event__loc { display: inline-flex; align-items: center; gap: 4px; margin: 4px 0 0; color: var(--text-light); font-size: 0.8rem; }
.td-event__director {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 5px 0 0;
  color: var(--secondary);
  font-size: 0.76rem;
  overflow-wrap: anywhere;
}
.td-event__director span { color: var(--text-light); }
.td-event__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border-divider);
}
.td-event__going { display: inline-flex; align-items: center; gap: 5px; color: var(--secondary); font-size: 0.8rem; }
.td-event__record { display: inline-flex; gap: 14px; }
.td-event__record span { display: inline-flex; align-items: center; gap: 4px; color: var(--text-light); font-size: 0.76rem; }
.td-event__record b { color: var(--text); font-size: 0.9rem; font-weight: 600; }

/* Members */
.team-detail__members { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.td-member {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 68px;
  padding: 9px 12px 9px 14px;
  border: 1px solid var(--border-divider);
  border-bottom: 0;
  background: var(--surface-card);
}
.td-member:first-child { border-radius: 7px 7px 0 0; }
.td-member:last-child { border-bottom: 1px solid var(--border-divider); border-radius: 0 0 7px 7px; }
.td-member::before {
  content: '';
  position: absolute;
  top: 12px;
  bottom: 12px;
  left: 0;
  width: 2px;
  background: #2588ff;
}
.td-member:nth-child(3n + 2)::before { background: #8b5cf6; }
.td-member:nth-child(3n)::before { background: #20c77a; }
.td-member__copy { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; }
.td-member__name { color: var(--text); font-size: 0.86rem; font-weight: 600; }
.td-member__sub { margin-top: 3px; color: var(--secondary); font-size: 0.72rem; }
.td-member__role { color: var(--secondary); font-size: 0.76rem; }
.td-member__uniform { color: var(--text-light); font-size: 0.82rem; font-variant-numeric: tabular-nums; }
.td-members-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.td-members-count { flex: 0 0 auto; color: var(--text); font-weight: 500; font-size: 0.95rem; }
.td-members-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex: 1 1 auto;
  min-width: 0;
  flex-wrap: nowrap;
  gap: 8px;
}
.td-toolbar-btn {
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  flex: 0 0 auto;
  white-space: nowrap;
  padding: 0 11px;
  border: 1px solid var(--border-divider);
  border-radius: var(--radius-md, 6px);
  background: var(--surface-card);
  color: var(--secondary);
  font: inherit;
  font-size: 0.82rem;
  cursor: pointer;
}
.td-toolbar-btn:hover {
  color: var(--primary);
  border-color: var(--border-accent-hover, var(--primary-light-2));
}
.td-member__badges { display: flex; gap: 6px; margin-top: 2px; }
.td-badge { font-size: 0.68rem; font-weight: 500; padding: 1px 7px; border-radius: 999px; background: var(--surface-pill); color: var(--secondary); }
.td-badge--admin { background: var(--primary-light-3); color: var(--primary); }
.td-badge--fan { background: #fff0df; color: #b57a34; }
.td-member__jersey { color: var(--text-light); font-size: 0.8rem; font-variant-numeric: tabular-nums; background: var(--surface-pill); padding: 2px 8px; border-radius: 6px; }
.td-member__role-pill {
  min-width: 76px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 5px 10px;
  border: 1px solid rgba(37, 136, 255, .2);
  border-radius: 999px;
  color: #2588ff;
  background: rgba(37, 136, 255, .07);
  font-size: .72rem;
}
.td-member__role-pill.is-admin { color: #9365ff; border-color: rgba(147,101,255,.25); background: rgba(147,101,255,.08); }
.td-member__role-pill.is-fan { color: var(--secondary); border-color: var(--border-divider); background: var(--surface-pill); }
.td-member__role-pill.is-player { color: #20c77a; border-color: rgba(32,199,122,.25); background: rgba(32,199,122,.08); }
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
.td-menu button.is-danger { color: #c1413a; }
.td-menu button.is-danger:hover:not(:disabled) { background: rgba(193, 65, 58, 0.1); color: #c1413a; }
.td-menu button:disabled { color: var(--text-light); cursor: default; }

.td-chat-widget {
  position: fixed;
  right: 22px;
  bottom: 22px;
  z-index: 95;
  width: min(390px, calc(100vw - 32px));
  height: min(620px, calc(100vh - 96px));
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-divider);
  border-radius: var(--radius-md, 8px);
  background: var(--surface-card);
  box-shadow: 0 22px 58px rgba(15, 23, 42, 0.28);
  overflow: hidden;
}
.td-chat-widget__header {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 58px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-divider);
  background: var(--surface-card);
}
.td-chat-widget__title {
  min-width: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.td-chat-widget__title b {
  color: var(--text);
  font-size: 0.92rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.td-chat-widget__title small {
  color: var(--secondary);
  font-size: 0.74rem;
}
.td-chat-widget__icon {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-divider);
  border-radius: 8px;
  background: var(--surface-card);
  color: var(--secondary);
  cursor: pointer;
}
.td-chat-widget__icon:hover:not(:disabled) {
  color: var(--primary);
  border-color: var(--border-accent-hover, var(--primary-light-2));
  background: var(--surface-pill);
}
.td-chat-widget__icon:disabled {
  opacity: 0.45;
  cursor: default;
}
.td-chat-widget__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 12px;
  background: var(--surface-main, var(--surface-card));
}
.td-chat-widget__state {
  margin: auto;
  color: var(--secondary);
  font-size: 0.85rem;
  text-align: center;
}
.td-chat-widget__state--error {
  color: #c1413a;
}
.td-chat-message {
  align-self: flex-start;
  max-width: min(82%, 280px);
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px 6px;
  border: 1px solid var(--border-divider);
  border-radius: 12px 12px 12px 4px;
  background: var(--surface-card);
  color: var(--text);
  box-shadow: 0 3px 10px rgba(15, 23, 42, 0.06);
}
.td-chat-message--own {
  align-self: flex-end;
  border-color: var(--primary-light-2);
  border-radius: 12px 12px 4px 12px;
  background: var(--primary-light-3);
}
.td-chat-message__sender {
  color: var(--primary);
  font-size: 0.72rem;
  font-weight: 600;
}
.td-chat-message__text,
.td-chat-message__deleted {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 0.88rem;
  line-height: 1.38;
}
.td-chat-message__deleted {
  color: var(--text-light);
  font-style: italic;
}
.td-chat-message__files {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.td-chat-message__image,
.td-chat-message__video {
  display: block;
  width: 100%;
  overflow: hidden;
  border-radius: 10px;
  background: var(--surface-pill);
}
.td-chat-message__image img,
.td-chat-message__video {
  display: block;
  width: 100%;
  max-height: 190px;
  object-fit: cover;
}
.td-chat-message__audio {
  width: 240px;
  max-width: 100%;
}
.td-chat-message__file {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 9px;
  background: var(--surface-pill);
  color: var(--text);
  text-decoration: none;
}
.td-chat-message__file span {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.td-chat-message__file b {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.8rem;
}
.td-chat-message__file small {
  color: var(--text-light);
  font-size: 0.7rem;
}
.td-chat-message__meta {
  align-self: flex-end;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-light);
  font-size: 0.68rem;
  line-height: 1;
}
.td-chat-message__status {
  color: var(--primary);
  font-weight: 700;
}
.td-chat-widget :deep(.composer) {
  padding: 8px;
  background: var(--surface-card);
}
.td-chat-widget :deep(.composer__bar) {
  gap: 7px;
}
.td-chat-widget :deep(.composer__input) {
  min-height: 38px;
  font-size: 0.84rem;
}
.td-chat-widget :deep(.composer__attach),
.td-chat-widget :deep(.composer__send) {
  width: 36px;
  height: 36px;
}

/* Stat tables — carded, sticky header, zebra rows, leader highlight. */
.team-detail__table-wrap {
  overflow: auto;
  max-height: 62vh;
  border: 1px solid var(--border-divider);
  border-radius: 12px;
  background: var(--surface-card);
}
.team-detail__table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 0.84rem; }
.team-detail__table th, .team-detail__table td { padding: 10px 8px; text-align: center; white-space: nowrap; }
.team-detail__table thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  color: var(--secondary);
  font-weight: 600;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  background: var(--surface-chrome, #fff);
  border-bottom: 1px solid var(--border-divider);
}
.team-detail__table td { border-bottom: 1px solid var(--border-subtle, rgba(207, 220, 234, 0.55)); color: var(--text); font-variant-numeric: tabular-nums; }
.team-detail__table tbody tr:last-child td { border-bottom: none; }
.team-detail__table .td-l { text-align: left; }
/* Zebra striping */
.team-detail__table tbody tr:nth-child(even) td { background: var(--surface-raised, rgba(240, 246, 253, 0.5)); }
.team-detail__table tbody tr:hover td { background: var(--primary-light-3, #eef4fd); }
/* Leader row (top of the sorted player table) */
.team-detail__table tbody tr.td-leader td { background: rgba(255, 212, 90, 0.14); font-weight: 600; }
.td-leader-mark { margin-right: 5px; color: var(--warning, #ffd45a); }

/* Team Statistics per-game table */
.team-detail__stats-table th.td-sortable { cursor: pointer; user-select: none; }
.team-detail__stats-table th.td-sortable:hover { color: var(--primary); }
.team-detail__stats-table th.td-sorted { color: var(--primary); }
.td-sortarrow { margin-left: 2px; }
.team-detail__stats-table .td-total-row td { position: sticky; top: 36px; z-index: 1; background: var(--surface-pill); border-bottom: 2px solid var(--border-divider); }
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

@media (max-width: 1120px) {
  .team-detail__hero {
    grid-template-columns: minmax(280px, 1fr) auto;
  }
  .team-detail__record {
    grid-column: 1 / -1;
    grid-template-columns: repeat(3, 1fr);
    border-top: 1px solid var(--border-divider);
    border-left: 0;
  }
  .team-detail__record-item { min-height: 62px; }
  .td-metric-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .td-content-grid,
  .td-stats-layout { grid-template-columns: minmax(0, 1fr) 280px; }
  .td-team-insights { grid-template-columns: 1fr; }
}

@media (max-width: 900px) {
  .td-content-grid,
  .td-stats-layout { grid-template-columns: 1fr; }
  .td-side-stack { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .td-side-stack > :last-child:nth-child(odd) { grid-column: 1 / -1; }
}

@media (max-width: 720px) {
  .team-detail {
    padding: 16px 12px calc(32px + var(--member-bottom-nav-height, 64px));
  }

  .team-detail__hero {
    grid-template-columns: 1fr;
    gap: 18px;
    padding: 18px;
  }
  .team-heading :deep(.team-avatar-mark) {
    width: 68px;
    height: 68px;
    flex-basis: 68px;
  }
  .team-detail__hero-actions {
    justify-content: flex-start;
    width: 100%;
  }

  .td-hero-btn,
  .td-hero-btn--primary {
    flex: 1 1 auto;
    justify-content: center;
  }

  .team-detail__tabs {
    margin-right: -12px;
    margin-left: -12px;
    padding-right: 12px;
    padding-left: 12px;
    scrollbar-width: none;
  }
  .team-detail__tab {
    min-width: max-content;
    min-height: 36px;
  }
  .td-metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .td-side-stack { grid-template-columns: 1fr; }
  .td-side-stack > :last-child:nth-child(odd) { grid-column: auto; }
  .td-tab-heading { padding: 14px; }
  .td-content-card--main { padding: 12px; }
  .td-filter--surface { margin: -12px -12px 12px; padding: 10px 12px; }
  .td-stats-toolbar { align-items: stretch; flex-direction: column; }
  .td-search-wrap--stats { max-width: none; flex-basis: auto; }
  .td-attendance,
  .td-overview,
  .td-offense { gap: 16px; }

  .team-detail__tabs::-webkit-scrollbar {
    display: none;
  }

  .td-filter--split {
    align-items: stretch;
  }

  .td-search-wrap {
    flex-basis: 100%;
    max-width: none;
  }

  .td-members-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .td-members-actions {
    justify-content: flex-start;
    width: 100%;
    flex-wrap: wrap;
  }

  .td-toolbar-btn {
    flex: 1 1 calc(50% - 8px);
  }

  .team-detail__table-wrap {
    max-height: none;
    margin-right: -12px;
    margin-left: -12px;
    border-right: 0;
    border-left: 0;
    border-radius: 0;
  }

  .team-detail__table th,
  .team-detail__table td {
    padding: 8px 6px;
  }

  .td-chat-widget {
    right: 8px;
    bottom: calc(var(--member-bottom-nav-height, 64px) + 8px);
    width: calc(100vw - 16px);
    height: min(560px, calc(100vh - var(--member-topbar-height, 56px) - var(--member-bottom-nav-height, 64px) - 24px));
  }
}

@media (max-width: 420px) {
  .team-detail__identity-copy h1 { font-size: 1.35rem; }
  .team-detail__record { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .team-detail__record-item b { font-size: 1.25rem; }
  .td-metric-grid { grid-template-columns: 1fr; }
  .td-event {
    padding: 96px 14px 14px;
  }
  .td-event::before { left: 14px; top: 18px; }
  .td-event::after { left: 32px; top: 36px; }
  .td-member__role-pill { min-width: 62px; }
  .td-toolbar-btn {
    flex-basis: 100%;
  }

  .td-event__record {
    width: 100%;
    justify-content: space-between;
  }
}
</style>
