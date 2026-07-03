<script setup lang="ts">
// TravelArrangementsModal
// -----------------------
// Form modal users see after marking themselves Going on the event
// attendance popup, when they opt into capturing travel info. Posts to
// the same `eventAttendeeSelect` endpoint as the status save (status
// stays `going`) — just with the extra travel fields populated.
//
// Service rules per product:
//   - Hotel ON  → Start Date, End Date, Adults, Rooms, Notes are
//                 required. Backend stores room_count, adult_count,
//                 exactStartDate, exactEndDate, note.
//   - Bnb / Car Rental / Airline Tickets → no extra fields, the toggle
//                 state alone determines whether the service is in the
//                 comma-separated `services` list.
//
// Body scroll lock + flex-column-with-inner-scroll-body pattern mirror
// EventLineupModal / GameLineupSubmissionModal.

import { computed, onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import ToggleSwitch from './ToggleSwitch.vue'
import NumberStepper from './NumberStepper.vue'
import DateRangePicker from './DateRangePicker.vue'
import { saveEventAttendance } from '../api/eventAttendance'
import { pushToast } from '../toast-center'
import { lockBodyScroll, unlockBodyScroll } from '../body-scroll-lock'
import type { SaveEventAttendanceResult } from '../types'

// Service codes — the canonical strings sent to the backend in the
// comma-separated `services` field. Order is the order they're rendered
// in and the order they're joined, so admins always see them in the
// same sequence regardless of which subset the user picked.
const HOTEL = 'Hotel'
const BNB = 'Bnb'
const CAR_RENTAL = 'Car Rental'
const AIRLINE_TICKETS = 'Airline Tickets'

interface InitialTravelInfo {
  services?: string[]
  roomCount?: number | null
  adultCount?: number | null
  exactStartDate?: string | null
  exactEndDate?: string | null
  note?: string | null
}

const props = withDefaults(defineProps<{
  modelValue: boolean
  eventId: string
  teamGuid: string
  eventName?: string
  eventDate?: string
  /** Pre-fill values when the user already has travel info on file. Pass
   *  null/undefined for a blank form (initial Going + opted-in case). */
  initial?: InitialTravelInfo | null
  /** Pass-through to `saveEventAttendance.memberId` when an admin is
   *  filling in the form on behalf of another teammate. Empty / omitted
   *  means self — the backend derives the user from the bearer token. */
  memberId?: string
  /** Display name of the person whose travel info we're capturing. Used
   *  to disambiguate the modal title when an admin is editing on behalf
   *  of another teammate. Omit / empty when filling for self. */
  targetName?: string
  /** ISO date strings (yyyy-mm-dd) for the event's division window. Used
   *  to pre-populate the Travel Dates range when the user is opting in
   *  for the first time (no `initial` data). When `initial` carries
   *  saved dates those win — these props only seed the blank-form case.
   *  Empty strings are treated as "not provided". */
  eventStartDate?: string
  eventEndDate?: string
}>(), {
  eventName: '',
  eventDate: '',
  initial: null,
  memberId: '',
  targetName: '',
  eventStartDate: '',
  eventEndDate: ''
})

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'saved', result: SaveEventAttendanceResult): void
}>()

// Form state. Toggles default OFF when no initial; hotel sub-fields use
// sensible defaults (1 adult, 1 room) but the submit guard makes sure
// the dates are filled before save is enabled.
const hotelOn = ref(false)
const bnbOn = ref(false)
const carRentalOn = ref(false)
const airlineTicketsOn = ref(false)
const startDate = ref('')
const endDate = ref('')
const adults = ref(1)
const rooms = ref(1)
const note = ref('')
const saving = ref(false)
const submitAttempted = ref(false)

// Hydrate from `props.initial` whenever the modal opens. The watcher
// fires both on open transition AND on prop changes while open (e.g.
// the parent could swap initial values without closing). Resetting
// `submitAttempted` here means the user doesn't see lingering error
// states from a previous open.
function hydrate(initial: InitialTravelInfo | null | undefined) {
  const services = initial?.services ?? []
  hotelOn.value = services.includes(HOTEL)
  bnbOn.value = services.includes(BNB)
  carRentalOn.value = services.includes(CAR_RENTAL)
  airlineTicketsOn.value = services.includes(AIRLINE_TICKETS)
  // Saved dates win over event-window defaults, so an admin can edit
  // a teammate's previously-saved range without it snapping back to
  // the event window every time the form opens. Only when the user
  // has no record on file (or those fields were never populated) do
  // we pre-fill from the event's division start/end as a sensible
  // starting range — saves the user from typing both dates by hand
  // when their travel almost always matches the event window.
  startDate.value = initial?.exactStartDate ?? props.eventStartDate ?? ''
  endDate.value = initial?.exactEndDate ?? props.eventEndDate ?? ''
  adults.value = initial?.adultCount ?? 1
  rooms.value = initial?.roomCount ?? 1
  note.value = initial?.note ?? ''
  submitAttempted.value = false
}

