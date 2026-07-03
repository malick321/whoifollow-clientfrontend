<script setup lang="ts">
// MatchGeniDivisionFormModal
// --------------------------
// Slide-in wizard for creating a new division OR editing an existing
// one (MatchGeni → Divisions). Single component, mode-driven by
// `divisionId`:
//   - `null` (or omitted) → Add Division flow.
//   - non-null id         → Edit Division flow (hydrated from `division`).
//
// THREE steps (the production app's "Teams" step is intentionally
// dropped — pool creation + team assignment is a heavier job that
// doesn't belong in the creation wizard, and teams are often unknown at
// division-creation time; that work lives behind "Manage Team Pools"):
//   1. Division Info  — name, dates, optional custom format, time
//                       limits, team-restriction + serial-numbering
//                       toggles, notes.
//   2. Seed Criteria  — optional custom tie-breaker ordering (move +
//                       reorder between Available / Selected).
//   3. Field Config   — optional custom field configuration select.
//
// A live Summary rail mirrors the production layout. Form-control
// styling is shared with the rest of the portal's modals
// (`.floating-input`, `.toggle-switch`, `.tags-input`) so this reads
// identically to EventFormModal / the bracket form.
//
// Catalogues (all page-cached — see the api modules):
//   - Bracket formats  — `fetchBracketFormats` (shared with the bracket
//     + event forms; cached once per page so this popup, opened from the
//     dashboard, reuses the same list without re-hitting the backend).
//   - Age groups / ratings — `fetchAgeGroups` / `fetchRatings` over the
//     legacy `/getAgeGroup` + `/getAllRatings` endpoints.
//
// NOTE (pending backend): there is no division create/update endpoint
// yet, and no seed-criteria / field-config catalogue endpoints. `save()`
// is a single isolated swap point (emits `saved`); the seed-criteria +
// field-config catalogues are local mocks marked TODO.

import { computed, nextTick, ref, watch } from 'vue'
import SlideModal from './SlideModal.vue'
import ToggleSwitch from './ToggleSwitch.vue'
import TagsMultiSelect from './TagsMultiSelect.vue'
import DateRangePicker from './DateRangePicker.vue'
import FieldPositionPreview from './FieldPositionPreview.vue'
import { fetchBracketFormats } from '../api/bracketFormats'
import { fetchAgeGroups } from '../api/ageRatingCatalogue'
import { fetchRatings } from '../api/associationRatings'
import { currentAssociation } from '../constants/associations'
import { fetchSportType } from '../api/sportTypes'
import { fetchSeedingCriteria } from '../api/seedingCriteria'
import { createDivision, updateDivision } from '../api/matchGeniDivisions'
import type {
  AgeGroupOption,
  BracketFormatOption,
  CreateDivisionPayload,
  CreateDivisionResult,
  EventDefaults,
  EventTournament,
  FieldConfigurationOption,
  RatingOption,
  SeedingCriterionOption,
  SportTypeUmpireConfig
} from '../types'

const props = withDefaults(defineProps<{
  modelValue: boolean
  /** Association numeric id + event id/guid — the create/update path. */
  associationId?: string
  eventId?: string
  /** Division id to edit. `null` (or omitted) for the Add flow. */
  divisionId?: string | null
  /** Existing division for the Edit flow (hydrates name + dates). */
  division?: EventTournament | null
  /** Parent event name — shown in the summary rail header. */
  eventName?: string
  /** Event start/end (plain `YYYY-MM-DD`) — default division dates. */
  eventStartDate?: string
  eventEndDate?: string
  /** Event's IANA timezone (e.g. "America/Chicago"). Sent with the
   *  division so the backend can resolve start/end DATEs into UTC instants. */
  eventTimeZone?: string | null
  /** Event's sport type id — drives the field-configuration fetch. */
  sportsTypeId?: number | null
  /** Event-level config defaults the division inherits (time limits,
   *  guarantee, bracket format, field config). */
  defaults?: EventDefaults | null
}>(), {
  associationId: '',
  eventId: '',
  divisionId: null,
  division: null,
  eventName: '',
  eventStartDate: '',
  eventEndDate: '',
  eventTimeZone: null,
  sportsTypeId: null,
  defaults: null
})

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'saved', payload: DivisionSavedEvent): void
  (event: 'delete', divisionId: string): void
}>()

/** Emitted after a successful create/update so the host can toast +
 *  refresh its division list. */
export interface DivisionSavedEvent {
  name: string
  isEdit: boolean
  result: CreateDivisionResult
}

const isEdit = computed(() => props.divisionId !== null && props.divisionId !== undefined)
const title = computed(() => (isEdit.value ? 'Edit Division' : 'New Division'))

// Pool-play game guarantee choices for the custom-format dropdown.
const POOL_GUARANTEE_OPTIONS = ['1', '2', '3', '4', '5']

// ── Live catalogues (page-cached) ────────────────────────────────
// Bracket formats (shared cache with the bracket/event forms), age
// groups + ratings for the team-restriction multi-selects, the
// field-configuration list for the event's sport type, and the seeding
// criteria. Loaded lazily on first open; the cached promises mean later
// opens are instant. Full `{ id, name }` rows are kept (not just names)
// so the multi-selects can show labels while the payload sends ids.
const bracketFormats = ref<BracketFormatOption[]>([])
const ageGroupCatalogue = ref<AgeGroupOption[]>([])
const ratingCatalogue = ref<RatingOption[]>([])
const fieldConfigOptions = ref<FieldConfigurationOption[]>([])
const umpireConfigs = ref<SportTypeUmpireConfig[]>([])
const sportTypeName = ref('')
const seedCatalogue = ref<SeedingCriterionOption[]>([])
const ageGroupOptions = computed(() => ageGroupCatalogue.value.map((a) => a.name))
const ratingOptions = computed(() => ratingCatalogue.value.map((r) => r.name))
let cataloguesLoaded = false

async function ensureCatalogues() {
  if (cataloguesLoaded) return
  cataloguesLoaded = true
  // The event's sport type (fixed for the division) carries the field
  // configurations + umpire configs the Format-step card renders.
  const [formats, ages, rates, sportType, seeds] = await Promise.all([
    fetchBracketFormats(),
    fetchAgeGroups(),
    fetchRatings({ associationId: props.associationId, associationShortName: currentAssociation.value?.slug }),
    props.sportsTypeId != null ? fetchSportType(String(props.sportsTypeId)) : Promise.resolve(null),
    fetchSeedingCriteria()
  ])
  bracketFormats.value = formats
  ageGroupCatalogue.value = ages
  ratingCatalogue.value = rates
  fieldConfigOptions.value = sportType?.fieldConfigurations ?? []
  umpireConfigs.value = [...(sportType?.umpireConfigs ?? [])].sort((a, b) => a.sortOrder - b.sortOrder)
  sportTypeName.value = sportType?.name ?? ''
  seedCatalogue.value = seeds
}

