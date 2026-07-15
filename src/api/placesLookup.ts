// placesLookup
// ------------
// Live Google Places search used by map/search and team location fields.
//
// We try the current Places API first:
//   - AutocompleteSuggestion.fetchAutocompleteSuggestions
//   - new Place({ id }).fetchFields()
// Then we fall back to the legacy Maps JS Places APIs:
//   - AutocompleteService.getPlacePredictions
//   - PlacesService.getDetails
//
// That fallback matters for production because the old Who I Follow frontend
// already uses the legacy stack, and some Google projects have Maps JS Places
// enabled before Places API (New) is enabled. With no key configured, callers
// still get [] / null and can render graceful empty states.

import { loadGoogleMaps } from '../lib/googleMaps'
import type { GeoPosition, PlaceLookup, PlacePrediction } from '../types'

type SearchOptions = {
  biasCenter?: GeoPosition
  /** Pass ['(cities)'] to prefer city/locality-level results. */
  types?: string[]
}

type AddressComponentLike = {
  types: string[]
  longText?: string | null
  shortText?: string | null
  long_name?: string
  short_name?: string
}

type PlacePhotoLike = {
  getURI?: (options: { maxWidth?: number; maxHeight?: number }) => string
  getUrl?: (options: { maxWidth?: number; maxHeight?: number }) => string
}

const BIAS_RADIUS_M = 50_000

export const NEARBY_MATCH_RADIUS_M = 500

let sessionToken: google.maps.places.AutocompleteSessionToken | null = null

function ensureSessionToken(
  google: typeof globalThis.google
): google.maps.places.AutocompleteSessionToken {
  if (!sessionToken) sessionToken = new google.maps.places.AutocompleteSessionToken()
  return sessionToken
}

function photoUrl(photo: PlacePhotoLike): string | null {
  if (typeof photo.getURI === 'function') return photo.getURI({ maxWidth: 480 })
  if (typeof photo.getUrl === 'function') return photo.getUrl({ maxWidth: 480 })
  return null
}

function mapCurrentPrediction(p: google.maps.places.PlacePrediction): PlacePrediction {
  return {
    placeId: p.placeId,
    primaryText: p.mainText?.text ?? p.text.text,
    secondaryText: p.secondaryText?.text ?? '',
    description: p.text.text,
    isEstablishment: (p.types ?? []).includes('establishment')
  }
}

function mapLegacyPrediction(p: google.maps.places.AutocompletePrediction): PlacePrediction | null {
  if (!p.place_id) return null
  return {
    placeId: p.place_id,
    primaryText: p.structured_formatting?.main_text ?? p.description,
    secondaryText: p.structured_formatting?.secondary_text ?? '',
    description: p.description,
    isEstablishment: (p.types ?? []).includes('establishment')
  }
}

async function searchCurrentPlacePredictions(
  google: typeof globalThis.google,
  query: string,
  opts?: SearchOptions
): Promise<PlacePrediction[]> {
  const autocomplete = google.maps.places.AutocompleteSuggestion
  if (!autocomplete?.fetchAutocompleteSuggestions) return []

  const request: google.maps.places.AutocompleteRequest = {
    input: query,
    sessionToken: ensureSessionToken(google)
  }
  if (opts?.types?.length) request.includedPrimaryTypes = opts.types
  if (opts?.biasCenter) {
    request.locationBias = {
      center: { lat: opts.biasCenter.lat, lng: opts.biasCenter.lng },
      radius: BIAS_RADIUS_M
    }
  }

  const { suggestions } = await autocomplete.fetchAutocompleteSuggestions(request)
  return suggestions
    .map((s) => s.placePrediction)
    .filter((p): p is google.maps.places.PlacePrediction => !!p)
    .map(mapCurrentPrediction)
}

function searchLegacyPlacePredictions(
  google: typeof globalThis.google,
  query: string,
  opts?: SearchOptions
): Promise<PlacePrediction[]> {
  if (!google.maps.places.AutocompleteService) return Promise.resolve([])

  return new Promise((resolve) => {
    const service = new google.maps.places.AutocompleteService()
    const request: google.maps.places.AutocompletionRequest = {
      input: query,
      sessionToken: ensureSessionToken(google)
    }
    if (opts?.types?.length) request.types = opts.types
    if (opts?.biasCenter) {
      request.location = new google.maps.LatLng(opts.biasCenter.lat, opts.biasCenter.lng)
      request.radius = BIAS_RADIUS_M
    }

    service.getPlacePredictions(request, (predictions, status) => {
      if (status !== google.maps.places.PlacesServiceStatus.OK || !predictions) {
        resolve([])
        return
      }
      resolve(predictions.map(mapLegacyPrediction).filter((p): p is PlacePrediction => !!p))
    })
  })
}

