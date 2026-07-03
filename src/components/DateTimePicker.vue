<script setup lang="ts">
// DateTimePicker
// --------------
// Floating-input-styled, fully in-app date + time control. The trigger shows
// the value in the app format ("Fri Apr 16, 2026 · 3:25 AM") — or just the
// floating label when empty (no native placeholder). The popover reuses the
// SAME calendar chrome as DateRangePicker (month nav + 6×7 grid) for a single
// date, plus the shared TimeSelectRow underneath. Value moves as a
// `YYYY-MM-DDTHH:mm` string (the datetime-local format the form already uses).

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import TimeSelectRow from './TimeSelectRow.vue'

const props = withDefaults(defineProps<{
  modelValue: string
  label: string
  id?: string
  invalid?: boolean
  /** Optional selectable bounds (ISO `YYYY-MM-DD`). Days outside the range
   *  are disabled in the calendar. */
  minDate?: string
  maxDate?: string
  /** Date-only mode: hide the time row, show just the date in the trigger,
   *  and move the value as a plain `YYYY-MM-DD` string (no time component). */
  dateOnly?: boolean
}>(), { id: '', invalid: false, minDate: '', maxDate: '', dateOnly: false })

const emit = defineEmits<{ (event: 'update:modelValue', value: string): void }>()

// ─── Value split (date / time halves) ─────────────────────────────
const datePart = computed(() => {
  const m = props.modelValue.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : ''
})
const timePart = computed(() => {
  const m = props.modelValue.match(/T(\d{2}):(\d{2})/)
  return m ? `${m[1]}:${m[2]}` : ''
})
const hasValue = computed(() => !!props.modelValue)

