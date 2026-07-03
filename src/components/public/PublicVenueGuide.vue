<script setup lang="ts">
// PublicVenueGuide
// ----------------
// Reusable "Venue Guide" card for public pages: a full-bleed map preview
// (parks + hotels pins, theme-aware) with a semi-transparent header strip
// floating over the top of the map showing the event location and the
// park/hotel counts. Tapping the map opens the full Map Explorer (the host
// listens for `open`). Self-contained — drop it anywhere the guide is needed.

import PublicVenueMap from './PublicVenueMap.vue'
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
</script>

<template>
  <section
    class="pub-venue"
    role="button"
    tabindex="0"
    aria-label="Open Map Explorer"
    @click="emit('open')"
    @keydown.enter.prevent="emit('open')"
    @keydown.space.prevent="emit('open')"
  >
    <!-- Semi-transparent header floating over the map. -->
    <div class="pub-venue__head">
      <div class="pub-venue__titles">
        <span class="pub-venue__eyebrow">Event Locations</span>
        <p v-if="location" class="pub-venue__location">
          <span class="pub-venue__location-icon" aria-hidden="true"></span>
          <span>{{ location }}</span>
        </p>
      </div>
      <div class="pub-venue__counts">
        <span class="pub-venue__count">
          {{ (parks?.length ?? 0) }} {{ (parks?.length ?? 0) === 1 ? 'Playing Facility' : 'Playing Facilities' }}
          <span class="pub-venue__count-dot pub-venue__count-dot--park" aria-hidden="true"></span>
        </span>
        <span class="pub-venue__count">
          {{ (hotels?.length ?? 0) }} {{ (hotels?.length ?? 0) === 1 ? 'Partner Hotel' : 'Partner Hotels' }}
          <span class="pub-venue__count-dot pub-venue__count-dot--hotel" aria-hidden="true"></span>
        </span>
      </div>
    </div>

    <PublicVenueMap
      :parks="parks"
      :hotels="hotels"
      :location="location"
      :event-name="eventName"
      @open="emit('open')"
    />
  </section>
</template>

<style scoped>
/* Card surface — the map fills the whole card; the head is a
   semi-transparent strip floating OVER the top of the map. */
.pub-venue {
  position: relative;
  overflow: hidden;
  height: 300px;
  border: 1px solid var(--border-divider);
  border-radius: 14px;
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.06);
  background: var(--surface-card, #fff);
  cursor: pointer;
  transition: box-shadow 150ms ease, border-color 150ms ease;
}
.pub-venue:hover {
  border-color: var(--primary);
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.16);
}
.pub-venue:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
/* The map ALWAYS fills the whole card (top/bottom/left/right) at every
   resolution; the head floats over it. Round corners on the map too so it
   matches the card even when Google's map makes its own stacking context. */
.pub-venue :deep(.pub-venuemap) {
  position: absolute;
  inset: 0;
  width: auto;
  height: auto;
  border: 0;
  border-radius: 14px;
}
@media (max-width: 720px) {
  .pub-venue { height: 260px; }
}
.pub-venue__head {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 2;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin: 0;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  border-bottom: 1px solid var(--border-divider);
}
html.dark-mode .pub-venue__head { background: rgba(15, 23, 34, 0.45); }
.pub-venue__titles { min-width: 0; }
.pub-venue__eyebrow {
  display: block;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--secondary);
}
.pub-venue__location {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 4px 0 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.pub-venue__location-icon {
  flex: 0 0 auto;
  width: 15px;
  height: 15px;
  background-color: var(--secondary);
  -webkit-mask: url('../../assets/location.svg') center / contain no-repeat;
  mask: url('../../assets/location.svg') center / contain no-repeat;
}
/* Park / hotel counts (right of the header). */
.pub-venue__counts {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}
.pub-venue__count {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  color: var(--secondary);
  white-space: nowrap;
}
.pub-venue__count-dot { width: 9px; height: 9px; border-radius: 50%; }
.pub-venue__count-dot--park { background: #2d8cf0; }
.pub-venue__count-dot--hotel { background: #d6409f; }
</style>
