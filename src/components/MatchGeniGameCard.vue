<script setup lang="ts">
// MatchGeniGameCard
// -----------------
// Single source of truth for the game-pill markup rendered inside
// every MatchGeni scheduling table cell. Used by:
//   - MatchGeniFieldGridView (scoring surface) — passes `permitted`
//     per cell so the operator's scope-restricted view dims cells
//     they don't have permission for.
//   - MatchGeniSchedulerView (admin scheduling) — always renders
//     in the permitted (interactive) state; doesn't carry a
//     permission concept.
//
// Was duplicated as a `#cell` slot in the field-grid view PLUS a
// separate default cell render inside `MatchGeniFieldGrid.vue`.
// Extracted here so the two surfaces share one rendering — when
// design tweaks the card (winner-highlight rules, status-badge
// placement, etc.) it lands in both views with no drift.
//
// Pure presentation: the component reads game state + a resolved
// division name string + a `permitted` flag and renders the card.
// Click handling lives on the parent `<td>` (driven by the
// `MatchGeniFieldGrid` component's `cell-click` / `cell-drop`
// events), so this card stays a plain visual.

import { computed } from 'vue'
import StatusBadge from './StatusBadge.vue'
import { themeMode } from '../theme'
import { divisionTone } from '../lib/divisionTone'
import { minutesFromMidnight, formatTimeLabel } from '../api/schedulerTimeAxis'
import type { SchedulerGame } from '../types'

/** Tone palette matches `StatusBadge`'s `tone` prop. Inlined here
 *  rather than imported because `StatusBadge.vue` doesn't export
 *  the union as a named type; duplicating it keeps this component
 *  type-safe without forcing a refactor of the badge component. */
type StatusBadgeTone =
  | 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary' | 'secondary'

const props = withDefaults(defineProps<{
  /** The game payload being rendered. */
  game: SchedulerGame
  /** Resolved division name — the parent owns the division
   *  catalogue (per the existing `divisionNameById` map in both
   *  consuming views), so it passes the string here. Empty string
   *  / `undefined` suppresses the division eyebrow row. */
  divisionName?: string
  /** Permission gating — when `false`, the card paints the dimmed
   *  read-only variant (dashed border, 0.55 opacity). Defaults to
   *  `true` so the scheduler view (which has no permission concept)
   *  can omit the prop entirely. */
  permitted?: boolean
  /** Card size variant — driven by `MatchGeniFieldGrid` from
   *  the game's effective duration / grid-row span:
   *    - `'full'`  (≥ 3 rows / ≥ 90 min): head row (division +
   *                status) + game label + time-span + two-column
   *                teams-with-scores block.
   *    - `'compact'` (2 rows / 60 min): head + label +
   *                time-span + a one-line "team1 vs team2 |
   *                score" condensed row.
   *    - `'mini'`  (1 row / 30 min): head + a single condensed
   *                line with the pool label on the left and
   *                "#1 vs #2" seed shorthand on the right. No
   *                time-span / no team names.
   *  Default `'full'` so off-grid surfaces (drawer header,
   *  source-list cards) keep the richest variant. */
  size?: 'full' | 'compact' | 'mini'
  /** When `true`, tint the card's background + division eyebrow
   *  using a deterministic palette indexed off `game.divisionId`
   *  — so every game in the same division reads as a colour
   *  group on the calendar grid. Mirrors the `TeamAvatar`
   *  palette (six pale tints in light mode, six deep tints in
   *  dark mode) so a division that hashes to "teal" stays teal
   *  across both modes. Default `false` so callers on
   *  read-only / mixed surfaces (drawer header etc.) keep the
   *  uniform primary-tinted card. */
  tonedByDivision?: boolean
  /** Effective duration in minutes — used to compute the
   *  "8:30 – 10:00 AM" time-span label below the game name.
   *  When absent, the card falls back to `game.durationMinutes`
   *  and finally to 90 (the legacy fixed-slot cadence). The
   *  parent typically passes the calendar-resolved value (after
   *  park-default fallback), so this stays correct on grid
   *  surfaces. Time span is suppressed entirely in `compact`
   *  mode — the card doesn't have vertical room there. */
  durationMinutes?: number
  /** Selection (bulk event-day management). `selectable` renders the
   *  hover/selection checkbox before the division; `selected` marks it
   *  on; `selectionActive` keeps every selectable card's box visible
   *  while a selection is in progress. */
  selectable?: boolean
  selected?: boolean
  selectionActive?: boolean
}>(), {
  divisionName: '',
  permitted: true,
  size: 'full',
  tonedByDivision: false,
  durationMinutes: undefined,
  selectable: false,
  selected: false,
  selectionActive: false
})

