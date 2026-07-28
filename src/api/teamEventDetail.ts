import { getAuthHeaders } from '../auth-session'
import { buildV2ApiUrl } from './config'
import type {
  EventAttendanceStatus,
  EventBoxscore,
  EventPlayerStat,
  EventTeamStats,
  TeamEventAttendance,
  TeamEventOverview
} from './contracts/teamEventDetail'

interface Envelope<T> {
  responseStatus?: { statusCode?: number; message?: string }
  data?: T
}

function eventPath(teamId: string, eventId: string, resource: string): string {
  return `/chat/teams/${encodeURIComponent(teamId)}/events/${encodeURIComponent(eventId)}/${resource}`
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(buildV2ApiUrl(path), {
    ...init,
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {})
    }
  })
  const envelope = (await response.json().catch(() => ({}))) as Envelope<T>
  if (!response.ok || !envelope.data) {
    throw new Error(envelope.responseStatus?.message || 'Could not load event details.')
  }
  return envelope.data
}

export async function fetchTeamEventOverview(teamId: string, eventId: string): Promise<TeamEventOverview> {
  const data = await request<{ event: TeamEventOverview }>(eventPath(teamId, eventId, 'overview'))
  return data.event
}

export async function fetchEventBoxscores(teamId: string, eventId: string): Promise<EventBoxscore[]> {
  const data = await request<{ games: EventBoxscore[] }>(eventPath(teamId, eventId, 'boxscores'))
  return Array.isArray(data.games) ? data.games : []
}

export async function fetchEventPlayerStats(teamId: string, eventId: string): Promise<EventPlayerStat[]> {
  const data = await request<{ players: EventPlayerStat[] }>(eventPath(teamId, eventId, 'player-stats'))
  return Array.isArray(data.players) ? data.players : []
}

export async function fetchEventTeamStats(teamId: string, eventId: string): Promise<EventTeamStats> {
  const data = await request<EventTeamStats>(eventPath(teamId, eventId, 'team-stats'))
  return { games: Array.isArray(data.games) ? data.games : [], total: data.total ?? null }
}

export async function updateEventAttendance(
  teamId: string,
  eventId: string,
  status: Exclude<EventAttendanceStatus, 'not_responded'>
): Promise<TeamEventAttendance> {
  const data = await request<{ attendance: TeamEventAttendance }>(eventPath(teamId, eventId, 'attendance'), {
    method: 'PATCH',
    body: JSON.stringify({ status })
  })
  return data.attendance
}
