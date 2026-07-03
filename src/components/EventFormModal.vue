<script setup lang="ts">
// EventFormModal
// --------------
// Slide-in modal for creating a new event OR editing an existing one.
// Single component, mode-driven by `eventId`:
//   - `null` (or omitted) → Create flow, calls createEvent.
//   - non-null id         → Edit flow. The modal fetches the full
//                            `Event` (`fetchEvent(id)`) on open
//                            because the parent listing only carries
//                            an `EventSummary`. A brief loading
//                            spinner shows while the fetch resolves.
//
// Wire shape matches `docs/api/association-events-api-contract.md` —
// every editable field on `Event` is exposed here. Sections collapse
// the form into manageable groups: Identity / Dates / Location /
// Director / Tournament settings / Registration / Status.

import { computed, ref, watch } from 'vue'
import ImageEditorModal from './ImageEditorModal.vue'
import SlideModal from './SlideModal.vue'
import {
  createEvent,
  fetchEvent,
  updateEvent,
  isAllowedTransition,
  BRACKET_FORMAT_CATALOGUE,
  EVENT_TIMEZONES,
  SPORTS_TYPE_CATALOGUE,
  PAYMENT_TERMS_OPTIONS,
  PARTIAL_PAYMENT_TYPE_OPTIONS
} from '../api/events'
import { US_STATES } from '../api/associationTeams'
import type {
  Event,
  EventPartialPaymentType,
  EventPaymentTerms,
  EventStatus,
  EventType,
  SaveEventPayload
} from '../types'

const props = withDefaults(defineProps<{
  modelValue: boolean
  associationShortName?: string
  /** Event id to edit. Pass `null` (or omit) for the Create flow.
   *  The modal fetches the full `Event` record itself on open — the
   *  parent listing only has an `EventSummary`. */
  eventId?: string | null
}>(), {
  associationShortName: '',
  eventId: null
})

const isEdit = computed(() => props.eventId !== null)
const title = computed(() => (isEdit.value ? 'Edit Event' : 'Create Event'))

/** True while the edit-mode detail fetch is in flight. The template
 *  hides the form body and shows a small spinner during this window. */
const hydrating = ref(false)
/** The fully-hydrated row backing the edit form. Held locally so the
 *  status-transition helper has the original `eventStatus` for
 *  comparison even after the user picks a new one. */
const hydrated = ref<Event | null>(null)

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'saved', evt: Event): void
}>()

// Form fields. Strings for floating-input compatibility; coerced on
// submit. Booleans use real `boolean` refs since they're driven by
// toggles / checkboxes.
const eventName = ref('')
/** Event-type ref carries the catalogue KEY (`tournament` / `online_meeting`
 *  / `league` / `other`) when set, empty string when unset. The dropdown
 *  binds to this; `nullIfBlank` on submit converts '' → null so the
 *  wire stays `EventType | null`. */
const eventType = ref<EventType | ''>('')
const avatarFilename = ref<string | null>(null)
const avatarPreviewUrl = ref<string | null>(null)

const address = ref('')
const location = ref('')
const city = ref('')
const state = ref('')
const zipCode = ref('')
const lat = ref('')
const long = ref('')

const startDate = ref('')
const endDate = ref('')
const startTime = ref('08:00')
const endTime = ref('20:00')
const timeZone = ref('America/Los_Angeles')
const allDay = ref(false)

const note = ref('')
const reminder = ref('')
const url = ref('')
const color = ref('#1F8FFF')

const directorName = ref('')
const directorEmail = ref('')
const directorPhone = ref('')
const mobCode = ref('+1')

const sportsTypeId = ref('')

const entryFee = ref('')
const refundPolicy = ref('')
const tournamentFormat = ref('')
const entryFeeDeadline = ref('')
const poolPlayGuaranteed = ref('')
const bracketFormatId = ref('')
const poolPlayTime = ref('')
const championshipTime = ref('')
const bracketTime = ref('')
const timeInterval = ref('')

const allowTeamRegistration = ref(false)
const registrationOpening = ref('')           // datetime-local string
const paymentRequired = ref(false)
const paymentTerms = ref<EventPaymentTerms | ''>('')
const partialPaymentType = ref<EventPartialPaymentType | ''>('')
const partialPaymentValue = ref('')
const allowOfflinePayment = ref(false)
const autoConfirmOnFullPayment = ref(false)
const autoConfirmOnPartialPayment = ref(false)

const eventStatus = ref<EventStatus>('draft')

const saving = ref(false)
const submitAttempted = ref(false)

// Hero image editor — single mode (cover only).
const imageEditorOpen = ref(false)
function openCoverEditor() {
  imageEditorOpen.value = true
}
function onImageSaved(dataUrl: string) {
  // In v1 we store the data-URL locally as the preview; the wire
  // value is a filename the upload endpoint (out of scope) returns.
  // For mock parity, derive a deterministic filename so save → reload
  // exercises the round-trip.
  avatarPreviewUrl.value = dataUrl
  avatarFilename.value = `event-${Date.now()}.jpg`
}

