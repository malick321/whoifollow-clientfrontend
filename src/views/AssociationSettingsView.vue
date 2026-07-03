<script setup lang="ts">
// AssociationSettingsView
// -----------------------
// Settings landing page reachable at
// /association/:associationShortName/portal/settings.
//
// Renders a single card with one row per top-level settings group.
// Each row is a navigation entry — click drills into that group's
// detail view (sub-views are placeholder for now). The Stripe Connect
// row is special:
//   - The Connected / Not Connected status pill sits inline with
//     the row title (instead of in the trailing column).
//   - The trailing column carries a Connect or Disconnect button
//     instead of the chevron.
//   - Disconnect prompts for confirmation before flipping state.
//   - Connect runs a short mock loader so the UX feels real before
//     the actual Stripe Connect onboarding flow ships.

import { computed, onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import AssociationProfileModal from '../components/AssociationProfileModal.vue'
import CustomFieldsManagerModal from '../components/CustomFieldsManagerModal.vue'
import RatingsManagerModal from '../components/RatingsManagerModal.vue'
import RegistrationSettingsModal from '../components/RegistrationSettingsModal.vue'
import AssociationSidebar from '../components/AssociationSidebar.vue'
import StatusBadge from '../components/StatusBadge.vue'
import { lockBodyScroll, unlockBodyScroll } from '../body-scroll-lock'
import { currentAssociation } from '../constants/associations'

interface SettingsRow {
  key: string
  title: string
  description: string
  /** True for the Stripe Connect row — surfaces the connect /
   *  disconnect controls and inlines the connection-state badge
   *  next to the title. */
  showStripeStatus?: boolean
}

const SECTIONS: SettingsRow[] = [
  {
    key: 'profile',
    title: 'Association Profile',
    description: 'Manage core association details such as name, logo, contact information, and public profile settings.'
  },
  {
    key: 'seasons',
    title: 'Seasons & Validity',
    description: 'Manage association seasons and control how long team/player registrations remain valid.'
  },
  {
    key: 'stripe',
    title: 'Stripe Connect Settings',
    description: "Connect and manage Stripe to collect registration payments directly into the association's account.",
    showStripeStatus: true
  },
  {
    key: 'registration',
    title: 'Registration Settings',
    description: 'Configure how teams, umpires and players register — self-registration, fees & payment, and how long a registration stays valid.'
  },
  {
    key: 'ratings',
    title: 'Ratings',
    description: 'Manage the skill tiers for your association\'s registered teams.'
  },
  {
    key: 'custom-fields',
    title: 'Custom Fields',
    description: 'Create extra fields (e.g. classification, flags) that appear on your event, division and game forms.'
  }
]

// Association Profile row title carries the association short name
// ("Acme Profile") instead of the generic "Association Profile"; falls
// back when the short name hasn't loaded yet.
const profileTitle = computed(
  () => `${currentAssociation.value?.shortName || 'Association'} Profile`
)

// Rows that name the association use its short name. Computed so they update
// once the association loads; fall back gracefully until then.
const shortName = computed(() => currentAssociation.value?.shortName || 'your association')
const registrationDescription = computed(
  () => `Configure how teams, umpires and players register with ${shortName.value}.`
)
const stripeDescription = computed(
  () => `Connect Stripe to collect registration payments directly into ${shortName.value}'s account.`
)
const ratingsDescription = computed(
  () => `Manage the skill tiers for ${shortName.value}'s registered teams.`
)

// Stripe Connect — the real connection state comes from the association
// (`currentAssociation.stripeConnected`, returned by my-associations). Seeded
// from it + kept in sync; the mock Connect / Disconnect buttons below still
// flip this local ref until the real OAuth flow ships.
const stripeConnected = ref(currentAssociation.value?.stripeConnected ?? false)
watch(
  () => currentAssociation.value?.stripeConnected,
  (v) => { if (typeof v === 'boolean') stripeConnected.value = v },
  { immediate: true }
)
const stripeConnecting = ref(false)
const disconnectConfirmOpen = ref(false)

// Association Profile edit popup — opens when the admin clicks
// the Association Profile row.
const profileModalOpen = ref(false)
// Custom-fields + ratings manager popups.
const customFieldsModalOpen = ref(false)
const ratingsModalOpen = ref(false)
const registrationSettingsModalOpen = ref(false)

function onRowClick(row: SettingsRow) {
  if (row.key === 'profile') {
    profileModalOpen.value = true
    return
  }
  if (row.key === 'custom-fields') {
    customFieldsModalOpen.value = true
    return
  }
  if (row.key === 'ratings') {
    ratingsModalOpen.value = true
    return
  }
  if (row.key === 'registration') {
    registrationSettingsModalOpen.value = true
    return
  }
  // Other sub-views aren't built yet — placeholder click handler
  // so we can wire navigation when the detail screens land.
}

/** Mock Stripe Connect onboarding — flips the local connected
 *  state after a short delay so the connecting state is visible
 *  long enough to read as a real network step. Replace with the
 *  actual OAuth redirect when the backend lands. */
async function startConnect() {
  if (stripeConnecting.value) return
  stripeConnecting.value = true
  await new Promise((resolve) => setTimeout(resolve, 1600))
  stripeConnected.value = true
  stripeConnecting.value = false
}

function openDisconnectConfirm() {
  disconnectConfirmOpen.value = true
}

function cancelDisconnect() {
  disconnectConfirmOpen.value = false
}

function confirmDisconnect() {
  stripeConnected.value = false
  disconnectConfirmOpen.value = false
}

function onDisconnectBackdrop(event: MouseEvent) {
  if (event.target === event.currentTarget) cancelDisconnect()
}

watch(disconnectConfirmOpen, (open, wasOpen) => {
  if (open && !wasOpen) lockBodyScroll()
  else if (!open && wasOpen) unlockBodyScroll()
})

onBeforeUnmount(() => {
  if (disconnectConfirmOpen.value) unlockBodyScroll()
})
</script>

<template>
  <main class="association-users">
    <AssociationSidebar active-key="settings" />
    <section class="association-users__main">
      <header class="association-settings__header">
        <h1 class="association-settings__title">Settings</h1>
      </header>

      <div class="association-settings__card">
        <template v-for="row in SECTIONS" :key="row.key">
          <!-- Stripe row needs nested interactive controls (the
               Connect / Disconnect button), so it cannot be a
               <button> itself. Render a <div> with a no-op click
               surface and slot the action button into the
               trailing column. -->
          <div
            v-if="row.showStripeStatus"
            class="association-settings__row association-settings__row--stripe"
          >
            <div class="association-settings__row-copy">
              <span class="association-settings__row-heading">
                <strong class="association-settings__row-title">{{ row.title }}</strong>
                <StatusBadge
                  :label="stripeConnected ? 'Connected' : 'Not Connected'"
                  :tone="stripeConnected ? 'success' : 'danger'"
                />
              </span>
              <span class="association-settings__row-description">{{ stripeDescription }}</span>
            </div>
            <div class="association-settings__row-trailing association-settings__row-trailing--stripe">
              <button
                v-if="!stripeConnected"
                type="button"
                class="association-users__invite-btn association-settings__connect-btn"
                :disabled="stripeConnecting"
                @click="startConnect"
              >
                <span
                  v-if="stripeConnecting"
                  class="association-settings__spinner"
                  aria-hidden="true"
                ></span>
                <span>{{ stripeConnecting ? 'Connecting…' : 'Connect' }}</span>
              </button>
              <button
                v-else
                type="button"
                class="danger-light-button association-settings__disconnect-btn"
                @click="openDisconnectConfirm"
              >Disconnect</button>
            </div>
          </div>

          <!-- All other rows are navigation entries — keep them as
               buttons so keyboard / SR semantics stay intact. -->
          <button
            v-else
            type="button"
            class="association-settings__row"
            @click="onRowClick(row)"
          >
            <div class="association-settings__row-copy">
              <strong class="association-settings__row-title">{{ row.key === 'profile' ? profileTitle : row.title }}</strong>
              <span class="association-settings__row-description">{{ row.key === 'registration' ? registrationDescription : row.key === 'ratings' ? ratingsDescription : row.description }}</span>
            </div>
            <div class="association-settings__row-trailing">
              <span class="association-settings__chevron" aria-hidden="true"></span>
            </div>
          </button>
        </template>
      </div>
    </section>

    <AssociationProfileModal
      :model-value="profileModalOpen"
      :association-id="currentAssociation?.slug || ''"
      @update:modelValue="profileModalOpen = $event"
    />

    <CustomFieldsManagerModal
      :model-value="customFieldsModalOpen"
      :association-id="currentAssociation?.id || ''"
      :association-short-name="currentAssociation?.slug || ''"
      @update:modelValue="customFieldsModalOpen = $event"
    />

    <RatingsManagerModal
      :model-value="ratingsModalOpen"
      :association-id="currentAssociation?.id || ''"
      :association-short-name="currentAssociation?.slug || ''"
      @update:modelValue="ratingsModalOpen = $event"
    />

    <RegistrationSettingsModal
      :model-value="registrationSettingsModalOpen"
      :association-id="currentAssociation?.id || ''"
      :association-short-name="currentAssociation?.slug || ''"
      @update:modelValue="registrationSettingsModalOpen = $event"
    />

    <!-- Disconnect confirmation popup — same chrome as the team
         suspend / reject confirms but inline because the copy +
         action are settings-specific and short-lived. -->
    <Transition name="slide-modal-backdrop">
      <div
        v-if="disconnectConfirmOpen"
        class="association-switcher-backdrop"
        role="presentation"
        @click="onDisconnectBackdrop"
      >
        <div
          class="association-switcher-panel association-confirm-panel"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="stripe-disconnect-title"
        >
          <header class="association-switcher-panel__header">
            <h2 id="stripe-disconnect-title" class="association-switcher-panel__title">
              Disconnect Stripe?
            </h2>
            <button
              type="button"
              class="association-switcher-panel__close"
              aria-label="Close"
              @click="cancelDisconnect"
            >
              <AppIcon name="close" :size="16" />
            </button>
          </header>
          <div class="association-confirm-panel__body">
            <p class="association-confirm-panel__copy">
              Disconnecting Stripe will stop the association from collecting new
              registration payments online until it's reconnected. Existing
              transactions and payment history are preserved.
            </p>
          </div>
          <footer class="association-confirm-panel__footer">
            <button class="secondary-button" type="button" @click="cancelDisconnect">Cancel</button>
            <button class="danger-light-button" type="button" @click="confirmDisconnect">
              Yes, Disconnect
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </main>
</template>