/** Live Places Autocomplete predictions for a free-text query. */
export async function searchPlacePredictions(
  query: string,
  opts?: SearchOptions
): Promise<PlacePrediction[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const google = await loadGoogleMaps()
  if (!google) return []

  try {
    const rows = await searchCurrentPlacePredictions(google, q, opts)
    if (rows.length) return rows
  } catch {
    // Fall through to the legacy Maps JS Places API below.
  }

  return searchLegacyPlacePredictions(google, q, opts)
}

/** Establishments within `radiusM` of a point. */
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

function component(
  components: AddressComponentLike[] | undefined,
  type: string,
  useShort = false
): string | undefined {
  const hit = (components ?? []).find((c) => c.types.includes(type))
  if (!hit) return undefined
  if (useShort) return hit.shortText ?? hit.short_name ?? undefined
  return hit.longText ?? hit.long_name ?? undefined
}

const US_STATE_CODES_BY_NAME: Record<string, string> = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  'district of columbia': 'DC',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY'
}

function normalizeStateText(value: string): string | null {
  const cleaned = value
    .replace(/\b\d{5}(?:-\d{4})?\b/g, '')
    .replace(/\b(?:usa|u\.s\.a\.|united states|united states of america)\b/gi, '')
    .replace(/[.]/g, '')
    .trim()
  if (!cleaned) return null
  const code = cleaned.match(/\b([A-Za-z]{2})\b/)
  if (code) return code[1].toUpperCase()
  return US_STATE_CODES_BY_NAME[cleaned.toLowerCase()] ?? cleaned
}

/** Best-effort fallback for manually typed values like "East Rutherford, NJ". */
export function parseCityStateText(value: string): { city: string; state: string } | null {
  const parts = value.split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length >= 2) {
    for (let i = parts.length - 1; i >= 1; i -= 1) {
      const state = normalizeStateText(parts[i])
      if (!state) continue
      const city = parts[i - 1].replace(/\b\d{5}(?:-\d{4})?\b/g, '').trim()
      if (city) return { city, state }
    }
  }

  const compact = value
    .trim()
    .match(/([A-Za-z][A-Za-z .'-]+?)\s+([A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/)
  if (!compact) return null
  return { city: compact[1].trim(), state: compact[2].toUpperCase() }
}

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

/** Resolve a place by id into a PlaceLookup. */
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
    sessionToken = null

    const loc = place.location
    const position = loc ? { lat: loc.lat(), lng: loc.lng() } : { lat: 0, lng: 0 }
    const comps = place.addressComponents as AddressComponentLike[] | undefined
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
      photos: (place.photos ?? [])
        .slice(0, 6)
        .map((p) => photoUrl(p))
        .filter((url): url is string => !!url),
      website: place.websiteURI ?? undefined
    }
  } catch {
    return fetchPlaceByIdLegacy(google, placeId)
  }
}

function fetchPlaceByIdLegacy(
  google: typeof globalThis.google,
  placeId: string
): Promise<PlaceLookup | null> {
  if (typeof document === 'undefined' || !google.maps.places.PlacesService) {
    sessionToken = null
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    const host = document.createElement('div')
    host.style.display = 'none'
    document.body.appendChild(host)

    const service = new google.maps.places.PlacesService(host)
    const request = {
      placeId,
      fields: [
        'name',
        'formatted_address',
        'address_components',
        'geometry',
        'formatted_phone_number',
        'international_phone_number',
        'rating',
        'user_ratings_total',
        'photos',
        'website'
      ],
      sessionToken: sessionToken ?? undefined
    } as google.maps.places.PlaceDetailsRequest & {
      sessionToken?: google.maps.places.AutocompleteSessionToken
    }

    service.getDetails(request, (place, status) => {
      host.remove()
      sessionToken = null
      if (status !== google.maps.places.PlacesServiceStatus.OK || !place) {
        resolve(null)
        return
      }

      const loc = place.geometry?.location
      const comps = place.address_components as AddressComponentLike[] | undefined
      const streetNumber = component(comps, 'street_number')
      const route = component(comps, 'route')
      const street = [streetNumber, route].filter(Boolean).join(' ') || undefined
      const { phoneCountryCode, phone } = splitPhone(
        place.international_phone_number ?? undefined,
        place.formatted_phone_number ?? undefined
      )

      resolve({
        placeId,
        name: place.name ?? '',
        formattedAddress: place.formatted_address ?? '',
        street,
        city:
          component(comps, 'locality') ??
          component(comps, 'postal_town') ??
          component(comps, 'sublocality'),
        state: component(comps, 'administrative_area_level_1', true),
        postalCode: component(comps, 'postal_code'),
        countryCode: component(comps, 'country', true),
        position: loc ? { lat: loc.lat(), lng: loc.lng() } : { lat: 0, lng: 0 },
        phone,
        phoneCountryCode,
        rating: place.rating ?? undefined,
        reviewCount: place.user_ratings_total ?? undefined,
        photos: (place.photos ?? [])
          .slice(0, 6)
          .map((p) => photoUrl(p))
          .filter((url): url is string => !!url),
        website: place.website ?? undefined
      })
    })
  })
}
