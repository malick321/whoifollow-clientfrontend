<script setup lang="ts">
// ToggleSwitch
// ------------
// Reusable pill-style switch (off → grey track + left knob; on → primary
// green track + right knob). Renders a <button role="switch"> so screen
// readers report state via aria-checked. Click flips the value via
// `update:modelValue`.
//
// Two ways to use it:
//   1. Standalone control with its own label:
//      <ToggleSwitch v-model="hotelOn" label="Hotel" />
//
//   2. Wrapped inside a custom row where the parent provides the label
//      and uses the default slot for any extra content:
//      <div class="my-row">
//        <span>Hotel</span>
//        <ToggleSwitch v-model="hotelOn" />
//      </div>
//
// Visual rules live in src/styles.css under `.toggle-switch*`.

defineProps<{
  modelValue: boolean
  label?: string
  disabled?: boolean
  /** Optional aria-label to use when no visible `label` is provided. */
  ariaLabel?: string
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
}>()

function onClick(value: boolean) {
  emit('update:modelValue', !value)
}
</script>

<template>
  <button
    type="button"
    role="switch"
    class="toggle-switch"
    :class="{
      'toggle-switch--on': modelValue,
      'toggle-switch--off': !modelValue,
      'toggle-switch--disabled': disabled
    }"
    :aria-checked="modelValue ? 'true' : 'false'"
    :aria-label="!label ? (ariaLabel ?? 'Toggle') : undefined"
    :disabled="disabled"
    @click="onClick(modelValue)"
  >
    <span v-if="label" class="toggle-switch__label">{{ label }}</span>
    <span class="toggle-switch__track" aria-hidden="true">
      <span class="toggle-switch__knob"></span>
    </span>
  </button>
</template>
