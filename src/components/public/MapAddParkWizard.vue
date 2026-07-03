<script setup lang="ts">
// MapAddParkWizard
// ----------------
// Right-side panel for the Map Explorer's in-map "Add Playing Facility"
// flow. The place is already picked (Google Place → `place` prop), so this
// is a 2-step wizard: (1) Fields in use, (2) Scheduling. On mount it creates
// the park (so `addParkField` has a parkId); on save it attaches the park to
// the event and emits a ready `PublicEventPark` for an optimistic map pin.

import { computed, nextTick, onMounted, ref } from 'vue'
import ToggleSwitch from '../ToggleSwitch.vue'
import { createPark, addParkField, saveEventFacility } from '../../api/matchGeniParks'
import type {
  EventFacilityPayload,
  FacilityScheduleDay,
  ParkFieldInUse,
  Park,
  PlaceLookup,
  PublicEventPark
} from '../../types'

const props = withDefaults(defineProps<{
  place: PlaceLookup
  associationId?: string
  eventId?: string
  eventStartDate?: string
  eventEndDate?: string
  eventStartTime?: string | null
  eventEndTime?: string | null
  eventAllDay?: boolean
}>(), {
  associationId: '',
  eventId: '',
  eventStartDate: '',
  eventEndDate: '',
  eventStartTime: null,
  eventEndTime: null,
  eventAllDay: false
})

const emit = defineEmits<{
  (event: 'saved', payload: { park: PublicEventPark; fieldCount: number; dayCount: number }): void
  (event: 'cancel'): void
}>()

// Park name comes straight from the selected place — authoritative for an
// establishment; for the rare address-only fallback we use the formatted
// address (functional). Not user-editable: the place lookup already
// identifies the venue.
const parkName = computed(() => props.place.name?.trim() || props.place.formattedAddress)

// ── Park creation (on mount — the place is brand-new) ────────────
const resolvedPark = ref<Park | null>(null)
const creating = ref(true)
const createError = ref('')

onMounted(async () => {
  try {
    const park = await createPark(props.associationId, {
      name: parkName.value,
      address: props.place.formattedAddress,
      latitude: props.place.position.lat,
      longitude: props.place.position.lng,
      fieldCount: 0,
      placeId: props.place.placeId
    })
    resolvedPark.value = park
    allFields.value = (park.fieldsInUse ?? []).map((f) => ({ ...f }))
    selectedFieldIds.value = allFields.value.map((f) => f.id)
  } catch (err) {
    createError.value = err instanceof Error ? err.message : 'Could not create the facility.'
  } finally {
    creating.value = false
  }
})

// ── Step machine ─────────────────────────────────────────────────
const step = ref<'fields' | 'schedule'>('fields')

// ── Step 1: fields in use ────────────────────────────────────────
const allFields = ref<ParkFieldInUse[]>([])
const selectedFieldIds = ref<string[]>([])
const fieldsAttempted = ref(false)
const addingFieldOpen = ref(false)
const newFieldName = ref('')
const addingField = ref(false)
const addFieldInputRef = ref<HTMLInputElement | null>(null)

const fieldsInvalid = computed(() => fieldsAttempted.value && selectedFieldIds.value.length === 0)

function toggleField(id: string) {
  selectedFieldIds.value = selectedFieldIds.value.includes(id)
    ? selectedFieldIds.value.filter((x) => x !== id)
    : [...selectedFieldIds.value, id]
}
function openAddField() {
  addingFieldOpen.value = true
  newFieldName.value = ''
  void nextTick(() => addFieldInputRef.value?.focus())
}
function cancelAddField() {
  addingFieldOpen.value = false
  newFieldName.value = ''
}
async function commitAddField() {
  if (addingField.value) return
  const name = newFieldName.value.trim()
  if (!name || !resolvedPark.value) { cancelAddField(); return }
  addingField.value = true
  try {
    const field = await addParkField(props.associationId, resolvedPark.value.id, name)
    allFields.value = [...allFields.value, field]
    selectedFieldIds.value = [...selectedFieldIds.value, field.id]
  } finally {
    addingField.value = false
    newFieldName.value = ''
    addingFieldOpen.value = false
  }
}

// ── Step 2: scheduling (per event day) ───────────────────────────
const scheduleDays = ref<FacilityScheduleDay[]>([])
const scheduleAttempted = ref(false)

