<script setup lang="ts">
// RegisterTeamModal
// -----------------
// Left-rail stepped wizard for registering a NEW team or editing an existing
// registration — mirrors the Events / Divisions wizard (`mg-evt-form` /
// `mg-div-form`); this is the parallel `mg-team-form` instance.
//
//   Step 1 · Details      — team info + manager info (logo upload, PhoneInput,
//                           and a live WIF manager-email lookup).
//   Step 2 · Registration — CREATE: "Activate now" toggle (default ON) + the
//                           validity fields. EDIT: current status + the
//                           lifecycle actions (reusing TeamValidityModal /
//                           SuspendTeamConfirmModal — the same popups the
//                           listing ellipsis opens), applied immediately.
//   Step 3 · Review        — summary + Save.
//
// Mode is driven by `initial` (null → Register, a team → Edit), same public
// surface as before so the mount sites (AssociationTeamsView /
// AssociationTeamDetailsView) are unchanged.

import { computed, ref, watch } from 'vue'
import SlideModal from './SlideModal.vue'
import ImageEditorModal from './ImageEditorModal.vue'
import PhoneInput from './PhoneInput.vue'
import ManagerEmailLookup from './ManagerEmailLookup.vue'
import TeamValidityModal from './TeamValidityModal.vue'
import SuspendTeamConfirmModal from './SuspendTeamConfirmModal.vue'
import ToggleSwitch from './ToggleSwitch.vue'
import TeamAvatar from './TeamAvatar.vue'
import CustomFieldsRenderer from './CustomFieldsRenderer.vue'
import DateTimePicker from './DateTimePicker.vue'
import { fetchPlaceById, parseCityStateText, searchPlacePredictions } from '../api/placesLookup'
import { fetchCustomFieldDefinitions } from '../api/customFields'
import { fetchSportTypes } from '../api/sportTypes'
import googleG from '../assets/google-g.svg'
import { fetchRegistrationSettings } from '../api/associationRegSettings'
import { currentAssociation } from '../constants/associations'
import { US_REGIONS } from '../constants/regions'
import {
  GENDERS,
  registerAssociationTeam,
  updateAssociationTeam,
  markAssociationTeamActive,
  renewAssociationTeam,
  reactivateAssociationTeam,
  updateAssociationTeamValidity,
  suspendAssociationTeam,
  rejectAssociationTeam,
  type RegisterAssociationTeamPayload
} from '../api/associationTeams'
import { fetchAgeGroups } from '../api/ageRatingCatalogue'
import { fetchRatings } from '../api/associationRatings'
import { pushToast } from '../toast-center'
import { applyPlatformFee, formatMoney, limitTwoDecimals } from '../lib/money'
import type { AssociationTeam, PlacePrediction, CustomFieldDefinition, RegistrationSetting, SportType, AgeGroupOption, RatingOption } from '../types'

// Catalogues — loaded (page-cached) from the shared APIs on open. Age groups
// are global; ratings are association-scoped. After loading we reconcile a
// label-only (older/demo) team to its id by name so the edit select preselects.
const sportTypes = ref<SportType[]>([])
async function loadSportTypes() {
  if (sportTypes.value.length) return
  sportTypes.value = await fetchSportTypes()
}
const ageGroups = ref<AgeGroupOption[]>([])
async function loadAgeGroups() {
  if (!ageGroups.value.length) ageGroups.value = await fetchAgeGroups()
  if (!ageGroupId.value && props.initial?.ageGroup) {
    const match = ageGroups.value.find((a) => a.name === props.initial!.ageGroup)
    if (match) ageGroupId.value = match.id
  }
}
const ratings = ref<RatingOption[]>([])
async function loadRatings() {
  const associationId = currentAssociation.value?.id
  if (!ratings.value.length) ratings.value = await fetchRatings({ associationId })
  if (!ratingId.value && props.initial?.rating) {
    const match = ratings.value.find((r) => r.name === props.initial!.rating)
    if (match) ratingId.value = match.id
  }
}

const props = withDefaults(defineProps<{
  modelValue: boolean
  associationShortName?: string
  /** Existing team to edit. Pass `null` (or omit) for the Register flow. */
  initial?: AssociationTeam | null
}>(), {
  associationShortName: '',
  initial: null
})

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'saved', team: AssociationTeam): void
}>()

const isEdit = computed(() => Boolean(props.initial))
const title = computed(() => (isEdit.value ? 'Edit Team' : 'New Team'))
const eyebrow = computed(() => (props.associationShortName || '').toUpperCase())

// ── Steps ────────────────────────────────────────────────────────
type StepKey = 'details' | 'registration' | 'additional' | 'review'
interface StepDef { key: StepKey; label: string; hint: string }
const STEPS = computed<StepDef[]>(() => {
  const base: StepDef[] = [
    { key: 'details', label: 'Details', hint: 'Team & manager info' },
    { key: 'registration', label: 'Registration', hint: isEdit.value ? 'Status & lifecycle' : 'Activate the team' }
  ]
  // Drop the Additional-details step when the association has no team custom fields.
  if (customFieldDefs.value.length) {
    base.push({ key: 'additional', label: 'Additional details', hint: 'Custom fields' })
  }
  base.push({ key: 'review', label: 'Review', hint: 'Confirm & save' })
  return base
})
const step = ref<StepKey>('details')
const stepIndex = computed(() => STEPS.value.findIndex((s) => s.key === step.value))
const isFirstStep = computed(() => stepIndex.value === 0)
const isLastStep = computed(() => stepIndex.value === STEPS.value.length - 1)
/** Create = linear (can only revisit done steps); edit = free jump. */
function canVisit(i: number) { return isEdit.value || i <= stepIndex.value }
function goToStep(key: StepKey) {
  const i = STEPS.value.findIndex((s) => s.key === key)
  if (i >= 0 && canVisit(i)) step.value = key
}

// ── Form state ───────────────────────────────────────────────────
const logoDataUrl = ref<string | null>(null)
const teamName = ref('')
const externalRegNo = ref('')
const city = ref('')
const state = ref('')
const region = ref('')
const sportsTypeId = ref('')
const gender = ref<'' | 'Male' | 'Female' | 'Coed'>('')
const ageGroupId = ref('')
const ratingId = ref('')
const lastUpdateDate = ref('')
const managerName = ref('')
const managerEmail = ref('')
const managerDialCode = ref('+1')
const managerPhone = ref('')
const managerLinkedUserId = ref<string | null>(null)
const sendManagerInvite = ref(false)

// ── Registration settings for the `team` type — drives payment behaviour ──
// Loaded on open. `payment_applicable` + `applicable_fee` decide whether a fee
// applies (the admin can't override it); `never_expires` / `duration_days` are
// the inherited validity granted on activation. The backend creates the
// payment order/payable from these + the collection choice below.
const teamRegSetting = ref<RegistrationSetting | null>(null)
async function loadTeamRegSetting() {
  const id = currentAssociation.value?.id
  if (!id) { teamRegSetting.value = null; return }
  try {
    const rows = await fetchRegistrationSettings({ associationId: id, type: 'team' })
    teamRegSetting.value = rows[0] ?? null
  } catch { teamRegSetting.value = null }
  // Pre-select the first available collection option (display order:
  // online → offline → later) so the top choice is active on landing.
  collection.value = canCollectOnline.value ? 'online' : canCollectOffline.value ? 'offline' : 'later'
  // Default the manual amount to the full payable (fee + platform fee) so the
  // common "paid in full" case needs no typing; admin can lower it for partials.
  payAmount.value = previewTotal.value > 0 ? previewTotal.value.toFixed(2) : ''
  paidDate.value = todayIso()
}
const paymentApplicable = computed(() => !isEdit.value && !!teamRegSetting.value?.paymentApplicable)
const fee = computed(() => teamRegSetting.value?.applicableFee ?? null)
const settingNeverExpires = computed(() => teamRegSetting.value?.neverExpires ?? false)
const settingDurationDays = computed(() => teamRegSetting.value?.durationDays ?? 365)
const stripeConnected = computed(() => currentAssociation.value?.stripeConnected !== false)
// Per-type payment rails (from team reg settings). Online needs Stripe AND
// card allowed; offline needs offline allowed. Absent setting ⇒ allowed.
const allowCardPayment = computed(() => teamRegSetting.value?.allowCardPayment !== false)
const allowOfflinePayment = computed(() => teamRegSetting.value?.allowOfflinePayment !== false)
const canCollectOnline = computed(() => stripeConnected.value && allowCardPayment.value)
const canCollectOffline = computed(() => allowOfflinePayment.value)

