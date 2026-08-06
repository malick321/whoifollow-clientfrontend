<script setup lang="ts">
// GameScoringView — Phase 2 placeholder.
// The full run/inning scoring screen (line score + scoring pad + batting stats,
// wired to the legacy game/* endpoints, styled like matchgeni) lands here next.
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'

const route = useRoute()
const router = useRouter()
const teamId = computed(() => String(route.params.teamId ?? ''))
const eventId = computed(() => String(route.params.eventId ?? ''))

function backToEvent() {
  router.push({ name: 'team-event-detail', params: { teamId: teamId.value, eventId: eventId.value } })
}
</script>

<template>
  <main class="game-scoring">
    <div class="game-scoring__card">
      <AppIcon name="game" :size="40" tone="two-tone" />
      <h1>Game scoring</h1>
      <p>The scoring screen is on its way — line score, run/inning scoring pad and batting stats.</p>
      <button type="button" class="primary-button" @click="backToEvent">Back to event</button>
    </div>
  </main>
</template>

<style scoped>
.game-scoring { max-width: 1540px; margin: 0 auto; padding: 22px; min-height: calc(100vh - 64px); }
.game-scoring__card {
  display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center;
  max-width: 460px; margin: 8vh auto 0; padding: 40px 28px;
  border: 1px solid var(--border-divider); border-radius: 12px; background: var(--surface-card); color: var(--text);
}
.game-scoring__card h1 { margin: 6px 0 0; font-size: 1.4rem; }
.game-scoring__card p { margin: 0; color: var(--secondary); }
.game-scoring__card .primary-button { margin-top: 8px; }
</style>
