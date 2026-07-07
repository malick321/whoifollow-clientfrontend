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
import { useChatStore } from '../../stores/chat'
import { useChatLockStore } from '../../stores/chatLock'
import {
  archiveTeam,
  changeTeamLogo,
  fetchSharedFiles,
  fetchTeamDetail,
  leaveTeam,
  reportTeam,
  updateTeamSettings,
  type ChatSharedFile,
  type ChatTeamDetail,
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
const convLocked = computed(() => chatLock.conversationHasLock(props.conversationId))
function toggleConvLock() {
  if (!chatLock.enabled) {
    pushToast({
      tone: 'warning',
      title: 'Set up Chat Lock first',
      message: 'Turn on Chat Lock from the lock icon in the chat list, then you can lock individual chats.'
    })
    return
  }
  if (convLocked.value) chatLock.removeConversationLock(props.conversationId)
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

async function loadDetail() {
  if (!isTeam.value || !teamId.value) return
  detailLoading.value = true
  try {
    detail.value = await fetchTeamDetail(teamId.value)
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
const logoInputRef = ref<HTMLInputElement | null>(null)

function onDocPointer(e: MouseEvent) {
  if (!settingsOpen.value) return
  const t = e.target as Node | null
  if (actionsWrap.value && t && !actionsWrap.value.contains(t)) settingsOpen.value = false
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
    if (url && detail.value) detail.value.logoUrl = url
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
  // Edit-details flow reuses the Add Team form shape; surfaced separately.
  pushToast({
    tone: 'success',
    title: 'Edit team details',
    message: 'Opening the team details editor is wired through the team settings flow.'
  })
}

async function doArchive() {
  if (!teamId.value) return
  try {
    await archiveTeam(teamId.value)
    pushToast({ tone: 'success', title: 'Team archived', message: `${teamTitle.value} was archived.` })
  } catch (err) {
    pushToast({ tone: 'warning', title: 'Could not archive', message: err instanceof Error ? err.message : 'Please try again.' })
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

const sharedFiles = ref<ChatSharedFile[]>([])
const filesLoaded = ref(false)
const filesLoading = ref(false)

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

const sharedFilesCount = computed(() =>
  filesLoaded.value ? sharedFiles.value.length : counts.value.sharedFiles
)
const teammatesCount = computed(() =>
  detail.value ? counts.value.teammates : participants.value.length
)

// Reset cached state when switching conversation; (re)load team detail.
watch(
  () => props.conversationId,
  () => {
    sharedFiles.value = []
    filesLoaded.value = false
    openTeammates.value = false
    openFiles.value = false
    settingsOpen.value = false
    detail.value = null
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

    <div class="info-panel__scroll">
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
            <span class="info-action__label">{{ convLocked ? 'Unlock this chat' : 'Lock this chat' }}</span>
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
            <span class="info-action__label">Archive Team</span>
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
            @click="openTeammates = !openTeammates"
          >
            <span class="info-row__label">Teammates</span>
            <span class="info-row__count">{{ teammatesCount }}</span>
            <span class="info-row__chevron" :class="{ 'info-row__chevron--open': openTeammates }">›</span>
          </button>
          <ul v-if="openTeammates" class="info-row__sub">
            <li v-for="p in participants" :key="p.userChatId" class="teammate">
              <TeamAvatar :name="p.name" :image-url="p.avatarUrl ?? undefined" size="sm" />
              <span class="teammate__name">{{ p.name }}</span>
              <span v-if="p.role === 'admin'" class="teammate__role">Admin</span>
            </li>
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
            <span class="info-row__label">{{ convLocked ? 'Unlock this chat' : 'Lock this chat' }}</span>
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
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  max-height: 60vh;
  overflow-y: auto;
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
  padding: 6px 4px;
}

.teammate__name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text, #2e3137);
  font-size: 0.86rem;
  font-weight: 400;
}

.teammate__role {
  color: var(--secondary, #2f5f98);
  font-size: 0.72rem;
  font-weight: 500;
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
