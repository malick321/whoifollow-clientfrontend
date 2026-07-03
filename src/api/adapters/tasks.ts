import type {
  ApiTask,
  ApiTaskMedia,
  ApiTaskMediaResponse,
  ApiTaskResponse,
  ApiTaskStep,
  ApiTasksResponse
} from '../contracts/tasks'
import type { Task, TaskMedia, TaskStep } from '../tasks'

export function adaptTaskStep(raw: ApiTaskStep): TaskStep {
  return {
    id: String(raw.id),
    title: raw.title ?? '',
    isCompleted: !!raw.isCompleted
  }
}

export function adaptTaskMedia(raw: ApiTaskMedia): TaskMedia {
  return {
    id: String(raw.id),
    name: raw.name ?? 'Attachment',
    url: raw.url ?? '',
    type: raw.type ?? undefined
  }
}

export function adaptTask(raw: ApiTask): Task {
  return {
    id: String(raw.id),
    title: raw.title ?? '',
    note: raw.note ?? '',
    dueDate: raw.dueDate ?? undefined,
    isImportant: !!raw.isImportant,
    isCompleted: !!raw.isCompleted,
    createdAt: raw.createdAt ?? undefined,
    steps: (raw.steps ?? []).map(adaptTaskStep),
    media: (raw.media ?? []).map(adaptTaskMedia)
  }
}

export function adaptTasks(response: ApiTasksResponse): Task[] {
  return (response?.data?.tasks ?? []).map(adaptTask)
}

export function adaptTaskResponse(response: ApiTaskResponse): Task | null {
  const task = response?.data?.task ?? null
  return task ? adaptTask(task) : null
}

export function adaptTaskMediaResponse(response: ApiTaskMediaResponse): TaskMedia[] {
  return (response?.data?.media ?? []).map(adaptTaskMedia)
}
