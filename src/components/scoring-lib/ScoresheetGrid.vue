<template>
  <div ref="gridRoot" :class="['scoresheet-grid-root', !canEdit && 'scoresheet-grid-root--readonly', inningWindowSize === 1 && 'scoresheet-grid-root--narrow']">
    <!-- Header row: title slot on the left, inning pager on the right -->
    <div v-if="$slots.title || showInningPager" class="scoresheet-grid-header">
      <slot name="title" />
      <div v-if="showInningPager" class="sheet-inning-pager" aria-label="Inning navigation">
        <button
          type="button"
          class="sheet-inning-pager__button"
          :disabled="!canPageBackward"
          @click="pageBackward"
        >
          Previous
        </button>
        <span class="sheet-inning-pager__label">
          Innings {{ visibleInnings[0] }}&ndash;{{ visibleInnings[visibleInnings.length - 1] }} of {{ totalInnings }}
        </span>
        <button
          v-if="canJumpToCurrent"
          type="button"
          class="sheet-inning-pager__button sheet-inning-pager__button--current"
          @click="goToCurrentInning"
        >
          Current
        </button>
        <button
          type="button"
          class="sheet-inning-pager__button"
          :disabled="!canPageForward"
          @click="pageForward"
        >
          Next
        </button>
      </div>
    </div>
    <div class="scoresheet-grid w-full overflow-x-auto rounded-lg shadow-md">
      <table
        class="sheet-table w-full border-collapse text-xs select-none"
        :style="{ '--visible-innings': visibleInnings.length }"
      >
        <thead>
          <tr>
            <th class="sheet-th-player text-left pl-3 w-8">#</th>
            <th class="sheet-th-player text-left pl-2 min-w-[148px]">Player</th>
            <th
              v-for="inning in visibleInnings"
              :key="inning"
              :class="[
                'sheet-th-inning w-14 text-center relative',
                inning === currentInning && 'sheet-th-inning--active',
              ]"
            >
              {{ inning }}
              <span
                v-if="inning === currentInning && isLive"
                class="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"
              />
            </th>
            <th
              v-for="stat in statColumns"
              :key="stat.key"
              :class="['sheet-th-stat w-8 text-center', stat.class]"
            >
              {{ stat.key }}
            </th>
          </tr>
          <tr class="sheet-totals-row">
            <th colspan="2" class="sheet-td-total sheet-td-total--label text-left pl-3 font-bold text-white text-[11px]">
              Totals
            </th>
            <th
              v-for="inning in visibleInnings"
              :key="`head-total-${inning}`"
              :class="[
                'sheet-td-total text-center font-bold text-white',
                inning === currentInning && 'sheet-td-total--active',
              ]"
            >
              {{ inningTotal(inning) || '-' }}
            </th>
            <th
              v-for="stat in statColumns"
              :key="`head-stat-total-${stat.key}`"
              :class="['sheet-td-total sheet-td-total--stat text-center font-bold', stat.totalClass]"
            >
              {{ teamTotal(stat.key) || '' }}
            </th>
          </tr>
        </thead>

        <tbody>
          <tr
            v-for="(player, idx) in players"
            :key="player.id"
            :class="['sheet-row', idx % 2 === 0 ? 'sheet-row--even' : 'sheet-row--odd']"
          >
            <td class="sheet-td text-center text-gray-500 font-medium">
              {{ player.batting_order }}
            </td>
            <td class="sheet-td pl-2">
              <div class="sheet-player-identity">
                <div class="sheet-player-jersey">
                  <img :src="jerseyIcon" alt="" class="sheet-player-jersey__icon" />
                  <span class="sheet-player-jersey__number">{{ displayJersey(player.player_note) }}</span>
                </div>
                <div class="sheet-player-copy">
                  <p class="sheet-player-name">{{ player.player_name }}</p>
                  <div class="sheet-player-meta">
                    <span v-if="player.position_code" class="sheet-player-pos">{{ player.position_code }}</span>
                    <p v-if="battingAverage(player.id) !== null" class="sheet-player-average">
                      {{ battingAverage(player.id) }}
                    </p>
                  </div>
                </div>
              </div>
              <p v-if="player.substitute_name" class="sheet-player-substitute">
                Sub: {{ player.substitute_name }}
                <span v-if="player.substitute_note">{{ player.substitute_note }}</span>
              </p>
            </td>
            <td
              v-for="inning in visibleInnings"
              :key="inning"
              :class="[
                'sheet-td-cell',
                player.substitute_inning && inning >= player.substitute_inning && 'sheet-cell--subbed',
                inning === currentInning && 'sheet-cell--active',
              ]"
            >
              <div class="sheet-cell-stack" :aria-label="`${player.player_name}, inning ${inning}`">
                <ScoresheetDiamond
                  v-for="(pa, paIdx) in appearancesFor(player, inning)"
                  :key="paIdx"
                  :result-code="pa.result_code"
                :rbi="pa.rbi"
                :sport-type-id="sportTypeId"
                :is-active="inning === currentInning"
                :size="58"
                class="sheet-cell-diamond"
                @click.native.stop="canEdit && openAppearanceModal(player, inning, pa)"
              />
                <ScoresheetDiamond
                  v-if="appearancesFor(player, inning).length === 0"
                  :result-code="null"
                  :sport-type-id="sportTypeId"
                  :is-active="inning === currentInning"
                  :size="58"
                  :class="[
                    'sheet-cell-diamond',
                    canEdit ? 'sheet-cell-diamond--editable' : 'sheet-cell-diamond--placeholder',
                  ]"
                  @click.native.stop="canEdit && openAppearanceModal(player, inning)"
                />
              </div>
            </td>
            <td
              v-for="stat in statColumns"
              :key="stat.key"
              :class="['sheet-td-stat text-center font-semibold', stat.valueClass]"
            >
              {{ playerStat(player.id, stat.key) }}
            </td>
          </tr>

          <tr
            v-for="n in emptyRows"
            :key="`empty-${n}`"
            class="sheet-row sheet-row--empty"
          >
            <td class="sheet-td text-gray-300 text-center">{{ players.length + n }}</td>
            <td class="sheet-td" />
            <td v-for="inning in visibleInnings" :key="inning" class="sheet-td-cell">
              <div class="sheet-cell-stack">
                <ScoresheetDiamond
                  :result-code="null"
                  :sport-type-id="sportTypeId"
                  :size="58"
                  class="sheet-cell-diamond sheet-cell-diamond--empty-row"
                />
              </div>
            </td>
            <td v-for="stat in statColumns" :key="stat.key" class="sheet-td-stat" />
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ScoresheetDiamond from './ScoresheetDiamond.vue'
import jerseyIcon from '../../assets/jersy.svg'

