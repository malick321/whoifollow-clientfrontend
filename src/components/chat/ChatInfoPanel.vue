<script setup lang="ts">
// ChatInfoPanel
// -------------
// Right-side details inspector for the active conversation.
//   - TEAM: upgraded panel mirroring the legacy team info screen — logo /
//     name / category / age-gender, Games/Won/Lost tiles, Invite / Statistics
//     / Settings actions, a reveal-able Settings section (Change Logo, Edit
//     Details, SMS + Push toggles, Show on-base %, Show top-5 avg, Archive,
//     Report, Exit + created-by), the ongoing-event card, and All Events /
//     Associations / Teammates / Shared Files rows with counts. Driven by
//     fetchTeamDetail; setting toggles call updateTeamSettings optimistically.
//   - DM: the other user's profile summary + shared files (unchanged).

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import TeamAvatar from '../TeamAvatar.vue'
import AppIcon from '../AppIcon.vue'
import PresenceDot from './PresenceDot.vue'
import ToggleSwitch from '../../components/ToggleSwitch.vue'
import InviteToTeamModal from './InviteToTeamModal.vue'
import { formatFileSize } from './chat-format'
import { getAuthUserChatId } from '../../auth-session'
import { useChatStore } from '../../stores/chat'
import { useChatLockStore } from '../../stores/chatLock'
import {
  archiveTeam,
  changeTeamLogo,
  fetchSharedFiles,
  fetchTeamDetail,
  fetchTeamMembers,
  leaveTeam,
  removeTeamMember,
  reportTeam,
  updateTeamMemberRole,
  updateTeamSettings,
  type ChatSharedFile,
  type ChatTeamDetail,
  type ChatTeamMember,
  type ChatTeamSettings
} from '../../api/chat'
import { pushToast } from '../../toast-center'

const props = defineProps<{
  conversationId: string
}>()

defineEmits<{ (e: 'close'): void }>()

const store = useChatStore()
const chatLock = useChatLockStore()

// Per-conversation PIN lock (WhatsApp "Chat Lock").
const convHasLock = computed(() => chatLock.conversationHasLock(props.conversationId))
function toggleConvLock() {
  if (!chatLock.enabled) {
    pushToast({
      tone: 'warning',
      title: 'Set up Chat Lock first',
      message: 'Turn on Chat Lock from the lock icon in the chat list, then you can lock individual chats.'
    })
    return
  }
  if (convHasLock.value) chatLock.removeConversationLock(props.conversationId)
  else chatLock.lockConversation(props.conversationId)
  settingsOpen.value = false
}

const conversation = computed(() => store.conversationById(props.conversationId))
const isTeam = computed(() => conversation.value?.type === 'team')
const participants = computed(() => conversation.value?.participants ?? [])
const otherUser = computed(() => conversation.value?.otherUser ?? null)
const otherOnline = computed(() =>
  otherUser.value ? store.isOnline(otherUser.value.userChatId) : false
)

/** The team's stable id for the v2 team endpoints — prefer `team.teamId`,
 *  fall back to `team.id`. */
const teamId = computed(
  () => conversation.value?.team?.teamId ?? conversation.value?.team?.id ?? null
)

// ── Team detail ──────────────────────────────────────────────────
const detail = ref<ChatTeamDetail | null>(null)
const detailLoading = ref(false)
const detailLoadedTeamId = ref('')

async function loadDetail(force = false) {
  const id = teamId.value
  if (!isTeam.value || !id || detailLoading.value) return
  if (!force && detail.value && detailLoadedTeamId.value === id) return
  detailLoading.value = true
  try {
    detail.value = await fetchTeamDetail(id)
    detailLoadedTeamId.value = id
  } catch (err) {
    console.warn('[chat] fetchTeamDetail failed', err)
  } finally {
    detailLoading.value = false
  }
}

const categoryLabel = computed(
  () => detail.value?.categoryLabel || conversation.value?.team?.name || ''
)
const ageGenderLabel = computed(() => detail.value?.ageGenderLabel ?? '')
const isAdmin = computed(() => detail.value?.isAdmin ?? false)
const logoUrl = computed(
  () => detail.value?.logoUrl ?? conversation.value?.avatarUrl ?? undefined
)
const teamTitle = computed(() => detail.value?.name || conversation.value?.title || '')
const counts = computed(
  () => detail.value?.counts ?? { allEvents: 0, associations: 0, teammates: 0, sharedFiles: 0 }
)
const ongoingEvent = computed(() => detail.value?.ongoingEvent ?? null)

const createdByLine = computed(() => {
  const d = detail.value
  if (!d?.createdByName) return ''
  if (!d.createdAt) return `Created by ${d.createdByName}`
  const when = new Date(d.createdAt)
  const date = Number.isNaN(when.getTime())
    ? d.createdAt
    : when.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  return `Created by ${d.createdByName} on ${date}`
})

