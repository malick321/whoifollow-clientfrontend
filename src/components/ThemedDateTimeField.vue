<script setup lang="ts">
// ThemedDateTimeField
// -------------------
// A floating-input-styled date+time control that shows the SELECTED value in
// the app's display format ("Fri Apr 16, 2026 · 3:25 AM") and, when empty,
// just the floating label — never the browser's raw "mm/dd/yyyy --:--"
// placeholder. Clicking opens the native datetime picker (date + time in one
// step) via `showPicker()`, so we reuse the OS picker rather than building a
// calendar. Themed calendar icon + invalid state match the rest of the form.
//
// modelValue is the native datetime-local string `YYYY-MM-DDTHH:mm`.

import { computed, ref } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string
  label: string
  id?: string
  invalid?: boolean
  ariaLabel?: string
}>(), {
  id: '',
  invalid: false,
  ariaLabel: ''
})

const emit = defineEmits<{ (event: 'update:modelValue', value: string): void }>()

const nativeRef = ref<HTMLInputElement | null>(null)
const hasValue = computed(() => !!props.modelValue)

// 'YYYY-MM-DDTHH:mm' → "Fri Apr 16, 2026 · 3:25 AM" (matches the app's
// short-weekday date style used across the scheduler / division screens).
const displayText = computed(() => {
  const m = props.modelValue.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!m) return ''
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]))
  const date = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `${date} · ${time}`
})

function openPicker() {
  const el = nativeRef.value
  if (!el) return
  // showPicker() opens the OS date+time picker directly; fall back to focus
  // (which still surfaces the native control) where it isn't supported.
  if (typeof el.showPicker === 'function') {
    try { el.showPicker(); return } catch { /* fall through to focus */ }
  }
  el.focus()
}

function onNativeInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}
</script>

<template>
  <div class="floating-input themed-dt" :class="{ 'floating-input--invalid': invalid }">
    <!-- Visible, formatted display. A button so it's keyboard-focusable and
         opens the picker on activation. -->
    <button
      type="button"
      class="floating-input__control themed-dt__control"
      :class="{ 'floating-input__control--has-value': hasValue }"
      :aria-label="ariaLabel || label"
      @click="openPicker"
    >{{ displayText }}</button>
    <label
      :for="id || undefined"
      class="floating-input__label"
      :class="{ 'floating-input__label--floated': hasValue }"
    >{{ label }}</label>
    <span v-if="invalid" class="floating-input__error-corner">Required</span>
    <!-- Hidden native control owns the actual date+time selection. -->
    <input
      :id="id || undefined"
      ref="nativeRef"
      type="datetime-local"
      class="themed-dt__native"
      :value="modelValue"
      tabindex="-1"
      aria-hidden="true"
      @input="onNativeInput"
    />
  </div>
</template>

<style scoped>
.themed-dt { position: relative; }
/* Make the button read exactly like a floating-input text control. */
.themed-dt__control {
  width: 100%;
  text-align: left;
  cursor: pointer;
  /* Reserve room for the calendar icon on the right. */
  padding-right: 38px;
}
/* The label + icon overlay the control — let clicks fall through to the
   button so the WHOLE field opens the picker (no dead zones). */
.themed-dt .floating-input__label { pointer-events: none; }
/* The themed line calendar icon (same asset as the DateRangePicker / time
   controls), masked to the text colour. */
.themed-dt::after {
  content: '';
  position: absolute;
  top: 50%;
  right: 14px;
  transform: translateY(-50%);
  width: 18px;
  height: 18px;
  pointer-events: none;
  background-color: var(--text);
  -webkit-mask: url('../assets/calendar.svg') center / contain no-repeat;
  mask: url('../assets/calendar.svg') center / contain no-repeat;
}
/* Native picker is visually hidden but stays in the DOM so showPicker()
   has an element to open against. */
.themed-dt__native {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  border: 0;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  overflow: hidden;
}
</style>
