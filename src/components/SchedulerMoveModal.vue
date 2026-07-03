<script setup lang="ts">
// SchedulerMoveModal
// ------------------
// Full right-side slide-over for the bulk "move games to another park"
// rain-pivot. Flow:
//   1. Pick a DESTINATION park (searchable, like the invite-official user
//      pick) — nothing below shows until one is chosen.
//   2. Pick a DESTINATION DATE (≥ the source date) via the preview grid's
//      own date strip.
//   3. The games are intelligently RE-PACKED across the destination's
//      fields (chronological, earliest free slot, around existing games +
//      breaks, within the day window — handles fewer fields than the
//      source) and shown as GHOST placements over the destination's real
//      schedule. A "Won't fit" list calls out anything that can't land.
//   4. Optionally shorten the slot duration (feeds the packer).
// The view re-runs the (deterministic) packer on confirm and applies.

import { computed, ref, watch } from 'vue'
import SlideModal from './SlideModal.vue'
import MatchGeniFieldGrid from './MatchGeniFieldGrid.vue'
import MatchGeniGameCard from './MatchGeniGameCard.vue'
import { packGamesToDestination } from '../api/schedulerTimeAxis'
import type { SchedulerGame, SchedulerPark, SchedulerBreak } from '../types'

const props = defineProps<{
  modelValue: boolean
  selectedGames: SchedulerGame[]
  sourcePark: SchedulerPark
  /** Candidate destination parks (event parks minus the source). */
  targetParks: SchedulerPark[]
  /** All games (for the destination preview + collision-aware packing). */
  allGames: SchedulerGame[]
  /** Date the selected games are currently on — destination date must be ≥ this. */
  sourceDate: string
  eventDefaultMinutes?: number
  divisionNameById?: Map<string, string>
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'confirm', payload: { targetParkId: string; date: string; durationOverride?: number }): void
}>()

const GRAIN = 5
const searchTerm = ref('')
const targetParkId = ref('')
const destDate = ref('')
/** Uniform game time slot (min) applied to every moved game. Defaults to
 *  the destination park's own default slot once a park is picked; the
 *  admin nudges it with the ±5 stepper. */
const duration = ref(60)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    searchTerm.value = ''
    targetParkId.value = ''
    destDate.value = ''
    duration.value = 60
  },
  { immediate: true }
)

// ── Destination park (searchable pick) ──────────────────────────────
// Mirrors the invite-official user search: a hint until the admin types,
// then matching suggestions in an overlay dropdown.
const parkResults = computed<SchedulerPark[]>(() => {
  const q = searchTerm.value.trim().toLowerCase()
  if (!q) return []
  return props.targetParks.filter((p) => p.name.toLowerCase().includes(q))
})
const targetPark = computed<SchedulerPark | null>(
  () => props.targetParks.find((p) => p.id === targetParkId.value) ?? null
)
function pickPark(id: string) {
  targetParkId.value = id
  // Seed the slot with the destination park's own default game slot.
  const park = props.targetParks.find((p) => p.id === id)
  duration.value = park?.defaultGameDurationMinutes ?? 60
  // Default the destination date to the first operating day ≥ source date.
  destDate.value = destDays.value[0]?.date ?? ''
}
function changePark() {
  targetParkId.value = ''
  destDate.value = ''
  searchTerm.value = ''
}

// ── Destination date (≥ source date) ────────────────────────────────
const destDays = computed(() =>
  (targetPark.value?.days ?? []).filter((d) => d.date >= props.sourceDate)
)
/** Park clone whose date strip only offers valid (≥ source) days. */
const destStripPark = computed<SchedulerPark | null>(() =>
  targetPark.value ? { ...targetPark.value, days: destDays.value } : null
)
/** Park clone carrying the CHOSEN day's window, for the packer. */
const destDayPark = computed<SchedulerPark | null>(() => {
  const park = targetPark.value
  if (!park) return null
  const day = park.days.find((d) => d.date === destDate.value)
  if (day?.startTime && day?.endTime) {
    return { ...park, dayStartTime: day.startTime, dayEndTime: day.endTime }
  }
  return park
})
const destBreaksForDate = computed<SchedulerBreak[]>(() =>
  (targetPark.value?.breaks ?? []).filter((b) => b.date === destDate.value)
)

// ── Game time slot (uniform, ±5 stepper) ────────────────────────────
const durationOverride = computed<number | undefined>(
  () => (duration.value > 0 ? duration.value : undefined)
)
/** Nudge the slot by ±GRAIN, clamped to a single grain minimum. */
function stepDuration(delta: number) {
  const next = duration.value + delta
  if (next < GRAIN) return
  duration.value = next
}