const props = defineProps({
  players: {
    type: Array,
    default: () => [],
  },
  appearances: {
    type: Array,
    default: () => [],
  },
  battingStats: {
    type: Array,
    default: () => [],
  },
  totalInnings: {
    type: Number,
    default: 7,
  },
  currentInning: {
    type: Number,
    default: null,
  },
  isLive: {
    type: Boolean,
    default: false,
  },
  sportTypeId: {
    type: Number,
    required: true,
  },
  gameVariant: {
    type: String,
    default: null,
  },
  canEdit: {
    type: Boolean,
    default: false,
  },
  minRosterRows: {
    type: Number,
    default: 9,
  },
  saving: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['open-appearance'])
const gridRoot = ref(null)
const gridWidth = ref(typeof window === 'undefined' ? 1280 : window.innerWidth)
const inningWindowStart = ref(1)
let resizeObserver = null

const statColumns = [
  { key: 'AB', class: 'text-white', valueClass: 'text-gray-700', totalClass: 'text-white' },
  { key: 'R', class: 'text-white', valueClass: 'text-gray-700', totalClass: 'text-white' },
  { key: 'H', class: 'text-white', valueClass: 'text-gray-700', totalClass: 'text-white' },
  { key: 'RBI', class: 'text-yellow-300', valueClass: 'text-yellow-700', totalClass: 'text-yellow-300' },
  { key: 'SB', class: 'text-yellow-300', valueClass: 'text-yellow-700', totalClass: 'text-yellow-300' },
  { key: 'BB', class: 'text-yellow-300', valueClass: 'text-yellow-700', totalClass: 'text-yellow-300' },
  { key: 'K', class: 'text-red-300', valueClass: 'text-red-700', totalClass: 'text-red-300' },
]

const inningWindowSize = computed(() => {
  if (gridWidth.value >= 1280) return 9
  if (gridWidth.value >= 900) return 6
  if (gridWidth.value >= 600) return 4
  return 1
})

const maxInningWindowStart = computed(() => {
  const total = Math.max(1, props.totalInnings)
  const size = Math.max(1, inningWindowSize.value)
  return Math.floor((total - 1) / size) * size + 1
})

const visibleInnings = computed(() => {
  const start = Math.min(inningWindowStart.value, maxInningWindowStart.value)
  const end = Math.min(props.totalInnings, start + inningWindowSize.value - 1)
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index)
})

