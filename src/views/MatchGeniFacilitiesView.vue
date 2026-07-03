<script setup lang="ts">
// MatchGeniFacilitiesView — placeholder sub-page.
// ----------------------------------------------------------------
// Gated by `manage_parks`. Real screen ships in a follow-up; this
// stub exists so the dashboard's facility carousel + "Add Facility"
// CTA has a destination and the route-level permission gate
// already blocks direct URL access.

import { computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import MatchGeniHeader from '../components/MatchGeniHeader.vue'
import { currentAssociation } from '../constants/associations'
import { ensureMatchGeniAccess, matchGeniContext } from '../matchgeni-context'

const route = useRoute()
const router = useRouter()

const associationShortName = computed(() =>
  (route.params.associationShortName as string | undefined) ?? ''
)
const eventId = computed(() =>
  (route.params.eventId as string | undefined) ?? ''
)

async function load() {
  await ensureMatchGeniAccess(
    router,
    currentAssociation.value?.id ?? '',
    eventId.value,
    associationShortName.value,
    'manage_parks',
    'Facilities'
  )
}

onMounted(load)
watch([associationShortName, eventId], load)
</script>

<template>
  <main class="matchgeni">
    <MatchGeniHeader
      variant="sub-page"
      title="Playing Facilities"
      :subtitle="matchGeniContext?.event.eventName ?? ''"
      :event-id="eventId"
    />
    <div class="matchgeni__content">
      <section class="matchgeni-placeholder">
        <h2 class="matchgeni-placeholder__title">Playing Facilities</h2>
        <p class="matchgeni-placeholder__copy">
          Manage parks added to this event, configure available
          fields, and define scheduling windows. This page is
          coming soon.
        </p>
      </section>
    </div>
  </main>
</template>
