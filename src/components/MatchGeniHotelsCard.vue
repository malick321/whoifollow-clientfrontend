<script setup lang="ts">
// MatchGeniHotelsCard
// -------------------
// Right-column card listing the hotels added to the event. Each hotel is
// a row: a tinted thumbnail (hotel glyph), name + address, and a distance
// chip on the right. Rows are split by inset rules (matching the people /
// teams cards). Reads as a compact "where teams can stay" directory.
//
// Hotels come from the §9 event-resources endpoint (`hotels` slice) via
// `fetchEventResources(..., 'hotels')`. That slice is mock-backed in the
// client today; swapping to the real backend needs no change here.

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { fetchEventResources } from '../api/events'
import { canMatchGeniWrite } from '../matchgeni-context'
import type { EventHotel } from '../types'
import hotelIcon from '../assets/hotel.svg?raw'

const props = defineProps<{
  associationId?: string
  eventId?: string
}>()

const emit = defineEmits<{ (event: 'add'): void }>()

const hotels = ref<EventHotel[]>([])

async function load() {
  if (!props.associationId || !props.eventId) {
    hotels.value = []
    return
  }
  try {
    const res = await fetchEventResources(props.associationId, props.eventId, ['hotels'])
    hotels.value = (res.hotels ?? []).filter((h) => h.status !== 0)
  } catch {
    hotels.value = []
  }
  void nextTick(refreshNav)
}
watch(() => [props.associationId, props.eventId], load, { immediate: true })

// ── Paging — each page holds up to 3 hotel rows; the rail slides to the
// next page (matches the Sponsors rail / Playing Facilities pattern). ──
const ROWS_PER_PAGE = 3
const pages = computed<EventHotel[][]>(() => {
  const out: EventHotel[][] = []
  for (let i = 0; i < hotels.value.length; i += ROWS_PER_PAGE) {
    out.push(hotels.value.slice(i, i + ROWS_PER_PAGE))
  }
  return out
})

const trackRef = ref<HTMLElement | null>(null)
const canPrev = ref(false)
const canNext = ref(false)
function refreshNav() {
  const rail = trackRef.value
  if (!rail) return
  canPrev.value = rail.scrollLeft > 2
  canNext.value = rail.scrollLeft < rail.scrollWidth - rail.clientWidth - 2
}
function step(direction: -1 | 1) {
  const rail = trackRef.value
  if (!rail) return
  // Step by one page-slot width (+ gap), matching the facilities
  // carousel, so each click advances exactly one page.
  const page = rail.querySelector<HTMLElement>('.matchgeni-hotels__page')
  const amount = page ? page.offsetWidth + 12 /* gap */ : rail.clientWidth
  rail.scrollBy({ left: amount * direction, behavior: 'smooth' })
}

let resizeObserver: ResizeObserver | null = null
onMounted(() => {
  void nextTick(refreshNav)
  if (typeof ResizeObserver !== 'undefined' && trackRef.value) {
    resizeObserver = new ResizeObserver(refreshNav)
    resizeObserver.observe(trackRef.value)
  }
})
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})
</script>

