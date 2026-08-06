import { getAuthHeaders } from '../auth-session'
import { buildV2ApiUrl } from './config'

// Game lineup for a team-event game.
// GET/PUT /v2/chat/teams/{teamId}/events/{eventId}/games/{gameId}/lineup

export interface LineupPlayer {
  userId: string
  name: string
  avatarUrl: string | null
  uniformNo: string | null
  positionId?: string | null
  positionName?: string | null
  positionIndex?: number
}

export interface LineupPositionOption {
  id: string
  name: string
}

export interface GameLineup {
  selected: LineupPlayer[]
  available: LineupPlayer[]
  positions: LineupPositionOption[]
}

export interface SaveLineupPlayer {
  userId: string
  positionId: string | null
  positionIndex: number
}

const lineupPath = (teamId: string, eventId: string, gameId: string) =>
  `/chat/teams/${encodeURIComponent(teamId)}/events/${encodeURIComponent(eventId)}/games/${encodeURIComponent(gameId)}/lineup`

async function lineupRequest(path: string, method: string, payload?: unknown): Promise<GameLineup> {
  const response = await fetch(buildV2ApiUrl(path), {
    method,
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json',
      ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {})
  })
  const envelope = (await response.json().catch(() => ({}))) as {
    responseStatus?: { message?: string }
    data?: GameLineup
  }
  if (!response.ok || !envelope.data) {
    throw new Error(envelope.responseStatus?.message || 'Could not load the lineup.')
  }
  return envelope.data
}

export function fetchGameLineup(teamId: string, eventId: string, gameId: string): Promise<GameLineup> {
  return lineupRequest(lineupPath(teamId, eventId, gameId), 'GET')
}

export function saveGameLineup(
  teamId: string,
  eventId: string,
  gameId: string,
  players: SaveLineupPlayer[]
): Promise<GameLineup> {
  return lineupRequest(lineupPath(teamId, eventId, gameId), 'PUT', { players })
}
