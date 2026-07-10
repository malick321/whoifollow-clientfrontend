<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import SlideModal from '../SlideModal.vue'
import TeamAvatar from '../TeamAvatar.vue'
import AppIcon from '../AppIcon.vue'
import { fetchAgeGroups } from '../../api/ageRatingCatalogue'
import { fetchSportTypes } from '../../api/sportTypes'
import {
  changeTeamLogo,
  editTeamDetails,
  type ChatTeamCategory,
  type ChatTeamDetail,
  type ChatTeamGender
} from '../../api/chat'
import { pushToast } from '../../toast-center'
import type { AgeGroupOption, SportType } from '../../types'

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
const gender = ref<ChatTeamGender | ''>('')
const ageGroup = ref('')
const logoFile = ref<File | null>(null)
const logoPreview = ref<string | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const sportTypes = ref<SportType[]>([])
const ageGroups = ref<AgeGroupOption[]>([])
const saving = ref(false)
const showErrors = ref(false)

const isSports = computed(() => category.value === 'sports')
const canSave = computed(() => name.value.trim().length > 0)
const currentLogo = computed(() => logoPreview.value || props.detail?.logoUrl || null)

function reset() {
  const d = props.detail
  name.value = d?.name ?? ''
  category.value = (d?.category === 'work' ? 'work' : 'sports')
  sportTypeId.value = d?.sportTypeId ?? ''
  city.value = d?.city ?? ''
  state.value = d?.state ?? ''
  const g = (d?.gender ?? '').toLowerCase()
  gender.value = g === 'male' || g === 'female' || g === 'coed' ? g : ''
  ageGroup.value = d?.ageGroup ?? ''
  logoFile.value = null
  if (logoPreview.value) URL.revokeObjectURL(logoPreview.value)
  logoPreview.value = null
  if (fileInputRef.value) fileInputRef.value.value = ''
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

function openFilePicker() {
  fileInputRef.value?.click()
}

function onLogoChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (!/\.(jpe?g|png|gif)$/i.test(file.name)) {
    pushToast({ tone: 'warning', title: 'Unsupported file', message: 'Use a .jpg, .png or .gif image.' })
    input.value = ''
    return
  }
  logoFile.value = file
  if (logoPreview.value) URL.revokeObjectURL(logoPreview.value)
  logoPreview.value = URL.createObjectURL(file)
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
      <div class="edit-team__logo">
        <TeamAvatar :name="name || detail?.name || 'Team'" :image-url="currentLogo ?? undefined" size="lg" />
        <input ref="fileInputRef" type="file" accept="image/png,image/jpeg,image/gif" hidden @change="onLogoChange" />
        <button type="button" class="secondary-button" @click="openFilePicker">
          <AppIcon name="folder" :size="15" />
          <span>Change Logo</span>
        </button>
      </div>

      <div class="floating-input">
        <input id="edit-team-name" v-model="name" class="floating-input__control" placeholder=" " />
        <label for="edit-team-name" class="floating-input__label">Team Name</label>
      </div>
      <p v-if="showErrors && !canSave" class="edit-team__error">Team name is required.</p>

      <div class="edit-team__segment" role="radiogroup" aria-label="Team category">
        <button type="button" :class="{ 'is-active': category === 'sports' }" @click="category = 'sports'">Sports</button>
        <button type="button" :class="{ 'is-active': category === 'work' }" @click="category = 'work'">Work</button>
      </div>

      <div class="edit-team__grid">
        <div class="floating-input">
          <input id="edit-team-city" v-model="city" class="floating-input__control" placeholder=" " />
          <label for="edit-team-city" class="floating-input__label">City</label>
        </div>
        <div class="floating-input">
          <input id="edit-team-state" v-model="state" class="floating-input__control" placeholder=" " />
          <label for="edit-team-state" class="floating-input__label">State</label>
        </div>
      </div>

      <template v-if="isSports">
        <div class="floating-input">
          <select id="edit-team-sport" v-model="sportTypeId" class="floating-input__control floating-input__control--select">
            <option value="">Sport Type</option>
            <option v-if="sportTypeId && !sportTypes.some((s) => s.id === sportTypeId)" :value="sportTypeId">{{ sportTypeId }}</option>
            <option v-for="sport in sportTypes" :key="sport.id" :value="sport.id">{{ sport.name }}</option>
          </select>
          <label for="edit-team-sport" class="floating-input__label floating-input__label--floated">Sport Type</label>
        </div>

        <div class="edit-team__grid">
          <div class="floating-input">
            <select id="edit-team-age" v-model="ageGroup" class="floating-input__control floating-input__control--select">
              <option value="">Age Group</option>
              <option v-if="ageGroup && !ageGroups.some((a) => a.name === ageGroup)" :value="ageGroup">{{ ageGroup }}</option>
              <option v-for="age in ageGroups" :key="age.id" :value="age.name">{{ age.name }}</option>
            </select>
            <label for="edit-team-age" class="floating-input__label floating-input__label--floated">Age Group</label>
          </div>
          <div class="floating-input">
            <select id="edit-team-gender" v-model="gender" class="floating-input__control floating-input__control--select">
              <option value="">Gender</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="coed">Coed</option>
            </select>
            <label for="edit-team-gender" class="floating-input__label floating-input__label--floated">Gender</label>
          </div>
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
</template>

<style scoped>
.edit-team {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.edit-team__logo {
  display: flex;
  align-items: center;
  gap: 12px;
}
.edit-team__logo .secondary-button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.edit-team__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.edit-team__segment {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  padding: 4px;
  border: 1px solid var(--border-divider);
  border-radius: var(--radius-md, 6px);
  background: var(--surface-raised);
}
.edit-team__segment button {
  min-height: 34px;
  border: none;
  border-radius: var(--radius-md, 5px);
  background: transparent;
  color: var(--secondary);
  font: inherit;
  font-size: 0.84rem;
  cursor: pointer;
}
.edit-team__segment button.is-active {
  background: var(--surface-card);
  color: var(--primary);
  box-shadow: var(--shadow-soft);
}
.edit-team__error {
  margin: -8px 0 0;
  color: #c1413a;
  font-size: 0.8rem;
}
@media (max-width: 560px) {
  .edit-team__grid {
    grid-template-columns: 1fr;
  }
}
</style>
