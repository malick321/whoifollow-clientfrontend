<script setup lang="ts">
// MatchGeniEventFormModal
// -----------------------
// Slide-in WIZARD for creating / editing an event. Single component,
// mode-driven by `eventId` (null = create, non-null = edit).
//
// The event form is large (~40 fields + map + image + field-config preview
// + seed criteria), so it's split into a left-rail stepped wizard rather
// than one flat popup. Steps:
//   1. Details        — name, image, type, sport, association, dates +
//                        all-day + times, timezone, entry fee/deadline,
//                        director (name / country code / number / email).
//   2. Format & Limits — pool/bracket/championship limits, game slot,
//                        seed criteria, field-config + preview.        (next phase)
//   3. Location       — in-person (map + address) ↔ online (medium + url). (next phase)
//   4. Registration   — sign-up + payment settings.                    (next phase)
//   5. Review         — confirm + create/save.                         (next phase)
//
// Navigation is HYBRID: create = linear (Next/Back, gated by per-step
// validation, can't skip ahead); edit = free (jump to any step). Save is a
// single atomic create/update (assembled on the Review step) — wired in a
// later phase.
//
// Reuse: SlideModal chrome, `.floating-input` controls, ToggleSwitch,
// ImageEditorModal, and the events.ts catalogues — same building blocks as
// the legacy EventFormModal + the Division wizard, so it reads identically.
//
// PHASE 1: shell + Details step. Steps 2–5 are placeholder panels and the
// final create/update call is stubbed (disabled) until those land.

import { computed, ref, watch } from 'vue'
import SlideModal from './SlideModal.vue'
import ImageEditorModal from './ImageEditorModal.vue'
import { formatMoney, limitTwoDecimals as clampTwoDecimals } from '../lib/money'
import ToggleSwitch from './ToggleSwitch.vue'
import TagsMultiSelect from './TagsMultiSelect.vue'
import DateRangePicker from './DateRangePicker.vue'
import MapPlaceSearch from './public/MapPlaceSearch.vue'
import EventLocationMap from './EventLocationMap.vue'
import FieldPositionPreview from './FieldPositionPreview.vue'
import DateTimePicker from './DateTimePicker.vue'
import TimePicker from './TimePicker.vue'
import PhoneInput from './PhoneInput.vue'
import CustomFieldsRenderer from './CustomFieldsRenderer.vue'
import { fetchCustomFieldDefinitions } from '../api/customFields'
import { fetchPlaceById } from '../api/placesLookup'
import { themeMode } from '../theme'
import { EVENT_TYPES_CATALOGUE, EVENT_TIMEZONES, PAYMENT_TERMS_OPTIONS, PARTIAL_PAYMENT_TYPE_OPTIONS, createEvent, updateEvent, fetchEvent, type EventAvatarUpload } from '../api/events'
import { fetchBracketFormats } from '../api/bracketFormats'
import { fetchSeedingCriteria } from '../api/seedingCriteria'
import { fetchSportTypes } from '../api/sportTypes'
import { fetchMediums } from '../api/mediums'
import { fetchMyAssociation } from '../api/myAssociations'
import { currentAssociation } from '../constants/associations'
import type {
  EventType,
  BracketFormatOption,
  SeedingCriterionOption,
  FieldConfigurationOption,
  SportType,
  SportTypeUmpireConfig,
  CustomFieldDefinition,
  MediumOption,
  EventPaymentTerms,
  EventPartialPaymentType,
  Event,
  EventStatus,
  SaveEventPayload,
  GeoPosition
} from '../types'

const props = withDefaults(defineProps<{
  modelValue: boolean
  /** Association numeric id + short name — the create/update scope + header. */
  associationId?: string
  associationName?: string
  /** Event id to edit. `null` (or omitted) for the Create flow. */
  eventId?: string | null
}>(), {
  associationId: '',
  associationName: '',
  eventId: null
})

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  /** Emitted after a successful create/update so the host can toast +
   *  refresh its list. */
  (event: 'saved', evt: Event): void
}>()

const isEdit = computed(() => props.eventId !== null && props.eventId !== undefined)
const title = computed(() => (isEdit.value ? 'Edit Event' : 'New Event'))

// The create/update endpoints key on the NUMERIC association id (the backend
// derives association_id / association / owner_* from it). `associationName`
// is the slug, kept for the display eyebrow only — prefer the numeric id from
// the prop, falling back to the router-guard-populated current association.
const associationApiId = computed(
  () => props.associationId || currentAssociation.value?.id || props.associationName
)

// ── Location type (decided up-front on Step 1; drives the step flow) ──
// Online events are lightweight: they skip Format & limits (step 2) and
// Registration (step 4); their step 3 is just the Medium picker. In-person
// events use the full flow with the address/location step.
type LocationType = 'in_person' | 'online'
const locationType = ref<LocationType>('in_person')

// ── Steps ────────────────────────────────────────────────────────
type StepKey = 'details' | 'format' | 'location' | 'registration' | 'additional' | 'review'
interface StepDef { key: StepKey; label: string; hint: string }
const ALL_STEPS: StepDef[] = [
  { key: 'details', label: 'Details', hint: 'Name, dates, director' },
  { key: 'location', label: 'Location', hint: 'Venue & address' },
  { key: 'format', label: 'Format & limits', hint: 'Seeding · field config' },
  { key: 'registration', label: 'Registration', hint: 'Sign-up · payment' },
  { key: 'additional', label: 'Additional details', hint: 'Custom fields' },
  { key: 'review', label: 'Review', hint: 'Confirm & create' }
]
const STEPS = computed<StepDef[]>(() => {
  // Drop the Additional-details step entirely when the association has no
  // custom fields for events — no point showing an empty step.
  const base = customFieldDefs.value.length ? ALL_STEPS : ALL_STEPS.filter((s) => s.key !== 'additional')
  if (locationType.value !== 'online') return base
  // Online events drop the Location, Format and Registration steps — the
  // medium + URL live in the Details step (above the dates), and there's no
  // scheduling/registration for an online meeting.
  return base.filter((s) => s.key !== 'location' && s.key !== 'format' && s.key !== 'registration')
})
const step = ref<StepKey>('details')
const stepIndex = computed(() => STEPS.value.findIndex((s) => s.key === step.value))
const isFirstStep = computed(() => stepIndex.value === 0)
const isLastStep = computed(() => stepIndex.value === STEPS.value.length - 1)

/** Rail click target — edit jumps anywhere; create only revisits a
 *  step at or before the current one (forward moves go through Next). */
function canVisit(i: number): boolean {
  return isEdit.value || i <= stepIndex.value
}
function goToStep(key: StepKey) {
  const i = STEPS.value.findIndex((s) => s.key === key)
  if (i >= 0 && canVisit(i)) step.value = key
}
// If the current step disappears (toggled to online while past it), fall back.
watch(locationType, () => {
  if (!STEPS.value.some((s) => s.key === step.value)) step.value = 'details'
})

// ── Details fields ───────────────────────────────────────────────
const eventName = ref('')
const eventType = ref<EventType | ''>('')
const sportsTypeId = ref('')
const avatarFilename = ref<string | null>(null)
const avatarPreviewUrl = ref<string | null>(null)

const startDate = ref('')
const endDate = ref('')
const allDay = ref(false)
const startTime = ref('08:00')
const endTime = ref('20:00')
const timeZone = ref('America/Los_Angeles')

const entryFee = ref('')
const entryFeeDeadline = ref('')          // local datetime (YYYY-MM-DDTHH:MM)
// True once the admin edits the deadline by hand — stops the auto-default
// (10 days before event start) from clobbering their choice.
const deadlineTouched = ref(false)

/** `YYYY-MM-DD` minus N days → `YYYY-MM-DD`. */
function isoDateMinusDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  if (!y || !m || !d) return ''
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() - days)
  return dt.toISOString().slice(0, 10)
}

/** `YYYY-MM-DD` minus N months → `YYYY-MM-DD`. */
function isoDateMinusMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  if (!y || !m || !d) return ''
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCMonth(dt.getUTCMonth() - months)
  return dt.toISOString().slice(0, 10)
}

// Default the entry deadline to 10 days before the event start (end of that
// day), unless the admin has already set it themselves. Re-derives if they
// change the start date while the deadline is still auto-managed.
watch(() => startDate.value, (sd) => {
  if (!sd || deadlineTouched.value) return
  const base = isoDateMinusDays(sd, 10)
  if (base) entryFeeDeadline.value = `${base}T23:59`
})

const directorName = ref('')
const mobCode = ref('+1')
const directorPhone = ref('')
const directorEmail = ref('')


// ── Format & limits fields (step 2) ──────────────────────────────
const bracketFormatId = ref('')
const poolPlayGuarantee = ref('')
const gameTimeSlot = ref('90')        // timeInterval (min) — grid footprint
const poolLimit = ref('65')           // poolPlayTime (min)
const bracketLimit = ref('70')        // bracketTime (min)
const championshipLimit = ref('80')   // championshipTime (min)
const fieldConfigId = ref('')
/** Seed criteria selected for the event default — order = tie-break
 *  priority (selection order). Stored as names for the multi-select;
 *  mapped to `{ seedingCriteriaId, order }` on submit. */
const selectedSeedNames = ref<string[]>([])
// Ordered seed-criteria ids from the edited event (get-one read). Mapped to
// catalogue names by `mapHydratedSeeds()` — kept separate because the catalogue
// may load after hydration, so we re-map once it's in.
const hydratedSeedIds = ref<string[]>([])

const POOL_GUARANTEE_OPTIONS = ['1', '2', '3', '4', '5']

// ── Catalogues (page-cached; loaded lazily on first open) ────────
const bracketFormats = ref<BracketFormatOption[]>([])
const seedCatalogue = ref<SeedingCriterionOption[]>([])
const sportTypes = ref<SportType[]>([])
const seedOptionNames = computed(() => seedCatalogue.value.map((c) => c.name))

async function loadCatalogues() {
  if (bracketFormats.value.length === 0) {
    bracketFormats.value = await fetchBracketFormats().catch(() => [])
  }
  if (seedCatalogue.value.length === 0) {
    seedCatalogue.value = await fetchSeedingCriteria().catch(() => [])
  }
  if (sportTypes.value.length === 0) {
    sportTypes.value = await fetchSportTypes().catch(() => [])
  }
}

// The chosen sport type carries its own field configs + umpire configs
// (unified /v2/sport-types resource) — no separate per-sport fetch.
const selectedSportType = computed(() =>
  sportTypes.value.find((s) => s.id === sportsTypeId.value) ?? null
)
const fieldConfigOptions = computed<FieldConfigurationOption[]>(() =>
  selectedSportType.value?.fieldConfigurations ?? []
)
const umpireConfigs = computed<SportTypeUmpireConfig[]>(() =>
  [...(selectedSportType.value?.umpireConfigs ?? [])].sort((a, b) => a.sortOrder - b.sortOrder)
)

// Keep the field-config selection valid for the current sport type and
// auto-select the FIRST config as soon as a sport type is chosen (so the
// diagram renders immediately). Fires on sport-type change AND when the
// catalogue finishes loading (edit hydration can set the id first); a
// still-valid stored selection is preserved.
watch([() => sportsTypeId.value, fieldConfigOptions], () => {
  const list = fieldConfigOptions.value
  if (list.length === 0) { fieldConfigId.value = ''; return }
  if (!list.some((f) => f.id === fieldConfigId.value)) fieldConfigId.value = list[0].id
})

// ── Field-config diagram preview ─────────────────────────────────
// The chosen config whose layout the shared <FieldPositionPreview> draws.
const previewFieldConfig = computed(() =>
  fieldConfigOptions.value.find((f) => f.id === fieldConfigId.value) ?? null
)

// ── Custom fields (generalized, association/sport-scoped) ─────────
// Definitions render as dynamic controls; values are held by id. Defs
// depend on the association + chosen sport, so re-fetch when the sport
// changes. `customFieldValues` may carry typed values (after edit) or raw
// wire strings (from hydration) — the renderer + encoder tolerate both.
const customFieldDefs = ref<CustomFieldDefinition[]>([])
const customFieldValues = ref<Record<string, boolean | string | string[]>>({})
async function loadCustomFields() {
  customFieldDefs.value = await fetchCustomFieldDefinitions('event', {
    associationId: associationApiId.value,
    associationShortName: props.associationName,
    sportsTypeId: sportsTypeId.value || undefined
  }).catch(() => [])
}
// Re-resolve when the sport changes (sport-scoped definitions).
watch(() => sportsTypeId.value, () => { void loadCustomFields() })

