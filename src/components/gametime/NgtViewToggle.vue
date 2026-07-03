<script setup lang="ts">
// NgtViewToggle
// -------------
// Segmented card/list switch for the Game Time filter row. Backed by the
// shared game-time-view store so every tab stays in sync. Default = card.

import { gameTimeView, setGameTimeView } from '../../game-time-view'
</script>

<template>
  <div class="ngt-view-toggle" role="group" aria-label="View">
    <button
      type="button"
      class="ngt-view-toggle__btn"
      :class="{ 'ngt-view-toggle__btn--active': gameTimeView === 'card' }"
      :aria-pressed="gameTimeView === 'card' ? 'true' : 'false'"
      title="Card view"
      @click="setGameTimeView('card')"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" />
        <rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" />
      </svg>
    </button>
    <button
      type="button"
      class="ngt-view-toggle__btn"
      :class="{ 'ngt-view-toggle__btn--active': gameTimeView === 'list' }"
      :aria-pressed="gameTimeView === 'list' ? 'true' : 'false'"
      title="List view"
      @click="setGameTimeView('list')"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
        <circle cx="3.5" cy="6" r="1.2" fill="currentColor" stroke="none" /><circle cx="3.5" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="3.5" cy="18" r="1.2" fill="currentColor" stroke="none" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.ngt-view-toggle {
  display: inline-flex;
  flex: 0 0 auto;
  padding: 3px;
  gap: 2px;
  border: 1px solid var(--border-divider);
  border-radius: 999px;
  background: var(--surface-pill);
}
.ngt-view-toggle__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 26px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--text-light);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}
.ngt-view-toggle__btn:hover { color: var(--text); }
.ngt-view-toggle__btn--active {
  background: var(--surface-card);
  color: var(--primary);
  box-shadow: var(--shadow-soft);
}
</style>
