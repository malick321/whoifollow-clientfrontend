<script setup lang="ts">
// MapAddHotelWizard
// -----------------
// Right-side panel for the Map Explorer's in-map "Add Hotel" flow. The place
// is already picked (Google Place → `place` prop) so this is a single-step
// detail form, prefilled from the Google lookup. On save it creates the
// hotel and emits the stored `EventHotel` for an optimistic map pin.

import { ref } from 'vue'
import { createHotel } from '../../api/matchGeniHotels'
import type { CreateHotelPayload, EventHotel, PlaceLookup } from '../../types'

const props = withDefaults(defineProps<{
  place: PlaceLookup
  associationId?: string
  eventId?: string
}>(), {
  associationId: '',
  eventId: ''
})

const emit = defineEmits<{
  (event: 'saved', payload: { hotel: EventHotel }): void
  (event: 'cancel'): void
}>()

// Prefill from the Google lookup; the admin can edit any field.
const form = ref({
  name: props.place.name,
  website: props.place.website ?? '',
  phoneCountryCode: props.place.phoneCountryCode ?? '',
  phone: props.place.phone ?? '',
  street: props.place.street ?? '',
  city: props.place.city ?? '',
  state: props.place.state ?? '',
  postalCode: props.place.postalCode ?? '',
  imageUrl: props.place.photos?.[0] ?? ''
})

const attempted = ref(false)
const saving = ref(false)
const saveError = ref('')

const nameInvalid = () => attempted.value && form.value.name.trim().length === 0

