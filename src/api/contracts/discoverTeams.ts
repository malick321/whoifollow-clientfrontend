// Wire (API) types for New Game Time → Teams (Discover / My Teams / Following).
// Mirrors docs/api/newgametime-teams-api-contract.md.
// These describe the RAW response shape; the adapter maps them to the
// camelCase domain `DiscoverTeam` model in ../discoverTeams.

export interface ApiDiscoverTeamMember {
  id: string
  name: string | null
  avatarUrl: string | null
}

export interface ApiDiscoverTeam {
  id: string
  name: string | null
  avatarUrl: string | null
  ageGroup: string | null
  rating: string | null
  sportType: string | null
  gender: string | null
  city: string | null
  state: string | null
  wifApproved: boolean | null
  isFollowing: boolean | null
  followId: string | null
  // Present only on the `mine` (My Teams) response.
  totalGames?: number | null
  won?: number | null
  lost?: number | null
  memberCount?: number | null
  members?: ApiDiscoverTeamMember[] | null
}

export interface ApiDiscoverTeamsPaginator {
  data: ApiDiscoverTeam[]
  current_page: number
  per_page: number
  total: number
  last_page: number
}

export interface ApiDiscoverTeamsResponse {
  responseStatus?: {
    message?: string
    statusCode?: number
    text?: string
  }
  data?: {
    teams?: ApiDiscoverTeamsPaginator | null
  } | null
}

export interface ApiTeamFollowResponse {
  responseStatus?: { statusCode?: number; message?: string }
  data?: { followId?: string } | null
}
