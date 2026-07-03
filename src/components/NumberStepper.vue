<script setup lang="ts">
// NumberStepper
// -------------
// Compact +/− stepper for small integer inputs (adult count, room count,
// etc.). Buttons clamp to `min` and `max`; the value is displayed in the
// middle as plain text (NOT an editable input — the design we're matching
// uses big, readable digits with no caret affordance, see screenshot in
// the travel-info form).
//
// Usage:
//   <NumberStepper v-model="adults" :min="1" :max="20" />
//
// Visual rules live in src/styles.css under `.number-stepper*`.

const props = withDefaults(defineProps<{
  modelValue: number
  min?: number
  max?: number
  disabled?: boolean
  /** Optional aria-label for screen readers. */
  ariaLabel?: string
}>(), {
  min: 1,
  max: 99,
  disabled: false
})

const emit = defineEmits<{
  (event: 'update:modelValue', value: number): void
}>()

function step(delta: number) {
  if (props.disabled) return
  const next = (props.modelValue || 0) + delta
  if (next < props.min || next > props.max) return
  emit('update:modelValue', next)
}
</script>

<template>
  <div
    class="number-stepper"
    :class="{ 'number-stepper--disabled': disabled }"
    :aria-label="ariaLabel"
    role="group"
  >
    <button
      type="button"
      class="number-stepper__btn number-stepper__btn--minus"
      :disabled="disabled || modelValue <= min"
      aria-label="Decrease"
      @click="step(-1)"
    >−</button>
    <span class="number-stepper__value" aria-live="polite">{{ modelValue }}</span>
    <button
      type="button"
      class="number-stepper__btn number-stepper__btn--plus"
      :disabled="disabled || modelValue >= max"
      aria-label="Increase"
      @click="step(1)"
    >+</button>
  </div>
</template>
