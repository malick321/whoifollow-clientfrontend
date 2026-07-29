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

export async function createTeamEventGame(
  teamId: string,
  eventId: string,
  payload: CreateGamePayload
): Promise<CreatedGame> {
  const path = `/chat/teams/${encodeURIComponent(teamId)}/events/${encodeURIComponent(eventId)}/games`
  const response = await fetch(buildV2ApiUrl(path), {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
  const envelope = (await response.json().catch(() => ({}))) as {
    responseStatus?: { message?: string }
    data?: { game?: CreatedGame }
  }
  if (!response.ok || !envelope.data?.game) {
    throw new Error(envelope.responseStatus?.message || 'Could not create the game.')
  }
  return envelope.data.game
}
