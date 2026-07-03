<script setup lang="ts">
// MatchGeniDivisionList
// ---------------------
// Left-column list of `event_tournaments` rows on the MatchGeni
// dashboard. A fast, navigation-only surface: each row shows the
// division's date range + name plus two cheap compute-on-read counts
// (teams + brackets) and the division's format summary. Clicking a row
// opens the division-detail page, which renders the full pool / seed /
// bracket breakdown for that one division.
//
// Deliberately NO phase-status pills / progress ring / game count here
// — those are high-churn aggregates that would force per-row
// multi-table joins for a list that can reach 50–60 rows. See
// `docs/api/matchgeni-division-api-contract.md` §4.
//
// The header above the list carries:
//   - "{N} divisions" count + search input
//   - "Game Scheduler" secondary button (wired in a follow-up)
//   - "Add Division" primary button (opens the create modal)

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import type { MatchGeniDivisionSummary } from '../types'
import { canMatchGeniWrite } from '../matchgeni-context'

// ── Sticky-header shadow ─────────────────────────────────────────
// Toggles a `--stuck` class on the header when the sticky pinning
// kicks in, so we can paint a drop-shadow only while pinned (no
// shadow at rest — it'd read as visual noise on the card surface).
// Same IntersectionObserver-on-sentinel pattern MatchGeniHeader uses
// for its own stuck-state detection.
const isStuck = ref(false)
const stickySentinelRef = ref<HTMLElement | null>(null)
let stickyObserver: IntersectionObserver | null = null

onMounted(() => {
  if (typeof IntersectionObserver === 'undefined') return
  if (!stickySentinelRef.value) return
  stickyObserver = new IntersectionObserver(
    ([entry]) => {
      // When the sentinel scrolls off the top of the viewport the
      // header has started pinning — flip the stuck flag.
      isStuck.value = !entry.isIntersecting
    },
    { rootMargin: '0px', threshold: 0 }
  )
  stickyObserver.observe(stickySentinelRef.value)
})

onBeforeUnmount(() => {
  if (stickyObserver) stickyObserver.disconnect()
})

const props = defineProps<{
  divisions: MatchGeniDivisionSummary[]
}>()

const emit = defineEmits<{
  (event: 'add-division'): void
  (event: 'open-division', division: MatchGeniDivisionSummary): void
}>()

const search = ref('')

const filteredDivisions = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return props.divisions
  return props.divisions.filter((d) =>
    d.name.toLowerCase().includes(q)
  )
})
</script>

