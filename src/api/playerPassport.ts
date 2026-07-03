import { buildV2ApiUrl } from './config'
import { getAuthHeaders } from '../auth-session'
import {
  adaptGameLog,
  adaptLeaderboard,
  adaptPlayerProfile,
  adaptPlayerStats,
  adaptSplits
} from './adapters/playerPassport'
import type {
  ApiGameLogResponse,
  ApiLeaderboardResponse,
  ApiPlayerProfileResponse,
  ApiPlayerStatsResponse,
  ApiSplitsResponse
} from './contracts/playerPassport'

// ── Domain models (camelCase) for the Player Passport ────────────────────────
// Co-located with the api entry points, mirroring DiscoverAssociation.
// Contract: docs/api/player-passport-api-contract.md.

export interface PlayerAccess {
  tier: 'free' | 'pro'
  isSelf: boolean
  /** Metric keys the backend nulled for this viewer (UI overlays an upgrade wall). */
  lockedMetrics: string[]
}

export interface PlayerTeamRef {
  id: string
  name: string
  avatarUrl?: string
  sportType?: string
  ageGroup?: string
  gender?: string
}

export interface PlayerProfile {
  id: string
  name: string
  avatarUrl?: string
  primaryPosition?: string
  teams: PlayerTeamRef[]
  memberSince?: string
  firstGameDate?: string
  lastGameDate?: string
  headline: {
    seasonsPlayed: number
    careerGames: number
    careerAvg: string
    careerHomeRuns: number
    careerRbi: number
  }
  access: PlayerAccess
}

/** A stat is `null` when locked behind Player Pro for the current viewer. */
export interface PlayerStats {
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
  qualified: boolean
}

export interface PlayerStatsResult {
  scope: 'career' | 'season'
  season: number | null
  player: { id: string; name: string; avatarUrl?: string }
  stats: PlayerStats
  access: PlayerAccess
}

export interface GameLogRow {
  gameId: string
  date: string
  eventName?: string
  division?: string
  opponent: { id?: string; name?: string }
  result: 'W' | 'L' | 'T'
  teamScore?: number
  opponentScore?: number
  line: { ab: number; r: number; h: number; rbi: number; hr: number; bb: number; k: number; avg: string }
  live: boolean
}

export interface GameLogResult {
  rows: GameLogRow[]
  currentPage: number
  perPage: number
  total: number
  lastPage: number
  access: PlayerAccess
}

export interface SeasonSplit {
  season: number
  games: number
  avg: string
  obp: string
  slg: string
  ops: string
  hits: number
  homeRuns: number
  rbi: number
  qualified: boolean
}

export interface SplitsResult {
  splits: SeasonSplit[]
  access: PlayerAccess
}

export interface LeaderboardRow {
  rank: number
  player: { id: string; name: string; avatarUrl?: string }
  team: { id?: string; name?: string }
  value: string | number
  games: number
}

export interface LeaderboardResult {
  stat: string
  scope: string
  season: number | null
  qualifier: { metric: string; min: number }
  rows: LeaderboardRow[]
  viewerRank: { rank: number; value: string | number } | null
  access: PlayerAccess
}

export type LeaderboardStat = 'avg' | 'obp' | 'slg' | 'ops' | 'hr' | 'rbi' | 'hits' | 'runs'

// ── HTTP helpers ─────────────────────────────────────────────────────────────

/** DEV-only Pro preview flag → appends ?preview=pro so the Pro shape can be
 *  visualized without a Pro account. Ignored by the backend in production. */
function q(params: Record<string, string | number | boolean | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '' && v !== false) sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(buildV2ApiUrl(path), {
    headers: { ...getAuthHeaders(), Accept: 'application/json' }
  })
  return (await res.json()) as T
}

// ── Entry points ─────────────────────────────────────────────────────────────

export async function fetchPlayerProfile(playerId: string, previewPro = false): Promise<PlayerProfile> {
  const res = await getJson<ApiPlayerProfileResponse>(
    `/players/${encodeURIComponent(playerId)}/profile${q({ preview: previewPro ? 'pro' : undefined })}`
  )
  return adaptPlayerProfile(res)
}

export async function fetchPlayerStats(
  playerId: string,
  opts: { scope: 'career' | 'season'; season?: number; previewPro?: boolean }
): Promise<PlayerStatsResult> {
  const res = await getJson<ApiPlayerStatsResponse>(
    `/players/${encodeURIComponent(playerId)}/stats${q({
      scope: opts.scope,
      season: opts.scope === 'season' ? opts.season : undefined,
      preview: opts.previewPro ? 'pro' : undefined
    })}`
  )
  return adaptPlayerStats(res)
}

export async function fetchPlayerGameLog(
  playerId: string,
  opts: { season?: number; page?: number; perPage?: number; previewPro?: boolean } = {}
): Promise<GameLogResult> {
  const res = await getJson<ApiGameLogResponse>(
    `/players/${encodeURIComponent(playerId)}/game-log${q({
      season: opts.season,
      page: opts.page,
      perPage: opts.perPage,
      preview: opts.previewPro ? 'pro' : undefined
    })}`
  )
  return adaptGameLog(res)
}

export async function fetchPlayerSplits(playerId: string, previewPro = false): Promise<SplitsResult> {
  const res = await getJson<ApiSplitsResponse>(
    `/players/${encodeURIComponent(playerId)}/splits${q({ preview: previewPro ? 'pro' : undefined })}`
  )
  return adaptSplits(res)
}

export async function fetchLeaderboard(opts: {
  stat: LeaderboardStat
  scope: string
  season?: number
  limit?: number
  previewPro?: boolean
}): Promise<LeaderboardResult> {
  const res = await getJson<ApiLeaderboardResponse>(
    `/leaderboards${q({
      stat: opts.stat,
      scope: opts.scope,
      season: opts.season,
      limit: opts.limit,
      preview: opts.previewPro ? 'pro' : undefined
    })}`
  )
  return adaptLeaderboard(res)
}
