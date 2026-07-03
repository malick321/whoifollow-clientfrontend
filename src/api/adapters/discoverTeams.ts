import type {
  ApiDiscoverTeam,
  ApiDiscoverTeamsResponse
} from '../contracts/discoverTeams'
import type { DiscoverTeam, DiscoverTeamsPage } from '../discoverTeams'

/** The backend already returns fully-resolved CDN URLs and the card display
 *  values, so this adapter is a thin, defensive rename from the wire shape to
 *  the domain model — no URL building or label math here (that all lives
 *  server-side per the contract). */
function adaptDiscoverTeam(raw: ApiDiscoverTeam): DiscoverTeam {
  const team: DiscoverTeam = {
    id: String(raw.id),
    name: raw.name ?? '',
    avatarUrl: raw.avatarUrl ?? undefined,
    ageGroup: raw.ageGroup ?? undefined,
    rating: raw.rating ?? undefined,
    sportType: raw.sportType ?? undefined,
    gender: raw.gender ?? undefined,
    city: raw.city ?? undefined,
    state: raw.state ?? undefined,
    wifApproved: !!raw.wifApproved,
    isFollowing: !!raw.isFollowing,
    followId: raw.followId ?? undefined
  }

  // My Teams (`mine`) adds stats + a teammate cluster. Only attach when the
  // wire payload actually carries them so Discover/Following cards stay lean.
  if (raw.totalGames != null || raw.won != null || raw.lost != null) {
    team.totalGames = raw.totalGames ?? 0
    team.won = raw.won ?? 0
    team.lost = raw.lost ?? 0
  }
  if (raw.memberCount != null || raw.members != null) {
    team.memberCount = raw.memberCount ?? 0
    team.members = (raw.members ?? []).map((m) => ({
      id: String(m.id),
      name: m.name ?? undefined,
      avatarUrl: m.avatarUrl ?? undefined
    }))
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
