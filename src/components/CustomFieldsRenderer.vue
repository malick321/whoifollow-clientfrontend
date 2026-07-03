<script setup lang="ts">
// CustomFieldsRenderer
// --------------------
// Renders a set of admin-defined custom-field DEFINITIONS as live form
// controls, mapping each `inputType` to an existing finalized control
// (ToggleSwitch / select / TagsMultiSelect / floating-input). Values are
// held by the parent as a `{ [definitionId]: value }` map (v-model).
// Entity-agnostic — used by the event form now, divisions/games later.

import ToggleSwitch from './ToggleSwitch.vue'
import TagsMultiSelect from './TagsMultiSelect.vue'
import DateTimePicker from './DateTimePicker.vue'
import type { CustomFieldDefinition } from '../types'

type FieldValue = boolean | string | string[]

const props = defineProps<{
  definitions: CustomFieldDefinition[]
  modelValue: Record<string, FieldValue>
  /** 'stack' (default) = one control per row; 'grid' = two columns, with
   *  textarea / multi-select fields spanning the full row. */
  layout?: 'stack' | 'grid'
  /** Definition ids that failed required validation (parent-driven). When an
   *  id is present, that field renders its invalid state + a "Required" cue. */
  errors?: string[]
}>()
const emit = defineEmits<{ (event: 'update:modelValue', value: Record<string, FieldValue>): void }>()

function setValue(id: string, value: FieldValue) {
  emit('update:modelValue', { ...props.modelValue, [id]: value })
}
function isInvalid(id: string): boolean {
  return Array.isArray(props.errors) && props.errors.includes(id)
}
// Tolerant readers — values may arrive typed (after edit) or as raw wire
// strings (from hydration): "1" boolean, an option, or a JSON array.
function boolVal(id: string): boolean {
  const v = props.modelValue[id]
  return v === true || v === '1'
}
function strVal(id: string): string {
  const v = props.modelValue[id]
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
}
function arrVal(id: string): string[] {
  const v = props.modelValue[id]
  if (Array.isArray(v)) return v
  if (typeof v === 'string' && v.trim().startsWith('[')) {
    try { return JSON.parse(v) as string[] } catch { return [] }
  }
  return []
}
</script>

