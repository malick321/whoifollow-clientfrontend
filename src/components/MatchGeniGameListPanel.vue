<script setup lang="ts">
// MatchGeniGameListPanel
// ----------------------
// Reusable vertical game list with optional date grouping + sticky
// date headers. Hosts the left-column game list on the matchgeni
// scheduler (drag-drop target) and the matchgeni scoring page
// (game picker). Future umpires sub-page will reuse the same
// component with an `assignedToMe` filter applied upstream.
//
// Headless on the row markup — callers supply the per-game card
// via the `#game-row` slot. This keeps each surface's row
// presentation (drag affordances, score state, assignment state)
// distinct without piling 30-prop tagged unions on the panel.
//
// Slots:
//   - `#game-row="{ game, isSelected }"` — caller's card markup,
//     one render per game. Receives the game + a selection flag.
//   - `#header-toolbar` — optional toolbar painted above the list
//     (filter pills, search, phase tabs). Sits OUTSIDE the
//     scroll container so it doesn't scroll with the cards.
//   - `#empty-state` — optional caller-supplied empty UI; default
//     is the `emptyMessage` prop rendered in a centered block.
//
// Sticky chain:
//   The date group headers stick to the panel's internal scroll
//   container top. Callers that have their own sticky chrome
//   above the panel (e.g. the scheduler's bracket-pager toolbar
//   pinned to `top: 0` of the same scroll container) should set
//   `--game-list-sticky-top` on a wrapping element so the date
//   headers stick BELOW that chrome instead of overlapping it.

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { SchedulerGame } from '../types'

interface DateGroup {
  /** Stable key — ISO date OR the sentinel `'unscheduled'`. */
  key: string
  /** Human-readable header label rendered above the group. */
  label: string
  games: SchedulerGame[]
}

const props = withDefaults(defineProps<{
  /** Flat game list. The panel groups + sorts; the caller doesn't
   *  pre-sort or pre-group. */
  games: SchedulerGame[]
  /** `'date'` → group by `scheduledDate` with sticky headers.
   *  `'none'` → single flat list (used by the scheduler's mobile
   *  horizontal-rail render path which doesn't want group breaks). */
  groupBy?: 'date' | 'none'
  /** Highlight + scroll-into-view target. Passed through to the
   *  `#game-row` slot as `isSelected` so the caller's card can
   *  apply its own selected state. */
  selectedGameId?: string | null
  /** Where to place unscheduled games (no `scheduledDate`) when
   *  `groupBy === 'date'`. `'top'` — the scheduler wants these
   *  first because they're the ones the admin still has to
   *  schedule. `'bottom'` — the scoring page wants these last
   *  because they're not yet actionable. `'hidden'` skips them
   *  entirely. */
  unscheduledPlacement?: 'top' | 'bottom' | 'hidden'
  /** Label rendered on the unscheduled group's header. */
  unscheduledLabel?: string
  /** Message shown when `games` is empty AND the caller didn't
   *  supply an `#empty-state` slot. */
  emptyMessage?: string
  /** When `true` (default), the panel's body owns its own
   *  vertical scroll — useful for standalone usage. Callers
   *  embedding the panel inside an existing scroll container
   *  (e.g. the scheduler's `.scheduler__game-grid` which already
   *  has `overflow-y: auto`) should set this `false` so the
   *  panel inherits the outer scroll instead of nesting a
   *  second scroll context. Date headers' `position: sticky`
   *  then anchors against the OUTER scroll container — the
   *  caller controls the sticky offset via the
   *  `--game-list-sticky-top` CSS variable. */
  internalScroll?: boolean
}>(), {
  groupBy: 'date',
  selectedGameId: null,
  unscheduledPlacement: 'top',
  unscheduledLabel: 'Unscheduled',
  emptyMessage: 'No games to show.',
  internalScroll: true
})

defineEmits<{
  (event: 'select', gameId: string): void
}>()

// ── Stuck-only date band ─────────────────────────────────────────
// The date headers are `position: sticky` and otherwise transparent;
// they only paint their background + bottom border once pinned to the
// scroll container's top. We detect "stuck" by comparing each header's
// viewport top against the scroll container's top plus its resolved
// sticky `top` offset (works whether the scroll container is this
// panel's own body or an outer container in embedded mode).
const rootRef = ref<HTMLElement | null>(null)
let scrollParent: HTMLElement | Window | null = null

