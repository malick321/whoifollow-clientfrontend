<script setup lang="ts">
// MatchGeniBracketFormModal
// -------------------------
// Slide-in modal for creating a new bracket OR editing an existing one
// inside a division (MatchGeni scheduler → Brackets tab). Single
// component, mode-driven by `bracketId`:
//   - `null` (or omitted) → New Bracket flow.
//   - non-null id         → Edit Bracket flow (hydrated from `bracket`).
//
// Fields mirror the provided design:
//   - Bracket Name        (floating-input text)
//   - Bracket Format      (floating-select, sourced from the live
//                          `GET /getBracketFormats` catalogue)
//   - Custom Team Selection (toggle) → when ON, reveals a multi-select
//                          team picker (same TagsMultiSelect control the
//                          event-official scoring-scope picker uses).
//   - Description         (floating-input textarea)
//
// Form-control styling is shared with the rest of the portal's modals
// (`.floating-input`, `.toggle-switch`, `.register-team-modal__*` from
// styles.css) so this drawer reads identically to EventFormModal.
//
// NOTE (pending backend): there is no bracket create/update endpoint or
// a per-division team-roster endpoint yet. `save()` is therefore a
// single isolated swap point (logs + emits `saved`), and the team
// catalogue comes from the `teamOptions` prop the parent derives. Both
// are clearly marked TODOs so wiring is a body-only change.

import { computed, ref, watch } from 'vue'
import SlideModal from './SlideModal.vue'
import ToggleSwitch from './ToggleSwitch.vue'
import TagsMultiSelect from './TagsMultiSelect.vue'
import { fetchBracketFormats } from '../api/bracketFormats'
import type { BracketFormatOption } from '../types'

const props = withDefaults(defineProps<{
  modelValue: boolean
  /** Division this bracket belongs to — shown as the header eyebrow. */
  divisionName?: string
  /** Bracket id to edit. `null` (or omitted) for the New flow. */
  bracketId?: string | null
  /** Existing bracket values for the Edit flow. */
  bracketName?: string
  bracketFormatId?: string
  description?: string
  customTeamSelection?: boolean
  selectedTeams?: string[]
  /** Catalogue of team labels available for custom selection. The
   *  parent derives this (real roster endpoint TBD). */
  teamOptions?: readonly string[]
  /** Edit mode only — show a "Cancel bracket" action (bracket is
   *  initiated/in_progress so it can be stopped for rain/other). */
  canCancel?: boolean
}>(), {
  divisionName: '',
  bracketId: null,
  bracketName: '',
  bracketFormatId: '',
  description: '',
  customTeamSelection: false,
  selectedTeams: () => [],
  teamOptions: () => [],
  canCancel: false
})

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'saved', payload: {
    bracketId: string | null
    name: string
    formatId: string
    description: string
    customTeamSelection: boolean
    teams: string[]
  }): void
  (event: 'delete', bracketId: string): void
  /** Stop the bracket (rain/other) — the host opens the reason form. */
  (event: 'cancel-bracket', bracketId: string): void
}>()

const isEdit = computed(() => props.bracketId !== null && props.bracketId !== undefined)
const title = computed(() => (isEdit.value ? 'Edit Bracket' : 'New Bracket'))

// ── Form fields ──────────────────────────────────────────────────
const name = ref('')
const formatId = ref('')
const descriptionText = ref('')
const customTeamSelection = ref(false)
const selectedTeams = ref<string[]>([])
const saving = ref(false)
const submitAttempted = ref(false)

// ── Bracket-format catalogue (live /getBracketFormats) ───────────
const formats = ref<BracketFormatOption[]>([])
const formatsLoading = ref(false)
let formatsLoaded = false

async function ensureFormats() {
  if (formatsLoaded || formatsLoading.value) return
  formatsLoading.value = true
  try {
    formats.value = await fetchBracketFormats()
    formatsLoaded = true
  } finally {
    formatsLoading.value = false
  }
}

function reset() {
  name.value = props.bracketName ?? ''
  formatId.value = props.bracketFormatId ?? ''
  descriptionText.value = props.description ?? ''
  customTeamSelection.value = props.customTeamSelection ?? false
  selectedTeams.value = [...(props.selectedTeams ?? [])]
  submitAttempted.value = false
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    reset()
    void ensureFormats()
  }
)

const errors = computed(() => {
  if (!submitAttempted.value) return new Set<string>()
  const errs = new Set<string>()
  if (!name.value.trim()) errs.add('name')
  if (!formatId.value) errs.add('formatId')
  if (customTeamSelection.value && selectedTeams.value.length === 0) errs.add('teams')
  return errs
})

function close() {
  if (saving.value) return
  emit('update:modelValue', false)
}

function onToggleCustomTeams(value: boolean) {
  customTeamSelection.value = value
  // Clear the picker when switching off so a stale selection doesn't
  // silently persist to save.
  if (!value) selectedTeams.value = []
}

