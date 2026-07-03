import { ref } from 'vue'

// MatchGeni notification center (singleton)
// -----------------------------------------
// The event-wide "Notifications" composer (SendNotificationModal) is now
// hosted ONCE in MatchGeniEventLayout so it's reachable from every MatchGeni
// sub-page (via the left nav rail) — not just the dashboard. Any surface can
// open it through this tiny shared store, mirroring the pattern of
// `src/toast-center.ts`.

const notifyOpen = ref(false)

export function useNotifyCenter() {
  return notifyOpen
}

export function openNotifications() {
  notifyOpen.value = true
}

export function closeNotifications() {
  notifyOpen.value = false
}
