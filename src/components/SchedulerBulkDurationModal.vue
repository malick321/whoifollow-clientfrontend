<script setup lang="ts">
// SchedulerBulkDurationModal
// --------------------------
// Day-level "Reduce remaining games to X minutes" action. Triggered
// from the scheduler toolbar (e.g. when a rain delay shortens the
// remaining cadence). Operates on every game on the active date
// where:
//   - `locked` is NOT set, AND
//   - `status` is not `'final'`
//
// Locked / final games keep their stored duration regardless —
// they've already been played at their original cadence and their
// row span on the calendar must reflect history, not the new
// default. The modal explicitly reports the skipped count on
// success so the user can verify nothing changed retroactively.
//
// The parent (`MatchGeniSchedulerView`) does the actual mutation
// (it owns the games array). This component just collects input,
// emits an `apply` payload, and trusts the parent to commit +
// surface the success toast.

import { computed, ref, watch } from 'vue'
import SlideModal from './SlideModal.vue'
import { minutesFromMidnight, formatTimeRange } from '../api/schedulerTimeAxis'
import { divisionTone } from '../lib/divisionTone'
import { themeMode } from '../theme'
import type { SchedulerGame } from '../types'

const props = withDefaults(defineProps<{
  open: boolean
  date: string
  /** All games — the modal filters by date + lock status for the
   *  "affected count" preview. */
  games: SchedulerGame[]
  /** Default value to pre-fill the input with (typically the
   *  park's current default duration). */
  defaultDuration: number
  /** When provided, the modal operates on this SELECTION of game ids
   *  instead of date-filtering — used by the grid's selection-mode
   *  "Modify › Slot duration". Locked/final are still skipped. `null`
   *  (default) = the legacy whole-day mode. */
  selectionIds?: string[] | null
  /** divisionId → name, for the per-game preview rows (a bulk selection
   *  can span multiple divisions). */
  divisionNameById?: Map<string, string>
  /** Park name — shown as the header eyebrow. */
  parkName?: string
}>(), {
  defaultDuration: 90,
  selectionIds: null,
  parkName: ''
})

const emit = defineEmits<{
  (event: 'close'): void
  /** Apply the new duration to all eligible games on the date.
   *  Parent commits + surfaces a toast with the affected count. */
  (event: 'apply', payload: {
    date: string
    durationMinutes: number
    affectedGameIds: string[]
    skippedCount: number
  }): void
}>()

const newDuration = ref(60)

watch(() => props.open, (isOpen, wasOpen) => {
  if (isOpen && !wasOpen) newDuration.value = Math.min(props.defaultDuration, 60)
})

const isSelectionMode = computed(() => Array.isArray(props.selectionIds))

/** Games in scope — the passed selection, or the whole active day. */
const scopeGames = computed(() => {
  if (isSelectionMode.value) {
    const ids = new Set(props.selectionIds as string[])
    return props.games.filter((g) => ids.has(g.id))
  }
  return props.games.filter((g) => g.scheduledDate === props.date)
})

/** Games that WILL be updated. Excludes locked + final games. */
const affectedGames = computed(() =>
  scopeGames.value.filter((g) => !g.locked && g.status !== 'final')
)
const skippedGames = computed(() =>
  scopeGames.value.filter((g) => g.locked || g.status === 'final')
)

/** Per-game preview: current slot → new slot (start stays, end reflects
 *  the new duration). Falls back to the park default when a game has no
 *  own duration. */
const previewRows = computed(() =>
  affectedGames.value.map((g) => {
    const start = minutesFromMidnight(g.scheduledTime ?? '')
    const curDur = g.durationMinutes && g.durationMinutes > 0 ? g.durationMinutes : props.defaultDuration
    const newDur = newDuration.value > 0 ? newDuration.value : curDur
    const valid = Number.isFinite(start)
    return {
      id: g.id,
      divisionId: g.divisionId,
      division: props.divisionNameById?.get(g.divisionId) ?? '',
      label: g.label,
      teams: `${g.team1Label ?? 'TBD'} vs ${g.team2Label ?? 'TBD'}`,
      field: g.scheduledFieldLabel ?? '',
      from: valid ? formatTimeRange(start, start + curDur) : '',
      to: valid ? formatTimeRange(start, start + newDur) : ''
    }
  })
)

const isValid = computed(() => newDuration.value >= 5 && newDuration.value % 5 === 0)

/** Division-tint fg colour for a row eyebrow — same palette the grid
 *  game cards use, so divisions read with consistent colours. */
function divFg(divisionId: string): string {
  return divisionTone(divisionId, themeMode.value === 'dark').fg
}

const titleText = computed<string>(() =>
  isSelectionMode.value
    ? `Modify ${affectedGames.value.length} game${affectedGames.value.length === 1 ? '' : 's'} slot`
    : 'Reduce remaining games'
)

/** Date label shown next to the title (e.g. "Fri, May 22, 2026"). */
const dateLabel = computed<string>(() => {
  if (!props.date) return ''
  const d = new Date(`${props.date}T00:00:00`)
  if (Number.isNaN(d.getTime())) return props.date
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
})

