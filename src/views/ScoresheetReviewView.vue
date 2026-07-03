<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import StatusBadge from '../components/StatusBadge.vue'
import AppIcon from '../components/AppIcon.vue'
import { fetchScoresheet } from '../api/team'
import type { ScoresheetDetail, UploadStatus } from '../types'

const route = useRoute()
const router = useRouter()

// New standardized review route: /event/participation/:participationId/team/:teamId/game/:gameGuid/review
const participationId = computed(() => route.params.participationId as string | undefined)
const teamId = computed(() => route.params.teamId as string)
const gameGuid = computed(() => route.params.gameGuid as string | undefined)
// eventId + gameId are only used by fetchScoresheet's signature; the URL
// itself doesn't carry them anymore. fetchScoresheet tolerates empty
// eventId (unused in the request URL), and we pass gameGuid in its slot
// — the scoresheet endpoint resolves by either identifier via the shell
// flow the view uses.
const eventId = computed(() => '')
const gameId = computed(() => gameGuid.value ?? '')

const scoresheet = ref<ScoresheetDetail | null>(null)

function statusTone(status: UploadStatus) {
  if (status === 'published' || status === 'mapped') return 'success'
  if (status === 'review' || status === 'uploading') return 'warning'
  return 'info'
}

const unresolvedPlayers = computed(
  () => scoresheet.value?.players.filter((player) => player.mappingState !== 'matched').length ?? 0
)

const trackedAppearances = computed(
  () =>
    scoresheet.value?.players.reduce(
      (total, player) => total + player.cells.reduce((sum, cell) => sum + cell.appearances.length, 0),
      0
    ) ?? 0
)

async function load() {
  scoresheet.value = await fetchScoresheet(eventId.value, teamId.value, gameId.value)
}

function goBack() {
  router.push({
    name: 'scoresheet',
    params: {
      participationId: participationId.value ?? '',
      teamId: teamId.value,
      gameGuid: gameGuid.value ?? ''
    }
  })
}

onMounted(load)
</script>

<template>
  <main v-if="scoresheet" class="page-shell">
    <section class="panel">
      <div class="panel__header">
        <div>
          <p class="eyebrow">Upload Review</p>
          <h1 class="review-flow__title">Staged Scoresheet Review</h1>
          <p class="panel-copy">Approve uploaded corrections here, then merge the reviewed results into the main scoresheet ledger.</p>
        </div>
        <div class="review-flow__header-actions">
          <StatusBadge :label="scoresheet.uploadStatus" :tone="statusTone(scoresheet.uploadStatus)" />
          <button class="secondary-button" type="button" @click="goBack">Back to Game Details</button>
        </div>
      </div>

      <div class="review-flow__summary">
        <div class="review-flow__summary-card">
          <span>Uploaded file</span>
          <strong>{{ scoresheet.sourceImageName || 'No image uploaded yet' }}</strong>
        </div>
        <div class="review-flow__summary-card">
          <span>Corrections</span>
          <strong>{{ unresolvedPlayers }} lineup issues</strong>
        </div>
        <div class="review-flow__summary-card">
          <span>Staged plays</span>
          <strong>{{ trackedAppearances }} appearances extracted</strong>
        </div>
      </div>

      <div class="review-flow__queue">
        <div v-for="item in scoresheet.reviewItems" :key="item.id" class="info-row">
          <div class="scoresheet-review-title">
            <strong>{{ item.title }}</strong>
            <StatusBadge :label="item.tone" :tone="item.tone" />
          </div>
          <span>{{ item.detail }}</span>
        </div>
      </div>

      <div class="review-flow__merge-note">
        <AppIcon name="document" :size="18" tone="two-tone" />
        <span>This review screen is the staging area for approve-and-merge behavior before updates reach the main grid.</span>
      </div>
    </section>
  </main>
</template>
