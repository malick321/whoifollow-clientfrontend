import { getJson, patchJson } from './client'
import { buildGameLineupSubmissionPayload } from './payloads/scoresheet'
import { adaptGameLineupPlayers, adaptGameLineupSubmission } from './adapters/scoresheet'
import type {
  FieldConfigPosition,
  GameLineupSubmission,
  GameLineupSubmissionDetail,
  LineupPlayer,
  ScoresheetDetail
} from '../types'
import type { ApiGameLineupPlayer, ApiGameLineupSubmission } from './contracts/scoresheet'

interface RawApiTemplateLineupPlayer {
  id: number | string | null
  event_team_lineup_id?: number | string | null
  team_member_id?: number | string | null
  user_id?: number | string | null
  image_url?: string | null
  avatar_url?: string | null
  profile_avatar?: string | null
  player_image_url?: string | null
  batting_order?: number | null
  jersey_number?: string | null
  player_name: string
  position_code?: string | null
  player_source_type?: number | null
  is_starter?: boolean | null
  is_bench?: boolean | null
  is_substitute?: boolean | null
  is_active?: boolean | null
  entered_inning?: number | null
  exited_inning?: number | null
  replaces_game_lineup_player_id?: number | string | null
  status?: 'active' | 'bench'
}

type RawTemplateLineupPlayer = LineupPlayer | RawApiTemplateLineupPlayer

interface RawGameLineupSubmissionDetailResponse {
  has_existing_submission: boolean
  submission: ApiGameLineupSubmission | GameLineupSubmission | null
  players?: ApiGameLineupPlayer[] | GameLineupSubmission['players']
  template_lineup?: RawTemplateLineupPlayer[]
  field_config?: {
    name?: string
    positions?: Array<{
      position_name: string
      position_number?: number | null
      x_axis?: number | null
      y_axis?: number | null
      status?: number | null
    }>
  } | null
}

interface RawGameLineupSubmissionSaveResponse {
  submission: ApiGameLineupSubmission | GameLineupSubmission
  players?: ApiGameLineupPlayer[] | GameLineupSubmission['players']
}

type GameLineupSubmissionEnvelope = {
  data?: RawGameLineupSubmissionDetailResponse | RawGameLineupSubmissionSaveResponse | null
}

function unwrapGameLineupResponse<T>(response: T | GameLineupSubmissionEnvelope): T {
  if (response && typeof response === 'object' && 'data' in response && response.data) {
    return response.data as T
  }

  return response as T
}

export async function fetchGameLineupSubmission(
  tournamentGameId: string,
  teamId: string
): Promise<GameLineupSubmissionDetail> {
  const encodedGameId = encodeURIComponent(tournamentGameId)
  const encodedTeamId = encodeURIComponent(teamId)
  return adaptGameLineupDetail(
    unwrapGameLineupResponse(
      await getJson<RawGameLineupSubmissionDetailResponse | GameLineupSubmissionEnvelope>(
        `/tournaments/game-lineup-submission/${encodedGameId}?team_id=${encodedTeamId}`
      )
    )
  )
}

function adaptGameLineupDetail(response: RawGameLineupSubmissionDetailResponse): GameLineupSubmissionDetail {
  const submission = adaptSubmission(response.submission, response.players)
  const players = response.has_existing_submission
    ? response.players
      ? adaptPlayers(response.players)
      : submission?.players
    : undefined

  return {
    hasExistingSubmission: response.has_existing_submission,
    submission,
    players,
    templateLineup: response.template_lineup ? adaptTemplateLineup(response.template_lineup) : undefined,
    fieldConfig: response.field_config
      ? {
          name: response.field_config.name,
          positions: adaptFieldConfigPositions(response.field_config.positions ?? [])
        }
      : null
  }
}

function adaptTemplateLineup(players: RawTemplateLineupPlayer[]): LineupPlayer[] {
  return players.map((player) => {
    if ('player_name' in player) {
      const apiPlayer = player as RawApiTemplateLineupPlayer
      const effectiveId =
        apiPlayer.event_team_lineup_id ??
        apiPlayer.id ??
        apiPlayer.team_member_id ??
        apiPlayer.user_id ??
        apiPlayer.player_name

      return {
        id: String(effectiveId),
        battingOrder: apiPlayer.batting_order ?? undefined,
        teamMemberId: apiPlayer.team_member_id != null ? String(apiPlayer.team_member_id) : null,
        userId: apiPlayer.user_id != null ? String(apiPlayer.user_id) : null,
        imageUrl:
          apiPlayer.player_image_url ??
          apiPlayer.profile_avatar ??
          apiPlayer.image_url ??
          apiPlayer.avatar_url ??
          undefined,
        jerseyNumber: apiPlayer.jersey_number ?? '',
        name: apiPlayer.player_name,
        position: apiPlayer.position_code ?? 'EH',
        playerSourceType:
          apiPlayer.team_member_id != null || apiPlayer.user_id != null ? 'team_member' : 'manual',
        status:
          apiPlayer.status != null
            ? apiPlayer.status === 'bench'
              ? 'bench'
              : 'active'
            : apiPlayer.is_bench
              ? 'bench'
              : 'active'
      }
    }

    return player
  })
}

