import type { GameLineupSubmission, ScoresheetDetail } from '../../types'

function approvalModeCode(mode: GameLineupSubmission['approvalMode']) {
  return mode === 'auto' ? 0 : 1
}

function playerSourceCode(source: GameLineupSubmission['players'][number]['playerSourceType']) {
  switch (source) {
    case 'team_member':
      return 1
    case 'invited_member':
      return 2
    case 'association_entered':
      return 3
    case 'uploaded_scoresheet':
      return 4
    default:
      return 0
  }
}

export function buildGameLineupSubmissionPayload(
  submission: GameLineupSubmission,
  context: {
    tournamentGameId: number
    teamId: number
    sportTypeId: number
  }
) {
  return {
    id: Number(submission.id) || null,
    tournament_game_id: context.tournamentGameId,
    tournament_game_score_id: null,
    team_id: context.teamId,
    sport_type_id: context.sportTypeId,
    ...(submission.id ? {} : { submission_status: 1 }),
    approval_mode: approvalModeCode(submission.approvalMode),
    source_type: submission.sourceType,
    submitted_at: submission.submittedAt ?? null,
    rejection_reason: submission.rejectionReason ?? null,
    notes: submission.notes ?? null,
    players: submission.players.map((player) => ({
      id: Number(player.id) || null,
      event_team_lineup_id: player.eventLineupId ? Number(player.eventLineupId) : null,
      team_member_id: player.teamMemberId ? Number(player.teamMemberId) : null,
      user_id: player.userId ? Number(player.userId) : null,
      player_name: player.playerName,
      jersey_number: player.jerseyNumber || null,
      player_source_type: playerSourceCode(player.playerSourceType),
      batting_order: player.battingOrder,
      position_code: player.positionCode,
      is_starter: player.isStarter,
      is_bench: player.isBench,
      is_substitute: player.isSubstitute,
      is_active: player.isActive,
      entered_inning: player.enteredInning ?? null,
      exited_inning: player.exitedInning ?? null,
      replaces_game_lineup_player_id: player.substitutesForId ? Number(player.substitutesForId) || null : null
    }))
  }
}

export function buildBattingAppearancePayload(scoresheet: ScoresheetDetail) {
  return scoresheet.players.flatMap((player) =>
    player.cells.flatMap((cell) =>
      cell.appearances.map((appearance, appearanceIndex) => ({
        id: appearance.id,
        game_lineup_player_local_id: player.id,
        batting_order: player.battingOrder,
        inning_number: cell.inning,
        plate_appearance_no_for_player: appearance.sequence || appearanceIndex + 1,
        result_code: appearance.result,
        result_detail: appearance.notes || null,
        batter_end_base: appearance.batterEndBase ?? null,
        rbi: appearance.rbi,
        run_scored: appearance.batterEndBase === 'HP',
        outs_on_play: appearance.outsOnPlay,
        contact_type: appearance.contactType || null,
        baserunning: appearance.baserunning || null,
        field_zone: appearance.fieldZone || null,
        fielders_involved: appearance.fieldersInvolved || null
      }))
    )
  )
}

function emptyResultCounts() {
  return {
    '1B': 0,
    '2B': 0,
    '3B': 0,
    'HR': 0,
    'GRH': 0,
    'K': 0,
    'KC': 0,
    'GO': 0,
    'FO': 0,
    'LO': 0,
    'PO': 0,
    'SF': 0,
    'GDP': 0,
    'LDP': 0,
    'FDP': 0,
    'TP': 0,
    'BB': 0,
    'IBB': 0,
    'HBP': 0,
    'E': 0,
    'FC': 0,
    'CI': 0,
    'OBI': 0,
    'OBR': 0,
    'OBS': 0,
    'IFR': 0,
    'SAC': 0,
    'SB': 0,
    'CS': 0,
    'PB': 0,
    'WP': 0
  }
}

function deriveStatsForPlayer(player: ScoresheetDetail['players'][number]) {
  const appearances = player.cells.flatMap((cell) => cell.appearances)
  const resultCounts = emptyResultCounts()

  let plateAppearances = 0
  let atBats = 0
  let runs = player.runs ?? 0
  let hits = 0
  let rbi = 0
  let walks = 0
  let strikeouts = 0
  let leftOnBase = 0

  for (const appearance of appearances) {
    const code = (appearance.result || '').toUpperCase()
    if (code in resultCounts) {
      resultCounts[code as keyof typeof resultCounts] += 1
    }

    if (code) plateAppearances += 1

    const isWalk = ['BB', 'IBB'].includes(code)
    const isSac = ['SAC', 'SF'].includes(code)
    const isHit = ['1B', '2B', '3B', 'HR', 'GRH'].includes(code)
    const isStrikeout = ['K', 'KC'].includes(code)
    const reachesBase = isHit || ['BB', 'IBB', 'HBP', 'E', 'FC', 'CI', 'OBI'].includes(code)
    const scoredRun = appearance.batterEndBase === 'HP'

    if (!isWalk && !isSac && code) atBats += 1
    if (isHit) hits += 1
    if (isWalk) walks += 1
    if (isStrikeout) strikeouts += 1
    if (scoredRun) runs += 1
    else if (reachesBase) leftOnBase += 1
    rbi += appearance.rbi ?? 0
  }

  return {
    plate_appearances: plateAppearances,
    at_bats: atBats,
    runs,
    hits,
    rbi,
    walks,
    strikeouts,
    left_on_base: leftOnBase,
    result_counts_json: resultCounts
  }
}

export function buildBattingStatsPayload(
  scoresheet: ScoresheetDetail,
  context: {
    tournamentGameId: number
    teamId: number
    sportTypeId: number
  }
) {
  return scoresheet.players.map((player) => {
    const derived = deriveStatsForPlayer(player)
    return {
      tournament_game_id: context.tournamentGameId,
      team_id: context.teamId,
      sport_type_id: context.sportTypeId,
      game_lineup_player_local_id: player.id,
      batting_order: player.battingOrder,
      ...derived,
      source_type: 'derived_from_pa',
      is_locked: false
    }
  })
}

export function buildScoresheetSavePayload(
  scoresheet: ScoresheetDetail,
  context: {
    tournamentGameId: number
    teamId: number
    sportTypeId: number
  }
) {
  return {
    game_id: scoresheet.gameId,
    current_inning: scoresheet.currentInning ?? null,
    is_live: scoresheet.isLive ?? false,
    lineup_submission_id: scoresheet.gameLineupSubmission?.id ?? null,
    batting_appearances: buildBattingAppearancePayload(scoresheet),
    batting_stats: buildBattingStatsPayload(scoresheet, context),
    upload_status: scoresheet.uploadStatus,
    notes: scoresheet.notes ?? ''
  }
}
