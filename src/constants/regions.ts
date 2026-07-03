// regions
// -------
// Shared catalogue of geographic regions a team registration can belong to.
// Region is a coarse grouping ABOVE state level (e.g. "Southwest") used by the
// association to organize teams. Starts US-only; structured by country so other
// countries can be added later without touching consumers.
//
// Mirrored in docs/system/shared-catalogues.md (single source of truth shared
// with the backend). Stored on `association_teams.region` (free VARCHAR), so the
// catalogue value is submitted verbatim.

export interface RegionOption {
  /** Stored + submitted value (also the display label — they're identical
   *  today, but kept distinct so a value can be relabeled without a data
   *  migration). */
  value: string
  label: string
}

/** United States regions. Directional groupings used by SSUSA-style
 *  associations. NOTE: starter set — confirm/adjust to match the real
 *  registration data before go-live. */
export const US_REGIONS: RegionOption[] = [
  { value: 'North', label: 'North' },
  { value: 'South', label: 'South' },
  { value: 'East', label: 'East' },
  { value: 'West', label: 'West' },
  { value: 'Northeast', label: 'Northeast' },
  { value: 'Northwest', label: 'Northwest' },
  { value: 'Southeast', label: 'Southeast' },
  { value: 'Southwest', label: 'Southwest' },
  { value: 'Midwest', label: 'Midwest' },
  { value: 'Far East', label: 'Far East' },
  { value: 'Far West', label: 'Far West' }
]

/** Region catalogue keyed by country ISO. Add new countries here. */
export const REGION_CATALOGUE: Record<string, RegionOption[]> = {
  US: US_REGIONS
}

/** Regions for a country (defaults to US). */
export function regionsForCountry(countryIso = 'US'): RegionOption[] {
  return REGION_CATALOGUE[countryIso] ?? US_REGIONS
}
