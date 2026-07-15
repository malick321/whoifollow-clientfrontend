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
const FALLBACK_CITY_PREFIX = 'wif-city:'

export const NEARBY_MATCH_RADIUS_M = 500

let sessionToken: google.maps.places.AutocompleteSessionToken | null = null

const FALLBACK_CITY_STATES: Array<[string, string]> = [
  ['Albany', 'NY'],
  ['Albuquerque', 'NM'],
  ['Anchorage', 'AK'],
  ['Annapolis', 'MD'],
  ['Arlington', 'TX'],
  ['Atlanta', 'GA'],
  ['Austin', 'TX'],
  ['Baltimore', 'MD'],
  ['Baton Rouge', 'LA'],
  ['Birmingham', 'AL'],
  ['Boise', 'ID'],
  ['Boston', 'MA'],
  ['Buffalo', 'NY'],
  ['Charlotte', 'NC'],
  ['Chicago', 'IL'],
  ['Cincinnati', 'OH'],
  ['Cleveland', 'OH'],
  ['Colorado Springs', 'CO'],
  ['Columbus', 'OH'],
  ['Dallas', 'TX'],
  ['Denver', 'CO'],
  ['Des Moines', 'IA'],
  ['Detroit', 'MI'],
  ['East Lansing', 'MI'],
  ['East Rutherford', 'NJ'],
  ['El Paso', 'TX'],
  ['Fort Lauderdale', 'FL'],
  ['Fort Worth', 'TX'],
  ['Fresno', 'CA'],
  ['Grand Rapids', 'MI'],
  ['Hartford', 'CT'],
  ['Houston', 'TX'],
  ['Indianapolis', 'IN'],
  ['Jacksonville', 'FL'],
  ['Jersey City', 'NJ'],
  ['Kansas City', 'MO'],
  ['Las Vegas', 'NV'],
  ['Long Beach', 'CA'],
  ['Los Angeles', 'CA'],
  ['Louisville', 'KY'],
  ['Memphis', 'TN'],
  ['Mesa', 'AZ'],
  ['Miami', 'FL'],
  ['Milwaukee', 'WI'],
  ['Minneapolis', 'MN'],
  ['Nashville', 'TN'],
  ['New Haven', 'CT'],
  ['New Orleans', 'LA'],
  ['New York', 'NY'],
  ['Newark', 'NJ'],
  ['Oakland', 'CA'],
  ['Oklahoma City', 'OK'],
  ['Omaha', 'NE'],
  ['Orlando', 'FL'],
  ['Philadelphia', 'PA'],
  ['Phoenix', 'AZ'],
  ['Pittsburgh', 'PA'],
  ['Portland', 'OR'],
  ['Providence', 'RI'],
  ['Raleigh', 'NC'],
  ['Richmond', 'VA'],
  ['Rochester', 'NY'],
  ['Sacramento', 'CA'],
  ['Saint Louis', 'MO'],
  ['Saint Paul', 'MN'],
  ['Salt Lake City', 'UT'],
  ['San Antonio', 'TX'],
  ['San Diego', 'CA'],
  ['San Francisco', 'CA'],
  ['San Jose', 'CA'],
  ['Seattle', 'WA'],
  ['Tampa', 'FL'],
  ['Trenton', 'NJ'],
  ['Tucson', 'AZ'],
  ['Tulsa', 'OK'],
  ['Virginia Beach', 'VA'],
  ['Washington', 'DC'],
  ['Wichita', 'KS'],
  ['Wilmington', 'DE'],
  ['Yonkers', 'NY']
]

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

function normalizeSearch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function fallbackCityPlaceId(city: string, state: string): string {
  return `${FALLBACK_CITY_PREFIX}${encodeURIComponent(city)}|${state}`
}

function fallbackCityFromPlaceId(placeId: string): { city: string; state: string } | null {
  if (!placeId.startsWith(FALLBACK_CITY_PREFIX)) return null
  const raw = placeId.slice(FALLBACK_CITY_PREFIX.length)
  const [cityRaw, stateRaw] = raw.split('|')
  const city = decodeURIComponent(cityRaw ?? '').trim()
  const state = (stateRaw ?? '').trim().toUpperCase()
  return city && state ? { city, state } : null
}

function fallbackCityPredictions(query: string): PlacePrediction[] {
  const q = normalizeSearch(query)
  if (q.length < 2) return []
  const parsed = parseCityStateText(query)
  const typedCity = parsed ? normalizeSearch(parsed.city) : ''
  const typedState = parsed?.state.toUpperCase() ?? ''

  return FALLBACK_CITY_STATES
    .map(([city, state]) => {
      const cityNorm = normalizeSearch(city)
      const fullNorm = normalizeSearch(`${city} ${state}`)
      let score = 0
      if (typedCity && typedState && cityNorm === typedCity && state === typedState) score = 100
      else if (cityNorm === q) score = 90
      else if (fullNorm === q) score = 85
      else if (cityNorm.startsWith(q)) score = 70
      else if (fullNorm.startsWith(q)) score = 65
      else if (cityNorm.includes(q)) score = 40
      else if (fullNorm.includes(q)) score = 30
      return { city, state, score }
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.city.localeCompare(b.city))
    .slice(0, 8)
    .map(({ city, state }) => ({
      placeId: fallbackCityPlaceId(city, state),
      primaryText: `${city}, ${state}`,
      secondaryText: 'United States',
      description: `${city}, ${state}, United States`,
      isEstablishment: false
    }))
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
  if (!google) return fallbackCityPredictions(q)

  try {
    const rows = await searchCurrentPlacePredictions(google, q, opts)
    if (rows.length) return rows
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.warn('[placesLookup] current autocomplete failed; using fallback.', err)
    }
    // Fall through to the legacy Maps JS Places API below.
  }

  const legacyRows = await searchLegacyPlacePredictions(google, q, opts)
  return legacyRows.length ? legacyRows : fallbackCityPredictions(q)
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

  const normalized = normalizeSearch(value)
  const exactFallbacks = FALLBACK_CITY_STATES.filter(([city, state]) => {
    const cityNorm = normalizeSearch(city)
    const fullNorm = normalizeSearch(`${city} ${state}`)
    return cityNorm === normalized || fullNorm === normalized
  })
  if (exactFallbacks.length === 1) {
    const [city, state] = exactFallbacks[0]
    return { city, state }
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
  const fallback = fallbackCityFromPlaceId(placeId)
  if (fallback) {
    const formattedAddress = `${fallback.city}, ${fallback.state}, United States`
    return {
      placeId,
      name: `${fallback.city}, ${fallback.state}`,
      formattedAddress,
      city: fallback.city,
      state: fallback.state,
      position: { lat: 0, lng: 0 },
      photos: []
    }
  }

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
