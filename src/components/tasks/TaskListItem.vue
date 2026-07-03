<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '../AppIcon.vue'
import type { Task } from '../../api/tasks'
import { describeDueDate } from './taskDate'

const props = defineProps<{
  task: Task
  selected?: boolean
  busy?: boolean
}>()

const emit = defineEmits<{
  (event: 'select'): void
  (event: 'toggle-complete'): void
  (event: 'toggle-important'): void
}>()

const due = computed(() => describeDueDate(props.task.dueDate))
const completedSteps = computed(() => props.task.steps.filter((s) => s.isCompleted).length)
const hasMeta = computed(
  () => due.value.tone !== 'none' || props.task.steps.length > 0 || props.task.media.length > 0
)
</script>

<template>
  <article
    class="task-list-item"
    :class="{
      'task-list-item--selected': selected,
      'task-list-item--complete': task.isCompleted,
      'task-list-item--busy': busy
    }"
    @click="emit('select')"
  >
    <button
      type="button"
      class="task-list-item__check"
      :class="{ 'task-list-item__check--on': task.isCompleted }"
      :disabled="busy"
      :aria-pressed="task.isCompleted ? 'true' : 'false'"
      :aria-label="task.isCompleted ? 'Mark incomplete' : 'Mark complete'"
      @click.stop="emit('toggle-complete')"
    >
      <svg class="task-list-item__tick" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3.5 8.5 6.5 11.5 12.5 5" />
      </svg>
    </button>

    <div class="task-list-item__main">
      <span class="task-list-item__title">{{ task.title }}</span>
      <span v-if="hasMeta" class="task-list-item__meta">
        <span
          v-if="due.tone !== 'none'"
          class="task-list-item__chip"
          :data-tone="due.tone"
        >
          <AppIcon name="calendar" :size="12" />
          {{ due.label }}
        </span>
        <span v-if="task.steps.length" class="task-list-item__pill">
          <AppIcon name="task" :size="12" />
          {{ completedSteps }}/{{ task.steps.length }}
        </span>
        <span v-if="task.media.length" class="task-list-item__pill">
          <AppIcon name="document" :size="12" />
          {{ task.media.length }}
        </span>
      </span>
    </div>

    <button
      type="button"
      class="task-list-item__star"
      :class="{ 'task-list-item__star--on': task.isImportant }"
      :disabled="busy"
      :aria-pressed="task.isImportant ? 'true' : 'false'"
      :aria-label="task.isImportant ? 'Remove importance' : 'Mark important'"
      @click.stop="emit('toggle-important')"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" class="task-list-item__star-icon">
        <path
          d="M12 3.6l2.43 4.93 5.44.79-3.94 3.84.93 5.42L12 16.83l-4.86 2.55.93-5.42-3.94-3.84 5.44-.79z"
        />
      </svg>
    </button>
  </article>
</template>

<style scoped>
.task-list-item {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-height: 64px;
  padding: 11px 13px;
  border: 1px solid var(--border-divider);
  border-radius: 10px;
  background: var(--surface-card);
  cursor: pointer;
  overflow: hidden;
  transition: border-color 150ms ease, background-color 150ms ease,
    box-shadow 150ms ease, transform 150ms ease;
}

/* Left accent rail — appears for important tasks and on selection. */
.task-list-item::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 3px;
  background: var(--primary);
  opacity: 0;
  transition: opacity 150ms ease;
}

.task-list-item:hover {
  border-color: var(--border-accent-hover);
  box-shadow: var(--shadow-soft);
  transform: translateY(-1px);
}

.task-list-item--selected {
  border-color: var(--primary);
  background: var(--primary-light-3);
  box-shadow: var(--shadow-soft);
}

.task-list-item--selected::before {
  opacity: 1;
}

.task-list-item--complete {
  background: var(--surface-pill);
}

.task-list-item--busy {
  opacity: 0.7;
}

/* ── Round animated checkbox ───────────────────────────────────────── */
.task-list-item__check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1.5px solid var(--border-accent-hover);
  border-radius: 50%;
  background: transparent;
  color: var(--white);
  cursor: pointer;
  transition: background-color 160ms ease, border-color 160ms ease, transform 120ms ease;
}

.task-list-item__check:hover:not(:disabled) {
  border-color: var(--primary);
}

.task-list-item__check:active:not(:disabled) {
  transform: scale(0.9);
}

.task-list-item__check--on {
  border-color: var(--primary);
  background: var(--primary);
  animation: task-check-pop 220ms ease;
}

@keyframes task-check-pop {
  0% { transform: scale(1); }
  45% { transform: scale(1.18); }
  100% { transform: scale(1); }
}

.task-list-item__check:disabled {
  cursor: progress;
}

.task-list-item__tick {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 18;
  stroke-dashoffset: 18;
  transition: stroke-dashoffset 200ms ease 40ms;
}

.task-list-item__check--on .task-list-item__tick {
  stroke-dashoffset: 0;
}

/* ── Main body ─────────────────────────────────────────────────────── */
.task-list-item__main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 5px;
}

.task-list-item__title {
  max-width: 100%;
  overflow: hidden;
  color: var(--text);
  font-size: 0.95rem;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 140ms ease;
}

.task-list-item--complete .task-list-item__title {
  color: var(--text-light);
  text-decoration: line-through;
}

.task-list-item__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.task-list-item__chip,
.task-list-item__pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 21px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 500;
  line-height: 1;
}

.task-list-item__chip :deep(.app-icon),
.task-list-item__pill :deep(.app-icon) {
  display: inline-flex;
}

.task-list-item__pill {
  background: var(--surface-pill);
  color: var(--text-light);
}

.task-list-item__chip[data-tone='today'] {
  background: var(--primary-light-3);
  color: var(--primary);
}

.task-list-item__chip[data-tone='soon'],
.task-list-item__chip[data-tone='future'] {
  background: var(--surface-pill);
  color: var(--text-light);
}

.task-list-item__chip[data-tone='overdue'] {
  background: var(--danger-light);
  color: #c2354a;
}

/* ── Importance star ───────────────────────────────────────────────── */
.task-list-item__star {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-light);
  cursor: pointer;
  opacity: 0.45;
  transition: background-color 140ms ease, color 140ms ease,
    transform 120ms ease, opacity 140ms ease;
}

/* Star stays muted until it matters — revealed on row hover or when set. */
.task-list-item:hover .task-list-item__star,
.task-list-item__star--on,
.task-list-item__star:focus-visible {
  opacity: 1;
}

.task-list-item__star-icon {
  width: 19px;
  height: 19px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linejoin: round;
  transition: fill 160ms ease, stroke 160ms ease;
}

.task-list-item__star:hover:not(:disabled) {
  background: var(--surface-pill);
  color: var(--primary);
}

.task-list-item__star:active:not(:disabled) {
  transform: scale(0.88);
}

.task-list-item__star--on {
  color: var(--warning);
}

.task-list-item__star--on .task-list-item__star-icon {
  fill: var(--warning);
  stroke: var(--warning);
}

.task-list-item__star:disabled {
  cursor: progress;
  opacity: 0.7;
}

@media (prefers-reduced-motion: reduce) {
  .task-list-item,
  .task-list-item__check--on {
    transition: none;
    animation: none;
  }
}
</style>
