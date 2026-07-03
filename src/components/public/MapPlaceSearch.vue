<script setup lang="ts">
// MapPlaceSearch
// --------------
// Rounded, blurred search card that floats top-center over the Map Explorer
// during the in-map "Add Venue" flow. Debounced live Google Places
// Autocomplete; picking a prediction emits `select(placeId)` so the host
// can fetch details + drop a candidate pin.

import { onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from '../AppIcon.vue'
import googleG from '../../assets/google-g.svg'
import { searchPlacePredictions } from '../../api/placesLookup'
import type { GeoPosition, PlacePrediction } from '../../types'

const props = withDefaults(defineProps<{
  placeholder?: string
  /** Soft autocomplete location bias (event area). */
  biasCenter?: GeoPosition
}>(), {
  placeholder: 'Find a place'
})

const emit = defineEmits<{ (event: 'select', placeId: string, isEstablishment: boolean): void }>()

const query = ref('')
const predictions = ref<PlacePrediction[]>([])
const searching = ref(false)
const open = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let searchSeq = 0

function runSearch() {
  const seq = ++searchSeq
  const q = query.value.trim()
  if (q.length < 2) {
    predictions.value = []
    searching.value = false
    return
  }
  searching.value = true
  void searchPlacePredictions(q, { biasCenter: props.biasCenter }).then((rows) => {
    if (seq !== searchSeq) return
    predictions.value = rows
    searching.value = false
  })
}

function onInput() {
  open.value = true
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(runSearch, 250)
}

function pick(p: PlacePrediction) {
  query.value = p.primaryText
  open.value = false
  predictions.value = []
  emit('select', p.placeId, p.isEstablishment)
}

onMounted(() => {
  // Drop the cursor straight into the field so the admin can type immediately.
  inputRef.value?.focus()
})

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
})
</script>

<template>
  <div class="mapx-search">
    <div class="mapx-search__box">
      <span class="mapx-search__icon" aria-hidden="true"><AppIcon name="search" :size="18" /></span>
      <input
        ref="inputRef"
        v-model="query"
        type="text"
        class="mapx-search__input"
        :placeholder="placeholder"
        autocomplete="off"
        @input="onInput"
        @focus="open = true"
      />
      <img class="mapx-search__google" :src="googleG" alt="" aria-hidden="true" />
    </div>
    <ul v-if="open && (searching || query.trim().length >= 2)" class="mapx-search__list">
      <li v-if="searching" class="mapx-search__row mapx-search__row--muted">Searching…</li>
      <li v-else-if="predictions.length === 0" class="mapx-search__row mapx-search__row--muted">No matches found.</li>
      <li
        v-for="p in predictions"
        v-else
        :key="p.placeId"
        class="mapx-search__row"
        @mousedown.prevent="pick(p)"
      >
        <span class="mapx-search__row-name">{{ p.primaryText }}</span>
        <span v-if="p.secondaryText" class="mapx-search__row-sub">{{ p.secondaryText }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.mapx-search {
  width: min(520px, calc(100% - 32px));
}
.mapx-search__box {
  position: relative;
  display: flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid var(--border-divider);
  border-radius: 999px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
}
html.dark-mode .mapx-search__box { background: rgba(26, 34, 48, 0.92); }
.mapx-search__icon {
  display: inline-flex;
  align-items: center;
  padding-left: 16px;
  color: var(--secondary);
  pointer-events: none;
}
.mapx-search__input {
  flex: 1 1 auto;
  min-width: 0;
  border: 0;
  background: transparent;
  padding: 13px 18px 13px 10px;
  font-family: inherit;
  font-size: 14px;
  color: var(--text);
  outline: none;
}
.mapx-search__input::placeholder { color: var(--secondary); }
/* Google "powered by" mark pinned to the right of the field. */
.mapx-search__google {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  margin-right: 16px;
  pointer-events: none;
}
.mapx-search__list {
  list-style: none;
  margin: 8px 0 0;
  padding: 6px;
  max-height: 280px;
  overflow-y: auto;
  background: var(--surface-card, #fff);
  border: 1px solid var(--border-divider);
  border-radius: 14px;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.22);
}
html.dark-mode .mapx-search__list { background: #1a2230; }
.mapx-search__row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 9px 12px;
  border-radius: 9px;
  cursor: pointer;
}
.mapx-search__row:hover { background: rgba(45, 140, 240, 0.08); }
.mapx-search__row--muted { color: var(--secondary); font-size: 13px; cursor: default; }
.mapx-search__row--muted:hover { background: none; }
.mapx-search__row-name { font-size: 13.5px; font-weight: 600; color: var(--text); }
.mapx-search__row-sub { font-size: 12px; color: var(--secondary); }
</style>
