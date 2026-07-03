<script setup lang="ts">
// GameNotesModal
// --------------
// Add / edit free-text notes for a game (mock-first). Host-agnostic — opened
// in-place from the scheduler or division-detail card. Emits `save(notes)`.

import { ref, watch } from 'vue'
import SlideModal from './SlideModal.vue'
import type { SchedulerGame } from '../types'

const props = withDefaults(defineProps<{
  modelValue: boolean
  game: SchedulerGame | null
  divisionName?: string
  /** Existing notes (host stores them; mock keeps in memory). */
  notes?: string
}>(), { divisionName: '', notes: '' })

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'save', payload: { game: SchedulerGame; notes: string }): void
}>()

const draft = ref('')
const saving = ref(false)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    draft.value = props.notes ?? ''
    saving.value = false
  },
  { immediate: true }
)

function close() { emit('update:modelValue', false) }
function onSave() {
  if (!props.game || saving.value) return
  saving.value = true
  emit('save', { game: props.game, notes: draft.value.trim() })
  close()
}
</script>

<template>
  <SlideModal
    :model-value="modelValue"
    title="Game Notes"
    :subtitle="game ? `${divisionName ? divisionName + ' · ' : ''}${game.label}` : divisionName"
    size="default"
    @update:model-value="(v) => emit('update:modelValue', v)"
  >
    <div class="floating-input">
      <textarea
        id="game-notes-body"
        v-model="draft"
        class="floating-input__control game-notes__textarea"
        :class="{ 'floating-input__control--has-value': !!draft }"
        rows="6"
        placeholder=" "
      ></textarea>
      <label for="game-notes-body" class="floating-input__label">Notes</label>
    </div>

    <template #footer>
      <button type="button" class="secondary-button" @click="close">Cancel</button>
      <span class="game-notes__foot-spacer"></span>
      <button type="button" class="primary-button" @click="onSave">Save Notes</button>
    </template>
  </SlideModal>
</template>

<style scoped>
.game-notes__textarea { resize: vertical; min-height: 120px; line-height: 1.45; }
.game-notes__foot-spacer { flex: 1 1 auto; }
</style>
