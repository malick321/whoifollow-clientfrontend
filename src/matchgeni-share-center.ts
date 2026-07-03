import { ref } from 'vue'

// MatchGeni header-action triggers (singleton)
// --------------------------------------------
// The Share + View Event buttons live in the MatchGeniHeader (rendered inside
// each view), but their targets (EventShareModal / the public event tab) are
// owned by MatchGeniEventLayout. They're siblings that can't prop-drill, so
// the header bumps these nonces and the layout watches them (mirrors
// `mg-rail-drawer` / `matchgeni-notify-center`).

const shareNonce = ref(0)
const viewNonce = ref(0)

export function useShareSignal() {
  return shareNonce
}
export function requestShare() {
  shareNonce.value += 1
}

export function useViewSignal() {
  return viewNonce
}
export function requestViewEvent() {
  viewNonce.value += 1
}
