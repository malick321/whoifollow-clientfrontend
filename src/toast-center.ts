import { ref } from 'vue'

export type ToastTone = 'success' | 'warning'

export interface ToastItem {
  id: number
  tone: ToastTone
  title: string
  message?: string
}

const toasts = ref<ToastItem[]>([])
let nextToastId = 1

export function useToasts() {
  return toasts
}

export function pushToast(payload: {
  tone: ToastTone
  title: string
  message?: string
  durationMs?: number
}) {
  const toast: ToastItem = {
    id: nextToastId++,
    tone: payload.tone,
    title: payload.title,
    message: payload.message
  }

  toasts.value = [...toasts.value, toast]

  const duration = payload.durationMs ?? 4200
  if (typeof window !== 'undefined') {
    window.setTimeout(() => removeToast(toast.id), duration)
  }

  return toast.id
}

export function removeToast(id: number) {
  toasts.value = toasts.value.filter((toast) => toast.id !== id)
}
