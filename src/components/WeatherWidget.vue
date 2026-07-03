<script setup lang="ts">
// WeatherWidget
// -------------
// Reusable compact weather chip — icon + temperature + condition.
// Drives the live "what's the weather right now at the park"
// affordance on every surface a tournament director, umpire, or
// scorekeeper might need it (field-grid toolbar today; scheduler
// header, public event page, mobile dashboard later).
//
// V1 is presentational only — the parent passes the data via
// props. When backend ships a `/weather?parkId=…` (or similar)
// endpoint, the component stays the same; a wrapping `<Suspense>`
// or composable can drive the data fetch in callers that want it.
//
// Icon strategy: inline SVG `<path>` elements painted via
// `currentColor` so the glyph themes with the surrounding text
// color in light + dark mode without a separate asset file per
// condition. Each condition keeps its glyph self-contained so
// adding a new condition is a one-row change to the `iconPath`
// switch + the `WeatherCondition` type below.

import { computed } from 'vue'

/** Weather condition union — drives both the icon AND (optionally)
 *  the fallback condition label when the parent doesn't supply a
 *  custom `description`. Extend by adding a new value here +
 *  matching arm in `iconPaths` below + a fallback in
 *  `conditionLabel`. */
export type WeatherCondition =
  | 'sunny'
  | 'partly-cloudy'
  | 'cloudy'
  | 'rainy'
  | 'thunderstorm'
  | 'snowy'
  | 'windy'

const props = withDefaults(defineProps<{
  /** Current temperature. Rendered verbatim (no rounding) so the
   *  parent controls precision. */
  temperature: number
  condition: WeatherCondition
  /** Temperature unit suffix. `'F'` → "72°F" / `'C'` → "22°C".
   *  Default `'F'` since the primary user base is US-based. */
  unit?: 'F' | 'C'
  /** Optional one-liner shown after the temperature ("Light
   *  breeze", "Severe thunderstorm warning", etc.). Falls back to
   *  the condition's title-case label when omitted. */
  description?: string
  /** When `true`, drops the condition label entirely — useful in
   *  tight headers where the icon + temperature carry the message
   *  on their own. */
  hideDescription?: boolean
  /** Day's forecast high temperature. Rendered next to the current
   *  temp as a `↑78°` chip. Both `high` and `low` must be present
   *  for the chip to render — passing just one is a caller bug. */
  high?: number
  /** Day's forecast low temperature. See `high`. */
  low?: number
}>(), {
  unit: 'F',
  hideDescription: false
})

/** Title-case label for each condition. Used when the caller
 *  doesn't supply a custom `description`. */
const CONDITION_LABEL: Record<WeatherCondition, string> = {
  sunny: 'Sunny',
  'partly-cloudy': 'Partly cloudy',
  cloudy: 'Cloudy',
  rainy: 'Rainy',
  thunderstorm: 'Thunderstorm',
  snowy: 'Snowy',
  windy: 'Windy'
}

const resolvedDescription = computed(() =>
  props.description ?? CONDITION_LABEL[props.condition]
)

/** Show the high/low chip only when BOTH values are present.
 *  Defends against half-populated callers (e.g. a backend that
 *  ships current temp but hasn't computed the day's forecast
 *  yet) showing a misleading "↑— ↓62°" half-chip. */
const showHighLow = computed(() =>
  typeof props.high === 'number' && typeof props.low === 'number'
)

/** Inline SVG paths per condition. Drawn on a 24×24 viewBox so
 *  the parent can size with a CSS `width` / `height` (defaults to
 *  16px below). All strokes use `currentColor` so the icon themes
 *  cleanly with light + dark mode without a per-mode asset. */