const showInningPager = computed(() => props.totalInnings > inningWindowSize.value)
const canPageBackward = computed(() => inningWindowStart.value > 1)
const canPageForward = computed(() => inningWindowStart.value < maxInningWindowStart.value)
const canJumpToCurrent = computed(() =>
  Number.isFinite(props.currentInning) &&
  props.currentInning >= 1 &&
  props.currentInning <= props.totalInnings &&
  !visibleInnings.value.includes(props.currentInning)
)

function windowStartForInning(inning) {
  if (!Number.isFinite(inning) || inning < 1) return 1
  const size = Math.max(1, inningWindowSize.value)
  const start = Math.floor((inning - 1) / size) * size + 1
  return Math.min(Math.max(1, start), maxInningWindowStart.value)
}

function pageBackward() {
  inningWindowStart.value = Math.max(1, inningWindowStart.value - inningWindowSize.value)
}

function pageForward() {
  inningWindowStart.value = Math.min(maxInningWindowStart.value, inningWindowStart.value + inningWindowSize.value)
}

function goToCurrentInning() {
  inningWindowStart.value = windowStartForInning(props.currentInning)
}

watch(
  () => [props.currentInning, props.totalInnings, inningWindowSize.value],
  () => {
    if (Number.isFinite(props.currentInning) && props.currentInning >= 1) {
      inningWindowStart.value = windowStartForInning(props.currentInning)
    } else {
      inningWindowStart.value = Math.min(inningWindowStart.value, maxInningWindowStart.value)
    }
  },
  { immediate: true }
)

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined' && gridRoot.value) {
    resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width
      if (width) gridWidth.value = width
    })
    resizeObserver.observe(gridRoot.value)
    gridWidth.value = gridRoot.value.clientWidth || gridWidth.value
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
})


const appearanceIndex = computed(() => {
  const map = {}
  for (const pa of props.appearances) {
    const pid = pa.game_lineup_player_id
    const inn = pa.inning_number
    if (!map[pid]) map[pid] = {}
    if (!map[pid][inn]) map[pid][inn] = []
    map[pid][inn].push(pa)
  }
  return map
})

// When a starter has been subbed out, innings >= substitute_inning belong to
// the sub. Returns { id, player_name, jersey_number, position_code } for the
// player who owns the given inning on this row.
function effectiveIdentityFor(player, inning) {
  if (
    player &&
    player.substitute_id != null &&
    player.substitute_inning != null &&
    inning >= player.substitute_inning
  ) {
    return {
      id: player.substitute_id,
      player_name: player.substitute_player_name ?? player.player_name,
      jersey_number: player.substitute_jersey_number ?? player.player_note ?? '',
      position_code: player.substitute_position_code ?? player.position_code ?? null,
    }
  }
  return {
    id: player.id,
    player_name: player.player_name,
    jersey_number: player.player_note ?? '',
    position_code: player.position_code ?? null,
  }
}

function appearancesFor(player, inning) {
  // Back-compat: some existing call sites pass the row.id (a number). When the
  // full player object is passed, resolve per inning so post-sub innings look
  // up under the sub's id; pre-sub innings stay on the starter's.
  if (typeof player === 'number' || typeof player === 'string') {
    return appearanceIndex.value[player]?.[inning] ?? []
  }
  const effectiveId = effectiveIdentityFor(player, inning).id
  return appearanceIndex.value[effectiveId]?.[inning] ?? []
}

