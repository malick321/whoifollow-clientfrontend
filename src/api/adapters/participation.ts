import type {
  ApiGameStatus,
  ApiParticipationDivisionBracket,
  ApiParticipationDivisionMeta,
  ApiParticipationDivisionOverview,
  ApiParticipationGame,
  ApiParticipationLineupPlayer,
  ApiParticipationLineupSummaryPlayer,
  ApiRegistrationStatus,
  ApiParticipationStatus,
  ApiTeamParticipationSummaryResponse,
  ApiUploadStatus,
  ApiTeamParticipationResponse
} from '../contracts/participation'
import type {
  GameSummary,
  LineupPlayer,
  LineupSummaryPlayer,
  ParticipationStatus,
  RegistrationStatus,
  TeamParticipation,
  UploadStatus
} from '../../types'
import type { TeamParticipationSummary } from '../participationPage'
import { buildTeamAvatarUrl, buildUserAvatarUrl } from '../config'

function unwrapParticipationPayload<T>(response: T | { data?: T | null } | null | undefined): T {
  if (response && typeof response === 'object' && 'data' in response && response.data) {
    return response.data
  }

  return response as T
}

function getDivisionMeta(division: ApiTeamParticipationResponse['division'] | ApiTeamParticipationSummaryResponse['division']) {
  if (division && typeof division === 'object') {
    return division as ApiParticipationDivisionMeta
  }

  return null
}

function formatParticipationDateRange(startDate?: string | null, endDate?: string | null, timezone?: string | null) {
  if (!startDate && !endDate && !timezone) return ''

  const formatter = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  })

  const startLabel = startDate ? formatter.format(new Date(startDate)) : ''
  const endLabel = endDate ? formatter.format(new Date(endDate)) : ''
  const rangeLabel =
    startLabel && endLabel && startLabel !== endLabel
      ? `${startLabel} to ${endLabel}`
      : startLabel || endLabel

  return timezone ? [rangeLabel, timezone].filter(Boolean).join(' ') : rangeLabel
}

function buildDivisionFormatText(
  poolGamesGuaranteed?: number | null,
  bracket?: ApiParticipationDivisionBracket | null
) {
  const poolText = poolGamesGuaranteed ? `${poolGamesGuaranteed} game round robin` : ''
  const bracketFormat = bracket?.format?.trim()

  if (poolText && bracketFormat) {
    return `${poolText} followed by ${bracketFormat} bracket.`
  }

  if (poolText) return `${poolText}.`
  if (bracketFormat) return `${bracketFormat} bracket.`

  return ''
}

function registrationStatusLabel(status: ApiRegistrationStatus): RegistrationStatus {
  switch (status) {
    case 'paid':
      return 'paid'
    case 'partially_paid':
      return 'partially_paid'
    case 'unpaid':
      return 'unpaid'
    case 0:
    case 'registered':
      return 'registered'
    case 2:
    case 'expired':
      return 'expired'
    default:
      return 'pending'
  }
}

function participationStatusLabel(status: ApiParticipationStatus): ParticipationStatus {
  const normalized = typeof status === 'string' ? status.trim().toLowerCase() : status
  const numericStatus =
    typeof normalized === 'string' && normalized !== ''
      ? Number(normalized)
      : typeof normalized === 'number'
        ? normalized
        : Number.NaN

  if (Number.isFinite(numericStatus)) {
    switch (numericStatus) {
      case 0:
        return 'initiated'
      case 1:
        return 'pending_approval'
      case 2:
        return 'confirmed'
      case 3:
        return 'waitlisted'
      case 4:
        return 'withdrawn'
      case 5:
        return 'cancelled'
      default:
        break
    }
  }

  switch (normalized) {
    case 'initiated':
      return 'initiated'
    case 'pending_approval':
      return 'pending_approval'
    case 'confirmed':
      return 'confirmed'
    case 'waitlisted':
      return 'waitlisted'
    case 'withdrawn':
      return 'withdrawn'
    case 'cancelled':
      return 'cancelled'
    default:
      return 'initiated'
  }
}

/** Normalize the new structured lineup_summary list. Gracefully handles:
 *   - `null` / `undefined` → empty list
 *   - Legacy string shape (rollout window) → empty list (UI falls back to
 *     "No lineup submitted for this event yet.")
 *   - Array of wire-shaped players → mapped with defensive coercions.
 *
 * Note the wire format uses `jersy` (sic) for the jersey number — the
 * backend spec uses that spelling, so the contract type preserves it and
 * this adapter reads it verbatim.
 */
