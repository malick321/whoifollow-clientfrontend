<script setup lang="ts">
// MatchGeniFieldGrid
// ------------------
// Reusable date-strip + calendar-style time × field grid for a single
// park. Drives three surfaces today:
//   - MatchGeni Scheduler (admin, drag-drop editable, hover-to-add
//     break, bulk-duration trigger via the parent's toolbar)
//   - MatchGeni Calendar / Scoring (admin, click-to-act, permission-
//     highlighted)
//   - Public event page (audience, view-only) — future migration
//
// Calendar axis (replaces the legacy fixed-slot rows):
//   The grid body is a CSS Grid. Rows = 30-minute granularity from
//   `floor(park.dayStartTime → hour)` to `ceil(park.dayEndTime →
//   hour)`. Each game stores its own `durationMinutes`; cards span
//   the corresponding number of rows. The portions of the visual
//   axis OUTSIDE the park's scheduling window paint as striped
//   "Outside park hours" bands (no drop targets). Breaks
//   (park-wide or field-scoped) render as full-width / single-
//   column striped blocks on top of the grid. All position math
//   lives in `src/api/schedulerTimeAxis.ts` — pure / testable.
//
// Architecture: headless on cell content. The component owns the
// shell (date pager, field pager, sticky stack, narrow-mode
// collapse, ResizeObserver measurement, calendar placement); the
// caller owns what gets rendered inside each game card via the
// `#cell` slot. Cell + break interactions surface as events
// (`cell-click` / `cell-drop` / `cell-dragover` / `break-add-
// request` / `break-edit-request` / `break-delete`) so the caller
// wires drag-drop OR click OR break-form semantics without the
// grid knowing which.
//
// Responsive behavior: same ResizeObserver-driven `dateWindowSize`
// + `fieldWindowSize` + `isNarrow` pattern as before. Narrow mode
// collapses to Time + 1 Field column with the field-pager
// promoted to a sticky top nav row.

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type {
  SchedulerBreak,
  SchedulerGame,
  SchedulerPark,
  SchedulerParkDay,
  SchedulerParkField
} from '../types'
import {
  ROW_GRANULARITY_MINUTES,
  PX_PER_MINUTE,
  breakGridRows,
  effectiveGameDurationMinutes,
  formatTimeLabel,
  formatTimeRange,
  gameGridRows,
  generateHourRows,
  isRowWithinWindow,
  minutesFromMidnight,
  offWindowBands,
  visualAxisRowCount,
  visualAxisStartMinutes,
  windowEndMinutes,
  windowStartMinutes
} from '../api/schedulerTimeAxis'

const props = withDefaults(defineProps<{
  /** Park whose schedule is being rendered. `null` shows an empty
   *  placeholder (e.g. on the public page before the audience picks
   *  a park, or on the scheduler when the payload hasn't resolved). */
  park: SchedulerPark | null
  /** All games on the event. Filtered internally by the active day
   *  + park's field names so the consumer doesn't have to maintain
   *  a per-cell lookup. */
  games: SchedulerGame[]
  /** Currently-shown day on the date strip (ISO `YYYY-MM-DD`). */
  activeDate: string
  /** View-only mode — independent of `cellInteraction`. Reserved
   *  for future visual differentiation (e.g. hiding the legacy
   *  "Invalid Date for Division" copy). */
  readonly?: boolean
  /** How cells respond to pointer events:
   *   - `'drop'` — drag/drop targets active (clamped to the park
   *     scheduling window), hover-add-break pill on the time
   *     column, break edit / delete affordances on existing
   *     breaks. The scheduler surface uses this.
   *   - `'click'` — cards clickable → drawer; no drop targets,
   *     no break CRUD. The calendar / scoring surface uses this.
   *   - `'none'` — fully read-only. The public event page. */
  cellInteraction?: 'drop' | 'click' | 'none'
  /** Breaks on this park for the ACTIVE date. Caller pre-filters
   *  by `date === activeDate`. Empty / absent when the date has
   *  none. Rendered regardless of `cellInteraction` — read-only
   *  surfaces still need to SHOW the lunch / rain-delay band,
   *  just not be able to edit it. */
  parkBreaks?: SchedulerBreak[]
  /** Event-level default game-slot length (minutes) — the baseline of
   *  the duration chain when a game has no own duration and its park
   *  has no default. Passed from the scheduler payload. */
  eventDefaultGameDurationMinutes?: number
  /** Id of the game currently being dragged from the SOURCE list (the
   *  parent's `draggedGameId`). Lets the drop-preview band size itself to
   *  the dragged game's footprint even though `dataTransfer` can't be read
   *  mid-`dragover`. Grid-originated game drags use the internal
   *  `draggingItemKey` instead, so this is only needed for source drags. */
  draggingGameId?: string | null
  /** When true, suppress the empty-cell "add break / game" affordance —
   *  no hover preview band and no click popup. The scheduler sets this
   *  while a bulk SELECTION is in progress so hovering/clicking empty
   *  cells doesn't compete with selection mode. */
  addSlotDisabled?: boolean
  /** Ghost games to preview (not committed) — rendered translucent +
   *  dashed and non-interactive, over the real games. Used by the bulk
   *  Move dialog to show where games WOULD land on a destination park. */
  previewGames?: SchedulerGame[]
}>(), {
  readonly: false,
  cellInteraction: 'none',
  parkBreaks: () => [],
  addSlotDisabled: false,
  previewGames: () => []
})

interface CellPayload {
  date: string
  time: string
  field: SchedulerParkField
  game: SchedulerGame | null
}
interface CellDragPayload extends CellPayload {
  event: DragEvent
}

/* Switched from the call-overload `defineEmits<{ (event: X,
   ...): void }>` syntax to the newer tuple-record syntax —
   the overload form started erroring under TS strict checks
   once the list grew past ~8 entries (Vue's generated typing
   appears to lose track of the discriminator and resolves
   handler types to `(...args: any[]) => any` which isn't
   assignable to the typed signatures consumers bind). The
   tuple-record syntax is what the Vue docs recommend now and
   produces cleaner typing without arity / variadic issues. */
const emit = defineEmits<{
  'update:activeDate': [value: string]
  'cell-click': [payload: CellPayload]
  'cell-drop': [payload: CellDragPayload]
  'cell-dragover': [payload: CellDragPayload]
  /** User clicked the "+ Insert break" affordance at the given
   *  start time (24h HH:MM). Parent owns the form mount + the
   *  commit. */
  'break-add-request': [payload: { date: string; startTime: string }]
  /** User clicked an existing break's Edit affordance. */
  'break-edit-request': [brk: SchedulerBreak]
  /** User clicked an existing break's Remove affordance. */
  'break-delete': [brk: SchedulerBreak]
  /** A game card ON THE GRID started dragging (reschedule
   *  flow). The component sets `event.dataTransfer` to the
   *  game id itself before emitting so the matching drop
   *  handler picks it up the same way it does for source-list
   *  cards. Parent can mirror its own dragged-game tracking
   *  state off this. */
  'game-dragstart': [payload: { game: SchedulerGame; event: DragEvent }]
  /** A break block ON THE GRID started dragging (reschedule
   *  flow). DataTransfer is prefixed (`break:<id>`) so the drop
   *  handler can distinguish a break drag from a game drag. */
  'break-dragstart': [payload: { brk: SchedulerBreak; event: DragEvent }]
  /** User CLICKED an empty drop strip (no drag). Carries the slot
   *  context + the click viewport coords (for anchoring a popover)
   *  + the empty space available below the row. The parent decides
   *  what to offer (add break / add game). */
  'cell-empty-click': [payload: {
    date: string
    time: string // 'HH:MM' 24h
    field: SchedulerParkField
    availableMinutes: number
    x: number
    y: number
  }]
}>()

// ── Active day lookup ────────────────────────────────────────────

const activeDay = computed<SchedulerParkDay | undefined>(() =>
  props.park?.days.find((d) => d.date === props.activeDate)
)

/** The park with the ACTIVE DAY's scheduling window substituted in.
 *  Each day in the §9 resources `schedule[]` can carry its own
 *  `startTime`/`endTime`, so the calendar axis must recompute per
 *  selected date. We feed this day-windowed clone to every
 *  time-axis helper (`generateHourRows`, `gameGridRows`,
 *  `offWindowBands`, drop-strip window checks, …) instead of the
 *  raw `props.park`, whose `dayStartTime`/`dayEndTime` is only the
 *  multi-day ENVELOPE. Falls back to the park window when the active
 *  day has no per-day window (legacy mock parks, or no day selected). */
const axisPark = computed<SchedulerPark | null>(() => {
  const park = props.park
  if (!park) return null
  const day = activeDay.value
  if (day?.startTime && day?.endTime) {
    return { ...park, dayStartTime: day.startTime, dayEndTime: day.endTime }
  }
  return park
})

// ── Responsive pager — element-width-driven (unchanged) ──────────

const gridRoot = ref<HTMLElement | null>(null)
const gridWidth = ref(typeof window === 'undefined' ? 1280 : window.innerWidth)
let gridResizeObserver: ResizeObserver | null = null

const dateWindowSize = computed(() => {
  const w = gridWidth.value
  if (w >= 1080) return 7
  if (w >= 840) return 5
  if (w >= 600) return 3
  return 1
})
const fieldWindowSize = computed(() => {
  const w = gridWidth.value
  if (w >= 1280) return Number.POSITIVE_INFINITY
  if (w >= 1080) return 6
  if (w >= 840) return 4
  if (w >= 600) return 2
  return 1
})
// (Removed: `isNarrow` flag. The previous narrow-mode field-
// selector strip + wide-mode field pager strip merged into a
// single `.field-grid__field-bar` that handles every viewport
// uniformly — no separate render path needed.)

// ── Date pager (unchanged) ───────────────────────────────────────

const dateWindowStart = ref(0)

const visibleDates = computed<SchedulerParkDay[]>(() => {
  const days = props.park?.days ?? []
  const size = dateWindowSize.value
  if (days.length === 0) return []
  const maxStart = Math.max(0, days.length - size)
  const start = Math.min(dateWindowStart.value, maxStart)
  return days.slice(start, start + size)
})

