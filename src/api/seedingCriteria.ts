import { getJson } from './client'
import type { SeedingCriterionOption } from '../types'

// Seeding-criteria ("seeders") catalogue client.
// ----------------------------------------------
// The global list of tie-break seeding criteria available across the WIF
// system (W/L, Head to Head, Runs Against, Run Differential, Runs Scored,
// Coin Flip) that an admin picks from to build an event-level default order
// (and a division can override). Used by the Add/Edit Event wizard AND the
// Add/Edit Division Seed step.
//
// v2: `GET /v2/seeders` — standard envelope, camelCase `{ id, name }` list.
// Replaces the legacy `GET /associationEvent/fetchFilteredSeedars` (snake_case
// `criteria_name`, bare `data[]`). Documented in
// `docs/api/shared-services-api-contract.md` §6.
//
// Mock-first (mirrors `mediums.ts` / `sportTypes.ts`) — flip `SEEDERS_LIVE`
// once the endpoint ships; the signature stays. Page-lifetime promise cache:
// static reference data, so the in-flight promise is shared across popups; a
// failed fetch clears the cache so the next open retries, and any error
// resolves to an empty array (a non-critical lookup never breaks a form).

const SEEDERS_LIVE = false

// The WIF-wide seeding-criteria catalogue (display order = list order).
const MOCK_SEEDERS: SeedingCriterionOption[] = [
  { id: '1', name: 'Win / Loss' },
  { id: '2', name: 'Head to Head' },
  { id: '3', name: 'Runs Against' },
  { id: '4', name: 'Run Differential' },
  { id: '5', name: 'Runs Scored' },
  { id: '6', name: 'Coin Flip' }
]

/** Raw `/v2/seeders` row (camelCase, v2 envelope). */
interface RawSeeder {
  id: number | string
  name: string
}
interface SeedersEnvelope {
  data?: { list?: RawSeeder[] | null } | null
}

let cache: Promise<SeedingCriterionOption[]> | null = null

async function loadSeeders(): Promise<SeedingCriterionOption[]> {
  if (!SEEDERS_LIVE) return MOCK_SEEDERS
  const payload = await getJson<SeedersEnvelope>('/seeders')
  const rows = payload?.data?.list ?? []
  return rows
    .filter((row) => row && row.name)
    .map((row) => ({ id: String(row.id), name: row.name }))
}

/** Fetch the global seeding-criteria catalogue (`{ id, name }`). Cached for
 *  the page lifetime; resolves to `[]` on any error. */
export async function fetchSeedingCriteria(): Promise<SeedingCriterionOption[]> {
  if (cache) return cache
  const inFlight = loadSeeders().catch((err) => {
    cache = null
    if (typeof console !== 'undefined') {
      console.warn('[seedingCriteria] /v2/seeders fetch failed.', err)
    }
    return [] as SeedingCriterionOption[]
  })
  cache = inFlight
  return inFlight
}
