<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppIcon from '../AppIcon.vue'
import ToggleSwitch from '../ToggleSwitch.vue'
import TaskStepRow from './TaskStepRow.vue'
import type { Task, TaskMedia, UpdateTaskPayload, UpdateTaskStepPayload } from '../../api/tasks'
import { describeDueDate, describeDueDateLong } from './taskDate'

const props = defineProps<{
  task: Task
  saving?: boolean
  mediaUploading?: boolean
}>()

const emit = defineEmits<{
  (event: 'update-task', value: UpdateTaskPayload): void
  (event: 'toggle-complete'): void
  (event: 'toggle-important'): void
  (event: 'add-step', title: string): void
  (event: 'update-step', value: { stepId: string; payload: UpdateTaskStepPayload }): void
  (event: 'delete-step', stepId: string): void
  (event: 'upload-media', files: File[]): void
  (event: 'delete-media', mediaId: string): void
  (event: 'delete-task'): void
}>()

const draftTitle = ref('')
const draftNote = ref('')
const draftDueDate = ref('')
const newStepTitle = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)
const dragOver = ref(false)

watch(
  () => props.task,
  (task) => {
    draftTitle.value = task.title
    draftNote.value = task.note
    draftDueDate.value = task.dueDate ?? ''
    newStepTitle.value = ''
  },
  { immediate: true }
)

const completedSteps = computed(() => props.task.steps.filter((step) => step.isCompleted).length)
const stepProgress = computed(() => {
  const total = props.task.steps.length
  return total ? Math.round((completedSteps.value / total) * 100) : 0
})
const due = computed(() => describeDueDate(props.task.dueDate))
const dueLong = computed(() => describeDueDateLong(props.task.dueDate))