const ICON_PATHS: Record<WeatherCondition, string> = {
  // Sun — circle + 8 rays
  sunny:
    'M12 4V2 M12 22v-2 M4 12H2 M22 12h-2 M5.6 5.6L4.2 4.2 ' +
    'M19.8 19.8l-1.4-1.4 M5.6 18.4l-1.4 1.4 M19.8 4.2l-1.4 1.4 ' +
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  // Sun + cloud — sun behind, cloud overlay
  'partly-cloudy':
    'M16 6a3 3 0 0 1 3 3 M7 18h11a4 4 0 0 0 0-8 5 5 0 0 0-9.6-1 ' +
    'A3.5 3.5 0 0 0 7 18z',
  // Plain cloud
  cloudy:
    'M7 18h11a4 4 0 0 0 0-8 5 5 0 0 0-9.6-1A3.5 3.5 0 0 0 7 18z',
  // Cloud + 3 raindrops
  rainy:
    'M7 14h11a4 4 0 0 0 0-8 5 5 0 0 0-9.6-1A3.5 3.5 0 0 0 7 14z ' +
    'M9 17v3 M13 17v3 M17 17v3',
  // Cloud + lightning bolt
  thunderstorm:
    'M7 14h11a4 4 0 0 0 0-8 5 5 0 0 0-9.6-1A3.5 3.5 0 0 0 7 14z ' +
    'M13 16l-3 4h3l-2 4',
  // Cloud + 3 snowflake asterisks
  snowy:
    'M7 14h11a4 4 0 0 0 0-8 5 5 0 0 0-9.6-1A3.5 3.5 0 0 0 7 14z ' +
    'M9 18l0 4 M8 20h2 M13 18l0 4 M12 20h2 M17 18l0 4 M16 20h2',
  // Three horizontal wind lines, the bottom one shorter
  windy:
    'M4 8h12a3 3 0 1 0-3-3 M3 13h17a3 3 0 1 1-3 3 M4 18h9'
}

const iconPath = computed(() => ICON_PATHS[props.condition])
</script>

<template>
  <div class="weather-widget" :data-condition="condition">
    <svg
      class="weather-widget__icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path :d="iconPath" />
    </svg>
    <span class="weather-widget__temp">
      {{ temperature }}<span class="weather-widget__unit">°{{ unit }}</span>
    </span>
    <!-- High / low chip — compact `↑78° ↓62°` pair sitting between
         the current temp and the condition label. Hidden when the
         caller hasn't supplied a forecast (current-only mode). -->
    <span
      v-if="showHighLow"
      class="weather-widget__range"
      :aria-label="`High ${high} degrees, low ${low} degrees`"
    >
      <span class="weather-widget__range-cell">
        <span class="weather-widget__range-arrow" aria-hidden="true">↑</span>{{ high }}°
      </span>
      <span class="weather-widget__range-cell">
        <span class="weather-widget__range-arrow" aria-hidden="true">↓</span>{{ low }}°
      </span>
    </span>
    <span
      v-if="!hideDescription"
      class="weather-widget__desc"
    >{{ resolvedDescription }}</span>
  </div>
</template>

<style scoped>
/* Compact horizontal pill — icon, temperature, condition label.
   No background of its own so the widget adopts whatever surface
   tone it lives inside (toolbar, card, header bar). Add background
   / border at the call site if a "chip" look is wanted. */
.weather-widget {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text);
  line-height: 1;
}

.weather-widget__icon {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  /* Default neutral tone — overridden per-condition below so e.g.
     thunderstorms read amber, sunny reads warmer, etc. without
     callers needing to know about the conditions at all. */
  color: var(--text);
}
/* Condition-tinted icons — only the icon picks up the tone; the
   temperature + description stay at default text color so the
   widget doesn't shout from across the page. */
.weather-widget[data-condition='sunny'] .weather-widget__icon {
  color: #f5a623; /* warm amber */
}
.weather-widget[data-condition='partly-cloudy'] .weather-widget__icon {
  color: #7fb0e8; /* soft blue */
}
.weather-widget[data-condition='cloudy'] .weather-widget__icon {
  color: var(--secondary);
}
.weather-widget[data-condition='rainy'] .weather-widget__icon {
  color: #5ea0e8; /* rain blue */
}
.weather-widget[data-condition='thunderstorm'] .weather-widget__icon {
  color: #c47a00; /* warning amber */
}
.weather-widget[data-condition='snowy'] .weather-widget__icon {
  color: #9bb8d6; /* cool grey-blue */
}
.weather-widget[data-condition='windy'] .weather-widget__icon {
  color: var(--secondary);
}

.weather-widget__temp {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.weather-widget__unit {
  font-weight: 500;
  color: var(--secondary);
  margin-left: 1px;
}

/* High / low chip — two `↑78° ↓62°` cells inline. Smaller font +
   secondary color so they read as supporting context, not as
   competing primary data alongside the current temperature. */
.weather-widget__range {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--secondary);
  font-variant-numeric: tabular-nums;
}
.weather-widget__range-cell {
  display: inline-flex;
  align-items: center;
  gap: 1px;
}
.weather-widget__range-arrow {
  font-weight: 700;
  /* Slight downscale so the arrow glyph sits flush with the
     digit baseline instead of towering above the numerals. */
  font-size: 11px;
}
.weather-widget__desc {
  color: var(--secondary);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
</style>
