<script setup lang="ts">
// MatchGeniPlayingFacility
// ------------------------
// Right-column playing-facility card. Renders the venue name + address,
// chips for divisions currently playing here, a weather strip across
// the date range, the field labels in use, the per-day schedule list,
// and a "Select Park" button (wired in a follow-up — swaps facility
// without leaving the dashboard).

import { computed, nextTick, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import type { MatchGeniPlayingFacility } from '../types'
import { canMatchGeniWrite } from '../matchgeni-context'

const props = defineProps<{
  facility: MatchGeniPlayingFacility | null
}>()

defineEmits<{
  (event: 'select-park'): void
}>()

// ── Schedule grouping ───────────────────────────────────────────
// Merge consecutive days that share the same playing window into a
// single date-range card (matches the Add-Facility summary breakdown),
// instead of one card per day.
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function isNextDay(a: string, b: string): boolean {
  const d = new Date(`${a}T00:00:00`)
  d.setDate(d.getDate() + 1)
  return ymd(d) === b
}
function fmtDay(date: string, withYear: boolean): string {
  const d = new Date(`${date}T00:00:00`)
  return d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {})
  })
}
const scheduleGroups = computed(() => {
  const days = props.facility?.schedule ?? []
  type G = { startDate: string; endDate: string; windowLabel: string }
  const groups: G[] = []
  for (const day of days) {
    const last = groups[groups.length - 1]
    if (last && last.windowLabel === day.windowLabel && isNextDay(last.endDate, day.date)) {
      last.endDate = day.date
    } else {
      groups.push({ startDate: day.date, endDate: day.date, windowLabel: day.windowLabel })
    }
  }
  return groups.map((g) => ({
    key: g.startDate,
    label: g.startDate === g.endDate
      ? fmtDay(g.startDate, true)
      : `${fmtDay(g.startDate, g.startDate.slice(0, 4) !== g.endDate.slice(0, 4))} – ${fmtDay(g.endDate, true)}`,
    windowLabel: g.windowLabel
  }))
})

// ── Schedule rail horizontal scroll ─────────────────────────────
// The schedule list is a horizontal-scrolling row of date / time
// cards. Prev / next arrows overlay the left + right edges of the
// rail and toggle visibility based on the rail's scroll position:
//   - scrolled to start  → next visible, prev hidden
//   - scrolled into middle → both visible
//   - scrolled to end    → prev visible, next hidden
// Hover is NOT used as the visibility trigger because the arrows
// need to be discoverable without the user knowing to mouse over.
const scheduleRailRef = ref<HTMLElement | null>(null)
const schedulePrevVisible = ref(false)
const scheduleNextVisible = ref(false)

function syncScheduleArrows() {
  const rail = scheduleRailRef.value
  if (!rail) {
    schedulePrevVisible.value = false
    scheduleNextVisible.value = false
    return
  }
  // 2px slack on each side to ignore sub-pixel scroll rounding.
  schedulePrevVisible.value = rail.scrollLeft > 2
  scheduleNextVisible.value = rail.scrollLeft < rail.scrollWidth - rail.clientWidth - 2
}

function onScheduleScroll(direction: -1 | 1) {
  const rail = scheduleRailRef.value
  if (!rail) return
  const firstCard = rail.querySelector<HTMLElement>('.matchgeni-facility__schedule-row')
  const step = firstCard ? (firstCard.offsetWidth + 8) * 2 : rail.clientWidth * 0.6
  rail.scrollBy({ left: step * direction, behavior: 'smooth' })
}

onMounted(() => {
  // Initial visibility — only the next arrow shows when the rail
  // is at scrollLeft = 0 with content to the right.
  syncScheduleArrows()
  const rail = scheduleRailRef.value
  if (rail) {
    rail.addEventListener('scroll', syncScheduleArrows, { passive: true })
  }
  window.addEventListener('resize', syncScheduleArrows)
})

// Re-evaluate visibility whenever the facility (and so the rail's
// scrollable width) changes — e.g. when the dashboard's carousel
// swaps to a different facility card.
watch(() => props.facility, async () => {
  await nextTick()
  syncScheduleArrows()
}, { flush: 'post' })
</script>

