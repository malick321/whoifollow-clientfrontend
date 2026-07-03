import type { CreateHotelPayload, EventHotel } from '../types'

// MatchGeni Hotels API — mock
// ---------------------------
// Backs the in-map "Add Hotel" wizard (Map Explorer). `createHotel` takes
// the form payload (prefilled from a Google Place) and returns a stored
// `EventHotel` the dashboard drops onto the map. Mock-first, mirroring the
// `delay()` + `*_ENDPOINT_LIVE = false` convention used across the
// MatchGeni mocks (e.g. `matchGeniParks.ts`).
//
// v1 is mock-only; the real endpoint is drafted alongside the parks
// contract. Frontend types live in `src/types.ts`.

const SIMULATED_LATENCY_MS = 240
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const HOTELS_ENDPOINT_LIVE = false

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), SIMULATED_LATENCY_MS))
}

// Hotels created during this session (persisted in memory so a re-open of
// the dashboard within the session keeps them — same pattern as parks).
const CREATED_HOTELS: EventHotel[] = []
let createdHotelSeq = 0

/** Build a single-line address from the payload's parts. */
function composeAddress(p: CreateHotelPayload): string {
  return [p.street, p.city, p.state, p.postalCode]
    .filter((x): x is string => !!x && x.trim().length > 0)
    .join(', ')
}

/** Create a hotel for an event from the in-map add form. Mock — stamps an
 *  id + active status and returns the stored `EventHotel`. */
export async function createHotel(
  _associationId: string,
  eventId: string,
  payload: CreateHotelPayload
): Promise<EventHotel> {
  // place_id dedup (primary identity) — reuse an already-created hotel for
  // this exact Google place rather than duplicating it.
  if (payload.placeId) {
    const existing = CREATED_HOTELS.find((h) => h.placeId === payload.placeId)
    if (existing) return delay({ ...existing })
  }
  createdHotelSeq += 1
  const hotel: EventHotel = {
    id: `new-hotel-${createdHotelSeq}`,
    eventId,
    name: payload.name,
    placeId: payload.placeId,
    address: composeAddress(payload),
    status: 1,
    position: { lat: payload.latitude, lng: payload.longitude },
    website: payload.website,
    bookingUrl: payload.website,
    phoneCountryCode: payload.phoneCountryCode,
    phone: payload.phone,
    street: payload.street,
    city: payload.city,
    state: payload.state,
    postalCode: payload.postalCode,
    countryCode: payload.countryCode,
    imageUrl: payload.imageUrl
  }
  CREATED_HOTELS.push({ ...hotel })
  return delay({ ...hotel })
}
