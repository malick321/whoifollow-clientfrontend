import { deleteJson, getJson, patchJson, postJson, uploadFile } from './client'
import { adaptScoresheetDetail } from './adapters/scoresheet'
import type { ApiScoresheetResponse } from './contracts/scoresheet'
import { getScoresheetState, setScoresheetState } from './mockState'
import { fetchTournamentGameScores, mergeTournamentGameScoresIntoScoresheet } from './tournamentGameScores'
import type {
  GameLineupSubmission,
  ScoresheetDetail,
  ScoresheetPlateAppearance,
  ScoresheetPlayerRow
} from '../types'

export interface PlateAppearanceMutationPayload {
  lineupPlayerId: number
  pitcherLineupPlayerId?: number | null
  sportTypeId?: number | null
  inningNumber: number
  inningHalf?: 'top' | 'bottom' | null
  battingSequenceNo?: number | null
  plateAppearanceNoForPlayer?: number | null
  outsBefore?: number | null
  outsAfter?: number | null
  resultCode: string
  resultDetail?: string | null
  batterEndBase?: '1B' | '2B' | '3B' | 'HP' | null
  rbi?: number
  whichOut?: number | null
  pitchType?: string | null
  countsAsAtBat?: boolean
  countsAsPlateAppearance?: boolean
  isOnBase?: boolean
  runScored?: boolean
  isEarnedRun?: boolean | null
  sourceType?: 'manual' | 'scoresheet_upload' | 'ball_by_ball' | 'corrected'
}

export interface PlateAppearanceMutationResult {
  appearance: ScoresheetPlateAppearance & {
    gameLineupPlayerId: number
    inningNumber: number
  }
  playerStats: {
    gameLineupPlayerId: number
    atBats: number
    runs: number
    hits: number
    rbi: number
    stolenBases: number
    walks: number
    strikeouts: number
  }
}

interface RawPlateAppearanceMutationResponse {
  appearance: {
    id: string | number
    game_lineup_player_id?: number
    pitcher_lineup_player_id?: number | null
    inning_number?: number
    inning_half?: 'top' | 'bottom' | null
    batting_sequence_no?: number | null
    plate_appearance_no_for_player?: number | null
    outs_before?: number | null
    outs_after?: number | null
    result_code: string
    result_detail?: string | null
    counts_as_at_bat?: boolean | number
    counts_as_plate_appearance?: boolean | number
    is_on_base?: boolean | number
    batter_end_base?: '1B' | '2B' | '3B' | 'HP' | null
    rbi?: number
    pitch_type?: string | null
    which_out?: number | null
    run_scored?: boolean | number
    is_earned_run?: boolean | null
    source_type?: 'manual' | 'scoresheet_upload' | 'ball_by_ball' | 'corrected'
  }
  player_stats?: {
    game_lineup_player_id: number
    sport_type_id?: number
    at_bats: number
    runs: number
    hits: number
    rbi: number
    stolen_bases?: number
    walks: number
    strikeouts: number
  }
  playerStats?: PlateAppearanceMutationResult['playerStats']
}

interface RawDeletePlateAppearanceResponse {
  deleted_id?: string | number
  deletedId?: string | number
  game_lineup_player_id?: number
  gameLineupPlayerId?: number
  player_stats?: {
    game_lineup_player_id: number
    sport_type_id?: number
    at_bats: number
    runs: number
    hits: number
    rbi: number
    stolen_bases?: number
    walks: number
    strikeouts: number
  }
  playerStats?: {
    gameLineupPlayerId: number
    atBats: number
    runs: number
    hits: number
    rbi: number
    stolenBases: number
    walks: number
    strikeouts: number
  }
}

function toApiFlag(value: boolean | number | null | undefined, fallback: 0 | 1) {
  if (typeof value === 'number') return value ? 1 : 0
  if (typeof value === 'boolean') return value ? 1 : 0
  return fallback
}

function buildPlateAppearancePayload(payload: PlateAppearanceMutationPayload) {
  return {
    game_lineup_player_id: payload.lineupPlayerId,
    pitcher_lineup_player_id: payload.pitcherLineupPlayerId ?? null,
    sport_type_id: payload.sportTypeId ?? 1,
    inning_number: payload.inningNumber,
    inning_half: payload.inningHalf ?? null,
    batting_sequence_no: payload.battingSequenceNo ?? null,
    plate_appearance_no_for_player: payload.plateAppearanceNoForPlayer ?? 1,
    outs_before: payload.outsBefore ?? null,
    outs_after: payload.outsAfter ?? null,
    result_code: payload.resultCode,
    result_detail: payload.resultDetail ?? null,
    counts_as_at_bat: toApiFlag(payload.countsAsAtBat, 1),
    counts_as_plate_appearance: toApiFlag(payload.countsAsPlateAppearance, 1),
    is_on_base: toApiFlag(payload.isOnBase, 0),
    rbi: payload.rbi ?? 0,
    which_out: payload.whichOut ?? null,
    pitch_type: payload.pitchType ?? null,
    run_scored: toApiFlag(payload.runScored, payload.batterEndBase === 'HP' ? 1 : 0),
    is_earned_run: payload.isEarnedRun ?? null,
    batter_end_base: payload.batterEndBase ?? null,
    source_type: payload.sourceType ?? 'manual'
  }
}