const canPageDatesBackward = computed(() => {
  const days = props.park?.days ?? []
  const idx = days.findIndex((d) => d.date === props.activeDate)
  return idx > 0
})
const canPageDatesForward = computed(() => {
  const days = props.park?.days ?? []
  const idx = days.findIndex((d) => d.date === props.activeDate)
  return idx >= 0 && idx < days.length - 1
})

function pageDatesBackward() {
  const days = props.park?.days ?? []
  const idx = days.findIndex((d) => d.date === props.activeDate)
  if (idx <= 0) return
  const prev = days[idx - 1]
  if (prev) emit('update:activeDate', prev.date)
}
function pageDatesForward() {
  const days = props.park?.days ?? []
  const idx = days.findIndex((d) => d.date === props.activeDate)
  if (idx < 0 || idx >= days.length - 1) return
  const next = days[idx + 1]
  if (next) emit('update:activeDate', next.date)
}

watch(
  () => [props.activeDate, dateWindowSize.value, props.park?.days.length] as const,
  () => {
    const days = props.park?.days ?? []
    if (days.length === 0) { dateWindowStart.value = 0; return }
    const idx = days.findIndex((d) => d.date === props.activeDate)
    if (idx < 0) return
    const size = dateWindowSize.value
    const start = Math.floor(idx / size) * size
    const maxStart = Math.max(0, days.length - size)
    dateWindowStart.value = Math.min(start, maxStart)
  },
  { immediate: true }
)

// ── Field pager (unchanged) ──────────────────────────────────────

const fieldWindowStart = ref(0)

const visibleFields = computed<SchedulerParkField[]>(() => {
  const fields = props.park?.fields ?? []
  const size = fieldWindowSize.value
  if (fields.length === 0) return []
  if (size >= fields.length) return fields
  const maxStart = Math.max(0, fields.length - size)
  const start = Math.min(fieldWindowStart.value, maxStart)
  return fields.slice(start, start + size)
})

const canPageFieldsBackward = computed(() => fieldWindowStart.value > 0)
const canPageFieldsForward = computed(() => {
  const fields = props.park?.fields ?? []
  return fieldWindowStart.value + fieldWindowSize.value < fields.length
})

function pageFieldsBackward() {
  if (!canPageFieldsBackward.value) return
  const size = fieldWindowSize.value === Number.POSITIVE_INFINITY ? 1 : fieldWindowSize.value
  fieldWindowStart.value = Math.max(0, fieldWindowStart.value - size)
}
function pageFieldsForward() {
  if (!canPageFieldsForward.value) return
  const fields = props.park?.fields ?? []
  const size = fieldWindowSize.value === Number.POSITIVE_INFINITY ? 1 : fieldWindowSize.value
  const max = Math.max(0, fields.length - size)
  fieldWindowStart.value = Math.min(max, fieldWindowStart.value + size)
}

watch(
  () => [props.park?.id, fieldWindowSize.value] as const,
  () => {
    const fields = props.park?.fields ?? []
    const size = fieldWindowSize.value === Number.POSITIVE_INFINITY ? fields.length : fieldWindowSize.value
    const maxStart = Math.max(0, fields.length - size)
    fieldWindowStart.value = Math.min(fieldWindowStart.value, maxStart)
  }
)

// (Removed: `fieldsPaged` computed. The merged
// `.field-grid__field-bar` is ALWAYS rendered when the park
// has any fields — prev/next arrows handle their own
// `disabled` state via `canPageFieldsBackward` /
// `canPageFieldsForward`, so we don't need a separate
// "is the user paged?" flag to decide visibility.)

// ── Calendar axis derivations ────────────────────────────────────

/** Total 30-min rows the calendar body spans. CSS Grid uses this
 *  for `grid-template-rows: repeat(N, var(--row-size))`. */
const axisRowCount = computed(() => {
  if (!axisPark.value) return 0
  return visualAxisRowCount(axisPark.value)
})

/** Hour-aligned anchors in the visual axis. Used to paint hour
 *  labels on the time column AND the bolder hour gridlines. */
const hourRows = computed(() => {
  if (!axisPark.value) return []
  return generateHourRows(axisPark.value)
})

/** Off-window leading + trailing bands. Empty when the window
 *  exactly matches the visual axis. */
const offWindowBandsList = computed(() => {
  if (!axisPark.value) return []
  return offWindowBands(axisPark.value)
})

/** Games scheduled on the active date that fall inside the park's
 *  visual axis. Each row carries its CSS Grid row coords + the
 *  field-column index so the template can place it with a single
 *  inline `style` binding. */
interface PlacedGame {
  game: SchedulerGame
  field: SchedulerParkField
  /** 1-based grid column (offset by +2 because col 1 is the time
   *  column and col 2+ are field columns). */
  gridColumn: number
  /** 1-based grid row inside the body grid (row 1 is the first
   *  30-min slot of the visual axis). */
  gridRowStart: number
  gridRowSpan: number
  /** Effective duration in minutes after fallback resolution. */
  durationMinutes: number
}

/** Place a list of games onto the active day's grid (CSS-grid coords +
 *  field-column index). Shared by the real games + the ghost previews. */
function placeGames(list: SchedulerGame[]): PlacedGame[] {
  const park = axisPark.value
  const day = activeDay.value
  if (!park || !day) return []
  const fieldByMatch = (label: string | null): SchedulerParkField | null => {
    if (!label) return null
    return park.fields.find(
      (f) => label.startsWith(f.name) || label.startsWith(f.name.replace('Field ', 'F'))
    ) ?? null
  }
  const visibleFieldIds = new Set(visibleFields.value.map((f) => f.id))
  const out: PlacedGame[] = []
  for (const game of list) {
    if (game.scheduledDate !== day.date) continue
    if (game.parkId && game.parkId !== park.id) continue
    const field = fieldByMatch(game.scheduledFieldLabel ?? null)
    if (!field) continue
    if (!visibleFieldIds.has(field.id)) continue
    const rows = gameGridRows(game, park, props.eventDefaultGameDurationMinutes)
    if (!rows) continue
    const colIdx = visibleFields.value.findIndex((f) => f.id === field.id)
    if (colIdx < 0) continue
    out.push({
      game,
      field,
      gridColumn: colIdx + 2, // +2 → skip time column (col 1)
      gridRowStart: rows.rowStart,
      gridRowSpan: rows.rowSpan,
      durationMinutes: effectiveGameDurationMinutes(game, park, props.eventDefaultGameDurationMinutes)
    })
  }
  return out
}

const placedGames = computed<PlacedGame[]>(() => placeGames(props.games))
const placedPreviewGames = computed<PlacedGame[]>(() => placeGames(props.previewGames ?? []))

/** Breaks on the active date, placed onto the grid. Park-scope
 *  breaks span every visible field column; field-scope breaks
 *  span the single matching column (and are skipped when their
 *  field is paged out of view). */
interface PlacedBreak {
  brk: SchedulerBreak
  /** `'2 / -1'` for park scope (full-width across field cols),
   *  or a single-column 1-based index for field scope. */
  gridColumnStyle: string
  gridRowStart: number
  gridRowSpan: number
}

const placedBreaks = computed<PlacedBreak[]>(() => {
  const park = axisPark.value
  const day = activeDay.value
  if (!park || !day) return []
  const out: PlacedBreak[] = []
  for (const brk of props.parkBreaks ?? []) {
    if (brk.date !== day.date) continue
    const rows = breakGridRows(brk, park)
    if (!rows) continue
    let columnStyle: string
    if (brk.scope === 'park') {
      // Span every field column — `2 / -1` skips the time col
      // (col 1) and stretches to the implicit grid end. Works
      // regardless of how many field columns are visible.
      columnStyle = '2 / -1'
    } else {
      const idx = visibleFields.value.findIndex((f) => f.name === brk.fieldName)
      if (idx < 0) continue
      columnStyle = `${idx + 2} / span 1`
    }
    out.push({
      brk,
      gridColumnStyle: columnStyle,
      gridRowStart: rows.rowStart,
      gridRowSpan: rows.rowSpan
    })
  }
  return out
})

// ── Drag-drop strips (cellInteraction === 'drop' only) ───────────
//
// One drop strip per (visibleField, row) where the row falls
// INSIDE the park scheduling window. Off-window rows have no
// strip so the user can't drop there.

interface DropStrip {
  field: SchedulerParkField
  rowIndex: number // 1-based
  startTime: string // 'HH:MM' 24h
  /** 1-based grid column. */
  gridColumn: number
}

const dropStrips = computed<DropStrip[]>(() => {
  if (props.cellInteraction !== 'drop') return []
  const park = axisPark.value
  const day = activeDay.value
  if (!park || !day) return []
  const axisStart = visualAxisStartMinutes(park)
  const out: DropStrip[] = []
  for (let row = 1; row <= axisRowCount.value; row++) {
    if (!isRowWithinWindow(row, park)) continue
    const startMin = axisStart + (row - 1) * ROW_GRANULARITY_MINUTES
    const hh = Math.floor(startMin / 60).toString().padStart(2, '0')
    const mm = (startMin % 60).toString().padStart(2, '0')
    const startTime = `${hh}:${mm}`
    for (let c = 0; c < visibleFields.value.length; c++) {
      out.push({
        field: visibleFields.value[c],
        rowIndex: row,
        startTime,
        gridColumn: c + 2
      })
    }
  }
  return out
})

// (Removed: per-hour `breakHoverPoints` computed + `BreakHoverPoint`
// interface. The "+ Break" hover affordance previously lived on
// every hour row of the time column; that interaction moved to a
// single "Add Break" button in the scheduler's park-head toolbar,
// so the per-row computed is no longer needed.)

// ── Event handlers ──────────────────────────────────────────────

