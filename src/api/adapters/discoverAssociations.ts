import type {
  ApiDiscoverAssociation,
  ApiDiscoverAssociationsResponse
} from '../contracts/discoverAssociations'
import { buildAssociationLogoUrl } from '../config'
import type { DiscoverAssociation, DiscoverAssociationsPage } from '../discoverAssociations'

type LooseRecord = Record<string, unknown>

function asRecord(value: unknown): LooseRecord {
  return value && typeof value === 'object' ? (value as LooseRecord) : {}
}

function pickString(source: LooseRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return undefined
}

function pickNumber(source: LooseRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
      return Number(value)
    }
  }
  return undefined
}

function pickBoolean(source: LooseRecord, keys: string[]): boolean {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return value === 1
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase()
      if (['1', 'true', 'yes'].includes(normalized)) return true
      if (['0', 'false', 'no'].includes(normalized)) return false
    }
  }
  return false
}

function adaptDiscoverAssociation(raw: ApiDiscoverAssociation): DiscoverAssociation {
  const source = asRecord(raw)
  const guid = pickString(source, ['guid', 'associationGuid', 'association_guid'])

  return {
    id: String(source.id ?? source.association_id ?? ''),
    guid,
    name: pickString(source, ['name', 'association_name', 'associationName', 'title']) ?? '',
    shortName: pickString(source, ['shortName', 'short_name']),
    fullName: pickString(source, ['fullName', 'full_name']),
    logoUrl: buildAssociationLogoUrl(
      pickString(source, ['logoUrl', 'logo_url', 'logo', 'association_logo', 'imageUrl', 'image_url', 'image']),
      guid
    ),
    coverUrl: pickString(source, ['coverUrl', 'cover_url', 'cover', 'bannerUrl', 'banner_url']),
    description: pickString(source, ['description', 'notes', 'bio']),
    websiteUrl: pickString(source, ['websiteUrl', 'website_url', 'website']),
    facebookUrl: pickString(source, ['facebookUrl', 'facebook_url', 'fb_url']),
    instagramUrl: pickString(source, ['instagramUrl', 'instagram_url', 'insta_url']),
    city: pickString(source, ['city']),
    state: pickString(source, ['state']),
    followerCount: pickNumber(source, ['followerCount', 'follower_count', 'followers_count']) ?? 0,
    teamCount: pickNumber(source, ['teamCount', 'team_count', 'teams_count']) ?? 0,
    upcomingEventCount:
      pickNumber(source, ['upcomingEventCount', 'upcoming_event_count', 'events_count', 'eventCount']) ?? 0,
    isFollowing: pickBoolean(source, ['isFollowing', 'is_following', 'following']),
    followId: pickString(source, ['followId', 'follow_id'])
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
