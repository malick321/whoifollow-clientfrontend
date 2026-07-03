// Public Event Detail — per-tab data clients
// -------------------------------------------
// The public event page (`/public/event/:slug`, slug = event GUID) has
// four unlocked tabs beyond "About". Each pulls from a dedicated PUBLIC
// v2 endpoint (no auth, no locks):
//   - Boxscores  → GET /v2/public/events/{slug}/divisions/{divisionId}/games
//   - Teams      → GET /v2/public/events/{slug}/teams  (grouped by age group)
//   - Field Grid → GET /v2/public/events/{slug}/schedule  (SchedulerPark/Game)
//
// The backend already returns camelCase in the exact display shape, so the
// adapters here are thin, defensive renames (no URL/date math client-side).

import { buildV2ApiUrl } from './config'
import type { SchedulerGame, SchedulerPark } from '../types'

interface Envelope<T> {
  responseStatus?: { statusCode?: number; message?: string }
  data?: T
}

async function fetchPublic<T>(path: string): Promise<T | null> {
  const res = await fetch(buildV2ApiUrl(path), { headers: { Accept: 'application/json' } })
  if (!res.ok) return null
  const env = (await res.json()) as Envelope<T>
  return (env?.data ?? null) as T | null
}

// ── Boxscores ────────────────────────────────────────────────────────────

export type PublicGameStatus = 'scheduled' | 'live' | 'final' | 'delayed'

export interface PublicBoxscoreTeam {
  name: string
  avatarUrl?: string
  /** Runs — `null` until the game has started. */
  score: number | null
}

export interface PublicBoxscoreGame {
  id: string
  gameName: string
  gameType: 'pool' | 'bracket'
  status: PublicGameStatus
  /** ISO `YYYY-MM-DD` (null when not yet scheduled). */
  startDate: string | null
  /** Server-formatted, e.g. "9:00 AM". */
  startTime: string | null
  field?: string
  park?: string
  bracketName?: string
  delayReason?: string
  team1: PublicBoxscoreTeam
  team2: PublicBoxscoreTeam
}

export interface PublicDivisionGames {
  divisionId: string
  divisionName: string
  games: PublicBoxscoreGame[]
}

function adaptBoxscoreTeam(raw: any): PublicBoxscoreTeam {
  return {
    name: raw?.name ?? 'TBD',
    avatarUrl: raw?.avatarUrl ?? undefined,
    score: typeof raw?.score === 'number' ? raw.score : null
  }
}

function adaptBoxscoreGame(raw: any): PublicBoxscoreGame {
  return {
    id: String(raw?.id ?? ''),
    gameName: raw?.gameName ?? '',
    gameType: raw?.gameType === 'bracket' ? 'bracket' : 'pool',
    status: ['live', 'final', 'delayed'].includes(raw?.status) ? raw.status : 'scheduled',
    startDate: raw?.startDate ?? null,
    startTime: raw?.startTime ?? null,
    field: raw?.field ?? undefined,
    park: raw?.park ?? undefined,
    bracketName: raw?.bracketName ?? undefined,
    delayReason: raw?.delayReason ?? undefined,
    team1: adaptBoxscoreTeam(raw?.team1),
    team2: adaptBoxscoreTeam(raw?.team2)
  }
}

export async function fetchDivisionGames(
  slug: string,
  divisionId: string
): Promise<PublicDivisionGames> {
  const data = await fetchPublic<any>(
    `/public/events/${encodeURIComponent(slug)}/divisions/${encodeURIComponent(divisionId)}/games`
  )
  return {
    divisionId: String(data?.divisionId ?? divisionId),
    divisionName: data?.divisionName ?? '',
    games: Array.isArray(data?.games) ? data.games.map(adaptBoxscoreGame) : []
  }
}

// ── Teams (grouped by age group) ───────────────────────────────────────────

export interface PublicEventTeam {
  id: string
  teamName: string
  avatarUrl?: string
  sport?: string
  gender?: string
  ageGroup?: string
  rating?: string
  city?: string
  state?: string
}

export interface PublicEventTeamGroup {
  ageGroup: string
  teamCount: number
  teams: PublicEventTeam[]
}

export interface PublicEventTeams {
  groups: PublicEventTeamGroup[]
  totalTeams: number
  /** Catalogues for the filter dropdowns (from the unfiltered set). */
  genders: string[]
  ratings: string[]
}

export interface PublicEventTeamsFilters {
  gender?: string
  rating?: string
}

function adaptTeam(raw: any): PublicEventTeam {
  return {
    id: String(raw?.id ?? ''),
    teamName: raw?.teamName ?? '',
    avatarUrl: raw?.avatarUrl ?? undefined,
    sport: raw?.sport ?? undefined,
    gender: raw?.gender ?? undefined,
    ageGroup: raw?.ageGroup ?? undefined,
    rating: raw?.rating ?? undefined,
    city: raw?.city ?? undefined,
    state: raw?.state ?? undefined
  }
}

export async function fetchEventTeams(
  slug: string,
  filters: PublicEventTeamsFilters = {}
): Promise<PublicEventTeams> {
  const params = new URLSearchParams()
  if (filters.gender) params.set('gender', filters.gender)
  if (filters.rating) params.set('rating', filters.rating)
  const qs = params.toString()
  const data = await fetchPublic<any>(
    `/public/events/${encodeURIComponent(slug)}/teams${qs ? `?${qs}` : ''}`
  )
  return {
    groups: Array.isArray(data?.groups)
      ? data.groups.map((g: any) => ({
          ageGroup: g?.ageGroup ?? 'N/A',
          teamCount: Number(g?.teamCount ?? (g?.teams?.length ?? 0)),
          teams: Array.isArray(g?.teams) ? g.teams.map(adaptTeam) : []
        }))
      : [],
    totalTeams: Number(data?.totalTeams ?? 0),
    genders: Array.isArray(data?.genders) ? data.genders.map(String) : [],
    ratings: Array.isArray(data?.ratings) ? data.ratings.map(String) : []
  }
}

// ── Field grid schedule ────────────────────────────────────────────────────
// Returns the exact `SchedulerPark` / `SchedulerGame` shapes the shared
// `MatchGeniFieldGrid` consumes, so no client-side reshaping is needed.

export interface PublicEventSchedule {
  parks: SchedulerPark[]
  games: SchedulerGame[]
}

export async function fetchEventSchedule(slug: string): Promise<PublicEventSchedule> {
  const data = await fetchPublic<any>(`/public/events/${encodeURIComponent(slug)}/schedule`)
  return {
    parks: Array.isArray(data?.parks) ? (data.parks as SchedulerPark[]) : [],
    games: Array.isArray(data?.games) ? (data.games as SchedulerGame[]) : []
  }
}