const eventDateLine = computed(() => {
  const e = ongoingEvent.value
  if (!e) return ''
  const fmt = (iso: string | null) => {
    if (!iso) return ''
    const d = new Date(iso)
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  }
  const start = fmt(e.startDate)
  const end = fmt(e.endDate)
  if (start && end && start !== end) return `${start} – ${end}`
  return start || end
})

// ── Settings menu (dropdown) + optimistic toggles ────────────────
// Settings live in an overflow (⋯) menu next to Invite / Statistics rather
// than a big inline reveal — cleaner, more standard UX.
const settingsOpen = ref(false)
const actionsWrap = ref<HTMLElement | null>(null)
const scrollRef = ref<HTMLElement | null>(null)
const logoInputRef = ref<HTMLInputElement | null>(null)
const memberMenuId = ref<string | null>(null)

function onDocPointer(e: MouseEvent) {
  const t = e.target as Node | null
  const el = e.target as HTMLElement | null
  if (scrollRef.value && t === scrollRef.value) return
  if (settingsOpen.value && actionsWrap.value && t && !actionsWrap.value.contains(t)) {
    settingsOpen.value = false
  }
  if (memberMenuId.value && !el?.closest('.teammate__actions')) {
    memberMenuId.value = null
  }
}
onMounted(() => document.addEventListener('mousedown', onDocPointer))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocPointer))

async function setSetting(key: keyof ChatTeamSettings, value: boolean) {
  if (!detail.value || !teamId.value) return
  const previous = detail.value.settings[key]
  detail.value.settings[key] = value // optimistic
  try {
    const reconciled = await updateTeamSettings(teamId.value, { [key]: value })
    if (detail.value) detail.value.settings = reconciled
  } catch (err) {
    if (detail.value) detail.value.settings[key] = previous // rollback
    pushToast({
      tone: 'warning',
      title: 'Could not update setting',
      message: err instanceof Error ? err.message : 'Please try again.'
    })
  }
}

function openLogoPicker() {
  logoInputRef.value?.click()
}

async function onLogoChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !teamId.value) return
  if (!/\.(jpe?g|png|gif)$/i.test(file.name)) {
    pushToast({ tone: 'warning', title: 'Unsupported file', message: 'Use a .jpg, .png or .gif image.' })
    input.value = ''
    return
  }
  try {
    const url = await changeTeamLogo(teamId.value, file)
    const cacheSafeUrl = url ? `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}` : null
    if (cacheSafeUrl && detail.value) detail.value.logoUrl = cacheSafeUrl
    if (cacheSafeUrl) store.updateConversationAvatar(props.conversationId, cacheSafeUrl)
    pushToast({ tone: 'success', title: 'Logo updated', message: 'The team logo has been changed.' })
  } catch (err) {
    pushToast({
      tone: 'warning',
      title: 'Could not change logo',
      message: err instanceof Error ? err.message : 'Please try again.'
    })
  } finally {
    input.value = ''
  }
}

function editDetails() {
  settingsOpen.value = false
  openTeamDetail('teammates')
}

async function doArchive() {
  if (!teamId.value) return
  const nextArchived = !(conversation.value?.isArchived ?? false)
  try {
    const archived = await archiveTeam(teamId.value, nextArchived)
    store.markConversationArchived(props.conversationId, archived)
    pushToast({
      tone: 'success',
      title: archived ? 'Team archived' : 'Team unarchived',
      message: `${teamTitle.value} was ${archived ? 'archived' : 'unarchived'}.`
    })
  } catch (err) {
    pushToast({ tone: 'warning', title: 'Could not update archive status', message: err instanceof Error ? err.message : 'Please try again.' })
  }
}

async function doReport() {
  if (!teamId.value) return
  try {
    await reportTeam(teamId.value)
    pushToast({ tone: 'success', title: 'Team reported', message: 'Thanks — our team will review it.' })
  } catch (err) {
    pushToast({ tone: 'warning', title: 'Could not report', message: err instanceof Error ? err.message : 'Please try again.' })
  }
}

async function doExit() {
  if (!teamId.value) return
  try {
    await leaveTeam(teamId.value)
    store.removeConversation(props.conversationId)
    pushToast({ tone: 'success', title: 'Left team', message: `You left ${teamTitle.value}.` })
  } catch (err) {
    pushToast({ tone: 'warning', title: 'Could not leave', message: err instanceof Error ? err.message : 'Please try again.' })
  }
}

// ── Invite modal ─────────────────────────────────────────────────
const inviteOpen = ref(false)
function openInvite() {
  if (!teamId.value) return
  inviteOpen.value = true
}

async function onInviteSent() {
  await loadTeamMembers(true)
  await loadDetail(true)
}

const router = useRouter()

