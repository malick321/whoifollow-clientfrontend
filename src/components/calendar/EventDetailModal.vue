<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import SlideModal from '../SlideModal.vue'
import TeamAvatar from '../TeamAvatar.vue'
import AppIcon from '../AppIcon.vue'
import {
  fetchCalendarEvent,
  setAttendance,
  type AttendanceStatus,
  type CalendarEventDetail,
  type CalendarSource
} from '../../api/calendar'
import { pushToast } from '../../toast-center'

const props = defineProps<{
  modelValue: boolean
  eventId: string | null
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'attendance-updated', value: { eventId: string; attendanceStatus: AttendanceStatus }): void
}>()

const eventDetail = ref<CalendarEventDetail | null>(null)
const loading = ref(false)
const savingStatus = ref<AttendanceStatus | null>(null)

// ── Date / time humanization ────────────────────────────────────────
// Renders the raw `YYYY-MM-DD` + `HH:mm:ss` payload as friendly copy:
//   "May 4 – Jun 30, 2026"  /  "8:00 AM – 8:00 PM"
// Handles single-day, multi-day, all-day, and missing-time cases.
// Parses dates as local (not UTC) so the calendar day never shifts.
function parseYmd(value?: string): Date | null {
  if (!value) return null
  const [y, m, d] = value.split('-').map((part) => Number(part))
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

function parseHms(value?: string): { h: number; m: number } | null {
  if (!value) return null
  const [h, m] = value.split(':').map((part) => Number(part))
  if (Number.isNaN(h)) return null
  return { h, m: Number.isNaN(m) ? 0 : m }
}

const monthDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const monthDayYear = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function formatTime(value?: string): string {
  const parsed = parseHms(value)
  if (!parsed) return ''
  const date = new Date(2000, 0, 1, parsed.h, parsed.m)
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })
    .format(date)
    .replace(':00', '')
}

const dateLabel = computed(() => {
  const event = eventDetail.value
  if (!event) return ''
  const start = parseYmd(event.startDate)
  if (!start) return 'Date not set'
  const end = parseYmd(event.endDate)
  const sameDay = !end || end.getTime() === start.getTime()
  if (sameDay) return monthDayYear.format(start)
  // Multi-day: drop the year on the first date when both fall in the
  // same year ("May 4 – Jun 30, 2026"); otherwise show both years.
  if (start.getFullYear() === end.getFullYear()) {
    return `${monthDay.format(start)} – ${monthDayYear.format(end)}`
  }
  return `${monthDayYear.format(start)} – ${monthDayYear.format(end)}`
})

const timeLabel = computed(() => {
  const event = eventDetail.value
  if (!event) return ''
  if (event.allDay) return 'All day'
  const start = formatTime(event.startTime)
  const end = formatTime(event.endTime)
  if (start && end) return `${start} – ${end}`
  if (start) return start
  return 'All day'
})

const subtitle = computed(() => {
  const event = eventDetail.value
  if (!event) return ''
  return [event.eventType, event.association.name, event.timeZone]
    .filter(Boolean)
    .join(' · ')
})

const locationLabel = computed(() => {
  const event = eventDetail.value
  if (!event) return ''
  return [event.location.city, event.location.state].filter(Boolean).join(', ')
})

// ── Source badge ────────────────────────────────────────────────────
const sourceMeta: Record<CalendarSource, { label: string; tone: 'info' | 'secondary' | 'success' }> = {
  team: { label: 'Team', tone: 'info' },
  following: { label: 'Following', tone: 'secondary' },
  attending: { label: 'Attending', tone: 'success' }
}

const sourceBadge = computed(() => {
  const event = eventDetail.value
  if (!event) return null
  return sourceMeta[event.source]
})

const goingActive = computed(() => eventDetail.value?.attendanceStatus === 'going')
const notGoingActive = computed(() => eventDetail.value?.attendanceStatus === 'not_going')

async function loadEvent() {
  if (!props.modelValue || !props.eventId) {
    eventDetail.value = null
    return
  }

  loading.value = true
  try {
    eventDetail.value = await fetchCalendarEvent(props.eventId)
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not load event',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
    eventDetail.value = null
  } finally {
    loading.value = false
  }
}