function reset() {
  eventName.value = ''
  eventType.value = ''
  avatarFilename.value = null
  avatarPreviewUrl.value = null
  address.value = ''
  location.value = ''
  city.value = ''
  state.value = ''
  zipCode.value = ''
  lat.value = ''
  long.value = ''
  startDate.value = ''
  endDate.value = ''
  startTime.value = '08:00'
  endTime.value = '20:00'
  timeZone.value = 'America/Los_Angeles'
  allDay.value = false
  note.value = ''
  reminder.value = ''
  url.value = ''
  color.value = '#1F8FFF'
  directorName.value = ''
  directorEmail.value = ''
  directorPhone.value = ''
  mobCode.value = '+1'
  sportsTypeId.value = ''
  entryFee.value = ''
  refundPolicy.value = ''
  tournamentFormat.value = ''
  entryFeeDeadline.value = ''
  poolPlayGuaranteed.value = ''
  bracketFormatId.value = ''
  poolPlayTime.value = ''
  championshipTime.value = ''
  bracketTime.value = ''
  timeInterval.value = ''
  allowTeamRegistration.value = false
  registrationOpening.value = ''
  paymentRequired.value = false
  paymentTerms.value = ''
  partialPaymentType.value = ''
  partialPaymentValue.value = ''
  allowOfflinePayment.value = false
  autoConfirmOnFullPayment.value = false
  autoConfirmOnPartialPayment.value = false
  eventStatus.value = 'draft'
  submitAttempted.value = false
}

/** Hydrate the form from an existing event (Edit mode). The
 *  registration window is a backend DATETIME string (local TZ);
 *  the `datetime-local` input expects `YYYY-MM-DDTHH:mm`. */
function hydrate(evt: Event) {
  reset()
  eventName.value = evt.eventName
  eventType.value = evt.eventType ?? ''
  avatarPreviewUrl.value = evt.avatarUrl
  avatarFilename.value = evt.avatarUrl
    ? evt.avatarUrl.split('/').pop() ?? null
    : null
  address.value = evt.address ?? ''
  location.value = evt.location ?? ''
  city.value = evt.city ?? ''
  state.value = evt.state ?? ''
  zipCode.value = evt.zipCode ?? ''
  lat.value = evt.lat ?? ''
  long.value = evt.long ?? ''
  // Hydrate the local refs from the wire fields. Wire is camelCase
  // (`eventStartDate` etc.); the form-local refs are the older
  // shorter `startDate` etc. names so the template bindings stay
  // readable.
  startDate.value = evt.eventStartDate ?? ''
  endDate.value = evt.eventEndDate ?? ''
  startTime.value = (evt.eventStartTime ?? '08:00:00').slice(0, 5)
  endTime.value = (evt.eventEndTime ?? '20:00:00').slice(0, 5)
  timeZone.value = evt.timeZone
  allDay.value = evt.allDay
  note.value = evt.note ?? ''
  reminder.value = evt.reminder ?? ''
  url.value = evt.url ?? ''
  color.value = evt.color ?? '#1F8FFF'
  directorName.value = evt.directorName ?? ''
  directorEmail.value = evt.directorEmail ?? ''
  directorPhone.value = evt.directorPhone ?? ''
  mobCode.value = evt.mobCode ?? '+1'
  sportsTypeId.value = evt.sportsTypeId ?? ''
  entryFee.value = evt.entryFee != null ? String(evt.entryFee) : ''
  refundPolicy.value = evt.refundPolicy ?? ''
  tournamentFormat.value = evt.tournamentFormat ?? ''
  entryFeeDeadline.value = evt.entryFeeDeadline ?? ''
  poolPlayGuaranteed.value = evt.poolPlayGuaranteed ?? ''
  bracketFormatId.value = evt.bracketFormatId ?? ''
  poolPlayTime.value = evt.poolPlayTime ?? ''
  championshipTime.value = evt.championshipTime ?? ''
  bracketTime.value = evt.bracketTime ?? ''
  timeInterval.value = evt.timeInterval ?? ''
  allowTeamRegistration.value = evt.allowTeamRegistration
  registrationOpening.value = evt.registrationOpening
    ? evt.registrationOpening.replace(' ', 'T').slice(0, 16)
    : ''
  paymentRequired.value = evt.paymentRequired
  paymentTerms.value = evt.paymentTerms ?? ''
  partialPaymentType.value = evt.partialPaymentType ?? ''
  partialPaymentValue.value = evt.partialPaymentValue != null
    ? String(evt.partialPaymentValue)
    : ''
  allowOfflinePayment.value = evt.allowOfflinePayment
  autoConfirmOnFullPayment.value = evt.autoConfirmOnFullPayment
  autoConfirmOnPartialPayment.value = evt.autoConfirmOnPartialPayment
  eventStatus.value = evt.eventStatus
}

