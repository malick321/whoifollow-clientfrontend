<script setup lang="ts">
// PaymentTransactionsModal
// ------------------------
// Right-edge slide modal that drills into one `payment_orders` row
// from the team-details Payments tab. Renders:
//   - Order header: PO #, status, payment method, totals,
//     completion + proof status.
//   - Line items (`payables[]`): description, amounts, status —
//     the row that triggered the modal is highlighted.
//   - Transaction ledger: every charge / payment recorded against
//     the order.
//
// Fetches its own data via `fetchPaymentOrder` so the modal can be
// re-opened from anywhere with just (teamId, paymentOrderId).

import { computed, ref, watch } from 'vue'
import SlideModal from './SlideModal.vue'
import StatusBadge from './StatusBadge.vue'
import DateTimePicker from './DateTimePicker.vue'
import { fetchPaymentOrder, recordTeamPayment, sendTeamPaymentLink } from '../api/associationTeams'
import { fetchRegistrationSettings } from '../api/associationRegSettings'
import { currentAssociation } from '../constants/associations'
import { limitTwoDecimals } from '../lib/money'
import { pushToast } from '../toast-center'
import type {
  AssociationPayable,
  AssociationPaymentCompletionStatus,
  AssociationPaymentMethodType,
  AssociationPaymentOrder,
  RegistrationSetting,
} from '../types'

// NOTE: Vue 2.7's runtime prop validator doesn't accept `null` as a
// type. The TS union `string | null` would compile to `[String, null]`
// and warn at runtime. Use optional `string` instead and let the
// parent pass `undefined` when the order/payable hasn't been picked
// yet — same effect, no runtime warning.
const props = defineProps<{
  modelValue: boolean
  associationShortName: string
  teamId: string
  paymentOrderId?: string
  /** Payable row the admin clicked — used to highlight the matching
   *  line item inside the order's payable list. Optional; omit to
   *  render the order without highlighting. */
  focusedPayableId?: string
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  /** Fired after a payment is recorded / a link is sent so the parent can
   *  re-pull the team + payables (the registration may have activated). */
  (event: 'updated'): void
}>()

const order = ref<AssociationPaymentOrder | null>(null)
const payables = ref<AssociationPayable[]>([])
const loading = ref(false)
// Per-type payment-rail policy (association reg settings) — gates which
// collection actions are offered against a registration payable.
const regSettings = ref<RegistrationSetting[]>([])

watch(
  () => [props.modelValue, props.paymentOrderId, props.teamId] as const,
  async ([open, poId, tId]) => {
    if (!open || !poId || !tId) return
    loading.value = true
    order.value = null
    payables.value = []
    try {
      const assocId = currentAssociation.value?.id
      const [result, rows] = await Promise.all([
        fetchPaymentOrder(props.associationShortName, tId, poId),
        assocId ? fetchRegistrationSettings({ associationId: assocId, type: 'team' }) : Promise.resolve([])
      ])
      regSettings.value = rows
      if (result) {
        order.value = result.order
        payables.value = result.payables
      }
    } finally {
      loading.value = false
    }
  },
  { immediate: true }
)

function formatCurrency(value: number): string {
  return value.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' })
}

function formatDateTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' })
    + ' · '
    + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

// ---- Status copy + tones ----

function completionLabel(status: AssociationPaymentCompletionStatus): string {
  switch (status) {
    case 'unpaid': return 'Pending'
    case 'partially_paid': return 'Partially Paid'
    case 'paid': return 'Paid'
  }
}

/** Same neutral / warning / success palette used on the Payments
 *  listing screen — keeps the badge-color language consistent
 *  whether the admin is scanning rows or drilled into one. */
function completionTone(
  status: AssociationPaymentCompletionStatus
): 'success' | 'warning' | 'neutral' {
  switch (status) {
    case 'paid': return 'success'
    case 'partially_paid': return 'warning'
    case 'unpaid':
    default: return 'neutral'
  }
}

// Header: the descriptor ("Team Event Participation") is the eyebrow, the event
// name is the title below it. Non-event payables have no event name → the
// descriptor becomes the title and the eyebrow is empty (no duplication).
const headerEyebrow = computed(() =>
  summaryPayable.value?.eventName ? statementDescriptor(summaryPayable.value) : ''
)
const title = computed(() => {
  const p = summaryPayable.value
  if (!p) return 'Payment Order'
  return p.eventName || statementDescriptor(p)
})

/** When the modal is opened from a row click, that payable's
 *  status is what the admin actually cares about — surface it in
 *  the summary header. Falls back to the first line item if no
 *  focus was provided. */
