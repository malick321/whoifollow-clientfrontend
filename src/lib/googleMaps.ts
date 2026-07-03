// googleMaps
// ----------
// Thin singleton wrapper around the official `@googlemaps/js-api-loader`.
// Loads the Maps JS SDK once (maps + marker + places libraries) using the
// `VITE_GOOGLE_MAPS_API_KEY` env var. When no key is configured, callers
// get `null` and render their keyless fallback (the public Map Explorer
// falls back to the iframe + venue lists).

import { setOptions, importLibrary } from '@googlemaps/js-api-loader'

/** A shared map id is required for AdvancedMarkerElement. A cloud-styled
 *  map id can be swapped in later; the default demo id renders fine. */
export const MAP_ID = 'wif-public-map'

const apiKey = (import.meta.env.GOOGLE_MAPS_API_KEY ?? '').trim()

/** `true` when a Maps key is configured (interactive map available). */
export function hasGoogleMapsKey(): boolean {
  return apiKey.length > 0
}

let loadPromise: Promise<typeof google | null> | null = null
let configured = false

/** Load the Google Maps SDK once (new functional loader API: `setOptions`
 *  + `importLibrary`). Resolves to the `google` namespace, or `null` when
 *  no API key is set (or loading fails) — callers fall back. */
export function loadGoogleMaps(): Promise<typeof google | null> {
  if (!hasGoogleMapsKey()) return Promise.resolve(null)
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    try {
      if (!configured) {
        setOptions({ key: apiKey, v: 'weekly' })
        configured = true
      }
      // Loading these libraries populates the global `google.maps.*`.
      await Promise.all([
        importLibrary('maps'),
        importLibrary('marker'),
        importLibrary('places')
      ])
      return typeof google !== 'undefined' ? google : null
    } catch (err) {
      if (typeof console !== 'undefined') {
        // eslint-disable-next-line no-console
        console.error('[googleMaps] SDK failed to load:', err)
      }
      loadPromise = null // allow a later retry
      return null
    }
  })()

  return loadPromise
}
