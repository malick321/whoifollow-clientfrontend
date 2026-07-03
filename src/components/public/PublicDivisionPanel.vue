<script setup lang="ts">
// PublicDivisionPanel
// -------------------
// Middle column of the public event page — the selected division's
// content stacked in ONE read-only column: (1) brackets, (2) division
// teams (pools + standings), (3) pool-play timeline. No admin controls.

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import TeamAvatar from '../TeamAvatar.vue'
import MatchGeniBracketRail from '../MatchGeniBracketRail.vue'
import MatchGeniBracket from '../MatchGeniBracket.vue'
import StatusBadge from '../StatusBadge.vue'
import AppIcon from '../AppIcon.vue'
import PoolPlayGames from '../poolplay/PoolPlayGames.vue'
import PublicPoolPlayGameItem from './PublicPoolPlayGameItem.vue'
import { lockBodyScroll, unlockBodyScroll } from '../../body-scroll-lock'
import { bracketStatusLabel, bracketStatusTone } from '../../lib/bracketStatus'
import { getMockBracket, getMockBracketsForDivision } from '../../api/mockBrackets'
import type { BracketModel, PublicDivision, PublicDivisionGame } from '../../types'

type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary'

const props = defineProps<{
  division: PublicDivision
}>()

interface DateGroup { key: string; label: string; games: PublicDivisionGame[] }
const gameGroups = computed<DateGroup[]>(() => {
  const order: string[] = []
  const byKey = new Map<string, DateGroup>()
  for (const g of props.division.games) {
    if (!byKey.has(g.date)) {
      byKey.set(g.date, { key: g.date, label: formatDate(g.date), games: [] })
      order.push(g.date)
    }
    byKey.get(g.date)!.games.push(g)
  }
  return order.map((k) => byKey.get(k)!)
})

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

// Pool-play status → StatusBadge (same surface as the bracket/game pills).
const poolStatusBadge = computed<{ label: string; tone: BadgeTone } | null>(() => {
  switch (props.division.poolStatus) {
    case 'completed': return { label: 'Completed', tone: 'primary' }
    case 'in_progress': return { label: 'In Progress', tone: 'success' }
    case 'scheduled': return { label: 'Scheduled', tone: 'neutral' }
    default: return null
  }
})
const poolPlaySub = computed(() =>
  [props.division.poolPlayText, props.division.tieBreaker ? `Tie breaker - ${props.division.tieBreaker}` : '']
    .filter(Boolean)
    .join(' · ')
)

// ── Sticky-compact brackets on scroll ──
// Pin the brackets rail below the header; once it sticks, switch the rail
// to its compact form (label + count + name/status only, team rows hidden).
const bracketsRef = ref<HTMLElement | null>(null)
const bracketsStuck = ref(false)
/** The brackets card's effective sticky offset — below the public header +
 *  the full-width divisions pill rail (live heights in CSS vars). */
function stickyOffset(): number {
  if (typeof window === 'undefined') return 64
  const cs = getComputedStyle(document.documentElement)
  const headerH = parseInt(cs.getPropertyValue('--public-header-h')) || 64
  const pillsH = parseInt(cs.getPropertyValue('--public-pills-h')) || 0
  return headerH + pillsH
}
function onScroll() {
  const el = bracketsRef.value
  if (!el) return
  bracketsStuck.value = el.getBoundingClientRect().top <= stickyOffset() + 1
  // Drop-shadow on whichever section header (Teams / Pool Play) is pinned
  // (sits at the stick top + brackets-card height). The Pool Play header +
  // its date rows now live inside <PoolPlayGames>, which owns their own
  // sticky + stuck-shadow — this only handles the Teams header here.
  const headTop = stickyOffset() + bracketsH.value
  document.querySelectorAll<HTMLElement>('.pub-panel__sticky-head').forEach((head) => {
    const top = head.getBoundingClientRect().top
    head.classList.toggle('pub-panel__sticky-head--stuck', Math.abs(top - headTop) <= 1.5)
  })
}

// Live height of the (sticky) brackets card, published as a CSS var so the
// Pool Play shell + Teams header pin just below it (the brackets card
// compacts on scroll, so it's observed live).
const bracketsH = ref(0)
let bracketsRo: ResizeObserver | null = null

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onScroll)
  onScroll()
  if (typeof ResizeObserver !== 'undefined' && bracketsRef.value) {
    bracketsRo = new ResizeObserver(() => { bracketsH.value = Math.round(bracketsRef.value?.offsetHeight ?? 0) })
    bracketsRo.observe(bracketsRef.value)
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onScroll)
  bracketsRo?.disconnect()
  if (seeAllId.value || openBracketId.value) unlockBodyScroll()
})

