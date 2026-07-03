<script setup lang="ts">
// MatchGeniBracketRail
// --------------------
// THE bracket rail — one component used by both the admin division-detail
// page and the public event page. A parks-carousel horizontal scroller:
// each chip is 80% of the rail width, centre-snapped (so the next chip
// peeks in), with edge "cut" shadows, responsive team-avatar fit + a
// "See all" overflow, and header nav arrows (hidden ≤1080, swipe instead).
//
// Modes via props:
//   - interactive  → chips are buttons that emit `open(id)` (admin opens
//                    the canvas); read-only otherwise (public page).
//   - showAdd      → header "Add" button (when brackets exist) + a trailing
//                    Create-bracket card (when empty), both emit `add`.
//   - compact      → hide the avatar row + tighten chips (stuck-on-scroll).
// Fills its container's height; the HOST supplies the surrounding card.

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import TeamAvatar from './TeamAvatar.vue'
import StatusBadge from './StatusBadge.vue'
import { bracketStatusLabel, bracketStatusTone } from '../lib/bracketStatus'
import type { BracketStatus } from '../types'

export interface BracketRailItem {
  id: string
  name: string
  format: string
  status: BracketStatus
  teamCount?: number
  teams?: { teamName: string; imageUrl?: string }[]
}

const props = withDefaults(defineProps<{
  brackets: BracketRailItem[]
  interactive?: boolean
  showAdd?: boolean
  compact?: boolean
  headingLabel?: string
}>(), {
  interactive: false,
  showAdd: false,
  compact: false,
  headingLabel: 'Brackets'
})

// ── How many chips fit — decided by the rail's OWN available width, NOT
// the device. This gives "1 full + a peek" wherever the rail is genuinely
// tight (mobile, narrow cards) and "2 full" wherever two readable chips
// (~250px each + gap) fit. The brackets card's track is content-width
// capped (so it tops out ~600px even on huge screens), so the cut-over sits
// at 500px (tunable) — below the capped width so wide layouts go two-up. ──
const TWO_UP_MIN = 500
const railWidth = ref(0)
const twoUp = computed(() => railWidth.value >= TWO_UP_MIN && props.brackets.length >= 2)

// Chip width fraction of the rail — drives both the CSS basis and the
// avatar-fit math. Two-up = ~44% (so a 3rd peeks when >2); one-up = 80%
// (one full + a peek).
const chipFraction = computed(() => (twoUp.value ? 0.44 : 0.8))
const chipBasis = computed(() => `${(chipFraction.value * 100).toFixed(2)}%`)
// Two-up with EXACTLY two brackets → let them flex equally to fill the
// row (no empty peek). 1 bracket fills via `:only-child`; 3+ peek at 44%.
const railFill = computed(() => twoUp.value && props.brackets.length === 2)

const emit = defineEmits<{
  (event: 'open', id: string): void
  (event: 'see-all', id: string): void
  (event: 'add'): void
}>()

function teamCountOf(b: BracketRailItem): number {
  return b.teamCount ?? b.teams?.length ?? 0
}

// ── Responsive avatar fit ──
// Each chip is ~80% of the rail; one measurement drives how many 28px
// (−6px overlap → 22px step) avatars fit, the rest collapse to "See all".
const SM_AVATAR = 28
const SM_AVATAR_STEP = 22
const avatarMax = ref(4)
const railRef = ref<HTMLElement | null>(null)
function recomputeAvatarMax() {
  // Track the rail's available width (drives one-up vs two-up above).
  railWidth.value = railRef.value?.clientWidth ?? 0
  // Measure the ACTUAL chip width so the avatar fit is correct in every
  // layout — single bracket (100%), two-up (44%), fill (50/50), and the
  // one-full-peek (80%). Falls back to the fraction estimate before the
  // chips have laid out.
  const chip = railRef.value?.querySelector<HTMLElement>('.mg-rail__chip')
  const chipW = chip?.clientWidth || (railRef.value?.clientWidth ?? 240) * chipFraction.value
  const usable = chipW - 24 - 52 // chip padding + See-all room
  const fit = Math.floor((usable - SM_AVATAR) / SM_AVATAR_STEP) + 1
  avatarMax.value = Math.max(2, Math.min(8, fit))
}
function visibleTeams(b: BracketRailItem) {
  const teams = b.teams ?? []
  if (teams.length <= avatarMax.value) return teams
  return teams.slice(0, Math.max(1, avatarMax.value - 1))
}
function hasMore(b: BracketRailItem): boolean {
  return (b.teams?.length ?? 0) > avatarMax.value
}