// Create-only registration choices.
const activateNow = ref(true)                                     // no-fee path
const collection = ref<'later' | 'online' | 'offline'>('later')  // fee path
const offlineMethod = ref<'cash' | 'check' | 'bank_transfer' | 'other'>('cash')
const offlineReference = ref('')
const offlineNotes = ref('')
// Manual-payment amount (string while typing) + date paid (YYYY-MM-DD). Amount
// defaults to the full fee but is editable so an admin can log a partial payment
// (e.g. half now, balance later). Date defaults to today.
const payAmount = ref('')
const paidDate = ref('')
function todayIso(): string { return new Date().toISOString().slice(0, 10) }
function onPayAmountInput(event: Event) {
  const el = event.target as HTMLInputElement
  const v = limitTwoDecimals(el.value)
  if (v !== el.value) el.value = v
  payAmount.value = v
}

function addDaysIso(days: number): string {
  const d = new Date(); d.setDate(d.getDate() + Math.max(0, days)); return d.toISOString().slice(0, 10)
}
// Inherited validity (from settings) granted on activation — read-only in the wizard.
const inheritedValidUntil = computed(() => (settingNeverExpires.value ? '' : addDaysIso(settingDurationDays.value)))
const inheritedValidityText = computed(() =>
  settingNeverExpires.value
    ? 'Never expires'
    : `Valid ${settingDurationDays.value} days (through ${formatDateDisplay(inheritedValidUntil.value)})`
)
// Banner phrasing: "Valid Thru <date> (<n> days)".
const bannerValidityText = computed(() =>
  settingNeverExpires.value
    ? 'Never expires'
    : `Valid Thru ${formatDateDisplay(inheritedValidUntil.value)} (${settingDurationDays.value} days)`
)
// Association short name for inline copy (falls back until loaded).
const assocShortName = computed(() => currentAssociation.value?.shortName || 'Association')

// ── Payment preview (create, fee path) — same math as the backend mock:
// platform fee = 3.5% of (gross − discount); payable = gross − discount + fee.
// Shown for ALL collection modes; only "Paid" differs (manual = amount entered;
// online link / collect-later = 0 until the order is settled later).
const previewFee = computed(() => fee.value ?? 0)
const previewDiscount = computed(() => 0)
// Platform fee from the type's resolved rule (reg-settings GET) — applied to the
// net (gross − discount). Informational preview; the backend re-resolves.
const previewPlatformFee = computed(
  () => applyPlatformFee(previewFee.value - previewDiscount.value, teamRegSetting.value?.platformFee)
)
const previewTotal = computed(
  () => Math.round((previewFee.value - previewDiscount.value + previewPlatformFee.value) * 100) / 100
)
const previewPaid = computed(() => {
  if (collection.value !== 'offline') return 0
  const n = Number(payAmount.value)
  return Number.isFinite(n) && n > 0 ? Math.min(n, previewTotal.value) : 0
})
const previewBalance = computed(
  () => Math.round((previewTotal.value - previewPaid.value) * 100) / 100
)
// Manual amount must be > 0 and not exceed the total owed (partials allowed).
const paymentInvalid = computed(() => {
  if (isEdit.value || !paymentApplicable.value || collection.value !== 'offline') return false
  const n = Number(payAmount.value)
  return !(n > 0) || n > previewTotal.value + 0.001
})

const showErrors = ref(false)
const saving = ref(false)

// Working copy of the team in edit mode — reflects lifecycle changes applied
// from the Registration step without closing the wizard.
const current = ref<AssociationTeam | null>(null)

// ── Custom fields (Additional details step) ──────────────────────
// Association-defined custom controls for the `team` entity — same renderer +
// encoder as the event form. The step only appears when the association has
// team custom fields.
const customFieldDefs = ref<CustomFieldDefinition[]>([])
const customFieldValues = ref<Record<string, boolean | string | string[]>>({})
async function loadCustomFields() {
  customFieldDefs.value = await fetchCustomFieldDefinitions('team', {
    associationId: currentAssociation.value?.id ?? '',
    associationShortName: props.associationShortName
  }).catch(() => [])
}
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

// Required custom fields still empty (reuses the encoder — non-empty values
// only, booleans always present so never flagged).
const customFieldErrors = computed<string[]>(() => {
  const present = new Set(buildCustomFields().map((c) => c.definitionId))
  return customFieldDefs.value.filter((d) => d.required && !present.has(d.id)).map((d) => d.id)
})

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function reset() {
  logoDataUrl.value = null
  teamName.value = ''
  externalRegNo.value = ''
  city.value = ''
  state.value = ''
  cityStateQuery.value = ''
  cityPredictions.value = []
  cityOpen.value = false
  region.value = ''
  sportsTypeId.value = ''
  gender.value = ''
  ageGroupId.value = ''
  ratingId.value = ''
  lastUpdateDate.value = ''
  managerName.value = ''
  managerEmail.value = ''
  managerDialCode.value = '+1'
  managerPhone.value = ''
  managerLinkedUserId.value = null
  sendManagerInvite.value = false
  activateNow.value = true
  collection.value = 'later'
  offlineMethod.value = 'cash'
  offlineReference.value = ''
  offlineNotes.value = ''
  payAmount.value = ''
  paidDate.value = todayIso()
  customFieldValues.value = {}
  showErrors.value = false
  step.value = 'details'
  current.value = null
}

function hydrate(team: AssociationTeam) {
  reset()
  current.value = { ...team }
  teamName.value = team.name
  logoDataUrl.value = team.avatarUrl ?? null
  externalRegNo.value = team.externalRegNo
  city.value = team.city
  state.value = team.state
  cityStateQuery.value = team.city && team.state ? `${team.city}, ${team.state}` : (team.city ?? '')
  region.value = team.region ?? ''
  gender.value = team.gender
  ageGroupId.value = team.ageGroupId ?? ''
  ratingId.value = team.ratingId ?? ''
  sportsTypeId.value = team.sportsTypeId ?? ''
  lastUpdateDate.value = team.lastUpdatedAt
    ? new Date(team.lastUpdatedAt).toISOString().slice(0, 10)
    : ''
  managerName.value = team.managerName
  managerEmail.value = team.managerEmail
  managerDialCode.value = team.managerDialCode ?? '+1'
  managerPhone.value = team.managerPhone
  managerLinkedUserId.value = team.managerLinkedUserId ?? null
  customFieldValues.value = {}
  for (const cf of team.customFields ?? []) {
    customFieldValues.value[cf.definitionId] = cf.value
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    if (props.initial) hydrate(props.initial)
    else reset()
    void loadSportTypes()
    void loadAgeGroups()
    void loadRatings()
    void loadCustomFields()
    void loadTeamRegSetting()
  }
)
watch(
  () => props.initial,
  (next) => {
    // Re-hydrate only when SWITCHING to a different team while open — not when
    // the parent replaces `initial` with an updated copy of the SAME team after
    // an inline lifecycle action (that would reset the step / working copy).
    if (props.modelValue && next && next.id !== current.value?.id) hydrate(next)
  }
)

