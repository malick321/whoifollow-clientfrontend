<script setup lang="ts">
// MapExplorerModal
// ----------------
// Full-screen "Map Explorer" for the public event page — a native Vue port
// of the standalone Firebase map app. Shows park + hotel pins on an
// interactive Google Map; clicking a pin opens a details panel enriched
// from Google Places (mock-first via `fetchPlaceDetails`). Category
// filters toggle parks/hotels. When no Maps API key is configured it
// falls back to the keyless map iframe + venue lists so dev still works.

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from '../AppIcon.vue'
import { lockBodyScroll, unlockBodyScroll } from '../../body-scroll-lock'
import { loadGoogleMaps, hasGoogleMapsKey, MAP_ID } from '../../lib/googleMaps'
import { fetchPlaceById, findNearbyVenues, NEARBY_MATCH_RADIUS_M } from '../../api/placesLookup'
import MapPlaceSearch from './MapPlaceSearch.vue'
import MapAddParkWizard from './MapAddParkWizard.vue'
import MapAddHotelWizard from './MapAddHotelWizard.vue'
import parkRaw from '../../assets/park.svg?raw'
import hotelRaw from '../../assets/hotel.svg?raw'
import wifIconUrl from '../../assets/wif-icon-only.svg'
import type { EventHotel, PublicEventPark, PlaceLookup, PlacePrediction, GeoPosition } from '../../types'

const props = withDefaults(defineProps<{
  open: boolean
  parks?: PublicEventPark[]
  hotels?: EventHotel[]
  location?: string
  eventName?: string
  dateRangeLabel?: string
  /** Admin-only: shows an "Add" control next to the tabs. */
  canAdd?: boolean
  /** Cover the whole viewport (ignore the top-header inset). */
  fullscreen?: boolean
  /** Embedded mode — render in place (no Teleport / overlay / body-scroll
   *  lock / close button). Used by the dedicated Event Locations page, where
   *  the map fills the content area beside the persistent left rail rather
   *  than floating as a modal. */
  embedded?: boolean
  // ── Event context for the in-map add wizards ──
  associationId?: string
  eventId?: string
  eventStartDate?: string
  eventEndDate?: string
  eventStartTime?: string | null
  eventEndTime?: string | null
  eventAllDay?: boolean
}>(), {
  parks: () => [],
  hotels: () => [],
  canAdd: false,
  fullscreen: false,
  embedded: false,
  associationId: '',
  eventId: '',
  eventStartDate: '',
  eventEndDate: '',
  eventStartTime: null,
  eventEndTime: null,
  eventAllDay: false
})

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'park-saved', payload: { park: PublicEventPark; fieldCount: number; dayCount: number }): void
  (event: 'hotel-saved', payload: { hotel: EventHotel }): void
}>()

// ── In-map "Add Venue" flow ──
// `addOpen` = the type-choice popover; `mode` = which venue is being added
// (browse = the normal explorer); `addStep` = search a place vs the wizard.
const addOpen = ref(false)
const mode = ref<'browse' | 'add-park' | 'add-hotel'>('browse')
const addStep = ref<'search' | 'wizard'>('search')
const candidate = ref<PlaceLookup | null>(null)
const candidateLoading = ref(false)
let candidateMarker: google.maps.marker.AdvancedMarkerElement | null = null

const addKind = computed<'park' | 'hotel'>(() => (mode.value === 'add-hotel' ? 'hotel' : 'park'))
const searchPlaceholder = computed(() => (addKind.value === 'hotel' ? 'Find hotel' : 'Find playing facility'))
// Soft autocomplete bias — the event's area, derived from the first venue
// pin we have a position for (else undefined → no bias).
const searchBiasCenter = computed<GeoPosition | undefined>(() => {
  const first = (props.parks ?? []).find((p) => p.position)?.position
    ?? (props.hotels ?? []).find((h) => h.position)?.position
  return first ?? undefined
})

// Camera (center+zoom) snapshot taken on entering add-mode, so we can put
// the view back exactly where it was on exit — instead of `fitBounds()`-ing
// all the way out from the zoomed-in candidate (which read as a "reload").
let savedCamera: { center: google.maps.LatLngLiteral; zoom: number } | null = null
// One-shot guard so the parks/hotels watch doesn't re-render right after
// exitAddMode already did (avoids a double pin redraw on save).
let skipVenueWatchOnce = false
// Whether the camera has been framed to the pins since the modal opened.
// Stays false until pins actually exist, so if the venue lists arrive
// AFTER `initMap` (async), the first population still fits-bounds to show
// every hotel + facility (instead of leaving the default single-point view).
let framedOnce = false

function chooseAdd(kind: 'park' | 'hotel') {
  addOpen.value = false
  mode.value = kind === 'park' ? 'add-park' : 'add-hotel'
  addStep.value = 'search'
  candidate.value = null
  // Remember the current view so we can restore it when leaving add-mode.
  if (mapInstance) {
    const c = mapInstance.getCenter()
    savedCamera = c ? { center: c.toJSON(), zoom: mapInstance.getZoom() ?? 12 } : null
  }
  // Focus the add flow: keep the existing event pins for context but dim
  // them (non-interactive) so the new candidate pin stays prominent.
  closeInfo()
  clearNearby()
  renderMarkers({ frame: false, dim: true })
}

function exitAddMode() {
  mode.value = 'browse'
  addStep.value = 'search'
  candidate.value = null
  clearCandidateMarker()
  clearNearby()
  closeInfo()
  // Swap the event pins back in (incl. any just-added venue) WITHOUT
  // reframing, then restore the pre-add camera so the view stays steady.
  if (savedCamera) {
    renderMarkers({ frame: false })
    mapInstance?.setCenter(savedCamera.center)
    mapInstance?.setZoom(savedCamera.zoom)
    savedCamera = null
    skipVenueWatchOnce = true
  } else {
    renderMarkers()
  }
}

function clearCandidateMarker() {
  if (candidateMarker) { candidateMarker.map = null; candidateMarker = null }
}

// Closing the candidate's info box (Google's X) cancels the picked place and
// returns to the search step — without leaving add mode.
function cancelCandidate() {
  candidate.value = null
  clearCandidateMarker()
  clearNearby()
  addStep.value = 'search'
}

function buildCandidatePin(place: PlaceLookup): Pin {
  return {
    id: 'candidate',
    kind: addKind.value,
    name: place.name,
    sub: place.formattedAddress,
    position: place.position,
    address: place.formattedAddress
  }
}

// Nearby-venue match (after an address pick): the small match circle + the
// candidate list of establishments found inside it.
const nearbyResults = ref<PlacePrediction[] | null>(null)
const addressFallback = ref<PlaceLookup | null>(null)
let matchCircle: google.maps.Circle | null = null

function clearMatchCircle() {
  if (matchCircle) { matchCircle.setMap(null); matchCircle = null }
}
function drawMatchCircle(center: GeoPosition) {
  if (!mapInstance || !googleNs) return
  clearMatchCircle()
  matchCircle = new googleNs.maps.Circle({
    map: mapInstance,
    center,
    radius: NEARBY_MATCH_RADIUS_M,
    strokeColor: PIN_COLOR[addKind.value],
    strokeOpacity: 0.9,
    strokeWeight: 2,
    fillColor: PIN_COLOR[addKind.value],
    fillOpacity: 0.1,
    clickable: false
  })
}

