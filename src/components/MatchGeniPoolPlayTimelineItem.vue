<script setup lang="ts">
// MatchGeniPoolPlayTimelineItem
// -----------------------------
// The original admin "timeline" Pool Play game row (time pill + vertical
// rail/dot + card), extracted verbatim so it's preserved for a future admin
// timeline view. Interactive like the list item (emit `open` / `action`,
// `canManage`-gated kebab). Render one per game inside `PoolPlayGames`'s
// `#game` slot. Parked — no importer yet.

import { onBeforeUnmount, ref, watch } from 'vue'
import TeamAvatar from './TeamAvatar.vue'
import type { SchedulerGame } from '../types'

type GameMenuAction = 'edit-matchup' | 'game-notes' | 'assign-umpires'

const props = defineProps<{
  game: SchedulerGame
  parkLabel?: string
  canManage?: boolean
}>()

const emit = defineEmits<{
  (event: 'open', game: SchedulerGame): void
  (event: 'action', action: GameMenuAction, game: SchedulerGame): void
}>()

function gameHasScore(g: SchedulerGame): boolean {
  return g.team1Score != null && g.team2Score != null
}
function gameTimeMain(g: SchedulerGame): string {
  return g.scheduledTime ?? 'TBD'
}
function gameTimeSub(g: SchedulerGame): string {
  switch (g.status) {
    case 'live': return 'Live'
    case 'final': return 'Final'
    case 'delayed': return 'Delayed'
    default: return g.scheduledDate ? 'Scheduled' : ''
  }
}
function gameSlotTone(g: SchedulerGame): string {
  if (!g.scheduledDate) return 'muted'
  switch (g.status) {
    case 'live': return 'live'
    case 'final': return 'final'
    case 'delayed': return 'warning'
    default: return ''
  }
}
function gameDotTone(g: SchedulerGame): string {
  switch (g.status) {
    case 'live': return 'live'
    case 'final': return 'final'
    case 'delayed': return 'warning'
    default: return 'pending'
  }
}
function gameIsStarted(g: SchedulerGame): boolean {
  return g.status === 'final' || g.status === 'live' || g.status === 'delayed'
}
function gameStartLabel(g: SchedulerGame): string {
  if (!g.scheduledTime) return ''
  return gameIsStarted(g) ? `Started ${g.scheduledTime}` : g.scheduledTime
}
function gameTimeLimitLabel(g: SchedulerGame): string {
  return g.durationMinutes ? `${g.durationMinutes} min limit` : ''
}

