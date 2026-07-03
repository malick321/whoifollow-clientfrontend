// schedulerTimeAxis
// -----------------
// Pure math + helpers for the calendar-style scheduler time axis.
// Single source of truth for HH:MM ↔ minutes ↔ CSS-Grid row math.
// No Vue / no DOM — safe to unit-test and reuse from any consumer
// (MatchGeniFieldGrid, the bulk-duration modal, the break form,
// future server-side validators if we lift the same math there).
//
// Axis vs window — important distinction:
//   The VISUAL axis paints hour-aligned labels (12:00, 1:00, 2:00 …)
//   to keep the time column legible regardless of where the park's
//   actual scheduling WINDOW begins. The window may start/end mid-
//   hour (e.g. 12:30–19:30). Rows outside `[windowStart, windowEnd]`
//   render as blocked bands ("Outside park hours") and accept no
//   drop targets. The exported helpers split cleanly:
//     - `generateHourRows(park)`  → visual axis, hour labels.
//     - `windowStartMinutes(park)` / `windowEndMinutes(park)` →
//       schedulable range; `findConflicts` clamps to this range.
//     - `gameGridRows` / `breakGridRows` → 1-based CSS Grid
//       row indexes off the visual-axis top.

import type { SchedulerGame, SchedulerPark, SchedulerParkField, SchedulerBreak } from '../types'

/** Axis grain — every grid row is this many minutes. 5-min grain so
 *  the axis can represent real schedules: `:15` / `:45` starts,
 *  75-minute slots, mid-hour day windows (8:15 / 9:45), and delayed
 *  off-cadence starts. The visual hour height is kept constant via
 *  `PX_PER_MINUTE` (row height = grain × px/min) so a finer grain
 *  doesn't shrink the rows; gridlines are drawn at hour + half-hour
 *  anchors only (not per grain row). */
export const ROW_GRANULARITY_MINUTES = 5

/** Pixel height per minute of the calendar axis — drives the CSS row
 *  height (`--row-size = grain × PX_PER_MINUTE`). ~1.5 keeps a 60-min
 *  game ≈ 90px tall (matching the previous 30-min/44px density)
 *  regardless of grain. */
export const PX_PER_MINUTE = 1.5

/** Fallback duration when neither the game nor the park specifies
 *  one. Matches the legacy 90-min fixed-slot cadence. */
export const FALLBACK_GAME_DURATION_MINUTES = 90

export interface HourRow {
  /** Minutes-from-midnight for the hour anchor (always a multiple
   *  of 60). The first hour row may sit BEFORE the park's
   *  `dayStartTime` when the window starts mid-hour. */
  startMinutes: number
  /** Display label — "8:00 AM" / "12:00 PM". */
  label: string
}

export interface GridRows {
  /** 1-based CSS Grid `grid-row-start`. */
  rowStart: number
  /** Number of 30-min rows the element spans. */
  rowSpan: number
}

/* -------------------------------------------------------------- */
/* Time parsing / formatting                                       */
/* -------------------------------------------------------------- */

/** Parse `'HH:MM'` (24h) or `'H:MM AM/PM'` / `'HH:MM AM/PM'` to
 *  minutes-from-midnight. Returns `NaN` for unparseable inputs so
 *  callers can guard. */
export function minutesFromMidnight(time: string): number {
  if (!time) return NaN
  const trimmed = time.trim()
  // 12-hour with meridiem.
  const meridiem = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (meridiem) {
    let hours = Number.parseInt(meridiem[1], 10)
    const minutes = Number.parseInt(meridiem[2], 10)
    const isPm = meridiem[3].toUpperCase() === 'PM'
    if (hours === 12) hours = 0
    if (isPm) hours += 12
    return hours * 60 + minutes
  }
  // 24-hour HH:MM.
  const military = trimmed.match(/^(\d{1,2}):(\d{2})$/)
  if (military) {
    const hours = Number.parseInt(military[1], 10)
    const minutes = Number.parseInt(military[2], 10)
    return hours * 60 + minutes
  }
  return NaN
}

/** Format minutes-from-midnight as a 12-hour display label —
 *  "8:30 AM" / "12:00 PM". Pads single-digit hours per common
 *  US convention (no leading zero on the hour). */