function onApply() {
  if (!isValid.value) return
  emit('apply', {
    date: props.date,
    durationMinutes: newDuration.value,
    affectedGameIds: affectedGames.value.map((g) => g.id),
    skippedCount: skippedGames.value.length
  })
}
</script>

<template>
  <SlideModal
    :model-value="open"
    :title="titleText"
    size="default"
    flush-body
    @update:model-value="(v) => { if (!v) emit('close') }"
  >
    <!-- Custom title block — park eyebrow, then title + date on one row. -->
    <template #title-block>
      <span v-if="parkName" class="slide-modal-panel__eyebrow">{{ parkName }}</span>
      <div class="scheduler-bulk-dur__titlerow">
        <h2 class="slide-modal-panel__title">{{ titleText }}</h2>
        <span v-if="dateLabel" class="scheduler-bulk-dur__title-date">{{ dateLabel }}</span>
      </div>
    </template>

    <div class="scheduler-bulk-dur__content">
    <div class="floating-input scheduler-bulk-dur__field">
      <input
        id="scheduler-bulk-dur-duration"
        v-model.number="newDuration"
        type="number"
        step="5"
        min="5"
        class="floating-input__control"
      >
      <label for="scheduler-bulk-dur-duration" class="floating-input__label floating-input__label--floated">New game slot (min)</label>
    </div>

    <!-- Per-game preview: current slot → new slot. -->
    <ul v-if="previewRows.length" class="scheduler-bulk-dur__list">
      <li v-for="r in previewRows" :key="r.id" class="scheduler-bulk-dur__row">
        <span v-if="r.division" class="scheduler-bulk-dur__row-eyebrow" :style="{ color: divFg(r.divisionId) }">{{ r.division }}</span>
        <span class="scheduler-bulk-dur__row-game">
          {{ r.label }}<span v-if="r.teams" class="scheduler-bulk-dur__row-teams"> · {{ r.teams }}</span>
        </span>
        <span class="scheduler-bulk-dur__row-times">
          <span class="scheduler-bulk-dur__row-from">{{ r.field }}<template v-if="r.field"> · </template>{{ r.from }}</span>
          <span class="scheduler-bulk-dur__row-arrow" aria-hidden="true">→</span>
          <span class="scheduler-bulk-dur__row-to">{{ r.to }}</span>
        </span>
      </li>
    </ul>
    </div>

    <template #footer>
      <button class="secondary-button" type="button" @click="emit('close')">Cancel</button>
      <span class="scheduler-bulk-dur__foot-spacer"></span>
      <button
        class="primary-button"
        type="button"
        :disabled="!isValid || affectedGames.length === 0"
        @click="onApply"
      >Modify {{ affectedGames.length }} game{{ affectedGames.length === 1 ? '' : 's' }} slot</button>
    </template>
  </SlideModal>
</template>

<style scoped>
/* Right-side SlideModal (more room for a long game list). Flat (no
   gradient) primary CTA, matching the other scheduler dialogs. */
.slide-modal-panel__footer .primary-button { background: var(--primary); }
/* Title + date on one row (date sits next to the title). */
.scheduler-bulk-dur__titlerow {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 10px;
  min-width: 0;
}
.scheduler-bulk-dur__title-date {
  font-size: 0.88rem;
  color: var(--secondary);
  white-space: nowrap;
}
/* `flush-body` zeroes the slide-modal body padding (and its reserved
   scrollbar gutter, which otherwise made the right inset wider than the
   left) — so the gutters live here, symmetric on both sides. */
.scheduler-bulk-dur__content {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 18px 24px 22px;
}
.scheduler-bulk-dur__field { margin-top: 0; }
.scheduler-bulk-dur__foot-spacer { flex: 1 1 auto; }

/* Per-game preview list — current slot → new slot. Full width; the
   SlideModal body scrolls (no inner list scroll). */
.scheduler-bulk-dur__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.scheduler-bulk-dur__row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 6px;
  /* Light fill + 1px divider so each row reads as a container against the
     white slide-modal body (the `--surface-muted` token resolves ~white
     in light mode, leaving rows invisible without this). */
  background: #f4f7fb;
  border: 1px solid var(--border-divider);
}
html.dark-mode .scheduler-bulk-dur__row {
  background: rgba(255, 255, 255, 0.04);
  border-color: transparent;
}
/* Division name — same size/weight/treatment as the grid game card's
   division eyebrow; colour is the division tint (inline `divFg`). */
.scheduler-bulk-dur__row-eyebrow {
  margin: 0 0 1px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  line-height: 1.15;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.scheduler-bulk-dur__row-game {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.scheduler-bulk-dur__row-teams { font-weight: 400; color: var(--secondary); }
.scheduler-bulk-dur__row-times {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.scheduler-bulk-dur__row-from { color: var(--secondary); }
.scheduler-bulk-dur__row-arrow { color: var(--secondary); }
.scheduler-bulk-dur__row-to { color: var(--text); font-weight: 600; }
</style>