<template>
  <section class="matchgeni-facility">
    <!-- Header row (count + "Select Park" button) removed — the
         dashboard's carousel header now carries the facility count
         and the Select Park action sits next to the carousel's
         scroll arrows so it lives at the rail level instead of
         duplicating once per card. -->

    <div v-if="!facility" class="matchgeni-facility__empty">
      <p>No park selected yet. Click "Select Park" to choose a venue.</p>
    </div>

    <div v-else class="matchgeni-facility__body">
      <div class="matchgeni-facility__name-row">
        <strong class="matchgeni-facility__name">{{ facility.name }}</strong>
        <!-- Per-facility ellipsis menu — gated by `manage_parks`.
             Read-only viewers see the facility card but no edit
             actions on it. -->
        <button
          v-if="canMatchGeniWrite('manage_parks')"
          type="button"
          class="matchgeni-facility__menu-btn"
          aria-label="Facility actions"
        >
          <AppIcon name="ellipsis" :size="16" />
        </button>
      </div>

<div class="matchgeni-facility__address-row">
        <!-- Location glyph from the design library
             (`src/assets/location.svg`). Used anywhere an
             address / city / state is rendered. -->
        <span class="matchgeni-facility__icon matchgeni-facility__icon--location" aria-hidden="true"></span>
        <span>{{ facility.address }}</span>
      </div>

      <div v-if="facility.forecast.length > 0" class="matchgeni-facility__forecast">
        <div
          v-for="day in facility.forecast"
          :key="day.date"
          class="matchgeni-facility__forecast-day"
        >
          <span class="matchgeni-facility__forecast-label">{{ day.label }}</span>
          <span class="matchgeni-facility__forecast-icon" aria-hidden="true">☀</span>
          <span class="matchgeni-facility__forecast-temps">
            <strong>{{ day.high }}°F</strong>
            <span>{{ day.low }}°F</span>
          </span>
        </div>
      </div>

      <!-- Fields in use — icon stays pinned to the top-left so
           when the field list wraps to a second line, the wrapped
           text aligns flush below the label (not under the icon).
           Achieved with a two-column flex row (icon + body) where
           the body holds the label + comma-separated list inline,
           with the list wrapping naturally inside the body
           container. -->
      <div class="matchgeni-facility__fields">
        <!-- Park / fields glyph from the design library
             (`src/assets/park.svg`). Same line-icon family as the
             other facility-row icons. -->
        <span class="matchgeni-facility__icon matchgeni-facility__icon--park" aria-hidden="true"></span>
        <div class="matchgeni-facility__fields-body">
          <span class="matchgeni-facility__fields-label">Fields in use:</span>
          <span class="matchgeni-facility__field-list">{{ facility.fieldsInUse.join(', ') }}</span>
        </div>
      </div>

<div class="matchgeni-facility__schedule">
        <span class="matchgeni-facility__label">
          <!-- Time glyph from the design library
               (`src/assets/time.svg`). Same line-icon family as
               the game / park icons in this card. -->
          <span class="matchgeni-facility__icon matchgeni-facility__icon--time" aria-hidden="true"></span>
          Schedule
        </span>
        <!-- Horizontal-scrolling rail of two-row date / time cards.
             Prev / next arrows are overlay-positioned over the
             rail (centered vertically, hugging the left + right
             edges of the schedule strip) so they don't take a row
             of their own. The rail's native scrollbar is hidden;
             arrows + touchpad swipes are the navigation. -->
        <div class="matchgeni-facility__schedule-rail-wrap">
          <button
            v-show="schedulePrevVisible"
            type="button"
            class="matchgeni-facility__schedule-arrow matchgeni-facility__schedule-arrow--prev"
            aria-label="Previous schedule days"
            @click="onScheduleScroll(-1)"
          >
            <span class="matchgeni-facility__schedule-arrow-icon matchgeni-facility__schedule-arrow-icon--prev" aria-hidden="true"></span>
          </button>
          <ul ref="scheduleRailRef" class="matchgeni-facility__schedule-list">
            <li
              v-for="grp in scheduleGroups"
              :key="grp.key"
              class="matchgeni-facility__schedule-row"
            >
              <strong>{{ grp.label }}</strong>
              <span>{{ grp.windowLabel }}</span>
            </li>
          </ul>
          <button
            v-show="scheduleNextVisible"
            type="button"
            class="matchgeni-facility__schedule-arrow matchgeni-facility__schedule-arrow--next"
            aria-label="Next schedule days"
            @click="onScheduleScroll(1)"
          >
            <span class="matchgeni-facility__schedule-arrow-icon" aria-hidden="true"></span>
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.matchgeni-facility {
  background: var(--white);
  border-radius: 8px;
  border: 1px solid var(--border-divider);
  padding: 16px;
}

/* `.matchgeni-facility__header / __heading / __select-btn` rules
   removed — the header row that owned the "1 Playing Facility"
   count + "Select Park" button was lifted out of the card and now
   lives at the carousel level (`.matchgeni__facility-carousel-head`
   in `MatchGeniDashboardView`). Card now starts directly with
   the name row. */