// ── Read-only bracket canvas ──
// Clicking a bracket chip opens the SAME reusable MatchGeniBracket canvas
// the admin uses, full-screen and read-only (no `#match-actions` slot → no
// user controls). Bracket models are mock (by division id/name) until the
// public bracket API ships, mirroring the admin division-detail fallback.
const openBracketId = ref<string | null>(null)
const bracketModels = computed<BracketModel[]>(() =>
  getMockBracketsForDivision({ id: props.division.id, name: props.division.name })
)
function bracketModelForIndex(index: number): BracketModel {
  const list = bracketModels.value
  const chipName = props.division.brackets[index]?.name
  if (list.length > 0) {
    const base = list[index] ?? list[0]
    return chipName ? { ...base, name: chipName } : base
  }
  const types: BracketModel['type'][] = ['single', 'double', '3gg']
  const seed = String(props.division.id).split('').reduce((s, ch) => s + ch.charCodeAt(0), 0)
  const base = getMockBracket(types[(seed + index) % types.length])
  return chipName ? { ...base, name: chipName } : base
}
const stageBracket = computed<BracketModel | null>(() => {
  if (!openBracketId.value) return null
  const idx = props.division.brackets.findIndex((b) => b.id === openBracketId.value)
  return idx < 0 ? null : bracketModelForIndex(idx)
})
const activeBracketChip = computed(() =>
  props.division.brackets.find((b) => b.id === openBracketId.value) ?? null
)
function openBracketCanvas(id: string) {
  openBracketId.value = id
  lockBodyScroll()
}
function closeBracketCanvas() {
  openBracketId.value = null
  unlockBodyScroll()
}

// ── Team search (filters the pool rows by name / meta / location) ──
const teamSearch = ref('')
const filteredPools = computed(() => {
  const q = teamSearch.value.trim().toLowerCase()
  if (!q) return props.division.pools
  return props.division.pools
    .map((p) => ({
      ...p,
      teams: p.teams.filter((t) =>
        t.teamName.toLowerCase().includes(q) ||
        (t.teamMeta ?? '').toLowerCase().includes(q) ||
        (t.location ?? '').toLowerCase().includes(q)
      )
    }))
    .filter((p) => p.teams.length > 0)
})

// ── See-all teams (per bracket) ──
const seeAllId = ref<string | null>(null)
const seeAllBracket = computed(() => props.division.brackets.find((b) => b.id === seeAllId.value) ?? null)
function openSeeAll(id: string) {
  seeAllId.value = id
  lockBodyScroll()
}
function closeSeeAll() {
  seeAllId.value = null
  unlockBodyScroll()
}
function onSeeAllBackdrop(event: MouseEvent) {
  if (event.target === event.currentTarget) closeSeeAll()
}
</script>

