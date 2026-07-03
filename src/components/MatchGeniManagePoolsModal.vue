<script setup lang="ts">
// MatchGeniManagePoolsModal
// -------------------------
// Drag-and-drop pool builder for a division, opened from the division
// page's "Manage Team Pools" action. Layout (left → right):
//
//   [ Available ] [ Pool A ] [ Pool B ] … [ + Add pool ]
//
//   - Available  — every eligible team for the division (event joined
//                  teams filtered by the division's age-group / rating)
//                  that isn't placed in a pool yet. Sticky-left so it
//                  stays put while the pools scroll horizontally.
//   - Pools      — a default pool exists; more can be added. Pools can
//                  be renamed; non-default pools can be removed (their
//                  teams return to Available).
//
// Teams drag between Available and any pool, and between pools, dropping
// at a precise index. Serial numbers re-derive on every change and honor
// the division's "maintain continuous serial numbering" setting:
//   - continuous  → serials run unbroken across pools (Pool A 1..n,
//                   Pool B continues n+1…)
//   - per-pool    → each pool restarts at 1.
//
// v1 reads/writes mock data (see `src/api/matchGeniPools.ts`); the typed
// shapes match the future GET/PUT pool endpoints.

import { computed, nextTick, ref, watch } from 'vue'
import SlideModal from './SlideModal.vue'
import AppIcon from './AppIcon.vue'
import { fetchDivisionPools, saveDivisionPools } from '../api/matchGeniPools'
import type { DivisionPool, ManagePoolTeam } from '../types'

const props = withDefaults(defineProps<{
  modelValue: boolean
  associationId: string
  eventId: string
  divisionId: string
  divisionName?: string
  /** Division's continuous-serial setting (defaults true when unknown). */
  continuousSerial?: boolean
}>(), {
  divisionName: '',
  continuousSerial: true
})

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'saved'): void
}>()

// ── Working copy ─────────────────────────────────────────────────
const loading = ref(false)
const saving = ref(false)
const errorMessage = ref('')
const available = ref<ManagePoolTeam[]>([])
const pools = ref<DivisionPool[]>([])
const continuous = ref(true)
const restrictTeams = ref(false)
const ageGroups = ref<string[]>([])
const ratings = ref<string[]>([])
const search = ref('')
let loadToken = 0
let newPoolSeq = 0

/** Eligibility line under the title: the division's allowed ages /
 *  ratings when restricted, otherwise "all ages / ratings". */
const eligibilityText = computed(() => {
  if (!restrictTeams.value || (ageGroups.value.length === 0 && ratings.value.length === 0)) {
    return 'All ages and ratings allowed'
  }
  // "<ages, comma-separated> — <ratings, comma-separated>"
  // e.g. "40+, 50+, 55+ — AA, AAA". Drop the dash side when one set is
  // empty so it never reads "40+ — " or " — AA".
  const ages = ageGroups.value.join(', ')
  const rates = ratings.value.join(', ')
  if (ages && rates) return `${ages} — ${rates}`
  return ages || rates
})

const filteredAvailable = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return available.value
  return available.value.filter((t) => t.name.toLowerCase().includes(q))
})

// Serial offset per pool: cumulative team count of earlier pools when
// continuous, otherwise 0 (each pool restarts at 1).
const poolSerialOffsets = computed<number[]>(() => {
  const offsets: number[] = []
  let running = 0
  for (const p of pools.value) {
    offsets.push(continuous.value ? running : 0)
    running += p.teams.length
  }
  return offsets
})
function serialFor(poolIndex: number, teamIndex: number): number {
  return (poolSerialOffsets.value[poolIndex] ?? 0) + teamIndex + 1
}

// ── Load on open ─────────────────────────────────────────────────
async function load() {
  if (!props.divisionId) return
  const token = ++loadToken
  loading.value = true
  errorMessage.value = ''
  try {
    const data = await fetchDivisionPools(
      props.associationId,
      props.eventId,
      props.divisionId,
      props.continuousSerial
    )
    if (token !== loadToken) return
    available.value = data.available
    pools.value = data.pools.length > 0
      ? data.pools
      : [{ id: `${props.divisionId}-pool-default`, name: 'Pool A', isDefault: true, teams: [] }]
    continuous.value = data.continuousSerial
    restrictTeams.value = data.restrictTeams
    ageGroups.value = data.ageGroups
    ratings.value = data.ratings
  } catch (err) {
    if (token !== loadToken) return
    errorMessage.value = err instanceof Error ? err.message : 'Could not load teams.'
  } finally {
    if (token === loadToken) loading.value = false
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      search.value = ''
      newPoolSeq = 0
      load()
    }
  },
  { immediate: true }
)

