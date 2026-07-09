<script setup lang="ts">
// InviteToTeamModal
// -----------------
// Slide-over "Invite to {team}" with three tabs — the new-frontend rebuild of
// the legacy chat/ChatModals/InviteToTeamModal.vue:
//   1. Via Link        — readonly invite URL + Copy.
//   2. Via Mobile/Email — country code + mobile OR email, Role, Mark as Player.
//   3. Add Friends      — friend search/picker + Role + Mark as Player.
// Wired to the team invite client fns in src/api/chat.ts.

import { computed, ref, watch } from 'vue'
import SlideModal from '../SlideModal.vue'
import TeamAvatar from '../TeamAvatar.vue'
import AppIcon from '../AppIcon.vue'
import ToggleSwitch from '../ToggleSwitch.vue'
import { fetchFriends, type ChatFriend } from '../../api/friends'
import {
  getTeamInviteLink,
  inviteTeamContact,
  inviteTeamFriends,
  type ChatInviteRole
} from '../../api/chat'
import { pushToast } from '../../toast-center'

const props = defineProps<{
  modelValue: boolean
  teamId: string
  teamName: string
  teamLogoUrl?: string | null
  excludedUserChatIds?: string[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'sent'): void
}>()

type Tab = 'link' | 'contact' | 'friends'
const activeTab = ref<Tab>('link')

const ROLE_OPTIONS: { value: ChatInviteRole; label: string }[] = [
  { value: 'teammate', label: 'Teammate' },
  { value: 'fan', label: 'Fan' }
]
const COUNTRY_CODES = [
  { value: '+1', label: 'USA (+1)' },
  { value: '+92', label: 'Pak (+92)' }
]

// ── Tab 1 · Link ─────────────────────────────────────────────────
const inviteLink = ref('')
const linkLoading = ref(false)
const copied = ref(false)

async function loadLink() {
  if (inviteLink.value || linkLoading.value) return
  linkLoading.value = true
  try {
    inviteLink.value = await getTeamInviteLink(props.teamId)
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not load link',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    linkLoading.value = false
  }
}

async function copyLink() {
  if (!inviteLink.value) return
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(inviteLink.value)
    } else {
      const el = document.getElementById('invite-link-input') as HTMLInputElement | null
      el?.select()
      document.execCommand('copy')
    }
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    pushToast({ tone: 'warning', title: 'Copy failed', message: 'Could not copy the link.' })
  }
}

// ── Tab 2 · Contact (mobile / email) ─────────────────────────────
const countryCode = ref('+1')
const mobile = ref('')
const email = ref('')
const contactRole = ref<ChatInviteRole>('teammate')
const contactMarkAsPlayer = ref(false)
const contactSending = ref(false)
const contactError = ref('')

const showContactPlayer = computed(() => contactRole.value === 'teammate')

watch(contactRole, (role) => {
  if (role === 'fan') contactMarkAsPlayer.value = false
})

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function sendContactInvite() {
  contactError.value = ''
  const hasMobile = mobile.value.trim() !== ''
  const hasEmail = email.value.trim() !== ''
  if (!hasMobile && !hasEmail) {
    contactError.value = 'Enter a mobile number or an email address.'
    return
  }
  if (hasMobile && hasEmail) {
    contactError.value = 'Use either a mobile number or an email — not both.'
    return
  }
  if (hasMobile && !/^\d{10,}$/.test(mobile.value.trim())) {
    contactError.value = 'Enter a valid mobile number (at least 10 digits).'
    return
  }
  if (hasEmail && !EMAIL_RE.test(email.value.trim())) {
    contactError.value = 'Enter a valid email address.'
    return
  }
  contactSending.value = true
  try {
    await inviteTeamContact(props.teamId, {
      countryCode: hasMobile ? countryCode.value : undefined,
      mobile: hasMobile ? mobile.value.trim() : undefined,
      email: hasEmail ? email.value.trim() : undefined,
      role: contactRole.value,
      markAsPlayer: contactRole.value === 'teammate' ? contactMarkAsPlayer.value : false
    })
    pushToast({ tone: 'success', title: 'Invitation sent', message: 'Your invite is on its way.' })
    mobile.value = ''
    email.value = ''
    contactRole.value = 'teammate'
    contactMarkAsPlayer.value = false
    emit('sent')
    emit('update:modelValue', false)
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not send invite',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    contactSending.value = false
  }
}

