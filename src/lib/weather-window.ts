/**
 * Weather strip is visible only during the window
 *   [event start − 5 days, event end]
 *
 * Outside that, the strip hides entirely. Past events don't get weather
 * (it would be stale anyway) and events far in the future don't either
 * — the 5-day lead-in matches the free-tier forecast horizon.
 *
 * Date-only comparison (UTC) to avoid timezone edge cases in the user's
 * browser clock vs the event's published ISO dates.
 */
export function shouldShowWeather(
  startDateISO: string | undefined,
  endDateISO: string | undefined,
  now: Date = new Date()
): boolean {
  if (!startDateISO || !endDateISO) return false

  const today = stripTimeUTC(now)
  if (!today) return false

  const eventStart = stripTimeUTC(new Date(startDateISO))
  const eventEnd = stripTimeUTC(new Date(endDateISO))
  if (!eventStart || !eventEnd) return false

  const windowStart = new Date(eventStart)
  windowStart.setUTCDate(windowStart.getUTCDate() - 5)

  return today >= windowStart && today <= eventEnd
}

function stripTimeUTC(d: Date): Date | null {
  if (Number.isNaN(d.getTime())) return null
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}
