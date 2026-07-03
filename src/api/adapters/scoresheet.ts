import type {
  ApiGameBattingAppearance,
  ApiGameBattingStats,
  ApiGameLineupPlayer,
  ApiGameLineupSubmission,
  ApiScoresheetResponse
} from '../contracts/scoresheet'
import type {
  GameLineupPlayer,
  GameLineupSubmission,
  LineupPlayer,
  ScoresheetCell,
  ScoresheetDetail,
  ScoresheetPlayerRow
} from '../../types'
import { buildUserAvatarUrl } from '../config'

function submissionStatusLabel(status: ApiGameLineupSubmission['submission_status']): GameLineupSubmission['status'] {
  switch (status) {
    case 1:
      return 'submitted'
    case 2:
      return 'approved'
    case 3:
      return 'rejected'
    case 4:
      return 'finalized'
    default:
      return 'draft'
  }
}

function approvalModeLabel(mode: ApiGameLineupSubmission['approval_mode']): GameLineupSubmission['approvalMode'] {
  return mode === 0 ? 'auto' : 'manual'
}

function playerSourceLabel(source: ApiGameLineupPlayer['player_source_type']): GameLineupPlayer['playerSourceType'] {
  switch (source) {
    case 1:
      return 'team_member'
    case 2:
      return 'invited_member'
    case 3:
      return 'association_entered'
    case 4:
      return 'uploaded_scoresheet'
    default:
      return 'manual'
  }
}

export function adaptEventLineupOptions(options: ApiScoresheetResponse['event_lineup_options']): LineupPlayer[] {
  return (options ?? []).map((option) => ({
    id: option.id,
    imageUrl: buildUserAvatarUrl(
      option.player_image_url ?? option.profile_avatar ?? option.image_url ?? option.avatar_url
    ),
    jerseyNumber: option.jersey_number,
    name: option.player_name,
    position: option.position_code,
    status: option.status
  }))
}

function inferFieldArea(positionName: string): 'infield' | 'outfield' | 'battery' | 'flex' {
  const code = positionName.toUpperCase()
  if (['P', 'C'].includes(code)) return 'battery'
  if (['1B', '2B', '3B', 'SS'].includes(code)) return 'infield'
  if (['LF', 'LC', 'CF', 'RC', 'RF'].includes(code)) return 'outfield'
  return 'flex'
}

export function adaptFieldConfigPositions(positions: ApiScoresheetResponse['field_config']['positions']) {
  return positions.map((position) => {
    const code = position.code ?? position.position_name
    const label = position.label ?? position.position_name
    return {
      id: position.id,
      fieldConfigurationId: position.field_configuration_id ?? null,
      positionName: position.position_name,
      positionNumber: position.position_number ?? null,
      xAxis: position.x_axis ?? null,
      yAxis: position.y_axis ?? null,
      status: position.status ?? null,
      code,
      label,
      area: position.area ?? inferFieldArea(position.position_name)
    }
  })
}

// Strictly use game_lineup_players.id — this is the only id that
// batting_appearances.game_lineup_player_id and batting_stats.game_lineup_player_id
// reference. Previously this fell back to event_team_lineup_id / team_member_id /
// user_id, which live in different numeric namespaces and can collide with a
// real game_lineup_players.id belonging to a different player — attaching the
// wrong appearances and stats to a row.
function stableGameLineupPlayerId(player: ApiGameLineupPlayer, index: number) {
  return player.id ?? index + 1
}

