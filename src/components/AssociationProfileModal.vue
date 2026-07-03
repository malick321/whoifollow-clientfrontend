<script setup lang="ts">
// AssociationProfileModal
// -----------------------
// Slide-in modal for self-editing the association's profile from
// the Settings page. Mirrors the editable subset of the
// `associations` MySQL table — identifiers (username, short_name),
// audit timestamps, computed coords, and admin-controlled flags
// (status, stripe_connected, deleted_at) are intentionally
// omitted because admins shouldn't be able to mutate platform-
// managed values from a self-service screen.

import { computed, ref, watch } from 'vue'
import ImageEditorModal from './ImageEditorModal.vue'
import SlideModal from './SlideModal.vue'
import PhoneInput from './PhoneInput.vue'
import googleG from '../assets/google-g.svg'
import { fetchAssociationProfile, saveAssociationProfile } from '../api/associationProfile'
import { searchPlacePredictions, fetchPlaceById } from '../api/placesLookup'
import { pushToast } from '../toast-center'
import type { AssociationProfile, PlacePrediction } from '../types'

const props = defineProps<{
  modelValue: boolean
  associationId: string
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'saved', profile: AssociationProfile): void
}>()

const loading = ref(false)
const saving = ref(false)
const submitAttempted = ref(false)

// Form fields — every value is a string ref so the floating-label
// `:placeholder-shown` check works uniformly across inputs.
const logoUrl = ref('')
const coverUrl = ref('')
const associationName = ref('')
const websiteUrl = ref('')
const email = ref('')
const mobileCode = ref('+1')
const mobileNumber = ref('')
const fbUrl = ref('')
const instaUrl = ref('')
const streetAddress = ref('')
const city = ref('')
const state = ref('')
const zipCode = ref('')
// Coordinates from the Places pick — submitted as-is (not geocoded server-side).
const lat = ref('')
const long = ref('')
const notes = ref('')

// Street address = Google Places autocomplete. Typing searches; picking a
// suggestion fills street + city + state + zip. (Same lookup the team wizard
// uses for city/state.)
const addressPredictions = ref<PlacePrediction[]>([])
const addressOpen = ref(false)
const addressSearching = ref(false)
let addressDebounce: ReturnType<typeof setTimeout> | null = null
let addressSeq = 0

function onStreetInput() {
  addressOpen.value = true
  // Manual typing invalidates the picked coordinates — re-pick to set them.
  lat.value = ''
  long.value = ''
  if (addressDebounce) clearTimeout(addressDebounce)
  const q = streetAddress.value.trim()
  if (q.length < 3) { addressPredictions.value = []; addressSearching.value = false; return }
  addressSearching.value = true
  const seq = ++addressSeq
  addressDebounce = setTimeout(() => {
    // No type filter — broad predictions (street addresses + establishments) so
    // the admin can type any street address, not just a city/state.
    void searchPlacePredictions(q).then((rows) => {
      if (seq !== addressSeq) return
      addressPredictions.value = rows
      addressSearching.value = false
    })
  }, 250)
}

async function pickAddress(p: PlacePrediction) {
  addressOpen.value = false
  addressPredictions.value = []
  const place = await fetchPlaceById(p.placeId)
  if (!place) return
  // Prefer the parsed street; fall back to the prediction's primary text.
  streetAddress.value = place.street || p.primaryText
  city.value = place.city || ''
  state.value = place.state || ''
  zipCode.value = place.postalCode || ''
  lat.value = place.position ? String(place.position.lat) : ''
  long.value = place.position ? String(place.position.lng) : ''
}

// Image editor — opens a centered popup for picking + cropping
// the cover photo or the logo / avatar. The same editor handles
// both via a `mode` prop; this modal tracks which slot is being
// edited so the save event lands in the right field.
const imageEditorOpen = ref(false)
const imageEditorMode = ref<'avatar' | 'cover'>('avatar')

function openLogoEditor() {
  imageEditorMode.value = 'avatar'
  imageEditorOpen.value = true
}

function openCoverEditor() {
  imageEditorMode.value = 'cover'
  imageEditorOpen.value = true
}