// ── Intelligent repack + ghost preview ──────────────────────────────
const packResult = computed(() => {
  if (!destDayPark.value || !destDate.value) return null
  return packGamesToDestination(
    props.selectedGames, destDayPark.value, props.allGames,
    destDate.value, props.eventDefaultMinutes, durationOverride.value
  )
})
/** Ghost games for the preview grid — the packed placements rendered on
 *  the destination park/date. `startTime` stays 24h ('HH:MM'); the grid
 *  parses both forms. */
const ghostGames = computed<SchedulerGame[]>(() => {
  if (!packResult.value) return []
  return packResult.value.placements.map((p) => ({
    ...p.game,
    parkId: targetPark.value?.id ?? p.game.parkId,
    scheduledDate: destDate.value,
    scheduledTime: p.startTime,
    scheduledFieldLabel: p.fieldName,
    durationMinutes: p.durationMinutes
  }))
})
const placedCount = computed(() => packResult.value?.placements.length ?? 0)
const unplaced = computed(() => packResult.value?.unplaced ?? [])

function divName(g: SchedulerGame): string {
  return props.divisionNameById?.get(g.divisionId) ?? ''
}


const titleText = computed<string>(
  () => `Moving ${props.selectedGames.length} game${props.selectedGames.length === 1 ? '' : 's'}`
)
/** Source date (the games' current day) shown next to the title. */
const sourceDateLabel = computed<string>(() => {
  if (!props.sourceDate) return ''
  const d = new Date(`${props.sourceDate}T00:00:00`)
  if (Number.isNaN(d.getTime())) return props.sourceDate
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
})

function close() { emit('update:modelValue', false) }
function onConfirm() {
  if (!targetPark.value || !destDate.value || placedCount.value === 0) return
  emit('confirm', {
    targetParkId: targetPark.value.id,
    date: destDate.value,
    durationOverride: durationOverride.value
  })
  close()
}
</script>