/** Local `YYYY-MM-DD` string for a date `offset` days from today. */
function isoOffset(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

const dueQuickChips = computed(() => [
  { key: 'today', label: 'Today', value: isoOffset(0) },
  { key: 'tomorrow', label: 'Tomorrow', value: isoOffset(1) },
  { key: 'week', label: 'Next week', value: isoOffset(7) }
])

function setDueDate(value: string) {
  draftDueDate.value = value
  if ((props.task.dueDate ?? null) !== value) emit('update-task', { dueDate: value })
}

function commitTitle() {
  const title = draftTitle.value.trim()
  if (!title) {
    draftTitle.value = props.task.title
    return
  }
  if (title !== props.task.title) emit('update-task', { title })
}

function commitNote() {
  if (draftNote.value !== props.task.note) emit('update-task', { note: draftNote.value })
}

function commitDueDate() {
  const dueDate = draftDueDate.value || null
  if ((props.task.dueDate ?? null) !== dueDate) emit('update-task', { dueDate })
}

function clearDueDate() {
  if (!draftDueDate.value && !props.task.dueDate) return
  draftDueDate.value = ''
  emit('update-task', { dueDate: null })
}

function addStep() {
  const title = newStepTitle.value.trim()
  if (!title) return
  emit('add-step', title)
  newStepTitle.value = ''
}

function emitFiles(files: File[]) {
  if (files.length) emit('upload-media', files)
}

function onFilesSelected(event: Event) {
  const input = event.target as HTMLInputElement
  emitFiles(Array.from(input.files ?? []))
  input.value = ''
}

function onDrop(event: DragEvent) {
  dragOver.value = false
  emitFiles(Array.from(event.dataTransfer?.files ?? []))
}

function isImage(media: TaskMedia): boolean {
  if (media.type && /^image\//i.test(media.type)) return true
  return /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|$)/i.test(media.url)
}

function mediaSubLabel(media: TaskMedia): string {
  const ext = media.type ?? media.name.split('.').pop()
  return ext ? ext.toUpperCase() : 'FILE'
}
</script>

<template>
  <section class="task-detail">
    <!-- Title + status row -->
    <header class="task-detail__header">
      <button
        type="button"
        class="task-detail__check"
        :class="{ 'task-detail__check--on': task.isCompleted }"
        :disabled="saving"
        :aria-pressed="task.isCompleted ? 'true' : 'false'"
        :aria-label="task.isCompleted ? 'Mark incomplete' : 'Mark complete'"
        @click="emit('toggle-complete')"
      >
        <svg class="task-detail__tick" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 8.5 6.5 11.5 12.5 5" />
        </svg>
      </button>
      <input
        v-model="draftTitle"
        class="task-detail__title"
        :class="{ 'task-detail__title--done': task.isCompleted }"
        :disabled="saving"
        placeholder="Task title"
        @blur="commitTitle"
        @keydown.enter.prevent="commitTitle"
      />
      <button
        type="button"
        class="task-detail__star"
        :class="{ 'task-detail__star--on': task.isImportant }"
        :disabled="saving"
        :aria-pressed="task.isImportant ? 'true' : 'false'"
        :aria-label="task.isImportant ? 'Remove importance' : 'Mark important'"
        @click="emit('toggle-important')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" class="task-detail__star-icon">
          <path
            d="M12 3.6l2.43 4.93 5.44.79-3.94 3.84.93 5.42L12 16.83l-4.86 2.55.93-5.42-3.94-3.84 5.44-.79z"
          />
        </svg>
      </button>
    </header>

    <!-- Due date control -->
    <div class="task-detail__section">
      <div class="task-detail__section-head">
        <h3>
          <AppIcon name="calendar" :size="15" />
          Due date
        </h3>
        <span
          v-if="due.tone !== 'none'"
          class="task-detail__due-chip"
          :data-tone="due.tone"
        >{{ due.label }}</span>
      </div>
      <div class="task-detail__due-quick">
        <button
          v-for="chip in dueQuickChips"
          :key="chip.key"
          type="button"
          class="task-detail__due-quick-btn"
          :class="{ 'task-detail__due-quick-btn--active': draftDueDate === chip.value }"
          :disabled="saving"
          @click="setDueDate(chip.value)"
        >
          <AppIcon name="clock" :size="13" />
          {{ chip.label }}
        </button>
      </div>
      <div class="task-detail__due">
        <input
          v-model="draftDueDate"
          type="date"
          class="task-detail__date-input"
          :disabled="saving"
          @blur="commitDueDate"
          @change="commitDueDate"
        />
        <button
          v-if="draftDueDate"
          type="button"
          class="task-detail__date-clear"
          :disabled="saving"
          aria-label="Clear due date"
          @click="clearDueDate"
        >
          <AppIcon name="close" :size="13" />
        </button>
      </div>
      <p v-if="dueLong" class="task-detail__due-long" :data-tone="due.tone">{{ dueLong }}</p>
    </div>

    <!-- Steps -->
    <div class="task-detail__section">
      <div class="task-detail__section-head">
        <h3>
          <AppIcon name="task" :size="15" />
          Steps
        </h3>
        <span class="task-detail__count">{{ completedSteps }}/{{ task.steps.length }}</span>
      </div>
      <div v-if="task.steps.length" class="task-detail__progress" aria-hidden="true">
        <span class="task-detail__progress-fill" :style="{ width: `${stepProgress}%` }"></span>
      </div>
      <div v-if="task.steps.length" class="task-detail__steps">
        <TaskStepRow
          v-for="step in task.steps"
          :key="step.id"
          :step="step"
          :busy="saving"
          @update="emit('update-step', { stepId: step.id, payload: $event })"
          @delete="emit('delete-step', step.id)"
        />
      </div>
      <p v-else class="task-detail__empty">No steps yet. Break this task down below.</p>
      <form class="task-detail__add-step" @submit.prevent="addStep">
        <span class="task-detail__add-step-icon"><AppIcon name="task" :size="15" /></span>
        <input
          v-model="newStepTitle"
          type="text"
          placeholder="Add a step"
          :disabled="saving"
        />
        <button type="submit" class="secondary-button" :disabled="saving || !newStepTitle.trim()">Add step</button>
      </form>
    </div>

    <!-- Notes -->
    <div class="task-detail__section">
      <div class="task-detail__section-head">
        <h3>
          <AppIcon name="text" :size="15" />
          Notes
        </h3>
      </div>
      <textarea
        v-model="draftNote"
        rows="5"
        class="task-detail__notes"
        placeholder="Add notes, links, or context for this task…"
        :disabled="saving"
        @blur="commitNote"
      ></textarea>
    </div>

    <!-- Media -->
    <div class="task-detail__section">
      <div class="task-detail__section-head">
        <h3>
          <AppIcon name="folder" :size="15" />
          Attachments
        </h3>
        <button
          type="button"
          class="secondary-button task-detail__upload-btn"
          :disabled="mediaUploading"
          @click="fileInputRef?.click()"
        >{{ mediaUploading ? 'Uploading…' : 'Upload' }}</button>
        <input
          ref="fileInputRef"
          class="task-detail__file-input"
          type="file"
          multiple
          @change="onFilesSelected"
        />
      </div>

      <div
        v-if="task.media.length"
        class="task-detail__media-grid"
      >
        <div v-for="media in task.media" :key="media.id" class="task-detail__media">
          <a
            class="task-detail__media-preview"
            :href="media.url"
            target="_blank"
            rel="noopener noreferrer"
          >
            <img v-if="isImage(media)" :src="media.url" :alt="media.name" loading="lazy" />
            <span v-else class="task-detail__media-ext">
              <AppIcon name="document" :size="20" />
              {{ mediaSubLabel(media) }}
            </span>
          </a>
          <div class="task-detail__media-foot">
            <span class="task-detail__media-name" :title="media.name">{{ media.name }}</span>
            <button
              type="button"
              class="task-detail__media-remove"
              aria-label="Delete attachment"
              :disabled="saving"
              @click="emit('delete-media', media.id)"
            >
              <AppIcon name="close" :size="13" />
            </button>
          </div>
        </div>
      </div>

      <button
        v-else
        type="button"
        class="task-detail__dropzone"
        :class="{ 'task-detail__dropzone--over': dragOver }"
        :disabled="mediaUploading"
        @click="fileInputRef?.click()"
        @dragover.prevent="dragOver = true"
        @dragleave.prevent="dragOver = false"
        @drop.prevent="onDrop"
      >
        <AppIcon name="folder" :size="22" />
        <span>Drop files here or <strong>browse</strong></span>
      </button>
    </div>

    <footer class="task-detail__footer">
      <button type="button" class="danger-light-button" :disabled="saving" @click="emit('delete-task')">
        Delete task
      </button>
    </footer>
  </section>
</template>

<style scoped>
.task-detail {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 16px;
}

/* ── Header: round check + title + star ───────────────────────────── */
.task-detail__header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  margin-bottom: 2px;
  padding: 14px 14px 16px;
  border: 1px solid var(--border-divider);
  border-radius: 12px;
  background:
    radial-gradient(120% 160% at 100% 0%, var(--primary-light-3) 0%, transparent 60%),
    var(--surface-card);
}