const statsIndex = computed(() => {
  const map = {}
  for (const s of props.battingStats) {
    map[s.game_lineup_player_id] = s
  }
  return map
})

const STAT_KEYS = {
  AB: 'at_bats',
  R: 'runs',
  H: 'hits',
  RBI: 'rbi',
  SB: 'stolen_bases',
  BB: 'walks',
  K: 'strikeouts',
}

function playerStat(playerId, key) {
  const dbKey = STAT_KEYS[key]
  const val = statsIndex.value[playerId]?.[dbKey]
  return val !== undefined && val !== null && val !== 0 ? val : '-'
}

// Render a dash inside the jersey chip when the number is missing, so the
// jersey icon is always visible — empty/null numbers no longer hide the chip.
function displayJersey(value) {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || '-'
}

function battingAverage(playerId) {
  const s = statsIndex.value[playerId]
  if (!s || !s.at_bats) return null
  return (s.hits / s.at_bats).toFixed(3).replace(/^0/, '')
}

function inningTotal(inning) {
  return props.players.reduce((sum, p) => {
    const pas = appearancesFor(p, inning)
    return sum + pas.reduce((innerSum, pa) => innerSum + (pa.run_scored ? 1 : 0), 0)
  }, 0)
}

function teamTotal(key) {
  const dbKey = STAT_KEYS[key]
  return props.battingStats.reduce((sum, s) => sum + (s[dbKey] ?? 0), 0) || ''
}

const emptyRows = computed(() => Math.max(0, props.minRosterRows - props.players.length))

function openAppearanceModal(player, inning, appearance = null) {
  const existing = appearancesFor(player, inning)
  const selectedAppearance = appearance ?? (existing.length === 1 ? existing[0] : null)
  // Clicking an existing diamond → open the modal for the player who OWNS
  // that plate appearance (starter for pre-sub innings, sub for post-sub),
  // resolved via game_lineup_player_id on the appearance itself.
  // Clicking the empty-cell diamond → open for whoever is due to bat this
  // inning on this row, via effectiveIdentityFor.
  let identity
  if (selectedAppearance && selectedAppearance.game_lineup_player_id != null) {
    if (
      player.substitute_id != null &&
      selectedAppearance.game_lineup_player_id === player.substitute_id
    ) {
      identity = {
        id: player.substitute_id,
        player_name: player.substitute_player_name ?? player.player_name,
        jersey_number: player.substitute_jersey_number ?? player.player_note ?? '',
        position_code: player.substitute_position_code ?? player.position_code ?? null,
      }
    } else {
      identity = {
        id: player.id,
        player_name: player.player_name,
        jersey_number: player.player_note ?? '',
        position_code: player.position_code ?? null,
      }
    }
  } else {
    identity = effectiveIdentityFor(player, inning)
  }
  const effectivePlayer = {
    id: identity.id,
    row_id: player.row_id,
    batting_order: player.batting_order,
    position_code: identity.position_code,
    player_name: identity.player_name,
    player_note: identity.jersey_number,
  }
  emit('open-appearance', {
    player: effectivePlayer,
    inning,
    existingAppearance: selectedAppearance,
    appearanceCount: existing.length,
    appearanceNumber: appearance ? existing.findIndex((entry) => entry.id === appearance.id) + 1 : existing.length + 1,
  })
}
</script>

<style scoped>
table {
  border-spacing: 0;
  font-family: var(--font-body);
  background: var(--white);
}

/* Header row inside the grid component: title (from parent slot) + pager */
.scoresheet-grid-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.sheet-inning-pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 0 10px;
}

@media (max-width: 599px) {
  .scoresheet-grid-header {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }

  .sheet-inning-pager {
    justify-content: space-between;
  }
}

.sheet-inning-pager__label {
  color: var(--secondary);
  font-size: 0.82rem;
  font-weight: 600;
  white-space: nowrap;
}

.sheet-inning-pager__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid var(--primary-light);
  border-radius: 6px;
  background: var(--white);
  color: var(--secondary);
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
}

.sheet-inning-pager__button--current {
  background: var(--primary-light-3);
}

