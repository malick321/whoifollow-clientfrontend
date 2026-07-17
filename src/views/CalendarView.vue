<script setup lang="ts">
import { computed, ref } from 'vue'
import FullCalendar from '@fullcalendar/vue3'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import listPlugin from '@fullcalendar/list'
import type { DatesSetArg, EventClickArg, EventInput } from '@fullcalendar/core'
import AppIcon from '../components/AppIcon.vue'
import EventDetailModal from '../components/calendar/EventDetailModal.vue'
import {
  fetchCalendarEvents,
  type AttendanceStatus,
  type CalendarEvent
} from '../api/calendar'
import { pushToast } from '../toast-center'

const events = ref<CalendarEvent[]>([])
const loading = ref(false)
const rangeLabel = ref('')
const activeRange = ref<{ from: string; to: string } | null>(null)
const selectedEventId = ref<string | null>(null)
const detailOpen = ref(false)
const hasLoadedOnce = ref(false)

let fetchToken = 0

const sourceColors: Record<CalendarEvent['source'], string> = {
  team: '#1f8fff',
  following: '#5d7cfa',
  attending: '#2f9d74'
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function toYmd(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function rangeEndInclusive(end: Date): string {
  const copy = new Date(end)
  copy.setDate(copy.getDate() - 1)
  return toYmd(copy)
}

function composeDateTime(date?: string, time?: string): string | undefined {
  if (!date) return undefined
  return time ? `${date}T${time}` : date
}

function eventSourceLabel(source: CalendarEvent['source']): string {
  if (source === 'team') return 'Team'
  if (source === 'attending') return 'Attending'
  return 'Following'
}

const calendarEvents = computed<EventInput[]>(() =>
  events.value.map((event) => {
    const color = event.color || sourceColors[event.source]
    return {
      id: event.id,
      title: event.name,
      start: composeDateTime(event.startDate, event.startTime),
      end: composeDateTime(event.endDate, event.endTime),
      allDay: event.allDay || (!event.startTime && !event.endTime),
      backgroundColor: color,
      borderColor: color,
      extendedProps: {
        source: event.source,
        attendanceStatus: event.attendanceStatus,
        location: [event.location.city, event.location.state].filter(Boolean).join(', ')
      }
    }
  })
)

const isEmpty = computed(() => hasLoadedOnce.value && !loading.value && events.value.length === 0)

async function loadRange(from: string, to: string) {
  const myToken = ++fetchToken
  loading.value = true
  try {
    const result = await fetchCalendarEvents({ from, to })
    if (myToken !== fetchToken) return
    events.value = result
  } catch (error) {
    if (myToken !== fetchToken) return
    events.value = []
    pushToast({
      tone: 'warning',
      title: 'Could not load calendar',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    if (myToken === fetchToken) {
      loading.value = false
      hasLoadedOnce.value = true
    }
  }
}

function onDatesSet(arg: DatesSetArg) {
  const from = toYmd(arg.start)
  const to = rangeEndInclusive(arg.end)
  rangeLabel.value = arg.view.title
  if (activeRange.value?.from === from && activeRange.value?.to === to) return
  activeRange.value = { from, to }
  void loadRange(from, to)
}

function onEventClick(arg: EventClickArg) {
  selectedEventId.value = arg.event.id
  detailOpen.value = true
}

function onAttendanceUpdated(payload: { eventId: string; attendanceStatus: AttendanceStatus }) {
  const event = events.value.find((item) => item.id === payload.eventId)
  if (event) event.attendanceStatus = payload.attendanceStatus
}

const calendarOptions = computed(() => ({
  plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin],
  initialView: 'dayGridMonth',
  headerToolbar: {
    left: 'prev,next today',
    center: 'title',
    right: 'dayGridMonth,timeGridWeek,listWeek'
  },
  buttonText: {
    today: 'Today',
    month: 'Month',
    week: 'Week',
    list: 'List'
  },
  events: calendarEvents.value,
  datesSet: onDatesSet,
  eventClick: onEventClick,
  eventDisplay: 'block',
  fixedWeekCount: false,
  height: 'auto',
  nowIndicator: true,
  dayMaxEvents: 3
}))
</script>

<template>
  <section class="calendar-page association-users__main association-users__main--wide">
    <header class="calendar-page__header">
      <div class="calendar-page__heading">
        <p class="calendar-page__eyebrow">Calendar</p>
        <h1>My Calendar</h1>
        <p class="calendar-page__copy">
          {{ rangeLabel || 'Events from your teams, follows, and RSVPs.' }}
        </p>
      </div>
      <div class="calendar-page__legend" aria-label="Calendar sources">
        <span
          v-for="source in (['team', 'following', 'attending'] as const)"
          :key="source"
          class="calendar-page__legend-item"
        >
          <i :style="{ backgroundColor: sourceColors[source] }" aria-hidden="true"></i>
          {{ eventSourceLabel(source) }}
        </span>
      </div>
    </header>

    <div class="calendar-page__surface">
      <div class="calendar-page__toolbar">
        <div class="calendar-page__toolbar-title">
          <span class="calendar-page__toolbar-icon" aria-hidden="true">
            <AppIcon name="calendar" :size="16" />
          </span>
          <span>{{ events.length }} {{ events.length === 1 ? 'event' : 'events' }}</span>
        </div>
        <span v-if="loading" class="calendar-page__loading">
          <span class="btn-spinner" aria-hidden="true"></span>
          Loading
        </span>
      </div>

      <div class="calendar-page__calendar" :class="{ 'calendar-page__calendar--empty': isEmpty }">
        <FullCalendar :options="calendarOptions" />

        <div v-if="isEmpty" class="calendar-page__empty">
          <span class="calendar-page__empty-icon" aria-hidden="true">
            <AppIcon name="calendar" :size="26" />
          </span>
          <p class="calendar-page__empty-title">No events this period</p>
          <p class="calendar-page__empty-copy">
            Nothing from your teams, follows, or RSVPs falls in this range. Try another month.
          </p>
        </div>
      </div>
    </div>

    <EventDetailModal
      v-model="detailOpen"
      :event-id="selectedEventId"
      @attendance-updated="onAttendanceUpdated"
    />
  </section>
</template>

<style scoped>
.calendar-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding-top: 24px;
}

/* ── Header ───────────────────────────────────────────────────────── */
.calendar-page__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
}

.calendar-page__heading {
  min-width: 0;
}

.calendar-page__eyebrow {
  margin: 0 0 6px;
  color: var(--primary);
  font-size: 0.78rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0;
}

.calendar-page__header h1 {
  margin: 0;
  color: var(--text);
  font-size: clamp(1.6rem, 3vw, 2.2rem);
  font-weight: 500;
  letter-spacing: 0;
}

.calendar-page__copy {
  margin: 8px 0 0;
  color: var(--text-light);
  font-size: 0.95rem;
}

.calendar-page__legend {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.calendar-page__legend-item {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--border-divider);
  border-radius: 999px;
  background: var(--surface-pill);
  color: var(--text);
  font-size: 0.82rem;
  font-weight: 500;
}

.calendar-page__legend-item i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

/* ── Surface + toolbar ────────────────────────────────────────────── */
.calendar-page__surface {
  overflow: hidden;
  border: 1px solid var(--border-divider);
  border-radius: 10px;
  background: var(--surface-card);
  box-shadow: var(--shadow-soft);
}

.calendar-page__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-divider);
  background: var(--surface-chrome);
}