export function formatTimeLabel(minutes: number): string {
  if (!Number.isFinite(minutes)) return ''
  const normalised = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60)
  const h24 = Math.floor(normalised / 60)
  const mm = normalised % 60
  const meridiem = h24 >= 12 ? 'PM' : 'AM'
  let h12 = h24 % 12
  if (h12 === 0) h12 = 12
  const mmStr = mm.toString().padStart(2, '0')
  return `${h12}:${mmStr} ${meridiem}`
}

/** Format a start–end span, collapsing the leading meridiem when both
 *  sides share it (matches the grid game card):
 *    - "8:00 – 9:30 AM"      (same meridiem — drop the leading AM/PM)
 *    - "11:00 AM – 12:30 PM" (different meridiem — keep both) */
export function formatTimeRange(startMinutes: number, endMinutes: number): string {
  const startLabel = formatTimeLabel(startMinutes)
  const endLabel = formatTimeLabel(endMinutes)
  if (!startLabel || !endLabel) return [startLabel, endLabel].filter(Boolean).join(' – ')
  if (startLabel.slice(-2) === endLabel.slice(-2)) {
    return `${startLabel.slice(0, -3).trim()} – ${endLabel}`
  }
  return `${startLabel} – ${endLabel}`
}

/* -------------------------------------------------------------- */
/* Park window math                                                */
/* -------------------------------------------------------------- */

/** Scheduling window start in minutes-from-midnight. */
export function windowStartMinutes(park: SchedulerPark): number {
  const m = minutesFromMidnight(park.dayStartTime)
  return Number.isFinite(m) ? m : 8 * 60
}

/** Scheduling window end in minutes-from-midnight. */
export function windowEndMinutes(park: SchedulerPark): number {
  const m = minutesFromMidnight(park.dayEndTime)
  return Number.isFinite(m) ? m : 20 * 60
}

/** First hour-aligned anchor at or before the window start —
 *  e.g. window 12:30 → 12:00. This is row 1 of the visual axis. */
export function visualAxisStartMinutes(park: SchedulerPark): number {
  return Math.floor(windowStartMinutes(park) / 60) * 60
}

/** First hour-aligned anchor at or after the window end —
 *  e.g. window 19:30 → 20:00. This sets the row count. */
export function visualAxisEndMinutes(park: SchedulerPark): number {
  const end = windowEndMinutes(park)
  return Math.ceil(end / 60) * 60
}

/** Total minute span of the visual axis (always a multiple of 60). */
export function visualAxisMinutes(park: SchedulerPark): number {
  return visualAxisStartMinutes(park) >= visualAxisEndMinutes(park)
    ? 0
    : visualAxisEndMinutes(park) - visualAxisStartMinutes(park)
}

/** Number of 30-min rows the visual axis spans. Drives the CSS
 *  Grid's `grid-template-rows: repeat(N, 30px)`. */
export function visualAxisRowCount(park: SchedulerPark): number {
  return Math.max(0, Math.round(visualAxisMinutes(park) / ROW_GRANULARITY_MINUTES))
}

/** Generate hour-row anchors for the visual axis. One per hour from
 *  `visualAxisStartMinutes` (inclusive) up to but EXCLUDING
 *  `visualAxisEndMinutes` — the trailing edge doesn't need its own
 *  label; the previous hour's row spans to it. */
export function generateHourRows(park: SchedulerPark): HourRow[] {
  const out: HourRow[] = []
  const start = visualAxisStartMinutes(park)
  const end = visualAxisEndMinutes(park)
  for (let m = start; m < end; m += 60) {
    out.push({ startMinutes: m, label: formatTimeLabel(m) })
  }
  return out
}

/* -------------------------------------------------------------- */
/* Game / break placement                                          */
/* -------------------------------------------------------------- */

/** Effective duration for a game, resolved most-specific-wins:
 *    game.durationMinutes        — explicit per-game (rain-changed /
 *                                  one-off games carry their own)
 *    → park.defaultGameDurationMinutes — per-park slot (75 here, 90/60 there)
 *    → eventDefaultMinutes       — event-level baseline slot
 *    → FALLBACK (90)
 *  This lets one park run 75-min games while another runs 90/60, and a
 *  single delayed game override its slot, all off one event baseline. */
