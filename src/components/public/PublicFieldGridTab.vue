<script setup lang="ts">
// PublicFieldGridTab
// ------------------
// Field Grid tab on the public event page. Reuses the shared game-scheduler
// UI (`MatchGeniFieldGrid`) in fully read-only mode (`cellInteraction="none"`)
// — a park picker on top + the selected park's time × field calendar grid.
// Data from the public schedule endpoint (`fetchEventSchedule`), which returns
// the exact `SchedulerPark` / `SchedulerGame` shapes the grid consumes.

import { computed, onMounted, ref, watch } from 'vue'
import MatchGeniFieldGrid from '../MatchGeniFieldGrid.vue'
import MatchGeniParkPicker from '../MatchGeniParkPicker.vue'
import MatchGeniGameCard from '../MatchGeniGameCard.vue'
import { fetchEventSchedule } from '../../api/publicEventTabs'
import type { PublicDivision, SchedulerGame, SchedulerPark } from '../../types'

const props = defineProps<{
  slug: string
  divisions: PublicDivision[]
}>()

const loading = ref(true)
const parks = ref<SchedulerPark[]>([])
const games = ref<SchedulerGame[]>([])
const selectedParkId = ref<string | null>(null)
const activeDate = ref<string>('')

const divisionNameById = computed<Map<string, string>>(() => {
  const map = new Map<string, string>()
  for (const d of props.divisions) map.set(d.id, d.name)
  return map
})

const selectedPark = computed<SchedulerPark | null>(
  () => parks.value.find((p) => p.id === selectedParkId.value) ?? null
)

onMounted(async () => {
  try {
    const res = await fetchEventSchedule(props.slug)
    parks.value = res.parks
    games.value = res.games
    selectedParkId.value = res.parks[0]?.id ?? null
    activeDate.value = res.parks[0]?.days[0]?.date ?? ''
  } finally {
    loading.value = false
  }
})

// Snap the active date to the selected park's first day when switching parks
// (unless the current date also exists on the new park).
watch(selectedPark, (next) => {
  if (next && next.days.length > 0) {
    const stillValid = next.days.some((d) => d.date === activeDate.value)
    if (!stillValid) activeDate.value = next.days[0].date
  }
})
</script>

<template>
  <div class="pub-fieldgrid">
    <div v-if="loading" class="pub-fieldgrid__sk" aria-busy="true">
      <span class="shimmer-block pub-fieldgrid__sk-park"></span>
      <div class="pub-fieldgrid__sk-strip">
        <span v-for="n in 7" :key="`skd-${n}`" class="shimmer-block pub-fieldgrid__sk-day"></span>
      </div>
      <div class="pub-fieldgrid__sk-grid">
        <span v-for="n in 24" :key="`skc-${n}`" class="shimmer-block pub-fieldgrid__sk-cell"></span>
      </div>
    </div>

    <template v-else-if="selectedPark">
      <header v-if="parks.length > 1" class="pub-fieldgrid__toolbar">
        <MatchGeniParkPicker
          id="public-field-grid-park"
          v-model="selectedParkId"
          :parks="parks"
        />
      </header>

      <div class="pub-fieldgrid__grid">
        <MatchGeniFieldGrid
          :park="selectedPark"
          :games="games"
          v-model:active-date="activeDate"
          cell-interaction="none"
        >
          <template #cell="{ game, size, durationMinutes }">
            <MatchGeniGameCard
              :game="(game as SchedulerGame)"
              :division-name="divisionNameById.get((game as SchedulerGame).divisionId) ?? ''"
              :permitted="true"
              :size="(size as 'full' | 'compact' | 'mini')"
              :duration-minutes="(durationMinutes as number)"
              toned-by-division
            />
          </template>
          <template #empty-cell><span /></template>
        </MatchGeniFieldGrid>
      </div>
    </template>

    <section v-else class="pub-panel__section pub-fieldgrid__empty">
      <h2 class="pub-panel__heading">Field Grid</h2>
      <p class="pub-panel__empty">No park schedule published for this event yet.</p>
    </section>
  </div>
</template>

<style scoped>
.pub-fieldgrid { display: flex; flex-direction: column; gap: 12px; min-width: 0; }

/* Loading skeleton — park pill + date strip + a grid of cells. */
.pub-fieldgrid__sk { display: flex; flex-direction: column; gap: 12px; }
.pub-fieldgrid__sk-park { display: block; height: 38px; width: 300px; max-width: 100%; border-radius: 8px; }
.pub-fieldgrid__sk-strip { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
.pub-fieldgrid__sk-day { height: 44px; border-radius: 6px; }
.pub-fieldgrid__sk-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}
.pub-fieldgrid__sk-cell { height: 72px; border-radius: 8px; }
.pub-fieldgrid__toolbar { display: flex; align-items: center; gap: 12px; }
.pub-fieldgrid__toolbar :deep(.floating-input),
.pub-fieldgrid__toolbar :deep(.matchgeni-park-picker) { max-width: 360px; }
.pub-fieldgrid__grid {
  background: var(--surface-card, #fff);
  border: 1px solid var(--border-divider);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.06);
}
.pub-panel__section {
  background: var(--surface-card, #fff);
  border: 1px solid var(--border-divider);
  border-radius: 14px;
  padding: 16px 18px;
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.06);
}
.pub-panel__heading { margin: 0 0 12px; font-size: 16px; font-weight: 600; color: var(--text); }
.pub-panel__empty { margin: 0; font-size: 13px; color: var(--secondary); }
</style>
