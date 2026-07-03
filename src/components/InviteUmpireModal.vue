<script setup lang="ts">
// AddUmpireModal (file: InviteUmpireModal.vue)
// --------------------------------------------
// Picker for adding an umpire to an event's roster. Lists the
// association's REGISTERED umpires (not the general association-users
// list), excludes those already on the event roster, and emits `add`
// with the picked umpire — the host view performs the add API call +
// list update.

import { computed, ref, watch } from 'vue'
import SlideModal from './SlideModal.vue'
import AppIcon from './AppIcon.vue'
import TeamAvatar from './TeamAvatar.vue'
import { fetchAssociationUmpires } from '../api/matchGeniUmpires'
import type { AssociationUmpire } from '../types'

const props = withDefaults(defineProps<{
  modelValue: boolean
  associationId: string
  /** Registered-umpire ids already on the event roster — hidden. */
  excludeUmpireIds?: string[]
}>(), {
  excludeUmpireIds: () => []
})

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'add', umpire: AssociationUmpire): void
}>()

const umpires = ref<AssociationUmpire[]>([])
const loading = ref(false)
const errorMessage = ref('')
const search = ref('')
let loadToken = 0

const excluded = computed(() => new Set(props.excludeUmpireIds))
const visibleUmpires = computed(() => umpires.value.filter((u) => !excluded.value.has(u.id)))

async function load() {
  const token = ++loadToken
  loading.value = true
  errorMessage.value = ''
  try {
    const rows = await fetchAssociationUmpires(props.associationId, { search: search.value })
    if (token !== loadToken) return
    umpires.value = rows
  } catch (err) {
    if (token !== loadToken) return
    errorMessage.value = err instanceof Error ? err.message : 'Could not load umpires.'
    umpires.value = []
  } finally {
    if (token === loadToken) loading.value = false
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      search.value = ''
      load()
    }
  },
  { immediate: true }
)

const SEARCH_DEBOUNCE_MS = 350
let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { searchTimer = null; load() }, SEARCH_DEBOUNCE_MS)
})

function pick(umpire: AssociationUmpire) {
  emit('add', umpire)
  emit('update:modelValue', false)
}
</script>

<template>
  <SlideModal
    :model-value="modelValue"
    title="Add Umpire"
    subtitle="Add a registered umpire to this event's roster"
    @update:modelValue="emit('update:modelValue', $event)"
  >
    <div class="add-umpire">
      <label class="add-umpire__search">
        <AppIcon name="search" :size="14" />
        <input
          v-model="search"
          type="search"
          placeholder="Search registered umpires"
          class="add-umpire__search-input"
        />
      </label>

      <div v-if="loading" class="add-umpire__state">Loading umpires…</div>
      <div v-else-if="errorMessage" class="add-umpire__state add-umpire__state--error">
        {{ errorMessage }}
        <button type="button" class="add-umpire__retry" @click="load">Retry</button>
      </div>
      <div v-else-if="visibleUmpires.length === 0" class="add-umpire__state">
        {{ search.trim() ? `No umpires match "${search}".` : 'All registered umpires are already on the roster.' }}
      </div>

      <ul v-else class="add-umpire__list">
        <li v-for="u in visibleUmpires" :key="u.id" class="add-umpire__row">
          <TeamAvatar :name="u.name" :image-url="u.avatarUrl" size="md" />
          <div class="add-umpire__row-copy">
            <strong class="add-umpire__row-name">{{ u.name }}</strong>
            <span class="add-umpire__row-email">{{ u.email }}</span>
          </div>
          <button type="button" class="add-umpire__add-btn" @click="pick(u)">
            <span aria-hidden="true">+</span> Add
          </button>
        </li>
      </ul>
    </div>
  </SlideModal>
</template>

<style scoped>
.add-umpire {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.add-umpire__search {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  height: 40px;
  border-radius: 8px;
  border: 1px solid var(--border-divider);
  background: var(--white);
  color: var(--secondary);
}
html.dark-mode .add-umpire__search {
  background: rgba(255, 255, 255, 0.04);
}
.add-umpire__search-input {
  flex: 1 1 auto;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font: inherit;
  color: var(--text);
}
.add-umpire__state {
  padding: 32px 12px;
  text-align: center;
  color: var(--secondary);
}
.add-umpire__state--error { color: var(--highlight, #d64545); }
.add-umpire__retry {
  margin-left: 10px;
  appearance: none;
  border: 1px solid var(--border-divider);
  background: var(--surface-muted, #eef3fb);
  color: var(--text);
  padding: 4px 12px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}
.add-umpire__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.add-umpire__row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 4px;
  border-top: 1px solid var(--border-divider);
}
.add-umpire__row:first-child { border-top: none; }
.add-umpire__row-copy {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.add-umpire__row-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.add-umpire__row-email {
  font-size: 12px;
  color: var(--secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.add-umpire__add-btn {
  flex: 0 0 auto;
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 32px;
  padding: 0 14px;
  border-radius: 6px;
  border: 1px solid var(--primary);
  background: transparent;
  color: var(--primary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}
.add-umpire__add-btn:hover {
  background: var(--primary);
  color: #ffffff;
}
</style>