async function save() {
  submitAttempted.value = true
  if (errors.value.size > 0) return
  saving.value = true
  try {
    // TODO — wire POST `/v2/.../brackets` (create) / PATCH
    // `/v2/.../brackets/{id}` (update) when the bracket API ships.
    // Single isolated swap point.
    emit('saved', {
      bracketId: props.bracketId ?? null,
      name: name.value.trim(),
      formatId: formatId.value,
      description: descriptionText.value.trim(),
      customTeamSelection: customTeamSelection.value,
      teams: customTeamSelection.value ? [...selectedTeams.value] : []
    })
    emit('update:modelValue', false)
  } finally {
    saving.value = false
  }
}

function onDelete() {
  if (!isEdit.value || !props.bracketId) return
  emit('delete', props.bracketId)
}

function onCancelBracket() {
  if (!isEdit.value || !props.bracketId) return
  emit('cancel-bracket', props.bracketId)
}
</script>

<template>
  <SlideModal
    :model-value="modelValue"
    :title="title"
    :eyebrow="divisionName"
    @update:modelValue="emit('update:modelValue', $event)"
  >
    <div class="register-team-modal__form matchgeni-bracket-form">
      <!-- Bracket name -->
      <div class="floating-input" :class="{ 'floating-input--invalid': errors.has('name') }">
        <input
          id="bracket-name"
          v-model="name"
          type="text"
          maxlength="120"
          class="floating-input__control"
          :class="{ 'floating-input__control--has-value': !!name }"
          placeholder=" "
        />
        <label for="bracket-name" class="floating-input__label">Bracket Name</label>
      </div>
      <span v-if="errors.has('name')" class="association-user-modal__error">
        Bracket name is required.
      </span>

      <!-- Bracket format (live /getBracketFormats) -->
      <div class="floating-input" :class="{ 'floating-input--invalid': errors.has('formatId') }">
        <select
          id="bracket-format"
          v-model="formatId"
          class="floating-input__control floating-input__control--select"
        >
          <option value="" disabled hidden></option>
          <option v-for="opt in formats" :key="opt.id" :value="opt.id">
            {{ opt.name }}
          </option>
        </select>
        <label
          for="bracket-format"
          class="floating-input__label"
          :class="{ 'floating-input__label--floated': !!formatId }"
        >{{ formatsLoading ? 'Loading formats…' : 'Bracket Format' }}</label>
      </div>
      <span v-if="errors.has('formatId')" class="association-user-modal__error">
        Select a bracket format.
      </span>

      <!-- Custom team selection toggle -->
      <label class="matchgeni-bracket-form__toggle-row">
        <span class="matchgeni-bracket-form__toggle-copy">
          <span class="matchgeni-bracket-form__toggle-label">Custom Team Selection</span>
          <span class="matchgeni-bracket-form__toggle-desc">
            Pick the specific teams in this bracket instead of using the division default.
          </span>
        </span>
        <ToggleSwitch
          :model-value="customTeamSelection"
          aria-label="Custom Team Selection"
          @update:modelValue="onToggleCustomTeams"
        />
      </label>

      <!-- Team multi-select — only when custom selection is on -->
      <div v-if="customTeamSelection" class="matchgeni-bracket-form__teams">
        <TagsMultiSelect
          v-model="selectedTeams"
          :options="teamOptions"
          placeholder="Type to pick teams…"
          aria-label="Pick teams"
        />
        <span v-if="errors.has('teams')" class="association-user-modal__error">
          Select at least one team, or turn off custom selection.
        </span>
      </div>

      <!-- Description -->
      <div class="floating-input">
        <textarea
          id="bracket-description"
          v-model="descriptionText"
          rows="3"
          class="floating-input__control"
          :class="{ 'floating-input__control--has-value': !!descriptionText }"
          placeholder=" "
        ></textarea>
        <label for="bracket-description" class="floating-input__label">Description (optional)</label>
      </div>
    </div>

    <template #footer>
      <button
        v-if="isEdit"
        class="danger-light-button"
        type="button"
        :disabled="saving"
        @click="onDelete"
      >
        Delete Bracket
      </button>
      <button
        v-if="isEdit && canCancel"
        class="secondary-button"
        type="button"
        :disabled="saving"
        @click="onCancelBracket"
      >
        Cancel Bracket
      </button>
      <span class="matchgeni-bracket-form__footer-spacer"></span>
      <button class="secondary-button" type="button" :disabled="saving" @click="close">
        Cancel
      </button>
      <button class="primary-button" type="button" :disabled="saving" @click="save">
        <span v-if="saving" class="btn-spinner" aria-hidden="true"></span>
        {{ saving ? 'Saving…' : (isEdit ? 'Save Changes' : 'Create Bracket') }}
      </button>
    </template>
  </SlideModal>
</template>

<style scoped>
.matchgeni-bracket-form__toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 6px 0;
  cursor: pointer;
}

.matchgeni-bracket-form__toggle-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.matchgeni-bracket-form__toggle-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.matchgeni-bracket-form__toggle-desc {
  font-size: 12px;
  color: var(--secondary);
  line-height: 1.4;
}

.matchgeni-bracket-form__teams {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* Push Cancel/Save to the right; Delete stays hard-left. */
.matchgeni-bracket-form__footer-spacer {
  flex: 1 1 auto;
}
</style>