<template>
  <SlideModal
    :model-value="modelValue"
    :title="titleText"
    size="full"
    flush-body
    @update:model-value="(v) => emit('update:modelValue', v)"
  >
    <!-- Custom title block — park eyebrow, then title + source date on one row. -->
    <template #title-block>
      <span class="slide-modal-panel__eyebrow">{{ sourcePark.name }}</span>
      <div class="scheduler-move__titlerow">
        <h2 class="slide-modal-panel__title">{{ titleText }}</h2>
        <span v-if="sourceDateLabel" class="scheduler-move__title-date">{{ sourceDateLabel }}</span>
      </div>
    </template>

    <div class="scheduler-move__content">
    <!-- Top row — From · To (searchable pick), then the game-time-slot
         card once a destination is chosen, laid out as one connection
         flow so the cards match width. -->
    <div class="event-access-modal__connection scheduler-move__top">
      <!-- From card. -->
      <div class="event-access-modal__connection-card">
        <div class="event-access-modal__connection-meta">
          <span class="event-access-modal__connection-sub">From</span>
          <strong class="event-access-modal__connection-title">{{ sourcePark.name }}</strong>
          <span class="event-access-modal__connection-sub">
            {{ sourcePark.fields.length }} field{{ sourcePark.fields.length === 1 ? '' : 's' }}
          </span>
        </div>
      </div>
      <span class="event-access-modal__connection-arrow" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 12h14"></path>
          <path d="M13 6l6 6-6 6"></path>
        </svg>
      </span>
      <!-- Destination — searchable pick, then card + Change. -->
      <div v-if="targetPark" class="event-access-modal__connection-card event-access-modal__connection-card--event scheduler-move__to-card">
        <div class="event-access-modal__connection-meta">
          <span class="event-access-modal__connection-sub">To</span>
          <strong class="event-access-modal__connection-title">{{ targetPark.name }}</strong>
          <span class="event-access-modal__connection-sub">
            {{ targetPark.fields.length }} field{{ targetPark.fields.length === 1 ? '' : 's' }}
          </span>
        </div>
        <button type="button" class="scheduler-move__change-btn" @click="changePark">Change</button>
      </div>
      <div v-else class="event-access-modal__connection-card scheduler-move__picker-card">
        <input
          v-model="searchTerm"
          type="search"
          class="scheduler-move__search"
          placeholder="Select destination park"
          aria-label="Search destination parks"
        >
        <ul v-if="parkResults.length" class="scheduler-move__park-results">
          <li v-for="p in parkResults" :key="p.id" class="scheduler-move__park-item">
            <button type="button" class="scheduler-move__park-btn" @click="pickPark(p.id)">
              <span class="scheduler-move__park-text">
                <strong>{{ p.name }}</strong>
                <small>{{ p.fields.length }} field{{ p.fields.length === 1 ? '' : 's' }}</small>
              </span>
            </button>
          </li>
        </ul>
        <p v-else-if="searchTerm.trim()" class="scheduler-move__park-empty">No parks match "{{ searchTerm }}".</p>
        <p v-else class="scheduler-move__park-hint">Search parks to choose a destination.</p>
      </div>

      <!-- Game time slot — shown once a destination is chosen. Defaults to
           the destination park's slot; ±5-min stepper. Applied uniformly
           to every moved game (feeds the packer). -->
      <div v-if="targetPark" class="event-access-modal__connection-card scheduler-move__summary">
        <span class="scheduler-move__slot-label">Game time slot (min)</span>
        <div class="scheduler-move__stepper">
          <button
            type="button"
            class="scheduler-move__step-btn"
            aria-label="Decrease by 5 minutes"
            :disabled="duration <= GRAIN"
            @click="stepDuration(-GRAIN)"
          >&minus;</button>
          <span class="scheduler-move__step-value">{{ duration }}</span>
          <button
            type="button"
            class="scheduler-move__step-btn"
            aria-label="Increase by 5 minutes"
            @click="stepDuration(GRAIN)"
          >+</button>
        </div>
      </div>
    </div>

    <!-- Everything below is gated behind a chosen destination park. -->
    <template v-if="targetPark">
      <!-- Destination schedule preview (read-only) with ghost placements. -->
      <div class="scheduler-move__preview">
        <p v-if="!destStripPark || !destDays.length" class="scheduler-move__error">
          {{ targetPark.name }} has no available dates on or after the source date.
        </p>
        <MatchGeniFieldGrid
          v-else
          :park="destStripPark"
          :games="allGames"
          :preview-games="ghostGames"
          v-model:active-date="destDate"
          cell-interaction="none"
          :park-breaks="destBreaksForDate"
          :event-default-game-duration-minutes="eventDefaultMinutes"
        >
          <template #cell="{ game, size, durationMinutes }">
            <MatchGeniGameCard
              :game="game"
              :division-name="divName(game)"
              :size="(size as 'full' | 'compact' | 'mini')"
              :duration-minutes="durationMinutes"
              toned-by-division
            />
          </template>
        </MatchGeniFieldGrid>
      </div>

      <!-- Won't fit. -->
      <div v-if="unplaced.length" class="scheduler-move__section">
        <p class="scheduler-move__section-title scheduler-move__section-title--warn">
          Won't fit ({{ unplaced.length }})
        </p>
        <ul class="scheduler-move__list">
          <li v-for="b in unplaced" :key="b.game.id" class="scheduler-move__row scheduler-move__row--blocked">
            <span class="scheduler-move__row-game">
              {{ b.game.label }}<span v-if="divName(b.game)" class="scheduler-move__row-teams"> · {{ divName(b.game) }}</span>
            </span>
            <span class="scheduler-move__row-reason">{{ b.reason }}</span>
          </li>
        </ul>
      </div>
    </template>
    </div>

    <template #footer>
      <button class="secondary-button" type="button" @click="close">Cancel</button>
      <span class="scheduler-move__foot-spacer"></span>
      <button
        class="primary-button"
        type="button"
        :disabled="placedCount === 0"
        @click="onConfirm"
      >Move {{ placedCount }} game{{ placedCount === 1 ? '' : 's' }}</button>
    </template>
  </SlideModal>
</template>

<style scoped>
.slide-modal-panel__footer .primary-button { background: var(--primary); }
/* Title + source date on one row (date sits next to the title). */
.scheduler-move__titlerow {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 10px;
  min-width: 0;
}
.scheduler-move__title-date {
  font-size: 0.88rem;
  color: var(--secondary);
  white-space: nowrap;
}

/* Body content wrapper. The slide modal body is `flush-body` (zero
   padding) so the sticky grid date row can pin flush to the top with no
   gap; the gutters live here instead. The preview grid bleeds back to
   the panel edges via its negative side margins. */
.scheduler-move__content {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 16px 24px 20px;
}

/* Top row — three EQUAL cards (summary · From · To) in one connection
   flow. Each `.event-access-modal__connection-card` is flex:1 1 0, so
   they match width; the arrow stays auto-width. Wraps on narrow widths. */
