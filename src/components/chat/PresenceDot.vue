<script setup lang="ts">
defineProps<{
  online?: boolean
  size?: number
}>()
</script>

<template>
  <span
    class="presence-dot"
    :class="{ 'presence-dot--online': online }"
    :style="size ? { width: `${size}px`, height: `${size}px` } : undefined"
    aria-hidden="true"
  />
</template>

<style scoped>
.presence-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--secondary-light-2, #96acc5);
  border: 2px solid var(--white, #ffffff);
  box-sizing: border-box;
}

.presence-dot--online {
  background: var(--success, #29cf59);
}
</style>