function emitCellClickForGame(placed: PlacedGame) {
  if (props.cellInteraction === 'none') return
  if (!activeDay.value) return
  const time = placed.game.scheduledTime ?? formatTimeLabel(
    visualAxisStartMinutes(axisPark.value ?? props.park!) + (placed.gridRowStart - 1) * ROW_GRANULARITY_MINUTES
  )
  emit('cell-click', {
    date: activeDay.value.date,
    time,
    field: placed.field,
    game: placed.game
  })
}

/** Currently-hovered drop strip during a drag-over. Drives the
 *  `--active` highlight class on that strip so the user sees a
 *  visible drop target while the drag is in progress. Keyed by
 *  `${field.id}|${rowIndex}` for O(1) match in the template. */
const activeDropTargetKey = ref<string | null>(null)

function dropStripKey(strip: DropStrip): string {
  return `${strip.field.id}|${strip.rowIndex}`
}

// ── Drop-preview band ────────────────────────────────────────────
// Instead of highlighting a single 5-min strip, we paint a band that
// spans the full footprint a drop would occupy at the hovered row:
//   • plain hover (no drag) → the park's standard slot length, so the
//     admin sees how tall a game placed here would be;
//   • during a drag → the dragged game's (or break's) actual duration,
//     so they see exactly how many cells it will cover before releasing.
const hoverStrip = ref<DropStrip | null>(null)
const hoverMode = ref<'drag' | 'hover'>('hover')

/** True when the strip's row falls inside a game/break already placed in
 *  that column. Drop strips render on EVERY in-window row (drag needs them
 *  as targets), but a card's intentional margin leaves a thin gap where the
 *  strip beneath peeks through — so plain hover/click must ignore those
 *  occupied rows or the band/popup fires in the spacing between cards. */
function isRowOccupied(strip: DropStrip): boolean {
  const col = strip.gridColumn
  const r = strip.rowIndex
  for (const pg of placedGames.value) {
    if (pg.gridColumn !== col) continue
    if (r >= pg.gridRowStart && r < pg.gridRowStart + pg.gridRowSpan) return true
  }
  for (const pb of placedBreaks.value) {
    const blocksCol = pb.gridColumnStyle === '2 / -1' || pb.gridColumnStyle === `${col} / span 1`
    if (!blocksCol) continue
    if (r >= pb.gridRowStart && r < pb.gridRowStart + pb.gridRowSpan) return true
  }
  return false
}

function setHoverStrip(strip: DropStrip, mode: 'drag' | 'hover') {
  // Plain hover over a card's margin gap lands on the occupied row's strip —
  // suppress the band there. Also suppress entirely while add-slot is
  // disabled (e.g. bulk selection mode). Drag keeps all strips live.
  if (mode === 'hover' && (isRowOccupied(strip) || props.addSlotDisabled)) {
    clearHoverStrip()
    return
  }
  hoverStrip.value = strip
  hoverMode.value = mode
}
function clearHoverStrip() {
  hoverStrip.value = null
}

/** Footprint height (in 5-min rows) of the preview band. */
const previewRows = computed<number>(() => {
  const park = axisPark.value
  if (!park) return 1
  let minutes = 0
  if (hoverMode.value === 'drag') {
    if (draggingItemKey.value?.startsWith('break:')) {
      const id = draggingItemKey.value.slice('break:'.length)
      const brk = (props.parkBreaks ?? []).find((b) => b.id === id)
      minutes = brk?.durationMinutes ?? 0
    } else {
      const id = props.draggingGameId
        ?? (draggingItemKey.value?.startsWith('game:')
          ? draggingItemKey.value.slice('game:'.length)
          : null)
      const game = id ? props.games.find((g) => g.id === id) : null
      minutes = game
        ? effectiveGameDurationMinutes(game, park, props.eventDefaultGameDurationMinutes)
        : 0
    }
  } else {
    // Plain hover — the park's standard slot length.
    minutes = park.defaultGameDurationMinutes || props.eventDefaultGameDurationMinutes || 0
  }
  if (minutes <= 0) return 1
  return Math.max(1, Math.ceil(minutes / ROW_GRANULARITY_MINUTES))
})

/** Last 1-based row still inside the park's scheduling window — the band
 *  must never extend past it into the off-window band below. */
const maxWindowRow = computed<number>(() => {
  const park = axisPark.value
  if (!park) return axisRowCount.value
  let last = 0
  for (let r = 1; r <= axisRowCount.value; r++) {
    if (isRowWithinWindow(r, park)) last = r
  }
  return last || axisRowCount.value
})

/** Rows of EMPTY space available below (and including) the hovered row in
 *  its field column — i.e. the distance to the next occupied boundary (a
 *  game or break that starts at/below the row) or the window end. Lets the
 *  preview band fill only the free gap instead of bleeding into the next
 *  game/break. */
function availableRowsFrom(strip: DropStrip): number {
  const col = strip.gridColumn
  const startRow = strip.rowIndex
  // Window end is the first hard boundary (exclusive end = maxWindowRow + 1).
  let boundary = maxWindowRow.value + 1
  for (const pg of placedGames.value) {
    if (pg.gridColumn !== col) continue
    if (pg.gridRowStart > startRow) boundary = Math.min(boundary, pg.gridRowStart)
  }
  for (const pb of placedBreaks.value) {
    // Park-scope breaks (`2 / -1`) block every column; field-scope blocks
    // only its own column.
    const blocksCol = pb.gridColumnStyle === '2 / -1' || pb.gridColumnStyle === `${col} / span 1`
    if (!blocksCol) continue
    if (pb.gridRowStart > startRow) boundary = Math.min(boundary, pb.gridRowStart)
  }
  return Math.max(1, boundary - startRow)
}

/** Inline grid placement for the preview band — sized to the would-be
 *  footprint but clamped to the available empty space (next game/break or
 *  window end). `label` is the start–end range (same format as the grid
 *  cards, e.g. "9:00 AM – 10:30 AM"), shown centered in the box or as a
 *  tooltip when the box is too short. `null` when nothing hovered. */
const previewBand = computed<{ gridColumn: string; gridRow: string; minutes: number; label: string } | null>(() => {
  const strip = hoverStrip.value
  if (!strip) return null
  const span = Math.max(1, Math.min(previewRows.value, availableRowsFrom(strip)))
  const minutes = span * ROW_GRANULARITY_MINUTES
  const startMin = minutesFromMidnight(strip.startTime)
  return {
    gridColumn: `${strip.gridColumn} / span 1`,
    gridRow: `${strip.rowIndex} / span ${span}`,
    minutes,
    label: formatTimeRange(startMin, startMin + minutes)
  }
})

/** Key of the item (game or break) currently being dragged ON
 *  the grid — `game:<id>` / `break:<id>`. Drives a `--dragging`
 *  class on that one card. While dragging, the card gets
 *  `pointer-events: none` so the drop strips BENEATH its own
 *  multi-row footprint become reachable — otherwise a 90-min
 *  game card (z=3) would occlude the drop strips (z=1) at the
 *  rows it spans, blocking any drop within its own slot (e.g.
 *  nudging a 9:30 game to 10:00). The browser's drag-ghost
 *  still shows what's being moved, so hiding pointer events on
 *  the source card loses no visual cue. */
const draggingItemKey = ref<string | null>(null)

/** Cleared on `dragend` (fires on the source after a drop,
 *  Esc-cancel, or drop-outside) so the `--dragging` class +
 *  `pointer-events: none` are removed once the gesture ends. */
function onItemDragEnd() {
  draggingItemKey.value = null
  clearHoverStrip()
}

function onDropStrip(strip: DropStrip, evt: DragEvent) {
  if (props.cellInteraction !== 'drop') return
  if (!activeDay.value) return
  evt.preventDefault()
  // Clear the hover highlight + dragging flag on commit — even
  // if the parent rejects the drop (conflict toast), the drag
  // has ended so both should reset (dragend also clears the
  // dragging flag, but doing it here too guards against any
  // ordering quirk between drop and dragend).
  activeDropTargetKey.value = null
  draggingItemKey.value = null
  clearHoverStrip()
  // The strip's `startTime` is 24h HH:MM; we surface it as `time`
  // in the existing payload contract. Parent inspects
  // `event.dataTransfer` for the dragged game id and runs its
  // own `findConflicts` before commit.
  const time = strip.startTime
  emit('cell-drop', {
    date: activeDay.value.date,
    time,
    field: strip.field,
    game: null,
    event: evt
  })
}

function onDragoverStrip(strip: DropStrip, evt: DragEvent) {
  if (props.cellInteraction !== 'drop') return
  if (!activeDay.value) return
  evt.preventDefault()
  // Tag this strip as the active drop target so the template
  // applies the highlight class. Browsers fire `dragover` ~60
  // times per second while the cursor is over an element; the
  // assignment is idempotent (no-op when the value doesn't
  // change), so this is cheap.
  activeDropTargetKey.value = dropStripKey(strip)
  setHoverStrip(strip, 'drag')
  emit('cell-dragover', {
    date: activeDay.value.date,
    time: strip.startTime,
    field: strip.field,
    game: null,
    event: evt
  })
}

/** Click on an empty drop strip — surface the slot to the parent so it
 *  can offer an "add break / add game" popup. `availableMinutes` is the
 *  HIGHLIGHTED footprint the user tapped (the same span the hover band
 *  shows: the slot length clamped to the free gap), NOT the raw gap — so
 *  the popup's slot range + duration match what was highlighted. */
function onStripClick(strip: DropStrip, evt: MouseEvent) {
  if (props.cellInteraction !== 'drop') return
  if (!activeDay.value) return
  if (props.addSlotDisabled) return
  // Ignore clicks that land in a card's margin gap (occupied row) — those
  // aren't real empty slots.
  if (isRowOccupied(strip)) return
  const span = Math.max(1, Math.min(previewRows.value, availableRowsFrom(strip)))
  emit('cell-empty-click', {
    date: activeDay.value.date,
    time: strip.startTime,
    field: strip.field,
    availableMinutes: span * ROW_GRANULARITY_MINUTES,
    x: evt.clientX,
    y: evt.clientY
  })
}

/** Clear the highlight when the cursor leaves a strip without
 *  dropping (e.g. drags away to a different field column, drops
 *  outside the grid, or presses Esc). */
