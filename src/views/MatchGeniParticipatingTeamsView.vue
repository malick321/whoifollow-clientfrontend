<script setup lang="ts">
// MatchGeniParticipatingTeamsView — placeholder sub-page.
// ----------------------------------------------------------------
// Gated by `manage_team_participation`. Real screen ships in a
// follow-up; this stub backs the dashboard's "Manage Teams" CTA
// + the four-stat participation tiles (Pending / Confirmed /
// Waitlist / Withdrawn).

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
    'manage_team_participation',
    'Participating Teams'
  )
}

onMounted(load)
watch([associationShortName, eventId], load)
</script>

<template>
  <main class="matchgeni">
    <MatchGeniHeader
      variant="sub-page"
      title="Participating Teams"
      :subtitle="matchGeniContext?.event.eventName ?? ''"
      :event-id="eventId"
    />
    <div class="matchgeni__content">
      <section class="matchgeni-placeholder">
        <h2 class="matchgeni-placeholder__title">Participating Teams</h2>
        <p class="matchgeni-placeholder__copy">
          Review and manage team registrations, approvals,
          waitlist position, and withdrawals for this event. This
          page is coming soon.
        </p>
      </section>
    </div>
  </main>
</template>