// ── Stepper ──────────────────────────────────────────────────────
// Mirrors the event wizard: a LEFT vertical rail with three steps.
//   1. Details — name, dates, team restriction, serial, notes.
//   2. Format  — time limits + overridable format / seed / field config.
//   3. Review  — read-only confirmation (replaces the old summary rail).
type StepKey = 'details' | 'format' | 'review'
const STEPS: { key: StepKey; label: string; hint: string }[] = [
  { key: 'details', label: 'Details', hint: 'Name, dates, teams' },
  { key: 'format', label: 'Format', hint: 'Limits · seed · field' },
  { key: 'review', label: 'Review', hint: 'Confirm & save' }
]
const step = ref<StepKey>('details')
const stepIndex = computed(() => STEPS.findIndex((s) => s.key === step.value))
const isLastStep = computed(() => stepIndex.value === STEPS.length - 1)
const isFirstStep = computed(() => stepIndex.value === 0)

// ── Form fields ──────────────────────────────────────────────────
const name = ref('')
const startDate = ref('')
const endDate = ref('')
const poolPlayGuarantee = ref('')
const bracketFormatId = ref('')
const poolLimit = ref('')
const bracketLimit = ref('')
const championshipLimit = ref('')
const restrictTeams = ref(false)
const restrictedAgeGroups = ref<string[]>([])
const restrictedRatings = ref<string[]>([])
const serialNumbering = ref(true)
const notes = ref('')
const fieldConfig = ref('')
const selectedSeedIds = ref<string[]>([])

// Per-section override modes — each section (Format, Tie breakers, Field
// config) independently inherits the event default or overrides it, so the
// admin can customise just one parameter. Each uses an 'Event default | Custom'
// segmented switch (mirrors the in-person/online control).
type OverrideMode = 'default' | 'custom'
const formatMode = ref<OverrideMode>('default')
const seedMode = ref<OverrideMode>('default')
const fieldMode = ref<OverrideMode>('default')
const isFormatCustom = computed(() => formatMode.value === 'custom')
const isSeedCustom = computed(() => seedMode.value === 'custom')
const isFieldCustom = computed(() => fieldMode.value === 'custom')

// When a section flips Default → Custom, seed its controls from the event
// default so the admin starts from the inherited values (rather than an empty
// control). Only backfills an empty control — never clobbers a value the admin
// already entered, so toggling back and forth keeps their edits.
watch(formatMode, (mode, prev) => {
  if (mode !== 'custom' || prev !== 'default') return
  if (!poolPlayGuarantee.value && props.defaults?.poolPlayGuarantee != null) {
    poolPlayGuarantee.value = String(props.defaults.poolPlayGuarantee)
  }
  if (!bracketFormatId.value && props.defaults?.bracketFormatId) {
    bracketFormatId.value = props.defaults.bracketFormatId
  }
})
watch(fieldMode, (mode, prev) => {
  if (mode !== 'custom' || prev !== 'default') return
  if (!fieldConfig.value && props.defaults?.fieldConfigId) {
    fieldConfig.value = props.defaults.fieldConfigId
  }
})
watch(seedMode, (mode, prev) => {
  if (mode !== 'custom' || prev !== 'default' || selectedSeedIds.value.length) return
  // Inherit the event's explicit seed order when set, else the full catalogue
  // (the same set shown as the inherited tie breakers in Default mode).
  const explicit = (props.defaults?.seedCriteriaIds ?? []).filter((id) =>
    seedCatalogue.value.some((c) => c.id === id)
  )
  selectedSeedIds.value = explicit.length
    ? [...explicit]
    : seedCatalogue.value.map((c) => c.id)
})

// Tie breakers via the SAME TagsMultiSelect the event uses (selection order =
// tie-break priority). Bridged to/from the id list the payload sends.
const seedOptionNames = computed(() => seedCatalogue.value.map((c) => c.name))
const selectedSeedNames = computed<string[]>({
  get() {
    return selectedSeedIds.value
      .map((id) => seedCatalogue.value.find((c) => c.id === id)?.name)
      .filter((n): n is string => !!n)
  },
  set(names) {
    selectedSeedIds.value = names
      .map((n) => seedCatalogue.value.find((c) => c.name === n)?.id)
      .filter((id): id is string => !!id)
  }
})

// Event-level values shown (read-only) in 'default' mode so the admin sees
// the inherited config they're proceeding with.
const eventGuaranteeLabel = computed(() =>
  props.defaults?.poolPlayGuarantee ? `${props.defaults.poolPlayGuarantee} game round robin` : '—'
)
const eventBracketFormatName = computed(() =>
  bracketFormats.value.find((f) => f.id === props.defaults?.bracketFormatId)?.name ?? '—'
)
const eventFieldConfigName = computed(() =>
  fieldConfigOptions.value.find((f) => f.id === props.defaults?.fieldConfigId)?.name ?? '—'
)
const eventSeedNames = computed(() =>
  (props.defaults?.seedCriteriaIds ?? [])
    .map((id) => seedCatalogue.value.find((c) => c.id === id)?.name)
    .filter((n): n is string => !!n)
)
// Tie breakers shown in 'default' mode: the event's explicit seed order when it
// set one, otherwise the seeding criteria the division inherits by default (the
// full catalogue in priority order). Never the bare "Event default" placeholder
// — the admin should see the actual tie breakers that will apply.
const inheritedSeedNames = computed(() =>
  eventSeedNames.value.length ? eventSeedNames.value : seedOptionNames.value
)

// Per-step "attempted" flags — an error only paints once the user has
// tried to advance past the step that owns the field.
const detailsAttempted = ref(false)
const formatAttempted = ref(false)
// Which step each validated key belongs to (drives both the gated `errors`
// view and the per-step Next gate). The custom-only keys (guarantee /
// bracketFormat / fieldConfig / seed) only become required in Custom mode.
const DETAIL_KEYS = ['name', 'startDate', 'endDate', 'ageGroups', 'ratings']
const FORMAT_KEYS = ['pool', 'bracket', 'championship', 'guarantee', 'bracketFormat', 'fieldConfig', 'seed']
const saving = ref(false)
const saveError = ref('')

// Scroll the panel column back to the top on each open.
const mainRef = ref<HTMLElement | null>(null)

function reset() {
  step.value = 'details'
  const d = props.defaults
  const numToStr = (v: number | null | undefined) => (v == null ? '' : String(v))
  name.value = props.division?.tournamentName ?? ''
  // Dates default to the event's own start/end (plain YYYY-MM-DD from
  // the access payload). EventTournament carries no ISO dates of its
  // own, so the Edit flow also starts from the event dates. TODO:
  // prefer the division's persisted dates once they flow through.
  startDate.value = props.eventStartDate ?? ''
  endDate.value = props.eventEndDate ?? ''
  // Every section starts in 'Event default' mode. Pre-seed the override
  // controls from the event defaults so flipping a section to Custom starts
  // from the inherited values.
  formatMode.value = 'default'
  seedMode.value = 'default'
  fieldMode.value = 'default'
  poolPlayGuarantee.value = numToStr(d?.poolPlayGuarantee)
  bracketFormatId.value = d?.bracketFormatId ?? ''
  // Default time limits to the event values; fall back to 65 / 70 / 80
  // when the event hasn't set them.
  poolLimit.value = numToStr(d?.poolPlayTimeLimit) || '65'
  bracketLimit.value = numToStr(d?.bracketTimeLimit) || '70'
  championshipLimit.value = numToStr(d?.championshipTimeLimit) || '80'
  restrictTeams.value = false
  restrictedAgeGroups.value = []
  restrictedRatings.value = []
  serialNumbering.value = true
  notes.value = ''
  // Pre-fill the tie breakers + field config from the event defaults so the
  // Custom view starts from the inherited order/config.
  selectedSeedIds.value = [...(d?.seedCriteriaIds ?? [])]
  fieldConfig.value = d?.fieldConfigId ?? ''
  detailsAttempted.value = false
  formatAttempted.value = false
  saveError.value = ''
  // Reset the panel scroll on each open.
  void nextTick(() => { if (mainRef.value) mainRef.value.scrollTop = 0 })
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      reset()
      void ensureCatalogues()
    }
  }
)