// ── Tab 3 · Friends ──────────────────────────────────────────────
const friendQuery = ref('')
const friendResults = ref<ChatFriend[]>([])
const selectedFriends = ref<ChatFriend[]>([])
const friendsLoading = ref(false)
const friendsOpen = ref(false)
const friendRole = ref<ChatInviteRole>('teammate')
const friendMarkAsPlayer = ref(false)
const friendsSending = ref(false)
let friendDebounce: ReturnType<typeof setTimeout> | null = null

const showFriendPlayer = computed(() => friendRole.value === 'teammate')
watch(friendRole, (role) => {
  if (role === 'fan') friendMarkAsPlayer.value = false
})

const filteredFriendResults = computed(() => {
  const takenChatIds = new Set(selectedFriends.value.map((f) => f.userChatId))
  const takenUserIds = new Set(selectedFriends.value.map((f) => f.userId).filter(Boolean))
  const excluded = new Set((props.excludedUserChatIds ?? []).filter(Boolean))
  return friendResults.value.filter((f) =>
    !takenChatIds.has(f.userChatId) &&
    !(f.userId && takenUserIds.has(f.userId)) &&
    !excluded.has(f.userChatId)
  )
})

async function loadFriends(search = '') {
  friendsLoading.value = true
  try {
    friendResults.value = await fetchFriends(search)
  } finally {
    friendsLoading.value = false
  }
}

function onFriendSearch() {
  friendsOpen.value = true
  if (friendDebounce) clearTimeout(friendDebounce)
  friendDebounce = setTimeout(() => void loadFriends(friendQuery.value), 250)
}

function addFriend(friend: ChatFriend) {
  if (selectedFriends.value.some((f) =>
    f.userChatId === friend.userChatId || (!!f.userId && f.userId === friend.userId)
  )) return
  selectedFriends.value = [...selectedFriends.value, friend]
  friendQuery.value = ''
}

function removeFriend(userChatId: string) {
  selectedFriends.value = selectedFriends.value.filter((f) => f.userChatId !== userChatId)
}

async function addFriendsToTeam() {
  if (!selectedFriends.value.length) {
    pushToast({ tone: 'warning', title: 'No friends selected', message: 'Pick at least one friend to add.' })
    return
  }
  friendsSending.value = true
  try {
    await inviteTeamFriends(props.teamId, {
      userChatIds: selectedFriends.value.map((f) => f.userChatId),
      role: friendRole.value,
      markAsPlayer: friendRole.value === 'teammate' ? friendMarkAsPlayer.value : false
    })
    pushToast({
      tone: 'success',
      title: 'Friends added',
      message: `${selectedFriends.value.length} friend(s) added to ${props.teamName}.`
    })
    selectedFriends.value = []
    friendQuery.value = ''
    emit('sent')
    emit('update:modelValue', false)
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not add friends',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    friendsSending.value = false
  }
}

// ── Lifecycle ────────────────────────────────────────────────────
function reset() {
  activeTab.value = 'link'
  inviteLink.value = ''
  copied.value = false
  countryCode.value = '+1'
  mobile.value = ''
  email.value = ''
  contactRole.value = 'teammate'
  contactMarkAsPlayer.value = false
  contactError.value = ''
  friendQuery.value = ''
  friendResults.value = []
  selectedFriends.value = []
  friendsOpen.value = false
  friendRole.value = 'teammate'
  friendMarkAsPlayer.value = false
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    reset()
    void loadLink()
  }
)

