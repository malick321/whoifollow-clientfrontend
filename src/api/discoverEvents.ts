import { buildV2ApiUrl } from './config'
import { getAuthHeaders } from '../auth-session'
import { adaptDiscoverEvents } from './adapters/discoverEvents'
import type {
  ApiDiscoverEventsResponse,
  ApiFollowResponse
} from './contracts/discoverEvents'

// ── Domain model (camelCase) for the Discover Events card ────────────────────
// Co-located with the api entry point, mirroring how `TeamParticipationSummary`
// lives in participationPage.ts. Move to src/types.ts on merge-back if preferred.

export interface DiscoverEventAssociation {
  id?: string
  name: string
}

export interface DiscoverEventLocation {
  city?: string
  state?: string
  lat?: string
  lng?: string
}

export interface DiscoverEvent {
  id: string
  guid?: string
  /** SEO slug for the public event detail URL (`/event/:slug`). Falls back
   *  to the GUID server-side when an event hasn't been backfilled. */
  slug?: string
  name: string
  eventType: string
  /** ISO `YYYY-MM-DD` */
  startDate?: string
  endDate?: string
  timeZone?: string
  /** Server-formatted, e.g. "May 4 to Jun 30, 2026 (Pakistan Time)". */
  dateRangeLabel: string
  /** "2" => external-link event (use `externalUrl` instead of location). */
  status?: string
  externalUrl?: string
  association: DiscoverEventAssociation
  directorName?: string
  location: DiscoverEventLocation
  avatarUrl?: string
  isFollowing: boolean
  followId?: string
  isUmpireOrAdmin: boolean
  /** "For You" feed only: why this card surfaced. */
  feedType?: string
  feedReason?: string
}

/** A team side of a game activity item. */
export interface FeedActivityTeam {
  id: string
  name: string
  /** Runs (live/result); null for upcoming or when not yet scored. */
  score: number | null
  /** True when this is one of the user's followed teams. */
  mine: boolean
}

/** A "For You" game activity item (live / result / upcoming). */
export interface FeedActivityItem {
  type: 'live' | 'result' | 'upcoming'
  gameId: string
  guid?: string
  eventId?: string
  eventName?: string
  division?: string
  startDate?: string
  startTime?: string
  reason: string
  teamOne: FeedActivityTeam
  teamTwo: FeedActivityTeam
}

export interface DiscoverEventsPage {
  events: DiscoverEvent[]
  availableYears: number[]
  /** Live/result/upcoming game activity (For You feed, page 1 only). */
  activity: FeedActivityItem[]
  currentPage: number
  perPage: number
  total: number
  lastPage: number
}

export type EventScope = 'discover' | 'mine' | 'following'

export interface DiscoverEventsFilters {
  page?: number
  perPage?: number
  year?: number
  pastEvents?: boolean
  /** Association IDs. */
  associationIds?: string[]
  /** State names or 2-letter abbreviations. */
  states?: string[]
  /** Event-type names (e.g. League, Tournament). Used by My Events. */
  eventType?: string[]
  search?: string
  /** IANA timezone used to compute the upcoming/past split server-side. */
  timezone?: string
  /** Which list to return — the single `/discover/events` endpoint serves all. */
  scope?: EventScope
}

function buildQuery(filters: DiscoverEventsFilters): string {
  const params = new URLSearchParams()
  if (filters.scope) params.set('scope', filters.scope)
  if (filters.page) params.set('page', String(filters.page))
  if (filters.perPage) params.set('per_page', String(filters.perPage))
  if (filters.year) params.set('year', String(filters.year))
  if (filters.pastEvents) params.set('pastEvents', 'true')
  if (filters.associationIds?.length) params.set('associationIds', filters.associationIds.join(','))
  if (filters.states?.length) params.set('states', filters.states.join(','))
  if (filters.eventType?.length) params.set('eventType', filters.eventType.join(','))
  if (filters.search) params.set('search', filters.search)
  if (filters.timezone) params.set('timezone', filters.timezone)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

/** Fetch a page of Discover events. Auth header is sent when available so
 *  `isFollowing` / `isUmpireOrAdmin` resolve for the current user; the endpoint
 *  works anonymously too. */
export async function fetchDiscoverEvents(
  filters: DiscoverEventsFilters = {}
): Promise<DiscoverEventsPage> {
  const response = await fetch(buildV2ApiUrl(`/discover/events${buildQuery({ ...filters, scope: 'discover' })}`), {
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json'
    }
  })

  const envelope = (await response.json()) as ApiDiscoverEventsResponse
  return adaptDiscoverEvents(envelope)
}

/** Available start-years for the events filter, fetched separately from the
 *  list (the list no longer returns `availableYears`). `scope` matches the
 *  list scope so each tab gets its own relevant years. */
export async function fetchEventYears(scope: EventScope = 'discover'): Promise<number[]> {
  const response = await fetch(buildV2ApiUrl(`/discover/events/years?scope=${scope}`), {
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json'
    }
  })
  const envelope = (await response.json()) as { data?: { years?: number[] } }
  return (envelope?.data?.years ?? []).map((y) => Number(y)).filter((y) => !Number.isNaN(y))
}

/** Fetch a page of events the current user FOLLOWS (New Game Time → Events ›
 *  Following). Auth required — the endpoint scopes by the bearer token's user.
 *  Same return shape as `fetchDiscoverEvents` (reuses the adapter). */
export async function fetchFollowingEvents(
  filters: DiscoverEventsFilters = {}
): Promise<DiscoverEventsPage> {
  const response = await fetch(buildV2ApiUrl(`/discover/events${buildQuery({ ...filters, scope: 'following' })}`), {
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json'
    }
  })

  const envelope = (await response.json()) as ApiDiscoverEventsResponse
  return adaptDiscoverEvents(envelope)
}

/** Fetch a page of events the current user OWNS / MANAGES (New Game Time →
 *  Events › My Events). Auth required. Same return shape (reuses the adapter). */
export async function fetchMyEvents(
  filters: DiscoverEventsFilters = {}
): Promise<DiscoverEventsPage> {
  const response = await fetch(buildV2ApiUrl(`/discover/events${buildQuery({ ...filters, scope: 'mine' })}`), {
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json'
    }
  })

  const envelope = (await response.json()) as ApiDiscoverEventsResponse
  return adaptDiscoverEvents(envelope)
}

/** Fetch the personalized "For You" feed (New Game Time landing). Auth required —
 *  scoped by the bearer token's user. Items carry `feedType`/`feedReason`
 *  explaining why each surfaced. Same page shape (reuses the adapter). */
export async function fetchForYouFeed(
  filters: DiscoverEventsFilters = {}
): Promise<DiscoverEventsPage> {
  const response = await fetch(buildV2ApiUrl(`/discover/events/feed${buildQuery(filters)}`), {
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json'
    }
  })
  const envelope = (await response.json()) as ApiDiscoverEventsResponse
  return adaptDiscoverEvents(envelope)
}

/** Follow an event. Returns the new follow id. */
export async function followDiscoverEvent(eventId: string): Promise<string | undefined> {
  const response = await fetch(buildV2ApiUrl(`/discover/events/${encodeURIComponent(eventId)}/follow`), {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json'
    }
  })
  const envelope = (await response.json()) as ApiFollowResponse
  return envelope?.data?.followId
}

/** Unfollow an event. */
export async function unfollowDiscoverEvent(eventId: string): Promise<void> {
  await fetch(buildV2ApiUrl(`/discover/events/${encodeURIComponent(eventId)}/follow`), {
    method: 'DELETE',
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json'
    }
  })
}