<template>
  <div
    class="pub-panel"
    :style="{ '--pub-brackets-h': bracketsH + 'px' }"
  >
    <!-- 1. Brackets — reusable rail (avatars + status + nav arrows).
         Sticks compact to the top on scroll. -->
    <section
      ref="bracketsRef"
      class="pub-panel__section pub-panel__section--brackets"
      :class="{ 'is-stuck': bracketsStuck }"
    >
      <MatchGeniBracketRail
        v-if="division.brackets.length"
        :brackets="division.brackets"
        :compact="bracketsStuck"
        interactive
        @open="openBracketCanvas"
        @see-all="openSeeAll"
      />
      <div v-else class="pub-panel__brackets-empty">
        <h2 class="pub-panel__heading">Brackets</h2>
        <p class="pub-panel__empty">No brackets yet.</p>
      </div>
    </section>

    <!-- 2. Division teams (pools + standings) -->
    <section class="pub-panel__section">
      <div class="pub-panel__teams-head pub-panel__sticky-head">
        <h2 class="pub-panel__heading pub-panel__heading--inline">Teams <span class="pub-panel__count">{{ division.teamCount }}</span></h2>
        <label class="pub-panel__teams-search">
          <AppIcon name="search" :size="14" />
          <input
            v-model="teamSearch"
            type="search"
            placeholder="Search teams"
            aria-label="Search teams"
          />
        </label>
      </div>
      <div v-if="filteredPools.length" class="pub-panel__pools">
        <div v-for="pool in filteredPools" :key="pool.id" class="pub-pool">
          <div class="pub-pool__label">
            <span class="pub-pool__name">{{ pool.name }}</span>
            <span class="pub-pool__count">{{ pool.teams.length }} teams</span>
          </div>
          <div class="pub-pool__head">
            <span>Seed</span><span>Team</span><span class="pub-pool__wl">W–L</span>
          </div>
          <ul class="pub-pool__rows">
            <li v-for="t in pool.teams" :key="t.teamName" class="pub-pool__row">
              <span class="pub-pool__seed">{{ t.seed ?? '–' }}</span>
              <span class="pub-pool__team">
                <TeamAvatar :name="t.teamName" :image-url="t.imageUrl" size="sm" />
                <span class="pub-pool__team-copy">
                  <span class="pub-pool__team-name">{{ t.teamName }}</span>
                  <span v-if="t.teamMeta || t.location" class="pub-pool__team-meta">
                    {{ [t.teamMeta, t.location].filter(Boolean).join(' · ') }}
                  </span>
                </span>
              </span>
              <span class="pub-pool__wl">{{ t.wins ?? 0 }}–{{ t.losses ?? 0 }}</span>
            </li>
          </ul>
        </div>
      </div>
      <p v-else class="pub-panel__empty">No teams match “{{ teamSearch.trim() }}”.</p>
    </section>

    <!-- 3. Pool Play — shared list shell + read-only public game cards. The
         shell pins its header below the brackets card (`--poolplay-stick-top`)
         and the date rows below the header; `--poolplay-bleed` = this card's
         18px padding so the pinned rows' bg spans full width. -->
    <section class="pub-panel__section">
      <PoolPlayGames
        :groups="gameGroups"
        :style="{ '--poolplay-stick-top': 'calc(var(--pub-stick-top) + var(--pub-brackets-h, 0px))', '--poolplay-bleed': '18px' }"
      >
        <template #header>
          <div class="pub-panel__games-head">
            <h2 class="pub-panel__heading pub-panel__heading--inline">Pool Play</h2>
            <StatusBadge v-if="poolStatusBadge" :label="poolStatusBadge.label" :tone="poolStatusBadge.tone" />
            <span class="pub-panel__games-count">{{ division.games.length }} {{ division.games.length === 1 ? 'game' : 'games' }}</span>
          </div>
        </template>
        <template v-if="poolPlaySub" #subhead>
          <p class="pub-panel__games-sub">{{ poolPlaySub }}</p>
        </template>
        <template #game="{ game }">
          <PublicPoolPlayGameItem :game="game" />
        </template>
        <template #empty>
          <p class="pub-panel__empty">No games scheduled yet.</p>
        </template>
      </PoolPlayGames>
    </section>

    <!-- Read-only bracket canvas — full-screen overlay opened by clicking a
         bracket chip. Same MatchGeniBracket the admin uses, but with NO
         `#match-actions` slot, so no user/edit controls are rendered. -->
    <Teleport to="body">
      <Transition name="slide-modal-backdrop">
        <div v-if="stageBracket" class="pub-bracket-stage" role="dialog" aria-modal="true" aria-label="Bracket">
          <MatchGeniBracket
            :bracket="stageBracket"
            closable
            close-label="Close bracket"
            hide-name-fallback
            @close="closeBracketCanvas"
          >
            <!-- Bracket lifecycle status pill, under the stats line. -->
            <template v-if="activeBracketChip" #status>
              <StatusBadge
                :tone="bracketStatusTone(activeBracketChip.status)"
                :label="bracketStatusLabel(activeBracketChip.status)"
              />
            </template>
            <!-- Read-only switcher — always shown (even for a single bracket)
                 so the tab renders and the info bar stays left-aligned, like
                 the admin canvas. -->
            <template #switch>
              <div class="pub-bracket-switch" role="tablist">
                <div
                  v-for="b in division.brackets"
                  :key="b.id"
                  role="tab"
                  tabindex="0"
                  class="pub-bracket-switch__tab"
                  :class="{ 'pub-bracket-switch__tab--active': b.id === openBracketId }"
                  :aria-selected="b.id === openBracketId"
                  @click="openBracketId = b.id"
                  @keydown.enter="openBracketId = b.id"
                  @keydown.space.prevent="openBracketId = b.id"
                >{{ b.name }}</div>
              </div>
            </template>
          </MatchGeniBracket>
        </div>
      </Transition>
    </Teleport>

    <!-- See-all teams (per bracket) — opened from the rail's "See all". -->
    <Teleport to="body">
      <Transition name="slide-modal-backdrop">
        <div
          v-if="seeAllBracket"
          class="association-switcher-backdrop"
          role="presentation"
          @click="onSeeAllBackdrop"
        >
          <div class="association-switcher-panel pub-seeall" role="dialog" aria-modal="true" aria-label="Bracket teams">
            <header class="association-switcher-panel__header">
              <div class="pub-seeall__titles">
                <span class="pub-seeall__eyebrow">{{ seeAllBracket.teams.length }} teams · {{ seeAllBracket.format }}</span>
                <h2 class="association-switcher-panel__title">{{ seeAllBracket.name }}</h2>
              </div>
              <button type="button" class="association-switcher-panel__close" aria-label="Close" @click="closeSeeAll">
                <AppIcon name="close" :size="16" />
              </button>
            </header>
            <ul class="pub-seeall__list">
              <li v-for="t in seeAllBracket.teams" :key="t.teamName" class="pub-seeall__row">
                <TeamAvatar :name="t.teamName" :image-url="t.imageUrl" size="sm" />
                <span class="pub-seeall__name">{{ t.teamName }}</span>
              </li>
            </ul>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.pub-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.pub-panel__section {
  background: var(--surface-card, #fff);
  border: 1px solid var(--border-divider);
  border-radius: 14px;
  padding: 16px 18px;
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.06);
}
/* Brackets — the rail owns its internal padding, so this card is flush;
   sticks below the header on scroll with a deeper shadow once stuck. */
