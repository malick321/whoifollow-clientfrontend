export interface ApiTaskStep {
  id: string
  title: string | null
  isCompleted: boolean | null
}

export interface ApiTaskMedia {
  id: string
  name: string | null
  url: string | null
  type: string | null
}

export interface ApiTask {
  id: string
  title: string | null
  note: string | null
  dueDate: string | null
  isImportant: boolean | null
  isCompleted: boolean | null
  createdAt: string | null
  steps: ApiTaskStep[] | null
  media: ApiTaskMedia[] | null
}

export interface ApiTasksResponse {
  responseStatus?: {
    message?: string
    statusCode?: number
    text?: string
  }
  data?: {
    tasks?: ApiTask[] | null
  } | null
}

export interface ApiTaskResponse {
  responseStatus?: {
    message?: string
    statusCode?: number
    text?: string
  }
  data?: {
    task?: ApiTask | null
  } | null
}

export interface ApiTaskMediaResponse {
  responseStatus?: {
    message?: string
    statusCode?: number
    text?: string
  }
  data?: {
    media?: ApiTaskMedia[] | null
  } | null
}
