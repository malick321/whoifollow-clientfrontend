<script setup lang="ts">
// GameLineupModal
// ---------------
// Set a game's batting lineup — the legacy "LineUp - {team}" flow (Available |
// Selected teammates + per-batter position select + drag-reorder), rebuilt on
// the finalized design system (SlideModal + floating controls + tokens).
// Wired to the v2 team-event lineup endpoints (see src/api/teamEventLineup.ts).
import { ref, watch } from 'vue'
import SlideModal from './SlideModal.vue'
import TeamAvatar from './TeamAvatar.vue'
import { fetchGameLineup, saveGameLineup, type LineupPlayer, type LineupPositionOption } from '../api/teamEventLineup'
import { pushToast } from '../toast-center'

const props = defineProps<{
  modelValue: boolean
  teamId: string
  eventId: string
  gameId: string
}>()
const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'saved'): void
}>()

const available = ref<LineupPlayer[]>([])
const selected = ref<LineupPlayer[]>([])
const positions = ref<LineupPositionOption[]>([])
const loading = ref(false)
const saving = ref(false)
const error = ref('')
let dragIndex = -1

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await fetchGameLineup(props.teamId, props.eventId, props.gameId)
    positions.value = data.positions
    selected.value = data.selected.map((p) => ({ ...p }))
    available.value = data.available.map((p) => ({ ...p }))
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load the lineup.'
  } finally {
    loading.value = false
  }
}

watch(() => props.modelValue, (open) => { if (open) load() })

function addPlayer(index: number) {
  const [player] = available.value.splice(index, 1)
  if (player) selected.value.push({ ...player, positionId: player.positionId ?? null })
}
function removePlayer(index: number) {
  const [player] = selected.value.splice(index, 1)
  if (player) available.value.push(player)
}

function onDragStart(index: number) { dragIndex = index }
function onDrop(index: number) {
  if (dragIndex < 0 || dragIndex === index) return
  const [moved] = selected.value.splice(dragIndex, 1)
  selected.value.splice(index, 0, moved)
  dragIndex = -1
}

