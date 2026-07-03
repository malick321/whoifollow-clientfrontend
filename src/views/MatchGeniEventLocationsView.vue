<script setup lang="ts">
// MatchGeniEventLocationsView
// ---------------------------
// /association/:associationShortName/portal/events/:eventId/matchgeni/event-locations
//
// Dedicated "Locations" sub-page — the venue map (parks + hotels) that
// used to open as a full-screen Map Explorer modal from the dashboard.
// Now it's a first-class page reached from the left rail's "Locations"
// item: the map fills the content area beside the persistent (collapsed)
// rail. Admins add a venue via the in-map "Add" flow (gated by
// manage_parks / manage_hotels); everyone else browses read-only.
//
// Parks + hotels come from the §9 event resources, mapped to the public
// map shapes (positions drive the pins) — same mapping the dashboard's
// venue guide uses.

import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import MatchGeniHeader from '../components/MatchGeniHeader.vue'
import MapExplorerModal from '../components/public/MapExplorerModal.vue'
import { fetchEventResources } from '../api/events'
import { currentAssociation } from '../constants/associations'
import { canMatchGeniWrite, ensureMatchGeniAccess, matchGeniContext } from '../matchgeni-context'
import { pushToast } from '../toast-center'
import type { EventHotel, Park, ParkScheduleEntry, PublicEventPark } from '../types'

const route = useRoute()
const router = useRouter()

const associationShortName = computed(() =>
  (route.params.associationShortName as string | undefined) ?? ''
)
const eventId = computed(() => (route.params.eventId as string | undefined) ?? '')
const associationId = computed(() => currentAssociation.value?.id ?? '')
const eventName = computed(() => matchGeniContext.value?.event?.eventName ?? '')

// ── Event context the in-map add wizards need ────────────────────
const eventStartDate = computed(() => matchGeniContext.value?.event?.startDate ?? '')
const eventEndDate = computed(() => matchGeniContext.value?.event?.endDate ?? '')
const eventStartTime = computed(() => matchGeniContext.value?.event?.eventStartTime ?? null)
const eventEndTime = computed(() => matchGeniContext.value?.event?.eventEndTime ?? null)
const eventAllDay = computed(() => matchGeniContext.value?.event?.allDay ?? false)
const dateRangeLabel = computed(() => matchGeniContext.value?.event?.dateRange ?? '')
const canAddVenue = computed(() => canMatchGeniWrite('manage_parks') || canMatchGeniWrite('manage_hotels'))

// ── Resources → public map shapes (mirrors the dashboard) ────────
const resourceParks = ref<Park[]>([])
const resourceHotels = ref<EventHotel[]>([])
const addedParks = ref<PublicEventPark[]>([])
const addedHotels = ref<EventHotel[]>([])

function ymdNext(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
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

const mapParks = computed<PublicEventPark[]>(() => [
  ...resourceParks.value.map(parkToPublic),
  ...addedParks.value
])
const mapHotels = computed<EventHotel[]>(() => [
  ...resourceHotels.value.filter((h) => h.status !== 0),
  ...addedHotels.value
])
const mapLocation = computed(() => mapParks.value[0]?.location ?? '')

const loading = ref(true)
let fetchToken = 0
async function load() {
  const myToken = ++fetchToken
  loading.value = true
  try {
    // Entry gate only — Locations is viewable by anyone with matchgeni
    // access (the in-map Add control is the permission-gated part).
    const ok = await ensureMatchGeniAccess(
      router,
      associationId.value,
      eventId.value,
      associationShortName.value
    )
    if (myToken !== fetchToken) return
    if (!ok) return

    // Parks + hotels in a single resources call (comma-separated buckets).
    const res = await fetchEventResources(
      associationId.value, eventId.value, ['parks', 'hotels']
    ).catch(() => null)
    if (myToken !== fetchToken) return
    resourceParks.value = res?.parks ?? []
    resourceHotels.value = res?.hotels ?? []
  } catch (err) {
    if (typeof console !== 'undefined') console.error('Load locations failed:', err)
    if (myToken === fetchToken) {
      resourceParks.value = []
      resourceHotels.value = []
    }
  } finally {
    if (myToken === fetchToken) loading.value = false
  }
}

watch([associationShortName, eventId], load)
onMounted(load)

function onMapParkSaved(payload: { park: PublicEventPark; fieldCount: number; dayCount: number }) {
  addedParks.value = [...addedParks.value, payload.park]
  pushToast({
    tone: 'success',
    title: 'Facility added',
    message: `"${payload.park.name}" added with ${payload.fieldCount} field${payload.fieldCount === 1 ? '' : 's'} across ${payload.dayCount} day${payload.dayCount === 1 ? '' : 's'}.`
  })
}
function onMapHotelSaved(payload: { hotel: EventHotel }) {
  addedHotels.value = [...addedHotels.value, payload.hotel]
  pushToast({ tone: 'success', title: 'Hotel added', message: `"${payload.hotel.name}" added.` })
}
</script>

<template>
  <main class="mg-locations">
    <MatchGeniHeader
      variant="sub-page"
      title="Event Locations"
      :subtitle="eventName"
      :event-id="eventId"
    />

    <!-- The map fills the content area beside the left rail; positioned
         host so the embedded explorer can `position: absolute; inset: 0`. -->
    <div class="mg-locations__map">
      <MapExplorerModal
        embedded
        :open="true"
        :parks="mapParks"
        :hotels="mapHotels"
        :location="mapLocation"
        :event-name="eventName"
        :date-range-label="dateRangeLabel"
        :can-add="canAddVenue"
        :association-id="associationId"
        :event-id="eventId"
        :event-start-date="eventStartDate"
        :event-end-date="eventEndDate"
        :event-start-time="eventStartTime"
        :event-end-time="eventEndTime"
        :event-all-day="eventAllDay"
        @park-saved="onMapParkSaved"
        @hotel-saved="onMapHotelSaved"
      />
    </div>
  </main>
</template>

<style scoped>
.mg-locations {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

/* Positioned host so the embedded Map Explorer fills it. `flex: 1` makes
   it claim the viewport height left under the sub-page header. */
.mg-locations__map {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
}
</style>
