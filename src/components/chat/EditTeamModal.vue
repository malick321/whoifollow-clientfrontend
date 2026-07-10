<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import SlideModal from '../SlideModal.vue'
import TeamAvatar from '../TeamAvatar.vue'
import ImageEditorModal from '../ImageEditorModal.vue'
import { fetchAgeGroups } from '../../api/ageRatingCatalogue'
import { fetchPlaceById, searchPlacePredictions } from '../../api/placesLookup'
import { fetchSportTypes } from '../../api/sportTypes'
import googleG from '../../assets/google-g.svg'
import {
  changeTeamLogo,
  editTeamDetails,
  type ChatTeamCategory,
  type ChatTeamDetail,
  type ChatTeamGender
} from '../../api/chat'
import { pushToast } from '../../toast-center'
import type { AgeGroupOption, PlacePrediction, SportType } from '../../types'

const props = defineProps<{
  modelValue: boolean
  teamId: string
  detail: ChatTeamDetail | null
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'saved'): void
}>()

const name = ref('')
const category = ref<ChatTeamCategory>('sports')
const sportTypeId = ref('')
const city = ref('')
const state = ref('')
const cityStateQuery = ref('')
const gender = ref<ChatTeamGender | ''>('')
const ageGroup = ref('')
const logoFile = ref<File | null>(null)
const logoPreview = ref<string | null>(null)
const logoEditorOpen = ref(false)
const sportTypes = ref<SportType[]>([])
const ageGroups = ref<AgeGroupOption[]>([])
const saving = ref(false)
const showErrors = ref(false)

const cityPredictions = ref<PlacePrediction[]>([])
const cityOpen = ref(false)
const citySearching = ref(false)
let cityDebounce: ReturnType<typeof setTimeout> | null = null
let citySeq = 0

const isSports = computed(() => category.value === 'sports')
const canSave = computed(() => name.value.trim().length > 0)
const currentLogo = computed(() => logoPreview.value || props.detail?.logoUrl || null)

function dataUrlToFile(dataUrl: string, fileName: string): File {
  const [meta, raw] = dataUrl.split(',')
  const mime = meta.match(/:(.*?);/)?.[1] || 'image/png'
  const binary = atob(raw)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new File([bytes], fileName, { type: mime })
}

function reset() {
  const d = props.detail
  name.value = d?.name ?? ''
  category.value = d?.category === 'work' ? 'work' : 'sports'
  sportTypeId.value = d?.sportTypeId ?? ''
  city.value = d?.city ?? ''
  state.value = d?.state ?? ''
  cityStateQuery.value =
    d?.city && d?.state ? `${d.city}, ${d.state}` : (d?.city ?? '')
  const g = (d?.gender ?? '').toLowerCase()
  gender.value = g === 'male' || g === 'female' || g === 'coed' ? g : ''
  ageGroup.value = d?.ageGroup ?? ''
  logoFile.value = null
  logoPreview.value = null
  cityPredictions.value = []
  cityOpen.value = false
  citySearching.value = false
  showErrors.value = false
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    reset()
    if (!sportTypes.value.length) void fetchSportTypes().then((rows) => (sportTypes.value = rows))
    if (!ageGroups.value.length) void fetchAgeGroups().then((rows) => (ageGroups.value = rows))
  }
)

function close() {
  if (!saving.value) emit('update:modelValue', false)
}

function openImageEditor() {
  logoEditorOpen.value = true
}

function onLogoSaved(dataUrl: string) {
  logoPreview.value = dataUrl
  logoFile.value = dataUrlToFile(dataUrl, 'team-logo.png')
}

