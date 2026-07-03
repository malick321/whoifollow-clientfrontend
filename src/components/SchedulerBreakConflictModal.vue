<script setup lang="ts">
// SchedulerBreakConflictModal
// ---------------------------
// Shown when a newly-added break overlaps one or more scheduled games on
// its field(s). Rather than silently reject, the admin is offered the two
// ways out:
//   • Move later games — push the games that start at/after the break back
//     so the break fits at full duration (lists each game's old → new
//     time, same as the drag-cascade confirm).
//   • Shorten the break — trim it to the gap before the next game so no
//     game has to move.
// Only the feasible option(s) are shown; if neither is possible the view
// rejects upstream and this never opens. Presentational — the view owns
// the commit; this emits `move` / `shorten`.

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
  breakLabel: string
  breakDurationMinutes: number
  /** First overlapping game — used in the copy. */
  conflictGameLabel: string
  /** "Field 2 · Park Name" — shown as the header eyebrow (the games
   *  all sit on this field/park, so it's shown once, not per row). */
  fieldPark?: string
  canMove: boolean
  moveRows: ShiftPreviewRow[]
  canShorten: boolean
  shortenToMinutes: number
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'move'): void
  (event: 'shorten'): void
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

const titleId = 'scheduler-break-conflict-title'

function close() { emit('update:modelValue', false) }
function onBackdrop(event: MouseEvent) {
  if (event.target === event.currentTarget) close()
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
          <span class="scheduler-break-conflict__heading">
            <span v-if="fieldPark" class="eyebrow scheduler-break-conflict__head-eyebrow">{{ fieldPark }}</span>
            <h2 :id="titleId" class="association-switcher-panel__title">Break overlaps a game</h2>
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
            The <strong>{{ breakLabel }}</strong> ({{ breakDurationMinutes }} min) overlaps
            <strong>{{ conflictGameLabel }}</strong>. Choose how to fit it in:
          </p>

          <!-- Option A — move the later games back. -->
          <div v-if="canMove" class="scheduler-break-conflict__option">
            <p class="scheduler-break-conflict__option-title">
              Move {{ moveRows.length }} later game{{ moveRows.length === 1 ? '' : 's' }}
            </p>
            <ul class="scheduler-break-conflict__list">
              <li v-for="row in moveRows" :key="row.label" class="scheduler-break-conflict__row">
                <span class="scheduler-break-conflict__game-info">
                  <span class="scheduler-break-conflict__game">{{ row.label }}</span>
                  <span v-if="row.teams" class="scheduler-break-conflict__teams">{{ row.teams }}</span>
                </span>
                <span class="scheduler-break-conflict__times">
                  <span class="scheduler-break-conflict__old">{{ row.oldTime }}</span>
                  <span class="scheduler-break-conflict__arrow" aria-hidden="true">→</span>
                  <span class="scheduler-break-conflict__new">{{ row.newTime }}</span>
                </span>
              </li>
            </ul>
          </div>

          <!-- Option B — shorten the break to fit the gap. -->
          <p v-if="canShorten" class="scheduler-break-conflict__shorten">
            <template v-if="canMove">Or shorten</template><template v-else>Shorten</template>
            the break to <strong>{{ shortenToMinutes }} min</strong> so no game has to move.
          </p>
        </div>
        <footer class="association-confirm-panel__footer">
          <button class="secondary-button" type="button" @click="close">Cancel</button>
          <button
            v-if="canShorten"
            class="secondary-button"
            type="button"
            @click="emit('shorten')"
          >Shorten to {{ shortenToMinutes }} min</button>
          <button
            v-if="canMove"
            class="primary-button"
            type="button"
            @click="emit('move')"
          >Move {{ moveRows.length }} game{{ moveRows.length === 1 ? '' : 's' }}</button>
        </footer>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* Flat fill (no gradient) on the footer's primary CTA — the global
   `.primary-button` paints a `linear-gradient(135deg, primary, secondary)`;
   here we want a solid primary so the button reads cleanly in the dialog. */
.association-confirm-panel__footer .primary-button { background: var(--primary); }

.scheduler-break-conflict__option { margin-top: 14px; }
.scheduler-break-conflict__option-title {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}
.scheduler-break-conflict__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 220px;
  overflow-y: auto;
}
.scheduler-break-conflict__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--surface-muted, #f4f7fb);
}
html.dark-mode .scheduler-break-conflict__row { background: rgba(255, 255, 255, 0.04); }
/* Header — eyebrow (field · park) stacked above the title. */
.scheduler-break-conflict__heading {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.scheduler-break-conflict__head-eyebrow {
  /* Reuse the global `.eyebrow` caps treatment, trimmed for the header. */
  margin: 0;
  font-size: 0.64rem;
  letter-spacing: 0.1em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Left column — game name over the teams. */
.scheduler-break-conflict__game-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.scheduler-break-conflict__game {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.scheduler-break-conflict__teams {
  font-size: 12px;
  color: var(--secondary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.scheduler-break-conflict__times {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.scheduler-break-conflict__old { color: var(--secondary); text-decoration: line-through; }
.scheduler-break-conflict__arrow { color: var(--secondary); }
.scheduler-break-conflict__new { color: var(--text); font-weight: 700; }
.scheduler-break-conflict__shorten {
  margin: 14px 0 0;
  font-size: 13px;
  color: var(--text);
  line-height: 1.5;
}
</style>
