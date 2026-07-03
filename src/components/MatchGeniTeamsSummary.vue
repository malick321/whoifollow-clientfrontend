<script setup lang="ts">
// MatchGeniTeamsSummary
// ---------------------
// Right-column "teams participating" card on the MatchGeni dashboard.
// Shows the total count plus a four-stat breakdown — one tile per
// `participation_status` bucket (Pending / Confirmed / Waitlist /
// Withdrawn). Vertical tile layout (icon on top, label + count
// below) so all four sit comfortably in a single row on the
// dashboard's right column. The "Manage Teams" CTA routes to the
// per-event Participating Teams sub-page (out of scope here —
// the parent owns the route via the `manage-teams` emit).

import type { MatchGeniTeamsSummary } from '../types'
import { canMatchGeniWrite } from '../matchgeni-context'

// Two-tone status glyphs imported as raw SVG strings + inlined
// via `v-html` (same pattern `MatchGeniStatsRow` uses for the
// dashboard's Active / Delayed / Progress tiles). Each glyph
// uses `fill="currentColor"` on the inner shape with
// `opacity="0.4"` on the outer disc, so the icon picks up the
// parent stat-icon chip's themed `color:` and renders cleanly
// in light + dark mode.
import tickTwotoneIcon        from '../assets/tick-circle-twotone.svg?raw'
import timeTwotoneIcon        from '../assets/time-twotone.svg?raw'
import exclamationTwotoneIcon from '../assets/exclamation-circle-twotone.svg?raw'
import minusTwotoneIcon       from '../assets/minus-circle-twotone.svg?raw'

defineProps<{
  summary: MatchGeniTeamsSummary
}>()

defineEmits<{
  (event: 'manage-teams'): void
}>()
</script>

<template>
  <section class="matchgeni-teams">
    <header class="matchgeni-teams__header">
      <div class="matchgeni-teams__heading">
        <strong>{{ summary.total }}</strong>
        <span>teams participating</span>
      </div>
      <!-- Gated by `manage_team_participation` — hidden for users
           who can only view the stats (e.g. a `manage_umpires`-only
           grant). Full Control users keep seeing the button. -->
      <button
        v-if="canMatchGeniWrite('manage_team_participation')"
        type="button"
        class="association-users__invite-btn matchgeni-teams__manage-btn"
        @click="$emit('manage-teams')"
      >Manage Teams</button>
    </header>

    <!-- Four-stat row — one tile per `participation_status` bucket.
         Vertical layout (icon on top, label + count below) so all
         four tiles fit in one row without wrapping. Icons use the
         design-library two-tone glyphs (`*-twotone.svg`) inlined
         via `v-html` so the `opacity="0.4"` outer disc survives
         and the icon picks up the chip's themed `color:`. Order
         matches the participation lifecycle: Pending → Confirmed
         → Waitlist → Withdrawn. -->
    <div class="matchgeni-teams__stats">
      <div class="matchgeni-teams__stat">
        <span
          class="matchgeni-teams__stat-icon matchgeni-teams__stat-icon--pending"
          aria-hidden="true"
          v-html="timeTwotoneIcon"
        />
        <span class="matchgeni-teams__stat-label">Pending</span>
        <strong class="matchgeni-teams__stat-count">{{ summary.pending }}</strong>
      </div>
      <div class="matchgeni-teams__stat">
        <span
          class="matchgeni-teams__stat-icon matchgeni-teams__stat-icon--confirmed"
          aria-hidden="true"
          v-html="tickTwotoneIcon"
        />
        <span class="matchgeni-teams__stat-label">Confirmed</span>
        <strong class="matchgeni-teams__stat-count">{{ summary.confirmed }}</strong>
      </div>
      <div class="matchgeni-teams__stat">
        <span
          class="matchgeni-teams__stat-icon matchgeni-teams__stat-icon--waitlisted"
          aria-hidden="true"
          v-html="exclamationTwotoneIcon"
        />
        <span class="matchgeni-teams__stat-label">Waitlist</span>
        <strong class="matchgeni-teams__stat-count">{{ summary.waitlisted }}</strong>
      </div>
      <div class="matchgeni-teams__stat">
        <span
          class="matchgeni-teams__stat-icon matchgeni-teams__stat-icon--withdrawn"
          aria-hidden="true"
          v-html="minusTwotoneIcon"
        />
        <span class="matchgeni-teams__stat-label">Withdrawn</span>
        <strong class="matchgeni-teams__stat-count">{{ summary.withdrawn }}</strong>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* Single card holding the header + the four-stat row. The stats are
   split by vertical dividers (no per-stat container) — same approach
   as the division-details overview card. */
.matchgeni-teams {
  background: var(--white);
  border: 1px solid var(--border-divider);
  border-radius: 8px;
  padding: 16px;
}
html.dark-mode .matchgeni-teams {
  background: var(--surface-card);
}