watch(activeTab, (tab) => {
  if (tab === 'friends' && !friendResults.value.length) void loadFriends('')
})

function close() {
  emit('update:modelValue', false)
}
</script>

<template>
  <SlideModal
    :model-value="modelValue"
    :title="`Invite to ${teamName}`"
    subtitle="Invite friends via link, mobile/email, or straight from your friend list."
    @update:model-value="(v) => emit('update:modelValue', v)"
  >
    <template #title-block>
      <div class="invite-team__head">
        <TeamAvatar :name="teamName" :image-url="teamLogoUrl ?? undefined" size="md" />
        <div class="invite-team__head-copy">
          <h2 class="slide-modal-panel__title">Invite to {{ teamName }}</h2>
          <p class="slide-modal-panel__subtitle">
            Invite friends via link, mobile/email, or from your friend list.
          </p>
        </div>
      </div>
    </template>

    <!-- Tabs -->
    <div class="invite-team__tabs" role="tablist">
      <button
        type="button"
        class="invite-team__tab"
        :class="{ 'invite-team__tab--active': activeTab === 'link' }"
        role="tab"
        :aria-selected="activeTab === 'link'"
        @click="activeTab = 'link'"
      >Via Link</button>
      <button
        type="button"
        class="invite-team__tab"
        :class="{ 'invite-team__tab--active': activeTab === 'contact' }"
        role="tab"
        :aria-selected="activeTab === 'contact'"
        @click="activeTab = 'contact'"
      >Via Mobile/Email</button>
      <button
        type="button"
        class="invite-team__tab"
        :class="{ 'invite-team__tab--active': activeTab === 'friends' }"
        role="tab"
        :aria-selected="activeTab === 'friends'"
        @click="activeTab = 'friends'"
      >Add Friends</button>
    </div>

    <!-- Tab 1 · Via Link -->
    <section v-if="activeTab === 'link'" class="invite-team__panel">
      <p class="invite-team__hint">Anyone with this link can request to join the team.</p>
      <div class="floating-input">
        <input
          id="invite-link-input"
          :value="linkLoading ? 'Generating link…' : inviteLink"
          type="text"
          class="floating-input__control"
          readonly
          placeholder=" "
        />
        <label for="invite-link-input" class="floating-input__label floating-input__label--floated">Invite Link</label>
      </div>
      <button
        type="button"
        class="primary-button invite-team__copy"
        :disabled="linkLoading || !inviteLink"
        @click="copyLink"
      >
        {{ copied ? 'Copied!' : 'Copy Link' }}
      </button>
    </section>

    <!-- Tab 2 · Via Mobile/Email -->
    <section v-else-if="activeTab === 'contact'" class="invite-team__panel">
      <div class="invite-team__contact-row">
        <div class="floating-input invite-team__code">
          <select id="invite-code" v-model="countryCode" class="floating-input__control floating-input__control--select">
            <option v-for="c in COUNTRY_CODES" :key="c.value" :value="c.value">{{ c.label }}</option>
          </select>
          <label for="invite-code" class="floating-input__label floating-input__label--floated">Country Code</label>
        </div>
        <div class="floating-input invite-team__mobile">
          <input id="invite-mobile" v-model="mobile" type="tel" inputmode="numeric" class="floating-input__control" placeholder=" " />
          <label for="invite-mobile" class="floating-input__label">Mobile Number</label>
        </div>
      </div>

      <div class="invite-team__or"><span>OR</span></div>

      <div class="floating-input">
        <input id="invite-email" v-model="email" type="email" class="floating-input__control" placeholder=" " autocomplete="email" />
        <label for="invite-email" class="floating-input__label">Email Address</label>
      </div>

      <div class="invite-team__role-row">
        <div class="floating-input invite-team__role">
          <select id="invite-role" v-model="contactRole" class="floating-input__control floating-input__control--select">
            <option v-for="r in ROLE_OPTIONS" :key="r.value" :value="r.value">{{ r.label }}</option>
          </select>
          <label for="invite-role" class="floating-input__label floating-input__label--floated">Role</label>
        </div>
        <div v-if="showContactPlayer" class="invite-team__player">
          <div class="invite-team__player-head">
            <span class="invite-team__player-title">Mark as Player</span>
            <ToggleSwitch v-model="contactMarkAsPlayer" aria-label="Mark as Player" />
          </div>
          <p class="invite-team__player-hint">
            Players appear in the game lineup, roster and stats.
          </p>
        </div>
      </div>

      <p v-if="contactError" class="invite-team__error">{{ contactError }}</p>
    </section>

    <!-- Tab 3 · Add Friends -->
    <section v-else class="invite-team__panel">
      <span class="invite-team__field-label">Select people from your friend list</span>

      <div v-if="selectedFriends.length" class="invite-team__chips">
        <span v-for="f in selectedFriends" :key="f.userChatId" class="invite-team__chip">
          <TeamAvatar :name="f.name" :image-url="f.avatarUrl ?? undefined" size="sm" />
          <span class="invite-team__chip-name">{{ f.name }}</span>
          <button type="button" class="invite-team__chip-remove" :aria-label="`Remove ${f.name}`" @click="removeFriend(f.userChatId)">
            <AppIcon name="close" :size="12" />
          </button>
        </span>
      </div>

      <div class="floating-input">
        <input
          id="invite-friend-search"
          v-model="friendQuery"
          type="search"
          class="floating-input__control"
          placeholder=" "
          autocomplete="off"
          @input="onFriendSearch"
          @focus="friendsOpen = true"
        />
        <label for="invite-friend-search" class="floating-input__label">Type to search friends</label>
      </div>

      <ul v-if="friendsOpen" class="invite-team__friend-list">
        <li v-if="friendsLoading" class="invite-team__friend-hint">Searching…</li>
        <li v-else-if="!filteredFriendResults.length" class="invite-team__friend-hint">No matching friends.</li>
        <li
          v-for="f in filteredFriendResults"
          v-else
          :key="f.userChatId"
          class="invite-team__friend-row"
          @click="addFriend(f)"
        >
          <TeamAvatar :name="f.name" :image-url="f.avatarUrl ?? undefined" size="sm" />
          <span class="invite-team__friend-name">{{ f.name }}</span>
          <span class="invite-team__friend-add" aria-hidden="true">+</span>
        </li>
      </ul>

      <div class="invite-team__role-row">
        <div class="floating-input invite-team__role">
          <select id="invite-friend-role" v-model="friendRole" class="floating-input__control floating-input__control--select">
            <option v-for="r in ROLE_OPTIONS" :key="r.value" :value="r.value">{{ r.label }}</option>
          </select>
          <label for="invite-friend-role" class="floating-input__label floating-input__label--floated">Role</label>
        </div>
        <div v-if="showFriendPlayer" class="invite-team__player">
          <div class="invite-team__player-head">
            <span class="invite-team__player-title">Mark as Player</span>
            <ToggleSwitch v-model="friendMarkAsPlayer" aria-label="Mark as Player" />
          </div>
          <p class="invite-team__player-hint">
            Players appear in the game lineup, roster and stats.
          </p>
        </div>
      </div>
    </section>

    <template #footer>
      <button type="button" class="secondary-button" @click="close">Close</button>
      <button
        v-if="activeTab === 'contact'"
        type="button"
        class="primary-button"
        :disabled="contactSending"
        @click="sendContactInvite"
      >
        <span v-if="contactSending" class="btn-spinner" aria-hidden="true"></span>
        {{ contactSending ? 'Sending…' : 'Send Invite' }}
      </button>
      <button
        v-else-if="activeTab === 'friends'"
        type="button"
        class="primary-button"
        :disabled="friendsSending"
        @click="addFriendsToTeam"
      >
        <span v-if="friendsSending" class="btn-spinner" aria-hidden="true"></span>
        {{ friendsSending ? 'Adding…' : 'Proceed to Add' }}
      </button>
    </template>
  </SlideModal>
