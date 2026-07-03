<script setup lang="ts">
// TeamValidityFields
// ------------------
// The validity field group an admin fills when activating / renewing /
// re-validating a team registration:
//   - Never Expires  vs  Expires on a specific date (+ date picker)
//   - optional Source (Payment / Manual + Payment Order ID)  [showSource]
//   - optional Reason note
//
// Extracted from TeamValidityModal so the SAME controls back both the
// centered lifecycle popup AND the Register wizard's "activate while
// registering" step — one source of truth, no duplicated markup. The parent
// owns validation state (passes `dateInvalid` / `paymentOrderInvalid`) and the
// submit gate; this component is purely the field group.

import { computed } from 'vue'
import DateTimePicker from './DateTimePicker.vue'

const props = withDefaults(defineProps<{
  neverExpires: boolean
  validUntil: string
  source?: 'payment' | 'manual'
  paymentOrderId?: string
  reason?: string
  /** Surface the Source picker (Payment vs Manual) + Payment Order ID.
   *  Only true for mark-active / renew / activate-on-create. */
  showSource?: boolean
  dateInvalid?: boolean
  paymentOrderInvalid?: boolean
  /** Prefix for DOM ids + radio group names so multiple instances never
   *  collide. */
  idPrefix?: string
}>(), {
  source: 'payment',
  paymentOrderId: '',
  reason: '',
  showSource: false,
  dateInvalid: false,
  paymentOrderInvalid: false,
  idPrefix: 'team-validity'
})

const emit = defineEmits<{
  (e: 'update:neverExpires', value: boolean): void
  (e: 'update:validUntil', value: string): void
  (e: 'update:source', value: 'payment' | 'manual'): void
  (e: 'update:paymentOrderId', value: string): void
  (e: 'update:reason', value: string): void
}>()

const dateId = computed(() => `${props.idPrefix}-date`)
const paymentId = computed(() => `${props.idPrefix}-payment-order`)
const reasonId = computed(() => `${props.idPrefix}-reason`)
const modeName = computed(() => `${props.idPrefix}-mode`)
const sourceName = computed(() => `${props.idPrefix}-source`)
</script>

<template>
  <div class="team-validity-modal__body">
    <label class="team-validity-modal__option" :class="{ 'team-validity-modal__option--selected': neverExpires }">
      <input
        type="radio"
        :name="modeName"
        value="never"
        :checked="neverExpires"
        @change="emit('update:neverExpires', true)"
      />
      <span class="team-validity-modal__option-copy">
        <strong class="team-validity-modal__option-title">Never Expires</strong>
        <span v-if="neverExpires" class="team-validity-modal__option-description">
          The registration stays valid until an admin changes it.
        </span>
      </span>
    </label>

    <label class="team-validity-modal__option" :class="{ 'team-validity-modal__option--selected': !neverExpires }">
      <input
        type="radio"
        :name="modeName"
        value="date"
        :checked="!neverExpires"
        @change="emit('update:neverExpires', false)"
      />
      <span class="team-validity-modal__option-copy">
        <strong class="team-validity-modal__option-title">Expires on a specific date</strong>
        <span v-if="!neverExpires" class="team-validity-modal__option-description">
          Pick a date below — the registration moves to Expired automatically when that date passes.
        </span>
        <DateTimePicker
          v-if="!neverExpires"
          :id="dateId"
          :model-value="validUntil"
          label="Expiry date"
          date-only
          :invalid="dateInvalid"
          class="team-validity-modal__date-input"
          @update:model-value="emit('update:validUntil', $event)"
        />
        <span v-if="dateInvalid" class="association-user-modal__error">Pick a date or choose "Never Expires" above.</span>
      </span>
    </label>

    <div v-if="showSource" class="team-validity-modal__source">
      <p class="team-validity-modal__section-label">How did this happen?</p>
      <div class="team-validity-modal__source-options">
        <label
          class="team-validity-modal__source-option"
          :class="{ 'team-validity-modal__source-option--selected': source === 'payment' }"
        >
          <input
            type="radio"
            :name="sourceName"
            value="payment"
            :checked="source === 'payment'"
            @change="emit('update:source', 'payment')"
          />
          <span>Payment</span>
        </label>
        <label
          class="team-validity-modal__source-option"
          :class="{ 'team-validity-modal__source-option--selected': source === 'manual' }"
        >
          <input
            type="radio"
            :name="sourceName"
            value="manual"
            :checked="source === 'manual'"
            @change="emit('update:source', 'manual')"
          />
          <span>Manual</span>
        </label>
      </div>
      <span
        v-if="source === 'payment'"
        class="floating-input team-validity-modal__payment-input"
        :class="{ 'floating-input--invalid': paymentOrderInvalid }"
      >
        <input
          :id="paymentId"
          :value="paymentOrderId"
          type="text"
          class="floating-input__control"
          :class="{ 'floating-input__control--has-value': !!paymentOrderId }"
          placeholder=" "
          @input="emit('update:paymentOrderId', ($event.target as HTMLInputElement).value)"
        />
        <label
          :for="paymentId"
          class="floating-input__label"
          :class="{ 'floating-input__label--floated': !!paymentOrderId }"
        >Payment Order ID</label>
      </span>
      <span v-if="paymentOrderInvalid" class="association-user-modal__error">Enter the Payment Order ID or pick Manual.</span>
    </div>

    <div class="team-validity-modal__reason">
      <span class="floating-input team-validity-modal__reason-input">
        <textarea
          :id="reasonId"
          :value="reason"
          class="floating-input__control"
          :class="{ 'floating-input__control--has-value': !!reason }"
          placeholder=" "
          rows="3"
          @input="emit('update:reason', ($event.target as HTMLTextAreaElement).value)"
        ></textarea>
        <label
          :for="reasonId"
          class="floating-input__label"
          :class="{ 'floating-input__label--floated': !!reason }"
        >Reason (optional)</label>
      </span>
    </div>
  </div>
</template>
