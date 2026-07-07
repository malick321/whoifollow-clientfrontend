// Team detail page — per-tab data clients
// ----------------------------------------
// The member-facing Team detail page (/team/:teamId, opened from the chat
// team info panel) has 4 tabs: Events, Teammates, Player Statistics, Team
// Statistics. Header + Team Statistics reuse the existing `fetchTeamDetail`
// (src/api/chat.ts); the three fetchers below back the other tabs + the
// header's Association line. All hit lean public-v2 chat/team endpoints and
// unwrap the standard { responseStatus, data } envelope.

import { buildV2ApiUrl } from './config'
import { getAuthHeaders } from '../auth-session'

interface Envelope<T> {
  responseStatus?: { statusCode?: number; message?: string }
  data?: T
}

async function fetchData<T>(path: string): Promise<T | null> {
  const res = await fetch(buildV2ApiUrl(path), {
    headers: { ...getAuthHeaders(), Accept: 'application/json' }
  })
  if (!res.ok) return null
  const env = (await res.json()) as Envelope<T>
  return (env?.data ?? null) as T | null
}

// ── Association (header) ─────────────────────────────────────────────────────

export interface TeamAssociation {
  id: string
  name: string
  registeredTeamName?: string
  registrationNo?: string | null
  registeredAt?: string | null
}

export async function fetchTeamAssociation(teamId: string): Promise<TeamAssociation | null> {
  const data = await fetchData<{ association: TeamAssociation | null }>(
    `/chat/teams/${encodeURIComponent(teamId)}/association`
  )
  return data?.association ?? null
}

// ── Events tab ───────────────────────────────────────────────────────────────

export interface TeamEventItem {
  id: string
  name: string
  association?: string | null
  eventType?: string | null
  mediumTypeLabel?: string | null
  location?: string | null
  dateRangeLabel: string
  statusLabel: string
}

export async function fetchTeamEvents(teamId: string): Promise<TeamEventItem[]> {
  const data = await fetchData<{ events: TeamEventItem[] }>(
    `/chat/teams/${encodeURIComponent(teamId)}/events`
  )
  return Array.isArray(data?.events) ? data!.events : []
}

// ── Player Statistics tab ────────────────────────────────────────────────────

export interface TeamPlayerStat {
  userId: string
  name: string
  games: number
  ab: number
  h: number
  r: number
  rbi: number
  hr: number
  bb: number
  singles: number
  doubles: number
  triples: number
  avg: string
  obp: string
}

export async function fetchTeamPlayerStats(teamId: string): Promise<TeamPlayerStat[]> {
  const data = await fetchData<{ players: TeamPlayerStat[] }>(
    `/chat/teams/${encodeURIComponent(teamId)}/player-stats`
  )
  return Array.isArray(data?.players) ? data!.players : []
}

// ── Teammates tab ────────────────────────────────────────────────────────────

export interface TeamMemberItem {
  memberId: string
  userId?: string | null
  userChatId?: string | null
  name: string
  avatarUrl?: string | null
  isAdmin: boolean
  isFan: boolean
  isPlayer: boolean
  uniformNo?: string | null
}

export async function fetchTeamMembers(teamId: string): Promise<TeamMemberItem[]> {
  const data = await fetchData<{ members: TeamMemberItem[] } | TeamMemberItem[]>(
    `/chat/teams/${encodeURIComponent(teamId)}/members`
  )
  if (!data) return []
  const list = Array.isArray(data) ? data : (data.members ?? [])
  return Array.isArray(list) ? list : []
}