const menuOpen = ref(false)
function toggleMenu() { menuOpen.value = !menuOpen.value }
function onAction(action: GameMenuAction) {
  menuOpen.value = false
  emit('action', action, props.game)
}
function onDocClick() { menuOpen.value = false }
watch(menuOpen, (open) => {
  if (open) document.addEventListener('click', onDocClick)
  else document.removeEventListener('click', onDocClick)
})
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div class="mg-div-detail__tl-item">
    <div class="mg-div-detail__tl-slot">
      <span class="mg-div-detail__tl-time" :data-tone="gameSlotTone(game)">
        <span class="mg-div-detail__tl-time-main">{{ gameTimeMain(game) }}</span>
        <span v-if="gameTimeSub(game)" class="mg-div-detail__tl-time-sub">{{ gameTimeSub(game) }}</span>
      </span>
    </div>
    <div class="mg-div-detail__tl-rail" aria-hidden="true">
      <span class="mg-div-detail__tl-dot" :data-tone="gameDotTone(game)"></span>
    </div>
    <article
      class="mg-div-detail__tl-card mg-div-detail__tl-card--clickable"
      role="button"
      tabindex="0"
      :aria-label="`Open ${game.label} details`"
      @click="emit('open', game)"
      @keydown.enter="emit('open', game)"
      @keydown.space.prevent="emit('open', game)"
    >
      <div class="mg-div-detail__tl-card-head">
        <span class="mg-div-detail__tl-label">{{ game.label }}</span>
        <div v-if="canManage" class="mg-div-detail__tl-menu-root" @click.stop>
          <button
            type="button"
            class="mg-div-detail__tl-menu-btn"
            aria-label="Game options"
            :aria-expanded="menuOpen ? 'true' : 'false'"
            aria-haspopup="menu"
            @click="toggleMenu"
          >
            <span class="mg-div-detail__tl-menu-dots" aria-hidden="true"></span>
          </button>
          <div v-if="menuOpen" class="association-users__row-menu mg-div-detail__tl-menu" role="menu">
            <button type="button" class="association-users__row-menu-item" role="menuitem" @click="onAction('edit-matchup')">Edit Matchup</button>
            <button type="button" class="association-users__row-menu-item" role="menuitem" @click="onAction('game-notes')">Game Notes</button>
            <button type="button" class="association-users__row-menu-item" role="menuitem" @click="onAction('assign-umpires')">Assign Umpires</button>
          </div>
        </div>
      </div>

      <div class="mg-div-detail__tl-meta">
        <span v-if="gameStartLabel(game)" class="mg-div-detail__tl-meta-item">
          <span class="mg-div-detail__tl-meta-icon mg-div-detail__tl-meta-icon--time" aria-hidden="true"></span>
          <span class="mg-div-detail__tl-meta-copy">
            <span>{{ gameStartLabel(game) }}</span>
            <span v-if="gameTimeLimitLabel(game)" class="mg-div-detail__tl-meta-sub">{{ gameTimeLimitLabel(game) }}</span>
          </span>
        </span>
        <span v-if="game.scheduledFieldLabel" class="mg-div-detail__tl-meta-item">
          <span class="mg-div-detail__tl-meta-icon mg-div-detail__tl-meta-icon--field" aria-hidden="true"></span>
          <span class="mg-div-detail__tl-meta-copy">{{ game.scheduledFieldLabel }}<template v-if="parkLabel"> - {{ parkLabel }}</template></span>
        </span>
      </div>

      <div class="mg-div-detail__tl-teams">
        <div class="mg-div-detail__tl-team">
          <TeamAvatar :name="game.team1Label ?? ''" size="md" />
          <span class="mg-div-detail__tl-team-name">{{ game.team1Label }}</span>
          <span v-if="gameHasScore(game)" class="mg-div-detail__tl-score">{{ game.team1Score }}</span>
        </div>
        <div class="mg-div-detail__tl-team">
          <TeamAvatar :name="game.team2Label ?? ''" size="md" />
          <span class="mg-div-detail__tl-team-name">{{ game.team2Label }}</span>
          <span v-if="gameHasScore(game)" class="mg-div-detail__tl-score">{{ game.team2Score }}</span>
        </div>
      </div>
    </article>
  </div>
</template>

