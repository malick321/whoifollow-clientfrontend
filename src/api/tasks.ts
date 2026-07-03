import { getAuthHeaders } from '../auth-session'
import { buildV2ApiUrl } from './config'
import {
  adaptTaskMediaResponse,
  adaptTaskResponse,
  adaptTasks
} from './adapters/tasks'
import type {
  ApiTaskMediaResponse,
  ApiTaskResponse,
  ApiTasksResponse
} from './contracts/tasks'

export type TaskFilter = 'all' | 'important' | 'completed' | 'today'

export interface TaskStep {
  id: string
  title: string
  isCompleted: boolean
}

export interface TaskMedia {
  id: string
  name: string
  url: string
  type?: string
}

export interface Task {
  id: string
  title: string
  note: string
  dueDate?: string
  isImportant: boolean
  isCompleted: boolean
  createdAt?: string
  steps: TaskStep[]
  media: TaskMedia[]
}

export interface CreateTaskPayload {
  title: string
  dueDate?: string
  note?: string
  isImportant?: boolean
}

export interface UpdateTaskPayload {
  title?: string
  note?: string
  dueDate?: string | null
}

export interface UpdateTaskStepPayload {
  title?: string
  isCompleted?: boolean
}

async function parseEnvelope<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as {
    responseStatus?: { message?: string }
    message?: string
  }

  if (!response.ok) {
    const message = body.responseStatus?.message || body.message || `Request failed: ${response.status}`
    throw new Error(message)
  }

  return body as T
}

export async function fetchTasks(filter: TaskFilter = 'all'): Promise<Task[]> {
  const response = await fetch(buildV2ApiUrl(`/tasks?filter=${encodeURIComponent(filter)}`), {
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json'
    }
  })

  return adaptTasks(await parseEnvelope<ApiTasksResponse>(response))
}

export async function createTask(payload: CreateTaskPayload): Promise<Task> {
  const response = await fetch(buildV2ApiUrl('/tasks'), {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })

  const task = adaptTaskResponse(await parseEnvelope<ApiTaskResponse>(response))
  if (!task) throw new Error('Task response did not include a task.')
  return task
}

export async function updateTask(taskId: string, payload: UpdateTaskPayload): Promise<Task> {
  const response = await fetch(buildV2ApiUrl(`/tasks/${encodeURIComponent(taskId)}`), {
    method: 'PATCH',
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })

  const task = adaptTaskResponse(await parseEnvelope<ApiTaskResponse>(response))
  if (!task) throw new Error('Task response did not include a task.')
  return task
}

export async function toggleTaskComplete(taskId: string): Promise<Task> {
  const response = await fetch(buildV2ApiUrl(`/tasks/${encodeURIComponent(taskId)}/toggle-complete`), {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json'
    }
  })

  const task = adaptTaskResponse(await parseEnvelope<ApiTaskResponse>(response))
  if (!task) throw new Error('Task response did not include a task.')
  return task
}

export async function toggleTaskImportant(taskId: string): Promise<Task> {
  const response = await fetch(buildV2ApiUrl(`/tasks/${encodeURIComponent(taskId)}/toggle-important`), {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json'
    }
  })

  const task = adaptTaskResponse(await parseEnvelope<ApiTaskResponse>(response))
  if (!task) throw new Error('Task response did not include a task.')
  return task
}

export async function deleteTask(taskId: string): Promise<void> {
  await parseEnvelope(await fetch(buildV2ApiUrl(`/tasks/${encodeURIComponent(taskId)}`), {
    method: 'DELETE',
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json'
    }
  }))
}

export async function addTaskStep(taskId: string, title: string): Promise<Task> {
  const response = await fetch(buildV2ApiUrl(`/tasks/${encodeURIComponent(taskId)}/steps`), {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ title })
  })

  const task = adaptTaskResponse(await parseEnvelope<ApiTaskResponse>(response))
  if (!task) throw new Error('Task response did not include a task.')
  return task
}

export async function updateTaskStep(stepId: string, payload: UpdateTaskStepPayload): Promise<Task> {
  const response = await fetch(buildV2ApiUrl(`/tasks/steps/${encodeURIComponent(stepId)}`), {
    method: 'PATCH',
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })

  const task = adaptTaskResponse(await parseEnvelope<ApiTaskResponse>(response))
  if (!task) throw new Error('Task response did not include a task.')
  return task
}

export async function deleteTaskStep(stepId: string): Promise<Task> {
  const response = await fetch(buildV2ApiUrl(`/tasks/steps/${encodeURIComponent(stepId)}`), {
    method: 'DELETE',
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json'
    }
  })

  const task = adaptTaskResponse(await parseEnvelope<ApiTaskResponse>(response))
  if (!task) throw new Error('Task response did not include a task.')
  return task
}

export async function uploadTaskMedia(taskId: string, files: File[]): Promise<TaskMedia[]> {
  const formData = new FormData()
  files.forEach((file) => formData.append('files[]', file))

  const response = await fetch(buildV2ApiUrl(`/tasks/${encodeURIComponent(taskId)}/media`), {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json'
    },
    body: formData
  })

  return adaptTaskMediaResponse(await parseEnvelope<ApiTaskMediaResponse>(response))
}

export async function deleteTaskMedia(mediaId: string): Promise<void> {
  await parseEnvelope(await fetch(buildV2ApiUrl(`/tasks/media/${encodeURIComponent(mediaId)}`), {
    method: 'DELETE',
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json'
    }
  }))
}
