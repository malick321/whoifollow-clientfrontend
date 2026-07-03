// placesLookup
// ------------
// LIVE Google Places search for the Map Explorer's in-map "Add Venue" flow
// (find a brand-new park/hotel that isn't in our backend yet, then prefill
// its details from Google). Distinct from `src/api/placeDetails.ts`, which
// stays mock-first for enriching EXISTING pins so dev keeps working.
//
// Uses the CURRENT Places API (the legacy `AutocompleteService` / `PlacesService`
// are deprecated to new customers as of Mar 2025):
//   - autocomplete  → `AutocompleteSuggestion.fetchAutocompleteSuggestions`
//   - place details → `new Place({id}).fetchFields()`
//   - nearby venues → `Place.searchNearby`
// The `places` library is loaded by `loadGoogleMaps()`. With no Maps key
// configured, `searchPlacePredictions` / `findNearbyVenues` resolve to `[]` and
// `fetchPlaceById` to `null` — callers render graceful empty states.

import { loadGoogleMaps } from '../lib/googleMaps'
import type { GeoPosition, PlaceLookup, PlacePrediction } from '../types'

// Soft location-bias radius (metres) for autocomplete — keeps results
// regional so a same-named venue in another city doesn't outrank the local
// one. NOT a filter and NOT a dedup radius: it only re-ranks; every match
// (incl. two parks <200m apart) still appears as a distinct prediction.
const BIAS_RADIUS_M = 50_000

// Radius (metres) scanned around a picked ADDRESS to find the actual venue
// (a softball/sports complex may be named anything, and its pin can sit at a
// parking entrance) — kept generous so the facility is caught. Drives the
// on-map match circle. Tunable.
export const NEARBY_MATCH_RADIUS_M = 500

// One session token spans a search→pick cycle (Google bills autocomplete +
// details as one session). Reset after each successful detail fetch.
let sessionToken: google.maps.places.AutocompleteSessionToken | null = null

function ensureSessionToken(
  google: typeof globalThis.google
): google.maps.places.AutocompleteSessionToken {
  if (!sessionToken) sessionToken = new google.maps.places.AutocompleteSessionToken()
  return sessionToken
}

/** Live Places Autocomplete predictions for a free-text query. Broad
 *  (establishments AND addresses) so typing a name resolves the venue
 *  directly, while an address row routes through the nearby-venue lookup.
 *  Softly biased to `biasCenter` when supplied. Returns `[]` when the query
 *  is too short, no key is configured, or none match. */
export async function searchPlacePredictions(
  query: string,
  opts?: {
    biasCenter?: GeoPosition
    /** Place-type filter mapped to the new API's `includedPrimaryTypes`.
     *  Pass `['(cities)']` to restrict to city / locality level (no street
     *  addresses). */
    types?: string[]
  }
): Promise<PlacePrediction[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const google = await loadGoogleMaps()
  if (!google) return []

  const token = ensureSessionToken(google)

  const request: google.maps.places.AutocompleteRequest = {
    input: q,
    sessionToken: token
  }
  if (opts?.types && opts.types.length) {
    request.includedPrimaryTypes = opts.types
  }
  if (opts?.biasCenter) {
    request.locationBias = {
      center: { lat: opts.biasCenter.lat, lng: opts.biasCenter.lng },
      radius: BIAS_RADIUS_M
    }
  }

  try {
    const { suggestions } =
      await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions(request)
    return suggestions
      .map((s) => s.placePrediction)
      .filter((p): p is google.maps.places.PlacePrediction => !!p)
      .map((p) => ({
        placeId: p.placeId,
        primaryText: p.mainText?.text ?? p.text.text,
        secondaryText: p.secondaryText?.text ?? '',
        description: p.text.text,
        isEstablishment: (p.types ?? []).includes('establishment')
      }))
  } catch {
    return []
  }
}