<style scoped>
.mg-div-detail__tl-item {
  display: grid;
  grid-template-columns: 80px 24px minmax(0, 1fr);
  align-items: stretch;
}
.mg-div-detail__tl-slot {
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  padding: 14px 0 0 0;
}
.mg-div-detail__tl-time {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 76px;
  padding: 7px 10px;
  border-radius: 12px;
  border: 1px solid var(--border-divider);
  background: var(--surface-card);
  color: var(--secondary);
  font-size: 12px;
  line-height: 1.15;
  text-align: center;
}
.mg-div-detail__tl-time[data-tone='live'] { background: var(--danger-light); border-color: rgba(255, 90, 104, 0.24); color: #aa2b37; }
.mg-div-detail__tl-time[data-tone='final'] { background: var(--primary-light-3); border-color: rgba(45, 140, 240, 0.22); color: var(--primary); }
.mg-div-detail__tl-time[data-tone='warning'] { background: var(--light-warning); border-color: rgba(255, 212, 90, 0.42); color: #8c6500; }
html.dark-mode .mg-div-detail__tl-time[data-tone='live'] { color: var(--highlight, #ff6b78); }
html.dark-mode .mg-div-detail__tl-time[data-tone='final'] { color: #7fb0e8; }
html.dark-mode .mg-div-detail__tl-time[data-tone='warning'] { color: #f7a120; }
.mg-div-detail__tl-time-main { font-weight: 600; }
.mg-div-detail__tl-time[data-tone='muted'] .mg-div-detail__tl-time-main { font-size: 11px; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase; }
.mg-div-detail__tl-time-sub { margin-top: 3px; font-size: 10px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
.mg-div-detail__tl-rail { position: relative; }
.mg-div-detail__tl-rail::before { content: ''; position: absolute; left: 50%; top: 0; bottom: 0; width: 2px; transform: translateX(-50%); background: var(--border-divider); }
.mg-div-detail__tl-dot { position: absolute; top: 20px; left: 50%; width: 11px; height: 11px; transform: translateX(-50%); border-radius: 999px; background: var(--secondary); box-shadow: 0 0 0 4px var(--white, #fff); }
.mg-div-detail__tl-dot[data-tone='live'] { background: #ff5a68; }
.mg-div-detail__tl-dot[data-tone='final'] { background: var(--primary); }
.mg-div-detail__tl-dot[data-tone='warning'] { background: #f0a728; }
.mg-div-detail__tl-dot[data-tone='pending'] { background: var(--secondary); }
.mg-div-detail__tl-card {
  margin: 8px 0;
  padding: 12px 14px;
  border: 1px solid var(--border-divider);
  border-radius: 10px;
  background: var(--surface-card);
  display: flex;
  flex-direction: column;
  gap: 0;
}
.mg-div-detail__tl-card--clickable { cursor: pointer; transition: border-color 120ms ease, box-shadow 120ms ease, background-color 120ms ease, transform 120ms ease; }
.mg-div-detail__tl-card--clickable:hover { border-color: var(--primary); background: var(--primary-light-3, #f0f6ff); box-shadow: 0 4px 14px rgba(20, 40, 80, 0.10); transform: translateY(-1px); }
html.dark-mode .mg-div-detail__tl-card--clickable:hover { background: rgba(45, 140, 240, 0.08); box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35); }
.mg-div-detail__tl-card--clickable:active { transform: translateY(0); }
.mg-div-detail__tl-card--clickable:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.mg-div-detail__tl-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 24px; }
.mg-div-detail__tl-label { font-size: 14px; font-weight: 600; color: var(--primary); }
.mg-div-detail__tl-menu-root { position: relative; flex: 0 0 auto; }
.mg-div-detail__tl-menu-btn { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 6px; border: 0; background: transparent; color: var(--secondary); cursor: pointer; }
.mg-div-detail__tl-menu-btn:hover { background: rgba(45, 140, 240, 0.08); color: var(--text); }
html.dark-mode .mg-div-detail__tl-menu-btn:hover { background: rgba(45, 140, 240, 0.16); }
.mg-div-detail__tl-menu-dots,
.mg-div-detail__tl-menu-dots::before,
.mg-div-detail__tl-menu-dots::after { width: 3px; height: 3px; border-radius: 50%; background: currentColor; }
.mg-div-detail__tl-menu-dots { position: relative; }
.mg-div-detail__tl-menu-dots::before,
.mg-div-detail__tl-menu-dots::after { content: ''; position: absolute; top: 0; }
.mg-div-detail__tl-menu-dots::before { left: -5px; }
.mg-div-detail__tl-menu-dots::after { left: 5px; }
.mg-div-detail__tl-menu { min-width: 170px; }
.mg-div-detail__tl-meta { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
.mg-div-detail__tl-meta-item { display: inline-flex; align-items: flex-start; gap: 6px; font-size: 12px; color: var(--secondary); min-width: 0; }
.mg-div-detail__tl-meta-icon { width: 14px; height: 14px; flex: 0 0 auto; margin-top: 1px; background-color: var(--secondary); }
.mg-div-detail__tl-meta-icon--time { -webkit-mask: url('../assets/timer-start.svg') center / contain no-repeat; mask: url('../assets/timer-start.svg') center / contain no-repeat; }
.mg-div-detail__tl-meta-icon--field { -webkit-mask: url('../assets/field-line.svg') center / contain no-repeat; mask: url('../assets/field-line.svg') center / contain no-repeat; }
.mg-div-detail__tl-meta-copy { display: inline-flex; flex-direction: column; min-width: 0; }
.mg-div-detail__tl-meta-sub { font-size: 11px; color: var(--secondary); opacity: 0.85; }
.mg-div-detail__tl-teams { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.mg-div-detail__tl-team { display: flex; align-items: center; gap: 10px; }
.mg-div-detail__tl-team-name { flex: 1 1 auto; min-width: 0; font-size: 14px; font-weight: 500; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mg-div-detail__tl-score { flex: 0 0 auto; font-size: 14px; font-weight: 700; color: var(--text); }
</style>
