<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  count: number
  max?: number
}>()

const label = computed(() => {
  const max = props.max ?? 99
  return props.count > max ? `${max}+` : String(props.count)
})
</script>

<template>
  <span v-if="count > 0" class="unread-badge">{{ label }}</span>
</template>

<style scoped>
.unread-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--primary, #2d8cf0);
  color: var(--white, #ffffff);
  font-family: var(--font-body);
  font-size: 0.68rem;
  font-weight: 500;
  line-height: 1;
}

html.dark-mode .unread-badge {
  color: #0f1419;
}
</style>