.matchgeni-teams__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.matchgeni-teams__heading {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  color: var(--secondary);
  font-size: 14px;
}

.matchgeni-teams__heading strong {
  font-size: 18px;
  color: var(--text);
}

/* Visual fill + hover come from the shared `.association-users__invite-btn`
   class — same solid `var(--primary)` treatment used by the users-page
   Invite User button. No gradient; dark-mode-aware. The local rule
   stays empty; geometry comes from the shared class. */
.matchgeni-teams__manage-btn {
  /* Inherits from .association-users__invite-btn */
}

.matchgeni-teams__stats {
  display: grid;
  /* Four equal columns — one per participation_status bucket. No
     gap; adjacent stats are separated by a vertical divider. */
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--border-divider);
}

/* Two-row tile — row 1: icon + count centered around the tile's
   midline; row 2: label below.
   Layout strategy: two equal 1fr columns. The icon is placed in
   the left column with `justify-self: end` (right edge of col 1
   = tile midline); the count is placed in the right column with
   `justify-self: start` (left edge of col 2 = tile midline).
   The `column-gap` of 6px gives the visible breathing room
   between them. Result: `[icon] [count]` is precisely
   horizontally centred around the tile's centerline, regardless
   of tile width or count digit count — no reliance on flex
   alignment. The label spans both columns on row 2 and uses
   `text-align: center`. */
.matchgeni-teams__stat {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-areas:
    'icon count'
    'label label';
  column-gap: 6px;
  row-gap: 2px;
  align-items: center;
  text-align: center;
  padding: 4px 6px;
  min-width: 0;
}
/* Vertical divider between adjacent stats (no per-stat container). */
.matchgeni-teams__stat + .matchgeni-teams__stat {
  border-left: 1px solid var(--border-divider);
}
.matchgeni-teams__stat-icon {
  grid-area: icon;
  /* Pin to right edge of col 1 (= tile midline). The column-gap
     then provides the 6px breathing room before the count. */
  justify-self: end;
}
.matchgeni-teams__stat-count {
  grid-area: count;
  /* Pin to left edge of col 2 (= tile midline + gap). */
  justify-self: start;
}
.matchgeni-teams__stat-label {
  grid-area: label;
}

/* Stat icon — direct host for the inlined two-tone SVG. No
   colored chip background anymore; the two-tone effect
   (opacity-0.4 outer disc + solid inner shape) does the visual
   work and the per-status `color:` tint themes the whole glyph
   in light + dark mode. */
.matchgeni-teams__stat-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
}

/* Force the inlined two-tone SVGs to render at the chip's
   footprint regardless of the source file's intrinsic
   `width`/`height` attributes. Same `:deep(svg)` pattern
   `MatchGeniStatsRow` uses for the dashboard stat-row icons. */
.matchgeni-teams__stat-icon :deep(svg) {
  width: 22px;
  height: 22px;
  display: block;
}

/* Per-status tints — same palette family the association portal
   StatusBadge component uses (success / warning / primary /
   danger) so dark mode picks up the established colours
   automatically. The `color:` flows down to the inlined SVG's
   `currentColor` paths. */
.matchgeni-teams__stat-icon--confirmed {
  color: #16763a;
}
html.dark-mode .matchgeni-teams__stat-icon--confirmed {
  color: #7ad48a;
}

.matchgeni-teams__stat-icon--pending {
  color: #8c6500;
}
html.dark-mode .matchgeni-teams__stat-icon--pending {
  color: #f7a120;
}

/* Waitlist — neutral cool-blue, signals "in queue / awaiting
   capacity" without competing with the warning amber on pending. */
.matchgeni-teams__stat-icon--waitlisted {
  color: var(--primary);
}
html.dark-mode .matchgeni-teams__stat-icon--waitlisted {
  color: #7fb0e8;
}

/* Withdrawn — danger tone reads as "pulled out / no longer
   participating". Same palette the StatusBadge "danger" tone
   uses across the portal. */
.matchgeni-teams__stat-icon--withdrawn {
  color: #aa2b37;
}
html.dark-mode .matchgeni-teams__stat-icon--withdrawn {
  color: #ff9aa6;
}

.matchgeni-teams__stat-label {
  font-size: 12px;
  color: var(--secondary);
  white-space: nowrap;
  line-height: 1.2;
}

/* Stat count — sits below the label, larger + bolder so the
   number is the visual anchor of the tile. */
.matchgeni-teams__stat-count {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
  line-height: 1.1;
}

/* Mobile — keep the 4-up row. The new compact tile shape
   (icon+count inline on row 1, label on row 2) is narrow
   enough that all four tiles fit even on small mobile widths
   without needing to drop to a 2×2 grid. The earlier 2×2
   fallback was added when the tile was a 3-row vertical stack
   that simply couldn't go below ~80px wide; that constraint
   no longer applies. */
</style>
