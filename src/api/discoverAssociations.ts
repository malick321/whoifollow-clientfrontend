import { buildV2ApiUrl } from './config'
import { getAuthHeaders } from '../auth-session'
import { adaptDiscoverAssociations } from './adapters/discoverAssociations'
import type {
  ApiDiscoverAssociationsResponse,
  ApiFollowResponse
} from './contracts/discoverAssociations'

// ── Domain model (camelCase) for the Discover Associations card ──────────────
// Co-located with the api entry point, mirroring how `DiscoverEvent` lives in
// discoverEvents.ts. Move to src/types.ts on merge-back if preferred.

export interface DiscoverAssociation {
  id: string
  guid?: string
  name: string
  shortName?: string
  fullName?: string
  /** Fully-resolved CDN logo URL (opaque to the client), or undefined. */
  logoUrl?: string
  /** Fully-resolved CDN cover/banner URL (opaque to the client), or undefined. */
  coverUrl?: string
  /** Short association blurb (from `notes`). */
  description?: string
  websiteUrl?: string
  facebookUrl?: string
  instagramUrl?: string
  city?: string
  state?: string
  followerCount: number
  teamCount: number
  /** Count of upcoming/ongoing public events under this association. */
  upcomingEventCount: number
  isFollowing: boolean
  followId?: string
}

export interface DiscoverAssociationsPage {
  associations: DiscoverAssociation[]
  currentPage: number
  perPage: number
  total: number
  lastPage: number
}

export interface DiscoverAssociationsFilters {
  page?: number
  perPage?: number
  search?: string
}

function buildQuery(filters: DiscoverAssociationsFilters): string {
  const params = new URLSearchParams()
  if (filters.page) params.set('page', String(filters.page))
  if (filters.perPage) params.set('per_page', String(filters.perPage))
  if (filters.search) params.set('search', filters.search)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

/** Fetch a page of Discover associations. Auth header is sent when available so
 *  `isFollowing` / `followId` resolve for the current user; the endpoint works
 *  anonymously too. */
export async function fetchDiscoverAssociations(
  filters: DiscoverAssociationsFilters = {}
): Promise<DiscoverAssociationsPage> {
  const response = await fetch(buildV2ApiUrl(`/discover/associations${buildQuery(filters)}`), {
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json'
    }
  })

  const envelope = (await response.json()) as ApiDiscoverAssociationsResponse
  return adaptDiscoverAssociations(envelope)
}

/** Fetch a page of associations the current user follows (auth required). */
export async function fetchFollowingAssociations(
  filters: DiscoverAssociationsFilters = {}
): Promise<DiscoverAssociationsPage> {
  const response = await fetch(
    buildV2ApiUrl(`/discover/associations/following${buildQuery(filters)}`),
    {
      headers: {
        ...getAuthHeaders(),
        Accept: 'application/json'
      }
    }
  )

  const envelope = (await response.json()) as ApiDiscoverAssociationsResponse
  return adaptDiscoverAssociations(envelope)
}

/** Follow an association. Returns the new follow id. */
export async function followDiscoverAssociation(
  associationId: string
): Promise<string | undefined> {
  const response = await fetch(
    buildV2ApiUrl(`/discover/associations/${encodeURIComponent(associationId)}/follow`),
    {
      method: 'POST',
      headers: {
        ...getAuthHeaders(),
        Accept: 'application/json'
      }
    }
  )
  const envelope = (await response.json()) as ApiFollowResponse
  return envelope?.data?.followId
}

/** Unfollow an association. */
export async function unfollowDiscoverAssociation(associationId: string): Promise<void> {
  await fetch(
    buildV2ApiUrl(`/discover/associations/${encodeURIComponent(associationId)}/follow`),
    {
      method: 'DELETE',
      headers: {
        ...getAuthHeaders(),
        Accept: 'application/json'
      }
    }
  )
}