.matchgeni-facility__empty {
  /* No `margin-top` — the header row that this used to be spaced
     below is gone, so the empty / body containers now sit flush
     against the card's `padding: 16px`, giving even top + bottom
     breathing room around the content. */
  padding: 16px;
  border-radius: 8px;
  background: var(--surface-muted, #f9fafd);
  color: var(--secondary);
  text-align: center;
}
html.dark-mode .matchgeni-facility__empty {
  background: rgba(255, 255, 255, 0.04);
}

.matchgeni-facility__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.matchgeni-facility__name-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.matchgeni-facility__name {
  font-size: 15px;
  color: var(--text);
}

.matchgeni-facility__menu-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: transparent;
  border: none;
  color: var(--secondary);
  cursor: pointer;
}

.matchgeni-facility__menu-btn:hover {
  background: var(--surface-muted, #f4f7fb);
}
html.dark-mode .matchgeni-facility__menu-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}

.matchgeni-facility__label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--secondary);
}

/* Inline glyph for the "Games scheduled" row. Same mask-image
   pattern the AssociationSidebar nav + the matchgeni Game
   Scheduler button use — silhouette from `assets/game.svg`,
   tinted via the parent label's `currentColor`. Future facility
   labels that need a custom line glyph can add their own
   `--<name>` modifier below the base rule. */
.matchgeni-facility__icon {
  display: inline-block;
  width: 14px;
  height: 14px;
  /* Pin all design-library icons to the `--secondary` token in
     BOTH light + dark mode. Was previously `currentColor`, which
     made the icons drift between secondary (`__label` parent) and
     text (`__address-row` parent) — the location glyph specifically
     fell through to `--text` and stopped reading as a peer of the
     other facility-row icons. `--secondary` re-binds in dark mode
     to a lighter cool-blue so the icons stay legible there too. */
  background-color: var(--secondary);
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}
.matchgeni-facility__icon--park {
  -webkit-mask-image: url('../assets/park.svg');
  mask-image: url('../assets/park.svg');
}
.matchgeni-facility__icon--time {
  -webkit-mask-image: url('../assets/time.svg');
  mask-image: url('../assets/time.svg');
}
.matchgeni-facility__icon--location {
  -webkit-mask-image: url('../assets/location.svg');
  mask-image: url('../assets/location.svg');
}

.matchgeni-facility__address-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text);
}

.matchgeni-facility__forecast {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
  padding: 10px 0;
}

.matchgeni-facility__forecast-day {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.matchgeni-facility__forecast-label {
  font-size: 11px;
  color: var(--primary);
  font-weight: 600;
}

.matchgeni-facility__forecast-icon {
  font-size: 18px;
}

.matchgeni-facility__forecast-temps {
  display: inline-flex;
  gap: 4px;
  font-size: 11px;
}

.matchgeni-facility__forecast-temps strong {
  color: var(--text);
}

.matchgeni-facility__forecast-temps span {
  color: var(--secondary);
}

/* Fields-in-use row container — icon column + body column. */
.matchgeni-facility__fields {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}
/* Nudge the icon down ~2px so its center aligns with the first
   line's cap-height instead of riding flush with the top of the
   flex box. `flex-start` top-aligns by default; the body text
   sits a few pixels lower due to its larger line-height. */
.matchgeni-facility__fields > .matchgeni-facility__icon {
  margin-top: 2px;
  flex: 0 0 14px;
}
.matchgeni-facility__fields-body {
  /* Inline children (label + comma-list) so they flow as one
     paragraph; the list wraps naturally inside this column and
     each wrapped line starts flush below the label text instead
     of beneath the icon. */
  display: block;
  min-width: 0;
  font-size: 13px;
  line-height: 1.35;
  color: var(--text);
}
.matchgeni-facility__fields-label {
  font-size: 12px;
  color: var(--secondary);
  margin-right: 4px;
}
.matchgeni-facility__field-list {
  /* Inline so it sits on the same line as the label and wraps
     when the row runs out of width. Lets `word-wrap`-style
     behaviour handle the line break between commas. */
  display: inline;
  color: var(--text);
}

/* Schedule rail — relative-positioned wrap so the overlay
   prev/next arrows can absolute-position over the left + right
   edges of the date/time card list. */
.matchgeni-facility__schedule-rail-wrap {
  position: relative;
  margin-top: 6px;
}

/* Horizontal-only row of date/time cards. No wrap. Native
   scrollbar hidden — the overlay arrows + touchpad swipes are
   the navigation. */
.matchgeni-facility__schedule-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  gap: 8px;
  overflow-x: auto;
  scroll-behavior: smooth;
  scrollbar-width: none;
  /* Snap each card to the left edge so arrow steps land on a
     card boundary instead of mid-card. */
  scroll-snap-type: x mandatory;
}
.matchgeni-facility__schedule-list::-webkit-scrollbar {
  display: none;
}