function onDragleaveStrip(strip: DropStrip) {
  if (activeDropTargetKey.value === dropStripKey(strip)) {
    activeDropTargetKey.value = null
  }
}

/** Drag-start handler on a game card already placed on the grid.
 *  Enables the reschedule-by-drag flow: the user grabs an
 *  existing scheduled game and drops it onto a different drop
 *  strip; the parent's `cell-drop` handler then conflict-checks
 *  against every OTHER game (and breaks) on the target field +
 *  date, and either commits the new placement or rejects with a
 *  toast.
 *
 *  We set `event.dataTransfer` here (mirroring how the source-
 *  list `SchedulerGameCard` does it) so the drop handler picks
 *  up the dragged game id via the same channel regardless of
 *  whether the drag started in the source list or on the grid. */
function onGameCardDragstart(game: SchedulerGame, evt: DragEvent) {
  if (props.cellInteraction !== 'drop') return
  // Locked games can't be moved — the scheduler view also
  // refuses any drop that targets a locked game (its
  // `commitGameMove` mutates the game's date/time/field). We
  // suppress the dragstart locally so the locked card never
  // even enters drag state, giving the user clear "this is
  // immovable" feedback (no ghost / no drag affordance).
  if (game.locked) {
    evt.preventDefault()
    return
  }
  if (!evt.dataTransfer) return
  // Prefix the payload so the drop handler can distinguish
  // games vs breaks dragged from the SAME grid. Using a
  // single `text/plain` channel with a tagged value keeps the
  // implementation simple and avoids browser quirks around
  // reading custom mime types mid-drag.
  evt.dataTransfer.setData('text/plain', `game:${game.id}`)
  evt.dataTransfer.effectAllowed = 'move'
  // Defer the `--dragging` flag one frame — setting it
  // synchronously inside `dragstart` risks the browser
  // snapshotting the drag-image AFTER `pointer-events: none`
  // applies (and some engines abort the drag if the source
  // mutates mid-start). One rAF tick later the drag is safely
  // underway.
  requestAnimationFrame(() => { draggingItemKey.value = `game:${game.id}` })
  emit('game-dragstart', { game, event: evt })
}

/** Drag-start on a break block — mirrors `onGameCardDragstart`
 *  but tags the payload with a `break:` prefix so the drop
 *  handler can route the move to the break-commit code path
 *  instead of the game-commit one. Conflict checks happen on
 *  the parent side once the drop fires. */
function onBreakDragstart(brk: SchedulerBreak, evt: DragEvent) {
  if (props.cellInteraction !== 'drop') return
  if (!evt.dataTransfer) return
  evt.dataTransfer.setData('text/plain', `break:${brk.id}`)
  evt.dataTransfer.effectAllowed = 'move'
  requestAnimationFrame(() => { draggingItemKey.value = `break:${brk.id}` })
  emit('break-dragstart', { brk, event: evt })
}

// (Removed: `onAddBreakClick` — was wired to the per-hour
// "+ Break" pill in the time column. The parent scheduler view
// now emits its own `break-add-request` from the park-head
// toolbar's "Add Break" button.)

// (Removed: break ellipsis-menu state — `openBreakMenuId`,
// `toggleBreakMenu`, `closeBreakMenu`, the document-mousedown
// outside-click closer. The break block's inline edit / delete
// icon buttons + the ellipsis-menu fallback were both removed
// in favour of a single click target that opens the Edit break
// popup, which now hosts the Delete action in its footer.)

// ── Date-strip height publisher (unchanged) ──────────────────────

const dateStripRef = ref<HTMLElement | null>(null)
let dateStripResizeObserver: ResizeObserver | null = null

function publishDateStripHeight() {
  if (!dateStripRef.value) return
  const h = dateStripRef.value.getBoundingClientRect().height
  document.documentElement.style.setProperty(
    '--matchgeni-field-grid-date-strip-height', `${Math.floor(h)}px`
  )
}

onMounted(() => {
  publishDateStripHeight()
  if (typeof ResizeObserver !== 'undefined') {
    if (dateStripRef.value) {
      dateStripResizeObserver = new ResizeObserver(() => publishDateStripHeight())
      dateStripResizeObserver.observe(dateStripRef.value)
    }
    if (gridRoot.value) {
      gridResizeObserver = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect?.width
        if (width) gridWidth.value = width
      })
      gridResizeObserver.observe(gridRoot.value)
      gridWidth.value = gridRoot.value.clientWidth || gridWidth.value
    }
  }
  window.addEventListener('resize', publishDateStripHeight)
})

onBeforeUnmount(() => {
  dateStripResizeObserver?.disconnect()
  gridResizeObserver?.disconnect()
  window.removeEventListener('resize', publishDateStripHeight)
})

watch(() => props.park, async () => {
  await nextTick()
  publishDateStripHeight()
}, { flush: 'post' })

/** Tag a placed game with whether it extends past the day's
 *  end — used by the template to paint a "Extends past day end"
 *  badge corner. */
function gameOverflowsDayEnd(placed: PlacedGame): boolean {
  const park = axisPark.value
  if (!park) return false
  const startMin = minutesFromMidnight(placed.game.scheduledTime ?? '')
  if (!Number.isFinite(startMin)) return false
  return startMin + placed.durationMinutes > windowEndMinutes(park)
}
function gameStartsBeforeWindow(placed: PlacedGame): boolean {
  const park = axisPark.value
  if (!park) return false
  const startMin = minutesFromMidnight(placed.game.scheduledTime ?? '')
  if (!Number.isFinite(startMin)) return false
  return startMin < windowStartMinutes(park)
}
</script>

