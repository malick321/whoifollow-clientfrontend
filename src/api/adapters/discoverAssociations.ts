import type {
  ApiDiscoverAssociation,
  ApiDiscoverAssociationsResponse
} from '../contracts/discoverAssociations'
import type { DiscoverAssociation, DiscoverAssociationsPage } from '../discoverAssociations'

/** The backend already returns fully-resolved CDN logo URLs and camelCase
 *  fields, so this adapter is a thin, defensive rename from the wire shape to
 *  the domain model — no URL building here (that lives server-side per the
 *  contract). */
function adaptDiscoverAssociation(raw: ApiDiscoverAssociation): DiscoverAssociation {
  return {
    id: String(raw.id),
    guid: raw.guid ?? undefined,
    name: raw.name ?? '',
    shortName: raw.shortName ?? undefined,
    fullName: raw.fullName ?? undefined,
    logoUrl: raw.logoUrl ?? undefined,
    coverUrl: raw.coverUrl ?? undefined,
    description: raw.description ?? undefined,
    websiteUrl: raw.websiteUrl ?? undefined,
    facebookUrl: raw.facebookUrl ?? undefined,
    instagramUrl: raw.instagramUrl ?? undefined,
    city: raw.city ?? undefined,
    state: raw.state ?? undefined,
    followerCount: raw.followerCount ?? 0,
    teamCount: raw.teamCount ?? 0,
    upcomingEventCount: raw.upcomingEventCount ?? 0,
    isFollowing: !!raw.isFollowing,
    followId: raw.followId ?? undefined
  }
}

export function adaptDiscoverAssociations(
  response: ApiDiscoverAssociationsResponse
): DiscoverAssociationsPage {
  const paginator = response?.data?.associations ?? null
  const rows = paginator?.data ?? []

  return {
    associations: rows.map(adaptDiscoverAssociation),
    currentPage: paginator?.current_page ?? 1,
    perPage: paginator?.per_page ?? 0,
    total: paginator?.total ?? rows.length,
    lastPage: paginator?.last_page ?? 1
  }
}