const emit = defineEmits<{
  (event: 'toggle-select'): void
}>()

const isFull = computed(() => props.size === 'full')
const isCompact = computed(() => props.size === 'compact')
const isMini = computed(() => props.size === 'mini')

/** Extract the leading "#N" seed token from a team label
 *  like "#6: GENESIS/ONYX/BG" → "#6". Falls back to the first
 *  space-or-colon-delimited token for labels that don't follow
 *  the seed convention (e.g. "Winner of G3" → "Winner"). The
 *  mini variant uses this so the team-vs-team summary stays
 *  readable in a ~50px-wide slot. */
function extractSeed(label: string | null | undefined): string {
  if (!label) return '?'
  const m = label.match(/^(#\d+)/)
  if (m) return m[1]
  return label.split(/[\s:]/)[0] || label
}

/** Inline-style payload — CSS custom properties consumed by the
 *  `.matchgeni-game-card--toned` block in the scoped CSS below.
 *  Returns an empty object (no overrides) when `tonedByDivision`
 *  is off so the default primary-tinted styles win. `themeMode`
 *  is reactive — flipping themes repaints the card's tone
 *  without a remount. */
/** Effective duration — the parent's resolved value wins; falls
 *  back to the game's own `durationMinutes`, then to 90 (legacy
 *  cadence). Mirrors the `effectiveGameDurationMinutes` helper
 *  on the calendar utility. */
const effectiveDuration = computed<number>(() => {
  if (props.durationMinutes && props.durationMinutes > 0) return props.durationMinutes
  if (props.game.durationMinutes && props.game.durationMinutes > 0) return props.game.durationMinutes
  return 90
})

/** Time-span label rendered below the game name on non-compact
 *  cards. Examples:
 *    - "8:30 – 10:00 AM"  (same meridiem — collapse leading AM/PM)
 *    - "11:00 AM – 12:30 PM"  (different meridiem — keep both)
 *  Returns an empty string when the start time is missing /
 *  unparseable so the template can `v-if` cleanly. */
const timeSpanLabel = computed<string>(() => {
  if (!props.game.scheduledTime) return ''
  const startMin = minutesFromMidnight(props.game.scheduledTime)
  if (!Number.isFinite(startMin)) return ''
  const endMin = startMin + effectiveDuration.value
  const startLabel = formatTimeLabel(startMin)
  const endLabel = formatTimeLabel(endMin)
  // Collapse the leading meridiem when both sides match —
  // "8:30 AM – 10:00 AM" reads as cluttered next to
  // "8:30 – 10:00 AM" for the same information.
  const startMeridiem = startLabel.slice(-2)
  const endMeridiem = endLabel.slice(-2)
  if (startMeridiem === endMeridiem) {
    const startTime = startLabel.slice(0, -3).trim()
    return `${startTime} – ${endLabel}`
  }
  return `${startLabel} – ${endLabel}`
})

const divisionToneStyle = computed<Record<string, string>>(() => {
  if (!props.tonedByDivision) return {}
  const choice = divisionTone(props.game.divisionId, themeMode.value === 'dark')
  const result: Record<string, string> = {
    '--card-tone-bg': choice.bg,
    '--card-tone-border': choice.border,
    '--card-tone-fg': choice.fg
  }
  return result
})

/** Human-readable status label rendered in the `StatusBadge`. */
function statusBadgeLabel(status: SchedulerGame['status']): string {
  if (status === 'live') return 'Live'
  if (status === 'delayed') return 'Delayed'
  if (status === 'final') return 'Final'
  return 'Yet to begin'
}

/** Tone palette per status. Mirrors the participation-card status
 *  tones so a "Live" pill carries the same red `danger` tone here
 *  as on a participation card. Finals use `neutral` (grey) rather
 *  than `success` — "completed" reads more accurate than
 *  "good outcome" since the chip applies to every team that
 *  finishes. */
function statusBadgeTone(status: SchedulerGame['status']): StatusBadgeTone {
  if (status === 'live') return 'danger'
  if (status === 'delayed') return 'warning'
  if (status === 'final') return 'secondary'
  return 'info'
}

/** `true` when the game has started — drives the score column's
 *  visibility (scheduled games show "Yet to / Begin" instead). */
const hasStarted = computed(() => {
  const s = props.game.status
  return s === 'live' || s === 'delayed' || s === 'final'
})

/** Status-badge visibility — suppressed for `scheduled` games so
 *  the most-common cell state stays uncluttered. The "Yet to
 *  Begin" label in the score column already telegraphs that
 *  state, no badge needed. */
const showStatusBadge = computed(() => hasStarted.value)

/** `true` for any pre-game state (scheduled or status-missing). */
const showYetToBegin = computed(() => {
  const s = props.game.status
  return !s || s === 'scheduled'
})

/** Side that won — only meaningful for finals. Returns `null`
 *  pre-game or during a tied final (defensive — the mock data
 *  guarantees no ties, but the check is cheap). */
const winnerSide = computed<1 | 2 | null>(() => {
  if (props.game.status !== 'final') return null
  const s1 = props.game.team1Score ?? 0
  const s2 = props.game.team2Score ?? 0
  if (s1 === s2) return null
  return s1 > s2 ? 1 : 2
})

function isWinner(side: 1 | 2): boolean {
  return winnerSide.value === side
}
</script>

<template>
  <article
    class="matchgeni-game-card"
    :class="[
      `matchgeni-game-card--${size}`,
      {
        'matchgeni-game-card--permitted': permitted,
        'matchgeni-game-card--dimmed': !permitted,
        'matchgeni-game-card--toned': tonedByDivision,
        'matchgeni-game-card--selected': selected,
        'matchgeni-game-card--selection-active': selectionActive
      }
    ]"
    :style="divisionToneStyle"
  >
    <!-- Head row — visible in ALL three size variants. Division eyebrow
         (+ the selection checkbox). The status badge now sits beside the
         game NAME below, not here. -->
    <div class="matchgeni-game-card__head">
      <!-- Selection checkbox (bulk event-day management) — hover- or
           selection-revealed, sits before the division. `.stop` so it
           doesn't trigger the card's open/drag on the grid wrapper. -->
      <label
        v-if="selectable"
        class="matchgeni-game-card__select"
        @click.stop
        @mousedown.stop
      >
        <input
          type="checkbox"
          :checked="selected"
          :aria-label="`Select ${game.label}`"
          @click.stop
          @change="emit('toggle-select')"
        >
      </label>
      <span
        v-if="divisionName"
        class="matchgeni-game-card__division"
      >{{ divisionName }}</span>
      <span v-else class="matchgeni-game-card__division-spacer"></span>
    </div>

    <!-- ── MINI variant (30 min / 1 row) ───────────────────────
         Just the head + one condensed row:
           LEFT  — pool label (e.g. "Pool 4")
           RIGHT — "#1 vs #2" seed shorthand
         No time span, no full team names — both would clip in
         the ~32px vertical room a 30-min slot provides after
         the head row + padding. -->
    <div
      v-if="isMini"
      class="matchgeni-game-card__mini-row"
    >
      <span class="matchgeni-game-card__mini-name">
        <span class="matchgeni-game-card__mini-label">{{ game.label }}</span>
        <StatusBadge
          v-if="showStatusBadge"
          class="matchgeni-game-card__status"
          :label="statusBadgeLabel(game.status)"
          :tone="statusBadgeTone(game.status)"
        />
      </span>
      <span class="matchgeni-game-card__mini-vs">
        <span :class="{ 'matchgeni-game-card__team-name--winner': isWinner(1) }">{{ extractSeed(game.team1Label) }}</span>
        <span class="matchgeni-game-card__compact-vs">vs</span>
        <span :class="{ 'matchgeni-game-card__team-name--winner': isWinner(2) }">{{ extractSeed(game.team2Label) }}</span>
      </span>
    </div>

    <!-- ── COMPACT (60 min / 2 rows) + FULL (≥90 min / 3+ rows)
         Both render the label + time-span subtitle. Then:
           COMPACT → one-line "team1 vs team2 | score" condensed
                     block under the timespan (no per-team
                     stacked names).
           FULL    → the two-column stacked team-names + scores
                     block. -->
    <template v-else>
      <div class="matchgeni-game-card__label-row">
        <span class="matchgeni-game-card__label">{{ game.label }}</span>
        <StatusBadge
          v-if="showStatusBadge"
          class="matchgeni-game-card__status"
          :label="statusBadgeLabel(game.status)"
          :tone="statusBadgeTone(game.status)"
        />
      </div>
      <span
        v-if="timeSpanLabel"
        class="matchgeni-game-card__timespan"
      >{{ timeSpanLabel }}</span>
      <div
        v-if="isCompact"
        class="matchgeni-game-card__compact-row"
      >
        <span class="matchgeni-game-card__compact-teams">
          <span :class="{ 'matchgeni-game-card__team-name--winner': isWinner(1) }">{{ game.team1Label || '—' }}</span>
          <span class="matchgeni-game-card__compact-vs">vs</span>
          <span :class="{ 'matchgeni-game-card__team-name--winner': isWinner(2) }">{{ game.team2Label || '—' }}</span>
        </span>
        <span v-if="hasStarted" class="matchgeni-game-card__compact-score">
          {{ game.team1Score ?? 0 }}–{{ game.team2Score ?? 0 }}
        </span>
        <span v-else class="matchgeni-game-card__compact-pending">Yet to begin</span>
      </div>
    </template>
    <!-- Full-only: two-column stacked teams block. Hidden on
         compact and mini variants. -->
    <div v-if="isFull" class="matchgeni-game-card__teams">
      <div class="matchgeni-game-card__team-names">
        <span
          v-if="game.team1Label"
          class="matchgeni-game-card__team-name"
          :class="{ 'matchgeni-game-card__team-name--winner': isWinner(1) }"
        >{{ game.team1Label }}</span>
        <span
          v-if="game.team2Label"
          class="matchgeni-game-card__team-name"
          :class="{ 'matchgeni-game-card__team-name--winner': isWinner(2) }"
        >{{ game.team2Label }}</span>
      </div>
      <!-- Right column — scores OR "Yet to / Begin" label.
           Two lines either way so the column height matches the
           names column visually. -->
      <div
        v-if="hasStarted"
        class="matchgeni-game-card__team-scores"
      >
        <span
          class="matchgeni-game-card__team-score"
          :class="{ 'matchgeni-game-card__team-score--winner': isWinner(1) }"
        >{{ game.team1Score ?? 0 }}</span>
        <span
          class="matchgeni-game-card__team-score"
          :class="{ 'matchgeni-game-card__team-score--winner': isWinner(2) }"
        >{{ game.team2Score ?? 0 }}</span>
      </div>
      <div
        v-else-if="showYetToBegin"
        class="matchgeni-game-card__yet-to-begin"
      >
        <span>Yet to</span>
        <span>Begin</span>
      </div>
    </div>
  </article>
</template>

<style scoped>
.matchgeni-game-card {
  display: flex;
  flex-direction: column;
  /* Slightly larger gap + padding so the bumped-up font sizes
     below have breathing room. The card now sits inside a 44px-
     per-30-min row, so the extra vertical space is available. */
  gap: 3px;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--border-divider);
  background: var(--surface-card);
  height: 100%;
  min-width: 0;
  /* `overflow: hidden` clips any inner content whose min-content
     exceeds the card's actual rendered width — without this, a
     long team name / division eyebrow / time-span string could
     leak past the card's right edge and trigger page-level
     horizontal scroll on narrow grid columns. The inner spans
     already carry their own `text-overflow: ellipsis`; this
     wrapper-level clip is the belt to those suspenders. */
  overflow: hidden;
  transition: box-shadow 120ms ease, transform 120ms ease;
}