<template>
  <section class="matchgeni-divisions">
    <!-- Sticky-stuck sentinel — zero-height div rendered just
         before the sticky header. An IntersectionObserver watches
         it: when it scrolls out of the viewport the header has
         started pinning, so we flip `isStuck = true` and paint a
         shadow on the header to give it depth above the rows
         passing beneath. Same pattern MatchGeniHeader uses. -->
    <div ref="stickySentinelRef" class="matchgeni-divisions__sticky-sentinel" aria-hidden="true"></div>
    <header
      class="matchgeni-divisions__header"
      :class="{ 'matchgeni-divisions__header--stuck': isStuck }"
    >
      <label class="matchgeni-divisions__search">
        <AppIcon name="search" :size="14" />
        <input
          v-model="search"
          type="search"
          :placeholder="`Search ${divisions.length} divisions`"
          class="matchgeni-divisions__search-input"
        />
      </label>
      <!-- Notifications + Game Scheduler now live in the event's left nav
           rail (dedicated menu items), so they're no longer duplicated here. -->
      <!-- Add Division — gated by `manage_divisions`. -->
      <button
        v-if="canMatchGeniWrite('manage_divisions')"
        type="button"
        class="association-users__invite-btn matchgeni-divisions__btn matchgeni-divisions__btn--primary"
        @click="emit('add-division')"
      >
        +&nbsp;Add Division
      </button>
    </header>

    <div v-if="filteredDivisions.length === 0" class="matchgeni-divisions__empty">
      <p v-if="search.trim()">No divisions match "{{ search }}".</p>
      <p v-else>No divisions yet. Click "Add Division" to start.</p>
    </div>

    <ul v-else class="matchgeni-divisions__list">
      <li
        v-for="d in filteredDivisions"
        :key="d.id"
        class="matchgeni-divisions__row"
        role="button"
        tabindex="0"
        @click="emit('open-division', d)"
        @keydown.enter="emit('open-division', d)"
        @keydown.space.prevent="emit('open-division', d)"
      >
        <div class="matchgeni-divisions__row-identity">
          <span class="matchgeni-divisions__row-dates">{{ d.dateRangeLabel }}</span>
          <strong class="matchgeni-divisions__row-name">{{ d.name }}</strong>
        </div>

        <!-- Pool Play + Brackets breakdown (right side, before the
             chevron). Per-bracket detail + tie-breaker come from the
             list endpoint — see contract §4. -->
        <div class="matchgeni-divisions__row-detail">
          <div class="matchgeni-divisions__detail-section">
            <span class="matchgeni-divisions__detail-line">
              <strong>{{ d.teamCount }}</strong> {{ d.teamCount === 1 ? 'team' : 'teams' }}
            </span>
            <span class="matchgeni-divisions__detail-line">
              {{ d.poolPlayGuarantee != null ? `${d.poolPlayGuarantee} game round robin` : 'Event default' }}
            </span>
            <span v-if="d.poolTieBreaker" class="matchgeni-divisions__detail-sub">
              {{ d.poolTieBreaker }}
            </span>
          </div>
          <div class="matchgeni-divisions__detail-section">
            <div v-if="d.brackets && d.brackets.length" class="matchgeni-divisions__bracket-cards">
              <div
                v-for="b in d.brackets"
                :key="b.name"
                class="matchgeni-divisions__bracket-card"
              >
                <span class="matchgeni-divisions__bracket-eyebrow">
                  <span
                    v-if="b.status"
                    class="matchgeni-divisions__bracket-dot app-tooltip app-tooltip--right"
                    :class="`matchgeni-divisions__bracket-dot--${b.statusTone ?? 'neutral'}`"
                    :data-tooltip="b.status"
                    :aria-label="b.status"
                  ></span>
                  {{ b.teamCount }} {{ b.teamCount === 1 ? 'team' : 'teams' }}
                </span>
                <span class="matchgeni-divisions__bracket-name">{{ b.name }}</span>
                <span class="matchgeni-divisions__bracket-type">{{ b.format }}</span>
              </div>
            </div>
            <span v-else class="matchgeni-divisions__detail-sub">No brackets yet</span>
          </div>
        </div>

        <span class="matchgeni-divisions__row-chev" aria-hidden="true"></span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.matchgeni-divisions {
  background: var(--white);
  border-radius: 8px;
  border: 1px solid var(--border-divider);
  /* No `overflow: hidden` — that would make this card the
     sticky-scroll ancestor for the header below, and sticky
     would never activate (the card itself doesn't scroll
     internally). Letting the header escape to the viewport
     scroll context is what enables the "pin to top under the
     matchgeni-header" behaviour. The top corners stay rounded
     via the header's matching `border-radius` below. */
}

.matchgeni-divisions__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-divider);
  /* Fully opaque background — was `var(--surface-muted)` which
     is `rgba(255, 255, 255, 0.75)` in light and
     `rgba(26, 32, 40, 0.85)` in dark. Both let the division
     rows scrolling underneath bleed through when this header is
     stuck. Using the solid hex equivalents instead so the row
     reads as a clean card-top divider on either theme. */
  background: #fbfcfe;
  /* Pin under the matchgeni-header (sticky z=50, ~70px tall +
     small gap). Once the user scrolls past the divisions card's
     top, the count + search + Game Scheduler + Add Division row
     stays glued to the top. z-index high enough to paint over
     the division rows passing behind it. */
  position: sticky;
  /* `--matchgeni-header-height` is published by MatchGeniHeader.vue
     at runtime via a ResizeObserver. Pins flush against the
     header's bottom edge across every viewport / title-wrap
     combination. The `-1px` overlap-guarantee tucks this row's
     top edge under the matchgeni header's bottom by 1px so
     sub-pixel rounding can never leave a hairline gap of
     page background between them. */
  top: calc(var(--matchgeni-header-height, 56px) - 1px);
  z-index: 5;
  /* Match the card's top corners so the header doesn't render
     a square corner against the rounded card edge. Bottom stays
     square because the divider row sits flush against it. */
  border-radius: 8px 8px 0 0;
}
html.dark-mode .matchgeni-divisions__header {
  /* Solid dark slate (same hex `--surface-chrome` resolves to,
     but without the translucency that would let division rows
     show through when the header is stuck). */
  background: #131c2e;
}