/** Encode the values map → wire `{ definitionId, value }[]` per field type. */
function buildCustomFields(): { definitionId: string; value: string }[] {
  const out: { definitionId: string; value: string }[] = []
  for (const def of customFieldDefs.value) {
    const raw = customFieldValues.value[def.id]
    if (def.inputType === 'boolean') {
      out.push({ definitionId: def.id, value: raw === true || raw === '1' ? '1' : '0' })
    } else if (def.inputType === 'multi_select') {
      const arr = Array.isArray(raw) ? raw : []
      if (arr.length) out.push({ definitionId: def.id, value: JSON.stringify(arr) })
    } else {
      const s = typeof raw === 'string' ? raw.trim() : raw != null ? String(raw) : ''
      if (s) out.push({ definitionId: def.id, value: s })
    }
  }
  return out
}

// Required custom fields that are still empty (reuses the encoder — it only
// emits non-empty values per type, and booleans are always emitted).
const additionalAttempted = ref(false)
const customFieldErrors = computed<string[]>(() => {
  const present = new Set(buildCustomFields().map((c) => c.definitionId))
  return customFieldDefs.value.filter((d) => d.required && !present.has(d.id)).map((d) => d.id)
})

// ── Location fields (step 3) — `locationType` lives up top (drives steps) ──
// In-person
const address = ref('')
const locationLine = ref('')
const city = ref('')
const stateField = ref('')
const zipCode = ref('')
// Lat/long are backend-only (map the venue pin); never shown — the admin
// can't meaningfully edit them. Populated from the Google Places pick.
const lat = ref('')
const long = ref('')
// Drives the read-only map preview pin. Set from the Places pick (and from
// stored lat/long on edit). Null → map shows the empty US-wide fallback.
const venuePosition = ref<GeoPosition | null>(null)

/** Apply a Google Places pick: drop the pin + prefill the address fields.
 *  The venue NAME becomes the location/venue line; the street/city/state/zip
 *  fill the editable fields below; lat/long feed the backend pin only. */
async function onPlaceSelected(placeId: string): Promise<void> {
  const place = await fetchPlaceById(placeId)
  if (!place) return
  if (place.name) locationLine.value = place.name
  address.value = place.street || place.formattedAddress || ''
  city.value = place.city || ''
  stateField.value = place.state || ''
  zipCode.value = place.postalCode || ''
  venuePosition.value = place.position
  lat.value = String(place.position.lat)
  long.value = String(place.position.lng)
}
// Online
const mediumId = ref('')
const url = ref('')

const mediumCatalogue = ref<MediumOption[]>([])
/** Denormalized medium-name snapshot for the selected id (persisted to
 *  `team_events.medium`). */
const mediumName = computed(() => mediumCatalogue.value.find((m) => m.id === mediumId.value)?.name ?? '')
async function loadMediums() {
  if (mediumCatalogue.value.length === 0) {
    mediumCatalogue.value = await fetchMediums().catch(() => [])
  }
}

// ── Registration & payment fields (step 4) ───────────────────────
const allowTeamRegistration = ref(false)
const registrationOpening = ref('')        // local datetime (YYYY-MM-DDTHH:MM)
// True once the admin edits "Registration opens" by hand — stops the
// auto-default (1 month before event start) from clobbering their choice.
const regOpenTouched = ref(false)
// `paymentRequired` backs the "Allow credit card payments" toggle — it gates
// the credit-card terms / auto-confirm block. Offline payments are a separate
// top-level method (`allowOfflinePayment`).
const paymentRequired = ref(false)

// Credit-card payments require the association to have Stripe Connect set up
// (from `GET /v2/my/associations/{slug}`). When not connected, the toggle is
// forced off + disabled with an explanatory banner. Defaults to allowed so a
// failed lookup never blocks the admin.
const stripeConnected = ref(true)
const stripeAssociationName = ref('')
async function loadStripeStatus() {
  if (!props.associationName) return
  try {
    const a = await fetchMyAssociation(props.associationName)
    // `stripeConnected` (camelCase) per my-associations-api-contract §1/§2.
    // Only an explicit `false` counts as "not connected" (undefined → leave
    // enabled so a missing field never blocks the admin).
    stripeConnected.value = a.stripeConnected !== false
    stripeAssociationName.value = a.associationName || props.associationName
  } catch {
    stripeConnected.value = true
    stripeAssociationName.value = props.associationName
  }
}
// If Stripe isn't connected, credit-card payments can't be on.
watch(stripeConnected, (connected) => {
  if (!connected && paymentRequired.value) {
    paymentRequired.value = false
    paymentTerms.value = ''
    autoConfirmOnFullPayment.value = false
    autoConfirmOnPartialPayment.value = false
  }
})
const paymentTerms = ref<EventPaymentTerms | ''>('')
const partialPaymentType = ref<EventPartialPaymentType | ''>('')
const partialPaymentValue = ref('')
const allowOfflinePayment = ref(false)
const autoConfirmOnPartialPayment = ref(false)
const autoConfirmOnFullPayment = ref(false)
/** The partial-payment type/value only apply when terms = 'partial'. */
const showPartialPayment = computed(() => paymentRequired.value && paymentTerms.value === 'partial')

// Bounds + guidance for the partial-payment value: fixed amount can't exceed
// the entry fee; percentage is 10–100.
const partialValueMin = computed(() => (partialPaymentType.value === 'percentage' ? 10 : 0))
const partialValueMax = computed<number | undefined>(() => {
  if (partialPaymentType.value === 'percentage') return 100
  const fee = Number(entryFee.value)
  return Number.isFinite(fee) && fee > 0 ? fee : undefined
})
const partialValueStep = computed(() => (partialPaymentType.value === 'percentage' ? 1 : 0.01))
const partialValueHint = computed(() => {
  // Only meaningful while the partial value field is visible — otherwise the
  // hint lingers after switching back to full payment (the field is hidden).
  if (!showPartialPayment.value) return ''
  if (partialPaymentType.value === 'percentage') return 'Enter a percentage between 10 and 100.'
  if (partialPaymentType.value === 'fixed_amount') {
    // `type="number"` inputs come back as numbers from v-model, so coerce.
    const fee = String(entryFee.value ?? '').trim()
    return fee ? `Can't exceed the entry fee ($${fee}).` : "Can't exceed the entry fee."
  }
  return ''
})
// Money formatting + the 2-decimal input rule are shared — see `src/lib/money.ts`.
const money = formatMoney
// Money / value inputs: cap at 2 decimal places as the user types (the
// native `step` only validates on submit). Keeps the ref as a string.
// NB: `Event` is the app's event entity in this module — use the DOM
// `InputEvent` type for this handler; the clamp rule itself is centralized.
function limitTwoDecimals(event: InputEvent): string {
  const el = event.target as HTMLInputElement
  const v = clampTwoDecimals(el.value)
  if (v !== el.value) el.value = v
  return v
}
function onEntryFeeInput(event: InputEvent) { entryFee.value = limitTwoDecimals(event) }
function onPartialValueInput(event: InputEvent) { partialPaymentValue.value = limitTwoDecimals(event) }
// Live (as-you-type) range error for the partial value — independent of the
// submit-gated `regErr`. Empty is not flagged here (handled by required).
const partialValueLiveError = computed(() => {
  if (!showPartialPayment.value) return ''
  const raw = String(partialPaymentValue.value ?? '').trim()
  if (!raw) return ''
  const v = Number(raw)
  if (!Number.isFinite(v) || v <= 0) return 'Enter a value greater than 0.'
  if (partialPaymentType.value === 'percentage') {
    if (v < 10) return 'Minimum is 10%.'
    if (v > 100) return 'Maximum is 100%.'
  } else if (partialPaymentType.value === 'fixed_amount') {
    const fee = Number(entryFee.value) || 0
    if (fee > 0 && v > fee) return `Can't exceed the entry fee (${money(fee)}).`
  }
  return ''
})
// What a team pays at registration — preview only, never sent to the backend.
// Full → the whole entry fee; partial-fixed → the entered amount; partial-%
// → the calculated amount. Hidden whenever the value is out of range.
const participationPreview = computed(() => {
  if (partialValueLiveError.value) return ''
  const fee = Number(entryFee.value) || 0
  if (fee <= 0) return ''
  if (paymentTerms.value !== 'partial') {
    return `Teams pay the full ${money(fee)} entry fee to submit their participation.`
  }
  const v = Number(partialPaymentValue.value)
  if (!Number.isFinite(v) || v <= 0) return ''
  if (partialPaymentType.value === 'percentage') {
    const amt = Math.round(fee * v) / 100
    return `Teams pay ${money(amt)} (${v}% of the ${money(fee)} entry fee) to submit their participation.`
  }
  if (partialPaymentType.value === 'fixed_amount') {
    return `Teams pay ${money(v)} of the ${money(fee)} entry fee to submit their participation.`
  }
  return ''
})

// Default "Registration opens" to 1 month before the event start (09:00)
// when self-registration is enabled — unless the admin has set it themselves.
watch([allowTeamRegistration, () => startDate.value], () => {
  if (!allowTeamRegistration.value || regOpenTouched.value || !startDate.value) return
  const base = isoDateMinusMonths(startDate.value, 1)
  if (base) registrationOpening.value = `${base}T09:00`
})

// Auto-confirm defaults follow the chosen terms (they stay user-editable —
// these only fire on an explicit terms change / first enabling payment):
//   full    → confirm-on-full ON,    confirm-on-partial off (+ hidden)
//   partial → confirm-on-partial ON, confirm-on-full off (+ hidden)
function applyTermsDefaults(terms: EventPaymentTerms | '') {
  if (terms === 'full') {
    autoConfirmOnFullPayment.value = true
    autoConfirmOnPartialPayment.value = false
  } else if (terms === 'partial') {
    autoConfirmOnPartialPayment.value = true
    autoConfirmOnFullPayment.value = false
  }
}
function setPaymentTerms(terms: EventPaymentTerms) {
  paymentTerms.value = terms
  applyTermsDefaults(terms)
}
// Default terms to 'full' the moment payment is first required (only when
// unset — hydration sets stored terms, so this never clobbers an edit).
watch(paymentRequired, (req) => {
  if (req && !paymentTerms.value) {
    paymentTerms.value = 'full'
    applyTermsDefaults('full')
  }
})

// Payment methods only exist under self-registration (user action — not
// hydration). Turning it ON defaults BOTH methods on — credit card (which
// the paymentRequired watch defaults to 'full' terms) + offline — all still
// editable. Turning it OFF clears the payment state so nothing stale is
// hidden/persisted, and re-defaults the opening date on the next enable.
function onSelfRegToggle(on: boolean) {
  if (on) {
    // Credit card only when Stripe is connected; offline always available.
    paymentRequired.value = stripeConnected.value
    allowOfflinePayment.value = true
    return
  }
  paymentRequired.value = false
  allowOfflinePayment.value = false
  paymentTerms.value = ''
  partialPaymentType.value = ''
  partialPaymentValue.value = ''
  autoConfirmOnFullPayment.value = false
  autoConfirmOnPartialPayment.value = false
  regOpenTouched.value = false
}

// ── Lifecycle status (hidden field) ──────────────────────────────
// New events start as 'draft' (per the event lifecycle — the admin
// publishes later); edit preserves the hydrated status (transitions
// enforced server-side).
const eventStatus = ref<EventStatus>('draft')

// ── Save / hydrate state ─────────────────────────────────────────
const saving = ref(false)
const saveError = ref('')
const hydrating = ref(false)

// ── Cover banner palette (no image → deterministic colored tile +
//    calendar icon, matching the events-listing hero scheme) ───────
const LIGHT_HERO_PALETTE = [
  { bg: '#fbe4e6', fg: '#bb5964' }, { bg: '#e7f1ff', fg: '#477bb2' },
  { bg: '#eaf8eb', fg: '#468957' }, { bg: '#fff0df', fg: '#b57a34' },
  { bg: '#efe8ff', fg: '#7360b7' }, { bg: '#e4f7f6', fg: '#3c8e89' }
]
const DARK_HERO_PALETTE = [
  { bg: '#4a2530', fg: '#ff8a98' }, { bg: '#2a3a52', fg: '#7fb0e8' },
  { bg: '#243d2c', fg: '#7ad48a' }, { bg: '#4a3320', fg: '#e8b075' },
  { bg: '#33294a', fg: '#b29bdc' }, { bg: '#1d3a3a', fg: '#6ec9c1' }
]
// Stable seed for the placeholder cover color — set once on open (create) /
// hydrate (edit), NOT tied to the live `eventName`, so the tile color doesn't
// flicker while the user types the name.
const heroSeed = ref('event')
const heroStyle = computed<Record<string, string>>(() => {
  const hash = Array.from(heroSeed.value).reduce((sum, c) => sum + c.charCodeAt(0), 0)
  const palette = themeMode.value === 'dark' ? DARK_HERO_PALETTE : LIGHT_HERO_PALETTE
  const choice = palette[hash % palette.length]
  return { '--avatar-bg': choice.bg, '--avatar-fg': choice.fg }
})