/* Permitted — primary-tinted, interactive. The cell's parent
   `<td>` carries the click handler so the card stays a pure
   visual; `cursor: pointer` is the affordance cue. */
.matchgeni-game-card--permitted {
  border-color: var(--border-accent);
  background: var(--primary-light-3);
  cursor: pointer;
}

/* Division-toned override — when `tonedByDivision` is on, the
   card's bg + border resolve from CSS custom properties set
   inline on the article (computed by the hash of
   `game.divisionId`). Wins over the `--permitted` primary-tint
   above without needing `!important` because both selectors
   carry one class (the inline-style fallback ensures the
   tone actually applies even if a downstream consumer wraps
   the card with their own permitted/dimmed state).
   The division eyebrow + winner text pick up the `--fg`
   variant so the eyebrow reads as the same colour family as
   the card body rather than the global primary-blue. */
.matchgeni-game-card--toned.matchgeni-game-card--permitted,
.matchgeni-game-card--toned {
  background: var(--card-tone-bg, var(--primary-light-3));
  border-color: var(--card-tone-border, var(--border-accent));
}
.matchgeni-game-card--toned .matchgeni-game-card__division {
  color: var(--card-tone-fg, var(--primary));
}
.matchgeni-game-card--permitted:hover {
  box-shadow: 0 2px 6px rgba(36, 60, 91, 0.12);
}
html.dark-mode .matchgeni-game-card--permitted {
  /* Solid color in dark mode (no alpha-transparency). Previously
     this was `rgba(45, 140, 240, 0.18)` which let the calendar's
     gridlines + scrolling content show faintly through the card.
     A solid pre-mixed dark-blue surface gives the same visual
     weight without the see-through effect. */
  background: #1f3148;
}

