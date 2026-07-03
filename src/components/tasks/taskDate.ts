// Due-date humanization for the My Tasks module.
// ----------------------------------------------
// Tasks carry `dueDate` as a plain `YYYY-MM-DD` string (or undefined). These
// helpers turn that into a friendly chip label ("Today", "Tomorrow",
// "Overdue", "May 4") and a tone so the list + detail panel can render a
// consistent due-date chip. Kept presentation-only — no API shape changes.

export type DueTone = 'overdue' | 'today' | 'soon' | 'future' | 'none'

export interface DueInfo {
  label: string
  tone: DueTone
}

/** Parse a `YYYY-MM-DD` string into a local Date at midnight (no TZ drift). */
function parseLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) {
    const fallback = new Date(value)
    return Number.isNaN(fallback.getTime()) ? null : fallback
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

/** Whole-day difference (target − today), normalized to midnight. */
function dayDiff(target: Date): number {
  const today = new Date()
  const a = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const b = new Date(target.getFullYear(), target.getMonth(), target.getDate())
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

export function describeDueDate(dueDate?: string | null): DueInfo {
  if (!dueDate) return { label: '', tone: 'none' }

  const date = parseLocalDate(dueDate)
  if (!date) return { label: dueDate, tone: 'future' }

  const diff = dayDiff(date)

  if (diff < 0) {
    const days = Math.abs(diff)
    return {
      label: days === 1 ? 'Yesterday' : `Overdue`,
      tone: 'overdue'
    }
  }
  if (diff === 0) return { label: 'Today', tone: 'today' }
  if (diff === 1) return { label: 'Tomorrow', tone: 'soon' }

  const sameYear = date.getFullYear() === new Date().getFullYear()
  const label = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' })
  })

  if (diff <= 6) {
    // Within the week → show the weekday for quick scanning.
    return { label: date.toLocaleDateString(undefined, { weekday: 'long' }), tone: 'soon' }
  }
  return { label, tone: 'future' }
}

/**
 * Long-form due-date description for the detail panel — e.g.
 * "Due Monday, May 4" or "Overdue · was Apr 2". Returns an empty string when
 * no due date is set so callers can hide the row.
 */
export function describeDueDateLong(dueDate?: string | null): string {
  if (!dueDate) return ''
  const date = parseLocalDate(dueDate)
  if (!date) return dueDate

  const diff = dayDiff(date)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  const full = date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' })
  })

  if (diff < 0) return `Overdue · was ${full}`
  if (diff === 0) return `Due today · ${full}`
  if (diff === 1) return `Due tomorrow · ${full}`
  return `Due ${full}`
}
