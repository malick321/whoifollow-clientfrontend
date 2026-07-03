<script setup lang="ts">
// SchedulerBreakForm
// ------------------
// Modal form for creating / editing a `SchedulerBreak` from the
// matchgeni scheduler. Opens when the user clicks the "+ Break"
// pill on a time-column hour row OR the Edit affordance on an
// existing break block.
//
// Three controls:
//   - Start time     — HH:MM 24h, validated in 30-min steps
//                      (mirrors the calendar axis grain).
//   - Duration       — minutes, default 30, validated in 30-min
//                      steps. Backend serializer rounds to grain
//                      anyway; we enforce client-side for
//                      immediate feedback.
//   - Label          — free-form (Lunch / Rain delay / Maint.).
//   - Scope          — "Park-wide" (default) or "Single field".
//                      When `field`, a field picker appears.
//
// The form does NOT run conflict detection itself — the parent
// (`MatchGeniSchedulerView`) calls `findConflicts` against the
// current games + breaks on save and surfaces an error toast if
// the placement collides. This keeps the form pure-UI; the
// scheduling rules live in `schedulerTimeAxis.ts`.

import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { SchedulerBreak, SchedulerParkField } from '../types'
import { ROW_GRANULARITY_MINUTES, minutesFromMidnight } from '../api/schedulerTimeAxis'

const props = withDefaults(defineProps<{
  /** Controls visibility — parent flips on form-open. */
  open: boolean
  /** Date being edited (`YYYY-MM-DD`). Caller pre-determines from
   *  the active grid date. */
  date: string
  /** Fields available for `scope: 'field'` mode. */
  fields: SchedulerParkField[]
  /** Park's day-scheduling window in 24-hour `HH:MM`. The form
   *  uses these to clamp the duration input so a user can't
   *  enter a break that runs past `dayEndTime` — same rule for
   *  park-wide AND field-scope breaks. When absent, falls back
   *  to a wide 00:00–24:00 window (no clamp). */
  dayStartTime?: string
  dayEndTime?: string
  /** When set, the form opens in EDIT mode pre-filled with this
   *  break's fields. When `null`, opens in CREATE mode with
   *  `initialStartTime` pre-filled. */
  editing?: SchedulerBreak | null
  /** When creating, the hover-anchored start time. `HH:MM` 24h. */
  initialStartTime?: string
  /** When creating from a grid-cell click, pre-select the scope +
   *  field so the break defaults to the clicked field. Omitted ⇒
   *  park-wide (the toolbar "Add Break" default). */
  initialScope?: 'park' | 'field'
  initialFieldName?: string
  /** When creating, pre-fill the duration (minutes). Omitted ⇒ the
   *  grain default. Used by the grid-click flow to seed the gap size. */
  initialDurationMinutes?: number
}>(), {
  dayStartTime: '00:00',
  dayEndTime: '24:00',
  editing: null,
  initialStartTime: '12:00',
  initialScope: 'park',
  initialFieldName: '',
  initialDurationMinutes: 0
})

const emit = defineEmits<{
  (event: 'close'): void
  /** Save in CREATE mode — parent generates the id and commits. */
  (event: 'create', payload: Omit<SchedulerBreak, 'id'>): void
  /** Save in EDIT mode — parent commits the updated break. */
  (event: 'update', payload: SchedulerBreak): void
  /** Delete in EDIT mode — parent removes the break from the
   *  park's breaks list. Surfaced as a destructive footer
   *  button when `editing` is set (previously the destructive
   *  affordance lived on the in-grid break card itself; pulled
   *  in here so the entire break-action surface lives in one
   *  popup). */
  (event: 'delete', brk: SchedulerBreak): void
}>()

// ── Form state ──────────────────────────────────────────────────

const startTime = ref('12:00')
const durationMinutes = ref(30)
const label = ref('')
const scope = ref<'park' | 'field'>('park')
const fieldName = ref<string>('')