function clearNearby() {
  nearbyResults.value = null
  addressFallback.value = null
  clearMatchCircle()
}

// Drop the candidate pin + open its info box, centred + zoomed in.
function adoptCandidate(place: PlaceLookup) {
  if (!mapInstance || !googleNs) return
  clearNearby()
  candidate.value = place
  clearCandidateMarker()
  const pin = buildCandidatePin(place)
  candidateMarker = new googleNs.maps.marker.AdvancedMarkerElement({
    map: mapInstance,
    position: place.position,
    content: buildPinEl(pin)
  })
  candidateMarker.content?.addEventListener('click', () => openCandidateInfo())
  mapInstance.setCenter(place.position)
  mapInstance.setZoom(15)
  openCandidateInfo()
}

async function onPickPrediction(placeId: string, isEstablishment: boolean) {
  if (!mapInstance || !googleNs) return
  candidateLoading.value = true
  try {
    if (isEstablishment) {
      const place = await fetchPlaceById(placeId)
      if (place) adoptCandidate(place)
      return
    }
    // Address pick — resolve to a point, scan the match radius for the venue.
    const addr = await fetchPlaceById(placeId)
    if (!addr) return
    addressFallback.value = addr
    mapInstance.setCenter(addr.position)
    mapInstance.setZoom(16)
    drawMatchCircle(addr.position)
    const found = await findNearbyVenues(addr.position)
    if (found.length === 0) {
      // No establishment nearby — use the address itself (admin names it).
      adoptCandidate(addr)
      return
    }
    nearbyResults.value = found
  } finally {
    candidateLoading.value = false
  }
}

// Candidate chosen from the nearby list → resolve full details + adopt.
async function onPickNearby(placeId: string) {
  candidateLoading.value = true
  try {
    const place = await fetchPlaceById(placeId)
    if (place) adoptCandidate(place)
  } finally {
    candidateLoading.value = false
  }
}

// "None of these" — keep the picked address as the venue (editable name).
function useAddressAsVenue() {
  if (addressFallback.value) adoptCandidate(addressFallback.value)
}

function openCandidateInfo() {
  if (!infoWindow || !mapInstance || !candidate.value || !candidateMarker) return
  const pin = buildCandidatePin(candidate.value)
  infoWindow.setHeaderContent(buildInfoHeader(pin))
  infoWindow.setContent(buildCandidateContent(pin, candidate.value, addStep.value === 'search'))
  infoWindow.open({ map: mapInstance, anchor: candidateMarker })
  mapInstance.panTo(pin.position as GeoPosition)
  const h = mapHost.value?.clientHeight ?? 0
  if (h) mapInstance.panBy(0, -Math.round(h * 0.28))
}

const ADD_PANEL_WIDTH = 420
function confirmAddCandidate() {
  if (!candidate.value) return
  addStep.value = 'wizard'
  // Rebuild the info box without the action footer (it lives in the wizard now).
  openCandidateInfo()
  // Nudge the pin toward the left so the right-side wizard panel doesn't cover it.
  if (mapInstance) {
    const isNarrow = (mapHost.value?.clientWidth ?? 0) <= 720
    if (!isNarrow) {
      void nextTick(() => mapInstance?.panBy(Math.round(ADD_PANEL_WIDTH / 2), 0))
    }
  }
}

function onParkSaved(payload: { park: PublicEventPark; fieldCount: number; dayCount: number }) {
  emit('park-saved', payload)
  exitAddMode()
}
function onHotelSaved(payload: { hotel: EventHotel }) {
  emit('hotel-saved', payload)
  exitAddMode()
}

type PinKind = 'park' | 'hotel'
interface Pin {
  id: string
  kind: PinKind
  name: string
  sub: string
  position?: GeoPosition
  address?: string
  bookingUrl?: string
  fieldsInUse?: string[]
  scheduleWindows?: { days: string; window: string }[]
  // Hotel-only — sourced from the (extended) resources API, NOT Google.
  phone?: string
  website?: string
  imageUrl?: string
  cityStateZip?: string
}

// Same legend colours as the on-page venue preview (PublicVenueMap):
// parks = primary blue, hotels = magenta.
const PIN_COLOR: Record<PinKind, string> = { park: '#2d8cf0', hotel: '#d6409f' }

const parkPins = computed<Pin[]>(() =>
  (props.parks ?? []).map((p) => ({
    id: `park-${p.id}`, kind: 'park', name: p.name, sub: p.location, position: p.position,
    address: p.address, fieldsInUse: p.fieldsInUse, scheduleWindows: p.scheduleWindows
  }))
)
const hotelPins = computed<Pin[]>(() =>
  (props.hotels ?? []).map((h) => {
    // "City, ST 12345" from whichever extended resource fields are present.
    const cityStateZip = [h.city, [h.state, h.postalCode].filter(Boolean).join(' ')]
      .filter((s) => s && s.trim())
      .join(', ')
    const phone = [h.phoneCountryCode, h.phone].filter((s) => s && String(s).trim()).join(' ').trim()
    return {
      id: `hotel-${h.id}`,
      kind: 'hotel',
      name: h.name,
      sub: h.address ?? '',
      position: h.position,
      address: h.address ?? '',
      bookingUrl: h.bookingUrl,
      phone: phone || undefined,
      website: h.website,
      imageUrl: h.imageUrl,
      cityStateZip: cityStateZip || undefined
    }
  })
)

// Category toggles (Facilities / Hotels) — each pill carries a legend
// checkbox; both can be on (multi-select), showing their pins together.
const selectedCategories = ref<{ parks: boolean; hotels: boolean }>({ parks: true, hotels: true })
const visiblePins = computed<Pin[]>(() => {
  const out: Pin[] = []
  if (selectedCategories.value.parks) out.push(...parkPins.value)
  if (selectedCategories.value.hotels) out.push(...hotelPins.value)
  return out
})

// ── Map ──
const mapHost = ref<HTMLElement | null>(null)
const mapUnavailable = ref(!hasGoogleMapsKey())
let mapInstance: google.maps.Map | null = null
let markers: google.maps.marker.AdvancedMarkerElement[] = []
let googleNs: typeof google | null = null
let infoWindow: google.maps.InfoWindow | null = null
let detailsToken = 0