// ── Paging arrows ──
const canPrev = ref(false)
const canNext = ref(false)
function updateArrows() {
  const el = railRef.value
  if (!el) {
    canPrev.value = false
    canNext.value = false
    return
  }
  canPrev.value = el.scrollLeft > 2
  canNext.value = el.scrollLeft < el.scrollWidth - el.clientWidth - 2
}
function step(dir: -1 | 1) {
  const el = railRef.value
  if (!el) return
  const slot = el.querySelector<HTMLElement>('.mg-rail__chip')
  // Two-up advances ~a full view; one-up advances a single chip.
  const amount = twoUp.value
    ? el.clientWidth * 0.9
    : (slot ? slot.offsetWidth + 10 : el.clientWidth * 0.8)
  el.scrollBy({ left: dir * amount, behavior: 'smooth' })
}

// On bracket-set change, snap back to start + recompute.
watch(() => props.brackets, () => void nextTick(() => {
  if (railRef.value) railRef.value.scrollLeft = 0
  updateArrows()
  recomputeAvatarMax()
}), { immediate: true })

let ro: ResizeObserver | null = null
function onResize() { recomputeAvatarMax() }
onMounted(() => {
  recomputeAvatarMax()
  void nextTick(updateArrows)
  if (typeof window !== 'undefined') window.addEventListener('resize', onResize)
  if (typeof ResizeObserver !== 'undefined' && railRef.value) {
    ro = new ResizeObserver(() => { recomputeAvatarMax(); updateArrows() })
    ro.observe(railRef.value)
  }
})
onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('resize', onResize)
  ro?.disconnect()
})

const showNav = computed(() => (props.showAdd && props.brackets.length > 0) || canPrev.value || canNext.value)
</script>

