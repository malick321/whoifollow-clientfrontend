<script setup lang="ts">
// MatchGeniDashboardView
// ----------------------
// /association/:associationShortName/portal/events/:eventId/matchgeni
//
// Composition root for the MatchGeni dashboard. Lays out:
//   - MatchGeniHeader (dashboard variant) sticky at top
//   - 5-tile MatchGeniStatsRow
//   - 2-column grid: LEFT = MatchGeniDivisionList,
//                    RIGHT = MatchGeniTeamsSummary + MatchGeniPlayingFacility
//
// Route param is the event's NUMERIC PK (not the guid) — every
// backend call inside MatchGeni keys on the id, so carrying it in
// the URL means a page refresh on a deep link can fire the
// permission check immediately without a guid→id resolve hop.
// See the route definition in `src/router.ts` for the rationale.
//
// Data sourced from `fetchMatchGeniDashboard(slug, eventId)` —
// returns a single composite payload. While loading we render a
// lightweight skeleton.

import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { fetchMatchGeniDashboard } from '../api/matchGeni'
import { fetchMatchGeniDivisions, isDivisionListMocked } from '../api/matchGeniDivisions'
import { fetchEventResources } from '../api/events'
import MatchGeniDivisionList from '../components/MatchGeniDivisionList.vue'
import MatchGeniDivisionFormModal, { type DivisionSavedEvent } from '../components/MatchGeniDivisionFormModal.vue'
import MatchGeniHeader from '../components/MatchGeniHeader.vue'
import MatchGeniPlayingFacility from '../components/MatchGeniPlayingFacility.vue'
import MatchGeniScoringCard from '../components/MatchGeniScoringCard.vue'
import MatchGeniStatsRow from '../components/MatchGeniStatsRow.vue'
import MatchGeniSponsorRail from '../components/MatchGeniSponsorRail.vue'
import MatchGeniTeamsSummary from '../components/MatchGeniTeamsSummary.vue'
import PublicVenueGuide from '../components/public/PublicVenueGuide.vue'
import PublicLegalFooter from '../components/public/PublicLegalFooter.vue'
import { currentAssociation } from '../constants/associations'
import { canMatchGeniWrite, ensureMatchGeniAccess, matchGeniContext } from '../matchgeni-context'
import { pushToast } from '../toast-center'
import type { MatchGeniDashboard, MatchGeniDivisionSummary, MatchGeniPlayingFacility as PlayingFacility, Park, ParkScheduleEntry, PublicEventPark, EventHotel } from '../types'

const route = useRoute()
const router = useRouter()

const associationShortName = computed(() =>
  (route.params.associationShortName as string | undefined) ?? ''
)
const eventId = computed(() =>
  (route.params.eventId as string | undefined) ?? ''
)

const dashboard = ref<MatchGeniDashboard | null>(null)
const loading = ref(true)
const errorMessage = ref<string | null>(null)

// ── Division list ────────────────────────────────────────────────
// The dashboard's division list is a fast, navigation-only surface
// sourced from the dedicated List Divisions endpoint
// (`fetchMatchGeniDivisions`) — division config + cheap
// compute-on-read team/bracket counts, NO phase statuses / progress
// (those live on the division-detail page, loaded one division at a
// time). See `docs/api/matchgeni-division-api-contract.md` §4.
const divisions = ref<MatchGeniDivisionSummary[]>([])

// ── "Coming soon" toast ──────────────────────────────────────────
// The §4 List Divisions endpoint isn't shipped yet, so the list
// renders placeholder (mock) rows. A black bottom-center pill — same
// style the scheduler uses for conflict messages — flashes once per
// mount to signal the data is a preview, not live. `showComingSoon`
// auto-dismisses after 4s; the flag keeps it to a single appearance.
const comingSoonToast = ref('')
let comingSoonToastTimer: ReturnType<typeof setTimeout> | null = null
let comingSoonShown = false
function showComingSoon(message: string) {
  comingSoonToast.value = message
  if (comingSoonToastTimer) clearTimeout(comingSoonToastTimer)
  comingSoonToastTimer = setTimeout(() => { comingSoonToast.value = '' }, 4000)
}

// ── Playing facilities from the §9 Event Resources API ───────────
// The Playing Facilities carousel is sourced from the LIVE resources
// endpoint (parks-only via `type=parks`) — each park's `fieldsInUse`
// + `schedule` map onto the facility card. Falls back to the mock
// dashboard facilities when resources returns nothing (dev / events
// with no parks added yet).
const resourceFacilities = ref<PlayingFacility[]>([])

/** Map a §9 resource `Park` onto the facility-card shape. Divisions-
 *  playing / games-scheduled / forecast aren't in the parks-only
 *  resource payload (they need games data), so they default empty —
 *  the card renders name + address + fields + per-day schedule. */
function parkToFacility(park: Park): PlayingFacility {
  const address = [park.address, park.city, park.state]
    .filter((p): p is string => !!p && p.trim().length > 0)
    .join(', ')
  return {
    id: park.id,
    name: park.name,
    address,
    divisionsPlaying: [],
    gamesScheduled: 0,
    fieldsInUse: (park.fieldsInUse ?? []).map((f) => f.name),
    forecast: [],
    schedule: (park.schedule ?? []).map((s) => ({
      date: s.date,
      label: s.dateLabelShort,
      windowLabel: s.timeRangeLabel
    }))
  }
}

/** Facilities the carousel renders — the LIVE resources parks. No
 *  mock fallback: when the event has no parks added, the carousel is
 *  replaced by an empty-state placeholder card (see template). */
const displayFacilities = computed<PlayingFacility[]>(() => resourceFacilities.value)

// ── Event Locations map (Venue Guide card + Map Explorer) ────────
// The right column shows the venue map instead of the facility carousel
// / hotels card. Parks + hotels come from the §9 resources, mapped to the
// public map shapes (positions drive the pins).
const resourceParks = ref<Park[]>([])
const resourceHotels = ref<EventHotel[]>([])

