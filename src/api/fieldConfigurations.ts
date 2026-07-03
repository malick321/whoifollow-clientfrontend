// Field-configuration catalogue client.
// -------------------------------------
// The legacy per-sport endpoint (§5,
// `GET /v2/tournaments/field-configurations/sport-type/{id}`) is RETIRED —
// field configurations are now sourced from the unified sport-types resource
// (`GET /v2/sport-types/{id}`, see `shared-services-api-contract.md` §8).
// This client is kept as a thin wrapper so its only consumer — the Add/Edit
// Division form, whose sport type is fixed — stays unchanged: it still calls
// `fetchFieldConfigurations(sportsTypeId)` and gets back the same
// `FieldConfigurationOption[]` (`{ id, name, positions }`).
//
// The Add/Edit Event wizard does NOT use this — it loads the whole catalogue
// via `fetchSportTypes()` and reads `fieldConfigurations` off the chosen
// sport type directly (so it also gets the umpire configs in the same call).

import type { FieldConfigurationOption } from '../types'
import { fetchSportType } from './sportTypes'

/** Field configurations for a sport type, read off the unified sport-types
 *  resource. Resolves to `[]` on any error (or a missing `sportsTypeId`) —
 *  a non-critical lookup should never break the form. */
export async function fetchFieldConfigurations(
  sportsTypeId: number | string | null | undefined
): Promise<FieldConfigurationOption[]> {
  if (sportsTypeId == null || String(sportsTypeId).trim() === '') return []
  try {
    const sport = await fetchSportType(sportsTypeId)
    return sport?.fieldConfigurations ?? []
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.warn('[fieldConfigurations] fetch failed.', err)
    }
    return []
  }
}
