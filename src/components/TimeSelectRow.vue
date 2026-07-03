<script setup lang="ts">
// TimeSelectRow
// -------------
// The shared time-of-day selector used inside TimePicker (standalone) and
// DateTimePicker (in the calendar popover). Three dropdowns — hour (1-12),
// minute (00-59), AM/PM — with the value moving as a 24-hour `HH:mm` string
// (or '' when unset). Fully in-app (no native picker) so it matches the rest
// of the date/time controls.

import { computed } from 'vue'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ (event: 'update:modelValue', value: string): void }>()

const parsed = computed(() => {
  const m = props.modelValue.match(/^(\d{2}):(\d{2})$/)
  return m ? { h24: Number(m[1]), minute: m[2] } : { h24: null as number | null, minute: '' }
})
const hour12 = computed(() => {
  const h = parsed.value.h24
  if (h == null) return ''
  return String(h % 12 === 0 ? 12 : h % 12)
})
const minute = computed(() => parsed.value.minute)
const period = computed(() => {
  const h = parsed.value.h24
  if (h == null) return ''
  return h < 12 ? 'AM' : 'PM'
})

const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1))
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))

function compose(h12: string, mins: string, per: string) {
  if (!h12 || !mins || !per) return
  let h = Number(h12) % 12
  if (per === 'PM') h += 12
  emit('update:modelValue', `${String(h).padStart(2, '0')}:${mins}`)
}
function onHour(e: Event) { compose((e.target as HTMLSelectElement).value, minute.value || '00', period.value || 'AM') }
function onMinute(e: Event) { compose(hour12.value || '12', (e.target as HTMLSelectElement).value, period.value || 'AM') }
function onPeriod(e: Event) { compose(hour12.value || '12', minute.value || '00', (e.target as HTMLSelectElement).value) }
</script>

<template>
  <div class="time-row">
    <select class="time-row__select" :value="hour12" aria-label="Hour" @change="onHour">
      <option value="" disabled hidden>HH</option>
      <option v-for="h in HOURS" :key="h" :value="h">{{ h }}</option>
    </select>
    <span class="time-row__sep">:</span>
    <select class="time-row__select" :value="minute" aria-label="Minute" @change="onMinute">
      <option value="" disabled hidden>MM</option>
      <option v-for="m in MINUTES" :key="m" :value="m">{{ m }}</option>
    </select>
    <select class="time-row__select time-row__select--period" :value="period" aria-label="AM or PM" @change="onPeriod">
      <option value="" disabled hidden>--</option>
      <option value="AM">AM</option>
      <option value="PM">PM</option>
    </select>
  </div>
</template>

<style scoped>
.time-row { display: flex; align-items: center; gap: 6px; }
.time-row__select {
  flex: 1 1 auto;
  min-width: 0;
  padding: 7px 8px;
  border: 1px solid var(--border-divider);
  border-radius: 6px;
  background: var(--white);
  color: var(--text);
  font-family: var(--font-body);
  font-size: 0.9rem;
  cursor: pointer;
}
.time-row__select:focus {
  outline: 0;
  border-color: var(--primary, #2d8cf0);
  box-shadow: 0 0 0 3px rgba(45, 140, 240, 0.15);
}
.time-row__sep { color: var(--secondary); font-weight: 700; }
.time-row__select--period { flex: 0 0 66px; }
</style>
