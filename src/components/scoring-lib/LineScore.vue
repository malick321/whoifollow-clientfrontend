<script setup lang="ts">
// LineScore
// ---------
// Reusable inning-by-inning team line-score table. Single source
// of truth for the matchup card on every surface that needs to
// show a game's per-inning runs + R/HR totals — currently the
// scoresheet page and the field-grid game-details drawer; future
// public event page + association recap pages will plug in via
// the same prop contract.
//
// Behaviour rules (mirrored from the original ScoresheetView
// implementation so nothing regresses on that surface):
//
//   - Pre-game (`gameHasStarted: false`) — only the team identity
//     rows render (avatar + seed + name). No inning columns, no
//     Runs/HR summary columns, no Home/Visitor sub-label. The
//     grid template collapses to a single track so there's no
//     empty horizontal scroll.
//   - Started — inning columns appear (one per entry in `innings`),
//     Runs + HR summary columns pin to the right, Home/Visitor
//     sub-label renders under each team name, and the
//     currently-batting team's active inning gets a highlight via
//     `--active` modifier.
//   - Empty inning entries (`row.scores[i]` is `null` / `undefined`)
//     render as `-` so the column always has content (mid-inning
//     games where the bottom team hasn't batted yet).
//   - Head-row first cell (`.scoresheet-linescore__team-head`)
//     hosts an optional status badge — callers pass `headBadge`
//     when they want a chip there (delay reason, live state, etc.)
//     or omit it to leave the cell empty as a grid alignment
//     spacer.
//
// Responsive sizing:
//   - Above 1080px viewport — team column flex-grows
//     (`minmax(220px, 1fr)`) so the row pins data columns to the
//     right edge of the matchup card.
//   - At/below 1080px — team column locks to `min(45vw, 200px)`
//     and the matchup card switches to `overflow-x: auto` with
//     `position: sticky; left` on the team column (handled by the
//     global `.scoresheet-matchup-card` rule in src/styles.css).
//
// CSS:
//   The visual rules all live under `.scoresheet-linescore*` in
//   `src/styles.css` — global so the cell styling, sticky team
//   column, mobile horizontal scroll, summary cell backgrounds,
//   and active-inning highlight apply automatically. This
//   component owns only the layout grid-template calc + the
//   responsive viewport-width listener that drives it.

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import StatusBadge from '../StatusBadge.vue'
import TeamAvatar from '../TeamAvatar.vue'

/** One team's row in the line score. `side` decides the
 *  Home/Visitor sub-label; `isBatting` + the caller's
 *  `currentInning` drive the active-inning highlight. */
export interface LineScoreRow {
  key: string
  name: string
  /** Team logo URL — empty string / undefined falls back to the
   *  initials avatar `TeamAvatar` renders by default. */
  imageUrl?: string | null
  /** Seed prefix shown before the team name ("#1 ", "#5 ", etc.).
   *  Empty / undefined skips the prefix entirely. */
  seed?: string | null
  side: 'H' | 'V'
  isBatting: boolean
  /** Per-inning runs for this team. Length can be < `innings.length`
   *  on mid-inning games — the template renders `-` for any
   *  index that's `null` / `undefined`. */
  scores: Array<number | string | null | undefined>
  runs: number | string
  homeRuns: number | string
}

/** Status chip rendered in the team-head cell. When omitted, the
 *  cell is an empty grid placeholder (used pre-game / when the
 *  caller has surfaced the status elsewhere). */
export interface LineScoreHeadBadge {
  label: string
  tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary'
}

const props = withDefaults(defineProps<{
  /** Inning numbers in order — typically `[1, 2, 3, …]`. The
   *  component renders one header cell per entry. */
  innings: number[]
  /** Two rows — Visitor first, Home second (caller sorts). */
  rows: LineScoreRow[]
  /** Gates the inning columns, Runs/HR summary columns, and
   *  Home/Visitor sub-labels. Pre-game the row collapses to
   *  team identity only. */
  gameHasStarted: boolean
  /** The currently-batting inning. Used together with
   *  `row.isBatting` to highlight the active cell. `null` for
   *  non-live games. */
  currentInning?: number | null
  /** Optional status chip rendered in the team-head cell. */
  headBadge?: LineScoreHeadBadge | null
}>(), {
  currentInning: null,
  headBadge: null
})

// ── Responsive grid-template (mirrored from ScoresheetView) ───
// CSS-grid template for both the header row and each team row.
// Above 1080px the team column flex-grows so data columns pin
// against the right edge; at/below 1080px the team col locks to
// `min(45vw, 200px)` and the matchup card switches to horizontal
// scroll (handled by `.scoresheet-matchup-card` in styles.css).
const viewportWidth = ref(typeof window === 'undefined' ? 1280 : window.innerWidth)
function updateViewportWidth() {
  if (typeof window !== 'undefined') viewportWidth.value = window.innerWidth
}
onMounted(() => {
  if (typeof window !== 'undefined') window.addEventListener('resize', updateViewportWidth)
})
onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('resize', updateViewportWidth)
})