/* Dimmed — visible for spatial awareness but inert. Dashed border
   telegraphs the "look but don't touch" state. Used by the
   field-grid scoring surface for cells outside the operator's
   permission scope. Light mode keeps the original opacity wash;
   dark mode swaps opacity for a solid muted surface so the card
   doesn't become semi-transparent against the dark page bg. */
/* Dimmed (no-score-permission) state — full opacity in BOTH
   themes. Distinguishability comes from a muted SOLID bg +
   dashed border + secondary-toned text, not from an opacity
   wash. The old `opacity: 0.55` made the entire card
   translucent, which let the calendar gridlines (hour + half-
   hour subdivisions) show THROUGH the card body — defeating
   the card's role as a visual block over the grid. */
.matchgeni-game-card--dimmed {
  opacity: 1;
  background: #eef1f5;
  border-style: dashed;
  border-color: var(--border-divider);
  color: var(--secondary);
  cursor: default;
}
html.dark-mode .matchgeni-game-card--dimmed {
  background: #232a35;
  border-color: rgba(255, 255, 255, 0.12);
  color: var(--secondary);
}

/* Head row — division on the left, status badge on the right. */
.matchgeni-game-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
}
/* Selection checkbox — fully hidden (no reserved space, division stays
   flush-left) until the card is hovered, a selection is in progress, or
   this card is selected. `display` toggle (not opacity) so the box
   doesn't occupy layout when idle. */