/* Sticky-stuck sentinel — zero-height marker sitting just above
   the sticky header. The IntersectionObserver in the script
   watches its visibility: visible = header at rest (no shadow),
   off-screen = header is pinned (shadow on). */
.matchgeni-divisions__sticky-sentinel {
  height: 0;
  margin: 0;
  padding: 0;
  pointer-events: none;
}

/* Stuck-state shadow — applied only when the header has started
   pinning (sentinel scrolled off). Soft drop-shadow below the
   row gives the pinned header depth above the division rows
   sliding underneath; at rest, no shadow keeps the card surface
   clean. `transition` on box-shadow smooths the on/off so the
   shadow doesn't pop in jarringly when the user crosses the
   threshold. */
.matchgeni-divisions__header {
  transition: box-shadow 180ms ease;
}
.matchgeni-divisions__header--stuck {
  box-shadow: 0 6px 14px rgba(13, 30, 58, 0.12);
}
html.dark-mode .matchgeni-divisions__header--stuck {
  box-shadow: 0 6px 14px rgba(0, 0, 0, 0.5);
}

.matchgeni-divisions__count {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  font-size: 14px;
  color: var(--secondary);
}

.matchgeni-divisions__count strong {
  font-size: 16px;
  color: var(--text);
}

/* Search pill — visible control with a real border so it reads
   as a search affordance against the section's white card
   surface. Matches the `.association-users__search` styling
   pattern (used on the Users portal toolbar) so the look stays
   consistent across portal toolbars. */
.matchgeni-divisions__search {
  flex: 1 1 auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  height: 36px;
  border-radius: 5px;
  background: var(--white);
  border: 1px solid var(--border-divider);
  color: var(--secondary);
}
html.dark-mode .matchgeni-divisions__search {
  background: rgba(255, 255, 255, 0.04);
  border-color: var(--border-divider);
}

.matchgeni-divisions__search-input {
  flex: 1 1 auto;
  background: transparent;
  border: none;
  outline: none;
  font: inherit;
  color: var(--text);
}

.matchgeni-divisions__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  /* Keep button labels on one line — at narrow widths the
     "Game Scheduler" / "+ Add Division" labels would otherwise
     break across lines inside the pill, which looks broken. The
     mobile breakpoint moves the buttons onto a second row of the
     header instead. */
  white-space: nowrap;
}

