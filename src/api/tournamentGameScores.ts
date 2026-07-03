import { postLegacyFormData } from './client'
import { buildTeamAvatarUrl } from './config'
import type { ScoresheetDetail } from '../types'

type LegacyTournamentGameScoresEnvelope = {
  data?: {
    game?: LegacyTournamentGameScoresRecord | null
  } | null
}

type LegacyTournamentGameScoresRecord = {
  id: number | string
  guid?: string | null
  event_id?: number | string | null
  tournament_id?: number | string | null
  game_name?: string | null
  team_1_id?: number | string | null
  team_2_id?: number | string | null
  team1Runs?: number | string | null
  team2Runs?: number | string | null
  start_date?: string | null
  start_time?: string | null
  time_limit?: string | number | null
  actual_start_time?: string | null
  status?: number | string | null
  game_live?: number | boolean | null
  game_delayed?: number | boolean | null
  delayed_reason?: string | null
  game_overed?: number | boolean | null
  field?: {
    field_name?: string | null
  } | null
  park?: {
    park_name?: string | null
    city?: string | null
    state?: string | null
  } | null
  event?: {
    eventName?: string | null
    city?: string | null
    state?: string | null
  } | null
  team_one?: LegacyTournamentGameSide | null
  team_two?: LegacyTournamentGameSide | null
  game_scores?: LegacyTournamentGameScore[] | null
  tournament?: {
    tournamentName?: string | null
    pool_play_time?: string | number | null
    bracket_time?: string | number | null
    championship_time?: string | number | null
  } | null
}

type LegacyTournamentGameSide = {
  team_sr_no?: number | string | null
  team_id?: number | string | null
  team_data?: {
    team_name?: string | null
    team_avatar?: string | null
  } | null
}

type LegacyTournamentGameScore = {
  team_id?: number | string | null
  team_type?: number | string | null
  team_flag?: number | string | null
  batting_flag?: number | string | null
  teams?: {
    team_sr_no?: number | string | null
  } | null
  game_innings?: Array<{
    inning_no?: number | string | null
    inning_type?: number | string | null
    score?: number | string | null
  }> | null
}

function toNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toBooleanFlag(value: unknown) {
  if (typeof value === 'boolean') return value
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed > 0 : false
}

function buildGameStatus(statusValue: unknown) {
  const statusCode = toNumber(statusValue)
  if (statusCode === 0) {
    return { code: 0, label: 'Yet to begin' }
  }
  if (statusCode === 1) {
    return { code: 1, label: 'Live' }
  }
  if (statusCode === 2) {
    return { code: 2, label: 'Final' }
  }

  return { code: undefined, label: undefined }
}

function formatDateLabel(dateValue?: string | null) {
  if (!dateValue) return ''

  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(dateValue))
}

function buildGameTime(game: LegacyTournamentGameScoresRecord) {
  const dateLabel = formatDateLabel(game.start_date)
  const timeLabel = game.start_time?.trim() ?? ''
  return [timeLabel, dateLabel].filter(Boolean).join(' - ')
}

function buildSeed(side?: LegacyTournamentGameSide | null) {
  return side?.team_sr_no != null ? `#${side.team_sr_no}` : undefined
}

function buildLineScores(score?: LegacyTournamentGameScore | null) {
  const inningsByNumber = new Map<number, Array<{ inningType: number | null; score: number }>>()

  for (const inning of score?.game_innings ?? []) {
    const inningNo = toNumber(inning.inning_no)
    if (inningNo == null) continue

    if (!inningsByNumber.has(inningNo)) inningsByNumber.set(inningNo, [])
    inningsByNumber.get(inningNo)!.push({
      inningType: toNumber(inning.inning_type),
      score: toNumber(inning.score) ?? 0
    })
  }

  return Array.from(inningsByNumber.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([, entries]) => {
      const preferred = entries.find((entry) => entry.inningType === 2)
      if (preferred) return preferred.score

      const nonZero = entries.find((entry) => entry.score > 0)
      if (nonZero) return nonZero.score

      return entries[0]?.score ?? 0
    })
}

function buildHomeRuns(score?: LegacyTournamentGameScore | null) {
  return (score?.game_innings ?? []).reduce<number>((sum, inning) => {
    const inningType = toNumber(inning.inning_type)
    if (inningType !== 1) return sum
    return sum + (toNumber(inning.score) ?? 0)
  }, 0)
}

function findScoreRecord(
  game: LegacyTournamentGameScoresRecord,
  teamId: number | null
) {
  if (teamId == null) return null
  return (game.game_scores ?? []).find((entry) => toNumber(entry.team_id) === teamId) ?? null
}

function buildSideLabel(
  score: LegacyTournamentGameScore | null,
  fallback: 'H' | 'V'
): 'H' | 'V' {
  const teamType = toNumber(score?.team_type)
  if (teamType === 1) return 'V'
  if (teamType === 2) return 'H'
  return fallback
}

function isCurrentlyBatting(score: LegacyTournamentGameScore | null) {
  return toNumber(score?.batting_flag) === 1
}

function buildDelayState(game: LegacyTournamentGameScoresRecord) {
  const delayed = toBooleanFlag(game.game_delayed)
  return {
    isDelayed: delayed,
    delayReason: delayed ? game.delayed_reason?.trim() ?? '' : ''
  }
}

