<script setup lang="ts">
// DateRangePicker
// ---------------
// Single-control date range picker. The user opens one popover, clicks
// a start date, then clicks an end date — the calendar closes and both
// values are emitted. No external date-picker library; built on a
// hand-rolled monthly grid so the dependency list stays lean and the
// visual style stays consistent with the rest of the app.
//
// Props use the Vue-3 v-model:foo convention (model-start / update:modelStart
// + model-end / update:modelEnd) so the parent can two-way-bind both
// halves of the range with explicit `:model-*` + `@update:model*`
// handlers (Vue 2 v-model on custom components only binds the default
// `value` prop, so we keep the binding explicit on both sides).
//
// All values move as ISO `yyyy-mm-dd` strings; internally we parse to
// LOCAL Date objects (no UTC offset surprises — `new Date('2026-04-28')`
// would otherwise parse as UTC midnight and shift in non-UTC zones).

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  modelStart: string
  modelEnd: string
  disabled?: boolean
  placeholder?: string
  ariaLabel?: string
  /** When true, applies the `--invalid` modifier so the parent can
   *  paint a red border on form-error states without re-binding the
   *  range value. */
  invalid?: boolean
  /** Optional selectable bounds (ISO `yyyy-mm-dd`). Days before `minDate`
   *  or after `maxDate` are disabled in the calendar. Empty = unbounded. */
  minDate?: string
  maxDate?: string
}>(), {
  disabled: false,
  placeholder: 'Select date range',
  ariaLabel: 'Select date range',
  invalid: false,
  minDate: '',
  maxDate: ''
})

const emit = defineEmits<{
  (event: 'update:modelStart', value: string): void
  (event: 'update:modelEnd', value: string): void
}>()

