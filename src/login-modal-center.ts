import { ref } from 'vue'

// Shared state for the global login modal. Mirrors the pattern in
// toast-center.ts so any view (e.g., HandoffView) can open the modal without
// prop-drilling through the app shell.
//
// The LoginModal component in components/LoginModal.vue subscribes to
// isLoginModalOpen and renders itself accordingly. App.vue mounts the modal
// once at shell level.

const isLoginModalOpen = ref(false)

export function useLoginModalState() {
  return isLoginModalOpen
}

export function openLoginModal() {
  isLoginModalOpen.value = true
}

export function closeLoginModal() {
  isLoginModalOpen.value = false
}