const summaryPayable = computed<AssociationPayable | null>(() => {
  if (props.focusedPayableId) {
    const match = payables.value.find((p) => p.id === props.focusedPayableId)
    if (match) return match
  }
  return payables.value[0] ?? null
})

/** Computed "Payable" amount at the order level — same formula as
 *  the listing screen: gross total − discount + platform fee. */
const orderPayableAmount = computed(() => {
  if (!order.value) return 0
  return order.value.totalAmount - order.value.discountAmount + order.value.platformFeeAmount
})

/** Statement descriptor used inside the modal's line-item rows.
 *  Mirrors the listing screen's mapping so the same payable reads
 *  identically wherever it appears. */
function statementDescriptor(payable: AssociationPayable): string {
  switch (payable.relatedEntityType) {
    case 'association_team': return 'Team Association Registration'
    case 'event_joined_team': return 'Team Event Participation'
    default: return payable.description
  }
}

// ── Actions: record manual payment / send Stripe link ─────────────
const stripeConnected = computed(() => currentAssociation.value?.stripeConnected !== false)
const hasBalance = computed(() =>
  !!order.value && order.value.balanceAmount > 0 &&
  order.value.status !== 'cancelled' && order.value.status !== 'refunded'
)

// Per-type rail policy. A registration payable (association_team) is governed
// by the team reg-settings rails; other payables (e.g. event participation)
// aren't governed here, so both rails stay available.
const typeSetting = computed<RegistrationSetting | null>(() => {
  if (summaryPayable.value?.relatedEntityType !== 'association_team') return null
  return regSettings.value.find((s) => s.registrationType === 'team') ?? null
})
const typeAllowsOffline = computed(() => typeSetting.value?.allowOfflinePayment !== false)
const typeAllowsCard = computed(() => typeSetting.value?.allowCardPayment !== false)
// Offline = manual record (cash/cheque/…); card = Stripe payment link.
const canRecordOffline = computed(() => hasBalance.value && typeAllowsOffline.value)
const canSendLink = computed(() => hasBalance.value && stripeConnected.value && typeAllowsCard.value)

const showRecordForm = ref(false)
const payMethod = ref<'cash' | 'check' | 'bank_transfer' | 'other'>('cash')
const payAmount = ref('')
const payDate = ref('')
const payReference = ref('')
const payNotes = ref('')
const recordAttempted = ref(false)
const recording = ref(false)
const sendingLink = ref(false)
function todayIso(): string { return new Date().toISOString().slice(0, 10) }

// Reset the action UI whenever a different order loads.
watch(order, (o) => {
  showRecordForm.value = false
  recordAttempted.value = false
  payMethod.value = 'cash'
  payAmount.value = o ? o.balanceAmount.toFixed(2) : ''
  payDate.value = todayIso()
  payReference.value = ''
  payNotes.value = ''
})

function openRecordForm() {
  if (order.value) payAmount.value = order.value.balanceAmount.toFixed(2)
  payDate.value = todayIso()
  recordAttempted.value = false
  showRecordForm.value = true
}
function onAmountInput(raw: string) { payAmount.value = limitTwoDecimals(raw) }

// No partial payments — the amount must equal the outstanding balance.
const amountInvalid = computed(() => {
  if (!recordAttempted.value || !order.value) return false
  const n = Number(payAmount.value)
  return !(n > 0) || Math.abs(n - order.value.balanceAmount) > 0.001
})

async function recordPayment() {
  recordAttempted.value = true
  if (!order.value || !props.paymentOrderId || amountInvalid.value) return
  recording.value = true
  try {
    const result = await recordTeamPayment(props.associationShortName, props.teamId, props.paymentOrderId, {
      method: methodLabel2(payMethod.value),
      amount: Number(payAmount.value),
      paidAt: payDate.value,
      reference: payReference.value.trim() || undefined,
      notes: payNotes.value.trim() || undefined
    })
    if (result) { order.value = result.order; payables.value = result.payables }
    showRecordForm.value = false
    emit('updated')
    pushToast({ tone: 'success', title: 'Payment recorded', message: 'The order was updated.' })
  } catch (error) {
    pushToast({ tone: 'warning', title: 'Could not record payment', message: error instanceof Error ? error.message : 'Please try again.' })
  } finally {
    recording.value = false
  }
}

async function sendLink() {
  if (!order.value || !props.paymentOrderId) return
  sendingLink.value = true
  try {
    const result = await sendTeamPaymentLink(props.associationShortName, props.teamId, props.paymentOrderId)
    if (result) { order.value = result.order; payables.value = result.payables }
    emit('updated')
    pushToast({ tone: 'success', title: 'Payment link sent', message: 'The team manager was emailed a payment link.' })
  } catch (error) {
    pushToast({ tone: 'warning', title: 'Could not send link', message: error instanceof Error ? error.message : 'Please try again.' })
  } finally {
    sendingLink.value = false
  }
}