export function effectiveGameDurationMinutes(
  game: SchedulerGame,
  park: SchedulerPark | null,
  eventDefaultMinutes?: number
): number {
  if (game.durationMinutes && game.durationMinutes > 0) return game.durationMinutes
  if (park?.defaultGameDurationMinutes && park.defaultGameDurationMinutes > 0) {
    return park.defaultGameDurationMinutes
  }
  if (eventDefaultMinutes && eventDefaultMinutes > 0) return eventDefaultMinutes
  return FALLBACK_GAME_DURATION_MINUTES
}

/** Compute 1-based CSS-Grid row indexes for a game on this park's
 *  visual axis. Returns `null` when the game has no scheduled time
 *  OR the time is unparseable. Games starting BEFORE the visual
 *  axis are clamped to row 1 with their span reduced (caller can
 *  show an "out of bounds" badge). */
export function gameGridRows(
  game: SchedulerGame,
  park: SchedulerPark,
  eventDefaultMinutes?: number
): GridRows | null {
  if (!game.scheduledTime) return null
  const startMin = minutesFromMidnight(game.scheduledTime)
  if (!Number.isFinite(startMin)) return null
  const durationMin = effectiveGameDurationMinutes(game, park, eventDefaultMinutes)
  return placeOnAxis(park, startMin, durationMin)
}

/** Compute grid rows for a break on this park's visual axis. */
export function breakGridRows(
  brk: SchedulerBreak,
  park: SchedulerPark
): GridRows | null {
  const startMin = minutesFromMidnight(brk.startTime)
  if (!Number.isFinite(startMin)) return null
  return placeOnAxis(park, startMin, brk.durationMinutes)
}

/** Internal — clamp a [start, start+duration] interval onto the
 *  park's visual axis and return CSS-Grid row indexes. */
function placeOnAxis(
  park: SchedulerPark,
  startMin: number,
  durationMin: number
): GridRows | null {
  const axisStart = visualAxisStartMinutes(park)
  const axisEnd = visualAxisEndMinutes(park)
  const endMin = startMin + Math.max(durationMin, ROW_GRANULARITY_MINUTES)
  if (endMin <= axisStart || startMin >= axisEnd) return null
  const clampedStart = Math.max(startMin, axisStart)
  const clampedEnd = Math.min(endMin, axisEnd)
  const rowStart = Math.floor((clampedStart - axisStart) / ROW_GRANULARITY_MINUTES) + 1
  const rowSpan = Math.max(
    1,
    Math.ceil((clampedEnd - clampedStart) / ROW_GRANULARITY_MINUTES)
  )
  return { rowStart, rowSpan }
}

/* -------------------------------------------------------------- */
/* Off-window blocked bands                                        */
/* -------------------------------------------------------------- */

export interface BlockedBand {
  /** 1-based grid row start. */
  rowStart: number
  /** Span in 30-min rows. */
  rowSpan: number
  /** Where on the axis this band sits — affects label / styling. */
  kind: 'leading' | 'trailing'
}

/** Leading / trailing portions of the visual axis that fall outside
 *  the park's scheduling window. Empty array when the window
 *  exactly matches the visual axis (e.g. 8:00–8:00 hour-aligned). */
export function offWindowBands(park: SchedulerPark): BlockedBand[] {
  const axisStart = visualAxisStartMinutes(park)
  const axisEnd = visualAxisEndMinutes(park)
  const winStart = windowStartMinutes(park)
  const winEnd = windowEndMinutes(park)
  const out: BlockedBand[] = []
  if (winStart > axisStart) {
    const span = Math.ceil((winStart - axisStart) / ROW_GRANULARITY_MINUTES)
    out.push({ rowStart: 1, rowSpan: span, kind: 'leading' })
  }
  if (winEnd < axisEnd) {
    const rowStart = Math.floor((winEnd - axisStart) / ROW_GRANULARITY_MINUTES) + 1
    const span = Math.ceil((axisEnd - winEnd) / ROW_GRANULARITY_MINUTES)
    out.push({ rowStart, rowSpan: span, kind: 'trailing' })
  }
  return out
}