function adaptLineupSummary(
  raw: ApiParticipationLineupSummaryPlayer[] | string | null | undefined
): LineupSummaryPlayer[] {
  if (!raw || !Array.isArray(raw)) return []
  return raw.map((entry) => ({
    userId: entry.user_id != null ? String(entry.user_id) : undefined,
    jerseyNumber: entry.jersy ?? '',
    name: entry.name ?? '',
    position: entry.position ?? '',
    isStarter: !!entry.isStarter,
    isActive: !!entry.isActive,
    isBench: !!entry.isBench
  }))
}

export function adaptTeamParticipationSummary(
  response: ApiTeamParticipationSummaryResponse
): TeamParticipationSummary {
  const payload = unwrapParticipationPayload(response)
  const divisionMeta = getDivisionMeta(payload.division)
  const eventName = payload.event_name ?? payload.event?.name ?? ''
  const eventDate =
    payload.event_date ??
    formatParticipationDateRange(divisionMeta?.start_date, divisionMeta?.end_date, payload.event?.timezone)
  const divisionName = typeof payload.division === 'string' ? payload.division : divisionMeta?.name ?? ''

  return {
    eventId: String(payload.event_id),
    eventGuid: payload.event_guid ?? undefined,
    eventName,
    eventDate,
    division: divisionName,
    tournamentId:
      payload.tournament_id != null
        ? String(payload.tournament_id)
        : divisionMeta?.id != null
          ? String(divisionMeta.id)
          : undefined,
    tournamentGuid: payload.tournament_guid ?? divisionMeta?.guid ?? undefined,
    teamId: payload.team_id != null ? String(payload.team_id) : undefined,
    teamGuid: payload.team_guid ?? undefined,
    teamAvatarUrl: buildTeamAvatarUrl(payload.team_avatar),
    // Team metadata from team association registration. All optional —
    // missing fields just collapse out of the hero meta line downstream.
    teamRating: payload.team_rating != null ? String(payload.team_rating) : undefined,
    teamAgeGroup: payload.team_agegroup ?? undefined,
    teamCity: payload.team_city ?? undefined,
    teamState: payload.team_state ?? undefined,
    // Raw ISO event dates drive the weather-strip visibility window on the
    // sidebar (src/lib/weather-window.ts). Prefer the fresh `event` object
    // from the v2 response; fall back to `divisionMeta` (already the source
    // for the human-readable eventDate label) so this keeps working on
    // backend builds that haven't yet surfaced start_date/end_date on the
    // event meta itself.
    eventStartDate: payload.event?.start_date?.trim() || divisionMeta?.start_date?.trim() || undefined,
    eventEndDate: payload.event?.end_date?.trim() || divisionMeta?.end_date?.trim() || undefined,
    divisionGuid: divisionMeta?.guid ?? undefined,
    feeStatus: registrationStatusLabel(payload.fee_status),
    associationStatus: registrationStatusLabel(payload.association_status),
    participationStatus: participationStatusLabel(payload.participation_status),
    teamName: payload.team_name ?? '',
    manager: {
      name: payload.manager?.name ?? '',
      email: payload.manager?.email ?? '',
      phone: payload.manager?.phone ?? '',
      linkedUserId:
        payload.manager?.manager_linked_user_id != null
          ? String(payload.manager.manager_linked_user_id)
          : undefined
    },
    eventOverview: {
      lineupSummary: adaptLineupSummary(payload.event_overview?.lineup_summary),
      venueText: payload.event_overview?.venue_text ?? '',
      forecast: (payload.event_overview?.forecast ?? []).map((day) => ({
        label: day.label ?? '',
        icon: day.icon ?? 'partly-cloudy',
        high: day.high ?? 0,
        low: day.low ?? 0
      })),
      attendeeCount: payload.event_overview?.attendee_count ?? 0
    }
  }
}

export function adaptParticipationDivisionOverview(
  overview: ApiParticipationDivisionOverview
): TeamParticipation['divisionOverview'] {
  return {
    tieBreakerText: overview.tie_breaker_text ?? '',
    formatText: overview.format_text ?? '',
    podium: (overview.podium ?? []).map((entry) => ({
      rankLabel: entry.rank_label ?? '',
      teamName: entry.team_name ?? '',
      note: entry.note ?? '',
      imageUrl: entry.image_url ?? undefined,
      runsDifferential: entry.runs_differential ?? undefined,
      bracketRecord: entry.bracket_record ?? undefined
    })),
    standings: (overview.standings ?? []).map((entry) => ({
      seed: entry.seed ?? 0,
      wins: entry.wins ?? 0,
      losses: entry.losses ?? 0,
      teamName: entry.team_name ?? '',
      teamMeta: entry.team_meta ?? '',
      location: entry.location ?? '',
      imageUrl: entry.image_url ?? undefined
    }))
  }
}