// Open the full Team detail page (Events / Teammates / Player Statistics /
// Team Statistics), optionally at a specific tab.
function openTeamDetail(tab?: 'events' | 'teammates' | 'player-stats' | 'team-stats') {
  if (!teamId.value) return
  router.push({
    name: 'team-detail',
    params: { teamId: teamId.value },
    query: tab ? { tab } : {}
  })
}

function openStatistics() {
  openTeamDetail('team-stats')
}

// ── Collapsible rows + shared files ──────────────────────────────
const openTeammates = ref(false)
const openFiles = ref(false)
const teamMembers = ref<ChatTeamMember[]>([])
const membersLoaded = ref(false)
const membersLoading = ref(false)
const memberBusyId = ref('')

const sharedFiles = ref<ChatSharedFile[]>([])
const filesLoaded = ref(false)
const filesLoading = ref(false)

async function loadTeamMembers(force = false) {
  if (!teamId.value || membersLoading.value) return
  if (membersLoaded.value && !force) return
  membersLoading.value = true
  try {
    teamMembers.value = await fetchTeamMembers(teamId.value, { includeInvites: true })
    membersLoaded.value = true
  } catch (err) {
    console.warn('[chat] fetchTeamMembers failed', err)
  } finally {
    membersLoading.value = false
  }
}

async function loadSharedFiles() {
  if (filesLoaded.value || filesLoading.value) return
  filesLoading.value = true
  try {
    const page = await fetchSharedFiles(props.conversationId)
    sharedFiles.value = page.files
    filesLoaded.value = true
  } catch (err) {
    console.warn('[chat] fetchSharedFiles failed', err)
  } finally {
    filesLoading.value = false
  }
}

function toggleFiles() {
  openFiles.value = !openFiles.value
  if (openFiles.value) void loadSharedFiles()
}

function toggleTeammates() {
  openTeammates.value = !openTeammates.value
  if (openTeammates.value) void loadTeamMembers()
}