function defaultWindow(): { start: string; end: string } {
  if (props.eventAllDay) return { start: '08:00', end: '20:00' }
  const start = (props.eventStartTime ?? '').slice(0, 5) || '08:00'
  const end = (props.eventEndTime ?? '').slice(0, 5) || '20:00'
  return { start, end }
}
function isoRange(startISO: string, endISO: string): string[] {
  const out: string[] = []
  const start = new Date(`${startISO}T00:00:00`)
  const end = new Date(`${endISO}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return startISO ? [startISO] : []
  }
  const cur = new Date(start)
  let guard = 0
  while (cur <= end && guard < 366) {
    const y = cur.getFullYear()
    const m = String(cur.getMonth() + 1).padStart(2, '0')
    const d = String(cur.getDate()).padStart(2, '0')
    out.push(`${y}-${m}-${d}`)
    cur.setDate(cur.getDate() + 1)
    guard += 1
  }
  return out
}
// MOCK fallback — until the event's real start/end dates flow through the
// MatchGeni access payload, fall back to a deterministic 4-day window so the
// scheduling step is always exercisable. Mirrors the old facility wizard.
const MOCK_EVENT_START_DATE = '2026-04-07'
const MOCK_EVENT_END_DATE = '2026-04-10'

function buildScheduleDays() {
  const startISO = props.eventStartDate || MOCK_EVENT_START_DATE
  const endISO = props.eventEndDate || props.eventStartDate || MOCK_EVENT_END_DATE
  const { start, end } = defaultWindow()
  scheduleDays.value = isoRange(startISO, endISO).map((date) => ({
    date, enabled: true, startTime: start, endTime: end
  }))
}
const enabledDays = computed(() => scheduleDays.value.filter((d) => d.enabled))
const scheduleError = computed(() => {
  if (!scheduleAttempted.value) return ''
  if (enabledDays.value.length === 0) return 'Select at least one day the facility is in use.'
  if (enabledDays.value.some((d) => d.startTime >= d.endTime)) {
    return 'Each day’s start time must be before its end time.'
  }
  return ''
})

function dayLabel(iso: string): string {
  const dt = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(dt.getTime())) return iso
  return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}
function dayLabelShort(iso: string): string {
  const dt = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(dt.getTime())) return iso
  return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}
function formatTime(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':')
  let h = Number(hStr)
  const m = mStr ?? '00'
  if (Number.isNaN(h)) return hhmm
  const period = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  return `${h}:${m} ${period}`
}
function openTimePicker(event: MouseEvent) {
  const el = event.currentTarget as HTMLInputElement & { showPicker?: () => void }
  try { el.showPicker?.() } catch { /* some browsers throw — ignore */ }
}

/** Group consecutive same-window enabled days into { days, window }. */
function groupWindows(days: FacilityScheduleDay[]): { days: string; window: string }[] {
  type G = { startDate: string; endDate: string; startTime: string; endTime: string }
  const groups: G[] = []
  const isNext = (a: string, b: string) => {
    const da = new Date(`${a}T00:00:00`).getTime()
    const db = new Date(`${b}T00:00:00`).getTime()
    return db - da === 86_400_000
  }
  for (const d of days) {
    const last = groups[groups.length - 1]
    if (last && last.startTime === d.startTime && last.endTime === d.endTime && isNext(last.endDate, d.date)) {
      last.endDate = d.date
    } else {
      groups.push({ startDate: d.date, endDate: d.date, startTime: d.startTime, endTime: d.endTime })
    }
  }
  return groups.map((g) => ({
    days: g.startDate === g.endDate ? dayLabelShort(g.startDate) : `${dayLabelShort(g.startDate)} – ${dayLabelShort(g.endDate)}`,
    window: `${formatTime(g.startTime)} – ${formatTime(g.endTime)}`
  }))
}

// ── Navigation + save ────────────────────────────────────────────
const saving = ref(false)
const saveError = ref('')

function next() {
  fieldsAttempted.value = true
  if (selectedFieldIds.value.length === 0) return
  if (scheduleDays.value.length === 0) buildScheduleDays()
  step.value = 'schedule'
}
function back() { step.value = 'fields' }

async function save() {
  scheduleAttempted.value = true
  if (scheduleError.value) return
  if (!resolvedPark.value) { saveError.value = 'Facility not ready yet.'; return }
  if (!props.associationId || !props.eventId) { saveError.value = 'Missing event context — cannot save.'; return }
  saving.value = true
  saveError.value = ''
  try {
    const payload: EventFacilityPayload = {
      parkId: resolvedPark.value.id,
      fieldIds: [...selectedFieldIds.value],
      schedule: enabledDays.value.map((d) => ({ date: d.date, startTime: d.startTime, endTime: d.endTime }))
    }
    await saveEventFacility(props.associationId, props.eventId, payload)
    const fieldNames = selectedFieldIds.value
      .map((id) => allFields.value.find((f) => f.id === id)?.name)
      .filter((n): n is string => !!n)
    const park: PublicEventPark = {
      id: resolvedPark.value.id,
      name: parkName.value,
      placeId: props.place.placeId,
      location: [props.place.city, props.place.state].filter((x): x is string => !!x).join(', ') || props.place.formattedAddress,
      address: props.place.formattedAddress || undefined,
      position: props.place.position,
      fieldsInUse: fieldNames,
      scheduleWindows: groupWindows(enabledDays.value)
    }
    emit('saved', { park, fieldCount: fieldNames.length, dayCount: payload.schedule.length })
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : 'Could not save the facility. Please try again.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="mapx-wiz">
    <header class="mapx-wiz__head">
      <div class="mapx-wiz__titles">
        <h3 class="mapx-wiz__title">{{ step === 'fields' ? 'Fields in use' : 'Scheduling' }}</h3>
      </div>
    </header>

    <!-- Step dots -->
    <div class="mapx-wiz__steps" aria-hidden="true">
      <span class="mapx-wiz__step-dot" :class="{ 'mapx-wiz__step-dot--on': true }"></span>
      <span class="mapx-wiz__step-dot" :class="{ 'mapx-wiz__step-dot--on': step === 'schedule' }"></span>
    </div>

    <div class="mapx-wiz__body">
      <p v-if="createError" class="mapx-wiz__error">{{ createError }}</p>
      <p v-else-if="creating" class="mapx-wiz__muted">Preparing facility…</p>

      <!-- STEP 1 — Fields in use -->
      <template v-else-if="step === 'fields'">
        <div class="mapx-wiz__row-head">
          <span class="mapx-wiz__label">Select fields</span>
          <button v-if="!addingFieldOpen" type="button" class="mapx-wiz__link" @click="openAddField">+ Add field</button>
        </div>
        <p class="mapx-wiz__help">Pick the park fields that will be used in this event, or add a new field.</p>
        <input
          v-if="addingFieldOpen"
          ref="addFieldInputRef"
          v-model="newFieldName"
          type="text"
          maxlength="60"
          class="mapx-wiz__field-input"
          placeholder="New field name"
          @keydown.enter.prevent="commitAddField"
          @keydown.esc.prevent="cancelAddField"
          @blur="commitAddField"
        />
        <ul class="mapx-wiz__fields">
          <li v-if="allFields.length === 0" class="mapx-wiz__muted">No fields yet — add one above.</li>
          <li v-for="f in allFields" :key="f.id" class="mapx-wiz__field">
            <label class="mapx-wiz__check">
              <input type="checkbox" :checked="selectedFieldIds.includes(f.id)" @change="toggleField(f.id)" />
              <span>{{ f.name }}</span>
            </label>
          </li>
        </ul>
        <p v-if="fieldsInvalid" class="mapx-wiz__error">Select at least one field.</p>
      </template>

      <!-- STEP 2 — Scheduling -->
      <template v-else>
        <span class="mapx-wiz__label">Daily scheduling window</span>
        <p v-if="scheduleDays.length === 0" class="mapx-wiz__muted">This event has no date range to schedule.</p>
        <ul v-else class="mapx-wiz__sched">
          <li
            v-for="day in scheduleDays"
            :key="day.date"
            class="mapx-wiz__sched-row"
            :class="{ 'mapx-wiz__sched-row--off': !day.enabled }"
          >
            <ToggleSwitch v-model="day.enabled" :aria-label="`Use facility on ${dayLabel(day.date)}`" />
            <span class="mapx-wiz__sched-date">{{ dayLabel(day.date) }}</span>
            <div class="mapx-wiz__sched-times">
              <input v-model="day.startTime" type="time" class="mapx-wiz__time" :disabled="!day.enabled" @click="openTimePicker" />
              <span class="mapx-wiz__sched-sep">–</span>
              <input v-model="day.endTime" type="time" class="mapx-wiz__time" :disabled="!day.enabled" @click="openTimePicker" />
            </div>
          </li>
        </ul>
        <p v-if="scheduleError" class="mapx-wiz__error">{{ scheduleError }}</p>
      </template>
    </div>

    <footer class="mapx-wiz__foot">
      <button v-if="step === 'schedule'" type="button" class="secondary-button" :disabled="saving" @click="back">Back</button>
      <span class="mapx-wiz__foot-spacer"></span>
      <span v-if="saveError" class="mapx-wiz__error mapx-wiz__error--inline">{{ saveError }}</span>
      <button v-if="step === 'fields'" type="button" class="primary-button" :disabled="creating" @click="next">Next</button>
      <button v-else type="button" class="primary-button" :disabled="saving" @click="save">{{ saving ? 'Saving…' : 'Save Facility' }}</button>
    </footer>
  </div>
</template>

<style scoped>
.mapx-wiz {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.mapx-wiz__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 16px 8px;
}
.mapx-wiz__titles { min-width: 0; }
.mapx-wiz__eyebrow {
  display: block;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mapx-wiz__title { margin: 2px 0 0; font-size: 17px; font-weight: 600; color: var(--text); }
.mapx-wiz__steps { display: flex; gap: 6px; padding: 0 16px 8px; }
.mapx-wiz__step-dot { width: 22px; height: 4px; border-radius: 999px; background: var(--border-divider); }
.mapx-wiz__step-dot--on { background: var(--primary); }

.mapx-wiz__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mapx-wiz__muted { margin: 0; font-size: 13px; color: var(--secondary); }
.mapx-wiz__error { margin: 0; font-size: 12.5px; font-weight: 500; color: #c1413a; }
.mapx-wiz__error--inline { align-self: center; }
.mapx-wiz__row-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.mapx-wiz__label { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--secondary); }
.mapx-wiz__help { margin: -4px 0 2px; font-size: 12px; line-height: 1.45; color: var(--secondary); }
.mapx-wiz__link { appearance: none; border: none; background: none; padding: 0; font-size: 12px; font-weight: 600; color: var(--primary); cursor: pointer; }
.mapx-wiz__link:hover { text-decoration: underline; }
.mapx-wiz__field-input {
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--primary);
  border-radius: 8px;
  background: var(--surface-card, #fff);
  color: var(--text);
  font-size: 13px;
  outline: none;
}
.mapx-wiz__fields { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.mapx-wiz__field {
  border: 1px solid var(--border-divider);
  border-radius: 8px;
  background: var(--surface-muted, #f4f7fb);
}
html.dark-mode .mapx-wiz__field { background: rgba(255, 255, 255, 0.03); }
.mapx-wiz__check {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 12px;
  font-size: 13px; color: var(--text); cursor: pointer;
}
.mapx-wiz__check input { width: 16px; height: 16px; accent-color: var(--primary); }

.mapx-wiz__sched { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.mapx-wiz__sched-row {
  display: flex; align-items: center; gap: 12px;
  padding: 9px 12px;
  border: 1px solid var(--border-divider);
  border-radius: 8px;
  background: var(--surface-muted, #f4f7fb);
}
html.dark-mode .mapx-wiz__sched-row { background: rgba(255, 255, 255, 0.03); }
.mapx-wiz__sched-row--off { opacity: 0.6; }
.mapx-wiz__sched-date { flex: 1 1 auto; min-width: 0; font-size: 13px; font-weight: 600; color: var(--text); white-space: nowrap; }
.mapx-wiz__sched-times { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
.mapx-wiz__sched-sep { color: var(--secondary); }
.mapx-wiz__time {
  appearance: none;
  border: 1px solid var(--border-divider);
  border-radius: 6px;
  background: var(--surface-card, #fff);
  color: var(--text);
  font-size: 12.5px;
  padding: 5px 7px;
  font-family: inherit;
}
.mapx-wiz__time:disabled { opacity: 0.5; }

.mapx-wiz__foot {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-divider);
}
.mapx-wiz__foot-spacer { flex: 1 1 auto; }
/* Flat brand primary (the base `.primary-button` is a gradient). */
.mapx-wiz__foot .primary-button { background: var(--primary); }
.mapx-wiz__foot .primary-button:hover { background: var(--primary-light); }
</style>