.pub-panel__section--brackets {
  padding: 0;
  position: sticky;
  /* Pin below the header + the divisions pill rail (full-width sticky bar
     above). Both heights are published as CSS vars. */
  top: var(--pub-stick-top);
  z-index: 6;
  transition: box-shadow 140ms ease;
}
/* When pinned, read as a flush bar — no card shadow, rounding, or
   top/bottom borders. */
.pub-panel__section--brackets.is-stuck {
  border-radius: 0;
  border-top: none;
  border-bottom: none;
  box-shadow: none;
}
.pub-panel__brackets-empty { padding: 16px 18px; }
.pub-panel__heading {
  margin: 0 0 12px;
  /* Matches the matchgeni division-detail heading (16 / 600 / --text). */
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 8px;
}
/* Neutral count badge (light grey) — same tone in light mode as the
   division-detail count pill. */
.pub-panel__count {
  font-size: 11px;
  font-weight: 600;
  border-radius: 999px;
  padding: 2px 8px;
  background: #eef2f7;
  color: #5f7186;
}
html.dark-mode .pub-panel__count { background: rgba(255, 255, 255, 0.06); color: var(--secondary); }
.pub-panel__empty { margin: 0; font-size: 13px; color: var(--secondary); }

/* Teams header — title + team search on one row. */
.pub-panel__teams-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.pub-panel__teams-search {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  height: 34px;
  border-radius: 6px;
  background: var(--white, #fff);
  border: 1px solid var(--border-divider);
  color: var(--secondary);
}
html.dark-mode .pub-panel__teams-search { background: rgba(255, 255, 255, 0.04); }
.pub-panel__teams-search input {
  flex: 1 1 auto;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  font: inherit;
  font-size: 13px;
  color: var(--text);
}

/* Pools */
.pub-panel__pools { display: flex; flex-direction: column; gap: 16px; }
.pub-pool__label {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
}
/* Match the matchgeni division-detail pool label (12px, uppercase). */
.pub-pool__name { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--secondary); }
.pub-pool__count { font-size: 12px; color: var(--secondary); }
.pub-pool__head,
.pub-pool__row {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) 56px;
  align-items: center;
  gap: 8px;
}
.pub-pool__head {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--secondary);
  padding: 4px 8px;
}
.pub-pool__rows { list-style: none; margin: 0; padding: 0; }
.pub-pool__row {
  padding: 8px;
  border-top: 1px solid var(--border-divider);
  font-size: 13px;
  color: var(--text);
}
.pub-pool__seed { font-weight: 600; color: var(--secondary); }
.pub-pool__wl { text-align: right; font-variant-numeric: tabular-nums; }
.pub-pool__team { display: flex; align-items: center; gap: 8px; min-width: 0; }
.pub-pool__team-copy { display: flex; flex-direction: column; min-width: 0; }
.pub-pool__team-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pub-pool__team-meta {
  font-size: 12px;
  color: var(--secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Pool Play header — title + status pill + count, then format/tie-breaker
   sub-line (mirrors the admin division-detail games header). */
.pub-panel__games-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.pub-panel__heading--inline { margin: 0; }
.pub-panel__games-count {
  margin-left: auto;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--secondary);
  line-height: 1.15;
  white-space: nowrap;
}
.pub-panel__games-sub {
  margin: 6px 0 12px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--secondary);
}