function onImageSaved(dataUrl: string) {
  if (imageEditorMode.value === 'avatar') {
    logoUrl.value = dataUrl
  } else {
    coverUrl.value = dataUrl
  }
}

const editorInitialUrl = computed(() =>
  imageEditorMode.value === 'avatar' ? logoUrl.value : coverUrl.value
)

const editorTitle = computed(() =>
  imageEditorMode.value === 'avatar' ? 'Edit logo' : 'Edit cover photo'
)

/** First letter of the association name (or "A" fallback) used as
 *  the avatar placeholder when no logo has been uploaded yet. */
const avatarInitial = computed(() => {
  const trimmed = associationName.value.trim()
  if (!trimmed) return 'A'
  const match = trimmed.match(/[A-Za-z]/)
  return match ? match[0].toUpperCase() : 'A'
})

function hydrate(profile: AssociationProfile) {
  logoUrl.value = profile.logoUrl
  coverUrl.value = profile.coverUrl
  associationName.value = profile.associationName
  websiteUrl.value = profile.websiteUrl
  email.value = profile.email
  mobileCode.value = profile.mobileCode || '+1'
  mobileNumber.value = profile.mobileNumber
  fbUrl.value = profile.fbUrl
  instaUrl.value = profile.instaUrl
  streetAddress.value = profile.streetAddress
  city.value = profile.city
  state.value = profile.state
  zipCode.value = profile.zipCode
  lat.value = profile.lat ?? ''
  long.value = profile.long ?? ''
  notes.value = profile.notes
}

