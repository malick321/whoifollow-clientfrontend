import { getLegacyJson } from './client'
import type { AgeGroupOption } from '../types'

// Age-group catalogue client.
// ---------------------------
// Backed by the legacy `GET /getAgeGroup` endpoint (no `/v2` prefix, no
// request parameters) — a global reference list used wherever a division /
// team is restricted to specific age groups.
//
// Ratings used to live here too, but are now association-scoped CRUD — see
// `src/api/associationRatings.ts` + `association-ratings-api-contract.md`.
//
// Documented in `docs/api/shared-services-api-contract.md` §3.
//
// Page-lifetime promise cache (same strategy as `bracketFormats.ts`):
// these are static reference lists, so the in-flight promise is cached
// and shared across every popup that opens within one page. A failed
// fetch clears its cache so the next open retries. Any error resolves
// to an empty array — a non-critical lookup should never break a form.

interface RawAgeGroup {
  id: number | string
  name: string
  type?: number | null
  fieldconfig_id?: number | null
}

interface RawRating {
  id: number | string
  rate: string | null
}

/** A global rating option (id + display label). Used by the New Game Time
 *  Teams filter, which needs the full unscoped ratings catalogue (the
 *  association-scoped `fetchRatings` in associationRatings.ts is a different
 *  list). */
export interface RatingOption {
  id: string
  rate: string
}

interface ListEnvelope<T> {
  statusCode?: number | null
  message?: string | null
  data?: {
    list?: T[] | null
  } | null
}

// ── Age groups ───────────────────────────────────────────────────
let ageGroupsCache: Promise<AgeGroupOption[]> | null = null

async function loadAgeGroups(): Promise<AgeGroupOption[]> {
  const payload = await getLegacyJson<ListEnvelope<RawAgeGroup>>('/getAgeGroup')
  const rows = payload?.data?.list ?? []
  return rows
    .filter((row) => row && row.name)
    .map((row) => ({
      id: String(row.id),
      name: row.name,
      type: row.type ?? undefined,
      fieldConfigId: row.fieldconfig_id ?? null
    }))
}

/** Fetch the global age-group catalogue. Maps the legacy
 *  `{ id, name, type, fieldconfig_id }` rows onto `AgeGroupOption`.
 *  Cached for the page lifetime; resolves to `[]` on any error. */
export async function fetchAgeGroups(): Promise<AgeGroupOption[]> {
  if (ageGroupsCache) return ageGroupsCache
  const inFlight = loadAgeGroups().catch((err) => {
    ageGroupsCache = null
    if (typeof console !== 'undefined') {
      console.warn('[ageRatingCatalogue] /getAgeGroup fetch failed.', err)
    }
    return [] as AgeGroupOption[]
  })
  ageGroupsCache = inFlight
  return inFlight
}

// ── Ratings (global) ─────────────────────────────────────────────
// Backed by the legacy `GET /getAllRatings` (`ActionController@getAllRatings`)
// which returns the full unscoped ratings catalogue as `{ data: { list: [...] } }`.
let allRatingsCache: Promise<RatingOption[]> | null = null

async function loadAllRatings(): Promise<RatingOption[]> {
  const payload = await getLegacyJson<ListEnvelope<RawRating>>('/getAllRatings')
  const rows = payload?.data?.list ?? []
  return rows
    .filter((row) => row && row.rate)
    .map((row) => ({ id: String(row.id), rate: String(row.rate) }))
}

/** Fetch the global ratings catalogue (id + rate label). Cached for the page
 *  lifetime; resolves to `[]` on any error. */
export async function fetchAllRatings(): Promise<RatingOption[]> {
  if (allRatingsCache) return allRatingsCache
  const inFlight = loadAllRatings().catch((err) => {
    allRatingsCache = null
    if (typeof console !== 'undefined') {
      console.warn('[ageRatingCatalogue] /getAllRatings fetch failed.', err)
    }
    return [] as RatingOption[]
  })
  allRatingsCache = inFlight
  return inFlight
}
