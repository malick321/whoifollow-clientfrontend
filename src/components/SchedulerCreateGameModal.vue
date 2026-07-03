<script setup lang="ts">
// SchedulerCreateGameModal
// ------------------------
// Add OR edit a POOL game (matchup). For "add" it's opened from the
// empty-cell "Add pool game" popover and drops the new matchup onto the
// clicked slot; for "edit" it's opened from the game-details drawer's
// "Edit game" action. Either way the division is fixed (the one selected
// on the scheduler screen / the game's own division) and shown as the
// header eyebrow — there is no division picker. The slot context
// (date · time, field · park) is shown read-only at the top of the body;
// the editable fields are the game name, the two teams, and the duration.
// The view owns the actual mutation (creation / placement / conflict
// checks); this is the pure form. Team options are label-only (the
// scheduler payload has no team roster) — the view derives them from
// existing games.

import { computed, ref, watch } from 'vue'
import SlideModal from './SlideModal.vue'

const props = withDefaults(defineProps<{
  modelValue: boolean
  /** 'create' (default) drops a new matchup on the slot; 'edit' updates
   *  an existing pool game. Drives the title + CTA wording. */
  mode?: 'create' | 'edit'
  /** Division this game belongs to — shown as the header eyebrow (fixed,
   *  not editable: it's the division selected on the scheduler screen). */
  divisionName: string
  /** Read-only slot context. */
  dateLabel: string
  timeLabel: string
  fieldName: string
  parkName: string
  /** Team labels selectable for this division. */
  teamOptions: string[]
  /** Default game time SLOT (park slot length), already capped to the gap. */
  defaultDuration: number
  /** Largest time slot that still fits (the clicked gap for create; a
   *  generous cap for edit). */
  maxDuration: number
  /** Default official TIME LIMIT (min) for this game type — sourced from
   *  the event (e.g. pool 65 / bracket 70). Distinct from the grid slot. */
  defaultTimeLimit: number
  /** Edit prefill — current name / teams / slot / time limit. */
  initialName?: string
  initialTeam1?: string
  initialTeam2?: string
  initialDuration?: number
  initialTimeLimit?: number
}>(), {
  mode: 'create',
  defaultTimeLimit: 65,
  initialName: '',
  initialTeam1: '',
  initialTeam2: '',
  initialDuration: 0,
  initialTimeLimit: 0
})

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'submit', payload: {
    name: string
    team1Label: string
    team2Label: string
    durationMinutes: number
    timeLimitMinutes: number
  }): void
}>()

const GRAIN = 5

const name = ref('')
const team1 = ref('')
const team2 = ref('')
const duration = ref(0)
const timeLimit = ref(0)

// Errors stay hidden until the first submit attempt (mirrors the other
// forms — required fields surface their message on submit, not on open).
const submitAttempted = ref(false)

// Each team field is a searchable single-select combobox: `*Query` is the
// text in the input, `*Open` toggles the results dropdown. The committed
// value lives in `team1` / `team2`.
const team1Query = ref('')
const team2Query = ref('')
const team1Open = ref(false)
const team2Open = ref(false)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    name.value = props.initialName ?? ''
    team1.value = props.initialTeam1 ?? ''
    team2.value = props.initialTeam2 ?? ''
    team1Query.value = team1.value
    team2Query.value = team2.value
    team1Open.value = false
    team2Open.value = false
    submitAttempted.value = false
    timeLimit.value = props.initialTimeLimit || props.defaultTimeLimit || GRAIN
    if (props.mode === 'edit') {
      duration.value = props.initialDuration || props.defaultDuration || GRAIN
    } else {
      duration.value =
        Math.max(GRAIN, Math.min(props.defaultDuration || 0, props.maxDuration || 0)) ||
        props.maxDuration
    }
  },
  { immediate: true }
)

const isEdit = computed(() => props.mode === 'edit')
const titleText = computed(() => (isEdit.value ? 'Edit pool game' : 'Add pool game'))
const submitText = computed(() => (isEdit.value ? 'Save changes' : 'Add game'))

/** Every team in this division (across all pools), with the prefilled teams
 *  folded in so an edit can't lose a selection that isn't in the derived
 *  option list. */
const allTeams = computed<string[]>(() => {
  const out = [...(props.teamOptions ?? [])]
  for (const t of [props.initialTeam1, props.initialTeam2]) {
    if (t && !out.includes(t)) out.push(t)
  }
  return out.sort((a, b) => a.localeCompare(b))
})