.matchgeni-divisions__btn--ghost {
  background: var(--surface-muted, #eef3fb);
  color: var(--text);
  border-color: var(--border-divider);
}

.matchgeni-divisions__btn--ghost:hover {
  background: var(--surface-card-hover, #e3ebf6);
}

html.dark-mode .matchgeni-divisions__btn--ghost {
  background: rgba(255, 255, 255, 0.06);
}
html.dark-mode .matchgeni-divisions__btn--ghost:hover {
  background: rgba(255, 255, 255, 0.10);
}

/* Inline icon glyph for the ghost button. Same mask-image pattern
   the AssociationSidebar nav uses (`assets/calendar.svg`), tinted
   via the parent button's `currentColor` so it themes cleanly in
   both light + dark. Width matches the AppIcon size we replaced. */
.matchgeni-divisions__btn-icon {
  display: inline-block;
  width: 14px;
  height: 14px;
  background-color: currentColor;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}
.matchgeni-divisions__btn-icon--calendar {
  -webkit-mask-image: url('../assets/calendar.svg');
  mask-image: url('../assets/calendar.svg');
}

/* `.matchgeni-divisions__btn--primary` inherits its visual fill +
   hover treatment from the shared `.association-users__invite-btn`
   class (same solid `var(--primary)` styling the users-page Invite
   button uses — no gradient, dark-mode-aware). The local rule body
   stays empty; the geometry comes from the `--btn` base rule above. */
.matchgeni-divisions__btn--primary {
  /* Inherits from .association-users__invite-btn */
}

.matchgeni-divisions__list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.matchgeni-divisions__row {
  display: grid;
  /* Division info hugs its content (the date is the widest line, so the
     column is just wide enough to show it fully) → the detail block
     takes the remaining space (Pool Play pinned left, Brackets pinned
     right, slack between them) → a fixed slot for the chevron. */
  grid-template-columns: max-content minmax(0, 1fr) 16px;
  align-items: center;
  gap: 16px;
  padding: 14px 18px;
  border-top: 1px solid var(--border-divider);
  /* Hover feedback — light primary tint so the row reads as an
     interactive target (each row links to the division's detail
     view). Same hover language the events list rows use. */
  cursor: pointer;
  transition: background-color 120ms ease;
}
/* Hover tone matches the `.association-users__row:hover` and
   `.association-events-row:hover` treatment used across the
   portal — a barely-there 4% primary alpha in light mode and
   8% in dark. */
.matchgeni-divisions__row:hover {
  background: rgba(45, 140, 240, 0.04);
}
html.dark-mode .matchgeni-divisions__row:hover {
  background: rgba(45, 140, 240, 0.08);
}

.matchgeni-divisions__row:first-child {
  border-top: none;
}

.matchgeni-divisions__row-identity {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.matchgeni-divisions__row-dates {
  font-size: 12px;
  /* Use the primary text token so the date reads with proper
     contrast in light mode — the previous `var(--secondary)`
     dropped to a soft cool-blue that was hard to read against
     the white row surface. Dark-mode override below keeps the
     existing softer treatment that already had enough contrast. */
  color: var(--text);
}
html.dark-mode .matchgeni-divisions__row-dates {
  color: var(--text);
}

.matchgeni-divisions__row-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Pool Play + Brackets breakdown. Pool keeps a readable baseline width
   but yields its slack to the Brackets column as its cards grow (which
   then scrolls internally only once it has borrowed all it can). */
.matchgeni-divisions__row-detail {
  display: flex;
  gap: 24px;
  min-width: 0;
}
.matchgeni-divisions__detail-section {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
/* Pool Play — fills leftover space but never below a readable minimum. */
.matchgeni-divisions__detail-section:first-child {
  flex: 1 1 0;
  min-width: 150px;
}
/* Brackets — sized to its cards; grows into the pool's space as content
   grows, shrinking (→ internal scroll) only when nothing's left. Its
   content centers vertically against the taller Pool column. */
.matchgeni-divisions__detail-section:last-child {
  flex: 0 1 auto;
  min-width: 0;
  justify-content: center;
}
.matchgeni-divisions__detail-line {
  font-size: 13px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Global `strong { font-weight: 400 }` would flatten the count — restore
   the emphasis explicitly. */
.matchgeni-divisions__detail-line strong {
  font-weight: 600;
  color: var(--text);
}

/* Brackets — horizontal mini-cards (mirrors the division-detail bracket
   chips): an eyebrow "N teams · format" line over the bracket name +
   status badge. Wrap to a new line when they don't fit. */
.matchgeni-divisions__bracket-cards {
  display: flex;
  flex-wrap: nowrap;
  gap: 8px;
  min-width: 0;
  /* Stay on one horizontal line; scroll within the column if they
     overflow (scrollbar hidden). */
  overflow-x: auto;
  scrollbar-width: none;
}
.matchgeni-divisions__bracket-cards::-webkit-scrollbar { display: none; }
.matchgeni-divisions__bracket-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 0 0 auto;
  /* Same chip style as the Playing Facility schedule-row card. */
  padding: 12px 14px;
  border: 1px solid var(--border-divider);
  border-radius: 8px;
  background: var(--surface-raised, #f4f8fd);
}
/* Eyebrow — status dot + team count. */
.matchgeni-divisions__bracket-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--secondary);
  white-space: nowrap;
}
/* Status dot — depicts the bracket's lifecycle in place of a badge. */
.matchgeni-divisions__bracket-dot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--secondary);
}
/* Bracket-state palette (canonical mapping in `src/lib/bracketStatus.ts`):
   pending=neutral, initiated=warning, in_progress=success,
   completed=primary, cancelled=danger. */
/* Neutral = a true grey (NOT --secondary, which is a navy/blue accent and
   would read as an active state). Matches the StatusBadge neutral tone. */
.matchgeni-divisions__bracket-dot--neutral { background: #8a97a8; }
html.dark-mode .matchgeni-divisions__bracket-dot--neutral { background: #6b7785; }
.matchgeni-divisions__bracket-dot--primary { background: var(--primary, #2d8cf0); }
.matchgeni-divisions__bracket-dot--success { background: #22a06b; }
.matchgeni-divisions__bracket-dot--warning { background: #d69e2e; }
.matchgeni-divisions__bracket-dot--danger { background: var(--danger, #e5484d); }
.matchgeni-divisions__bracket-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Format — moved below the name to keep the card narrow. */
.matchgeni-divisions__bracket-type {
  font-size: 12px;
  color: var(--secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.matchgeni-divisions__detail-sub {
  font-size: 13px;
  color: var(--secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Trailing chevron — shared `arrow-right.svg` painted via CSS mask
   so it inherits color + themes across light/dark. Signals the row
   navigates into the division-detail page. */
.matchgeni-divisions__row-chev {
  flex: 0 0 auto;
  justify-self: end;
  width: 16px;
  height: 16px;
  background-color: var(--secondary);
  -webkit-mask-image: url('../assets/arrow-right.svg');
  mask-image: url('../assets/arrow-right.svg');
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
}

.matchgeni-divisions__empty {
  padding: 40px 24px;
  text-align: center;
  color: var(--secondary);
}

/* ≤720px — two-row mobile layout:
     Row 1: identity (date / name / team count).
     Row 2: Pool Play + Brackets breakdown. The desktop 3-column grid
            collapses to a two-area stack; the chevron spans both rows
            at the right. */
@media (max-width: 720px) {
  .matchgeni-divisions__row {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      "identity chev"
      "pool     chev"
      "brackets brackets";
    gap: 8px 12px;
    padding: 12px 14px;
  }
  .matchgeni-divisions__row-identity { grid-area: identity; }
  /* Dissolve the detail wrapper so its two sections place directly in
     the row grid: Pool sits beside the chevron, Brackets spans the full
     width on its own row so its card strip can scroll horizontally. */
  .matchgeni-divisions__row-detail { display: contents; }
  .matchgeni-divisions__detail-section:first-child {
    grid-area: pool;
    min-width: 0;
  }
  .matchgeni-divisions__detail-section:last-child {
    grid-area: brackets;
    min-width: 0;
  }
  /* Chevron spans the identity + pool rows, centered against them. */
  .matchgeni-divisions__row-chev {
    grid-area: chev;
    align-self: center;
  }
}

/* ≤720px — push the two buttons (Game Scheduler + Add Division)
   onto a second header row so they don't squeeze the search box
   and don't force their labels to wrap mid-text. CSS grid with
   named template areas is the cleanest way to lock the layout:
     Row 1: count + search
     Row 2: ghost button + primary button (equal-width). */
@media (max-width: 720px) {
  /* Two-row mobile header — flex-wrap so the items break across
     rows naturally. Sizing chosen so the items land in the
     desired layout:
       Row 1: count (auto width) + search (flexes to fill rest).
       Row 2: ghost button + primary button (equal-width, each
              `flex-basis: calc(50% - 6px)` to account for the
              12px gap split between the two siblings).
     Grid layout was discarded here because grid-template-columns
     applies to every row — making row 1's `min-content / 1fr`
     mean row 2's first column was always narrower than the
     second. Flex with wrap is the cleanest fit. */
  .matchgeni-divisions__header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 12px;
  }
  .matchgeni-divisions__count {
    flex: 0 0 auto;
    /* Keep the count label on a single line so it doesn't bloat
       row 1's height. */
    white-space: nowrap;
  }
  .matchgeni-divisions__search {
    /* Fills the remainder of row 1 next to the count. `flex-basis:
       calc(100% - 110px)` is wide enough to push the two buttons
       below it onto row 2; `min-width` keeps the pill readable on
       the smallest phones. */
    flex: 1 1 calc(100% - 110px);
    min-width: 140px;
  }
  .matchgeni-divisions__btn--ghost,
  .matchgeni-divisions__btn--primary {
    /* Each button takes half of row 2 — `flex-basis: calc(50% - 6px)`
       accounts for the 12px gap split equally between the pair. */
    flex: 1 1 calc(50% - 6px);
    width: auto;
  }
}
</style>