<template>
  <div
    ref="gridRoot"
    class="field-grid"
  >
    <!-- Date strip — unchanged sticky chain. -->
    <div ref="dateStripRef" class="field-grid__date-strip">
      <button
        type="button"
        class="field-grid__date-arrow"
        aria-label="Previous dates"
        :disabled="!canPageDatesBackward"
        @click="pageDatesBackward"
      >
        <span class="field-grid__date-arrow-icon field-grid__date-arrow-icon--prev" aria-hidden="true"></span>
      </button>
      <div
        class="field-grid__date-list"
        :style="{ '--date-window-size': dateWindowSize }"
      >
        <button
          v-for="day in visibleDates"
          :key="day.date"
          type="button"
          class="field-grid__date-cell"
          :class="{ 'field-grid__date-cell--active': day.date === activeDate }"
          @click="emit('update:activeDate', day.date)"
        >
          <span class="field-grid__date-weekday">{{ day.weekdayLabel }}</span>
          <span class="field-grid__date-day-row">
            <span class="field-grid__date-day">{{ day.dayLabel }}</span>
            <span class="field-grid__date-month">{{ day.monthLabel }}</span>
          </span>
          <!-- Active-date weather corner — consumers (field-grid
               page) fill the `date-weather` slot; it renders at the
               bottom-right of the SELECTED date card and is CSS-
               gated to the responsive (≤720px) layout, where the
               toolbar weather is hidden and the forecast reads as
               "weather for THIS day" right where the date lives. -->
          <span
            v-if="day.date === activeDate && $slots['date-weather']"
            class="field-grid__date-weather"
          >
            <slot name="date-weather" />
          </span>
        </button>
      </div>
      <button
        type="button"
        class="field-grid__date-arrow"
        aria-label="Next dates"
        :disabled="!canPageDatesForward"
        @click="pageDatesForward"
      >
        <span class="field-grid__date-arrow-icon" aria-hidden="true"></span>
      </button>
    </div>

    <!-- Field bar — single sticky row that replaces the previous
         (a) `<thead>` row inside the calendar grid, (b) wide-mode
         field pager strip, AND (c) narrow-mode field selector
         strip. Behaviour:
           - Field-name cells sit in CSS Grid columns matching the
             body's column template (`96px repeat(N, 1fr)`), so
             each name lines up exactly above its body column.
           - The time column's 96px slot hosts the PREV arrow
             icon — time labels are obvious from the rows, so
             reusing that header slot for navigation saves a
             whole sticky bar's worth of vertical room.
           - NEXT arrow lives as an absolute-positioned chip on
             the bar's right edge.
           - Both arrows hide their `disabled` state when there's
             nowhere further to page; on narrow viewports where
             `fieldWindowSize === 1`, the bar naturally renders
             a single centered field name flanked by the arrows
             with no special branch in the template. -->
    <div
      v-if="park && park.fields.length > 0"
      class="field-grid__field-bar"
      :style="{ '--field-count': visibleFields.length }"
    >
      <button
        type="button"
        class="field-grid__field-bar-arrow field-grid__field-bar-arrow--prev"
        aria-label="Previous fields"
        :disabled="!canPageFieldsBackward"
        @click="pageFieldsBackward"
      >
        <span class="field-grid__date-arrow-icon field-grid__date-arrow-icon--prev" aria-hidden="true"></span>
      </button>
      <div
        v-for="(field, fIdx) in visibleFields"
        :key="`fld-bar-${field.id}`"
        class="field-grid__field-bar-name"
        :style="{ gridColumn: `${fIdx + 2} / ${fIdx + 3}` }"
      >{{ field.name }}</div>
      <button
        type="button"
        class="field-grid__field-bar-arrow field-grid__field-bar-arrow--next"
        aria-label="Next fields"
        :disabled="!canPageFieldsForward"
        @click="pageFieldsForward"
      >
        <span class="field-grid__date-arrow-icon" aria-hidden="true"></span>
      </button>
    </div>

    <!-- Calendar grid — replaces the old `<table>` body. CSS Grid
         with the time column at col 1 and one column per visible
         field. Rows = 30-min granularity from the park's visual
         axis start to end. Games, breaks, off-window bands, and
         drop strips all position themselves via inline
         `grid-row` / `grid-column`. -->
    <div class="field-grid__grid-wrap">
      <div
        v-if="park && activeDay"
        class="field-grid__calendar"
        :style="{
          '--row-count': axisRowCount,
          '--row-size': `${ROW_GRANULARITY_MINUTES * PX_PER_MINUTE}px`,
          '--field-count': visibleFields.length
        }"
        @mouseleave="clearHoverStrip"
      >
        <!-- Field-name column headers moved OUT of this grid into
             the sibling sticky `.field-grid__field-bar` ABOVE
             (which absorbed the prev/next field pager + narrow-
             mode field selector into one merged row). The body
             grid now starts at row 1 — there's no header row to
             skip, so all `grid-row` position math below uses the
             raw body-relative index (no `+ 1` offset). -->
        <!-- Hour gridlines. Painted as full-width 1px borders at
             the top of each hour-anchored body row. -->
        <div
          v-for="(hour, idx) in hourRows"
          :key="`hour-line-${hour.startMinutes}`"
          class="field-grid__cal-hourline"
          :class="{ 'field-grid__cal-hourline--first': idx === 0 }"
          :style="{
            gridColumn: '1 / -1',
            gridRow: `${Math.round((hour.startMinutes - visualAxisStartMinutes(park)) / ROW_GRANULARITY_MINUTES) + 1} / span 1`
          }"
        ></div>

        <!-- Half-hour subdivision lines — every odd body row. Painted
             as a fainter dashed border. We paint one per body row
             (excluding the hour-aligned rows which already get a
             solid line above). -->
        <template v-for="row in axisRowCount" :key="`subline-${row}`">
          <div
            v-if="((visualAxisStartMinutes(park) + (row - 1) * ROW_GRANULARITY_MINUTES) % 60) === 30"
            class="field-grid__cal-halfline"
            :style="{
              gridColumn: '1 / -1',
              gridRow: `${row} / span 1`
            }"
          ></div>
        </template>

        <!-- Time-column hour labels. Sticky-left so they ride
             horizontal scroll along with the field columns.
             Span the full hour (2 rows) so the col-1 right-edge
             divider stays continuous, but use a TRANSPARENT
             background (see the CSS below) so the dashed
             `field-grid__cal-halfline` border drawn at the
             half-hour boundary shows through the time column
             too. The label text + add-break pill align to the
             TOP of the cell (anchored to the hour mark itself);
             the lower 30-min half stays visually clear so the
             user sees the half-hour subdivision in all columns. -->
        <div
          v-for="hour in hourRows"
          :key="`hour-label-${hour.startMinutes}`"
          class="field-grid__cal-time-label"
          :style="{
            gridColumn: '1 / span 1',
            gridRow: `${Math.round((hour.startMinutes - visualAxisStartMinutes(park)) / ROW_GRANULARITY_MINUTES) + 1} / span ${60 / ROW_GRANULARITY_MINUTES}`
          }"
        >
          <span class="field-grid__cal-time-label-text">{{ hour.label }}</span>
          <!-- Hover-add-break affordance moved OUT of the time
               column into a dedicated "Add Break" button in the
               scheduler's park-head toolbar. The button-per-hour
               pattern crowded the time column and made the
               affordance discoverable only on hover; a single
               top-toolbar entry is clearer and works at every
               screen size. -->
        </div>

        <!-- Off-window blocked bands. Striped, no drop targets,
             tooltip explains why. -->
        <div
          v-for="(band, idx) in offWindowBandsList"
          :key="`offwin-${idx}-${band.kind}`"
          class="field-grid__cal-off-window"
          :style="{
            gridColumn: '2 / -1',
            gridRow: `${band.rowStart} / span ${band.rowSpan}`
          }"
          title="Outside park hours"
        >
          <span v-if="band.rowSpan >= 2" class="field-grid__cal-off-window-label">
            Outside park hours
          </span>
        </div>

        <!-- Break blocks. Park-scope spans all field columns; field-
             scope spans one column. Edit / remove affordances only on
             the scheduler. -->
        <div
          v-for="placed in placedBreaks"
          :key="`break-${placed.brk.id}`"
          class="field-grid__cal-break"
          :class="{
            'field-grid__cal-break--field-scope': placed.brk.scope === 'field',
            'field-grid__cal-break--tall': placed.brk.durationMinutes > 30,
            'field-grid__cal-break--draggable': cellInteraction === 'drop',
            'field-grid__cal-break--dragging': draggingItemKey === `break:${placed.brk.id}`
          }"
          :draggable="cellInteraction === 'drop'"
          @click="cellInteraction === 'drop' && emit('break-edit-request', placed.brk)"
          @dragstart="onBreakDragstart(placed.brk, $event)"
          @dragend="onItemDragEnd"
          :style="{
            gridColumn: placed.gridColumnStyle,
            gridRow: `${placed.gridRowStart} / span ${placed.gridRowSpan}`
          }"
        >
          <span class="field-grid__cal-break-label">
            {{ placed.brk.label || 'Break' }}
          </span>
          <span class="field-grid__cal-break-time">
            <!-- Three-part time tag:
                   `--start` — absolute start time ("12:30 PM"),
                               ALWAYS visible.
                   `--end`   — " – " + end time ("– 1:00 PM"),
                               computed as start + durationMinutes.
                               HIDES via container query when the
                               break narrows so the start + duration
                               survive the squeeze.
                   `--dur`   — " · 30m" minute count, ALWAYS
                               visible. -->
            <span class="field-grid__cal-break-time-start">{{ formatTimeLabel(minutesFromMidnight(placed.brk.startTime)) }}</span><span class="field-grid__cal-break-time-end"> – {{ formatTimeLabel(minutesFromMidnight(placed.brk.startTime) + placed.brk.durationMinutes) }}</span><span class="field-grid__cal-break-time-dur"> · {{ placed.brk.durationMinutes }}m</span>
          </span>
          <!-- Inline edit / delete icon buttons + the ellipsis-menu
               fallback were removed entirely. Clicking anywhere on
               the break block now opens the Edit break popup
               (which hosts a `Delete` button in its footer for the
               destructive action). One click target — no separate
               affordance for the action menu. -->
        </div>

        <!-- Drop strips — one per (field column × in-window row).
             Each strip is a transparent target that accepts dragover
             + drop. Off-window rows have no strip (the off-window
             band sits there + has pointer-events: none, so the
             dragged card can't land in that range). -->
        <div
          v-for="strip in dropStrips"
          :key="`drop-${strip.field.id}-${strip.rowIndex}`"
          class="field-grid__cal-drop-strip"
          :style="{
            gridColumn: `${strip.gridColumn} / span 1`,
            gridRow: `${strip.rowIndex} / span 1`
          }"
          @mouseenter="setHoverStrip(strip, 'hover')"
          @click="onStripClick(strip, $event)"
          @dragover="onDragoverStrip(strip, $event)"
          @dragleave="onDragleaveStrip(strip)"
          @drop="onDropStrip(strip, $event)"
        ></div>

        <!-- Drop-preview band — spans the footprint a drop would occupy at
             the hovered row (park slot length on plain hover; the dragged
             item's duration mid-drag). Purely visual: `pointer-events: none`
             so the strips beneath stay the actual drop targets. -->
        <div
          v-if="previewBand"
          class="field-grid__cal-drop-preview"
          :style="{ gridColumn: previewBand.gridColumn, gridRow: previewBand.gridRow }"
          aria-hidden="true"
        >
          <!-- Duration label centered in the box; for short slots (< 15 min)
               the box can't fit text, so it floats above as a tooltip. -->
          <span
            v-if="previewBand.minutes >= 15"
            class="field-grid__cal-drop-preview-label"
          >
            <span class="field-grid__cal-drop-preview-time">{{ previewBand.label }}</span>
            <span
              v-if="previewBand.minutes >= 30"
              class="field-grid__cal-drop-preview-hint"
            >Tap to add break/game</span>
          </span>
          <span
            v-else
            class="field-grid__cal-drop-preview-tip"
          >{{ previewBand.label }}</span>
        </div>

        <!-- Games — positioned by `gameGridRows`. Card content is
             slot-supplied; we wrap the slot in a clickable surface
             that emits `cell-click` so the calendar / scoring
             surface still gets its drawer trigger. -->
        <div
          v-for="placed in placedGames"
          :key="`game-${placed.game.id}`"
          class="field-grid__cal-game"
          :class="{
            'field-grid__cal-game--compact': placed.gridRowSpan <= 2,
            'field-grid__cal-game--clickable': cellInteraction !== 'none',
            'field-grid__cal-game--overflow-end': gameOverflowsDayEnd(placed),
            'field-grid__cal-game--overflow-start': gameStartsBeforeWindow(placed),
            'field-grid__cal-game--locked': placed.game.locked,
            'field-grid__cal-game--draggable':
              cellInteraction === 'drop' && !placed.game.locked,
            'field-grid__cal-game--dragging':
              draggingItemKey === `game:${placed.game.id}`
          }"
          :style="{
            gridColumn: `${placed.gridColumn} / span 1`,
            gridRow: `${placed.gridRowStart} / span ${placed.gridRowSpan}`
          }"
          :title="gameOverflowsDayEnd(placed)
            ? 'Extends past day end'
            : gameStartsBeforeWindow(placed)
              ? 'Starts before park hours'
              : ''"
          :draggable="cellInteraction === 'drop' && !placed.game.locked"
          @click="emitCellClickForGame(placed)"
          @dragstart="onGameCardDragstart(placed.game, $event)"
          @dragend="onItemDragEnd"
        >
          <slot
            name="cell"
            :game="placed.game"
            :field="placed.field"
            :date="activeDay.date"
            :time="placed.game.scheduledTime ?? ''"
            :size="placed.gridRowSpan >= 3 ? 'full' : placed.gridRowSpan === 2 ? 'compact' : 'mini'"
            :compact="placed.gridRowSpan <= 2"
            :duration-minutes="placed.durationMinutes"
          >
            <article class="field-grid__grid-pill">
              <span class="field-grid__grid-pill-label">{{ placed.game.label }}</span>
              <span class="field-grid__grid-pill-teams">
                <span v-if="placed.game.team1Label">{{ placed.game.team1Label }}</span>
                <span v-if="placed.game.team2Label">{{ placed.game.team2Label }}</span>
              </span>
            </article>
          </slot>
        </div>

        <!-- Ghost preview games — translucent + dashed, non-interactive.
             Show where games WOULD land (bulk Move destination preview). -->
        <div
          v-for="placed in placedPreviewGames"
          :key="`preview-${placed.game.id}`"
          class="field-grid__cal-game field-grid__cal-game--preview"
          :class="{ 'field-grid__cal-game--compact': placed.gridRowSpan <= 2 }"
          :style="{
            gridColumn: `${placed.gridColumn} / span 1`,
            gridRow: `${placed.gridRowStart} / span ${placed.gridRowSpan}`
          }"
          aria-hidden="true"
        >
          <slot
            name="cell"
            :game="placed.game"
            :field="placed.field"
            :date="activeDay.date"
            :time="placed.game.scheduledTime ?? ''"
            :size="placed.gridRowSpan >= 3 ? 'full' : placed.gridRowSpan === 2 ? 'compact' : 'mini'"
            :compact="placed.gridRowSpan <= 2"
            :duration-minutes="placed.durationMinutes"
          >
            <article class="field-grid__grid-pill">
              <span class="field-grid__grid-pill-label">{{ placed.game.label }}</span>
            </article>
          </slot>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.field-grid {
  display: block;
  /* `min-width: 0` so the component CAN shrink inside a flex /
     grid parent (e.g. the scheduler's `.scheduler__grid-shell`
     which is a flex column). Without this, the field-grid's
     default `min-width: auto` (≈ its min-content width) wins
     against a `1fr` parent track, refusing to shrink and
     forcing horizontal page scroll. */
  min-width: 0;
  /* `max-width: 100%` is the belt to that `min-width: 0`
     suspenders — even if a child somehow leaks intrinsic
     content width up here, this clamps the field-grid to its
     parent's width and the overflow stays internal. */
  max-width: 100%;
}