function findScrollParent(el: HTMLElement | null): HTMLElement | Window {
  let node: HTMLElement | null = el?.parentElement ?? null
  while (node) {
    const oy = getComputedStyle(node).overflowY
    if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) return node
    node = node.parentElement
  }
  return window
}

function updateStuck() {
  const root = rootRef.value
  if (!root) return
  const container = scrollParent
  const containerTop = container && !(container instanceof Window)
    ? container.getBoundingClientRect().top
    : 0
  root.querySelectorAll<HTMLElement>('.game-list-panel__date-header').forEach((el) => {
    const offset = parseFloat(getComputedStyle(el).top) || 0
    const stuck = el.getBoundingClientRect().top <= containerTop + offset + 1.5
    el.classList.toggle('game-list-panel__date-header--stuck', stuck)
  })
}

onMounted(() => {
  scrollParent = findScrollParent(rootRef.value)
  scrollParent.addEventListener('scroll', updateStuck, { passive: true })
  window.addEventListener('resize', updateStuck)
  updateStuck()
})
onBeforeUnmount(() => {
  scrollParent?.removeEventListener('scroll', updateStuck)
  window.removeEventListener('resize', updateStuck)
})

/** Format `YYYY-MM-DD` as a date-header label.
 *  Parse with `T00:00:00` so the local-time Date constructor
 *  doesn't shift the weekday across a UTC boundary. */
function formatDateLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}

/** Bucket the flat game list into date groups. `groupBy === 'none'`
 *  short-circuits to a single all-games bucket so the template's
 *  group v-for stays the same code path. */
const groups = computed<DateGroup[]>(() => {
  if (props.groupBy === 'none') {
    return [{ key: 'all', label: '', games: props.games }]
  }

  const byDate = new Map<string, DateGroup>()
  const unscheduled: SchedulerGame[] = []

  for (const game of props.games) {
    const date = game.scheduledDate
    if (!date) {
      unscheduled.push(game)
      continue
    }
    if (!byDate.has(date)) {
      byDate.set(date, { key: date, label: formatDateLabel(date), games: [] })
    }
    byDate.get(date)!.games.push(game)
  }

  // Chronological order of dated groups. ISO `YYYY-MM-DD` strings
  // compare correctly with `localeCompare`.
  const dated = Array.from(byDate.values()).sort((a, b) =>
    a.key.localeCompare(b.key)
  )

  if (props.unscheduledPlacement === 'hidden' || unscheduled.length === 0) {
    return dated
  }
  const group: DateGroup = {
    key: 'unscheduled',
    label: props.unscheduledLabel,
    games: unscheduled
  }
  return props.unscheduledPlacement === 'top'
    ? [group, ...dated]
    : [...dated, group]
})

// Re-evaluate stuck state after the group set changes (e.g. switching
// the Pool / Bracket tab or paging brackets re-renders the headers).
watch(groups, () => void nextTick(updateStuck))
</script>

