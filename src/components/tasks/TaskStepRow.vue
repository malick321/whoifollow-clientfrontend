<script setup lang="ts">
import { ref, watch } from 'vue'
import AppIcon from '../AppIcon.vue'
import type { TaskStep } from '../../api/tasks'

const props = defineProps<{
  step: TaskStep
  busy?: boolean
}>()

const emit = defineEmits<{
  (event: 'update', value: { title?: string; isCompleted?: boolean }): void
  (event: 'delete'): void
}>()

const draftTitle = ref(props.step.title)

watch(
  () => props.step,
  (step) => {
    draftTitle.value = step.title
  },
  { deep: true }
)

function commitTitle() {
  const title = draftTitle.value.trim()
  if (!title) {
    draftTitle.value = props.step.title
    return
  }
  if (title !== props.step.title) emit('update', { title })
}
</script>

<template>
  <div class="task-step-row" :class="{ 'task-step-row--complete': step.isCompleted }">
    <button
      type="button"
      class="task-step-row__check"
      :class="{ 'task-step-row__check--on': step.isCompleted }"
      :disabled="busy"
      :aria-pressed="step.isCompleted ? 'true' : 'false'"
      :aria-label="step.isCompleted ? 'Mark step incomplete' : 'Mark step complete'"
      @click="emit('update', { isCompleted: !step.isCompleted })"
    >
      <svg class="task-step-row__tick" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3.5 8.5 6.5 11.5 12.5 5" />
      </svg>
    </button>
    <input
      v-model="draftTitle"
      class="task-step-row__input"
      :disabled="busy"
      @blur="commitTitle"
      @keydown.enter.prevent="commitTitle"
    />
    <button
      type="button"
      class="task-step-row__delete"
      :disabled="busy"
      aria-label="Delete step"
      @click="emit('delete')"
    >
      <AppIcon name="close" :size="14" />
    </button>
  </div>
</template>

<style scoped>
.task-step-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 2px 4px;
  border-radius: 6px;
  transition: background-color 120ms ease;
}

.task-step-row:hover {
  background: var(--surface-pill);
}

.task-step-row:hover .task-step-row__delete {
  opacity: 1;
}

/* ── Round mini checkbox (matches list item) ──────────────────────── */
.task-step-row__check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 1.5px solid var(--border-accent-hover);
  border-radius: 50%;
  background: transparent;
  color: var(--white);
  cursor: pointer;
  transition: background-color 160ms ease, border-color 160ms ease, transform 120ms ease;
}

.task-step-row__check:hover:not(:disabled) {
  border-color: var(--primary);
}

.task-step-row__check:active:not(:disabled) {
  transform: scale(0.9);
}

.task-step-row__check--on {
  border-color: var(--primary);
  background: var(--primary);
  animation: task-step-check-pop 220ms ease;
}

@keyframes task-step-check-pop {
  0% { transform: scale(1); }
  45% { transform: scale(1.18); }
  100% { transform: scale(1); }
}

.task-step-row__check:disabled {
  cursor: progress;
}

.task-step-row__tick {
  width: 13px;
  height: 13px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 18;
  stroke-dashoffset: 18;
  transition: stroke-dashoffset 200ms ease 40ms;
}

.task-step-row__check--on .task-step-row__tick {
  stroke-dashoffset: 0;
}

/* ── Editable step title ──────────────────────────────────────────── */
.task-step-row__input {
  min-width: 0;
  height: 36px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: var(--text);
  font-family: var(--font-body);
  font-size: 0.9rem;
  font-weight: 500;
}

.task-step-row__input:focus {
  border-color: var(--border-accent-hover);
  background: var(--surface-opaque);
  outline: none;
}

.task-step-row--complete .task-step-row__input {
  color: var(--text-light);
  text-decoration: line-through;
}

/* ── Delete ───────────────────────────────────────────────────────── */
.task-step-row__delete {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-light);
  cursor: pointer;
  opacity: 0;
  transition: background-color 120ms ease, color 120ms ease, opacity 120ms ease;
}

.task-step-row__delete:hover:not(:disabled) {
  background: var(--danger-light);
  color: #c2354a;
}

.task-step-row__delete:disabled,
.task-step-row__input:disabled {
  cursor: progress;
  opacity: 0.7;
}
</style>
