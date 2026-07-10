<script setup lang="ts">
// InviteFriendModal
// -----------------
// Standalone "Invite Friend to join Who I Follow" slide-over — the new-frontend
// rebuild of the legacy Home/InviteFriendsModal.vue. Country Code + Number OR
// Email → Send Invite, backed by `POST /v2/friends/invite` (Email + SMS).
//
// Unlike InviteToTeamModal this invite is NOT team-scoped — it invites a person
// to the platform. Opened globally via invite-modal-center (top-bar "Invite").
// When the target already has an account the backend returns their friend
// status, which we surface as an inline informational card.

import { computed, ref, watch } from 'vue'
import SlideModal from './SlideModal.vue'
import TeamAvatar from './TeamAvatar.vue'
import { useInviteModalState, closeInviteModal } from '../invite-modal-center'
import { inviteFriend, type FriendStatus, type InvitedFriendSummary } from '../api/friends'
import { pushToast } from '../toast-center'

const isOpen = useInviteModalState()

// Mirror the legacy static list (default USA). No dynamic country-code source
// existed in the legacy app either.
const COUNTRY_CODES = [
  { value: '+1', label: 'USA (+1)' },
  { value: '+92', label: 'Pak (+92)' }
]

const countryCode = ref('+1')
const number = ref('')
const email = ref('')
const sending = ref(false)
const error = ref('')

// Inline "already registered" result card.
const registeredUser = ref<InvitedFriendSummary | null>(null)
const registeredStatus = ref<FriendStatus | null>(null)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const friendStatusLabel = computed(() => {
  switch (registeredStatus.value) {
    case 1:
      return "You're already friends."
    case 3:
      return 'A friend request is already pending.'
    default:
      return 'Already on Who I Follow.'
  }
})

/** Light (XXX) XXX-XXXX formatting, matching the legacy v-phone-mask. */
function onNumberInput(event: Event) {
  const digits = (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 10)
  let out = digits
  if (digits.length > 6) out = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  else if (digits.length > 3) out = `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  else if (digits.length > 0) out = `(${digits}`
  number.value = out
}

function reset() {
  countryCode.value = '+1'
  number.value = ''
  email.value = ''
  error.value = ''
  sending.value = false
  registeredUser.value = null
  registeredStatus.value = null
}

watch(isOpen, (open) => {
  if (open) reset()
})

async function send() {
  error.value = ''
  registeredUser.value = null
  registeredStatus.value = null

  const hasNumber = number.value.replace(/\D/g, '').length > 0
  const hasEmail = email.value.trim() !== ''

  if (!hasNumber && !hasEmail) {
    error.value = 'Please enter a mobile number or an email address.'
    return
  }
  if (hasNumber && number.value.replace(/\D/g, '').length < 10) {
    error.value = 'Please enter a valid 10-digit mobile number.'
    return
  }
  if (hasEmail && !EMAIL_RE.test(email.value.trim())) {
    error.value = 'Please enter a valid email address.'
    return
  }

  sending.value = true
  try {
    const result = await inviteFriend({
      countryCode: countryCode.value,
      phone: hasNumber ? number.value.replace(/\D/g, '') : undefined,
      email: hasEmail ? email.value.trim() : undefined
    })

    if (result.outcome === 'sent') {
      pushToast({ tone: 'success', title: 'Invitation sent', message: result.message })
      reset()
      return
    }
    if (result.outcome === 'already_registered') {
      registeredUser.value = result.user
      registeredStatus.value = result.friendStatus
      return
    }
    // blocked — soft business rejection, show inline.
    error.value = result.message
  } catch (err) {
    pushToast({
      tone: 'warning',
      title: 'Could not send invite',
      message: err instanceof Error ? err.message : 'Please try again later.'
    })
  } finally {
    sending.value = false
  }
}

function close() {
  closeInviteModal()
}
</script>

<template>
  <SlideModal
    :model-value="isOpen"
    title="Invite Friend to join Who I Follow"
    subtitle="Let's invite your friends."
    @update:model-value="(v) => (v ? null : close())"
  >
    <section class="invite-friend__panel">
      <!-- Already-registered result card -->
      <div v-if="registeredUser" class="invite-friend__found">
        <TeamAvatar :name="registeredUser.name" :image-url="registeredUser.avatarUrl ?? undefined" size="md" />
        <div class="invite-friend__found-copy">
          <span class="invite-friend__found-name">{{ registeredUser.name }}</span>
          <span class="invite-friend__found-status">{{ friendStatusLabel }}</span>
        </div>
      </div>

      <template v-else>
        <div class="invite-friend__contact-row">
          <div class="floating-input invite-friend__code">
            <select id="invite-friend-code" v-model="countryCode" class="floating-input__control floating-input__control--select">
              <option v-for="c in COUNTRY_CODES" :key="c.value" :value="c.value">{{ c.label }}</option>
            </select>
            <label for="invite-friend-code" class="floating-input__label floating-input__label--floated">Country Code</label>
          </div>
          <div class="floating-input invite-friend__number">
            <input
              id="invite-friend-number"
              :value="number"
              type="tel"
              inputmode="numeric"
              class="floating-input__control"
              placeholder=" "
              @input="onNumberInput"
            />
            <label for="invite-friend-number" class="floating-input__label">Number</label>
          </div>
        </div>

        <div class="invite-friend__or"><span>OR</span></div>

        <div class="floating-input">
          <input id="invite-friend-email" v-model="email" type="email" class="floating-input__control" placeholder=" " autocomplete="email" />
          <label for="invite-friend-email" class="floating-input__label">Email</label>
        </div>

        <p v-if="error" class="invite-friend__error">{{ error }}</p>
      </template>
    </section>

    <template #footer>
      <button type="button" class="secondary-button" @click="close">
        {{ registeredUser ? 'Done' : 'Close' }}
      </button>
      <button
        v-if="!registeredUser"
        type="button"
        class="primary-button"
        :disabled="sending"
        @click="send"
      >
        <span v-if="sending" class="btn-spinner" aria-hidden="true"></span>
        {{ sending ? 'Sending…' : 'Send Invite' }}
      </button>
    </template>
  </SlideModal>
</template>

<style scoped>
.invite-friend__panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.invite-friend__contact-row {
  display: grid;
  grid-template-columns: minmax(120px, 0.6fr) 1fr;
  gap: 12px;
}
.invite-friend__or {
  display: flex;
  align-items: center;
  text-align: center;
  color: var(--text-light, #787f8d);
  font-size: 0.78rem;
  font-weight: 400;
}
.invite-friend__or::before,
.invite-friend__or::after {
  content: '';
  flex: 1 1 auto;
  height: 1px;
  background: var(--border-divider, rgba(207, 220, 234, 0.85));
}
.invite-friend__or span {
  padding: 0 12px;
}
.invite-friend__error {
  margin: 0;
  color: #c1413a;
  font-size: 0.82rem;
  font-weight: 400;
}

/* Already-registered card */
.invite-friend__found {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
  background: var(--surface-pill, rgba(248, 250, 253, 0.94));
}
.invite-friend__found-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.invite-friend__found-name {
  color: var(--text, #2e3137);
  font-size: 0.95rem;
  font-weight: 600;
}
.invite-friend__found-status {
  color: var(--text-light, #787f8d);
  font-size: 0.82rem;
  font-weight: 400;
}
</style>
