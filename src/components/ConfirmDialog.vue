<script setup lang="ts">
// ConfirmDialog — the single app-wide confirmation dialog (driven by
// confirm-center). Reuses the colleague's confirm-panel chrome (the same
// `.association-switcher-*` / `.association-confirm-panel` classes used by
// AssociationEventsView's lifecycle confirm) so it matches every other
// confirm in the product. Mounted once in App.vue. No native window.confirm.

import { computed, onBeforeUnmount, onMounted } from 'vue'
import AppIcon from './AppIcon.vue'
import { confirmState, resolveConfirm } from '../confirm-center'

const open = computed(() => confirmState.value.open)

function confirm() {
  resolveConfirm(true)
}
function cancel() {
  resolveConfirm(false)
}
function onBackdrop(event: MouseEvent) {
  if (event.target === event.currentTarget) cancel()
}
function onKey(event: KeyboardEvent) {
  if (!open.value) return
  if (event.key === 'Escape') cancel()
  else if (event.key === 'Enter') confirm()
}

onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <Transition name="slide-modal-backdrop">
      <div
        v-if="open"
        class="association-switcher-backdrop"
        role="presentation"
        @click="onBackdrop"
      >
        <div
          class="association-switcher-panel association-confirm-panel confirm-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
        >
          <header class="association-switcher-panel__header">
            <h2 id="confirm-dialog-title" class="association-switcher-panel__title">
              {{ confirmState.title }}
            </h2>
            <button
              type="button"
              class="association-switcher-panel__close"
              aria-label="Close"
              @click="cancel"
            >
              <AppIcon name="close" :size="16" />
            </button>
          </header>

          <div v-if="confirmState.message" class="association-confirm-panel__body">
            <p class="association-confirm-panel__copy">{{ confirmState.message }}</p>
          </div>

          <footer class="association-confirm-panel__footer">
            <button type="button" class="secondary-button" @click="cancel">
              {{ confirmState.cancelLabel }}
            </button>
            <button
              type="button"
              :class="confirmState.danger ? 'danger-light-button' : 'primary-button'"
              @click="confirm"
            >
              {{ confirmState.confirmLabel }}
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* The chrome comes from the global `.association-switcher-*` /
   `.association-confirm-panel` classes (styles.css). Just ensure a sane
   width + that this dialog floats above other modals/drawers. */
.confirm-dialog {
  width: min(420px, calc(100vw - 32px));
  z-index: 1300;
}
.association-switcher-backdrop {
  z-index: 1290;
}
</style>
