import { buildV2ApiUrl } from './config'
import { getAuthHeaders } from '../auth-session'
import { adaptDiscoverTeams } from './adapters/discoverTeams'
import type {
  ApiDiscoverTeamsResponse,
  ApiTeamFollowResponse
} from './contracts/discoverTeams'

// ── Domain model (camelCase) for the Teams cards ─────────────────────────────
// Co-located with the api entry point, mirroring how `DiscoverEvent` lives in
// discoverEvents.ts. Move to src/types.ts on merge-back if preferred.

export interface DiscoverTeamMember {
  id: string
  name?: string
  /** Fully-resolved CDN URL, opaque to the client. */
  avatarUrl?: string
}

export interface DiscoverTeam {
  id: string
  name: string
  /** Fully-resolved CDN URL, opaque to the client. */
  avatarUrl?: string
  ageGroup?: string
  rating?: string
  sportType?: string
  gender?: string
  city?: string
  state?: string
  wifApproved: boolean
  isFollowing: boolean
  followId?: string
  // ── My Teams only (the `mine` endpoint adds these) ─────────────────────────
  /** Total completed games (regular + tournament). Undefined on Discover/Following. */
  totalGames?: number
  won?: number
  lost?: number
  /** Total active teammates on the team. */
  memberCount?: number
  /** First few teammate avatars for the row cluster. */
  members?: DiscoverTeamMember[]
}

export interface DiscoverTeamsPage {
  teams: DiscoverTeam[]
  currentPage: number
  perPage: number
  total: number
  lastPage: number
}

/** Team-type options (Work / Sports / Family) — a fixed reference list, defined
 *  locally rather than fetched (mirrors the legacy "Sports" dropdown). The
 *  `team_type` column stores these lowercased; the backend matches
 *  case-insensitively, so the labels can be sent as-is. */
export const TEAM_TYPES = ['Work', 'Sports', 'Family'] as const

export interface DiscoverTeamsFilters {
  page?: number
  perPage?: number
  search?: string
  /** Age-group ids or names. */
  ageGroup?: string[]
  /** Rating ids. */
  rating?: string[]
  /** Team-type names (Work / Sports / Family). */
  teamType?: string[]
  gender?: string[]
  /** State names or 2-letter abbreviations. */
  state?: string[]
}

function buildQuery(filters: DiscoverTeamsFilters): string {
  const params = new URLSearchParams()
  if (filters.page) params.set('page', String(filters.page))
  if (filters.perPage) params.set('per_page', String(filters.perPage))
  if (filters.search) params.set('search', filters.search)
  if (filters.ageGroup?.length) params.set('ageGroup', filters.ageGroup.join(','))
  if (filters.rating?.length) params.set('rating', filters.rating.join(','))
  if (filters.teamType?.length) params.set('teamType', filters.teamType.join(','))
  if (filters.gender?.length) params.set('gender', filters.gender.join(','))
  if (filters.state?.length) params.set('state', filters.state.join(','))
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

async function fetchTeamsPath(
  path: string,
  filters: DiscoverTeamsFilters
): Promise<DiscoverTeamsPage> {
  const response = await fetch(buildV2ApiUrl(`${path}${buildQuery(filters)}`), {
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json'
    }
  })

  const envelope = (await response.json()) as ApiDiscoverTeamsResponse
  return adaptDiscoverTeams(envelope)
}

/** Fetch a page of Discover teams (all publicly-listable teams). Auth header is
 *  sent when available so `isFollowing` / `followId` resolve for the current
 *  user; the endpoint works anonymously too. */
export function fetchDiscoverTeams(filters: DiscoverTeamsFilters = {}): Promise<DiscoverTeamsPage> {
  return fetchTeamsPath('/discover/teams', filters)
}

/** Fetch a page of the current user's teams (auth required). */
export function fetchMyTeams(filters: DiscoverTeamsFilters = {}): Promise<DiscoverTeamsPage> {
  return fetchTeamsPath('/discover/teams/mine', filters)
}

/** Fetch a page of the teams the current user follows (auth required). */
export function fetchFollowingTeams(filters: DiscoverTeamsFilters = {}): Promise<DiscoverTeamsPage> {
  return fetchTeamsPath('/discover/teams/following', filters)
}

/** Follow a team. Returns the new follow id. */
export async function followTeam(teamId: string): Promise<string | undefined> {
  const response = await fetch(buildV2ApiUrl(`/discover/teams/${encodeURIComponent(teamId)}/follow`), {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json'
    }
  })
  const envelope = (await response.json()) as ApiTeamFollowResponse
  return envelope?.data?.followId
}

/** Unfollow a team. */
export async function unfollowTeam(teamId: string): Promise<void> {
  await fetch(buildV2ApiUrl(`/discover/teams/${encodeURIComponent(teamId)}/follow`), {
    method: 'DELETE',
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json'
    }
  })
}