// ── Validation (only the Division Info step gates progress) ──────
// `fieldErrors` evaluates UNCONDITIONALLY (always reads every field) so
// Vue tracks all of them as reactive deps — that's what makes a red
// field clear the instant its value is filled. `errors` is the gated
// view used by the template: empty until the user attempts to submit,
// then it mirrors `fieldErrors` live.
//
// Required: name, both dates, all three time limits. Conditionally
// required: pool-play guarantee + bracket format (when custom format
// is on); at least one age group + one rating (when team restriction
// is on).
function isBlank(v: unknown): boolean {
  return String(v ?? '').trim().length === 0
}
const fieldErrors = computed(() => {
  const errs = new Set<string>()
  if (isBlank(name.value)) errs.add('name')
  if (isBlank(startDate.value)) errs.add('startDate')
  if (isBlank(endDate.value)) errs.add('endDate')
  if (isBlank(poolLimit.value)) errs.add('pool')
  if (isBlank(bracketLimit.value)) errs.add('bracket')
  if (isBlank(championshipLimit.value)) errs.add('championship')
  // Each section's override fields become required only when that section is
  // in Custom mode.
  if (isFormatCustom.value) {
    if (isBlank(poolPlayGuarantee.value)) errs.add('guarantee')
    if (isBlank(bracketFormatId.value)) errs.add('bracketFormat')
  }
  if (isFieldCustom.value && isBlank(fieldConfig.value)) errs.add('fieldConfig')
  if (isSeedCustom.value && selectedSeedIds.value.length === 0) errs.add('seed')
  if (restrictTeams.value) {
    if (restrictedAgeGroups.value.length === 0) errs.add('ageGroups')
    if (restrictedRatings.value.length === 0) errs.add('ratings')
  }
  return errs
})
// Gated error view: a key shows only after its OWNING step was attempted.
const errors = computed(() => {
  const fe = fieldErrors.value
  const out = new Set<string>()
  if (detailsAttempted.value) DETAIL_KEYS.forEach((k) => { if (fe.has(k)) out.add(k) })
  if (formatAttempted.value) FORMAT_KEYS.forEach((k) => { if (fe.has(k)) out.add(k) })
  return out
})
function detailsHasErrors() { return DETAIL_KEYS.some((k) => fieldErrors.value.has(k)) }
function formatHasErrors() { return FORMAT_KEYS.some((k) => fieldErrors.value.has(k)) }