type ApiEnvelope<T> = {
  data?: T | null
}

function unwrapApiEnvelope<T>(response: T | ApiEnvelope<T>): T {
  if (response && typeof response === 'object' && 'data' in response && response.data) {
    return response.data as T
  }

  return response as T
}

function adaptScoresheetResponse(response: ScoresheetDetail | ApiScoresheetResponse) {
  if ('gameId' in response && 'players' in response) return response
  return adaptScoresheetDetail(response as ApiScoresheetResponse)
}

function adaptPlayerStats(
  stats:
    | RawPlateAppearanceMutationResponse['player_stats']
    | RawDeletePlateAppearanceResponse['player_stats']
    | PlateAppearanceMutationResult['playerStats']
    | undefined,
  fallbackLineupPlayerId: number
): PlateAppearanceMutationResult['playerStats'] {
  if (!stats) {
    return {
      gameLineupPlayerId: fallbackLineupPlayerId,
      atBats: 0,
      runs: 0,
      hits: 0,
      rbi: 0,
      stolenBases: 0,
      walks: 0,
      strikeouts: 0
    }
  }

  if ('gameLineupPlayerId' in stats) return stats

  return {
    gameLineupPlayerId: stats.game_lineup_player_id,
    atBats: stats.at_bats,
    runs: stats.runs,
    hits: stats.hits,
    rbi: stats.rbi,
    stolenBases: stats.stolen_bases ?? 0,
    walks: stats.walks,
    strikeouts: stats.strikeouts
  }
}

function adaptPlateAppearanceMutationResult(
  response: RawPlateAppearanceMutationResponse,
  fallback: { lineupPlayerId: number; inningNumber: number }
): PlateAppearanceMutationResult {
  return {
    appearance: {
      id: String(response.appearance.id),
      sequence: 0,
      result: response.appearance.result_code,
      batterEndBase: response.appearance.batter_end_base ?? null,
      contactType: response.appearance.pitch_type ?? '',
      rbi: response.appearance.rbi ?? 0,
      outsOnPlay: response.appearance.which_out ?? 0,
      baserunning: '',
      fieldZone: '',
      fieldersInvolved: '',
      notes: response.appearance.result_detail ?? '',
      gameLineupPlayerId: response.appearance.game_lineup_player_id ?? fallback.lineupPlayerId,
      inningNumber: response.appearance.inning_number ?? fallback.inningNumber
    },
    playerStats: adaptPlayerStats(response.player_stats ?? response.playerStats, fallback.lineupPlayerId)
  }
}

function cloneAppearance(appearance: ScoresheetPlateAppearance, lineupPlayerId: number, inningNumber: number) {
  return {
    ...structuredClone(appearance),
    gameLineupPlayerId: lineupPlayerId,
    inningNumber
  }
}

function isHit(code: string) {
  return ['1B', '2B', '3B', 'HR', 'GRH'].includes(code)
}

function isWalk(code: string) {
  return ['BB', 'IBB'].includes(code)
}

function isStrikeout(code: string) {
  return ['K', 'KC'].includes(code)
}

function countsAsAtBat(code: string) {
  return !!code && !['BB', 'IBB', 'SAC', 'SF', 'HBP', 'CI'].includes(code)
}

function recalcPlayerStats(player: ScoresheetPlayerRow) {
  const appearances = player.cells.flatMap((cell) => cell.appearances)
  return {
    gameLineupPlayerId: player.gameLineupPlayerId ?? Number.NaN,
    atBats: appearances.filter((appearance) => countsAsAtBat(appearance.result)).length,
    runs: player.runs,
    hits: appearances.filter((appearance) => isHit(appearance.result)).length,
    rbi: appearances.reduce((sum, appearance) => sum + (appearance.rbi ?? 0), 0),
    stolenBases: appearances.filter((appearance) => appearance.result === 'SB').length,
    walks: appearances.filter((appearance) => isWalk(appearance.result)).length,
    strikeouts: appearances.filter((appearance) => isStrikeout(appearance.result)).length
  }
}

function refreshPlayerTotals(player: ScoresheetPlayerRow) {
  const stats = recalcPlayerStats(player)
  player.hits = stats.hits
  player.rbi = stats.rbi
  return stats
}

