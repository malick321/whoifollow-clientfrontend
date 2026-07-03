// Wire (API) types for New Game Time → Associations › Discover / Following.
// Mirrors docs/api/newgametime-associations-api-contract.md.
// These describe the RAW response shape; the adapter maps them to the
// camelCase domain `DiscoverAssociation` model in ../discoverAssociations.

export interface ApiDiscoverAssociation {
  id: string
  guid: string | null
  name: string | null
  shortName: string | null
  fullName: string | null
  logoUrl: string | null
  coverUrl: string | null
  description: string | null
  websiteUrl: string | null
  facebookUrl: string | null
  instagramUrl: string | null
  city: string | null
  state: string | null
  followerCount: number | null
  teamCount: number | null
  upcomingEventCount: number | null
  isFollowing: boolean | null
  followId: string | null
}

export interface ApiDiscoverAssociationsPaginator {
  data: ApiDiscoverAssociation[]
  current_page: number
  per_page: number
  total: number
  last_page: number
}

export interface ApiDiscoverAssociationsResponse {
  responseStatus?: {
    message?: string
    statusCode?: number
    text?: string
  }
  data?: {
    associations?: ApiDiscoverAssociationsPaginator | null
  } | null
}

export interface ApiFollowResponse {
  responseStatus?: { statusCode?: number; message?: string }
  data?: { followId?: string } | null
}