/* ─── Date strip ─────────────────────────────────────────────── */

.field-grid__date-strip {
  position: sticky;
  top: calc(var(--matchgeni-field-grid-top, 0px) - 1px);
  margin-top: -1px;
  z-index: 3;
  display: grid;
  grid-template-columns: 30px 1fr 30px;
  gap: 6px;
  align-items: center;
  padding: 0 10px;
  background: #ffffff;
  border-bottom: 1px solid var(--border-divider);
}
html.dark-mode .field-grid__date-strip {
  background: #1a2028;
}

.field-grid__date-arrow {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border-radius: 999px;
  border: 1px solid var(--border-divider);
  background: var(--surface-card);
  color: var(--secondary);
  cursor: pointer;
}
.field-grid__date-arrow:hover:not(:disabled) {
  background: var(--surface-raised);
}
.field-grid__date-arrow:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.field-grid__date-arrow-icon {
  display: inline-block;
  width: 12px;
  height: 12px;
  background-color: currentColor;
  -webkit-mask-image: url('../assets/arrow-right.svg');
  mask-image: url('../assets/arrow-right.svg');
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
}
.field-grid__date-arrow-icon--prev {
  transform: scaleX(-1);
}

.field-grid__date-list {
  display: grid;
  grid-template-columns: repeat(var(--date-window-size, 7), 1fr);
  gap: 6px;
}
.field-grid__date-cell {
  appearance: none;
  background: none;
  border: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  padding: 9px 4px;
  cursor: pointer;
  color: var(--secondary);
  font-size: 11px;
  line-height: 1.15;
}
.field-grid__date-cell:hover {
  background: var(--surface-raised);
}
.field-grid__date-weekday {
  font-weight: 500;
  color: var(--secondary);
}
.field-grid__date-day-row {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  line-height: 1;
}
.field-grid__date-day {
  font-weight: 700;
  font-size: 15px;
  color: var(--text);
  line-height: 1;
}
.field-grid__date-cell--active .field-grid__date-day {
  color: var(--primary);
}
/* Active-date weather corner — hidden by default; only the
   responsive (≤720px) layout surfaces it, pinned to the bottom-
   right of the selected date card (the toolbar weather is hidden
   at that width so the forecast lives next to the date instead). */
.field-grid__date-weather {
  display: none;
}
@media (max-width: 720px) {
  .field-grid__date-cell--active {
    position: relative;
    padding-bottom: 24px;
  }
  .field-grid__date-cell--active .field-grid__date-weather {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    position: absolute;
    right: 10px;
    bottom: 6px;
  }
}
.field-grid__date-cell--active {
  background: var(--primary-light-3);
  border-radius: 0;
}
.field-grid__date-cell--active .field-grid__date-weekday,
.field-grid__date-cell--active .field-grid__date-month {
  color: var(--primary);
}
html.dark-mode .field-grid__date-cell--active {
  background: rgba(45, 140, 240, 0.18);
}
.field-grid__date-month {
  font-size: 11px;
  text-transform: lowercase;
}

/* ─── Field bar ──────────────────────────────────────────────
   Merged sticky row that absorbed THREE previously separate
   elements:
     - the old `.field-grid__cal-header` row (in-grid column
       headers with the "Time" cell + field names)
     - the wide-mode `.field-grid__field-pager` strip
       ("Prev fields | 2–3 of 8 | Next fields")
     - the narrow-mode `.field-grid__narrow-nav` strip
       (single field name flanked by < > arrows)
   One unified bar handles all viewport widths: the prev/next
   arrows page through the field window (1 / 2 / 4 / 6 / All
   fields per `fieldWindowSize`), and field-name cells sit in
   CSS Grid columns that match the body grid's column template
   so each name aligns exactly above its respective body
   column. */
.field-grid__field-bar {
  position: sticky;
  top: calc(
    var(--matchgeni-field-grid-top, 0px)
    + var(--matchgeni-field-grid-date-strip-height, 56px)
    - 1px
  );
  z-index: 4;
  /* Grid template matches the body's `96px repeat(--field-count,
     1fr)` so the field-name cells (placed in cols 2..N+1) line
     up exactly over the body's field tracks. The 96px first
     track hosts the PREV arrow chip — the same space the time
     col below uses; time labels aren't needed in a header
     since the hour rows speak for themselves.
     NO padding on the bar — adding `padding-left` would shift
     the bar's tracks right by that amount and break alignment
     with the body grid. Arrow positioning is handled by inset
     `margin-left` on prev and `right` on absolute-positioned
     next, both matching the DATE STRIP's `padding: 0 10px`
     edge inset so the two sticky chrome rows align visually. */
  display: grid;
  grid-template-columns: 96px repeat(var(--field-count, 1), minmax(0, 1fr));
  align-items: center;
  /* Bar height matches the date strip's natural height (~48px
     from `30px arrow + 18px date-cell padding`), so the two
     sticky chrome rows read as a coherent stack. */
  min-height: 48px;
  background: #ffffff;
  border-bottom: 1px solid rgba(60, 80, 110, 0.28);
  box-shadow: 0 6px 14px -14px rgba(13, 30, 58, 0.55);
}
html.dark-mode .field-grid__field-bar {
  background: #1a2028;
  border-bottom-color: rgba(255, 255, 255, 0.18);
  box-shadow: 0 6px 14px -14px rgba(0, 0, 0, 0.85);
}
/* Field-name cell — text-only label sitting above its body
   column. The right-most visible name gets extra padding to
   keep clear of the absolute-positioned NEXT arrow chip on the
   bar's right edge. */
