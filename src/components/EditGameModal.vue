<script setup lang="ts">
// EditGameModal
// -------------
// Edit a game's matchup (the two teams) + name. Host-agnostic + mock-first:
// the consumer passes the game, the division roster (`teamOptions`), and
// display context; this emits `save` / `delete`. Opened in-place from the
// scheduler card OR the division-detail card so an admin never has to leave
// the screen to change a matchup.
//
//   - Pool games  → both teams picked from the division roster.
//   - Bracket games → ONLY initial-round games are editable, and their teams
//     come from SEED inputs (Seed 1 … Seed N), not the roster.

import { computed, ref, watch } from 'vue'
import SlideModal from './SlideModal.vue'
import type { SchedulerGame } from '../types'

const props = withDefaults(defineProps<{
  modelValue: boolean
  game: SchedulerGame | null
  divisionName?: string
  /** Pre-formatted date (e.g. "May 29, 2026") for the read-only when-row. */
  dateLabel?: string
  /** Resolved park name for the field row. */
  parkLabel?: string
  /** Division roster labels ("#3: GTR") — the pool team picker options. */
  teamOptions?: string[]
}>(), {
  divisionName: '',
  dateLabel: '',
  parkLabel: '',
  teamOptions: () => []
})

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'save', payload: { game: SchedulerGame; name: string; team1Label: string; team2Label: string }): void
  (event: 'delete', game: SchedulerGame): void
}>()

const isBracket = computed(() => props.game?.type === 'bracket')
const titleText = computed(() => (isBracket.value ? 'Edit Bracket Game' : 'Edit Pool Game'))

/** Pool → roster labels; bracket → Seed 1 … Seed N (count from the roster,
 *  falling back to 8 when the roster isn't known yet). */
const options = computed<string[]>(() => {
  if (!isBracket.value) return props.teamOptions
  const n = props.teamOptions.length || 8
  return Array.from({ length: n }, (_, i) => `Seed ${i + 1}`)
})

const name = ref('')
const team1 = ref('')
const team2 = ref('')
const attempted = ref(false)

watch(
  () => props.modelValue,
  (open) => {
    if (!open || !props.game) return
    attempted.value = false
    name.value = props.game.label
    team1.value = props.game.team1Label ?? ''
    team2.value = props.game.team2Label ?? ''
  },
  { immediate: true }
)

const canSave = computed(() =>
  name.value.trim().length > 0 && !!team1.value && !!team2.value && team1.value !== team2.value
)

function close() { emit('update:modelValue', false) }
function onUpdate() {
  attempted.value = true
  if (!canSave.value || !props.game) return
  emit('save', { game: props.game, name: name.value.trim(), team1Label: team1.value, team2Label: team2.value })
  close()
}
function onDelete() {
  if (props.game) emit('delete', props.game)
  close()
}
</script>

<template>
  <SlideModal
    :model-value="modelValue"
    :title="titleText"
    :subtitle="divisionName"
    size="default"
    @update:model-value="(v) => emit('update:modelValue', v)"
  >
    <div v-if="game" class="edit-game">
      <!-- Read-only schedule context. -->
      <p v-if="game.scheduledDate" class="edit-game__meta">
        <span class="edit-game__meta-ico edit-game__meta-ico--time" aria-hidden="true"></span>
        {{ game.scheduledTime }}<template v-if="dateLabel || game.scheduledDate"> - {{ dateLabel || game.scheduledDate }}</template>
      </p>
      <p v-if="game.scheduledFieldLabel" class="edit-game__meta">
        <span class="edit-game__meta-ico edit-game__meta-ico--park" aria-hidden="true"></span>
        {{ game.scheduledFieldLabel }}<template v-if="parkLabel"> - {{ parkLabel }}</template>
      </p>

      <div class="floating-input" :class="{ 'floating-input--invalid': attempted && !name.trim() }">
        <input id="edit-game-name" v-model="name" type="text" class="floating-input__control" :class="{ 'floating-input__control--has-value': !!name }" placeholder=" " />
        <label for="edit-game-name" class="floating-input__label">Game Name</label>
        <span v-if="attempted && !name.trim()" class="floating-input__error-corner">Required</span>
      </div>

      <div class="edit-game__teams">
        <div class="floating-input" :class="{ 'floating-input--invalid': attempted && !team1 }">
          <select id="edit-game-t1" v-model="team1" class="floating-input__control floating-input__control--select" :class="{ 'floating-input__control--has-value': !!team1 }">
            <option value="" disabled></option>
            <option v-for="o in options" :key="`t1-${o}`" :value="o">{{ o }}</option>
          </select>
          <label for="edit-game-t1" class="floating-input__label floating-input__label--floated">Team 1</label>
        </div>
        <div class="floating-input" :class="{ 'floating-input--invalid': attempted && (!team2 || team1 === team2) }">
          <select id="edit-game-t2" v-model="team2" class="floating-input__control floating-input__control--select" :class="{ 'floating-input__control--has-value': !!team2 }">
            <option value="" disabled></option>
            <option v-for="o in options" :key="`t2-${o}`" :value="o">{{ o }}</option>
          </select>
          <label for="edit-game-t2" class="floating-input__label floating-input__label--floated">Team 2</label>
          <span v-if="attempted && team1 && team1 === team2" class="floating-input__error-corner">Pick a different team</span>
        </div>
      </div>
    </div>

    <template #footer>
      <button type="button" class="secondary-button edit-game__delete" @click="onDelete">
        <span class="edit-game__delete-ico" aria-hidden="true"></span>
        Delete
      </button>
      <span class="edit-game__foot-spacer"></span>
      <button type="button" class="primary-button" :disabled="!canSave" @click="onUpdate">Update</button>
    </template>
  </SlideModal>
</template>

<style scoped>
.edit-game { display: flex; flex-direction: column; gap: 16px; }
.edit-game__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 14px;
  color: var(--secondary);
}
.edit-game__meta-ico {
  width: 16px; height: 16px; flex: 0 0 auto;
  background-color: currentColor;
  -webkit-mask-position: center; mask-position: center;
  -webkit-mask-size: contain; mask-size: contain;
  -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
}
.edit-game__meta-ico--time { -webkit-mask-image: url('../assets/time.svg'); mask-image: url('../assets/time.svg'); }
.edit-game__meta-ico--park { -webkit-mask-image: url('../assets/location.svg'); mask-image: url('../assets/location.svg'); }

.edit-game__teams { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 520px) { .edit-game__teams { grid-template-columns: 1fr; } }

.edit-game__foot-spacer { flex: 1 1 auto; }
/* Delete — danger-tinted secondary button (matches the reference). */
.edit-game__delete {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #c1413a;
  border-color: rgba(193, 65, 58, 0.4);
  background: rgba(193, 65, 58, 0.08);
}
.edit-game__delete:hover { background: rgba(193, 65, 58, 0.16); }
.edit-game__delete-ico {
  width: 15px; height: 15px; flex: 0 0 auto;
  background-color: currentColor;
  -webkit-mask: url('../assets/delete.svg') center / contain no-repeat;
  mask: url('../assets/delete.svg') center / contain no-repeat;
}
</style>