.sheet-inning-pager__button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

thead {
  background: var(--primary-light-3);
}

.sheet-th-player {
  background-color: var(--primary-light-3);
  color: var(--secondary);
  padding: 8px 4px;
  font-weight: 700;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  position: sticky;
  top: 0;
  z-index: 2;
  white-space: nowrap;
  border-bottom: 0;
}

thead tr:first-child .sheet-th-player,
thead tr:first-child .sheet-th-inning,
thead tr:first-child .sheet-th-stat {
  top: 0;
}

.sheet-th-inning {
  display: table-cell;
  background-color: #edf4fc;
  color: var(--secondary);
  padding: 8px 2px;
  font-weight: 700;
  font-size: 12px;
  text-align: center;
  vertical-align: middle;
  position: sticky;
  z-index: 2;
  border-bottom: 0;
}

.sheet-th-inning--active {
  background-color: #d8ebff;
  box-shadow: inset 0 -2px 0 var(--primary);
}

.sheet-th-stat {
  background-color: var(--primary-light-3);
  color: var(--secondary);
  padding: 8px 2px;
  font-weight: 700;
  font-size: 11px;
  text-align: center;
  position: sticky;
  z-index: 2;
  border-bottom: 0;
}

.sheet-row--even {
  background-color: var(--white);
}

.sheet-row--odd {
  background-color: var(--body-bg);
}

.sheet-row--empty {
  background-color: #f9fbfe;
  opacity: 0.72;
}

.sheet-td {
  padding: 6px 4px;
  vertical-align: middle;
  border-bottom: 1px solid var(--secondary-light-4);
  color: var(--text);
}

.sheet-player-name {
  margin: 0;
  /* No fixed max-width — let the name fill whatever the Player column
     actually has room for. The parent .sheet-player-copy (min-width: 0 +
     flex: 1) constrains width to the available cell space, so overflow
     still kicks in on genuinely narrow columns. */
  max-width: 100%;
  overflow: hidden;
  color: var(--text);
  font-weight: 600;
  font-size: 14px;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sheet-player-identity {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  width: 100%;
}

.sheet-player-copy {
  min-width: 0;
  flex: 1 1 auto;
}

.sheet-player-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  min-height: 18px;
}

.sheet-player-jersey {
  position: relative;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
}

.sheet-player-jersey__icon {
  width: 100%;
  height: 100%;
  display: block;
}

.sheet-player-jersey__number {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text);
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}

.sheet-player-pos {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 34px;
  height: 18px;
  padding: 0 10px;
  border: 1.5px solid var(--primary);
  border-radius: 999px;
  color: var(--secondary);
  background: var(--white);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}

.sheet-player-average {
  margin: 0;
  color: var(--secondary);
  font-size: 12px;
  line-height: 1;
  font-weight: 600;
}

.sheet-player-substitute {
  margin: 6px 0 0;
  color: var(--secondary);
  font-size: 11px;
  line-height: 1.25;
}

.sheet-player-substitute span {
  color: var(--secondary-light);
}

.sheet-td-cell {
  padding: 4px 2px;
  text-align: center;
  vertical-align: middle;
  border-bottom: 1px solid var(--secondary-light-4);
  border-right: 1px solid #edf2f8;
  min-width: 64px;
}

.sheet-cell--active {
  background: linear-gradient(180deg, rgba(45, 140, 240, 0.08) 0%, rgba(45, 140, 240, 0.03) 100%);
  box-shadow: inset 2px 0 0 rgba(45, 140, 240, 0.18), inset -2px 0 0 rgba(45, 140, 240, 0.18);
}

.sheet-cell--subbed {
  background-color: #fff9e8;
}

.sheet-cell--active.sheet-cell--subbed {
  background-color: #fff9e8;
}

.sheet-cell-stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 66px;
  cursor: pointer;
}

.scoresheet-grid-root--readonly .sheet-cell-stack {
  cursor: not-allowed;
}

.sheet-cell-diamond {
  display: block;
  transition: opacity 120ms ease;
}

.sheet-cell-stack:hover .sheet-cell-diamond {
  opacity: 0.82;
}

