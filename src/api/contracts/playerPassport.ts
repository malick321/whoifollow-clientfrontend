// Wire (API) types for the Player Passport surface.
// Mirrors docs/api/player-passport-api-contract.md. These describe the RAW
// response shapes; the adapter maps them to the camelCase domain models in
// ../playerPassport. Locked metrics arrive as `null` (freemium gating), so
// every numeric stat is nullable on the wire.

export interface ApiAccess {
  tier: 'free' | 'pro' | null
  isSelf: boolean | null
  lockedMetrics: string[] | null
}

export interface ApiPlayerRef {
  id: string
  name: string | null
  avatarUrl: string | null
}

export interface ApiPlayerTeam {
  id: string
  name: string | null
  avatarUrl: string | null
  sportType: string | null
  ageGroup: string | null
  gender: string | null
}

export interface ApiPlayerProfileResponse {
  responseStatus?: { message?: string; statusCode?: number; text?: string }
  data?: {
    player: {
      id: string
      name: string | null
      avatarUrl: string | null
      primaryPosition: string | null
      teams: ApiPlayerTeam[] | null
      memberSince: string | null
      firstGameDate: string | null
      lastGameDate: string | null
    }
    headline: {
      seasonsPlayed: number | null
      careerGames: number | null
      careerAvg: string | null
      careerHomeRuns: number | null
      careerRbi: number | null
    }
    access: ApiAccess
  } | null
}

export interface ApiPlayerStats {
  games: number | null
  plateAppearances: number | null
  atBats: number | null
  runs: number | null
  hits: number | null
  singles: number | null
  doubles: number | null
  triples: number | null
  homeRuns: number | null
  rbi: number | null
  walks: number | null
  strikeouts: number | null
  totalBases: number | null
  avg: string | null
  obp: string | null
  slg: string | null
  ops: string | null
  qualified: boolean | null
  pitching: unknown | null
  fielding: unknown | null
}

export interface ApiPlayerStatsResponse {
  responseStatus?: { message?: string; statusCode?: number; text?: string }
  data?: {
    scope: string
    season: number | null
    player: ApiPlayerRef
    stats: ApiPlayerStats
    access: ApiAccess
  } | null
}

export interface ApiGameLogRow {
  gameId: string
  date: string | null
  eventName: string | null
  division: string | null
  opponent: { id: string | null; name: string | null; avatarUrl: string | null }
  result: string | null
  teamScore: number | null
  opponentScore: number | null
  line: {
    ab: number | null
    r: number | null
    h: number | null
    rbi: number | null
    hr: number | null
    bb: number | null
    k: number | null
    avg: string | null
  }
  live: boolean | null
}

export interface ApiGameLogResponse {
  responseStatus?: { message?: string; statusCode?: number; text?: string }
  data?: {
    games: {
      data: ApiGameLogRow[]
      current_page: number
      per_page: number
      total: number
      last_page: number
    }
    access: ApiAccess
  } | null
}

export interface ApiSeasonSplit {
  season: number
  games: number | null
  avg: string | null
  obp: string | null
  slg: string | null
  ops: string | null
  hits: number | null
  homeRuns: number | null
  rbi: number | null
  qualified: boolean | null
}

export interface ApiSplitsResponse {
  responseStatus?: { message?: string; statusCode?: number; text?: string }
  data?: { splits: ApiSeasonSplit[]; access: ApiAccess } | null
}

export interface ApiLeaderboardRow {
  rank: number
  player: ApiPlayerRef
  team: { id: string | null; name: string | null }
  value: string | number | null
  games: number | null
}

export interface ApiLeaderboardResponse {
  responseStatus?: { message?: string; statusCode?: number; text?: string }
  data?: {
    stat: string
    scope: string
    season: number | null
    qualifier: { metric: string; min: number }
    rows: ApiLeaderboardRow[]
    viewerRank: { rank: number; value: string | number } | null
    access: ApiAccess
  } | null
}
