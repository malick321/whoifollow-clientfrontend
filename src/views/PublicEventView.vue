<script setup lang="ts">
// PublicEventView
// ---------------
// Public (unauthenticated) event page at /public/event/:eventSlug.
// Header (event identity + Sign in) + a 3-column body:
//   left   — floating divisions list
//   middle — selected division's read-only content (brackets / teams / timeline)
//   right  — event "stacks": register+countdown, event details, sponsors, hotels
// Read-only; data from the mock aggregator (`fetchPublicEventBySlug`).

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import PublicEventHeader from '../components/public/PublicEventHeader.vue'
import PublicDivisionList from '../components/public/PublicDivisionList.vue'
import PublicDivisionPanel from '../components/public/PublicDivisionPanel.vue'
import PublicEventRegisterCard from '../components/public/PublicEventRegisterCard.vue'
import PublicEventDetailsCard from '../components/public/PublicEventDetailsCard.vue'
import MatchGeniSponsorRail from '../components/MatchGeniSponsorRail.vue'
import EventShareModal from '../components/EventShareModal.vue'
import MapExplorerModal from '../components/public/MapExplorerModal.vue'
import PublicEventHero from '../components/public/PublicEventHero.vue'
import PublicAppPromoCard from '../components/public/PublicAppPromoCard.vue'
import PublicVenueGuide from '../components/public/PublicVenueGuide.vue'
import PublicLegalFooter from '../components/public/PublicLegalFooter.vue'
import PublicBoxscoresTab from '../components/public/PublicBoxscoresTab.vue'
import PublicTeamsTab from '../components/public/PublicTeamsTab.vue'
import PublicFieldGridTab from '../components/public/PublicFieldGridTab.vue'
import PublicDiscussionsTab from '../components/public/PublicDiscussionsTab.vue'
import { openLoginModal } from '../login-modal-center'
import { fetchPublicEventBySlug } from '../api/publicEvent'
import type { PublicEventPage } from '../types'

const route = useRoute()
const slug = computed(() => (route.params.eventSlug as string | undefined) ?? '')

// "Detail" mode = the SEO route `/event/:slug` reached from Game Time. Same
// layout as the public showcase, minus the marketing: no app-promo left
// column, no "Sign in" — just the event's own info. The `/public/event/:slug`
// share route keeps the full showcase (promo + sign-in).
const isDetailMode = computed(() => route.name === 'event-detail')

const page = ref<PublicEventPage | null>(null)
const loading = ref(true)
const selectedId = ref('')

const selectedDivision = computed(() =>
  page.value?.divisions.find((d) => d.id === selectedId.value) ?? page.value?.divisions[0] ?? null
)

