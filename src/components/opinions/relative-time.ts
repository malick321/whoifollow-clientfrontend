// relative-time
// --------------
// Humanises an ISO-8601 timestamp the way a social feed reads it:
//   • < 1 min   → "now"
//   • < 60 min  → "5m"
//   • < 24 h    → "3h"
//   • < 7 days  → "2d"
//   • this year → "Apr 23"
//   • older     → "Apr 23, 2024"
//
// Kept feature-local (not a global util) so the Opinions module merges
// back into the canonical repo as a self-contained folder.

export function formatRelativeTime(value: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const now = Date.now()
  const diffMs = now - date.getTime()
  const diffSec = Math.round(diffMs / 1000)

  // Future / clock-skew → fall back to "now" rather than a negative age.
  if (diffSec < 45) return 'now'

  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m`

  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h`

  const diffDay = Math.round(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d`

  const sameYear = date.getFullYear() === new Date().getFullYear()
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' })
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