<template>
  <div
    class="mg-rail"
    :class="{ 'mg-rail--compact': compact, 'mg-rail--two-up': twoUp, 'mg-rail--fill': railFill }"
    :style="{ '--mg-rail-chip-basis': chipBasis }"
  >
    <div class="mg-rail__head">
      <span class="mg-rail__title">{{ headingLabel }}</span>
      <span v-if="brackets.length" class="mg-rail__count">{{ brackets.length }}</span>
      <div v-if="showNav" class="mg-rail__nav">
        <button
          v-if="showAdd && brackets.length > 0"
          type="button"
          class="mg-rail__add-btn"
          aria-label="Add bracket"
          @click="emit('add')"
        >
          <span class="mg-rail__add-icon" aria-hidden="true">+</span>
          <span>Add</span>
        </button>
        <button
          v-if="canPrev || canNext"
          type="button"
          class="mg-rail__arrow"
          aria-label="Previous brackets"
          :disabled="!canPrev"
          @click="step(-1)"
        ><span class="mg-rail__arrow-icon mg-rail__arrow-icon--prev" aria-hidden="true"></span></button>
        <button
          v-if="canPrev || canNext"
          type="button"
          class="mg-rail__arrow"
          aria-label="Next brackets"
          :disabled="!canNext"
          @click="step(1)"
        ><span class="mg-rail__arrow-icon" aria-hidden="true"></span></button>
      </div>
    </div>

    <div
      class="mg-rail__wrap"
      :class="{ 'mg-rail__wrap--fade-start': canPrev, 'mg-rail__wrap--fade-end': canNext }"
    >
      <!-- Sticky (compact): nav arrows overlay the rail edges, on hover. -->
      <template v-if="compact && (canPrev || canNext)">
        <button
          type="button"
          class="mg-rail__edge mg-rail__edge--prev"
          aria-label="Previous brackets"
          :disabled="!canPrev"
          @click="step(-1)"
        ><span class="mg-rail__arrow-icon mg-rail__arrow-icon--prev" aria-hidden="true"></span></button>
        <button
          type="button"
          class="mg-rail__edge mg-rail__edge--next"
          aria-label="Next brackets"
          :disabled="!canNext"
          @click="step(1)"
        ><span class="mg-rail__arrow-icon" aria-hidden="true"></span></button>
      </template>
      <div ref="railRef" class="mg-rail__track" @scroll="updateArrows">
        <component
          :is="interactive ? 'button' : 'article'"
          v-for="b in brackets"
          :key="b.id"
          class="mg-rail__chip"
          :class="{ 'mg-rail__chip--interactive': interactive }"
          :type="interactive ? 'button' : undefined"
          :aria-label="interactive ? `Open ${b.name}` : undefined"
          @click="interactive && emit('open', b.id)"
        >
          <span class="mg-rail__eyebrow">{{ teamCountOf(b) }} {{ teamCountOf(b) === 1 ? 'team' : 'teams' }} · {{ b.format }}</span>
          <div class="mg-rail__chip-head">
            <span
              v-if="compact"
              class="mg-rail__status-dot app-tooltip app-tooltip--right"
              :data-tone="bracketStatusTone(b.status)"
              :data-tooltip="bracketStatusLabel(b.status)"
              :aria-label="bracketStatusLabel(b.status)"
            ></span>
            <span class="mg-rail__name">{{ b.name }}</span>
            <StatusBadge v-if="!compact" :tone="bracketStatusTone(b.status)" :label="bracketStatusLabel(b.status)" />
          </div>
          <div
            v-if="b.teams && b.teams.length"
            class="mg-rail__avatars"
            :class="{ 'mg-rail__avatars--collapsed': compact }"
          >
            <span class="mg-rail__stack">
              <span
                v-for="t in visibleTeams(b)"
                :key="t.teamName"
                class="mg-rail__avatar app-tooltip app-tooltip--top"
                :data-tooltip="t.teamName"
                :aria-label="t.teamName"
              >
                <TeamAvatar :name="t.teamName" :image-url="t.imageUrl" size="sm" />
              </span>
            </span>
            <button
              v-if="hasMore(b)"
              type="button"
              class="mg-rail__seeall"
              @click.stop="emit('see-all', b.id)"
            >See all</button>
          </div>
        </component>

        <button
          v-if="showAdd && brackets.length === 0"
          type="button"
          class="mg-rail__chip mg-rail__add-card"
          aria-label="New bracket"
          @click="emit('add')"
        >
          <span class="mg-rail__add-plus" aria-hidden="true">+</span>
          <span class="mg-rail__add-label">New bracket</span>
          <span class="mg-rail__add-sub">No brackets created yet.</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mg-rail {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.mg-rail__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 16px 0;
}
.mg-rail__title { font-size: 16px; font-weight: 600; color: var(--text); }
.mg-rail__count {
  font-size: 11px;
  font-weight: 600;
  border-radius: 999px;
  padding: 2px 8px;
  background: #eef2f7;
  color: #5f7186;
}
html.dark-mode .mg-rail__count { background: rgba(255, 255, 255, 0.06); color: var(--secondary); }
.mg-rail__nav { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; }
.mg-rail__add-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--primary, #2d8cf0);
  background: transparent;
  color: var(--primary, #2d8cf0);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 120ms ease, border-color 120ms ease;
}
.mg-rail__add-btn:hover { background: var(--primary-light-3, #e5f1ff); }
html.dark-mode .mg-rail__add-btn:hover { background: rgba(45, 140, 240, 0.12); }
.mg-rail__add-icon { font-size: 18px; line-height: 1; }
.mg-rail__arrow {
  appearance: none;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  border: 1px solid var(--border-divider);
  background: var(--surface-card, #fff);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  transition: background-color 120ms ease, opacity 120ms ease;
}
.mg-rail__arrow:hover:not(:disabled) { background: var(--surface-raised, rgba(45, 140, 240, 0.08)); }
.mg-rail__arrow:disabled { opacity: 0.4; cursor: not-allowed; }
.mg-rail__arrow-icon {
  width: 12px;
  height: 12px;
  background-color: var(--secondary);
  -webkit-mask: url('../assets/arrow-right.svg') center / contain no-repeat;
  mask: url('../assets/arrow-right.svg') center / contain no-repeat;
}
.mg-rail__arrow-icon--prev { transform: scaleX(-1); }

/* Rail wrapper — grows to fill the card height + vertically centres the
   scroller; carries the edge "cut" shadows. */
.mg-rail__wrap {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.mg-rail__wrap::before,
.mg-rail__wrap::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 28px;
  pointer-events: none;
  opacity: 0;
  transition: opacity 120ms ease;
  z-index: 2;
  -webkit-mask: linear-gradient(to bottom, transparent, #000 28%, #000 72%, transparent);
  mask: linear-gradient(to bottom, transparent, #000 28%, #000 72%, transparent);
}
.mg-rail__wrap::before { left: 0; box-shadow: inset 14px 0 12px -12px rgba(20, 40, 80, 0.45); }
.mg-rail__wrap::after { right: 0; box-shadow: inset -14px 0 12px -12px rgba(20, 40, 80, 0.45); }
html.dark-mode .mg-rail__wrap::before { box-shadow: inset 14px 0 14px -12px rgba(0, 0, 0, 0.7); }
html.dark-mode .mg-rail__wrap::after { box-shadow: inset -14px 0 14px -12px rgba(0, 0, 0, 0.7); }
.mg-rail__wrap--fade-start::before { opacity: 1; }
.mg-rail__wrap--fade-end::after { opacity: 1; }

.mg-rail__track {
  display: flex;
  align-items: stretch;
  gap: 10px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scroll-behavior: smooth;
  scrollbar-width: none;
  padding: 16px;
  scroll-padding-inline: 16px;
}
.mg-rail__track::-webkit-scrollbar { display: none; }

.mg-rail__chip {
  position: relative;
  flex: 0 0 var(--mg-rail-chip-basis, 80%);
  scroll-snap-align: center;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--border-divider);
  border-radius: 8px;
  background: var(--surface-muted, #f4f7fb);
  text-align: left;
  transition: border-color 120ms ease, box-shadow 120ms ease, background-color 120ms ease, transform 120ms ease, padding 200ms ease, gap 200ms ease;
}
.mg-rail__chip:first-child { scroll-snap-align: start; }
.mg-rail__chip:last-child { scroll-snap-align: end; }
.mg-rail__chip:only-child { flex-basis: 100%; }
/* Two-up — left-align snapping so pairs page cleanly. */
.mg-rail--two-up .mg-rail__chip { scroll-snap-align: start; }
/* Exactly two brackets → flex equally to fill the row (no empty peek). */
.mg-rail--fill .mg-rail__chip { flex: 1 1 0; }
html.dark-mode .mg-rail__chip { background: rgba(255, 255, 255, 0.04); }
.mg-rail__chip--interactive { cursor: pointer; appearance: none; }
.mg-rail__chip--interactive:hover {
  border-color: var(--primary);
  background: var(--primary-light-3, #f0f6ff);
  box-shadow: 0 4px 14px rgba(20, 40, 80, 0.1);
  transform: translateY(-1px);
}
html.dark-mode .mg-rail__chip--interactive:hover { background: rgba(45, 140, 240, 0.08); box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35); }
.mg-rail__chip--interactive:active { transform: translateY(0); }
.mg-rail__chip--interactive:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }

.mg-rail__eyebrow {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mg-rail__chip-head { display: flex; align-items: center; gap: 6px; }
/* Compact: a status dot before the name (badge hidden) — colour mirrors the
   StatusBadge tone; the status label shows as a tooltip on the right. */
.mg-rail__status-dot {
  flex: 0 0 auto;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #8a97a8;
}
/* Tones mirror the MatchGeni dashboard division-list bracket dots. */
.mg-rail__status-dot[data-tone='success'] { background: #22a06b; }
.mg-rail__status-dot[data-tone='warning'] { background: #d69e2e; }
.mg-rail__status-dot[data-tone='danger'] { background: var(--danger, #e5484d); }
.mg-rail__status-dot[data-tone='info'] { background: var(--secondary); }
.mg-rail__status-dot[data-tone='neutral'] { background: #8a97a8; }
.mg-rail__status-dot[data-tone='primary'] { background: var(--primary, #2d8cf0); }
html.dark-mode .mg-rail__status-dot[data-tone='neutral'] { background: #6b7785; }
.mg-rail__name {
  flex: 0 1 auto;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Status uses the shared StatusBadge component; keep it from shrinking in
   the chip head (a child's root node is reachable by the parent's scoped
   CSS). */
.mg-rail__chip-head .status-badge { flex: 0 0 auto; }

.mg-rail__avatars {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin-top: 2px;
  /* Animate the squeeze when the rail goes compact (stuck on scroll).
     Keep overflow VISIBLE in the normal (expanded) state so the avatar
     drop-shadows and the upward hover tooltip aren't clipped — only the
     collapsed state clips (so the max-height squeeze reads cleanly). */
  max-height: 44px;
  opacity: 1;
  overflow: visible;
  transition: max-height 200ms ease, opacity 140ms ease, margin-top 200ms ease;
}
.mg-rail__avatars--collapsed {
  max-height: 0;
  opacity: 0;
  margin-top: 0;
  overflow: hidden;
}
.mg-rail__stack { display: flex; align-items: center; flex: 0 1 auto; min-width: 0; }
.mg-rail__avatar { display: inline-flex; }
.mg-rail__stack > :not(:first-child) { margin-left: -6px; }
/* Tooltip anchored to the avatar's left edge so it never crosses the
   rail's clipped side edges. */
.mg-rail__avatar.app-tooltip::after { left: 0; transform: translateX(0) translateY(2px); }
.mg-rail__avatar.app-tooltip:hover::after,
.mg-rail__avatar.app-tooltip:focus-visible::after { transform: translateX(0) translateY(0); }
.mg-rail__avatar.app-tooltip::before { left: 14px; }
.mg-rail__seeall {
  flex: 0 0 auto;
  appearance: none;
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--border-divider);
  border-radius: 6px;
  background: var(--surface-card, #fff);
  color: var(--text);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: border-color 120ms ease, color 120ms ease;
}
.mg-rail__seeall:hover { border-color: var(--primary); color: var(--primary); }

/* Trailing Create-bracket card. */
.mg-rail__add-card {
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 4px;
  border-style: dashed;
  background: transparent;
  color: var(--primary);
  cursor: pointer;
}
.mg-rail__add-card:hover { border-color: var(--primary); background: var(--primary-light-3, #e5f1ff); }
html.dark-mode .mg-rail__add-card:hover { background: rgba(45, 140, 240, 0.1); }
.mg-rail__add-plus { font-size: 22px; line-height: 1; }
.mg-rail__add-label { font-size: 13px; font-weight: 600; }
.mg-rail__add-sub { font-size: 11px; color: var(--secondary); }

/* Compact (stuck) — hide avatars + lay the head (title + count inline,
   unchanged) BESIDE the rail, then the brackets rail fills the rest. */
.mg-rail--compact { flex-direction: row; align-items: center; gap: 0; }
.mg-rail--compact .mg-rail__head {
  flex: 0 0 auto;
  padding: 0 0 0 16px;
}
.mg-rail--compact .mg-rail__wrap { flex: 1 1 auto; min-width: 0; }
.mg-rail--compact .mg-rail__track { padding: 10px 16px; }
.mg-rail--compact .mg-rail__chip { padding: 8px 12px; gap: 4px; }
/* Sticky: head keeps the add button only; arrows move onto the rail edges. */
.mg-rail--compact .mg-rail__nav .mg-rail__arrow { display: none; }

/* Edge nav buttons overlaying the rail (left + right), revealed on hover. */
.mg-rail__edge {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 3;
  width: 30px;
  height: 30px;
  border-radius: 999px;
  border: 1px solid var(--border-divider);
  background: var(--surface-card, #fff);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.18);
  opacity: 0;
  pointer-events: none;
  transition: opacity 140ms ease, background-color 120ms ease;
}
.mg-rail__edge--prev { left: 6px; }
.mg-rail__edge--next { right: 6px; }
.mg-rail--compact:hover .mg-rail__edge:not(:disabled) { opacity: 1; pointer-events: auto; }
.mg-rail__edge:hover { background: var(--surface-raised, rgba(45, 140, 240, 0.08)); }
.mg-rail__edge:disabled { opacity: 0 !important; cursor: not-allowed; }

/* Tablet-portrait and smaller — hide arrows; swipe instead. */
@media (max-width: 1080px) {
  .mg-rail__arrow { display: none; }
}
</style>