.field-grid__field-bar-name {
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.field-grid__field-bar-name:last-of-type {
  /* Right-most name needs breathing room next to the NEXT
     arrow that overlays the bar's right edge. */
  padding-right: 36px;
}
/* Prev / Next arrow chips — circular icon buttons. Prev sits
   INSIDE the 96px first column (matching the time-col below).
   Next overlays the right edge of the bar as a positioned
   chip so it doesn't widen the grid template. */
.field-grid__field-bar-arrow {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border-radius: 999px;
  border: 1px solid var(--border-divider);
  background: var(--surface-card);
  color: var(--secondary);
  cursor: pointer;
  flex: 0 0 auto;
}
.field-grid__field-bar-arrow:hover:not(:disabled) {
  background: var(--surface-raised);
  color: var(--primary);
}
.field-grid__field-bar-arrow:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.field-grid__field-bar-arrow--prev {
  /* Prev sits in col 1 (the 96px time-col-equivalent slot) at
     its LEFT edge — `justify-self: start` + `margin-left: 10px`
     places the chip's centre at x=25 from the bar's left edge,
     matching the DATE STRIP's prev-arrow position (which uses
     `padding: 0 10px` + a 30px arrow in col 1 of its 30/1fr/30
     grid → arrow centre at x=25 as well). The two sticky rows'
     prev arrows now line up vertically. */
  grid-column: 1 / 2;
  justify-self: start;
  margin-left: 10px;
}
.field-grid__field-bar-arrow--next {
  /* Next is absolute-positioned at the bar's right edge so the
     grid template can stay as a clean `96px + N×1fr` (matching
     the body) without an extra trailing column that would
     misalign with the body's right edge. `right: 10px` matches
     the date strip's `padding-right: 10px` so the two sticky
     rows' next arrows also line up vertically. */
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
}

/* ─── Calendar grid (NEW) ────────────────────────────────────── */

.field-grid__grid-wrap {
  border-top: 1px solid var(--border-divider);
  margin-top: -1px;
  /* IMPORTANT: keep `overflow` at `visible` on BOTH axes. CSS has
     a quirky rule — when `overflow-x` (or `-y`) is set to anything
     other than `visible`, the OPPOSITE axis is computed to `auto`
     too. Setting `overflow-x: auto` here made the wrap a Y-axis
     scroll container as a side-effect, which then captured the
     calendar header row's `position: sticky` — pinning it inside
     the wrap (~145px below its own top) instead of below the
     date strip on the page viewport. Field-count responsiveness
     is handled by the component's own `fieldWindowSize` paging
     (which already filters `visibleFields` based on element
     width via ResizeObserver) — not by horizontal overflow on
     this container. */
  min-width: 0;
}

/* The calendar uses CSS Grid:
   - Col 1: time column (fixed 96px), sticky-left.
   - Col 2+: field columns (1fr each, min 140px).
   - Row 1: header row (Time | Field 1 | Field 2 | …).
   - Row 2…N+1: 30-min body rows. CSS variable `--row-size` controls
     the row height — 30px gives 60px per hour, which is the visual
     density that reads as a real calendar without making the grid
     enormous on multi-hour windows. */
.field-grid__calendar {
  display: grid;
  /* `minmax(0, 1fr)` (NOT `minmax(140px, 1fr)`) — columns share
     the available width equally and SHRINK to fit narrow
     viewports. `min-width: max-content` is also dropped: with
     it, the grid refused to shrink below 8 × 140 + 96 = 1216px
     and forced a horizontal scrollbar, which broke the previous
     `<table>`'s `table-layout: fixed` behavior. Field-count
     responsiveness is handled INSIDE the component via
     `fieldWindowSize` + `visibleFields` (a ResizeObserver-driven
     window that drops field columns when the element narrows),
     so the grid never needs to overflow horizontally — it just
     paints fewer columns at smaller widths. */
  grid-template-columns: 96px repeat(var(--field-count, 1), minmax(0, 1fr));
  /* Body row height — 44px per 30-min row. Game cards get
     meaningful vertical room (88px for a 60-min game; 132px
     for 90-min). No header row in the grid template anymore —
     the field-name column headers + prev/next pager arrows
     moved up into the sibling `.field-grid__field-bar` sticky
     strip above this grid. */
  grid-template-rows: repeat(var(--row-count, 0), var(--row-size, 44px));
  /* `width: 100%` (with `min-width: 0`) explicitly anchors the
     grid to its parent's width so the implicit grid-container
     auto-sizing can't size it to its max-content (which 8 field
     columns of nowrap-team-name cards would push wide enough
     to trigger horizontal page scroll). Combined with the
     `minmax(0, 1fr)` columns above, the field tracks share the
     parent's available space equally and items overflow within
     their own cells (where the inner card's `overflow: hidden`
     clips them) — never escaping to widen the page. */
  width: 100%;
  min-width: 0;
  /* Calendar-style row gridlines are painted via the hourline +
     halfline elements below, so the grid itself draws no inter-
     cell borders. */
  background: var(--surface-card);
  position: relative;
  /* `isolation: isolate` creates a NEW stacking context scoped to
     this grid. Without it, the grid's positioned children (game
     cards z=3, breaks z=4, sticky headers z=5) participate in
     the PARENT stacking context and compete directly with the
     sticky date strip above (also z=3). Because the calendar
     comes AFTER the date strip in DOM order, game cards were
     winning the tie and painting OVER the date strip as the
     user scrolled them up past the pinned strip. Isolating the
     calendar contains all those z-indexes inside this grid's
     own context, so against the date strip the comparison
     becomes "calendar (no z-index) vs date strip (z=3)" at the
     parent level — and the date strip wins cleanly. */
  isolation: isolate;
}
html.dark-mode .field-grid__calendar {
  background: #1a2028;
}

/* Header row — sticky to the bottom of the date strip chain. */
/* (Removed: `.field-grid__cal-header*` rules — the in-grid
   column-header row was lifted out into the sibling
   `.field-grid__field-bar` sticky strip above the calendar.
   The bar's `border-bottom` now plays the same role this rule's
   border did: bottom edge of the field-name row + visual
   anchor for the calendar's first body row.) */

/* Time-column hour labels — sticky-left so they ride the horizontal
   scroll. Stacked with the add-break button below the label. */
.field-grid__cal-time-label {
  position: sticky;
  left: 0;
  z-index: 2;
  /* NO background here — the calendar grid's own surface-card
     bg fills col 1 already, and dropping the explicit fill on
     this cell lets the `field-grid__cal-halfline` dashed
     subdivision AND `field-grid__cal-hourline` solid line
     below paint through the half-hour / hour portion of the
     label cell. With a solid bg those gridlines were
     invisible inside the time column (covered by the label).
     The text + add-break pill anchor to the TOP of the cell
     (`justify-content: flex-start`), so the lower half stays
     clean and the dashed line reads naturally there.

     NO `border-top` here either — previously this painted its
     own hour boundary using `var(--border-divider)`, which
     resolves to a DIFFERENT colour/alpha than the
     `.field-grid__cal-hourline` element used in the rest of
     the grid (`rgba(207,220,234,0.85)` light token vs
     `rgba(60,80,110,0.5)` explicit; even worse in dark mode,
     where `--border-divider` is rgba white 0.08 vs the hour-
     line's rgba white 0.5). Letting the hourline element show
     through unifies the hour stroke across every column. */
  border-right: 1px solid var(--border-divider);
  padding: 6px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
  justify-content: flex-start;
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  /* `pointer-events: none` on the label container, then re-
     enable on the `+ Break` button below. Without this, the
     transparent half-hour portion of the (now-no-background)
     cell still captures hover events and blocks any drop
     strip / break-hover affordance painted at that row in
     other columns. */
  pointer-events: none;
}
.field-grid__cal-time-label-text {
  pointer-events: auto;
  font-weight: 600;
}
/* (Removed: `.field-grid__cal-add-break` rules — the per-hour
   "+ Break" pill in the time column is gone, replaced by a
   single "Add Break" button in the scheduler's park-head
   toolbar.) */

/* Hour gridline — 1px solid. Same stroke weight as the half-hour
   line below; the visual distinction is solid vs dashed only.
   Light mode: subdued slate at 0.28 alpha so the grid recedes
   behind the cards. Dark mode: subdued white at 0.18 alpha
   (eye reads white-on-dark stronger than slate-on-light at
   equal alpha, so the dark-mode value is intentionally lower
   to match the perceived dullness in light). */
.field-grid__cal-hourline {
  border-top: 1px solid rgba(60, 80, 110, 0.28);
  pointer-events: none;
  z-index: 0;
}
html.dark-mode .field-grid__cal-hourline {
  border-top-color: rgba(255, 255, 255, 0.18);
}
/* Suppress the first hour's top border — the header row already
   draws a divider below itself. */
.field-grid__cal-hourline--first {
  border-top: 0;
}

/* Half-hour subdivision — 1px dashed at matched alpha. The
   dashed pattern alone communicates "secondary subdivision";
   colour weight matches the hour line so the two read as the
   same colour family, distinguished only by stroke style. */
.field-grid__cal-halfline {
  border-top: 1px dashed rgba(60, 80, 110, 0.28);
  pointer-events: none;
  z-index: 0;
}
html.dark-mode .field-grid__cal-halfline {
  border-top-color: rgba(255, 255, 255, 0.18);
}

/* Off-window blocked band. Diagonal-stripe background so it reads
   as "intentionally blocked", neutral grey not red (it's not an
   error, just out-of-hours). */
.field-grid__cal-off-window {
  background-image: repeating-linear-gradient(
    -45deg,
    rgba(120, 130, 145, 0.06) 0,
    rgba(120, 130, 145, 0.06) 6px,
    rgba(120, 130, 145, 0.14) 6px,
    rgba(120, 130, 145, 0.14) 12px
  );
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--secondary);
  font-style: italic;
  pointer-events: none;
  z-index: 1;
}
html.dark-mode .field-grid__cal-off-window {
  background-image: repeating-linear-gradient(
    -45deg,
    rgba(255, 255, 255, 0.04) 0,
    rgba(255, 255, 255, 0.04) 6px,
    rgba(255, 255, 255, 0.09) 6px,
    rgba(255, 255, 255, 0.09) 12px
  );
}

/* Break block. Distinct from off-window — darker stripe + tinted
   so the user reads it as an EVENT (someone explicitly added it),
   not a passive constraint. Uses a NEUTRAL slate-blue palette for
   BOTH park-wide and field-scope variants (the amber palette
   collided with the warning / status colors elsewhere on the grid).
   Differentiation between scopes is communicated by the block's
   width (park-wide spans every field column; field-scope spans
   one), not by a colour change. */
.field-grid__cal-break {
  background-image: repeating-linear-gradient(
    -45deg,
    rgba(120, 140, 180, 0.12) 0,
    rgba(120, 140, 180, 0.12) 6px,
    rgba(120, 140, 180, 0.24) 6px,
    rgba(120, 140, 180, 0.24) 12px
  );
  border: 1px dashed rgba(120, 140, 180, 0.65);
  border-radius: 4px;
  margin: 2px 4px;
  padding: 6px 10px;
  /* Two-row stack for ALL break durations (30 / 60 / 90 min):
       Row 1 : label
       Row 2 : time (start–end · duration)
     `align-content: start` pins the rows to the TOP of the block
     so a tall (60 / 90 min) break shows the info at the top with
     empty striped space below, rather than stretching the rows
     to fill the block. The previous `actions` grid-area (inline
     edit / delete + ellipsis menu) was removed — the entire
     block is now clickable and opens the Edit break popup. */
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: auto auto;
  grid-template-areas:
    'label'
    'time';
  row-gap: 2px;
  align-content: start;
  align-items: center;
  font-size: 12px;
  color: var(--secondary);
  /* Breaks paint IN FRONT of game cards on the same rows (z=4
     vs game's z=3) while staying below the sticky column-
     headers (z=5). */
  z-index: 4;
  /* `container-type: inline-size` makes the break block its own
     container-query root — responsive rules below react to THIS
     block's width, not the viewport. */
  container-type: inline-size;
  min-width: 0;
  /* `position: relative` anchors the ellipsis popover (rendered
     as an absolutely-positioned child below) to this break.
     We INTENTIONALLY do NOT set `overflow: hidden` here — the
     popover needs to escape the block's vertical bounds on
     short 30-min breaks. Child elements that need to clip
     (label, time text) carry their own `overflow: hidden`. */
  position: relative;
}

/* (No `--tall` variant overrides — every break duration uses
   the same 2-column / 2-row grid template defined above. The
   `align-content: start` on the container pins the content to
   the TOP of the card so 60 / 90 min breaks show the label +
   time at the top with empty striped space below, instead of
   having the rows stretch to fill the block. The class is
   still applied in the template as a hook for future styling
   needs but has no rules of its own.) */