// ── Validation ───────────────────────────────────────────────────
const detailsErrors = computed(() => {
  const e = new Set<string>()
  if (!teamName.value.trim()) e.add('teamName')
  if (!city.value.trim() || !state.value) e.add('cityState')
  if (!gender.value) e.add('gender')
  if (!ageGroupId.value) e.add('ageGroup')
  if (!ratingId.value) e.add('rating')
  if (!managerName.value.trim()) e.add('managerName')
  if (!EMAIL_RE.test(managerEmail.value.trim())) e.add('managerEmail')
  return e
})
function err(field: string) { return showErrors.value && detailsErrors.value.has(field) }

// The registration step has no required free-input fields (fee + validity are
// inherited from settings; the collection choice + offline method default), so
// it's always valid — Save is gated by Details + custom fields only.
const canSubmit = computed(() =>
  detailsErrors.value.size === 0 && customFieldErrors.value.length === 0 && !paymentInvalid.value
)

// ── Navigation ───────────────────────────────────────────────────
function close() {
  if (saving.value) return
  emit('update:modelValue', false)
}
function goBack() {
  if (!isFirstStep.value) step.value = STEPS.value[stepIndex.value - 1].key
}
function goNext() {
  showErrors.value = true
  if (step.value === 'details') applyTypedCityState()
  if (step.value === 'details' && detailsErrors.value.size) return
  if (step.value === 'registration' && paymentInvalid.value) return
  if (step.value === 'additional' && customFieldErrors.value.length) return
  showErrors.value = false
  if (!isLastStep.value) step.value = STEPS.value[stepIndex.value + 1].key
}

// ── City / State via Google Places (themed field, not a separate box) ────
// The City/State floating-input IS the search: the admin types, picks a
// prediction, and we read back the locality + two-letter state so the value
// is never mistyped. Typing again clears the resolved pair, forcing a fresh
// pick so the submitted city/state always match a real place.
const cityStateQuery = ref('')
const cityPredictions = ref<PlacePrediction[]>([])
const cityOpen = ref(false)
const citySearching = ref(false)
let cityDebounce: ReturnType<typeof setTimeout> | null = null
let citySeq = 0

function onCityInput() {
  cityOpen.value = true
  city.value = ''
  state.value = ''
  if (cityDebounce) clearTimeout(cityDebounce)
  const q = cityStateQuery.value.trim()
  if (q.length < 2) { cityPredictions.value = []; citySearching.value = false; return }
  citySearching.value = true
  const seq = ++citySeq
  cityDebounce = setTimeout(() => {
    void searchPlacePredictions(q, { types: ['(cities)'] }).then((rows) => {
      if (seq !== citySeq) return
      cityPredictions.value = rows
      citySearching.value = false
    })
  }, 250)
}
async function pickPlace(p: PlacePrediction) {
  cityOpen.value = false
  cityPredictions.value = []
  const place = await fetchPlaceById(p.placeId)
  if (!place) return
  city.value = place.city || ''
  state.value = place.state || ''
  cityStateQuery.value = city.value && state.value ? `${city.value}, ${state.value}` : (place.city || p.primaryText)
}

function applyTypedCityState() {
  if (city.value.trim() && state.value.trim()) return
  const parsed = parseCityStateText(cityStateQuery.value)
  if (!parsed) return
  city.value = parsed.city
  state.value = parsed.state
  cityStateQuery.value = `${parsed.city}, ${parsed.state}`
}

// ── Logo (cropper) ───────────────────────────────────────────────
const imageEditorOpen = ref(false)
function openImageEditor() { imageEditorOpen.value = true }
function onLogoSaved(dataUrl: string) { logoDataUrl.value = dataUrl }
function clearLogo() { logoDataUrl.value = null }

// ── Edit-mode lifecycle sub-popups ───────────────────────────────
type ValidityFlow = 'mark-active' | 'renew' | 'reactivate' | 'change-validity'
type ConfirmFlow = 'suspend' | 'reject'
const validityModalOpen = ref(false)
const validityFlow = ref<ValidityFlow | null>(null)
const confirmModalOpen = ref(false)
const confirmFlow = ref<ConfirmFlow | null>(null)
const actionSaving = ref(false)

const validityCopy: Record<ValidityFlow, { title: string; submit: string; showSource: boolean }> = {
  'mark-active': { title: 'Mark Registration Active', submit: 'Mark Active', showSource: true },
  renew: { title: 'Renew Registration', submit: 'Renew', showSource: true },
  reactivate: { title: 'Reactivate Registration', submit: 'Reactivate', showSource: false },
  'change-validity': { title: 'Change Validity', submit: 'Save', showSource: false }
}
const validityTitle = computed(() => (validityFlow.value ? validityCopy[validityFlow.value].title : ''))
const validitySubmitLabel = computed(() => (validityFlow.value ? validityCopy[validityFlow.value].submit : 'Save'))
const validityShowSource = computed(() => (validityFlow.value ? validityCopy[validityFlow.value].showSource : false))

function openValidityFlow(flow: ValidityFlow) {
  validityFlow.value = flow
  validityModalOpen.value = true
}
function openSuspendConfirm() { confirmFlow.value = 'suspend'; confirmModalOpen.value = true }
function openRejectConfirm() { confirmFlow.value = 'reject'; confirmModalOpen.value = true }

async function onValiditySubmit(payload: {
  neverExpires: boolean; validUntil: string; reason: string
  source: 'payment' | 'manual' | null; paymentOrderId: string
}) {
  const team = current.value
  const flow = validityFlow.value
  if (!team || !flow) return
  actionSaving.value = true
  try {
    const validity = {
      neverExpires: payload.neverExpires,
      validUntil: payload.validUntil,
      reason: payload.reason || undefined,
      source: payload.source ?? undefined,
      paymentOrderId: payload.paymentOrderId || undefined
    }
    let result: AssociationTeam
    if (flow === 'mark-active') result = await markAssociationTeamActive(props.associationShortName, team.id, validity)
    else if (flow === 'renew') result = await renewAssociationTeam(props.associationShortName, team.id, validity)
    else if (flow === 'reactivate') result = await reactivateAssociationTeam(props.associationShortName, team.id, validity)
    else result = await updateAssociationTeamValidity(props.associationShortName, team.id, validity)
    current.value = result
    emit('saved', result)
    validityModalOpen.value = false
    pushToast({ tone: 'success', title: 'Registration updated', message: `${result.name}'s registration was updated.` })
  } catch (error) {
    pushToast({ tone: 'warning', title: 'Could not update', message: error instanceof Error ? error.message : 'Please try again.' })
  } finally {
    actionSaving.value = false
  }
}

async function onConfirmModalConfirm(payload: { reason: string }) {
  const team = current.value
  const flow = confirmFlow.value
  if (!team || !flow) return
  actionSaving.value = true
  try {
    const result = flow === 'suspend'
      ? await suspendAssociationTeam(props.associationShortName, team.id, payload)
      : await rejectAssociationTeam(props.associationShortName, team.id, payload)
    current.value = result
    emit('saved', result)
    confirmModalOpen.value = false
    pushToast({
      tone: 'success',
      title: flow === 'suspend' ? 'Team suspended' : 'Registration cancelled',
      message: `${result.name}'s registration was updated.`
    })
  } catch (error) {
    pushToast({ tone: 'warning', title: 'Could not update', message: error instanceof Error ? error.message : 'Please try again.' })
  } finally {
    actionSaving.value = false
  }
}

