<script setup lang="ts">
// PublicTeamsTab
// --------------
// Teams tab on the public event page. Mirrors the legacy design: teams
// grouped by AGE GROUP (section header + count), each team a row with
// avatar, name, a "Sport · Gender · Age · Rating" meta line, and city/state.
// Gender + Rating filters (shared `MultiSelectDropdown`) narrow the list
// client-side from the single fetch (the endpoint also returns the option
// catalogues). Data from the public teams endpoint (`fetchEventTeams`).

import { computed, onMounted, ref } from 'vue'
import TeamAvatar from '../TeamAvatar.vue'
import MultiSelectDropdown from '../MultiSelectDropdown.vue'
import { fetchEventTeams, type PublicEventTeams, type PublicEventTeam } from '../../api/publicEventTabs'

const props = defineProps<{ slug: string }>()

const loading = ref(true)
const data = ref<PublicEventTeams | null>(null)
const selectedGenders = ref<string[]>([])
const selectedRatings = ref<string[]>([])

onMounted(async () => {
  try {
    data.value = await fetchEventTeams(props.slug)
  } finally {
    loading.value = false
  }
})

const genderOptions = computed(() => data.value?.genders ?? [])
const ratingOptions = computed(() => data.value?.ratings ?? [])

// Client-side filter — narrow each age-group section, drop empties.
const filteredGroups = computed(() => {
  const groups = data.value?.groups ?? []
  const g = selectedGenders.value
  const r = selectedRatings.value
  const match = (t: PublicEventTeam) =>
    (g.length === 0 || (t.gender != null && g.some((x) => x.toLowerCase() === t.gender!.toLowerCase()))) &&
    (r.length === 0 || (t.rating != null && r.includes(t.rating)))
  return groups
    .map((grp) => ({ ...grp, teams: grp.teams.filter(match) }))
    .filter((grp) => grp.teams.length > 0)
    .map((grp) => ({ ...grp, teamCount: grp.teams.length }))
})

const totalShown = computed(() =>
  filteredGroups.value.reduce((n, grp) => n + grp.teams.length, 0)
)

function teamMeta(t: PublicEventTeam): string {
  return [t.sport, t.gender, t.ageGroup, t.rating].filter(Boolean).join(' · ')
}
function teamLocation(t: PublicEventTeam): string {
  return [t.city, t.state].filter(Boolean).join(', ')
}
</script>

<template>
  <div class="pub-teams">
    <section class="pub-panel__section">
      <!-- Header: title + count + filters -->
      <div class="pub-teams__head">
        <h2 class="pub-panel__heading pub-panel__heading--inline">
          Teams <span class="pub-panel__count">{{ totalShown }}</span>
        </h2>
        <div class="pub-teams__filters">
          <MultiSelectDropdown
            v-model="selectedGenders"
            :options="genderOptions"
            placeholder="Gender"
            :searchable="false"
          />
          <MultiSelectDropdown
            v-model="selectedRatings"
            :options="ratingOptions"
            placeholder="Rating"
          />
        </div>
      </div>

      <div v-if="loading" class="pub-sk-teams" aria-busy="true">
        <span class="shimmer-block pub-sk-teams__head"></span>
        <div v-for="n in 6" :key="`skt-${n}`" class="pub-sk-teams__row">
          <span class="shimmer-circle pub-sk-teams__avatar"></span>
          <span class="pub-sk-teams__lines">
            <span class="shimmer-block pub-sk-teams__name"></span>
            <span class="shimmer-block pub-sk-teams__meta"></span>
          </span>
        </div>
      </div>
      <p v-else-if="!filteredGroups.length" class="pub-panel__empty">No teams match these filters.</p>

      <div v-else class="pub-teams__groups">
        <div v-for="grp in filteredGroups" :key="grp.ageGroup" class="pub-teams__group">
          <p class="pub-teams__group-head">
            <span>{{ grp.ageGroup }}</span>
            <span class="pub-teams__group-count">({{ grp.teamCount }} {{ grp.teamCount === 1 ? 'Team' : 'Teams' }})</span>
          </p>
          <ul class="pub-teams__list">
            <li v-for="t in grp.teams" :key="t.id" class="pub-teams__row">
              <TeamAvatar :name="t.teamName" :image-url="t.avatarUrl" size="sm" />
              <span class="pub-teams__copy">
                <span class="pub-teams__name">{{ t.teamName }}</span>
                <span v-if="teamMeta(t)" class="pub-teams__meta">{{ teamMeta(t) }}</span>
                <span v-if="teamLocation(t)" class="pub-teams__loc">{{ teamLocation(t) }}</span>
              </span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.pub-teams { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.pub-panel__section {
  background: var(--surface-card, #fff);
  border: 1px solid var(--border-divider);
  border-radius: 14px;
  padding: 16px 18px;
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.06);
}
.pub-teams__head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.pub-panel__heading { margin: 0 0 12px; font-size: 16px; font-weight: 600; color: var(--text); display: flex; align-items: center; gap: 8px; }
.pub-panel__heading--inline { margin: 0; }
.pub-panel__count {
  font-size: 11px; font-weight: 600; border-radius: 999px; padding: 2px 8px;
  background: #eef2f7; color: #5f7186;
}
html.dark-mode .pub-panel__count { background: rgba(255, 255, 255, 0.06); color: var(--secondary); }
.pub-teams__filters { margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; }
.pub-panel__empty { margin: 0; font-size: 13px; color: var(--secondary); }

.pub-teams__groups { display: flex; flex-direction: column; gap: 18px; }
.pub-teams__group-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--secondary);
}
.pub-teams__group-count { font-weight: 500; letter-spacing: normal; text-transform: none; }
.pub-teams__list { list-style: none; margin: 0; padding: 0; }
.pub-teams__row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 4px;
  border-top: 1px solid var(--border-divider);
}
.pub-teams__row:first-child { border-top: none; }
.pub-teams__copy { display: flex; flex-direction: column; min-width: 0; }
.pub-teams__name { font-size: 13px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pub-teams__meta { font-size: 12px; color: var(--secondary); }
.pub-teams__loc { font-size: 12px; color: var(--text-light, var(--secondary)); }

/* Loading skeleton — mirrors the age-group header + team rows. */
.pub-sk-teams { display: flex; flex-direction: column; gap: 12px; }
.pub-sk-teams__head { display: block; height: 12px; width: 28%; border-radius: 6px; }
.pub-sk-teams__row { display: flex; align-items: center; gap: 10px; }
.pub-sk-teams__avatar { width: 28px; height: 28px; flex: 0 0 auto; }
.pub-sk-teams__lines { display: flex; flex-direction: column; gap: 6px; flex: 1 1 auto; }
.pub-sk-teams__name { display: block; height: 13px; width: 45%; border-radius: 6px; }
.pub-sk-teams__meta { display: block; height: 11px; width: 65%; border-radius: 6px; }
</style>
