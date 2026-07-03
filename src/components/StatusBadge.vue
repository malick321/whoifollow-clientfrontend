<script setup lang="ts">
defineProps<{
  label: string
  tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary' | 'secondary'
}>()
</script>

<template>
  <span class="status-badge" :data-tone="tone">{{ label }}</span>
</template>