function ymdNext(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/** Group consecutive same-window days into { days, window } ranges. */
function groupParkSchedule(entries: ParkScheduleEntry[]): { days: string; window: string }[] {
  type G = { startDate: string; endDate: string; startLabel: string; endLabel: string; startTime: string; endTime: string; window: string }
  const groups: G[] = []
  for (const e of entries) {
    const last = groups[groups.length - 1]
    if (last && last.startTime === e.startTime && last.endTime === e.endTime && ymdNext(last.endDate) === e.date) {
      last.endDate = e.date
      last.endLabel = e.dateLabelShort
    } else {
      groups.push({ startDate: e.date, endDate: e.date, startLabel: e.dateLabelShort, endLabel: e.dateLabelShort, startTime: e.startTime, endTime: e.endTime, window: e.timeRangeLabel })
    }
  }
  return groups.map((g) => ({ days: g.startDate === g.endDate ? g.startLabel : `${g.startLabel} – ${g.endLabel}`, window: g.window }))
}
function parkToPublic(p: Park): PublicEventPark {
  const lat = p.latitude ? Number(p.latitude) : NaN
  const lng = p.longitude ? Number(p.longitude) : NaN
  const position = !Number.isNaN(lat) && !Number.isNaN(lng) ? { lat, lng } : undefined
  return {
    id: p.id,
    name: p.name,
    location: [p.city, p.state].filter((x): x is string => !!x).join(', ') || (p.address ?? ''),
    address: p.address || undefined,
    position,
    fieldsInUse: (p.fieldsInUse ?? []).map((f) => f.name),
    scheduleWindows: groupParkSchedule(p.schedule ?? [])
  }
}
// Venues added in-session from the Map Explorer's add flow — appended
// optimistically so the new pin shows immediately (the §9 resources mock
// store is separate; a real backend reload would fold these in).
const addedParks = ref<PublicEventPark[]>([])
const addedHotels = ref<EventHotel[]>([])
const mapParks = computed<PublicEventPark[]>(() => [
  ...resourceParks.value.map(parkToPublic),
  ...addedParks.value
])
const mapHotels = computed<EventHotel[]>(() => [
  ...resourceHotels.value.filter((h) => h.status !== 0),
  ...addedHotels.value
])
const mapLocation = computed(() => mapParks.value[0]?.location ?? '')
const canAddVenue = computed(() => canMatchGeniWrite('manage_parks') || canMatchGeniWrite('manage_hotels'))

// ── Playing-facility carousel ──────────────────────────────────
// Horizontal rail of facility cards. First card takes ~82% of the
// rail's width so the next card peeks in to telegraph
// scrollability. Arrows step one card-width at a time; `canPrev` /
// `canNext` mirror the rail's scroll position so we can disable
// the arrows at the ends.
const facilityCarouselRef = ref<HTMLElement | null>(null)
const facilityCarouselCanPrev = ref(false)
const facilityCarouselCanNext = ref(true)

function onFacilityCarouselScroll() {
  const rail = facilityCarouselRef.value
  if (!rail) return
  // 2px slack on each side to account for sub-pixel scroll
  // rounding (Chrome sometimes reports scrollLeft = 0.5).
  facilityCarouselCanPrev.value = rail.scrollLeft > 2
  facilityCarouselCanNext.value =
    rail.scrollLeft < rail.scrollWidth - rail.clientWidth - 2
}

function stepFacilityCarousel(direction: -1 | 1) {
  const rail = facilityCarouselRef.value
  if (!rail) return
  // Step by the visible card width — the slot's offsetWidth, which
  // equals the rail width × the slot's flex-basis percent.
  const slot = rail.querySelector<HTMLElement>('.matchgeni__facility-carousel-slot')
  const step = slot ? slot.offsetWidth + 16 /* gap */ : rail.clientWidth * 0.82
  rail.scrollBy({ left: step * direction, behavior: 'smooth' })
}

/** Thin wrapper around the shared `ensureMatchGeniAccess` helper
 *  in `src/matchgeni-context.ts`. The helper handles the
 *  `/my-permissions` fetch, the matchgeni-context cache (skips
 *  the round-trip when nav lands on a sub-page for the same
 *  event), and the 403 / 404 / 409 → toast + redirect plumbing. */
async function loadAccess(): Promise<boolean> {
  return ensureMatchGeniAccess(
    router,
    currentAssociation.value?.id ?? '',
    eventId.value,
    associationShortName.value
  )
}

async function load() {
  loading.value = true
  errorMessage.value = null
  try {
    // Fire BOTH fetches in parallel — the access check gates entry,
    // the dashboard fetch hydrates the body. If access fails we
    // redirect inside `loadAccess`; the dashboard result is then
    // discarded by the unmount triggered by the redirect.
    // Permission check and dashboard hydrate fire in parallel —
    // both endpoints now key on the numeric event id which is
    // already in the URL, so no resolve hop is needed first.
    const associationId = currentAssociation.value?.id ?? ''
    const [, result, resources, divisionRows] = await Promise.all([
      loadAccess(),
      fetchMatchGeniDashboard(associationShortName.value, eventId.value),
      // Parks + hotels resources slice (LIVE) for the Event Locations map,
      // in a single comma-separated call. Swallow errors → empty map.
      fetchEventResources(associationId, eventId.value, ['parks', 'hotels']).catch((err) => {
        if (typeof console !== 'undefined') {
          console.warn('[dashboard] fetchEventResources(parks,hotels) failed.', err)
        }
        return null
      }),
      // Division list — dedicated lightweight endpoint (config +
      // compute-on-read counts). Has its own mock fallback inside the
      // client, so this resolves to rows even pre-backend.
      fetchMatchGeniDivisions(associationId, eventId.value)
    ])
    dashboard.value = result
    resourceParks.value = resources?.parks ?? []
    resourceFacilities.value = resourceParks.value.map(parkToFacility)
    resourceHotels.value = resources?.hotels ?? []
    divisions.value = divisionRows
    // Flag the placeholder list once (until the backend route ships).
    if (isDivisionListMocked() && !comingSoonShown) {
      comingSoonShown = true
      showComingSoon('Division list — coming soon')
    }
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : 'Could not load dashboard.'
    dashboard.value = null
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch([associationShortName, eventId], load)

// After the dashboard payload lands, the facility carousel's
// DOM measurements are available — initialise the arrow-enable
// state so "previous" is disabled at scroll position 0 and "next"
// stays enabled until the rail has nothing more to scroll to.
watch(displayFacilities, async () => {
  await nextTick()
  onFacilityCarouselScroll()
}, { flush: 'post' })

// NOTE: matchGeniContext is intentionally NOT cleared on unmount.
// The whole point of the shared `ensureMatchGeniAccess` cache is
// that navigating between matchgeni sub-pages (Dashboard →
// Scheduler → Officials → …) for the same event skips the
// `/my-permissions` round-trip. Clearing on unmount defeated that:
// the scheduler view would re-fetch and stall the page with empty
// data if the re-fetch failed. Stale-permission bleed is handled
// inside `ensureMatchGeniAccess` itself — it re-fetches whenever
// the active eventId differs from the cached payload's event id.

// Navigation helpers — each guards against a missing permission
// before pushing (defensive: the buttons themselves are already
// `v-if`'d on the matching `canMatchGeniWrite(...)` check, but
// the guard catches keyboard activation, programmatic clicks,
// and developer mistakes where the v-if drifts out of sync with
// the handler).
function navigateToOfficials() {
  if (!canMatchGeniWrite('manage_officials')) return
  router.push({
    name: 'matchgeni-officials',
    params: {
      associationShortName: associationShortName.value,
      eventId: eventId.value
    }
  })
}

function navigateToUmpires() {
  if (!canMatchGeniWrite('manage_umpires')) return
  router.push({
    name: 'matchgeni-umpires',
    params: {
      associationShortName: associationShortName.value,
      eventId: eventId.value
    }
  })
}

/** People card (left column) → the Officials / Umpires rows route to the
 *  same sub-pages the old right-column quick-links pointed at. */
function onPeopleOpen(target: 'officials' | 'umpires') {
  if (target === 'officials') navigateToOfficials()
  else navigateToUmpires()
}

function navigateToEventLocations() {
  router.push({
    name: 'matchgeni-event-locations',
    params: {
      associationShortName: associationShortName.value,
      eventId: eventId.value
    }
  })
}

function navigateToTeams() {
  if (!canMatchGeniWrite('manage_team_participation')) return
  router.push({
    name: 'matchgeni-participating-teams',
    params: {
      associationShortName: associationShortName.value,
      eventId: eventId.value
    }
  })
}

function navigateToFacilities() {
  if (!canMatchGeniWrite('manage_parks')) return
  router.push({
    name: 'matchgeni-facilities',
    params: {
      associationShortName: associationShortName.value,
      eventId: eventId.value
    }
  })
}

function navigateToScoring() {
  if (!canMatchGeniWrite('manage_scoring')) return
  router.push({
    name: 'matchgeni-scoring',
    params: {
      associationShortName: associationShortName.value,
      eventId: eventId.value
    }
  })
}

/** Navigate to the Field Grid sub-page — park-day-at-a-glance
 *  view available to EVERY matchgeni user. No permission gate at
 *  the dashboard level: anyone who landed on `/matchgeni` (i.e.
 *  has any matchgeni access for this event) can enter Field Grid.
 *  The page itself decides what's actionable — games inside the
 *  caller's `scoringScope` get the primary-tinted "permitted"
 *  highlight + clickable actions modal; everything else is
 *  read-only for situational awareness. */
function navigateToFieldGrid() {
  router.push({
    name: 'matchgeni-field-grid',
    params: {
      associationShortName: associationShortName.value,
      eventId: eventId.value
    }
  })
}

// ── Division details ─────────────────────────────────────────────
// Clicking a division row navigates to the dedicated division page
// (sticky division sidebar + detail panel) keyed by the division id.
function onOpenDivision(division: MatchGeniDivisionSummary) {
  router.push({
    name: 'matchgeni-division-detail',
    params: {
      associationShortName: associationShortName.value,
      eventId: eventId.value,
      divisionId: division.id
    }
  })
}

// ── Add Division (same wizard as the division-detail page) ───────
const divisionFormOpen = ref(false)
// Notify teams — event-wide composer. Maps the lightweight division
// summaries to the picker's minimal `NotifyDivision` shape.
const associationIdValue = computed(() => currentAssociation.value?.id ?? '')
const eventName = computed(() => matchGeniContext.value?.event?.eventName ?? '')
const eventStartDate = computed(() => matchGeniContext.value?.event?.startDate ?? '')
const eventEndDate = computed(() => matchGeniContext.value?.event?.endDate ?? '')
const eventTimeZone = computed(() => matchGeniContext.value?.event?.timeZone ?? null)
const eventSportsTypeId = computed(() => matchGeniContext.value?.event?.sportsTypeId ?? null)
const eventDefaults = computed(() => matchGeniContext.value?.event?.defaults ?? null)
function onAddDivision() {
  divisionFormOpen.value = true
}
function onDivisionSaved(payload: DivisionSavedEvent) {
  divisionFormOpen.value = false
  pushToast({ tone: 'success', title: 'Division created', message: `"${payload.name}" created.` })
}

// ── Event scheduling context (passed to the in-map add wizard) ───
const eventStartTime = computed(() => matchGeniContext.value?.event?.eventStartTime ?? null)
const eventEndTime = computed(() => matchGeniContext.value?.event?.eventEndTime ?? null)
const eventAllDay = computed(() => matchGeniContext.value?.event?.allDay ?? false)

</script>

<template>
  <main class="matchgeni">
    <MatchGeniHeader
      variant="dashboard"
      :title="matchGeniContext?.event.eventName ?? 'MatchGeni'"
      :subtitle="matchGeniContext?.event.dateRange ?? ''"
      :loading="loading"
    />

    <!-- Skeleton mirrors the post-load layout 1:1 — same two-column
         shape, same per-component shapes inside each column — so
         the content paints in place without a layout shift on
         resolve. Each skeleton block uses the global `.shimmer-block`
         class for the gradient sweep; sizes / radii match the live
         tiles + cards.
         Layout map:
           LEFT  — People card (director + access rows) + divisions list
                   (header + 15 rows)
           RIGHT — Field Grid card (primary band), Teams summary, Sponsor
                   rail, Event Locations venue-map card, Legal footer -->
    <div v-if="loading" class="matchgeni__content matchgeni__content--loading" aria-busy="true">
      <div class="matchgeni__columns">
        <div class="matchgeni__left">
          <!-- People card — Director block (avatar + lines) on the left,
               two access rows (Officials / Umpires) on the right.
               Mirrors `MatchGeniStatsRow`. -->
          <div class="matchgeni__people-skeleton">
            <div class="matchgeni__people-skeleton-director">
              <div class="shimmer-circle matchgeni__people-skeleton-avatar"></div>
              <div class="matchgeni__people-skeleton-lines">
                <div class="shimmer-block matchgeni__people-skeleton-eyebrow"></div>
                <div class="shimmer-block matchgeni__people-skeleton-name"></div>
                <div class="shimmer-block matchgeni__people-skeleton-sub"></div>
                <div class="shimmer-block matchgeni__people-skeleton-sub"></div>
              </div>
            </div>
            <div class="matchgeni__people-skeleton-access">
              <div
                v-for="i in 2"
                :key="`people-row-${i}`"
                class="matchgeni__people-skeleton-row"
              >
                <div class="shimmer-block matchgeni__people-skeleton-row-heading"></div>
                <div class="shimmer-block matchgeni__people-skeleton-row-copy"></div>
              </div>
            </div>
          </div>
          <!-- Divisions list — header row (title + chevron pill)
               then 15 slim division-row placeholders. Each row
               mirrors the real (navigation-only) division row: a
               stacked text block on the left (date / name / format)
               + two count pills and a chevron on the right. Bumped
               row count to 15 so the skeleton's vertical extent
               matches a typical 12-15 division event without a
               visible jump when data resolves. -->
          <div class="matchgeni__divisions-skeleton">
            <div class="matchgeni__divisions-skeleton-head">
              <div class="shimmer-block matchgeni__divisions-skeleton-title"></div>
              <div class="shimmer-block matchgeni__divisions-skeleton-pill"></div>
            </div>
            <div
              v-for="i in 15"
              :key="`div-row-${i}`"
              class="matchgeni__divisions-skeleton-row"
            >
              <div class="matchgeni__divisions-skeleton-text">
                <div class="shimmer-block matchgeni__divisions-skeleton-date"></div>
                <div class="shimmer-block matchgeni__divisions-skeleton-name"></div>
                <div class="shimmer-block matchgeni__divisions-skeleton-meta"></div>
              </div>
              <div class="matchgeni__divisions-skeleton-counts">
                <div class="shimmer-block matchgeni__divisions-skeleton-count-pill"></div>
                <div class="shimmer-block matchgeni__divisions-skeleton-count-pill"></div>
              </div>
              <div class="shimmer-block matchgeni__divisions-skeleton-chev"></div>
            </div>
          </div>
        </div>
        <div class="matchgeni__right">
          <!-- Field Grid card — primary-tinted single-row band.
               Title line + badge chip inline, supporting copy
               beneath, chevron pinned right. Mirrors
               `MatchGeniScoringCard` (top of the right column). -->
          <div class="matchgeni__field-grid-skeleton">
            <div class="matchgeni__field-grid-skeleton-body">
              <div class="matchgeni__field-grid-skeleton-title-row">
                <div class="shimmer-block matchgeni__field-grid-skeleton-title"></div>
                <div class="shimmer-block matchgeni__field-grid-skeleton-badge"></div>
              </div>
              <div class="shimmer-block matchgeni__field-grid-skeleton-copy"></div>
            </div>
            <div class="shimmer-circle matchgeni__field-grid-skeleton-chev"></div>
          </div>
          <!-- Teams summary card — large count number + label +
               "Manage Teams" CTA on the right. Mirrors
               `MatchGeniTeamsSummary`. -->
          <div class="matchgeni__teams-skeleton">
            <div class="matchgeni__teams-skeleton-text">
              <div class="shimmer-block matchgeni__teams-skeleton-count"></div>
              <div class="shimmer-block matchgeni__teams-skeleton-label"></div>
            </div>
            <div class="shimmer-block matchgeni__teams-skeleton-cta"></div>
          </div>
          <!-- Sponsor rail — bare row of logo pills (no heading);
               sits below the teams card. Mirrors `MatchGeniSponsorRail`. -->
          <div class="matchgeni__sponsor-skeleton">
            <div class="matchgeni__sponsor-skeleton-track">
              <div
                v-for="i in 6"
                :key="`sponsor-${i}`"
                class="shimmer-block matchgeni__sponsor-skeleton-pill"
              ></div>
            </div>
          </div>
          <!-- Event Locations — tall venue-map card with a blurred head
               overlay (eyebrow + title left, two count lines right) over a
               full-bleed map fill. Mirrors `PublicVenueGuide`. -->
          <div class="shimmer-block matchgeni__venue-skeleton">
            <div class="matchgeni__venue-skeleton-head">
              <div class="matchgeni__venue-skeleton-titles">
                <div class="shimmer-block matchgeni__venue-skeleton-eyebrow"></div>
                <div class="shimmer-block matchgeni__venue-skeleton-title"></div>
              </div>
              <div class="matchgeni__venue-skeleton-counts">
                <div class="shimmer-block matchgeni__venue-skeleton-count"></div>
                <div class="shimmer-block matchgeni__venue-skeleton-count"></div>
              </div>
            </div>
          </div>
          <!-- Legal footer — a row of small policy-link blocks + a
               copyright line. Mirrors `PublicLegalFooter`. -->
          <div class="matchgeni__foot-skeleton">
            <div class="matchgeni__foot-skeleton-links">
              <div
                v-for="i in 5"
                :key="`foot-link-${i}`"
                class="shimmer-block matchgeni__foot-skeleton-link"
              ></div>
            </div>
            <div class="shimmer-block matchgeni__foot-skeleton-copy"></div>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="errorMessage" class="matchgeni__error">
      <p>{{ errorMessage }}</p>
      <button type="button" class="matchgeni__retry" @click="load">Retry</button>
    </div>

    <div v-else-if="dashboard" class="matchgeni__content">
      <!-- Field Grid card (mobile-only slot) — sits above the two
           columns on mobile so the at-a-glance day view is the
           first affordance after the header. Hidden via CSS at
           desktop / tablet widths; the in-column copy below takes
           over there.
           ALWAYS VISIBLE — every matchgeni user can browse the
           field grid for situational awareness; the scoring-scope
           highlight + clickable actions modal inside the page
           gate the actual write actions, not the entry. -->
      <MatchGeniScoringCard
        class="matchgeni__scoring-mobile"
        @open-scorebook="navigateToFieldGrid"
      />
      <div class="matchgeni__columns">
        <div class="matchgeni__left">
          <!-- Stats row lives ABOVE the divisions card inside the
               left column — three game-state tiles (Active Games,
               Delayed Games, Overall Progress) reading as the
               header of the divisions section. -->
          <MatchGeniStatsRow :stats="dashboard.stats" @open="onPeopleOpen" />
          <MatchGeniDivisionList
            :divisions="divisions"
            @open-division="onOpenDivision"
            @add-division="onAddDivision"
          />
        </div>
        <div class="matchgeni__right">
          <!-- Field Grid card (desktop / tablet slot). Hidden on
               mobile (≤720px) via CSS; the mobile-only copy at
               the top of `.matchgeni__content` takes over there.
               ALWAYS VISIBLE — same rationale as the mobile copy
               above. -->
          <MatchGeniScoringCard
            class="matchgeni__scoring-desktop"
            @open-scorebook="navigateToFieldGrid"
          />
          <MatchGeniTeamsSummary
            :summary="dashboard.teamsSummary"
            @manage-teams="navigateToTeams"
          />
          <!-- Sponsor logo rail — sits below the teams card (bare rail of
               logo pills; name on hover; opens the sponsor site). -->
          <MatchGeniSponsorRail :association-id="associationIdValue" :event-id="eventId" />
          <!-- Event Locations — venue map (parks + hotels), replacing the
               facility carousel + hotels card. Tapping opens the dedicated
               Locations page (the map is no longer a popup). -->
          <PublicVenueGuide
            :parks="mapParks"
            :hotels="mapHotels"
            :location="mapLocation"
            :event-name="eventName"
            @open="navigateToEventLocations"
          />
          <PublicLegalFooter />
        </div>
      </div>
    </div>

    <!-- Add Division wizard — same 3-step popup as the division-detail
         page (Division Info → Seed Criteria → Field Config). -->
    <MatchGeniDivisionFormModal
      v-model="divisionFormOpen"
      :association-id="associationIdValue"
      :event-id="eventId"
      :event-name="eventName"
      :event-start-date="eventStartDate"
      :event-end-date="eventEndDate"
      :event-time-zone="eventTimeZone"
      :sports-type-id="eventSportsTypeId"
      :defaults="eventDefaults"
      @saved="onDivisionSaved"
    />

    <!-- "Coming soon" toast — black bottom-center pill (same style the
         scheduler uses for conflict messages). Flashes once while the
         §4 List Divisions endpoint is unshipped to signal the list is
         placeholder data. -->
    <div
      v-if="comingSoonToast"
      class="matchgeni__toast"
      role="status"
      aria-live="polite"
    >{{ comingSoonToast }}</div>
  </main>
</template>

<style scoped>
.matchgeni {
  min-height: 100vh;
  /* No background — inherits whatever the surrounding workspace
     surface is (the body bg in normal cases). Setting one here
     would just duplicate the body fill. */
  display: flex;
  flex-direction: column;
}

.matchgeni__content {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 20px 24px;
}

/* The Game Scoring card has two render slots — one at the top
   of `.matchgeni__content` (above both columns) for mobile, and
   one inside the right column for desktop / tablet. Show
   exactly one at any viewport width via these visibility
   toggles. Base rule: hide the mobile slot, show the desktop
   slot. The ≤720px media query below inverts both. */
.matchgeni__scoring-mobile {
  display: none;
}

.matchgeni__columns {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(320px, 1fr);
  gap: 18px;
  align-items: start;
}

.matchgeni__left,
.matchgeni__right {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: 0;
}
/* Taller Event Locations map in the dashboard's right column (the public
   page keeps the component's default height). */
.matchgeni__right :deep(.pub-venue) { height: 440px; }

/* Right-column sticky behaviour — same pattern ParticipationV2's
   `.participation-v2__side-panel` uses. The left column (divisions
   list) keeps scrolling with the page; the right column (Teams
   Summary + Officials quick-link + Playing Facility) pins below
   the matchgeni-header and stays put once the user scrolls past
   its natural position.
   `top: 96px` clears the sticky matchgeni-header above (which
   carries z-index 50 and overlays the global topbar when the
   page is scrolled). `align-self: start` keeps the right
   column from stretching to match the left column's height —
   without it, the grid's `align-items: start` would still
   stretch a sticky child to the row height and sticky would
   never activate. */
.matchgeni__right {
  position: sticky;
  /* `--matchgeni-header-height` is published at runtime by
     MatchGeniHeader.vue (ResizeObserver on its <header> element)
     so this sticky always pins flush against the header's
     bottom edge — no gap even when the title wraps or padding
     changes. The `-1px` overlap-guarantee tucks the column's
     top edge under the header's bottom by 1px so sub-pixel
     rounding can't leave a hairline gap between them. */
  top: calc(var(--matchgeni-header-height, 56px) - 1px);
  align-self: start;
}

/* Event Officials quick-link — full-card button. Counter line on
   top ("N event officials") + supporting copy below, chevron pinned
   to the right edge. Header counter style mirrors
   MatchGeniTeamsSummary for visual symmetry. */
.matchgeni__quick-link {
  appearance: none;
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  /* Bumped from `14px 18px` so the cards read at a similar
     visual weight to the playing-facility carousel cards below
     them. Same horizontal padding; ~50% more vertical
     breathing room gives the heading + supporting copy more
     space to read as a stacked block. */
  padding: 22px 18px;
  background: var(--white);
  border: 1px solid var(--border-divider);
  border-radius: 8px;
  text-align: left;
  cursor: pointer;
  transition: background-color 120ms ease;
}

/* Hover tone — same 4% primary-alpha (8% dark mode) used by
   `.association-users__row:hover` / `.association-events-row:hover`
   / `.matchgeni-divisions__row:hover` so every interactive card
   surface across the portal shares one finalised hover language. */
.matchgeni__quick-link:hover {
  background: rgba(45, 140, 240, 0.04);
}
html.dark-mode .matchgeni__quick-link:hover {
  background: rgba(45, 140, 240, 0.08);
}

/* Read-only state — applied when the caller lacks the matching
   matchgeni permission. The card stays visible (the count is
   part of the dashboard's read-only event overview) but the
   click is `disabled` and the visual affordances that normally
   say "I'm interactive" are stripped:
     - default cursor (not pointer)
     - no hover tint
     - chevron hidden — there's nowhere to navigate to. */
.matchgeni__quick-link--readonly,
.matchgeni__quick-link--readonly:hover {
  cursor: default;
  background: var(--white);
}
html.dark-mode .matchgeni__quick-link--readonly,
html.dark-mode .matchgeni__quick-link--readonly:hover {
  background: var(--surface-card);
}
.matchgeni__quick-link--readonly .matchgeni__quick-link-chev {
  display: none;
}

.matchgeni__quick-link-text {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.matchgeni__quick-link-heading {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  font-size: 14px;
  color: var(--secondary);
}

.matchgeni__quick-link-heading strong {
  font-size: 18px;
  color: var(--text);
}

.matchgeni__quick-link-copy {
  font-size: 13px;
  color: var(--secondary);
}

/* Quick-link card chevron — was a `›` text glyph; now the shared
   `arrow-right.svg` painted via CSS mask so the icon inherits the
   parent's `color` and themes cleanly across light + dark. */
.matchgeni__quick-link-chev {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  align-self: center;
  background-color: var(--secondary);
  -webkit-mask-image: url('../assets/arrow-right.svg');
  mask-image: url('../assets/arrow-right.svg');
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
}

/* ─── Playing-facility carousel ───────────────────────────────────
   Horizontal rail of facility cards in the right column. Used to
   be a single MatchGeniPlayingFacility card; now a snap-scrolling
   carousel that holds all of the event's facilities. The first
   card takes ~82% of the rail's width so the next one peeks in
   on the right — visual signal that more content is to the side. */
.matchgeni__facility-carousel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  /* Negative right margin lets the carousel rail bleed into the
     column's gutter, so the peek of the next card lands flush
     against the right edge of the visible area instead of being
     clipped by the column's own padding. The header keeps its
     positive right padding via its own margin. */
}
.matchgeni__facility-carousel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 0 2px;
}
/* Matches the heading style used by `.matchgeni-teams__heading`
   (the "76 teams participating" line) and
   `.matchgeni__quick-link-heading` (the "N event officials" /
   "N event umpires" cards) so every count + label pair in the
   dashboard's right column reads as a consistent family:
     - 14px secondary-tinted label
     - 18px text-tinted bold count
   The element stays an `<h2>` for document outline but the
   font-weight is normalised to inherit so the browser's default
   bold on `<h2>` doesn't drift the parent label heavier than the
   sibling cards. */
.matchgeni__facility-carousel-title {
  margin: 0;
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  font-size: 14px;
  color: var(--secondary);
  font-weight: inherit;
}
.matchgeni__facility-carousel-title strong {
  font-size: 18px;
  color: var(--text);
}
.matchgeni__facility-carousel-nav {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.matchgeni__facility-carousel-arrow {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 999px;
  border: 1px solid var(--border-divider);
  background: var(--surface-card);
  color: var(--secondary);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  transition: background-color 120ms ease, opacity 120ms ease;
  padding: 0;
}
/* Tablet-portrait and smaller (the dashboard goes single-column here) —
   hide the carousel paging arrows; touch users swipe the rail instead.
   The "Add Facility" action in the same nav row stays. */
@media (max-width: 1080px) {
  .matchgeni__facility-carousel-arrow {
    display: none;
  }
}

/* Arrow glyph — shared `arrow-right.svg` rendered via CSS mask so
   the chevron inherits the button's `color` (themes light + dark).
   Prev arrow flips horizontally via `transform: scaleX(-1)`. */
.matchgeni__facility-carousel-arrow-icon {
  display: inline-block;
  width: 14px;
  height: 14px;
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
.matchgeni__facility-carousel-arrow-icon--prev {
  transform: scaleX(-1);
}
.matchgeni__facility-carousel-arrow:hover:not(:disabled) {
  background: var(--surface-raised);
}
.matchgeni__facility-carousel-arrow:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* "Select Park" pill — same ghost-button language used elsewhere
   in the portal (transparent surface with a neutral border). Sits
   at the rail level next to the scroll arrows so a single action
   applies to the whole carousel instead of duplicating per card. */
.matchgeni__facility-carousel-select {
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
.matchgeni__facility-carousel-select:hover {
  background: var(--surface-raised);
  border-color: var(--border-accent);
}

.matchgeni__facility-carousel-rail {
  display: flex;
  /* `align-items: stretch` (the flex default) makes every slot
     match the height of the tallest card in the rail. Combined
     with the slot's `display: flex` below, the card inside each
     slot fills that height so every card visually reads as the
     same size regardless of varying content (longer divisions
     chip row, more fields, etc.). */
  align-items: stretch;
  gap: 16px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scroll-behavior: smooth;
  /* Hide the native horizontal scrollbar — the user navigates via
     the arrow buttons in the header. Touchpad swipes still work. */
  scrollbar-width: none;
}
.matchgeni__facility-carousel-rail::-webkit-scrollbar {
  display: none;
}

.matchgeni__facility-carousel-slot {
  /* Each card occupies 80% of the rail's width — leaves ~10% on
     each side for the previous + next card to peek in (the
     `scroll-snap-align: center` rule below puts the active card
     in the middle of the scrollport). All slots share this exact
     width so the cards read as a uniform set. */
  flex: 0 0 80%;
  scroll-snap-align: center;
  min-width: 0;
  /* Make the card inside fill the slot's full height so cards
     with shorter content (fewer divisions / fields) still match
     the height of the tallest card in the rail. */
  display: flex;
  flex-direction: column;
}
.matchgeni__facility-carousel-slot > * {
  flex: 1 1 auto;
  min-height: 0;
}

/* Edge alignment — the first card snaps to the rail's start (no
   left peek when scrolled all the way left) and the last card
   snaps to the rail's end (no right peek when scrolled all the
   way right). Middle cards stay center-snapped for the
   "previous + active + next" peek behaviour above. */
.matchgeni__facility-carousel-slot:first-child {
  scroll-snap-align: start;
}
.matchgeni__facility-carousel-slot:last-child {
  scroll-snap-align: end;
}
/* Single facility — no peek/scroll needed, so the lone card
   stretches to the full rail width instead of leaving ~20% empty
   on the right. */
.matchgeni__facility-carousel-slot:only-child {
  flex-basis: 100%;
}

/* Empty-state placeholder — shown when the event has no parks. */
.matchgeni__facility-empty-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 8px;
  padding: 28px 20px;
  background: var(--white);
  border: 1px dashed var(--border-divider);
  border-radius: 8px;
}
html.dark-mode .matchgeni__facility-empty-card {
  background: rgba(255, 255, 255, 0.03);
}
.matchgeni__facility-empty-icon {
  display: inline-block;
  width: 40px;
  height: 40px;
  margin-bottom: 2px;
  background-color: var(--secondary);
  -webkit-mask: url('../assets/park.svg') center / contain no-repeat;
  mask: url('../assets/park.svg') center / contain no-repeat;
}
.matchgeni__facility-empty-title {
  margin: 0;
  font-size: 15px;
  font-weight: 500;
  color: var(--text);
}
.matchgeni__facility-empty-body {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--secondary);
  max-width: 320px;
}
.matchgeni__facility-empty-cta {
  margin-top: 8px;
  appearance: none;
  border: none;
  border-radius: 8px;
  background: var(--primary, #2563eb);
  color: #fff;
  font-weight: 600;
  font-size: 13px;
  padding: 9px 18px;
  cursor: pointer;
  transition: filter 120ms ease;
}
.matchgeni__facility-empty-cta:hover {
  filter: brightness(1.06);
}

/* Skeleton — mirrors the loaded layout so content paints in place.
   Each block uses the global `.shimmer-block` class for the sweep
   animation; sizes / radii match the live tiles + cards. */
.matchgeni__content--loading {
  pointer-events: none;
}

/* People card skeleton — mirrors `MatchGeniStatsRow`'s `.matchgeni-people`:
   Director block (avatar + lines) on the left, two access rows on the
   right, on one translucent card. */
.matchgeni__people-skeleton {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
  border-radius: 8px;
  background: var(--surface-raised);
  border: 1px solid var(--border-divider);
}
.matchgeni__people-skeleton-director {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 18px;
}
.matchgeni__people-skeleton-avatar {
  flex: 0 0 auto;
  width: 56px;
  height: 56px;
  border-radius: 50%;
}
.matchgeni__people-skeleton-lines {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.matchgeni__people-skeleton-eyebrow {
  height: 9px;
  width: 40%;
  border-radius: 4px;
}
.matchgeni__people-skeleton-name {
  height: 15px;
  width: 70%;
  border-radius: 5px;
}
.matchgeni__people-skeleton-sub {
  height: 11px;
  width: 85%;
  border-radius: 4px;
}
.matchgeni__people-skeleton-access {
  display: flex;
  flex-direction: column;
}
.matchgeni__people-skeleton-row {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  padding: 12px 16px;
}
.matchgeni__people-skeleton-row + .matchgeni__people-skeleton-row {
  border-top: 1px solid var(--border-divider);
}
.matchgeni__people-skeleton-row-heading {
  height: 14px;
  width: 45%;
  border-radius: 5px;
}
.matchgeni__people-skeleton-row-copy {
  height: 11px;
  width: 80%;
  border-radius: 4px;
}

/* ─── Divisions list skeleton ─────────────────────────────────
   Mirrors the live `MatchGeniDivisionList`: header row at the
   top + N division-row placeholders. Each row has a bullet
   circle, a stacked text block (name + meta), and a chevron
   square on the right. Sizes / spacing match the loaded card so
   the page doesn't shift on resolve. */
.matchgeni__divisions-skeleton {
  background: var(--white);
  border: 1px solid var(--border-divider);
  border-radius: 8px;
  padding: 0;
  display: flex;
  flex-direction: column;
}
html.dark-mode .matchgeni__divisions-skeleton {
  background: var(--surface-card);
}
.matchgeni__divisions-skeleton-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-divider);
}
.matchgeni__divisions-skeleton-title {
  height: 18px;
  width: 35%;
  border-radius: 5px;
}
.matchgeni__divisions-skeleton-pill {
  height: 22px;
  width: 70px;
  border-radius: 999px;
}
.matchgeni__divisions-skeleton-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 16px;
  gap: 16px;
  align-items: center;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-divider);
}
.matchgeni__divisions-skeleton-row:last-child {
  border-bottom: none;
}
.matchgeni__divisions-skeleton-text {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.matchgeni__divisions-skeleton-date {
  height: 11px;
  width: 45%;
  border-radius: 5px;
}
.matchgeni__divisions-skeleton-name {
  height: 14px;
  width: 60%;
  border-radius: 5px;
}
.matchgeni__divisions-skeleton-meta {
  height: 11px;
  width: 40%;
  border-radius: 5px;
}
.matchgeni__divisions-skeleton-counts {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.matchgeni__divisions-skeleton-count-pill {
  height: 24px;
  width: 64px;
  border-radius: 999px;
}
.matchgeni__divisions-skeleton-chev {
  height: 16px;
  width: 16px;
  border-radius: 4px;
}

/* ─── Right column: Field Grid card skeleton ──────────────────
   Mirrors `MatchGeniScoringCard` — primary-tinted single-row
   band with a 3px left accent border, title + badge inline,
   one-line copy beneath, chevron pinned right. */
.matchgeni__field-grid-skeleton {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  background: var(--primary-light-3, #e5f1ff);
  border: 1px solid var(--primary-light-2, #c9e1fc);
  border-left: 3px solid var(--primary);
  border-radius: 10px;
}
html.dark-mode .matchgeni__field-grid-skeleton {
  background: rgba(45, 140, 240, 0.12);
}
.matchgeni__field-grid-skeleton-body {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.matchgeni__field-grid-skeleton-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.matchgeni__field-grid-skeleton-title {
  height: 20px;
  width: 100px;
  border-radius: 5px;
}
.matchgeni__field-grid-skeleton-badge {
  height: 22px;
  width: 140px;
  border-radius: 5px;
}
.matchgeni__field-grid-skeleton-copy {
  height: 14px;
  width: 85%;
  border-radius: 5px;
}
.matchgeni__field-grid-skeleton-chev {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  flex: 0 0 28px;
}

/* ─── Teams summary card skeleton ─────────────────────────────
   Mirrors `MatchGeniTeamsSummary` — big count + label on the
   left, "Manage Teams" CTA on the right. */
.matchgeni__teams-skeleton {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  background: var(--white);
  border: 1px solid var(--border-divider);
  border-radius: 8px;
}
html.dark-mode .matchgeni__teams-skeleton {
  background: var(--surface-card);
}
.matchgeni__teams-skeleton-text {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.matchgeni__teams-skeleton-count {
  height: 22px;
  width: 36px;
  border-radius: 5px;
}
.matchgeni__teams-skeleton-label {
  height: 16px;
  width: 140px;
  border-radius: 5px;
}
.matchgeni__teams-skeleton-cta {
  height: 36px;
  width: 130px;
  border-radius: 6px;
  flex: 0 0 auto;
}

/* ─── Quick-link skeleton (Officials / Umpires) ───────────────
   Two-line copy + chevron square on the right. Heading is a
   single line (count + label inline in the real version). */
/* Sponsor rail skeleton — heading above a row of logo-pill placeholders.
   Mirrors `MatchGeniSponsorRail` (bare rail, no card). */
.matchgeni__sponsor-skeleton {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.matchgeni__sponsor-skeleton-track {
  display: flex;
  gap: 8px;
  overflow: hidden;
}
.matchgeni__sponsor-skeleton-pill {
  flex: 0 0 auto;
  width: 72px;
  height: 40px;
  border-radius: 8px;
}

/* ─── Event Locations venue-map skeleton ──────────────────────
   Tall card (440px on dashboard) with a blurred head overlay
   pinned to the top: eyebrow + title on the left, two count
   lines on the right. The body is a flat map-fill placeholder.
   Mirrors `PublicVenueGuide`. */
.matchgeni__venue-skeleton {
  position: relative;
  height: 440px;
  border-radius: 14px;
  border: 1px solid var(--border-divider);
  overflow: hidden;
  /* Reuse the shimmer gradient as the full-bleed map fill. */
}
.matchgeni__venue-skeleton-head {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 2;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  border-bottom: 1px solid var(--border-divider);
}
html.dark-mode .matchgeni__venue-skeleton-head {
  background: rgba(15, 23, 34, 0.55);
}
.matchgeni__venue-skeleton-titles {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.matchgeni__venue-skeleton-eyebrow {
  height: 10px;
  width: 110px;
  border-radius: 4px;
}
.matchgeni__venue-skeleton-title {
  height: 16px;
  width: 150px;
  border-radius: 5px;
}
.matchgeni__venue-skeleton-counts {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  flex: 0 0 auto;
}
.matchgeni__venue-skeleton-count {
  height: 12px;
  width: 96px;
  border-radius: 4px;
}

/* ─── Legal footer skeleton ───────────────────────────────────
   A wrapped row of small policy-link blocks + a copyright line.
   Mirrors `PublicLegalFooter`. */
.matchgeni__foot-skeleton {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 2px 8px;
}
.matchgeni__foot-skeleton-links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.matchgeni__foot-skeleton-link {
  height: 10px;
  width: 72px;
  border-radius: 4px;
}
.matchgeni__foot-skeleton-link:nth-child(3) { width: 96px; }
.matchgeni__foot-skeleton-link:nth-child(4) { width: 60px; }
.matchgeni__foot-skeleton-copy {
  height: 10px;
  width: 150px;
  border-radius: 4px;
}

/* Toast — bottom-center fixed pill (stubbed division actions). Same
   shape the scheduler + field-grid surfaces use. */
.matchgeni__toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 250;
  background: var(--text, #1a2028);
  color: #ffffff;
  padding: 10px 18px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 500;
  box-shadow: 0 8px 24px rgba(13, 30, 58, 0.32);
  max-width: 90vw;
  text-align: center;
}
html.dark-mode .matchgeni__toast {
  background: #2a3340;
}

/* Error state stays as a centered text + retry. */
.matchgeni__error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 80px 24px;
  color: var(--secondary);
  text-align: center;
}

.matchgeni__retry {
  appearance: none;
  border: 1px solid var(--border-divider);
  background: var(--surface-muted, #eef3fb);
  color: var(--text);
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

@media (max-width: 1080px) {
  .matchgeni__columns {
    grid-template-columns: 1fr;
  }
  /* Flip the Game Scoring slot visibility — show the mobile copy
     at the TOP of `.matchgeni__content`, hide the desktop copy
     that lives inside the right column. Applies across tablet
     (portrait + landscape) AND mobile, so the scoring affordance
     is the first item the user sees on every viewport ≤1080px
     instead of being buried in the right column once it collapses
     under the left column. */
  .matchgeni__scoring-mobile {
    display: flex;
  }
  .matchgeni__scoring-desktop {
    display: none;
  }
  /* Stats-skeleton inherits the 3-column base layout — no
     per-breakpoint override needed since the row already fits at
     1080px (was a 5→3 wrap before the redesign). */
}

@media (max-width: 720px) {
  .matchgeni__people-skeleton {
    /* Stack the director block above the access rows on mobile — same
       behaviour as the live `.matchgeni-people` grid in
       MatchGeniStatsRow.vue. */
    grid-template-columns: minmax(0, 1fr);
  }
  .matchgeni__people-skeleton-director {
    border-bottom: 1px solid var(--border-divider);
  }

  /* Mobile gutter — keep horizontal page padding so every card
     EXCEPT the divisions section sits inside a gutter (stats
     tiles, team participation, officials, umpires, playing
     facilities). The divisions section is the one stack the user
     wants stretched edge-to-edge — it uses a negative-margin
     break-out trick below to extend past the gutter and meet the
     viewport edges. */
  .matchgeni__content {
    padding: 12px 14px;
    gap: 12px;
  }
  /* (Game Scoring slot visibility flip — show mobile / hide desktop
     — moved up to the `≤1080px` breakpoint above so the same flip
     covers tablet portrait + landscape too, not just mobile.) */
  .matchgeni__columns {
    gap: 12px;
  }
  .matchgeni__left,
  .matchgeni__right {
    gap: 12px;
  }
  /* Divisions section — break out of the page gutter on mobile
     and stretch to the viewport edges. Negative left/right
     margins of `-14px` exactly cancel the parent's `padding: 12px
     14px`, so the section's border line hits the viewport edge
     while the content inside the section keeps its own internal
     padding. Corners + side borders dropped so the band reads as
     flush (top + bottom borders kept for boundary separation). */
  :deep(.matchgeni-divisions) {
    margin-left: -14px;
    margin-right: -14px;
    border-radius: 0;
    border-left: 0;
    border-right: 0;
  }
  /* Event Locations card — same edge-to-edge break-out on mobile: cancel
     the page gutter, drop the rounding + side borders so it reads flush.
     The inner map fill loses its corner radius to match. */
  .matchgeni__right :deep(.pub-venue) {
    margin-left: -14px;
    margin-right: -14px;
    border-radius: 0;
    border-left: 0;
    border-right: 0;
  }
  .matchgeni__right :deep(.pub-venue .pub-venuemap) {
    border-radius: 0;
  }
}
</style>
