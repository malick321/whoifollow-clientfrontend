import type {
  ApiDiscoverTeam,
  ApiDiscoverTeamsResponse
} from '../contracts/discoverTeams'
import { buildTeamAvatarUrl } from '../config'
import type { DiscoverTeam, DiscoverTeamsPage } from '../discoverTeams'

type LooseRecord = Record<string, unknown>

function asRecord(value: unknown): LooseRecord {
  return value && typeof value === 'object' ? (value as LooseRecord) : {}
}

function pickString(source: LooseRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return undefined
}

function pickNumber(source: LooseRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
      return Number(value)
    }
  }
  return undefined
}

function pickBoolean(source: LooseRecord, keys: string[]): boolean {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return value === 1
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase()
      if (['1', 'true', 'yes'].includes(normalized)) return true
      if (['0', 'false', 'no'].includes(normalized)) return false
    }
  }
  return false
}

function normalizeTeamAvatar(raw: string | undefined): string | undefined {
  return buildTeamAvatarUrl(raw) ?? raw
}

function adaptMember(raw: unknown, index: number) {
  const m = asRecord(raw)
  return {
    id: String(m.id ?? m.user_id ?? m.userId ?? m.member_id ?? index),
    name: pickString(m, ['name', 'fullName', 'full_name', 'userName', 'user_name']),
    avatarUrl:
      pickString(m, [
        'avatarUrl',
        'avatar_url',
        'profileAvatar',
        'profile_avatar',
        'imageUrl',
        'image_url',
        'picture',
        'photo'
      ]) ?? undefined
  }
}

function adaptDiscoverTeam(raw: ApiDiscoverTeam): DiscoverTeam {
  const source = asRecord(raw)
  const membersRaw = source.members ?? source.team_members ?? source.teammates ?? source.players
  const members = Array.isArray(membersRaw) ? membersRaw.map(adaptMember) : []
  const totalGames = pickNumber(source, [
    'totalGames',
    'total_games',
    'games',
    'gameCount',
    'game_count',
    'gamesPlayed',
    'games_played'
  ])
  const won = pickNumber(source, ['won', 'win', 'wins', 'gamesWon', 'games_won', 'won_count', 'win_count'])
  const lost = pickNumber(source, ['lost', 'loss', 'losses', 'gamesLost', 'games_lost', 'lost_count'])
  const memberCount = pickNumber(source, [
    'memberCount',
    'member_count',
    'members_count',
    'teammateCount',
    'teammates_count'
  ])

  const team: DiscoverTeam = {
    id: String(source.id ?? source.team_id ?? ''),
    name: pickString(source, ['name', 'team_name', 'teamName']) ?? '',
    avatarUrl: normalizeTeamAvatar(
      pickString(source, [
        'avatarUrl',
        'avatar_url',
        'team_avatar_url',
        'teamAvatarUrl',
        'team_avatar',
        'teamAvatar',
        'team_logo',
        'teamLogo',
        'logoUrl',
        'logo_url',
        'logo',
        'imageUrl',
        'image_url',
        'image',
        'avatar'
      ])
    ),
    ageGroup: pickString(source, ['ageGroup', 'age_group', 'age']),
    rating: pickString(source, ['rating', 'rate', 'rateName', 'rate_name']),
    sportType: pickString(source, ['sportType', 'sport_type', 'sportName', 'sport_name', 'sports']),
    gender: pickString(source, ['gender']),
    city: pickString(source, ['city']),
    state: pickString(source, ['state']),
    wifApproved: pickBoolean(source, ['wifApproved', 'wif_approved', 'wif_approved_status', 'isWifApproved']),
    isFollowing: pickBoolean(source, ['isFollowing', 'is_following', 'following']),
    followId: pickString(source, ['followId', 'follow_id'])
  }

  if (totalGames !== undefined || won !== undefined || lost !== undefined) {
    team.totalGames = totalGames ?? 0
    team.won = won ?? 0
    team.lost = lost ?? 0
  }

  if (memberCount !== undefined || members.length) {
    team.memberCount = memberCount ?? members.length
    team.members = members
  }

  return team
}

export function adaptDiscoverTeams(response: ApiDiscoverTeamsResponse): DiscoverTeamsPage {
  const paginator = response?.data?.teams ?? null
  const rows = paginator?.data ?? []

  return {
    teams: rows.map(adaptDiscoverTeam),
    currentPage: paginator?.current_page ?? 1,
    perPage: paginator?.per_page ?? 0,
    total: paginator?.total ?? rows.length,
    lastPage: paginator?.last_page ?? 1
  }
}