function isApiSubmission(
  submission: ApiGameLineupSubmission | GameLineupSubmission | null
): submission is ApiGameLineupSubmission {
  return !!submission && 'submission_status' in submission
}

function isApiPlayer(player: ApiGameLineupPlayer | GameLineupSubmission['players'][number]) {
  return 'player_name' in player && 'batting_order' in player
}

function adaptPlayers(players: ApiGameLineupPlayer[] | GameLineupSubmission['players']): GameLineupSubmission['players'] {
  return players.length && isApiPlayer(players[0]) ? adaptGameLineupPlayers(players as ApiGameLineupPlayer[]) : players as GameLineupSubmission['players']
}

function adaptSubmission(
  submission: ApiGameLineupSubmission | GameLineupSubmission | null,
  players?: ApiGameLineupPlayer[] | GameLineupSubmission['players']
): GameLineupSubmission | null {
  if (!submission) return null
  if (isApiSubmission(submission)) {
    return adaptGameLineupSubmission(submission, Array.isArray(players) ? (players as ApiGameLineupPlayer[]) : [])
  }
  return submission
}

function adaptFieldConfigPositions(
  positions: Array<{
    position_name: string
    position_number?: number | null
    x_axis?: number | null
    y_axis?: number | null
    status?: number | null
  }>
): FieldConfigPosition[] {
  return positions.map((position) => {
    const code = position.position_name
    const label = position.position_name
    const numericSlot = position.position_number ?? null
    const area: FieldConfigPosition['area'] =
      code === 'P' || code === 'C'
        ? 'battery'
        : numericSlot && numericSlot <= 6
          ? 'infield'
          : ['LF', 'LC', 'CF', 'RC', 'RF'].includes(code)
            ? 'outfield'
            : 'flex'

    return {
      code,
      label,
      area,
      positionName: position.position_name,
      positionNumber: position.position_number ?? null,
      xAxis: position.x_axis ?? null,
      yAxis: position.y_axis ?? null,
      status: position.status ?? null
    }
  })
}

function lineupOptionsFromSubmission(submission: GameLineupSubmission): LineupPlayer[] {
  return submission.players
    .filter((player) => !player.isSubstitute || player.isActive)
    .map((player) => ({
      id: player.eventLineupId ?? player.id,
      teamMemberId: player.teamMemberId ?? null,
      userId: player.userId ?? null,
      jerseyNumber: player.jerseyNumber,
      name: player.playerName,
      position: player.positionCode ?? 'EH',
      status: player.isBench ? 'bench' : 'active'
    }))
}

function mergeSubmission(scoresheet: ScoresheetDetail, submission: GameLineupSubmission) {
  return {
    ...scoresheet,
    gameLineupSubmission: structuredClone(submission),
    gameLineupSubmitted: ['submitted', 'approved', 'finalized'].includes(submission.status),
    lineupOptions: lineupOptionsFromSubmission(submission)
  }
}

export async function saveGameLineupSubmission(
  tournamentGameId: string,
  teamId: string,
  submission: GameLineupSubmission
): Promise<GameLineupSubmission> {
  const payload = buildGameLineupSubmissionPayload(submission, {
    tournamentGameId: Number.parseInt(tournamentGameId.replace(/\D+/g, ''), 10) || 0,
    teamId: Number.parseInt(teamId.replace(/\D+/g, ''), 10) || 0,
    sportTypeId: 1
  })
  const response = unwrapGameLineupResponse(
    await patchJson<RawGameLineupSubmissionSaveResponse | GameLineupSubmissionEnvelope>(
      `/tournaments/game-lineup-submission/${encodeURIComponent(tournamentGameId)}?team_id=${encodeURIComponent(teamId)}`,
      payload
    )
  )
  return (
    adaptSubmission(response.submission, response.players) ?? {
      ...submission,
      players: response.players ? adaptPlayers(response.players) : submission.players
    }
  )
}