export function adaptGameLineupPlayers(players: ApiGameLineupPlayer[]): GameLineupPlayer[] {
  const adaptedPlayers = players
    .map((player, index) => ({
      id: String(stableGameLineupPlayerId(player, index)),
      eventLineupId: player.event_team_lineup_id ? String(player.event_team_lineup_id) : undefined,
      teamMemberId: player.team_member_id ? String(player.team_member_id) : undefined,
      userId: player.user_id ? String(player.user_id) : undefined,
      imageUrl: buildUserAvatarUrl(
        player.player_image_url ?? player.profile_avatar ?? player.image_url ?? player.avatar_url
      ),
      playerName: player.player_name,
      jerseyNumber: player.jersey_number ?? '',
      battingOrder: player.batting_order,
      positionCode: player.position_code,
      isStarter: player.is_starter,
      isBench: player.is_bench,
      isSubstitute: player.is_substitute,
      isActive: player.is_active,
      enteredInning: player.entered_inning,
      exitedInning: player.exited_inning,
      substitutesForId: player.replaces_game_lineup_player_id
        ? String(player.replaces_game_lineup_player_id)
        : null,
      playerSourceType: playerSourceLabel(player.player_source_type)
    }))
    .sort((left, right) => left.battingOrder - right.battingOrder)

  const slotMap = new Map<number, GameLineupPlayer[]>()
  for (const player of adaptedPlayers) {
    if (!slotMap.has(player.battingOrder)) slotMap.set(player.battingOrder, [])
    slotMap.get(player.battingOrder)!.push(player)
  }

  for (const [, slotPlayers] of slotMap) {
    const starter = slotPlayers.find((player) => !player.isSubstitute) ?? null
    const substitute = slotPlayers.find((player) => player.isSubstitute) ?? null
    if (starter && substitute && !substitute.substitutesForId) {
      substitute.substitutesForId = starter.id
    }
  }

  return adaptedPlayers
}

export function adaptGameLineupSubmission(
  submission: ApiGameLineupSubmission | null,
  lineupPlayers: ApiGameLineupPlayer[]
): GameLineupSubmission | null {
  if (!submission) return null

  return {
    id: submission.id != null ? String(submission.id) : null,
    status: submissionStatusLabel(submission.submission_status),
    approvalMode: approvalModeLabel(submission.approval_mode),
    sourceType: submission.source_type,
    submittedAt: submission.submitted_at,
    approvedAt: submission.approved_at,
    rejectionReason: submission.rejection_reason,
    notes: submission.notes ?? '',
    players: adaptGameLineupPlayers(lineupPlayers)
  }
}

function buildAppearanceCellMap(
  appearances: ApiGameBattingAppearance[],
  totalInnings: number
): Map<number, ScoresheetCell[]> {
  const cellMap = new Map<number, ScoresheetCell[]>()

  for (const appearance of appearances) {
    if (!cellMap.has(appearance.game_lineup_player_id)) {
      cellMap.set(
        appearance.game_lineup_player_id,
        Array.from({ length: totalInnings }, (_, index) => ({
          inning: index + 1,
          appearances: [],
          reviewState: 'empty'
        }))
      )
    }

    const playerCells = cellMap.get(appearance.game_lineup_player_id)!
    const cell = playerCells[appearance.inning_number - 1]
    if (!cell) {
      // Defensive: should not trigger now that totalInnings includes
      // maxAppearanceInning, but keeps a future off-by-one from silently
      // detonating the whole scoresheet fetch.
      // eslint-disable-next-line no-console
      console.warn(
        `[scoresheet adapter] Appearance inning ${appearance.inning_number} exceeds totalInnings ${playerCells.length} — skipping id ${appearance.id}`
      )
      continue
    }
    cell.appearances.push({
      id: String(appearance.id),
      sequence: appearance.plate_appearance_no_for_player,
      result: appearance.result_code,
      batterEndBase: appearance.batter_end_base,
      contactType: '',
      rbi: appearance.rbi,
      outsOnPlay: appearance.outs_after && appearance.outs_before !== null ? Math.max(0, appearance.outs_after - (appearance.outs_before ?? 0)) : 0,
      baserunning: '',
      fieldZone: '',
      fieldersInvolved: '',
      notes: appearance.result_detail ?? ''
    })
    cell.reviewState = 'verified'
  }

  return cellMap
}

function buildStatsMap(stats: ApiGameBattingStats[]): Map<number, ApiGameBattingStats> {
  return new Map(stats.map((stat) => [stat.game_lineup_player_id, stat]))
}