/* ── Nested sticky stack (all screen sizes) ──
   Brackets card pins at `--pub-stick-top`; the Teams + Pool Play section
   headers pin just below it (each replacing the other as you scroll); the
   date rows pin below the Pool Play header. Offsets chain off the live
   brackets / pool-header heights (published as CSS vars; the brackets card
   compacts on scroll). `--pub-stick-top` = header + the full-width
   divisions pill rail (both published as CSS vars), on all sizes. Negative
   side margins + padding let the opaque background span the card's full
   width so content scrolls cleanly under the pinned rows. */
.pub-panel { --pub-stick-top: calc(var(--public-header-h, 64px) + var(--public-pills-h, 0px)); }
.pub-panel__sticky-head {
  position: sticky;
  top: calc(var(--pub-stick-top) + var(--pub-brackets-h, 0px));
  z-index: 5;
  background: var(--surface-card, #fff);
  margin: 0 -18px;
  padding: 4px 18px 8px;
  transition: box-shadow 140ms ease;
}
/* Drop shadow only while a section header is pinned (toggled in JS). The
   Pool Play header (`.pub-panel__games-head`) is excluded — its scrolling
   sub-line below it would sit under the shadow. */
.pub-panel__sticky-head--stuck:not(.pub-panel__games-head) {
  box-shadow: 0 6px 10px -6px rgba(36, 60, 91, 0.22);
}
html.dark-mode .pub-panel__sticky-head--stuck:not(.pub-panel__games-head) {
  box-shadow: 0 6px 10px -6px rgba(0, 0, 0, 0.45);
}
/* Pool Play list + game cards now live in <PoolPlayGames> + the shared
   `.poolplay-item__*` classes (src/styles.css). The Teams section header
   keeps `.pub-panel__sticky-head` above. */

/* Read-only bracket canvas — full-screen stage above everything (incl.
   the sticky header). MatchGeniBracket fills it (its root is height:100%
   + flex:1). */
.pub-bracket-stage {
  position: fixed;
  /* Sit BELOW the sticky public header (its live height is published as
     `--public-header-h`) so it never covers the top bar. */
  top: var(--public-header-h, 64px);
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40; /* under the header (z-index: 50) */
  display: flex;
  background: var(--body-bg, #f4f7fb);
}
html.dark-mode .pub-bracket-stage { background: var(--surface-page, #0f1722); }

/* Read-only bracket switcher (segmented pills) — fed into the canvas's
   `#switch` slot. */
/* Standalone shadowed pills — identical to the admin division-detail
   bracket switch (`.mg-div-detail__bracket-switch` / `__tab`): no
   container chrome, active = primary fill (light) / primary outline (dark). */
.pub-bracket-switch {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: none;
  scroll-snap-type: x proximity;
  padding: 6px 2px; /* room for the pill drop-shadow */
}
.pub-bracket-switch::-webkit-scrollbar { display: none; }
.pub-bracket-switch__tab {
  flex: 0 0 auto;
  scroll-snap-align: start;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 18px;
  min-height: 36px;
  background: var(--white);
  border: 1px solid var(--border-divider);
  border-radius: 999px;
  cursor: pointer;
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.12);
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}
.pub-bracket-switch__tab:hover:not(.pub-bracket-switch__tab--active) {
  background: rgba(45, 140, 240, 0.06);
}
.pub-bracket-switch__tab--active,
.pub-bracket-switch__tab--active:hover {
  background: var(--primary, #2d8cf0);
  border-color: var(--primary, #2d8cf0);
  color: var(--white, #fff);
}
html.dark-mode .pub-bracket-switch__tab { background: var(--surface-card); }
/* Dark mode active — outline only (primary border + primary text). */
html.dark-mode .pub-bracket-switch__tab--active,
html.dark-mode .pub-bracket-switch__tab--active:hover {
  background: var(--surface-card);
  border-color: var(--primary);
  color: var(--primary);
}

/* See-all teams modal */
.pub-seeall { width: min(420px, 100%); }
.pub-seeall__titles { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pub-seeall__eyebrow {
  font-size: 0.72rem;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--secondary);
}
.pub-seeall__list {
  list-style: none;
  margin: 0;
  padding: 8px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: min(60vh, 460px);
  overflow-y: auto;
}
.pub-seeall__row { display: flex; align-items: center; gap: 10px; }
.pub-seeall__name { font-size: 13px; color: var(--text); }
</style>