/** Human label for the chosen offline method (recorded on the transaction). */
function methodLabel2(m: string): string {
  switch (m) {
    case 'cash': return 'Cash'
    case 'check': return 'Check'
    case 'bank_transfer': return 'Bank transfer'
    default: return 'Other'
  }
}
</script>

<template>
  <SlideModal
    :model-value="modelValue"
    :title="title"
    @update:modelValue="emit('update:modelValue', $event)"
  >
    <!-- Custom header: eyebrow (descriptor) + status badge on one line, then
         the event-name title below. Shows a shimmer while the order loads. -->
    <template #title-block>
      <span v-if="loading" class="shimmer-block payment-transactions__skeleton-title"></span>
      <template v-else>
        <span class="payment-transactions__header-eyebrow-row">
          <span v-if="headerEyebrow" class="slide-modal-panel__eyebrow">{{ headerEyebrow }}</span>
          <StatusBadge
            v-if="summaryPayable"
            :label="completionLabel(summaryPayable.paymentCompletionStatus)"
            :tone="completionTone(summaryPayable.paymentCompletionStatus)"
          />
        </span>
        <h2 class="slide-modal-panel__title">{{ title }}</h2>
      </template>
    </template>
    <!-- Shimmer skeleton — mirrors the real body layout (line
         items, summary card, transaction ledger) so the modal
         doesn't pop in awkwardly when data resolves. -->
    <div v-if="loading" class="payment-transactions__body payment-transactions__skeleton">
      <span class="shimmer-block payment-transactions__skeleton-heading"></span>
      <div class="payment-transactions__skeleton-line-items">
        <div
          v-for="i in 2"
          :key="`line-skel-${i}`"
          class="payment-transactions__skeleton-line-item"
        >
          <div class="payment-transactions__skeleton-line-main">
            <span class="shimmer-block payment-transactions__skeleton-line-title"></span>
            <span class="shimmer-block payment-transactions__skeleton-line-meta"></span>
          </div>
          <div class="payment-transactions__skeleton-line-side">
            <span class="shimmer-block payment-transactions__skeleton-line-amount"></span>
            <span class="shimmer-block payment-transactions__skeleton-line-badge"></span>
          </div>
        </div>
      </div>

      <span class="shimmer-block payment-transactions__skeleton-heading"></span>
      <div class="payment-transactions__skeleton-summary">
        <span
          v-for="i in 6"
          :key="`sum-skel-${i}`"
          class="shimmer-block payment-transactions__skeleton-summary-row"
        ></span>
      </div>

      <span class="shimmer-block payment-transactions__skeleton-heading"></span>
      <div class="payment-transactions__skeleton-tx-list">
        <span
          v-for="i in 2"
          :key="`tx-skel-${i}`"
          class="shimmer-block payment-transactions__skeleton-tx-row"
        ></span>
      </div>
    </div>

    <div v-else-if="!order" class="payment-transactions__empty">
      Could not load this payment order.
    </div>

    <div v-else class="payment-transactions__body">
      <!-- Payment summary — the focused payable's
           `paymentCompletionStatus` drives the headline badge
           (Pending / Partially Paid / Paid), keeping the modal
           summary aligned with the listing screen's badge
           palette. The richer `payable.status` enum is only used
           inside the line-item rows below. -->
      <article class="payment-transactions__summary">
        <!-- Top bar — collection actions on the left, the outstanding balance
             on the right (the headline figure). -->
        <div class="payment-transactions__bar">
          <div class="payment-transactions__bar-actions">
            <button v-if="!showRecordForm && canRecordOffline" class="primary-button" type="button" @click="openRecordForm">Record payment</button>
            <button v-if="!showRecordForm && canSendLink" class="secondary-button" type="button" :disabled="sendingLink" @click="sendLink">
              <span v-if="sendingLink" class="btn-spinner" aria-hidden="true"></span>
              {{ sendingLink ? 'Sending…' : 'Send payment link' }}
            </button>
          </div>
          <div class="payment-transactions__bar-balance">
            <span class="payment-transactions__bar-balance-label">Balance</span>
            <strong class="payment-transactions__bar-balance-amount">{{ formatCurrency(order.balanceAmount) }}</strong>
          </div>
        </div>

        <div v-if="showRecordForm" class="payment-transactions__record-form">
            <h3 class="payment-transactions__heading">Record payment</h3>
            <div class="floating-input">
              <select id="pt-method" v-model="payMethod" class="floating-input__control floating-input__control--select">
                <option value="cash">Cash</option>
                <option value="check">Check</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="other">Other</option>
              </select>
              <label for="pt-method" class="floating-input__label floating-input__label--floated">Payment method</label>
            </div>
            <div class="floating-input" :class="{ 'floating-input--invalid': amountInvalid }">
              <input id="pt-amount" type="text" inputmode="decimal" :value="payAmount"
                     class="floating-input__control" :class="{ 'floating-input__control--has-value': !!payAmount }"
                     placeholder=" " @input="onAmountInput(($event.target as HTMLInputElement).value)" />
              <label for="pt-amount" class="floating-input__label">Amount</label>
              <span v-if="amountInvalid" class="floating-input__error-corner">Full balance</span>
            </div>
            <DateTimePicker v-model="payDate" :date-only="true" :max-date="todayIso()" id="pt-paid-date" label="Date paid" />
            <div class="floating-input">
              <input id="pt-ref" v-model="payReference" type="text" maxlength="100" class="floating-input__control"
                     :class="{ 'floating-input__control--has-value': !!payReference }" placeholder=" " />
              <label for="pt-ref" class="floating-input__label">Reference # (optional)</label>
            </div>
            <div class="floating-input">
              <textarea id="pt-notes" v-model="payNotes" rows="2" class="floating-input__control"
                        :class="{ 'floating-input__control--has-value': !!payNotes }" placeholder=" "></textarea>
              <label for="pt-notes" class="floating-input__label">Notes (optional)</label>
            </div>
            <div class="payment-transactions__record-actions">
              <button class="secondary-button" type="button" :disabled="recording" @click="showRecordForm = false">Cancel</button>
              <button class="primary-button" type="button" :disabled="recording" @click="recordPayment">
                <span v-if="recording" class="btn-spinner" aria-hidden="true"></span>
                {{ recording ? 'Saving…' : 'Save payment' }}
              </button>
            </div>
        </div>

        <!-- Detail rows (zebra-striped). PO# + dates, then the financial
             breakdown. Status now lives in the header next to the eyebrow. -->
        <div class="payment-transactions__rows">
          <div class="payment-transactions__summary-row">
            <span class="payment-transactions__summary-label">Payment Order #</span>
            <span>{{ order.orderNumber }}</span>
          </div>
          <div class="payment-transactions__summary-row">
            <span class="payment-transactions__summary-label">Created</span>
            <span>{{ formatDateTime(order.createdAt) }}</span>
          </div>
          <div v-if="order.paidAt" class="payment-transactions__summary-row">
            <span class="payment-transactions__summary-label">Paid at</span>
            <span>{{ formatDateTime(order.paidAt) }}</span>
          </div>
          <div class="payment-transactions__summary-row">
            <span class="payment-transactions__summary-label">Total</span>
            <span>{{ formatCurrency(order.totalAmount) }}</span>
          </div>
          <div class="payment-transactions__summary-row">
            <span class="payment-transactions__summary-label">Discount</span>
            <span>{{ formatCurrency(order.discountAmount) }}</span>
          </div>
          <div class="payment-transactions__summary-row">
            <span class="payment-transactions__summary-label">Platform fee</span>
            <span>{{ formatCurrency(order.platformFeeAmount) }}</span>
          </div>
          <div class="payment-transactions__summary-row">
            <span class="payment-transactions__summary-label">Payable</span>
            <strong>{{ formatCurrency(orderPayableAmount) }}</strong>
          </div>
          <div class="payment-transactions__summary-row">
            <span class="payment-transactions__summary-label">Paid</span>
            <span>{{ formatCurrency(order.paidAmount) }}</span>
          </div>
        </div>
      </article>

      <!-- Transaction ledger -->
      <h3 class="payment-transactions__heading">Transaction history</h3>

      <div v-if="order.transactions.length === 0" class="payment-transactions__empty">
        No transactions yet — this order is fully outstanding.
      </div>

      <ul v-else class="payment-transactions__list">
        <li
          v-for="tx in order.transactions"
          :key="tx.id"
          class="payment-transactions__row"
        >
          <div class="payment-transactions__row-meta">
            <strong class="payment-transactions__row-amount">{{ formatCurrency(tx.amount) }}</strong>
            <span class="payment-transactions__row-method">{{ tx.method }}</span>
          </div>
          <div class="payment-transactions__row-side">
            <span class="payment-transactions__row-date">{{ formatDate(tx.paidAt) }}</span>
            <span class="payment-transactions__row-reference">Ref: {{ tx.reference }}</span>
          </div>
        </li>
      </ul>
    </div>
  </SlideModal>
</template>
