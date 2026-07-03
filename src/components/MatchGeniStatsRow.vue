<script setup lang="ts">
// MatchGeniStatsRow
// -----------------
// "Event people" card at the top of the LEFT (divisions) column of the
// MatchGeni dashboard — the humans who run the event: the Director (read
// only contact block) plus the Officials + Umpires access surfaces.
//
// Layout: ONE card split by a vertical rule. Left = Director person
// block; right = two stacked, tappable rows (Officials over Umpires)
// divided by a horizontal rule. Each right row carries a leading
// two-tone icon, a count + label, a one-line helper, and a trailing
// chevron — mirroring the Officials / Umpires quick-link cards in the
// right column, so the navigational intent reads the same across both.
//
// Two-tone SVGs are imported `?raw` + inlined via `v-html` (not the
// usual CSS mask) so the `opacity="0.4"` outer shape survives — masks
// flatten to a single-colour silhouette. `fill="currentColor"` on each
// path picks up the surrounding colour and themes cleanly light/dark.

import type { MatchGeniStats } from '../types'
import directorIcon    from '../assets/director-twotone.svg?raw'

defineProps<{
  stats: MatchGeniStats
}>()

const emit = defineEmits<{
  (event: 'open', target: 'officials' | 'umpires'): void
}>()

// MOCK — first-look content only. The Director (name / email / phone +
// country code) lives on the event table and will ride along in the
// MatchGeni access payload; Officials / Umpires counts come from their
// endpoints. TODO: wire to real data once the payload carries them.
const director = {
  name: 'Asad Mirza',
  email: 'asadmirza@mailinator.com',
  phoneDisplay: '+92 300 1234567'
}
const officialsCount = 4
const umpiresCount = 6
</script>

<template>
  <div class="matchgeni-people">
    <!-- LEFT — Director person block (informational). -->
    <div class="matchgeni-people__director">
      <span class="matchgeni-people__avatar" aria-hidden="true" v-html="directorIcon" />
      <div class="matchgeni-people__director-text">
        <span class="matchgeni-people__eyebrow">Director</span>
        <strong class="matchgeni-people__name">{{ director.name }}</strong>
        <span class="matchgeni-people__sub">{{ director.email }}</span>
        <span class="matchgeni-people__sub">{{ director.phoneDisplay }}</span>
      </div>
    </div>

    <!-- RIGHT — two tappable access rows split by a horizontal rule. -->
    <div class="matchgeni-people__access">
      <button type="button" class="matchgeni-people__row" @click="emit('open', 'officials')">
        <span class="matchgeni-people__row-text">
          <span class="matchgeni-people__row-heading">
            <strong class="matchgeni-people__row-count">{{ officialsCount }}</strong>
            <span class="matchgeni-people__row-label">Officials</span>
          </span>
          <span class="matchgeni-people__row-copy">Per-event access for scoring, scheduling &amp; more.</span>
        </span>
        <span class="matchgeni-people__row-chev" aria-hidden="true" />
      </button>

      <button type="button" class="matchgeni-people__row" @click="emit('open', 'umpires')">
        <span class="matchgeni-people__row-text">
          <span class="matchgeni-people__row-heading">
            <strong class="matchgeni-people__row-count">{{ umpiresCount }}</strong>
            <span class="matchgeni-people__row-label">Umpires</span>
          </span>
          <span class="matchgeni-people__row-copy">Invite &amp; assign umpires to games.</span>
        </span>
        <span class="matchgeni-people__row-chev" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<style scoped>
/* One unified translucent card (frosted over the page gradient), split
   into the Director block + the access rows. */
.matchgeni-people {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
  border-radius: 8px;
  background: var(--surface-raised);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  border: 1px solid var(--border-divider);
  box-shadow: 0 1px 2px rgba(13, 30, 58, 0.04);
  overflow: hidden;
}

