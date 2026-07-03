<script setup lang="ts">
// RegistrationSettingsModal
// -------------------------
// Slide-in popup where an association configures registration per TYPE —
// team / umpire / player — each on its own top pill tab: self-registration
// on/off, whether a fee applies (+ the fee), and the default validity granted
// on activation (never-expires, or N days). All three are saved together in
// one Save. Backed by `src/api/associationRegSettings.ts`.
//
// Reuses the shared controls/rules — `ToggleSwitch`, the `floating-input`
// pattern, and the centralized 2-decimal money clamp (`src/lib/money.ts`) —
// rather than re-implementing them here.

import { computed, ref, watch } from 'vue'
import SlideModal from './SlideModal.vue'
import ToggleSwitch from './ToggleSwitch.vue'
import { limitTwoDecimals } from '../lib/money'
import { currentAssociation } from '../constants/associations'
import {
  fetchRegistrationSettings,
  updateRegistrationSettings
} from '../api/associationRegSettings'
import { pushToast } from '../toast-center'
import type { RegistrationEntityType, RegistrationSetting } from '../types'

const props = withDefaults(defineProps<{
  modelValue: boolean
  associationId?: string
  associationShortName?: string
}>(), { associationId: '', associationShortName: '' })

const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()

// Tab order as the admin reads them (team → umpire → player).
const TAB_ORDER: RegistrationEntityType[] = ['team', 'umpire', 'player']
const TYPE_LABELS: Record<RegistrationEntityType, string> = {
  team: 'Team',
  umpire: 'Umpire',
  player: 'Player'
}

// Editing shape keeps the money / duration fields as STRINGS while typing
// (same approach as the event form) — avoids number-input cursor glitches and
// lets the 2-decimal clamp apply cleanly. Converted to numbers on save.
interface EditSetting {
  registrationType: RegistrationEntityType
  allowSelfRegistration: boolean
  paymentApplicable: boolean
  applicableFee: string
  allowCardPayment: boolean
  allowOfflinePayment: boolean
  neverExpires: boolean
  durationDays: string
}

function toEdit(s: RegistrationSetting): EditSetting {
  return {
    registrationType: s.registrationType,
    allowSelfRegistration: s.allowSelfRegistration,
    paymentApplicable: s.paymentApplicable,
    applicableFee: s.applicableFee != null ? String(s.applicableFee) : '',
    allowCardPayment: s.allowCardPayment !== false,
    allowOfflinePayment: s.allowOfflinePayment !== false,
    neverExpires: s.neverExpires,
    durationDays: s.durationDays != null ? String(s.durationDays) : ''
  }
}
function toModel(e: EditSetting): RegistrationSetting {
  return {
    registrationType: e.registrationType,
    allowSelfRegistration: e.allowSelfRegistration,
    paymentApplicable: e.paymentApplicable,
    applicableFee: e.paymentApplicable && e.applicableFee.trim() !== '' ? Number(e.applicableFee) : null,
    // Card requires Stripe; when it's not connected we never persist card as an
    // allowed rail (mirrors the event form forcing the toggle off).
    allowCardPayment: e.paymentApplicable ? (e.allowCardPayment && stripeConnected.value) : true,
    allowOfflinePayment: e.paymentApplicable ? e.allowOfflinePayment : true,
    neverExpires: e.neverExpires,
    durationDays: !e.neverExpires && e.durationDays.trim() !== '' ? Number(e.durationDays) : null
  }
}

const settings = ref<EditSetting[]>([])
const activeType = ref<RegistrationEntityType>('team')
const loading = ref(false)
const saving = ref(false)
const showErrors = ref(false)

const current = computed<EditSetting | null>(
  () => settings.value.find((s) => s.registrationType === activeType.value) ?? null
)
const eyebrow = computed(() => (props.associationShortName || '').toUpperCase())

// Subtitle names the association directly ("…register with Acme League.")
// instead of the generic "your association"; falls back when the name
// hasn't loaded yet.
const subtitle = computed(
  () =>
    `Configure how teams, umpires and players register with ${
      currentAssociation.value?.associationName || 'your association'
    }.`
)
// Stripe state (only `false` flags as not-connected; absent = assume ok).
const stripeConnected = computed(() => currentAssociation.value?.stripeConnected !== false)