/** Filter a team list by the typed query, excluding the team already chosen
 *  in the OTHER field (a team can't play itself). When the query still
 *  matches the committed value (i.e. the field hasn't been re-typed), show
 *  the full list so the dropdown acts as a browse-all on focus. */
function filterTeams(query: string, committed: string, exclude: string): string[] {
  const base = allTeams.value.filter((t) => t !== exclude)
  const q = query.trim().toLowerCase()
  if (!q || query === committed) return base
  return base.filter((t) => t.toLowerCase().includes(q))
}
const team1Options = computed<string[]>(() => filterTeams(team1Query.value, team1.value, team2.value))
const team2Options = computed<string[]>(() => filterTeams(team2Query.value, team2.value, team1.value))

function focusTeam1(e: FocusEvent) { team1Open.value = true; (e.target as HTMLInputElement)?.select() }
function focusTeam2(e: FocusEvent) { team2Open.value = true; (e.target as HTMLInputElement)?.select() }
function onTeam1Input() { team1Open.value = true; team1.value = '' }
function onTeam2Input() { team2Open.value = true; team2.value = '' }
function pickTeam1(t: string) { team1.value = t; team1Query.value = t; team1Open.value = false }
function pickTeam2(t: string) { team2.value = t; team2Query.value = t; team2Open.value = false }
/** Restore the input text to the committed value on blur (so an abandoned
 *  search doesn't leave stray text), then close the dropdown. */
function blurTeam1() { team1Open.value = false; team1Query.value = team1.value }
function blurTeam2() { team2Open.value = false; team2Query.value = team2.value }

const timeLimitError = computed<string>(() => {
  if (timeLimit.value <= 0) return 'Enter a time limit.'
  if (timeLimit.value % GRAIN !== 0) return `Use ${GRAIN}-min steps.`
  return ''
})

const durationError = computed<string>(() => {
  if (duration.value <= 0) return 'Enter a time slot.'
  if (duration.value % GRAIN !== 0) return `Use ${GRAIN}-min steps.`
  if (!isEdit.value && props.maxDuration > 0 && duration.value > props.maxDuration) {
    return `Max ${props.maxDuration} min — that's all the open space here.`
  }
  return ''
})

const isValid = computed(() =>
  !!name.value.trim() &&
  !!team1.value &&
  !!team2.value &&
  team1.value !== team2.value &&
  !timeLimitError.value &&
  !durationError.value
)

// Per-field invalid flags — only "live" after a submit attempt, so the form
// doesn't shout "Required" the moment it opens (matches the other forms).
const nameInvalid = computed(() => submitAttempted.value && !name.value.trim())
const team1Invalid = computed(() => submitAttempted.value && !team1.value)
const team2Invalid = computed(() => submitAttempted.value && !team2.value)
const timeLimitInvalid = computed(() => submitAttempted.value && !!timeLimitError.value)
const durationInvalid = computed(() => submitAttempted.value && !!durationError.value)

function close() { emit('update:modelValue', false) }
function onSubmit() {
  submitAttempted.value = true
  if (!isValid.value) return
  emit('submit', {
    name: name.value.trim(),
    team1Label: team1.value,
    team2Label: team2.value,
    durationMinutes: duration.value,
    timeLimitMinutes: timeLimit.value
  })
  close()
}
</script>

