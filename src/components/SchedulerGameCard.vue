<script setup lang="ts">
// SchedulerGameCard
// -----------------
// Game card in the matchgeni scheduler's left source column. Visually mirrors
// the division-detail Pool-Play card (name → time + status → field · park →
// team rows with avatars + scores), with two scheduler-specific additions:
//   - a dotted drag GRIP + `draggable` (HTML5 dnd; drag-start handled by the
//     parent, which owns the page-level dnd state),
//   - an inline **Un-schedule** text link in the time row (shown only for a
//     scheduled, non-final game) — clicking the card itself opens the game
//     details drawer; there's no per-card kebab menu.

import TeamAvatar from './TeamAvatar.vue'
import StatusBadge from './StatusBadge.vue'
import type { SchedulerGame } from '../types'

defineProps<{
  game: SchedulerGame
  /** Pre-formatted date label from the parent's `formatGameDate()`. */
  dateLabel: string
  /** Resolved park name for the meta row. */
  parkLabel?: string
}>()

defineEmits<{
  (event: 'dragstart', payload: { event: DragEvent; game: SchedulerGame }): void
  (event: 'open', game: SchedulerGame): void
}>()

type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary' | 'secondary'
function statusBadge(s: NonNullable<SchedulerGame['status']>): { label: string; tone: BadgeTone } {
  switch (s) {
    case 'live': return { label: 'Live', tone: 'danger' }
    case 'delayed': return { label: 'Delayed', tone: 'warning' }
    case 'final': return { label: 'Final', tone: 'secondary' }
    default: return { label: 'Scheduled', tone: 'neutral' }
  }
}
function scored(g: SchedulerGame): boolean {
  return g.team1Score != null && g.team2Score != null
}
function teamResult(g: SchedulerGame, side: 1 | 2): 'win' | 'loss' | '' {
  if (!scored(g) || g.team1Score === g.team2Score) return ''
  const team1Wins = (g.team1Score as number) > (g.team2Score as number)
  if (side === 1) return team1Wins ? 'win' : 'loss'
  return team1Wins ? 'loss' : 'win'
}
</script>

<template>
  <article
    class="scheduler__game-card"
    :class="{ 'scheduler__game-card--scheduled': game.scheduledDate }"
    draggable="true"
    role="button"
    tabindex="0"
    :aria-label="`Open ${game.label} details`"
    @dragstart="(e) => $emit('dragstart', { event: e, game })"
    @click="$emit('open', game)"
    @keydown.enter="$emit('open', game)"
    @keydown.space.prevent="$emit('open', game)"
  >
    <!-- Drag grip — dotted handle, same as the Manage Team Pools team item. -->
    <span class="scheduler__game-grip" aria-hidden="true"></span>

    <div class="scheduler__game-body">
      <!-- Game name + status badge on one line (badge sits next to the name). -->
      <div class="scheduler__game-header">
        <span class="scheduler__game-label">{{ game.label }}</span>
        <StatusBadge
          v-if="game.status"
          :label="statusBadge(game.status).label"
          :tone="statusBadge(game.status).tone"
        />
      </div>

      <div v-if="game.scheduledDate && game.scheduledTime" class="scheduler__game-when">
        <!-- Time only exists for a scheduled game (no date ⇒ no time).
             Un-scheduling now happens via the grid's bulk selection mode,
             so the inline link was removed. -->
        <span class="scheduler__game-time">{{ game.scheduledTime }}</span>
      </div>

      <!-- Field · park only exist for a scheduled game (no date ⇒ no
           field/park assigned, so the meta row is hidden entirely). -->
      <div v-if="game.scheduledDate && (game.scheduledFieldLabel || parkLabel)" class="scheduler__game-meta">
        <span v-if="game.scheduledFieldLabel">{{ game.scheduledFieldLabel }}</span>
        <span v-if="game.scheduledFieldLabel && parkLabel" aria-hidden="true">·</span>
        <span v-if="parkLabel">{{ parkLabel }}</span>
      </div>

      <div class="scheduler__game-teams">
        <span
          class="scheduler__game-team"
          :class="{ 'scheduler__game-team--winner': teamResult(game, 1) === 'win', 'scheduler__game-team--loser': teamResult(game, 1) === 'loss' }"
        >
          <TeamAvatar :name="game.team1Label ?? ''" size="sm" />
          <span class="scheduler__game-team-name">{{ game.team1Label ?? 'TBD' }}</span>
          <span v-if="scored(game)" class="scheduler__game-score">{{ game.team1Score }}</span>
        </span>
        <span
          class="scheduler__game-team"
          :class="{ 'scheduler__game-team--winner': teamResult(game, 2) === 'win', 'scheduler__game-team--loser': teamResult(game, 2) === 'loss' }"
        >
          <TeamAvatar :name="game.team2Label ?? ''" size="sm" />
          <span class="scheduler__game-team-name">{{ game.team2Label ?? 'TBD' }}</span>
          <span v-if="scored(game)" class="scheduler__game-score">{{ game.team2Score }}</span>
        </span>
      </div>
    </div>
  </article>