.matchgeni-facility__schedule-row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 12px 14px;
  background: var(--surface-raised, #f4f8fd);
  border: 1px solid var(--border-divider);
  border-radius: 8px;
  font-size: 13px;
  color: var(--secondary);
  /* Tight to the content — the longest line ("08:30 AM - 04:00 PM")
     fits comfortably at ~138px including the new 12/14 padding,
     so the cards no longer carry leftover whitespace on the right.
     `flex-shrink: 0` prevents squishing when the rail's overflow
     grows; `width: max-content` lets each card hug its actual
     text length while `min-width` enforces a baseline so short
     time strings don't make tiny cards. */
  flex: 0 0 auto;
  width: max-content;
  min-width: 138px;
  scroll-snap-align: start;
}

.matchgeni-facility__schedule-row strong {
  color: var(--text);
  font-size: 14px;
  font-weight: 400;
  line-height: 1.25;
}

.matchgeni-facility__schedule-row span {
  color: var(--secondary);
  font-size: 12px;
  line-height: 1.3;
}

/* Overlay prev/next arrows. Absolute-positioned over the rail's
   left + right edges, centered vertically. Visibility is JS-driven
   via `v-show`. Tone:
     - Light mode: lighter pale-blue pill with a primary-tinted
       chevron — softer than the solid primary surface used before,
       so the buttons sit politely on top of the schedule cards
       instead of dominating the strip.
     - Dark mode: contrasting near-white pill with a slate-navy
       chevron (overrides below) — flips to a high-contrast lift
       so the controls stay just as discoverable against the dark
       surface as the light pill does in light mode. */
.matchgeni-facility__schedule-arrow {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 30px;
  height: 30px;
  border-radius: 999px;
  border: 1px solid var(--border-divider);
  background: var(--primary-light-3, #e5f1ff);
  color: var(--primary);
  font-size: 16px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 6px rgba(13, 30, 58, 0.10);
  transition: background-color 120ms ease, transform 120ms ease;
  padding: 0;
}
.matchgeni-facility__schedule-arrow:hover {
  background: var(--primary-light-2, #c9e1fc);
  transform: translateY(-50%) scale(1.04);
}
.matchgeni-facility__schedule-arrow:active {
  transform: translateY(-50%) scale(0.96);
}
.matchgeni-facility__schedule-arrow--prev {
  left: -6px;
}
.matchgeni-facility__schedule-arrow--next {
  right: -6px;
}
/* Tablet-portrait and smaller (the dashboard goes single-column here) —
   hide the schedule rail's prev/next arrows; touch users swipe instead. */
@media (max-width: 1080px) {
  .matchgeni-facility__schedule-arrow {
    display: none;
  }
}

/* Arrow glyph inside the schedule rail's prev / next buttons.
   Shares `arrow-right.svg` with the dashboard's facility-carousel
   arrows + the officials / umpires quick-link chevrons. Painted
   via CSS mask so the chevron inherits the button's text color
   (white on the primary-blue button surface). Prev arrow flips
   horizontally via `transform: scaleX(-1)`. */
.matchgeni-facility__schedule-arrow-icon {
  display: inline-block;
  width: 12px;
  height: 12px;
  background-color: currentColor;
  -webkit-mask-image: url('../assets/arrow-right.svg');
  mask-image: url('../assets/arrow-right.svg');
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
}
.matchgeni-facility__schedule-arrow-icon--prev {
  transform: scaleX(-1);
}

/* Dark mode — fully opaque primary-tinted slate pill (no alpha
   on the surface). `--primary-light-3` in dark mode resolves to
   the solid `#1f3c5c` deep-navy used elsewhere in the dashboard
   for chip surfaces, so the schedule-arrow stays themed +
   consistent while reading as a solid tap target instead of
   blending through to the rail behind it. */
html.dark-mode .matchgeni-facility__schedule-arrow {
  background: var(--primary-light-3);
  color: #7fb0e8;
  border-color: var(--primary-light-2);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
}
html.dark-mode .matchgeni-facility__schedule-arrow:hover {
  background: var(--primary-light-2);
}
</style>
