<script setup lang="ts">
// MatchGeniSponsorRail
// --------------------
// Horizontal sponsor-logo rail shown at the bottom of the dashboard's
// LEFT column. Each sponsor renders its logo (max 36px tall, width auto
// so square OR rectangle wordmarks keep their aspect) on a white plate
// that links to the sponsor's site. When no logo image is present, a
// coloured wordmark chip stands in.
//
// Sponsors come from the §9 event-resources endpoint (`sponsors` slice)
// via `fetchEventResources(..., 'sponsors')`. That slice is mock-backed
// in the client today; swapping to the real backend needs no change here.
// Each row carries `imageUrl` (logo CDN URL) — when blank or it fails to
// load, a coloured wordmark chip stands in.

import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { fetchEventResources } from '../api/events'
import type { EventSponsor } from '../types'

const props = defineProps<{
  associationId?: string
  eventId?: string
  /** When provided, render these directly and SKIP the resources fetch —
   *  used by the public event page, which already holds the sponsors. */
  presetSponsors?: EventSponsor[]
}>()

const sponsors = ref<EventSponsor[]>([])

async function load() {
  // Preset path (public page) — use the supplied list verbatim.
  if (props.presetSponsors) {
    sponsors.value = props.presetSponsors.filter((s) => s.status !== 0)
    void nextTick(refreshNav)
    return
  }
  if (!props.associationId || !props.eventId) {
    sponsors.value = []
    return
  }
  try {
    const res = await fetchEventResources(props.associationId, props.eventId, ['sponsors'])
    sponsors.value = (res.sponsors ?? []).filter((s) => s.status !== 0)
  } catch {
    sponsors.value = []
  }
  void nextTick(refreshNav)
}
watch(() => [props.associationId, props.eventId, props.presetSponsors], load, { immediate: true })

// ── Scroll paging — mirrors the Playing Facilities carousel ─────
// A ref'd scroll track + prev/next arrow buttons in the header that step
// the rail and enable/disable as it hits each end.
const trackRef = ref<HTMLElement | null>(null)
const canPrev = ref(false)
const canNext = ref(false)
function refreshNav() {
  const rail = trackRef.value
  if (!rail) return
  // 2px slack for sub-pixel scroll rounding (same as the facilities rail).
  canPrev.value = rail.scrollLeft > 2
  canNext.value = rail.scrollLeft < rail.scrollWidth - rail.clientWidth - 2
}
function step(direction: -1 | 1) {
  const rail = trackRef.value
  if (!rail) return
  // Page by ~a full viewport-width of plates (not one plate) so the user
  // reaches the end in a couple of clicks. A small overlap keeps a column
  // of context between pages.
  const amount = Math.max(120, rail.clientWidth - 24)
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

// Deterministic wordmark tint per sponsor (used only when there's no
// logo image). Hash the name into a small brand-ish palette.
const WORDMARK_PALETTE = ['#0a7d4b', '#e35205', '#c8102e', '#1d8649', '#b40028', '#11161a', '#0b6efd', '#0a3d91']
function wordmarkColor(s: EventSponsor): string {
  let h = 0
  for (let i = 0; i < s.name.length; i += 1) h = (h * 31 + s.name.charCodeAt(i)) >>> 0
  return WORDMARK_PALETTE[h % WORDMARK_PALETTE.length]
}

// Track per-id image load failures → fall back to the wordmark chip.
const failed = ref<Record<string, boolean>>({})
function onImgError(id: string) {
  failed.value = { ...failed.value, [id]: true }
}

// ── Name tooltip (above the hovered plate) ──────────────────────
// A CSS `::after` tooltip gets clipped by the rail's horizontal-scroll
// overflow, so render it as a `position: fixed` element teleported to
// <body> — it escapes the scroll container and always shows on top.
const tip = ref<{ name: string; x: number; y: number } | null>(null)
function showTip(event: Event, name: string) {
  const el = event.currentTarget as HTMLElement | null
  if (!el) return
  const r = el.getBoundingClientRect()
  tip.value = { name, x: r.left + r.width / 2, y: r.top }
}
function hideTip() {
  tip.value = null
}
</script>

<template>
  <section v-if="sponsors.length" class="matchgeni-sponsor-rail">
    <!-- Header — title left, prev/next arrows right (parks-header
         pattern). Arrows only render once the rail overflows. -->
    <header class="matchgeni-sponsor-rail__head">
      <h2 class="matchgeni-sponsor-rail__title">Sponsors</h2>
      <div v-if="canPrev || canNext" class="matchgeni-sponsor-rail__nav">
        <button
          type="button"
          class="matchgeni-sponsor-rail__arrow"
          aria-label="Previous sponsors"
          :disabled="!canPrev"
          @click="step(-1)"
        >
          <span class="matchgeni-sponsor-rail__arrow-icon matchgeni-sponsor-rail__arrow-icon--prev" aria-hidden="true"></span>
        </button>
        <button
          type="button"
          class="matchgeni-sponsor-rail__arrow"
          aria-label="Next sponsors"
          :disabled="!canNext"
          @click="step(1)"
        >
          <span class="matchgeni-sponsor-rail__arrow-icon" aria-hidden="true"></span>
        </button>
      </div>
    </header>
    <!-- Bare rail (no card container) — the plates ARE the pills. -->
    <ul ref="trackRef" class="matchgeni-sponsor-rail__track" @scroll="refreshNav">
      <li v-for="s in sponsors" :key="s.id" class="matchgeni-sponsor-rail__item">
        <a
          class="matchgeni-sponsor-rail__plate"
          :href="s.websiteUrl || undefined"
          :aria-label="s.name"
          target="_blank"
          rel="noopener noreferrer"
          @mouseenter="showTip($event, s.name)"
          @mouseleave="hideTip"
          @focus="showTip($event, s.name)"
          @blur="hideTip"
        >
          <img
            v-if="s.imageUrl && !failed[s.id]"
            class="matchgeni-sponsor-rail__logo"
            :src="s.imageUrl"
            :alt="s.name"
            @error="onImgError(s.id)"
            @load="refreshNav"
          />
          <span
            v-else
            class="matchgeni-sponsor-rail__wordmark"
            :style="{ color: wordmarkColor(s) }"
          >{{ s.name }}</span>
          <!-- External-link affordance — revealed on hover. -->
          <span class="matchgeni-sponsor-rail__ext" aria-hidden="true"></span>
        </a>
      </li>
    </ul>
  </section>

  <!-- Name tooltip — teleported to body + position:fixed so the
       horizontal-scroll overflow can't clip it. Sits above the hovered
       plate. -->
  <Teleport to="body">
    <div
      v-if="tip"
      class="matchgeni-sponsor-rail__tip"
      :style="{ left: tip.x + 'px', top: tip.y + 'px' }"
      role="tooltip"
    >{{ tip.name }}</div>
  </Teleport>
</template>

<style scoped>
.matchgeni-sponsor-rail {
  display: flex;
  flex-direction: column;
}
/* Header — title left, paging arrows right. */
.matchgeni-sponsor-rail__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0 0 6px;
}
/* Eyebrow — identical to the people card's "DIRECTOR" label
   (`.matchgeni-people__eyebrow`): not bold. */