function buildPinEl(pin: Pin, dim = false): HTMLElement {
  // Inline-styled (AdvancedMarker content lives outside the component's
  // scoped DOM, so scoped CSS classes wouldn't apply).
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.setAttribute('aria-label', pin.name)
  // `dim` = an existing event pin shown for context during add-mode: faded
  // + non-interactive so the new candidate pin stays prominent. (No tooltip.)
  if (!dim) {
    // Styled hover tooltip (same system as the rest of the app).
    btn.className = 'app-tooltip app-tooltip--top'
    btn.setAttribute('data-tooltip', pin.name)
  }
  // White ring in light mode; a dark slate ring in dark mode so the pin
  // still reads as a distinct marker against the dark basemap.
  const ring = isDarkMode() ? '#0f1722' : '#fff'
  btn.style.cssText = [
    'width:48px', 'height:48px', 'border-radius:50%', `background:${PIN_COLOR[pin.kind]}`,
    'display:flex', 'align-items:center', 'justify-content:center',
    `border:3px solid ${ring}`, 'box-shadow:0 3px 10px rgba(0,0,0,0.4)', 'padding:0',
    dim ? 'cursor:default' : 'cursor:pointer',
    dim ? 'opacity:0.35' : 'opacity:1',
    dim ? 'pointer-events:none' : ''
  ].join(';')
  // Same brand icons as the on-page venue preview (recoloured white).
  btn.innerHTML = (pin.kind === 'park' ? parkRaw : hotelRaw)
    .replace(/#254C72/gi, '#ffffff')
    .replace(/currentColor/g, '#ffffff')
  const svg = btn.querySelector('svg')
  if (svg) {
    svg.setAttribute('width', '24')
    svg.setAttribute('height', '24')
    svg.style.display = 'block'
  }
  return btn
}

const KIND_COLOR: Record<PinKind, string> = PIN_COLOR

// Build the InfoWindow body imperatively (it renders inside Google's DOM, so
// scoped CSS won't reach it — these `.mapx-iw*` classes come from the
// component's non-scoped <style> block, which is injected globally).
function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

// Prev/next overlay chevron button that scrolls a horizontal rail by one item.
// Shared by the photo gallery and the scheduling-window rail.
function mkRailNav(dir: 'prev' | 'next', strip: HTMLElement): HTMLElement {
  const b = el('button', `mapx-iw__nav mapx-iw__nav--${dir}`)
  b.setAttribute('type', 'button')
  b.setAttribute('aria-label', dir === 'prev' ? 'Previous' : 'Next')
  b.innerHTML =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
    (dir === 'prev' ? '<path d="M15 6 9 12l6 6"/>' : '<path d="M9 6l6 6-6 6"/>') + '</svg>'
  b.addEventListener('click', (ev) => {
    ev.stopPropagation()
    const step = (strip.firstElementChild as HTMLElement | null)?.offsetWidth ?? strip.clientWidth
    strip.scrollBy({ left: dir === 'prev' ? -(step + 8) : step + 8, behavior: 'smooth' })
  })
  return b
}

// Flat chevron (no circle/border) that flanks the schedule rail start/end.
function mkSchedNav(dir: 'prev' | 'next', strip: HTMLElement): HTMLElement {
  const b = el('button', 'mapx-iw__sched-nav')
  b.setAttribute('type', 'button')
  b.setAttribute('aria-label', dir === 'prev' ? 'Previous' : 'Next')
  b.innerHTML =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
    (dir === 'prev' ? '<path d="M15 6 9 12l6 6"/>' : '<path d="M9 6l6 6-6 6"/>') + '</svg>'
  b.addEventListener('click', (ev) => {
    ev.stopPropagation()
    const step = (strip.firstElementChild as HTMLElement | null)?.offsetWidth ?? strip.clientWidth
    strip.scrollBy({ left: dir === 'prev' ? -(step + 8) : step + 8, behavior: 'smooth' })
  })
  return b
}

// InfoWindow header — kind badge + name on the left (Google places the close
// button on the right of the header chrome automatically).
/** Google Maps *directions* deep link (no Routes API → no usage cost) — opens
 *  the Maps site/app with directions to the venue in a new tab. Prefers the
 *  exact coordinates; falls back to the name + address for geocoding. */
function directionsUrl(pin: Pin): string {
  const dest = pin.position
    ? `${pin.position.lat},${pin.position.lng}`
    : [pin.name, pin.address].filter(Boolean).join(', ')
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`
}

function buildInfoHeader(pin: Pin): HTMLElement {
  const hdr = el('div', 'mapx-iw__hdr')
  // Top row — badge on the left, "Get directions" on the right.
  const top = el('div', 'mapx-iw__hdr-top')
  const kind = el('span', 'mapx-iw__kind', pin.kind === 'park' ? 'Park' : 'Hotel')
  kind.style.background = KIND_COLOR[pin.kind]
  top.appendChild(kind)
  // Get directions — only for real (added) venues, not the add-candidate
  // header (which has no resource identity yet).
  if (pin.id !== 'candidate' && (pin.position || pin.address)) {
    const dir = document.createElement('a')
    dir.className = 'mapx-iw__dir'
    dir.href = directionsUrl(pin)
    dir.target = '_blank'
    dir.rel = 'noopener'
    dir.textContent = 'Get directions'
    top.appendChild(dir)
  }
  hdr.appendChild(top)
  hdr.appendChild(el('span', 'mapx-iw__hdr-name', pin.name))
  return hdr
}

function buildInfoContent(pin: Pin): HTMLElement {
  const root = el('div', 'mapx-iw')

  // Parks render purely from our own resource data — NO Places lookup
  // (no rating / reviews / photos fetched).
  if (pin.kind === 'park') {
    root.appendChild(el('p', 'mapx-iw__line', pin.address || pin.sub))
    if (pin.fieldsInUse && pin.fieldsInUse.length) {
      const fields = el('p', 'mapx-iw__line')
      fields.appendChild(el('span', 'mapx-iw__line-label', 'Fields in use: '))
      fields.appendChild(document.createTextNode(pin.fieldsInUse.join(', ')))
      root.appendChild(fields)
    }
    if (pin.scheduleWindows && pin.scheduleWindows.length) {
      root.appendChild(el('p', 'mapx-iw__line-label', 'Schedule'))
      const wrap = el('div', 'mapx-iw__sched-wrap')
      const sched = el('div', 'mapx-iw__sched')
      pin.scheduleWindows.forEach((w) => {
        const card = el('div', 'mapx-iw__sched-card')
        card.appendChild(el('strong', undefined, w.days))
        card.appendChild(el('span', undefined, w.window))
        sched.appendChild(card)
      })
      if (pin.scheduleWindows.length > 1) {
        wrap.appendChild(mkSchedNav('prev', sched))
        wrap.appendChild(sched)
        wrap.appendChild(mkSchedNav('next', sched))
      } else {
        wrap.appendChild(sched)
      }
      root.appendChild(wrap)
    }
    return root
  }

  // Hotels — render from the WIF resources record (the extended resources
  // API: address / city-state-zip / phone / website / image). NO Google
  // Places lookup for an already-added hotel.
  if (pin.imageUrl) {
    const gallery = el('div', 'mapx-iw__gallery')
    const strip = el('div', 'mapx-iw__photos')
    const img = document.createElement('img')
    img.className = 'mapx-iw__photo'
    img.src = pin.imageUrl
    img.alt = `${pin.name} photo`
    img.loading = 'lazy'
    strip.appendChild(img)
    gallery.appendChild(strip)
    root.appendChild(gallery)
  }
  if (pin.address || pin.sub) root.appendChild(el('p', 'mapx-iw__line', pin.address || pin.sub))
  if (pin.cityStateZip) root.appendChild(el('p', 'mapx-iw__line', pin.cityStateZip))
  if (pin.phone) root.appendChild(el('p', 'mapx-iw__line', pin.phone))
  if (pin.website) {
    const site = document.createElement('a')
    site.className = 'mapx-iw__line mapx-iw__weblink'
    site.href = pin.website
    site.target = '_blank'
    site.rel = 'noopener'
    site.textContent = pin.website.replace(/^https?:\/\//, '').replace(/\/$/, '')
    root.appendChild(site)
  }
  if (pin.bookingUrl) {
    const book = document.createElement('a')
    book.className = 'mapx-iw__book'
    book.href = pin.bookingUrl
    book.target = '_blank'
    book.rel = 'noopener'
    book.textContent = 'Book Now'
    root.appendChild(book)
  }
  return root
}

// Candidate (not-yet-added) place — Google-sourced details + optional
// Cancel / Add action footer (shown while picking; hidden once the wizard
// is open). Mirrors the hotel detail layout (address / phone / rating /
// photos) regardless of kind, since a new place isn't in our backend yet.
function buildCandidateContent(pin: Pin, place: PlaceLookup, withActions: boolean): HTMLElement {
  const root = el('div', 'mapx-iw')
  if (place.formattedAddress) root.appendChild(el('p', 'mapx-iw__line', place.formattedAddress))
  const phone = [place.phoneCountryCode, place.phone].filter(Boolean).join(' ')
  if (phone) root.appendChild(el('p', 'mapx-iw__line', phone))
  if (place.rating != null) {
    const rating = el('p', 'mapx-iw__rating')
    rating.appendChild(el('span', 'mapx-iw__star', '★'))
    rating.appendChild(el('strong', undefined, String(place.rating)))
    if (place.reviewCount != null) rating.appendChild(el('span', 'mapx-iw__muted', `(${place.reviewCount} reviews)`))
    root.appendChild(rating)
  }
  if (place.photos && place.photos.length) {
    const gallery = el('div', 'mapx-iw__gallery')
    const strip = el('div', 'mapx-iw__photos')
    place.photos.forEach((src, i) => {
      const img = document.createElement('img')
      img.className = 'mapx-iw__photo'
      img.src = src
      img.alt = `${place.name} photo ${i + 1}`
      img.loading = 'lazy'
      strip.appendChild(img)
    })
    gallery.appendChild(strip)
    if (place.photos.length > 1) {
      gallery.appendChild(mkRailNav('prev', strip))
      gallery.appendChild(mkRailNav('next', strip))
    }
    root.appendChild(gallery)
  }
  if (withActions) {
    const actions = el('div', 'mapx-iw__actions')
    const cancel = el('button', 'mapx-iw__btn mapx-iw__btn--ghost', 'Cancel') as HTMLButtonElement
    cancel.type = 'button'
    cancel.addEventListener('click', (e) => { e.stopPropagation(); exitAddMode() })
    const add = el('button', 'mapx-iw__btn mapx-iw__btn--primary', pin.kind === 'hotel' ? 'Add Hotel' : 'Add Facility') as HTMLButtonElement
    add.type = 'button'
    add.addEventListener('click', (e) => { e.stopPropagation(); confirmAddCandidate() })
    actions.appendChild(cancel)
    actions.appendChild(add)
    root.appendChild(actions)
  }
  return root
}

async function openInfo(pin: Pin, marker: google.maps.marker.AdvancedMarkerElement) {
  if (!infoWindow || !mapInstance) return
  const token = ++detailsToken
  infoWindow.setHeaderContent(buildInfoHeader(pin))
  infoWindow.open({ map: mapInstance, anchor: marker })
  if (pin.position) {
    // Drop the pin toward the lower third of the viewport so the InfoWindow
    // (which opens above the pin) sits centred — room for taller content.
    mapInstance.panTo(pin.position)
    const h = mapHost.value?.clientHeight ?? 0
    if (h) mapInstance.panBy(0, -Math.round(h * 0.3))
  }
  // Both parks AND already-added hotels render from our own resources data
  // (no Places API call) — Google is only used while *adding* a new venue.
  void token
  infoWindow.setContent(buildInfoContent(pin))
}

function closeInfo() {
  detailsToken++
  infoWindow?.close()
}

function clearMarkers() {
  for (const m of markers) m.map = null
  markers = []
}

function renderMarkers(opts?: { frame?: boolean; dim?: boolean }) {
  if (!mapInstance || !googleNs) return
  const frame = opts?.frame ?? true
  const dim = opts?.dim ?? false
  clearMarkers()
  const pins = visiblePins.value.filter((p) => p.position)
  const bounds = new googleNs.maps.LatLngBounds()
  for (const pin of pins) {
    const marker = new googleNs.maps.marker.AdvancedMarkerElement({
      map: mapInstance,
      position: pin.position,
      content: buildPinEl(pin, dim)
    })
    // Dimmed (add-mode context) pins are non-interactive — no info on click.
    if (!dim) marker.content?.addEventListener('click', () => openInfo(pin, marker))
    markers.push(marker)
    bounds.extend(pin.position as GeoPosition)
  }
  // `frame` reframes the camera to fit the pins. Skipped when we want to
  // swap pins without moving the camera (e.g. returning from add-mode,
  // where we restore the pre-add camera instead).
  if (!frame) return
  if (pins.length === 1) {
    mapInstance.setCenter(pins[0].position as GeoPosition)
    mapInstance.setZoom(13)
    framedOnce = true
  } else if (pins.length > 1) {
    mapInstance.fitBounds(bounds, 80)
    framedOnce = true
  }
}

function isDarkMode(): boolean {
  return document.documentElement.classList.contains('dark-mode')
}

async function initMap() {
  googleNs = await loadGoogleMaps()
  if (!googleNs || !mapHost.value) {
    mapUnavailable.value = true
    return
  }
  mapUnavailable.value = false
  // `colorScheme` is read at construction time, so the map matches the
  // current theme; a theme toggle re-inits the map (see the observer below).
  const opts: google.maps.MapOptions & { colorScheme?: string } = {
    mapId: MAP_ID,
    center: { lat: 39.1638, lng: -119.7674 },
    zoom: 12,
    disableDefaultUI: false,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    // Don't open Google's built-in POI info windows when a labelled place
    // is tapped — only our own park/hotel pins should respond.
    clickableIcons: false,
    colorScheme: isDarkMode() ? 'DARK' : 'LIGHT'
  }
  mapInstance = new googleNs.maps.Map(mapHost.value, opts)
  infoWindow = new googleNs.maps.InfoWindow({ maxWidth: 320 })
  // In add mode, closing the candidate's info box cancels the selection
  // and returns to the place search (normal browse pins just close).
  infoWindow.addListener('closeclick', () => {
    if (mode.value !== 'browse') cancelCandidate()
  })
  renderMarkers()
}

function teardownMap() {
  closeInfo()
  infoWindow = null
  clearCandidateMarker()
  clearMatchCircle()
  clearMarkers()
  mapInstance = null
}

// Re-create the map when the app theme flips so the basemap follows
// dark/light (Google reads `colorScheme` only at construction).
let themeObserver: MutationObserver | null = null
let lastDark = false
function startThemeObserver() {
  if (themeObserver || typeof MutationObserver === 'undefined') return
  lastDark = isDarkMode()
  themeObserver = new MutationObserver(() => {
    const dark = isDarkMode()
    if (dark === lastDark) return
    lastDark = dark
    if (mapInstance && mapHost.value) {
      teardownMap()
      void nextTick(initMap)
    }
  })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
}
function stopThemeObserver() {
  themeObserver?.disconnect()
  themeObserver = null
}

// Rebuild pins when the category filters change (interactive map only).
watch(selectedCategories, () => { if (mapInstance) renderMarkers() }, { deep: true })

// Refresh pins when the venue lists change (e.g. a venue was just added via
// the in-map flow and the host appended it) — only while browsing.
watch(
  [() => props.parks, () => props.hotels],
  () => {
    // De-dupe: exitAddMode already re-rendered after a save.
    if (skipVenueWatchOnce) { skipVenueWatchOnce = false; return }
    if (mapInstance && mode.value === 'browse') {
      // First time pins actually arrive (lists loaded after `initMap`) →
      // frame to fit ALL of them. After that, a venue added/changed while
      // browsing just swaps pins in place without yanking the camera.
      if (!framedOnce) renderMarkers()
      else renderMarkers({ frame: false })
    }
  },
  { deep: true }
)

function activate() {
  // Embedded (page) mode never locks body scroll — the page owns scrolling.
  if (!props.embedded) lockBodyScroll()
  if (hasGoogleMapsKey()) {
    startThemeObserver()
    void nextTick(initMap)
  } else {
    mapUnavailable.value = true
  }
}
function deactivate() {
  if (!props.embedded) unlockBodyScroll()
  stopThemeObserver()
  teardownMap()
  addOpen.value = false
  mode.value = 'browse'
  addStep.value = 'search'
  candidate.value = null
  framedOnce = false
}

watch(() => props.open, (open) => {
  if (open) activate()
  else deactivate()
})

// Embedded mode mounts with `open` already true (it's a page, not a toggled
// modal), so the `open` watcher never fires — initialise on mount instead.
onMounted(() => {
  if (props.open) activate()
})

onBeforeUnmount(() => {
  if (props.open && !props.embedded) unlockBodyScroll()
  stopThemeObserver()
  teardownMap()
})

// ── Keyless fallback map (no API key) ──
const fallbackMapSrc = computed(() => {
  const q = encodeURIComponent(props.location || props.eventName || 'event')
  return `https://maps.google.com/maps?q=${q}&z=12&output=embed`
})