<template>
  <SlideModal
    :model-value="modelValue"
    :title="titleText"
    size="default"
    @update:model-value="(v) => emit('update:modelValue', v)"
  >
    <!-- Header: division eyebrow + title (no subtitle). -->
    <template #title-block>
      <span v-if="divisionName" class="slide-modal-panel__eyebrow">{{ divisionName }}</span>
      <h2 class="slide-modal-panel__title">{{ titleText }}</h2>
    </template>

    <!-- Read-only slot context — when (date · time) + where (field · park). -->
    <ul class="scheduler-create-game__ctx">
      <li class="scheduler-create-game__ctx-row">
        <span class="scheduler-create-game__ctx-icon scheduler-create-game__ctx-icon--time" aria-hidden="true"></span>
        <span class="scheduler-create-game__ctx-text">
          {{ [dateLabel, timeLabel].filter(Boolean).join(' · ') }}
        </span>
      </li>
      <li class="scheduler-create-game__ctx-row">
        <span class="scheduler-create-game__ctx-icon scheduler-create-game__ctx-icon--field" aria-hidden="true"></span>
        <span class="scheduler-create-game__ctx-text">
          {{ [fieldName, parkName].filter(Boolean).join(' · ') }}
        </span>
      </li>
    </ul>

    <!-- Game name. -->
    <div class="floating-input scheduler-create-game__field" :class="{ 'floating-input--invalid': nameInvalid }">
      <input
        id="create-game-name"
        v-model="name"
        type="text"
        maxlength="60"
        class="floating-input__control"
        :class="{ 'floating-input__control--has-value': !!name }"
        placeholder=" "
      >
      <label
        for="create-game-name"
        class="floating-input__label"
        :class="{ 'floating-input__label--floated': !!name }"
      >Game name</label>
      <span v-if="nameInvalid" class="floating-input__error-corner">Required</span>
    </div>

    <!-- Team 1 vs Team 2 — searchable single-select comboboxes; each list
         excludes the team picked in the other field. -->
    <div class="scheduler-create-game__teams">
      <div class="floating-input scheduler-create-game__field scheduler-create-game__combo" :class="{ 'floating-input--invalid': team1Invalid }">
        <input
          id="create-game-team1"
          v-model="team1Query"
          type="text"
          autocomplete="off"
          role="combobox"
          :aria-expanded="team1Open"
          class="floating-input__control"
          :class="{ 'floating-input__control--has-value': !!team1Query }"
          placeholder=" "
          @focus="focusTeam1"
          @input="onTeam1Input"
          @blur="blurTeam1"
        >
        <label for="create-game-team1" class="floating-input__label" :class="{ 'floating-input__label--floated': !!team1Query }">Team 1</label>
        <span v-if="team1Invalid" class="floating-input__error-corner">Required</span>
        <ul v-if="team1Open" class="scheduler-create-game__combo-list">
          <li v-for="t in team1Options" :key="`t1-${t}`">
            <button type="button" class="scheduler-create-game__combo-item" @mousedown.prevent="pickTeam1(t)">{{ t }}</button>
          </li>
          <li v-if="!team1Options.length" class="scheduler-create-game__combo-empty">No teams match.</li>
        </ul>
      </div>
      <span class="scheduler-create-game__vs" aria-hidden="true">vs</span>
      <div class="floating-input scheduler-create-game__field scheduler-create-game__combo" :class="{ 'floating-input--invalid': team2Invalid }">
        <input
          id="create-game-team2"
          v-model="team2Query"
          type="text"
          autocomplete="off"
          role="combobox"
          :aria-expanded="team2Open"
          class="floating-input__control"
          :class="{ 'floating-input__control--has-value': !!team2Query }"
          placeholder=" "
          @focus="focusTeam2"
          @input="onTeam2Input"
          @blur="blurTeam2"
        >
        <label for="create-game-team2" class="floating-input__label" :class="{ 'floating-input__label--floated': !!team2Query }">Team 2</label>
        <span v-if="team2Invalid" class="floating-input__error-corner">Required</span>
        <ul v-if="team2Open" class="scheduler-create-game__combo-list">
          <li v-for="t in team2Options" :key="`t2-${t}`">
            <button type="button" class="scheduler-create-game__combo-item" @mousedown.prevent="pickTeam2(t)">{{ t }}</button>
          </li>
          <li v-if="!team2Options.length" class="scheduler-create-game__combo-empty">No teams match.</li>
        </ul>
      </div>
    </div>
    <p v-if="!allTeams.length" class="scheduler-create-game__hint">No teams found for this division yet.</p>

    <!-- Time limit + game time slot — side by side. Time limit = the
         regulation game length (event/type level), used for live "remaining
         / over time". Game time slot = how much room the game takes on the
         schedule grid. Each shows an error (when invalid) or a hint. -->
    <div class="scheduler-create-game__durations">
      <div class="scheduler-create-game__duration-col">
        <div class="floating-input scheduler-create-game__field" :class="{ 'floating-input--invalid': timeLimitInvalid }">
          <input
            id="create-game-time-limit"
            v-model.number="timeLimit"
            type="number"
            :step="GRAIN"
            :min="GRAIN"
            class="floating-input__control"
          >
          <label for="create-game-time-limit" class="floating-input__label floating-input__label--floated">Time limit (min)</label>
        </div>
        <p v-if="timeLimitInvalid" class="scheduler-create-game__error">{{ timeLimitError }}</p>
        <p v-else class="scheduler-create-game__hint">Regulation length — drives live remaining / over time.</p>
      </div>
      <div class="scheduler-create-game__duration-col">
        <div class="floating-input scheduler-create-game__field" :class="{ 'floating-input--invalid': durationInvalid }">
          <input
            id="create-game-duration"
            v-model.number="duration"
            type="number"
            :step="GRAIN"
            :min="GRAIN"
            :max="!isEdit && maxDuration > 0 ? maxDuration : undefined"
            class="floating-input__control"
          >
          <label for="create-game-duration" class="floating-input__label floating-input__label--floated">Game time slot (min)</label>
        </div>
        <p v-if="durationInvalid" class="scheduler-create-game__error">{{ durationError }}</p>
        <p v-else class="scheduler-create-game__hint">Room the game takes on the schedule grid.</p>
      </div>
    </div>

    <template #footer>
      <button type="button" class="secondary-button" @click="close">Cancel</button>
      <span class="scheduler-create-game__foot-spacer"></span>
      <button type="button" class="primary-button" @click="onSubmit">{{ submitText }}</button>
    </template>
  </SlideModal>