/** True when the given row index (1-based) sits INSIDE the park's
 *  scheduling window. Used by the drop-strip overlay to decide
 *  whether to accept a drag-over at that row. */
export function isRowWithinWindow(rowIndex: number, park: SchedulerPark): boolean {
  const axisStart = visualAxisStartMinutes(park)
  const winStart = windowStartMinutes(park)
  const winEnd = windowEndMinutes(park)
  const rowStartMin = axisStart + (rowIndex - 1) * ROW_GRANULARITY_MINUTES
  const rowEndMin = rowStartMin + ROW_GRANULARITY_MINUTES
  return rowStartMin >= winStart && rowEndMin <= winEnd
}

/* -------------------------------------------------------------- */
/* Snap + conflict detection                                       */
/* -------------------------------------------------------------- */

/** Convert a pixel offset (clientY relative to the grid body top)
 *  into a grain-snapped (`ROW_GRANULARITY_MINUTES`) HH:MM string
 *  anchored to the visual axis. Clamps to
 *  `[axisStart, axisEnd - ROW_GRANULARITY_MINUTES]`. */
export function snapToGrain(
  offsetPx: number,
  pxPerMinute: number,
  park: SchedulerPark
): string {
  const axisStart = visualAxisStartMinutes(park)
  const axisEnd = visualAxisEndMinutes(park)
  const rawMin = axisStart + offsetPx / Math.max(pxPerMinute, 0.0001)
  const snapped = Math.round(rawMin / ROW_GRANULARITY_MINUTES) * ROW_GRANULARITY_MINUTES
  const clamped = Math.max(axisStart, Math.min(axisEnd - ROW_GRANULARITY_MINUTES, snapped))
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
}

export interface ConflictCandidate {
  /** `HH:MM` (24h) — the prospective start. */
  startTime: string
  /** Length in minutes. */
  durationMinutes: number
  /** `YYYY-MM-DD`. */
  date: string
  /** Field name — must match `SchedulerParkField.name`. */
  fieldName: string
  /** When set, the named game is excluded from the conflict check —
   *  used during resize / move so the game doesn't conflict with
   *  ITSELF. */
  ignoreGameId?: string
}

/** Normalise either field-naming convention used across the
 *  scheduler payload to a canonical numeric token. The park's
 *  field config carries `name: "Field 1"`, while game / break
 *  payloads carry `scheduledFieldLabel: "F1 - H1 Park"` (the
 *  abbreviated form embedding the park abbreviation). Strict
 *  `===` comparison between the two NEVER matched — which let
 *  the conflict detector pass every collision check silently
 *  (no game ever saw any other game as "on the same field").
 *  We extract the leading field NUMBER from either form and
 *  compare on that — `"Field 12"` and `"F12 - WC"` both
 *  reduce to `"12"`, so the check works regardless of which
 *  form the caller / payload uses. Returns `null` for unparseable
 *  labels so the caller can fall back to strict-equal. */
function canonicalFieldKey(label: string | null | undefined): string | null {
  if (!label) return null
  const m = label.trim().match(/^(?:Field\s+|F)(\d+)/i)
  return m ? m[1] : null
}

function fieldLabelsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  if (a === b) return true
  const ka = canonicalFieldKey(a)
  const kb = canonicalFieldKey(b)
  return ka !== null && ka === kb
}

/** Check whether the candidate placement collides with any
 *  pre-existing game on the same `(date, fieldName)` or with any
 *  break that affects that field. Returns the colliding entities
 *  so the caller can surface a precise error ("Conflicts with
 *  Lunch 12:30 PM"). Also enforces the park window when `park`
 *  is provided.
 *
 *  Field-name comparison uses `fieldLabelsMatch` (numeric
 *  canonical form) so callers can pass either `"Field 1"` (the
 *  park config form) or `"F1 - H1 Park"` (the game payload form)
 *  for the candidate's `fieldName` and get the same match
 *  semantics. */