const sharedFilesCount = computed(() =>
  filesLoaded.value ? sharedFiles.value.length : counts.value.sharedFiles
)
function dedupeMembers(rows: ChatTeamMember[]): ChatTeamMember[] {
  const seen = new Set<string>()
  return rows.filter((m) => {
    const key = m.userId ? `user:${m.userId}` : (m.userChatId ? `chat:${m.userChatId}` : `invite:${m.inviteId || m.memberId || m.name}`)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const visibleTeamMembers = computed<ChatTeamMember[]>(() => {
  if (membersLoaded.value) return dedupeMembers(teamMembers.value)
  return dedupeMembers(participants.value.map((p) => ({
    memberId: null,
    userChatId: p.userChatId,
    userId: p.userId,
    userIdFirebase: p.userChatId,
    name: p.name,
    email: null,
    avatarUrl: p.avatarUrl,
    role: p.role,
    isAdmin: p.role === 'admin',
    isFan: false,
    isPlayer: p.role !== 'admin',
    isInvitationPending: false,
    inviteId: null,
    inviteTarget: null,
    inviteTargetType: null,
    inviteStatus: null,
    uniformNo: null
  })))
})

const teammatesCount = computed(() =>
  membersLoaded.value ? visibleTeamMembers.value.length : (detail.value ? counts.value.teammates : participants.value.length)
)

const existingMemberChatIds = computed(() =>
  [...new Set(visibleTeamMembers.value.map((m) => m.userChatId).filter(Boolean))]
)
const myChatId = computed(() => getAuthUserChatId())

function memberKey(member: ChatTeamMember): string {
  return member.memberId || member.userChatId || member.userId || member.inviteId || member.name
}

function toggleMemberMenu(member: ChatTeamMember) {
  const key = memberKey(member)
  memberMenuId.value = memberMenuId.value === key ? null : key
}

function canManageMember(member: ChatTeamMember): boolean {
  if (!isAdmin.value) return false
  if (member.isInvitationPending) return false
  return !!member.userChatId && member.userChatId !== myChatId.value
}

function memberRoleValue(member: ChatTeamMember): 'admin' | 'teammate' | 'fan' {
  if (member.isAdmin || member.role === 'admin') return 'admin'
  if (member.isFan || member.role === 'fan') return 'fan'
  return 'teammate'
}

async function changeMemberRole(member: ChatTeamMember, role: 'admin' | 'teammate' | 'fan') {
  if (!teamId.value || !member.userId) return
  memberBusyId.value = member.memberId || member.userChatId || member.userId
  try {
    await updateTeamMemberRole(teamId.value, {
      userId: member.userId,
      userIdFirebase: member.userIdFirebase
    }, {
      role,
      markAsPlayer: role === 'teammate' ? member.isPlayer : false
    })
    await loadTeamMembers(true)
    await loadDetail(true)
    pushToast({ tone: 'success', title: 'Member updated' })
  } catch (err) {
    pushToast({ tone: 'warning', title: 'Could not update member', message: err instanceof Error ? err.message : 'Please try again.' })
  } finally {
    memberBusyId.value = ''
  }
}

function onMemberRoleChange(member: ChatTeamMember, event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (value === 'admin' || value === 'teammate' || value === 'fan') {
    void changeMemberRole(member, value)
  }
}

async function toggleMemberPlayer(member: ChatTeamMember, isPlayer: boolean) {
  const role = memberRoleValue(member)
  if (!teamId.value || !member.userId || role === 'fan') return
  memberBusyId.value = member.memberId || member.userChatId || member.userId
  try {
    await updateTeamMemberRole(teamId.value, {
      userId: member.userId,
      userIdFirebase: member.userIdFirebase
    }, { role, markAsPlayer: isPlayer })
    await loadTeamMembers(true)
  } catch (err) {
    pushToast({ tone: 'warning', title: 'Could not update player status', message: err instanceof Error ? err.message : 'Please try again.' })
  } finally {
    memberBusyId.value = ''
  }
}

function onMemberPlayerChange(member: ChatTeamMember, event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  void toggleMemberPlayer(member, checked)
}

async function removeMember(member: ChatTeamMember) {
  if (!teamId.value || !member.userChatId) return
  memberBusyId.value = member.memberId || member.userChatId
  try {
    await removeTeamMember(teamId.value, member.userChatId)
    await loadTeamMembers(true)
    await loadDetail(true)
    pushToast({ tone: 'success', title: 'Member removed' })
  } catch (err) {
    pushToast({ tone: 'warning', title: 'Could not remove member', message: err instanceof Error ? err.message : 'Please try again.' })
  } finally {
    memberBusyId.value = ''
  }
}

// Reset cached state when switching conversation; (re)load team detail.
watch(
  () => props.conversationId,
  () => {
    sharedFiles.value = []
    filesLoaded.value = false
    openTeammates.value = false
    openFiles.value = false
    settingsOpen.value = false
    teamMembers.value = []
    membersLoaded.value = false
    memberBusyId.value = ''
    detail.value = null
    detailLoadedTeamId.value = ''
    memberMenuId.value = null
    void loadDetail()
  },
  { immediate: true }
)

// If the team ref resolves after the panel mounts (detail fetch needs it).
watch(teamId, () => {
  if (!detail.value) void loadDetail()
})
</script>

<template>
  <aside class="info-panel">
    <header class="info-panel__head">
      <span class="info-panel__title">Details</span>
      <button type="button" class="info-panel__close" aria-label="Close" @click="$emit('close')">
        <AppIcon name="close" :size="18" />
      </button>
    </header>

    <div ref="scrollRef" class="info-panel__scroll">
      <!-- Profile block -->
      <div class="info-panel__profile">
        <span class="info-panel__avatar">
          <TeamAvatar
            :name="teamTitle || conversation?.title || ''"
            :image-url="isTeam ? logoUrl : (conversation?.avatarUrl ?? undefined)"
            size="lg"
          />
          <PresenceDot
            v-if="!isTeam"
            class="info-panel__presence"
            :online="otherOnline"
            :size="14"
          />
        </span>
        <span class="info-panel__name">{{ teamTitle || conversation?.title }}</span>

        <template v-if="isTeam">
          <span v-if="categoryLabel" class="info-panel__category">{{ categoryLabel }}</span>
          <span v-if="ageGenderLabel" class="info-panel__sub">{{ ageGenderLabel }}</span>
        </template>
        <span v-else class="info-panel__sub">{{ otherOnline ? 'Online' : 'Offline' }}</span>
      </div>

      <!-- Team: stats + actions -->
      <template v-if="isTeam">
        <div class="info-panel__stats">
          <div class="info-panel__stat">
            <span class="info-panel__stat-value">{{ detail?.stats.games ?? '—' }}</span>
            <span class="info-panel__stat-label">Games</span>
          </div>
          <div class="info-panel__stat">
            <span class="info-panel__stat-value">{{ detail?.stats.won ?? '—' }}</span>
            <span class="info-panel__stat-label">Won</span>
          </div>
          <div class="info-panel__stat">
            <span class="info-panel__stat-value">{{ detail?.stats.lost ?? '—' }}</span>
            <span class="info-panel__stat-label">Lost</span>
          </div>
        </div>

        <div ref="actionsWrap" class="info-panel__actions-wrap">
          <div class="info-panel__actions">
            <button type="button" class="secondary-button" @click="openInvite">Invite</button>
            <button type="button" class="secondary-button" @click="openStatistics">Statistics</button>
            <button
              type="button"
              class="secondary-button info-panel__kebab"
              :class="{ 'info-panel__action--active': settingsOpen }"
              aria-label="Team settings"
              aria-haspopup="menu"
              :aria-expanded="settingsOpen"
              @click="settingsOpen = !settingsOpen"
            >
              <AppIcon name="ellipsis" :size="18" />
            </button>
          </div>

          <!-- Settings dropdown menu -->
          <div v-if="settingsOpen" class="info-panel__menu" role="menu">
          <button type="button" class="info-action" @click="toggleConvLock">
            <span class="info-action__label">{{ convHasLock ? 'Remove chat lock' : 'Lock this chat' }}</span>
            <span class="info-action__chevron">›</span>
          </button>
          <input
            ref="logoInputRef"
            type="file"
            class="info-panel__file"
            accept="image/png, image/jpeg, image/gif"
            @change="onLogoChange"
          />
          <button v-if="isAdmin" type="button" class="info-action" @click="openLogoPicker">
            <span class="info-action__label">Change Team Logo</span>
            <span class="info-action__chevron">›</span>
          </button>
          <button v-if="isAdmin" type="button" class="info-action" @click="editDetails">
            <span class="info-action__label">Edit Team Details</span>
            <span class="info-action__chevron">›</span>
          </button>

          <div class="info-toggle">
            <span class="info-toggle__label">SMS Notification</span>
            <ToggleSwitch
              :model-value="detail?.settings.smsNotification ?? false"
              aria-label="SMS Notification"
              @update:model-value="setSetting('smsNotification', $event)"
            />
          </div>
          <div class="info-toggle">
            <span class="info-toggle__label">Push Notification</span>
            <ToggleSwitch
              :model-value="detail?.settings.pushNotification ?? false"
              aria-label="Push Notification"
              @update:model-value="setSetting('pushNotification', $event)"
            />
          </div>
          <div class="info-toggle">
            <span class="info-toggle__label">Show On Base % as Average</span>
            <ToggleSwitch
              :model-value="detail?.settings.showOnBaseAvg ?? false"
              aria-label="Show On Base % as Average"
              @update:model-value="setSetting('showOnBaseAvg', $event)"
            />
          </div>
          <div class="info-toggle">
            <span class="info-toggle__label">Show average for top 5 players</span>
            <ToggleSwitch
              :model-value="detail?.settings.showTop5Avg ?? false"
              aria-label="Show average for top 5 players"
              @update:model-value="setSetting('showTop5Avg', $event)"
            />
          </div>

          <button type="button" class="info-action" @click="doArchive">
            <span class="info-action__label">{{ conversation?.isArchived ? 'Unarchive Team' : 'Archive Team' }}</span>
            <span class="info-action__chevron">›</span>
          </button>
          <button type="button" class="info-action info-action--danger" @click="doReport">
            <span class="info-action__label">Report Team</span>
            <span class="info-action__chevron">›</span>
          </button>
          <button type="button" class="info-action info-action--danger" @click="doExit">
            <span class="info-action__label">Exit Team</span>
            <span class="info-action__chevron">›</span>
          </button>

          <p v-if="createdByLine" class="info-panel__created">{{ createdByLine }}</p>
          </div>
        </div>

        <!-- Ongoing event card -->
        <div v-if="ongoingEvent" class="event-card">
          <div class="event-card__top">
            <span class="event-card__badge">{{ ongoingEvent.status || 'Ongoing' }}</span>
            <span v-if="eventDateLine" class="event-card__dates">{{ eventDateLine }}</span>
          </div>
          <span class="event-card__name">{{ ongoingEvent.name }}</span>
          <span v-if="ongoingEvent.location" class="event-card__location">{{ ongoingEvent.location }}</span>
          <div v-if="ongoingEvent.goingUsers.length || ongoingEvent.goingCount" class="event-card__going">
            <span class="event-card__avatars">
              <TeamAvatar
                v-for="u in ongoingEvent.goingUsers.slice(0, 4)"
                :key="u.userChatId"
                :name="u.name"
                :image-url="u.avatarUrl ?? undefined"
                size="sm"
              />
            </span>
            <span class="event-card__going-label">{{ ongoingEvent.goingCount }} going</span>
          </div>
        </div>

        <!-- Rows with counts -->
        <div class="info-panel__rows">
          <button type="button" class="info-row" @click="openTeamDetail('events')">
            <span class="info-row__label">All Events</span>
            <span class="info-row__count">{{ counts.allEvents }}</span>
            <span class="info-row__chevron">›</span>
          </button>
          <button type="button" class="info-row" @click="openTeamDetail()">
            <span class="info-row__label">Associations</span>
            <span class="info-row__count">{{ counts.associations }}</span>
            <span class="info-row__chevron">›</span>
          </button>

          <button
            type="button"
            class="info-row"
            :aria-expanded="openTeammates"
            @click="toggleTeammates"
          >
            <span class="info-row__label">Teammates</span>
            <span class="info-row__count">{{ teammatesCount }}</span>
            <span class="info-row__chevron" :class="{ 'info-row__chevron--open': openTeammates }">›</span>
          </button>
          <ul v-if="openTeammates" class="info-row__sub">
            <li v-if="membersLoading" class="info-row__hint">Loading...</li>
            <li v-else-if="!visibleTeamMembers.length" class="info-row__hint">No teammates yet.</li>
            <template v-else>
              <li v-for="member in visibleTeamMembers" :key="member.memberId || member.userChatId || member.inviteId || member.name" class="teammate">
                <TeamAvatar :name="member.name" :image-url="member.avatarUrl ?? undefined" size="sm" />
                <span class="teammate__main">
                  <span class="teammate__name" :title="member.name">{{ member.name }}</span>
                  <span v-if="member.isInvitationPending" class="teammate__sub">
                    Pending{{ member.inviteTarget ? `: ${member.inviteTarget}` : '' }}
                  </span>
                  <span v-else-if="member.email" class="teammate__sub">{{ member.email }}</span>
                </span>
                <span v-if="!canManageMember(member)" class="teammate__role">
                  {{ member.isInvitationPending ? 'Pending' : (memberRoleValue(member) === 'teammate' ? 'Teammate' : memberRoleValue(member)) }}
                </span>
                <div v-else class="teammate__actions" @click.stop>
                  <button
                    type="button"
                    class="teammate__menu-btn"
                    :class="{ 'is-active': memberMenuId === memberKey(member) }"
                    :aria-expanded="memberMenuId === memberKey(member) ? 'true' : 'false'"
                    aria-label="Member actions"
                    @click="toggleMemberMenu(member)"
                  >
                    <AppIcon name="ellipsis" :size="16" />
                  </button>
                  <div v-if="memberMenuId === memberKey(member)" class="teammate__menu">
                    <label class="teammate__menu-field">
                      <span>Role</span>
                      <select
                        class="teammate__select"
                        :value="memberRoleValue(member)"
                        :disabled="memberBusyId === (member.memberId || member.userChatId || member.userId)"
                        aria-label="Member role"
                        @change="onMemberRoleChange(member, $event)"
                      >
                        <option value="teammate">Teammate</option>
                        <option value="fan">Fan</option>
                        <option value="admin">Admin</option>
                      </select>
                    </label>
                    <label
                      v-if="memberRoleValue(member) !== 'fan'"
                      class="teammate__player"
                    >
                      <input
                        type="checkbox"
                        :checked="member.isPlayer"
                        :disabled="memberBusyId === (member.memberId || member.userChatId || member.userId)"
                        @change="onMemberPlayerChange(member, $event)"
                      />
                      Player
                    </label>
                    <button
                      type="button"
                      class="teammate__remove"
                      :disabled="memberBusyId === (member.memberId || member.userChatId || member.userId)"
                      @click="removeMember(member)"
                    >
                      <AppIcon name="close" :size="14" />
                      <span>Remove member</span>
                    </button>
                  </div>
                </div>
              </li>
            </template>
          </ul>

          <button
            type="button"
            class="info-row"
            :aria-expanded="openFiles"
            @click="toggleFiles"
          >
            <span class="info-row__label">Shared Files</span>
            <span class="info-row__count">{{ sharedFilesCount }}</span>
            <span class="info-row__chevron" :class="{ 'info-row__chevron--open': openFiles }">›</span>
          </button>
          <ul v-if="openFiles" class="info-row__sub">
            <li v-if="filesLoading" class="info-row__hint">Loading…</li>
            <li v-else-if="!sharedFiles.length" class="info-row__hint">No shared files.</li>
            <li v-for="f in sharedFiles" :key="f.messageId" class="shared-file">
              <a :href="f.url || undefined" target="_blank" rel="noopener" class="shared-file__link">
                <AppIcon name="document" :size="18" />
                <span class="shared-file__meta">
                  <span class="shared-file__name">{{ f.name }}</span>
                  <span v-if="f.size" class="shared-file__size">{{ formatFileSize(f.size) }}</span>
                </span>
              </a>
            </li>
          </ul>
        </div>
      </template>

      <!-- DM: other user's profile summary -->
      <template v-else>
        <div class="info-panel__rows">
          <button type="button" class="info-row" @click="toggleConvLock">
            <span class="info-row__label">{{ convHasLock ? 'Remove chat lock' : 'Lock this chat' }}</span>
            <span class="info-row__chevron">›</span>
          </button>
          <button
            type="button"
            class="info-row"
            :aria-expanded="openFiles"
            @click="toggleFiles"
          >
            <span class="info-row__label">Shared Files</span>
            <span v-if="filesLoaded" class="info-row__count">{{ sharedFiles.length }}</span>
            <span class="info-row__chevron" :class="{ 'info-row__chevron--open': openFiles }">›</span>
          </button>
          <ul v-if="openFiles" class="info-row__sub">
            <li v-if="filesLoading" class="info-row__hint">Loading…</li>
            <li v-else-if="!sharedFiles.length" class="info-row__hint">No shared files.</li>
            <li v-for="f in sharedFiles" :key="f.messageId" class="shared-file">
              <a :href="f.url || undefined" target="_blank" rel="noopener" class="shared-file__link">
                <AppIcon name="document" :size="18" />
                <span class="shared-file__meta">
                  <span class="shared-file__name">{{ f.name }}</span>
                  <span v-if="f.size" class="shared-file__size">{{ formatFileSize(f.size) }}</span>
                </span>
              </a>
            </li>
          </ul>
        </div>
      </template>
    </div>

    <!-- Invite slide-over -->
    <InviteToTeamModal
      v-if="isTeam && teamId"
      v-model="inviteOpen"
      :team-id="teamId"
      :team-name="teamTitle"
      :team-logo-url="logoUrl ?? null"
      :excluded-user-chat-ids="existingMemberChatIds"
      @sent="onInviteSent"
    />
  </aside>
</template>

<style scoped>
.info-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--surface-card, #fff);
  border-left: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
}

.info-panel__head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
}

.info-panel__title {
  color: var(--text, #2e3137);
  font-size: 0.95rem;
  font-weight: 500;
}

.info-panel__close {
  display: inline-flex;
  border: none;
  background: transparent;
  color: var(--text-light, #787f8d);
  cursor: pointer;
}

.info-panel__scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 16px;
}

.info-panel__profile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  text-align: center;
}

.info-panel__avatar {
  position: relative;
}

.info-panel__presence {
  position: absolute;
  right: 2px;
  bottom: 2px;
}

.info-panel__name {
  margin-top: 4px;
  color: var(--text, #2e3137);
  font-size: 1.05rem;
  font-weight: 500;
}

.info-panel__category {
  color: var(--secondary, #2f5f98);
  font-size: 0.84rem;
  font-weight: 500;
}

.info-panel__sub {
  color: var(--text-light, #787f8d);
  font-size: 0.82rem;
  font-weight: 400;
}

.info-panel__stats {
  display: flex;
  gap: 10px;
  margin: 18px 0;
}

.info-panel__stat {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 4px;
  border-radius: var(--radius-md, 5px);
  background: var(--surface-raised, rgba(240, 246, 253, 0.65));
}

.info-panel__stat-value {
  color: var(--text, #2e3137);
  font-size: 1.1rem;
  font-weight: 500;
}

.info-panel__stat-label {
  color: var(--text-light, #787f8d);
  font-size: 0.74rem;
  font-weight: 400;
}

.info-panel__actions-wrap {
  position: relative;
  margin-bottom: 18px;
}

.info-panel__actions {
  display: flex;
  gap: 8px;
}

.info-panel__actions .secondary-button {
  flex: 1 1 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 9px 8px;
  border-radius: var(--radius-md, 5px);
  font-size: 0.82rem;
  white-space: nowrap;
  cursor: pointer;
}

/* Overflow (⋯) button — fixed, narrow; opens the settings dropdown. */
.info-panel__kebab {
  flex: 0 0 auto !important;
  width: 44px;
}

.info-panel__action--active {
  border-color: var(--primary, #2d8cf0);
  color: var(--primary, #2d8cf0);
}

/* Settings dropdown menu (anchored under the actions row) */
.info-panel__menu {
  position: static;
  display: flex;
  flex-direction: column;
  margin-top: 8px;
  overflow: visible;
  padding: 4px 12px;
  border-radius: 12px;
  background: var(--surface-opaque, rgba(255, 255, 255, 0.98));
  border: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
  box-shadow: var(--shadow, 0 10px 24px rgba(36, 60, 91, 0.18));
}

.info-panel__file {
  display: none;
}

.info-action {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 12px 4px;
  border: none;
  border-bottom: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
  background: transparent;
  cursor: pointer;
  font-family: var(--font-body);
}

.info-action:last-of-type {
  border-bottom: none;
}

.info-action__label {
  flex: 1 1 auto;
  text-align: left;
  color: var(--text, #2e3137);
  font-size: 0.88rem;
  font-weight: 400;
}

.info-action__chevron {
  color: var(--text-light, #787f8d);
  font-size: 1.1rem;
}

.info-action--danger .info-action__label {
  color: #c1413a;
}

.info-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 4px;
  border-bottom: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
}

.info-toggle__label {
  color: var(--text, #2e3137);
  font-size: 0.88rem;
  font-weight: 400;
}

.info-panel__created {
  margin: 12px 4px 4px;
  color: var(--text-light, #787f8d);
  font-size: 0.74rem;
  font-weight: 400;
}

/* Ongoing event card */
.event-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 18px;
  padding: 14px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
  background: var(--surface-raised, rgba(240, 246, 253, 0.65));
}

.event-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.event-card__badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--primary, #2d8cf0);
  color: var(--white, #fff);
  font-size: 0.7rem;
  font-weight: 500;
  text-transform: capitalize;
}

html.dark-mode .event-card__badge {
  color: #0f1419;
}

.event-card__dates {
  color: var(--text-light, #787f8d);
  font-size: 0.78rem;
  font-weight: 400;
}

.event-card__name {
  color: var(--text, #2e3137);
  font-size: 0.95rem;
  font-weight: 500;
}

.event-card__location {
  color: var(--text-light, #787f8d);
  font-size: 0.8rem;
  font-weight: 400;
}

.event-card__going {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 4px;
}

.event-card__avatars {
  display: inline-flex;
}

.event-card__avatars > :not(:first-child) {
  margin-left: -8px;
}

.event-card__going-label {
  color: var(--text-light, #787f8d);
  font-size: 0.78rem;
  font-weight: 400;
}

.info-panel__rows {
  display: flex;
  flex-direction: column;
}

.info-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 12px 4px;
  border: none;
  border-bottom: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
  background: transparent;
  cursor: pointer;
  font-family: var(--font-body);
}

.info-row__label {
  flex: 1 1 auto;
  text-align: left;
  color: var(--text, #2e3137);
  font-size: 0.9rem;
  font-weight: 400;
}

.info-row__count {
  color: var(--text-light, #787f8d);
  font-size: 0.82rem;
  font-weight: 400;
}

.info-row__chevron {
  color: var(--text-light, #787f8d);
  font-size: 1.1rem;
  transition: transform 120ms ease;
}

.info-row__chevron--open {
  transform: rotate(90deg);
}

.info-row__sub {
  list-style: none;
  margin: 0;
  padding: 6px 0;
}

.info-row__hint {
  padding: 8px 4px;
  color: var(--text-light, #787f8d);
  font-size: 0.82rem;
  font-weight: 400;
}

.teammate {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 4px;
}

.teammate__main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.teammate__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text, #2e3137);
  font-size: 0.86rem;
  font-weight: 400;
}

.teammate__sub {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-light, #787f8d);
  font-size: 0.72rem;
  font-weight: 400;
}

.teammate__role {
  flex: 0 0 auto;
  color: var(--secondary, #2f5f98);
  font-size: 0.72rem;
  font-weight: 500;
  text-transform: capitalize;
}

.teammate__actions {
  position: relative;
  flex: 0 0 auto;
}

.teammate__menu-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--text-light, #787f8d);
  cursor: pointer;
}

.teammate__menu-btn:hover,
.teammate__menu-btn.is-active {
  background: var(--surface-pill, rgba(248, 250, 253, 0.94));
  color: var(--primary, #2d8cf0);
}

.teammate__menu {
  position: absolute;
  right: 0;
  top: 34px;
  z-index: 8;
  display: flex;
  min-width: 178px;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
  border-radius: 10px;
  background: var(--surface-opaque, rgba(255, 255, 255, 0.98));
  box-shadow: var(--shadow, 0 10px 24px rgba(36, 60, 91, 0.18));
}

.teammate__menu-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: var(--text-light, #787f8d);
  font-size: 0.72rem;
}

.teammate__select {
  width: 100%;
  min-height: 30px;
  padding: 0 8px;
  border: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
  border-radius: var(--radius-md, 5px);
  background: var(--surface-card, #fff);
  color: var(--text, #2e3137);
  font-family: var(--font-body);
  font-size: 0.76rem;
  outline: none;
}

.teammate__player {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-light, #787f8d);
  font-size: 0.72rem;
  font-weight: 400;
  white-space: nowrap;
}

.teammate__player input {
  width: 14px;
  height: 14px;
}

.teammate__remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 32px;
  width: 100%;
  padding: 0 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #c1413a;
  font-family: var(--font-body);
  font-size: 0.78rem;
  cursor: pointer;
}

.teammate__remove:hover {
  background: var(--danger-light, rgba(193, 65, 58, 0.1));
}

.teammate__remove:disabled {
  cursor: wait;
  opacity: 0.6;
}

.shared-file {
  padding: 4px 0;
}

.shared-file__link {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 4px;
  border-radius: var(--radius-md, 5px);
  text-decoration: none;
  color: var(--secondary, #2f5f98);
}

.shared-file__link:hover {
  background: var(--surface-pill, rgba(248, 250, 253, 0.94));
}

.shared-file__meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.shared-file__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text, #2e3137);
  font-size: 0.84rem;
  font-weight: 400;
}

.shared-file__size {
  color: var(--text-light, #787f8d);
  font-size: 0.72rem;
  font-weight: 400;
}
</style>
