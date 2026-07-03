import type {
  CreateParkPayload,
  EventFacilityPayload,
  NearbyParkResult,
  Park,
  ParkFieldInUse,
  PlaceSuggestion
} from '../types'

// MatchGeni Parks (playing facilities) API — mock
// -----------------------------------------------
// Backs the "Add Playing Facility" wizard:
//   1. searchPlaces      — location autocomplete (Google Places-shaped;
//                          mock now, real Places Autocomplete is a
//                          drop-in — see "Maps-ready" note below).
//   2. checkNearbyPark   — does a WIF park already exist within
//                          NEARBY_RADIUS_M of the picked coordinates?
//                          → existing park (skip create) or null (→ the
//                          create-park popup).
//   3. createPark        — create a brand-new park from a picked place +
//                          a default field count.
//   4. saveEventFacility — attach a park to the event with its selected
//                          fields + per-day scheduling window.
//
// Maps-ready: `searchPlaces` returns Google-Places-shaped suggestions
// (placeId/name/address/lat/lng). Swapping the mock body for a real
// Places Autocomplete + Geocoding call is a drop-in — callers only see
// `PlaceSuggestion`.
//
// v1 is mock-only; the real endpoints are drafted in
// `docs/api/matchgeni-park-api-contract.md` (DRAFT — finalised jointly
// with the user later). The frontend types live in `src/types.ts`.

const SIMULATED_LATENCY_MS = 240

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), SIMULATED_LATENCY_MS))
}

/** Radius (metres) within which an existing park is treated as the same
 *  venue (skip the create-park step). Mirrors the backend's dedupe. */
export const NEARBY_RADIUS_M = 200

// ── Mock geo data ────────────────────────────────────────────────────
// A small catalogue of plausible places the autocomplete can surface,
// plus a couple of already-existing WIF parks to exercise the nearby
// branch. Coordinates are real-ish but not load-bearing.

const MOCK_PLACES: PlaceSuggestion[] = [
  {
    placeId: 'place-arbab-niaz',
    name: 'Arbab Niaz Cricket Stadium',
    address: 'University Rd, Peshawar, Khyber Pakhtunkhwa, Pakistan',
    latitude: 34.0019,
    longitude: 71.5571
  },
  {
    placeId: 'place-imran-khan',
    name: 'Imran Khan Cricket Stadium',
    address: 'Shahi Bagh, Peshawar, Khyber Pakhtunkhwa, Pakistan',
    latitude: 34.0123,
    longitude: 71.5468
  },
  {
    placeId: 'place-gaddafi',
    name: 'Gaddafi Stadium',
    address: 'Ferozepur Rd, Lahore, Punjab, Pakistan',
    latitude: 31.5132,
    longitude: 74.3331
  },
  {
    placeId: 'place-national',
    name: 'National Stadium Karachi',
    address: 'Stadium Rd, Karachi, Sindh, Pakistan',
    latitude: 24.8924,
    longitude: 67.0652
  },
  {
    placeId: 'place-pindi',
    name: 'Rawalpindi Cricket Stadium',
    address: 'Bahria Town Rd, Rawalpindi, Punjab, Pakistan',
    latitude: 33.6361,
    longitude: 73.0479
  },
  {
    placeId: 'place-multan',
    name: 'Multan Cricket Stadium',
    address: 'Vehari Rd, Multan, Punjab, Pakistan',
    latitude: 30.2255,
    longitude: 71.5249
  },
  {
    placeId: 'place-diamond-sf',
    name: 'Diamond Sports Complex',
    address: '1200 Roberts Ave, San Jose, CA, USA',
    latitude: 37.3019,
    longitude: -121.8743
  },
  {
    placeId: 'place-riverside',
    name: 'Riverside Athletic Fields',
    address: '88 Riverside Dr, Austin, TX, USA',
    latitude: 30.2422,
    longitude: -97.7431
  }
]

/** Existing WIF parks keyed loosely to the mock places, so the nearby
 *  check returns a hit for some picks and a miss (→ create) for others. */
const EXISTING_PARKS: Park[] = [
  {
    id: 'park-gaddafi',
    name: 'Gaddafi Stadium',
    address: 'Ferozepur Rd, Lahore, Punjab, Pakistan',
    city: 'Lahore',
    state: 'Punjab',
    latitude: '31.5132',
    longitude: '74.3331',
    fieldsInUse: [
      { id: 'gaddafi-f1', name: 'Main Ground' },
      { id: 'gaddafi-f2', name: 'Practice Field A' },
      { id: 'gaddafi-f3', name: 'Practice Field B' }
    ]
  },
  {
    id: 'park-national',
    name: 'National Stadium Karachi',
    address: 'Stadium Rd, Karachi, Sindh, Pakistan',
    city: 'Karachi',
    state: 'Sindh',
    latitude: '24.8924',
    longitude: '67.0652',
    fieldsInUse: [
      { id: 'national-f1', name: 'Field 1' },
      { id: 'national-f2', name: 'Field 2' },
      { id: 'national-f3', name: 'Field 3' },
      { id: 'national-f4', name: 'Field 4' }
    ]
  }
]