/** Establishments within `radiusM` of a point — used after an address pick
 *  to surface the actual venue (no type filter, since softball venues are
 *  named "Park" / "Complex" / "Sports Complex" / "Fields" etc). Closest /
 *  most-prominent first. Returns `[]` when unavailable. */
export async function findNearbyVenues(
  position: GeoPosition,
  radiusM: number = NEARBY_MATCH_RADIUS_M
): Promise<PlacePrediction[]> {
  const google = await loadGoogleMaps()
  if (!google) return []
  try {
    const { places } = await google.maps.places.Place.searchNearby({
      fields: ['id', 'displayName', 'formattedAddress'],
      locationRestriction: { center: { lat: position.lat, lng: position.lng }, radius: radiusM },
      maxResultCount: 8
    })
    return places
      .filter((p) => !!p.id)
      .map((p) => ({
        placeId: p.id as string,
        primaryText: p.displayName ?? '',
        secondaryText: p.formattedAddress ?? '',
        description: p.displayName ?? '',
        isEstablishment: true
      }))
  } catch {
    return []
  }
}

/** Pull one address component's value out of a Place result. */
function component(
  components: google.maps.places.AddressComponent[] | undefined,
  type: string,
  useShort = false
): string | undefined {
  const hit = (components ?? []).find((c) => c.types.includes(type))
  if (!hit) return undefined
  return (useShort ? hit.shortText : hit.longText) ?? undefined
}

/** Split an international phone number ("+1 775-882-1234") into the
 *  dialling code ("+1") and the rest, falling back to the national form. */
function splitPhone(
  international?: string,
  national?: string
): { phoneCountryCode?: string; phone?: string } {
  if (international) {
    const m = international.match(/^(\+\d{1,3})\s*(.*)$/)
    if (m) return { phoneCountryCode: m[1], phone: (national ?? m[2]).trim() }
  }
  return national ? { phone: national } : {}
}

/** Resolve a place by id into a `PlaceLookup` (name, address parts, geo,
 *  phone, rating, photos, website). Returns `null` when unavailable. */
export async function fetchPlaceById(placeId: string): Promise<PlaceLookup | null> {
  const google = await loadGoogleMaps()
  if (!google) return null

  try {
    const place = new google.maps.places.Place({ id: placeId })
    await place.fetchFields({
      fields: [
        'displayName',
        'formattedAddress',
        'addressComponents',
        'location',
        'nationalPhoneNumber',
        'internationalPhoneNumber',
        'rating',
        'userRatingCount',
        'photos',
        'websiteURI'
      ]
    })
    // The search→pick cycle is complete — end the autocomplete billing session.
    sessionToken = null

    const loc = place.location
    const position = loc ? { lat: loc.lat(), lng: loc.lng() } : { lat: 0, lng: 0 }
    const comps = place.addressComponents
    const streetNumber = component(comps, 'street_number')
    const route = component(comps, 'route')
    const street = [streetNumber, route].filter(Boolean).join(' ') || undefined
    const { phoneCountryCode, phone } = splitPhone(
      place.internationalPhoneNumber ?? undefined,
      place.nationalPhoneNumber ?? undefined
    )
    return {
      placeId,
      name: place.displayName ?? '',
      formattedAddress: place.formattedAddress ?? '',
      street,
      city:
        component(comps, 'locality') ??
        component(comps, 'postal_town') ??
        component(comps, 'sublocality'),
      state: component(comps, 'administrative_area_level_1', true),
      postalCode: component(comps, 'postal_code'),
      countryCode: component(comps, 'country', true),
      position,
      phone,
      phoneCountryCode,
      rating: place.rating ?? undefined,
      reviewCount: place.userRatingCount ?? undefined,
      photos: (place.photos ?? []).slice(0, 6).map((p) => p.getURI({ maxWidth: 480 })),
      website: place.websiteURI ?? undefined
    }
  } catch {
    sessionToken = null
    return null
  }
}
