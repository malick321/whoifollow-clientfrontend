<script setup lang="ts">
// GameOptionsMenu
// ---------------
// Game-card "⋯" (kebab) options menu used by the scheduler source card. The
// only option today is **Un-schedule** (scheduler context only, for a
// scheduled game that isn't `final` — a completed game can't be unscheduled).
// Edit Matchup / Game Notes / Assign Umpires were removed; a single
// consolidated "edit game" popup will replace them later, opened from the game
// details drawer rather than this menu.
//
// Renders just the button + popover; the consuming card wraps it in a
// positioned `.poolplay-item__kebab-root` so the popover anchors correctly.

import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { GameMenuAction, SchedulerGame } from '../types'

const props = withDefaults(defineProps<{
  game: SchedulerGame
  /** Which surface hosts the card — gates the scheduler-only Un-schedule. */
  context: 'division' | 'scheduler'
}>(), {})

const emit = defineEmits<{
  (event: 'action', action: GameMenuAction, game: SchedulerGame): void
}>()

const canUnschedule = computed(() =>
  props.context === 'scheduler' &&
  !!props.game.scheduledDate &&
  props.game.status !== 'final'
)

interface MenuItem { action: GameMenuAction; label: string; danger?: boolean }
const items = computed<MenuItem[]>(() => {
  const list: MenuItem[] = []
  if (canUnschedule.value) list.push({ action: 'unschedule', label: 'Un-schedule', danger: true })
  return list
})

const open = ref(false)
function toggle() { open.value = !open.value }
function choose(action: GameMenuAction) {
  open.value = false
  emit('action', action, props.game)
}
function onDocClick() { open.value = false }
watch(open, (isOpen) => {
  if (isOpen) document.addEventListener('click', onDocClick)
  else document.removeEventListener('click', onDocClick)
})
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <span v-if="items.length" class="game-options-menu">
    <button
      type="button"
      class="poolplay-item__kebab"
      aria-label="Game options"
      :aria-expanded="open ? 'true' : 'false'"
      aria-haspopup="menu"
      @click="toggle"
    >
      <span class="poolplay-item__kebab-dots" aria-hidden="true"></span>
    </button>
    <div v-if="open" class="association-users__row-menu poolplay-item__menu" role="menu">
      <button
        v-for="item in items"
        :key="item.action"
        type="button"
        class="association-users__row-menu-item"
        :class="{ 'association-users__row-menu-item--danger': item.danger }"
        role="menuitem"
        @click="choose(item.action)"
      >{{ item.label }}</button>
    </div>
  </span>
</template>

<style scoped>
/* Transparent to layout — the host's `.poolplay-item__kebab-root` is the
   positioned ancestor the popover anchors to. */
.game-options-menu { display: contents; }
</style>
