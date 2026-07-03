<script setup lang="ts">
// SuspendTeamConfirmModal
// -----------------------
// Centered confirmation popup used for both the **suspend** and
// **cancel-registration (reject)** flows. The two share the same
// shape (confirm + required reason textarea); the `mode` prop
// swaps copy + button colors so the same component covers both.
//
// Both actions are destructive and require a non-empty `reason` —
// confirming without one surfaces a validation error on the field
// (the button stays enabled so the click can trigger that validation).

import { computed, onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { lockBodyScroll, unlockBodyScroll } from '../body-scroll-lock'

const props = withDefaults(defineProps<{
  modelValue: boolean
  /** Action being confirmed. Drives the title, copy, and submit
   *  button label/tone. */
  mode?: 'suspend' | 'reject'
  teamName?: string
  saving?: boolean
}>(), {
  mode: 'suspend',
  teamName: '',
  saving: false
})

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'confirm', payload: { reason: string }): void
}>()

const reason = ref('')
const submitAttempted = ref(false)

watch(
  () => props.modelValue,
  (open, wasOpen) => {
    if (open && !wasOpen) {
      reason.value = ''
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

const titleId = 'suspend-team-title'

const title = computed(() =>
  props.mode === 'reject' ? 'Cancel Registration' : 'Suspend Team'
)

const submitLabel = computed(() => {
  if (props.saving) {
    return props.mode === 'reject' ? 'Cancelling…' : 'Suspending…'
  }
  return props.mode === 'reject' ? 'Yes, Cancel Registration' : 'Yes, Suspend'
})

const reasonInvalid = computed(() => {
  if (!submitAttempted.value) return false
  return !reason.value.trim()
})

function close() {
  if (props.saving) return
  emit('update:modelValue', false)
}

function onBackdrop(event: MouseEvent) {
  if (event.target === event.currentTarget) close()
}

function onConfirm() {
  submitAttempted.value = true
  if (!reason.value.trim()) return
  emit('confirm', { reason: reason.value.trim() })
}
</script>

<template>
  <Transition name="slide-modal-backdrop">
    <div
      v-if="modelValue"
      class="association-switcher-backdrop"
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
          <h2 :id="titleId" class="association-switcher-panel__title">{{ title }}</h2>
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
        <div class="association-confirm-panel__body">
          <p class="association-confirm-panel__copy">
            <template v-if="mode === 'reject'">
              Cancel registration for <strong>{{ teamName }}</strong>? This marks the
              team as Rejected and removes their ability to enter events.
            </template>
            <template v-else>
              Suspend <strong>{{ teamName }}</strong>? The team won't be able to enter
              new events until they're reactivated.
            </template>
          </p>
          <span
            class="floating-input association-confirm-panel__reason-input"
            :class="{ 'floating-input--invalid': reasonInvalid }"
          >
            <textarea
              id="suspend-team-reason"
              v-model="reason"
              class="floating-input__control"
              :class="{ 'floating-input__control--has-value': !!reason }"
              placeholder=" "
              rows="3"
            ></textarea>
            <label
              for="suspend-team-reason"
              class="floating-input__label"
              :class="{ 'floating-input__label--floated': !!reason }"
            >Reason</label>
            <span v-if="reasonInvalid" class="floating-input__error-corner">Required</span>
          </span>
        </div>
        <footer class="association-confirm-panel__footer">
          <button class="secondary-button" type="button" :disabled="saving" @click="close">Cancel</button>
          <button
            class="danger-light-button"
            type="button"
            :disabled="saving"
            @click="onConfirm"
          >
            {{ submitLabel }}
          </button>
        </footer>
      </div>
    </div>
  </Transition>
</template>