.calendar-page__toolbar-title {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  color: var(--text);
  font-size: 0.9rem;
  font-weight: 500;
}

.calendar-page__toolbar-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: var(--primary-light-3);
  color: var(--primary);
}

.calendar-page__loading {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-light);
  font-size: 0.85rem;
}

.calendar-page__calendar {
  position: relative;
}

/* When empty, the bare grid sits behind a centered empty-state card. */
.calendar-page__calendar--empty :deep(.fc) {
  opacity: 0.35;
  pointer-events: none;
}

/* ── Empty state ──────────────────────────────────────────────────── */
.calendar-page__empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 8px;
  padding: 24px;
}

.calendar-page__empty-icon {
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

.calendar-page__empty-title {
  margin: 0;
  color: var(--text);
  font-size: 1rem;
  font-weight: 500;
}

.calendar-page__empty-copy {
  margin: 0;
  max-width: 320px;
  color: var(--text-light);
  font-size: 0.9rem;
  line-height: 1.5;
}

/* ═══════════════════════════════════════════════════════════════════
   FullCalendar chrome — token-driven theme so the embedded calendar
   reads as part of the app in both light + dark, instead of the stock
   bootstrap-ish look. Scoped via :deep() through the .fc root.
   ═══════════════════════════════════════════════════════════════════ */
.calendar-page :deep(.fc) {
  --fc-border-color: var(--border-divider);
  --fc-today-bg-color: var(--primary-light-3);
  --fc-neutral-bg-color: var(--surface-raised);
  --fc-page-bg-color: transparent;
  --fc-now-indicator-color: var(--highlight);
  padding: 16px;
  color: var(--text);
  font-family: var(--font-body);
}

/* ── Toolbar ──────────────────────────────────────────────────────── */
.calendar-page :deep(.fc .fc-toolbar.fc-header-toolbar) {
  margin-bottom: 16px;
}

.calendar-page :deep(.fc .fc-toolbar-title) {
  color: var(--text);
  font-size: 1.15rem;
  font-weight: 500;
}

/* Toolbar buttons styled to match the app's tertiary/ghost buttons. */
.calendar-page :deep(.fc .fc-button-primary) {
  border: 1px solid var(--border-divider);
  background: var(--surface-btn-solid);
  color: var(--text);
  font-family: var(--font-body);
  font-size: 0.82rem;
  font-weight: 500;
  padding: 7px 14px;
  box-shadow: none;
  text-transform: none;
  transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease;
}

.calendar-page :deep(.fc .fc-button-primary:hover:not(:disabled)) {
  border-color: var(--border-accent-hover);
  background: rgba(45, 140, 240, 0.06);
  color: var(--text);
}

.calendar-page :deep(.fc .fc-button-primary:focus),
.calendar-page :deep(.fc .fc-button-primary:focus-visible) {
  outline: none;
  box-shadow: 0 0 0 2px var(--primary-light-2);
}

.calendar-page :deep(.fc .fc-button-primary:disabled) {
  border-color: var(--border-divider);
  background: var(--surface-btn-solid);
  color: var(--text-light);
  opacity: 0.6;
}

/* Active view + today buttons get the primary-tinted selected state. */
.calendar-page :deep(.fc .fc-button-primary:not(:disabled).fc-button-active),
.calendar-page :deep(.fc .fc-button-primary:not(:disabled):active) {
  border-color: var(--primary-light-2);
  background: var(--primary-light-3);
  color: var(--primary);
}

/* Prev/next chevrons inherit the icon color cleanly. */
.calendar-page :deep(.fc .fc-button .fc-icon) {
  font-size: 1.2em;
  vertical-align: middle;
}

/* Tighten the segmented button group corners. */
.calendar-page :deep(.fc .fc-button-group > .fc-button) {
  border-radius: 0;
}

.calendar-page :deep(.fc .fc-button-group > .fc-button:first-child) {
  border-top-left-radius: 5px;
  border-bottom-left-radius: 5px;
}

.calendar-page :deep(.fc .fc-button-group > .fc-button:last-child) {
  border-top-right-radius: 5px;
  border-bottom-right-radius: 5px;
}

.calendar-page :deep(.fc .fc-button-group > .fc-button:not(:first-child)) {
  margin-left: -1px;
}

/* ── Grid ─────────────────────────────────────────────────────────── */
.calendar-page :deep(.fc-theme-standard td),
.calendar-page :deep(.fc-theme-standard th),
.calendar-page :deep(.fc-theme-standard .fc-scrollgrid) {
  border-color: var(--border-divider);
}

.calendar-page :deep(.fc .fc-scrollgrid) {
  border-radius: 8px;
  overflow: hidden;
}

/* Day-of-week header row reads as a quiet uppercase label strip. */
.calendar-page :deep(.fc .fc-col-header-cell) {
  background: var(--surface-raised);
  padding: 8px 0;
}

.calendar-page :deep(.fc-col-header-cell-cushion) {
  color: var(--text-light);
  text-decoration: none;
  font-size: 0.72rem;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 6px 8px;
}

.calendar-page :deep(.fc-daygrid-day-number) {
  color: var(--text);
  text-decoration: none;
  font-size: 0.82rem;
  font-weight: 500;
  padding: 6px 8px;
}

/* Today: tinted cell + a pill around the date number. */
.calendar-page :deep(.fc .fc-daygrid-day.fc-day-today) {
  background: var(--primary-light-3);
}

.calendar-page :deep(.fc .fc-day-today .fc-daygrid-day-number) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  margin: 4px 4px 0 auto;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--primary);
  color: var(--white);
}

