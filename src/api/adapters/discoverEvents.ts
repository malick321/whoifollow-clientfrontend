import type {
  ApiDiscoverEvent,
  ApiDiscoverEventsResponse,
  ApiFeedActivityItem,
  ApiFeedActivityTeam
} from '../contracts/discoverEvents'
import type {
  DiscoverEvent,
  DiscoverEventsPage,
  FeedActivityItem,
  FeedActivityTeam
} from '../discoverEvents'

function adaptActivityTeam(raw: ApiFeedActivityTeam): FeedActivityTeam {
  return {
    id: String(raw.id),
    name: raw.name ?? 'Team',
    score: typeof raw.score === 'number' ? raw.score : null,
    mine: !!raw.mine
  }
}

function adaptActivityItem(raw: ApiFeedActivityItem): FeedActivityItem {
  const type = raw.type === 'live' || raw.type === 'result' ? raw.type : 'upcoming'
  return {
    type,
    gameId: String(raw.gameId),
    guid: raw.guid ?? undefined,
    eventId: raw.eventId ?? undefined,
    eventName: raw.eventName ?? undefined,
    division: raw.division ?? undefined,
    startDate: raw.startDate ?? undefined,
    startTime: raw.startTime ?? undefined,
    reason: raw.reason ?? '',
    teamOne: adaptActivityTeam(raw.teamOne),
    teamTwo: adaptActivityTeam(raw.teamTwo)
  }
}

/** The backend already returns fully-resolved CDN URLs, ISO dates, and a
 *  server-formatted `dateRangeLabel`, so this adapter is a thin, defensive
 *  rename from the wire shape to the domain model — no URL building or date
 *  math here (that all lives server-side per the contract). */
function adaptDiscoverEvent(raw: ApiDiscoverEvent): DiscoverEvent {
  return {
    id: String(raw.id),
    guid: raw.guid ?? undefined,
    slug: raw.slug ?? undefined,
    name: raw.name ?? '',
    eventType: raw.eventType ?? '',
    startDate: raw.startDate ?? undefined,
    endDate: raw.endDate ?? undefined,
    timeZone: raw.timeZone ?? undefined,
    dateRangeLabel: raw.dateRangeLabel ?? '',
    status: raw.status ?? undefined,
    externalUrl: raw.externalUrl ?? undefined,
    association: {
      id: raw.association?.id ?? undefined,
      name: raw.association?.name ?? ''
    },
    directorName: raw.directorName ?? undefined,
    location: {
      city: raw.location?.city ?? undefined,
      state: raw.location?.state ?? undefined,
      lat: raw.location?.lat ?? undefined,
      lng: raw.location?.lng ?? undefined
    },
    avatarUrl: raw.avatarUrl ?? undefined,
    isFollowing: !!raw.isFollowing,
    followId: raw.followId ?? undefined,
    isUmpireOrAdmin: !!raw.isUmpireOrAdmin,
    feedType: raw.feedType ?? undefined,
    feedReason: raw.feedReason ?? undefined
  }
}

export function adaptDiscoverEvents(response: ApiDiscoverEventsResponse): DiscoverEventsPage {
  const paginator = response?.data?.events ?? null
  const rows = paginator?.data ?? []

  return {
    events: rows.map(adaptDiscoverEvent),
    availableYears: response?.data?.availableYears ?? [],
    activity: (response?.data?.activity ?? []).map(adaptActivityItem),
    currentPage: paginator?.current_page ?? 1,
    perPage: paginator?.per_page ?? 0,
    total: paginator?.total ?? rows.length,
    lastPage: paginator?.last_page ?? 1
  }
}