// ── Drag & drop ──────────────────────────────────────────────────
// `source`/`target` keys: 'available' or a pool id. `dropIndex` tracks
// the insertion point within the hovered list.
const dragTeamId = ref<string | null>(null)
const dragSource = ref<string | null>(null)
const dropTarget = ref<string | null>(null)
const dropIndex = ref<number | null>(null)

function listForKey(key: string): ManagePoolTeam[] | null {
  if (key === 'available') return available.value
  return pools.value.find((p) => p.id === key)?.teams ?? null
}

function onTeamDragStart(event: DragEvent, teamId: string, source: string) {
  dragTeamId.value = teamId
  dragSource.value = source
  dropTarget.value = null
  dropIndex.value = null
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', teamId)
  }
}
function onTeamDragEnd() {
  dragTeamId.value = null
  dragSource.value = null
  dropTarget.value = null
  dropIndex.value = null
}
/** Hovering a team row — insert before/after based on cursor half. */
function onItemDragOver(event: DragEvent, key: string, index: number) {
  if (!dragTeamId.value) return
  event.preventDefault()
  const el = event.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  const after = event.clientY - rect.top > rect.height / 2
  dropTarget.value = key
  dropIndex.value = after ? index + 1 : index
}
/** Hovering a column's empty space — append. */
function onColumnDragOver(event: DragEvent, key: string) {
  if (!dragTeamId.value) return
  event.preventDefault()
  if (dropTarget.value !== key) {
    dropTarget.value = key
    dropIndex.value = listForKey(key)?.length ?? 0
  }
}
function onDrop(event: DragEvent, key: string) {
  if (!dragTeamId.value) return
  event.preventDefault()
  const id = dragTeamId.value
  const sourceList = dragSource.value ? listForKey(dragSource.value) : null
  const targetList = listForKey(key)
  if (!sourceList || !targetList) { onTeamDragEnd(); return }
  const from = sourceList.findIndex((t) => t.id === id)
  if (from === -1) { onTeamDragEnd(); return }
  let to = dropIndex.value ?? targetList.length
  const [team] = sourceList.splice(from, 1)
  // Same list: removing an earlier item shifts the target left by one.
  if (sourceList === targetList && from < to) to -= 1
  to = Math.max(0, Math.min(to, targetList.length))
  targetList.splice(to, 0, team)
  onTeamDragEnd()
}

// ── Pool management ──────────────────────────────────────────────
function nextPoolName(): string {
  // "Pool A", "Pool B" … then "Pool 27"+ once letters run out.
  const n = pools.value.length
  if (n < 26) return `Pool ${String.fromCharCode(65 + n)}`
  return `Pool ${n + 1}`
}
function addPool() {
  pools.value.push({
    id: `new-${++newPoolSeq}`,
    name: nextPoolName(),
    teams: []
  })
}
function removePool(poolId: string) {
  const idx = pools.value.findIndex((p) => p.id === poolId)
  if (idx === -1) return
  const pool = pools.value[idx]
  if (pool.isDefault) return
  // Spill the pool's teams back to Available, then drop the column.
  available.value.push(...pool.teams)
  pools.value.splice(idx, 1)
}

// Inline rename
const editingPoolId = ref<string | null>(null)
const editingName = ref('')
const renameInputRef = ref<HTMLInputElement | null>(null)
function startRename(pool: DivisionPool) {
  editingPoolId.value = pool.id
  editingName.value = pool.name
  void nextTick(() => {
    renameInputRef.value?.focus()
    renameInputRef.value?.select()
  })
}
function commitRename() {
  const pool = pools.value.find((p) => p.id === editingPoolId.value)
  if (pool) {
    const name = editingName.value.trim()
    if (name) pool.name = name
  }
  editingPoolId.value = null
  editingName.value = ''
}
function cancelRename() {
  editingPoolId.value = null
  editingName.value = ''
}