/* ── Event chips ──────────────────────────────────────────────────── */
.calendar-page :deep(.fc-event) {
  border-radius: 5px;
  border-width: 0;
  border-left-width: 3px;
  border-left-style: solid;
  padding: 2px 6px;
  font-size: 0.78rem;
  font-weight: 500;
  cursor: pointer;
  transition: filter 120ms ease, transform 120ms ease;
}

.calendar-page :deep(.fc-daygrid-block-event .fc-event-title),
.calendar-page :deep(.fc-event-title) {
  font-weight: 500;
}

/* Chip text sits on a soft tint of the event color rather than a full
   saturated fill, so dense months stay readable. The colored left
   border carries the source identity. */
.calendar-page :deep(.fc-h-event),
.calendar-page :deep(.fc-daygrid-block-event) {
  background: color-mix(in srgb, var(--fc-event-bg-color, var(--primary)) 16%, var(--surface-card));
  color: var(--text);
}

.calendar-page :deep(.fc-event:hover) {
  filter: brightness(0.98);
}

/* Dot events (timed events in month view) keep their color dot. */
.calendar-page :deep(.fc-daygrid-event-dot) {
  border-color: var(--fc-event-bg-color, var(--primary));
}

.calendar-page :deep(.fc-daygrid-dot-event) {
  color: var(--text);
}

