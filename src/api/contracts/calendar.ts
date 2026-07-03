export type ApiCalendarSource = 'team' | 'following' | 'attending'
export type ApiAttendanceStatus = 'going' | 'not_going' | null

export interface ApiCalendarEventLocation {
  city: string | null
  state: string | null
}

export interface ApiCalendarEventAssociation {
  id: string | null
  name: string | null
}

export interface ApiCalendarEvent {
  id: string
  guid: string | null
  name: string | null
  eventType: string | null
  startDate: string | null
  endDate: string | null
  startTime: string | null
  endTime: string | null
  allDay: boolean | null
  timeZone: string | null
  color: string | null
  location: ApiCalendarEventLocation | null
  association: ApiCalendarEventAssociation | null
  avatarUrl: string | null
  source: ApiCalendarSource
  attendanceStatus: ApiAttendanceStatus
}

export interface ApiCalendarEventDetail extends ApiCalendarEvent {
  description: string | null
  directorName: string | null
  externalUrl: string | null
}

export interface ApiCalendarEventsResponse {
  responseStatus?: {
    message?: string
    statusCode?: number
    text?: string
  }
  data?: {
    events?: ApiCalendarEvent[] | null
  } | null
}

export interface ApiCalendarEventResponse {
  responseStatus?: {
    message?: string
    statusCode?: number
    text?: string
  }
  data?: {
    event?: ApiCalendarEventDetail | null
  } | null
}

export interface ApiCalendarAttendanceResponse {
  responseStatus?: {
    message?: string
    statusCode?: number
    text?: string
  }
  data?: {
    attendanceStatus?: ApiAttendanceStatus
  } | null
}