async function load() {
  if (!props.associationId) { settings.value = []; return }
  loading.value = true
  showErrors.value = false
  activeType.value = 'team'
  try {
    const rows = await fetchRegistrationSettings({ associationId: props.associationId })
    settings.value = rows.map(toEdit)
    // Card can't be a rail without Stripe — reflect that in the toggle state
    // so an admin never sees "card on" while it's actually uncollectable.
    if (!stripeConnected.value) {
      settings.value.forEach((s) => { s.allowCardPayment = false })
    }
  } catch {
    settings.value = []
  } finally {
    loading.value = false
  }
}

watch(() => props.modelValue, (open) => { if (open) void load() })

// ── Field edits ──
// Sync the input element's own value (not just the model) so the clamp sticks
// even when the clamped result equals the previous model value — otherwise Vue
// skips the DOM patch and the rejected character stays visible. Mirrors the
// event form's fee input.
function onFeeInput(event: Event) {
  const el = event.target as HTMLInputElement
  const v = limitTwoDecimals(el.value)
  if (v !== el.value) el.value = v
  if (current.value) current.value.applicableFee = v
}
function onDurationInput(event: Event) {
  const el = event.target as HTMLInputElement
  const v = el.value.replace(/[^0-9]/g, '')
  if (v !== el.value) el.value = v
  if (current.value) current.value.durationDays = v
}

// ── Validation (across all tabs — Save commits all three) ──
function feeInvalid(s: EditSetting): boolean {
  return s.paymentApplicable && !(Number(s.applicableFee) > 0)
}
function durationInvalid(s: EditSetting): boolean {
  const n = Number(s.durationDays)
  return !s.neverExpires && !(Number.isInteger(n) && n >= 1)
}
// A paid type must keep at least one usable rail. Card only counts as a rail
// when Stripe is connected (else it can't actually collect).
function methodInvalid(s: EditSetting): boolean {
  if (!s.paymentApplicable) return false
  const cardUsable = s.allowCardPayment && stripeConnected.value
  return !cardUsable && !s.allowOfflinePayment
}
const invalidTypes = computed(() =>
  settings.value
    .filter((s) => feeInvalid(s) || durationInvalid(s) || methodInvalid(s))
    .map((s) => s.registrationType)
)
const feeError = computed(() => showErrors.value && !!current.value && feeInvalid(current.value))
const durationError = computed(() => showErrors.value && !!current.value && durationInvalid(current.value))
const methodError = computed(() => showErrors.value && !!current.value && methodInvalid(current.value))

function close() {
  if (saving.value) return
  emit('update:modelValue', false)
}