/* ── Director (left) ── */
.matchgeni-people__director {
  display: flex;
  /* Vertically centre the avatar + text block within the section. */
  align-items: center;
  gap: 16px;
  padding: 16px 18px;
}
.matchgeni-people__avatar {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: rgba(45, 140, 240, 0.1);
  color: var(--primary);
}
html.dark-mode .matchgeni-people__avatar {
  background: rgba(127, 176, 232, 0.16);
  color: #7fb0e8;
}
.matchgeni-people__avatar :deep(svg) {
  width: 30px;
  height: 30px;
  display: block;
}
.matchgeni-people__director-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
/* Shared eyebrow — caps meta-label (matches the portal's eyebrow). */
.matchgeni-people__eyebrow {
  font-size: 0.72rem;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--secondary);
}
.matchgeni-people__name {
  margin-top: 2px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.matchgeni-people__sub {
  margin-top: 2px;
  font-size: 12px;
  color: var(--text);
  line-height: 1.35;
  overflow-wrap: anywhere;
}

/* ── Access rows (right) ── */
.matchgeni-people__access {
  position: relative;
  display: flex;
  flex-direction: column;
}
/* Vertical rule between Director and the access rows — INSET from the
   card's top/bottom (like the teams-participating card's dividers) so
   it doesn't connect with the card border or the horizontal rule. */
.matchgeni-people__access::before {
  content: '';
  position: absolute;
  left: 0;
  top: 14px;
  bottom: 14px;
  width: 1px;
  background: var(--border-divider);
}
.matchgeni-people__row {
  position: relative;
  flex: 1 1 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  text-align: left;
  background: none;
  border: 0;
  cursor: pointer;
  font-family: var(--font-body);
  transition: background-color 120ms ease;
}
.matchgeni-people__row:hover {
  background: rgba(45, 140, 240, 0.06);
}
html.dark-mode .matchgeni-people__row:hover {
  background: rgba(127, 176, 232, 0.08);
}
/* Horizontal rule between the two rows — INSET on the left so it clears
   the vertical rule (they never touch) and on the right for symmetry. */
.matchgeni-people__row + .matchgeni-people__row::before {
  content: '';
  position: absolute;
  top: 0;
  left: 14px;
  right: 14px;
  height: 1px;
  background: var(--border-divider);
}
.matchgeni-people__row-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1 1 auto;
}
.matchgeni-people__row-heading {
  display: inline-flex;
  align-items: baseline;
  gap: 7px;
}
.matchgeni-people__row-count {
  font-size: 16px;
  font-weight: 500;
  color: var(--text);
  line-height: 1.1;
}
/* Sentence-case label (not the caps eyebrow) — matches the
   teams-participating stat labels. */
.matchgeni-people__row-label {
  font-size: 13px;
  color: var(--secondary);
}
.matchgeni-people__row-copy {
  margin-top: 2px;
  font-size: 12px;
  color: var(--secondary);
  line-height: 1.35;
}
.matchgeni-people__row-chev {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  align-self: center;
  background-color: var(--secondary);
  -webkit-mask: url('../assets/arrow-right.svg') center / contain no-repeat;
  mask: url('../assets/arrow-right.svg') center / contain no-repeat;
}

/* ── Mobile — stack: director on top (rule becomes a bottom border),
   the two access rows beneath. ── */
@media (max-width: 720px) {
  .matchgeni-people {
    grid-template-columns: minmax(0, 1fr);
  }
  /* Stacked — the vertical rule is replaced by a director bottom border
     (inset to match the teams-card look). */
  .matchgeni-people__access::before {
    display: none;
  }
  .matchgeni-people__director {
    position: relative;
  }
  .matchgeni-people__director::after {
    content: '';
    position: absolute;
    left: 16px;
    right: 16px;
    bottom: 0;
    height: 1px;
    background: var(--border-divider);
  }
  /* Drop the helper copy on mobile so the rows stay compact. */
  .matchgeni-people__row-copy {
    display: none;
  }
}
</style>
