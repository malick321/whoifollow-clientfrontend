import { postLegacyFormData } from './client'
import { buildTeamAvatarUrl } from './config'
import type { GameSummary } from '../types'

type LegacyTournamentGameEnvelope = {
  data?: LegacyTournamentGameRecord[] | null
  all_pools_completed?: boolean | null
  pools_status?: Array<{ pool_id: number; pool_name: string; is_completed: boolean }> | null
}

type LegacyTournamentGameRecord = {
  id: number | string
  guid?: string | null
  event_id?: number | string | null
  tournament_id?: number | string | null
  game_name?: string | null
  game_type?: number | string | null
  round_number?: number | string | null
  bracket_type?: string | null
  team_1_id?: number | string | null
  team_2_id?: number | string | null
  winner_id?: number | string | null
  loser_id?: number | string | null
  team_1_score?: number | string | null
  team_2_score?: number | string | null
  team1Runs?: number | null
  team2Runs?: number | null
  start_date?: string | null
  start_time?: string | null
  actual_start_time?: string | null
  time_limit?: number | string | null
  status?: number | string | null
  game_live?: number | boolean | null
  game_delayed?: number | boolean | null
  delayed_reason?: string | null
  notScheduled?: number | boolean | null
  filtered_team_id?: number | string | null
  filtered_team_side?: 'team_1' | 'team_2' | null
  lineup_submitted?: boolean | null
  player_stats_available?: boolean | null
  team_1_lineup_submitted?: boolean | null
  team_2_lineup_submitted?: boolean | null
  team_1_player_stats_available?: boolean | null
  team_2_player_stats_available?: boolean | null
  field?: { field_name?: string | null; name?: string | null } | null
  park?: { park_name?: string | null; name?: string | null } | null
  bracket?: { bracket_name?: string | null; guid?: string | null } | null
  tournament?: { tournamentName?: string | null } | null
  team_one?: LegacyTournamentSide | null
  team_two?: LegacyTournamentSide | null
  game_scores?: LegacyTournamentGameScore[] | null
}

type LegacyTournamentSide = {
  team_sr_no?: number | string | null
  team_id?: number | string | null
  win_count?: number | null
  loss_count?: number | null
  seed_count?: number | null
  pool_id?: number | string | null
  /** Canonical source of team name + avatar on the game record. Present for
   *  every game regardless of status, so it works for scheduled games where
   *  `game_scores` is still empty (those used to fall back to "TBD" before
   *  this field was wired through). Mirrors the shape in
   *  `src/api/tournamentGameScores.ts` → LegacyTournamentGameSide. */
  team_data?: {
    team_name?: string | null
    team_avatar?: string | null
  } | null
}

type LegacyTournamentGameScore = {
  team_id?: number | string | null
  team_type?: number | string | null
  team_flag?: number | null
  team?: {
    team_name?: string | null
    team_avatar?: string | null
  } | null
  game_innings?: Array<{
    inning_no?: number | null
    score?: number | null
    inning_type?: number | null
    inning_status?: number | null
    end_status?: number | null
  }> | null
}

function toNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeStatus(game: LegacyTournamentGameRecord): GameSummary['status'] {
  if (game.game_live === 1 || game.game_live === true) return 'live'

  const hasFinalScore = game.team_1_score != null && game.team_2_score != null
  if (hasFinalScore || game.winner_id != null || game.loser_id != null) return 'final'

  return 'scheduled'
}

function buildStatusNote(game: LegacyTournamentGameRecord) {
  if (game.game_delayed === 1 || game.game_delayed === true) {
    const reason = game.delayed_reason?.trim()
    return reason ? `Delayed - ${reason}` : 'Delayed'
  }

  if (game.notScheduled === 1 || game.notScheduled === true) {
    return 'Match yet to begin'
  }

  return undefined
}

function formatDateLabel(dateValue?: string | null) {
  if (!dateValue) return undefined

  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(dateValue))
}

function formatTimeLabel(timeValue?: string | null) {
  if (!timeValue) return undefined

  return timeValue
}

function buildGameTime(game: LegacyTournamentGameRecord) {
  const dateLabel = formatDateLabel(game.start_date)
  const timeLabel = formatTimeLabel(game.start_time)

  return [dateLabel, timeLabel].filter(Boolean).join(', ')
}

function buildTeamSeed(side?: LegacyTournamentSide | null) {
  if (side?.team_sr_no == null) return undefined
  return `#${side.team_sr_no}`
}