<template>
  <section v-if="hotels.length" class="matchgeni-hotels">
    <!-- Heading sits ABOVE the card; prev/next page arrows on the right
         (only when there's more than one page). -->
    <header class="matchgeni-hotels__head">
      <h2 class="matchgeni-hotels__title">
        <strong>{{ hotels.length }}</strong>
        <span>{{ hotels.length === 1 ? 'Hotel' : 'Hotels' }}</span>
      </h2>
      <div v-if="canMatchGeniWrite('manage_hotels') || canPrev || canNext" class="matchgeni-hotels__nav">
        <button
          v-if="canMatchGeniWrite('manage_hotels')"
          type="button"
          class="matchgeni-hotels__add"
          @click="emit('add')"
        >Add Hotel</button>
        <template v-if="canPrev || canNext">
          <button
            type="button"
            class="matchgeni-hotels__arrow"
            aria-label="Previous hotels"
            :disabled="!canPrev"
            @click="step(-1)"
          >
            <span class="matchgeni-hotels__arrow-icon matchgeni-hotels__arrow-icon--prev" aria-hidden="true"></span>
          </button>
          <button
            type="button"
            class="matchgeni-hotels__arrow"
            aria-label="Next hotels"
            :disabled="!canNext"
            @click="step(1)"
          >
            <span class="matchgeni-hotels__arrow-icon" aria-hidden="true"></span>
          </button>
        </template>
      </div>
    </header>

    <div class="matchgeni-hotels__card">
      <!-- Paged rail — each page is a column of up to 3 hotel rows. -->
      <ul ref="trackRef" class="matchgeni-hotels__track" @scroll="refreshNav">
        <li v-for="(page, pi) in pages" :key="pi" class="matchgeni-hotels__page">
          <div v-for="hotel in page" :key="hotel.id" class="matchgeni-hotels__row">
            <span class="matchgeni-hotels__thumb" aria-hidden="true" v-html="hotelIcon" />
            <span class="matchgeni-hotels__text">
              <span class="matchgeni-hotels__name">{{ hotel.name }}</span>
              <span class="matchgeni-hotels__meta">
                <span class="matchgeni-hotels__addr">{{ hotel.address }}</span>
                <span v-if="hotel.distanceLabel" class="matchgeni-hotels__distance">
                  <span class="matchgeni-hotels__pin" aria-hidden="true"></span>
                  {{ hotel.distanceLabel }}
                </span>
              </span>
            </span>
          </div>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
/* Container only — heading sits above the card. */
.matchgeni-hotels {
  display: flex;
  flex-direction: column;
}
/* Header — title left, page arrows right. */
.matchgeni-hotels__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.matchgeni-hotels__title {
  margin: 0;
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  font-size: 14px;
  color: var(--secondary);
  font-weight: inherit;
}
.matchgeni-hotels__title strong {
  font-size: 18px;
  color: var(--text);
}
.matchgeni-hotels__nav {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
/* "Add Hotel" — matches the dashboard's "Add Facility" pill. */
.matchgeni-hotels__add {
  appearance: none;
  height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--border-divider);
  background: var(--surface-card);
  color: var(--text);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease;
}
.matchgeni-hotels__add:hover {
  background: var(--surface-raised);
  border-color: var(--border-accent);
}
/* Arrow buttons — same shape as the Sponsors rail / facilities carousel. */
.matchgeni-hotels__arrow {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 999px;
  border: 1px solid var(--border-divider);
  background: var(--surface-card);
  color: var(--secondary);
  cursor: pointer;
  padding: 0;
  transition: background-color 120ms ease, opacity 120ms ease;
}
.matchgeni-hotels__arrow:hover:not(:disabled) {
  background: var(--surface-raised);
}
.matchgeni-hotels__arrow:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.matchgeni-hotels__arrow-icon {
  display: inline-block;
  width: 13px;
  height: 13px;
  background-color: currentColor;
  -webkit-mask: url('../assets/arrow-right.svg') center / contain no-repeat;
  mask: url('../assets/arrow-right.svg') center / contain no-repeat;
}
.matchgeni-hotels__arrow-icon--prev {
  transform: scaleX(-1);
}
/* Tablet-portrait and smaller (the dashboard goes single-column here) —
   hide the paging arrows; touch users swipe the rail instead. */
@media (max-width: 1080px) {
  .matchgeni-hotels__nav {
    display: none;
  }
}
/* Card — background matches the teams-participating + Sponsors cards. */
.matchgeni-hotels__card {
  padding: 4px 16px;
  border-radius: 8px;
  background: var(--white);
  border: 1px solid var(--border-divider);
}
html.dark-mode .matchgeni-hotels__card {
  background: var(--surface-card);
}
/* Paged rail — horizontal scroll between pages; scrollbar hidden,
   navigation via the header arrows (Playing Facilities pattern). */
.matchgeni-hotels__track {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  gap: 12px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scroll-behavior: smooth;
  scrollbar-width: none;
}
.matchgeni-hotels__track::-webkit-scrollbar {
  display: none;
}
/* Each page stacks up to 3 rows. When there are multiple pages, a page
   occupies 80% of the rail (centre-snapped) so the prev/next pages peek
   in on the sides — matching the Playing Facilities carousel. */
.matchgeni-hotels__page {
  flex: 0 0 80%;
  min-width: 0;
  scroll-snap-align: center;
}
/* Edges: first snaps to start (no left peek), last to end (no right
   peek); a lone page fills the full width (no empty peek space). */
.matchgeni-hotels__page:first-child {
  scroll-snap-align: start;
}
.matchgeni-hotels__page:last-child {
  scroll-snap-align: end;
}
.matchgeni-hotels__page:only-child {
  flex-basis: 100%;
}
.matchgeni-hotels__row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
}
/* Inset rule between rows (doesn't reach the card edges). */
.matchgeni-hotels__row + .matchgeni-hotels__row::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--border-divider);
}
.matchgeni-hotels__thumb {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: rgba(45, 140, 240, 0.1);
  color: var(--primary);
}
html.dark-mode .matchgeni-hotels__thumb {
  background: rgba(127, 176, 232, 0.16);
  color: #7fb0e8;
}
.matchgeni-hotels__thumb :deep(svg) {
  width: 22px;
  height: 22px;
  display: block;
}
.matchgeni-hotels__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1 1 auto;
}
.matchgeni-hotels__name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Meta line — address (truncates) + distance pinned at the end, so the
   name above gets the full row width. */
.matchgeni-hotels__meta {
  margin-top: 2px;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.matchgeni-hotels__addr {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12px;
  color: var(--secondary);
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.matchgeni-hotels__distance {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--secondary);
  white-space: nowrap;
}
.matchgeni-hotels__pin {
  width: 12px;
  height: 12px;
  background-color: currentColor;
  -webkit-mask: url('../assets/location.svg') center / contain no-repeat;
  mask: url('../assets/location.svg') center / contain no-repeat;
}
</style>