</template>

<style scoped>
/* Flat fill (no gradient) on the primary CTA — overrides the global
   `.primary-button` linear-gradient, matching the other scheduler dialogs. */
.primary-button { background: var(--primary); }

/* Read-only slot context — when / where rows with a leading masked glyph. */
.scheduler-create-game__ctx {
  list-style: none;
  margin: 0 0 4px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-radius: 8px;
  background: var(--surface-muted, #f4f7fb);
}
html.dark-mode .scheduler-create-game__ctx { background: rgba(255, 255, 255, 0.04); }
.scheduler-create-game__ctx-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.scheduler-create-game__ctx-icon {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  background-color: var(--primary);
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}
html.dark-mode .scheduler-create-game__ctx-icon { background-color: #7fb0e8; }
.scheduler-create-game__ctx-icon--time {
  -webkit-mask-image: url('../assets/time.svg');
  mask-image: url('../assets/time.svg');
}
.scheduler-create-game__ctx-icon--field {
  -webkit-mask-image: url('../assets/field-line.svg');
  mask-image: url('../assets/field-line.svg');
}
.scheduler-create-game__ctx-text {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scheduler-create-game__field { margin-top: 16px; }
.scheduler-create-game__teams {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
}
.scheduler-create-game__teams .scheduler-create-game__field { margin-top: 0; }
/* Time limit + game time slot side by side. */
.scheduler-create-game__durations {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-top: 16px;
  align-items: start;
}
.scheduler-create-game__durations .scheduler-create-game__field { margin-top: 0; }
@media (max-width: 520px) {
  .scheduler-create-game__durations { grid-template-columns: 1fr; }
}
.scheduler-create-game__vs {
  font-size: 12px;
  font-weight: 600;
  color: var(--secondary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

/* Searchable team combobox — results dropdown anchored under the input. */
.scheduler-create-game__combo { position: relative; }
.scheduler-create-game__combo-list {
  list-style: none;
  margin: 4px 0 0;
  padding: 4px;
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 20;
  max-height: 208px;
  overflow-y: auto;
  background: var(--surface-card);
  border: 1px solid var(--border-divider);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}
html.dark-mode .scheduler-create-game__combo-list { box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5); }
.scheduler-create-game__combo-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px 10px;
  border: none;
  background: transparent;
  border-radius: 6px;
  font-size: 13px;
  color: var(--text);
  cursor: pointer;
}
.scheduler-create-game__combo-item:hover { background: var(--primary-light-3, #eef4fd); color: var(--primary); }
html.dark-mode .scheduler-create-game__combo-item:hover { background: rgba(45, 140, 240, 0.16); color: #7fb0e8; }
.scheduler-create-game__combo-empty {
  padding: 8px 10px;
  font-size: 12px;
  color: var(--secondary);
}
.scheduler-create-game__hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--secondary);
}
.scheduler-create-game__error {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--danger, #b03e3e);
}
html.dark-mode .scheduler-create-game__error { color: #ef6f6f; }
.scheduler-create-game__foot-spacer { flex: 1 1 auto; }
</style>
