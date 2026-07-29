<script setup lang="ts">
// CreateGameModal
// ---------------
// "Add Game" popup for a team event, in the finalized new-design system
// (SlideModal + floating-input + DateTimePicker + TimePicker). Mirrors the
// core legacy NewGame fields; posts via createTeamEventGame. Park/field pickers
// are intentionally omitted (legacy game-park system not in the new app).
import { computed, ref, watch } from 'vue'
import SlideModal from './SlideModal.vue'
import DateTimePicker from './DateTimePicker.vue'
import TimePicker from './TimePicker.vue'
import MultiSelectDropdown from './MultiSelectDropdown.vue'
import { US_STATES } from '../api/associationTeams'
import { createTeamEventGame } from '../api/teamEventGames'
import { pushToast } from '../toast-center'

const props = defineProps<{
  modelValue: boolean
  teamId: string
  eventId: string
}>()
const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'saved'): void
}>()

const name = ref('')
const opponentName = ref('')
const opponentCity = ref('')
const stateArr = ref<string[]>([])
const startDate = ref('')
const startTime = ref('')
const note = ref('')
const saving = ref(false)
const submitAttempted = ref(false)
const saveError = ref('')

const errors = computed(() => {
  const e = new Set<string>()
  if (!name.value.trim()) e.add('name')
  if (!opponentName.value.trim()) e.add('opponentName')
  if (!startDate.value) e.add('startDate')
  return e
})
function err(key: string) {
  return submitAttempted.value && errors.value.has(key)
}

function reset() {
  name.value = ''
  opponentName.value = ''
  opponentCity.value = ''
  stateArr.value = []
  startDate.value = ''
  startTime.value = ''
  note.value = ''
  saving.value = false
  submitAttempted.value = false
  saveError.value = ''
}

// Reset each time the modal opens so a fresh create never shows stale input.
watch(() => props.modelValue, (open) => { if (open) reset() })

async function save() {
  submitAttempted.value = true
  if (errors.value.size > 0) return
  saving.value = true
  saveError.value = ''
  try {
    await createTeamEventGame(props.teamId, props.eventId, {
      name: name.value.trim(),
      opponentName: opponentName.value.trim(),
      opponentCity: opponentCity.value.trim() || undefined,
      opponentState: stateArr.value[0] || undefined,
      startDate: startDate.value,
      startTime: startTime.value || undefined,
      note: note.value.trim() || undefined
    })
    pushToast({ tone: 'success', title: 'Game created' })
    emit('saved')
    emit('update:modelValue', false)
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : 'Could not create the game.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <SlideModal
    :model-value="modelValue"
    title="Add Game"
    eyebrow="New Game"
    @update:model-value="(v) => emit('update:modelValue', v)"
  >
    <div class="create-game-form">
      <div class="floating-input" :class="{ 'floating-input--invalid': err('name') }">
        <input id="cg-name" v-model="name" type="text" maxlength="60"
               class="floating-input__control" :class="{ 'floating-input__control--has-value': !!name }" placeholder=" " />
        <label for="cg-name" class="floating-input__label" :class="{ 'floating-input__label--floated': !!name }">Game name</label>
      </div>

      <div class="floating-input" :class="{ 'floating-input--invalid': err('opponentName') }">
        <input id="cg-opp" v-model="opponentName" type="text" maxlength="60"
               class="floating-input__control" :class="{ 'floating-input__control--has-value': !!opponentName }" placeholder=" " />
        <label for="cg-opp" class="floating-input__label" :class="{ 'floating-input__label--floated': !!opponentName }">Opponent name</label>
      </div>

      <div class="create-game-form__row">
        <div class="floating-input">
          <input id="cg-city" v-model="opponentCity" type="text" maxlength="80"
                 class="floating-input__control" :class="{ 'floating-input__control--has-value': !!opponentCity }" placeholder=" " />
          <label for="cg-city" class="floating-input__label" :class="{ 'floating-input__label--floated': !!opponentCity }">Opponent city</label>
        </div>
        <MultiSelectDropdown v-model="stateArr" :options="US_STATES" placeholder="State" single aria-label="Opponent state" />
      </div>

      <div class="create-game-form__row">
        <DateTimePicker v-model="startDate" label="Start date" date-only :invalid="err('startDate')" />
        <TimePicker v-model="startTime" label="Start time" />
      </div>

      <div class="floating-input">
        <textarea id="cg-note" v-model="note" rows="3" maxlength="200"
                  class="floating-input__control floating-input__control--textarea" :class="{ 'floating-input__control--has-value': !!note }" placeholder=" "></textarea>
        <label for="cg-note" class="floating-input__label" :class="{ 'floating-input__label--floated': !!note }">Notes (optional)</label>
      </div>

      <p v-if="saveError" class="create-game-form__error" role="alert">{{ saveError }}</p>
    </div>

    <template #footer>
      <button type="button" class="secondary-button" @click="emit('update:modelValue', false)">Cancel</button>
      <span class="create-game-form__spacer"></span>
      <button type="button" class="primary-button" :disabled="saving" @click="save">
        <span v-if="saving" class="btn-spinner" aria-hidden="true"></span>
        {{ saving ? 'Creating…' : 'Create Game' }}
      </button>
    </template>
  </SlideModal>
</template>

<style scoped>
.create-game-form { display: flex; flex-direction: column; gap: 16px; }
.create-game-form__row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.create-game-form__spacer { flex: 1; }
.create-game-form__error { margin: 0; color: var(--danger, #e5484d); font-size: 0.85rem; }
@media (max-width: 560px) {
  .create-game-form__row { grid-template-columns: 1fr; }
}
</style>