// ── Save / close ─────────────────────────────────────────────────
function close() {
  if (saving.value) return
  emit('update:modelValue', false)
}
async function save() {
  if (saving.value) return
  saving.value = true
  errorMessage.value = ''
  try {
    await saveDivisionPools(props.associationId, props.eventId, props.divisionId, {
      available: available.value,
      pools: pools.value,
      continuousSerial: continuous.value,
      restrictTeams: restrictTeams.value,
      ageGroups: ageGroups.value,
      ratings: ratings.value
    })
    emit('saved')
    emit('update:modelValue', false)
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : 'Could not save pools. Please try again.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <SlideModal
    :model-value="modelValue"
    title="Manage Team Pools"
    :eyebrow="divisionName"
    size="full"
    @update:modelValue="emit('update:modelValue', $event)"
  >
    <div class="mg-pools">
      <div v-if="loading" class="mg-pools__state">Loading teams…</div>
      <div v-else-if="errorMessage" class="mg-pools__state mg-pools__state--error">
        {{ errorMessage }}
        <button type="button" class="mg-pools__retry" @click="load">Retry</button>
      </div>

      <!-- Board — Available (sticky-left) + pool columns + Add pool. -->
      <div v-else class="mg-pools__board">
        <!-- Available column -->
        <section
          class="mg-pools__col mg-pools__col--available"
          :class="{ 'mg-pools__col--drop': dropTarget === 'available' }"
          @dragover="onColumnDragOver($event, 'available')"
          @drop="onDrop($event, 'available')"
        >
          <header class="mg-pools__col-head">
            <div class="mg-pools__col-title">
              <span class="mg-pools__col-name">Available</span>
              <span class="mg-pools__col-count">{{ filteredAvailable.length }}</span>
            </div>
          </header>
          <label class="mg-pools__search">
            <AppIcon name="search" :size="14" />
            <input v-model="search" type="search" placeholder="Search teams" class="mg-pools__search-input" />
          </label>
          <div class="mg-pools__col-body">
            <article
              v-for="(team, i) in filteredAvailable"
              :key="team.id"
              class="mg-pools__team"
              :class="{ 'mg-pools__team--dragging': dragTeamId === team.id }"
              draggable="true"
              @dragstart="onTeamDragStart($event, team.id, 'available')"
              @dragend="onTeamDragEnd"
            >
              <span class="mg-pools__grip" aria-hidden="true"></span>
              <span class="mg-pools__team-text">
                <span class="mg-pools__team-name">{{ team.name }}</span>
                <span v-if="team.meta" class="mg-pools__team-meta">{{ team.meta }}</span>
              </span>
            </article>
            <p v-if="filteredAvailable.length === 0" class="mg-pools__col-empty">
              {{ search.trim() ? 'No teams match.' : 'All teams assigned.' }}
            </p>
          </div>
        </section>

        <!-- Pool columns -->
        <section
          v-for="(pool, pi) in pools"
          :key="pool.id"
          class="mg-pools__col mg-pools__col--pool"
          :class="{ 'mg-pools__col--drop': dropTarget === pool.id }"
          @dragover="onColumnDragOver($event, pool.id)"
          @drop="onDrop($event, pool.id)"
        >
          <header class="mg-pools__col-head">
            <div v-if="editingPoolId === pool.id" class="mg-pools__rename">
              <input
                ref="renameInputRef"
                v-model="editingName"
                class="mg-pools__rename-input"
                maxlength="40"
                @keydown.enter.prevent="commitRename"
                @keydown.esc.prevent="cancelRename"
                @blur="commitRename"
              />
            </div>
            <div v-else class="mg-pools__col-title">
              <span class="mg-pools__col-name">{{ pool.name }}</span>
              <span class="mg-pools__col-count">{{ pool.teams.length }}</span>
              <span v-if="pool.isDefault" class="mg-pools__col-tag">Default</span>
            </div>
            <div class="mg-pools__col-actions">
              <button
                type="button"
                class="mg-pools__icon-btn"
                aria-label="Rename pool"
                @click="startRename(pool)"
              >
                <span class="mg-pools__glyph mg-pools__glyph--edit" aria-hidden="true"></span>
              </button>
              <button
                v-if="!pool.isDefault"
                type="button"
                class="mg-pools__icon-btn mg-pools__icon-btn--danger"
                aria-label="Remove pool"
                @click="removePool(pool.id)"
              >
                <span class="mg-pools__glyph mg-pools__glyph--delete" aria-hidden="true"></span>
              </button>
            </div>
          </header>
          <div class="mg-pools__col-body">
            <article
              v-for="(team, i) in pool.teams"
              :key="team.id"
              class="mg-pools__team mg-pools__team--pooled"
              :class="{
                'mg-pools__team--dragging': dragTeamId === team.id,
                'mg-pools__team--drop-before': dropTarget === pool.id && dropIndex === i,
                'mg-pools__team--drop-after': dropTarget === pool.id && dropIndex === i + 1 && i === pool.teams.length - 1
              }"
              draggable="true"
              @dragstart="onTeamDragStart($event, team.id, pool.id)"
              @dragend="onTeamDragEnd"
              @dragover="onItemDragOver($event, pool.id, i)"
              @drop="onDrop($event, pool.id)"
            >
              <span class="mg-pools__grip" aria-hidden="true"></span>
              <span class="mg-pools__team-serial">{{ serialFor(pi, i) }}.</span>
              <span class="mg-pools__team-text">
                <span class="mg-pools__team-name">{{ team.name }}</span>
                <span v-if="team.meta" class="mg-pools__team-meta">{{ team.meta }}</span>
              </span>
            </article>
            <p v-if="pool.teams.length === 0" class="mg-pools__col-empty mg-pools__col-empty--drop">
              Drag teams here
            </p>
          </div>
        </section>

        <!-- Add pool -->
        <button type="button" class="mg-pools__add-col" @click="addPool">
          <span class="mg-pools__add-col-plus" aria-hidden="true">+</span>
          Add Team Pool
        </button>
      </div>
    </div>

    <template #footer>
      <div class="mg-pools__footer">
        <div class="mg-pools__footer-info">
          <span v-if="!loading" class="mg-pools__eligibility">
            Allowed age/rating : {{ eligibilityText }}
          </span>
          <span class="mg-pools__serial-note" :class="{ 'mg-pools__serial-note--on': continuous }">
            <span class="mg-pools__serial-dot" aria-hidden="true"></span>
            {{ continuous ? 'Continuous serial numbering across pools' : 'Serial numbering restarts per pool' }}
          </span>
        </div>
        <span class="mg-pools__footer-spacer"></span>
        <button type="button" class="secondary-button" :disabled="saving" @click="close">Cancel</button>
        <button type="button" class="primary-button" :disabled="saving || loading" @click="save">
          <span v-if="saving" class="btn-spinner" aria-hidden="true"></span>
          {{ saving ? 'Saving…' : 'Save pools' }}
        </button>
      </div>
    </template>
  </SlideModal>
</template>

<style scoped>
.mg-pools {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  min-height: 0;
}

/* Eligibility line — sits in the footer above the serial-mode note. */
.mg-pools__eligibility {
  font-size: 13px;
  color: var(--secondary);
  line-height: 1.4;
}

/* Serial-mode note — sits in the modal footer, flush-left. */
.mg-pools__serial-note {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--secondary);
}
.mg-pools__serial-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--secondary);
}
.mg-pools__serial-note--on .mg-pools__serial-dot {
  background: var(--success, #22a06b);
}

.mg-pools__state {
  padding: 40px 16px;
  text-align: center;
  color: var(--secondary);
}
.mg-pools__state--error { color: var(--highlight, #d64545); }
.mg-pools__retry {
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

/* Board — horizontal rail of columns. */
.mg-pools__board {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: stretch;
  gap: 14px;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 6px;
}

.mg-pools__col {
  flex: 0 0 300px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  /* Pool columns carry a clear opaque tint so they read distinct from
     the white Available column — same two-tone relationship in light
     and dark. (`--surface-muted` is a near-white translucent token in
     light mode, which blended into the modal body, so use an explicit
     grey here.) */
  background: #eef2f7;
  border: 1px solid var(--border-divider);
  border-radius: 10px;
  overflow: hidden;
  transition: border-color 120ms ease, background-color 120ms ease;
}
html.dark-mode .mg-pools__col {
  background: rgba(255, 255, 255, 0.03);
}
/* Available stays pinned to the left as the pools scroll, and uses the
   translucent card surface so it gets the same frosted/transparency
   treatment in light mode that it already had in dark (the
   `--surface-card` token is a semi-opaque surface in both themes). */
.mg-pools__col--available {
  position: sticky;
  left: 0;
  z-index: 2;
  background: var(--surface-card);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
}
/* Active drop target highlight. */
.mg-pools__col--drop {
  border-color: var(--primary);
  background: var(--primary-light-3, #e5f1ff);
}
html.dark-mode .mg-pools__col--drop {
  background: rgba(45, 140, 240, 0.12);
}

.mg-pools__col-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-divider);
}
.mg-pools__col-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.mg-pools__col-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Count chip — bordered neutral badge (the portal's standard chip)
   so it stays legible on both the white Available column and the
   tinted pool columns regardless of theme. */
.mg-pools__col-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--white);
  border: 1px solid var(--border-divider);
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
}
html.dark-mode .mg-pools__col-count {
  background: rgba(255, 255, 255, 0.08);
  border-color: var(--border-divider);
}
.mg-pools__col-tag {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--primary);
  background: var(--primary-light-3, #e5f1ff);
  padding: 2px 6px;
  border-radius: 4px;
}
html.dark-mode .mg-pools__col-tag {
  background: rgba(45, 140, 240, 0.16);
}
.mg-pools__col-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
}
.mg-pools__icon-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--secondary);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}
.mg-pools__icon-btn:hover {
  background: var(--surface-card-hover, rgba(45, 140, 240, 0.08));
  color: var(--text);
}
.mg-pools__icon-btn--danger:hover {
  color: var(--highlight, #d64545);
}
/* Masked glyphs — edit / delete SVGs tinted via the button's
   currentColor so they theme in light + dark. */
.mg-pools__glyph {
  display: inline-block;
  width: 15px;
  height: 15px;
  background-color: currentColor;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}
.mg-pools__glyph--edit {
  -webkit-mask-image: url('../assets/edit.svg');
  mask-image: url('../assets/edit.svg');
}
.mg-pools__glyph--delete {
  -webkit-mask-image: url('../assets/delete.svg');
  mask-image: url('../assets/delete.svg');
}

.mg-pools__rename { flex: 1 1 auto; }
.mg-pools__rename-input {
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--primary);
  border-radius: 6px;
  background: var(--white);
  color: var(--text);
  font-size: 14px;
  font-weight: 600;
  outline: none;
}
html.dark-mode .mg-pools__rename-input {
  background: var(--surface-card);
}

