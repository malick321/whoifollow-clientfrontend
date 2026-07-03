// placeDetails
// ------------
// Place enrichment for Map Explorer pins (address / phone / rating /
// photos). Mock-first, following the repo convention (`delay()` +
// `*_ENDPOINT_LIVE = false`). The live branch queries the Google Places
// JS SDK (loaded via `src/lib/googleMaps.ts`) and is OFF until a Maps key
// with the Places API is configured.

import { loadGoogleMaps } from '../lib/googleMaps'
import type { GeoPosition, PlaceDetails } from '../types'

const SIMULATED_LATENCY_MS = 260
const PLACE_DETAILS_ENDPOINT_LIVE = false

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), SIMULATED_LATENCY_MS))
}

// Deterministic hash so mock details are stable per place name.
function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

export interface PlaceQuery {
  name: string
  position?: GeoPosition
  /** Optional known address — used as the mock fallback. */
  address?: string
}

function buildMockDetails(q: PlaceQuery): PlaceDetails {
  const seed = hashString(q.name)
  const rating = Math.round((38 + (seed % 12)) ) / 10 // 3.8 .. 5.0
  const reviewCount = 40 + (seed % 460)
  const phone = `+1 (${200 + (seed % 700)}) ${100 + (seed % 900)}-${1000 + (seed % 9000)}`
  const photos = [0, 1, 2].map((i) => `https://picsum.photos/seed/${(seed + i) % 1000}/400/225`)
  return {
    address: q.address || `${100 + (seed % 900)} Main St, Carson City, NV`,
    phone,
    rating,
    reviewCount,
    photos
  }
}

/** Live Google Places lookup — find the place by name (biased to its
 *  position) and read its detail fields in one text search. Returns `{}` if
 *  unavailable. Uses the current `Place.searchByText` API (the legacy
 *  `PlacesService` is deprecated to new customers as of Mar 2025). */
async function fetchLivePlaceDetails(q: PlaceQuery): Promise<PlaceDetails> {
  const google = await loadGoogleMaps()
  if (!google) return {}

  const fallback = (): PlaceDetails => (q.address ? { address: q.address } : {})
  try {
    const { places } = await google.maps.places.Place.searchByText({
      textQuery: q.name,
      fields: ['formattedAddress', 'nationalPhoneNumber', 'rating', 'userRatingCount', 'photos'],
      ...(q.position ? { locationBias: { lat: q.position.lat, lng: q.position.lng } } : {}),
      maxResultCount: 1
    })
    const place = places[0]
    if (!place) return fallback()
    return {
      address: place.formattedAddress ?? q.address,
      phone: place.nationalPhoneNumber ?? undefined,
      rating: place.rating ?? undefined,
      reviewCount: place.userRatingCount ?? undefined,
      photos: (place.photos ?? []).slice(0, 6).map((p) => p.getURI({ maxWidth: 400 }))
    }
  } catch {
    return fallback()
  }
}

/** Fetch place details for a Map Explorer pin. Mock until the Places
 *  endpoint is enabled. */
export async function fetchPlaceDetails(q: PlaceQuery): Promise<PlaceDetails> {
  if (!PLACE_DETAILS_ENDPOINT_LIVE) {
    return delay(buildMockDetails(q))
  }
  return fetchLivePlaceDetails(q)
}