// Block page scroll while the popup is open. Locks `<body>`
// overflow + compensates the scrollbar gutter with a matching
// `padding-right` so the page DOESN'T visibly shift when the
// scrollbar disappears — same pattern modal-aware libraries
// (Bootstrap, Headless UI) use to avoid the content-jump that
// `overflow: hidden` alone produces. `unmount` cleanup also
// restores defaults in case the parent unmounts the form while
// it's still open (e.g. route change).
let prevBodyOverflow = ''
let prevBodyPaddingRight = ''

function lockPageScroll() {
  if (typeof document === 'undefined') return
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
  prevBodyOverflow = document.body.style.overflow
  prevBodyPaddingRight = document.body.style.paddingRight
  document.body.style.overflow = 'hidden'
  if (scrollbarWidth > 0) {
    document.body.style.paddingRight = `${scrollbarWidth}px`
  }
}
function unlockPageScroll() {
  if (typeof document === 'undefined') return
  document.body.style.overflow = prevBodyOverflow
  document.body.style.paddingRight = prevBodyPaddingRight
}
onBeforeUnmount(unlockPageScroll)

// Re-seed state every time the modal opens so a stale edit
// doesn't bleed into a fresh create. Also flip the page-scroll
// lock to match the open state.
watch(() => props.open, (isOpen) => {
  if (!isOpen) {
    unlockPageScroll()
    return
  }
  lockPageScroll()
  if (props.editing) {
    startTime.value = props.editing.startTime
    durationMinutes.value = props.editing.durationMinutes
    label.value = props.editing.label ?? ''
    scope.value = props.editing.scope
    fieldName.value = props.editing.fieldName ?? props.fields[0]?.name ?? ''
  } else {
    startTime.value = props.initialStartTime
    durationMinutes.value = props.initialDurationMinutes > 0
      ? props.initialDurationMinutes
      : ROW_GRANULARITY_MINUTES
    label.value = ''
    scope.value = props.initialScope
    fieldName.value = props.initialScope === 'field' && props.initialFieldName
      ? props.initialFieldName
      : props.fields[0]?.name ?? ''
  }
}, { immediate: true })

/** Human-friendly date for the header eyebrow — e.g. "Wed,
 *  Apr 29, 2026". Parses ISO with `T00:00:00` so the local-Date
 *  constructor doesn't shift the weekday across a UTC boundary. */
const formattedDate = computed<string>(() => {
  if (!props.date) return ''
  const d = new Date(`${props.date}T00:00:00`)
  if (Number.isNaN(d.getTime())) return props.date
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
})

/** Maximum duration (minutes) the break can have without
 *  extending past the park's `dayEndTime`. Computed live from
 *  `(dayEndTime - startTime)` so picking a later start
 *  automatically shrinks the allowed duration. Returns a large
 *  fallback when the start time is unparseable so the input
 *  doesn't lock the user out of typing a partial value. */
const maxDurationMinutes = computed<number>(() => {
  const start = minutesFromMidnight(startTime.value)
  const end = props.dayEndTime === '24:00'
    ? 24 * 60
    : minutesFromMidnight(props.dayEndTime)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 24 * 60
  const span = end - start
  return span > 0 ? span : 0
})

const isValid = computed(() => {
  if (!startTime.value.match(/^\d{2}:\d{2}$/)) return false
  if (durationMinutes.value <= 0) return false
  if (durationMinutes.value % ROW_GRANULARITY_MINUTES !== 0) return false
  // Duration must not push the break end past the park's
  // `dayEndTime` — applies to BOTH scopes (park-wide and
  // field-scope). `0` max means start time is at/after window
  // end, which is also invalid.
  if (durationMinutes.value > maxDurationMinutes.value) return false
  if (scope.value === 'field' && !fieldName.value) return false
  return true
})

/** Inline error text — shown under the duration input when the
 *  user enters a value that would extend past park hours. Empty
 *  string when the value is valid (or the form is in a "user
 *  is still typing" state with NaN). */