function findPlayer(scoresheet: ScoresheetDetail, lineupPlayerId: number) {
  return scoresheet.players.find((player) => player.gameLineupPlayerId === lineupPlayerId) ?? null
}

export async function fetchScoresheet(
  eventId: string,
  teamId: string,
  tournamentGameId: string,
  gameGuid?: string
): Promise<ScoresheetDetail> {
  try {
    const rawResponse = unwrapApiEnvelope(
      await getJson<ScoresheetDetail | ApiScoresheetResponse | ApiEnvelope<ScoresheetDetail | ApiScoresheetResponse>>(
        `/tournaments/scoresheet/${encodeURIComponent(tournamentGameId)}?team_id=${encodeURIComponent(teamId)}`
      )
    )
    let response = adaptScoresheetResponse(rawResponse)
    if (gameGuid) {
      try {
        const game = await fetchTournamentGameScores(gameGuid)
        if (game) {
          response = mergeTournamentGameScoresIntoScoresheet(response, game, teamId)
        }
      } catch {
        // Keep the scoresheet shell available even if the legacy score API fails.
      }
    }
    return response
  } catch (error) {
    // Previously this catch was silent (`catch {}`) which hid adapter throws
    // as a misleading "Game lineup required" banner in the UI. Surface the
    // real error so future regressions are visible instead of disguised.
    // eslint-disable-next-line no-console
    console.error('[fetchScoresheet] failed — falling back to mock state', error)
    let scoresheet = getScoresheetState()
    if (gameGuid) {
      try {
        const game = await fetchTournamentGameScores(gameGuid)
        if (game) {
          scoresheet = mergeTournamentGameScoresIntoScoresheet(scoresheet, game, teamId)
        }
      } catch {
        // Fall back to the mock scoresheet if the score API is unavailable.
      }
    }
    return {
      ...scoresheet,
      gameLineupSubmission: null,
      gameLineupSubmitted: false,
      lineupOptions: [],
      players: []
    }
  }
}

export async function fetchScoresheetShell(
  teamId: string,
  gameGuid?: string
): Promise<ScoresheetDetail | null> {
  if (!gameGuid) return null

  try {
    const game = await fetchTournamentGameScores(gameGuid)
    if (!game) return null

    return mergeTournamentGameScoresIntoScoresheet(getScoresheetState(), game, teamId)
  } catch {
    return null
  }
}

export async function uploadScoresheetImage(tournamentGameId: string, teamId: string, file: File) {
  try {
    const response = await uploadFile<ScoresheetDetail | ApiScoresheetResponse>(
      `/scoresheet/${encodeURIComponent(tournamentGameId)}/upload?team_id=${encodeURIComponent(teamId)}`,
      file
    )
    return adaptScoresheetResponse(response)
  } catch {
    const next = getScoresheetState()
    next.uploadStatus = 'review'
    next.sourceImageName = file.name
    next.notes = 'New handwritten sheet uploaded. Review extracted mappings and play details before publish.'
    setScoresheetState(next)
    return next
  }
}

export async function submitScoresheetForPublish(tournamentGameId: string, teamId: string) {
  try {
    const response = await postJson<ScoresheetDetail | ApiScoresheetResponse>(
      `/scoresheet/${encodeURIComponent(tournamentGameId)}/publish?team_id=${encodeURIComponent(teamId)}`,
      {}
    )
    return adaptScoresheetResponse(response)
  } catch {
    const next = getScoresheetState()
    next.uploadStatus = 'published'
    setScoresheetState(next)
    return next
  }
}

export async function createPlateAppearance(
  tournamentGameId: string,
  teamId: string,
  payload: PlateAppearanceMutationPayload
): Promise<PlateAppearanceMutationResult> {
  try {
    const rawResponse = await postJson<RawPlateAppearanceMutationResponse | ApiEnvelope<RawPlateAppearanceMutationResponse>>(
      `/tournaments/scoresheet/${encodeURIComponent(tournamentGameId)}/plate-appearances?team_id=${encodeURIComponent(teamId)}`,
      buildPlateAppearancePayload(payload)
    )
    const response = unwrapApiEnvelope(rawResponse)
    return adaptPlateAppearanceMutationResult(response, {
      lineupPlayerId: payload.lineupPlayerId,
      inningNumber: payload.inningNumber
    })
  } catch {
    const scoresheet = getScoresheetState()
    const player = findPlayer(scoresheet, payload.lineupPlayerId)
    if (!player) throw new Error('Unable to find player for plate appearance create')

    let cell = player.cells.find((entry) => entry.inning === payload.inningNumber)
    if (!cell) {
      cell = { inning: payload.inningNumber, appearances: [], reviewState: 'review' }
      player.cells.push(cell)
      player.cells.sort((left, right) => left.inning - right.inning)
    }

    const appearance: ScoresheetPlateAppearance = {
      id: `p${payload.lineupPlayerId}-i${payload.inningNumber}-a${cell.appearances.length + 1}`,
      sequence: cell.appearances.length + 1,
      result: payload.resultCode,
      batterEndBase: payload.batterEndBase ?? null,
      contactType: payload.pitchType ?? '',
      rbi: payload.rbi ?? 0,
      outsOnPlay: payload.whichOut ?? 0,
      baserunning: '',
      fieldZone: '',
      fieldersInvolved: '',
      notes: payload.resultDetail ?? ''
    }

    cell.appearances.push(appearance)
    cell.reviewState = 'review'
    const playerStats = refreshPlayerTotals(player)
    setScoresheetState(scoresheet)

    return {
      appearance: cloneAppearance(appearance, payload.lineupPlayerId, payload.inningNumber),
      playerStats
    }
  }
}

