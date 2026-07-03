import { ref } from 'vue'

// MatchGeni left-rail mobile drawer (singleton)
// ---------------------------------------------
// On mobile the persistent left nav rail collapses into a slide-in drawer
// opened by a hamburger button in the MatchGeniHeader. The header is rendered
// inside each view (router-view) while the rail lives in MatchGeniEventLayout,
// so they're siblings that can't prop-drill — this tiny shared store bridges
// them (mirrors `toast-center` / `matchgeni-notify-center`).

const railDrawerOpen = ref(false)

export function useRailDrawer() {
  return railDrawerOpen
}
export function openRailDrawer() {
  railDrawerOpen.value = true
}
export function closeRailDrawer() {
  railDrawerOpen.value = false
}
export function toggleRailDrawer() {
  railDrawerOpen.value = !railDrawerOpen.value
}
