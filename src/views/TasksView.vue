<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import SlideModal from '../components/SlideModal.vue'
import TaskDetailPanel from '../components/tasks/TaskDetailPanel.vue'
import TaskListItem from '../components/tasks/TaskListItem.vue'
import { confirmDialog } from '../confirm-center'
import {
  addTaskStep,
  createTask,
  deleteTask,
  deleteTaskMedia,
  deleteTaskStep,
  fetchTasks,
  toggleTaskComplete,
  toggleTaskImportant,
  updateTask,
  updateTaskStep,
  uploadTaskMedia,
  type Task,
  type TaskFilter,
  type UpdateTaskPayload,
  type UpdateTaskStepPayload
} from '../api/tasks'
import { pushToast } from '../toast-center'

const FILTERS: { value: TaskFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'important', label: 'Important' },
  { value: 'completed', label: 'Completed' },
  { value: 'today', label: 'Today' }
]

const tasks = ref<Task[]>([])
const selectedTaskId = ref<string | null>(null)
const filter = ref<TaskFilter>('all')
const loading = ref(true)
const savingIds = ref<Set<string>>(new Set())
const mediaUploading = ref(false)
const newTaskTitle = ref('')
const isNarrow = ref(false)

const selectedTask = computed(() =>
  selectedTaskId.value
    ? tasks.value.find((task) => task.id === selectedTaskId.value) ?? null
    : null
)

const completedCount = computed(() => tasks.value.filter((task) => task.isCompleted).length)
const remainingCount = computed(() => tasks.value.filter((task) => !task.isCompleted).length)
const progressPct = computed(() =>
  tasks.value.length ? Math.round((completedCount.value / tasks.value.length) * 100) : 0
)

function setSaving(taskId: string, value: boolean) {
  const next = new Set(savingIds.value)
  if (value) next.add(taskId)
  else next.delete(taskId)
  savingIds.value = next
}

function replaceTask(task: Task) {
  const index = tasks.value.findIndex((item) => item.id === task.id)
  if (index === -1) {
    tasks.value = [task, ...tasks.value]
  } else {
    tasks.value = [
      ...tasks.value.slice(0, index),
      task,
      ...tasks.value.slice(index + 1)
    ]
  }
}