export function findConflicts(
  candidate: ConflictCandidate,
  games: SchedulerGame[],
  breaks: SchedulerBreak[],
  park?: SchedulerPark | null,
  eventDefaultMinutes?: number
): { games: SchedulerGame[]; breaks: SchedulerBreak[]; outOfWindow: boolean } {
  const candStart = minutesFromMidnight(candidate.startTime)
  const candEnd = candStart + candidate.durationMinutes
  const gameHits: SchedulerGame[] = []
  const breakHits: SchedulerBreak[] = []

  let outOfWindow = false
  if (park) {
    const winStart = windowStartMinutes(park)
    const winEnd = windowEndMinutes(park)
    if (candStart < winStart || candEnd > winEnd) outOfWindow = true
  }

  for (const g of games) {
    if (g.id === candidate.ignoreGameId) continue
    if (g.scheduledDate !== candidate.date) continue
    if (!fieldLabelsMatch(g.scheduledFieldLabel, candidate.fieldName)) continue
    if (!g.scheduledTime) continue
    const gStart = minutesFromMidnight(g.scheduledTime)
    if (!Number.isFinite(gStart)) continue
    const gDur = effectiveGameDurationMinutes(g, park ?? null, eventDefaultMinutes)
    const gEnd = gStart + gDur
    if (candStart < gEnd && candEnd > gStart) gameHits.push(g)
  }

  for (const b of breaks) {
    if (b.date !== candidate.date) continue
    // Field-scoped breaks: compare via the same canonical key
    // so a break stored with `fieldName: "Field 2"` still
    // matches a candidate carrying `fieldName: "F2 - H1 Park"`.
    if (b.scope === 'field' && !fieldLabelsMatch(b.fieldName, candidate.fieldName)) continue
    const bStart = minutesFromMidnight(b.startTime)
    if (!Number.isFinite(bStart)) continue
    const bEnd = bStart + b.durationMinutes
    if (candStart < bEnd && candEnd > bStart) breakHits.push(b)
  }

  return { games: gameHits, breaks: breakHits, outOfWindow }
}

/* -------------------------------------------------------------- */
/* Cadence magnet (Phase 2)                                        */
/* -------------------------------------------------------------- */

/** Candidate "next slot" start-minutes for one field on one date —
 *  the park window start plus the END of every game / break already
 *  occupying that field/date. Because durations vary (and shift on a
 *  delay), the cadence is the running sequence of *actual* ends, not
 *  a fixed `start + n×slot` clock — so it naturally drifts later when
 *  a game runs long. Excludes `ignoreGameId` (the game being moved). */
export function fieldCadenceStarts(
  games: SchedulerGame[],
  breaks: SchedulerBreak[],
  park: SchedulerPark,
  fieldName: string,
  date: string,
  eventDefaultMinutes?: number,
  ignoreGameId?: string
): number[] {
  const winStart = windowStartMinutes(park)
  const winEnd = windowEndMinutes(park)
  const starts = new Set<number>([winStart])
  for (const g of games) {
    if (g.id === ignoreGameId) continue
    if (g.scheduledDate !== date) continue
    if (!fieldLabelsMatch(g.scheduledFieldLabel, fieldName)) continue
    if (!g.scheduledTime) continue
    const s = minutesFromMidnight(g.scheduledTime)
    if (!Number.isFinite(s)) continue
    starts.add(s + effectiveGameDurationMinutes(g, park, eventDefaultMinutes))
  }
  for (const b of breaks) {
    if (b.date !== date) continue
    if (b.scope === 'field' && !fieldLabelsMatch(b.fieldName, fieldName)) continue
    const s = minutesFromMidnight(b.startTime)
    if (!Number.isFinite(s)) continue
    starts.add(s + b.durationMinutes)
  }
  return [...starts].filter((m) => m >= winStart && m < winEnd).sort((a, b) => a - b)
}

/** Snap a raw start (minutes) to the nearest field-cadence boundary
 *  when within `thresholdMin`; otherwise return the raw start
 *  unchanged. This makes a normal drop click neatly into the next
 *  back-to-back slot, while a deliberately off-cadence drop (a
 *  delayed game) stays exactly where it was dropped. */
export function snapStartToCadence(
  rawStartMin: number,
  cadenceStarts: number[],
  thresholdMin: number = ROW_GRANULARITY_MINUTES * 3
): number {
  let best = rawStartMin
  let bestDist = Infinity
  for (const c of cadenceStarts) {
    const d = Math.abs(c - rawStartMin)
    if (d < bestDist) { bestDist = d; best = c }
  }
  return bestDist <= thresholdMin ? best : rawStartMin
}

