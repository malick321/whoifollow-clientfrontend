<script setup lang="ts">
// SchedulerMarkDelayedModal
// -------------------------
// Bulk "mark selected games delayed" with an optional shared reason
// (e.g. "Rain", "Lightning in area"). The view applies status='delayed'
// + delayReason to each selected non-final game. Reuses the shared
// centered-confirm chrome.

import { onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { lockBodyScroll, unlockBodyScroll } from '../body-scroll-lock'

const props = defineProps<{
  modelValue: boolean
  count: number
  /** Header context — park name (eyebrow) + date (next to title). */
  parkName?: string
  dateLabel?: string
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'confirm', payload: { reason: string }): void
}>()

const reason = ref('')

watch(
  () => props.modelValue,
  (open, wasOpen) => {
    if (open && !wasOpen) { reason.value = ''; lockBodyScroll() }
    else if (!open && wasOpen) unlockBodyScroll()
  },
  { immediate: true }
)
onBeforeUnmount(() => { if (props.modelValue) unlockBodyScroll() })

const titleId = 'scheduler-delay-title'
function close() { emit('update:modelValue', false) }
function onBackdrop(e: MouseEvent) { if (e.target === e.currentTarget) close() }
function onConfirm() { emit('confirm', { reason: reason.value.trim() }); close() }
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
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
      >
        <header class="association-switcher-panel__header">
          <span class="scheduler-delay__heading">
            <span v-if="parkName" class="eyebrow scheduler-delay__head-eyebrow">{{ parkName }}</span>
            <span class="scheduler-delay__titlerow">
              <h2 :id="titleId" class="association-switcher-panel__title">
                Mark {{ count }} game{{ count === 1 ? '' : 's' }} delayed
              </h2>
              <span v-if="dateLabel" class="scheduler-delay__title-date">{{ dateLabel }}</span>
            </span>
          </span>
          <button type="button" class="association-switcher-panel__close" aria-label="Close" @click="close">
            <AppIcon name="close" :size="16" />
          </button>
        </header>
        <div class="association-confirm-panel__body">
          <p class="association-confirm-panel__copy">
            The selected games will show the <strong>Delayed</strong> badge.
            Add an optional reason (applies to all).
          </p>
          <span class="floating-input scheduler-delay__reason">
            <textarea
              id="scheduler-delay-reason"
              v-model="reason"
              class="floating-input__control"
              :class="{ 'floating-input__control--has-value': !!reason }"
              placeholder=" "
              rows="5"
            ></textarea>
            <label
              for="scheduler-delay-reason"
              class="floating-input__label"
              :class="{ 'floating-input__label--floated': !!reason }"
            >Reason (optional)</label>
          </span>
        </div>
        <footer class="association-confirm-panel__footer">
          <button class="secondary-button" type="button" @click="close">Cancel</button>
          <span class="scheduler-delay__foot-spacer"></span>
          <button class="primary-button" type="button" @click="onConfirm">Mark delayed</button>
        </footer>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.association-confirm-panel__footer .primary-button { background: var(--primary); }
/* Header — park eyebrow, then title + date on one row. */
.scheduler-delay__heading { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.scheduler-delay__head-eyebrow {
  margin: 0;
  font-size: 0.64rem;
  letter-spacing: 0.1em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.scheduler-delay__titlerow {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 10px;
  min-width: 0;
}
.scheduler-delay__title-date { font-size: 0.88rem; color: var(--secondary); white-space: nowrap; }
.scheduler-delay__reason { display: block; margin-top: 12px; }
/* Override the global `.floating-input__control { height: 36px }` so the
   textarea is a roomy multi-row box (matches the game-delay reason popup). */
.scheduler-delay__reason textarea.floating-input__control {
  height: auto;
  min-height: 110px;
  padding: 10px 12px;
  line-height: 1.45;
  resize: vertical;
}
.scheduler-delay__foot-spacer { flex: 1 1 auto; }
</style>