watch(
  () => props.modelValue,
  (open, wasOpen) => {
    if (open) hydrate(props.initial)
    // Body scroll lock — page behind the modal stays put while open. Same
    // pattern as EventLineupModal / GameLineupSubmissionModal.
    if (open && !wasOpen) lockBodyScroll()
    else if (!open && wasOpen) unlockBodyScroll()
  }
)

onBeforeUnmount(() => {
  // Defensive: if we unmount mid-open (parent v-if flip / route change)
  // release the lock so the underlying page stays usable.
  if (props.modelValue) unlockBodyScroll()
})

// Selected services in canonical order — the array we hand to the API.
const selectedServices = computed<string[]>(() => {
  const out: string[] = []
  if (hotelOn.value) out.push(HOTEL)
  if (bnbOn.value) out.push(BNB)
  if (carRentalOn.value) out.push(CAR_RENTAL)
  if (airlineTicketsOn.value) out.push(AIRLINE_TICKETS)
  return out
})

// Hotel field validity — only meaningful when Hotel toggle is on.
const hotelStartInvalid = computed(() => hotelOn.value && !startDate.value)
const hotelEndInvalid = computed(() => hotelOn.value && !endDate.value)
const hotelDateOrderInvalid = computed(
  // Coerced to boolean — chained `&&` with string operands would otherwise
  // produce `string | boolean`, which TS infers wider than the boolean
  // signature `DateRangePicker.invalid` expects.
  () => Boolean(hotelOn.value && startDate.value && endDate.value && endDate.value < startDate.value)
)
const hotelAdultsInvalid = computed(() => hotelOn.value && adults.value < 1)
const hotelRoomsInvalid = computed(() => hotelOn.value && rooms.value < 1)
// Notes is compulsory when Hotel is selected — the team manager relies
// on this free-text field to capture preferences (twin beds, accessible
// rooms, late check-in, etc.) that can't be modelled by the structured
// fields above. Whitespace-only values count as empty.
const hotelNoteInvalid = computed(() => hotelOn.value && !note.value.trim())

const isFormValid = computed(() => {
  // Form valid when service-specific required fields pass. Submitting
  // with ZERO services toggled on is also valid — that's the user's
  // way of saying "I don't need any travel arrangements" (or, on a
  // re-edit, of clearing previously-saved info). The save then sends
  // empty `services`, `room_count`, `adult_count`, `exactStartDate`,
  // `exactEndDate`, and `note`, which the backend treats as a clear.
  // Hotel sub-fields are only validated when Hotel itself is on.
  if (hotelOn.value) {
    if (hotelStartInvalid.value) return false
    if (hotelEndInvalid.value) return false
    if (hotelDateOrderInvalid.value) return false
    if (hotelAdultsInvalid.value) return false
    if (hotelRoomsInvalid.value) return false
    if (hotelNoteInvalid.value) return false
  }
  return true
})

function close() {
  if (saving.value) return
  emit('update:modelValue', false)
}