.scoresheet-grid-root--readonly .sheet-cell-stack:hover .sheet-cell-diamond {
  opacity: 0.28;
}

.sheet-cell-diamond--editable {
  opacity: 0.58;
}

.sheet-cell-stack:hover .sheet-cell-diamond--editable {
  opacity: 0.78;
}

.sheet-cell-diamond--placeholder,
.sheet-cell-diamond--empty-row {
  opacity: 0.28;
}

.sheet-td-stat {
  padding: 4px 2px;
  text-align: center;
  vertical-align: middle;
  border-bottom: 1px solid var(--secondary-light-4);
  border-left: 1px solid var(--secondary-light-4);
}

.sheet-totals-row .sheet-td-total {
  background-color: var(--primary-light-3);
  color: var(--secondary);
  padding: 6px 4px;
  font-size: 11px;
  text-align: center;
  vertical-align: middle;
  position: sticky;
  top: 31px;
  z-index: 2;
  border-top: 0;
  border-right: 1px solid #edf2f8;
}

.sheet-totals-row .sheet-td-total--active {
  background-color: #d8ebff;
  color: var(--secondary);
  box-shadow: inset 0 -2px 0 var(--primary), inset 2px 0 0 rgba(45, 140, 240, 0.12), inset -2px 0 0 rgba(45, 140, 240, 0.12);
}

.sheet-totals-row .sheet-td-total--label {
  text-align: left;
}

/* ─── Narrow (single-inning) layout ────────────────────────────────────────
   Applied via JS class when inningWindowSize === 1 (gridWidth < 600px).
   Using a JS-driven class instead of @media (max-width:599px) because the
   CSS media query measures VIEWPORT width while the grid component measures
   its own ELEMENT width.  On a 620px viewport the panel padding shrinks the
   element to ~552px so JS shows 1 inning — but the media query never fires
   because 620px > 599px.  Tying the CSS to the same condition that controls
   JS keeps them perfectly in sync regardless of viewport vs element width. */

/* Clip the component so the table can never bleed outside the ledger card.
   The ledger panel has overflow:visible, so containment must be here. */
.scoresheet-grid-root--narrow {
  max-width: 100%;
  overflow: hidden;
}

.scoresheet-grid-root--narrow .scoresheet-grid {
  overflow: hidden;
  /* styles.css sets min-width:680px on .scoresheet-grid at ≤520px so the
     scrollable desktop table isn't too cramped.  In narrow mode we own the
     layout via table-layout:fixed, so that forced minimum must be cleared
     or the table resolves width:100% against 680px and the player column
     consumes the whole thing. */
  min-width: 0;
}

/* table-layout:fixed → column widths come ONLY from the first row's <th>
   elements.  With table-layout:auto the player body cells (jersey + name +
   badge) force the column to ~180 px regardless of anything set on <th>. */
.scoresheet-grid-root--narrow .sheet-table {
  table-layout: fixed;
  width: 100%;
}

/* # column — 36 px is enough for 2-digit batting orders. */
.scoresheet-grid-root--narrow thead tr:first-child > th:first-child {
  width: 36px;
}

/* Inning column — 88 px always visible; the 58 px diamond fits with room. */
.scoresheet-grid-root--narrow .sheet-th-inning {
  width: 88px;
}

/* Player column — no explicit width so it absorbs ALL remaining space:
   table_width − 36 px (#) − 88 px (inning). */
.scoresheet-grid-root--narrow .sheet-th-player {
  min-width: 0;
}

/* Hide stat columns in all rows (header, body, totals). */
.scoresheet-grid-root--narrow .sheet-th-stat,
.scoresheet-grid-root--narrow .sheet-td-stat,
.scoresheet-grid-root--narrow .sheet-td-total--stat {
  display: none;
}

/* Disable sticky positioning — desktop top:168px offsets cause the headers
   to cover content rows on narrow viewports. */
.scoresheet-grid-root--narrow .sheet-th-player,
.scoresheet-grid-root--narrow .sheet-th-inning {
  position: static;
}

.scoresheet-grid-root--narrow .sheet-totals-row .sheet-td-total {
  position: static;
}

/* Truncate long player names within their fluid column. */
.scoresheet-grid-root--narrow .sheet-player-name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
