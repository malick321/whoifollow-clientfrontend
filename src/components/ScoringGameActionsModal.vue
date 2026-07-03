<script setup lang="ts">
// ScoringGameActionsModal
// -----------------------
// Popup shown when a scorekeeper / umpire taps a permitted game
// cell on the matchgeni Calendar surface. Lays out the game info
// header + a stack of action buttons (Start / Mark delayed /
// Enter score by inning / Upload scanned sheet).
//
// v1 actions are stubs — they `emit('action', name)` and the
// caller can console.log or wire to the real endpoints. The
// modal itself doesn't know what each action means; that keeps
// the component reusable across surfaces (umpire page later
// will use the same modal with a narrower action set).

import { computed } from 'vue'
import type { SchedulerGame } from '../types'

const props = defineProps<{
  /** Two-way visibility — parent owns the open state. */
  open: boolean
  /** Game whose actions are being shown. `null` while closed (or
   *  during the close-out animation) so the parent doesn't have
   *  to keep the last-shown game in state. */
  game: SchedulerGame | null
  /** Resolved division name for the game header. Parent resolves
   *  it (it owns the division catalogue) — keeps the modal
   *  data-fetch-free. */
  divisionName?: string
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'action', action: ScoringAction): void
}>()

/** Action identifiers emitted to the parent. Stays a string union
 *  so any new action just needs to extend this type + add a
 *  button below — no other API change. */
export type ScoringAction =
  | 'start'
  | 'delay'
  | 'enter-inning'
  | 'upload-scan'

/** Action button config. Title + tone + emitted id. `tone` drives
 *  the button's visual treatment — `primary` for the recommended
 *  next action, `neutral` for everything else. */
interface ActionButton {
  id: ScoringAction
  label: string
  description: string
  tone: 'primary' | 'neutral'
}

const actions: ActionButton[] = [
  {
    id: 'start',
    label: 'Start game',
    description: 'Move the game from scheduled to live and start the clock.',
    tone: 'primary'
  },
  {
    id: 'delay',
    label: 'Mark as delayed',
    description: 'Flag the game as delayed and notify the event roster.',
    tone: 'neutral'
  },
  {
    id: 'enter-inning',
    label: 'Enter score by inning',
    description: 'Live-score the game inning by inning.',
    tone: 'neutral'
  },
  {
    id: 'upload-scan',
    label: 'Upload scanned sheet',
    description: 'Attach a photo / scan of the paper scoresheet.',
    tone: 'neutral'
  }
]

const slotLine = computed(() => {
  if (!props.game) return ''
  const parts: string[] = []
  if (props.game.scheduledTime) parts.push(props.game.scheduledTime)
  if (props.game.scheduledFieldLabel) parts.push(props.game.scheduledFieldLabel)
  return parts.join(' · ')
})

function onClose() { emit('close') }
function onAction(id: ScoringAction) { emit('action', id) }

/** Click-outside / backdrop close — clicking the dimmed area
 *  outside the dialog closes the modal. Clicking inside the
 *  dialog body intentionally does NOT (stopPropagation). */
function onBackdropClick(evt: MouseEvent) {
  if (evt.target === evt.currentTarget) onClose()
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && game"
      class="scoring-actions"
      role="dialog"
      aria-modal="true"
      :aria-label="`Actions for ${game.label}`"
      @click="onBackdropClick"
    >
      <div class="scoring-actions__dialog" @click.stop>
        <header class="scoring-actions__header">
          <div class="scoring-actions__title-block">
            <span v-if="divisionName" class="scoring-actions__division">{{ divisionName }}</span>
            <h2 class="scoring-actions__title">{{ game.label }}</h2>
            <div class="scoring-actions__teams">
              <span v-if="game.team1Label">{{ game.team1Label }}</span>
              <span v-if="game.team2Label && game.team1Label" class="scoring-actions__vs">vs</span>
              <span v-if="game.team2Label">{{ game.team2Label }}</span>
            </div>
            <p v-if="slotLine" class="scoring-actions__slot">{{ slotLine }}</p>
          </div>
          <button
            type="button"
            class="scoring-actions__close"
            aria-label="Close"
            @click="onClose"
          >×</button>
        </header>

        <div class="scoring-actions__body">
          <button
            v-for="action in actions"
            :key="action.id"
            type="button"
            class="scoring-actions__action"
            :class="{ 'scoring-actions__action--primary': action.tone === 'primary' }"
            @click="onAction(action.id)"
          >
            <span class="scoring-actions__action-label">{{ action.label }}</span>
            <span class="scoring-actions__action-desc">{{ action.description }}</span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.scoring-actions {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(13, 30, 58, 0.55);
}

.scoring-actions__dialog {
  width: 100%;
  max-width: 440px;
  max-height: calc(100vh - 32px);
  display: flex;
  flex-direction: column;
  background: var(--white);
  border-radius: 12px;
  box-shadow: 0 18px 48px rgba(13, 30, 58, 0.28);
  overflow: hidden;
}
html.dark-mode .scoring-actions__dialog {
  background: #1a2028;
}

.scoring-actions__header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 18px 18px 14px;
  border-bottom: 1px solid var(--border-divider);
}
.scoring-actions__title-block {
  flex: 1 1 auto;
  min-width: 0;
}
.scoring-actions__division {
  display: block;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--primary);
  margin-bottom: 4px;
}
.scoring-actions__title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--text);
  line-height: 1.2;
}
.scoring-actions__teams {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text);
}
.scoring-actions__vs {
  color: var(--secondary);
  font-weight: 400;
}
.scoring-actions__slot {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--secondary);
}
.scoring-actions__close {
  appearance: none;
  background: none;
  border: none;
  font-size: 26px;
  line-height: 1;
  color: var(--secondary);
  cursor: pointer;
  padding: 0 4px;
  margin-top: -4px;
}
.scoring-actions__close:hover {
  color: var(--text);
}

.scoring-actions__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 18px 18px;
  overflow-y: auto;
}

.scoring-actions__action {
  appearance: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border-radius: 8px;
  border: 1px solid var(--border-divider);
  background: var(--surface-card);
  text-align: left;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
}
.scoring-actions__action:hover {
  border-color: var(--border-accent);
  box-shadow: 0 2px 6px rgba(36, 60, 91, 0.08);
}
.scoring-actions__action--primary {
  background: var(--primary);
  border-color: var(--primary);
}
.scoring-actions__action--primary .scoring-actions__action-label,
.scoring-actions__action--primary .scoring-actions__action-desc {
  color: #ffffff;
}
.scoring-actions__action--primary:hover {
  background: var(--primary-dark, var(--primary));
}

.scoring-actions__action-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.scoring-actions__action-desc {
  font-size: 12px;
  color: var(--secondary);
  line-height: 1.3;
}
.scoring-actions__action--primary .scoring-actions__action-desc {
  color: rgba(255, 255, 255, 0.85);
}
</style>