.task-detail__check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1.5px solid var(--border-accent-hover);
  border-radius: 50%;
  background: transparent;
  color: var(--white);
  cursor: pointer;
  transition: background-color 160ms ease, border-color 160ms ease, transform 120ms ease;
}

.task-detail__check:hover:not(:disabled) {
  border-color: var(--primary);
}

.task-detail__check:active:not(:disabled) {
  transform: scale(0.9);
}

.task-detail__check--on {
  border-color: var(--primary);
  background: var(--primary);
  animation: task-detail-check-pop 220ms ease;
}

@keyframes task-detail-check-pop {
  0% { transform: scale(1); }
  45% { transform: scale(1.16); }
  100% { transform: scale(1); }
}

.task-detail__check:disabled {
  cursor: progress;
}

.task-detail__tick {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 18;
  stroke-dashoffset: 18;
  transition: stroke-dashoffset 200ms ease 40ms;
}

.task-detail__check--on .task-detail__tick {
  stroke-dashoffset: 0;
}

.task-detail__title {
  width: 100%;
  min-width: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font-family: var(--font-body);
  font-size: 1.3rem;
  font-weight: 500;
  letter-spacing: 0;
  outline: none;
  padding: 5px 8px;
  transition: background-color 120ms ease, border-color 120ms ease;
}

.task-detail__title:hover:not(:disabled) {
  background: var(--surface-pill);
}

.task-detail__title:focus {
  border-color: var(--border-accent-hover);
  background: var(--surface-opaque);
}

.task-detail__title--done {
  color: var(--text-light);
  text-decoration: line-through;
}

.task-detail__star {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-light);
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease, transform 120ms ease;
}

.task-detail__star-icon {
  width: 21px;
  height: 21px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linejoin: round;
  transition: fill 160ms ease, stroke 160ms ease;
}

.task-detail__star:hover:not(:disabled) {
  background: var(--surface-pill);
  color: var(--primary);
}