async function load() {
  loading.value = true
  submitAttempted.value = false
  try {
    const fetched = await fetchAssociationProfile(props.associationId)
    hydrate(fetched)
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not load profile',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.modelValue, props.associationId] as const,
  ([open]) => {
    if (open) void load()
  }
)

function close() {
  if (saving.value) return
  emit('update:modelValue', false)
}

// Required-field validation. Association name is the one mandatory
// field; everything else is optional metadata.
const requiredErrors = () => {
  const errs = new Set<string>()
  if (!associationName.value.trim()) errs.add('associationName')
  return errs
}

async function save() {
  submitAttempted.value = true
  const errs = requiredErrors()
  if (errs.size > 0) return
  saving.value = true
  try {
    const payload: AssociationProfile = {
      id: props.associationId,
      logoUrl: logoUrl.value.trim(),
      coverUrl: coverUrl.value.trim(),
      associationName: associationName.value.trim(),
      websiteUrl: websiteUrl.value.trim(),
      email: email.value.trim(),
      mobileCode: mobileCode.value,
      mobileNumber: mobileNumber.value.trim(),
      fbUrl: fbUrl.value.trim(),
      instaUrl: instaUrl.value.trim(),
      streetAddress: streetAddress.value.trim(),
      city: city.value.trim(),
      state: state.value,
      zipCode: zipCode.value.trim(),
      lat: lat.value,
      long: long.value,
      notes: notes.value.trim()
    }
    const saved = await saveAssociationProfile(payload)
    emit('saved', saved)
    emit('update:modelValue', false)
    pushToast({
      tone: 'success',
      title: 'Profile updated',
      message: 'The association profile has been saved.'
    })
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not save profile',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    saving.value = false
  }
}

function fieldInvalid(name: string): boolean {
  if (!submitAttempted.value) return false
  return requiredErrors().has(name)
}
</script>

<template>
  <!-- `display: contents` wrapper makes Vue 2 happy (single template
       root) without affecting layout — the SlideModal and the
       ImageEditorModal both render via `position: fixed`, so they
       don't care about a wrapper element. -->
  <div class="profile-modal-root">
  <SlideModal
    :model-value="modelValue"
    title="Edit Association Profile"
    subtitle="Update public profile details for the association."
    @update:modelValue="emit('update:modelValue', $event)"
  >
    <div class="register-team-modal__form association-profile-modal__form">
      <!-- Cover photo (rectangular) with the avatar (circular)
           overlapping its bottom-left corner — half inside the
           cover, half outside, the standard "profile-card" look.
           Both surfaces are clickable AND have a small Edit pill
           overlay; clicking either opens the centered image
           editor in the matching mode. -->
      <div class="profile-image-stack">
        <button
          type="button"
          class="profile-image-stack__cover"
          :class="{ 'profile-image-stack__cover--empty': !coverUrl }"
          aria-label="Edit cover photo"
          @click="openCoverEditor"
        >
          <img
            v-if="coverUrl"
            :src="coverUrl"
            alt=""
            class="profile-image-stack__cover-img"
            aria-hidden="true"
          />
          <span v-else class="profile-image-stack__cover-placeholder">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
            <span>Add cover photo</span>
          </span>
          <span class="profile-image-stack__edit-badge" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
            <span>Edit</span>
          </span>
        </button>

        <button
          type="button"
          class="profile-image-stack__avatar"
          :class="{ 'profile-image-stack__avatar--empty': !logoUrl }"
          aria-label="Edit logo"
          @click.stop="openLogoEditor"
        >
          <img
            v-if="logoUrl"
            :src="logoUrl"
            alt=""
            class="profile-image-stack__avatar-img"
            aria-hidden="true"
          />
          <span v-else class="profile-image-stack__avatar-initial">{{ avatarInitial }}</span>
          <span class="profile-image-stack__edit-badge profile-image-stack__edit-badge--avatar" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
          </span>
        </button>
      </div>

      <!-- Association name (required) -->
      <div
        class="floating-input"
        :class="{ 'floating-input--invalid': fieldInvalid('associationName') }"
      >
        <input
          id="profile-association-name"
          v-model="associationName"
          type="text"
          class="floating-input__control"
          :class="{ 'floating-input__control--has-value': !!associationName }"
          placeholder=" "
        />
        <label for="profile-association-name" class="floating-input__label">Association Name</label>
      </div>
      <span v-if="fieldInvalid('associationName')" class="association-user-modal__error">
        Association name is required.
      </span>

      <!-- Website + Email -->
      <div class="register-team-modal__row">
        <div class="floating-input">
          <input
            id="profile-website"
            v-model="websiteUrl"
            type="url"
            class="floating-input__control"
            :class="{ 'floating-input__control--has-value': !!websiteUrl }"
            placeholder=" "
          />
          <label for="profile-website" class="floating-input__label">Website URL</label>
        </div>
        <div class="floating-input">
          <input
            id="profile-email"
            v-model="email"
            type="email"
            class="floating-input__control"
            :class="{ 'floating-input__control--has-value': !!email }"
            placeholder=" "
          />
          <label for="profile-email" class="floating-input__label">Contact Email</label>
        </div>
      </div>

      <!-- Phone: shared PhoneInput (flag + dial code + masked number) -->
      <PhoneInput
        id="profile-phone"
        v-model:dial-code="mobileCode"
        v-model:number="mobileNumber"
        number-label="Mobile Number"
      />

      <!-- Social links -->
      <div class="register-team-modal__row">
        <div class="floating-input">
          <input
            id="profile-fb-url"
            v-model="fbUrl"
            type="url"
            class="floating-input__control"
            :class="{ 'floating-input__control--has-value': !!fbUrl }"
            placeholder=" "
          />
          <label for="profile-fb-url" class="floating-input__label">Facebook URL</label>
        </div>
        <div class="floating-input">
          <input
            id="profile-insta-url"
            v-model="instaUrl"
            type="url"
            class="floating-input__control"
            :class="{ 'floating-input__control--has-value': !!instaUrl }"
            placeholder=" "
          />
          <label for="profile-insta-url" class="floating-input__label">Instagram URL</label>
        </div>
      </div>

      <!-- Address: street is a Google Places search → fills city/state/zip;
           those stay editable text fields. -->
      <div class="floating-input association-profile-modal__search">
        <input
          id="profile-street"
          v-model="streetAddress"
          type="text"
          autocomplete="off"
          class="floating-input__control"
          :class="{ 'floating-input__control--has-value': !!streetAddress }"
          placeholder=" "
          @input="onStreetInput"
          @focus="addressOpen = true"
          @blur="addressOpen = false"
        />
        <label for="profile-street" class="floating-input__label">Street Address</label>
        <img class="places-google-icon" :src="googleG" alt="" aria-hidden="true" />
        <ul
          v-if="addressOpen && (addressSearching || streetAddress.trim().length >= 3)"
          class="association-profile-modal__suggest"
        >
          <li v-if="addressSearching" class="association-profile-modal__suggest-row association-profile-modal__suggest-row--muted">Searching…</li>
          <li v-else-if="!addressPredictions.length" class="association-profile-modal__suggest-row association-profile-modal__suggest-row--muted">No matches found.</li>
          <li
            v-for="p in addressPredictions"
            v-else
            :key="p.placeId"
            class="association-profile-modal__suggest-row"
            @mousedown.prevent="pickAddress(p)"
          >
            <span class="association-profile-modal__suggest-name">{{ p.primaryText }}</span>
            <span v-if="p.secondaryText" class="association-profile-modal__suggest-sub">{{ p.secondaryText }}</span>
          </li>
        </ul>
      </div>

      <div class="register-team-modal__row association-profile-modal__row--triple">
        <div class="floating-input">
          <input
            id="profile-city"
            v-model="city"
            type="text"
            class="floating-input__control"
            :class="{ 'floating-input__control--has-value': !!city }"
            placeholder=" "
          />
          <label for="profile-city" class="floating-input__label">City</label>
        </div>
        <div class="floating-input">
          <input
            id="profile-state"
            v-model="state"
            type="text"
            class="floating-input__control"
            :class="{ 'floating-input__control--has-value': !!state }"
            placeholder=" "
          />
          <label for="profile-state" class="floating-input__label">State</label>
        </div>
        <div class="floating-input">
          <input
            id="profile-zip"
            v-model="zipCode"
            type="text"
            class="floating-input__control"
            :class="{ 'floating-input__control--has-value': !!zipCode }"
            placeholder=" "
          />
          <label for="profile-zip" class="floating-input__label">ZIP Code</label>
        </div>
      </div>

      <!-- Notes -->
      <div class="floating-input">
        <textarea
          id="profile-notes"
          v-model="notes"
          rows="3"
          class="floating-input__control association-profile-modal__notes"
          :class="{ 'floating-input__control--has-value': !!notes }"
          placeholder=" "
        ></textarea>
        <label for="profile-notes" class="floating-input__label">Notes</label>
      </div>
    </div>

    <template #footer>
      <button
        class="secondary-button"
        type="button"
        :disabled="saving"
        @click="close"
      >Cancel</button>
      <button
        class="ledger-action-button"
        type="button"
        :disabled="saving || loading"
        @click="save"
      >
        <span v-if="saving" class="btn-spinner" aria-hidden="true"></span>
        {{ saving ? 'Saving…' : 'Save Changes' }}
      </button>
    </template>
  </SlideModal>

  <ImageEditorModal
    :model-value="imageEditorOpen"
    :mode="imageEditorMode"
    :title="editorTitle"
    :initial-url="editorInitialUrl"
    @update:modelValue="imageEditorOpen = $event"
    @save="onImageSaved"
    @remove="onImageSaved('')"
  />
  </div>
</template>

<style scoped>
/* Street-address Places autocomplete — anchored dropdown under the field. */
.association-profile-modal__search { position: relative; }
.association-profile-modal__suggest {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 30;
  margin: 0;
  padding: 4px;
  list-style: none;
  max-height: 240px;
  overflow-y: auto;
  background: var(--surface-opaque, #fff);
  border: 1px solid var(--border-divider);
  border-radius: 10px;
  box-shadow: var(--shadow-soft);
}
.association-profile-modal__suggest-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
}
.association-profile-modal__suggest-row:hover { background: rgba(45, 140, 240, 0.08); }
.association-profile-modal__suggest-row--muted { color: var(--secondary); cursor: default; }
.association-profile-modal__suggest-row--muted:hover { background: transparent; }
.association-profile-modal__suggest-name { font-size: 14px; color: var(--text); }
.association-profile-modal__suggest-sub { font-size: 12px; color: var(--secondary); }
</style>
