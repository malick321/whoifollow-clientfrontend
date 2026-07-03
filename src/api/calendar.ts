import { getAuthHeaders } from '../auth-session'
import { buildV2ApiUrl } from './config'
import {
  adaptCalendarEventResponse,
  adaptCalendarEvents
} from './adapters/calendar'
import type {
  ApiCalendarAttendanceResponse,
  ApiCalendarEventResponse,
  ApiCalendarEventsResponse,
  ApiAttendanceStatus,
  ApiCalendarSource
} from './contracts/calendar'

export type CalendarSource = ApiCalendarSource
export type AttendanceStatus = Exclude<ApiAttendanceStatus, null>

export interface CalendarEventLocation {
  city?: string
  state?: string
}

export interface CalendarEventAssociation {
  id?: string
  name?: string
}

export interface CalendarEvent {
  id: string
  guid?: string
  name: string
  eventType: string
  startDate?: string
  endDate?: string
  startTime?: string
  endTime?: string
  allDay: boolean
  timeZone?: string
  color?: string
  location: CalendarEventLocation
  association: CalendarEventAssociation
  avatarUrl?: string
  source: CalendarSource
  attendanceStatus: ApiAttendanceStatus
}

export interface CalendarEventDetail extends CalendarEvent {
  description?: string
  directorName?: string
  externalUrl?: string
}

export interface CalendarRangeFilters {
  from?: string
  to?: string
}

function buildQuery(filters: CalendarRangeFilters): string {
  const params = new URLSearchParams()
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

async function parseEnvelope<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as {
    responseStatus?: { message?: string }
    message?: string
  }

  if (!response.ok) {
    const message = body.responseStatus?.message || body.message || `Request failed: ${response.status}`
    throw new Error(message)
  }

  return body as T
}

export async function fetchCalendarEvents(
  filters: CalendarRangeFilters = {}
): Promise<CalendarEvent[]> {
  const response = await fetch(buildV2ApiUrl(`/calendar/events${buildQuery(filters)}`), {
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json'
    }
  })

  return adaptCalendarEvents(await parseEnvelope<ApiCalendarEventsResponse>(response))
}

export async function fetchCalendarEvent(eventId: string): Promise<CalendarEventDetail | null> {
  const response = await fetch(buildV2ApiUrl(`/calendar/events/${encodeURIComponent(eventId)}`), {
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json'
    }
  })

  return adaptCalendarEventResponse(await parseEnvelope<ApiCalendarEventResponse>(response))
}

export async function setAttendance(
  eventId: string,
  status: AttendanceStatus
): Promise<ApiCalendarAttendanceResponse['data']> {
  const response = await fetch(
    buildV2ApiUrl(`/calendar/events/${encodeURIComponent(eventId)}/attendance`),
    {
      method: 'POST',
      headers: {
        ...getAuthHeaders(),
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status })
    }
  )

  return (await parseEnvelope<ApiCalendarAttendanceResponse>(response)).data ?? null
}