/* Search (Available only) */
.mg-pools__search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 10px 0;
  padding: 0 10px;
  height: 32px;
  border-radius: 6px;
  border: 1px solid var(--border-divider);
  background: var(--white);
  color: var(--secondary);
}
html.dark-mode .mg-pools__search {
  background: rgba(255, 255, 255, 0.04);
}
.mg-pools__search-input {
  flex: 1 1 auto;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font: inherit;
  color: var(--text);
}

.mg-pools__col-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
}

/* Team card */
.mg-pools__team {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 10px;
  border-radius: 8px;
  background: var(--white);
  border: 1px solid var(--border-divider);
  cursor: grab;
  user-select: none;
}
html.dark-mode .mg-pools__team {
  background: var(--surface-card);
}
.mg-pools__team:active { cursor: grabbing; }
.mg-pools__team--dragging { opacity: 0.45; }
/* Insertion line shown at the drop position — same treatment as the
   seed-criteria step: a 2px primary line sitting in the gap between
   cards (before the targeted row, or after the last row). */
.mg-pools__team--drop-before::before,
.mg-pools__team--drop-after::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--primary);
  border-radius: 2px;
}
.mg-pools__team--drop-before::before { top: -5px; }
.mg-pools__team--drop-after::after { bottom: -5px; }
/* Order counter — same plain "N." treatment as the seed-criteria
   step (secondary tint, 600 weight, no pill). */
