<script setup lang="ts">
// MatchGeniPoolPlayGameItem
// -------------------------
// Admin Pool Play game card in the shared LIST style (same visual as the
// public item) PLUS interactivity: the whole card opens the scoring/game
// details drawer (emit `open`). No per-card kebab — game editing happens from
// the game details drawer. Stays dumb — the parent owns the drawer; this
// imports no auth/drawer code. Uses the shared `.poolplay-item__*` classes
// (src/styles.css).

import TeamAvatar from './TeamAvatar.vue'
import StatusBadge from './StatusBadge.vue'
import type { SchedulerGame } from '../types'

type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary' | 'secondary'

defineProps<{
  game: SchedulerGame
  /** Resolved park name (parent maps it; no mock coupling in the card). */
  parkLabel?: string
}>()

const emit = defineEmits<{
  (event: 'open', game: SchedulerGame): void
}>()

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
    class="poolplay-item poolplay-item--interactive"
    role="button"
    tabindex="0"
    :aria-label="`Open ${game.label} details`"
    @click="emit('open', game)"
    @keydown.enter="emit('open', game)"
    @keydown.space.prevent="emit('open', game)"
  >
    <div class="poolplay-item__slot">
      <span class="poolplay-item__nameline">
        <span class="poolplay-item__name">{{ game.label }}</span>
        <StatusBadge
          v-if="game.status"
          :label="statusBadge(game.status).label"
          :tone="statusBadge(game.status).tone"
        />
      </span>
      <div class="poolplay-item__when">
        <span class="poolplay-item__time">{{ game.scheduledTime || 'TBD' }}</span>
      </div>
      <div v-if="game.scheduledFieldLabel || parkLabel" class="poolplay-item__meta">
        <span v-if="game.scheduledFieldLabel">{{ game.scheduledFieldLabel }}</span>
        <span v-if="game.scheduledFieldLabel && parkLabel" aria-hidden="true">·</span>
        <span v-if="parkLabel">{{ parkLabel }}</span>
      </div>
    </div>

    <div class="poolplay-item__teams">
      <div class="poolplay-item__team-col">
        <span
          class="poolplay-item__team"
          :class="{ 'poolplay-item__team--winner': teamResult(game, 1) === 'win', 'poolplay-item__team--loser': teamResult(game, 1) === 'loss' }"
        >
          <TeamAvatar :name="game.team1Label ?? ''" size="sm" />
          <span class="poolplay-item__team-name">{{ game.team1Label }}</span>
          <span v-if="scored(game)" class="poolplay-item__score">{{ game.team1Score }}</span>
        </span>
        <span
          class="poolplay-item__team"
          :class="{ 'poolplay-item__team--winner': teamResult(game, 2) === 'win', 'poolplay-item__team--loser': teamResult(game, 2) === 'loss' }"
        >
          <TeamAvatar :name="game.team2Label ?? ''" size="sm" />
          <span class="poolplay-item__team-name">{{ game.team2Label }}</span>
          <span v-if="scored(game)" class="poolplay-item__score">{{ game.team2Score }}</span>
        </span>
      </div>
      <span v-if="!scored(game) && (game.status ?? 'scheduled') === 'scheduled'" class="poolplay-item__pending">Yet to begin</span>
    </div>
  </article>
</template>

<style scoped>
/* Game name + status badge on one line (badge moved off the time row).
   Name truncates; the badge stays put (doesn't flex). */
.poolplay-item__nameline {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}
.poolplay-item__nameline .poolplay-item__name {
  flex: 0 1 auto;
  min-width: 0;
  /* Cancel the shared `.poolplay-item--interactive .poolplay-item__name`
     26px right padding (reserved for the old kebab) so the badge sits
     snug against the name. */
  padding-right: 0;
}
.poolplay-item__nameline .status-badge {
  flex: 0 0 auto;
  /* Tight line-height so the badge doesn't grow the name row's height. */
  line-height: 1;
}
</style>