function onClose() { emit('close') }
function onBackdrop(event: MouseEvent) {
  if (event.target === event.currentTarget) onClose()
}
function toggleCategory(cat: 'parks' | 'hotels') {
  selectedCategories.value = { ...selectedCategories.value, [cat]: !selectedCategories.value[cat] }
  closeInfo()
}
</script>

<template>
  <Teleport to="body" :disabled="embedded">
    <Transition name="slide-modal-backdrop">
      <div
        v-if="open"
        class="map-explorer"
        :class="{ 'map-explorer--fullscreen': fullscreen, 'map-explorer--embedded': embedded }"
        :role="embedded ? 'region' : 'dialog'"
        :aria-modal="embedded ? undefined : 'true'"
        aria-label="Map Explorer"
        @click="embedded ? undefined : onBackdrop($event)"
      >
        <div class="map-explorer__panel">
          <!-- Body -->
          <div class="map-explorer__body">
            <!-- Floating close button, top-right over the map (modal only) -->
            <button v-if="!embedded" type="button" class="map-explorer__close app-tooltip app-tooltip--left" data-tooltip="Close Map Explorer" aria-label="Close Map Explorer" @click="onClose">
              <AppIcon name="close" :size="18" />
            </button>

            <!-- Interactive map -->
            <template v-if="!mapUnavailable">
              <div ref="mapHost" class="map-explorer__map"></div>

              <!-- Sticky category tab bar (blurred map behind it). -->
              <div class="map-explorer__tabsbar">
                <!-- Fullscreen (dashboard) — WIF brand + centered event
                     identity. On mobile this lead block fills the first
                     row (alongside the floating theme/close buttons) and
                     the tabs wrap to a stretched second row. -->
                <div v-if="fullscreen" class="map-explorer__lead">
                  <img
                    :src="wifIconUrl"
                    alt="Who I Follow"
                    class="map-explorer__brand"
                  />
                  <div v-if="eventName" class="map-explorer__identity">
                    <span class="map-explorer__identity-name">{{ eventName }}</span>
                    <span v-if="dateRangeLabel" class="map-explorer__identity-dates">{{ dateRangeLabel }}</span>
                  </div>
                </div>
                <div v-if="mode === 'browse'" class="map-explorer__tabs">
                  <button
                    type="button"
                    class="mapx-tab"
                    :class="{ 'mapx-tab--off': !selectedCategories.parks }"
                    data-kind="park"
                    :aria-pressed="selectedCategories.parks"
                    @click="toggleCategory('parks')"
                  >
                    <span class="mapx-tab__dot" data-kind="park" aria-hidden="true"></span>
                    Facilities
                    <span class="mapx-tab__count">{{ parkPins.length }}</span>
                  </button>
                  <button
                    type="button"
                    class="mapx-tab"
                    :class="{ 'mapx-tab--off': !selectedCategories.hotels }"
                    data-kind="hotel"
                    :aria-pressed="selectedCategories.hotels"
                    @click="toggleCategory('hotels')"
                  >
                    <span class="mapx-tab__dot" data-kind="hotel" aria-hidden="true"></span>
                    Hotels
                    <span class="mapx-tab__count">{{ hotelPins.length }}</span>
                  </button>
                  <!-- Admin: add a venue. -->
                  <button
                    v-if="canAdd"
                    type="button"
                    class="mapx-tab mapx-tab--add"
                    aria-label="Add venue"
                    @click="addOpen = true"
                  >
                    <span class="mapx-tab__plus" aria-hidden="true">+</span>
                    Add
                  </button>
                </div>
                <!-- Add mode — tabs hidden; show a back chevron + title. -->
                <div v-else class="map-explorer__addbar">
                  <button type="button" class="map-explorer__addback" aria-label="Back" @click="exitAddMode">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6 9 12l6 6" /></svg>
                  </button>
                  <span class="map-explorer__addtitle">{{ addKind === 'hotel' ? 'Add Hotel' : 'Add Playing Facility' }}</span>
                </div>
              </div>

              <!-- Add flow — top-center place search (live Google Places). -->
              <div v-if="mode !== 'browse' && addStep === 'search'" class="map-explorer__search-wrap">
                <MapPlaceSearch :placeholder="searchPlaceholder" :bias-center="searchBiasCenter" @select="onPickPrediction" />
                <p v-if="candidateLoading" class="map-explorer__search-loading">Loading place details…</p>
                <!-- Address pick → choose the actual venue found within the
                     match radius (names vary: Park / Complex / Fields…). -->
                <div v-if="nearbyResults && !candidateLoading" class="map-explorer__nearby">
                  <p class="map-explorer__nearby-title">Select the {{ addKind === 'hotel' ? 'hotel' : 'facility' }} at this location</p>
                  <ul class="map-explorer__nearby-list">
                    <li
                      v-for="n in nearbyResults"
                      :key="n.placeId"
                      class="map-explorer__nearby-row"
                      @click="onPickNearby(n.placeId)"
                    >
                      <span class="map-explorer__nearby-name">{{ n.primaryText }}</span>
                      <span v-if="n.secondaryText" class="map-explorer__nearby-sub">{{ n.secondaryText }}</span>
                    </li>
                  </ul>
                  <button type="button" class="map-explorer__nearby-use" @click="useAddressAsVenue">Use this address instead</button>
                </div>
              </div>

              <!-- Add flow — right-side wizard panel (over a blurred backdrop). -->
              <div v-if="mode !== 'browse' && addStep === 'wizard' && candidate" class="map-explorer__wizard">
                <MapAddParkWizard
                  v-if="mode === 'add-park'"
                  :place="candidate"
                  :association-id="associationId"
                  :event-id="eventId"
                  :event-start-date="eventStartDate"
                  :event-end-date="eventEndDate"
                  :event-start-time="eventStartTime"
                  :event-end-time="eventEndTime"
                  :event-all-day="eventAllDay"
                  @saved="onParkSaved"
                  @cancel="exitAddMode"
                />
                <MapAddHotelWizard
                  v-else
                  :place="candidate"
                  :association-id="associationId"
                  :event-id="eventId"
                  @saved="onHotelSaved"
                  @cancel="exitAddMode"
                />
              </div>

              <!-- Add-venue confirm popover (blurred overlay over the map). -->
              <div v-if="addOpen" class="mapx-add" @click.self="addOpen = false">
                <div class="mapx-add__panel">
                  <button type="button" class="mapx-add__close" aria-label="Cancel" @click="addOpen = false">
                    <AppIcon name="close" :size="16" />
                  </button>
                  <span v-if="eventName" class="mapx-add__eyebrow">{{ eventName }}</span>
                  <h3 class="mapx-add__title">What would you like to add?</h3>
                  <div class="mapx-add__choices">
                    <button type="button" class="mapx-add__choice" @click="chooseAdd('park')">
                      <span class="mapx-add__dot" data-kind="park" aria-hidden="true"></span>
                      Playing Facility
                    </button>
                    <button type="button" class="mapx-add__choice" @click="chooseAdd('hotel')">
                      <span class="mapx-add__dot" data-kind="hotel" aria-hidden="true"></span>
                      Hotel
                    </button>
                  </div>
                </div>
              </div>
            </template>

            <!-- Fallback (no API key): keyless iframe + venue lists -->
            <div v-else class="map-explorer__fallback">
              <div class="map-explorer__fallback-map">
                <iframe :src="fallbackMapSrc" title="Event location map" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>
              </div>
              <p class="map-explorer__note">Interactive map needs a Google Maps key — showing the location map and venue lists.</p>
              <div v-if="parks.length" class="map-explorer__group">
                <h3 class="map-explorer__group-title">Parks</h3>
                <ul class="map-explorer__list">
                  <li v-for="p in parks" :key="p.id" class="map-explorer__list-item">
                    <span class="map-explorer__list-name">{{ p.name }}</span>
                    <span class="map-explorer__list-sub">{{ p.location }}</span>
                  </li>
                </ul>
              </div>
              <div v-if="hotels.length" class="map-explorer__group">
                <h3 class="map-explorer__group-title">Partner Hotels</h3>
                <ul class="map-explorer__list">
                  <li v-for="h in hotels" :key="h.id" class="map-explorer__list-item">
                    <span class="map-explorer__list-name">{{ h.name }}</span>
                    <span class="map-explorer__list-sub">{{ h.address }}</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.map-explorer {
  position: fixed;
  /* Sit below the page's top header. `--public-header-h` is set on the
     public event page; on the MatchGeni dashboard the header publishes
     `--matchgeni-header-height` — fall back through both. */
  top: var(--public-header-h, var(--matchgeni-header-height, 64px));
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
  background: var(--body-bg, #f4f7fb);
  display: flex;
  flex-direction: column;
}
/* Fullscreen variant — cover the whole viewport (used when opened from
   the MatchGeni dashboard, which has no public-page header to clear). */
.map-explorer--fullscreen { top: 0; z-index: 1100; }
/* Embedded (page) variant — fill the positioned host container in normal
   flow instead of floating over the viewport. No Teleport, so it stays
   inside the page content area beside the left rail. */
.map-explorer--embedded {
  position: absolute;
  inset: 0;
  top: 0;
  z-index: 0;
}
html.dark-mode .map-explorer { background: var(--surface-page, #0f1722); }
.map-explorer__panel { display: flex; flex-direction: column; height: 100%; min-height: 0; }

/* Floating close button over the map (top-right). */
.map-explorer__close {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 4;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid var(--border-divider);
  background: var(--surface-card, #fff);
  color: var(--text);
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.22);
}
.map-explorer__close:hover { background: var(--surface-muted, #f1f5f9); }

.map-explorer__body { position: relative; flex: 1 1 auto; min-height: 0; }
.map-explorer__map { position: absolute; inset: 0; }

/* Category tab bar — full-width sticky strip over the top of the map, with
   the map blurred behind it (same effect as the Venue card header). */
.map-explorer__tabsbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  padding: 12px 64px 12px 16px; /* right pad clears the floating close button */
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--border-divider);
}
html.dark-mode .map-explorer__tabsbar { background: rgba(15, 23, 34, 0.5); }
/* Fullscreen lead block (brand + centered identity). On desktop it's just
   the brand at the far left — the identity inside is absolutely centered to
   the whole bar; on mobile the lead fills the first row. */
.map-explorer__lead { display: flex; align-items: center; min-width: 0; }
/* Fullscreen brand mark before the tabs. */
.map-explorer__brand {
  flex: 0 0 auto;
  height: 30px;
  width: auto;
  margin-right: 12px;
  display: block;
}
/* Fullscreen centered event identity — absolutely centered so the tabs
   on the left don't shove it off-axis. `pointer-events:none` keeps the
   map drag/clicks reaching the bar edges; it's display-only text. */
.map-explorer__identity {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  max-width: 46%;
  text-align: center;
  pointer-events: none;
}
.map-explorer__identity-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.map-explorer__identity-dates {
  font-size: 12px;
  font-weight: 500;
  color: var(--secondary);
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
/* Hide the centered identity where it would collide with the tab pills. */
@media (max-width: 840px) {
  .map-explorer__identity { display: none; }
}
.map-explorer__tabs { display: flex; gap: 8px; }
/* Neutral pills (bracket-switch shape) — each carries a legend checkbox
   that toggles its category; no active/selected state. */
.mapx-tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  min-height: 36px;
  background: var(--surface-card, #fff);
  border: 1px solid var(--border-divider);
  border-radius: 999px;
  cursor: pointer;
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.12);
  transition: background 120ms ease, border-color 120ms ease;
}
.mapx-tab:hover { background: rgba(45, 140, 240, 0.06); }
html.dark-mode .mapx-tab { background: var(--surface-card); }
/* Deselected category — dim the pill (the dot still shows its legend colour). */
.mapx-tab--off { opacity: 0.5; }
/* Legend colour dot. */
.mapx-tab__dot { flex: 0 0 auto; width: 9px; height: 9px; border-radius: 50%; }
.mapx-tab__dot[data-kind='park'] { background: #2d8cf0; }
.mapx-tab__dot[data-kind='hotel'] { background: #d6409f; }
/* Add-venue pill — primary outline. */
.mapx-tab--add { color: var(--primary, #2d8cf0); border-color: var(--primary, #2d8cf0); }
.mapx-tab--add:hover { background: rgba(45, 140, 240, 0.08); }
.mapx-tab__plus { font-size: 16px; line-height: 1; }

/* Add-mode header bar — back chevron + title replace the tabs. */
.map-explorer__addbar { display: flex; align-items: center; gap: 10px; }
.map-explorer__addback {
  flex: 0 0 auto;
  width: 36px; height: 36px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 999px;
  border: 1px solid var(--border-divider);
  background: var(--surface-card, #fff);
  color: var(--text);
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.12);
}
.map-explorer__addback:hover { background: rgba(45, 140, 240, 0.06); }
.map-explorer__addtitle { font-size: 15px; font-weight: 600; color: var(--text); white-space: nowrap; }

/* Top-center place-search overlay (add flow, search step). */
.map-explorer__search-wrap {
  position: absolute;
  top: 76px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: min(520px, calc(100% - 32px));
}
.map-explorer__search-loading {
  margin: 0;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--text);
  background: rgba(255, 255, 255, 0.92);
  padding: 4px 12px;
  border-radius: 999px;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.18);
}
html.dark-mode .map-explorer__search-loading { background: rgba(26, 34, 48, 0.92); }

/* Nearby-venue candidate card (after an address pick). */
.map-explorer__nearby {
  width: 100%;
  padding: 10px;
  background: var(--surface-card, #fff);
  border: 1px solid var(--border-divider);
  border-radius: 14px;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.22);
}
html.dark-mode .map-explorer__nearby { background: #1a2230; }
.map-explorer__nearby-title {
  margin: 2px 6px 8px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--secondary);
}
.map-explorer__nearby-list { list-style: none; margin: 0; padding: 0; max-height: 240px; overflow-y: auto; }
.map-explorer__nearby-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 9px 12px;
  border-radius: 9px;
  cursor: pointer;
}
.map-explorer__nearby-row:hover { background: rgba(45, 140, 240, 0.08); }
.map-explorer__nearby-name { font-size: 13.5px; font-weight: 600; color: var(--text); }
.map-explorer__nearby-sub { font-size: 12px; color: var(--secondary); }
.map-explorer__nearby-use {
  width: 100%;
  margin-top: 6px;
  padding: 9px 12px;
  border: 1px dashed var(--border-divider);
  border-radius: 9px;
  background: transparent;
  color: var(--primary);
  font-size: 12.5px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
}
.map-explorer__nearby-use:hover { background: rgba(45, 140, 240, 0.06); }

/* Right-side wizard — a floating card over the map, with the same blurred
   translucent treatment as the header (the map shows through behind it). */
.map-explorer__wizard {
  position: absolute;
  top: 76px;
  right: 16px;
  bottom: 16px;
  z-index: 4;
  width: min(420px, calc(100% - 32px));
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid var(--border-divider);
  border-radius: 16px;
  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.32);
  overflow: hidden;
}
html.dark-mode .map-explorer__wizard { background: rgba(15, 23, 34, 0.5); }
@media (max-width: 720px) {
  .map-explorer__search-wrap { top: 120px; }
  /* Floating bottom sheet on mobile. */
  .map-explorer__wizard {
    top: auto;
    left: 12px;
    right: 12px;
    bottom: 12px;
    height: min(72%, 560px);
    width: auto;
    border-radius: 16px;
    box-shadow: 0 -10px 34px rgba(15, 23, 42, 0.34);
  }
}

/* Mobile (fullscreen) — first row keeps the brand + event identity (with
   the floating theme/close buttons overlaid top-right); the Facilities/
   Hotels/Add controls wrap to a stretched second row. */
@media (max-width: 720px) {
  .map-explorer__tabsbar {
    flex-wrap: wrap;
    row-gap: 10px;
  }
  /* Only the fullscreen (dashboard) layout wraps the tabs onto a second
     row — there the first (lead) row reserves space for the floating
     close button, so the tab row can use the full width. In the public
     (non-fullscreen) explorer the tabs are the sole row, so keep the
     right padding that clears the floating close button (otherwise the
     Hotels tab slides under it). */
  .map-explorer--fullscreen .map-explorer__tabsbar { padding-right: 16px; }
  .map-explorer__lead {
    flex: 1 1 100%;
    /* Reserve room for the floating theme + close buttons (40px each). */
    padding-right: 104px;
  }
  .map-explorer__identity {
    position: static;
    transform: none;
    flex: 1 1 auto;
    min-width: 0;
    max-width: 100%;
    align-items: flex-start;
    text-align: left;
    pointer-events: auto;
    display: flex; /* override the ≤840px hide */
  }
  .map-explorer__tabs { flex: 1 1 100%; }
  .map-explorer__tabs .mapx-tab { flex: 1 1 0; justify-content: center; }
}

/* Add-venue confirm popover — blurred overlay over the map. */
.mapx-add {
  position: absolute;
  inset: 0;
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(15, 23, 34, 0.35);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.mapx-add__panel {
  position: relative;
  width: min(320px, 100%);
  padding: 18px;
  border-radius: 14px;
  background: var(--surface-card, #fff);
  border: 1px solid var(--border-divider);
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.28);
}
.mapx-add__close {
  position: absolute; top: 10px; right: 10px;
  width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center;
  border: none; background: transparent; color: var(--secondary); cursor: pointer; border-radius: 6px;
}
.mapx-add__close:hover { background: var(--surface-muted, #f1f5f9); }
.mapx-add__eyebrow {
  display: block;
  margin: 0 0 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--secondary);
}
.mapx-add__title { margin: 0 0 14px; font-size: 15px; font-weight: 600; color: var(--text); }
.mapx-add__choices { display: flex; flex-direction: column; gap: 8px; }
.mapx-add__choice {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; border-radius: 10px;
  border: 1px solid var(--border-divider); background: var(--surface-card, #fff);
  color: var(--text); font-size: 14px; font-weight: 500; cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease;
}
.mapx-add__choice:hover { border-color: var(--primary); background: rgba(45, 140, 240, 0.06); }
.mapx-add__dot { width: 11px; height: 11px; border-radius: 50%; flex: 0 0 auto; }
.mapx-add__dot[data-kind='park'] { background: #2d8cf0; }
.mapx-add__dot[data-kind='hotel'] { background: #d6409f; }
.mapx-tab__count {
  font-size: 11px; font-weight: 700; line-height: 1;
  padding: 2px 7px; border-radius: 999px;
  background: rgba(15, 23, 42, 0.08);
}
html.dark-mode .mapx-tab__count { background: rgba(255, 255, 255, 0.08); }

/* Fallback */
.map-explorer__fallback { position: absolute; inset: 0; overflow-y: auto; padding: 18px; max-width: 720px; margin: 0 auto; }
.map-explorer__fallback-map { border-radius: 12px; overflow: hidden; border: 1px solid var(--border-divider); }
.map-explorer__fallback-map iframe { display: block; width: 100%; height: 320px; border: 0; }
.map-explorer__note { margin: 12px 0; font-size: 12.5px; color: var(--secondary); }
.map-explorer__group + .map-explorer__group { margin-top: 16px; }
.map-explorer__group-title { margin: 0 0 10px; font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--secondary); }
.map-explorer__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.map-explorer__list-item { display: flex; flex-direction: column; gap: 1px; }
.map-explorer__list-name { font-size: 13px; font-weight: 600; color: var(--text); }
.map-explorer__list-sub { font-size: 12px; color: var(--text); }
</style>

<!-- Non-scoped: the InfoWindow body renders inside Google's DOM, so scoped
     CSS can't reach it. These classes are injected globally instead. -->
<style>
.mapx-iw { min-width: 200px; max-width: 300px; font-family: inherit; }
.mapx-iw__kind {
  display: inline-block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
  color: #fff; padding: 2px 8px; border-radius: 999px;
}
.mapx-iw__name { margin: 8px 0 6px; font-size: 16px; font-weight: 600; color: var(--text); }
/* InfoWindow header (badge + name on the left; close button is on the right). */
/* Badge on top, name below (name wraps up to two lines). */
.mapx-iw__hdr { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; min-width: 0; padding-right: 4px; }
.mapx-iw__hdr-top { display: flex; align-items: center; gap: 10px; width: 100%; }
.mapx-iw__dir { margin-left: auto; flex: 0 0 auto; font-size: 12px; font-weight: 600; color: var(--primary); text-decoration: none; white-space: nowrap; }
.mapx-iw__dir:hover { text-decoration: underline; }
.mapx-iw__hdr-name {
  font-size: 15px; font-weight: 600; color: var(--text); line-height: 1.25;
  display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.mapx-iw__line { margin: 0 0 6px; font-size: 13px; font-weight: 500; color: var(--text) !important; }
.mapx-iw__line-label { margin: 0 0 6px; font-size: 13px; font-weight: 600; color: var(--secondary); }
/* Park schedule — flat chevrons flank the rail (not overlaid). */
.mapx-iw__sched-wrap { display: flex; align-items: center; gap: 4px; margin: 0 0 2px; }
.mapx-iw__sched-nav {
  flex: 0 0 auto;
  appearance: none;
  border: none;
  background: none;
  padding: 0;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--secondary);
  cursor: pointer;
}
.mapx-iw__sched-nav:hover { color: var(--primary); }
/* Horizontal rail of date/time cards. */
.mapx-iw__sched {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
}
.mapx-iw__sched::-webkit-scrollbar { display: none; }
.mapx-iw__sched-card {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 9px;
  border-radius: 8px;
  background: var(--surface-card, #fff);
  border: 1px solid var(--border-divider);
}
.mapx-iw__sched-card strong { font-size: 12px; font-weight: 600; color: var(--text); white-space: nowrap; }
.mapx-iw__sched-card span { font-size: 11.5px; font-weight: 500; color: var(--text) !important; white-space: nowrap; }
.mapx-iw__muted { margin: 0; font-size: 12.5px; color: var(--secondary); }
.mapx-iw__rating { display: flex; align-items: center; gap: 6px; margin: 6px 0; font-size: 13px; color: var(--text); }
.mapx-iw__star { color: #f5a623; }
.mapx-iw__gallery { position: relative; margin-top: 10px; }
.mapx-iw__photos { display: flex; gap: 8px; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; border-radius: 10px; }
.mapx-iw__photos::-webkit-scrollbar { display: none; }
.mapx-iw__photo { flex: 0 0 auto; width: 240px; height: 130px; object-fit: cover; border-radius: 10px; scroll-snap-align: start; }
/* Prev/next gallery navigation, overlaid on the photo strip. */
.mapx-iw__nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.92);
  color: #1f2733;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  z-index: 2;
  padding: 0;
}
.mapx-iw__nav:hover { background: #fff; }
.mapx-iw__nav--prev { left: 6px; }
.mapx-iw__nav--next { right: 6px; }

/* Google wraps InfoWindow content in a scrollable box; suppress its
   scrollbars so our card never shows a vertical/horizontal scroller. */
.gm-style-iw-d { overflow: hidden !important; }
.gm-style-iw-d::-webkit-scrollbar { display: none !important; }
/* Even padding on all sides of the popup. Google leaves a default
   padding-inline-start on the container (only end/top/bottom are zeroed
   inline), so zero the container and set the inset on header + body. */
.gm-style-iw-c { padding: 0 !important; }
.gm-style-iw-ch { padding: 14px 14px 6px 14px !important; }
.gm-style-iw-d { padding: 0 14px 14px 14px !important; }

/* Dark mode: Google keeps the InfoWindow bubble white regardless of the
   map colorScheme, so our (light) themed text becomes unreadable. Recolour
   the bubble, its pointer tail, and the close icon to match the theme. */
html.dark-mode .gm-style-iw,
html.dark-mode .gm-style-iw-c,
html.dark-mode .gm-style-iw-d { background-color: #1a2230 !important; }
html.dark-mode .gm-style .gm-style-iw-tc::after { background: #1a2230 !important; }
html.dark-mode .gm-style-iw-c { box-shadow: 0 2px 14px rgba(0, 0, 0, 0.55) !important; }
html.dark-mode .gm-ui-hover-effect > span { background-color: #cfd8e3 !important; }
.mapx-iw__book {
  display: inline-block; margin-top: 12px; padding: 8px 16px; border-radius: 8px;
  background: var(--primary); color: #fff; font-size: 13px; font-weight: 600; text-decoration: none;
}
.mapx-iw__book:hover { filter: brightness(0.95); }
/* Hotel website link — reads as a primary link, not default-underlined text. */
.mapx-iw__weblink { color: var(--primary); text-decoration: none; }
.mapx-iw__weblink:hover { text-decoration: underline; }

/* Candidate (new place) action footer — Cancel / Add buttons. */
.mapx-iw__actions { display: flex; gap: 8px; margin-top: 12px; }
.mapx-iw__btn {
  flex: 1 1 0;
  appearance: none;
  border-radius: 8px;
  padding: 9px 12px;
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  border: 1px solid var(--border-divider);
}
.mapx-iw__btn--ghost { background: var(--surface-card, #fff); color: var(--text); }
.mapx-iw__btn--ghost:hover { background: var(--surface-muted, #f1f5f9); }
.mapx-iw__btn--primary { background: var(--primary); border-color: var(--primary); color: #fff; }
.mapx-iw__btn--primary:hover { filter: brightness(0.96); }
/* Dark mode — calmer primary + a translucent ghost so both read correctly
   on the dark info bubble (#1a2230) instead of the bright light-mode blue. */
html.dark-mode .mapx-iw__btn--ghost {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.18);
  color: #e6edf5;
}
html.dark-mode .mapx-iw__btn--ghost:hover { background: rgba(255, 255, 255, 0.12); }
html.dark-mode .mapx-iw__btn--primary {
  background: var(--primary-light);
  border-color: var(--primary-light);
  color: #fff;
}
</style>
