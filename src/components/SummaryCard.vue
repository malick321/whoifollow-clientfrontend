<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'

const props = defineProps<{
  title: string
  value: string
  hint: string
  iconSrc?: string
}>()

const icon = computed(() => {
  const key = props.title.toLowerCase()

  if (key.includes('won')) return 'trophy'
  if (key.includes('lost')) return 'close'
  if (key.includes('active')) return 'game'
  if (key.includes('scoresheet')) return 'document'
  return 'calendar'
})
</script>

<template>
  <article class="summary-card">
    <div class="summary-card__top">
      <p class="summary-label">{{ title }}</p>
      <span class="summary-card__icon">
        <img v-if="iconSrc" :src="iconSrc" :alt="`${title} icon`" class="summary-card__icon-image" />
        <AppIcon v-else :name="icon" :size="34" tone="two-tone" />
      </span>
    </div>
    <strong class="summary-value">{{ value }}</strong>
    <span class="summary-hint">{{ hint }}</span>
  </article>
</template>