.matchgeni-game-card__select {
  flex: 0 0 auto;
  display: none;
  align-items: center;
  cursor: pointer;
}
.matchgeni-game-card:hover .matchgeni-game-card__select,
.matchgeni-game-card--selection-active .matchgeni-game-card__select,
.matchgeni-game-card--selected .matchgeni-game-card__select {
  display: inline-flex;
}
.matchgeni-game-card__select input {
  width: 15px;
  height: 15px;
  margin: 0;
  accent-color: var(--primary);
  cursor: pointer;
}
/* Selected ring — outline (no layout shift). */
.matchgeni-game-card--selected {
  outline: 2px solid var(--primary);
  outline-offset: -2px;
}
.matchgeni-game-card__division {
  font-size: 12px;
  font-weight: 700;
  color: var(--primary);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  line-height: 1.15;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1 1 auto;
}
.matchgeni-game-card__division-spacer {
  flex: 1 1 auto;
  min-width: 0;
}

/* Compact StatusBadge inside the card — slightly smaller than
   the participation-card default since the cell is narrow. */
.matchgeni-game-card__status {
  flex: 0 0 auto;
}
.matchgeni-game-card__status :deep(.status-badge),
.matchgeni-game-card__status.status-badge {
  font-size: 10px;
  padding: 2px 7px;
  letter-spacing: 0.02em;
}

/* Division eyebrow flips to secondary tone when the card is
   dimmed — keeps the headline group muted alongside the body. */
.matchgeni-game-card--dimmed .matchgeni-game-card__division {
  color: var(--secondary);
}

/* Label row — game name on the left, status badge on the right. */
.matchgeni-game-card__label-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.matchgeni-game-card__label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1 1 auto;
  min-width: 0;
}

