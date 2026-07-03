import type {
  ApiCalendarEvent,
  ApiCalendarEventDetail,
  ApiCalendarEventResponse,
  ApiCalendarEventsResponse
} from '../contracts/calendar'
import type { CalendarEvent, CalendarEventDetail } from '../calendar'

export function adaptCalendarEvent(raw: ApiCalendarEvent): CalendarEvent {
  return {
    id: String(raw.id),
    guid: raw.guid ?? undefined,
    name: raw.name ?? '',
    eventType: raw.eventType ?? '',
    startDate: raw.startDate ?? undefined,
    endDate: raw.endDate ?? undefined,
    startTime: raw.startTime ?? undefined,
    endTime: raw.endTime ?? undefined,
    allDay: !!raw.allDay,
    timeZone: raw.timeZone ?? undefined,
    color: raw.color ?? undefined,
    location: {
      city: raw.location?.city ?? undefined,
      state: raw.location?.state ?? undefined
    },
    association: {
      id: raw.association?.id ?? undefined,
      name: raw.association?.name ?? undefined
    },
    avatarUrl: raw.avatarUrl ?? undefined,
    source: raw.source,
    attendanceStatus: raw.attendanceStatus ?? null
  }
}

export function adaptCalendarEventDetail(raw: ApiCalendarEventDetail): CalendarEventDetail {
  return {
    ...adaptCalendarEvent(raw),
    description: raw.description ?? undefined,
    directorName: raw.directorName ?? undefined,
    externalUrl: raw.externalUrl ?? undefined
  }
}

export function adaptCalendarEvents(response: ApiCalendarEventsResponse): CalendarEvent[] {
  return (response?.data?.events ?? []).map(adaptCalendarEvent)
}

export function adaptCalendarEventResponse(
  response: ApiCalendarEventResponse
): CalendarEventDetail | null {
  const event = response?.data?.event ?? null
  return event ? adaptCalendarEventDetail(event) : null
}