.task-detail__star:active:not(:disabled) {
  transform: scale(0.88);
}

.task-detail__star--on {
  color: var(--warning);
}

.task-detail__star--on .task-detail__star-icon {
  fill: var(--warning);
  stroke: var(--warning);
}

/* ── Sections ─────────────────────────────────────────────────────── */
.task-detail__section {
  display: flex;
  flex-direction: column;
  gap: 11px;
  padding: 15px;
  border: 1px solid var(--border-divider);
  border-radius: 12px;
  background: var(--surface-card);
  transition: border-color 160ms ease, box-shadow 160ms ease;
}

.task-detail__section:focus-within {
  border-color: var(--border-accent-hover);
  box-shadow: 0 0 0 3px var(--primary-light-3);
}

.task-detail__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.task-detail__section h3 {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--text);
  font-size: 0.92rem;
  font-weight: 500;
}

.task-detail__section h3 :deep(.app-icon) {
  color: var(--primary);
}

.task-detail__count {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 9px;
  border-radius: 999px;
  background: var(--surface-pill);
  color: var(--text-light);
  font-size: 0.76rem;
  font-weight: 500;
}

.task-detail__empty {
  margin: 0;
  padding: 4px 2px;
  color: var(--text-light);
  font-size: 0.84rem;
}

/* ── Due date ─────────────────────────────────────────────────────── */
.task-detail__due {
  display: flex;
  align-items: center;
  gap: 8px;
}

.task-detail__date-input {
  flex: 1;
  min-width: 0;
  height: 40px;
  padding: 0 12px;
  border: 1px solid var(--border-divider);
  border-radius: 6px;
  background: var(--surface-opaque);
  color: var(--text);
  font-family: var(--font-body);
  font-size: 0.9rem;
  font-weight: 500;
}

.task-detail__date-input:focus {
  border-color: var(--border-accent-hover);
  outline: none;
}

.task-detail__date-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--border-divider);
  border-radius: 6px;
  background: var(--surface-btn-solid);
  color: var(--text-light);
  cursor: pointer;
  transition: border-color 120ms ease, color 120ms ease;
}

.task-detail__date-clear:hover:not(:disabled) {
  border-color: var(--border-accent-hover);
  color: var(--text);
}

.task-detail__due-chip {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 9px;
  border-radius: 999px;
  font-size: 0.76rem;
  font-weight: 500;
}

.task-detail__due-chip[data-tone='today'] {
  background: var(--primary-light-3);
  color: var(--primary);
}

.task-detail__due-chip[data-tone='soon'],
.task-detail__due-chip[data-tone='future'] {
  background: var(--surface-pill);
  color: var(--text-light);
}

.task-detail__due-chip[data-tone='overdue'] {
  background: var(--danger-light);
  color: #c2354a;
}

/* Quick-pick chips — Today / Tomorrow / Next week. */
.task-detail__due-quick {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.task-detail__due-quick-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 11px;
  border: 1px solid var(--border-divider);
  border-radius: 999px;
  background: var(--surface-opaque);
  color: var(--text-light);
  font-family: var(--font-body);
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 140ms ease, color 140ms ease,
    background-color 140ms ease, transform 120ms ease;
}

.task-detail__due-quick-btn :deep(.app-icon) {
  color: var(--text-light);
  transition: color 140ms ease;
}

.task-detail__due-quick-btn:hover:not(:disabled) {
  border-color: var(--border-accent-hover);
  color: var(--text);
}

.task-detail__due-quick-btn--active {
  border-color: var(--primary);
  background: var(--primary-light-3);
  color: var(--primary);
}

.task-detail__due-quick-btn--active :deep(.app-icon) {
  color: var(--primary);
}

.task-detail__due-quick-btn:active:not(:disabled) {
  transform: scale(0.96);
}

.task-detail__due-quick-btn:disabled {
  cursor: progress;
  opacity: 0.6;
}

.task-detail__due-long {
  margin: 0;
  color: var(--text-light);
  font-size: 0.8rem;
  font-weight: 500;
}

.task-detail__due-long[data-tone='overdue'] {
  color: #c2354a;
}

.task-detail__due-long[data-tone='today'] {
  color: var(--primary);
}