.calendar-page :deep(.fc-daygrid-dot-event:hover) {
  background: var(--surface-raised);
}

/* "+N more" link. */
.calendar-page :deep(.fc-daygrid-more-link) {
  color: var(--primary);
  font-size: 0.74rem;
  font-weight: 500;
  text-decoration: none;
}

.calendar-page :deep(.fc-daygrid-more-link:hover) {
  text-decoration: underline;
}

.calendar-page :deep(.fc-popover) {
  border: 1px solid var(--border-divider);
  border-radius: 8px;
  background: var(--surface-opaque);
  box-shadow: var(--shadow);
}

.calendar-page :deep(.fc-popover-header) {
  background: var(--surface-raised);
  color: var(--text);
}

/* ── List view ────────────────────────────────────────────────────── */
.calendar-page :deep(.fc-list),
.calendar-page :deep(.fc-list-table td),
.calendar-page :deep(.fc-list-day-cushion) {
  background: var(--surface-card);
  border-color: var(--border-divider);
}

.calendar-page :deep(.fc .fc-list) {
  border-radius: 8px;
  overflow: hidden;
}

.calendar-page :deep(.fc-list-event-title),
.calendar-page :deep(.fc-list-event-time) {
  color: var(--text);
  font-weight: 500;
}

.calendar-page :deep(.fc-list-day-text),
.calendar-page :deep(.fc-list-day-side-text) {
  color: var(--text);
  font-weight: 500;
  text-decoration: none;
}

.calendar-page :deep(.fc .fc-list-event:hover td) {
  background: var(--surface-raised);
}

.calendar-page :deep(.fc-list-empty) {
  background: var(--surface-card);
  color: var(--text-light);
}

/* ── Dark-mode nudges ─────────────────────────────────────────────── */
html.dark-mode .calendar-page :deep(.fc .fc-button-primary:hover:not(:disabled)) {
  background: rgba(79, 163, 255, 0.1);
}

html.dark-mode .calendar-page :deep(.fc-event:hover) {
  filter: brightness(1.12);
}

@media (max-width: 840px) {
  .calendar-page__header {
    align-items: flex-start;
    flex-direction: column;
  }

  .calendar-page__legend {
    justify-content: flex-start;
  }

  .calendar-page :deep(.fc) {
    padding: 10px;
  }

  .calendar-page :deep(.fc .fc-toolbar.fc-header-toolbar) {
    align-items: stretch;
    flex-direction: column;
    gap: 10px;
  }

  .calendar-page :deep(.fc .fc-toolbar-title) {
    font-size: 1.05rem;
  }
}

@media (max-width: 560px) {
  .calendar-page {
    gap: 14px;
    padding-top: 16px;
  }

  .calendar-page__copy {
    font-size: 0.88rem;
  }

  .calendar-page__legend {
    gap: 6px;
  }

  .calendar-page__legend-item {
    height: 30px;
    padding: 0 10px;
    font-size: 0.78rem;
  }

  .calendar-page__surface {
    border-radius: 8px;
  }

  .calendar-page__toolbar {
    flex-wrap: wrap;
    padding: 12px;
  }

  .calendar-page :deep(.fc) {
    padding: 8px 6px;
  }

  .calendar-page :deep(.fc .fc-toolbar-chunk) {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
  }

  .calendar-page :deep(.fc .fc-toolbar-title) {
    width: 100%;
    text-align: center;
    font-size: 1rem;
  }

  .calendar-page :deep(.fc .fc-button-primary) {
    padding: 6px 10px;
    font-size: 0.76rem;
  }

  .calendar-page :deep(.fc-col-header-cell-cushion) {
    padding: 4px 2px;
    font-size: 0.64rem;
  }

  .calendar-page :deep(.fc-daygrid-day-number) {
    padding: 4px;
    font-size: 0.72rem;
  }

  .calendar-page :deep(.fc-event) {
    padding: 1px 4px;
    font-size: 0.68rem;
  }

  .calendar-page :deep(.fc .fc-daygrid-day-frame) {
    min-height: 58px;
  }
}
</style>
