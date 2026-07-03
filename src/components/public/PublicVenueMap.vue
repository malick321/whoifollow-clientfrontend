<script setup lang="ts">
// PublicVenueMap
// --------------
// Compact, non-interactive map preview for the Venue Guide card: park
// (primary) + hotel (magenta) pins, auto-fit so all pins show. The whole
// preview is a button that opens the full Map Explorer. Falls back to the
// keyless map iframe when no Maps key is configured.

import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { loadGoogleMaps, hasGoogleMapsKey, MAP_ID } from '../../lib/googleMaps'
import parkRaw from '../../assets/park.svg?raw'
import hotelRaw from '../../assets/hotel.svg?raw'
import type { EventHotel, PublicEventPark } from '../../types'

const props = withDefaults(defineProps<{
  parks?: PublicEventPark[]
  hotels?: EventHotel[]
  location?: string
  eventName?: string
}>(), {
  parks: () => [],
  hotels: () => []
})

const emit = defineEmits<{ (event: 'open'): void }>()

const PARK_COLOR = '#2d8cf0'
const HOTEL_COLOR = '#d6409f'
// Top inset (px) reserved for the blurred header overlay so pins stay clear.
const HEADER_PAD = 76

const mapHost = ref<HTMLElement | null>(null)
const unavailable = ref(!hasGoogleMapsKey())
let mapInstance: google.maps.Map | null = null
let markers: google.maps.marker.AdvancedMarkerElement[] = []
let googleNs: typeof google | null = null

function buildPin(kind: 'park' | 'hotel'): HTMLElement {
  const color = kind === 'park' ? PARK_COLOR : HOTEL_COLOR
  // Inject the SVG markup directly, recoloured white (mask-image fails for
  // these icons — the park glyph has a full-area twotone shape).
  const raw = (kind === 'park' ? parkRaw : hotelRaw)
    .replace(/#254C72/gi, '#ffffff')
    .replace(/currentColor/g, '#ffffff')
  // White ring in light mode; a dark slate ring in dark mode so the pin
  // still reads as a distinct marker against the dark basemap.
  const ring = isDarkMode() ? '#0f1722' : '#fff'
  const el = document.createElement('div')
  el.style.cssText = [
    'width:28px', 'height:28px', 'border-radius:50%', `background:${color}`,
    'display:flex', 'align-items:center', 'justify-content:center',
    `border:2px solid ${ring}`, 'box-shadow:0 2px 6px rgba(0,0,0,0.35)'
  ].join(';')
  el.innerHTML = raw
  const svg = el.querySelector('svg')
  if (svg) {
    svg.setAttribute('width', '15')
    svg.setAttribute('height', '15')
    svg.style.display = 'block'
  }
  return el
}

function renderMarkers() {
  if (!mapInstance || !googleNs) return
  for (const m of markers) m.map = null
  markers = []
  const bounds = new googleNs.maps.LatLngBounds()
  let count = 0
  const add = (pos: { lat: number; lng: number } | undefined, kind: 'park' | 'hotel') => {
    if (!pos) return
    markers.push(new googleNs!.maps.marker.AdvancedMarkerElement({ map: mapInstance!, position: pos, content: buildPin(kind) }))
    bounds.extend(pos)
    count++
  }
  ;(props.parks ?? []).forEach((p) => add(p.position, 'park'))
  ;(props.hotels ?? []).forEach((h) => add(h.position, 'hotel'))
  if (count === 1) {
    mapInstance.setCenter(bounds.getCenter())
    mapInstance.setZoom(13)
    // Nudge the lone pin below the blurred header so it isn't clipped.
    mapInstance.panBy(0, -HEADER_PAD / 2)
  } else if (count > 1) {
    // Extra top padding keeps every pin inside the viewable area below the
    // blurred header overlay (~60px tall).
    mapInstance.fitBounds(bounds, { top: HEADER_PAD, right: 36, bottom: 36, left: 36 })
  }
}

function isDarkMode(): boolean {
  return document.documentElement.classList.contains('dark-mode')
}

async function initMap() {
  googleNs = await loadGoogleMaps()
  if (!googleNs || !mapHost.value) { unavailable.value = true; return }
  unavailable.value = false
  // `colorScheme` is read at construction, so the basemap matches the theme.
  const opts: google.maps.MapOptions & { colorScheme?: string } = {
    mapId: MAP_ID,
    center: { lat: 39.1638, lng: -119.7674 },
    zoom: 12,
    disableDefaultUI: true,
    gestureHandling: 'none',
    keyboardShortcuts: false,
    clickableIcons: false,
    colorScheme: isDarkMode() ? 'DARK' : 'LIGHT'
  }
  mapInstance = new googleNs.maps.Map(mapHost.value, opts)
  renderMarkers()
}

// Re-create the map when the theme flips (Google reads colorScheme only at
// construction).
let themeObserver: MutationObserver | null = null
let lastDark = false
function startThemeObserver() {
  if (themeObserver || typeof MutationObserver === 'undefined') return
  lastDark = isDarkMode()
  themeObserver = new MutationObserver(() => {
    const dark = isDarkMode()
    if (dark === lastDark) return
    lastDark = dark
    if (mapInstance && mapHost.value) initMap()
  })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
}

watch(() => [props.parks, props.hotels], () => renderMarkers(), { deep: true })
onMounted(() => { if (hasGoogleMapsKey()) { startThemeObserver(); initMap() } })
onBeforeUnmount(() => {
  themeObserver?.disconnect(); themeObserver = null
  for (const m of markers) m.map = null; markers = []; mapInstance = null
})
</script>

<template>
  <button type="button" class="pub-venuemap" aria-label="Open Map Explorer" @click="emit('open')">
    <div v-if="!unavailable" ref="mapHost" class="pub-venuemap__canvas"></div>
    <!-- No Maps key — a clean placeholder (no third-party iframe / buttons). -->
    <div v-else class="pub-venuemap__placeholder">
      <span class="pub-venuemap__placeholder-icon" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>
      </span>
      <span class="pub-venuemap__placeholder-text">Open Map Explorer</span>
    </div>
    <!-- Transparent overlay so a click anywhere opens the full explorer
         (the inner map has gestures disabled). -->
    <span class="pub-venuemap__overlay" aria-hidden="true"></span>
  </button>
</template>

<style scoped>
.pub-venuemap {
  position: relative;
  display: block;
  width: 100%;
  height: 240px;
  padding: 0;
  border: 1px solid var(--border-divider);
  border-radius: 12px;
  overflow: hidden;
  /* Placeholder fill shown until the map tiles paint over it — white in
     light mode, the card surface in dark mode so it isn't a grey box. */
  background: var(--white, #fff);
  cursor: pointer;
}
html.dark-mode .pub-venuemap { background: var(--surface-card, #16202c); }
.pub-venuemap__canvas { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.pub-venuemap__overlay { position: absolute; inset: 0; }
.pub-venuemap__placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--secondary);
}
.pub-venuemap__placeholder-icon { color: var(--primary); display: inline-flex; }
.pub-venuemap__placeholder-text { font-size: 13px; font-weight: 600; }
</style>