async function loadTasks() {
  loading.value = true
  try {
    tasks.value = await fetchTasks(filter.value)
    if (!tasks.value.some((task) => task.id === selectedTaskId.value)) {
      selectedTaskId.value = isNarrow.value ? null : tasks.value[0]?.id ?? null
    }
  } catch (error) {
    tasks.value = []
    selectedTaskId.value = null
    pushToast({
      tone: 'warning',
      title: 'Could not load tasks',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    loading.value = false
  }
}

async function addTask() {
  const title = newTaskTitle.value.trim()
  if (!title) return
  newTaskTitle.value = ''
  try {
    const task = await createTask({ title })
    tasks.value = [task, ...tasks.value]
    selectedTaskId.value = task.id
  } catch (error) {
    newTaskTitle.value = title
    pushToast({
      tone: 'warning',
      title: 'Could not add task',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  }
}

async function saveTaskPatch(task: Task, payload: UpdateTaskPayload) {
  setSaving(task.id, true)
  try {
    replaceTask(await updateTask(task.id, payload))
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not save task',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    setSaving(task.id, false)
  }
}

async function toggleComplete(task: Task) {
  const previous = tasks.value
  replaceTask({ ...task, isCompleted: !task.isCompleted })
  setSaving(task.id, true)
  try {
    replaceTask(await toggleTaskComplete(task.id))
  } catch (error) {
    tasks.value = previous
    pushToast({
      tone: 'warning',
      title: 'Could not update completion',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    setSaving(task.id, false)
  }
}

async function toggleImportant(task: Task) {
  const previous = tasks.value
  replaceTask({ ...task, isImportant: !task.isImportant })
  setSaving(task.id, true)
  try {
    replaceTask(await toggleTaskImportant(task.id))
  } catch (error) {
    tasks.value = previous
    pushToast({
      tone: 'warning',
      title: 'Could not update importance',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    setSaving(task.id, false)
  }
}

async function addStep(task: Task, title: string) {
  setSaving(task.id, true)
  try {
    replaceTask(await addTaskStep(task.id, title))
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not add step',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    setSaving(task.id, false)
  }
}

async function saveStep(task: Task, stepId: string, payload: UpdateTaskStepPayload) {
  setSaving(task.id, true)
  try {
    replaceTask(await updateTaskStep(stepId, payload))
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not update step',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    setSaving(task.id, false)
  }
}

async function removeStep(task: Task, stepId: string) {
  setSaving(task.id, true)
  try {
    replaceTask(await deleteTaskStep(stepId))
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not delete step',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    setSaving(task.id, false)
  }
}

async function uploadMedia(task: Task, files: File[]) {
  mediaUploading.value = true
  try {
    const media = await uploadTaskMedia(task.id, files)
    replaceTask({ ...task, media })
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not upload media',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    mediaUploading.value = false
  }
}

async function removeMedia(task: Task, mediaId: string) {
  setSaving(task.id, true)
  try {
    await deleteTaskMedia(mediaId)
    replaceTask({ ...task, media: task.media.filter((media) => media.id !== mediaId) })
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not delete media',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    setSaving(task.id, false)
  }
}

async function removeTask(task: Task) {
  if (!(await confirmDialog({
    title: 'Delete this task?',
    message: 'This task and its steps will be permanently removed.',
    confirmLabel: 'Delete',
    danger: true
  }))) return
  setSaving(task.id, true)
  try {
    await deleteTask(task.id)
    tasks.value = tasks.value.filter((item) => item.id !== task.id)
    selectedTaskId.value = tasks.value[0]?.id ?? null
    pushToast({ tone: 'success', title: 'Task deleted' })
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not delete task',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    setSaving(task.id, false)
  }
}

function onFilterClick(next: TaskFilter) {
  if (filter.value === next) return
  filter.value = next
  void loadTasks()
}

function onResize() {
  isNarrow.value = typeof window !== 'undefined' && window.matchMedia('(max-width: 920px)').matches
  if (!isNarrow.value && !selectedTaskId.value && tasks.value.length) {
    selectedTaskId.value = tasks.value[0].id
  }
}

onMounted(() => {
  onResize()
  if (typeof window !== 'undefined') window.addEventListener('resize', onResize)
  void loadTasks()
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('resize', onResize)
})
</script>

<template>
  <section class="tasks-page association-users__main association-users__main--wide">
    <header class="tasks-page__header">
      <div class="tasks-page__heading">
        <p class="tasks-page__eyebrow">My Tasks</p>
        <h1>Tasks</h1>
        <p class="tasks-page__copy">
          <template v-if="loading">Loading your tasks…</template>
          <template v-else-if="tasks.length">{{ completedCount }} of {{ tasks.length }} done · {{ remainingCount }} remaining</template>
          <template v-else>You're all caught up</template>
        </p>
      </div>
      <div class="tasks-page__progress" aria-hidden="true">
        <svg viewBox="0 0 44 44" class="tasks-page__ring">
          <circle class="tasks-page__ring-track" cx="22" cy="22" r="18" />
          <circle
            class="tasks-page__ring-fill"
            cx="22"
            cy="22"
            r="18"
            :stroke-dasharray="113.097"
            :stroke-dashoffset="113.097 * (1 - progressPct / 100)"
          />
        </svg>
        <span class="tasks-page__progress-label">{{ progressPct }}%</span>
      </div>
    </header>

    <div class="tasks-page__layout">
      <aside class="tasks-page__list-panel">
        <div class="tasks-page__filters" role="tablist" aria-label="Task filters">
          <button
            v-for="item in FILTERS"
            :key="item.value"
            type="button"
            role="tab"
            class="tasks-page__filter"
            :class="{ 'tasks-page__filter--active': filter === item.value }"
            :aria-selected="filter === item.value ? 'true' : 'false'"
            @click="onFilterClick(item.value)"
          >
            {{ item.label }}
            <span v-if="filter === item.value && !loading && tasks.length" class="tasks-page__filter-count">{{ tasks.length }}</span>
          </button>
        </div>

        <form class="tasks-page__add" @submit.prevent="addTask">
          <span class="tasks-page__add-icon" aria-hidden="true"><AppIcon name="task" :size="17" /></span>
          <input
            v-model="newTaskTitle"
            type="text"
            placeholder="Add a task"
            :disabled="loading"
          />
          <button type="submit" class="tasks-page__add-btn" :disabled="!newTaskTitle.trim() || loading" aria-label="Add task">
            <AppIcon name="text" :size="16" />
            Add
          </button>
        </form>

        <div v-if="loading" class="tasks-page__loading">
          <div v-for="i in 5" :key="i" class="tasks-page__skeleton">
            <span class="shimmer-circle tasks-page__skeleton-check"></span>
            <span class="tasks-page__skeleton-lines">
              <span class="shimmer-block tasks-page__skeleton-title"></span>
              <span class="shimmer-block tasks-page__skeleton-meta"></span>
            </span>
          </div>
        </div>
        <div v-else-if="!tasks.length" class="tasks-page__empty">
          <span class="tasks-page__empty-icon" aria-hidden="true"><AppIcon name="task" :size="28" /></span>
          <p class="tasks-page__empty-title">No tasks yet</p>
          <p class="tasks-page__empty-copy">Add your first task above to get started.</p>
        </div>
        <div v-else class="tasks-page__list">
          <TaskListItem
            v-for="task in tasks"
            :key="task.id"
            :task="task"
            :selected="selectedTask?.id === task.id"
            :busy="savingIds.has(task.id)"
            @select="selectedTaskId = task.id"
            @toggle-complete="toggleComplete(task)"
            @toggle-important="toggleImportant(task)"
          />
        </div>
      </aside>

      <main v-if="selectedTask && !isNarrow" class="tasks-page__detail-panel">
        <TaskDetailPanel
          :task="selectedTask"
          :saving="savingIds.has(selectedTask.id)"
          :media-uploading="mediaUploading"
          @update-task="saveTaskPatch(selectedTask, $event)"
          @toggle-complete="toggleComplete(selectedTask)"
          @toggle-important="toggleImportant(selectedTask)"
          @add-step="addStep(selectedTask, $event)"
          @update-step="saveStep(selectedTask, $event.stepId, $event.payload)"
          @delete-step="removeStep(selectedTask, $event)"
          @upload-media="uploadMedia(selectedTask, $event)"
          @delete-media="removeMedia(selectedTask, $event)"
          @delete-task="removeTask(selectedTask)"
        />
      </main>
      <main v-else-if="!selectedTask && !isNarrow" class="tasks-page__detail-panel tasks-page__detail-panel--empty">
        <span class="tasks-page__empty-icon" aria-hidden="true"><AppIcon name="task" :size="30" /></span>
        <p class="tasks-page__empty-title">Nothing selected</p>
        <p class="tasks-page__empty-copy">Select a task on the left, or create one to see its details here.</p>
      </main>
    </div>

    <SlideModal
      v-if="selectedTask"
      :model-value="isNarrow && !!selectedTask"
      :title="selectedTask.title || 'Task detail'"
      eyebrow="My Tasks"
      @update:modelValue="selectedTaskId = null"
    >
      <TaskDetailPanel
        :task="selectedTask"
        :saving="savingIds.has(selectedTask.id)"
        :media-uploading="mediaUploading"
        @update-task="saveTaskPatch(selectedTask, $event)"
        @toggle-complete="toggleComplete(selectedTask)"
        @toggle-important="toggleImportant(selectedTask)"
        @add-step="addStep(selectedTask, $event)"
        @update-step="saveStep(selectedTask, $event.stepId, $event.payload)"
        @delete-step="removeStep(selectedTask, $event)"
        @upload-media="uploadMedia(selectedTask, $event)"
        @delete-media="removeMedia(selectedTask, $event)"
        @delete-task="removeTask(selectedTask)"
      />
    </SlideModal>
  </section>
</template>

<style scoped>
.tasks-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding-top: 24px;
}

.tasks-page__header {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 20px 22px;
  border: 1px solid var(--border-divider);
  border-radius: 12px;
  background:
    radial-gradient(120% 140% at 0% 0%, var(--primary-light-3) 0%, transparent 58%),
    var(--surface-card);
  box-shadow: var(--shadow-soft);
  overflow: hidden;
}

.tasks-page__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 6px;
  color: var(--primary);
  font-size: 0.78rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0;
}

.tasks-page__eyebrow::before {
  content: '';
  width: 14px;
  height: 2px;
  border-radius: 999px;
  background: var(--primary);
}

.tasks-page__header h1 {
  margin: 0;
  color: var(--text);
  font-size: clamp(1.6rem, 3vw, 2.2rem);
  font-weight: 500;
  letter-spacing: 0;
}

.tasks-page__copy {
  margin: 8px 0 0;
  color: var(--text-light);
  font-size: 0.95rem;
}

/* ── Progress ring ────────────────────────────────────────────────── */
.tasks-page__progress {
  position: relative;
  flex-shrink: 0;
  width: 56px;
  height: 56px;
}

.tasks-page__ring {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.tasks-page__ring-track {
  fill: none;
  stroke: var(--border-divider);
  stroke-width: 4;
}

.tasks-page__ring-fill {
  fill: none;
  stroke: var(--primary);
  stroke-width: 4;
  stroke-linecap: round;
  transition: stroke-dashoffset 320ms ease;
}

.tasks-page__progress-label {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--text);
  font-size: 0.74rem;
  font-weight: 500;
}

/* ── Layout ───────────────────────────────────────────────────────── */
.tasks-page__layout {
  display: grid;
  grid-template-columns: minmax(320px, 0.92fr) minmax(0, 1.28fr);
  align-items: start;
  gap: 18px;
}

.tasks-page__list-panel,
.tasks-page__detail-panel {
  border: 1px solid var(--border-divider);
  border-radius: 12px;
  background: var(--surface-card);
  box-shadow: var(--shadow-soft);
}

.tasks-page__list-panel {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 14px;
  padding: 14px;
}

.tasks-page__detail-panel {
  min-width: 0;
  padding: 20px;
}

.tasks-page__detail-panel--empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 320px;
  text-align: center;
}

/* ── Segmented filter pills ───────────────────────────────────────── */
.tasks-page__filters {
  display: flex;
  gap: 3px;
  padding: 4px;
  border: 1px solid var(--border-divider);
  border-radius: 10px;
  background: var(--surface-pill);
}

.tasks-page__filter {
  appearance: none;
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex: 1;
  height: 33px;
  padding: 0 10px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text-light);
  font-family: var(--font-body);
  font-size: 0.83rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 160ms ease, color 160ms ease, box-shadow 160ms ease;
}

.tasks-page__filter:hover {
  color: var(--text);
}

.tasks-page__filter--active {
  background: var(--surface-card);
  color: var(--primary);
  box-shadow: var(--shadow-soft);
}

/* Subtle accent underline that grows in under the active tab label. */
.tasks-page__filter--active::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: 5px;
  width: 16px;
  height: 2px;
  border-radius: 999px;
  background: var(--primary);
  transform: translateX(-50%);
}

.tasks-page__filter-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--primary-light-3);
  color: var(--primary);
  font-size: 0.7rem;
  font-weight: 500;
}

/* ── Add task ─────────────────────────────────────────────────────── */
.tasks-page__add {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 4px 6px 4px 12px;
  border: 1px solid var(--border-divider);
  border-radius: 8px;
  background: var(--surface-opaque);
  transition: border-color 140ms ease, box-shadow 140ms ease;
}

.tasks-page__add:focus-within {
  border-color: var(--border-accent-hover);
  box-shadow: 0 0 0 3px var(--primary-light-3);
}

.tasks-page__add-icon {
  display: inline-flex;
  color: var(--text-light);
}

.tasks-page__add input {
  min-width: 0;
  height: 40px;
  border: none;
  background: transparent;
  color: var(--text);
  font-family: var(--font-body);
  font-size: 0.92rem;
  font-weight: 500;
  outline: none;
}

.tasks-page__add-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 0 14px;
  border: none;
  border-radius: 6px;
  background: var(--primary);
  color: #fff;
  font-family: var(--font-body);
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 140ms ease, transform 120ms ease;
}