async function chooseAttendance(status: AttendanceStatus) {
  const event = eventDetail.value
  if (!event || savingStatus.value) return

  savingStatus.value = status
  const previous = event.attendanceStatus
  event.attendanceStatus = status

  try {
    const result = await setAttendance(event.id, status)
    const savedStatus = result?.attendanceStatus ?? status
    event.attendanceStatus = savedStatus
    emit('attendance-updated', { eventId: event.id, attendanceStatus: savedStatus })
    pushToast({
      tone: 'success',
      title: savedStatus === 'going' ? 'Marked going' : 'Marked not going'
    })
  } catch (error) {
    event.attendanceStatus = previous
    pushToast({
      tone: 'warning',
      title: 'Could not save RSVP',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    savingStatus.value = null
  }
}

function close() {
  emit('update:modelValue', false)
}

watch(
  () => [props.modelValue, props.eventId] as const,
  () => {
    void loadEvent()
  },
  { immediate: true }
)
</script>

<template>
  <SlideModal
    :model-value="modelValue"
    :title="eventDetail?.name || 'Event detail'"
    :subtitle="subtitle"
    eyebrow="Calendar"
    @update:modelValue="emit('update:modelValue', $event)"
  >
    <div v-if="loading" class="calendar-event-detail calendar-event-detail--loading">
      <div class="calendar-event-detail__summary calendar-event-detail__summary--loading">
        <span class="shimmer-block calendar-event-detail__avatar-shimmer"></span>
        <div class="calendar-event-detail__summary-copy">
          <span class="shimmer-block calendar-event-detail__line-shimmer"></span>
          <span class="shimmer-block calendar-event-detail__line-shimmer calendar-event-detail__line-shimmer--short"></span>
        </div>
      </div>
      <span class="shimmer-block calendar-event-detail__line-shimmer"></span>
      <span class="shimmer-block calendar-event-detail__line-shimmer calendar-event-detail__line-shimmer--short"></span>
    </div>

    <div v-else-if="eventDetail" class="calendar-event-detail">
      <!-- Summary card — avatar + name + the humanized date/time, location,
           director, each prefixed with an inline icon. Source badge pins
           to the top-right so the event's origin reads at a glance. -->
      <div class="calendar-event-detail__summary">
        <TeamAvatar
          :name="eventDetail.name"
          :image-url="eventDetail.avatarUrl"
          size="lg"
        />
        <div class="calendar-event-detail__summary-copy">
          <p class="calendar-event-detail__name">{{ eventDetail.name }}</p>
          <ul class="calendar-event-detail__facts">
            <li class="calendar-event-detail__fact">
              <AppIcon name="calendar" :size="15" />
              <span>{{ dateLabel }}</span>
            </li>
            <li class="calendar-event-detail__fact">
              <AppIcon name="clock" :size="15" />
              <span>{{ timeLabel }}</span>
            </li>
            <li v-if="locationLabel" class="calendar-event-detail__fact">
              <AppIcon name="home" :size="15" />
              <span>{{ locationLabel }}</span>
            </li>
            <li v-if="eventDetail.directorName" class="calendar-event-detail__fact">
              <AppIcon name="people" :size="15" />
              <span>{{ eventDetail.directorName }}</span>
            </li>
          </ul>
        </div>
        <span
          v-if="sourceBadge"
          class="status-badge calendar-event-detail__source"
          :data-tone="sourceBadge.tone"
        >{{ sourceBadge.label }}</span>
      </div>

      <!-- RSVP — segmented Going / Not Going control with one shared
           track so the selected state slides between two halves rather
           than reading as two disconnected buttons. -->
      <section class="calendar-event-detail__section">
        <h3>Your RSVP</h3>
        <div
          class="calendar-event-detail__rsvp"
          role="group"
          aria-label="RSVP"
        >
          <button
            type="button"
            class="calendar-event-detail__rsvp-seg"
            :class="{ 'calendar-event-detail__rsvp-seg--active calendar-event-detail__rsvp-seg--going': goingActive }"
            :disabled="!!savingStatus"
            :aria-pressed="goingActive"
            @click="chooseAttendance('going')"
          >
            <span v-if="savingStatus === 'going'" class="btn-spinner" aria-hidden="true"></span>
            Going
          </button>
          <button
            type="button"
            class="calendar-event-detail__rsvp-seg"
            :class="{ 'calendar-event-detail__rsvp-seg--active calendar-event-detail__rsvp-seg--not-going': notGoingActive }"
            :disabled="!!savingStatus"
            :aria-pressed="notGoingActive"
            @click="chooseAttendance('not_going')"
          >
            <span v-if="savingStatus === 'not_going'" class="btn-spinner" aria-hidden="true"></span>
            Not Going
          </button>
        </div>
      </section>

      <section v-if="eventDetail.description" class="calendar-event-detail__section">
        <h3>Notes</h3>
        <p>{{ eventDetail.description }}</p>
      </section>

      <section v-if="eventDetail.externalUrl" class="calendar-event-detail__section">
        <h3>Link</h3>
        <a
          class="calendar-event-detail__link"
          :href="eventDetail.externalUrl"
          target="_blank"
          rel="noopener noreferrer"
        >
          Open event link
          <AppIcon name="ticket" :size="15" />
        </a>
      </section>
    </div>

    <div v-else class="calendar-event-detail__empty">
      <span class="calendar-event-detail__empty-icon" aria-hidden="true">
        <AppIcon name="calendar" :size="26" />
      </span>
      <p class="calendar-event-detail__empty-title">Event unavailable</p>
      <p>This event could not be loaded. It may have been removed or you no longer have access.</p>
    </div>

    <template #footer>
      <button type="button" class="secondary-button" @click="close">Close</button>
    </template>
  </SlideModal>
</template>

<style scoped>
.calendar-event-detail {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* ── Summary card ─────────────────────────────────────────────────── */
.calendar-event-detail__summary {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 16px;
  border: 1px solid var(--border-divider);
  border-radius: 8px;
  background: var(--surface-raised);
  box-shadow: var(--shadow-soft);
}

.calendar-event-detail__summary-copy {
  min-width: 0;
  flex: 1;
}

.calendar-event-detail__name {
  margin: 0 0 10px;
  padding-right: 84px;
  color: var(--text);
  font-size: 1.02rem;
  font-weight: 500;
  line-height: 1.35;
}

.calendar-event-detail__facts {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.calendar-event-detail__fact {
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--text-light);
  font-size: 0.9rem;
  line-height: 1.3;
}

.calendar-event-detail__fact :deep(.app-icon) {
  flex: none;
  color: var(--primary);
}

.calendar-event-detail__fact span {
  min-width: 0;
}

/* First fact (date) reads as the primary line. */
.calendar-event-detail__fact:first-child {
  color: var(--text);
  font-weight: 500;
}

.calendar-event-detail__source {
  position: absolute;
  top: 14px;
  right: 14px;
}

/* ── Sections ─────────────────────────────────────────────────────── */
.calendar-event-detail__section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.calendar-event-detail__section h3 {
  margin: 0;
  color: var(--text-light);
  font-size: 0.74rem;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.calendar-event-detail__section p {
  margin: 0;
  color: var(--text);
  font-size: 0.92rem;
  line-height: 1.55;
}

/* ── Segmented RSVP control ───────────────────────────────────────── */
.calendar-event-detail__rsvp {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border: 1px solid var(--border-divider);
  border-radius: 6px;
  background: var(--surface-btn-solid);
  overflow: hidden;
}

.calendar-event-detail__rsvp-seg {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 42px;
  border: 0;
  background: transparent;
  color: var(--text);
  font-family: var(--font-body);
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease;
}

.calendar-event-detail__rsvp-seg + .calendar-event-detail__rsvp-seg {
  border-left: 1px solid var(--border-divider);
}

.calendar-event-detail__rsvp-seg:hover:not(:disabled):not(.calendar-event-detail__rsvp-seg--active) {
  background: rgba(45, 140, 240, 0.06);
}

.calendar-event-detail__rsvp-seg:disabled {
  cursor: progress;
}

.calendar-event-detail__rsvp-seg--active.calendar-event-detail__rsvp-seg--going {
  background: var(--success-light);
  color: var(--success);
}

.calendar-event-detail__rsvp-seg--active.calendar-event-detail__rsvp-seg--not-going {
  background: var(--danger-light);
  color: var(--highlight);
}

/* ── Link ─────────────────────────────────────────────────────────── */
.calendar-event-detail__link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--primary);
  font-size: 0.9rem;
  font-weight: 500;
  text-decoration: none;
}

.calendar-event-detail__link:hover {
  text-decoration: underline;
}

/* ── Empty state ──────────────────────────────────────────────────── */
.calendar-event-detail__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 8px;
  padding: 32px 16px;
}

.calendar-event-detail__empty-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  margin-bottom: 4px;
  border-radius: 50%;
  background: var(--primary-light-3);
  color: var(--primary);
}

.calendar-event-detail__empty-title {
  margin: 0;
  color: var(--text);
  font-size: 0.98rem;
  font-weight: 500;
}

.calendar-event-detail__empty p {
  margin: 0;
  max-width: 340px;
  color: var(--text-light);
  font-size: 0.9rem;
  line-height: 1.5;
}

/* ── Loading skeleton ─────────────────────────────────────────────── */
.calendar-event-detail--loading {
  gap: 16px;
}

.calendar-event-detail__summary--loading {
  box-shadow: none;
}

.calendar-event-detail__avatar-shimmer {
  flex: none;
  width: 56px;
  height: 56px;
  border-radius: 50%;
}

.calendar-event-detail__line-shimmer {
  display: block;
  width: 100%;
  height: 16px;
  border-radius: 6px;
}

.calendar-event-detail__line-shimmer--short {
  width: 64%;
}

@media (max-width: 520px) {
  .calendar-event-detail__name {
    padding-right: 0;
  }

  .calendar-event-detail__source {
    position: static;
    margin-bottom: 10px;
  }

  .calendar-event-detail__summary {
    flex-wrap: wrap;
  }
}
</style>