async function save() {
  submitAttempted.value = true
  if (!isFormValid.value) return
  saving.value = true
  try {
    const result = await saveEventAttendance({
      eventId: props.eventId,
      teamGuid: props.teamGuid,
      status: 'going',
      // Pass-through when an admin is filling in for another teammate.
      // Empty string falls back to undefined so the API layer omits the
      // `member_id` field (sending an empty string would make the
      // backend look up a player with id "" and 500 — confirmed in the
      // saveEventAttendance comments).
      memberId: props.memberId || undefined,
      services: selectedServices.value,
      // Hotel-specific fields only sent when the toggle is on; otherwise
      // null → the API layer renders them as empty strings. This means
      // toggling Hotel OFF on a previously-saved record CLEARS those
      // fields on the backend, which is the desired edit behaviour.
      roomCount: hotelOn.value ? rooms.value : null,
      adultCount: hotelOn.value ? adults.value : null,
      exactStartDate: hotelOn.value ? startDate.value : null,
      exactEndDate: hotelOn.value ? endDate.value : null,
      note: hotelOn.value ? note.value.trim() : null
    })
    emit('saved', result)
    emit('update:modelValue', false)
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Unable to save travel info',
      message: error instanceof Error ? error.message : 'Something went wrong while saving your travel arrangements.'
    })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div v-if="modelValue" class="modal-backdrop" @click.self="close">
    <section class="modal-card travel-modal">
      <header class="modal-card__header travel-modal__header">
        <div class="travel-modal__title-block">
          <h2>Travel arrangements</h2>
          <!-- When an admin is filling in for another teammate, surface
               the target name immediately under the title so the admin
               doesn't lose track of whose record they're editing while
               navigating between cards. Hidden for self (no `targetName`
               or memberId blank). -->
          <p v-if="targetName && memberId" class="travel-modal__subtitle travel-modal__subtitle--target">
            For {{ targetName }}
          </p>
          <p v-if="eventName || eventDate" class="travel-modal__subtitle">
            {{ [eventName, eventDate].filter(Boolean).join(' · ') }}
          </p>
        </div>
        <button
          type="button"
          class="ellipsis-button ellipsis-button--close"
          aria-label="Close"
          :disabled="saving"
          @click="close"
        >
          <AppIcon name="close" :size="16" />
        </button>
      </header>

      <div class="travel-modal__body">
        <!-- Hotel — toggle + collapsible sub-section with required
             dates, adult/room steppers, and an optional notes field.
             Vue 2 quirk: v-model on custom components binds to `value`
             by default, not `modelValue`. We use the explicit Vue-3-style
             `:model-value` + `@update:modelValue` shape so the child
             component contracts (which use `modelValue`) line up. */ -->
        <div class="travel-modal__row">
          <span class="travel-modal__row-label">Hotel</span>
          <ToggleSwitch :model-value="hotelOn" aria-label="Hotel" @update:modelValue="hotelOn = $event" />
        </div>
        <div v-if="hotelOn" class="travel-modal__hotel-fields">
          <!-- Travel Dates range control: a single popover calendar
               where the user clicks start, then end, all inside one
               control. Pre-filled from the event's division window so
               the most common case (travel matches event window) is
               a zero-keystroke default. The picker emits both halves
               of the range, which are bound back to startDate and
               endDate. The whole field gets the --invalid modifier
               when any of the three Hotel-date guards fail after
               submitAttempted, so the trigger paints a red border
               that matches the rest of the form's error treatment. -->
          <div class="travel-modal__field travel-modal__field--range">
            <span class="travel-modal__field-label">Travel Dates</span>
            <DateRangePicker
              :model-start="startDate"
              :model-end="endDate"
              :invalid="submitAttempted && (hotelStartInvalid || hotelEndInvalid || hotelDateOrderInvalid)"
              placeholder="Select travel dates"
              aria-label="Travel dates"
              @update:modelStart="startDate = $event"
              @update:modelEnd="endDate = $event"
            />
            <span v-if="submitAttempted && hotelStartInvalid" class="travel-modal__error">Start date is required</span>
            <span v-else-if="submitAttempted && hotelEndInvalid" class="travel-modal__error">End date is required</span>
            <span v-else-if="submitAttempted && hotelDateOrderInvalid" class="travel-modal__error">End date must be on or after start date</span>
          </div>
          <div class="travel-modal__field-row">
            <label class="travel-modal__field travel-modal__field--inline">
              <span class="travel-modal__field-label">Adults</span>
              <NumberStepper :model-value="adults" :min="1" :max="20" aria-label="Adults" @update:modelValue="adults = $event" />
            </label>
            <label class="travel-modal__field travel-modal__field--inline">
              <span class="travel-modal__field-label">Rooms</span>
              <NumberStepper :model-value="rooms" :min="1" :max="10" aria-label="Rooms" @update:modelValue="rooms = $event" />
            </label>
          </div>
          <label class="travel-modal__field">
            <span class="travel-modal__field-label">Notes</span>
            <textarea
              v-model="note"
              rows="3"
              class="travel-modal__textarea"
              :class="{ 'travel-modal__input--invalid': submitAttempted && hotelNoteInvalid }"
              placeholder="Any preferences or special requests for the team manager"
            ></textarea>
            <span v-if="submitAttempted && hotelNoteInvalid" class="travel-modal__error">Notes are required for hotel bookings</span>
          </label>
        </div>

        <div class="travel-modal__row">
          <span class="travel-modal__row-label">Bnb</span>
          <ToggleSwitch :model-value="bnbOn" aria-label="Bnb" @update:modelValue="bnbOn = $event" />
        </div>

        <div class="travel-modal__row">
          <span class="travel-modal__row-label">Car Rental</span>
          <ToggleSwitch :model-value="carRentalOn" aria-label="Car Rental" @update:modelValue="carRentalOn = $event" />
        </div>

        <div class="travel-modal__row travel-modal__row--last">
          <span class="travel-modal__row-label">Airline Tickets</span>
          <ToggleSwitch :model-value="airlineTicketsOn" aria-label="Airline Tickets" @update:modelValue="airlineTicketsOn = $event" />
        </div>
        <!-- No "select at least one service" error — saving with every
             toggle off is allowed and means "no travel arrangements
             needed". The backend stores cleared values and the team
             manager sees the absence of services as the explicit
             opt-out signal. -->
      </div>

      <footer class="travel-modal__footer">
        <button class="secondary-button" type="button" :disabled="saving" @click="close">Cancel</button>
        <button
          class="primary-button"
          type="button"
          :disabled="saving || (submitAttempted && !isFormValid)"
          @click="save"
        >
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
      </footer>
    </section>
  </div>
</template>