.tasks-page__add-btn:hover:not(:disabled) {
  opacity: 0.92;
}

.tasks-page__add-btn:active:not(:disabled) {
  transform: scale(0.97);
}

.tasks-page__add-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* ── List ─────────────────────────────────────────────────────────── */
.tasks-page__list,
.tasks-page__loading {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* ── Skeleton ─────────────────────────────────────────────────────── */
.tasks-page__skeleton {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  min-height: 64px;
  padding: 11px 13px;
  border: 1px solid var(--border-divider);
  border-radius: 10px;
  background: var(--surface-card);
}

.tasks-page__skeleton-check {
  width: 22px;
  height: 22px;
}

.tasks-page__skeleton-lines {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tasks-page__skeleton-title {
  width: 65%;
  height: 12px;
  border-radius: 5px;
}

.tasks-page__skeleton:nth-child(2n) .tasks-page__skeleton-title { width: 78%; }
.tasks-page__skeleton:nth-child(3n) .tasks-page__skeleton-title { width: 54%; }

.tasks-page__skeleton-meta {
  width: 40%;
  height: 9px;
  border-radius: 5px;
}

.tasks-page__skeleton:nth-child(2n) .tasks-page__skeleton-meta { width: 30%; }
.tasks-page__skeleton:nth-child(3n) .tasks-page__skeleton-meta { width: 48%; }

/* ── Empty states ─────────────────────────────────────────────────── */
.tasks-page__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 36px 16px;
  text-align: center;
}

.tasks-page__empty-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  margin-bottom: 6px;
  border-radius: 50%;
  background:
    radial-gradient(circle at 50% 35%, var(--primary-light-2) 0%, var(--primary-light-3) 70%);
  color: var(--primary);
  box-shadow: inset 0 0 0 1px var(--border-divider);
}