export function adaptScoresheetPlayers(
  lineupPlayers: ApiGameLineupPlayer[],
  appearances: ApiGameBattingAppearance[],
  battingStats: ApiGameBattingStats[],
  totalInnings: number
): ScoresheetPlayerRow[] {
  // Group non-bench players by batting_order so we can carry both the starter
  // AND their substitute (when present) onto the same ledger row. The starter
  // anchors the row; the sub's identity + cells are attached as parallel
  // fields so the view can switch per-inning to the player who actually
  // batted / fielded in that inning.
  const slotMap = lineupPlayers
    .filter((player) => !player.is_bench)
    .reduce<Map<number, ApiGameLineupPlayer[]>>((slots, player) => {
      const slotPlayers = slots.get(player.batting_order) ?? []
      slotPlayers.push(player)
      slots.set(player.batting_order, slotPlayers)
      return slots
    }, new Map())

  const orderedSlots = Array.from(slotMap.entries()).sort(([a], [b]) => a - b)
  const cellMap = buildAppearanceCellMap(appearances, totalInnings)
  const statsMap = buildStatsMap(battingStats)

  const rows: ScoresheetPlayerRow[] = []
  orderedSlots.forEach(([, slotPlayers], slotIndex) => {
    const starter =
      slotPlayers.find((entry) => !entry.is_substitute) ??
      slotPlayers.find((entry) => entry.is_active) ??
      slotPlayers[0]
    if (!starter) return

    // Strict: cells and stats are looked up ONLY by game_lineup_players.id,
    // which is exactly what batting_appearances.game_lineup_player_id and
    // batting_stats.game_lineup_player_id reference. No cross-namespace
    // fallbacks — they silently mis-attach data.
    if (starter.id == null) {
      // eslint-disable-next-line no-console
      console.warn(
        `[scoresheet adapter] ScoresheetPlayerRow skipped: game_lineup_players.id missing for "${starter.player_name}" at batting_order ${starter.batting_order}`
      )
      return
    }
    const starterId = starter.id
    const gameLineupPlayerId = stableGameLineupPlayerId(starter, slotIndex)
    const starterStats = statsMap.get(starterId)
    const starterCells = cellMap.get(starterId)

    // A slot may have multiple subs across the game; for now surface the
    // earliest-entering sub as the row's substitute. Additional sub chaining
    // is an orthogonal enhancement.
    const substitute = slotPlayers
      .filter((entry) => entry.is_substitute && entry.id != null)
      .slice()
      .sort((a, b) => (a.entered_inning ?? 0) - (b.entered_inning ?? 0))[0]

    const row: ScoresheetPlayerRow = {
      id: `p${gameLineupPlayerId}`,
      gameLineupPlayerId,
      battingOrder: starter.batting_order,
      jerseyNumber: starter.jersey_number ?? '',
      playerName: starter.player_name,
      mappedLineupId: starter.event_team_lineup_id ? String(starter.event_team_lineup_id) : undefined,
      mappedLineupName: starter.player_name,
      mappingState: 'matched',
      innings: Array.from({ length: totalInnings }, (_, inningIndex) => ({
        inning: inningIndex + 1,
        runs: '',
        outcome: ''
      })),
      cells:
        starterCells ??
        Array.from({ length: totalInnings }, (_, inningIndex) => ({
          inning: inningIndex + 1,
          appearances: [],
          reviewState: 'empty'
        })),
      runs: starterStats?.runs ?? 0,
      hits: starterStats?.hits ?? 0,
      rbi: starterStats?.rbi ?? 0
    }

    if (substitute && substitute.id != null) {
      const subStats = statsMap.get(substitute.id)
      const subCells = cellMap.get(substitute.id)
      row.substituteGameLineupPlayerId = substitute.id
      row.substitutePlayerName = substitute.player_name
      row.substituteJerseyNumber = substitute.jersey_number ?? ''
      row.substitutePositionCode = substitute.position_code ?? undefined
      row.substituteEnteredInning = substitute.entered_inning ?? undefined
      row.substituteExitedInning = substitute.exited_inning ?? undefined
      row.substituteCells =
        subCells ??
        Array.from({ length: totalInnings }, (_, inningIndex) => ({
          inning: inningIndex + 1,
          appearances: [],
          reviewState: 'empty'
        }))
      row.substituteRuns = subStats?.runs ?? 0
      row.substituteHits = subStats?.hits ?? 0
      row.substituteRbi = subStats?.rbi ?? 0
    }

    rows.push(row)
  })

  return rows
}

