// Wire (API) types for New Game Time → Events › Discover.
// Mirrors docs/api/newgametime-discover-events-api-contract.md.
// These describe the RAW response shape; the adapter maps them to the
// camelCase domain `DiscoverEvent` model in ../discoverEvents.

export interface ApiDiscoverEventAssociation {
  id: string | null
  name: string | null
}

export interface ApiDiscoverEventLocation {
  city: string | null
  state: string | null
  lat: string | null
  lng: string | null
}

export interface ApiDiscoverEvent {
  id: string
  guid: string | null
  slug: string | null
  name: string | null
  eventType: string | null
  startDate: string | null
  endDate: string | null
  timeZone: string | null
  dateRangeLabel: string | null
  status: string | null
  externalUrl: string | null
  association: ApiDiscoverEventAssociation | null
  directorName: string | null
  location: ApiDiscoverEventLocation | null
  avatarUrl: string | null
  isFollowing: boolean | null
  followId: string | null
  isUmpireOrAdmin: boolean | null
  // Present only on the "For You" feed endpoint.
  feedType?: string | null
  feedReason?: string | null
}

export interface ApiDiscoverEventsPaginator {
  data: ApiDiscoverEvent[]
  current_page: number
  per_page: number
  total: number
  last_page: number
}

// ── For You: live/result/upcoming game activity items ─────────────────────
export interface ApiFeedActivityTeam {
  id: string
  name: string | null
  score: number | null
  mine: boolean | null
}
export interface ApiFeedActivityItem {
  type: string // 'live' | 'result' | 'upcoming'
  gameId: string
  guid: string | null
  eventId: string | null
  eventName: string | null
  division: string | null
  startDate: string | null
  startTime: string | null
  reason: string | null
  teamOne: ApiFeedActivityTeam
  teamTwo: ApiFeedActivityTeam
}

export interface ApiDiscoverEventsResponse {
  responseStatus?: {
    message?: string
    statusCode?: number
    text?: string
  }
  data?: {
    events?: ApiDiscoverEventsPaginator | null
    availableYears?: number[] | null
    // Present only on the "For You" feed endpoint (page 1).
    activity?: ApiFeedActivityItem[] | null
  } | null
}

export interface ApiFollowResponse {
  responseStatus?: { statusCode?: number; message?: string }
  data?: { followId?: string } | null
}