.tasks-page__empty-title {
  margin: 0;
  color: var(--text);
  font-size: 0.98rem;
  font-weight: 500;
}

.tasks-page__empty-copy {
  margin: 0;
  max-width: 280px;
  color: var(--text-light);
  font-size: 0.86rem;
  line-height: 1.4;
}

@media (max-width: 920px) {
  .tasks-page__layout {
    grid-template-columns: 1fr;
  }

  .tasks-page__detail-panel {
    display: none;
  }
}

@media (max-width: 640px) {
  .tasks-page {
    gap: 14px;
    padding-top: 16px;
  }

  .tasks-page__header {
    align-items: flex-start;
    padding: 16px;
  }

  .tasks-page__copy {
    font-size: 0.88rem;
  }

  .tasks-page__progress {
    width: 50px;
    height: 50px;
  }

  .tasks-page__list-panel {
    padding: 12px;
  }

  .tasks-page__filters {
    overflow-x: auto;
    scrollbar-width: none;
  }

  .tasks-page__filters::-webkit-scrollbar {
    display: none;
  }

  .tasks-page__filter {
    flex: 0 0 auto;
    min-width: 92px;
  }

  .tasks-page__add {
    grid-template-columns: minmax(0, 1fr) auto;
    padding-left: 10px;
  }

  .tasks-page__add-icon {
    display: none;
  }
}

@media (max-width: 420px) {
  .tasks-page__header {
    flex-direction: column;
  }

  .tasks-page__progress {
    align-self: flex-end;
    margin-top: -54px;
  }
}
</style>