export function adaptScoresheetDetail(response: ApiScoresheetResponse): ScoresheetDetail {
  const teamLineScores = response.team?.line_scores ?? []
  const opponentLineScores = response.opponent?.line_scores ?? []
  const lineupPlayers = response.game_lineup_players ?? response.lineup_players ?? []
  const battingAppearances = response.game_batting_appearances ?? response.batting_appearances ?? []
  const battingStats = response.game_batting_stats ?? response.batting_stats ?? []
  const gameLineupSubmission = adaptGameLineupSubmission(response.lineup_submission, lineupPlayers)
  const submittedLineupOptions = adaptGameLineupPlayers(lineupPlayers).map((player) => ({
    id: player.eventLineupId ?? player.id,
    teamMemberId: player.teamMemberId ?? null,
    userId: player.userId ?? null,
    jerseyNumber: player.jerseyNumber,
    name: player.playerName,
    position: player.positionCode ?? 'EH',
    status: player.isBench ? 'bench' as const : 'active' as const
  }))
  // Include the max inning_number seen in batting_appearances so the per-player
  // cell arrays always have room for every appearance the backend returned.
  // Without this, an appearance at inning N where team.line_scores < N (or
  // team is absent entirely) would land outside the cell array and throw a
  // TypeError inside buildAppearanceCellMap — which the fetchScoresheet catch
  // block was silently swallowing into a "Game lineup required" fallback.
  const maxAppearanceInning = battingAppearances.reduce(
    (max, appearance) => Math.max(max, appearance.inning_number ?? 0),
    0
  )
  const totalInnings = Math.max(
    teamLineScores.length,
    opponentLineScores.length,
    maxAppearanceInning,
    7
  )
  const teamRunsTotal = teamLineScores.reduce<number>((sum, value) => sum + (Number(value) || 0), 0)
  const opponentRunsTotal = opponentLineScores.reduce<number>((sum, value) => sum + (Number(value) || 0), 0)

  return {
    gameId: String(response.game_id ?? response.tournament_game_id ?? ''),
    eventName: response.event_name ?? undefined,
    teamName: response.team?.name ?? '',
    teamAvatarUrl: undefined,
    opponent: response.opponent?.name ?? '',
    opponentAvatarUrl: undefined,
    teamSeed: response.team?.seed ?? undefined,
    opponentSeed: response.opponent?.seed ?? undefined,
    teamSide: response.team?.side ?? 'H',
    opponentSide: response.opponent?.side ?? 'V',
    bracketLabel: response.bracket_label ?? '',
    division: response.division ?? '',
    gameTime: response.game_time_label ?? '',
    actualStartTime: undefined,
    timeLimit: response.time_limit_minutes ?? undefined,
    venueField: response.venue?.field ?? undefined,
    venuePark: response.venue?.park ?? undefined,
    venueCity: response.venue?.city ?? undefined,
    venueState: response.venue?.state ?? undefined,
    teamLineScores,
    opponentLineScores,
    teamRunsTotal,
    opponentRunsTotal,
    teamHomeRuns: response.team?.home_runs,
    opponentHomeRuns: response.opponent?.home_runs,
    currentInning: response.current_inning ?? null,
    currentBattingTeamSide: undefined,
    gameStatusCode: undefined,
    gameStatusLabel: undefined,
    isDelayed: false,
    delayReason: undefined,
    isLive: response.is_live ?? false,
    manager: response.manager ?? { name: '', email: '', phone: '' },
    uploadStatus: response.scoresheet_upload.status,
    sourceImageName: response.scoresheet_upload.source_image_name ?? undefined,
    extractionConfidence: response.scoresheet_upload.extraction_confidence ?? 0,
    notes: response.scoresheet_upload.notes ?? '',
    // Backend contract: lineup_submission is null ⇔ no submission yet (UI
    // should show the event-lineup template + "Game lineup required" banner).
    // lineup_submission is an object ⇔ submission exists (UI shows the game
    // lineup as-is). That's the source of truth — do not layer additional
    // gating (id/status/lineupPlayers.length) on top.
    gameLineupSubmitted: response.lineup_submission != null,
    fieldConfigName: response.field_config.name ?? undefined,
    fieldConfigPositions: adaptFieldConfigPositions(response.field_config.positions),
    gameLineupSubmission,
    lineupOptions: submittedLineupOptions.length ? submittedLineupOptions : adaptEventLineupOptions(response.event_lineup_options),
    reviewItems: response.scoresheet_upload.review_items,
    players: adaptScoresheetPlayers(
      lineupPlayers,
      battingAppearances,
      battingStats,
      totalInnings
    )
  }
}