function buildCurrentInning(game: LegacyTournamentGameScoresRecord) {
  const inningNumbers = (game.game_scores ?? [])
    .flatMap((entry) => entry.game_innings ?? [])
    .map((inning) => toNumber(inning.inning_no))
    .filter((inningNo): inningNo is number => inningNo != null)

  if (!inningNumbers.length) return null
  return Math.max(...inningNumbers)
}

export async function fetchTournamentGameScores(gameGuid: string) {
  const response = await postLegacyFormData<LegacyTournamentGameScoresEnvelope>(
    '/tournaments/game/getScores',
    {
      tournament_game_guid: gameGuid
    }
  )

  return response.data?.game ?? null
}

export function mergeTournamentGameScoresIntoScoresheet(
  scoresheet: ScoresheetDetail,
  game: LegacyTournamentGameScoresRecord,
  teamId: string
): ScoresheetDetail {
  const numericTeamId = toNumber(teamId)
  const teamOneId = toNumber(game.team_1_id)
  const teamTwoId = toNumber(game.team_2_id)
  const isTeamOne = numericTeamId != null && teamOneId === numericTeamId
  const isTeamTwo = numericTeamId != null && teamTwoId === numericTeamId
  const currentSide = isTeamOne ? game.team_one : game.team_two
  const opposingSide = isTeamOne ? game.team_two : game.team_one
  const fallbackTimeLimit =
    game.time_limit ??
    game.tournament?.pool_play_time ??
    game.tournament?.bracket_time ??
    game.tournament?.championship_time ??
    scoresheet.timeLimit

  const currentScoreRecord = findScoreRecord(game, isTeamOne ? teamOneId : isTeamTwo ? teamTwoId : numericTeamId)
  const opposingScoreRecord = findScoreRecord(
    game,
    isTeamOne ? teamTwoId : isTeamTwo ? teamOneId : null
  )

  const teamLineScores = buildLineScores(currentScoreRecord)
  const opponentLineScores = buildLineScores(opposingScoreRecord)
  const currentInning = buildCurrentInning(game)
  const currentRuns = isTeamOne ? toNumber(game.team1Runs) : isTeamTwo ? toNumber(game.team2Runs) : null
  const opposingRuns = isTeamOne ? toNumber(game.team2Runs) : isTeamTwo ? toNumber(game.team1Runs) : null
  const currentTeamSide = buildSideLabel(currentScoreRecord, isTeamOne ? 'V' : 'H')
  const opposingTeamSide = buildSideLabel(opposingScoreRecord, currentTeamSide === 'H' ? 'V' : 'H')
  const currentTeamBatting = isCurrentlyBatting(currentScoreRecord)
  const opposingTeamBatting = isCurrentlyBatting(opposingScoreRecord)
  const delayState = buildDelayState(game)
  const gameStatus = buildGameStatus(game.status)

  return {
    ...scoresheet,
    gameId: String(game.id),
    eventName: game.event?.eventName ?? scoresheet.eventName,
    teamName: currentSide?.team_data?.team_name ?? scoresheet.teamName,
    teamAvatarUrl: buildTeamAvatarUrl(currentSide?.team_data?.team_avatar) ?? scoresheet.teamAvatarUrl,
    opponent: opposingSide?.team_data?.team_name ?? scoresheet.opponent,
    opponentAvatarUrl: buildTeamAvatarUrl(opposingSide?.team_data?.team_avatar) ?? scoresheet.opponentAvatarUrl,
    teamSeed: buildSeed(currentSide) ?? scoresheet.teamSeed,
    opponentSeed: buildSeed(opposingSide) ?? scoresheet.opponentSeed,
    bracketLabel: game.game_name ?? scoresheet.bracketLabel,
    division: game.tournament?.tournamentName ?? scoresheet.division,
    gameTime: buildGameTime(game) || scoresheet.gameTime,
    actualStartTime: game.actual_start_time?.trim() || scoresheet.actualStartTime,
    timeLimit: fallbackTimeLimit,
    venueField: game.field?.field_name ?? scoresheet.venueField,
    venuePark: game.park?.park_name ?? scoresheet.venuePark,
    venueCity: game.park?.city ?? game.event?.city ?? scoresheet.venueCity,
    venueState: game.park?.state ?? game.event?.state ?? scoresheet.venueState,
    teamLineScores: teamLineScores.length ? teamLineScores : scoresheet.teamLineScores,
    opponentLineScores: opponentLineScores.length ? opponentLineScores : scoresheet.opponentLineScores,
    teamRunsTotal: currentRuns ?? scoresheet.teamRunsTotal,
    opponentRunsTotal: opposingRuns ?? scoresheet.opponentRunsTotal,
    teamHomeRuns: buildHomeRuns(currentScoreRecord),
    opponentHomeRuns: buildHomeRuns(opposingScoreRecord),
    currentInning: currentInning ?? scoresheet.currentInning,
    isLive: toBooleanFlag(game.game_live) || gameStatus.code === 1 || scoresheet.isLive,
    currentBattingTeamSide: currentTeamBatting ? currentTeamSide : opposingTeamBatting ? opposingTeamSide : undefined,
    gameStatusCode: gameStatus.code,
    gameStatusLabel: gameStatus.label,
    isDelayed: delayState.isDelayed,
    delayReason: delayState.delayReason || undefined,
    teamSide: currentTeamSide,
    opponentSide: opposingTeamSide
  }
}
