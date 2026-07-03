<script setup lang="ts">
// TemplatePickerModal
// -------------------
// Swap the active page's template. Renders the selectable catalogue (cover/back
// are structural + excluded) as small visual layout previews so the user picks
// by shape, not by name. Built on the shared SlideModal drawer.

import SlideModal from '../SlideModal.vue'
import { TEMPLATES } from './lifebookCatalogue'

defineProps<{
  modelValue: boolean
  current: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'select', key: string): void
}>()

const selectable = TEMPLATES.filter((t) => t.selectable)

function choose(key: string) {
  emit('select', key)
  emit('update:modelValue', false)
}
</script>

<template>
  <SlideModal
    :model-value="modelValue"
    title="Page layout"
    subtitle="Pick a template for this page"
    @update:model-value="(v) => emit('update:modelValue', v)"
  >
    <div class="tpl-grid">
      <button
        v-for="tpl in selectable"
        :key="tpl.key"
        type="button"
        class="tpl-card"
        :class="{ 'tpl-card--active': tpl.key === current }"
        @click="choose(tpl.key)"
      >
        <span class="tpl-card__preview" :class="`tpl-preview--${tpl.key}`" aria-hidden="true">
          <template v-if="tpl.key === 'full'"><i class="tpl-cell" /></template>
          <template v-else-if="tpl.key === 'grid-2'"><i class="tpl-cell" /><i class="tpl-cell" /></template>
          <template v-else-if="tpl.key === 'grid-4'"><i class="tpl-cell" /><i class="tpl-cell" /><i class="tpl-cell" /><i class="tpl-cell" /></template>
          <template v-else-if="tpl.key === 'collage-3'"><i class="tpl-cell tpl-cell--tall" /><i class="tpl-cell" /><i class="tpl-cell" /></template>
          <template v-else-if="tpl.key === 'photo-caption'"><i class="tpl-cell" /><i class="tpl-line" /></template>
          <template v-else-if="tpl.key === 'text'"><i class="tpl-line" /><i class="tpl-line" /><i class="tpl-line tpl-line--short" /></template>
        </span>
        <span class="tpl-card__meta">
          <span class="tpl-card__label">{{ tpl.label }}</span>
          <span class="tpl-card__hint">{{ tpl.hint }}</span>
        </span>
      </button>
    </div>
  </SlideModal>
</template>

<style scoped>
.tpl-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
}
.tpl-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-divider);
  background: var(--surface-card);
  cursor: pointer;
  text-align: left;
  transition: border-color 160ms ease, transform 160ms ease, box-shadow 160ms ease;
}
.tpl-card:hover {
  border-color: var(--border-accent-hover);
  transform: translateY(-2px);
  box-shadow: var(--shadow-soft);
}
.tpl-card--active {
  border-color: var(--primary);
  box-shadow: 0 0 0 1px var(--primary) inset;
}
.tpl-card__preview {
  aspect-ratio: 3 / 4;
  display: grid;
  gap: 5px;
  padding: 10px;
  border-radius: 4px;
  background: var(--surface-raised);
}
.tpl-cell {
  background: linear-gradient(150deg, var(--secondary-light), var(--secondary-light-2));
  border-radius: 2px;
}
.tpl-line {
  height: 6px;
  border-radius: 3px;
  background: var(--secondary-light-3);
  align-self: center;
}
.tpl-line--short {
  width: 60%;
}
.tpl-preview--grid-2 { grid-template-columns: 1fr 1fr; }
.tpl-preview--grid-4 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
.tpl-preview--collage-3 { grid-template-columns: 1.4fr 1fr; grid-template-rows: 1fr 1fr; }
.tpl-preview--collage-3 .tpl-cell--tall { grid-row: 1 / 3; }
.tpl-preview--photo-caption { grid-template-rows: 1fr auto; }
.tpl-preview--text { align-content: center; }
.tpl-card__meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tpl-card__label {
  font-size: 0.92rem;
  color: var(--text);
}
.tpl-card__hint {
  font-size: 0.78rem;
  color: var(--text-light);
}
</style>