.scheduler-move__top { flex-wrap: wrap; }
.scheduler-move__to-card { align-items: center; }
.scheduler-move__change-btn {
  appearance: none;
  margin-left: auto;
  background: transparent;
  border: 1px solid var(--border-divider);
  color: var(--text);
  border-radius: 6px;
  padding: 4px 10px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.scheduler-move__change-btn:hover { background: var(--surface-muted); }

/* Searchable destination picker — hint until typing, then a suggestion
   dropdown overlaying below the input (mirrors the invite-official pick). */
.scheduler-move__picker-card {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  min-width: 0;
  position: relative; /* anchors the absolute results dropdown */
}
.scheduler-move__search {
  width: 100%;
  height: 38px;
  padding: 0 12px;
  border-radius: 6px;
  border: 1px solid var(--border-divider);
  background: var(--surface-muted);
  font: inherit;
  color: var(--text);
}
.scheduler-move__search:focus { outline: none; border-color: var(--primary); background: var(--surface-card); }
.scheduler-move__park-results {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--border-divider);
  border-radius: 6px;
  background: var(--white);
  max-height: 240px;
  overflow-y: auto;
}
html.dark-mode .scheduler-move__park-results { background: rgba(255, 255, 255, 0.04); }
.scheduler-move__park-hint,
.scheduler-move__park-empty {
  margin: 0;
  font-size: 12px;
  color: var(--secondary);
  text-align: center;
  padding: 6px 0;
}
.scheduler-move__park-item + .scheduler-move__park-item {
  border-top: 1px solid var(--border-subtle, var(--border-divider));
}
.scheduler-move__park-btn {
  appearance: none;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
}
.scheduler-move__park-btn:hover { background: var(--surface-muted); }
html.dark-mode .scheduler-move__park-btn:hover { background: rgba(255, 255, 255, 0.06); }
.scheduler-move__park-text { display: flex; flex-direction: column; min-width: 0; }
.scheduler-move__park-text strong { font-size: 13px; color: var(--text); }
.scheduler-move__park-text small { font-size: 11px; color: var(--secondary); }
.scheduler-move__park-empty { padding: 10px 12px; font-size: 12px; color: var(--secondary); text-align: center; }


/* Game-time-slot card — internal layout only; the card chrome (border,
   padding, bg, flex:1 1 0 for equal width) comes from the shared
   `.event-access-modal__connection-card` base. Label above a centred
   ±5-min stepper. */
.scheduler-move__summary {
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 8px;
}
.scheduler-move__slot-label { font-size: 13px; font-weight: 600; color: var(--text); }
.scheduler-move__stepper {
  display: inline-flex;
  align-items: center;
  gap: 0;
  border: 1px solid var(--border-divider);
  border-radius: 8px;
  overflow: hidden;
  background: var(--surface-card);
}
.scheduler-move__step-btn {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--text);
  width: 34px;
  height: 34px;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.scheduler-move__step-btn:hover:not(:disabled) { background: var(--surface-muted); color: var(--primary); }
.scheduler-move__step-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.scheduler-move__step-value {
  min-width: 48px;
  text-align: center;
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  border-left: 1px solid var(--border-divider);
  border-right: 1px solid var(--border-divider);
  padding: 0 6px;
  line-height: 34px;
}
.scheduler-move__error { font-size: 12px; color: var(--danger, #b03e3e); }
html.dark-mode .scheduler-move__error { color: #ef6f6f; }

/* Preview + sections. */
/* Preview grid stretches edge-to-edge of the panel (bleeds past the
   body's 24px side padding). Vertical spacing comes from the content
   wrapper's gap. The grid's date strip / field bar are sticky against
   `--matchgeni-field-grid-top` (the main page's header offset) — reset it
   to 0 here so they pin to the top of the modal body, not below a gap. */
.scheduler-move__preview {
  margin: 0 -24px;
  --matchgeni-field-grid-top: 0px;
}
.scheduler-move__section { margin-top: 6px; }
.scheduler-move__section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 8px;
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--secondary);
}
.scheduler-move__section-title--warn { color: #b03e3e; }
html.dark-mode .scheduler-move__section-title--warn { color: #ef6f6f; }
.scheduler-move__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.scheduler-move__row--blocked {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--danger-light, #fdecec);
}
html.dark-mode .scheduler-move__row--blocked { background: rgba(239, 111, 111, 0.1); }
.scheduler-move__row-game { font-size: 13px; font-weight: 600; color: var(--text); }
.scheduler-move__row-teams { font-weight: 400; color: var(--secondary); }
.scheduler-move__row-reason {
  flex: 0 1 auto;
  font-size: 12px;
  color: var(--secondary);
  text-align: right;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.scheduler-move__foot-spacer { flex: 1 1 auto; }
</style>