</template>

<style scoped>
.invite-team__head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.invite-team__head-copy {
  min-width: 0;
}

/* Tabs */
.invite-team__tabs {
  display: flex;
  gap: 6px;
  padding: 4px;
  margin-bottom: 20px;
  border-radius: 999px;
  background: var(--surface-pill, rgba(248, 250, 253, 0.94));
}
.invite-team__tab {
  flex: 1 1 0;
  min-height: 36px;
  padding: 0 10px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--text-light, #787f8d);
  font-family: var(--font-body);
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}
.invite-team__tab--active {
  background: var(--white, #fff);
  color: var(--secondary, #2f5f98);
  box-shadow: var(--shadow-soft, 0 6px 16px rgba(36, 60, 91, 0.05));
}

.invite-team__panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.invite-team__hint {
  margin: 0;
  color: var(--text-light, #787f8d);
  font-size: 0.84rem;
  font-weight: 400;
}
.invite-team__copy {
  align-self: flex-start;
}

/* Contact tab */
.invite-team__contact-row {
  display: grid;
  grid-template-columns: minmax(120px, 0.6fr) 1fr;
  gap: 12px;
}
.invite-team__or {
  display: flex;
  align-items: center;
  text-align: center;
  color: var(--text-light, #787f8d);
  font-size: 0.78rem;
  font-weight: 400;
}
.invite-team__or::before,
.invite-team__or::after {
  content: '';
  flex: 1 1 auto;
  height: 1px;
  background: var(--border-divider, rgba(207, 220, 234, 0.85));
}
.invite-team__or span {
  padding: 0 12px;
}
.invite-team__role-row {
  display: grid;
  grid-template-columns: minmax(140px, 0.7fr) 1fr;
  gap: 16px;
  align-items: start;
}
.invite-team__player-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.invite-team__player-title {
  color: var(--text, #2e3137);
  font-size: 0.9rem;
  font-weight: 500;
}
.invite-team__player-hint {
  margin: 4px 0 0;
  color: var(--text-light, #787f8d);
  font-size: 0.76rem;
  font-weight: 400;
}
.invite-team__error {
  margin: 0;
  color: #c1413a;
  font-size: 0.82rem;
  font-weight: 400;
}

/* Friends tab */
.invite-team__field-label {
  color: var(--secondary, #2f5f98);
  font-size: 0.82rem;
  font-weight: 500;
}
.invite-team__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.invite-team__chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px 4px 4px;
  border-radius: 999px;
  background: var(--surface-pill, rgba(248, 250, 253, 0.94));
  border: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
}
.invite-team__chip-name {
  font-size: 0.84rem;
  font-weight: 400;
  color: var(--text, #2e3137);
}
.invite-team__chip-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--text-light, #787f8d);
  cursor: pointer;
}
.invite-team__chip-remove:hover {
  background: var(--surface-card, #fff);
  color: var(--text, #2e3137);
}
.invite-team__friend-list {
  list-style: none;
  margin: 0;
  padding: 4px;
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
  border-radius: var(--radius-md, 8px);
  background: var(--surface-card, #fff);
}
.invite-team__friend-hint {
  padding: 10px 8px;
  color: var(--text-light, #787f8d);
  font-size: 0.84rem;
  font-weight: 400;
}
.invite-team__friend-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border-radius: var(--radius-md, 6px);
  cursor: pointer;
}
.invite-team__friend-row:hover {
  background: var(--surface-pill, rgba(248, 250, 253, 0.94));
}
.invite-team__friend-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text, #2e3137);
  font-size: 0.88rem;
  font-weight: 400;
}
.invite-team__friend-add {
  color: var(--primary, #2d8cf0);
  font-size: 1.2rem;
  line-height: 1;
}
</style>