function adaptDivisionOverviewFromMeta(
  divisionMeta: ApiParticipationDivisionMeta | null
): TeamParticipation['divisionOverview'] {
  const winners = divisionMeta?.bracket?.winners ?? []

  return {
    tieBreakerText: divisionMeta?.tie_breaker_text ?? '',
    formatText: buildDivisionFormatText(divisionMeta?.pool_games_guaranteed, divisionMeta?.bracket),
    bracketName: divisionMeta?.bracket?.bracket_name ?? '',
    bracketCompleted: !!divisionMeta?.bracket?.bracket_completed,
    isSeedGenerated: !!divisionMeta?.bracket?.is_seed_generated,
    podium: winners.map((winner) => ({
      rankLabel: winner.label ?? (winner.rank != null ? `#${winner.rank}` : ''),
      teamName: winner.team_name ?? '',
      teamId: winner.team_id != null ? String(winner.team_id) : undefined,
      teamGuid: winner.team_guid ?? undefined,
      note: winner.rank != null ? `Rank ${winner.rank}` : ''
    })),
    standings: []
  }
}

function uploadStatusLabel(status: ApiUploadStatus): UploadStatus {
  switch (status) {
    case 'uploading':
    case 'review':
    case 'mapped':
    case 'published':
      return status
    default:
      return 'idle'
  }
}

function gameStatusLabel(status: ApiGameStatus): GameSummary['status'] {
  switch (status) {
    case 1:
    case 'live':
      return 'live'
    case 2:
    case 'final':
      return 'final'
    default:
      return 'scheduled'
  }
}

export function adaptParticipationLineupPlayer(player: ApiParticipationLineupPlayer): LineupPlayer {
  return {
    id: String(player.id),
    teamMemberId: player.team_member_id != null ? String(player.team_member_id) : null,
    userId: player.user_id != null ? String(player.user_id) : null,
    jerseyNumber: player.jersey_number ?? '',
    name: player.player_name ?? 'Unknown Player',
    position: player.position_code ?? 'EH',
    status: player.status === 'bench' ? 'bench' : 'active'
  }
}

export function adaptParticipationGame(game: ApiParticipationGame): GameSummary {
  return {
    id: String(game.id),
    bracketLabel: game.bracket_label ?? 'Game',
    gameTime: game.game_time ?? '',
    dateLabel: game.date_label ?? undefined,
    timeLabel: game.time_label ?? undefined,
    field: game.field ?? '',
    facilityLabel: game.facility_label ?? undefined,
    divisionLabel: game.division_label ?? undefined,
    opponent: game.opponent ?? 'TBD',
    opponentImageUrl: buildTeamAvatarUrl(game.opponent_image_url),
    teamImageUrl: buildTeamAvatarUrl(game.team_image_url),
    opponentSeed: game.opponent_seed ?? undefined,
    teamSeed: game.team_seed ?? undefined,
    scoreFor: game.score_for ?? undefined,
    scoreAgainst: game.score_against ?? undefined,
    status: gameStatusLabel(game.status),
    statusNote: game.status_note ?? undefined,
    badgeCount: game.badge_count ?? undefined,
    lineupSubmitted: !!game.lineup_submitted,
    scoresheetStatus: uploadStatusLabel(game.scoresheet_status)
  }
}

export function adaptTeamParticipation(response: ApiTeamParticipationResponse): TeamParticipation {
  const payload = unwrapParticipationPayload(response)

  // New v2 response uses divisions[]; fall back to legacy division field
  const primaryDivision: ApiParticipationDivisionMeta | null =
    payload.divisions?.[0] ?? getDivisionMeta(payload.division ?? null)

  // Build a summary-compatible shape from the new structure
  const summaryPayload: ApiTeamParticipationSummaryResponse = {
    ...payload,
    division: primaryDivision
  }

  return {
    ...adaptTeamParticipationSummary(summaryPayload),
    eventJoinedTeamId: payload.event_joined_team_id != null ? String(payload.event_joined_team_id) : undefined,
    userRoleId: payload.user_role_id ?? undefined,
    userRole: payload.user_role ?? undefined,
    // Backend sends is_admin as a 0/1 number (or occasionally a boolean/null).
    // Coerce to a proper boolean here so downstream props that `type: Boolean`
    // don't trip Vue's prop validation warning.
    isAdmin: payload.is_admin == null ? undefined : !!payload.is_admin,
    lineup: (payload.lineup ?? []).map(adaptParticipationLineupPlayer),
    games: (payload.games ?? []).map(adaptParticipationGame),
    divisionOverview: payload.division_overview
      ? adaptParticipationDivisionOverview(payload.division_overview)
      : adaptDivisionOverviewFromMeta(primaryDivision)
  }
}
