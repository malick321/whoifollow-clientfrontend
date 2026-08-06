import { getAuthHeaders } from '../auth-session'
import { buildV2ApiUrl } from './config'

// Create a team-event game — POST /v2/chat/teams/{teamId}/events/{eventId}/games.
// See docs/api/team-event-games-api-contract.md.

export interface CreateGamePayload {
  name: string
  opponentName: string
  opponentCountry?: string
  opponentState?: string
  opponentCity?: string
  startDate: string // YYYY-MM-DD
  startTime?: string
  note?: string
}

export interface CreatedGame {
  id: string
  guid: string | null
  name: string
  opponentName: string
  startDate: string | null
  startTime: string | null
}

const gamesBase = (teamId: string, eventId: string) =>
  `/chat/teams/${encodeURIComponent(teamId)}/events/${encodeURIComponent(eventId)}/games`

async function gameRequest<T>(path: string, method: string, payload?: unknown): Promise<T | null> {
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
    data?: T
  }
  if (!response.ok) {
    throw new Error(envelope.responseStatus?.message || 'Request failed.')
  }
  return envelope.data ?? null
}

export async function createTeamEventGame(
  teamId: string,
  eventId: string,
  payload: CreateGamePayload
): Promise<CreatedGame> {
  const data = await gameRequest<{ game?: CreatedGame }>(gamesBase(teamId, eventId), 'POST', payload)
  if (!data?.game) throw new Error('Could not create the game.')
  return data.game
}

export async function updateTeamEventGame(
  teamId: string,
  eventId: string,
  gameId: string,
  payload: CreateGamePayload
): Promise<void> {
  await gameRequest(`${gamesBase(teamId, eventId)}/${encodeURIComponent(gameId)}`, 'PUT', payload)
}

export async function deleteTeamEventGame(
  teamId: string,
  eventId: string,
  gameId: string
): Promise<void> {
  await gameRequest(`${gamesBase(teamId, eventId)}/${encodeURIComponent(gameId)}`, 'DELETE')
}
