<script setup lang="ts">
// PublicBoxscoresTab
// ------------------
// Boxscores tab on the public event page. Mirrors the legacy design: a
// division pill rail (the same `PublicDivisionList` the About tab uses) +
// the selected division's games grouped by DATE, each rendered with the
// shared read-only `PublicPoolPlayGameItem` card (team names, avatars,
// scores, status). Data comes from the public per-division games endpoint
// (`fetchDivisionGames`) — fetched on demand as the division changes.

import { computed, onMounted, ref, watch } from 'vue'
import PublicDivisionList from './PublicDivisionList.vue'
import PublicPoolPlayGameItem from './PublicPoolPlayGameItem.vue'
import PoolPlayGames from '../poolplay/PoolPlayGames.vue'
import { fetchDivisionGames, type PublicBoxscoreGame } from '../../api/publicEventTabs'
import type { PublicDivision, PublicDivisionGame } from '../../types'

const props = defineProps<{
  slug: string
  divisions: PublicDivision[]
}>()

const selectedId = ref<string>(props.divisions[0]?.id ?? '')
const loading = ref(false)
const games = ref<PublicBoxscoreGame[]>([])

const selectedDivision = computed(() =>
  props.divisions.find((d) => d.id === selectedId.value) ?? props.divisions[0] ?? null
)

async function load(divisionId: string) {
  if (!divisionId) { games.value = []; return }
  loading.value = true
  try {
    const res = await fetchDivisionGames(props.slug, divisionId)
    games.value = res.games
  } finally {
    loading.value = false
  }
}

onMounted(() => load(selectedId.value))
watch(selectedId, (id) => load(id))

// Map the boxscore payload → the `PublicDivisionGame` shape the shared
// pool-play card renders (null scores → undefined so the card hides them).
const mappedGames = computed<PublicDivisionGame[]>(() =>
  games.value.map((g) => ({
    id: g.id,
    label: g.bracketName ? `${g.gameName} · ${g.bracketName}` : g.gameName,
    team1: g.team1.name,
    team2: g.team2.name,
    date: g.startDate ?? '',
    time: g.startTime ?? undefined,
    field: g.field,
    park: g.park,
    status: g.status,
    team1Score: g.team1.score ?? undefined,
    team2Score: g.team2.score ?? undefined
  }))
)

interface DateGroup { key: string; label: string; games: PublicDivisionGame[] }
const gameGroups = computed<DateGroup[]>(() => {
  const order: string[] = []
  const byKey = new Map<string, DateGroup>()
  for (const g of mappedGames.value) {
    const key = g.date || 'unscheduled'
    if (!byKey.has(key)) {
      byKey.set(key, { key, label: g.date ? formatDate(g.date) : 'Not scheduled', games: [] })
      order.push(key)
    }
    byKey.get(key)!.games.push(g)
  }
  return order.map((k) => byKey.get(k)!)
})

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}
</script>

<template>
  <div class="pub-boxscores">
    <PublicDivisionList
      v-if="divisions.length"
      :divisions="divisions"
      :selected-id="selectedDivision?.id ?? ''"
      @select="selectedId = $event"
    />

    <section class="pub-panel__section">
      <PoolPlayGames :groups="gameGroups">
        <template #header>
          <div class="pub-panel__games-head">
            <h2 class="pub-panel__heading pub-panel__heading--inline">Boxscores</h2>
            <span class="pub-panel__games-count">
              {{ games.length }} {{ games.length === 1 ? 'game' : 'games' }}
            </span>
          </div>
        </template>
        <template #game="{ game }">
          <PublicPoolPlayGameItem :game="(game as PublicDivisionGame)" />
        </template>
        <template #empty>
          <div v-if="loading" class="pub-sk-games" aria-busy="true">
            <div v-for="n in 5" :key="`skg-${n}`" class="pub-sk-game">
              <span class="shimmer-block pub-sk-game__meta"></span>
              <span class="shimmer-block pub-sk-game__row"></span>
              <span class="shimmer-block pub-sk-game__row"></span>
            </div>
          </div>
          <p v-else class="pub-panel__empty">No games in this division yet.</p>
        </template>
      </PoolPlayGames>
    </section>
  </div>
</template>

<style scoped>
.pub-boxscores { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.pub-panel__section {
  background: var(--surface-card, #fff);
  border: 1px solid var(--border-divider);
  border-radius: 14px;
  padding: 16px 18px;
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.06);
}
.pub-panel__games-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.pub-panel__heading { margin: 0 0 12px; font-size: 16px; font-weight: 600; color: var(--text); }
.pub-panel__heading--inline { margin: 0; }
.pub-panel__games-count {
  margin-left: auto;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--secondary);
  white-space: nowrap;
}
.pub-panel__empty { margin: 0; font-size: 13px; color: var(--secondary); }

/* Loading skeleton — mirrors the game-card rows so the list doesn't jump. */
.pub-sk-games { display: flex; flex-direction: column; gap: 14px; }
.pub-sk-game {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--border-divider);
  border-radius: 12px;
}
.pub-sk-game__meta { display: block; height: 11px; width: 40%; border-radius: 6px; }
.pub-sk-game__row { display: block; height: 15px; width: 75%; border-radius: 6px; }
.pub-sk-game__row:last-child { width: 60%; }
</style>