const durationError = computed<string>(() => {
  if (durationMinutes.value > 0 && durationMinutes.value > maxDurationMinutes.value) {
    return `Max ${maxDurationMinutes.value} min (park closes at ${props.dayEndTime}).`
  }
  return ''
})

function onSave() {
  if (!isValid.value) return
  if (props.editing) {
    emit('update', {
      ...props.editing,
      startTime: startTime.value,
      durationMinutes: durationMinutes.value,
      label: label.value || undefined,
      scope: scope.value,
      fieldName: scope.value === 'field' ? fieldName.value : undefined
    })
  } else {
    emit('create', {
      date: props.date,
      startTime: startTime.value,
      durationMinutes: durationMinutes.value,
      label: label.value || undefined,
      scope: scope.value,
      fieldName: scope.value === 'field' ? fieldName.value : undefined
    })
  }
}

function onBackdrop(evt: MouseEvent) {
  if (evt.target === evt.currentTarget) emit('close')
}
</script>

<template>
  <div v-if="open" class="break-form-backdrop" @click="onBackdrop">
    <div class="break-form" role="dialog" aria-modal="true">
      <header class="break-form__header">
        <div class="break-form__heading">
          <span class="break-form__eyebrow">{{ formattedDate }}</span>
          <h2 class="break-form__title">
            {{ editing ? 'Edit break' : 'Add break' }}
          </h2>
          <p class="break-form__subtitle">
            Blocks scheduling for the chosen fields during this time.
          </p>
        </div>
        <button
          type="button"
          class="break-form__close"
          aria-label="Close"
          @click="emit('close')"
        >×</button>
      </header>

      <div class="break-form__row">
        <!-- Start time + Duration use the portal-wide
             `.floating-input` pattern (same component the team-
             register / event modals share) so the form chrome
             reads as a consistent affordance across the app.
             `type="time"` and `type="number"` carry an intrinsic
             value (always rendered), so the floated `--floated`
             label modifier is set permanently to keep the label
             clear of the input glyph. -->
        <div class="floating-input">
          <input
            id="break-form-start-time"
            v-model="startTime"
            type="time"
            step="1800"
            class="floating-input__control"
          >
          <label
            for="break-form-start-time"
            class="floating-input__label floating-input__label--floated"
          >Start time</label>
        </div>
        <div
          class="floating-input"
          :class="{ 'floating-input--invalid': !!durationError }"
        >
          <input
            id="break-form-duration"
            v-model.number="durationMinutes"
            type="number"
            :step="ROW_GRANULARITY_MINUTES"
            min="30"
            :max="maxDurationMinutes"
            class="floating-input__control"
          >
          <label
            for="break-form-duration"
            class="floating-input__label floating-input__label--floated"
          >Duration (min)</label>
        </div>
      </div>
      <p
        v-if="durationError"
        class="break-form__field-error"
      >{{ durationError }}</p>

      <div class="floating-input break-form__label-input">
        <input
          id="break-form-label"
          v-model="label"
          type="text"
          maxlength="40"
          placeholder=" "
          class="floating-input__control"
        >
        <label
          for="break-form-label"
          class="floating-input__label"
        >Label (optional)</label>
      </div>

      <fieldset class="break-form__scope">
        <legend class="break-form__scope-legend">Applies to</legend>
        <div class="break-form__scope-pills">
          <label
            class="break-form__scope-pill"
            :class="{ 'break-form__scope-pill--active': scope === 'park' }"
          >
            <input
              type="radio"
              value="park"
              v-model="scope"
              class="break-form__scope-pill-radio"
            >
            <span class="break-form__scope-pill-label">Park-wide</span>
            <span class="break-form__scope-pill-hint">All fields</span>
          </label>
          <label
            class="break-form__scope-pill"
            :class="{ 'break-form__scope-pill--active': scope === 'field' }"
          >
            <input
              type="radio"
              value="field"
              v-model="scope"
              class="break-form__scope-pill-radio"
            >
            <span class="break-form__scope-pill-label">Single field</span>
            <span class="break-form__scope-pill-hint">Pick one</span>
          </label>
        </div>
        <div
          v-if="scope === 'field'"
          class="floating-input break-form__scope-field-select"
        >
          <select
            id="break-form-field"
            v-model="fieldName"
            class="floating-input__control floating-input__control--select"
          >
            <option v-for="f in fields" :key="f.id" :value="f.name">
              {{ f.name }}
            </option>
          </select>
          <label
            for="break-form-field"
            class="floating-input__label floating-input__label--floated"
          >Field</label>
        </div>
      </fieldset>

      <footer class="break-form__footer">
        <!-- Delete (EDIT mode only) — destructive, sits on the
             LEFT with `margin-right: auto` pushing the Cancel /
             Save buttons to the right edge. Replaces the inline
             remove icon button on the break card itself. -->
        <button
          v-if="editing"
          type="button"
          class="break-form__btn break-form__btn--danger"
          @click="emit('delete', editing)"
        >Delete</button>
        <button
          type="button"
          class="break-form__btn break-form__btn--ghost"
          @click="emit('close')"
        >Cancel</button>
        <button
          type="button"
          class="break-form__btn break-form__btn--primary"
          :disabled="!isValid"
          @click="onSave"
        >{{ editing ? 'Save changes' : 'Add break' }}</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.break-form-backdrop {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(13, 30, 58, 0.45);
  /* Match the blurred backdrop used by the other modals. */
  -webkit-backdrop-filter: blur(2px);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.break-form {
  width: 100%;
  max-width: 420px;
  /* Solid opaque surface — `var(--surface-card)` resolves to
     `rgba(255, 255, 255, 0.9)` in light mode, which let the
     calendar grid behind the backdrop bleed faintly through
     the popup. Using a solid `#ffffff` in light mode keeps
     the popup chrome fully opaque; dark mode keeps its own
     solid override below. */
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 18px 42px -12px rgba(13, 30, 58, 0.45);
  /* Bumped top padding (18 → 28) — the header's three-row
     heading (eyebrow date + title + subtitle) reads tighter
     when it sits flush close to the popup edge. Extra breathing
     room on top makes the eyebrow date feel anchored rather
     than crammed. */
  padding: 28px 22px 16px;
  color: var(--text);
}
html.dark-mode .break-form {
  background: #1f2731;
  box-shadow: 0 18px 42px -12px rgba(0, 0, 0, 0.7);
}
.break-form__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.break-form__heading {
  display: flex;
  flex-direction: column;
  /* Slightly more breathing room between title and subtitle
     now that the heading carries three lines (eyebrow date,
     title, subtitle). */
  gap: 3px;
  min-width: 0;
}
.break-form__heading .break-form__subtitle {
  /* Small additional bump above the subtitle so it reads as
     "supporting copy below the title" rather than touching
     the title baseline. */
  margin-top: 2px;
}
.break-form__eyebrow {
  font-size: 11px;
  font-weight: 600;
  color: var(--primary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  line-height: 1.2;
}
html.dark-mode .break-form__eyebrow {
  color: #7fb0e8;
}
.break-form__title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--text);
  line-height: 1.25;
}
.break-form__close {
  appearance: none;
  background: transparent;
  border: none;
  font-size: 24px;
  line-height: 1;
  color: var(--secondary);
  cursor: pointer;
}
/* Subtitle (third row inside the header, under the title) —
   carries the explainer text that was previously a separate
   `.break-form__hint` paragraph below the header. Grouping
   eyebrow + title + subtitle keeps the heading block visually
   self-contained and saves the vertical room the standalone
   paragraph used to take above the form fields. */
