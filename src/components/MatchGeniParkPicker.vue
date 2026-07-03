<script setup lang="ts">
// MatchGeniParkPicker
// -------------------
// Shared park <select> used across the MatchGeni surfaces that work a
// single park at a time — Game Scheduler, Field Grid, Umpires (and
// future screens). Wraps the floating-label select + a "X fields" count
// pill (sourced from the §9 resources park.fields) pinned just left of
// the dropdown caret, with the park name ellipsized when it overflows.
//
// v-model carries the selected park id. Keeping this one component means
// the field-count affordance + ellipsis behave identically everywhere
// instead of being re-implemented per screen.

import { computed } from 'vue'
import type { SchedulerPark } from '../types'

const props = withDefaults(
  defineProps<{
    /** Selected park id (v-model). */
    modelValue: string | null
    /** Parks to choose from (from the resources payload). */
    parks: SchedulerPark[]
    /** Unique id so the floating label's `for` resolves per screen. */
    id?: string
    disabled?: boolean
    /** Show the "X fields" count pill (default on). */
    showFieldCount?: boolean
  }>(),
  { id: 'park-picker', disabled: false, showFieldCount: true }
)

const emit = defineEmits<{ (event: 'update:modelValue', value: string): void }>()

const selectedPark = computed(
  () => props.parks.find((p) => p.id === props.modelValue) ?? null
)
const fieldCount = computed(() => selectedPark.value?.fields.length ?? 0)
const showCount = computed(() => props.showFieldCount && !!selectedPark.value)

function onChange(event: Event) {
  emit('update:modelValue', (event.target as HTMLSelectElement).value)
}
</script>

<template>
  <div class="floating-input mg-park-picker">
    <select
      :id="id"
      class="floating-input__control floating-input__control--select mg-park-picker__select"
      :class="{ 'mg-park-picker__select--has-count': showCount }"
      :value="modelValue ?? ''"
      :disabled="disabled || parks.length === 0"
      @change="onChange"
    >
      <option v-for="p in parks" :key="p.id" :value="p.id">{{ p.name }}</option>
    </select>
    <label :for="id" class="floating-input__label floating-input__label--floated">Park</label>
    <span v-if="showCount" class="mg-park-picker__fieldcount">
      {{ fieldCount }} {{ fieldCount === 1 ? 'field' : 'fields' }}
    </span>
  </div>
</template>

<style scoped>
/* Sizing (width / max-width / flex / responsive) is owned by the
   consuming screen's wrapper class — in Vue 2.7 the parent's scoped
   styles reach this component's root, so each view keeps its existing
   layout. The component only needs the positioning context for the
   count pill. A standalone consumer should give it a width. */
.mg-park-picker {
  position: relative;
  width: 100%;
}
/* Ellipsize a long park name so it never collides with the count pill /
   caret. */
.mg-park-picker__select {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
/* Keep the dropdown options from rendering wider than the control — a
   long park name truncates rather than ballooning the popup. */
.mg-park-picker__select option {
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
/* Reserve room for the count pill (sits left of the caret). */
.mg-park-picker__select--has-count {
  padding-right: 104px;
}
/* Fields-in-use pill — pinned just left of the select's dropdown caret. */
.mg-park-picker__fieldcount {
  position: absolute;
  top: 50%;
  right: 34px;
  transform: translateY(-50%);
  pointer-events: none;
  font-size: 12px;
  font-weight: 600;
  color: var(--secondary);
  /* Solid fill + border so it reads as a badge in light mode
     (`--surface-muted` is a translucent near-white that blends in). */
  background: #eef2f7;
  border: 1px solid #d8e0ea;
  padding: 2px 8px;
  border-radius: 999px;
  white-space: nowrap;
}
html.dark-mode .mg-park-picker__fieldcount {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.14);
}
</style>