// ─── ISO ↔ Date helpers ───────────────────────────────────────────
// Parse `yyyy-mm-dd` as a LOCAL date. Plain `new Date(iso)` would
// parse as UTC midnight, which shifts to the prior day in negative
// timezones — manifests as the calendar showing the wrong cell as
// "selected". Component pieces avoid the time portion entirely.
function parseIsoDate(iso: string): Date | null {
  if (!iso) return null
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function formatIsoDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDisplayDate(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

const startDate = computed<Date | null>(() => parseIsoDate(props.modelStart))
const endDate = computed<Date | null>(() => parseIsoDate(props.modelEnd))

// ─── Picker state ─────────────────────────────────────────────────
const open = ref(false)
const cursor = ref<Date>(new Date())   // The month currently being shown
const hoverDate = ref<Date | null>(null)
const wrapperRef = ref<HTMLElement | null>(null)

// Trigger label: "Apr 28, 2026 → May 03, 2026" when both are set,
// "Apr 28, 2026 → …" while waiting for the second click, or the
// `placeholder` when neither is set.
const triggerLabel = computed(() => {
  const s = startDate.value
  const e = endDate.value
  if (s && e) return `${formatDisplayDate(s)} → ${formatDisplayDate(e)}`
  if (s) return `${formatDisplayDate(s)} → …`
  return props.placeholder
})

const monthLabel = computed(() =>
  cursor.value.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
)

// 6×7 cell grid for a stable layout (no jumps between 5- and 6-row
// months). Cells outside the current month are rendered dimmed but
// still clickable so the user can spill across month boundaries.
type GridCell = {
  date: Date
  inMonth: boolean
  isToday: boolean
  isStart: boolean
  isEnd: boolean
  isInRange: boolean
  isHoverInRange: boolean
  disabled: boolean
}

const minDateObj = computed<Date | null>(() => parseIsoDate(props.minDate))
const maxDateObj = computed<Date | null>(() => parseIsoDate(props.maxDate))

const grid = computed<GridCell[]>(() => {
  const c = cursor.value
  const monthStart = new Date(c.getFullYear(), c.getMonth(), 1)
  const startWeekday = monthStart.getDay() // 0 = Sunday
  const gridStart = new Date(c.getFullYear(), c.getMonth(), 1 - startWeekday)
  const today = startOfDay(new Date())
  const start = startDate.value
  const end = endDate.value
  const hover = hoverDate.value
  const min = minDateObj.value
  const max = maxDateObj.value

  const cells: GridCell[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i)
    const inMonth = d.getMonth() === c.getMonth()
    const isToday = d.getTime() === today.getTime()
    const isStart = !!start && d.getTime() === start.getTime()
    const isEnd = !!end && d.getTime() === end.getTime()
    const isInRange = !!start && !!end && d > start && d < end
    // Hover preview: when the user has clicked a start but not yet
    // clicked an end, hovering forward shows a tentative range.
    const isHoverInRange =
      !!start && !end && !!hover && hover > start && d > start && d <= hover
    // Out-of-bounds days (before min / after max) are non-selectable.
    const disabled = (!!min && d < min) || (!!max && d > max)
    cells.push({ date: d, inMonth, isToday, isStart, isEnd, isInRange, isHoverInRange, disabled })
  }
  return cells
})

// ─── Open / close / nav ──────────────────────────────────────────

function openPicker() {
  if (props.disabled) return
  // Anchor the visible month on the existing start (if any), else today.
  cursor.value = new Date(startDate.value ?? new Date())
  open.value = true
}

function closePicker() {
  open.value = false
  hoverDate.value = null
}

function togglePicker() {
  open.value ? closePicker() : openPicker()
}

function prevMonth() {
  cursor.value = new Date(cursor.value.getFullYear(), cursor.value.getMonth() - 1, 1)
}

function nextMonth() {
  cursor.value = new Date(cursor.value.getFullYear(), cursor.value.getMonth() + 1, 1)
}

// ─── Selection logic ─────────────────────────────────────────────
//
// Click 1: sets start, clears end.
// Click 2 on a date >= start: sets end, closes the popover.
// Click 2 on a date < start: treats it as restarting the selection —
//   the new earlier date becomes the start, and we wait for another
//   click for the end. This matches Google Calendar / Notion
//   range-picker behaviour and avoids surprising the user with an
//   inverted range.

function selectDay(cell: GridCell) {
  if (cell.disabled) return
  const dayIso = formatIsoDate(cell.date)
  const haveStart = !!startDate.value
  const haveEnd = !!endDate.value

  if (!haveStart || (haveStart && haveEnd)) {
    // Fresh selection — first click of a new range.
    emit('update:modelStart', dayIso)
    emit('update:modelEnd', '')
    return
  }

  // Have a start, no end yet.
  if (cell.date < (startDate.value as Date)) {
    // Earlier than the current start → treat as restart.
    emit('update:modelStart', dayIso)
    emit('update:modelEnd', '')
    return
  }

  // dayIso is on or after start → commit the end and close.
  emit('update:modelEnd', dayIso)
  closePicker()
}

// ─── Outside click + Escape ───────────────────────────────────────
function onDocMouseDown(event: MouseEvent) {
  if (!open.value) return
  if (wrapperRef.value && !wrapperRef.value.contains(event.target as Node)) {
    closePicker()
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) {
    event.stopPropagation()
    closePicker()
  }
}

onMounted(() => {
  if (typeof document !== 'undefined') {
    document.addEventListener('mousedown', onDocMouseDown)
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', onKeydown)
  }
})

onBeforeUnmount(() => {
  if (typeof document !== 'undefined') {
    document.removeEventListener('mousedown', onDocMouseDown)
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', onKeydown)
  }
})

// Re-anchor the visible month if the model values are changed
// externally (e.g. parent hydrates from saved data while the popover
// is open). Without this, the user could open the popover and see a
// stale month.
watch(
  () => [props.modelStart, props.modelEnd],
  () => {
    if (open.value && startDate.value) {
      cursor.value = new Date(startDate.value)
    }
  }
)

const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
</script>

<template>
  <div
    ref="wrapperRef"
    class="date-range-picker"
    :class="{
      'date-range-picker--open': open,
      'date-range-picker--invalid': invalid,
      'date-range-picker--disabled': disabled
    }"
  >
    <button
      type="button"
      class="date-range-picker__trigger"
      :disabled="disabled"
      :aria-label="ariaLabel"
      :aria-expanded="open ? 'true' : 'false'"
      aria-haspopup="dialog"
      @click="togglePicker"
    >
      <span
        class="date-range-picker__trigger-text"
        :class="{ 'date-range-picker__trigger-text--placeholder': !startDate }"
      >
        {{ triggerLabel }}
      </span>
      <span class="date-range-picker__trigger-icon" aria-hidden="true"></span>
    </button>

    <div
      v-if="open"
      class="date-range-picker__popover"
      role="dialog"
      aria-label="Choose date range"
    >
      <div class="date-range-picker__nav">
        <button
          type="button"
          class="date-range-picker__nav-btn"
          aria-label="Previous month"
          @click="prevMonth"
        >‹</button>
        <span class="date-range-picker__nav-label">{{ monthLabel }}</span>
        <button
          type="button"
          class="date-range-picker__nav-btn"
          aria-label="Next month"
          @click="nextMonth"
        >›</button>
      </div>
      <div class="date-range-picker__weekdays" aria-hidden="true">
        <span
          v-for="day in weekDays"
          :key="day"
          class="date-range-picker__weekday"
        >{{ day }}</span>
      </div>
      <div class="date-range-picker__grid">
        <button
          v-for="cell in grid"
          :key="cell.date.getTime()"
          type="button"
          class="date-range-picker__day"
          :class="{
            'date-range-picker__day--out-of-month': !cell.inMonth,
            'date-range-picker__day--today': cell.isToday,
            'date-range-picker__day--start': cell.isStart,
            'date-range-picker__day--end': cell.isEnd,
            'date-range-picker__day--in-range': cell.isInRange,
            'date-range-picker__day--hover-range': cell.isHoverInRange,
            'date-range-picker__day--disabled': cell.disabled
          }"
          :disabled="cell.disabled"
          @click="selectDay(cell)"
          @mouseenter="hoverDate = cell.disabled ? null : cell.date"
        >
          {{ cell.date.getDate() }}
        </button>
      </div>
    </div>
  </div>
</template>
