<script setup lang="ts">
// CancelBracketModal
// ------------------
// Centered confirmation popup for cancelling a bracket that can't finish
// as scheduled (rain / field conditions / time-curfew / other). A
// cancelled bracket can't produce winners, so its teams are announced via
// their pool instead. Captures a PRESET reason (categorisable for
// reporting) + an optional free-text note.
//
// Shared: opened from BOTH the Announce-result modal (per-bracket unit)
// and the bracket canvas (active pill). Reuses the confirm-panel chrome.

import { computed, onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { lockBodyScroll, unlockBodyScroll } from '../body-scroll-lock'
import type { BracketCancelReasonCode } from '../types'

/** Payload emitted on confirm. */
export interface CancelBracketReason {
  reasonCode: BracketCancelReasonCode
  note?: string
}

const props = withDefaults(defineProps<{
  modelValue: boolean
  /** Bracket being cancelled — shown in the copy. */
  bracketName?: string
  saving?: boolean
}>(), {
  bracketName: '',
  saving: false
})

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'confirm', payload: CancelBracketReason): void
}>()

const REASONS: { value: BracketCancelReasonCode; label: string }[] = [
  { value: 'rain', label: 'Rain' },
  { value: 'field_conditions', label: 'Field conditions' },
  { value: 'time_curfew', label: 'Time / curfew' },
  { value: 'other', label: 'Other' }
]

const reasonCode = ref<BracketCancelReasonCode | ''>('')
const note = ref('')
const submitAttempted = ref(false)

watch(
  () => props.modelValue,
  (open, wasOpen) => {
    if (open && !wasOpen) {
      reasonCode.value = ''
      note.value = ''
      submitAttempted.value = false
      lockBodyScroll()
    } else if (!open && wasOpen) {
      unlockBodyScroll()
    }
  }
)
onBeforeUnmount(() => {
  if (props.modelValue) unlockBodyScroll()
})

const titleId = 'cancel-bracket-title'
const reasonInvalid = computed(() => submitAttempted.value && !reasonCode.value)
const canSubmit = computed(() => !!reasonCode.value && !props.saving)
const submitLabel = computed(() => (props.saving ? 'Cancelling…' : 'Cancel bracket'))

function close() {
  if (props.saving) return
  emit('update:modelValue', false)
}
function onBackdrop(event: MouseEvent) {
  if (event.target === event.currentTarget) close()
}
function onConfirm() {
  submitAttempted.value = true
  if (!reasonCode.value) return
  emit('confirm', { reasonCode: reasonCode.value, note: note.value.trim() || undefined })
}
</script>

<template>
  <Teleport to="body">
    <Transition name="slide-modal-backdrop">
      <div
        v-if="modelValue"
        class="association-switcher-backdrop cancel-bracket-backdrop"
        role="presentation"
        @click="onBackdrop"
      >
        <div
          class="association-switcher-panel association-confirm-panel"
          role="alertdialog"
          aria-modal="true"
          :aria-labelledby="titleId"
        >
          <header class="association-switcher-panel__header">
            <div class="cancel-bracket__titles">
              <span v-if="bracketName" class="cancel-bracket__eyebrow">{{ bracketName }}</span>
              <h2 :id="titleId" class="association-switcher-panel__title">Cancel Bracket</h2>
            </div>
            <button
              type="button"
              class="association-switcher-panel__close"
              aria-label="Close"
              :disabled="saving"
              @click="close"
            >
              <AppIcon name="close" :size="16" />
            </button>
          </header>
          <div class="association-confirm-panel__body cancel-bracket__body">
            <div class="app-banner app-banner--warning cancel-bracket__warning">
              <div class="app-banner__text">
                <p class="cancel-bracket__warning-line">
                  You are about to cancel the <strong>{{ bracketName || 'bracket' }}</strong>. Once
                  canceled, results from this bracket will no longer determine the division winners.
                  Instead, winners and final standings will be based on pool play results.
                </p>
                <p class="cancel-bracket__warning-line">
                  Please select a cancellation reason and provide any additional notes before
                  proceeding. This action will affect how winners are determined for the division.
                </p>
              </div>
            </div>

            <span
              class="floating-input cancel-bracket__reason"
              :class="{ 'floating-input--invalid': reasonInvalid }"
            >
              <select
                id="cancel-bracket-reason"
                v-model="reasonCode"
                class="floating-input__control floating-input__control--select"
                :class="{ 'floating-input__control--has-value': !!reasonCode }"
              >
                <option value="" disabled>— Select reason —</option>
                <option v-for="r in REASONS" :key="r.value" :value="r.value">{{ r.label }}</option>
              </select>
              <label for="cancel-bracket-reason" class="floating-input__label floating-input__label--floated">
                Reason
              </label>
            </span>
            <span v-if="reasonInvalid" class="association-user-modal__error">A reason is required.</span>

            <span class="floating-input cancel-bracket__note">
              <textarea
                id="cancel-bracket-note"
                v-model="note"
                class="floating-input__control"
                :class="{ 'floating-input__control--has-value': !!note }"
                placeholder=" "
                rows="5"
              ></textarea>
              <label
                for="cancel-bracket-note"
                class="floating-input__label"
                :class="{ 'floating-input__label--floated': !!note }"
              >Note (optional)</label>
            </span>
          </div>
          <footer class="association-confirm-panel__footer">
            <button class="secondary-button" type="button" :disabled="saving" @click="close">Keep bracket</button>
            <button
              class="danger-light-button"
              type="button"
              :disabled="!canSubmit"
              @click="onConfirm"
            >
              {{ submitLabel }}
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Sit above the Announce-result modal — that modal mounts on open (later
   in the DOM) while this one is always mounted, so without a higher
   z-index the cancel popup would paint BEHIND it. */
.cancel-bracket-backdrop {
  z-index: 210;
}
/* Header — eyebrow (bracket name) above the title. */
.cancel-bracket__titles {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.cancel-bracket__eyebrow {
  font-size: 0.72rem;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--secondary);
}
/* Body — space the warning banner, reason select, and note apart so the
   controls aren't crammed against the text or each other. */
.cancel-bracket__body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.cancel-bracket__warning {
  align-items: flex-start;
}
.cancel-bracket__warning-line {
  margin: 0;
  line-height: 1.45;
}
.cancel-bracket__warning-line + .cancel-bracket__warning-line {
  margin-top: 8px;
}
.cancel-bracket__reason,
.cancel-bracket__note {
  display: block;
}
/* The confirm-panel chrome doesn't carry the SlideModal's tall-textarea
   rule, so the note would collapse to the 36px input height. Give it a
   roomy box (matching the game-delay reason popup) + resize handle. */
.cancel-bracket__note .floating-input__control {
  height: auto;
  min-height: 110px;
  padding: 14px;
  line-height: 1.45;
  resize: vertical;
}
/* Keep the validation error tucked under the reason select instead of a
   full 16px gap floating it between the two controls. */
.cancel-bracket__body .association-user-modal__error {
  margin-top: -10px;
}
</style>