async function save() {
  showErrors.value = true
  if (invalidTypes.value.length) {
    // Jump to the first tab with an error so it's visible.
    activeType.value = invalidTypes.value[0]
    return
  }
  saving.value = true
  try {
    const saved = await updateRegistrationSettings(props.associationId, settings.value.map(toModel))
    settings.value = saved.map(toEdit)
    emit('update:modelValue', false)
    pushToast({ tone: 'success', title: 'Registration settings saved', message: 'Team, umpire and player settings were updated.' })
  } catch (error) {
    pushToast({ tone: 'warning', title: 'Could not save settings', message: error instanceof Error ? error.message : 'Please try again.' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <SlideModal
    :model-value="modelValue"
    title="Registration Settings"
    :eyebrow="eyebrow"
    :subtitle="subtitle"
    size="default"
    flush-body
    @update:model-value="(v) => emit('update:modelValue', v)"
  >
    <div class="mg-regset">
      <!-- Top pill tabs — one per registration type (left-aligned). -->
      <div class="mg-regset__tabs" role="tablist" aria-label="Registration type">
        <button
          v-for="t in TAB_ORDER"
          :key="t"
          type="button"
          role="tab"
          class="mg-regset__tab"
          :class="{
            'mg-regset__tab--active': activeType === t,
            'mg-regset__tab--flagged': showErrors && invalidTypes.includes(t)
          }"
          :aria-selected="activeType === t"
          @click="activeType = t"
        >{{ TYPE_LABELS[t] }}</button>
      </div>

      <div class="mg-regset__body">
        <!-- Stripe-not-connected notice. Unlike the event form this is NOT a
             hard block: a fee can still be required and collected manually
             (cash / cheque); only ONLINE card payments + payment links need
             Stripe. -->
        <div v-if="!stripeConnected" class="app-banner app-banner--warning mg-regset__banner">
          <div class="app-banner__text">
            <strong class="app-banner__title">Stripe isn't connected</strong>
            <span class="app-banner__sub">You can still require a fee and record manual payments (cash, cheque, etc.). To collect online card payments or send payment links, connect Stripe in Settings → Stripe Connect.</span>
          </div>
        </div>

        <!-- Loading shimmer -->
        <div v-if="loading" class="mg-regset__section" aria-hidden="true">
          <div class="shimmer-block mg-regset__sk-row"></div>
          <div class="shimmer-block mg-regset__sk-row"></div>
          <div class="shimmer-block mg-regset__sk-row"></div>
        </div>

        <div v-else-if="current" class="mg-regset__section">
          <!-- 1. Self Registration — heading + a container holding the toggle. -->
          <div class="mg-regset__group">
            <h3 class="mg-regset__subhead">Self Registration</h3>
            <div class="mg-regset__panel">
              <label class="mg-regset__row mg-regset__panel-head">
                <span class="mg-regset__row-copy">
                  <strong>Allow self-registration</strong>
                  <span class="mg-regset__hint">Let the {{ TYPE_LABELS[activeType].toLowerCase() }} register directly from the {{ currentAssociation?.shortName || 'association' }} profile page.</span>
                </span>
                <ToggleSwitch v-model="current.allowSelfRegistration" :aria-label="`Allow self-registration for ${TYPE_LABELS[activeType]}`" />
              </label>
            </div>
          </div>

          <!-- 2. Registration Fees — accordion: the toggle is the header; when on
               the fee + accepted rails expand as the panel body. Card needs Stripe
               (disabled + banner above when absent); offline off funnels through
               Stripe. -->
          <div class="mg-regset__group">
            <h3 class="mg-regset__subhead">Registration Fees</h3>
            <div class="mg-regset__panel" :class="{ 'mg-regset__panel--open': current.paymentApplicable }">
              <label class="mg-regset__row mg-regset__panel-head">
                <span class="mg-regset__row-copy">
                  <strong>Collect registration fee</strong>
                  <span class="mg-regset__hint">Charge a fee to register a {{ TYPE_LABELS[activeType].toLowerCase() }}.</span>
                </span>
                <ToggleSwitch v-model="current.paymentApplicable" :aria-label="`Collect registration fee for ${TYPE_LABELS[activeType]}`" />
              </label>
              <div v-if="current.paymentApplicable" class="mg-regset__panel-body">
                <div class="floating-input" :class="{ 'floating-input--invalid': feeError }">
                  <input
                    id="regset-fee"
                    type="text"
                    inputmode="decimal"
                    class="floating-input__control"
                    :class="{ 'floating-input__control--has-value': !!current.applicableFee }"
                    :value="current.applicableFee"
                    placeholder=" "
                    @input="onFeeInput($event)"
                  />
                  <label for="regset-fee" class="floating-input__label">Registration fee ($)</label>
                  <span v-if="feeError" class="floating-input__error-corner">Required</span>
                </div>
                <label class="mg-regset__row">
                  <span class="mg-regset__row-copy">
                    <strong>Allow credit card payments</strong>
                    <span class="mg-regset__hint">Collect the fee online by card via Stripe.</span>
                  </span>
                  <ToggleSwitch v-model="current.allowCardPayment" :disabled="!stripeConnected" :aria-label="`Allow card payments for ${TYPE_LABELS[activeType]}`" />
                </label>
                <label class="mg-regset__row">
                  <span class="mg-regset__row-copy">
                    <strong>Allow offline payments</strong>
                    <span class="mg-regset__hint">Let an admin record manual payments. Turn off to require online card payment only.</span>
                  </span>
                  <ToggleSwitch v-model="current.allowOfflinePayment" :aria-label="`Allow offline payments for ${TYPE_LABELS[activeType]}`" />
                </label>
                <span v-if="methodError" class="mg-regset__methods-error">Enable at least one payment method.</span>
              </div>
            </div>
          </div>

          <!-- 3. Validity — accordion: never-expires toggle as header; when off,
               the duration field expands as the body. -->
          <div class="mg-regset__group">
            <h3 class="mg-regset__subhead">Validity</h3>
            <div class="mg-regset__panel" :class="{ 'mg-regset__panel--open': !current.neverExpires }">
              <label class="mg-regset__row mg-regset__panel-head">
                <span class="mg-regset__row-copy">
                  <strong>Never expires</strong>
                  <span class="mg-regset__hint">Registrations stay valid until an admin changes them.</span>
                </span>
                <ToggleSwitch v-model="current.neverExpires" :aria-label="`Never expires for ${TYPE_LABELS[activeType]}`" />
              </label>
              <div v-if="!current.neverExpires" class="mg-regset__panel-body">
                <div class="floating-input" :class="{ 'floating-input--invalid': durationError }">
                  <input
                    id="regset-duration"
                    type="text"
                    inputmode="numeric"
                    class="floating-input__control"
                    :class="{ 'floating-input__control--has-value': !!current.durationDays }"
                    :value="current.durationDays"
                    placeholder=" "
                    @input="onDurationInput($event)"
                  />
                  <label for="regset-duration" class="floating-input__label">Valid for (days)</label>
                  <span v-if="durationError" class="floating-input__error-corner">Required</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <button class="secondary-button" type="button" :disabled="saving" @click="close">Cancel</button>
      <span class="mg-regset__foot-spacer"></span>
      <button class="primary-button" type="button" :disabled="saving || loading" @click="save">
        <span v-if="saving" class="btn-spinner" aria-hidden="true"></span>
        {{ saving ? 'Saving…' : 'Save settings' }}
      </button>
    </template>
  </SlideModal>
</template>

<style scoped>
.slide-modal-panel__footer .primary-button { background: var(--primary); }
.mg-regset { display: flex; flex-direction: column; min-height: 100%; }

/* Top pill tabs (one per registration type) — content-sized + left-aligned. */
.mg-regset__tabs {
  display: flex;
  gap: 8px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-divider);
  background: var(--white);
  flex: 0 0 auto;
}
.mg-regset__tab {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  padding: 0 16px;
  min-height: 36px;
  background: var(--white);
  border: 1px solid var(--border-divider);
  border-radius: 999px;
  cursor: pointer;
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}
.mg-regset__tab:hover:not(.mg-regset__tab--active) { background: rgba(45, 140, 240, 0.06); }
.mg-regset__tab--active { background: var(--primary, #2d8cf0); border-color: var(--primary, #2d8cf0); color: #fff; }
.mg-regset__tab--flagged:not(.mg-regset__tab--active) { border-color: var(--danger, #d64545); color: var(--danger, #d64545); }
/* Dark mode — match the scheduler / team-details pills: card surface inactive,
   primary outline active. */
html.dark-mode .mg-regset__tabs { background: var(--surface-card); }
html.dark-mode .mg-regset__tab { background: var(--surface-card); }
html.dark-mode .mg-regset__tab--active {
  background: var(--surface-card);
  border-color: var(--primary);
  color: var(--primary);
}

.mg-regset__body { padding: 18px 16px 8px; }
.mg-regset__banner { margin-bottom: 16px; }
.mg-regset__section { display: flex; flex-direction: column; gap: 24px; }
/* Section group + wizard-style subhead (primary bar on the left). */
.mg-regset__group { display: flex; flex-direction: column; gap: 16px; }
.mg-regset__subhead {
  margin: 0;
  padding-left: 10px;
  border-left: 3px solid var(--primary, #2d8cf0);
  font-family: var(--font-body);
  font-size: 1rem;
  font-weight: 500;
  color: var(--text);
  line-height: 1.2;
}
.mg-regset__row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.mg-regset__row-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.mg-regset__hint { font-size: 13px; color: var(--secondary); }
/* Per-section container. Collapsed it's a simple bordered card holding the
   header row; expanded (accordion) the header gains a divider and the body
   drops to a tinted inset surface. */
.mg-regset__panel {
  border: 1px solid var(--border-divider);
  border-radius: 10px;
  background: var(--surface-card);
  overflow: hidden;
}
.mg-regset__panel-head { padding: 14px 16px; }
.mg-regset__panel--open .mg-regset__panel-head { border-bottom: 1px solid var(--border-divider); }
.mg-regset__panel-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  /* Inset-panel surface used for nested sections across the app — a visible
     pale blue-grey in light, lifted slate in dark. */
  background: var(--surface-raised);
}
.mg-regset__methods-error { font-size: 13px; color: var(--danger, #d64545); }
.mg-regset__sk-row { height: 44px; border-radius: 10px; }
.mg-regset__foot-spacer { flex: 1 1 auto; }
</style>