<template>
  <div class="cf-renderer" :class="{ 'cf-renderer--grid': layout === 'grid' }">
    <template v-for="def in definitions" :key="def.id">
      <!-- boolean → setting row + ToggleSwitch (a toggle always has a value,
           so it's never "required-empty"). -->
      <div v-if="def.inputType === 'boolean'" class="cf-setting">
        <span class="cf-setting__label">{{ def.label }}</span>
        <ToggleSwitch :model-value="boolVal(def.id)" :aria-label="def.label" @update:model-value="setValue(def.id, $event)" />
      </div>

      <!-- single_select → floating select -->
      <div v-else-if="def.inputType === 'single_select'" class="floating-input cf-field" :class="{ 'floating-input--invalid': isInvalid(def.id) }">
        <select
          :id="`cf-${def.id}`"
          :value="strVal(def.id)"
          class="floating-input__control floating-input__control--select"
          :class="{ 'floating-input__control--has-value': !!strVal(def.id) }"
          @change="setValue(def.id, ($event.target as HTMLSelectElement).value)"
        >
          <option value="" disabled hidden></option>
          <option v-for="o in def.options" :key="o" :value="o">{{ o }}</option>
        </select>
        <label :for="`cf-${def.id}`" class="floating-input__label" :class="{ 'floating-input__label--floated': !!strVal(def.id) }">{{ def.label }}</label>
        <span v-if="isInvalid(def.id)" class="floating-input__error-corner">Required</span>
      </div>

      <!-- multi_select → tags -->
      <div v-else-if="def.inputType === 'multi_select'" class="cf-stack cf-item--full">
        <span class="cf-stack__label">{{ def.label }}</span>
        <TagsMultiSelect
          :model-value="arrVal(def.id)"
          :options="def.options"
          :placeholder="`Select ${def.label.toLowerCase()}`"
          :aria-label="def.label"
          @update:model-value="setValue(def.id, $event)"
        />
        <span v-if="isInvalid(def.id)" class="cf-error">Required</span>
      </div>

      <!-- number -->
      <div v-else-if="def.inputType === 'number'" class="floating-input cf-field" :class="{ 'floating-input--invalid': isInvalid(def.id) }">
        <input
          :id="`cf-${def.id}`"
          :value="strVal(def.id)"
          type="number"
          class="floating-input__control"
          :class="{ 'floating-input__control--has-value': !!strVal(def.id) }"
          placeholder=" "
          @input="setValue(def.id, ($event.target as HTMLInputElement).value)"
        />
        <label :for="`cf-${def.id}`" class="floating-input__label" :class="{ 'floating-input__label--floated': !!strVal(def.id) }">{{ def.label }}</label>
        <span v-if="isInvalid(def.id)" class="floating-input__error-corner">Required</span>
      </div>

      <!-- date → in-app stylized calendar (date-only) -->
      <div v-else-if="def.inputType === 'date'" class="cf-field">
        <DateTimePicker
          :id="`cf-${def.id}`"
          :model-value="strVal(def.id)"
          :label="def.label"
          date-only
          @update:model-value="setValue(def.id, $event)"
        />
        <span v-if="isInvalid(def.id)" class="cf-error">Required</span>
      </div>

      <!-- textarea (long text) -->
      <div v-else-if="def.inputType === 'textarea'" class="floating-input cf-field cf-item--full" :class="{ 'floating-input--invalid': isInvalid(def.id) }">
        <textarea
          :id="`cf-${def.id}`"
          :value="strVal(def.id)"
          rows="3"
          class="floating-input__control cf-textarea"
          :class="{ 'floating-input__control--has-value': !!strVal(def.id) }"
          placeholder=" "
          @input="setValue(def.id, ($event.target as HTMLTextAreaElement).value)"
        ></textarea>
        <label :for="`cf-${def.id}`" class="floating-input__label" :class="{ 'floating-input__label--floated': !!strVal(def.id) }">{{ def.label }}</label>
        <span v-if="isInvalid(def.id)" class="floating-input__error-corner">Required</span>
      </div>

      <!-- text (default) -->
      <div v-else class="floating-input cf-field" :class="{ 'floating-input--invalid': isInvalid(def.id) }">
        <input
          :id="`cf-${def.id}`"
          :value="strVal(def.id)"
          type="text"
          class="floating-input__control"
          :class="{ 'floating-input__control--has-value': !!strVal(def.id) }"
          placeholder=" "
          @input="setValue(def.id, ($event.target as HTMLInputElement).value)"
        />
        <label :for="`cf-${def.id}`" class="floating-input__label" :class="{ 'floating-input__label--floated': !!strVal(def.id) }">{{ def.label }}</label>
        <span v-if="isInvalid(def.id)" class="floating-input__error-corner">Required</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.cf-renderer { display: flex; flex-direction: column; gap: 16px; }
/* Grid layout — two columns; textarea / multi-select span the full row. */
.cf-renderer--grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.cf-renderer--grid .cf-item--full { grid-column: 1 / -1; }
@media (max-width: 720px) {
  .cf-renderer--grid { grid-template-columns: 1fr; }
}
.cf-field { margin: 0; }
.cf-stack { display: flex; flex-direction: column; gap: 6px; }
.cf-stack__label { font-size: 12px; font-weight: 600; color: var(--secondary); }
.cf-setting {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}
.cf-setting__label { font-size: 14px; font-weight: 600; color: var(--text); }
/* Inline error cue for controls without a corner badge (multi-select, date). */
.cf-error { font-size: 12px; color: var(--danger, #d64545); }
/* textarea control — let it grow vertically (override the fixed control height). */
.cf-textarea { height: auto; min-height: 80px; resize: vertical; line-height: 1.4; padding-top: 10px; }
</style>
