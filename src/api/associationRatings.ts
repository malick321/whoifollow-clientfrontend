// associationRatings
// ------------------
// Association-scoped team ratings (skill tiers). Each association manages
// its own set from Settings → Ratings (e.g. SSUSA: AA / AAA / Major / Major+;
// PSA: REC / COMP). Replaces the global legacy `GET /getAllRatings`.
//
// Backed by `/v2/association/{associationId}/ratings` CRUD — see
// `docs/api/association-ratings-api-contract.md`. Mock-first (mirrors
// `mediums.ts` / `customFields.ts`) — flip `RATINGS_LIVE` + wire the
// fetchEnvelope branches once the endpoints ship.

import { getJson, postJson, patchJson, deleteJson } from './client'
import type { RatingOption, RatingInput } from '../types'

const RATINGS_LIVE = true

/** Standard v2 envelope. */
interface Envelope<T> {
  responseStatus?: { statusCode: number; message?: string; text?: string }
  data: T
}

interface StoredRating {
  id: number
  association_short: string   // owning association (mock scope)
  rate: string
  sort_order: number
  status: number              // 1 = active
}

let MOCK_RATINGS: StoredRating[] = [
  { id: 1, association_short: 'ssusa', rate: 'AA', sort_order: 1, status: 1 },
  { id: 2, association_short: 'ssusa', rate: 'AAA', sort_order: 2, status: 1 },
  { id: 3, association_short: 'ssusa', rate: 'Major', sort_order: 3, status: 1 },
  { id: 4, association_short: 'ssusa', rate: 'Major +', sort_order: 4, status: 1 },
  { id: 5, association_short: 'psa', rate: 'REC', sort_order: 1, status: 1 },
  { id: 6, association_short: 'psa', rate: 'COMP', sort_order: 2, status: 1 }
]
let nextId = 7

function mapRating(r: StoredRating): RatingOption {
  return { id: String(r.id), name: r.rate, sortOrder: r.sort_order, active: r.status === 1 }
}

// Page-cached per association (active-only) for the picker consumers.
const cacheByAssoc = new Map<string, Promise<RatingOption[]>>()
function assocKey(opts: { associationId?: string; associationShortName?: string }): string {
  return `${opts.associationId ?? ''}|${(opts.associationShortName ?? '').toLowerCase()}`
}
function invalidate() { cacheByAssoc.clear() }

/** Active ratings for an association (the division-form picker). Resolves to
 *  `[]` on any error — a non-critical lookup should never break the form. */
export async function fetchRatings(
  opts: { associationId?: string; associationShortName?: string }
): Promise<RatingOption[]> {
  const key = assocKey(opts)
  const hit = cacheByAssoc.get(key)
  if (hit) return hit
  const inFlight = loadRatings(opts, true).catch((err) => {
    cacheByAssoc.delete(key)
    if (typeof console !== 'undefined') console.warn('[associationRatings] fetch failed.', err)
    return [] as RatingOption[]
  })
  cacheByAssoc.set(key, inFlight)
  return inFlight
}

/** All ratings for an association incl. inactive (the Settings manager). */
export async function fetchAllRatings(
  opts: { associationId?: string; associationShortName?: string }
): Promise<RatingOption[]> {
  return loadRatings(opts, false)
}

async function loadRatings(
  opts: { associationId?: string; associationShortName?: string },
  activeOnly: boolean
): Promise<RatingOption[]> {
  if (RATINGS_LIVE) {
    // GET /v2/association/{associationId}/ratings[?active=1]. `data` is the
    // camelCase `RatingOption` shape — tolerate both the documented
    // `{ data: { list: [...] } }` and a bare `{ data: [...] }` (some v2
    // endpoints ship `data` as a bare array; without this a bare response
    // reads as empty).
    const id = encodeURIComponent(opts.associationId ?? '')
    const env = await getJson<Envelope<{ list: RatingOption[] }>>(
      `/association/${id}/ratings${activeOnly ? '?active=1' : ''}`
    )
    const data: unknown = (env as { data?: unknown })?.data
    if (Array.isArray(data)) return data as RatingOption[]
    const list = (data as { list?: unknown } | null | undefined)?.list
    return Array.isArray(list) ? (list as RatingOption[]) : []
  }
  const assoc = (opts.associationShortName ?? '').toLowerCase()
  return MOCK_RATINGS
    .filter((r) => !assoc || r.association_short === assoc)
    .filter((r) => !activeOnly || r.status === 1)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(mapRating)
}

export async function createRating(
  opts: { associationId: string; associationShortName?: string },
  input: RatingInput
): Promise<RatingOption> {
  if (RATINGS_LIVE) {
    const id = encodeURIComponent(opts.associationId)
    const env = await postJson<Envelope<RatingOption>>(`/association/${id}/ratings`, {
      name: input.name.trim(),
      sortOrder: input.sortOrder,
      active: input.active ?? true
    })
    invalidate()
    return env.data
  }
  const r: StoredRating = {
    id: nextId++,
    association_short: (opts.associationShortName ?? '').toLowerCase(),
    rate: input.name.trim(),
    sort_order: input.sortOrder,
    status: input.active === false ? 0 : 1
  }
  MOCK_RATINGS.push(r)
  invalidate()
  return mapRating(r)
}

export async function updateRating(
  associationId: string,
  id: string,
  input: RatingInput
): Promise<RatingOption> {
  if (RATINGS_LIVE) {
    const env = await patchJson<Envelope<RatingOption>>(
      `/association/${encodeURIComponent(associationId)}/ratings/${encodeURIComponent(id)}`,
      { name: input.name.trim(), sortOrder: input.sortOrder, active: input.active }
    )
    invalidate()
    return env.data
  }
  const r = MOCK_RATINGS.find((x) => String(x.id) === id)
  if (!r) throw new Error('Rating not found.')
  r.rate = input.name.trim()
  r.sort_order = input.sortOrder
  if (input.active !== undefined) r.status = input.active ? 1 : 0
  invalidate()
  return mapRating(r)
}

export async function deleteRating(associationId: string, id: string): Promise<void> {
  // RESTRICT in the schema: an in-use rating is retired (soft-deleted) by the
  // backend rather than destroyed (the response `data.mode` reports which).
  if (RATINGS_LIVE) {
    await deleteJson<Envelope<{ id: string; mode: string }>>(
      `/association/${encodeURIComponent(associationId)}/ratings/${encodeURIComponent(id)}`
    )
    invalidate()
    return
  }
  // The mock has no division refs, so just remove.
  MOCK_RATINGS = MOCK_RATINGS.filter((x) => String(x.id) !== id)
  invalidate()
}