/* Draggable variant — only set on the scheduler (write) surface.
   Same `cursor: grab` / `grabbing` affordance the game cards use.
   `user-select: none` prevents the browser from starting a text
   selection on mousedown — which otherwise competes with the
   drag gesture and can swallow it. Action buttons inside keep
   their pointer cursor via their own rules. */
.field-grid__cal-break--draggable {
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
}
.field-grid__cal-break--draggable:active {
  cursor: grabbing;
}
/* While a break is mid-drag, make its on-grid block transparent
   to pointer events so the drop strips beneath its own footprint
   are reachable — lets the user nudge a break within its own
   span. The drag-ghost provides the visual cue. Slight opacity
   dim signals "this is the thing moving". */
.field-grid__cal-break--dragging {
  pointer-events: none;
  opacity: 0.4;
}
html.dark-mode .field-grid__cal-break {
  color: var(--text);
}
/* No `--field-scope` style override — both park-wide and
   field-scope breaks share the same neutral slate-blue
   surface defined above. The scope distinction is signalled
   by the block's WIDTH (park-wide spans all field columns,
   field-scope spans one), not by a colour swap. */
.field-grid__cal-break-label {
  grid-area: label;
  font-weight: 700;
  font-size: 12px;
  /* Label ellipses when space is tight. */
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.field-grid__cal-break-time {
  grid-area: time;
  font-size: 12px;
  /* Stronger explicit color in both themes — earlier this used
     `opacity: 0.85` on top of the inherited `var(--secondary)`,
     which compounded to barely-readable in light mode against
     the slate-blue striped break background. Using a direct
     theme-token color (with full opacity) gives the time row
     reliable contrast at the small font size. */
  color: var(--text);
  white-space: nowrap;
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* All three time spans (start · end · duration) share the same
   colour + size from the parent `.field-grid__cal-break-time`
   block. Font-weight is matched at 500 across the trio so they
   read as one coherent time string rather than three different
   visual weights. */
.field-grid__cal-break-time-start,
.field-grid__cal-break-time-end,
.field-grid__cal-break-time-dur {
  font-weight: 500;
  color: inherit;
}
/* Container-query collapse — when the break block itself is
   narrower than 280px (typical single-column field-scope width),
   drop ONLY the end-time portion ("– 1:00 PM"). The start time
   and duration ("12:30 PM · 30m") survive because they're the
   compulsory info per the layout spec. The end time can be
   re-derived by the user from start + duration if needed. */
@container (max-width: 280px) {
  .field-grid__cal-break-time-end {
    display: none;
  }
}
/* (Removed: `.field-grid__cal-break-actions*`, the inline
   icon-button chrome (`.field-grid__cal-break-btn*`), the
   ellipsis-trigger overrides for `.ellipsis-button` inside a
   break, and the container-query swap that toggled between
   inline icons and the ellipsis fallback. The break block is
   now a single clickable surface that opens the Edit break
   popup — destructive Delete moved into that popup's footer.) */

/* Drop strip — invisible target. No per-strip highlight: the
   `.field-grid__cal-drop-preview` band (driven from script on hover /
   dragover) provides the visual cue and spans the full slot footprint,
   so a single 5-min strip no longer lights up on its own. */
.field-grid__cal-drop-strip {
  background: transparent;
  border-right: 1px solid transparent;
  z-index: 1;
  /* Clickable — opens the add break / add game popover at the slot. */
  cursor: pointer;
}

/* Drop-preview band — the "selected slot area". Tinted fill + dashed
   primary outline, sized to the would-be footprint. Sits above the
   strips (z=1) but below game cards (z=3); never intercepts pointer
   events so the strips beneath remain the drop targets. */
.field-grid__cal-drop-preview {
  z-index: 2;
  pointer-events: none;
  margin: 0 1px;
  border-radius: 4px;
  background: var(--primary-light-3);
  outline: 2px dashed var(--primary);
  outline-offset: -2px;
  /* Center the duration label in the box. `position: relative` anchors the
     short-slot tooltip that floats above. */
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
html.dark-mode .field-grid__cal-drop-preview {
  background: rgba(45, 140, 240, 0.18);
  outline-color: #7fb0e8;
}
/* Time + hint stacked, centered inside the band (slots ≥ 15 min). */
.field-grid__cal-drop-preview-label {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 0 4px;
  text-align: center;
}
.field-grid__cal-drop-preview-time {
  font-size: 11px;
  font-weight: 700;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.field-grid__cal-drop-preview-hint {
  font-size: 12px;
  font-weight: 500;
  color: var(--secondary);
  line-height: 1.15;
}
/* Short-slot (< 15 min) — the box is too thin for text, so float the
   duration above it as a small dark tooltip bubble. */
.field-grid__cal-drop-preview-tip {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%);
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--text, #1a2028);
  color: #ffffff;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  line-height: 1.3;
}
html.dark-mode .field-grid__cal-drop-preview-tip {
  background: #2b3442;
}

/* Game card area. The slot fills the container. We add subtle
   margin so cards don't touch the hour gridlines. Border + bg
   are caller-supplied via the slot. */
.field-grid__cal-game {
  /* Asymmetric vertical margin (3px top / 2px bottom) so the
     VISIBLE gap between card and gridline reads as 2px on
     BOTH sides. The hour/half-hour line element occupies the
     same grid-row as the card's first row — its 1px border-top
     paints at y=0 of that row, INSIDE the card's grid area.
     A 2px top margin therefore left only a 1px gap between the
     gridline and the card's top border. The next-row gridline
     below sits OUTSIDE the card's grid area, so a 2px bottom
     margin gives a full 2px gap there. Bumping margin-top to
     3px absorbs the 1px hourline and produces a matching 2px
     visible breathing space above. */
  margin: 3px 4px 2px 4px;
  /* No `border-right` here — the inner `MatchGeniGameCard`
     already paints its own full border (and the
     `--locked` modifier overrides the left edge). An extra
     border on this wrapper paints a redundant 1px vertical
     line on the right side of every card. */
  z-index: 3;
  position: relative;
  overflow: hidden;
}
.field-grid__cal-game--clickable {
  cursor: pointer;
}
/* Draggable variant — overrides the pointer cursor with a grab
   hand to telegraph "you can move this card". Switches to
   `grabbing` during the actual drag. Locked games never get
   this class (their dragstart is blocked at the script level),
   so the cursor stays as the regular pointer for those.
   The `:deep()` selector reaches INTO the slotted
   `MatchGeniGameCard` article — without it the inner article's
   own `cursor: pointer` rule (from `--permitted`) wins by
   specificity / proximity and the user never sees the grab
   affordance, so they don't try to drag the card. */
.field-grid__cal-game--draggable,
.field-grid__cal-game--draggable :deep(.matchgeni-game-card) {
  cursor: grab;
}
.field-grid__cal-game--draggable:active,
.field-grid__cal-game--draggable:active :deep(.matchgeni-game-card) {
  cursor: grabbing;
}
/* While a game is mid-drag, make its on-grid card transparent
   to pointer events so the drop strips beneath its own multi-
   row footprint are reachable — this is what lets the user
   nudge a 90-min game from 9:30 to 10:00 (a drop target that
   sits UNDER the card's own span). The browser's drag-ghost
   gives the "moving" visual; a slight opacity dim reinforces
   which card is the source. */
.field-grid__cal-game--dragging {
  pointer-events: none;
  opacity: 0.4;
}
/* `user-select: none` on the draggable wrapper (and its slotted
   children) prevents the browser from starting a TEXT SELECTION
   on mousedown — which competes with `dragstart` and on many
   browsers wins, eating the drag gesture entirely. With selection
   disabled, mousedown on the card unambiguously initiates a drag
   when the user moves the pointer. Mirrors the same fix HTML5-DnD
   examples apply on every drag-source element. */
.field-grid__cal-game--draggable,
.field-grid__cal-game--draggable :deep(*) {
  user-select: none;
  -webkit-user-select: none;
}
.field-grid__cal-game > * {
  height: 100%;
  width: 100%;
}
/* Out-of-bounds badges — top-right corner triangle. */
.field-grid__cal-game--overflow-end::after,
.field-grid__cal-game--overflow-start::before {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 0 12px 12px 0;
  border-color: transparent #e6a23c transparent transparent;
  z-index: 4;
}
.field-grid__cal-game--overflow-start::before {
  right: auto;
  left: 0;
  border-width: 12px 12px 0 0;
}
/* Locked games (final, frozen duration) get the same primary-
   tinted thick left edge the `.app-banner--primary` utility uses.
   Reaches through the slot via `:deep()` to retarget the inner
   `MatchGeniGameCard` article's `border-left` (the card carries
   its own 1px divider border by default). Bumping the left edge
   to 3px primary matches the banner convention — reads as "this
   is an authoritative / locked record" without painting an
   extra rectangle outside the card bounds the way the earlier
   `box-shadow: inset` rule did. */
.field-grid__cal-game--locked :deep(.matchgeni-game-card) {
  border-left: 3px solid var(--primary);
}

/* Ghost preview games — translucent + dashed outline, non-interactive.
   Sit above the real games (z=3) so the preview reads clearly. */
.field-grid__cal-game--preview {
  z-index: 4;
  pointer-events: none;
  opacity: 0.7;
}
.field-grid__cal-game--preview :deep(.matchgeni-game-card) {
  outline: 2px dashed var(--primary);
  outline-offset: -2px;
}

/* Default pill (rendered when caller doesn't supply a `#cell`
   slot — public event page case). */
.field-grid__grid-pill {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--primary-light-3);
  border: 1px solid var(--border-accent);
  height: 100%;
  overflow: hidden;
}
html.dark-mode .field-grid__grid-pill {
  background: rgba(45, 140, 240, 0.18);
}
.field-grid__grid-pill-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--primary);
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.field-grid__grid-pill-teams {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: var(--text);
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
