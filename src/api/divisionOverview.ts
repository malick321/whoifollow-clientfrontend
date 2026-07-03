import { getLegacyJson } from './client'
import { buildTeamAvatarUrl } from './config'
import type { DivisionOverview } from '../types'

type SelectedTournamentTeamsEnvelope = {
  data?: {
    teams?: unknown
    pools?: unknown
  } | unknown
}

type SelectedTournamentTeamRecord = Record<string, any>
type SelectedTournamentPoolRecord = Record<string, any>

type SelectedTournamentNestedTeam = {
  id?: number | string | null
  team_name?: string | null
  team_avatar?: string | null
  city?: string | null
  state?: string | null
  age_group?: { name?: string | null } | string | null
  ratings?: { rate?: string | null } | string | null
}

function unwrapTeams(response: SelectedTournamentTeamsEnvelope | unknown): SelectedTournamentTeamRecord[] {
  const payload = (response as SelectedTournamentTeamsEnvelope)?.data
  return Array.isArray((payload as { teams?: unknown })?.teams)
    ? ((payload as { teams?: unknown }).teams as SelectedTournamentTeamRecord[])
    : []
}

function unwrapPools(response: SelectedTournamentTeamsEnvelope | unknown): SelectedTournamentPoolRecord[] {
  const payload = (response as SelectedTournamentTeamsEnvelope)?.data
  return Array.isArray((payload as { pools?: unknown })?.pools)
    ? ((payload as { pools?: unknown }).pools as SelectedTournamentPoolRecord[])
    : []
}

function getNestedTeam(record: SelectedTournamentTeamRecord): SelectedTournamentNestedTeam {
  return (record.team ?? {}) as SelectedTournamentNestedTeam
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toStringValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }

  return ''
}

function buildLocation(record: SelectedTournamentTeamRecord) {
  const team = getNestedTeam(record)

  return toStringValue(
    [team.city, team.state].filter(Boolean).join(', ')
  )
}

function buildTeamMeta(record: SelectedTournamentTeamRecord) {
  const team = getNestedTeam(record)
  const rootRatings = record.ratings
  const ageGroup = toStringValue(
    typeof team.age_group === 'object' ? team.age_group?.name : team.age_group
  )
  const ratings = toStringValue(
    typeof team.ratings === 'object' ? team.ratings?.rate : team.ratings,
    typeof rootRatings === 'object' ? rootRatings?.rate : rootRatings
  )

  if (ageGroup && ratings) return `${ageGroup} - ${ratings}`
  if (ageGroup) return ageGroup
  if (ratings) return ratings

  return ''
}

function getTeamSerialNumber(record: SelectedTournamentTeamRecord, fallback: number) {
  return toNumber(
    record.team_sr_no,
    fallback
  )
}

function mapStanding(record: SelectedTournamentTeamRecord, index: number) {
  const team = getNestedTeam(record)
  const fallbackOrder = 1000 + index
  const teamSerialNumber = getTeamSerialNumber(record, fallbackOrder)
  const teamDisplayName = toStringValue(
    team.team_name,
    `Team ${index + 1}`
  )
  const hasExplicitSerial = record.team_sr_no != null && `${record.team_sr_no}` !== ''

  return {
    seed: toNumber(record.seed_count, 0),
    wins: toNumber(record.win_count, 0),
    losses: toNumber(record.loss_count, 0),
    teamName: hasExplicitSerial ? `#${teamSerialNumber}: ${teamDisplayName}` : teamDisplayName,
    teamMeta: buildTeamMeta(record),
    location: buildLocation(record),
    imageUrl: buildTeamAvatarUrl(toStringValue(team.team_avatar)) || undefined
  }
}

export async function fetchDivisionOverviewStandings(
  tournamentGuid: string
): Promise<DivisionOverview> {
  const response = await getLegacyJson<SelectedTournamentTeamsEnvelope>(
    `/tournaments/teams/getSelectedTournamentTeams?tournament_guid=${encodeURIComponent(tournamentGuid)}`
  )

  const standings = unwrapTeams(response)
    .sort(
      (left, right) =>
        getTeamSerialNumber(left, Number.MAX_SAFE_INTEGER) -
        getTeamSerialNumber(right, Number.MAX_SAFE_INTEGER)
    )
    .map((record, index) => mapStanding(record, index))

  const pools = unwrapPools(response)
  const isSeedGenerated = pools.some((pool) => toNumber(pool.seed_count_created, 0) === 1)

  return {
    tieBreakerText: '',
    formatText: '',
    podium: [],
    standings,
    isSeedGenerated
  }
}
