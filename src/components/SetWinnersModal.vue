<script setup lang="ts">
// SetWinnersModal
// ---------------
// Manual winner announcement / override for one standings group (a
// bracket, or the pool-only group). Lets the admin pick 1st / 2nd / 3rd
// from the group's eligible teams, with a "Co-champions" toggle that
// turns 1st into two shared rank-1 slots. Centered popup using the
// shared switcher chrome (same as the delete-division / assign-umpire
// dialogs). Mock-backed for v1 — see matchgeni-division-api-contract §5.

import { computed, onBeforeUnmount, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import TeamAvatar from './TeamAvatar.vue'
import { lockBodyScroll, unlockBodyScroll } from '../body-scroll-lock'
import type { StandingGroup } from '../types'
import type { StandingsTeam } from '../api/matchGeniStandings'

const props = defineProps<{
  group: StandingGroup
  teams: StandingsTeam[]
}>()

const emit = defineEmits<{
  (event: 'save', payload: { bracketId: string | null; placements: { rank: number; teamId?: string; teamName: string; coChampion?: boolean }[] }): void
  (event: 'close'): void
}>()

// Seed from any existing placements (editing a prior announcement).
function teamForRank(rank: number, nth = 0): string {
  const matches = props.group.placements.filter((p) => p.rank === rank)
  return matches[nth]?.teamName ?? ''
}
const coChampions = ref(props.group.placements.filter((p) => p.rank === 1).length > 1)
const first = ref(teamForRank(1, 0))
const firstB = ref(teamForRank(1, 1))
const second = ref(teamForRank(2, 0))
const third = ref(teamForRank(3, 0))

function teamObj(name: string): { teamId?: string; teamName: string } | null {
  if (!name) return null
  const t = props.teams.find((x) => x.teamName === name)
  return t ? { teamId: t.teamId, teamName: t.teamName } : { teamName: name }
}

const canSave = computed(() =>
  coChampions.value
    ? !!first.value && !!firstB.value && first.value !== firstB.value
    : !!first.value
)

function save() {
  if (!canSave.value) return
  const placements: { rank: number; teamId?: string; teamName: string; coChampion?: boolean }[] = []
  if (coChampions.value) {
    const a = teamObj(first.value)
    const b = teamObj(firstB.value)
    if (a) placements.push({ rank: 1, ...a, coChampion: true })
    if (b) placements.push({ rank: 1, ...b, coChampion: true })
  } else {
    const a = teamObj(first.value)
    const b = teamObj(second.value)
    const c = teamObj(third.value)
    if (a) placements.push({ rank: 1, ...a })
    if (b) placements.push({ rank: 2, ...b })
    if (c) placements.push({ rank: 3, ...c })
  }
  emit('save', { bracketId: props.group.bracketId, placements })
}

function onBackdrop(event: MouseEvent) {
  if (event.target === event.currentTarget) emit('close')
}

lockBodyScroll()
onBeforeUnmount(() => unlockBodyScroll())
</script>

<template>
  <Transition name="slide-modal-backdrop" appear>
    <div
      class="association-switcher-backdrop"
      role="presentation"
      @click="onBackdrop"
    >
      <div class="association-switcher-panel set-winners" role="dialog" aria-modal="true" aria-label="Set winners">
        <header class="association-switcher-panel__header">
          <div class="set-winners__titles">
            <span class="set-winners__eyebrow">{{ group.bracketName }}</span>
            <h2 class="association-switcher-panel__title">Set Winners</h2>
          </div>
          <button type="button" class="association-switcher-panel__close" aria-label="Close" @click="emit('close')">
            <AppIcon name="close" :size="16" />
          </button>
        </header>

        <div class="set-winners__body">
          <label class="set-winners__cochamp">
            <input type="checkbox" v-model="coChampions" />
            <span>Co-champions (two shared 1st place)</span>
          </label>

          <!-- Co-champions: two rank-1 slots. -->
          <template v-if="coChampions">
            <div class="set-winners__row">
              <span class="set-winners__rank">Champion 1</span>
              <div class="floating-input set-winners__pick">
                <select v-model="first" class="floating-input__control floating-input__control--select">
                  <option value="">— Select team —</option>
                  <option v-for="t in teams" :key="`a-${t.teamName}`" :value="t.teamName">{{ t.teamName }}</option>
                </select>
              </div>
            </div>
            <div class="set-winners__row">
              <span class="set-winners__rank">Champion 2</span>
              <div class="floating-input set-winners__pick">
                <select v-model="firstB" class="floating-input__control floating-input__control--select">
                  <option value="">— Select team —</option>
                  <option v-for="t in teams" :key="`b-${t.teamName}`" :value="t.teamName">{{ t.teamName }}</option>
                </select>
              </div>
            </div>
          </template>

          <!-- Standard podium: 1st / 2nd / 3rd. -->
          <template v-else>
            <div class="set-winners__row">
              <span class="set-winners__rank">1st</span>
              <div class="floating-input set-winners__pick">
                <select v-model="first" class="floating-input__control floating-input__control--select">
                  <option value="">— Select team —</option>
                  <option v-for="t in teams" :key="`1-${t.teamName}`" :value="t.teamName">{{ t.teamName }}</option>
                </select>
              </div>
            </div>
            <div class="set-winners__row">
              <span class="set-winners__rank">2nd</span>
              <div class="floating-input set-winners__pick">
                <select v-model="second" class="floating-input__control floating-input__control--select">
                  <option value="">— Select team —</option>
                  <option v-for="t in teams" :key="`2-${t.teamName}`" :value="t.teamName">{{ t.teamName }}</option>
                </select>
              </div>
            </div>
            <div class="set-winners__row">
              <span class="set-winners__rank">3rd</span>
              <div class="floating-input set-winners__pick">
                <select v-model="third" class="floating-input__control floating-input__control--select">
                  <option value="">— Select team —</option>
                  <option v-for="t in teams" :key="`3-${t.teamName}`" :value="t.teamName">{{ t.teamName }}</option>
                </select>
              </div>
            </div>
          </template>

          <p v-if="teams.length === 0" class="set-winners__empty">No teams available for this group.</p>
        </div>

        <footer class="set-winners__footer">
          <button type="button" class="secondary-button" @click="emit('close')">Cancel</button>
          <button type="button" class="primary-button" :disabled="!canSave" @click="save">Save winners</button>
        </footer>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.set-winners { width: min(420px, 100%); }
.set-winners__titles {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.set-winners__eyebrow {
  font-size: 0.72rem;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--secondary);
}
.set-winners__body {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.set-winners__cochamp {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text);
  cursor: pointer;
}
.set-winners__row {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
}
.set-winners__rank {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.set-winners__pick { min-width: 0; }
.set-winners__empty {
  margin: 0;
  font-size: 13px;
  color: var(--secondary);
}
.set-winners__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-divider);
}
.set-winners__footer .primary-button {
  background: var(--primary);
}
.set-winners__footer .primary-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
