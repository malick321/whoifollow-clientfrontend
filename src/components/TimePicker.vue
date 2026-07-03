<script setup lang="ts">
// TimePicker
// ----------
// Floating-input-styled, fully in-app time control. The trigger shows the
// selected time in the app's 12-hour format ("8:00 AM") — or just the
// floating label when empty (no native placeholder) — and opens a small
// popover with the shared TimeSelectRow (hour / minute / AM·PM dropdowns).
// Reuses the `date-range-picker__popover` chrome so it matches the event
// date-range + datetime pickers. Value moves as a 24-hour `HH:mm` string.

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import TimeSelectRow from './TimeSelectRow.vue'

const props = withDefaults(defineProps<{
  modelValue: string
  label: string
  id?: string
  invalid?: boolean
}>(), { id: '', invalid: false })

const emit = defineEmits<{ (event: 'update:modelValue', value: string): void }>()

const open = ref(false)
const wrapperRef = ref<HTMLElement | null>(null)
const hasValue = computed(() => !!props.modelValue)

const displayText = computed(() => {
  const m = props.modelValue.match(/^(\d{2}):(\d{2})$/)
  if (!m) return ''
  const d = new Date(2000, 0, 1, Number(m[1]), Number(m[2]))
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
})

function toggle() { open.value = !open.value }
function close() { open.value = false }

function onDocMouseDown(event: MouseEvent) {
  if (open.value && wrapperRef.value && !wrapperRef.value.contains(event.target as Node)) close()
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) { event.stopPropagation(); close() }
}
onMounted(() => {
  document.addEventListener('mousedown', onDocMouseDown)
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMouseDown)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="wrapperRef" class="floating-input themed-pick themed-pick--time" :class="{ 'floating-input--invalid': invalid }">
    <button
      type="button"
      class="floating-input__control themed-pick__control"
      :class="{ 'floating-input__control--has-value': hasValue }"
      :aria-label="label"
      :aria-expanded="open ? 'true' : 'false'"
      @click="toggle"
    >{{ displayText }}</button>
    <label class="floating-input__label" :class="{ 'floating-input__label--floated': hasValue }">{{ label }}</label>
    <span v-if="invalid" class="floating-input__error-corner">Required</span>

    <div v-if="open" class="date-range-picker__popover themed-pick__popover" role="dialog" aria-label="Choose a time">
      <TimeSelectRow :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)" />
    </div>
  </div>
</template>

<style scoped>
.themed-pick { position: relative; }
.themed-pick__control {
  width: 100%;
  text-align: left;
  cursor: pointer;
  padding-right: 38px;
}
/* Label + icon overlay the trigger — clicks fall through to the button so
   the whole field opens the popover. */
.themed-pick .floating-input__label { pointer-events: none; }
.themed-pick::after {
  content: '';
  position: absolute;
  top: 50%;
  right: 14px;
  transform: translateY(-50%);
  width: 18px;
  height: 18px;
  pointer-events: none;
  background-color: var(--text);
  -webkit-mask: url('../assets/time.svg') center / contain no-repeat;
  mask: url('../assets/time.svg') center / contain no-repeat;
}
.themed-pick__popover { width: 248px; }
</style>