async function save() {
  saving.value = true
  error.value = ''
  try {
    const data = await saveGameLineup(
      props.teamId,
      props.eventId,
      props.gameId,
      selected.value.map((p, i) => ({ userId: p.userId, positionId: p.positionId ?? null, positionIndex: i + 1 }))
    )
    selected.value = data.selected.map((p) => ({ ...p }))
    available.value = data.available.map((p) => ({ ...p }))
    pushToast({ tone: 'success', title: 'Lineup saved' })
    emit('saved')
    emit('update:modelValue', false)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save the lineup.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <SlideModal
    :model-value="modelValue"
    title="Game Lineup"
    eyebrow="Batting order"
    size="wide"
    @update:model-value="(v) => emit('update:modelValue', v)"
  >
    <div v-if="loading" class="gl-loading">
      <span v-for="n in 6" :key="n" class="shimmer-block gl-loading__row"></span>
    </div>
    <p v-else-if="error" class="gl-error" role="alert">{{ error }}</p>
    <div v-else class="gl-grid">
      <!-- Available -->
      <section class="gl-col">
        <header class="gl-col__head">Available Teammates <span>{{ available.length }}</span></header>
        <ul class="gl-list">
          <li v-for="(p, i) in available" :key="p.userId" class="gl-row">
            <TeamAvatar :name="p.name" :image-url="p.avatarUrl ?? undefined" size="sm" />
            <span class="gl-row__name"><b>{{ p.name }}</b><small v-if="p.uniformNo">#{{ p.uniformNo }}</small></span>
            <button type="button" class="gl-row__add" aria-label="Add to lineup" @click="addPlayer(i)">+</button>
          </li>
          <li v-if="!available.length" class="gl-empty">Everyone is in the lineup.</li>
        </ul>
      </section>

      <!-- Selected (batting order) -->
      <section class="gl-col">
        <header class="gl-col__head">Selected Teammates <span>{{ selected.length }}</span></header>
        <ul class="gl-list">
          <li
            v-for="(p, i) in selected"
            :key="p.userId"
            class="gl-row gl-row--selected"
            draggable="true"
            @dragstart="onDragStart(i)"
            @dragover.prevent
            @drop="onDrop(i)"
          >
            <span class="gl-row__order">{{ i + 1 }}</span>
            <TeamAvatar :name="p.name" :image-url="p.avatarUrl ?? undefined" size="sm" />
            <span class="gl-row__name"><b>{{ p.name }}</b><small v-if="p.uniformNo">#{{ p.uniformNo }}</small></span>
            <select v-model="p.positionId" class="gl-row__pos" aria-label="Field position">
              <option :value="null">—</option>
              <option v-for="pos in positions" :key="pos.id" :value="pos.id">{{ pos.name }}</option>
            </select>
            <button type="button" class="gl-row__remove" aria-label="Remove from lineup" @click="removePlayer(i)"><AppIcon name="close" :size="15" /></button>
            <span class="gl-row__drag" aria-hidden="true">⠿</span>
          </li>
          <li v-if="!selected.length" class="gl-empty">Add teammates from the left to build the batting order.</li>
        </ul>
      </section>
    </div>

    <template #footer>
      <button type="button" class="secondary-button" @click="emit('update:modelValue', false)">Cancel</button>
      <span class="gl-spacer"></span>
      <button type="button" class="primary-button" :disabled="saving || loading" @click="save">
        <span v-if="saving" class="btn-spinner" aria-hidden="true"></span>
        {{ saving ? 'Saving…' : 'Save Lineup' }}
      </button>
    </template>
  </SlideModal>
</template>

<style scoped>
.gl-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.gl-col { border: 1px solid var(--border-divider); border-radius: 8px; background: var(--surface-card); overflow: hidden; }
.gl-col__head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px; font-weight: 600; font-size: 0.9rem; color: var(--text);
  border-bottom: 1px solid var(--border-divider); background: var(--surface-raised);
}
.gl-col__head span { color: var(--secondary); font-weight: 500; font-size: 0.8rem; }
.gl-list { list-style: none; margin: 0; padding: 8px; display: flex; flex-direction: column; gap: 6px; min-height: 120px; }
.gl-row {
  display: grid; grid-template-columns: auto 32px 1fr auto; align-items: center; gap: 10px;
  padding: 8px 10px; border: 1px solid var(--border-divider); border-radius: 8px; background: var(--surface-raised);
}
.gl-row--selected { grid-template-columns: 22px 32px minmax(0, 1fr) 120px auto auto; cursor: grab; }
.gl-row__order { color: var(--secondary); font-weight: 700; font-size: 0.85rem; text-align: center; }
.gl-row__name { display: flex; flex-direction: column; min-width: 0; }
.gl-row__name b { font-size: 0.85rem; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gl-row__name small { color: var(--secondary); font-size: 0.72rem; }
.gl-row__pos {
  height: 32px; border: 1px solid var(--border-divider); border-radius: 6px;
  background: var(--surface-card); color: var(--text); font: inherit; font-size: 0.8rem; padding: 0 6px; cursor: pointer;
}
.gl-row__add, .gl-row__remove {
  display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px;
  border: 1px solid var(--border-divider); border-radius: 6px; background: var(--surface-card); color: var(--text); cursor: pointer;
}
.gl-row__add { color: var(--primary); border-color: var(--border-accent, var(--primary)); font-size: 1.1rem; line-height: 1; font-weight: 600; }
.gl-row__remove:hover { color: var(--highlight); border-color: var(--highlight); }
.gl-row__drag { color: var(--secondary); display: inline-flex; }
.gl-empty { color: var(--secondary); font-size: 0.82rem; padding: 16px 8px; text-align: center; }
.gl-loading { display: grid; gap: 8px; }
.gl-loading__row { height: 48px; border-radius: 8px; }
.gl-error { margin: 0; color: var(--highlight); font-size: 0.9rem; }
.gl-spacer { flex: 1; }
@media (max-width: 720px) {
  .gl-grid { grid-template-columns: 1fr; }
  .gl-row--selected { grid-template-columns: 20px 30px minmax(0, 1fr) 96px auto; }
  .gl-row__drag { display: none; }
}
</style>
