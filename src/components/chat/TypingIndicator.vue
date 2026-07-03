<script setup lang="ts">
defineProps<{
  label?: string
}>()
</script>

<template>
  <span class="typing-indicator">
    <span class="typing-indicator__dots" aria-hidden="true">
      <span class="typing-indicator__dot" />
      <span class="typing-indicator__dot" />
      <span class="typing-indicator__dot" />
    </span>
    <span v-if="label" class="typing-indicator__label">{{ label }}</span>
  </span>
</template>

<style scoped>
.typing-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--primary, #2d8cf0);
  font-family: var(--font-body);
  font-size: 0.8rem;
  font-weight: 400;
}

.typing-indicator__dots {
  display: inline-flex;
  align-items: flex-end;
  gap: 3px;
}

.typing-indicator__dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.4;
  animation: typing-bounce 1.2s infinite ease-in-out;
}

.typing-indicator__dot:nth-child(2) {
  animation-delay: 0.2s;
}

.typing-indicator__dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typing-bounce {
  0%,
  60%,
  100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  30% {
    transform: translateY(-3px);
    opacity: 1;
  }
}
</style>
