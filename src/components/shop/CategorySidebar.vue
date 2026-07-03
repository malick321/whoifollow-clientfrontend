<script setup lang="ts">
// CategorySidebar
// ---------------
// The storefront's left category rail: an "All" entry followed by the root
// categories. Selecting one emits the (string) category id, or '' for All.
// On mobile it collapses into a horizontal scrolling pill row (handled by CSS).

import type { ShopCategory } from '../../api/shop'

defineProps<{
  categories: ShopCategory[]
  /** Currently selected root category id; '' => All. */
  modelValue: string
  loading?: boolean
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
}>()
</script>

<template>
  <nav class="shop-categories" aria-label="Product categories">
    <h2 class="shop-categories__title">Shop</h2>
    <ul class="shop-categories__list">
      <li>
        <button
          type="button"
          class="shop-categories__item"
          :class="{ 'shop-categories__item--active': modelValue === '' }"
          @click="emit('update:modelValue', '')"
        >
          All
        </button>
      </li>
      <li v-for="cat in categories" :key="cat.id">
        <button
          type="button"
          class="shop-categories__item"
          :class="{ 'shop-categories__item--active': modelValue === cat.id }"
          @click="emit('update:modelValue', cat.id)"
        >
          {{ cat.name }}
        </button>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.shop-categories {
  background: var(--surface-card);
  border: 1px solid var(--border-divider);
  border-radius: var(--radius-lg);
  padding: 16px;
  box-shadow: var(--shadow-soft);
}

.shop-categories__title {
  font-family: var(--font-body);
  font-weight: 500;
  font-size: 1.05rem;
  color: var(--text);
  margin: 0 0 12px;
  padding: 0 8px;
}

.shop-categories__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.shop-categories__item {
  display: block;
  width: 100%;
  text-align: left;
  font-family: var(--font-body);
  font-weight: 500;
  font-size: 0.9rem;
  color: var(--text-light);
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  padding: 9px 12px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.shop-categories__item:hover {
  background: var(--surface-pill);
  color: var(--text);
}

.shop-categories__item--active {
  background: var(--primary-light-3);
  color: var(--primary);
}

@media (max-width: 860px) {
  .shop-categories {
    padding: 12px;
  }
  .shop-categories__title {
    display: none;
  }
  .shop-categories__list {
    flex-direction: row;
    flex-wrap: nowrap;
    overflow-x: auto;
    gap: 8px;
    padding-bottom: 2px;
  }
  .shop-categories__item {
    white-space: nowrap;
    background: var(--surface-pill);
  }
  .shop-categories__item--active {
    background: var(--primary-light-3);
  }
}
</style>
