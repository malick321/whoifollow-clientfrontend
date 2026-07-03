<script setup lang="ts" generic="T extends { id: string }">
// PoolPlayGames
// -------------
// Shared, environment-agnostic shell for a date-grouped "Pool Play" game
// list. Owns: the (optional) sticky section header, the sticky date rows,
// the stuck drop-shadow toggling, and the mobile structure. Knows nothing
// about the game shape or any auth/admin code — the host pre-groups its
// games and renders each card through the `#game` slot, so the same shell
// serves the public (read-only) page and the admin page.
//
// Sticky is parameterized by one host-set CSS var, `--poolplay-stick-top`
// (where the header — or, headerless, the date rows — pins). The shell
// measures its own header height into `--poolplay-headh` so the date rows
// pin just below it. The host also sets `--poolplay-bleed` = its card's
// horizontal padding so the pinned rows' opaque background spans full width.

import { computed, onBeforeUnmount, onMounted, ref, useSlots } from 'vue'

defineProps<{
  /** Pre-grouped games (host builds these from its own data + formatter). */
  groups: { key: string; label: string; games: T[] }[]
}>()

const slots = useSlots()
const hasHeader = computed(() => !!slots.header)

const rootRef = ref<HTMLElement | null>(null)
const headRef = ref<HTMLElement | null>(null)
const headH = ref(0)
const headStuck = ref(false)
let headRo: ResizeObserver | null = null

// Narrow-card stacking — when the list itself is tight (e.g. the admin
// games column squeezed by the divisions sidebar), the cards stack their
// team rows below the slot instead of cramming them into a tiny 2nd column.
// Keyed off the card's OWN width (not the viewport). Tunable.
const STACK_MIN = 480
const narrow = ref(false)
let rootRo: ResizeObserver | null = null

// Toggle the stuck drop-shadow by reading each sticky element's RESOLVED
// `top` (so we don't need to know the offset math — the CSS vars do that).
function onScroll() {
  if (headRef.value) {
    const t = parseFloat(getComputedStyle(headRef.value).top) || 0
    headStuck.value = headRef.value.getBoundingClientRect().top <= t + 1
  }
  const root = rootRef.value
  if (!root) return
  root.querySelectorAll<HTMLElement>('.poolplay__date').forEach((el) => {
    const t = parseFloat(getComputedStyle(el).top) || 0
    el.classList.toggle('poolplay__date--stuck', el.getBoundingClientRect().top <= t + 1.5)
  })
}

function measureNarrow() {
  narrow.value = (rootRef.value?.clientWidth ?? 0) > 0 && (rootRef.value?.clientWidth ?? 0) < STACK_MIN
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onScroll)
  onScroll()
  measureNarrow()
  if (typeof ResizeObserver !== 'undefined') {
    if (headRef.value) {
      headRo = new ResizeObserver(() => { headH.value = Math.round(headRef.value?.offsetHeight ?? 0) })
      headRo.observe(headRef.value)
    }
    if (rootRef.value) {
      rootRo = new ResizeObserver(measureNarrow)
      rootRo.observe(rootRef.value)
    }
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onScroll)
  headRo?.disconnect()
  rootRo?.disconnect()
})
</script>

<template>
  <div ref="rootRef" class="poolplay" :class="{ 'poolplay--narrow': narrow }" :style="{ '--poolplay-headh': headH + 'px' }">
    <!-- Optional sticky section header (title/status/count on public; the
         admin tab bar lives outside the shell, so it omits this). -->
    <div v-if="hasHeader" ref="headRef" class="poolplay__head" :class="{ 'poolplay__head--stuck': headStuck }">
      <slot name="header" />
    </div>
    <!-- Non-sticky sub-line (e.g. format · tie-breaker). -->
    <slot name="subhead" />

    <div v-if="groups.length" class="poolplay__list">
      <div v-for="grp in groups" :key="grp.key" class="poolplay__group">
        <div class="poolplay__date">
          <span class="poolplay__date-label">{{ grp.label }}</span>
          <span class="poolplay__date-count">{{ grp.games.length }} {{ grp.games.length === 1 ? 'game' : 'games' }}</span>
        </div>
        <template v-for="game in grp.games" :key="game.id">
          <slot name="game" :game="game" />
        </template>
      </div>
    </div>
    <slot v-else name="empty"><p class="poolplay__empty">No games scheduled yet.</p></slot>
  </div>
</template>

<style scoped>
.poolplay {
  display: flex;
  flex-direction: column;
  /* Optional inner gutter the host can set (so the stuck date/header bg can
     bleed out to the container edge without overflowing). Hosts whose card
     already pads the content leave this 0 and only set `--poolplay-bleed`. */
  padding-inline: var(--poolplay-inset, 0px);
}

/* Sticky section header — pins at the host-set offset; opaque bg spans the
   host card's full width via the negative `--poolplay-bleed` margins. */
.poolplay__head {
  position: sticky;
  top: var(--poolplay-stick-top, 0px);
  z-index: 5;
  background: var(--surface-card, #fff);
  margin: 0 calc(-1 * var(--poolplay-bleed, 0px));
  padding: 4px var(--poolplay-bleed, 0px) 8px;
  transition: box-shadow 140ms ease;
}
.poolplay__head--stuck { box-shadow: 0 6px 10px -6px rgba(36, 60, 91, 0.22); }
html.dark-mode .poolplay__head--stuck { box-shadow: 0 6px 10px -6px rgba(0, 0, 0, 0.45); }

.poolplay__list { display: flex; flex-direction: column; gap: 14px; }
.poolplay__group { display: flex; flex-direction: column; gap: 8px; }

/* Sticky date row — transparent in flow; when pinned it gains the same
   opaque background + drop shadow as the header (and bleeds out by the
   host's `--poolplay-bleed` to span the container's full width). */
.poolplay__date {
  position: sticky;
  top: calc(var(--poolplay-stick-top, 0px) + var(--poolplay-headh, 0px));
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 0;
  margin: 0 0 2px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  transition: box-shadow 140ms ease, background-color 140ms ease;
}
.poolplay__date--stuck {
  background: var(--surface-card, #fff);
  margin-left: calc(-1 * var(--poolplay-bleed, 0px));
  margin-right: calc(-1 * var(--poolplay-bleed, 0px));
  padding-left: var(--poolplay-bleed, 0px);
  padding-right: var(--poolplay-bleed, 0px);
  box-shadow: 0 6px 10px -6px rgba(36, 60, 91, 0.22);
}
html.dark-mode .poolplay__date--stuck { box-shadow: 0 6px 10px -6px rgba(0, 0, 0, 0.45); }
.poolplay__date-count {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--secondary);
  line-height: 1.15;
}

.poolplay__empty { margin: 0; font-size: 13px; color: var(--secondary); }
</style>
