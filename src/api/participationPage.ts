import { buildV2ApiUrl } from './config'
import { getAuthHeaders } from '../auth-session'
import { fetchTournamentGames } from './tournamentGames'
import {
  adaptTeamParticipation
} from './adapters/participation'
import type {
  ApiTeamParticipationResponse
} from './contracts/participation'
import { getParticipationState } from './mockState'
import type { TeamParticipation } from '../types'

export interface TeamParticipationSummary {
  eventId: string
  eventGuid?: string
  eventName: string
  eventDate: string
  division: string
  tournamentId?: string
  tournamentGuid?: string
  teamId?: string
  teamGuid?: string
  teamAvatarUrl?: string
  teamRating?: string
  teamAgeGroup?: string
  teamCity?: string
  teamState?: string
  eventStartDate?: string
  eventEndDate?: string
  divisionGuid?: string
  feeStatus: TeamParticipation['feeStatus']
  associationStatus: TeamParticipation['associationStatus']
  participationStatus: TeamParticipation['participationStatus']
  teamName: string
  manager: TeamParticipation['manager']
  eventOverview: TeamParticipation['eventOverview']
}

/** Thrown by `fetchTeamParticipationPage` when the participation API
 *  responds with a non-200 envelope statusCode (e.g., participation
 *  doesn't exist, user isn't authorized to see it). The view catches
 *  this specific error and redirects to NotFoundView. HTTP / network
 *  errors take a different code path (dev mock fallback) and do NOT
 *  throw this class. */
export class ParticipationNotFoundError extends Error {
  readonly statusCode: number | null
  constructor(message = 'Participation not available.', statusCode: number | null = null) {
    super(message)
    this.name = 'ParticipationNotFoundError'
    this.statusCode = statusCode
  }
}

const TEMP_TOURNAMENT_GUID_BY_ID: Record<string, string> = {
  '1227': '22db7770-e620-4e87-a4af-287d0cb39ef2'
}

export function resolveTournamentGuid(
  participation: Pick<TeamParticipation, 'tournamentGuid'>,
  tournamentId?: string,
  tournamentGuid?: string
) {
  return (
    tournamentGuid ??
    participation.tournamentGuid ??
    (tournamentId ? TEMP_TOURNAMENT_GUID_BY_ID[tournamentId] : undefined)
  )
}

export async function fetchTeamParticipationPage(
  teamParticipationId: string
): Promise<TeamParticipation> {
  // Use a raw fetch (not the postJson/getJson wrapper) so we can read the
  // response body regardless of HTTP status. The wrapper throws a plain
  // Error on 4xx/5xx and discards the body — which would hide the
  // envelope statusCode the backend uses to signal business errors like
  // 403 "Not allowed." (where HTTP is also 4xx + the envelope has a
  // distinct message). Reading the body manually lets us route the user
  // to NotFoundView on any non-200 envelope, regardless of HTTP status.
  let httpResponse: Response
  try {
    httpResponse = await fetch(
      buildV2ApiUrl(
        `/tournaments/team-participation/${encodeURIComponent(teamParticipationId)}`
      ),
      {
        headers: {
          ...getAuthHeaders(),
          Accept: 'application/json'
        }
      }
    )
  } catch {
    // True network failure (no response at all). Dev mock fallback so
    // local work without the backend continues to function.
    return getParticipationState()
  }

  // Parse the body regardless of HTTP status.
  let envelope: ApiTeamParticipationResponse | null = null
  try {
    envelope = (await httpResponse.json()) as ApiTeamParticipationResponse
  } catch {
    // Body wasn't JSON. Fall back to mock.
    return getParticipationState()
  }

  // Envelope statusCode is the single source of truth. Backend returns
  // this alongside HTTP status for every response — non-200 means the
  // request wasn't fulfilled (not allowed, not found, etc.) and we must
  // redirect the user to NotFoundView.
  if (envelope?.statusCode != null && envelope.statusCode !== 200) {
    throw new ParticipationNotFoundError(
      envelope.message ?? 'Participation not available.',
      envelope.statusCode
    )
  }

  // Defensive: if HTTP was non-2xx AND the envelope didn't carry an
  // explicit statusCode (backend shape we don't recognize), treat as
  // not-found rather than silently mock-falling-back. The user's
  // explicit rule — "if status is 200 show, else redirect" — wins.
  if (!httpResponse.ok) {
    throw new ParticipationNotFoundError(
      envelope?.message ?? `Participation request failed (${httpResponse.status}).`,
      httpResponse.status
    )
  }

  const participation = adaptTeamParticipation(envelope)
  participation.games = participation.games ?? []
  return participation
}

export async function fetchParticipationGames(
  participation: Pick<TeamParticipation, 'tournamentGuid' | 'teamAvatarUrl'>,
  teamId: string,
  tournamentId?: string,
  tournamentGuid?: string
) {
  const resolvedTournamentGuid = resolveTournamentGuid(participation, tournamentId, tournamentGuid)
  if (!resolvedTournamentGuid) return []

  try {
    const games = await fetchTournamentGames(resolvedTournamentGuid, teamId)
    // Unscheduled games don't have game_scores populated, so the game-level
    // adapter can't resolve the viewing team's avatar. Backfill from the
    // participation payload so the viewing team's logo shows across every
    // card state (scheduled, live, delayed, unscheduled, final). Opponent
    // stays as initials for unscheduled games — there is no opponent fixture
    // yet to attach a logo to.
    if (!participation.teamAvatarUrl) return games
    return games.map((game) =>
      game.teamImageUrl ? game : { ...game, teamImageUrl: participation.teamAvatarUrl }
    )
  } catch {
    return []
  }
}
