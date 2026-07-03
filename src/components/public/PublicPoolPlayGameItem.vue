<script setup lang="ts">
// PublicPoolPlayGameItem
// ----------------------
// Read-only Pool Play game card for the public event page. Pure presentation
// (no click/handlers, no auth imports) so it's safe in the logged-out bundle.
// Uses the shared `.poolplay-item__*` classes (src/styles.css).

import TeamAvatar from '../TeamAvatar.vue'
import StatusBadge from '../StatusBadge.vue'
import type { PublicDivisionGame } from '../../types'

type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary' | 'secondary'

defineProps<{ game: PublicDivisionGame }>()

function gameStatusBadge(s: NonNullable<PublicDivisionGame['status']>): { label: string; tone: BadgeTone } {
  switch (s) {
    case 'live': return { label: 'Live', tone: 'danger' }
    case 'delayed': return { label: 'Delayed', tone: 'warning' }
    case 'final': return { label: 'Final', tone: 'secondary' }
    default: return { label: 'Scheduled', tone: 'neutral' }
  }
}
function gameScored(g: PublicDivisionGame): boolean {
  return g.team1Score != null && g.team2Score != null
}
/** Win / loss for a side once scored — winner bold, loser muted. Ties = ''. */
function teamResult(g: PublicDivisionGame, side: 1 | 2): 'win' | 'loss' | '' {
  if (!gameScored(g) || g.team1Score === g.team2Score) return ''
  const team1Wins = (g.team1Score as number) > (g.team2Score as number)
  if (side === 1) return team1Wins ? 'win' : 'loss'
  return team1Wins ? 'loss' : 'win'
}
</script>

<template>
  <article class="poolplay-item">
    <div class="poolplay-item__slot">
      <span v-if="game.label || game.status" class="poolplay-item__nameline">
        <span v-if="game.label" class="poolplay-item__name">{{ game.label }}</span>
        <StatusBadge
          v-if="game.status"
          :label="gameStatusBadge(game.status).label"
          :tone="gameStatusBadge(game.status).tone"
        />
      </span>
      <div class="poolplay-item__when">
        <span class="poolplay-item__time">{{ game.time || 'TBD' }}</span>
      </div>
      <div v-if="game.field || game.park" class="poolplay-item__meta">
        <span v-if="game.field">{{ game.field }}</span>
        <span v-if="game.field && game.park" aria-hidden="true">·</span>
        <span v-if="game.park">{{ game.park }}</span>
      </div>
    </div>
    <div class="poolplay-item__teams">
      <div class="poolplay-item__team-col">
        <span
          class="poolplay-item__team"
          :class="{ 'poolplay-item__team--winner': teamResult(game, 1) === 'win', 'poolplay-item__team--loser': teamResult(game, 1) === 'loss' }"
        >
          <TeamAvatar :name="game.team1" size="sm" />
          <span class="poolplay-item__team-name">{{ game.team1 }}</span>
          <span v-if="gameScored(game)" class="poolplay-item__score">{{ game.team1Score }}</span>
        </span>
        <span
          class="poolplay-item__team"
          :class="{ 'poolplay-item__team--winner': teamResult(game, 2) === 'win', 'poolplay-item__team--loser': teamResult(game, 2) === 'loss' }"
        >
          <TeamAvatar :name="game.team2" size="sm" />
          <span class="poolplay-item__team-name">{{ game.team2 }}</span>
          <span v-if="gameScored(game)" class="poolplay-item__score">{{ game.team2Score }}</span>
        </span>
      </div>
      <span v-if="!gameScored(game) && game.status === 'scheduled'" class="poolplay-item__pending">Yet to begin</span>
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
}
.poolplay-item__nameline .status-badge {
  flex: 0 0 auto;
  /* Tight line-height so the badge doesn't grow the name row's height. */
  line-height: 1;
}
</style>