/** Fetch the full `Event` by id (edit mode) and hydrate the form,
 *  or reset (create mode). Stale-fetch guarded so re-opening the
 *  modal mid-flight discards the in-progress response. */
let hydrateToken = 0
async function hydrateFromId(eventId: string | null) {
  if (eventId === null) {
    hydrated.value = null
    hydrating.value = false
    reset()
    return
  }
  const myToken = ++hydrateToken
  hydrating.value = true
  reset()
  try {
    const evt = await fetchEvent(props.associationShortName, eventId)
    if (myToken !== hydrateToken) return
    hydrated.value = evt
    hydrate(evt)
  } catch (error) {
    if (myToken !== hydrateToken) return
    // Toast intentionally omitted — UX for save / load failures
    // will be revisited in a follow-up pass. Log + close the modal
    // so the user isn't stuck on an empty form.
    if (typeof console !== 'undefined') console.error('Load event failed:', error)
    emit('update:modelValue', false)
  } finally {
    if (myToken === hydrateToken) hydrating.value = false
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    hydrateFromId(props.eventId ?? null)
  }
)

watch(
  () => props.eventId,
  (next) => {
    if (props.modelValue) hydrateFromId(next ?? null)
  }
)

// Validation — runs on submit only.
const errors = computed(() => {
  if (!submitAttempted.value) return new Set<string>()
  const errs = new Set<string>()
  if (!eventName.value.trim()) errs.add('eventName')
  if (!startDate.value) errs.add('startDate')
  if (!endDate.value) errs.add('endDate')
  if (startDate.value && endDate.value && startDate.value > endDate.value) errs.add('endDate')
  if (!timeZone.value) errs.add('timeZone')
  if (!allDay.value && !startTime.value) errs.add('startTime')
  if (!allDay.value && !endTime.value) errs.add('endTime')
  if (!sportsTypeId.value) errs.add('sportsTypeId')
  if (!city.value.trim()) errs.add('city')
  if (!state.value) errs.add('state')
  const emailVal = directorEmail.value.trim()
  if (emailVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
    errs.add('directorEmail')
  }
  // Registration window — required when allowTeamRegistration on.
  if (allowTeamRegistration.value) {
    if (!registrationOpening.value) errs.add('registrationOpening')
    if (!entryFeeDeadline.value) errs.add('entryFeeDeadline')
    // Backend enforces: registrationOpening < entryFeeDeadline <= endDate.
    if (registrationOpening.value && entryFeeDeadline.value) {
      const opensDay = registrationOpening.value.slice(0, 10)
      if (opensDay > entryFeeDeadline.value) errs.add('entryFeeDeadline')
    }
    if (entryFeeDeadline.value && endDate.value && entryFeeDeadline.value > endDate.value) {
      errs.add('entryFeeDeadline')
    }
  }
  // Partial-payment fields required when paymentTerms='partial'.
  if (paymentRequired.value) {
    if (!paymentTerms.value) errs.add('paymentTerms')
    if (paymentTerms.value === 'partial') {
      if (!partialPaymentType.value) errs.add('partialPaymentType')
      const v = Number(partialPaymentValue.value)
      if (!partialPaymentValue.value || Number.isNaN(v) || v <= 0) {
        errs.add('partialPaymentValue')
      }
    }
  }
  return errs
})

function close() {
  if (saving.value) return
  emit('update:modelValue', false)
}

function nullIfBlank(s: string): string | null {
  const t = s.trim()
  return t ? t : null
}

