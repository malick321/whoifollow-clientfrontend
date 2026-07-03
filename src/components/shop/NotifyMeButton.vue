<script setup lang="ts">
// NotifyMeButton
// --------------
// Shown in place of "Add To Cart" for an OUT-OF-STOCK product. Registers the
// current user via POST /v2/shop/products/{id}/notify-me. Auth required — the
// parent surfaces a sign-in prompt via the `requires-auth` event when no
// session is present. After a successful call it flips to a calm "We'll
// notify you" confirmed state.

import { ref } from 'vue'
import AppIcon from '../AppIcon.vue'
import { isAuthenticated } from '../../auth-session'
import { notifyMe } from '../../api/shop'

const props = defineProps<{
  productId: string
  /** Pre-confirmed (e.g. detail view knows the user already opted in). */
  modelValue?: boolean
  block?: boolean
}>()

const emit = defineEmits<{
  (event: 'requires-auth'): void
}>()

const submitting = ref(false)
const confirmed = ref(!!props.modelValue)

async function onClick() {
  if (confirmed.value || submitting.value) return
  if (!isAuthenticated.value) {
    emit('requires-auth')
    return
  }
  submitting.value = true
  try {
    const ok = await notifyMe(props.productId)
    if (ok) confirmed.value = true
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <button
    type="button"
    class="shop-notify-btn"
    :class="{ 'shop-notify-btn--block': block, 'shop-notify-btn--done': confirmed }"
    :disabled="submitting || confirmed"
    @click.stop.prevent="onClick"
  >
    <AppIcon name="bell" :size="16" />
    <span v-if="confirmed">We'll notify you</span>
    <span v-else-if="submitting">Saving…</span>
    <span v-else>Notify Me</span>
  </button>
</template>

<style scoped>
.shop-notify-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-family: var(--font-body);
  font-weight: 500;
  font-size: 0.85rem;
  color: var(--text);
  background: var(--surface-pill);
  border: 1px solid var(--border-divider);
  border-radius: var(--radius-md);
  padding: 9px 14px;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.shop-notify-btn--block {
  width: 100%;
}

.shop-notify-btn:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--primary);
}

.shop-notify-btn:disabled {
  cursor: default;
}

.shop-notify-btn--done {
  color: var(--success);
  border-color: var(--success);
  background: var(--success-light);
  opacity: 1;
}
</style>