// Parks created during this session (the create-park flow). Persisted in
// memory so a re-check after creating returns the new park.
const CREATED_PARKS: Park[] = []

let createdParkSeq = 0
let createdFieldSeq = 0

/** Haversine distance in metres between two lat/lng points. */
function distanceMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const R = 6_371_000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const lat1 = toRad(aLat)
  const lat2 = toRad(bLat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function parkLatLng(park: Park): { lat: number; lng: number } | null {
  if (park.latitude == null || park.longitude == null) return null
  const lat = Number(park.latitude)
  const lng = Number(park.longitude)
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null
  return { lat, lng }
}

// ── API ──────────────────────────────────────────────────────────────

/** Location autocomplete. Returns Google-Places-shaped suggestions for a
 *  free-text query (case-insensitive substring over name + address). An
 *  empty/short query returns a short default list so the dropdown isn't
 *  blank on focus. */
export async function searchPlaces(query: string): Promise<PlaceSuggestion[]> {
  const q = query.trim().toLowerCase()
  if (q.length < 2) {
    return delay(MOCK_PLACES.slice(0, 5).map((p) => ({ ...p })))
  }
  const matches = MOCK_PLACES.filter(
    (p) =>
      p.name.toLowerCase().includes(q) || p.address.toLowerCase().includes(q)
  )
  return delay(matches.map((p) => ({ ...p })))
}

/** Does a WIF park already exist within NEARBY_RADIUS_M of the picked
 *  coordinates? Returns the existing park (→ skip create) or `null` (→
 *  show the create-park popup). Checks created-this-session parks too. */
export async function checkNearbyPark(
  _associationId: string,
  _eventId: string,
  latitude: number,
  longitude: number
): Promise<NearbyParkResult> {
  const candidates = [...EXISTING_PARKS, ...CREATED_PARKS]
  let nearest: Park | null = null
  let nearestDist = Infinity
  for (const park of candidates) {
    const coords = parkLatLng(park)
    if (!coords) continue
    const dist = distanceMeters(latitude, longitude, coords.lat, coords.lng)
    if (dist < nearestDist) {
      nearestDist = dist
      nearest = park
    }
  }
  const park = nearest && nearestDist <= NEARBY_RADIUS_M ? { ...nearest } : null
  return delay({ park })
}

/** Create a new park from a picked place + a default number of fields.
 *  The park is persisted in-session so a subsequent nearby check finds
 *  it. Fields are auto-named "Field 1…N". */
export async function createPark(
  _associationId: string,
  payload: CreateParkPayload
): Promise<Park> {
  // place_id dedup (primary identity) — if we've already created a park for
  // this exact Google place this session, reuse it instead of duplicating.
  // The real backend dedups by place_id first, lat/long-radius only as a
  // fallback for venues with no place_id.
  if (payload.placeId) {
    const existing = [...EXISTING_PARKS, ...CREATED_PARKS].find((p) => p.placeId === payload.placeId)
    if (existing) {
      return delay({ ...existing, fieldsInUse: (existing.fieldsInUse ?? []).map((f) => ({ ...f })) })
    }
  }
  createdParkSeq += 1
  const count = Math.max(1, Math.floor(payload.fieldCount))
  const fieldsInUse: ParkFieldInUse[] = Array.from({ length: count }, () => {
    createdFieldSeq += 1
    return { id: `new-field-${createdFieldSeq}`, name: `Field ${createdFieldSeq}` }
  })
  // Re-number field labels 1..N for a clean default set.
  fieldsInUse.forEach((f, i) => {
    f.name = `Field ${i + 1}`
  })
  const park: Park = {
    id: `new-park-${createdParkSeq}`,
    name: payload.name,
    placeId: payload.placeId,
    address: payload.address,
    latitude: String(payload.latitude),
    longitude: String(payload.longitude),
    fieldsInUse
  }
  CREATED_PARKS.push({ ...park, fieldsInUse: fieldsInUse.map((f) => ({ ...f })) })
  return delay({ ...park, fieldsInUse: fieldsInUse.map((f) => ({ ...f })) })
}

/** Add a field to a park (the "Add field" affordance in step 2). Mock —
 *  returns the created field; the caller appends it to its working set. */
export async function addParkField(
  _associationId: string,
  parkId: string,
  name: string
): Promise<ParkFieldInUse> {
  createdFieldSeq += 1
  const field: ParkFieldInUse = { id: `new-field-${createdFieldSeq}`, name }
  const park = CREATED_PARKS.find((p) => p.id === parkId)
  if (park) {
    park.fieldsInUse = [...(park.fieldsInUse ?? []), { ...field }]
  }
  return delay({ ...field })
}

/** Attach a park to the event with its selected fields + per-day
 *  scheduling window. Mock — resolves with the saved park id. */
export async function saveEventFacility(
  _associationId: string,
  _eventId: string,
  payload: EventFacilityPayload
): Promise<{ parkId: string }> {
  return delay({ parkId: payload.parkId })
}
