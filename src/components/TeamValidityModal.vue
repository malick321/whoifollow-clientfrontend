<script setup lang="ts">
// TeamValidityModal
// -----------------
// Centered confirmation popup that asks the admin to pick a
// validity for a team registration. Reused by mark-active, renew,
// reactivate, and change-validity flows on the team-details page.
//
// The user picks one of:
//   - "Never Expires" — registration has no end date.
//   - "Expires on <date>" — explicit ISO date in the future.

import { computed, onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import TeamValidityFields from './TeamValidityFields.vue'
import { lockBodyScroll, unlockBodyScroll } from '../body-scroll-lock'

const props = withDefaults(defineProps<{
  modelValue: boolean
  /** Title shown at the top of the popup — copy varies per flow
   *  (e.g. "Mark Active", "Renew Registration"). */
  title?: string
  /** Subtitle — short context line. */
  subtitle?: string
  /** Submit button label. */
  submitLabel?: string
  /** Whether the form should boot with the Never Expires option
   *  selected. Reuse from the team's current state on edit flows. */
  initialNeverExpires?: boolean
  /** Initial expiry date (YYYY-MM-DD) when re-opening on a team
   *  that already has one. */
  initialValidUntil?: string
  /** Whether the user is currently saving — disables submit. */
  saving?: boolean
  /** Whether to surface the Source picker (Payment vs Manual) and
   *  the Payment Order ID field. Only true for the `mark_active`
   *  and `renew` flows; reactivate / change-validity hide it. */
  showSource?: boolean
}>(), {
  title: 'Set validity',
  subtitle: '',
  submitLabel: 'Save',
  initialNeverExpires: false,
  initialValidUntil: '',
  saving: false,
  showSource: false
})

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'submit', payload: {
    neverExpires: boolean
    validUntil: string
    reason: string
    source: 'payment' | 'manual' | null
    paymentOrderId: string
  }): void
}>()

const neverExpires = ref(true)
const validUntil = ref('')
const reason = ref('')
const source = ref<'payment' | 'manual'>('payment')
const paymentOrderId = ref('')
const submitAttempted = ref(false)

function reset() {
  neverExpires.value = props.initialNeverExpires || !props.initialValidUntil
  validUntil.value = props.initialValidUntil
  reason.value = ''
  source.value = 'payment'
  paymentOrderId.value = ''
  submitAttempted.value = false
}

watch(
  () => props.modelValue,
  (open, wasOpen) => {
    if (open) {
      reset()
      lockBodyScroll()
    } else if (wasOpen) {
      unlockBodyScroll()
    }
  }
)

onBeforeUnmount(() => {
  if (props.modelValue) unlockBodyScroll()
})

const dateInvalid = computed(() => {
  if (neverExpires.value) return false
  if (!submitAttempted.value) return false
  return !validUntil.value
})

const paymentOrderInvalid = computed(() => {
  if (!props.showSource) return false
  if (source.value !== 'payment') return false
  if (!submitAttempted.value) return false
  return !paymentOrderId.value.trim()
})

function close() {
  if (props.saving) return
  emit('update:modelValue', false)
}

function onBackdrop(event: MouseEvent) {
  if (event.target === event.currentTarget) close()
}

function submit() {
  submitAttempted.value = true
  if (!neverExpires.value && !validUntil.value) return
  if (props.showSource && source.value === 'payment' && !paymentOrderId.value.trim()) return
  emit('submit', {
    neverExpires: neverExpires.value,
    validUntil: neverExpires.value ? '' : validUntil.value,
    reason: reason.value.trim(),
    source: props.showSource ? source.value : null,
    paymentOrderId:
      props.showSource && source.value === 'payment'
        ? paymentOrderId.value.trim()
        : ''
  })
}
</script>

<template>
  <Transition name="slide-modal-backdrop">
    <div
      v-if="modelValue"
      class="association-switcher-backdrop"
      role="presentation"
      @click="onBackdrop"
    >
      <div
        class="association-switcher-panel association-confirm-panel team-validity-modal"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
      >
        <header class="association-switcher-panel__header">
          <div class="association-switcher-panel__title-block">
            <h2 class="association-switcher-panel__title">{{ title }}</h2>
            <p v-if="subtitle" class="association-switcher-panel__subtitle">{{ subtitle }}</p>
          </div>
          <button
            type="button"
            class="association-switcher-panel__close"
            aria-label="Close"
            :disabled="saving"
            @click="close"
          >
            <AppIcon name="close" :size="16" />
          </button>
        </header>

        <TeamValidityFields
          v-model:never-expires="neverExpires"
          v-model:valid-until="validUntil"
          v-model:source="source"
          v-model:payment-order-id="paymentOrderId"
          v-model:reason="reason"
          :show-source="showSource"
          :date-invalid="dateInvalid"
          :payment-order-invalid="paymentOrderInvalid"
          id-prefix="team-validity"
        />

        <footer class="association-confirm-panel__footer">
          <button class="secondary-button" type="button" :disabled="saving" @click="close">Cancel</button>
          <button class="ledger-action-button" type="button" :disabled="saving" @click="submit">
            {{ saving ? 'Saving…' : submitLabel }}
          </button>
        </footer>
      </div>
    </div>
  </Transition>
</template>