function clearPendingLogo() {
  logoPreview.value = null
  logoFile.value = null
}

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
    void searchPlacePredictions(q, { types: ['(cities)'] }).then((rows) => {
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
  cityStateQuery.value = city.value && state.value
    ? `${city.value}, ${state.value}`
    : (place.city || p.primaryText)
}

async function save() {
  showErrors.value = true
  if (!canSave.value || !props.teamId) return
  saving.value = true
  try {
    if (logoFile.value) await changeTeamLogo(props.teamId, logoFile.value)
    await editTeamDetails(props.teamId, {
      name: name.value.trim(),
      category: category.value,
      city: city.value.trim(),
      state: state.value.trim(),
      sportsTypeId: isSports.value ? sportTypeId.value : undefined,
      ageGroup: isSports.value ? ageGroup.value : undefined,
      gender: isSports.value && gender.value ? gender.value : undefined
    })
    pushToast({ tone: 'success', title: 'Team updated', message: 'Team details were saved.' })
    emit('saved')
    emit('update:modelValue', false)
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not save team',
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
    title="Edit Team"
    subtitle="Update the team logo, details, and sport profile."
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="edit-team">
      <section class="edit-team__logo-row">
        <button type="button" class="edit-team__logo" @click="openImageEditor">
          <TeamAvatar
            v-if="currentLogo"
            :name="name || detail?.name || 'Team'"
            :image-url="currentLogo"
            size="lg"
          />
          <span v-else class="edit-team__logo-empty" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 14.5 16 10 5.5 20.5" />
            </svg>
          </span>
          <span class="edit-team__logo-label">{{ currentLogo ? 'Change logo' : 'Upload logo' }}</span>
        </button>

        <div class="edit-team__logo-fields">
          <div class="floating-input" :class="{ 'floating-input--invalid': showErrors && !canSave }">
            <input
              id="edit-team-name"
              v-model="name"
              class="floating-input__control"
              :class="{ 'floating-input__control--has-value': !!name }"
              maxlength="255"
              placeholder=" "
            />
            <label for="edit-team-name" class="floating-input__label">Team Name</label>
            <span v-if="showErrors && !canSave" class="floating-input__error-corner">Required</span>
          </div>

          <div class="floating-input edit-team__search">
            <input
              id="edit-team-citystate"
              v-model="cityStateQuery"
              type="text"
              autocomplete="off"
              class="floating-input__control"
              :class="{ 'floating-input__control--has-value': !!cityStateQuery }"
              placeholder=" "
              @input="onCityInput"
              @focus="cityOpen = true"
              @blur="cityOpen = false"
            />
            <label for="edit-team-citystate" class="floating-input__label">City, State</label>
            <img class="places-google-icon" :src="googleG" alt="" aria-hidden="true" />
            <ul
              v-if="cityOpen && (citySearching || cityStateQuery.trim().length >= 2)"
              class="edit-team__suggest"
            >
              <li v-if="citySearching" class="edit-team__suggest-row edit-team__suggest-row--muted">Searching...</li>
              <li v-else-if="!cityPredictions.length" class="edit-team__suggest-row edit-team__suggest-row--muted">No matches found.</li>
              <li
                v-for="p in cityPredictions"
                v-else
                :key="p.placeId"
                class="edit-team__suggest-row"
                @mousedown.prevent="pickPlace(p)"
              >
                <span class="edit-team__suggest-name">{{ p.primaryText }}</span>
                <span v-if="p.secondaryText" class="edit-team__suggest-sub">{{ p.secondaryText }}</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <div class="edit-team__segment" role="radiogroup" aria-label="Team category">
        <button type="button" :class="{ 'is-active': category === 'sports' }" @click="category = 'sports'">Sports</button>
        <button type="button" :class="{ 'is-active': category === 'work' }" @click="category = 'work'">Work</button>
      </div>

      <template v-if="isSports">
        <div class="edit-team__grid edit-team__grid--sport">
          <div class="edit-team__segment edit-team__segment--inline" role="radiogroup" aria-label="Gender">
            <button type="button" :class="{ 'is-active': gender === 'male' }" @click="gender = 'male'">Male</button>
            <button type="button" :class="{ 'is-active': gender === 'female' }" @click="gender = 'female'">Female</button>
            <button type="button" :class="{ 'is-active': gender === 'coed' }" @click="gender = 'coed'">Coed</button>
          </div>

          <div class="floating-input">
            <select id="edit-team-sport" v-model="sportTypeId" class="floating-input__control floating-input__control--select">
              <option value="" disabled hidden></option>
              <option v-if="sportTypeId && !sportTypes.some((s) => s.id === sportTypeId)" :value="sportTypeId">{{ sportTypeId }}</option>
              <option v-for="sport in sportTypes" :key="sport.id" :value="sport.id">{{ sport.name }}</option>
            </select>
            <label
              for="edit-team-sport"
              class="floating-input__label"
              :class="{ 'floating-input__label--floated': !!sportTypeId }"
            >Sport Type</label>
          </div>
        </div>

        <div class="floating-input">
          <select id="edit-team-age" v-model="ageGroup" class="floating-input__control floating-input__control--select">
            <option value="" disabled hidden></option>
            <option v-if="ageGroup && !ageGroups.some((a) => a.name === ageGroup)" :value="ageGroup">{{ ageGroup }}</option>
            <option v-for="age in ageGroups" :key="age.id" :value="age.name">{{ age.name }}</option>
          </select>
          <label
            for="edit-team-age"
            class="floating-input__label"
            :class="{ 'floating-input__label--floated': !!ageGroup }"
          >Age Group</label>
        </div>
      </template>
    </div>

    <template #footer>
      <button type="button" class="secondary-button" :disabled="saving" @click="close">Cancel</button>
      <button type="button" class="primary-button" :disabled="saving" @click="save">
        {{ saving ? 'Saving...' : 'Save changes' }}
      </button>
    </template>
  </SlideModal>

  <ImageEditorModal
    v-model="logoEditorOpen"
    mode="avatar"
    title="Edit team logo"
    :initial-url="currentLogo || ''"
    @save="onLogoSaved"
    @remove="clearPendingLogo"
  />
</template>

<style scoped>
.edit-team {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.edit-team__logo-row {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.edit-team__logo {
  flex: 0 0 92px;
  min-height: 112px;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px dashed var(--border-divider);
  border-radius: var(--radius-md, 8px);
  background: var(--surface-card);
  color: var(--secondary);
  cursor: pointer;
}

.edit-team__logo:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.edit-team__logo-empty {
  width: 56px;
  height: 56px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--surface-pill);
}

.edit-team__logo-label {
  font-size: 0.76rem;
  font-weight: 600;
}

.edit-team__logo-fields {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.edit-team__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.edit-team__grid--sport {
  align-items: stretch;
}

.edit-team__segment {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border: 1px solid var(--border-divider);
  border-radius: var(--radius-md, 8px);
  background: var(--surface-raised);
  overflow: hidden;
}

.edit-team__segment--inline {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.edit-team__segment button {
  min-height: 38px;
  border: none;
  border-right: 1px solid var(--border-divider);
  background: transparent;
  color: var(--secondary);
  font: inherit;
  font-size: 0.84rem;
  cursor: pointer;
}

.edit-team__segment button:last-child {
  border-right: none;
}

.edit-team__segment button.is-active {
  background: var(--surface-card);
  color: var(--primary);
  box-shadow: inset 0 0 0 1px var(--primary);
}

.edit-team__search {
  position: relative;
}

.edit-team__search .floating-input__control {
  padding-right: 38px;
}

.edit-team__suggest {
  position: absolute;
  z-index: 45;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 220px;
  margin: 0;
  padding: 6px;
  list-style: none;
  overflow-y: auto;
  border: 1px solid var(--border-divider);
  border-radius: var(--radius-md, 8px);
  background: var(--surface-card);
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.18);
}

.edit-team__suggest-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 6px;
  color: var(--text);
  cursor: pointer;
}

.edit-team__suggest-row:hover {
  background: var(--surface-pill);
  color: var(--primary);
}

.edit-team__suggest-row--muted,
.edit-team__suggest-row--muted:hover {
  color: var(--text-light);
  background: transparent;
  cursor: default;
}

.edit-team__suggest-name {
  font-size: 0.84rem;
  font-weight: 600;
}

.edit-team__suggest-sub {
  font-size: 0.74rem;
  color: var(--text-light);
}

@media (max-width: 620px) {
  .edit-team__logo-row,
  .edit-team__grid {
    grid-template-columns: 1fr;
  }

  .edit-team__logo-row {
    flex-direction: column;
  }

  .edit-team__logo {
    flex-basis: auto;
    width: 100%;
    min-height: 96px;
  }
}
</style>