// ── Date display (read-only text mirrors the app's date controls) ─
function formatDateDisplay(iso: string): string {
  if (!iso) return ''
  const [yearStr, monthStr, dayStr] = iso.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr)
  const day = Number(dayStr)
  if (!year || !month || !day) return ''
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[month - 1]} ${String(day).padStart(2, '0')}, ${year}`
}

// ── Summary rail ─────────────────────────────────────────────────
const summaryDateRange = computed(() => {
  const s = formatDateDisplay(startDate.value)
  const e = formatDateDisplay(endDate.value)
  if (s && e) return `${s} to ${e}`
  return s || e || ''
})
const selectedBracketFormatName = computed(() =>
  bracketFormats.value.find((f) => f.id === bracketFormatId.value)?.name ?? ''
)
const summaryFormat = computed(() => {
  if (!isFormatCustom.value) return 'Event default'
  const guarantee = poolPlayGuarantee.value ? `${poolPlayGuarantee.value} game round robin` : ''
  const fmt = selectedBracketFormatName.value
  if (guarantee && fmt) return `${guarantee} · ${fmt} bracket`
  return guarantee || fmt || 'Custom format.'
})
const summaryAges = computed(() => {
  if (!restrictTeams.value) return 'All ages and ratings are allowed.'
  // Only surface what's actually selected — no "any age" placeholders.
  const parts: string[] = []
  if (restrictedAgeGroups.value.length) parts.push(restrictedAgeGroups.value.join(', '))
  if (restrictedRatings.value.length) parts.push(restrictedRatings.value.join(', '))
  return parts.length ? parts.join(' — ') : '—'
})
const summarySeed = computed(() =>
  isSeedCustom.value
    ? (selectedSeedNames.value.join(', ') || '—')
    : (inheritedSeedNames.value.join(', ') || '—')
)
const selectedFieldConfigName = computed(() =>
  fieldConfigOptions.value.find((f) => f.id === fieldConfig.value)?.name ?? ''
)
const summaryField = computed(() =>
  isFieldCustom.value ? (selectedFieldConfigName.value || '—') : (eventFieldConfigName.value || 'Event default')
)
const summaryTimeLimits = computed(() =>
  `${poolLimit.value || '—'} / ${bracketLimit.value || '—'} / ${championshipLimit.value || '—'} min  (pool / bracket / championship)`
)
const summarySerial = computed(() =>
  serialNumbering.value ? 'Continuous across all pools' : 'Restarts per pool'
)

// ── Field-config diagram preview ─────────────────────────────────
// The config whose layout we preview: the selected one when custom is
// on, otherwise the event default. Rendered by the shared
// <FieldPositionPreview>; `fieldPreviewPins` only gates whether to show it.
const previewFieldConfigId = computed(() =>
  isFieldCustom.value ? fieldConfig.value : (props.defaults?.fieldConfigId ?? '')
)
const previewFieldConfig = computed(() =>
  fieldConfigOptions.value.find((f) => f.id === previewFieldConfigId.value) ?? null
)
// Pins = positions that carry real x/y and aren't disabled.
const fieldPreviewPins = computed(() =>
  (previewFieldConfig.value?.positions ?? [])
    .filter((p) => p.status !== 0 && typeof p.xAxis === 'number' && typeof p.yAxis === 'number')
    .map((p) => ({ code: p.code, xAxis: p.xAxis as number, yAxis: p.yAxis as number }))
)

// ── Navigation ───────────────────────────────────────────────────
/** Edit mode — hand the delete up to the host (it confirms + calls the
 *  API + closes). */
function onDelete() {
  if (!isEdit.value || !props.divisionId || saving.value) return
  emit('delete', props.divisionId)
}
function goPrevious() {
  if (isFirstStep.value) return
  step.value = STEPS[stepIndex.value - 1].key
}
/** Rail click target — edit jumps anywhere (every step is already valid);
 *  create only revisits a step at or before the current one (forward moves go
 *  through Next so each step's gate runs). Mirrors the event wizard. */
function canVisit(i: number): boolean {
  return isEdit.value || i <= stepIndex.value
}
function goToStep(key: StepKey) {
  const target = STEPS.findIndex((s) => s.key === key)
  if (target >= 0 && canVisit(target)) step.value = key
}
function primary() {
  // Details gates on name + dates (+ ages/ratings when restricted).
  if (step.value === 'details') {
    detailsAttempted.value = true
    if (detailsHasErrors()) return
  }
  // Format gates on the time limits, plus the override fields (incl. ≥1 tie
  // breaker) when Custom mode is on — all captured in FORMAT_KEYS.
  if (step.value === 'format') {
    formatAttempted.value = true
    if (formatHasErrors()) return
  }
  if (isLastStep.value) {
    save()
    return
  }
  step.value = STEPS[stepIndex.value + 1].key
}
// Non-final steps advance ("Next"); the final step commits ("Save").
const primaryLabel = computed(() => (isLastStep.value ? 'Save' : 'Next'))

/** Map selected labels (from the TagsMultiSelect) back to catalogue
 *  ids for the payload. */
function namesToIds<T extends { id: string; name: string }>(names: string[], catalogue: T[]): string[] {
  return names
    .map((n) => catalogue.find((c) => c.name === n)?.id)
    .filter((id): id is string => !!id)
}

function buildPayload(): CreateDivisionPayload {
  const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v))
  return {
    tournamentName: name.value.trim(),
    startDate: startDate.value,
    endDate: endDate.value,
    // Event IANA tz so the backend can combine the plain start/end DATEs into
    // UTC instants (start-of-day / end-of-day in this zone).
    timeZone: props.eventTimeZone ?? null,
    poolPlayTime: numOrNull(poolLimit.value),
    bracketTime: numOrNull(bracketLimit.value),
    championshipTime: numOrNull(championshipLimit.value),
    continuousTeamSrNo: serialNumbering.value,
    // Each section sends its toggle flag (always) plus its value(s) only when
    // overriding; in Default mode the value fields are null/empty so the
    // backend applies the event default.
    // Format → custom_format (1 = custom, send guarantee + bracket format).
    customFormat: isFormatCustom.value,
    poolPlayGuarantee: isFormatCustom.value ? numOrNull(poolPlayGuarantee.value) : null,
    bracketFormatId: isFormatCustom.value ? (bracketFormatId.value || null) : null,
    // Restrict Team Entry → restrict_teams_entry (1 = restricted, send the lists).
    restrictTeamsEntry: restrictTeams.value,
    ageGroupIds: restrictTeams.value ? namesToIds(restrictedAgeGroups.value, ageGroupCatalogue.value) : [],
    ratingIds: restrictTeams.value ? namesToIds(restrictedRatings.value, ratingCatalogue.value) : [],
    // Tie breakers → use_event_seed (1 = inherit; custom sends the ordered list).
    useEventSeed: !isSeedCustom.value,
    seedCriteria: isSeedCustom.value
      ? selectedSeedIds.value.map((id, i) => ({ seedingCriteriaId: id, order: i + 1 }))
      : [],
    // Field config → use_event_field_config (1 = inherit; custom sends the id).
    useEventFieldConfig: !isFieldCustom.value,
    fieldConfigId: isFieldCustom.value ? (fieldConfig.value || null) : null,
    notes: notes.value.trim()
  }
}

async function save() {
  // Re-assert each step's gate before committing, jumping back to the
  // first step that has a problem.
  detailsAttempted.value = true
  if (detailsHasErrors()) { step.value = 'details'; return }
  formatAttempted.value = true
  if (formatHasErrors()) { step.value = 'format'; return }
  if (!props.associationId || !props.eventId) {
    saveError.value = 'Missing event context — cannot save.'
    return
  }
  saving.value = true
  saveError.value = ''
  try {
    const payload = buildPayload()
    const result = props.divisionId
      ? await updateDivision(props.associationId, props.eventId, props.divisionId, payload)
      : await createDivision(props.associationId, props.eventId, payload)
    emit('saved', { name: payload.tournamentName, isEdit: !!props.divisionId, result })
    emit('update:modelValue', false)
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : 'Could not save the division. Please try again.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <SlideModal
    :model-value="modelValue"
    :title="title"
    size="full"
    flush-body
    @update:modelValue="emit('update:modelValue', $event)"
  >
    <template #title-block>
      <span v-if="eventName" class="slide-modal-panel__eyebrow">{{ eventName }}</span>
      <h2 class="slide-modal-panel__title">{{ title }}</h2>
    </template>

    <div class="mg-div-form">
      <!-- LEFT rail — vertical stepper (matches the event wizard). -->
      <nav class="mg-div-form__rail" aria-label="Division steps">
        <ol class="mg-div-form__steps">
          <li
            v-for="(s, i) in STEPS"
            :key="s.key"
            class="mg-div-form__step"
            :class="{
              'mg-div-form__step--active': s.key === step,
              'mg-div-form__step--done': i < stepIndex
            }"
          >
            <button
              type="button"
              class="mg-div-form__step-btn"
              :disabled="!canVisit(i)"
              @click="goToStep(s.key)"
            >
              <span class="mg-div-form__step-node" aria-hidden="true">
                <span v-if="i < stepIndex" class="mg-div-form__step-check"></span>
                <span v-else class="mg-div-form__step-num">{{ i + 1 }}</span>
              </span>
              <span class="mg-div-form__step-text">
                <span class="mg-div-form__step-label">{{ s.label }}</span>
                <span class="mg-div-form__step-hint">{{ s.hint }}</span>
              </span>
            </button>
          </li>
        </ol>
      </nav>

      <div ref="mainRef" class="mg-div-form__main">

        <!-- STEP 1 — Details -->
        <div v-show="step === 'details'" class="mg-div-form__panel">
          <div class="floating-input" :class="{ 'floating-input--invalid': errors.has('name') }">
            <input
              id="div-name"
              v-model="name"
              type="text"
              maxlength="120"
              class="floating-input__control"
              :class="{ 'floating-input__control--has-value': !!name }"
              placeholder=" "
            />
            <label for="div-name" class="floating-input__label">Division Name</label>
            <span v-if="errors.has('name')" class="floating-input__error-corner">Required</span>
          </div>

          <!-- Date range — shared in-app DateRangePicker (same control as
               the event wizard). Division dates are plain YYYY-MM-DD. -->
          <div class="mg-div-form__field">
            <DateRangePicker
              :model-start="startDate"
              :model-end="endDate"
              :min-date="eventStartDate"
              :max-date="eventEndDate"
              :invalid="errors.has('startDate') || errors.has('endDate')"
              placeholder="Select division dates"
              aria-label="Division dates"
              @update:model-start="startDate = $event"
              @update:model-end="endDate = $event"
            />
            <span v-if="errors.has('startDate') || errors.has('endDate')" class="mg-div-form__field-error">Pick a start and end date.</span>
          </div>

          <label class="mg-div-form__toggle-row">
            <span class="mg-div-form__toggle-copy">
              <span class="mg-div-form__toggle-label">Restrict Team Entry</span>
              <span class="mg-div-form__toggle-desc">Only teams matching the selected age groups and ratings can be added to this division.</span>
            </span>
            <ToggleSwitch v-model="restrictTeams" aria-label="Restrict teams" />
          </label>
          <!-- Team restriction → Age Group + Rating multi-selects (same
               TagsMultiSelect control as the bracket form; options from
               the cached /getAgeGroup + /getAllRatings catalogues). -->
          <div v-if="restrictTeams" class="mg-div-form__row">
            <div class="mg-div-form__field">
              <TagsMultiSelect
                v-model="restrictedAgeGroups"
                :options="ageGroupOptions"
                placeholder="Pick age groups…"
                aria-label="Age groups"
              />
              <span v-if="errors.has('ageGroups')" class="mg-div-form__field-error">Pick at least one age group</span>
            </div>
            <div class="mg-div-form__field">
              <TagsMultiSelect
                v-model="restrictedRatings"
                :options="ratingOptions"
                placeholder="Pick ratings…"
                aria-label="Ratings"
              />
              <span v-if="errors.has('ratings')" class="mg-div-form__field-error">Pick at least one rating</span>
            </div>
          </div>

          <label class="mg-div-form__toggle-row">
            <span class="mg-div-form__toggle-copy">
              <span class="mg-div-form__toggle-label">Teams Serial #</span>
              <span class="mg-div-form__toggle-desc">Maintain continuous team serial numbering across all pools.</span>
            </span>
            <ToggleSwitch v-model="serialNumbering" aria-label="Team serial numbering" />
          </label>

          <div class="floating-input">
            <textarea
              id="div-notes"
              v-model="notes"
              rows="3"
              class="floating-input__control"
              :class="{ 'floating-input__control--has-value': !!notes }"
              placeholder=" "
            ></textarea>
            <label for="div-notes" class="floating-input__label">Notes</label>
          </div>
        </div>

        <!-- STEP 2 — Format (event-style: field-config card LEFT, controls RIGHT).
             Each section has its own Event-default / Custom switch. -->
        <div v-show="step === 'format'" class="mg-div-form__panel mg-div-form__panel--wide">
          <div class="mg-div-form__cols">
            <!-- LEFT: field-config card. Sport type is inherited (read-only); the
                 field-config switch + dropdown live ON the card. -->
            <div class="mg-div-form__col">
              <div class="mg-div-form__fieldcard">
                <div class="mg-div-form__fieldcard-head">
                  <span class="mg-div-form__fieldcard-value">{{ sportTypeName || '—' }}</span>
                  <div class="mg-div-form__seg mg-div-form__seg--on-field" role="tablist" aria-label="Field configuration source">
                    <button type="button" role="tab" class="mg-div-form__seg-btn" :class="{ 'mg-div-form__seg-btn--active': !isFieldCustom }" :aria-selected="!isFieldCustom" @click="fieldMode = 'default'">Default</button>
                    <button type="button" role="tab" class="mg-div-form__seg-btn" :class="{ 'mg-div-form__seg-btn--active': isFieldCustom }" :aria-selected="isFieldCustom" @click="fieldMode = 'custom'">Custom</button>
                  </div>
                </div>
                <div v-if="isFieldCustom" class="mg-div-form__fieldselect" :class="{ 'mg-div-form__fieldselect--invalid': errors.has('fieldConfig') }">
                  <select id="div-field" v-model="fieldConfig" class="mg-div-form__fieldselect-control">
                    <option value="" disabled>Select field configuration</option>
                    <option v-for="f in fieldConfigOptions" :key="f.id" :value="f.id">{{ f.name }}</option>
                  </select>
                  <span v-if="errors.has('fieldConfig')" class="floating-input__error-corner">Required</span>
                </div>
                <div class="mg-div-form__fieldcard-pitch">
                  <FieldPositionPreview
                    :positions="previewFieldConfig?.positions ?? []"
                    :field-config-name="previewFieldConfig?.name"
                  />
                </div>
                <div v-if="umpireConfigs.length" class="mg-div-form__umpires">
                  <span class="mg-div-form__umpires-title">Umpires</span>
                  <span
                    v-for="u in umpireConfigs"
                    :key="u.id"
                    class="mg-div-form__umpire-row"
                  >{{ u.code }} - {{ u.name }}</span>
                </div>
              </div>
            </div>

            <!-- RIGHT: controls — Format, Tie Breakers, Time limits. -->
            <div class="mg-div-form__col">
              <div class="mg-div-form__subhead-row">
                <h3 class="mg-div-form__subhead">Format</h3>
                <div class="mg-div-form__seg" role="tablist" aria-label="Format source">
                  <button type="button" role="tab" class="mg-div-form__seg-btn" :class="{ 'mg-div-form__seg-btn--active': !isFormatCustom }" :aria-selected="!isFormatCustom" @click="formatMode = 'default'">Default</button>
                  <button type="button" role="tab" class="mg-div-form__seg-btn" :class="{ 'mg-div-form__seg-btn--active': isFormatCustom }" :aria-selected="isFormatCustom" @click="formatMode = 'custom'">Custom</button>
                </div>
              </div>
              <template v-if="isFormatCustom">
                <div class="floating-input mg-div-form__field" :class="{ 'floating-input--invalid': errors.has('guarantee') }">
                  <select id="div-guarantee" v-model="poolPlayGuarantee" class="floating-input__control floating-input__control--select" :class="{ 'floating-input__control--has-value': !!poolPlayGuarantee }">
                    <option value="" disabled hidden></option>
                    <option v-for="g in POOL_GUARANTEE_OPTIONS" :key="g" :value="g">{{ g }} game round robin</option>
                  </select>
                  <label for="div-guarantee" class="floating-input__label" :class="{ 'floating-input__label--floated': !!poolPlayGuarantee }">Pool play guaranteed</label>
                  <span v-if="errors.has('guarantee')" class="floating-input__error-corner">Required</span>
                </div>
                <div class="floating-input mg-div-form__field" :class="{ 'floating-input--invalid': errors.has('bracketFormat') }">
                  <select id="div-bracket-format" v-model="bracketFormatId" class="floating-input__control floating-input__control--select" :class="{ 'floating-input__control--has-value': !!bracketFormatId }">
                    <option value="" disabled hidden></option>
                    <option v-for="f in bracketFormats" :key="f.id" :value="f.id">{{ f.name }}</option>
                  </select>
                  <label for="div-bracket-format" class="floating-input__label" :class="{ 'floating-input__label--floated': !!bracketFormatId }">Bracket format</label>
                  <span v-if="errors.has('bracketFormat')" class="floating-input__error-corner">Required</span>
                </div>
              </template>
              <dl v-else class="mg-div-form__inherit">
                <div class="mg-div-form__inherit-row"><dt>Pool play guaranteed</dt><dd>{{ eventGuaranteeLabel }}</dd></div>
                <div class="mg-div-form__inherit-row"><dt>Bracket format</dt><dd>{{ eventBracketFormatName }}</dd></div>
              </dl>

              <div class="mg-div-form__subhead-row">
                <h3 class="mg-div-form__subhead">Tie Breakers</h3>
                <div class="mg-div-form__seg" role="tablist" aria-label="Tie breakers source">
                  <button type="button" role="tab" class="mg-div-form__seg-btn" :class="{ 'mg-div-form__seg-btn--active': !isSeedCustom }" :aria-selected="!isSeedCustom" @click="seedMode = 'default'">Default</button>
                  <button type="button" role="tab" class="mg-div-form__seg-btn" :class="{ 'mg-div-form__seg-btn--active': isSeedCustom }" :aria-selected="isSeedCustom" @click="seedMode = 'custom'">Custom</button>
                </div>
              </div>
              <p v-if="errors.has('seed')" class="mg-div-form__field-error">Select at least one tie breaker</p>
              <TagsMultiSelect
                v-if="isSeedCustom"
                v-model="selectedSeedNames"
                :options="seedOptionNames"
                placeholder="Select tie breakers"
                aria-label="Division tie breakers"
              />
              <p v-else class="mg-div-form__inherit-text">{{ inheritedSeedNames.join(', ') || '—' }}</p>

              <h3 class="mg-div-form__subhead">Time limits (minutes)</h3>
              <p class="mg-div-form__hint">Pre-filled from the event — override for this division if needed.</p>
              <div class="mg-div-form__row mg-div-form__row--3">
                <div class="floating-input mg-div-form__field" :class="{ 'floating-input--invalid': errors.has('pool') }">
                  <input id="div-pool" v-model="poolLimit" type="number" min="0" step="5" class="floating-input__control floating-input__control--has-value" />
                  <label for="div-pool" class="floating-input__label floating-input__label--floated">Pool play</label>
                  <span v-if="errors.has('pool')" class="floating-input__error-corner">Required</span>
                </div>
                <div class="floating-input mg-div-form__field" :class="{ 'floating-input--invalid': errors.has('bracket') }">
                  <input id="div-bracket" v-model="bracketLimit" type="number" min="0" step="5" class="floating-input__control floating-input__control--has-value" />
                  <label for="div-bracket" class="floating-input__label floating-input__label--floated">Bracket</label>
                  <span v-if="errors.has('bracket')" class="floating-input__error-corner">Required</span>
                </div>
                <div class="floating-input mg-div-form__field" :class="{ 'floating-input--invalid': errors.has('championship') }">
                  <input id="div-champ" v-model="championshipLimit" type="number" min="0" step="5" class="floating-input__control floating-input__control--has-value" />
                  <label for="div-champ" class="floating-input__label floating-input__label--floated">Championship</label>
                  <span v-if="errors.has('championship')" class="floating-input__error-corner">Required</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- STEP 3 — Review (read-only confirmation) -->
        <div v-show="step === 'review'" class="mg-div-form__panel">
          <div class="app-banner app-banner--primary mg-div-form__review-banner">
            <div class="app-banner__text">
              <strong class="app-banner__title">{{ isEdit ? 'Almost there — review your changes' : 'Almost there — give it a final look' }}</strong>
              <span class="app-banner__sub">
                {{ isEdit
                  ? 'Check the division details below, then tap Save to update it.'
                  : 'Check the division details below, then tap Save to create it.' }}
              </span>
            </div>
          </div>
          <div class="mg-div-form__review-head">
            <span class="mg-div-form__review-badge" aria-hidden="true">{{ (name.trim()[0] || 'D').toUpperCase() }}</span>
            <span class="mg-div-form__review-name">{{ name || '—' }}</span>
          </div>
          <dl class="mg-div-form__review">
            <div><dt>Dates</dt><dd>{{ summaryDateRange || '—' }}</dd></div>
            <div><dt>Ages &amp; ratings</dt><dd>{{ summaryAges }}</dd></div>
            <div><dt>Team serial #</dt><dd>{{ summarySerial }}</dd></div>
            <div><dt>Time limits</dt><dd>{{ summaryTimeLimits }}</dd></div>
            <div><dt>Format</dt><dd>{{ summaryFormat }}</dd></div>
            <div><dt>Tie breakers</dt><dd>{{ summarySeed }}</dd></div>
            <div><dt>Field config</dt><dd>{{ summaryField }}</dd></div>
            <div v-if="notes.trim()"><dt>Notes</dt><dd>{{ notes.trim() }}</dd></div>
          </dl>
        </div>
      </div>
    </div>

    <template #footer>
      <button
        v-if="!isFirstStep"
        class="secondary-button"
        type="button"
        :disabled="saving"
        @click="goPrevious"
      >Previous</button>
      <!-- Edit mode — delete sits just after Previous on the left. -->
      <button
        v-if="isEdit"
        class="danger-light-button"
        type="button"
        :disabled="saving"
        @click="onDelete"
      >Delete Division</button>
      <span v-if="saveError" class="mg-div-form__save-error" role="alert">{{ saveError }}</span>
      <span class="mg-div-form__footer-spacer"></span>
      <button
        class="primary-button"
        type="button"
        :disabled="saving"
        @click="primary"
      ><span v-if="saving" class="btn-spinner" aria-hidden="true"></span>{{ saving ? 'Saving…' : primaryLabel }}</button>
    </template>
  </SlideModal>
</template>

<style scoped>
.mg-div-form {
  /* LEFT vertical step rail + scrolling panel column — same shell as the
     event wizard (SlideModal size="full" + flush-body, header from the
     modal's #title-block slot). */
  display: grid;
  grid-template-columns: 248px 1fr;
  min-height: 100%;
  min-width: 0;
}
@media (max-width: 720px) {
  .mg-div-form {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* ── Left rail stepper (matches .mg-evt-form__rail) ── */
.mg-div-form__rail {
  border-right: 1px solid #e4e7ec;
  background: #f4f5f7;
  padding: 20px 14px;
}
html.dark-mode .mg-div-form__rail {
  background: rgba(255, 255, 255, 0.05);
  border-right-color: rgba(255, 255, 255, 0.12);
}
@media (max-width: 720px) {
  .mg-div-form__rail { border-right: none; border-bottom: 1px solid #e4e7ec; }
  html.dark-mode .mg-div-form__rail { border-bottom-color: rgba(255, 255, 255, 0.12); }
}
.mg-div-form__steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
@media (max-width: 720px) {
  .mg-div-form__steps { flex-direction: row; flex-wrap: wrap; gap: 8px; }
}
.mg-div-form__step { margin: 0; }
.mg-div-form__step-btn {
  appearance: none;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: none;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
  color: var(--text);
}
.mg-div-form__step-btn:hover:not(:disabled) { background: var(--surface-card); }
.mg-div-form__step-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.mg-div-form__step--active .mg-div-form__step-btn { background: var(--surface-card); box-shadow: inset 0 0 0 1px var(--border-divider); }
.mg-div-form__step-node {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  background: var(--surface-card);
  border: 1px solid var(--border-divider);
  color: var(--secondary);
}
.mg-div-form__step--active .mg-div-form__step-node { background: var(--primary); border-color: var(--primary); color: #fff; }
.mg-div-form__step--done .mg-div-form__step-node { background: var(--primary-light-3, #eef4fd); border-color: var(--primary); color: var(--primary); }
.mg-div-form__step-check {
  width: 20px; height: 20px;
  background-color: var(--primary);
  -webkit-mask: url('../assets/tick-circle-twotone.svg') center / contain no-repeat;
  mask: url('../assets/tick-circle-twotone.svg') center / contain no-repeat;
}
.mg-div-form__step-text { display: flex; flex-direction: column; min-width: 0; }
.mg-div-form__step-label { font-size: 14px; font-weight: 600; }
.mg-div-form__step-hint { font-size: 11px; color: var(--secondary); }
@media (max-width: 720px) {
  .mg-div-form__step-hint { display: none; }
}

/* Group hint under a section title (e.g. time limits default-from-event). */
.mg-div-form__group-hint { margin: 2px 0 8px; font-size: 13px; color: var(--secondary); }

/* Review step — read-only confirmation grid (mirrors the event wizard). */
.mg-div-form__review-banner { margin-bottom: 16px; }
/* Review header — division name on top with an initials badge (no image),
   mirroring the team / event review headers. */
.mg-div-form__review-head { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
.mg-div-form__review-badge {
  flex: 0 0 auto;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 700;
  background: var(--primary-light-3, #eef4fd);
  color: var(--primary);
}
.mg-div-form__review-name { font-size: 18px; font-weight: 600; color: var(--text); min-width: 0; }
.mg-div-form__review { margin: 0; display: flex; flex-direction: column; gap: 0; }
.mg-div-form__review > div {
  display: grid;
  grid-template-columns: 160px 1fr;
  gap: 16px;
  padding: 10px 0;
  border-top: 1px solid var(--border-divider);
}
.mg-div-form__review > div:first-child { border-top: none; }
.mg-div-form__review dt { margin: 0; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--secondary); }
.mg-div-form__review dd { margin: 0; font-size: 14px; color: var(--text); }
@media (max-width: 720px) {
  .mg-div-form__review > div { grid-template-columns: 1fr; gap: 2px; }
}

/* Main panel column (matches .mg-evt-form__panel-wrap). */
.mg-div-form__main {
  min-width: 0;
  padding: 22px 24px 24px;
  overflow-y: auto;
}

/* (Old top-bar + horizontal-stepper + summary CSS removed — the wizard now
   uses a LEFT vertical rail; rail/step/close/review styles live above.) */

/* ── Panel + rows ── */
.mg-div-form__panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  /* Center the form content in a readable column (matches .mg-evt-form__panel). */
  max-width: 720px;
  margin-left: auto;
  margin-right: auto;
  width: 100%;
}
/* Format step is two columns → wider readable cap (matches the event). */
.mg-div-form__panel--wide { max-width: 940px; }

/* ── Format step: two columns + field-config card (mirrors the event) ── */
.mg-div-form__cols { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 4px; align-items: stretch; }
.mg-div-form__col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
@media (max-width: 720px) {
  .mg-div-form__cols { grid-template-columns: minmax(0, 1fr); }
}
.mg-div-form__field { margin: 0; }
/* Section heading with the blue left accent (matches .mg-evt-form__subhead). */
.mg-div-form__subhead {
  margin: 0; padding-left: 10px; border-left: 3px solid var(--primary, #2d8cf0);
  font-size: 1rem; font-weight: 500; color: var(--text); line-height: 1.2;
}
.mg-div-form__subhead-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.mg-div-form__hint { margin: 0; font-size: 13px; color: var(--secondary); }

/* Default / Custom segmented switch — same pill-group treatment as the event
   wizard's in-person/online toggle (.mg-evt-form__seg). */
.mg-div-form__seg {
  display: inline-flex; align-self: flex-start; flex: 0 0 auto; gap: 8px; padding: 4px;
  border: 1px solid var(--border-divider); border-radius: 10px; background: var(--surface-muted, #f4f7fb);
}
html.dark-mode .mg-div-form__seg { background: rgba(255, 255, 255, 0.04); }
.mg-div-form__seg-btn {
  appearance: none; border: 1px solid transparent; background: transparent; cursor: pointer;
  border-radius: 7px; padding: 7px 16px; font: inherit; font-size: 14px; font-weight: 600;
  color: var(--secondary); white-space: nowrap;
}
.mg-div-form__seg-btn--active {
  background: var(--surface-card); border-color: var(--primary); color: var(--primary);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}
/* On-green variant — the field-config switch lives ON the green card. */
.mg-div-form__seg--on-field { background: rgba(255, 255, 255, 0.14); border-color: rgba(255, 255, 255, 0.4); }
.mg-div-form__seg--on-field .mg-div-form__seg-btn { color: rgba(255, 255, 255, 0.85); }
.mg-div-form__seg--on-field .mg-div-form__seg-btn--active { background: #fff; border-color: #fff; color: #1f6b29; box-shadow: none; }

/* Field-card head — sport type (left) + field-config switch (right). */
.mg-div-form__fieldcard-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }

/* Inherited (read-only) values shown in Event-default mode. */
.mg-div-form__inherit { margin: 0; display: flex; flex-direction: column; gap: 6px; }
.mg-div-form__inherit-row { display: flex; justify-content: space-between; gap: 12px; }
.mg-div-form__inherit-row dt { margin: 0; font-size: 0.85rem; color: var(--secondary); }
.mg-div-form__inherit-row dd { margin: 0; font-size: 0.9rem; font-weight: 500; color: var(--text); text-align: right; }
/* Inherited tie breakers — plain, left-aligned text (no label, no two-col row). */
.mg-div-form__inherit-text { margin: 0; font-size: 14px; font-weight: 500; color: var(--text); text-align: left; }

/* Field-config card — green field surface (mirrors .mg-evt-form__fieldcard). */
.mg-div-form__fieldcard {
  display: flex; flex-direction: column; gap: 14px; padding: 14px; border-radius: 12px;
  flex: 1 1 auto; background: #258c31;
}
html.dark-mode .mg-div-form__fieldcard { filter: brightness(0.92); }
.mg-div-form__fieldcard-hint { margin: -8px 0 0; font-size: 13px; color: rgba(255, 255, 255, 0.85); }
.mg-div-form__fieldcard-readonly { display: flex; flex-direction: column; gap: 2px; }
.mg-div-form__fieldcard-label { font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: rgba(255, 255, 255, 0.7); }
.mg-div-form__fieldcard-value { font-size: 14px; font-weight: 600; color: #fff; }
.mg-div-form__fieldcard-pitch { width: 100%; max-width: 420px; margin: 0 auto; }
.mg-div-form__umpires { margin-top: auto; align-self: flex-start; display: flex; flex-direction: column; gap: 3px; }
.mg-div-form__umpires-title { font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: rgba(255, 255, 255, 0.7); margin-bottom: 2px; }
.mg-div-form__umpire-row { font-size: 12.5px; font-weight: 600; color: #fff; }

/* The field-config picker sits ON the green field — translucent control. */
.mg-div-form__fieldselect { position: relative; margin: 0; }
.mg-div-form__fieldselect-control {
  width: 100%; box-sizing: border-box; appearance: none; -webkit-appearance: none;
  padding: 12px 38px 12px 14px; border-radius: 9px;
  border: 1px solid rgba(255, 255, 255, 0.55); background-color: rgba(255, 255, 255, 0.18);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 14px center;
  color: #fff; font-family: var(--font-body); font-size: 14px; font-weight: 600; cursor: pointer;
}
.mg-div-form__fieldselect-control:hover { background-color: rgba(255, 255, 255, 0.24); }
.mg-div-form__fieldselect-control:focus { outline: none; border-color: #fff; background-color: rgba(255, 255, 255, 0.28); }
.mg-div-form__fieldselect-control option { color: var(--text); background: var(--white); }
.mg-div-form__fieldselect--invalid .mg-div-form__fieldselect-control { border-color: var(--highlight, #c1413a); }
.mg-div-form__row {
  display: grid;
  /* `minmax(0, 1fr)` (not bare `1fr`) so the tracks can shrink below
     the inputs' intrinsic width. A bare `1fr` floors at the field's
     min-content size, which overflows the panel at narrow widths and
     forces a horizontal scrollbar — the content must always fit. */
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}
.mg-div-form__row--3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
@media (max-width: 520px) {
  /* Collapse the 2-col rows (dates etc.) to a single column on small
     screens — but keep Time Limits (`--3`) as three columns (just
     tighten the gap) so Pool / Bracket / Championship stay on one row. */
  .mg-div-form__row {
    grid-template-columns: 1fr;
  }
  .mg-div-form__row--3 {
    /* Re-assert 3 columns (the single-column `.mg-div-form__row` rule
       above would otherwise win by source order on this element, which
       carries both classes). Tighter gap so they fit. `minmax(0, 1fr)`
       keeps the tracks shrinkable so the three fields never overflow. */
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }
}
.mg-div-form__group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mg-div-form__group-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
/* Labelled wrapper for a TagsMultiSelect (age groups / ratings) — the
   multi-select has no floating label of its own, so a small caption
   names it. */
.mg-div-form__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
/* Lineup-field preview (Field Config step). */
.mg-div-form__field-preview {
  margin-top: 4px;
  border: 1px solid var(--border-divider);
  border-radius: 10px;
  background: var(--surface-muted, #f4f7fb);
  padding: 8px;
  max-width: 460px;
}
html.dark-mode .mg-div-form__field-preview {
  background: rgba(255, 255, 255, 0.03);
}
.mg-div-form__field-error {
  font-size: 11px;
  font-weight: 500;
  text-transform: none;
  letter-spacing: 0;
  color: #c1413a;
}

/* ── Toggle rows (shared shape with the bracket form) ── */
.mg-div-form__toggle-row,
.mg-div-form__seed-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 6px 0;
  cursor: pointer;
}
.mg-div-form__toggle-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.mg-div-form__toggle-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.mg-div-form__toggle-desc {
  font-size: 13px;
  color: var(--secondary);
  line-height: 1.4;
}

/* ── Seed criteria ── */
.mg-div-form__seed-default {
  margin: 0;
  font-size: 13px;
  color: var(--secondary);
  line-height: 1.5;
}
.mg-div-form__seed-default strong {
  color: var(--text);
}
.mg-div-form__seed-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  /* Fill the remaining height of the seed panel so both lists run
     full length. */
  flex: 1 1 auto;
  min-height: 0;
}
@media (max-width: 520px) {
  .mg-div-form__seed-cols {
    grid-template-columns: 1fr;
  }
}
.mg-div-form__seed-col {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}
.mg-div-form__seed-col-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.mg-div-form__seed-col-title {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--secondary);
}
/* "Select all" — quiet text link in the Available column header. */
.mg-div-form__seed-link {
  appearance: none;
  border: none;
  background: none;
  padding: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--primary);
  cursor: pointer;
}
.mg-div-form__seed-link:hover {
  text-decoration: underline;
}
.mg-div-form__seed-list {
  list-style: none;
  margin: 0;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  /* Fill the column height; scroll internally if the list is long. */
  flex: 1 1 auto;
  min-height: 120px;
  overflow-y: auto;
  border: 1px solid var(--border-divider);
  border-radius: 8px;
  background: var(--surface-muted, #f4f7fb);
}
html.dark-mode .mg-div-form__seed-list {
  background: rgba(255, 255, 255, 0.03);
}
.mg-div-form__seed-empty {
  font-size: 12.5px;
  color: var(--secondary);
  padding: 6px 4px;
}
/* Highlight a list while it's a valid drop target during a drag. */
.mg-div-form__seed-list--dropzone {
  border-color: var(--primary);
  background: rgba(45, 140, 240, 0.06);
}
html.dark-mode .mg-div-form__seed-list--dropzone {
  background: rgba(45, 140, 240, 0.12);
}
/* Invalid (custom seed on, none selected, after a submit attempt). */
.mg-div-form__seed-list--invalid {
  border-color: #c1413a;
}
.mg-div-form__seed-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 6px;
  background: var(--white);
  border: 1px solid var(--border-divider);
  font-size: 13px;
  color: var(--text);
}
html.dark-mode .mg-div-form__seed-item {
  background: var(--surface-card);
}
/* Draggable rows — grab cursor + don't let the browser text-select
   while dragging. */
.mg-div-form__seed-item--draggable {
  cursor: grab;
  user-select: none;
}
.mg-div-form__seed-item--draggable:active {
  cursor: grabbing;
}
.mg-div-form__seed-item--dragging {
  opacity: 0.4;
}
/* Insertion line shown at the drop position within Selected. */
.mg-div-form__seed-item--drop-before::before,
.mg-div-form__seed-item--drop-after::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--primary);
  border-radius: 2px;
}
.mg-div-form__seed-item--drop-before::before {
  top: -4px;
}
.mg-div-form__seed-item--drop-after::after {
  bottom: -4px;
}
/* Drag-handle grip (six-dot affordance, drawn with a radial-gradient). */
.mg-div-form__seed-grip {
  flex: 0 0 auto;
  width: 10px;
  height: 16px;
  background-image: radial-gradient(currentColor 1px, transparent 1.5px);
  background-size: 5px 5px;
  background-position: 0 2px;
  color: var(--secondary);
  opacity: 0.7;
}
.mg-div-form__seed-index {
  color: var(--secondary);
  font-weight: 600;
}
.mg-div-form__seed-name {
  flex: 1 1 auto;
  min-width: 0;
}

/* Push Previous hard-left; Skip + primary stay right. */
.mg-div-form__footer-spacer {
  flex: 1 1 auto;
}
/* Inline save failure — sits between Previous and the right-hand
   actions so the user stays in the modal to retry. */
.mg-div-form__save-error {
  font-size: 12.5px;
  font-weight: 500;
  color: #c1413a;
  padding: 0 12px;
  min-width: 0;
}
</style>