.mg-pools__team-serial {
  flex: 0 0 auto;
  color: var(--secondary);
  font-weight: 600;
  font-size: 13px;
}
/* Drag handle — same dotted grip the seed-criteria step uses. */
.mg-pools__grip {
  flex: 0 0 auto;
  width: 10px;
  height: 16px;
  background-image: radial-gradient(currentColor 1px, transparent 1.5px);
  background-size: 5px 5px;
  background-position: 0 2px;
  color: var(--secondary);
  opacity: 0.7;
}
.mg-pools__team-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.mg-pools__team-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mg-pools__team-meta {
  font-size: 12px;
  color: var(--secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mg-pools__col-empty {
  margin: 0;
  padding: 18px 8px;
  text-align: center;
  font-size: 12px;
  color: var(--secondary);
}
.mg-pools__col-empty--drop {
  border: 1px dashed var(--border-divider);
  border-radius: 8px;
}

/* Add-pool column */
.mg-pools__add-col {
  flex: 0 0 300px;
  align-self: stretch;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px dashed var(--border-divider);
  border-radius: 10px;
  background: transparent;
  color: var(--secondary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 120ms ease, color 120ms ease, background-color 120ms ease;
}
.mg-pools__add-col:hover {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-light-3, #e5f1ff);
}
html.dark-mode .mg-pools__add-col:hover {
  background: rgba(45, 140, 240, 0.10);
}
.mg-pools__add-col-plus {
  font-size: 22px;
  line-height: 1;
}

/* Footer */
.mg-pools__footer {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}
/* Stacked info block — eligibility on top, serial-mode note below. */
.mg-pools__footer-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
/* Spacer pushes the action buttons to the right, leaving the
   info block flush-left. */
.mg-pools__footer-spacer {
  flex: 1 1 auto;
}

@media (max-width: 720px) {
  .mg-pools__col,
  .mg-pools__col--available,
  .mg-pools__add-col { flex-basis: 240px; }
  .mg-pools__col--available { position: static; }
}
</style>