</template>

<style scoped>
/* Card chrome — mirrors the shared Pool-Play list item: muted surface, 1px
   divider, 8px radius, primary-tinted hover. Draggable source (grab cursor). */
.scheduler__game-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border-divider);
  border-radius: 8px;
  background: var(--surface-muted, #f4f7fb);
  cursor: grab;
  transition: box-shadow 120ms ease, border-color 120ms ease, background-color 120ms ease;
  min-width: 0;
}
html.dark-mode .scheduler__game-card { background: rgba(255, 255, 255, 0.04); }
.scheduler__game-card:hover {
  border-color: var(--primary);
  background: var(--primary-light-3, #f0f6ff);
  box-shadow: 0 4px 14px rgba(20, 40, 80, 0.10);
}
html.dark-mode .scheduler__game-card:hover {
  background: rgba(45, 140, 240, 0.08);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
}
.scheduler__game-card:active { cursor: grabbing; }

/* Drag grip — dotted handle, identical to `.mg-pools__grip`. */
.scheduler__game-grip {
  flex: 0 0 auto;
  width: 10px;
  height: 16px;
  margin-top: 2px;
  background-image: radial-gradient(currentColor 1px, transparent 1.5px);
  background-size: 5px 5px;
  background-position: 0 2px;
  color: var(--secondary);
  opacity: 0.7;
}

.scheduler__game-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1 1 auto;
  min-width: 0;
}

.scheduler__game-header {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}
.scheduler__game-label {
  color: var(--text);
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 0 1 auto;
  min-width: 0;
}
/* Status badge sits next to the name; stays put + tight so it doesn't grow
   the name row's height. */
.scheduler__game-header .status-badge {
  flex: 0 0 auto;
  line-height: 1;
}
.scheduler__game-when { display: flex; align-items: center; gap: 8px; }
.scheduler__game-time { font-size: 14px; font-weight: 600; color: var(--text); white-space: nowrap; }

.scheduler__game-meta {
  /* Match the division-detail card's meta row (`.poolplay-item__meta`):
     12px in `--text`, not `--secondary`. */
  font-size: 12px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.scheduler__game-meta span { margin-left: 4px; }
.scheduler__game-meta span:first-child { margin-left: 0; }

.scheduler__game-teams { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.scheduler__game-team { display: flex; align-items: center; gap: 8px; min-width: 0; }
.scheduler__game-team-name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.scheduler__game-score {
  flex: 0 0 auto;
  margin-left: auto;
  padding-left: 8px;
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.scheduler__game-team--winner .scheduler__game-team-name { font-weight: 700; }
.scheduler__game-team--loser .scheduler__game-team-name,
.scheduler__game-team--loser .scheduler__game-score { color: var(--secondary); font-weight: 500; }
</style>