function parseIsoDate(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}
function formatIsoDate(date: Date): string {
  const y = date.getFullYear()
  const mo = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${mo}-${d}`
}
const selectedDate = computed(() => parseIsoDate(datePart.value))

const displayText = computed(() => {
  if (props.dateOnly) {
    const d = selectedDate.value
    return d ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : ''
  }
  const m = props.modelValue.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!m) return ''
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]))
  const date = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `${date} · ${time}`
})

// ─── Popover state ────────────────────────────────────────────────
const open = ref(false)
const cursor = ref<Date>(new Date())
const wrapperRef = ref<HTMLElement | null>(null)

function openPicker() {
  cursor.value = selectedDate.value ? new Date(selectedDate.value) : new Date()
  open.value = true
}
function close() { open.value = false }
function toggle() { open.value ? close() : openPicker() }
function prevMonth() { cursor.value = new Date(cursor.value.getFullYear(), cursor.value.getMonth() - 1, 1) }
function nextMonth() { cursor.value = new Date(cursor.value.getFullYear(), cursor.value.getMonth() + 1, 1) }

const monthLabel = computed(() => cursor.value.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))
const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const minDateObj = computed(() => parseIsoDate(props.minDate))
const maxDateObj = computed(() => parseIsoDate(props.maxDate))

type GridCell = { date: Date; inMonth: boolean; isToday: boolean; isSelected: boolean; disabled: boolean }
const grid = computed<GridCell[]>(() => {
  const c = cursor.value
  const startWeekday = new Date(c.getFullYear(), c.getMonth(), 1).getDay()
  const gridStart = new Date(c.getFullYear(), c.getMonth(), 1 - startWeekday)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const sel = selectedDate.value
  const min = minDateObj.value
  const max = maxDateObj.value
  const cells: GridCell[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i)
    cells.push({
      date: d,
      inMonth: d.getMonth() === c.getMonth(),
      isToday: d.getTime() === today.getTime(),
      isSelected: !!sel && d.getTime() === sel.getTime(),
      disabled: (!!min && d < min) || (!!max && d > max)
    })
  }
  return cells
})

// ─── Selection ────────────────────────────────────────────────────
// Picking a day keeps the existing time (default 09:00 if none yet).
// Setting a time keeps the existing date (default today if none yet).
function selectDay(cell: GridCell) {
  if (cell.disabled) return
  if (props.dateOnly) {
    emit('update:modelValue', formatIsoDate(cell.date))
    close()
    return
  }
  const t = timePart.value || '09:00'
  emit('update:modelValue', `${formatIsoDate(cell.date)}T${t}`)
}
function onTime(t: string) {
  const d = datePart.value || formatIsoDate(new Date())
  emit('update:modelValue', `${d}T${t}`)
}

function onDocMouseDown(event: MouseEvent) {
  if (open.value && wrapperRef.value && !wrapperRef.value.contains(event.target as Node)) close()
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) { event.stopPropagation(); close() }
}
onMounted(() => {
  document.addEventListener('mousedown', onDocMouseDown)
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMouseDown)
  window.removeEventListener('keydown', onKeydown)
})

// Re-anchor the visible month if the value changes externally while open.
watch(() => props.modelValue, () => {
  if (open.value && selectedDate.value) cursor.value = new Date(selectedDate.value)
})
</script>

<template>
  <div ref="wrapperRef" class="floating-input themed-pick themed-pick--date" :class="{ 'floating-input--invalid': invalid }">
    <button
      type="button"
      class="floating-input__control themed-pick__control"
      :class="{ 'floating-input__control--has-value': hasValue }"
      :aria-label="label"
      :aria-expanded="open ? 'true' : 'false'"
      @click="toggle"
    >{{ displayText }}</button>
    <label class="floating-input__label" :class="{ 'floating-input__label--floated': hasValue }">{{ label }}</label>
    <span v-if="invalid" class="floating-input__error-corner">Required</span>

    <div v-if="open" class="date-range-picker__popover themed-pick__popover" role="dialog" :aria-label="dateOnly ? 'Choose a date' : 'Choose a date and time'">
      <div class="date-range-picker__nav">
        <button type="button" class="date-range-picker__nav-btn" aria-label="Previous month" @click="prevMonth">‹</button>
        <span class="date-range-picker__nav-label">{{ monthLabel }}</span>
        <button type="button" class="date-range-picker__nav-btn" aria-label="Next month" @click="nextMonth">›</button>
      </div>
      <div class="date-range-picker__weekdays" aria-hidden="true">
        <span v-for="day in weekDays" :key="day" class="date-range-picker__weekday">{{ day }}</span>
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
            'date-range-picker__day--start': cell.isSelected,
            'date-range-picker__day--end': cell.isSelected,
            'dt-picker__day--disabled': cell.disabled
          }"
          :disabled="cell.disabled"
          @click="selectDay(cell)"
        >{{ cell.date.getDate() }}</button>
      </div>
      <div v-if="!dateOnly" class="themed-pick__time">
        <span class="themed-pick__time-label">Time</span>
        <TimeSelectRow :model-value="timePart" @update:model-value="onTime" />
      </div>
      <button v-if="!dateOnly" type="button" class="primary-button themed-pick__done" @click="close">Done</button>
    </div>
  </div>
</template>

<style scoped>
.themed-pick { position: relative; }
.themed-pick__control {
  width: 100%;
  text-align: left;
  cursor: pointer;
  padding-right: 38px;
}
.themed-pick .floating-input__label { pointer-events: none; }
.themed-pick::after {
  content: '';
  position: absolute;
  top: 50%;
  right: 14px;
  transform: translateY(-50%);
  width: 18px;
  height: 18px;
  pointer-events: none;
  background-color: var(--text);
  -webkit-mask: url('../assets/calendar.svg') center / contain no-repeat;
  mask: url('../assets/calendar.svg') center / contain no-repeat;
}
.themed-pick__time {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border-divider);
}
.themed-pick__time-label {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--secondary);
  flex: 0 0 auto;
}
/* Flat solid primary — no gradient (overrides .primary-button's gradient;
   the scoped attribute selector wins the specificity tie). */
.themed-pick__done { width: 100%; margin-top: 10px; background: var(--primary); }
.themed-pick__done:hover { background: var(--primary); filter: brightness(1.05); }
/* Out-of-range days — non-selectable. */
.dt-picker__day--disabled {
  opacity: 0.3;
  cursor: not-allowed;
  pointer-events: none;
}
</style>
