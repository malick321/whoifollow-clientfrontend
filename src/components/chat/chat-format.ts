// Small presentation-only helpers shared across the chat UI components.
// Pure functions — no store / API coupling.

/** Short time label for a message bubble / row (e.g. "3:07 PM"). */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** Relative-ish label for a conversation row's last-activity timestamp:
 *  time today, "Yesterday", weekday this week, else a short date. */
export function formatListTimestamp(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dayMs = 24 * 60 * 60 * 1000
  const diffDays = Math.round((startOfToday.getTime() - startOfDay.getTime()) / dayMs)

  if (diffDays <= 0) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: 'short' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Full day label used in the thread's date separators (e.g. "Today",
 *  "Yesterday", or "Monday, April 7, 2026"). */
export function formatDayLabel(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dayMs = 24 * 60 * 60 * 1000
  const diffDays = Math.round((startOfToday.getTime() - startOfDay.getTime()) / dayMs)

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })
}

/** A stable yyyy-mm-dd key for grouping messages into day buckets. */
export function dayKey(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/** Human-readable file size (e.g. "1.4 MB"). */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

/** True when a file's MIME type / extension reads as a displayable image. */
export function isImageFile(type: string | null | undefined, name?: string | null): boolean {
  if (type && type.toLowerCase().startsWith('image/')) return true
  const n = (name ?? '').toLowerCase()
  return /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/.test(n)
}

/** True when a file's MIME type / extension reads as playable audio. */
export function isAudioFile(type: string | null | undefined, name?: string | null): boolean {
  if (type && type.toLowerCase().startsWith('audio/')) return true
  const n = (name ?? '').toLowerCase()
  return /\.(mp3|m4a|aac|wav|ogg|oga|webm|flac)$/.test(n)
}

/** True when a file's MIME type / extension reads as playable video. */
export function isVideoFile(type: string | null | undefined, name?: string | null): boolean {
  if (type && type.toLowerCase().startsWith('video/')) return true
  const n = (name ?? '').toLowerCase()
  return /\.(mp4|m4v|mov|webm|ogv|avi|mkv)$/.test(n)
}