// ── Image (reuses ImageEditorModal) ──────────────────────────────
const imageEditorOpen = ref(false)
// Tracks whether the cover was changed THIS session — drives whether the
// binary is sent on update (omit when unchanged so the existing image stays).
const coverChanged = ref(false)
function openImageEditor() { imageEditorOpen.value = true }
function onImageSaved(dataUrl: string) {
  avatarPreviewUrl.value = dataUrl
  avatarFilename.value = `event-${Date.now()}.jpg`
  coverChanged.value = true
}
function clearImage() {
  avatarPreviewUrl.value = null
  avatarFilename.value = null
  coverChanged.value = true
}

/** Decode a `data:` URL into a Blob for multipart upload (null otherwise). */
function dataUrlToBlob(dataUrl: string): Blob | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/)
  if (!m) return null
  const bytes = atob(m[2])
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return new Blob([arr], { type: m[1] })
}

/** Build the cover-image argument for create/update:
 *  - create: send the picked image (data URL → blob), or nothing;
 *  - update: only when changed — a new image replaces, a cleared one
 *    clears, an untouched one is omitted (keep existing). */
function buildAvatarUpload(): EventAvatarUpload | undefined {
  const url = avatarPreviewUrl.value
  if (isEdit.value && !coverChanged.value) return undefined
  if (url && url.startsWith('data:')) {
    return { blob: dataUrlToBlob(url), filename: avatarFilename.value ?? 'cover.jpg' }
  }
  // No (new) image: create → nothing to send; edit → explicit clear.
  return isEdit.value ? { blob: null } : undefined
}

// ── Reset on open ────────────────────────────────────────────────
// Create resets to defaults; edit hydration (fetch the full Event) lands
// with the save wiring in a later phase.
watch(
  () => props.modelValue,
  (open, wasOpen) => {
    if (open && !wasOpen) {
      step.value = 'details'
      detailsAttempted.value = false
      formatAttempted.value = false
      locationAttempted.value = false
      registrationAttempted.value = false
      additionalAttempted.value = false
      saveError.value = ''
      void loadCatalogues().then(() => {
        // Fresh create: pre-select every seeding criterion by default (the
        // common case — admins typically want them all as tie-breakers).
        // Runs after the synchronous create-reset below, so it wins the race.
        // Edit: re-map the event's stored seed ids → names now the catalogue
        // is in (hydration may have run before it loaded).
        if (!isEdit.value) selectedSeedNames.value = seedOptionNames.value.slice()
        else mapHydratedSeeds()
      })
      void loadMediums()
      // Create resolves Stripe status from the association; edit uses the
      // event's own `stripeConnectedStatus` (applied in hydrate()).
      if (!isEdit.value) void loadStripeStatus()
      void loadCustomFields()
      if (isEdit.value) {
        void hydrateFromId(props.eventId ?? null)
      } else {
        // New events start as a draft (per the event lifecycle); the admin
        // publishes later from the event surface.
        eventStatus.value = 'draft'
        eventName.value = ''
        eventType.value = ''
        sportsTypeId.value = ''
        avatarFilename.value = null
        avatarPreviewUrl.value = null
        coverChanged.value = false
        startDate.value = ''
        endDate.value = ''
        allDay.value = false
        startTime.value = '08:00'
        endTime.value = '20:00'
        timeZone.value = 'America/Los_Angeles'
        entryFee.value = ''
        entryFeeDeadline.value = ''
        deadlineTouched.value = false
        directorName.value = ''
        mobCode.value = '+1'
        directorPhone.value = ''
        directorEmail.value = ''
        // Format & limits defaults (mirror the legacy form's starting values).
        bracketFormatId.value = ''
        poolPlayGuarantee.value = ''
        gameTimeSlot.value = '90'
        poolLimit.value = '65'
        bracketLimit.value = '70'
        championshipLimit.value = '80'
        fieldConfigId.value = ''
        selectedSeedNames.value = []
        hydratedSeedIds.value = []
        customFieldValues.value = {}
        // Location
        locationType.value = 'in_person'
        address.value = ''
        locationLine.value = ''
        city.value = ''
        stateField.value = ''
        zipCode.value = ''
        lat.value = ''
        long.value = ''
        venuePosition.value = null
        mediumId.value = ''
        url.value = ''
        // Registration & payment
        allowTeamRegistration.value = false
        registrationOpening.value = ''
        regOpenTouched.value = false
        paymentRequired.value = false
        paymentTerms.value = ''
        partialPaymentType.value = ''
        partialPaymentValue.value = ''
        allowOfflinePayment.value = false
        autoConfirmOnPartialPayment.value = false
        autoConfirmOnFullPayment.value = false
        // Stable placeholder-cover color for this session (independent of the
        // name the user types).
        heroSeed.value = String(Math.floor(Math.random() * 6))
      }
    }
  },
  { immediate: true }
)

