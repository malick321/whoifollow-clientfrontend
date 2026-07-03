import { getLegacyJson } from './client'
import type { BracketFormatOption } from '../types'

// Bracket-format catalogue client.
// --------------------------------
// Backed by the legacy `GET /getBracketFormats` endpoint (no `/v2`
// prefix, no request parameters). The backend returns the global list
// of bracket formats — Single Elimination, Double Elimination, Triple
// Elimination, 3 Game Guarantee, Round Robin — used anywhere a bracket
// format is chosen: event add/edit, bracket add/edit, division add/edit.
//
// Documented in `docs/api/shared-services-api-contract.md` §2.
//
// Graceful failure: any error returns an empty array so callers can
// render an empty <select> (or fall back to a static catalogue) without
// surfacing an alarming toast for a non-critical lookup.

interface RawBracketFormat {
  id: number | string
  bracket_name: string
  status?: number | string | null
  created_at?: string | null
  updated_at?: string | null
}

interface BracketFormatsEnvelope {
  statusCode?: number | null
  message?: string | null
  data?: {
    list?: RawBracketFormat[] | null
  } | null
}

// Page-lifetime cache. The catalogue is static reference data (changes
// only when an admin adds a format), and the same dropdown appears in
// several popups that can open repeatedly within one page (bracket
// add/edit, division add/edit, event add/edit). We cache the in-flight
// PROMISE — not just the resolved value — so concurrent callers that
// open near-simultaneously share a single network request, and every
// later popup reuses the resolved list without hitting the backend
// again. A failed fetch is NOT cached (the promise is cleared) so a
// transient error can be retried on the next open.
let formatsCache: Promise<BracketFormatOption[]> | null = null

async function loadBracketFormats(): Promise<BracketFormatOption[]> {
  const payload = await getLegacyJson<BracketFormatsEnvelope>('/getBracketFormats')
  const rows = payload?.data?.list ?? []
  return rows
    .filter((row) => row && row.bracket_name)
    .map((row) => ({
      id: String(row.id),
      name: row.bracket_name
    }))
}

/** Fetch the global bracket-format catalogue. Maps the legacy
 *  `{ id, bracket_name }` rows onto the shared `BracketFormatOption`
 *  `{ id, name }` shape the form controls bind to. Cached for the page
 *  lifetime (see `formatsCache`); resolves to `[]` on any error. */
export async function fetchBracketFormats(): Promise<BracketFormatOption[]> {
  if (formatsCache) return formatsCache
  const inFlight = loadBracketFormats().catch((err) => {
    // Drop the cache on failure so the next caller retries.
    formatsCache = null
    if (typeof console !== 'undefined') {
      console.warn('[bracketFormats] fetch failed.', err)
    }
    return [] as BracketFormatOption[]
  })
  formatsCache = inFlight
  return inFlight
}