<template>
  <div
    ref="rootRef"
    class="game-list-panel"
    :class="{ 'game-list-panel--no-scroll': !internalScroll }"
  >
    <!-- Optional toolbar slot — sits ABOVE the scroll container
         so filters / search / phase tabs don't scroll with the
         cards below. Caller decides what to render. -->
    <div v-if="$slots['header-toolbar']" class="game-list-panel__toolbar">
      <slot name="header-toolbar" />
    </div>

    <div class="game-list-panel__body">
      <!-- Empty state — caller can override the default copy via
           the `#empty-state` slot (e.g. show a "Try a different
           filter" affordance for filter-driven emptiness). -->
      <template v-if="games.length === 0">
        <slot name="empty-state">
          <p class="game-list-panel__empty">{{ emptyMessage }}</p>
        </slot>
      </template>

      <!-- Flat-list mode (`groupBy === 'none'`) — no headers, just
           cards. The scheduler's mobile horizontal-rail path uses
           this so it can apply its own scroll-snap CSS. -->
      <template v-else-if="groupBy === 'none'">
        <div class="game-list-panel__list">
          <slot
            v-for="game in games"
            :key="game.id"
            name="game-row"
            :game="game"
            :is-selected="selectedGameId === game.id"
          />
        </div>
      </template>

      <!-- Grouped-list mode — one section per date with a sticky
           header pinned to the scroll container's top edge. -->
      <template v-else>
        <div
          v-for="group in groups"
          :key="group.key"
          class="game-list-panel__group"
        >
          <div class="game-list-panel__date-header">
            <span class="game-list-panel__date-label">{{ group.label }}</span>
            <span class="game-list-panel__date-count">{{ group.games.length }} {{ group.games.length === 1 ? 'game' : 'games' }}</span>
          </div>
          <div class="game-list-panel__list">
            <slot
              v-for="game in group.games"
              :key="game.id"
              name="game-row"
              :game="game"
              :is-selected="selectedGameId === game.id"
            />
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* Outer panel — flex column. Body owns the scroll, toolbar (if
   present) stays pinned above. `min-height: 0` lets the body
   shrink inside a flex parent so its `overflow-y` actually
   activates instead of expanding the panel. */
.game-list-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.game-list-panel__toolbar {
  flex: 0 0 auto;
}

.game-list-panel__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
/* Embedded-mode — the panel's body inherits the outer scroll
   container instead of creating its own. Used by the scheduler's
   `.scheduler__game-grid` which already owns the scroll axis.
   The body becomes a plain block; sticky headers anchor against
   the outer scroll container per the CSS-sticky containing-block
   rules. */
.game-list-panel--no-scroll .game-list-panel__body {
  flex: 0 0 auto;
  min-height: 0;
  overflow-y: visible;
}

.game-list-panel__group {
  display: flex;
  flex-direction: column;
}

/* Sticky date header — pins to the scroll container's top. The
   `--game-list-sticky-top` CSS variable lets a wrapping caller
   (e.g. the scheduler with a bracket-pager toolbar above) push
   the sticky position down to clear its own pinned chrome.
   Default 0 so consumers without external chrome get the simple
   case for free. */
.game-list-panel__date-header {
  position: sticky;
  top: var(--game-list-sticky-top, 0);
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  /* Full-bleed band. The parent scroll container owns the side gutter
     (e.g. the scheduler's `.scheduler__game-grid` → `padding: 0 12px`).
     A caller that wants the date band to span edge-to-edge sets
     `--game-list-bleed` to that gutter; the header then pulls out by
     a matching negative margin and re-adds it as padding so the label
     + count chip stay aligned with the cards while the background +
     bottom border reach the column edges. Default `0` keeps the simple
     case (band inset with the cards) for callers that don't opt in. */
  margin-left: calc(-1 * var(--game-list-bleed, 0px));
  margin-right: calc(-1 * var(--game-list-bleed, 0px));
  padding: 10px var(--game-list-bleed, 0px);
  /* Transparent in normal flow — no visible background, border or
     shadow. The band only paints once it pins to the top (see
     `--stuck` below), so an in-flow date row reads as a plain label,
     not a filled bar. */
  background: transparent;
  transition: background-color 140ms ease, box-shadow 140ms ease;
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  letter-spacing: 0.02em;
}
/* Pinned state (toggled in JS) — paint the dedicated sticky-header
   surface token (`--surface-chrome`, 0.96 alpha so scrolling cards
   don't bleed through) plus a soft drop shadow (no bottom border),
   full-bleed via the host's `--game-list-bleed` margins above. Shadow
   matches the shared PoolPlayGames shell's stuck date row. */
.game-list-panel__date-header--stuck {
  background: var(--surface-chrome);
  box-shadow: 0 6px 10px -6px rgba(36, 60, 91, 0.22);
}
html.dark-mode .game-list-panel__date-header--stuck {
  box-shadow: 0 6px 10px -6px rgba(0, 0, 0, 0.45);
}

.game-list-panel__date-label {
  min-width: 0;
}
.game-list-panel__date-count {
  /* Plain "{n} games" text label — matches the shared PoolPlayGames
     shell's `.poolplay__date-count` (used on division detail + public)
     so both surfaces read identically. */
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--secondary);
  line-height: 1.15;
  flex: 0 0 auto;
}

.game-list-panel__list {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
  /* Top/bottom padding only — horizontal inset dropped. The
     parent scroll container (e.g. the scheduler's
     `.scheduler__game-grid` or any caller) owns the side gutter,
     so adding a `14px` horizontal inset here would double up the
     padding and push the cards further in from the column edges
     than intended. */
  padding: 12px 0;
}

.game-list-panel__empty {
  padding: 32px 16px;
  text-align: center;
  color: var(--secondary);
  font-size: 13px;
  margin: 0;
}
</style>