export async function updatePlateAppearance(
  tournamentGameId: string,
  teamId: string,
  appearanceId: string,
  payload: PlateAppearanceMutationPayload
): Promise<PlateAppearanceMutationResult> {
  try {
    const rawResponse = await patchJson<RawPlateAppearanceMutationResponse | ApiEnvelope<RawPlateAppearanceMutationResponse>>(
      `/tournaments/scoresheet/${encodeURIComponent(tournamentGameId)}/plate-appearances/${encodeURIComponent(appearanceId)}?team_id=${encodeURIComponent(teamId)}`,
      buildPlateAppearancePayload(payload)
    )
    const response = unwrapApiEnvelope(rawResponse)
    return adaptPlateAppearanceMutationResult(response, {
      lineupPlayerId: payload.lineupPlayerId,
      inningNumber: payload.inningNumber
    })
  } catch {
    const scoresheet = getScoresheetState()
    const player = findPlayer(scoresheet, payload.lineupPlayerId)
    if (!player) throw new Error('Unable to find player for plate appearance update')

    const cell = player.cells.find((entry) => entry.inning === payload.inningNumber)
    const appearance = cell?.appearances.find((entry) => entry.id === appearanceId)
    if (!cell || !appearance) throw new Error('Unable to find plate appearance to update')

    appearance.result = payload.resultCode
    appearance.batterEndBase = payload.batterEndBase ?? null
    appearance.contactType = payload.pitchType ?? ''
    appearance.rbi = payload.rbi ?? 0
    appearance.outsOnPlay = payload.whichOut ?? 0
    appearance.notes = payload.resultDetail ?? ''
    cell.reviewState = 'review'

    const playerStats = refreshPlayerTotals(player)
    setScoresheetState(scoresheet)

    return {
      appearance: cloneAppearance(appearance, payload.lineupPlayerId, payload.inningNumber),
      playerStats
    }
  }
}

export async function deletePlateAppearance(tournamentGameId: string, teamId: string, appearanceId: string) {
  try {
    const rawResponse = await deleteJson<RawDeletePlateAppearanceResponse | ApiEnvelope<RawDeletePlateAppearanceResponse>>(
      `/tournaments/scoresheet/${encodeURIComponent(tournamentGameId)}/plate-appearances/${encodeURIComponent(appearanceId)}?team_id=${encodeURIComponent(teamId)}`
    )
    const response = unwrapApiEnvelope(rawResponse)
    const playerStats = adaptPlayerStats(
      response.player_stats ?? response.playerStats,
      response.game_lineup_player_id ?? response.gameLineupPlayerId ?? Number.NaN
    )
    return {
      deletedId: String(response.deleted_id ?? response.deletedId ?? appearanceId),
      gameLineupPlayerId:
        response.game_lineup_player_id ?? response.gameLineupPlayerId ?? playerStats.gameLineupPlayerId,
      playerStats
    }
  } catch {
    const scoresheet = getScoresheetState()
    for (const player of scoresheet.players) {
      for (const cell of player.cells) {
        const index = cell.appearances.findIndex((appearance) => appearance.id === appearanceId)
        if (index >= 0) {
          cell.appearances.splice(index, 1)
          cell.appearances.forEach((appearance, sequence) => {
            appearance.sequence = sequence + 1
          })
          cell.reviewState = cell.appearances.length ? 'review' : 'empty'
          const playerStats = refreshPlayerTotals(player)
          setScoresheetState(scoresheet)
          return {
            deletedId: appearanceId,
            gameLineupPlayerId: player.gameLineupPlayerId ?? Number.NaN,
            playerStats
          }
        }
      }
    }
    throw new Error('Unable to find plate appearance to delete')
  }
}

export function mergeGameLineupIntoScoresheet(
  scoresheet: ScoresheetDetail,
  submission: GameLineupSubmission | null
): ScoresheetDetail {
  return {
    ...scoresheet,
    gameLineupSubmission: submission,
    gameLineupSubmitted: !!submission
  }
}
