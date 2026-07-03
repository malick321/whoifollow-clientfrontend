<script setup lang="ts">
// MatchGeniScoringCard — Field Grid entry point on the dashboard.
// ALWAYS visible to every matchgeni user (anyone who landed on
// the dashboard has at least one matchgeni permission and can
// browse the field grid for situational awareness). The scope
// badge inside the card is the conditional bit — it ONLY renders
// when the caller holds `manage_scoring` (or fullControl). A
// non-scoring matchgeni user (e.g. someone with only
// `manage_umpires`) sees the card with no scope chip, navigates
// in, and gets a read-only field grid — no permitted highlights,
// no actions modal, but full visibility into the day.
//
// Card content is intentionally lean:
//   - Title ("Field Grid").
//   - One-line description so the affordance reads as the primary
//     park-day-at-a-glance action.
//   - Scope chip — only when the caller has scoring rights.
//
// Earlier iterations surfaced live + today game counts on this
// card. They were dropped because (a) the numbers needed a fresh
// per-event aggregate that doesn't exist on the dashboard
// payload (would have required a new endpoint or a payload
// extension), and (b) the live/today framing was ambiguous to
// users — "live now" vs "today" overlap, and the actual scope
// the counts cover depends on the user's `scoringScope` which
// the card already surfaces in plain English. Drop the noise,
// keep the clear handoff.

import { computed } from 'vue'
import { canMatchGeniWrite, matchGeniContext } from '../matchgeni-context'

defineEmits<{
  (event: 'open-scorebook'): void
}>()

/** Compute the scope label from the loaded matchgeni context.
 *  Returns the EMPTY STRING for callers who lack `manage_scoring`
 *  (and aren't full-control) so the template's `v-if="scopeLabel"`
 *  hides the badge entirely. A matchgeni user without scoring
 *  rights gets the card with no chip — the page they land on is
 *  read-only by virtue of `permittedGameIds` being empty.
 *
 *  Mode → label mapping (when scoring rights ARE present):
 *    fullControl: true    → "All games (Full Control)"
 *    null / `all`         → "All parks · All divisions"
 *    `parks` (N parks)    → "N park" / "N parks in scope"
 *    `divisions` (N divs) → "N division" / "N divisions in scope" */
const scopeLabel = computed<string>(() => {
  const access = matchGeniContext.value?.access
  if (!access) return ''
  if (access.fullControl) return 'All games (Full Control)'
  // No scoring permission → no scope chip. The field-grid view
  // handles the empty-permitted-set state on its own.
  if (!canMatchGeniWrite('manage_scoring')) return ''
  const scope = access.scoringScope
  if (!scope || scope.mode === 'all') return 'All parks · All divisions'
  if (scope.mode === 'parks') {
    const n = scope.parkIds.length
    return n === 1 ? '1 park in scope' : `${n} parks in scope`
  }
  if (scope.mode === 'divisions') {
    const n = scope.divisionIds.length
    return n === 1 ? '1 division in scope' : `${n} divisions in scope`
  }
  return ''
})
</script>

<template>
  <button
    type="button"
    class="matchgeni-scoring"
    @click="$emit('open-scorebook')"
  >
    <div class="matchgeni-scoring__body">
      <!-- Title row — heading + scope badge inline. The badge
           sits next to the title as a permission chip so the
           caller's scoring access reads at the same glance as
           the affordance name. -->
      <div class="matchgeni-scoring__title-row">
        <h2 class="matchgeni-scoring__title">Field Grid</h2>
        <span v-if="scopeLabel" class="matchgeni-scoring__scope-badge">
          {{ scopeLabel }}
        </span>
      </div>
      <p class="matchgeni-scoring__copy">
        See park day at a glance and score games in your assigned scope.
      </p>
    </div>
    <!-- Chevron — shared `arrow-right.svg` painted via CSS mask
         so it inherits the card's primary accent. Matches the
         `.matchgeni__quick-link-chev` glyph used by the
         Officials + Umpires cards on the same column. -->
    <span class="matchgeni-scoring__chev" aria-hidden="true"></span>
  </button>
</template>

<style scoped>
/* Attention-anchored primary-tinted card. `<button>` so the
   whole band is the click target (matches the Officials /
   Umpires quick-link cards). Body text on the left + chevron
   pinned to the right. */
.matchgeni-scoring {
  appearance: none;
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 14px 16px;
  background: var(--primary-light-3, #e5f1ff);
  border: 1px solid var(--primary-light-2, #c9e1fc);
  border-left: 3px solid var(--primary);
  border-radius: 10px;
  text-align: left;
  cursor: pointer;
  transition: background-color 120ms ease;
}
.matchgeni-scoring:hover {
  background: rgba(45, 140, 240, 0.18);
}
.matchgeni-scoring:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
html.dark-mode .matchgeni-scoring {
  background: rgba(45, 140, 240, 0.12);
  border-color: rgba(45, 140, 240, 0.28);
  border-left-color: var(--primary);
}
html.dark-mode .matchgeni-scoring:hover {
  background: rgba(45, 140, 240, 0.22);
}

.matchgeni-scoring__body {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

/* Title row — heading + permission badge laid out inline. The
   badge wraps to a second line if the title + label combo
   exceeds the row's width on narrow phone viewports. */
.matchgeni-scoring__title-row {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}
.matchgeni-scoring__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.2;
}

/* Scope badge — matches the event-officials row's
   "Scoring: …" chip 1:1 (`.association-users__row-event-chip`
   in `styles.css`) so the permission indicator reads as the
   same affordance across the portal. Warning-amber palette
   in both themes — the dark-mode override mirrors the source
   chip's brighter amber so the badge stays legible against
   the slate surface. */
.matchgeni-scoring__scope-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  font-family: var(--font-body);
  font-size: 0.78rem;
  font-weight: 500;
  letter-spacing: normal;
  color: #8c6500;
  background: var(--light-warning);
  border: 1px solid rgba(140, 101, 0, 0.25);
  border-radius: 5px;
  white-space: nowrap;
}
html.dark-mode .matchgeni-scoring__scope-badge {
  color: #f7a120;
  background: rgba(247, 161, 32, 0.14);
  border-color: rgba(247, 161, 32, 0.32);
}

/* One-line description — sits directly below the title at the
   same secondary-tinted weight the Officials / Umpires quick-link
   cards use for their supporting copy. */
.matchgeni-scoring__copy {
  margin: 0;
  font-size: 13px;
  color: var(--secondary);
  line-height: 1.35;
}

/* Chevron — shared `arrow-right.svg` painted via CSS mask, same
   pattern the Officials / Umpires quick-link cards use for their
   `.matchgeni__quick-link-chev`. Tints with the card's primary
   accent so it reads as part of the same primary-tinted band. */
.matchgeni-scoring__chev {
  flex: 0 0 auto;
  display: inline-block;
  width: 18px;
  height: 18px;
  background-color: var(--primary);
  -webkit-mask-image: url('../assets/arrow-right.svg');
  mask-image: url('../assets/arrow-right.svg');
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  transition: transform 120ms ease;
}
.matchgeni-scoring:hover .matchgeni-scoring__chev {
  transform: translateX(2px);
}
</style>
