<script setup lang="ts">
// EventLocationMap
// ----------------
// Compact, read-only Google map preview for the Add/Edit Event wizard's
// in-person Location step. Drops a single pin at the venue position picked
// from the Google Places search above it and recenters when that position
// changes. Falls back to a clean placeholder when no Maps key is configured
// (mirrors PublicVenueMap). Purely a visual confirmation — no interaction.

import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { loadGoogleMaps, hasGoogleMapsKey, MAP_ID } from '../lib/googleMaps'
import calendarRaw from '../assets/calendar.svg?raw'
import type { GeoPosition } from '../types'

const props = withDefaults(defineProps<{
  position?: GeoPosition | null
}>(), {
  position: null
})

const PIN_COLOR = '#2e9e4f'
// Continental-US centre — the keyless/empty fallback view.
const US_CENTER = { lat: 39.8283, lng: -98.5795 }

const mapHost = ref<HTMLElement | null>(null)
const unavailable = ref(!hasGoogleMapsKey())
let mapInstance: google.maps.Map | null = null
let marker: google.maps.marker.AdvancedMarkerElement | null = null
let googleNs: typeof google | null = null

function isDarkMode(): boolean {
  return document.documentElement.classList.contains('dark-mode')
}

function buildPin(): HTMLElement {
  // Green disc with the white calendar glyph (the event brand icon),
  // recoloured white (the source strokes/fill are `#254C72`).
  const raw = calendarRaw.replace(/#254C72/gi, '#ffffff').replace(/currentColor/g, '#ffffff')
  const ring = isDarkMode() ? '#0f1722' : '#fff'
  const el = document.createElement('div')
  el.style.cssText = [
    'width:44px', 'height:44px', 'border-radius:50%', `background:${PIN_COLOR}`,
    'display:flex', 'align-items:center', 'justify-content:center',
    `border:3px solid ${ring}`, 'box-shadow:0 2px 8px rgba(0,0,0,0.4)'
  ].join(';')
  el.innerHTML = raw
  const svg = el.querySelector('svg')
  if (svg) {
    svg.setAttribute('width', '24')
    svg.setAttribute('height', '24')
    svg.style.display = 'block'
  }
  return el
}

function renderMarker() {
  if (!mapInstance || !googleNs) return
  if (marker) { marker.map = null; marker = null }
  const pos = props.position
  if (!pos) {
    mapInstance.setCenter(US_CENTER)
    mapInstance.setZoom(4)
    return
  }
  marker = new googleNs.maps.marker.AdvancedMarkerElement({
    map: mapInstance,
    position: pos,
    content: buildPin()
  })
  mapInstance.setCenter(pos)
  mapInstance.setZoom(15)
}

async function initMap() {
  googleNs = await loadGoogleMaps()
  if (!googleNs || !mapHost.value) { unavailable.value = true; return }
  unavailable.value = false
  // `colorScheme` is read at construction, so the basemap matches the theme.
  const opts: google.maps.MapOptions & { colorScheme?: string } = {
    mapId: MAP_ID,
    center: props.position ?? US_CENTER,
    zoom: props.position ? 15 : 4,
    disableDefaultUI: true,
    gestureHandling: 'none',
    keyboardShortcuts: false,
    clickableIcons: false,
    colorScheme: isDarkMode() ? 'DARK' : 'LIGHT'
  }
  mapInstance = new googleNs.maps.Map(mapHost.value, opts)
  renderMarker()
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

watch(() => props.position, () => renderMarker(), { deep: true })
onMounted(() => { if (hasGoogleMapsKey()) { startThemeObserver(); initMap() } })
onBeforeUnmount(() => {
  themeObserver?.disconnect(); themeObserver = null
  if (marker) marker.map = null
  marker = null; mapInstance = null
})
</script>

<template>
  <div class="evt-loc-map">
    <div v-if="!unavailable" ref="mapHost" class="evt-loc-map__canvas"></div>
    <!-- No Maps key — a clean placeholder (no third-party iframe). -->
    <div v-else class="evt-loc-map__placeholder">
      <span class="evt-loc-map__placeholder-icon" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>
      </span>
      <span class="evt-loc-map__placeholder-text">Search to drop the venue pin</span>
    </div>
  </div>
</template>

<style scoped>
.evt-loc-map {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  border: 1px solid var(--border-divider);
  border-radius: 12px;
  overflow: hidden;
  /* Placeholder fill shown until the tiles paint — white in light mode,
     the card surface in dark mode so it isn't a grey box. */
  background: var(--white, #fff);
}
html.dark-mode .evt-loc-map { background: var(--surface-card, #16202c); }
.evt-loc-map__canvas { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.evt-loc-map__placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--secondary);
}
.evt-loc-map__placeholder-icon { color: var(--primary); display: inline-flex; }
.evt-loc-map__placeholder-text { font-size: 13px; font-weight: 600; }
</style>