/** Minutes-from-midnight → zero-padded 24-hour `'HH:MM'`. */
export function minutesToHHMM(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${h.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`
}

/* -------------------------------------------------------------- */
/* Delay cascade (Phase 3)                                         */
/* -------------------------------------------------------------- */

/** A scheduled-time change to apply to one game (24h `'HH:MM'`). */
export interface CadenceShift {
  gameId: string
  startTime: string
}

/** Compute the cascade when a delay/move pushes a game later: every
 *  game on the SAME field+date that starts at or after `fromStartMin`
 *  shifts LATER by `deltaMin`, preserving order (the rain-delay
 *  "push the rest of the day" behaviour). `overflow` is true when any
 *  shifted game would run past the park window end (caller decides
 *  whether to apply, warn, or reject). Pure — returns the moves;
 *  applying them is the caller's job. Excludes `ignoreGameId` (the
 *  game that triggered the cascade, already placed). */
export function cascadeFollowingGames(
  games: SchedulerGame[],
  park: SchedulerPark,
  fieldName: string,
  date: string,
  fromStartMin: number,
  deltaMin: number,
  eventDefaultMinutes?: number,
  ignoreGameId?: string,
  breaks: SchedulerBreak[] = []
): { shifts: CadenceShift[]; overflow: boolean; breakBlocked: boolean } {
  const winEnd = windowEndMinutes(park)
  const shifts: CadenceShift[] = []
  let overflow = false
  let breakBlocked = false
  if (deltaMin <= 0) return { shifts, overflow, breakBlocked }
  // Breaks on this field/date are FIXED — they don't cascade, so a
  // shifted game that lands on one is flagged (caller decides).
  const fieldBreaks = breaks.filter(
    (b) => b.date === date && (b.scope !== 'field' || fieldLabelsMatch(b.fieldName, fieldName))
  )
  for (const g of games) {
    if (g.id === ignoreGameId) continue
    if (g.scheduledDate !== date) continue
    if (!fieldLabelsMatch(g.scheduledFieldLabel, fieldName)) continue
    if (!g.scheduledTime) continue
    const s = minutesFromMidnight(g.scheduledTime)
    if (!Number.isFinite(s) || s < fromStartMin) continue
    const shifted = s + deltaMin
    const shiftedEnd = shifted + effectiveGameDurationMinutes(g, park, eventDefaultMinutes)
    if (shiftedEnd > winEnd) overflow = true
    for (const b of fieldBreaks) {
      const bStart = minutesFromMidnight(b.startTime)
      if (!Number.isFinite(bStart)) continue
      if (shifted < bStart + b.durationMinutes && shiftedEnd > bStart) { breakBlocked = true; break }
    }
    shifts.push({ gameId: g.id, startTime: minutesToHHMM(shifted) })
  }
  return { shifts, overflow, breakBlocked }
}

/* -------------------------------------------------------------- */
/* Cross-park move (bulk event-day management)                     */
/* -------------------------------------------------------------- */

/** True when a game/break field LABEL belongs to a park field. Mirrors
 *  the field-grid's `fieldByMatch`: handles "Field 1"/"F1 - X" numeric
 *  forms AND named fields ("Jasmine - X" startsWith "Jasmine"). */
function labelMatchesField(label: string | null | undefined, field: SchedulerParkField): boolean {
  if (!label) return false
  if (label.startsWith(field.name)) return true
  if (label.startsWith(field.name.replace('Field ', 'F'))) return true
  return fieldLabelsMatch(field.name, label)
}

/** Index of the park field a label belongs to, or -1. Used to map a
 *  game to the SAME-POSITION field in another park (names may differ
 *  between parks, so mapping is positional). */
export function fieldIndexForLabel(park: SchedulerPark, label: string | null | undefined): number {
  return park.fields.findIndex((f) => labelMatchesField(label, f))
}

export interface GamePlacement {
  game: SchedulerGame
  /** Destination field NAME the game lands on. */
  fieldName: string
  /** Packed start, 24h `'HH:MM'`. */
  startTime: string
  /** Duration applied (override when provided, else effective). */
  durationMinutes: number
}
export interface PackBlocked {
  game: SchedulerGame
  reason: string
}
export interface PackResult {
  placements: GamePlacement[]
  /** Games that couldn't fit before the window end. */
  unplaced: PackBlocked[]
}

/** Earliest start ≥ `winStart` where `[start, start+dur]` fits among the
 *  `intervals` already occupied on a field and ends ≤ `winEnd`. Returns
 *  `null` when nothing fits. */
function earliestFit(
  intervals: Array<[number, number]>,
  dur: number,
  winStart: number,
  winEnd: number
): number | null {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0])
  let cursor = winStart
  for (const [s, e] of sorted) {
    if (s - cursor >= dur) return cursor // gap before this interval is big enough
    if (e > cursor) cursor = e
  }
  return winEnd - cursor >= dur ? cursor : null
}

/** Intelligently repack `selected` games onto `destPark`'s fields for
 *  `date`: order them by their original start time, then drop each into
 *  the globally-earliest free slot across the destination's fields —
 *  working around the destination's EXISTING games + breaks, inside the
 *  day window. Handles a destination with FEWER fields than the source
 *  (games stack across the available fields). `destPark` should already
 *  carry the chosen day's window (`dayStartTime`/`dayEndTime`). Pure —
 *  returns the placements + the games that didn't fit. */
export function packGamesToDestination(
  selected: SchedulerGame[],
  destPark: SchedulerPark,
  allGames: SchedulerGame[],
  date: string,
  eventDefaultMinutes?: number,
  durationOverride?: number
): PackResult {
  const placements: GamePlacement[] = []
  const unplaced: PackBlocked[] = []
  const fields = destPark.fields
  if (fields.length === 0) {
    return { placements, unplaced: selected.map((game) => ({ game, reason: 'Park has no fields' })) }
  }
  const winStart = windowStartMinutes(destPark)
  const winEnd = windowEndMinutes(destPark)

  // Per-field occupied intervals, seeded from the destination's existing
  // games + breaks (the moving games can't block themselves).
  const occ: Array<Array<[number, number]>> = fields.map(() => [])
  const selectedIds = new Set(selected.map((g) => g.id))
  for (const g of allGames) {
    if (g.parkId !== destPark.id || g.scheduledDate !== date || !g.scheduledTime) continue
    if (selectedIds.has(g.id)) continue
    const idx = fieldIndexForLabel(destPark, g.scheduledFieldLabel)
    if (idx < 0) continue
    const s = minutesFromMidnight(g.scheduledTime)
    if (!Number.isFinite(s)) continue
    occ[idx].push([s, s + effectiveGameDurationMinutes(g, destPark, eventDefaultMinutes)])
  }
  for (const b of destPark.breaks ?? []) {
    if (b.date !== date) continue
    const s = minutesFromMidnight(b.startTime)
    if (!Number.isFinite(s)) continue
    const interval: [number, number] = [s, s + b.durationMinutes]
    if (b.scope === 'park') fields.forEach((_, i) => occ[i].push(interval))
    else {
      const idx = fieldIndexForLabel(destPark, b.fieldName)
      if (idx >= 0) occ[idx].push(interval)
    }
  }

  // Chronological order, then earliest-fit across the fields.
  const ordered = [...selected].sort(
    (a, b) => minutesFromMidnight(a.scheduledTime ?? '') - minutesFromMidnight(b.scheduledTime ?? '')
  )
  for (const game of ordered) {
    const dur = durationOverride && durationOverride > 0
      ? durationOverride
      : effectiveGameDurationMinutes(game, destPark, eventDefaultMinutes)
    let bestIdx = -1
    let bestStart = Number.POSITIVE_INFINITY
    for (let i = 0; i < fields.length; i++) {
      const start = earliestFit(occ[i], dur, winStart, winEnd)
      if (start !== null && start < bestStart) { bestStart = start; bestIdx = i }
    }
    if (bestIdx < 0) {
      unplaced.push({ game, reason: `No room before ${formatTimeLabel(winEnd)}` })
      continue
    }
    occ[bestIdx].push([bestStart, bestStart + dur])
    placements.push({
      game,
      fieldName: fields[bestIdx].name,
      startTime: minutesToHHMM(bestStart),
      durationMinutes: dur
    })
  }
  return { placements, unplaced }
}