// ── Display helpers ──────────────────────────────────────────────
function formatDateDisplay(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  const year = Number(y); const month = Number(m); const day = Number(d)
  if (!year || !month || !day) return ''
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[month - 1]} ${String(day).padStart(2, '0')}, ${year}`
}
const statusLabels: Record<AssociationTeam['status'], string> = {
  pending: 'Pending', active: 'Active', expired: 'Expired', rejected: 'Cancelled', suspended: 'Suspended'
}
const currentValiditySummary = computed(() => {
  const t = current.value
  if (!t) return ''
  if (t.status === 'pending') return 'No validity yet — activate to set one.'
  if (t.neverExpires) return 'Never expires'
  return t.validUntil ? `Valid through ${formatDateDisplay(t.validUntil)}` : '—'
})
const sportTypeName = computed(
  () => sportTypes.value.find((s) => s.id === sportsTypeId.value)?.name ?? ''
)
const ageGroupName = computed(
  () => ageGroups.value.find((a) => a.id === ageGroupId.value)?.name ?? ''
)
const ratingName = computed(
  () => ratings.value.find((r) => r.id === ratingId.value)?.name ?? ''
)
const reviewLocation = computed(() => [city.value, state.value].filter(Boolean).join(', ') || '—')
const reviewManagerPhone = computed(() => (managerPhone.value ? `${managerDialCode.value} ${managerPhone.value}` : '—'))
const reviewManagerLink = computed(() =>
  managerLinkedUserId.value ? 'Linked to an existing WIF account' : 'Not on WIF — an invite will be sent'
)
const feeLabel = computed(() => (fee.value != null ? `$${fee.value}` : '—'))
const reviewActivation = computed(() => {
  if (isEdit.value) return ''
  if (!paymentApplicable.value) {
    return activateNow.value ? `Active · ${inheritedValidityText.value}` : 'Pending'
  }
  if (collection.value === 'offline') {
    const paid = `${formatMoney(previewPaid.value)} (${offlineMethod.value})`
    return previewBalance.value <= 0.001
      ? `Paid ${paid} · Active · ${inheritedValidityText.value}`
      : `Paid ${paid} · Balance ${formatMoney(previewBalance.value)} · Pending`
  }
  if (collection.value === 'online') {
    return `${formatMoney(previewTotal.value)} · Pending — payment link will be sent`
  }
  return `${formatMoney(previewTotal.value)} · Pending — collect later`
})

// ── Save ─────────────────────────────────────────────────────────
async function save() {
  showErrors.value = true
  applyTypedCityState()
  if (!canSubmit.value) {
    // Jump back to the first step with an error so it's visible.
    if (detailsErrors.value.size) step.value = 'details'
    else if (customFieldErrors.value.length) step.value = 'additional'
    return
  }
  saving.value = true
  try {
    const payload: RegisterAssociationTeamPayload = {
      name: teamName.value.trim(),
      externalRegNo: externalRegNo.value.trim(),
      city: city.value.trim(),
      state: state.value,
      region: region.value,
      gender: gender.value as 'Male' | 'Female' | 'Coed',
      ageGroupId: ageGroupId.value,
      ratingId: ratingId.value,
      sportsTypeId: sportsTypeId.value,
      lastUpdateDate: lastUpdateDate.value,
      managerName: managerName.value.trim(),
      managerEmail: managerEmail.value.trim(),
      managerDialCode: managerDialCode.value,
      managerPhone: managerPhone.value.trim(),
      managerLinkedUserId: managerLinkedUserId.value,
      sendManagerInvite: !managerLinkedUserId.value && sendManagerInvite.value,
      logoDataUrl: logoDataUrl.value,
      customFields: buildCustomFields()
    }
    if (!isEdit.value) {
      // Activate now when: no fee + "activate" chosen, OR a fee paid IN FULL
      // offline right now. A partial offline payment, online link, or
      // collect-later all stay Pending until the backend marks the order paid.
      const paidInFullOffline =
        collection.value === 'offline' && previewBalance.value <= 0.001
      const activateNowResolved = paymentApplicable.value
        ? paidInFullOffline
        : activateNow.value
      payload.registrationStatus = activateNowResolved ? 'active' : 'pending'

      // Validity is inherited from reg-settings (not admin-picked) and applied
      // on activation; pass it as the activation block when activating.
      if (activateNowResolved) {
        payload.activation = {
          neverExpires: settingNeverExpires.value,
          validUntil: settingNeverExpires.value ? undefined : inheritedValidUntil.value,
          source: paymentApplicable.value ? 'payment' : 'manual'
        }
      }

      // Payment collection choice — the backend reads this + reg-settings to
      // create the payment order / payable (fee = applicable_fee; no override).
      if (paymentApplicable.value) {
        const isOffline = collection.value === 'offline'
        payload.payment = {
          collection: collection.value,
          method: isOffline ? offlineMethod.value : undefined,
          amount: isOffline ? Number(payAmount.value) : undefined,
          paidAt: isOffline ? paidDate.value : undefined,
          reference: isOffline ? offlineReference.value.trim() || undefined : undefined,
          notes: isOffline ? offlineNotes.value.trim() || undefined : undefined
        }
      }
    }
    const result = isEdit.value && props.initial
      ? await updateAssociationTeam(props.associationShortName, props.initial.id, payload)
      : await registerAssociationTeam(props.associationShortName, payload)
    emit('saved', result)
    emit('update:modelValue', false)
    pushToast({
      tone: 'success',
      title: isEdit.value ? 'Team updated' : 'Team registered',
      message: isEdit.value
        ? `${result.name}'s details have been updated.`
        : `${result.name} has been added to the association.`
    })
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: isEdit.value ? 'Could not update team' : 'Could not register team',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
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
      <span v-if="eyebrow" class="slide-modal-panel__eyebrow">{{ eyebrow }}</span>
      <h2 class="slide-modal-panel__title">{{ title }}</h2>
    </template>

    <div class="mg-team-form">
      <!-- Left rail — vertical stepper. -->
      <nav class="mg-team-form__rail" aria-label="Team form steps">
        <ol class="mg-team-form__steps">
          <li
            v-for="(s, i) in STEPS"
            :key="s.key"
            class="mg-team-form__step"
            :class="{
              'mg-team-form__step--active': s.key === step,
              'mg-team-form__step--done': i < stepIndex
            }"
          >
            <button
              type="button"
              class="mg-team-form__step-btn"
              :disabled="!canVisit(i)"
              :aria-current="s.key === step ? 'step' : undefined"
              @click="goToStep(s.key)"
            >
              <span class="mg-team-form__step-node" aria-hidden="true">
                <span v-if="i < stepIndex" class="mg-team-form__step-check"></span>
                <span v-else class="mg-team-form__step-num">{{ i + 1 }}</span>
              </span>
              <span class="mg-team-form__step-text">
                <span class="mg-team-form__step-label">{{ s.label }}</span>
                <span class="mg-team-form__step-hint">{{ s.hint }}</span>
              </span>
            </button>
          </li>
        </ol>
      </nav>

      <!-- Panel -->
      <div class="mg-team-form__panel-wrap">
        <!-- ── Step 1 · Details ──────────────────────────────── -->
        <section v-show="step === 'details'" class="mg-team-form__panel">
          <!-- Logo (1:1) + team identity row -->
          <div class="mg-team-form__logo-row">
            <button type="button" class="mg-team-form__logo" @click="openImageEditor">
              <TeamAvatar v-if="logoDataUrl" :name="teamName || 'Team'" :image-url="logoDataUrl || undefined" size="lg" />
              <span v-else class="mg-team-form__logo-empty" aria-hidden="true">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="3" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="M21 14.5 16 10 5.5 20.5" />
                </svg>
              </span>
              <span class="mg-team-form__logo-label">{{ logoDataUrl ? 'Change logo' : 'Upload logo' }}</span>
            </button>
            <div class="mg-team-form__logo-fields">
              <div class="floating-input" :class="{ 'floating-input--invalid': err('teamName') }">
                <input id="team-name" v-model="teamName" type="text" maxlength="255" class="floating-input__control"
                       :class="{ 'floating-input__control--has-value': !!teamName }" placeholder=" " />
                <label for="team-name" class="floating-input__label">Team Name</label>
                <span v-if="err('teamName')" class="floating-input__error-corner">Required</span>
              </div>
              <!-- City / State — the themed field itself is a Google Places
                   search (type → pick → city + two-letter state are filled). -->
              <div class="floating-input mg-team-form__search" :class="{ 'floating-input--invalid': err('cityState') }">
                <input
                  id="team-citystate"
                  v-model="cityStateQuery"
                  type="text"
                  autocomplete="off"
                  class="floating-input__control"
                  :class="{ 'floating-input__control--has-value': !!cityStateQuery }"
                  placeholder=" "
                  @input="onCityInput"
                  @focus="cityOpen = true"
                  @blur="cityOpen = false"
                />
                <label for="team-citystate" class="floating-input__label">City, State</label>
                <span v-if="err('cityState')" class="floating-input__error-corner">Required</span>
                <img class="places-google-icon" :src="googleG" alt="" aria-hidden="true" />
                <ul
                  v-if="cityOpen && (citySearching || cityStateQuery.trim().length >= 2)"
                  class="mg-team-form__suggest"
                >
                  <li v-if="citySearching" class="mg-team-form__suggest-row mg-team-form__suggest-row--muted">Searching…</li>
                  <li v-else-if="!cityPredictions.length" class="mg-team-form__suggest-row mg-team-form__suggest-row--muted">No matches found.</li>
                  <li
                    v-for="p in cityPredictions"
                    v-else
                    :key="p.placeId"
                    class="mg-team-form__suggest-row"
                    @mousedown.prevent="pickPlace(p)"
                  >
                    <span class="mg-team-form__suggest-name">{{ p.primaryText }}</span>
                    <span v-if="p.secondaryText" class="mg-team-form__suggest-sub">{{ p.secondaryText }}</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <!-- Gender + Sport Type on one row -->
          <div class="mg-team-form__grid2 mg-team-form__gender-sport">
            <div class="mg-team-form__seg" :class="{ 'mg-team-form__seg--invalid': err('gender') }" role="radiogroup" aria-label="Gender">
              <button
                v-for="option in GENDERS"
                :key="option"
                type="button"
                class="mg-team-form__seg-btn"
                :class="{ 'mg-team-form__seg-btn--active': gender === option }"
                role="radio"
                :aria-checked="gender === option ? 'true' : 'false'"
                @click="gender = option"
              >{{ option }}</button>
              <span v-if="err('gender')" class="floating-input__error-corner">Required</span>
            </div>
            <div class="floating-input">
              <select id="team-sport" v-model="sportsTypeId" class="floating-input__control floating-input__control--select">
                <option value="" disabled hidden></option>
                <option v-for="s in sportTypes" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
              <label for="team-sport" class="floating-input__label" :class="{ 'floating-input__label--floated': !!sportsTypeId }">Sport Type</label>
            </div>
          </div>

          <!-- Age Group + Rating -->
          <div class="mg-team-form__grid2">
            <div class="floating-input" :class="{ 'floating-input--invalid': err('ageGroup') }">
              <select id="team-age" v-model="ageGroupId" class="floating-input__control floating-input__control--select">
                <option value="" disabled hidden></option>
                <option v-for="a in ageGroups" :key="a.id" :value="a.id">{{ a.name }}</option>
              </select>
              <label for="team-age" class="floating-input__label" :class="{ 'floating-input__label--floated': !!ageGroupId }">Age Group</label>
              <span v-if="err('ageGroup')" class="floating-input__error-corner">Required</span>
            </div>
            <div class="floating-input" :class="{ 'floating-input--invalid': err('rating') }">
              <select id="team-rating" v-model="ratingId" class="floating-input__control floating-input__control--select">
                <option value="" disabled hidden></option>
                <option v-for="r in ratings" :key="r.id" :value="r.id">{{ r.name }}</option>
              </select>
              <label for="team-rating" class="floating-input__label" :class="{ 'floating-input__label--floated': !!ratingId }">Rating</label>
              <span v-if="err('rating')" class="floating-input__error-corner">Required</span>
            </div>
          </div>

          <!-- Last update date + Region (both optional) -->
          <div class="mg-team-form__grid2">
            <DateTimePicker
              id="team-update"
              :model-value="lastUpdateDate"
              label="Last Update Date"
              date-only
              @update:model-value="lastUpdateDate = $event"
            />
            <div class="floating-input">
              <select id="team-region" v-model="region" class="floating-input__control floating-input__control--select">
                <option value="" disabled hidden></option>
                <option v-for="r in US_REGIONS" :key="r.value" :value="r.value">{{ r.label }}</option>
              </select>
              <label for="team-region" class="floating-input__label" :class="{ 'floating-input__label--floated': !!region }">Region</label>
            </div>
          </div>

          <h3 class="mg-team-form__subhead">Team manager</h3>
          <div class="floating-input" :class="{ 'floating-input--invalid': err('managerName') }">
            <input id="team-manager" v-model="managerName" type="text" maxlength="150" class="floating-input__control"
                   :class="{ 'floating-input__control--has-value': !!managerName }" placeholder=" " />
            <label for="team-manager" class="floating-input__label">Manager Name</label>
            <span v-if="err('managerName')" class="floating-input__error-corner">Required</span>
          </div>

          <ManagerEmailLookup
            id="team-manager-email"
            v-model:email="managerEmail"
            v-model:linked-user-id="managerLinkedUserId"
            :invalid="err('managerEmail')"
            @update:send-invite="sendManagerInvite = $event"
          />

          <PhoneInput
            id="team-manager-phone"
            v-model:dial-code="managerDialCode"
            v-model:number="managerPhone"
            number-label="Phone"
          />
        </section>

        <!-- ── Step 2 · Registration ─────────────────────────── -->
        <section v-show="step === 'registration'" class="mg-team-form__panel">
          <!-- External registration number (partner / league #). -->
          <div class="floating-input">
            <input id="team-extreg" v-model="externalRegNo" type="text" maxlength="255" class="floating-input__control"
                   :class="{ 'floating-input__control--has-value': !!externalRegNo }" placeholder=" " />
            <label for="team-extreg" class="floating-input__label">External Registration #</label>
          </div>
          <p class="mg-team-form__hint mg-team-form__hint--field">
            {{ assocShortName }} ID for this team. Add it to find the team by that number in reports and across WIF.
          </p>

          <!-- CREATE: payment-driven when the team reg-settings make a fee
               applicable; otherwise a simple activate toggle. Fee + validity
               are inherited from settings (not overridable here). -->
          <template v-if="!isEdit">
            <!-- No fee → activate now (with the inherited validity) or save pending. -->
            <template v-if="!paymentApplicable">
              <label class="mg-team-form__activate-row">
                <span class="mg-team-form__activate-copy">
                  <strong>Activate this registration now</strong>
                  <span class="mg-team-form__hint">Turn off to save the team as Pending and activate it later.</span>
                </span>
                <ToggleSwitch v-model="activateNow" aria-label="Activate this registration now" />
              </label>
              <p v-if="activateNow" class="mg-team-form__hint mg-team-form__hint--field">Validity: <strong>{{ inheritedValidityText }}</strong>.</p>
            </template>

            <!-- Fee → payment-driven. Registration is created Pending until paid. -->
            <template v-else>
              <div class="app-banner app-banner--primary">
                <div class="app-banner__text">
                  <strong class="app-banner__title">Registration fee applicable — {{ feeLabel }}</strong>
                  <span class="app-banner__sub">{{ bannerValidityText }} applies once active.</span>
                </div>
              </div>

              <div v-if="!stripeConnected" class="app-banner app-banner--warning">
                <div class="app-banner__text">
                  <strong class="app-banner__title">Stripe isn't connected</strong>
                  <span class="app-banner__sub">Online payment links are unavailable. Collect the fee manually (cash / cheque) or later. Connect Stripe in Settings to send links.</span>
                </div>
              </div>

              <div class="mg-team-form__choices" role="radiogroup" aria-label="How to collect the fee">
                <label v-if="canCollectOnline" class="mg-team-form__choice" :class="{ 'mg-team-form__choice--active': collection === 'online' }">
                  <input type="radio" name="reg-collection" value="online" :checked="collection === 'online'" @change="collection = 'online'" />
                  <span><strong>Send payment link</strong><span class="mg-team-form__hint">Email the manager a Stripe link to pay online.</span></span>
                </label>
                <label v-if="canCollectOffline" class="mg-team-form__choice" :class="{ 'mg-team-form__choice--active': collection === 'offline' }">
                  <input type="radio" name="reg-collection" value="offline" :checked="collection === 'offline'" @change="collection = 'offline'" />
                  <span><strong>Record payment now</strong><span class="mg-team-form__hint">Log a manual payment (cash / cheque / etc.) — activates the team.</span></span>
                </label>
                <label class="mg-team-form__choice" :class="{ 'mg-team-form__choice--active': collection === 'later' }">
                  <input type="radio" name="reg-collection" value="later" :checked="collection === 'later'" @change="collection = 'later'" />
                  <span><strong>Collect later</strong><span class="mg-team-form__hint">Create the order now; record payment from the team's Statement.</span></span>
                </label>
              </div>

              <!-- Two-column: left = collection inputs (manual) / context note;
                   right = live payment preview (shown for every mode). -->
              <div class="mg-team-form__pay-grid">
                <div class="mg-team-form__pay-col">
                  <!-- Manual payment: method, amount, date, ref, notes (stacked). -->
                  <template v-if="collection === 'offline'">
                    <div class="floating-input">
                      <select id="reg-method" v-model="offlineMethod" class="floating-input__control floating-input__control--select">
                        <option value="cash">Cash</option>
                        <option value="check">Check</option>
                        <option value="bank_transfer">Bank transfer</option>
                        <option value="other">Other</option>
                      </select>
                      <label for="reg-method" class="floating-input__label floating-input__label--floated">Payment method</label>
                    </div>
                    <div class="floating-input" :class="{ 'floating-input--invalid': showErrors && paymentInvalid }">
                      <input id="reg-amount" type="text" inputmode="decimal" :value="payAmount"
                             class="floating-input__control" :class="{ 'floating-input__control--has-value': !!payAmount }"
                             placeholder=" " @input="onPayAmountInput($event)" />
                      <label for="reg-amount" class="floating-input__label">Amount paid ($)</label>
                      <span v-if="showErrors && paymentInvalid" class="floating-input__error-corner">Enter 1 – {{ previewTotal.toFixed(2) }}</span>
                    </div>
                    <DateTimePicker v-model="paidDate" :date-only="true" :max-date="todayIso()" id="reg-paid-date" label="Date paid" />
                    <div class="floating-input">
                      <input id="reg-reference" v-model="offlineReference" type="text" maxlength="100" class="floating-input__control"
                             :class="{ 'floating-input__control--has-value': !!offlineReference }" placeholder=" " />
                      <label for="reg-reference" class="floating-input__label">Reference # (optional)</label>
                    </div>
                    <div class="floating-input">
                      <textarea id="reg-notes" v-model="offlineNotes" rows="2" class="floating-input__control"
                                :class="{ 'floating-input__control--has-value': !!offlineNotes }" placeholder=" "></textarea>
                      <label for="reg-notes" class="floating-input__label">Notes (optional)</label>
                    </div>
                  </template>
                  <p v-else-if="collection === 'online'" class="mg-team-form__hint">A Stripe payment link for the full balance will be emailed to the manager. The team stays <strong>Pending</strong> until it's paid.</p>
                  <p v-else class="mg-team-form__hint">The payment order will be created now. Record a payment anytime from the team's <strong>Statement</strong>; the team stays <strong>Pending</strong> until paid.</p>
                </div>

                <!-- Live preview — same breakdown the Statement shows. -->
                <aside class="mg-team-form__preview" aria-label="Payment preview">
                  <h4 class="mg-team-form__preview-title">Payment preview</h4>
                  <div class="mg-team-form__preview-row"><span>Registration fee</span><span>{{ formatMoney(previewFee) }}</span></div>
                  <div class="mg-team-form__preview-row"><span>Platform fee</span><span>{{ formatMoney(previewPlatformFee) }}</span></div>
                  <div class="mg-team-form__preview-row"><span>Discount</span><span>{{ formatMoney(previewDiscount) }}</span></div>
                  <div class="mg-team-form__preview-row mg-team-form__preview-row--total"><span>Total</span><strong>{{ formatMoney(previewTotal) }}</strong></div>
                  <div class="mg-team-form__preview-row"><span>Paid</span><span>{{ formatMoney(previewPaid) }}</span></div>
                  <div class="mg-team-form__preview-row mg-team-form__preview-row--balance"><span>Balance</span><strong>{{ formatMoney(previewBalance) }}</strong></div>
                </aside>
              </div>
            </template>
          </template>

          <!-- EDIT: registration card + lifecycle actions -->
          <template v-else-if="current">
            <div class="mg-team-form__regcard">
              <div class="mg-team-form__regcard-top">
                <div class="mg-team-form__regcard-titles">
                  <span class="mg-team-form__regcard-eyebrow">{{ current.systemRegNo || '—' }}</span>
                  <span class="mg-team-form__regcard-team">{{ current.name }}</span>
                </div>
                <span class="mg-team-form__regcard-badge" :data-status="current.status">{{ statusLabels[current.status] }}</span>
              </div>
              <div class="mg-team-form__regcard-bottom">
                <span class="mg-team-form__regcard-caption">Validity</span>
                <span class="mg-team-form__regcard-validity">{{ currentValiditySummary }}</span>
              </div>
            </div>
            <div class="mg-team-form__actions">
              <button v-if="current.status === 'pending' || current.status === 'rejected'" type="button" class="primary-button" @click="openValidityFlow('mark-active')">Mark Active</button>
              <button v-if="current.status === 'expired'" type="button" class="primary-button" @click="openValidityFlow('renew')">Renew Registration</button>
              <button v-if="current.status === 'active'" type="button" class="secondary-button" @click="openValidityFlow('change-validity')">Change Validity</button>
              <button v-if="current.status === 'suspended'" type="button" class="primary-button" @click="openValidityFlow('reactivate')">Reactivate</button>
              <button v-if="current.status === 'active'" type="button" class="secondary-button" @click="openSuspendConfirm">Mark Suspended</button>
              <button v-if="current.status === 'active' || current.status === 'pending'" type="button" class="secondary-button mg-team-form__action-danger" @click="openRejectConfirm">Cancel Registration</button>
            </div>
          </template>
        </section>

        <!-- ── Step · Additional details (team custom fields) ─── -->
        <section v-show="step === 'additional'" class="mg-team-form__panel">
          <CustomFieldsRenderer
            v-if="customFieldDefs.length"
            :definitions="customFieldDefs"
            v-model="customFieldValues"
            :errors="showErrors ? customFieldErrors : []"
            layout="grid"
          />
        </section>

        <!-- ── Step · Review ─────────────────────────────────── -->
        <section v-show="step === 'review'" class="mg-team-form__panel">
          <div class="app-banner app-banner--primary">
            <div class="app-banner__text">
              <strong class="app-banner__title">{{ isEdit ? 'Review your changes' : 'Almost there — give it a final look' }}</strong>
              <span class="app-banner__sub">
                {{ isEdit ? 'Check the details below, then tap Save changes.' : 'Check the details below, then tap Register team.' }}
              </span>
            </div>
          </div>
          <div class="mg-team-form__review-head">
            <TeamAvatar :name="teamName || 'Team'" :image-url="logoDataUrl || undefined" size="lg" />
            <span class="mg-team-form__review-teamname">{{ teamName || '—' }}</span>
          </div>
          <dl class="mg-team-form__review">
            <div><dt>External reg #</dt><dd>{{ externalRegNo || '—' }}</dd></div>
            <div><dt>Location</dt><dd>{{ reviewLocation }}</dd></div>
            <div><dt>Region</dt><dd>{{ region || '—' }}</dd></div>
            <div><dt>Sport</dt><dd>{{ sportTypeName || '—' }}</dd></div>
            <div><dt>Division</dt><dd>{{ [gender, ageGroupName, ratingName].filter(Boolean).join(' · ') || '—' }}</dd></div>
            <div><dt>Manager</dt><dd>{{ managerName || '—' }}</dd></div>
            <div><dt>Manager email</dt><dd>{{ managerEmail || '—' }}<span v-if="managerEmail" class="mg-team-form__review-note">{{ reviewManagerLink }}</span></dd></div>
            <div><dt>Manager phone</dt><dd>{{ reviewManagerPhone }}</dd></div>
            <div v-if="!isEdit"><dt>Registration</dt><dd>{{ reviewActivation }}</dd></div>
          </dl>
        </section>
      </div>
    </div>

    <template #footer>
      <button v-if="!isFirstStep" type="button" class="secondary-button" :disabled="saving" @click="goBack">Back</button>
      <button v-else type="button" class="secondary-button" :disabled="saving" @click="close">Cancel</button>
      <span class="mg-team-form__foot-spacer"></span>
      <button v-if="!isLastStep" type="button" class="primary-button" @click="goNext">Next</button>
      <button v-else type="button" class="primary-button" :disabled="saving" @click="onSubmit">
        <span v-if="saving" class="btn-spinner" aria-hidden="true"></span>
        {{ saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Register team') }}
      </button>
    </template>
  </SlideModal>

  <!-- Logo cropper — fixed 1:1 (avatar mode, no aspect toggle). -->
  <ImageEditorModal
    :model-value="imageEditorOpen"
    mode="avatar"
    title="Edit team logo"
    :initial-url="logoDataUrl || ''"
    @update:modelValue="imageEditorOpen = $event"
    @save="onLogoSaved"
    @remove="clearLogo"
  />

  <!-- Edit-mode lifecycle sub-popups (reused from the listing ellipsis). -->
  <TeamValidityModal
    v-model="validityModalOpen"
    :title="validityTitle"
    :submit-label="validitySubmitLabel"
    :show-source="validityShowSource"
    :initial-never-expires="current?.neverExpires ?? false"
    :initial-valid-until="current?.validUntil ?? ''"
    :saving="actionSaving"
    @submit="onValiditySubmit"
  />
  <SuspendTeamConfirmModal
    v-model="confirmModalOpen"
    :mode="confirmFlow ?? 'suspend'"
    :team-name="current?.name ?? ''"
    :saving="actionSaving"
    @confirm="onConfirmModalConfirm"
  />
</template>

<style scoped>
.slide-modal-panel__footer .primary-button { background: var(--primary); }

/* Two-column layout: fixed left rail + scrolling panel. Mirrors mg-evt-form. */
.mg-team-form { display: grid; grid-template-columns: 248px 1fr; min-height: 100%; min-width: 0; }

/* ── Left rail stepper ── */
.mg-team-form__rail { border-right: 1px solid #e4e7ec; background: #f4f5f7; padding: 20px 14px; }
html.dark-mode .mg-team-form__rail { background: rgba(255, 255, 255, 0.05); border-right-color: rgba(255, 255, 255, 0.12); }
.mg-team-form__steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.mg-team-form__step-btn {
  appearance: none; width: 100%; display: flex; align-items: center; gap: 12px;
  padding: 10px 12px; border: none; background: transparent; border-radius: 8px;
  cursor: pointer; text-align: left; color: var(--text);
}
.mg-team-form__step-btn:hover:not(:disabled) { background: var(--surface-card); }
.mg-team-form__step-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.mg-team-form__step--active .mg-team-form__step-btn { background: var(--surface-card); box-shadow: inset 0 0 0 1px var(--border-divider); }
.mg-team-form__step-node {
  flex: 0 0 auto; width: 28px; height: 28px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700; background: var(--surface-card);
  border: 1px solid var(--border-divider); color: var(--secondary);
}
.mg-team-form__step--active .mg-team-form__step-node { background: var(--primary); border-color: var(--primary); color: #fff; }
.mg-team-form__step--done .mg-team-form__step-node { background: var(--primary-light-3, #eef4fd); border-color: var(--primary); color: var(--primary); }
.mg-team-form__step-check {
  width: 20px; height: 20px; background-color: var(--primary);
  -webkit-mask: url('../assets/tick-circle-twotone.svg') center / contain no-repeat;
  mask: url('../assets/tick-circle-twotone.svg') center / contain no-repeat;
}
.mg-team-form__step-text { display: flex; flex-direction: column; min-width: 0; }
.mg-team-form__step-label { font-size: 14px; font-weight: 600; }
.mg-team-form__step-hint { font-size: 11px; color: var(--secondary); }

/* ── Panel ── */
.mg-team-form__panel-wrap { min-width: 0; padding: 22px 24px 24px; overflow-y: auto; }
.mg-team-form__panel { display: flex; flex-direction: column; gap: 16px; max-width: 640px; margin: 0 auto; }
.mg-team-form__grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
/* Gender segmented + Sport select share a row; center the seg against the
   taller select control. */
.mg-team-form__gender-sport { align-items: center; }
.mg-team-form__hint { margin: 0; font-size: 13px; color: var(--secondary); }
/* Hint pinned directly under its field (the panel uses a 16px gap). */
.mg-team-form__hint--field { margin-top: -8px; }

/* City/State search — the themed floating-input IS the search box; its
   predictions float over the content below. */
.mg-team-form__search { position: relative; }
.mg-team-form__suggest {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 6px);
  z-index: 40;
  list-style: none;
  margin: 0;
  padding: 6px;
  max-height: 260px;
  overflow-y: auto;
  background: var(--surface-card);
  border: 1px solid var(--border-divider);
  border-radius: 12px;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.22);
}
.mg-team-form__suggest-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 9px 12px;
  border-radius: 8px;
  cursor: pointer;
}
.mg-team-form__suggest-row:hover { background: var(--primary-light-3, #eef4fd); }
.mg-team-form__suggest-row--muted { color: var(--secondary); font-size: 13px; cursor: default; }
.mg-team-form__suggest-row--muted:hover { background: none; }
.mg-team-form__suggest-name { font-size: 13.5px; font-weight: 600; color: var(--text); }
.mg-team-form__suggest-sub { font-size: 12px; color: var(--secondary); }
.mg-team-form__subhead {
  margin: 4px 0 0; padding-left: 10px; border-left: 3px solid var(--primary, #2d8cf0);
  font-family: var(--font-body); font-size: 1rem; font-weight: 500; color: var(--text); line-height: 1.2;
}

/* Logo + identity row */
.mg-team-form__logo-row { display: flex; gap: 16px; align-items: flex-start; }
.mg-team-form__logo {
  flex: 0 0 auto; display: flex; flex-direction: column; align-items: center; gap: 8px;
  width: 116px; padding: 12px; border: 1px dashed var(--border-divider); border-radius: 12px;
  background: var(--surface-card); color: var(--secondary); font: inherit; cursor: pointer;
}
.mg-team-form__logo:hover { border-color: var(--primary); color: var(--primary); }
.mg-team-form__logo-empty {
  display: inline-flex; align-items: center; justify-content: center;
  width: 64px; height: 64px; border-radius: 50%; background: var(--surface-muted, #eef2f7);
}
.mg-team-form__logo-label { font-size: 12px; font-weight: 600; }
.mg-team-form__logo-fields { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 16px; }

/* Gender segmented selector */
.mg-team-form__seg {
  position: relative;
  display: flex; width: 100%; gap: 8px; padding: 4px; border-radius: 10px;
  background: var(--surface-muted, #f4f7fb); border: 1px solid var(--border-divider);
}
.mg-team-form__seg--invalid { border-color: var(--danger, #d64545); }
html.dark-mode .mg-team-form__seg { background: rgba(255, 255, 255, 0.04); }
.mg-team-form__seg-btn {
  flex: 1 1 0; appearance: none; border: 1px solid transparent; background: transparent; border-radius: 7px;
  padding: 9px 12px; font: inherit; font-size: 14px; font-weight: 600; color: var(--secondary);
  cursor: pointer; text-align: center;
}
.mg-team-form__seg-btn--active {
  background: var(--surface-card); border-color: var(--primary); color: var(--primary);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

/* Activation row (create) */
.mg-team-form__activate-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.mg-team-form__activate-copy { display: flex; flex-direction: column; gap: 2px; }

/* Equal-width cards in one row (wrap on narrow). Radio sits top-left above the
   copy so each card reads as a compact selectable tile. */
.mg-team-form__choices { display: flex; flex-wrap: wrap; gap: 10px; }
.mg-team-form__choice {
  flex: 1 1 140px; min-width: 0;
  display: flex; flex-direction: column; gap: 8px;
  padding: 12px 14px; border: 1px solid var(--border-divider); border-radius: 10px; cursor: pointer;
}
.mg-team-form__choice--active { border-color: var(--primary); box-shadow: inset 0 0 0 1px var(--primary); }
.mg-team-form__choice:focus-within { border-color: var(--primary); }
.mg-team-form__choice > span { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
/* No visible radio — the highlighted card IS the selection. Input kept in the
   DOM (visually hidden) so it stays keyboard-focusable / form-correct. */
.mg-team-form__choice input {
  position: absolute;
  width: 1px; height: 1px;
  opacity: 0;
  pointer-events: none;
}

/* Two-column: collection inputs (left) + live payment preview (right). */
.mg-team-form__pay-grid {
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: 16px;
  align-items: start;
}
.mg-team-form__pay-col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.mg-team-form__preview {
  display: flex; flex-direction: column; gap: 8px;
  padding: 14px 16px;
  border: 1px solid var(--border-divider);
  border-radius: 10px;
  background: var(--surface-raised);
}
.mg-team-form__preview-title {
  margin: 0 0 2px;
  font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--secondary);
}
.mg-team-form__preview-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  font-size: 13px; color: var(--text);
}
.mg-team-form__preview-row > span:first-child { color: var(--secondary); }
.mg-team-form__preview-row--total { padding-top: 8px; border-top: 1px solid var(--border-divider); }
.mg-team-form__preview-row--balance strong { color: var(--primary, #2d8cf0); }
/* Stack the preview under the inputs on narrow widths. */
@media (max-width: 720px) {
  .mg-team-form__pay-grid { grid-template-columns: 1fr; }
}

/* Edit — registration card (credit-card style) + lifecycle actions */
.mg-team-form__regcard {
  position: relative;
  align-self: center;
  width: 100%;
  max-width: 420px;
  min-height: 200px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 20px;
  border-radius: 16px;
  color: var(--text);
  background: var(--surface-card);
  border: 1px solid var(--border-divider);
  box-shadow: var(--shadow-soft);
  overflow: hidden;
}
.mg-team-form__regcard-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; position: relative; z-index: 1; }
.mg-team-form__regcard-titles { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.mg-team-form__regcard-eyebrow {
  font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 2px;
  font-variant-numeric: tabular-nums; color: var(--secondary);
}
.mg-team-form__regcard-team { font-size: 18px; font-weight: 700; line-height: 1.25; min-width: 0; }
.mg-team-form__regcard-badge {
  flex: 0 0 auto;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--surface-pill);
  color: var(--secondary);
  border: 1px solid var(--border-divider);
}
.mg-team-form__regcard-badge[data-status='active'] { background: #1f9d55; color: #fff; }
.mg-team-form__regcard-badge[data-status='pending'] { background: #d9822b; color: #fff; }
.mg-team-form__regcard-badge[data-status='suspended'],
.mg-team-form__regcard-badge[data-status='expired'],
.mg-team-form__regcard-badge[data-status='rejected'] { background: #d64545; color: #fff; }
.mg-team-form__regcard-caption { font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-light); }
.mg-team-form__regcard-bottom { margin-top: auto; display: flex; flex-direction: column; gap: 2px; position: relative; z-index: 1; }
.mg-team-form__regcard-validity { font-size: 14px; font-weight: 500; }

/* Lifecycle controls in a single centered row that hugs its buttons — it may
   extend wider than the card (fine) and wraps only on very narrow screens. */
.mg-team-form__actions { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
.mg-team-form__action-danger { color: var(--danger, #d64545); border-color: var(--danger, #d64545); }

/* Review */
.mg-team-form__review-head { display: flex; align-items: center; gap: 14px; }
.mg-team-form__review-teamname { font-size: 18px; font-weight: 600; color: var(--text); min-width: 0; }
.mg-team-form__review { margin: 0; }
.mg-team-form__review > div {
  display: grid; grid-template-columns: 160px 1fr; gap: 12px;
  padding: 10px 0; border-top: 1px solid var(--border-divider);
}
.mg-team-form__review > div:first-child { border-top: none; }
.mg-team-form__review dt { margin: 0; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--secondary); }
.mg-team-form__review dd { margin: 0; font-size: 14px; color: var(--text); }
.mg-team-form__review-note { display: block; margin-top: 2px; color: var(--secondary); font-size: 12px; }

.mg-team-form__foot-spacer { flex: 1 1 auto; }

@media (max-width: 720px) {
  .mg-team-form { grid-template-columns: 1fr; }
  .mg-team-form__rail { border-right: none; border-bottom: 1px solid var(--border-divider); padding: 12px; }
  .mg-team-form__steps { flex-direction: row; overflow-x: auto; gap: 8px; }
  .mg-team-form__step-hint { display: none; }
  .mg-team-form__grid2 { grid-template-columns: 1fr; }
  .mg-team-form__review > div { grid-template-columns: 1fr; gap: 2px; }
}
</style>
