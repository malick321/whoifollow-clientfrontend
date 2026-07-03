<script setup lang="ts">
// SchedulerShiftConfirmModal
// --------------------------
// Centered confirmation popup shown before a drag-drop "delay cascade"
// is applied. When a game is dropped later onto its field's day and the
// later games on that field have to slide back to absorb the overlap,
// this dialog spells out the impact first — how many games move, and the
// old → new time for each — so the admin can proceed or back out.
//
// Mirrors SchedulerBreakConflictModal: header eyebrow (field · park),
// game name + teams per row, flat (no-gradient) primary CTA. Purely
// presentational — the scheduler view computes the shift set + owns the
// commit; this renders the preview and emits `confirm`.

import { onBeforeUnmount, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { lockBodyScroll, unlockBodyScroll } from '../body-scroll-lock'

interface ShiftPreviewRow {
  label: string
  /** "Team A vs Team B" — shown under the game name. */
  teams?: string
  oldTime: string
  newTime: string
}

const props = defineProps<{
  modelValue: boolean
  /** Label of the game being dragged into place. */
  movedLabel: string
  /** New time the dragged game lands at (12h string). */
  movedNewTime: string
  /** Minutes every following game shifts back by. */
  deltaMinutes: number
  /** "Field 2 · Park Name" — shown once as the header eyebrow. */
  fieldPark?: string
  /** The later games that have to move, with old + new times. */
  rows: ShiftPreviewRow[]
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'confirm'): void
}>()

watch(
  () => props.modelValue,
  (open, wasOpen) => {
    if (open && !wasOpen) lockBodyScroll()
    else if (!open && wasOpen) unlockBodyScroll()
  }
)

onBeforeUnmount(() => {
  if (props.modelValue) unlockBodyScroll()
})

const titleId = 'scheduler-shift-title'

function close() { emit('update:modelValue', false) }
function onBackdrop(event: MouseEvent) {
  if (event.target === event.currentTarget) close()
}
function onConfirm() { emit('confirm') }
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
          <span class="scheduler-shift__heading">
            <span v-if="fieldPark" class="eyebrow scheduler-shift__head-eyebrow">{{ fieldPark }}</span>
            <h2 :id="titleId" class="association-switcher-panel__title">Move later games?</h2>
          </span>
          <button
            type="button"
            class="association-switcher-panel__close"
            aria-label="Close"
            @click="close"
          >
            <AppIcon name="close" :size="16" />
          </button>
        </header>
        <div class="association-confirm-panel__body">
          <p class="association-confirm-panel__copy">
            Moving <strong>{{ movedLabel }}</strong> to <strong>{{ movedNewTime }}</strong> pushes
            {{ rows.length }} later game{{ rows.length === 1 ? '' : 's' }} back by
            <strong>{{ deltaMinutes }} min</strong>:
          </p>
          <ul class="scheduler-shift__list">
            <li v-for="row in rows" :key="row.label" class="scheduler-shift__row">
              <span class="scheduler-shift__game-info">
                <span class="scheduler-shift__game">{{ row.label }}</span>
                <span v-if="row.teams" class="scheduler-shift__teams">{{ row.teams }}</span>
              </span>
              <span class="scheduler-shift__times">
                <span class="scheduler-shift__old">{{ row.oldTime }}</span>
                <span class="scheduler-shift__arrow" aria-hidden="true">→</span>
                <span class="scheduler-shift__new">{{ row.newTime }}</span>
              </span>
            </li>
          </ul>
        </div>
        <footer class="association-confirm-panel__footer">
          <button class="secondary-button" type="button" @click="close">Cancel</button>
          <button class="primary-button" type="button" @click="onConfirm">
            Move {{ rows.length }} game{{ rows.length === 1 ? '' : 's' }}
          </button>
        </footer>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* Flat fill (no gradient) on the footer's primary CTA — overrides the
   global `.primary-button` linear-gradient so it reads cleanly here. */
.association-confirm-panel__footer .primary-button { background: var(--primary); }

/* Header — eyebrow (field · park) stacked above the title. */
.scheduler-shift__heading {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.scheduler-shift__head-eyebrow {
  margin: 0;
  font-size: 0.64rem;
  letter-spacing: 0.1em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.scheduler-shift__list {
  list-style: none;
  margin: 14px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 260px;
  overflow-y: auto;
}
.scheduler-shift__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--surface-muted, #f4f7fb);
}
html.dark-mode .scheduler-shift__row { background: rgba(255, 255, 255, 0.04); }
.scheduler-shift__game-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.scheduler-shift__game {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.scheduler-shift__teams {
  font-size: 12px;
  color: var(--secondary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.scheduler-shift__times {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.scheduler-shift__old { color: var(--secondary); text-decoration: line-through; }
.scheduler-shift__arrow { color: var(--secondary); }
.scheduler-shift__new { color: var(--text); font-weight: 700; }
</style>
