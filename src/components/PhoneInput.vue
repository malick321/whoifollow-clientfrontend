<script setup lang="ts">
// PhoneInput
// ----------
// Reusable phone control used everywhere a phone number is captured. A country
// picker (flag + dial code) sits beside a masked national-number input. The
// mask comes from the selected country (see `phoneCountries.ts`), so adding a
// region is a one-row catalogue change that reflects in every consumer.
//
// Storage stays SEPARATE + UNMASKED: two v-models — `dialCode` ("+1") and
// `number` (raw national digits). The mask is display-only; on input we strip
// to digits, on hydrate we re-mask. Derive E.164 elsewhere if a caller needs it.

import { computed, ref, watch } from 'vue'
import {
  COUNTRY_PHONE_CATALOGUE,
  DEFAULT_PHONE_COUNTRY,
  applyPhoneMask,
  digitsOnly,
  flagUrl,
  phoneCountryByIso,
  phoneCountryForDialCode
} from '../constants/phoneCountries'

const props = withDefaults(defineProps<{
  /** v-model:dialCode — the country dial code, e.g. "+1". */
  dialCode?: string
  /** v-model:number — the raw national digits (no formatting). */
  number?: string
  numberLabel?: string
  invalid?: boolean
  disabled?: boolean
  id?: string
}>(), {
  dialCode: '+1',
  number: '',
  numberLabel: 'Number',
  invalid: false,
  disabled: false,
  id: 'phone'
})

const emit = defineEmits<{
  (e: 'update:dialCode', value: string): void
  (e: 'update:number', value: string): void
}>()

const selectedIso = ref(phoneCountryForDialCode(props.dialCode).iso)
const selectedCountry = computed(() => phoneCountryByIso(selectedIso.value))

// External dial-code changes (e.g. edit hydration) re-sync the country — but
// leave it alone when the current selection already maps to that code (US/CA
// share "+1", so flipping CA → US on every hydrate would be wrong).
watch(() => props.dialCode, (dc) => {
  if (selectedCountry.value.dialCode !== dc) selectedIso.value = phoneCountryForDialCode(dc).iso
})

// Masked display derived from the raw digits + the selected country's mask.
const display = computed(() => applyPhoneMask(props.number, selectedCountry.value.mask))
const hasValue = computed(() => display.value.length > 0)

const open = ref(false)
const failedFlags = ref<Record<string, boolean>>({})

function pick(iso: string) {
  selectedIso.value = iso
  open.value = false
  const dc = phoneCountryByIso(iso).dialCode
  if (dc !== props.dialCode) emit('update:dialCode', dc)
}

function onInput(e: Event) {
  const raw = (e.target as HTMLInputElement).value
  const digits = digitsOnly(raw).slice(0, selectedCountry.value.digits)
  emit('update:number', digits)
}

const showFlag = (iso: string) => !failedFlags.value[iso]
</script>

<template>
  <div class="phone-input" :class="{ 'phone-input--disabled': disabled }">
    <!-- Country picker -->
    <div class="phone-input__country">
      <button
        type="button"
        class="phone-input__country-btn"
        :disabled="disabled"
        :aria-expanded="open"
        aria-haspopup="listbox"
        @click="open = !open"
      >
        <img
          v-if="showFlag(selectedCountry.iso)"
          class="phone-input__flag"
          :src="flagUrl(selectedCountry.iso)"
          :alt="selectedCountry.iso"
          @error="failedFlags[selectedCountry.iso] = true"
        />
        <span v-else class="phone-input__flag-fallback">{{ selectedCountry.iso }}</span>
        <span class="phone-input__dial">{{ selectedCountry.dialCode }}</span>
        <span class="phone-input__caret" aria-hidden="true"></span>
      </button>

      <template v-if="open">
        <div class="phone-input__backdrop" @click="open = false"></div>
        <ul class="phone-input__menu" role="listbox">
          <li
            v-for="c in COUNTRY_PHONE_CATALOGUE"
            :key="c.iso"
            class="phone-input__option"
            :class="{ 'phone-input__option--active': c.iso === selectedIso }"
            role="option"
            :aria-selected="c.iso === selectedIso"
            @click="pick(c.iso)"
          >
            <img
              v-if="showFlag(c.iso)"
              class="phone-input__flag"
              :src="flagUrl(c.iso)"
              :alt="c.iso"
              @error="failedFlags[c.iso] = true"
            />
            <span v-else class="phone-input__flag-fallback">{{ c.iso }}</span>
            <span class="phone-input__option-name">{{ c.name }}</span>
            <span class="phone-input__option-dial">{{ c.dialCode }}</span>
          </li>
        </ul>
      </template>
    </div>

    <!-- Masked national number -->
    <div class="floating-input phone-input__number" :class="{ 'floating-input--invalid': invalid }">
      <input
        :id="id"
        type="tel"
        inputmode="tel"
        class="floating-input__control"
        :class="{ 'floating-input__control--has-value': hasValue }"
        :value="display"
        :disabled="disabled"
        :placeholder="selectedCountry.mask"
        @input="onInput"
      />
      <label :for="id" class="floating-input__label" :class="{ 'floating-input__label--floated': hasValue }">{{ numberLabel }}</label>
    </div>
  </div>
</template>

<style scoped>
.phone-input { display: grid; grid-template-columns: auto 1fr; gap: 12px; align-items: start; }
.phone-input--disabled { opacity: 0.6; }

.phone-input__country { position: relative; }
.phone-input__country-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 48px;
  padding: 0 12px;
  border: 1px solid var(--border-divider);
  border-radius: 10px;
  background: var(--surface-card);
  color: var(--text);
  font: inherit;
  cursor: pointer;
}
.phone-input__country-btn:hover:not(:disabled) { border-color: var(--primary); }
.phone-input__country-btn:disabled { cursor: not-allowed; }
.phone-input__flag { width: 22px; height: 16px; border-radius: 2px; object-fit: cover; box-shadow: 0 0 0 1px rgba(0,0,0,0.08); }
.phone-input__flag-fallback {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 16px; border-radius: 2px; font-size: 9px; font-weight: 700;
  background: var(--surface-muted, #eef2f7); color: var(--secondary);
}
.phone-input__dial { font-size: 14px; font-weight: 600; }
.phone-input__caret {
  width: 0; height: 0; margin-left: 2px;
  border-left: 4px solid transparent; border-right: 4px solid transparent;
  border-top: 5px solid var(--secondary);
}

.phone-input__backdrop { position: fixed; inset: 0; z-index: 40; }
.phone-input__menu {
  position: absolute; z-index: 41; top: calc(100% + 4px); left: 0; min-width: 220px;
  margin: 0; padding: 4px; list-style: none;
  background: var(--surface-card); border: 1px solid var(--border-divider);
  border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.16);
}
.phone-input__option {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: 7px; cursor: pointer; font-size: 14px; color: var(--text);
}
.phone-input__option:hover { background: var(--surface-pill, var(--surface-muted)); }
.phone-input__option--active { background: var(--primary-light-3, #eef4fd); color: var(--primary); }
.phone-input__option-name { flex: 1 1 auto; }
.phone-input__option-dial { color: var(--secondary); font-weight: 600; }

@media (max-width: 520px) {
  .phone-input { grid-template-columns: 1fr; }
}
</style>
