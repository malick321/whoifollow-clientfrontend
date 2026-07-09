<script setup lang="ts">
// AddTeamModal
// ------------
// Slide-over "Add Team" form — the new-frontend rebuild of the legacy
// chat/NewTeam.vue. Same fields + flow (Work/Sports toggle, Team Name, logo
// upload, City/State, Sport Type, gender, Age Group, friend multi-select,
// Continue) but rendered with the colleague's SlideModal + floating-input /
// segmented-button / footer-button vocabulary (matching RegisterTeamModal),
// not the legacy Bootstrap-Vue styling.
//
// On Continue → createTeam(payload) → emits `created` with the new
// conversation so ChatView can open it.

import { computed, ref, watch } from 'vue'
import SlideModal from '../SlideModal.vue'
import TeamAvatar from '../TeamAvatar.vue'
import AppIcon from '../AppIcon.vue'
import { fetchSportTypes } from '../../api/sportTypes'
import { fetchAgeGroups } from '../../api/ageRatingCatalogue'
import { fetchFriends, type ChatFriend } from '../../api/friends'
import { fetchPlaceById, searchPlacePredictions } from '../../api/placesLookup'
import googleG from '../../assets/google-g.svg'
import {
  createTeam,
  type ChatConversation,
  type ChatTeamCategory,
  type ChatTeamGender,
  type CreateTeamPayload
} from '../../api/chat'
import { pushToast } from '../../toast-center'
import type { SportType, AgeGroupOption, PlacePrediction } from '../../types'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'created', conversation: ChatConversation | null): void
}>()

// ── Form state ───────────────────────────────────────────────────
const CATEGORY_OPTIONS: { value: ChatTeamCategory; label: string }[] = [
  { value: 'work', label: 'Work' },
  { value: 'sports', label: 'Sports' }
]
const GENDER_OPTIONS: { value: ChatTeamGender; label: string }[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'coed', label: 'Coed' }
]

const teamName = ref('')
const category = ref<ChatTeamCategory>('sports')
const sportsTypeId = ref('')
const city = ref('')
const state = ref('')
const gender = ref<ChatTeamGender | ''>('')
const ageGroupId = ref('')
const logoFile = ref<File | null>(null)
const logoPreview = ref<string | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

const isSports = computed(() => category.value === 'sports')

// ── City / State via Google Places (themed field, not a separate box) ────
// The single City/State floating-input IS the search — exactly the colleague's
// RegisterTeamModal pattern: the user types, picks a prediction, and we read
// back the locality + two-letter state so the value is never mistyped. Typing
// again clears the resolved pair, forcing a fresh pick so the submitted
// city/state always match a real place.
const cityStateQuery = ref('')
const cityPredictions = ref<PlacePrediction[]>([])
const cityOpen = ref(false)
const citySearching = ref(false)
let cityDebounce: ReturnType<typeof setTimeout> | null = null
let citySeq = 0

function onCityInput() {
  cityOpen.value = true
  city.value = ''
  state.value = ''
  if (cityDebounce) clearTimeout(cityDebounce)
  const q = cityStateQuery.value.trim()
  if (q.length < 2) {
    cityPredictions.value = []
    citySearching.value = false
    return
  }
  citySearching.value = true
  const seq = ++citySeq
  cityDebounce = setTimeout(() => {
    void searchPlacePredictions(q).then((rows) => {
      if (seq !== citySeq) return
      cityPredictions.value = rows
      citySearching.value = false
    })
  }, 250)
}
async function pickPlace(p: PlacePrediction) {
  cityOpen.value = false
  cityPredictions.value = []
  const place = await fetchPlaceById(p.placeId)
  if (!place) return
  city.value = place.city || ''
  state.value = place.state || ''
  cityStateQuery.value =
    place.formattedAddress ||
    (city.value && state.value ? `${city.value}, ${state.value}` : (place.city || p.primaryText))
}

// ── Catalogues ───────────────────────────────────────────────────
const sportTypes = ref<SportType[]>([])
const ageGroups = ref<AgeGroupOption[]>([])