function numberOrNull(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

async function save() {
  submitAttempted.value = true
  if (errors.value.size > 0) return
  saving.value = true
  try {
    const payload: SaveEventPayload = {
      eventName: eventName.value.trim(),
      // `eventType` ref is `EventType | ''`; collapse '' → null and
      // cast for the wire (`SaveEventPayload.eventType: EventType | null`).
      eventType: eventType.value === '' ? null : eventType.value,
      avatar: avatarFilename.value,
      address: nullIfBlank(address.value),
      location: nullIfBlank(location.value),
      city: nullIfBlank(city.value),
      state: nullIfBlank(state.value),
      zipCode: nullIfBlank(zipCode.value),
      lat: nullIfBlank(lat.value),
      long: nullIfBlank(long.value),
      // camelCase on the wire (DB column names are
      // `event_start_date` etc.; backend serializer translates).
      eventStartDate: startDate.value,
      eventEndDate: endDate.value,
      eventStartTime: allDay.value ? null : `${startTime.value}:00`,
      eventEndTime: allDay.value ? null : `${endTime.value}:00`,
      timeZone: timeZone.value,
      allDay: allDay.value,
      note: nullIfBlank(note.value),
      reminder: nullIfBlank(reminder.value),
      mediumId: null,
      mediumName: null,
      url: nullIfBlank(url.value),
      color: nullIfBlank(color.value),
      eventStatus: eventStatus.value,
      directorName: nullIfBlank(directorName.value),
      directorEmail: nullIfBlank(directorEmail.value),
      directorPhone: nullIfBlank(directorPhone.value),
      mobCode: nullIfBlank(mobCode.value),
      entryFee: numberOrNull(entryFee.value),
      refundPolicy: nullIfBlank(refundPolicy.value),
      tournamentFormat: nullIfBlank(tournamentFormat.value),
      entryFeeDeadline: nullIfBlank(entryFeeDeadline.value),
      poolPlayGuaranteed: nullIfBlank(poolPlayGuaranteed.value),
      bracketFormatId: nullIfBlank(bracketFormatId.value),
      poolPlayTime: nullIfBlank(poolPlayTime.value),
      championshipTime: nullIfBlank(championshipTime.value),
      bracketTime: nullIfBlank(bracketTime.value),
      timeInterval: nullIfBlank(timeInterval.value),
      sportsTypeId: nullIfBlank(sportsTypeId.value),
      fieldConfigId: null,
      allowTeamRegistration: allowTeamRegistration.value,
      registrationOpening: allowTeamRegistration.value && registrationOpening.value
        ? registrationOpening.value.replace('T', ' ') + ':00'
        : null,
      paymentRequired: paymentRequired.value,
      paymentTerms: paymentRequired.value ? (paymentTerms.value || null) : null,
      partialPaymentType: paymentRequired.value && paymentTerms.value === 'partial'
        ? (partialPaymentType.value || null)
        : null,
      partialPaymentValue: paymentRequired.value && paymentTerms.value === 'partial'
        ? numberOrNull(partialPaymentValue.value)
        : null,
      allowOfflinePayment: allowOfflinePayment.value,
      autoConfirmOnFullPayment: autoConfirmOnFullPayment.value,
      autoConfirmOnPartialPayment: autoConfirmOnPartialPayment.value
    }
    const result = isEdit.value && hydrated.value
      ? await updateEvent(props.associationShortName, hydrated.value.id, payload)
      : await createEvent(props.associationShortName, payload)
    emit('saved', result)
    emit('update:modelValue', false)
    // Success toast intentionally omitted — we'll wire the
    // post-save UX in a follow-up pass.
  } catch (error) {
    // Error toast intentionally omitted for now; surface the error
    // some other way once we revisit the save UX. Swallow into the
    // console so it's still discoverable during development.
    if (typeof console !== 'undefined') console.error('Save event failed:', error)
  } finally {
    saving.value = false
  }
}

// Status options. Create: only draft/published. Edit: lifecycle-gated.
const statusOptions = computed<{ value: EventStatus; label: string; disabled?: boolean }[]>(() => {
  const all: { value: EventStatus; label: string }[] = [
    { value: 'draft', label: 'Draft (work in progress)' },
    { value: 'published', label: 'Published (visible publicly)' },
    { value: 'completed', label: 'Completed (event wrapped)' },
    { value: 'cancelled', label: 'Cancelled' }
  ]
  if (!isEdit.value) {
    return all.filter((o) => o.value === 'draft' || o.value === 'published')
  }
  const current = hydrated.value?.eventStatus ?? 'draft'
  return all.map((opt) => ({
    ...opt,
    disabled: !isAllowedTransition(current, opt.value)
  }))
})
</script>

<template>
  <div class="event-form-modal-root">
    <SlideModal
      :model-value="modelValue"
      :title="title"
      @update:modelValue="emit('update:modelValue', $event)"
    >
      <!-- Loading state while the detail-fetch hydrates the form
           in Edit mode. Shown only on the first paint after open;
           subsequent edits to the same event resolve from cache (the
           parent's `eventId` change re-triggers the watcher). -->
      <div v-if="hydrating" class="event-form-modal__loading" aria-busy="true">
        <span class="event-form-modal__loading-spinner" aria-hidden="true"></span>
        <span>Loading event…</span>
      </div>
      <div v-else class="register-team-modal__form event-form-modal__form">
        <!-- Hero image -->
        <div class="profile-image-stack event-form-modal__hero">
          <button
            type="button"
            class="profile-image-stack__cover"
            :class="{ 'profile-image-stack__cover--empty': !avatarPreviewUrl }"
            aria-label="Edit event cover photo"
            @click="openCoverEditor"
          >
            <img
              v-if="avatarPreviewUrl"
              :src="avatarPreviewUrl"
              alt=""
              class="profile-image-stack__cover-img"
              aria-hidden="true"
            />
            <span v-else class="profile-image-stack__cover-placeholder">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                <polyline points="21 15 16 10 5 21"></polyline>
              </svg>
              <span>Add hero photo</span>
            </span>
          </button>
        </div>

        <!-- Identity: name + type -->
        <div class="register-team-modal__row">
          <div class="floating-input" :class="{ 'floating-input--invalid': errors.has('eventName') }">
            <input
              id="event-name"
              v-model="eventName"
              type="text"
              maxlength="200"
              class="floating-input__control"
              :class="{ 'floating-input__control--has-value': !!eventName }"
              placeholder=" "
            />
            <label for="event-name" class="floating-input__label">Event Name</label>
          </div>
          <div class="floating-input">
            <select
              id="event-type"
              v-model="eventType"
              class="floating-input__control floating-input__control--select"
            >
              <option value="">—</option>
              <option value="Tournament">Tournament</option>
              <option value="Showcase">Showcase</option>
              <option value="Championship">Championship</option>
              <option value="League">League</option>
              <option value="Clinic">Clinic</option>
            </select>
            <label
              for="event-type"
              class="floating-input__label floating-input__label--floated"
            >Event Type</label>
          </div>
        </div>
        <span v-if="errors.has('eventName')" class="association-user-modal__error">
          Event name is required.
        </span>

        <!-- Sport -->
        <div class="floating-input" :class="{ 'floating-input--invalid': errors.has('sportsTypeId') }">
          <select
            id="event-sport-type"
            v-model="sportsTypeId"
            class="floating-input__control floating-input__control--select"
          >
            <option value="" disabled hidden></option>
            <option v-for="opt in SPORTS_TYPE_CATALOGUE" :key="opt.id" :value="opt.id">
              {{ opt.name }}
            </option>
          </select>
          <label
            for="event-sport-type"
            class="floating-input__label"
            :class="{ 'floating-input__label--floated': !!sportsTypeId }"
          >Sport</label>
        </div>

        <!-- Dates -->
        <h4 class="event-form-modal__section-title">Schedule</h4>
        <div class="register-team-modal__row">
          <div class="floating-input" :class="{ 'floating-input--invalid': errors.has('startDate') }">
            <input
              id="event-start-date"
              v-model="startDate"
              type="date"
              class="floating-input__control floating-input__control--date"
              :class="{ 'floating-input__control--has-value': !!startDate }"
              placeholder=" "
            />
            <label
              for="event-start-date"
              class="floating-input__label"
              :class="{ 'floating-input__label--floated': !!startDate }"
            >Start Date</label>
          </div>
          <div class="floating-input" :class="{ 'floating-input--invalid': errors.has('endDate') }">
            <input
              id="event-end-date"
              v-model="endDate"
              type="date"
              class="floating-input__control floating-input__control--date"
              :class="{ 'floating-input__control--has-value': !!endDate }"
              placeholder=" "
            />
            <label
              for="event-end-date"
              class="floating-input__label"
              :class="{ 'floating-input__label--floated': !!endDate }"
            >End Date</label>
          </div>
        </div>
        <span v-if="errors.has('endDate') && startDate && endDate && startDate > endDate" class="association-user-modal__error">
          End date must be on or after the start date.
        </span>

        <label class="event-form-modal__check">
          <input v-model="allDay" type="checkbox" />
          All-day event (skip start/end times)
        </label>

        <div v-if="!allDay" class="register-team-modal__row">
          <div class="floating-input" :class="{ 'floating-input--invalid': errors.has('startTime') }">
            <input
              id="event-start-time"
              v-model="startTime"
              type="time"
              class="floating-input__control floating-input__control--date"
              :class="{ 'floating-input__control--has-value': !!startTime }"
              placeholder=" "
            />
            <label
              for="event-start-time"
              class="floating-input__label"
              :class="{ 'floating-input__label--floated': !!startTime }"
            >Start Time</label>
          </div>
          <div class="floating-input" :class="{ 'floating-input--invalid': errors.has('endTime') }">
            <input
              id="event-end-time"
              v-model="endTime"
              type="time"
              class="floating-input__control floating-input__control--date"
              :class="{ 'floating-input__control--has-value': !!endTime }"
              placeholder=" "
            />
            <label
              for="event-end-time"
              class="floating-input__label"
              :class="{ 'floating-input__label--floated': !!endTime }"
            >End Time</label>
          </div>
        </div>

        <div class="floating-input" :class="{ 'floating-input--invalid': errors.has('timeZone') }">
          <select
            id="event-timezone"
            v-model="timeZone"
            class="floating-input__control floating-input__control--select"
          >
            <option v-for="tz in EVENT_TIMEZONES" :key="tz.value" :value="tz.value">
              {{ tz.formLabel }}
            </option>
          </select>
          <label
            for="event-timezone"
            class="floating-input__label floating-input__label--floated"
          >Timezone</label>
        </div>

        <!-- Location -->
        <h4 class="event-form-modal__section-title">Location</h4>
        <div class="floating-input">
          <input
            id="event-address"
            v-model="address"
            type="text"
            class="floating-input__control"
            :class="{ 'floating-input__control--has-value': !!address }"
            placeholder=" "
          />
          <label for="event-address" class="floating-input__label">Street Address (optional)</label>
        </div>
        <div class="floating-input">
          <input
            id="event-location"
            v-model="location"
            type="text"
            class="floating-input__control"
            :class="{ 'floating-input__control--has-value': !!location }"
            placeholder=" "
          />
          <label for="event-location" class="floating-input__label">Venue / Park Name (optional)</label>
        </div>
        <div class="register-team-modal__row">
          <div class="floating-input" :class="{ 'floating-input--invalid': errors.has('city') }">
            <input
              id="event-city"
              v-model="city"
              type="text"
              class="floating-input__control"
              :class="{ 'floating-input__control--has-value': !!city }"
              placeholder=" "
            />
            <label for="event-city" class="floating-input__label">City</label>
          </div>
          <div class="floating-input" :class="{ 'floating-input--invalid': errors.has('state') }">
            <select
              id="event-state"
              v-model="state"
              class="floating-input__control floating-input__control--select"
            >
              <option value="" disabled hidden></option>
              <option v-for="s in US_STATES" :key="s" :value="s">{{ s }}</option>
            </select>
            <label
              for="event-state"
              class="floating-input__label"
              :class="{ 'floating-input__label--floated': !!state }"
            >State</label>
          </div>
          <div class="floating-input">
            <input
              id="event-zip"
              v-model="zipCode"
              type="text"
              class="floating-input__control"
              :class="{ 'floating-input__control--has-value': !!zipCode }"
              placeholder=" "
            />
            <label for="event-zip" class="floating-input__label">ZIP (optional)</label>
          </div>
        </div>

        <!-- Director -->
        <h4 class="event-form-modal__section-title">Director</h4>
        <div class="register-team-modal__row">
          <div class="floating-input">
            <input
              id="event-director-name"
              v-model="directorName"
              type="text"
              class="floating-input__control"
              :class="{ 'floating-input__control--has-value': !!directorName }"
              placeholder=" "
            />
            <label for="event-director-name" class="floating-input__label">Director Name (optional)</label>
          </div>
          <div class="floating-input" :class="{ 'floating-input--invalid': errors.has('directorEmail') }">
            <input
              id="event-director-email"
              v-model="directorEmail"
              type="email"
              class="floating-input__control"
              :class="{ 'floating-input__control--has-value': !!directorEmail }"
              placeholder=" "
            />
            <label for="event-director-email" class="floating-input__label">Director Email (optional)</label>
          </div>
        </div>
        <span v-if="errors.has('directorEmail')" class="association-user-modal__error">
          Enter a valid email address (or leave blank).
        </span>
        <div class="register-team-modal__row">
          <div class="floating-input event-form-modal__phone-code">
            <input
              id="event-mob-code"
              v-model="mobCode"
              type="text"
              maxlength="6"
              class="floating-input__control"
              :class="{ 'floating-input__control--has-value': !!mobCode }"
              placeholder=" "
            />
            <label for="event-mob-code" class="floating-input__label">Country</label>
          </div>
          <div class="floating-input">
            <input
              id="event-director-phone"
              v-model="directorPhone"
              type="tel"
              class="floating-input__control"
              :class="{ 'floating-input__control--has-value': !!directorPhone }"
              placeholder=" "
            />
            <label for="event-director-phone" class="floating-input__label">Phone (optional)</label>
          </div>
        </div>

        <!-- Misc copy -->
        <div class="floating-input">
          <textarea
            id="event-note"
            v-model="note"
            rows="2"
            class="floating-input__control"
            :class="{ 'floating-input__control--has-value': !!note }"
            placeholder=" "
          ></textarea>
          <label for="event-note" class="floating-input__label">Note (optional, short prose)</label>
        </div>
        <div class="floating-input">
          <textarea
            id="event-reminder"
            v-model="reminder"
            rows="2"
            class="floating-input__control"
            :class="{ 'floating-input__control--has-value': !!reminder }"
            placeholder=" "
          ></textarea>
          <label for="event-reminder" class="floating-input__label">Reminder (optional)</label>
        </div>
        <div class="register-team-modal__row">
          <div class="floating-input">
            <input
              id="event-url"
              v-model="url"
              type="url"
              class="floating-input__control"
              :class="{ 'floating-input__control--has-value': !!url }"
              placeholder=" "
            />
            <label for="event-url" class="floating-input__label">Website URL (optional)</label>
          </div>
          <div class="floating-input event-form-modal__color">
            <input
              id="event-color"
              v-model="color"
              type="color"
              class="floating-input__control floating-input__control--color"
            />
            <label
              for="event-color"
              class="floating-input__label floating-input__label--floated"
            >Color</label>
          </div>
        </div>

        <!-- Tournament settings -->
        <h4 class="event-form-modal__section-title">Tournament Settings</h4>
        <div class="register-team-modal__row">
          <div class="floating-input">
            <input
              id="event-entry-fee"
              v-model="entryFee"
              type="number"
              min="0"
              step="0.01"
              class="floating-input__control"
              :class="{ 'floating-input__control--has-value': !!entryFee }"
              placeholder=" "
            />
            <label for="event-entry-fee" class="floating-input__label">Entry Fee ($) (optional)</label>
          </div>
          <div class="floating-input">
            <input
              id="event-entry-deadline"
              v-model="entryFeeDeadline"
              type="date"
              class="floating-input__control floating-input__control--date"
              :class="{ 'floating-input__control--has-value': !!entryFeeDeadline }"
              placeholder=" "
            />
            <label
              for="event-entry-deadline"
              class="floating-input__label"
              :class="{ 'floating-input__label--floated': !!entryFeeDeadline }"
            >Entry Fee Deadline</label>
          </div>
        </div>
        <span v-if="errors.has('entryFeeDeadline')" class="association-user-modal__error">
          Entry fee deadline must be after registration opens and on or before the end date.
        </span>
        <div class="register-team-modal__row">
          <div class="floating-input">
            <input
              id="event-pool-play-guaranteed"
              v-model="poolPlayGuaranteed"
              type="text"
              class="floating-input__control"
              :class="{ 'floating-input__control--has-value': !!poolPlayGuaranteed }"
              placeholder=" "
            />
            <label for="event-pool-play-guaranteed" class="floating-input__label">Pool Play Guaranteed (optional)</label>
          </div>
          <div class="floating-input">
            <select
              id="event-bracket-format"
              v-model="bracketFormatId"
              class="floating-input__control floating-input__control--select"
            >
              <option value="">—</option>
              <option v-for="opt in BRACKET_FORMAT_CATALOGUE" :key="opt.id" :value="opt.id">
                {{ opt.name }}
              </option>
            </select>
            <label
              for="event-bracket-format"
              class="floating-input__label floating-input__label--floated"
            >Bracket Format (optional)</label>
          </div>
        </div>
        <div class="register-team-modal__row">
          <div class="floating-input">
            <input
              id="event-time-interval"
              v-model="timeInterval"
              type="text"
              class="floating-input__control"
              :class="{ 'floating-input__control--has-value': !!timeInterval }"
              placeholder=" "
            />
            <label for="event-time-interval" class="floating-input__label">Time Interval (optional)</label>
          </div>
        </div>
        <div class="register-team-modal__row">
          <div class="floating-input">
            <input
              id="event-pool-time"
              v-model="poolPlayTime"
              type="text"
              class="floating-input__control"
              :class="{ 'floating-input__control--has-value': !!poolPlayTime }"
              placeholder=" "
            />
            <label for="event-pool-time" class="floating-input__label">Pool Play Time</label>
          </div>
          <div class="floating-input">
            <input
              id="event-bracket-time"
              v-model="bracketTime"
              type="text"
              class="floating-input__control"
              :class="{ 'floating-input__control--has-value': !!bracketTime }"
              placeholder=" "
            />
            <label for="event-bracket-time" class="floating-input__label">Bracket Time</label>
          </div>
          <div class="floating-input">
            <input
              id="event-championship-time"
              v-model="championshipTime"
              type="text"
              class="floating-input__control"
              :class="{ 'floating-input__control--has-value': !!championshipTime }"
              placeholder=" "
            />
            <label for="event-championship-time" class="floating-input__label">Championship Time</label>
          </div>
        </div>
        <div class="floating-input">
          <textarea
            id="event-tournament-format"
            v-model="tournamentFormat"
            rows="3"
            class="floating-input__control"
            :class="{ 'floating-input__control--has-value': !!tournamentFormat }"
            placeholder=" "
          ></textarea>
          <label for="event-tournament-format" class="floating-input__label">Tournament Format (optional)</label>
        </div>
        <div class="floating-input">
          <textarea
            id="event-refund-policy"
            v-model="refundPolicy"
            rows="2"
            class="floating-input__control"
            :class="{ 'floating-input__control--has-value': !!refundPolicy }"
            placeholder=" "
          ></textarea>
          <label for="event-refund-policy" class="floating-input__label">Refund Policy (optional)</label>
        </div>

        <!-- Registration -->
        <h4 class="event-form-modal__section-title">Team Registration</h4>
        <label class="event-form-modal__check">
          <input v-model="allowTeamRegistration" type="checkbox" />
          Allow teams to register publicly
        </label>
        <template v-if="allowTeamRegistration">
          <div class="floating-input" :class="{ 'floating-input--invalid': errors.has('registrationOpening') }">
            <input
              id="event-registration-opens"
              v-model="registrationOpening"
              type="datetime-local"
              class="floating-input__control floating-input__control--date"
              :class="{ 'floating-input__control--has-value': !!registrationOpening }"
              placeholder=" "
            />
            <label
              for="event-registration-opens"
              class="floating-input__label"
              :class="{ 'floating-input__label--floated': !!registrationOpening }"
            >Registration Opens (local datetime)</label>
          </div>
          <span v-if="errors.has('registrationOpening')" class="association-user-modal__error">
            Registration opening time is required when registration is enabled.
          </span>

          <label class="event-form-modal__check">
            <input v-model="paymentRequired" type="checkbox" />
            Require payment to confirm registration
          </label>
          <template v-if="paymentRequired">
            <div class="register-team-modal__row">
              <div class="floating-input" :class="{ 'floating-input--invalid': errors.has('paymentTerms') }">
                <select
                  id="event-payment-terms"
                  v-model="paymentTerms"
                  class="floating-input__control floating-input__control--select"
                >
                  <option value="" disabled hidden></option>
                  <option v-for="opt in PAYMENT_TERMS_OPTIONS" :key="opt.value" :value="opt.value">
                    {{ opt.label }}
                  </option>
                </select>
                <label
                  for="event-payment-terms"
                  class="floating-input__label"
                  :class="{ 'floating-input__label--floated': !!paymentTerms }"
                >Payment Terms</label>
              </div>
              <div
                v-if="paymentTerms === 'partial'"
                class="floating-input"
                :class="{ 'floating-input--invalid': errors.has('partialPaymentType') }"
              >
                <select
                  id="event-partial-type"
                  v-model="partialPaymentType"
                  class="floating-input__control floating-input__control--select"
                >
                  <option value="" disabled hidden></option>
                  <option v-for="opt in PARTIAL_PAYMENT_TYPE_OPTIONS" :key="opt.value" :value="opt.value">
                    {{ opt.label }}
                  </option>
                </select>
                <label
                  for="event-partial-type"
                  class="floating-input__label"
                  :class="{ 'floating-input__label--floated': !!partialPaymentType }"
                >Partial Mode</label>
              </div>
              <div
                v-if="paymentTerms === 'partial'"
                class="floating-input"
                :class="{ 'floating-input--invalid': errors.has('partialPaymentValue') }"
              >
                <input
                  id="event-partial-value"
                  v-model="partialPaymentValue"
                  type="number"
                  min="0"
                  step="0.01"
                  class="floating-input__control"
                  :class="{ 'floating-input__control--has-value': !!partialPaymentValue }"
                  placeholder=" "
                />
                <label for="event-partial-value" class="floating-input__label">Partial Amount</label>
              </div>
            </div>
            <label class="event-form-modal__check">
              <input v-model="allowOfflinePayment" type="checkbox" />
              Allow offline payment (cash / cheque)
            </label>
            <label class="event-form-modal__check">
              <input v-model="autoConfirmOnFullPayment" type="checkbox" />
              Auto-confirm team on full payment
            </label>
            <label v-if="paymentTerms === 'partial'" class="event-form-modal__check">
              <input v-model="autoConfirmOnPartialPayment" type="checkbox" />
              Auto-confirm team on partial payment
            </label>
          </template>
        </template>

        <!-- Status -->
        <h4 class="event-form-modal__section-title">Status</h4>
        <div class="floating-input">
          <select
            id="event-status"
            v-model="eventStatus"
            class="floating-input__control floating-input__control--select"
          >
            <option
              v-for="opt in statusOptions"
              :key="opt.value"
              :value="opt.value"
              :disabled="opt.disabled"
            >{{ opt.label }}</option>
          </select>
          <label
            for="event-status"
            class="floating-input__label floating-input__label--floated"
          >Status</label>
        </div>
      </div>

      <template #footer>
        <button class="secondary-button" type="button" :disabled="saving" @click="close">
          Cancel
        </button>
        <button class="primary-button" type="button" :disabled="saving || hydrating" @click="save">
          <span v-if="saving" class="btn-spinner" aria-hidden="true"></span>
          {{ saving ? 'Saving…' : (isEdit ? 'Save Changes' : 'Create Event') }}
        </button>
      </template>
    </SlideModal>

    <ImageEditorModal
      :model-value="imageEditorOpen"
      mode="cover"
      title="Edit hero photo"
      :initial-url="avatarPreviewUrl || ''"
      @update:modelValue="imageEditorOpen = $event"
      @save="onImageSaved"
      @remove="() => { avatarPreviewUrl = null; avatarFilename = null }"
    />
  </div>
</template>

<style scoped>
/* Loading state shown while the detail-fetch hydrates the form in
   Edit mode. Same vertical alignment as the form body so the modal
   doesn't jump when the data arrives. */
.event-form-modal__loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 80px 16px;
  font-size: 13px;
  color: #5b6b80;
}

.event-form-modal__loading-spinner {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 3px solid #d4dbe5;
  border-top-color: #1f8fff;
  animation: event-form-modal-spin 720ms linear infinite;
}

@keyframes event-form-modal-spin {
  to { transform: rotate(360deg); }
}

.event-form-modal__section-title {
  margin: 18px 0 4px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #5b6b80;
}

.event-form-modal__check {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #2a3b53;
  cursor: pointer;
  padding: 4px 0;
}

.event-form-modal__phone-code {
  flex: 0 0 100px;
}

.event-form-modal__color {
  flex: 0 0 120px;
}

.event-form-modal__color .floating-input__control--color {
  height: 38px;
  padding: 2px 6px;
}
</style>