.break-form__subtitle {
  margin: 0;
  font-size: 12px;
  color: var(--secondary);
  line-height: 1.4;
}

/* Inline field-error — shown below the duration input when the
   value would push the break past the park's `dayEndTime`. Uses
   the same danger tone the portal forms (RegisterTeamModal,
   EventFormModal) use for their inline validation messages. */
.break-form__field-error {
  margin: 4px 0 8px;
  font-size: 11px;
  color: var(--danger, #b03e3e);
  line-height: 1.3;
}
html.dark-mode .break-form__field-error {
  color: #ef6f6f;
}
.break-form__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 12px;
}
/* Single-column label-input field (just sits below the row).
   Spacing only — the input chrome itself comes from the shared
   `.floating-input` pattern in `styles.css`. */
.break-form__label-input {
  margin-bottom: 14px;
}
.break-form__scope {
  border: 0;
  padding: 0;
  margin: 0 0 14px;
}
.break-form__scope-legend {
  font-size: 11px;
  font-weight: 600;
  color: var(--secondary);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 0;
  margin-bottom: 6px;
}
/* Modern segmented-pill picker — two tiles side by side. Each
   tile shows its primary label + a short secondary line. The
   `--active` variant flips to a primary-tinted fill with a
   visible border so the selection reads at a glance, without
   needing a separate radio dot. */