/* Time-span subtitle — small secondary text right under the
   game name. Reads as supporting metadata, not a primary
   element, so font-size + color back off from the label. The
   en-dash separator is kept inline ("8:30 – 10:00 AM") for the
   tightest read. */
.matchgeni-game-card__timespan {
  font-size: 13px;
  font-weight: 500;
  color: var(--secondary);
  line-height: 1.2;
  letter-spacing: 0.01em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
html.dark-mode .matchgeni-game-card__timespan {
  color: rgba(255, 255, 255, 0.55);
}

.matchgeni-game-card__teams {
  display: flex;
  align-items: stretch;
  gap: 8px;
  font-size: 12px;
  color: var(--text);
  line-height: 1.3;
  min-width: 0;
  overflow: hidden;
  /* `margin: auto 0` on a flex column item makes the
     remaining vertical space SPLIT equally between top and
     bottom — so the gap between the timespan text above and
     the teams block equals the gap between the teams block
     and the card's bottom padding. The header items (head,
     label, timespan) stay tightly clustered at the top of
     the card with their default 3px flex gap; the teams
     block then floats in the centre of the residual column
     space, producing the symmetric breathing room the
     stacked layout was missing. */
  margin: auto 0;
  min-width: 0;
}
.matchgeni-game-card__team-names {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.matchgeni-game-card__team-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

/* Score column — same vertical rhythm as the names column. */
.matchgeni-game-card__team-scores {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.matchgeni-game-card__team-score {
  font-weight: 500;
  color: var(--text);
}

/* Final-game winner — bolder weight on the winning team's name
   AND score so the card reads at a glance as "this team won".
   Only fires for FINAL games (`isWinner` short-circuits on every
   other status). */
.matchgeni-game-card__team-name--winner,
.matchgeni-game-card__team-score--winner {
  font-weight: 700;
  color: var(--text);
}

/* "Yet to Begin" — occupies the same right column the scores
   would. Two stacked spans so the vertical rhythm matches the
   team-names column on the left. */
/* Compact mode — collapses the teams block to a single row.
   Triggered by the field-grid when the card spans ≤ 2 calendar
   rows (60-min games on the 30-min axis). */
.matchgeni-game-card--compact {
  padding: 6px 8px;
  gap: 2px;
}
/* Mini variant (30-min slot, 1 grid row of ~44px) — tightest
   padding so the head row + the single condensed pool / seed-vs
   line both fit in the available vertical room. */
.matchgeni-game-card--mini {
  padding: 4px 8px;
  gap: 1px;
}
/* Mini's one condensed line under the head — pool label on
   the left, "#1 vs #2" seed shorthand on the right. */
.matchgeni-game-card__mini-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
  margin-top: auto;
  margin-bottom: auto;
  font-size: 11px;
  line-height: 1.2;
  min-width: 0;
}
/* Mini name group — game name + status badge, left side of the row. */
.matchgeni-game-card__mini-name {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  flex: 1 1 auto;
}
.matchgeni-game-card__mini-label {
  font-weight: 700;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 0 1 auto;
}
.matchgeni-game-card__mini-vs {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  font-weight: 500;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  flex: 0 0 auto;
  white-space: nowrap;
}
.matchgeni-game-card__compact-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  /* Bumped to 12px (was 11px) so the team-vs-team line in
     compact (60-min) mode is comfortably readable now that
     the slot has more vertical room from the 44px-per-30-min
     grid bump. */
  font-size: 12px;
  color: var(--text);
  line-height: 1.3;
  min-width: 0;
  margin-top: auto;
}
.matchgeni-game-card__compact-teams {
  flex: 1 1 auto;
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.matchgeni-game-card__compact-teams > span:not(.matchgeni-game-card__compact-vs) {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.matchgeni-game-card__compact-vs {
  color: var(--secondary);
  font-weight: 500;
  flex: 0 0 auto;
}
.matchgeni-game-card__compact-score {
  flex: 0 0 auto;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.matchgeni-game-card__compact-pending {
  flex: 0 0 auto;
  color: var(--secondary);
  font-size: 10px;
  font-style: italic;
}

.matchgeni-game-card__yet-to-begin {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: center;
  gap: 1px;
  font-size: 11px;
  font-weight: 500;
  color: var(--secondary);
  letter-spacing: 0.02em;
  line-height: 1.2;
}
</style>