/** Resolve team name from game_scores nested team object */
function resolveTeamName(game: LegacyTournamentGameRecord, teamId: number | string | null | undefined): string {
  if (teamId == null) return 'TBD'
  const numericId = toNumber(teamId)
  const entry = (game.game_scores ?? []).find((s) => toNumber(s.team_id) === numericId)
  return entry?.team?.team_name ?? 'TBD'
}

/** Resolve team avatar from game_scores nested team object */
function resolveTeamAvatar(game: LegacyTournamentGameRecord, teamId: number | string | null | undefined): string | undefined {
  if (teamId == null) return undefined
  const numericId = toNumber(teamId)
  const entry = (game.game_scores ?? []).find((s) => toNumber(s.team_id) === numericId)
  return buildTeamAvatarUrl(entry?.team?.team_avatar)
}

/** Team name for a side.
 *
 *  PRIMARY source: `team_one.team_data.team_name` / `team_two.team_data.team_name`.
 *  These are present on every response — including scheduled games where
 *  `game_scores` hasn't been populated yet. Using this as the primary source
 *  is what fixes the long-standing "TBD" display on unstarted games.
 *
 *  FALLBACK: the legacy `game_scores[*].team.team_name` lookup, so older
 *  responses that don't yet send `team_data` still render correctly.
 *
 *  Final fallback: 'TBD' (only hit when both sources are missing).
 */
function resolveSideTeamName(
  side: LegacyTournamentSide | null | undefined,
  game: LegacyTournamentGameRecord,
  teamId: number | string | null | undefined
): string {
  const fromSide = side?.team_data?.team_name?.trim()
  if (fromSide) return fromSide
  return resolveTeamName(game, teamId)
}

/** Team avatar URL for a side. Same primary/fallback pattern as
 *  resolveSideTeamName: `team_data.team_avatar` first, `game_scores` second. */
function resolveSideTeamAvatar(
  side: LegacyTournamentSide | null | undefined,
  game: LegacyTournamentGameRecord,
  teamId: number | string | null | undefined
): string | undefined {
  const fromSide = side?.team_data?.team_avatar?.trim()
  if (fromSide) return buildTeamAvatarUrl(fromSide)
  return resolveTeamAvatar(game, teamId)
}

function buildSideFromTeamType(value: unknown): 'H' | 'V' | undefined {
  const teamType = toNumber(value)
  if (teamType === 1) return 'V'
  if (teamType === 2) return 'H'
  return undefined
}

/**
 * Determines H/V side for the viewing team and their opponent.
 * team_type in game_scores: 1 = Visitor, 2 = Home.
 * Home always displays at bottom; Visitor at top.
 */
function buildGameSides(game: LegacyTournamentGameRecord, numericTeamId: number | null) {
  const currentScore = (game.game_scores ?? []).find((entry) => toNumber(entry.team_id) === numericTeamId)
  const opponentScore = (game.game_scores ?? []).find((entry) => toNumber(entry.team_id) !== numericTeamId)

  const teamSide = buildSideFromTeamType(currentScore?.team_type)
  const opponentSide = buildSideFromTeamType(opponentScore?.team_type)

  if (teamSide && opponentSide) {
    return { teamSide, opponentSide }
  }

  return { teamSide: undefined, opponentSide: undefined }
}

function buildBracketTypeLabel(value: LegacyTournamentGameRecord['bracket_type']) {
  if (value == null) return undefined

  const normalized = String(value).trim().toLowerCase()

  if (normalized === 'winner') return 'Winner'
  if (normalized === 'loser') return 'Elimination'
  if (normalized === 'grand_final' || normalized === '998') return 'Grand Final'
  if (normalized === '999') return 'Grand Final If Necessary'

  return undefined
}

function buildBracketLabel(game: LegacyTournamentGameRecord) {
  const gameType = toNumber(game.game_type)
  const roundNumber = toNumber(game.round_number)
  const bracketName = game.bracket?.bracket_name?.trim() || ''

  const gameName =
    gameType === 2 && roundNumber === 998
      ? 'Championship'
      : gameType === 2 && roundNumber === 999
        ? 'Championship IF'
        : game.game_name?.trim() || 'Game'

  if (gameType !== 2) return gameName

  if (roundNumber === 998 || roundNumber === 999) {
    return bracketName ? `${gameName} - ${bracketName}` : gameName
  }

  const bracketType = buildBracketTypeLabel(game.bracket_type)
  const segments = [gameName]

  if (bracketType) {
    segments.push(roundNumber != null ? `${bracketType} Round ${roundNumber}` : bracketType)
  } else if (roundNumber != null) {
    segments.push(`Round ${roundNumber}`)
  }

  if (bracketName) {
    segments.push(bracketName)
  }

  return segments.join(' - ')
}