const gridStyle = computed(() => {
  // 1080 matches the existing `@media (max-width: 1080px)` sticky-
  // team breakpoint in styles.css. Keep this in sync with that
  // rule (the matchup card switches to overflow-x: auto + sticky
  // team column at the same width).
  const teamCol = viewportWidth.value <= 1080
    ? 'min(45vw, 200px)'
    : 'minmax(220px, 1fr)'
  // Pre-game — single track only. Matches the v-if gates below
  // (no inning / Runs / HR cells render).
  if (!props.gameHasStarted) {
    return { gridTemplateColumns: teamCol }
  }
  const inningTracks =
    props.innings.length > 0
      ? `repeat(${props.innings.length}, 36px) `
      : ''
  return {
    gridTemplateColumns: `${teamCol} ${inningTracks}52px 44px`
  }
})
</script>

<template>
  <div class="scoresheet-matchup-card">
    <div class="scoresheet-linescore">
      <!-- Header row — team-head badge + inning numbers + Runs/HR.
           Inning + Runs/HR cells gate on `gameHasStarted` so a
           pre-game line-score is just the team-head + team rows
           with no empty columns reserved on the right. -->
      <div class="scoresheet-linescore__header" :style="gridStyle">
        <div class="scoresheet-linescore__team-head">
          <StatusBadge
            v-if="headBadge"
            :label="headBadge.label"
            :tone="headBadge.tone"
          />
        </div>
        <template v-if="gameHasStarted">
          <div
            v-for="inning in innings"
            :key="`inning-head-${inning}`"
            class="scoresheet-linescore__colhead"
          >{{ inning }}</div>
          <div class="scoresheet-linescore__colhead scoresheet-linescore__colhead--summary">Runs</div>
          <div class="scoresheet-linescore__colhead scoresheet-linescore__colhead--summary">HR</div>
        </template>
      </div>

      <!-- Team rows. Pre-game shows only team identity (avatar +
           seed + name); started games add inning cells + Runs/HR
           summary cells. Active-inning highlight only fires for
           the currently-batting team's current inning. -->
      <div
        v-for="row in rows"
        :key="row.key"
        class="scoresheet-linescore__row"
        :style="gridStyle"
      >
        <div class="scoresheet-linescore__team">
          <TeamAvatar :name="row.name" :image-url="row.imageUrl ?? undefined" size="sm" />
          <div class="scoresheet-linescore__team-copy">
            <strong>{{ row.seed ? `${row.seed} ` : '' }}{{ row.name }}</strong>
            <!-- Home / Visitor label is meaningful once the game
                 has actually started. Before then, hide it —
                 pre-game the row is just the team identity. -->
            <span v-if="gameHasStarted">{{ row.side === 'H' ? 'Home' : 'Visitor' }}</span>
          </div>
        </div>
        <template v-if="gameHasStarted">
          <div
            v-for="inning in innings"
            :key="`${row.key}-inning-${inning}`"
            class="scoresheet-linescore__value"
            :class="{
              'scoresheet-linescore__value--active':
                row.isBatting && currentInning === inning
            }"
          >{{ row.scores[inning - 1] ?? '-' }}</div>
          <div class="scoresheet-linescore__value scoresheet-linescore__value--summary">{{ row.runs }}</div>
          <div class="scoresheet-linescore__value scoresheet-linescore__value--summary">{{ row.homeRuns }}</div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Final / completed state — neutral-toned head badge ("F") gets
   the secondary background treatment instead of the global pale-
   grey neutral. Matches the F chip styling used on the field-
   grid cell pill so the "this game is done" visual reads
   identically across cell + linescore + drawer surfaces.
   Scoped via `:deep()` so the override sticks even though the
   `.status-badge` markup lives in a child component. */
/* Neutral-tone status pill inside the line-score head cell —
   use the SOLID slate background + white text treatment in both
   light AND dark modes. The previous dark-mode tint
   (`rgba(255, 255, 255, 0.16)` + `#d6dde6`) was too subtle on
   the slate-blue line-score head cell, leaving the F glyph
   nearly invisible. The solid `var(--secondary)` paint reads
   cleanly across both themes (the token already flips between
   light + dark values), with white text for guaranteed contrast
   regardless of which slate the bg resolves to. Mirrors the
   field-grid game-card pill's light-mode treatment, just applied
   uniformly. */
:deep(.scoresheet-linescore__team-head .status-badge[data-tone='neutral']) {
  background: var(--secondary);
  color: #ffffff;
}
</style>