// ── Validation (Details step gates create) ───────────────────────
function isBlank(v: unknown): boolean {
  return String(v ?? '').trim().length === 0
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const detailsAttempted = ref(false)
const detailsFieldErrors = computed(() => {
  const e = new Set<string>()
  if (isBlank(eventName.value)) e.add('eventName')
  // Event type applies to in-person events only (online has none).
  // Sport type now lives on the Format step — validated there, not here.
  if (locationType.value !== 'online') {
    if (isBlank(eventType.value)) e.add('eventType')
  } else {
    // Online — the medium + a valid join URL live on THIS step (above the
    // dates), so they're validated here (no separate Location/Medium step).
    if (isBlank(mediumId.value)) e.add('mediumId')
    if (isBlank(url.value) || !isValidUrl(url.value)) e.add('url')
  }
  if (isBlank(startDate.value)) e.add('startDate')
  if (isBlank(endDate.value)) e.add('endDate')
  if (!allDay.value) {
    if (isBlank(startTime.value)) e.add('startTime')
    if (isBlank(endTime.value)) e.add('endTime')
  }
  if (isBlank(timeZone.value)) e.add('timeZone')
  // End must not precede start (date level).
  if (!isBlank(startDate.value) && !isBlank(endDate.value) && endDate.value < startDate.value) {
    e.add('endDate')
  }
  // Optional fields — validate only when filled.
  if (!isBlank(directorEmail.value) && !EMAIL_RE.test(directorEmail.value.trim())) e.add('directorEmail')
  return e
})
const detailsErrors = computed(() => (detailsAttempted.value ? detailsFieldErrors.value : new Set<string>()))
function err(field: string): boolean { return detailsErrors.value.has(field) }

// Format step — ALL fields are required for in-person events (the Format
// step doesn't exist for online, so it's skipped there). Gated by its own
// attempt flag.
const formatAttempted = ref(false)
const formatFieldErrors = computed(() => {
  const e = new Set<string>()
  if (locationType.value === 'online') return e
  if (isBlank(sportsTypeId.value)) e.add('sportsTypeId')
  if (isBlank(poolPlayGuarantee.value)) e.add('poolPlayGuarantee')
  if (isBlank(bracketFormatId.value)) e.add('bracketFormatId')
  if (isBlank(poolLimit.value)) e.add('poolLimit')
  if (isBlank(bracketLimit.value)) e.add('bracketLimit')
  if (isBlank(championshipLimit.value)) e.add('championshipLimit')
  if (isBlank(gameTimeSlot.value)) e.add('gameTimeSlot')
  if (isBlank(fieldConfigId.value)) e.add('fieldConfigId')
  if (selectedSeedNames.value.length === 0) e.add('seedCriteria')
  return e
})
function fmtErr(field: string): boolean { return formatAttempted.value && formatFieldErrors.value.has(field) }

// Location step — for in-person events every address field is required
// (online uses the medium/url fields instead, which aren't gated here).
const locationAttempted = ref(false)
function isValidUrl(s: string): boolean {
  try {
    const u = new URL(s.trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}
const locationFieldErrors = computed(() => {
  const e = new Set<string>()
  // Online events skip the Location step entirely — the medium + URL are
  // validated on the Details step instead.
  if (locationType.value === 'online') return e
  if (isBlank(locationLine.value)) e.add('location')
  if (isBlank(address.value)) e.add('address')
  if (isBlank(city.value)) e.add('city')
  if (isBlank(stateField.value)) e.add('state')
  if (isBlank(zipCode.value)) e.add('zip')
  return e
})
function locErr(field: string): boolean { return locationAttempted.value && locationFieldErrors.value.has(field) }

// Registration & payment step — conditional requireds:
//   self-registration on → registration-opens date required;
//   payment required     → entry fee + deadline + terms required;
//   partial terms        → partial type + value required.
const registrationAttempted = ref(false)
const registrationFieldErrors = computed(() => {
  const e = new Set<string>()
  if (locationType.value === 'online') return e
  // Entry fee + deadline are always required (independent of registration /
  // payment toggles).
  if (isBlank(entryFee.value)) e.add('entryFee')
  if (isBlank(entryFeeDeadline.value)) e.add('entryFeeDeadline')
  // Self-registration requires an opening date AND at least one payment
  // method (credit card and/or offline) so teams have a way to pay.
  if (allowTeamRegistration.value) {
    if (isBlank(registrationOpening.value)) e.add('registrationOpening')
    if (!paymentRequired.value && !allowOfflinePayment.value) e.add('paymentMethod')
  }
  // Credit-card payments need terms.
  if (paymentRequired.value) {
    if (isBlank(paymentTerms.value)) e.add('paymentTerms')
    if (paymentTerms.value === 'partial') {
      if (isBlank(partialPaymentType.value)) e.add('partialPaymentType')
      if (isBlank(partialPaymentValue.value)) {
        e.add('partialPaymentValue')
      } else {
        const v = Number(partialPaymentValue.value)
        if (!Number.isFinite(v) || v <= 0) {
          e.add('partialPaymentValue')
        } else if (partialPaymentType.value === 'percentage') {
          // Percentage: 10–100.
          if (v < 10 || v > 100) e.add('partialPaymentValue')
        } else if (partialPaymentType.value === 'fixed_amount') {
          // Fixed amount: can't exceed the entry fee.
          const fee = Number(entryFee.value)
          if (Number.isFinite(fee) && v > fee) e.add('partialPaymentValue')
        }
      }
    }
  }
  return e
})
function regErr(field: string): boolean { return registrationAttempted.value && registrationFieldErrors.value.has(field) }

// ── Navigation ───────────────────────────────────────────────────
function validateCurrentStep(): boolean {
  if (step.value === 'details') {
    detailsAttempted.value = true
    return detailsFieldErrors.value.size === 0
  }
  if (step.value === 'format') {
    formatAttempted.value = true
    return formatFieldErrors.value.size === 0
  }
  if (step.value === 'location') {
    locationAttempted.value = true
    return locationFieldErrors.value.size === 0
  }
  if (step.value === 'registration') {
    registrationAttempted.value = true
    return registrationFieldErrors.value.size === 0
  }
  if (step.value === 'additional') {
    additionalAttempted.value = true
    return customFieldErrors.value.length === 0
  }
  return true
}
function goNext() {
  if (!validateCurrentStep()) return
  if (!isLastStep.value) step.value = STEPS.value[stepIndex.value + 1].key
}
function goBack() {
  if (!isFirstStep.value) step.value = STEPS.value[stepIndex.value - 1].key
}

// ── Review summary (read-only recap) ─────────────────────────────
const eventTypeLabel = computed(() => EVENT_TYPES_CATALOGUE.find((t) => t.key === eventType.value)?.label ?? '')
const sportName = computed(() => selectedSportType.value?.name ?? '')
const timeZoneLabel = computed(() => EVENT_TIMEZONES.find((t) => t.value === timeZone.value)?.nameLabel ?? '')
// Short tz abbreviation (e.g. "CST") from the step-1 timezone — postfixed onto
// the registration-step datetime field labels so the admin knows the zone.
const timeZoneShort = computed(() => EVENT_TIMEZONES.find((t) => t.value === timeZone.value)?.shortLabel ?? '')
const entryDeadlineFieldLabel = computed(
  () => (timeZoneShort.value ? `Entry deadline (${timeZoneShort.value})` : 'Entry deadline')
)
const registrationOpensFieldLabel = computed(
  () => (timeZoneShort.value ? `Registration opens (${timeZoneShort.value})` : 'Registration opens')
)
// App-formatted date / time for the review recap.
function fmtReviewDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return ''
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtReviewTime(hhmm: string): string {
  const m = hhmm.match(/^(\d{2}):(\d{2})$/)
  if (!m) return hhmm
  const d = new Date(2000, 0, 1, Number(m[1]), Number(m[2]))
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
const reviewDates = computed(() => {
  const range = [fmtReviewDate(startDate.value), fmtReviewDate(endDate.value)].filter(Boolean).join(' → ')
  if (!range) return '—'
  return allDay.value
    ? `${range} · All day`
    : `${range} · ${fmtReviewTime(startTime.value)}–${fmtReviewTime(endTime.value)}`
})
const reviewDirector = computed(() => {
  // Only show the dialling code when there's an actual phone number.
  const phone = (directorPhone.value && directorPhone.value.trim())
    ? [mobCode.value, directorPhone.value].filter((s) => s && s.trim()).join(' ')
    : ''
  return [directorName.value, phone, directorEmail.value].filter((s) => s && s.trim()).join(' · ') || '—'
})
const reviewRegistration = computed(() => {
  if (!allowTeamRegistration.value) return 'Closed'
  const methods: string[] = []
  if (paymentRequired.value) methods.push('Credit card')
  if (allowOfflinePayment.value) methods.push('Offline')
  return methods.length ? `Open (${methods.join(', ')})` : 'Open'
})
const reviewFormat = computed(() => {
  const fmt = bracketFormats.value.find((f) => f.id === bracketFormatId.value)?.name
  const guarantee = poolPlayGuarantee.value ? `${poolPlayGuarantee.value}-game round robin` : ''
  return [guarantee, fmt].filter(Boolean).join(' · ') || 'Event default'
})
const reviewLocation = computed(() => {
  if (locationType.value === 'online') {
    return [mediumName.value, url.value].filter((s) => s && s.trim()).join(' · ') || 'Online'
  }
  return [address.value, city.value, stateField.value, zipCode.value].filter((s) => s && s.trim()).join(', ') || 'In person'
})

function close() { emit('update:modelValue', false) }

// ── Edit hydration ───────────────────────────────────────────────
function hydrate(evt: Event) {
  eventName.value = evt.eventName
  heroSeed.value = evt.eventName || 'event'
  // Edit gates the online-payment toggle off the event's own Stripe status
  // (get-one `stripeConnected`); only an explicit `false` disables it.
  stripeConnected.value = evt.stripeConnected !== false
  stripeAssociationName.value = props.associationName
  // The backend persists/returns the event-type DISPLAY LABEL (e.g.
  // "Tournament"), but the select binds catalogue KEYS ("tournament"). Resolve
  // either form back to the key so the field populates on edit.
  const rawType = (evt.eventType ?? '') as string
  eventType.value =
    (EVENT_TYPES_CATALOGUE.find((t) => t.key === rawType || t.label === rawType)?.key ?? '') as EventType | ''
  sportsTypeId.value = evt.sportsTypeId ?? ''
  avatarPreviewUrl.value = evt.avatarUrl
  avatarFilename.value = evt.avatarUrl ? evt.avatarUrl.split('/').pop() ?? null : null
  // The hydrated cover is the existing one — not a change, so it isn't re-sent.
  coverChanged.value = false
  startDate.value = evt.eventStartDate ?? ''
  endDate.value = evt.eventEndDate ?? ''
  allDay.value = evt.allDay
  startTime.value = (evt.eventStartTime ?? '08:00:00').slice(0, 5)
  endTime.value = (evt.eventEndTime ?? '20:00:00').slice(0, 5)
  timeZone.value = evt.timeZone
  entryFee.value = evt.entryFee != null ? String(evt.entryFee) : ''
  // Normalize the stored deadline to the datetime-local format. A date-only
  // value gets an end-of-day time so the control has something to show.
  // Mark it touched so the start-date auto-default leaves the stored value be.
  if (evt.entryFeeDeadline) {
    const d = evt.entryFeeDeadline
    entryFeeDeadline.value = (d.includes(' ') || d.includes('T'))
      ? d.replace(' ', 'T').slice(0, 16)
      : `${d}T23:59`
    deadlineTouched.value = true
  } else {
    entryFeeDeadline.value = ''
    deadlineTouched.value = false
  }
  directorName.value = evt.directorName ?? ''
  mobCode.value = evt.mobCode ?? '+1'
  directorPhone.value = evt.directorPhone ?? ''
  directorEmail.value = evt.directorEmail ?? ''
  // Format & limits
  bracketFormatId.value = evt.bracketFormatId ?? ''
  poolPlayGuarantee.value = evt.poolPlayGuaranteed ?? ''
  gameTimeSlot.value = evt.timeInterval ?? '90'
  poolLimit.value = evt.poolPlayTime ?? ''
  bracketLimit.value = evt.bracketTime ?? ''
  championshipLimit.value = evt.championshipTime ?? ''
  fieldConfigId.value = evt.fieldConfigId ?? ''
  // Seed criteria arrive on the get-one read as an ordered
  // { seedingCriteriaId, order }[]. Stash the ordered ids; `mapHydratedSeeds`
  // turns them into names now (if the catalogue's in) and again once it loads.
  hydratedSeedIds.value = (evt.seedCriteria ?? [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((s) => s.seedingCriteriaId)
  mapHydratedSeeds()
  // Custom-field values — keyed by definition id (raw wire strings; the
  // renderer + encoder interpret per type).
  customFieldValues.value = {}
  for (const cf of evt.customFields ?? []) {
    customFieldValues.value[cf.definitionId] = cf.value
  }
  // Location — derive type from the stored flag, falling back to inference.
  locationType.value = evt.locationType ?? ((evt.mediumId || evt.url) ? 'online' : 'in_person')
  address.value = evt.address ?? ''
  locationLine.value = evt.location ?? ''
  city.value = evt.city ?? ''
  stateField.value = evt.state ?? ''
  zipCode.value = evt.zipCode ?? ''
  lat.value = evt.lat ?? ''
  long.value = evt.long ?? ''
  venuePosition.value = (evt.lat && evt.long) ? { lat: Number(evt.lat), lng: Number(evt.long) } : null
  mediumId.value = evt.mediumId ?? ''
  url.value = evt.url ?? ''
  // Registration & payment
  allowTeamRegistration.value = evt.allowTeamRegistration
  registrationOpening.value = evt.registrationOpening
    ? evt.registrationOpening.replace(' ', 'T').slice(0, 16)
    : ''
  // Keep the stored opening date — don't let the start-date default override.
  regOpenTouched.value = !!evt.registrationOpening
  paymentRequired.value = evt.paymentRequired
  paymentTerms.value = evt.paymentTerms ?? ''
  partialPaymentType.value = evt.partialPaymentType ?? ''
  partialPaymentValue.value = evt.partialPaymentValue != null ? String(evt.partialPaymentValue) : ''
  allowOfflinePayment.value = evt.allowOfflinePayment
  autoConfirmOnFullPayment.value = evt.autoConfirmOnFullPayment
  autoConfirmOnPartialPayment.value = evt.autoConfirmOnPartialPayment
  eventStatus.value = evt.eventStatus
}

let hydrateToken = 0
async function hydrateFromId(eventId: string | null) {
  if (!eventId) return
  const myToken = ++hydrateToken
  hydrating.value = true
  try {
    const evt = await fetchEvent(associationApiId.value, eventId)
    if (myToken === hydrateToken && evt) hydrate(evt)
  } catch {
    if (myToken === hydrateToken) saveError.value = 'Could not load the event.'
  } finally {
    if (myToken === hydrateToken) hydrating.value = false
  }
}

// ── Save ─────────────────────────────────────────────────────────
// Coerce first — `type="number"` inputs return numbers from v-model, so the
// raw value can be a number despite the string-typed ref.
function nullIfBlank(s: string | number): string | null {
  const t = String(s ?? '').trim()
  return t ? t : null
}
function numberOrNull(s: string | number): number | null {
  const t = String(s ?? '').trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** Resolve the edited event's ordered seed-criteria ids → catalogue names →
 *  `selectedSeedNames`. Safe before the catalogue loads (resolves to [] then;
 *  re-run from `loadCatalogues().then(...)` once it's filled). */
function mapHydratedSeeds() {
  selectedSeedNames.value = hydratedSeedIds.value
    .map((id) => seedCatalogue.value.find((c) => c.id === id)?.name)
    .filter((n): n is string => !!n)
}

/** Map selected seed-criteria names → ordered `{ seedingCriteriaId, order }`. */
function buildSeedCriteria(): { seedingCriteriaId: string; order: number }[] {
  return selectedSeedNames.value
    .map((name, i) => {
      const hit = seedCatalogue.value.find((c) => c.name === name)
      return hit ? { seedingCriteriaId: hit.id, order: i + 1 } : null
    })
    .filter((x): x is { seedingCriteriaId: string; order: number } => x !== null)
}

function buildPayload(): SaveEventPayload {
  const online = locationType.value === 'online'
  return {
    eventName: eventName.value.trim(),
    eventType: eventType.value === '' ? null : eventType.value,
    avatar: avatarFilename.value,
    locationType: locationType.value,
    // In-person block (null when online).
    address: online ? null : nullIfBlank(address.value),
    location: online ? null : nullIfBlank(locationLine.value),
    city: online ? null : nullIfBlank(city.value),
    state: online ? null : nullIfBlank(stateField.value),
    zipCode: online ? null : nullIfBlank(zipCode.value),
    lat: online ? null : nullIfBlank(lat.value),
    long: online ? null : nullIfBlank(long.value),
    eventStartDate: startDate.value,
    eventEndDate: endDate.value,
    eventStartTime: allDay.value ? null : `${startTime.value}:00`,
    eventEndTime: allDay.value ? null : `${endTime.value}:00`,
    timeZone: timeZone.value,
    allDay: allDay.value,
    note: null,
    reminder: null,
    // Online block (null when in-person). `mediumName` carries the snapshot.
    mediumId: online ? nullIfBlank(mediumId.value) : null,
    mediumName: online ? (mediumName.value || null) : null,
    url: online ? nullIfBlank(url.value) : null,
    color: null,
    eventStatus: eventStatus.value,
    directorName: nullIfBlank(directorName.value),
    directorEmail: nullIfBlank(directorEmail.value),
    directorPhone: nullIfBlank(directorPhone.value),
    mobCode: nullIfBlank(mobCode.value),
    entryFee: numberOrNull(entryFee.value),
    refundPolicy: null,
    tournamentFormat: null,
    entryFeeDeadline: entryFeeDeadline.value
      ? entryFeeDeadline.value.replace('T', ' ') + ':00'
      : null,
    poolPlayGuaranteed: nullIfBlank(poolPlayGuarantee.value),
    bracketFormatId: nullIfBlank(bracketFormatId.value),
    poolPlayTime: nullIfBlank(poolLimit.value),
    championshipTime: nullIfBlank(championshipLimit.value),
    bracketTime: nullIfBlank(bracketLimit.value),
    timeInterval: nullIfBlank(gameTimeSlot.value),
    sportsTypeId: nullIfBlank(sportsTypeId.value),
    fieldConfigId: nullIfBlank(fieldConfigId.value),
    seedCriteria: buildSeedCriteria(),
    customFields: buildCustomFields(),
    allowTeamRegistration: allowTeamRegistration.value,
    registrationOpening: allowTeamRegistration.value && registrationOpening.value
      ? registrationOpening.value.replace('T', ' ') + ':00'
      : null,
    paymentRequired: paymentRequired.value,
    paymentTerms: paymentRequired.value ? (paymentTerms.value || null) : null,
    partialPaymentType: showPartialPayment.value ? (partialPaymentType.value || null) : null,
    partialPaymentValue: showPartialPayment.value ? numberOrNull(partialPaymentValue.value) : null,
    allowOfflinePayment: allowOfflinePayment.value,
    // Each auto-confirm only applies under its matching terms (full vs
    // partial are mutually exclusive), so zero out the inactive side.
    autoConfirmOnFullPayment: (paymentRequired.value && paymentTerms.value === 'full') ? autoConfirmOnFullPayment.value : false,
    autoConfirmOnPartialPayment: (paymentRequired.value && paymentTerms.value === 'partial') ? autoConfirmOnPartialPayment.value : false
  }
}

const canSubmit = computed(() => !saving.value && detailsFieldErrors.value.size === 0 && customFieldErrors.value.length === 0)

async function save() {
  detailsAttempted.value = true
  formatAttempted.value = true
  locationAttempted.value = true
  registrationAttempted.value = true
  if (detailsFieldErrors.value.size > 0) { step.value = 'details'; return }
  if (locationFieldErrors.value.size > 0) { step.value = 'location'; return }
  if (formatFieldErrors.value.size > 0) { step.value = 'format'; return }
  if (registrationFieldErrors.value.size > 0) { step.value = 'registration'; return }
  saving.value = true
  saveError.value = ''
  try {
    const payload = buildPayload()
    const avatar = buildAvatarUpload()
    const saved = isEdit.value && props.eventId
      ? await updateEvent(associationApiId.value, props.eventId, payload, avatar)
      : await createEvent(associationApiId.value, payload, avatar)
    emit('saved', saved)
    close()
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : 'Could not save the event.'
  } finally {
    saving.value = false
  }
}
function onSubmit() { void save() }
</script>

<template>
  <SlideModal
    :model-value="modelValue"
    :title="title"
    size="full"
    flush-body
    @update:model-value="(v) => emit('update:modelValue', v)"
  >
    <template #title-block>
      <span v-if="associationName" class="slide-modal-panel__eyebrow">{{ associationName }}</span>
      <h2 class="slide-modal-panel__title">{{ title }}</h2>
    </template>

    <div class="mg-evt-form">
      <!-- Left rail — vertical stepper. -->
      <nav class="mg-evt-form__rail" aria-label="Event form steps">
        <ol class="mg-evt-form__steps">
          <li
            v-for="(s, i) in STEPS"
            :key="s.key"
            class="mg-evt-form__step"
            :class="{
              'mg-evt-form__step--active': s.key === step,
              'mg-evt-form__step--done': i < stepIndex
            }"
          >
            <button
              type="button"
              class="mg-evt-form__step-btn"
              :disabled="!canVisit(i)"
              :aria-current="s.key === step ? 'step' : undefined"
              @click="goToStep(s.key)"
            >
              <span class="mg-evt-form__step-node" aria-hidden="true">
                <span v-if="i < stepIndex" class="mg-evt-form__step-check"></span>
                <span v-else class="mg-evt-form__step-num">{{ i + 1 }}</span>
              </span>
              <span class="mg-evt-form__step-text">
                <span class="mg-evt-form__step-label">{{ s.label }}</span>
                <span class="mg-evt-form__step-hint">{{ s.hint }}</span>
              </span>
            </button>
          </li>
        </ol>
      </nav>

      <!-- Panel -->
      <div class="mg-evt-form__panel-wrap">
        <!-- Edit-mode skeleton while the event record loads. -->
        <div v-if="hydrating" class="mg-evt-form__panel mg-evt-form__panel--wide mg-evt-form__skeleton" aria-hidden="true">
          <div class="shimmer-block mg-evt-form__sk-cover"></div>
          <div class="mg-evt-form__sk-namerow">
            <div class="shimmer-block mg-evt-form__sk-field mg-evt-form__sk-grow"></div>
            <div class="shimmer-block mg-evt-form__sk-toggle"></div>
          </div>
          <div class="shimmer-block mg-evt-form__sk-field"></div>
          <div class="mg-evt-form__cols">
            <div class="mg-evt-form__col">
              <div class="shimmer-block mg-evt-form__sk-label"></div>
              <div class="shimmer-block mg-evt-form__sk-field"></div>
              <div class="shimmer-block mg-evt-form__sk-field"></div>
              <div class="shimmer-block mg-evt-form__sk-field"></div>
            </div>
            <div class="mg-evt-form__col">
              <div class="shimmer-block mg-evt-form__sk-label"></div>
              <div class="shimmer-block mg-evt-form__sk-field"></div>
              <div class="shimmer-block mg-evt-form__sk-field"></div>
              <div class="shimmer-block mg-evt-form__sk-field"></div>
            </div>
          </div>
        </div>

        <template v-else>
        <!-- ── Step 1 · Details ────────────────────────────────── -->
        <section v-show="step === 'details'" class="mg-evt-form__panel mg-evt-form__panel--wide">
          <!-- Cover banner — uploaded image, or a deterministic colored
               tile + calendar icon (matches the events-listing hero). -->
          <div
            class="mg-evt-form__cover"
            :class="{ 'mg-evt-form__cover--initial': !avatarPreviewUrl }"
            :style="!avatarPreviewUrl ? heroStyle : undefined"
          >
            <template v-if="avatarPreviewUrl">
              <!-- Blurred backdrop (same image) fills the band; the full
                   image sits contained on top so any aspect (square /
                   landscape) shows uncropped — same concept as the public
                   event hero. -->
              <img :src="avatarPreviewUrl" alt="" aria-hidden="true" class="mg-evt-form__cover-bg" />
              <img :src="avatarPreviewUrl" alt="Event cover" class="mg-evt-form__cover-img" />
            </template>
            <span v-else class="mg-evt-form__cover-icon" aria-hidden="true"></span>
            <button type="button" class="mg-evt-form__cover-btn" @click="openImageEditor">
              {{ avatarPreviewUrl ? 'Change cover' : 'Upload cover' }}
            </button>
          </div>

          <!-- Row 1 · identity: location-type toggle + name on one row, then
               (in-person only) event type + sport type. -->
          <div class="mg-evt-form__row">
            <div class="mg-evt-form__name-row">
              <div class="floating-input mg-evt-form__field mg-evt-form__name-field" :class="{ 'floating-input--invalid': err('eventName') }">
                <input id="evt-name" v-model="eventName" type="text" maxlength="120" class="floating-input__control"
                       :class="{ 'floating-input__control--has-value': !!eventName }" placeholder=" " />
                <label for="evt-name" class="floating-input__label" :class="{ 'floating-input__label--floated': !!eventName }">Event name</label>
                <span v-if="err('eventName')" class="floating-input__error-corner">Required</span>
              </div>
              <div class="mg-evt-form__seg" role="tablist" aria-label="Location type">
                <button
                  type="button"
                  role="tab"
                  class="mg-evt-form__seg-btn"
                  :class="{ 'mg-evt-form__seg-btn--active': locationType === 'in_person' }"
                  :aria-selected="locationType === 'in_person'"
                  @click="locationType = 'in_person'"
                ><span class="mg-evt-form__seg-icon mg-evt-form__seg-icon--inperson" aria-hidden="true"></span><span>In person</span></button>
                <button
                  type="button"
                  role="tab"
                  class="mg-evt-form__seg-btn"
                  :class="{ 'mg-evt-form__seg-btn--active': locationType === 'online' }"
                  :aria-selected="locationType === 'online'"
                  @click="locationType = 'online'"
                ><span class="mg-evt-form__seg-icon mg-evt-form__seg-icon--online" aria-hidden="true"></span><span>Online</span></button>
              </div>
            </div>
          </div>

          <!-- Row 2 · two columns: timing (left) · director (right). -->
          <div class="mg-evt-form__cols">
            <!-- Timing -->
            <div class="mg-evt-form__col">
              <!-- Event type (in-person only) — sits above the dates so it
                   doesn't stretch full-width across the panel. -->
              <div v-if="locationType !== 'online'" class="floating-input mg-evt-form__field" :class="{ 'floating-input--invalid': err('eventType') }">
                <select id="evt-type" v-model="eventType"
                        class="floating-input__control floating-input__control--select"
                        :class="{ 'floating-input__control--has-value': !!eventType }">
                  <option value="" disabled hidden></option>
                  <option v-for="t in EVENT_TYPES_CATALOGUE" :key="t.key" :value="t.key">{{ t.label }}</option>
                </select>
                <label for="evt-type" class="floating-input__label" :class="{ 'floating-input__label--floated': !!eventType }">Event type</label>
                <span v-if="err('eventType')" class="floating-input__error-corner">Required</span>
              </div>
              <!-- Online — medium + join URL sit here (above the dates), in
                   place of the hidden event type. No separate Medium step. -->
              <template v-if="locationType === 'online'">
                <div class="floating-input mg-evt-form__field" :class="{ 'floating-input--invalid': err('mediumId') }">
                  <select id="evt-medium" v-model="mediumId" class="floating-input__control floating-input__control--select" :class="{ 'floating-input__control--has-value': !!mediumId }">
                    <option value="" disabled hidden></option>
                    <option v-for="m in mediumCatalogue" :key="m.id" :value="m.id">{{ m.name }}</option>
                  </select>
                  <label for="evt-medium" class="floating-input__label" :class="{ 'floating-input__label--floated': !!mediumId }">Medium</label>
                  <span v-if="err('mediumId')" class="floating-input__error-corner">Required</span>
                </div>
                <div class="floating-input mg-evt-form__field" :class="{ 'floating-input--invalid': err('url') }">
                  <input id="evt-url" v-model="url" type="url" maxlength="255" class="floating-input__control" :class="{ 'floating-input__control--has-value': !!url }" placeholder=" " />
                  <label for="evt-url" class="floating-input__label" :class="{ 'floating-input__label--floated': !!url }">URL</label>
                  <span v-if="err('url')" class="floating-input__error-corner">Enter a valid URL</span>
                </div>
              </template>
              <div class="mg-evt-form__field mg-evt-form__rangefield">
                <DateRangePicker
                  :model-start="startDate"
                  :model-end="endDate"
                  :invalid="err('startDate') || err('endDate')"
                  placeholder="Select event dates"
                  aria-label="Event dates"
                  @update:model-start="startDate = $event"
                  @update:model-end="endDate = $event"
                />
                <span v-if="err('startDate') || err('endDate')" class="mg-evt-form__error">Pick a start and end date.</span>
              </div>

              <label class="mg-evt-form__toggle-row">
                <span class="mg-evt-form__toggle-text">All day</span>
                <ToggleSwitch v-model="allDay" aria-label="All day event" />
              </label>

              <div v-if="!allDay" class="mg-evt-form__grid2">
                <TimePicker
                  id="evt-start-time"
                  v-model="startTime"
                  class="mg-evt-form__field"
                  label="Start time"
                  :invalid="err('startTime')"
                />
                <TimePicker
                  id="evt-end-time"
                  v-model="endTime"
                  class="mg-evt-form__field"
                  label="End time"
                  :invalid="err('endTime')"
                />
              </div>

              <div class="floating-input mg-evt-form__field" :class="{ 'floating-input--invalid': err('timeZone') }">
                <select id="evt-tz" v-model="timeZone"
                        class="floating-input__control floating-input__control--select floating-input__control--has-value">
                  <option v-for="tz in EVENT_TIMEZONES" :key="tz.value" :value="tz.value">{{ tz.formLabel }}</option>
                </select>
                <label for="evt-tz" class="floating-input__label floating-input__label--floated">Timezone</label>
                <span v-if="err('timeZone')" class="floating-input__error-corner">Required</span>
              </div>
            </div>

            <!-- Director -->
            <div class="mg-evt-form__col">
              <h3 class="mg-evt-form__subhead">Director information</h3>
              <div class="floating-input mg-evt-form__field">
                <input id="evt-dir-name" v-model="directorName" type="text" maxlength="120"
                       class="floating-input__control" :class="{ 'floating-input__control--has-value': !!directorName }" placeholder=" " />
                <label for="evt-dir-name" class="floating-input__label" :class="{ 'floating-input__label--floated': !!directorName }">Director name</label>
              </div>
              <PhoneInput
                id="evt-dir-phone"
                v-model:dial-code="mobCode"
                v-model:number="directorPhone"
                number-label="Number"
              />
              <div class="floating-input mg-evt-form__field" :class="{ 'floating-input--invalid': err('directorEmail') }">
                <input id="evt-dir-email" v-model="directorEmail" type="email" maxlength="255"
                       class="floating-input__control" :class="{ 'floating-input__control--has-value': !!directorEmail }" placeholder=" " />
                <label for="evt-dir-email" class="floating-input__label" :class="{ 'floating-input__label--floated': !!directorEmail }">Email</label>
                <span v-if="err('directorEmail')" class="floating-input__error-corner">Invalid</span>
              </div>
            </div>
          </div>
        </section>

        <!-- ── Step 2 · Format & limits ────────────────────────── -->
        <section v-show="step === 'format'" class="mg-evt-form__panel mg-evt-form__panel--wide">
          <!-- Two columns: field-config card (left) · controls (right). The
               `--swap` modifier flips the visual order (DOM is controls-first). -->
          <div class="mg-evt-form__cols mg-evt-form__cols--swap">
            <!-- Left: Format + Seeding + Time limits -->
            <div class="mg-evt-form__col">
              <h3 class="mg-evt-form__subhead">Format</h3>
              <div class="floating-input mg-evt-form__field" :class="{ 'floating-input--invalid': fmtErr('poolPlayGuarantee') }">
                <select id="evt-pool-guarantee" v-model="poolPlayGuarantee"
                        class="floating-input__control floating-input__control--select"
                        :class="{ 'floating-input__control--has-value': !!poolPlayGuarantee }">
                  <option value="" disabled hidden></option>
                  <option v-for="g in POOL_GUARANTEE_OPTIONS" :key="g" :value="g">{{ g }} game round robin</option>
                </select>
                <label for="evt-pool-guarantee" class="floating-input__label" :class="{ 'floating-input__label--floated': !!poolPlayGuarantee }">Pool play guaranteed</label>
                <span v-if="fmtErr('poolPlayGuarantee')" class="floating-input__error-corner">Required</span>
              </div>
              <div class="floating-input mg-evt-form__field" :class="{ 'floating-input--invalid': fmtErr('bracketFormatId') }">
                <select id="evt-bracket-format" v-model="bracketFormatId"
                        class="floating-input__control floating-input__control--select"
                        :class="{ 'floating-input__control--has-value': !!bracketFormatId }">
                  <option value="" disabled hidden></option>
                  <option v-for="f in bracketFormats" :key="f.id" :value="f.id">{{ f.name }}</option>
                </select>
                <label for="evt-bracket-format" class="floating-input__label" :class="{ 'floating-input__label--floated': !!bracketFormatId }">Bracket format</label>
                <span v-if="fmtErr('bracketFormatId')" class="floating-input__error-corner">Required</span>
              </div>

              <div class="mg-evt-form__subhead-row">
                <h3 class="mg-evt-form__subhead">Tie Breakers</h3>
                <p v-if="fmtErr('seedCriteria')" class="mg-evt-form__error mg-evt-form__error--inline">Select at least one tie breaker</p>
              </div>
              <TagsMultiSelect
                v-model="selectedSeedNames"
                :options="seedOptionNames"
                placeholder="Select tie breakers"
                aria-label="Event tie breakers"
              />

              <h3 class="mg-evt-form__subhead">Time limits (minutes)</h3>
              <p class="mg-evt-form__hint">Regulation game length — drives the live "remaining / over time" clock.</p>
              <div class="mg-evt-form__grid3">
                <div class="floating-input mg-evt-form__field" :class="{ 'floating-input--invalid': fmtErr('poolLimit') }">
                  <input id="evt-pool-limit" v-model="poolLimit" type="number" min="0" step="5" class="floating-input__control floating-input__control--has-value" />
                  <label for="evt-pool-limit" class="floating-input__label floating-input__label--floated">Pool play</label>
                  <span v-if="fmtErr('poolLimit')" class="floating-input__error-corner">Required</span>
                </div>
                <div class="floating-input mg-evt-form__field" :class="{ 'floating-input--invalid': fmtErr('bracketLimit') }">
                  <input id="evt-bracket-limit" v-model="bracketLimit" type="number" min="0" step="5" class="floating-input__control floating-input__control--has-value" />
                  <label for="evt-bracket-limit" class="floating-input__label floating-input__label--floated">Bracket</label>
                  <span v-if="fmtErr('bracketLimit')" class="floating-input__error-corner">Required</span>
                </div>
                <div class="floating-input mg-evt-form__field" :class="{ 'floating-input--invalid': fmtErr('championshipLimit') }">
                  <input id="evt-champ-limit" v-model="championshipLimit" type="number" min="0" step="5" class="floating-input__control floating-input__control--has-value" />
                  <label for="evt-champ-limit" class="floating-input__label floating-input__label--floated">Championship</label>
                  <span v-if="fmtErr('championshipLimit')" class="floating-input__error-corner">Required</span>
                </div>
              </div>

              <h3 class="mg-evt-form__subhead">Scheduling (minutes)</h3>
              <div class="floating-input mg-evt-form__field" :class="{ 'floating-input--invalid': fmtErr('gameTimeSlot') }">
                <input id="evt-game-slot" v-model="gameTimeSlot" type="number" min="5" step="5" class="floating-input__control floating-input__control--has-value" />
                <label for="evt-game-slot" class="floating-input__label floating-input__label--floated">Game time slot</label>
                <span v-if="fmtErr('gameTimeSlot')" class="floating-input__error-corner">Required</span>
              </div>
              <p class="mg-evt-form__hint">How much room each game takes on the schedule grid — its footprint. Separate from the time limits above; you can shorten it on the grid during a delay without changing the regulation limit.</p>
            </div>

            <!-- Right: Sport type + Field configuration on one green field
                 card. Sport type drives the field-config list; the picker
                 sits on the field, pins render once a configuration is
                 selected. -->
            <div class="mg-evt-form__col">
              <div class="mg-evt-form__fieldcard">
                <div class="mg-evt-form__fieldcard-row">
                  <div class="mg-evt-form__fieldselect" :class="{ 'mg-evt-form__fieldselect--invalid': fmtErr('sportsTypeId') }">
                    <select id="evt-sport" v-model="sportsTypeId" class="mg-evt-form__fieldselect-control">
                      <option value="" disabled>Select sport type</option>
                      <option v-for="s in sportTypes" :key="s.id" :value="s.id">{{ s.name }}</option>
                    </select>
                    <span v-if="fmtErr('sportsTypeId')" class="floating-input__error-corner">Required</span>
                  </div>
                  <div class="mg-evt-form__fieldselect" :class="{ 'mg-evt-form__fieldselect--invalid': fmtErr('fieldConfigId') }">
                    <select id="evt-field-config" v-model="fieldConfigId" class="mg-evt-form__fieldselect-control" :disabled="!sportsTypeId">
                      <option value="" disabled>{{ sportsTypeId ? 'Select field configuration' : 'Pick a sport type first' }}</option>
                      <option v-for="f in fieldConfigOptions" :key="f.id" :value="f.id">{{ f.name }}</option>
                    </select>
                    <span v-if="fmtErr('fieldConfigId')" class="floating-input__error-corner">Required</span>
                  </div>
                </div>
                <p class="mg-evt-form__fieldcard-hint">Applies to all divisions by default — you can override it per division later.</p>
                <div class="mg-evt-form__fieldcard-pitch">
                  <FieldPositionPreview
                    :positions="previewFieldConfig?.positions ?? []"
                    :field-config-name="previewFieldConfig?.name"
                  />
                </div>

                <!-- Umpire configuration for the chosen sport — code · name,
                     ordered by sort_order. Pinned bottom-left of the card. -->
                <div v-if="umpireConfigs.length" class="mg-evt-form__umpires">
                  <span class="mg-evt-form__umpires-title">Umpires</span>
                  <span
                    v-for="u in umpireConfigs"
                    :key="u.id"
                    class="mg-evt-form__umpire-row"
                  >{{ u.code }} - {{ u.name }}</span>
                </div>
              </div>
            </div>
          </div>
        </section>
        <!-- ── Step 3 · Location (in-person) / Medium (online) ─── -->
        <section v-show="step === 'location'" class="mg-evt-form__panel">
          <!-- In person -->
          <template v-if="locationType === 'in_person'">
            <!-- Google Places search. Mounted only on the location step so it
                 auto-focuses when the admin lands here, not on modal open.
                 The picked result's name becomes the event `location`. -->
            <div v-if="step === 'location'" class="mg-evt-form__placesearch">
              <MapPlaceSearch
                placeholder="Search for the venue or address"
                @select="onPlaceSelected"
              />
              <p v-if="locErr('location')" class="mg-evt-form__error">Search and select the venue.</p>
            </div>

            <!-- Map preview — pin appears once a place is selected. -->
            <EventLocationMap :position="venuePosition" />

            <!-- Editable address fields, prefilled from the picked place. The
                 venue name (location) is sourced from the search selection,
                 so its own field is not shown. -->
            <div class="floating-input mg-evt-form__field" :class="{ 'floating-input--invalid': locErr('address') }">
              <input id="evt-address" v-model="address" type="text" maxlength="255" class="floating-input__control" :class="{ 'floating-input__control--has-value': !!address }" placeholder=" " />
              <label for="evt-address" class="floating-input__label" :class="{ 'floating-input__label--floated': !!address }">Street address</label>
              <span v-if="locErr('address')" class="floating-input__error-corner">Required</span>
            </div>
            <div class="mg-evt-form__grid3">
              <div class="floating-input mg-evt-form__field" :class="{ 'floating-input--invalid': locErr('city') }">
                <input id="evt-city" v-model="city" type="text" maxlength="100" class="floating-input__control" :class="{ 'floating-input__control--has-value': !!city }" placeholder=" " />
                <label for="evt-city" class="floating-input__label" :class="{ 'floating-input__label--floated': !!city }">City</label>
                <span v-if="locErr('city')" class="floating-input__error-corner">Required</span>
              </div>
              <div class="floating-input mg-evt-form__field" :class="{ 'floating-input--invalid': locErr('state') }">
                <input id="evt-state" v-model="stateField" type="text" maxlength="40" class="floating-input__control" :class="{ 'floating-input__control--has-value': !!stateField }" placeholder=" " />
                <label for="evt-state" class="floating-input__label" :class="{ 'floating-input__label--floated': !!stateField }">State</label>
                <span v-if="locErr('state')" class="floating-input__error-corner">Required</span>
              </div>
              <div class="floating-input mg-evt-form__field" :class="{ 'floating-input--invalid': locErr('zip') }">
                <input id="evt-zip" v-model="zipCode" type="text" maxlength="12" class="floating-input__control" :class="{ 'floating-input__control--has-value': !!zipCode }" placeholder=" " />
                <label for="evt-zip" class="floating-input__label" :class="{ 'floating-input__label--floated': !!zipCode }">Zip code</label>
                <span v-if="locErr('zip')" class="floating-input__error-corner">Required</span>
              </div>
            </div>
          </template>
        </section>
        <!-- ── Step 4 · Registration & payment ─────────────────── -->
        <section v-show="step === 'registration'" class="mg-evt-form__panel">
          <!-- Entry fee + deadline -->
          <div class="mg-evt-form__grid2">
            <div class="floating-input mg-evt-form__field" :class="{ 'floating-input--invalid': regErr('entryFee') }">
              <input id="evt-fee" :value="entryFee" type="number" min="0" step="0.01" inputmode="decimal"
                     class="floating-input__control" :class="{ 'floating-input__control--has-value': !!entryFee }" placeholder=" " @input="(e) => onEntryFeeInput(e)" />
              <label for="evt-fee" class="floating-input__label" :class="{ 'floating-input__label--floated': !!entryFee }">Entry fee ($)</label>
              <span v-if="regErr('entryFee')" class="floating-input__error-corner">Required</span>
            </div>
            <DateTimePicker
              id="evt-deadline"
              v-model="entryFeeDeadline"
              class="mg-evt-form__field"
              :label="entryDeadlineFieldLabel"
              :max-date="endDate"
              :invalid="regErr('entryFeeDeadline')"
              @update:model-value="deadlineTouched = true"
            />
          </div>

          <!-- Allow self registration -->
          <div class="mg-evt-form__setting">
            <div class="mg-evt-form__setting-text">
              <span class="mg-evt-form__setting-title">Allow self registration</span>
              <span class="mg-evt-form__setting-desc">Enabling lets teams sign themselves up for this event.</span>
            </div>
            <ToggleSwitch v-model="allowTeamRegistration" aria-label="Allow self registration" @update:model-value="onSelfRegToggle" />
          </div>
          <DateTimePicker
            v-if="allowTeamRegistration"
            id="evt-reg-open"
            v-model="registrationOpening"
            class="mg-evt-form__field"
            :label="registrationOpensFieldLabel"
            :max-date="startDate"
            :invalid="regErr('registrationOpening')"
            @update:model-value="regOpenTouched = true"
          />

          <!-- Payment methods only apply under self-registration. -->
          <template v-if="allowTeamRegistration">
          <!-- Self-registration needs at least one payment method. -->
          <p v-if="regErr('paymentMethod')" class="mg-evt-form__error">
            Self registration needs at least one payment method — enable credit card and/or offline payments.
          </p>

          <!-- Allow credit card payments (gates the credit-card terms below) -->
          <div class="mg-evt-form__setting">
            <div class="mg-evt-form__setting-text">
              <span class="mg-evt-form__setting-title">Allow credit card payments</span>
              <span class="mg-evt-form__setting-desc">Let teams pay the participation fee online by credit card.</span>
            </div>
            <ToggleSwitch v-model="paymentRequired" :disabled="!stripeConnected" aria-label="Allow credit card payments" />
          </div>
          <!-- Stripe not connected → credit card unavailable. -->
          <div v-if="!stripeConnected" class="app-banner app-banner--warning mg-evt-form__stripe-banner">
            <div class="app-banner__text">
              <strong class="app-banner__title">Credit card payments unavailable</strong>
              <span class="app-banner__sub">
                {{ stripeAssociationName || 'This association' }} hasn’t connected Stripe yet, so online card payments can’t be enabled. Please contact your association admin to set up Stripe — you can still accept offline payments in the meantime.
              </span>
            </div>
          </div>

          <template v-if="paymentRequired">
            <!-- Payment terms toggle + (for partial) type + value, one row. -->
            <div class="mg-evt-form__payterms-row">
              <div class="mg-evt-form__seg" role="tablist" aria-label="Payment terms">
                <button
                  v-for="t in PAYMENT_TERMS_OPTIONS"
                  :key="t.value"
                  type="button"
                  role="tab"
                  class="mg-evt-form__seg-btn"
                  :class="{ 'mg-evt-form__seg-btn--active': paymentTerms === t.value }"
                  :aria-selected="paymentTerms === t.value"
                  @click="setPaymentTerms(t.value)"
                >{{ t.label }}</button>
              </div>
              <template v-if="showPartialPayment">
                <div class="floating-input mg-evt-form__field mg-evt-form__payterms-grow" :class="{ 'floating-input--invalid': regErr('partialPaymentType') }">
                  <select id="evt-pay-type" v-model="partialPaymentType" class="floating-input__control floating-input__control--select" :class="{ 'floating-input__control--has-value': !!partialPaymentType }">
                    <option value="" disabled hidden></option>
                    <option v-for="t in PARTIAL_PAYMENT_TYPE_OPTIONS" :key="t.value" :value="t.value">{{ t.label }}</option>
                  </select>
                  <label for="evt-pay-type" class="floating-input__label" :class="{ 'floating-input__label--floated': !!partialPaymentType }">Payment type</label>
                  <span v-if="regErr('partialPaymentType')" class="floating-input__error-corner">Required</span>
                </div>
                <div class="floating-input mg-evt-form__field mg-evt-form__payterms-grow" :class="{ 'floating-input--invalid': regErr('partialPaymentValue') || !!partialValueLiveError }">
                  <input id="evt-pay-value" :value="partialPaymentValue" type="number" :min="partialValueMin" :max="partialValueMax" :step="partialValueStep" class="floating-input__control" :class="{ 'floating-input__control--has-value': !!partialPaymentValue }" placeholder=" " @input="(e) => onPartialValueInput(e)" />
                  <label for="evt-pay-value" class="floating-input__label" :class="{ 'floating-input__label--floated': !!partialPaymentValue }">{{ partialPaymentType === 'percentage' ? 'Value (%)' : 'Value ($)' }}</label>
                </div>
              </template>
            </div>
            <p v-if="showPartialPayment && (partialValueLiveError || partialValueHint)" class="mg-evt-form__payterms-hint" :class="(regErr('partialPaymentValue') || partialValueLiveError) ? 'mg-evt-form__error' : 'mg-evt-form__hint'">{{ partialValueLiveError || partialValueHint }}</p>

            <!-- Registration-payment preview (display only — never submitted).
                 Hidden whenever the value is out of range. -->
            <div v-if="participationPreview" class="app-banner app-banner--primary mg-evt-form__pay-preview">
              <div class="app-banner__text">
                <strong class="app-banner__title">Payment preview</strong>
                <span class="app-banner__sub">{{ participationPreview }}</span>
              </div>
            </div>

            <!-- Auto-confirm belongs to the credit-card block, so no divider
                 above it (--flush). Partial terms → confirm-on-partial; full
                 terms → confirm-on-full. -->
            <div v-if="paymentTerms === 'partial'" class="mg-evt-form__setting mg-evt-form__setting--flush">
              <div class="mg-evt-form__setting-text">
                <span class="mg-evt-form__setting-title">Auto confirm on partial payment</span>
                <span class="mg-evt-form__setting-desc">Automatically confirm team participation upon partial payment.</span>
              </div>
              <ToggleSwitch v-model="autoConfirmOnPartialPayment" aria-label="Auto confirm on partial payment" />
            </div>
            <div v-if="paymentTerms === 'full'" class="mg-evt-form__setting mg-evt-form__setting--flush">
              <div class="mg-evt-form__setting-text">
                <span class="mg-evt-form__setting-title">Auto confirm on full payment</span>
                <span class="mg-evt-form__setting-desc">Automatically confirm team participation upon full payment.</span>
              </div>
              <ToggleSwitch v-model="autoConfirmOnFullPayment" aria-label="Auto confirm on full payment" />
            </div>
          </template>

          <!-- Allow offline payments — a payment method alongside credit card,
               available once self-registration is enabled. -->
          <div class="mg-evt-form__setting">
            <div class="mg-evt-form__setting-text">
              <span class="mg-evt-form__setting-title">Allow offline payments</span>
              <span class="mg-evt-form__setting-desc">Accept cash / check payments collected outside the app.</span>
            </div>
            <ToggleSwitch v-model="allowOfflinePayment" aria-label="Allow offline payments" />
          </div>
          </template>
        </section>
        <!-- ── Step · Additional details (association/sport custom fields) ─── -->
        <section v-show="step === 'additional'" class="mg-evt-form__panel mg-evt-form__panel--wide">
          <CustomFieldsRenderer
            v-if="customFieldDefs.length"
            :definitions="customFieldDefs"
            v-model="customFieldValues"
            :errors="additionalAttempted ? customFieldErrors : []"
            layout="grid"
          />
        </section>
        <!-- ── Step 5 · Review ─────────────────────────────────── -->
        <section v-show="step === 'review'" class="mg-evt-form__panel">
          <div class="app-banner app-banner--primary mg-evt-form__review-banner">
            <div class="app-banner__text">
              <strong class="app-banner__title">{{ isEdit ? 'Almost there — review your changes' : 'Almost there — give it a final look' }}</strong>
              <span class="app-banner__sub">
                {{ isEdit
                  ? 'Check the event details below, then tap Save changes to update it.'
                  : 'Check the event details below, then tap Create event — it’ll be saved as a draft you can publish later.' }}
              </span>
            </div>
          </div>
          <div class="mg-evt-form__review-head">
            <div
              class="mg-evt-form__review-cover"
              :class="{ 'mg-evt-form__review-cover--initial': !avatarPreviewUrl }"
              :style="!avatarPreviewUrl ? heroStyle : undefined"
            >
              <img v-if="avatarPreviewUrl" :src="avatarPreviewUrl" alt="" class="mg-evt-form__review-cover-img" />
              <span v-else class="mg-evt-form__review-cover-icon" aria-hidden="true"></span>
            </div>
            <span class="mg-evt-form__review-name">{{ eventName || '—' }}</span>
          </div>
          <dl class="mg-evt-form__review">
            <div><dt>{{ locationType === 'online' ? 'Medium' : 'Location' }}</dt><dd>{{ reviewLocation }}</dd></div>
            <div><dt>Type</dt><dd>{{ [associationName, eventTypeLabel, sportName].filter(Boolean).join(' · ') || '—' }}</dd></div>
            <div><dt>Dates</dt><dd>{{ reviewDates }}</dd></div>
            <div><dt>Timezone</dt><dd>{{ timeZoneLabel || '—' }}</dd></div>
            <div><dt>Director</dt><dd>{{ reviewDirector }}</dd></div>
            <template v-if="locationType !== 'online'">
              <div><dt>Format</dt><dd>{{ reviewFormat }}</dd></div>
              <div><dt>Time limits</dt><dd>Pool {{ poolLimit || '—' }} · Bracket {{ bracketLimit || '—' }} · Champ {{ championshipLimit || '—' }} · Slot {{ gameTimeSlot || '—' }} (min)</dd></div>
              <div><dt>Tie breakers</dt><dd>{{ selectedSeedNames.length ? selectedSeedNames.join(', ') : 'Event default' }}</dd></div>
              <div><dt>Entry fee</dt><dd>{{ entryFee ? ('$' + entryFee) : '—' }}</dd></div>
              <div><dt>Registration</dt><dd>{{ reviewRegistration }}</dd></div>
            </template>
          </dl>
          <p v-if="saveError" class="mg-evt-form__error" role="alert">{{ saveError }}</p>
        </section>
        </template>
      </div>
    </div>

    <template #footer>
      <button v-if="!isFirstStep" type="button" class="secondary-button" @click="goBack">Back</button>
      <button v-else type="button" class="secondary-button" @click="close">Cancel</button>
      <span class="mg-evt-form__foot-spacer"></span>
      <button v-if="!isLastStep" type="button" class="primary-button" @click="goNext">Next</button>
      <button v-else type="button" class="primary-button" :disabled="!canSubmit" @click="onSubmit">
        <span v-if="saving" class="btn-spinner" aria-hidden="true"></span>
        {{ saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Create event') }}
      </button>
    </template>
  </SlideModal>

  <ImageEditorModal
    :model-value="imageEditorOpen"
    mode="cover"
    title="Edit event image"
    :initial-url="avatarPreviewUrl || ''"
    :aspect-options="['16:9', '1:1']"
    @update:modelValue="imageEditorOpen = $event"
    @save="onImageSaved"
    @remove="clearImage"
  />
</template>

<style scoped>
.slide-modal-panel__footer .primary-button { background: var(--primary); }

/* Two-column layout: fixed left rail + scrolling panel. Collapses to a
   stacked layout on narrow viewports (rail becomes a horizontal strip). */
.mg-evt-form {
  display: grid;
  grid-template-columns: 248px 1fr;
  min-height: 100%;
  min-width: 0;
}

/* ── Left rail stepper ── */
.mg-evt-form__rail {
  /* Soft neutral surface — same highlighted-rail treatment as the
     division popup's summary card. */
  border-right: 1px solid #e4e7ec;
  background: #f4f5f7;
  padding: 20px 14px;
}
html.dark-mode .mg-evt-form__rail { background: rgba(255, 255, 255, 0.05); border-right-color: rgba(255, 255, 255, 0.12); }
.mg-evt-form__steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.mg-evt-form__step-btn {
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
.mg-evt-form__step-btn:hover:not(:disabled) { background: var(--surface-card); }
.mg-evt-form__step-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.mg-evt-form__step--active .mg-evt-form__step-btn { background: var(--surface-card); box-shadow: inset 0 0 0 1px var(--border-divider); }
.mg-evt-form__step-node {
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
.mg-evt-form__step--active .mg-evt-form__step-node { background: var(--primary); border-color: var(--primary); color: #fff; }
.mg-evt-form__step--done .mg-evt-form__step-node { background: var(--primary-light-3, #eef4fd); border-color: var(--primary); color: var(--primary); }
.mg-evt-form__step-check {
  width: 20px; height: 20px;
  background-color: var(--primary);
  -webkit-mask: url('../assets/tick-circle-twotone.svg') center / contain no-repeat;
  mask: url('../assets/tick-circle-twotone.svg') center / contain no-repeat;
}
.mg-evt-form__step-text { display: flex; flex-direction: column; min-width: 0; }
.mg-evt-form__step-label { font-size: 14px; font-weight: 600; }
.mg-evt-form__step-hint { font-size: 11px; color: var(--secondary); }

/* ── Panel ── */
.mg-evt-form__panel-wrap { min-width: 0; padding: 22px 24px 24px; overflow-y: auto; }
.mg-evt-form__panel { display: flex; flex-direction: column; gap: 16px; max-width: 720px; margin-left: auto; margin-right: auto; }
.mg-evt-form__panel--wide { max-width: 940px; }
.mg-evt-form__field { margin: 0; }

.mg-evt-form__grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.mg-evt-form__grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.mg-evt-form__grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
.mg-evt-form__phone-grid { display: grid; grid-template-columns: 160px 1fr; gap: 16px; }

/* Segmented InPerson / Online toggle. */
.mg-evt-form__seg {
  display: inline-flex;
  gap: 8px;
  padding: 4px;
  border-radius: 10px;
  background: var(--surface-muted, #f4f7fb);
  border: 1px solid var(--border-divider);
  align-self: flex-start;
}
html.dark-mode .mg-evt-form__seg { background: rgba(255, 255, 255, 0.04); }
.mg-evt-form__seg-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 7px;
  padding: 7px 16px;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  color: var(--secondary);
  cursor: pointer;
}
.mg-evt-form__seg-btn--active {
  background: var(--surface-card);
  border-color: var(--primary);
  color: var(--primary);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}
/* Two-tone toggle icons — masked so the 0.4-opacity background path stays
   faded while the icon takes the button's current text color (secondary →
   primary when active). location-twotone = in person, video-twotone = online. */
.mg-evt-form__seg-icon {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  background-color: currentColor;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}
.mg-evt-form__seg-icon--inperson {
  -webkit-mask-image: url('../assets/location-twotone.svg');
  mask-image: url('../assets/location-twotone.svg');
}
.mg-evt-form__seg-icon--online {
  -webkit-mask-image: url('../assets/video-twotone.svg');
  mask-image: url('../assets/video-twotone.svg');
}
/* Section heading — accent-bar style matching the association-user modal's
   "Permissions" section title. */
.mg-evt-form__subhead {
  margin: 0;
  padding-left: 10px;
  border-left: 3px solid var(--primary, #2d8cf0);
  font-family: var(--font-body);
  font-size: 1rem;
  font-weight: 500;
  color: var(--text);
  line-height: 1.2;
}
.mg-evt-form__subhead-hint { font-weight: 400; font-size: 12px; color: var(--secondary); }
.mg-evt-form__hint { margin: 0; font-size: 13px; color: var(--secondary); }

/* Google Places search at the top of the Location step — the shared
   MapPlaceSearch is capped at 520px for its map-overlay use; let it span
   the form column here (parent owns layout per the scoped-CSS convention). */
.mg-evt-form__placesearch { position: relative; z-index: 5; }
.mg-evt-form__placesearch :deep(.mapx-search) { width: 100%; position: relative; }
/* Float the predictions over the content below (the map) instead of
   pushing it down when suggestions appear. */
.mg-evt-form__placesearch :deep(.mapx-search__list) {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 8px);
  margin: 0;
  z-index: 40;
}

/* Field configuration card — one green surface (like FieldLineupPreview's
   field treatment) holding the picker + the field diagram, so the control
   reads as part of the field. */
.mg-evt-form__fieldcard {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px;
  border-radius: 12px;
  /* Always visible (sport type lives inside it now) and stretches to the
     full column height — the grid stretches both columns to the taller one,
     so flex:1 fills the right column to match the left. */
  flex: 1 1 auto;
  /* Outfield green — matches softball-field.png + the lineup-preview
     modal (`#258C31`) so the diagram bleeds into the surround. */
  background: #258C31;
  border: none;
}
html.dark-mode .mg-evt-form__fieldcard {
  /* Dull the field in dark mode — equivalent to a 60% black wash over
     the green (#258C31 × 0.4), mirroring the lineup-preview overlay. */
  background: #0e3814;
}
/* Sport type + field config sit side-by-side on the green field. */
.mg-evt-form__fieldcard-row { display: flex; gap: 12px; }
.mg-evt-form__fieldcard-row .mg-evt-form__fieldselect { flex: 1 1 0; min-width: 0; }
/* Hint sits on the green card under the pickers — readable translucent white,
   pulled flush to the row above (the card uses a 14px gap). */
.mg-evt-form__fieldcard-hint {
  margin: -8px 0 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
}

/* Umpire configuration list — pinned to the card's bottom-left, on the
   green. `margin-top: auto` claims the card's spare height below the
   diagram; `align-self: flex-start` keeps it left. */
.mg-evt-form__umpires {
  margin-top: auto;
  align-self: flex-start;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.mg-evt-form__umpires-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.7);
  margin-bottom: 2px;
}
.mg-evt-form__umpire-row { font-size: 12.5px; font-weight: 600; color: #fff; }

/* The picker sits ON the green field — a semi-transparent control (no
   floating label) so it reads as part of the field rather than a card. */
.mg-evt-form__fieldselect { position: relative; margin: 0; }
.mg-evt-form__fieldselect-control {
  width: 100%;
  box-sizing: border-box;
  appearance: none;
  -webkit-appearance: none;
  padding: 12px 38px 12px 14px;
  border-radius: 9px;
  border: 1px solid rgba(255, 255, 255, 0.55);
  background-color: rgba(255, 255, 255, 0.18);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 14px center;
  background-size: 12px;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}
.mg-evt-form__fieldselect-control:hover:not(:disabled) { background-color: rgba(255, 255, 255, 0.24); }
.mg-evt-form__fieldselect-control:disabled { opacity: 0.55; cursor: not-allowed; }
.mg-evt-form__fieldselect-control:focus {
  outline: none;
  border-color: #fff;
  background-color: rgba(255, 255, 255, 0.28);
}
/* Native option list renders on a solid surface — force readable colours
   so it isn't white-on-white when opened. */
.mg-evt-form__fieldselect-control option { color: var(--text); background: var(--white); }
.mg-evt-form__fieldselect--invalid .mg-evt-form__fieldselect-control {
  border-color: var(--highlight);
}
/* Diagram wrapper — sizes/centres the shared <FieldPositionPreview> on the
   green card (it renders its own 460-frame SVG + pins). */
.mg-evt-form__fieldcard-pitch {
  width: 100%;
  max-width: 420px;
  /* Centred horizontally, sits just below the picker row. The umpire list
     below claims the remaining height (margin-top:auto) and pins itself to
     the card's bottom-left. */
  margin: 0 auto;
}

.mg-evt-form__toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.mg-evt-form__toggle-text { font-size: 14px; font-weight: 600; color: var(--text); }

/* Setting row — title + description on the left, toggle on the right. */
.mg-evt-form__setting {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 12px 0;
  border-top: 1px solid var(--border-divider);
}
.mg-evt-form__setting:first-of-type { border-top: none; }
/* No divider — the setting belongs to the section above it (e.g. auto-confirm
   is part of the credit-card payments block). */
.mg-evt-form__setting--flush { border-top: none; }

/* Registration-payment preview uses the shared primary banner; this hook
   only owns its spacing in the column. */
.mg-evt-form__pay-preview { margin: 0; }
.mg-evt-form__setting-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.mg-evt-form__setting-title { font-size: 14px; font-weight: 600; color: var(--text); }
.mg-evt-form__setting-desc { font-size: 13px; color: var(--secondary); }
.mg-evt-form__field--disabled { opacity: 0.5; }

/* Cover banner — hero image, or a deterministic colored tile + calendar
   icon (palette via `heroStyle` → --avatar-bg / --avatar-fg). */
.mg-evt-form__cover {
  position: relative;
  width: 100%;
  height: 208px;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--border-divider);
  background: var(--surface-muted, #f4f7fb);
}
.mg-evt-form__cover--initial {
  background: var(--avatar-bg);
  display: flex;
  align-items: center;
  justify-content: center;
}
/* Blurred backdrop fills the band around the contained full image — mirrors
   the public event hero so square or landscape covers show uncropped. */
.mg-evt-form__cover-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  transform: scale(1.12);
  filter: blur(22px) brightness(0.85);
  z-index: 0;
}
.mg-evt-form__cover-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: center;
  display: block;
  z-index: 1;
}
.mg-evt-form__cover-icon {
  width: 56px;
  height: 56px;
  background-color: var(--avatar-fg);
  -webkit-mask: url('../assets/calendar.svg') center / contain no-repeat;
  mask: url('../assets/calendar.svg') center / contain no-repeat;
}
.mg-evt-form__cover-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 2;
  appearance: none;
  border: 1px solid var(--border-divider);
  background: var(--surface-card);
  color: var(--text);
  border-radius: 8px;
  padding: 6px 12px;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
}
.mg-evt-form__cover-btn:hover { border-color: var(--primary); color: var(--primary); }

/* Details rows: identity row (stacked fields), then a two-column row. */
.mg-evt-form__row { display: flex; flex-direction: column; gap: 16px; }
/* Toggle + name on one line (toggle fixed, name fills the rest). */
.mg-evt-form__name-row { display: flex; align-items: center; gap: 16px; }
.mg-evt-form__name-field { flex: 1 1 auto; min-width: 0; }
@media (max-width: 620px) {
  .mg-evt-form__name-row { flex-direction: column; align-items: stretch; }
}
.mg-evt-form__cols { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 12px; }
.mg-evt-form__col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
/* Format step ONLY — field-config card on the LEFT, controls on the RIGHT
   (DOM order is controls-then-card; `order` swaps the visual columns without
   reflowing the markup). Scoped to `--swap` so other two-column steps
   (Details) keep their natural order. On a single mobile column the card
   drops below the controls. */
@media (min-width: 721px) {
  .mg-evt-form__cols--swap > .mg-evt-form__col:nth-child(1) { order: 2; }
  .mg-evt-form__cols--swap > .mg-evt-form__col:nth-child(2) { order: 1; }
}
.mg-evt-form__rangefield { display: flex; flex-direction: column; gap: 6px; }
.mg-evt-form__range-label { font-size: 12px; font-weight: 600; color: var(--secondary); }

/* Swap the DateRangePicker's built-in glyph for the app's themed LINE
   calendar icon (`calendar.svg`, stroke-based — matches the time controls'
   line clock), scoped to this modal so other pickers are unchanged. */
.mg-evt-form__rangefield :deep(.date-range-picker__trigger-icon) { display: none; }
.mg-evt-form__rangefield :deep(.date-range-picker__trigger)::after {
  content: '';
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  background-color: var(--text);
  -webkit-mask: url('../assets/calendar.svg') center / contain no-repeat;
  mask: url('../assets/calendar.svg') center / contain no-repeat;
}
@media (max-width: 980px) {
  .mg-evt-form__cols { grid-template-columns: 1fr; }
}

.mg-evt-form__foot-spacer { flex: 1 1 auto; }

.mg-evt-form__placeholder { color: var(--secondary); font-size: 14px; }

/* Edit-mode load skeleton (reuses the global `.shimmer-block` sweep). */
.mg-evt-form__skeleton { gap: 16px; }
.mg-evt-form__sk-cover { height: 168px; border-radius: 12px; }
.mg-evt-form__sk-namerow { display: flex; gap: 16px; align-items: center; }
.mg-evt-form__sk-grow { flex: 1 1 auto; }
.mg-evt-form__sk-toggle { flex: 0 0 auto; width: 200px; height: 38px; border-radius: 8px; }
.mg-evt-form__sk-field { height: 38px; border-radius: 6px; }
.mg-evt-form__sk-label { height: 16px; width: 140px; border-radius: 4px; }
@media (max-width: 620px) {
  .mg-evt-form__sk-namerow { flex-direction: column; align-items: stretch; }
  .mg-evt-form__sk-toggle { width: 100%; }
}
.mg-evt-form__error { margin: 0; font-size: 13px; color: var(--danger, #b03e3e); }
html.dark-mode .mg-evt-form__error { color: #ef6f6f; }

/* Heading row — section title on the left, its validation error right-aligned
   on the same line (keeps the form below from shifting when the error shows). */
.mg-evt-form__subhead-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.mg-evt-form__error--inline { font-size: 12px; text-align: right; }

/* Review recap. */
.mg-evt-form__review-banner { margin-bottom: 16px; }
/* Stripe-not-connected warning sits just under the credit-card toggle. */
.mg-evt-form__stripe-banner { margin-top: -4px; }

/* Payment-terms toggle + (partial) type + value on one row. */
.mg-evt-form__payterms-row { display: flex; align-items: center; gap: 16px; }
.mg-evt-form__payterms-grow { flex: 1 1 0; min-width: 0; }
/* Value hint — right-aligned and flush under the control (cancels the
   panel's 16px row gap so there's no space above it). */
.mg-evt-form__payterms-hint { text-align: right; margin-top: -16px; }
.mg-evt-form__review { margin: 0; display: flex; flex-direction: column; gap: 0; }
.mg-evt-form__review > div {
  display: grid;
  grid-template-columns: 160px 1fr;
  gap: 16px;
  padding: 10px 0;
  border-top: 1px solid var(--border-divider);
}
.mg-evt-form__review > div:first-child { border-top: none; }

/* Review header — cover thumbnail + event name on top (mirrors the team
   review header). */
.mg-evt-form__review-head { display: flex; align-items: center; gap: 14px; margin-bottom: 4px; }
.mg-evt-form__review-cover {
  position: relative;
  flex: 0 0 auto;
  width: 96px;
  height: 54px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border-divider);
  background: var(--surface-muted, #f4f7fb);
}
.mg-evt-form__review-cover--initial { background: var(--avatar-bg); display: flex; align-items: center; justify-content: center; }
.mg-evt-form__review-cover-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mg-evt-form__review-cover-icon {
  width: 26px; height: 26px; background-color: var(--avatar-fg);
  -webkit-mask: url('../assets/calendar.svg') center / contain no-repeat;
  mask: url('../assets/calendar.svg') center / contain no-repeat;
}
.mg-evt-form__review-name { font-size: 18px; font-weight: 600; color: var(--text); min-width: 0; }
.mg-evt-form__review dt { margin: 0; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--secondary); }
.mg-evt-form__review dd { margin: 0; font-size: 14px; color: var(--text); }
@media (max-width: 720px) {
  .mg-evt-form__review > div { grid-template-columns: 1fr; gap: 2px; }
}

@media (max-width: 720px) {
  .mg-evt-form { grid-template-columns: 1fr; }
  .mg-evt-form__rail { border-right: none; border-bottom: 1px solid var(--border-divider); padding: 12px; }
  .mg-evt-form__steps { flex-direction: row; overflow-x: auto; gap: 8px; }
  .mg-evt-form__step-hint { display: none; }
  .mg-evt-form__grid2, .mg-evt-form__phone-grid, .mg-evt-form__grid3 { grid-template-columns: 1fr; }
  .mg-evt-form__grid4 { grid-template-columns: 1fr 1fr; }
}
</style>