function adaptTournamentGame(game: LegacyTournamentGameRecord, teamId: string): GameSummary {
  // Use server-provided filtered_team_side when available; fall back to ID comparison
  const isTeamOne = game.filtered_team_side
    ? game.filtered_team_side === 'team_1'
    : toNumber(teamId) != null && toNumber(game.team_1_id) === toNumber(teamId)

  const myTeamId = isTeamOne ? game.team_1_id : game.team_2_id
  const opponentTeamId = isTeamOne ? game.team_2_id : game.team_1_id
  const teamTournamentSide = isTeamOne ? game.team_one : game.team_two
  const opponentTournamentSide = isTeamOne ? game.team_two : game.team_one

  // Use pre-computed run totals where available; fall back to score strings
  const scoreFor = isTeamOne
    ? (game.team1Runs ?? toNumber(game.team_1_score) ?? undefined)
    : (game.team2Runs ?? toNumber(game.team_2_score) ?? undefined)
  const scoreAgainst = isTeamOne
    ? (game.team2Runs ?? toNumber(game.team_2_score) ?? undefined)
    : (game.team1Runs ?? toNumber(game.team_1_score) ?? undefined)

  const numericTeamId = toNumber(myTeamId)
  const gameSides = buildGameSides(game, numericTeamId)

  const winnerId = toNumber(game.winner_id)
  const loserId = toNumber(game.loser_id)
  const hasWinnerMapping = numericTeamId != null && (winnerId != null || loserId != null)
  const teamWon = hasWinnerMapping
    ? winnerId != null
      ? winnerId === numericTeamId
      : loserId != null
        ? loserId !== numericTeamId
        : undefined
    : scoreFor != null && scoreAgainst != null && scoreFor !== scoreAgainst
      ? scoreFor > scoreAgainst
      : undefined
  const opponentWon = hasWinnerMapping
    ? winnerId != null
      ? winnerId !== numericTeamId
      : loserId != null
        ? loserId === numericTeamId
        : undefined
    : scoreFor != null && scoreAgainst != null && scoreFor !== scoreAgainst
      ? scoreFor < scoreAgainst
      : undefined

  return {
    id: String(game.id),
    guid: game.guid ?? undefined,
    bracketLabel: buildBracketLabel(game),
    gameTime: buildGameTime(game),
    dateLabel: formatDateLabel(game.start_date),
    timeLabel: formatTimeLabel(game.start_time),
    actualStartTime: formatTimeLabel(game.actual_start_time),
    timeLimit: game.time_limit ?? undefined,
    field: game.field?.field_name ?? game.field?.name ?? '',
    facilityLabel: game.park?.park_name ?? game.park?.name ?? undefined,
    divisionLabel: game.tournament?.tournamentName ?? undefined,
    // Team name + avatar come from team_one.team_data / team_two.team_data
    // (always populated) rather than from game_scores (only populated after
    // the game has scores). This is what makes scheduled games show real
    // team names instead of "TBD". See resolveSideTeamName for the exact
    // primary/fallback order.
    opponent: resolveSideTeamName(opponentTournamentSide, game, opponentTeamId),
    opponentImageUrl: resolveSideTeamAvatar(opponentTournamentSide, game, opponentTeamId),
    teamImageUrl: resolveSideTeamAvatar(teamTournamentSide, game, myTeamId),
    opponentSeed: buildTeamSeed(opponentTournamentSide),
    teamSeed: buildTeamSeed(teamTournamentSide),
    opponentSide: gameSides.opponentSide,
    teamSide: gameSides.teamSide,
    scoreFor,
    scoreAgainst,
    teamWon,
    opponentWon,
    status: normalizeStatus(game),
    statusNote: buildStatusNote(game),
    // Lineup + scoresheet status are carried per-side on the response
    // (team_1_* vs team_2_*). Pick the flag that matches the viewing team;
    // fall back to the legacy top-level flags for safety.
    lineupSubmitted:
      (isTeamOne ? game.team_1_lineup_submitted : game.team_2_lineup_submitted) ??
      game.lineup_submitted ??
      false,
    scoresheetStatus:
      ((isTeamOne ? game.team_1_player_stats_available : game.team_2_player_stats_available) ??
        game.player_stats_available)
        ? 'published'
        : 'idle'
  }
}

export async function fetchTournamentGames(tournamentGuid: string, teamId: string): Promise<GameSummary[]> {
  const response = await postLegacyFormData<LegacyTournamentGameEnvelope>(
    '/tournaments/getTournamentGames',
    {
      tournament_guid: tournamentGuid,
      team_id: teamId
    }
  )

  const games = Array.isArray(response?.data) ? response.data : []

  return games.map((game) => adaptTournamentGame(game, teamId))
}