.matchgeni-sponsor-rail__title {
  margin: 0;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--secondary);
}
.matchgeni-sponsor-rail__nav {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
/* Arrow buttons — same shape as the Playing Facilities carousel arrows. */
.matchgeni-sponsor-rail__arrow {
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
.matchgeni-sponsor-rail__arrow:hover:not(:disabled) {
  background: var(--surface-raised);
}
.matchgeni-sponsor-rail__arrow:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.matchgeni-sponsor-rail__arrow-icon {
  display: inline-block;
  width: 13px;
  height: 13px;
  background-color: currentColor;
  -webkit-mask: url('../assets/arrow-right.svg') center / contain no-repeat;
  mask: url('../assets/arrow-right.svg') center / contain no-repeat;
}
.matchgeni-sponsor-rail__arrow-icon--prev {
  transform: scaleX(-1);
}
/* Tablet-portrait and smaller (the dashboard goes single-column here) —
   hide the paging arrows; touch users swipe the rail instead. */
@media (max-width: 1080px) {
  .matchgeni-sponsor-rail__nav {
    display: none;
  }
}
.matchgeni-sponsor-rail__track {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scroll-behavior: smooth;
  /* Hide the native scrollbar — navigation is via the header arrows,
     matching the Playing Facilities carousel. Touchpad swipes still work. */
  scrollbar-width: none;
}
.matchgeni-sponsor-rail__track::-webkit-scrollbar {
  display: none;
}
.matchgeni-sponsor-rail__item {
  flex: 0 0 auto;
  scroll-snap-align: start;
}
/* Pill plate — a PURE-WHITE canvas in BOTH themes. Logos are authored
   for light backgrounds (transparent-dark marks, white-bg JPEGs, colour
   logos all assume it), so a consistent white plate renders every
   uploaded format correctly without masking/recolouring the image. In
   dark mode a subtle border + shadow makes the bright chip read as a
   deliberate "logo tile" rather than a glaring box. */
.matchgeni-sponsor-rail__plate {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 40px;
  /* Compact container — sized to the logo, not the name (the name lives
     in the hover tooltip now). */
  min-width: 52px;
  max-width: 116px;
  padding: 0 10px;
  border-radius: 8px;
  background: #ffffff;
  border: 1px solid var(--border-divider);
  text-decoration: none;
  overflow: hidden;
  cursor: pointer;
}
html.dark-mode .matchgeni-sponsor-rail__plate {
  background: #ffffff;
  border-color: rgba(255, 255, 255, 0.16);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
}
.matchgeni-sponsor-rail__logo {
  /* Square/rectangular brand logos kept within a compact plate. */
  height: 28px;
  width: auto;
  max-width: 96px;
  object-fit: contain;
  display: block;
}
/* Wordmark fallback — truncates instead of stretching the plate. */
.matchgeni-sponsor-rail__wordmark {
  max-width: 96px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.01em;
  line-height: 28px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* External-link glyph — revealed on hover in the plate's top-right. */
.matchgeni-sponsor-rail__ext {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 12px;
  height: 12px;
  background-color: var(--secondary);
  -webkit-mask: url('../assets/external-link.svg') center / contain no-repeat;
  mask: url('../assets/external-link.svg') center / contain no-repeat;
  opacity: 0;
  transition: opacity 120ms ease;
}
.matchgeni-sponsor-rail__plate:hover .matchgeni-sponsor-rail__ext,
.matchgeni-sponsor-rail__plate:focus-visible .matchgeni-sponsor-rail__ext {
  opacity: 0.75;
}

/* Name tooltip — teleported to body, fixed above the hovered plate
   (escapes the rail's scroll-overflow clipping). Mirrors the shared
   app-tooltip look (dark bubble + downward arrow). */
.matchgeni-sponsor-rail__tip {
  position: fixed;
  z-index: 1000;
  transform: translate(-50%, calc(-100% - 8px));
  padding: 5px 9px;
  background: #1a2028;
  color: #ffffff;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.3;
  letter-spacing: 0.01em;
  border-radius: 4px;
  white-space: nowrap;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
  pointer-events: none;
}
.matchgeni-sponsor-rail__tip::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 4px solid transparent;
  border-top-color: #1a2028;
}
</style>
