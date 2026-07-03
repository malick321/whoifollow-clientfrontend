<script setup lang="ts">
// AssignUmpiresModal
// ------------------
// Assign one or more event umpires to a game (mock-first). Self-fetches the
// event umpire roster (`fetchEventUmpires`) so hosts only pass ids + the
// currently-assigned set; emits `save(umpireIds)`.

import { ref, watch } from 'vue'
import SlideModal from './SlideModal.vue'
import TeamAvatar from './TeamAvatar.vue'
import { fetchEventUmpires } from '../api/matchGeniUmpires'
import type { SchedulerGame } from '../types'

const props = withDefaults(defineProps<{
  modelValue: boolean
  game: SchedulerGame | null
  divisionName?: string
  associationId?: string
  eventId?: string
  /** Currently-assigned umpire ids (host stores them; mock keeps in memory). */
  assignedIds?: string[]
}>(), { divisionName: '', associationId: '', eventId: '', assignedIds: () => [] })

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'save', payload: { game: SchedulerGame; umpireIds: string[] }): void
}>()

interface UmpireRow { id: string; name: string; avatarUrl?: string }
const umpires = ref<UmpireRow[]>([])
const loading = ref(false)
const selected = ref<Set<string>>(new Set())

const FALLBACK: UmpireRow[] = [
  { id: 'u1', name: 'Chris Park' }, { id: 'u2', name: 'Robin Vale' },
  { id: 'u3', name: 'Alex Day' }, { id: 'u4', name: 'Morgan Reed' }, { id: 'u5', name: 'Lee Cruz' }
]

async function load() {
  loading.value = true
  try {
    const res = await fetchEventUmpires(props.associationId, props.eventId, {})
    const list = (res.data ?? []).map((u) => ({ id: u.id, name: u.name, avatarUrl: u.avatarUrl }))
    umpires.value = list.length ? list : FALLBACK
  } catch {
    umpires.value = FALLBACK
  } finally {
    loading.value = false
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    selected.value = new Set(props.assignedIds ?? [])
    if (umpires.value.length === 0) void load()
  },
  { immediate: true }
)

function toggle(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}
function isOn(id: string) { return selected.value.has(id) }

function close() { emit('update:modelValue', false) }
function onSave() {
  if (!props.game) return
  emit('save', { game: props.game, umpireIds: Array.from(selected.value) })
  close()
}
</script>

<template>
  <SlideModal
    :model-value="modelValue"
    title="Assign Umpires"
    :subtitle="game ? `${divisionName ? divisionName + ' · ' : ''}${game.label}` : divisionName"
    size="default"
    @update:model-value="(v) => emit('update:modelValue', v)"
  >
    <p v-if="loading" class="assign-umpires__muted">Loading umpires…</p>
    <div v-else-if="umpires.length === 0" class="app-banner app-banner--primary">
      <div class="app-banner__text"><span class="app-banner__sub">No umpires on the roster yet.</span></div>
    </div>
    <div v-else class="assign-umpires__list">
      <label
        v-for="u in umpires"
        :key="u.id"
        class="assign-umpires__row"
        :class="{ 'assign-umpires__row--on': isOn(u.id) }"
      >
        <input type="checkbox" class="assign-umpires__check" :checked="isOn(u.id)" @change="toggle(u.id)" />
        <TeamAvatar :name="u.name" :image-url="u.avatarUrl" size="sm" />
        <span class="assign-umpires__name">{{ u.name }}</span>
      </label>
    </div>

    <template #footer>
      <button type="button" class="secondary-button" @click="close">Cancel</button>
      <span class="assign-umpires__foot-spacer"></span>
      <button type="button" class="primary-button" @click="onSave">Save</button>
    </template>
  </SlideModal>
</template>

<style scoped>
.assign-umpires__muted { font-size: 14px; color: var(--text-muted); }
.assign-umpires__list { display: flex; flex-direction: column; gap: 4px; }
.assign-umpires__row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
}
.assign-umpires__row:hover { background: var(--surface-hover, rgba(0, 0, 0, 0.03)); }
.assign-umpires__row--on { background: var(--primary-light-4, rgba(45, 140, 240, 0.08)); }
.assign-umpires__check { width: 16px; height: 16px; flex: 0 0 auto; }
.assign-umpires__name { font-size: 14px; color: var(--text); }
.assign-umpires__foot-spacer { flex: 1 1 auto; }
</style>
