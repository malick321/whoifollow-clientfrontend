<script setup lang="ts">
// SchedulerAddSlotModal
// ---------------------
// Centered selection popup shown when the admin clicks an empty grid slot.
// Surfaces the slot's context (start / end / duration / field / park) and
// asks what to add — a break or a new pool game — as two selectable tiles.
// Picking one emits the matching event; the view then opens the relevant
// form pre-filled with the slot. Reuses the shared centered-confirm chrome
// (`association-confirm-panel`) + scope-pill tile pattern.

import { computed, onBeforeUnmount, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { lockBodyScroll, unlockBodyScroll } from '../body-scroll-lock'

const props = defineProps<{
  modelValue: boolean
  /** Date, pre-formatted (e.g. "Sun, May 24"). */
  dateLabel: string
  /** Slot range, pre-formatted (e.g. "1:30 – 3:00 PM"). */
  slotLabel: string
  durationMinutes: number
  fieldName: string
  parkName: string
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'add-break'): void
  (event: 'add-game'): void
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

const titleId = 'scheduler-add-slot-title'

/** "Field 2 · Centennial Park" — header eyebrow. */
const fieldPark = computed<string>(() =>
  [props.fieldName, props.parkName].filter(Boolean).join(' · ')
)

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
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
      >
        <header class="association-switcher-panel__header">
          <span class="scheduler-add-slot__heading">
            <span v-if="fieldPark" class="eyebrow scheduler-add-slot__head-eyebrow">{{ fieldPark }}</span>
            <h2 :id="titleId" class="association-switcher-panel__title">What would you like to add?</h2>
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
          <!-- Slot context — date, slot range, duration on one row. -->
          <dl class="scheduler-add-slot__info">
            <div class="scheduler-add-slot__info-item">
              <dt>Date</dt><dd>{{ dateLabel }}</dd>
            </div>
            <div class="scheduler-add-slot__info-item">
              <dt>Slot</dt><dd>{{ slotLabel }}</dd>
            </div>
            <div class="scheduler-add-slot__info-item">
              <dt>Duration</dt><dd>{{ durationMinutes }} min</dd>
            </div>
          </dl>

          <!-- Selectable tiles. -->
          <div class="scheduler-add-slot__options">
            <button type="button" class="scheduler-add-slot__option" @click="emit('add-break')">
              <span class="scheduler-add-slot__option-icon" aria-hidden="true">
                <span class="scheduler-add-slot__option-glyph scheduler-add-slot__option-glyph--break"></span>
              </span>
              <span class="scheduler-add-slot__option-text">
                <span class="scheduler-add-slot__option-title">Add break</span>
                <span class="scheduler-add-slot__option-hint">Block this field for the slot (lunch, rain delay…)</span>
              </span>
              <span class="scheduler-add-slot__option-arrow" aria-hidden="true"></span>
            </button>
            <button type="button" class="scheduler-add-slot__option" @click="emit('add-game')">
              <span class="scheduler-add-slot__option-icon" aria-hidden="true">
                <span class="scheduler-add-slot__option-glyph scheduler-add-slot__option-glyph--game"></span>
              </span>
              <span class="scheduler-add-slot__option-text">
                <span class="scheduler-add-slot__option-title">Add pool game</span>
                <span class="scheduler-add-slot__option-hint">Create a new pool matchup and place it here</span>
              </span>
              <span class="scheduler-add-slot__option-arrow" aria-hidden="true"></span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* Header — eyebrow (field · park) stacked above the title. */
.scheduler-add-slot__heading {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.scheduler-add-slot__head-eyebrow {
  margin: 0;
  font-size: 0.64rem;
  letter-spacing: 0.1em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Slot-info — date, slot range, duration in one row. */
.scheduler-add-slot__info {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin: 0 0 16px;
  padding: 12px;
  border-radius: 8px;
  background: var(--surface-muted, #f4f7fb);
}
.scheduler-add-slot__info-item { min-width: 0; }
html.dark-mode .scheduler-add-slot__info { background: rgba(255, 255, 255, 0.04); }
.scheduler-add-slot__info dt {
  font-size: 0.62rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--secondary);
  margin-bottom: 1px;
}
.scheduler-add-slot__info dd {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

/* Option tiles — mirrors the break-form scope-pill selectable card. */
.scheduler-add-slot__options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.scheduler-add-slot__option {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12px;
  width: 100%;
  text-align: left;
  padding: 12px 14px;
  border: 1px solid var(--border-divider);
  border-radius: 8px;
  background: var(--surface-card);
  cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease, box-shadow 120ms ease;
}
/* Circular tinted chip holding the twotone glyph — mirrors the
   people-row avatar style. */
.scheduler-add-slot__option-icon {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(45, 140, 240, 0.1);
}
html.dark-mode .scheduler-add-slot__option-icon { background: rgba(127, 176, 232, 0.16); }
/* Inner glyph — masked SVG; the source's 0.4-opacity paths render at 40%
   alpha of the fill, preserving the two-tone look. */
.scheduler-add-slot__option-glyph {
  width: 22px;
  height: 22px;
  background-color: var(--primary);
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}
html.dark-mode .scheduler-add-slot__option-glyph { background-color: #7fb0e8; }
.scheduler-add-slot__option-glyph--break {
  -webkit-mask-image: url('../assets/timer-pause-twotone.svg');
  mask-image: url('../assets/timer-pause-twotone.svg');
}
.scheduler-add-slot__option-glyph--game {
  -webkit-mask-image: url('../assets/game-twotone.svg');
  mask-image: url('../assets/game-twotone.svg');
}
.scheduler-add-slot__option-text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-width: 0;
  flex: 1 1 auto;
}
/* Right chevron — masked SVG that picks up the tile's accent on hover. */
.scheduler-add-slot__option-arrow {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  background-color: var(--secondary);
  -webkit-mask-image: url('../assets/arrow-right.svg');
  mask-image: url('../assets/arrow-right.svg');
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}
.scheduler-add-slot__option:hover .scheduler-add-slot__option-arrow { background-color: var(--primary); }
html.dark-mode .scheduler-add-slot__option:hover .scheduler-add-slot__option-arrow { background-color: #7fb0e8; }
.scheduler-add-slot__option:hover {
  border-color: var(--primary);
  background: var(--primary-light-3);
  box-shadow: inset 0 0 0 1px var(--primary);
}
html.dark-mode .scheduler-add-slot__option { background: rgba(255, 255, 255, 0.03); }
html.dark-mode .scheduler-add-slot__option:hover {
  background: rgba(45, 140, 240, 0.12);
  border-color: var(--primary);
}
.scheduler-add-slot__option-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text);
}
.scheduler-add-slot__option:hover .scheduler-add-slot__option-title { color: var(--primary); }
html.dark-mode .scheduler-add-slot__option:hover .scheduler-add-slot__option-title { color: #7fb0e8; }
.scheduler-add-slot__option-hint {
  font-size: 12px;
  color: var(--secondary);
  line-height: 1.35;
}
</style>