async function load() {
  loading.value = true
  try {
    const result = await fetchPublicEventBySlug(slug.value)
    page.value = result
    selectedId.value = result.divisions[0]?.id ?? ''
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(slug, load)

// Hero tabs — the page is fully public now: every tab (About / Boxscores /
// Field Grid / Teams / Discussions) is viewable and renders real content.
const activeTab = ref('schedule')
function onHeroSelect(tab: string) {
  activeTab.value = tab
}

// Reveal the header event name once the HERO has scrolled up under the
// header (works the same on desktop + mobile).
const heroRef = ref<{ $el?: HTMLElement } | null>(null)
const condensed = ref(false)
function onScrollCondense() {
  const el = heroRef.value?.$el
  if (!el) { condensed.value = false; return }
  const cs = getComputedStyle(document.documentElement)
  const headerH = parseInt(cs.getPropertyValue('--public-header-h')) || 64
  condensed.value = el.getBoundingClientRect().bottom <= headerH + 1
}
watch(heroRef, () => onScrollCondense())
onMounted(() => {
  window.addEventListener('scroll', onScrollCondense, { passive: true })
  window.addEventListener('resize', onScrollCondense)
  onScrollCondense()
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScrollCondense)
  window.removeEventListener('resize', onScrollCondense)
})
function onHeroGated(_tab: string) {
  openLoginModal()
}

// ── Right column: "sticky to bottom" ──
// When the right stack is TALLER than the viewport, a plain `top: 84`
// sticky would pin its top and hide its bottom cards (Venue Guide etc.).
// Instead we let it scroll up with the page until its LAST card reaches
// the viewport bottom, then stick — by setting `top` to a negative offset
// equal to its overflow. If it fits the viewport it just sticks at 84.
const BOTTOM_GAP = 20
const rightColRef = ref<HTMLElement | null>(null)
const rightColTop = ref('100px')
let rightRo: ResizeObserver | null = null
// Sticky top sits below the public header + the divisions pill rail.
function topOffset(): number {
  if (typeof window === 'undefined') return 100
  const cs = getComputedStyle(document.documentElement)
  const headerH = parseInt(cs.getPropertyValue('--public-header-h')) || 64
  const pillsH = parseInt(cs.getPropertyValue('--public-pills-h')) || 0
  return headerH + pillsH + 16
}
function updateRightColTop() {
  const el = rightColRef.value
  if (!el || typeof window === 'undefined') return
  const offset = topOffset()
  const fits = el.offsetHeight <= window.innerHeight - offset - BOTTOM_GAP
  rightColTop.value = fits
    ? `${offset}px`
    : `${Math.round(window.innerHeight - el.offsetHeight - BOTTOM_GAP)}px`
}
watch(rightColRef, (el) => {
  rightRo?.disconnect()
  if (el && typeof ResizeObserver !== 'undefined') {
    rightRo = new ResizeObserver(updateRightColTop)
    rightRo.observe(el)
  }
  updateRightColTop()
})
onMounted(() => window.addEventListener('resize', updateRightColTop))
onBeforeUnmount(() => {
  window.removeEventListener('resize', updateRightColTop)
  rightRo?.disconnect()
})

// Share popup — same EventShareModal the MatchGeni header + association
// events list use. `guid` is the route slug (the public URL is keyed by
// slug); the builder turns it into `/public/event/<slug>`.
const sharingEvent = ref<{ guid: string; eventName: string; slug: string } | null>(null)
function openShare() {
  sharingEvent.value = {
    guid: slug.value,
    slug: slug.value,
    eventName: page.value?.eventName || 'Event'
  }
}
function closeShare() {
  sharingEvent.value = null
}

// Map Explorer modal (parks + hotels pins).
const mapOpen = ref(false)
</script>

<template>
  <main class="public-event">
    <PublicEventHeader
      :event-name="page?.eventName || 'Event'"
      :date-range-label="page?.dateRangeLabel"
      :association-name="page?.associationName"
      :tournament-type="page?.tournamentType"
      :event-type="page?.eventType"
      :show-identity="condensed"
      :hide-sign-in="isDetailMode"
    />

    <!-- Hero — cover image (or gradient) + event identity + tab bar. Only
         Schedule is viewable; other tabs are sign-in-gated. -->
    <PublicEventHero
      v-if="page"
      ref="heroRef"
      :event-name="page.eventName"
      :date-range-label="page.dateRangeLabel"
      :association-name="page.associationName"
      :tournament-type="page.tournamentType"
      :event-type="page.eventType"
      :cover-image-url="page.coverImageUrl"
      :active-tab="activeTab"
      @select="onHeroSelect"
      @gated="onHeroGated"
      @share="openShare"
    />

    <!-- Loading — skeleton mirroring the live layout (hero + pills rail +
         3 columns) so the page doesn't jump when data lands. -->
    <template v-if="loading">
      <!-- Hero cover + tab bar -->
      <div class="pub-sk-hero" aria-busy="true">
        <span class="shimmer-block pub-sk-hero__cover"></span>
        <div class="pub-sk-hero__tabs">
          <span v-for="n in 5" :key="`skht-${n}`" class="shimmer-block pub-sk__pill"></span>
        </div>
      </div>

      <div class="public-event__body" :class="{ 'public-event__body--detail': isDetailMode }">
        <!-- Left — app-download promo card (hidden in detail mode). -->
        <div v-if="!isDetailMode" class="public-event__col public-event__col--left">
          <div class="pub-sk-card">
            <span class="shimmer-block pub-sk__bar pub-sk__bar--title"></span>
            <span class="shimmer-block pub-sk__bar pub-sk__bar--md"></span>
            <div class="pub-sk__chips">
              <span class="shimmer-block pub-sk__badge"></span>
              <span class="shimmer-block pub-sk__badge"></span>
            </div>
            <span class="shimmer-block pub-sk__stage"></span>
            <span class="shimmer-block pub-sk__bar pub-sk__bar--cta"></span>
          </div>
        </div>

        <!-- Middle — pills rail + brackets / teams / timeline -->
        <div class="public-event__col public-event__col--mid">
          <div class="pub-sk__pills">
            <span v-for="n in 5" :key="`skp-${n}`" class="shimmer-block pub-sk__pill"></span>
          </div>
          <div class="pub-sk-card">
            <span class="shimmer-block pub-sk__bar pub-sk__bar--title"></span>
            <div class="pub-sk__chips">
              <span v-for="n in 2" :key="`skbk-${n}`" class="shimmer-block pub-sk__chip"></span>
            </div>
          </div>
          <div class="pub-sk-card">
            <span class="shimmer-block pub-sk__bar pub-sk__bar--title"></span>
            <div v-for="n in 4" :key="`skt-${n}`" class="pub-sk__team">
              <span class="shimmer-circle pub-sk__avatar"></span>
              <span class="shimmer-block pub-sk__bar pub-sk__bar--lg"></span>
            </div>
          </div>
          <div class="pub-sk-card">
            <span class="shimmer-block pub-sk__bar pub-sk__bar--title"></span>
            <div v-for="n in 3" :key="`skg-${n}`" class="pub-sk__game">
              <span class="shimmer-block pub-sk__bar pub-sk__bar--xs"></span>
              <span class="shimmer-block pub-sk__bar pub-sk__bar--lg"></span>
            </div>
          </div>
        </div>

        <!-- Right — sponsors + register + details + venue -->
        <div class="public-event__col public-event__col--right">
          <div class="pub-sk__sponsors">
            <span v-for="n in 4" :key="`sks-${n}`" class="shimmer-block pub-sk__sponsor"></span>
          </div>
          <span class="shimmer-block pub-sk__register"></span>
          <div class="pub-sk-card">
            <span v-for="n in 6" :key="`skd-${n}`" class="shimmer-block pub-sk__bar pub-sk__bar--md"></span>
          </div>
          <span class="shimmer-block pub-sk__venue"></span>
        </div>
      </div>
    </template>

    <div v-if="page" class="public-event__body" :class="{ 'public-event__body--detail': isDetailMode }">
      <!-- Left — app-download promo (hidden in detail mode: no marketing,
           just the event info). -->
      <div v-if="!isDetailMode" class="public-event__col public-event__col--left">
        <PublicAppPromoCard />
        <!-- Mobile-only: the legal footer follows the marketing card (this
             column is last on mobile). Hidden ≥721px (the right-column copy
             below takes over there). -->
        <PublicLegalFooter class="public-event__foot public-event__foot--mobile" />
      </div>

      <!-- Middle — content switches on the active hero tab. "About" keeps
           the divisions pill rail + selected division panel; the other tabs
           render their own (fully public) content. -->
      <div class="public-event__col public-event__col--mid">
        <template v-if="activeTab === 'schedule'">
          <PublicDivisionList
            :divisions="page.divisions"
            :selected-id="selectedDivision?.id ?? ''"
            @select="selectedId = $event"
          />
          <PublicDivisionPanel v-if="selectedDivision" :division="selectedDivision" />
        </template>
        <PublicBoxscoresTab
          v-else-if="activeTab === 'boxscores'"
          :slug="slug"
          :divisions="page.divisions"
        />
        <PublicFieldGridTab
          v-else-if="activeTab === 'field-grid'"
          :slug="slug"
          :divisions="page.divisions"
        />
        <PublicTeamsTab
          v-else-if="activeTab === 'teams'"
          :slug="slug"
        />
        <PublicDiscussionsTab v-else-if="activeTab === 'discussions'" />
      </div>

      <!-- Right — event stacks (sticky to bottom when taller than viewport) -->
      <div ref="rightColRef" class="public-event__col public-event__col--right" :style="{ top: rightColTop }">
        <MatchGeniSponsorRail
          v-if="page.sponsors && page.sponsors.length"
          :preset-sponsors="page.sponsors"
        />
        <PublicEventRegisterCard :registration="page.registration" />
        <PublicEventDetailsCard :details="page.details" />

        <!-- Venue Guide — reusable card (overlay head + map preview). -->
        <PublicVenueGuide
          :parks="page.parks"
          :hotels="page.hotels"
          :location="page.location"
          :event-name="page.eventName"
          @open="mapOpen = true"
        />

        <!-- Legal footer (desktop/tablet) — last card in the right column.
             Hidden ≤720px; the mobile copy under the app-promo card takes
             over there. -->
        <PublicLegalFooter class="public-event__foot public-event__foot--desktop" />
      </div>
    </div>

    <div v-else-if="!loading" class="public-event__loading">Event not found.</div>

    <!-- Share popup — same component the MatchGeni header / events list use. -->
    <EventShareModal :event="sharingEvent" @close="closeShare" />

    <!-- Map Explorer — parks + hotels pins (full-screen). -->
    <MapExplorerModal
      :open="mapOpen"
      :parks="page?.parks"
      :hotels="page?.hotels"
      :location="page?.location"
      :event-name="page?.eventName"
      :date-range-label="page?.dateRangeLabel"
      @close="mapOpen = false"
    />
  </main>
</template>

<style scoped>
.public-event {
  min-height: 100vh;
  /* Transparent so the page/body gradient shows through. */
  background: transparent;
}
.public-event__loading {
  padding: 64px 24px;
  text-align: center;
  color: var(--secondary);
  font-size: 14px;
}

/* ── Loading skeleton ── */
.pub-sk-card {
  background: var(--surface-card, #fff);
  border: 1px solid var(--border-divider);
  border-radius: 14px;
  padding: 16px 18px;
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.06);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.public-event__col--mid .pub-sk-card { margin-bottom: 16px; }
.public-event__col--mid .pub-sk-card:last-child { margin-bottom: 0; }
.pub-sk__bar {
  display: block;
  height: 12px;
  border-radius: 6px;
}
.pub-sk__bar--head { height: 16px; width: 40%; }
.pub-sk__bar--search { height: 36px; border-radius: 8px; width: 100%; }
.pub-sk__bar--title { height: 16px; width: 35%; }
.pub-sk__bar--xs { width: 30%; }
.pub-sk__bar--sm { width: 50%; }
.pub-sk__bar--md { width: 80%; }
.pub-sk__bar--lg { width: 70%; }
.pub-sk__row { display: flex; flex-direction: column; gap: 6px; }
.pub-sk__chips { display: flex; gap: 10px; }
.pub-sk__chip { flex: 1 1 0; height: 78px; border-radius: 12px; }
.pub-sk__team { display: flex; align-items: center; gap: 10px; }
.pub-sk__avatar { width: 28px; height: 28px; flex: 0 0 auto; }
.pub-sk__game { display: flex; flex-direction: column; gap: 6px; }
.pub-sk__register { display: block; height: 200px; border-radius: 14px; }
/* New-layout skeleton pieces. */
.pub-sk-hero { max-width: 1360px; margin: 0 auto; padding: 0 20px; }
.pub-sk-hero__cover { display: block; height: 240px; border-radius: 0 0 14px 14px; }
.pub-sk-hero__tabs { display: flex; gap: 10px; padding: 14px 0 4px; }
.pub-sk__pill { height: 34px; width: 96px; border-radius: 999px; flex: 0 0 auto; }
.pub-sk__pills { display: flex; gap: 8px; margin-bottom: 16px; overflow: hidden; }
.pub-sk__badge { flex: 1 1 0; height: 40px; border-radius: 8px; max-width: 160px; }
.pub-sk__stage { display: block; height: 150px; border-radius: 12px; }
.pub-sk__bar--cta { height: 38px; width: 100%; border-radius: 8px; }
.pub-sk__sponsors { display: flex; gap: 10px; }
.pub-sk__sponsor { flex: 1 1 0; height: 56px; border-radius: 10px; }
.pub-sk__venue { display: block; height: 300px; border-radius: 14px; }

.public-event__body {
  max-width: 1360px;
  margin: 0 auto;
  padding: 20px;
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr) 372px;
  gap: 20px;
  align-items: start;
}
/* Detail mode (from Game Time) — no left marketing column, so the body is a
   2-column grid (content + event stacks). Collapses to one column on tablet
   like the showcase does. */
.public-event__body--detail {
  grid-template-columns: minmax(0, 1fr) 372px;
}
@media (max-width: 1080px) {
  .public-event__body--detail { grid-template-columns: minmax(0, 1fr); }
}
/* Left + right columns float alongside the scrolling middle — pinned
   BELOW the header + the divisions pill rail. */
.public-event__col--left,
.public-event__col--right {
  position: sticky;
  top: calc(var(--public-header-h, 64px) + var(--public-pills-h, 0px) + 16px);
}
/* Left column fills the viewport height so the app-promo card stretches
   full-height (its feature slider grows to fill). Sidebar layout only. */
@media (min-width: 1025px) {
  .public-event__col--left {
    height: calc(100vh - var(--public-header-h, 64px) - var(--public-pills-h, 0px) - 36px);
  }
}
.public-event__col--right {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Legal footer — shown inside the right column on desktop/tablet; the
   mobile copy (under the app-promo card) is hidden until ≤720px. */
.public-event__foot--mobile { display: none; }

/* Right-column simple panels (sponsors / hotels). */
.public-event__panel {
  background: var(--surface-card, #fff);
  border: 1px solid var(--border-divider);
  border-radius: 14px;
  padding: 16px 18px;
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.06);
}
.public-event__panel-title {
  margin: 0 0 12px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--secondary);
}
/* Tablet — drop the right column under the middle; keep the left app card. */
@media (max-width: 1080px) {
  .public-event__body { grid-template-columns: 260px minmax(0, 1fr); }
  .public-event__col--right {
    grid-column: 1 / -1;
    position: static;
    flex-direction: row;
    flex-wrap: wrap;
  }
  .public-event__col--right > * { flex: 1 1 320px; }
}

/* Tablet band only — the right column is a wrapping flex row, so let the
   Venue Guide card stretch to its row-mate's height (the map fills it) for
   aligned cards. Desktop (stacked) and mobile keep the component's fixed
   height. Bounded below so it never collapses when alone on a line. */
@media (min-width: 721px) and (max-width: 1080px) {
  .public-event__col--right :deep(.pub-venue) {
    height: auto;
    min-height: 300px;
    align-self: stretch;
  }
}

/* ≤1024 — single column; the app-promo card drops below the content (the
   divisions are already a full-width pill rail above). */
@media (max-width: 1024px) {
  .public-event__body { grid-template-columns: minmax(0, 1fr); }
  .public-event__col--left { position: static; order: 3; }
  .public-event__col--mid { order: 1; }
}

/* Mobile — cards go edge-to-edge: full width, no corner rounding, no
   left/right border (our standard mobile card rule). Zero the body's
   horizontal padding so cards reach both screen edges. */
@media (max-width: 720px) {
  .public-event__body { padding: 0 0 14px; gap: 14px; }
  .public-event__body :deep(.pub-panel__section),
  .public-event__body :deep(.pub-details),
  .public-event__body :deep(.pub-register),
  .public-event__body :deep(.matchgeni-sponsor-rail),
  .public-event__body :deep(.pub-venue),
  .public-event__panel {
    border-radius: 0;
    border-left: none;
    border-right: none;
  }
  /* The venue card's map fill loses its corner radius to match the
     flush, edge-to-edge card on mobile. */
  .public-event__body :deep(.pub-venue .pub-venuemap) {
    border-radius: 0;
  }
  /* The sponsor rail has no card padding (bare rail), so its plates would
     sit flush against the screen edge — give it a left/right gutter. */
  .public-event__body :deep(.matchgeni-sponsor-rail) {
    padding-left: 16px;
    padding-right: 16px;
  }
  /* Footer: hide the right-column copy, show the one after the app-promo. */
  .public-event__foot--desktop { display: none; }
  .public-event__foot--mobile { display: block; }
}
</style>
