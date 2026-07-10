import { ref } from 'vue'

// Shared state for the global "Invite Friend" modal. Mirrors the pattern in
// login-modal-center.ts / toast-center.ts so any view or the top bar can open
// the modal without prop-drilling through the app shell.
//
// The InviteFriendModal component subscribes to isInviteModalOpen and renders
// itself accordingly. App.vue mounts the modal once at shell level.

const isInviteModalOpen = ref(false)

export function useInviteModalState() {
  return isInviteModalOpen
}

export function openInviteModal() {
  isInviteModalOpen.value = true
}

export function closeInviteModal() {
  isInviteModalOpen.value = false
}