/* ── Steps ────────────────────────────────────────────────────────── */
.task-detail__progress {
  height: 5px;
  border-radius: 999px;
  background: var(--surface-pill);
  overflow: hidden;
}

.task-detail__progress-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--primary);
  transition: width 240ms ease;
}

.task-detail__steps {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.task-detail__add-step {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
  padding: 4px 10px 4px 8px;
  border: 1px dashed var(--border-divider);
  border-radius: 6px;
}

.task-detail__add-step:focus-within {
  border-color: var(--border-accent-hover);
  border-style: solid;
}

.task-detail__add-step-icon {
  display: inline-flex;
  color: var(--text-light);
}

.task-detail__add-step input {
  min-width: 0;
  height: 36px;
  border: none;
  background: transparent;
  color: var(--text);
  font-family: var(--font-body);
  font-size: 0.9rem;
  font-weight: 500;
  outline: none;
}

/* ── Notes ────────────────────────────────────────────────────────── */
.task-detail__notes {
  width: 100%;
  min-height: 112px;
  padding: 10px 12px;
  border: 1px solid var(--border-divider);
  border-radius: 6px;
  background: var(--surface-opaque);
  color: var(--text);
  font-family: var(--font-body);
  font-size: 0.9rem;
  font-weight: 500;
  line-height: 1.5;
  resize: vertical;
}

.task-detail__notes:focus {
  border-color: var(--border-accent-hover);
  outline: none;
}

/* ── Media ────────────────────────────────────────────────────────── */
.task-detail__upload-btn {
  min-height: 32px;
  padding: 0 14px;
}

.task-detail__file-input {
  display: none;
}

.task-detail__media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(108px, 1fr));
  gap: 10px;
}

.task-detail__media {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-divider);
  border-radius: 8px;
  background: var(--surface-opaque);
  overflow: hidden;
  transition: border-color 120ms ease;
}

.task-detail__media:hover {
  border-color: var(--border-accent-hover);
}

.task-detail__media-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 16 / 11;
  background: var(--surface-pill);
  color: var(--text-light);
  text-decoration: none;
  overflow: hidden;
}

.task-detail__media-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 220ms ease;
}

.task-detail__media:hover .task-detail__media-preview img {
  transform: scale(1.05);
}

.task-detail__media-ext {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-size: 0.68rem;
  font-weight: 500;
  letter-spacing: 0.04em;
}

.task-detail__media-foot {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 6px 6px 9px;
  border-top: 1px solid var(--border-divider);
}

.task-detail__media-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 0.76rem;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-detail__media-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-light);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.task-detail__media-remove:hover:not(:disabled) {
  background: var(--danger-light);
  color: #c2354a;
}

.task-detail__dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  min-height: 96px;
  padding: 18px;
  border: 1px dashed var(--border-divider);
  border-radius: 8px;
  background: transparent;
  color: var(--text-light);
  font-family: var(--font-body);
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 140ms ease, background-color 140ms ease, color 140ms ease;
}

.task-detail__dropzone :deep(.app-icon) {
  color: var(--primary);
}

.task-detail__dropzone strong {
  color: var(--primary);
  font-weight: 500;
}

.task-detail__dropzone:hover:not(:disabled),
.task-detail__dropzone--over {
  border-color: var(--border-accent-hover);
  background: var(--primary-light-3);
  color: var(--text);
}

.task-detail__dropzone:disabled {
  cursor: progress;
  opacity: 0.7;
}

/* ── Footer ───────────────────────────────────────────────────────── */
.task-detail__footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 2px;
  padding-top: 14px;
  border-top: 1px solid var(--border-divider);
}

@media (max-width: 640px) {
  .task-detail__add-step {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .task-detail__add-step .secondary-button {
    grid-column: 1 / -1;
  }

  .task-detail__header,
  .task-detail__section {
    border-radius: 10px;
  }

  .task-detail__section {
    padding: 12px;
  }

  .task-detail__footer {
    position: sticky;
    bottom: calc(-28px - env(safe-area-inset-bottom));
    z-index: 2;
    margin: 4px -16px calc(-28px - env(safe-area-inset-bottom));
    padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
    background: var(--white);
    box-shadow: 0 -10px 20px rgba(15, 23, 42, 0.08);
  }

  .task-detail__footer .danger-light-button {
    width: 100%;
    justify-content: center;
    min-height: 42px;
  }
}
</style>
