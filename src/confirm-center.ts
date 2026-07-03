// confirm-center
// ---------------
// A tiny promise-based confirmation dialog, mirroring `toast-center`. Replaces
// the native `window.confirm()` with an in-app dialog that matches the design
// system. Mounted ONCE via <ConfirmDialog /> in App.vue.
//
//   if (await confirmDialog({ title: 'Delete this task?', danger: true })) { ... }

import { ref } from 'vue'

export interface ConfirmOptions {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Renders the confirm button in the destructive style. */
  danger?: boolean
}

interface ConfirmState {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  danger: boolean
  resolve: ((value: boolean) => void) | null
}

export const confirmState = ref<ConfirmState>({
  open: false,
  title: '',
  message: '',
  confirmLabel: 'Confirm',
  cancelLabel: 'Cancel',
  danger: false,
  resolve: null
})

/** Open the confirm dialog; resolves true on confirm, false on cancel/dismiss. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  // If a previous dialog is somehow still open, resolve it false first.
  confirmState.value.resolve?.(false)

  return new Promise<boolean>((resolve) => {
    confirmState.value = {
      open: true,
      title: options.title,
      message: options.message ?? '',
      confirmLabel: options.confirmLabel ?? 'Confirm',
      cancelLabel: options.cancelLabel ?? 'Cancel',
      danger: options.danger ?? false,
      resolve
    }
  })
}

/** Resolve + close the active dialog. Called by the <ConfirmDialog /> component. */
export function resolveConfirm(value: boolean): void {
  const { resolve } = confirmState.value
  confirmState.value = { ...confirmState.value, open: false, resolve: null }
  resolve?.(value)
}
