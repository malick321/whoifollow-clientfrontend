// Opinion date formatting.
// Posts, comments and specialist cards share this absolute date style.
export function formatRelativeTime(value: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date)
}

// Full, human-readable timestamp for the `title=` tooltip on a relative
// time element — e.g. "Apr 23, 2026, 2:14 PM".
export function formatAbsoluteTime(value: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date)
}
