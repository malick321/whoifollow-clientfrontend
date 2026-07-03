import { postLegacyFormData } from './client'
import type { TeamEventForecastDay } from '../types'

// Event weather client.
//
// Backed by the legacy `/event/getApiWeatherData` endpoint — the backend
// wraps the WeatherAPI.com call for us, so we never see an API key or a
// third-party URL from the browser. We POST the numeric event_id as a
// form-data field and receive a 5-day forecast array.
//
// Graceful failure: any error returns `null` so the caller can hide the UI
// without surfacing an alarming toast for a non-critical feature.

interface ApiWeatherDay {
  /** ISO date string, e.g. "2026-04-20". */
  day: string
  temperatureMin: number
  temperatureMax: number
  /** Human-readable condition (e.g. "Sunny", "Partly cloudy"). */
  condition: string | null
  /** Protocol-relative icon URL from WeatherAPI's CDN, passed through by
   *  our backend, e.g. "//cdn.weatherapi.com/weather/64x64/day/113.png". */
  icon: string | null
}

interface ApiWeatherEnvelope {
  statusCode?: number | null
  message?: string | null
  data?: ApiWeatherDay[] | null
}

export async function fetchEventWeather(
  eventId: string | number
): Promise<TeamEventForecastDay[] | null> {
  const id = String(eventId ?? '').trim()
  if (!id) return null

  try {
    const payload = await postLegacyFormData<ApiWeatherEnvelope>(
      '/event/getApiWeatherData',
      { event_id: id }
    )
    const rows = payload?.data ?? []
    if (!rows.length) return null
    return rows.map(mapDay)
  } catch {
    return null
  }
}

function mapDay(raw: ApiWeatherDay): TeamEventForecastDay {
  return {
    label: formatLabel(raw.day),
    // Legacy bucket kept for backward-compat (mock fallback) — real cells
    // always render via iconUrl. "partly-cloudy" is a neutral default.
    icon: 'partly-cloudy',
    iconUrl: normalizeIconUrl(raw.icon),
    conditionText: raw.condition ?? undefined,
    high: Math.round(raw.temperatureMax),
    low: Math.round(raw.temperatureMin)
  }
}

/** Format "2026-04-20" → "Mon, Apr 20", matching the cell label spec. */
function formatLabel(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(iso))
}

/** Backend forwards WeatherAPI's protocol-relative URLs ("//cdn…"). Prepend
 *  https: so the <img> works without relying on document.location. */
function normalizeIconUrl(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined
  if (raw.startsWith('//')) return 'https:' + raw
  if (raw.startsWith('http')) return raw
  return undefined
}
