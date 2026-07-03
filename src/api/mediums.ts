// mediums
// -------
// Online-event medium catalogue (Zoom, YouTube Live, …) for the Add/Edit
// Event wizard's Online location step. Backed by `shared-services-api-contract.md`
// §7 (`GET /v2/mediums`, PROVISIONAL) + the `mediums` table
// (`sql-schema-shared.md#mediums`). Mock-first until the endpoint ships —
// swap `MOCK_MEDIUMS` for a `fetchEnvelope` call then; the signature stays.

import type { MediumOption } from '../types'

const MOCK_MEDIUMS: MediumOption[] = [
  { id: '1', name: 'Zoom' },
  { id: '2', name: 'YouTube Live' },
  { id: '3', name: 'Google Meet' },
  { id: '4', name: 'Microsoft Teams' },
  { id: '5', name: 'Facebook Live' },
  { id: '6', name: 'Twitch' }
]

// Page-cached promise (mirrors the other catalogue clients) so repeated
// opens of the wizard don't refetch.
let cached: Promise<MediumOption[]> | null = null

/** Resolves the active online mediums. Resolves to `[]` on any error
 *  (non-critical lookup — the Online step just renders an empty picker). */
export async function fetchMediums(): Promise<MediumOption[]> {
  if (!cached) {
    cached = Promise.resolve(MOCK_MEDIUMS)
  }
  try {
    return await cached
  } catch {
    return []
  }
}
