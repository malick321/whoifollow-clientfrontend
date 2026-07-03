<script setup lang="ts">
// FieldPositionPreview
// --------------------
// Read-only field diagram: the softball-field artwork + a field
// configuration's position pins (code labels). Drawn on the SAME 460-frame
// SVG and styled with the SAME global `event-lineup-preview__*` classes as
// the game-details "Preview Lineup" (FieldLineupPreview.vue) — so every
// field preview in the app speaks one visual language. No players, no
// drag/drop: just the layout.
//
// Consumers: Add/Edit Event wizard (Format step, field-config card) and
// Add/Edit Division (Field Config step). FieldLineupPreview keeps its own
// player/drag layer for the game-details surface but shares these styles.

import { computed } from 'vue'
import type { FieldConfigPosition } from '../types'

const props = withDefaults(defineProps<{
  positions: FieldConfigPosition[]
  fieldConfigName?: string
}>(), {
  fieldConfigName: ''
})

// Same artwork + coordinate frame as FieldLineupPreview.
const fieldImageUrl = new URL('../assets/softball-field.png', import.meta.url).href

// Pins = positions with real x/y that aren't disabled. Coordinates are in
// the 460×460 reference frame (viewBox "0 -50 460 460"), matching the
// backend's `x_axis`/`y_axis` (see shared-services-api-contract §5/§8).
const pins = computed(() =>
  props.positions
    .filter((p) => p.status !== 0 && typeof p.xAxis === 'number' && typeof p.yAxis === 'number')
    .map((p) => ({ code: p.code, xAxis: p.xAxis as number, yAxis: p.yAxis as number }))
)
</script>

<template>
  <div class="event-lineup-preview__field-frame">
    <svg
      class="event-lineup-preview__field-svg"
      viewBox="0 -50 460 460"
      preserveAspectRatio="xMidYMid meet"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      :aria-label="`${fieldConfigName || 'Field'} layout preview`"
    >
      <image :href="fieldImageUrl" x="0" y="-50" width="460" height="460" preserveAspectRatio="xMidYMid meet" />
      <g
        v-for="pin in pins"
        :key="`pin-${pin.code}`"
        :transform="`translate(${pin.xAxis}, ${pin.yAxis})`"
        class="event-lineup-preview__pin event-lineup-preview__pin--unassigned"
      >
        <circle class="event-lineup-preview__pin-circle" r="13" />
        <text class="event-lineup-preview__pin-code" text-anchor="middle" dominant-baseline="middle">{{ pin.code }}</text>
      </g>
    </svg>
  </div>
</template>

<style scoped>
/* Dark mode: dim the bright field artwork to match the surrounding dark
   surfaces (mirrors the lineup-preview's dark wash). brightness(0.4) maps
   the outfield green onto the wizard card's dulled #0e3814. Only the
   <image> is dimmed — the position pins stay bright/legible. */
html.dark-mode .event-lineup-preview__field-svg image {
  filter: brightness(0.4);
}
</style>