// ── Friends picker ───────────────────────────────────────────────
const friendQuery = ref('')
const friendResults = ref<ChatFriend[]>([])
const selectedFriends = ref<ChatFriend[]>([])
const friendsLoading = ref(false)
const friendsOpen = ref(false)
let friendDebounce: ReturnType<typeof setTimeout> | null = null

const filteredFriendResults = computed(() => {
  const takenChatIds = new Set(selectedFriends.value.map((f) => f.userChatId))
  const takenUserIds = new Set(selectedFriends.value.map((f) => f.userId).filter(Boolean))
  return friendResults.value.filter((f) =>
    !takenChatIds.has(f.userChatId) && !(f.userId && takenUserIds.has(f.userId))
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

// ── Logo upload ──────────────────────────────────────────────────
function openFilePicker() {
  fileInputRef.value?.click()
}

function onLogoChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (!/\.(jpe?g|png|gif)$/i.test(file.name)) {
    pushToast({
      tone: 'warning',
      title: 'Unsupported file',
      message: 'Please upload a .jpg, .jpeg, .png or .gif image.'
    })
    input.value = ''
    return
  }
  logoFile.value = file
  if (logoPreview.value) URL.revokeObjectURL(logoPreview.value)
  logoPreview.value = URL.createObjectURL(file)
}

// ── Validation ───────────────────────────────────────────────────
const showErrors = ref(false)
const errors = computed(() => {
  const e = new Set<string>()
  if (!teamName.value.trim()) e.add('teamName')
  if (!category.value) e.add('category')
  if (isSports.value) {
    if (!sportsTypeId.value) e.add('sportsType')
    if (!ageGroupId.value) e.add('ageGroup')
    if (!gender.value) e.add('gender')
  }
  return e
})
function err(field: string): boolean {
  return showErrors.value && errors.value.has(field)
}
const canSubmit = computed(() => errors.value.size === 0)

// ── Lifecycle ────────────────────────────────────────────────────
function reset() {
  teamName.value = ''
  category.value = 'sports'
  sportsTypeId.value = ''
  city.value = ''
  state.value = ''
  cityStateQuery.value = ''
  cityPredictions.value = []
  cityOpen.value = false
  gender.value = ''
  ageGroupId.value = ''
  logoFile.value = null
  if (logoPreview.value) URL.revokeObjectURL(logoPreview.value)
  logoPreview.value = null
  if (fileInputRef.value) fileInputRef.value.value = ''
  friendQuery.value = ''
  friendResults.value = []
  selectedFriends.value = []
  friendsOpen.value = false
  showErrors.value = false
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    reset()
    if (!sportTypes.value.length) void fetchSportTypes().then((rows) => (sportTypes.value = rows))
    if (!ageGroups.value.length) void fetchAgeGroups().then((rows) => (ageGroups.value = rows))
    void loadFriends('')
  }
)

const saving = ref(false)

function close() {
  if (saving.value) return
  emit('update:modelValue', false)
}

async function submit() {
  showErrors.value = true
  if (!canSubmit.value) return
  saving.value = true
  try {
    const sportName = sportTypes.value.find((s) => s.id === sportsTypeId.value)?.name
    const ageName = ageGroups.value.find((a) => a.id === ageGroupId.value)?.name
    const payload: CreateTeamPayload = {
      name: teamName.value.trim(),
      category: category.value,
      memberUserChatIds: selectedFriends.value.map((f) => f.userChatId),
      logo: logoFile.value
    }
    if (city.value.trim()) payload.city = city.value.trim()
    if (state.value.trim()) payload.state = state.value.trim()
    if (isSports.value) {
      payload.sportsTypeId = sportsTypeId.value
      if (gender.value) payload.gender = gender.value
      if (ageName) payload.ageGroup = ageName
    }
    // sportName feeds the optimistic toast only — the backend resolves the id.
    const result = await createTeam(payload)
    emit('created', result.conversation)
    if (result.conversation) {
      pushToast({
        tone: 'success',
        title: 'Team created',
        message: `${result.conversation.title || teamName.value.trim()} is ready.`
      })
    } else {
      pushToast({
        tone: 'success',
        title: 'Team created',
        message: `${teamName.value.trim()}${sportName ? ` · ${sportName}` : ''} has been created.`
      })
    }
    emit('update:modelValue', false)
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not create team',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <SlideModal
    :model-value="modelValue"
    title="Add Team"
    subtitle="Create a team and invite your friends to chat, plan and play together."
    @update:model-value="(v) => emit('update:modelValue', v)"
  >
    <!-- Logo + name -->
    <section class="add-team__section">
      <div class="add-team__logo-row">
        <button type="button" class="add-team__logo" @click="openFilePicker">
          <TeamAvatar
            v-if="logoPreview"
            :name="teamName || 'Team'"
            :image-url="logoPreview"
            size="lg"
          />
          <span v-else class="add-team__logo-empty" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 14.5 16 10 5.5 20.5" />
            </svg>
          </span>
          <span class="add-team__logo-label">{{ logoPreview ? 'Change logo' : 'Upload logo' }}</span>
        </button>
        <div class="add-team__logo-fields">
          <div class="floating-input" :class="{ 'floating-input--invalid': err('teamName') }">
            <input
              id="add-team-name"
              v-model="teamName"
              type="text"
              maxlength="255"
              class="floating-input__control"
              placeholder=" "
            />
            <label for="add-team-name" class="floating-input__label">Team Name</label>
            <span v-if="err('teamName')" class="floating-input__error-corner">Required</span>
          </div>
          <input
            ref="fileInputRef"
            type="file"
            class="add-team__file"
            accept="image/png, image/jpeg, image/gif"
            @change="onLogoChange"
          />
        </div>
      </div>

      <!-- Work / Sports toggle -->
      <div class="add-team__seg" role="radiogroup" aria-label="Team type">
        <button
          v-for="opt in CATEGORY_OPTIONS"
          :key="opt.value"
          type="button"
          class="add-team__seg-btn"
          :class="{ 'add-team__seg-btn--active': category === opt.value }"
          role="radio"
          :aria-checked="category === opt.value ? 'true' : 'false'"
          @click="category = opt.value"
        >{{ opt.label }}</button>
      </div>
    </section>

    <!-- Sports-only division fields -->
    <section v-if="isSports" class="add-team__section">
      <div class="floating-input" :class="{ 'floating-input--invalid': err('sportsType') }">
        <select
          id="add-team-sport"
          v-model="sportsTypeId"
          class="floating-input__control floating-input__control--select"
        >
          <option value="" disabled hidden></option>
          <option v-for="s in sportTypes" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <label
          for="add-team-sport"
          class="floating-input__label"
          :class="{ 'floating-input__label--floated': !!sportsTypeId }"
        >Sport Type</label>
        <span v-if="err('sportsType')" class="floating-input__error-corner">Required</span>
      </div>

      <div class="floating-input" :class="{ 'floating-input--invalid': err('ageGroup') }">
        <select
          id="add-team-age"
          v-model="ageGroupId"
          class="floating-input__control floating-input__control--select"
        >
          <option value="" disabled hidden></option>
          <option v-for="a in ageGroups" :key="a.id" :value="a.id">{{ a.name }}</option>
        </select>
        <label
          for="add-team-age"
          class="floating-input__label"
          :class="{ 'floating-input__label--floated': !!ageGroupId }"
        >Age Group</label>
        <span v-if="err('ageGroup')" class="floating-input__error-corner">Required</span>
      </div>

      <div class="add-team__seg" :class="{ 'add-team__seg--invalid': err('gender') }" role="radiogroup" aria-label="Gender">
        <button
          v-for="opt in GENDER_OPTIONS"
          :key="opt.value"
          type="button"
          class="add-team__seg-btn"
          :class="{ 'add-team__seg-btn--active': gender === opt.value }"
          role="radio"
          :aria-checked="gender === opt.value ? 'true' : 'false'"
          @click="gender = opt.value"
        >{{ opt.label }}</button>
      </div>
    </section>

    <!-- Location (optional) — the themed field itself is a Google Places
         search (type → pick → city + two-letter state are filled), matching
         the colleague's RegisterTeamModal. -->
    <section class="add-team__section">
      <div class="floating-input add-team__search">
        <input
          id="add-team-citystate"
          v-model="cityStateQuery"
          type="text"
          autocomplete="off"
          class="floating-input__control"
          placeholder=" "
          @input="onCityInput"
          @focus="cityOpen = true"
          @blur="cityOpen = false"
        />
        <label for="add-team-citystate" class="floating-input__label">Address, City, State</label>
        <img class="places-google-icon" :src="googleG" alt="" aria-hidden="true" />
        <ul
          v-if="cityOpen && (citySearching || cityStateQuery.trim().length >= 2)"
          class="add-team__suggest"
        >
          <li v-if="citySearching" class="add-team__suggest-row add-team__suggest-row--muted">Searching…</li>
          <li v-else-if="!cityPredictions.length" class="add-team__suggest-row add-team__suggest-row--muted">No matches found.</li>
          <li
            v-for="p in cityPredictions"
            v-else
            :key="p.placeId"
            class="add-team__suggest-row"
            @mousedown.prevent="pickPlace(p)"
          >
            <span class="add-team__suggest-name">{{ p.primaryText }}</span>
            <span v-if="p.secondaryText" class="add-team__suggest-sub">{{ p.secondaryText }}</span>
          </li>
        </ul>
      </div>
    </section>

    <!-- Friends picker -->
    <section class="add-team__section">
      <span class="add-team__field-label">Select your friends</span>

      <div v-if="selectedFriends.length" class="add-team__chips">
        <span v-for="f in selectedFriends" :key="f.userChatId" class="add-team__chip">
          <TeamAvatar :name="f.name" :image-url="f.avatarUrl ?? undefined" size="sm" />
          <span class="add-team__chip-name">{{ f.name }}</span>
          <button type="button" class="add-team__chip-remove" :aria-label="`Remove ${f.name}`" @click="removeFriend(f.userChatId)">
            <AppIcon name="close" :size="12" />
          </button>
        </span>
      </div>

      <div class="add-team__friend-search floating-input">
        <input
          id="add-team-friends"
          v-model="friendQuery"
          type="search"
          class="floating-input__control"
          placeholder=" "
          autocomplete="off"
          @input="onFriendSearch"
          @focus="friendsOpen = true"
        />
        <label for="add-team-friends" class="floating-input__label">Type to search friends</label>
      </div>

      <ul v-if="friendsOpen" class="add-team__friend-list">
        <li v-if="friendsLoading" class="add-team__friend-hint">Searching…</li>
        <li v-else-if="!filteredFriendResults.length" class="add-team__friend-hint">No matching friends.</li>
        <li
          v-for="f in filteredFriendResults"
          v-else
          :key="f.userChatId"
          class="add-team__friend-row"
          @click="addFriend(f)"
        >
          <TeamAvatar :name="f.name" :image-url="f.avatarUrl ?? undefined" size="sm" />
          <span class="add-team__friend-name">{{ f.name }}</span>
          <span class="add-team__friend-add" aria-hidden="true">+</span>
        </li>
      </ul>
    </section>

    <template #footer>
      <button type="button" class="secondary-button" :disabled="saving" @click="close">Cancel</button>
      <button type="button" class="primary-button" :disabled="saving" @click="submit">
        <span v-if="saving" class="btn-spinner" aria-hidden="true"></span>
        {{ saving ? 'Creating…' : 'Continue' }}
      </button>
    </template>
  </SlideModal>
</template>

<style scoped>
.add-team__section {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-bottom: 20px;
  margin-bottom: 20px;
  border-bottom: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
}
.add-team__section:last-of-type {
  border-bottom: none;
  margin-bottom: 0;
}

.add-team__grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

/* Logo + name row */
.add-team__logo-row {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.add-team__logo {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  width: 96px;
  padding: 10px;
  border: 1px dashed var(--border-divider, rgba(207, 220, 234, 0.85));
  border-radius: var(--radius-md, 8px);
  background: var(--surface-raised, rgba(240, 246, 253, 0.65));
  color: var(--text-light, #787f8d);
  cursor: pointer;
  font-family: var(--font-body);
}
.add-team__logo:hover {
  border-color: var(--primary, #2d8cf0);
}
.add-team__logo-empty {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 999px;
  background: var(--surface-card, #fff);
  color: var(--text-light, #787f8d);
}
.add-team__logo-label {
  font-size: 0.74rem;
  font-weight: 400;
}
.add-team__logo-fields {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.add-team__file {
  display: none;
}

/* Segmented control (Work/Sports + gender) */
.add-team__seg {
  position: relative;
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  border-radius: 999px;
  background: var(--surface-pill, rgba(248, 250, 253, 0.94));
  border: 1px solid transparent;
}
.add-team__seg--invalid {
  border-color: #c1413a;
}
.add-team__seg-btn {
  flex: 1 1 0;
  min-height: 34px;
  padding: 0 18px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--text-light, #787f8d);
  font-family: var(--font-body);
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}
.add-team__seg-btn--active {
  background: var(--white, #fff);
  color: var(--secondary, #2f5f98);
  box-shadow: var(--shadow-soft, 0 6px 16px rgba(36, 60, 91, 0.05));
}

/* Friends picker */
.add-team__field-label {
  color: var(--secondary, #2f5f98);
  font-size: 0.82rem;
  font-weight: 500;
}
.add-team__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.add-team__chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px 4px 4px;
  border-radius: 999px;
  background: var(--surface-pill, rgba(248, 250, 253, 0.94));
  border: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
}
.add-team__chip-name {
  font-size: 0.84rem;
  font-weight: 400;
  color: var(--text, #2e3137);
}
.add-team__chip-remove {
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
.add-team__chip-remove:hover {
  background: var(--surface-card, #fff);
  color: var(--text, #2e3137);
}

.add-team__friend-list {
  list-style: none;
  margin: 0;
  padding: 4px;
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
  border-radius: var(--radius-md, 8px);
  background: var(--surface-card, #fff);
}
.add-team__friend-hint {
  padding: 10px 8px;
  color: var(--text-light, #787f8d);
  font-size: 0.84rem;
  font-weight: 400;
}
.add-team__friend-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border-radius: var(--radius-md, 6px);
  cursor: pointer;
}
.add-team__friend-row:hover {
  background: var(--surface-pill, rgba(248, 250, 253, 0.94));
}
.add-team__friend-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text, #2e3137);
  font-size: 0.88rem;
  font-weight: 400;
}
.add-team__friend-add {
  color: var(--primary, #2d8cf0);
  font-size: 1.2rem;
  line-height: 1;
}

/* City / State Google Places search — mirrors RegisterTeamModal's
   `.mg-team-form__search` / `__suggest` (the .places-google-icon itself is a
   global class in styles.css; we just supply the relative box + icon padding
   + the prediction dropdown here). */
.add-team__search {
  position: relative;
}
.add-team__search .floating-input__control {
  padding-right: 40px;
}
.add-team__suggest {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 6px);
  z-index: 40;
  list-style: none;
  margin: 0;
  padding: 6px;
  max-height: 260px;
  overflow-y: auto;
  background: var(--surface-card);
  border: 1px solid var(--border-divider);
  border-radius: 12px;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.22);
}
.add-team__suggest-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 9px 12px;
  border-radius: 8px;
  cursor: pointer;
}
.add-team__suggest-row:hover {
  background: var(--primary-light-3, #eef4fd);
}
.add-team__suggest-row--muted {
  color: var(--secondary);
  font-size: 13px;
  cursor: default;
}
.add-team__suggest-row--muted:hover {
  background: none;
}
.add-team__suggest-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
}
.add-team__suggest-sub {
  font-size: 12px;
  color: var(--secondary);
}
</style>