.break-form__scope-pills {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.break-form__scope-pill {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--border-divider);
  border-radius: 8px;
  background: var(--surface-card);
  cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease, box-shadow 120ms ease;
}
.break-form__scope-pill:hover {
  border-color: var(--primary-light-2, #b9d4f4);
  background: var(--primary-light-3);
}
html.dark-mode .break-form__scope-pill {
  background: rgba(255, 255, 255, 0.03);
}
html.dark-mode .break-form__scope-pill:hover {
  background: rgba(45, 140, 240, 0.10);
  border-color: rgba(45, 140, 240, 0.45);
}
.break-form__scope-pill--active {
  border-color: var(--primary);
  background: var(--primary-light-3);
  box-shadow: inset 0 0 0 1px var(--primary);
}
html.dark-mode .break-form__scope-pill--active {
  background: rgba(45, 140, 240, 0.15);
  border-color: var(--primary);
}
/* Native radio is hidden — the pill chrome carries the selected
   state visually. Keeping the input in the DOM preserves
   keyboard/focus semantics + form-binding. */
.break-form__scope-pill-radio {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.break-form__scope-pill-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.2;
}
.break-form__scope-pill--active .break-form__scope-pill-label {
  color: var(--primary);
}
html.dark-mode .break-form__scope-pill--active .break-form__scope-pill-label {
  color: #7fb0e8;
}
.break-form__scope-pill-hint {
  font-size: 11px;
  color: var(--secondary);
  line-height: 1.2;
}
.break-form__scope-field-select {
  margin-top: 16px;
}
.break-form__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 6px;
}
.break-form__btn {
  appearance: none;
  border-radius: 6px;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
}
.break-form__btn--ghost {
  background: transparent;
  border-color: var(--border-divider);
  color: var(--text);
}
/* Destructive — `margin-right: auto` pushes the Delete button
   to the LEFT edge of the footer, leaving Cancel + Save on
   the right. Tone family matches the portal's standard danger
   palette (see `.association-users__row-menu-item--danger`). */
.break-form__btn--danger {
  margin-right: auto;
  background: transparent;
  border-color: rgba(176, 62, 62, 0.55);
  color: #b03e3e;
}
.break-form__btn--danger:hover {
  background: #fdecec;
  color: #b03e3e;
}
html.dark-mode .break-form__btn--danger {
  border-color: rgba(239, 111, 111, 0.45);
  color: #ef6f6f;
}
html.dark-mode .break-form__btn--danger:hover {
  background: #3d2a30;
  color: #ef6f6f;
}
.break-form__btn--primary {
  background: var(--primary);
  /* `var(--white)` → dark text on the bright-blue primary in dark
     mode (same pattern as the dashboard "Add Division" button). */
  color: var(--white, #ffffff);
}
.break-form__btn--primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