async function save() {
  attempted.value = true
  if (form.value.name.trim().length === 0) return
  if (!props.eventId) { saveError.value = 'Missing event context — cannot save.'; return }
  saving.value = true
  saveError.value = ''
  try {
    const payload: CreateHotelPayload = {
      name: form.value.name.trim(),
      placeId: props.place.placeId,
      website: form.value.website.trim() || undefined,
      phoneCountryCode: form.value.phoneCountryCode.trim() || undefined,
      phone: form.value.phone.trim() || undefined,
      street: form.value.street.trim() || undefined,
      city: form.value.city.trim() || undefined,
      state: form.value.state.trim() || undefined,
      postalCode: form.value.postalCode.trim() || undefined,
      countryCode: props.place.countryCode,
      // Coordinates come straight from the picked place — not user-editable.
      latitude: props.place.position.lat,
      longitude: props.place.position.lng,
      imageUrl: form.value.imageUrl.trim() || undefined
    }
    const hotel = await createHotel(props.associationId, props.eventId, payload)
    emit('saved', { hotel })
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : 'Could not save the hotel. Please try again.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="mapx-wiz">
    <header class="mapx-wiz__head">
      <div class="mapx-wiz__titles">
        <h3 class="mapx-wiz__title">Hotel details</h3>
      </div>
    </header>

    <div class="mapx-wiz__body">
      <div class="floating-input" :class="{ 'floating-input--invalid': nameInvalid() }">
        <input
          id="hotel-name"
          v-model="form.name"
          type="text"
          class="floating-input__control"
          :class="{ 'floating-input__control--has-value': !!form.name }"
          placeholder=" "
        />
        <label for="hotel-name" class="floating-input__label">Hotel name</label>
        <span v-if="nameInvalid()" class="floating-input__error-corner">Required</span>
      </div>

      <div class="floating-input">
        <input
          id="hotel-website"
          v-model="form.website"
          type="url"
          class="floating-input__control"
          :class="{ 'floating-input__control--has-value': !!form.website }"
          placeholder=" "
        />
        <label for="hotel-website" class="floating-input__label">Website URL</label>
      </div>

      <div class="mapx-wiz__grid mapx-wiz__grid--cc">
        <div class="floating-input">
          <input
            id="hotel-cc"
            v-model="form.phoneCountryCode"
            type="text"
            class="floating-input__control"
            :class="{ 'floating-input__control--has-value': !!form.phoneCountryCode }"
            placeholder=" "
          />
          <label for="hotel-cc" class="floating-input__label">Code</label>
        </div>
        <div class="floating-input">
          <input
            id="hotel-phone"
            v-model="form.phone"
            type="tel"
            class="floating-input__control"
            :class="{ 'floating-input__control--has-value': !!form.phone }"
            placeholder=" "
          />
          <label for="hotel-phone" class="floating-input__label">Phone</label>
        </div>
      </div>

      <div class="floating-input">
        <input
          id="hotel-street"
          v-model="form.street"
          type="text"
          class="floating-input__control"
          :class="{ 'floating-input__control--has-value': !!form.street }"
          placeholder=" "
        />
        <label for="hotel-street" class="floating-input__label">Street address</label>
      </div>

      <div class="mapx-wiz__grid mapx-wiz__grid--csz">
        <div class="floating-input">
          <input
            id="hotel-city"
            v-model="form.city"
            type="text"
            class="floating-input__control"
            :class="{ 'floating-input__control--has-value': !!form.city }"
            placeholder=" "
          />
          <label for="hotel-city" class="floating-input__label">City</label>
        </div>
        <div class="floating-input">
          <input
            id="hotel-state"
            v-model="form.state"
            type="text"
            class="floating-input__control"
            :class="{ 'floating-input__control--has-value': !!form.state }"
            placeholder=" "
          />
          <label for="hotel-state" class="floating-input__label">State</label>
        </div>
        <div class="floating-input">
          <input
            id="hotel-zip"
            v-model="form.postalCode"
            type="text"
            class="floating-input__control"
            :class="{ 'floating-input__control--has-value': !!form.postalCode }"
            placeholder=" "
          />
          <label for="hotel-zip" class="floating-input__label">ZIP</label>
        </div>
      </div>

      <div class="floating-input">
        <input
          id="hotel-image"
          v-model="form.imageUrl"
          type="url"
          class="floating-input__control"
          :class="{ 'floating-input__control--has-value': !!form.imageUrl }"
          placeholder=" "
        />
        <label for="hotel-image" class="floating-input__label">Image URL</label>
      </div>
    </div>

    <footer class="mapx-wiz__foot">
      <button type="button" class="secondary-button" :disabled="saving" @click="emit('cancel')">Cancel</button>
      <span class="mapx-wiz__foot-spacer"></span>
      <span v-if="saveError" class="mapx-wiz__error mapx-wiz__error--inline">{{ saveError }}</span>
      <button type="button" class="primary-button" :disabled="saving" @click="save">{{ saving ? 'Saving…' : 'Add Hotel' }}</button>
    </footer>
  </div>
</template>

<style scoped>
.mapx-wiz {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.mapx-wiz__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 16px 8px;
}
.mapx-wiz__titles { min-width: 0; }
.mapx-wiz__eyebrow {
  display: block;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mapx-wiz__title { margin: 2px 0 0; font-size: 17px; font-weight: 600; color: var(--text); }

.mapx-wiz__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
/* Multi-field rows — each cell is a finalized `.floating-input`. */
.mapx-wiz__grid { display: grid; gap: 10px; }
.mapx-wiz__grid--cc { grid-template-columns: 96px 1fr; }
.mapx-wiz__grid--csz { grid-template-columns: 1.4fr 0.8fr 0.8fr; }
.mapx-wiz__error { font-size: 12px; font-weight: 500; color: #c1413a; }
.mapx-wiz__error--inline { align-self: center; }

.mapx-wiz__foot {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-divider);
}
.mapx-wiz__foot-spacer { flex: 1 1 auto; }
/* Flat brand primary (the base `.primary-button` is a gradient). */
.mapx-wiz__foot .primary-button { background: var(--primary); }
.mapx-wiz__foot .primary-button:hover { background: var(--primary-light); }
</style>
