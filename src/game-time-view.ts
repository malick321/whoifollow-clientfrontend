// game-time-view
// --------------
// Shared card/list view mode for the Game Time tabs. Module-level ref so every
// tab shares the choice reactively; persisted to localStorage. Default = card
// (the new, attractive grid); 'list' = the compact row layout (the old view).

import { ref } from 'vue'

export type GameTimeViewMode = 'card' | 'list'

const STORAGE_KEY = 'wif_ngt_view'

function initial(): GameTimeViewMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'list' ? 'list' : 'card'
  } catch {
    return 'card'
  }
}

export const gameTimeView = ref<GameTimeViewMode>(initial())

export function setGameTimeView(mode: GameTimeViewMode) {
  gameTimeView.value = mode
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    /* private mode — still applies in-session */
  }
}
