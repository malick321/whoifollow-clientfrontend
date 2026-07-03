<script setup lang="ts">
// MatchGeniBracket
// ----------------
// Reusable, READ-ONLY bracket renderer — single / double / 3-game-
// guarantee. Translated + re-skinned from the legacy `BracketsView`:
// the layout geometry lives in `src/lib/bracketLayout.ts`; this
// component is the presentational + interaction layer.
//
// Interaction: the tree sits on a pan/zoom "canvas" — an
// `overflow:hidden` viewport with a CSS-transform inner layer
// (translate + scale). Wheel / buttons zoom (around the cursor),
// pointer-drag pans, Fit frames the whole bracket. Match boxes stay
// real DOM, so they remain clickable, themeable, and accessible.
//
// Consumers: scheduler preview drawer, division-info, public pages.
// Optional `#match-actions` scoped slot lets an admin surface inject
// per-game controls without bloating the previewer.

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { computeBracketLayout } from '../lib/bracketLayout'
import StatusBadge from './StatusBadge.vue'
import type { BracketModel, BracketMatch, BracketSection } from '../types'

type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary'

/** Status → designed StatusBadge tone + label. Tones mirror the
 *  scheduler/field-grid mapping (live=danger, delayed=warning,
 *  final=neutral) so a "Live" pill reads identically across surfaces;
 *  light/dark styling comes from the shared `.status-badge` rules. */
function statusBadge(status: BracketMatch['status']): { tone: BadgeTone; label: string } {
  switch (status) {
    case 'live': return { tone: 'danger', label: 'Live' }
    case 'delayed': return { tone: 'warning', label: 'Delayed' }
    case 'final': return { tone: 'neutral', label: 'Final' }
    case 'not_needed': return { tone: 'neutral', label: 'Not needed' }
    default: return { tone: 'neutral', label: 'Not scheduled' }
  }
}

const props = withDefaults(defineProps<{
  bracket: BracketModel | null
  /** Disable pan/zoom (static embed). Default interactive. */
  interactive?: boolean
  /** Hide the floating bracket-info card (name + stats) — e.g. when
   *  the host renders that context elsewhere. Default shown. */
  hideInfoCard?: boolean
  /** Show a floating close button (top-right of the canvas) that
   *  emits `close` — used when the host (e.g. a drawer) wants the
   *  close affordance on the canvas rather than in a header. */
  closable?: boolean
  /** Suppress the fallback bracket-name pill that renders when no
   *  `#switch` slot is given — e.g. a single-bracket division where
   *  the host shows context elsewhere and only wants the stats. */
  hideNameFallback?: boolean
  /** Accessible label + hover tooltip for the close button. Default
   *  "Close"; hosts can be specific (e.g. "Close brackets"). */
  closeLabel?: string
}>(), {
  interactive: true,
  hideInfoCard: false,
  closable: false,
  hideNameFallback: false,
  closeLabel: 'Close'
})

const emit = defineEmits<{
  'match-click': [match: BracketMatch]
  'close': []
}>()

// ── Layout (clone first — the engine writes left/top/height) ─────
const layout = computed(() => {
  if (!props.bracket) return null
  const clone = JSON.parse(JSON.stringify(props.bracket)) as BracketModel
  return computeBracketLayout(clone)
})

/** Section banner anchor — min left/top across the section's matches. */
function sectionAnchor(section: BracketSection): { left: number; top: number } {
  let left = Infinity
  let top = Infinity
  for (const round of section.rounds) {
    for (const match of round) {
      if (match.left != null) left = Math.min(left, match.left)
      if (match.top != null) top = Math.min(top, match.top)
    }
  }
  return { left: Number.isFinite(left) ? left : 0, top: Number.isFinite(top) ? top : 0 }
}

// ── Pan / zoom state ─────────────────────────────────────────────
const viewportRef = ref<HTMLElement | null>(null)
const scale = ref(1)
const tx = ref(0)
const ty = ref(0)
const MIN_SCALE = 0.5
const MAX_SCALE = 2

const zoomPercent = computed(() => Math.round(scale.value * 100))

/** Division champion name shown above the winner line (when decided). */
const winnerName = computed(() => props.bracket?.winner?.name ?? '')

/** "8 Teams · Single Elimination · 7 Games" line on the info card. */
const metaLine = computed(() => {
  const b = props.bracket
  if (!b) return ''
  return [
    b.teamCount != null ? `${b.teamCount} Teams` : null,
    b.format,
    b.gameCount != null ? `${b.gameCount} Games` : null
  ].filter(Boolean).join(' · ')
})

const canvasStyle = computed(() => ({
  width: `${layout.value?.width ?? 0}px`,
  height: `${layout.value?.height ?? 0}px`,
  transform: `translate(${tx.value}px, ${ty.value}px) scale(${scale.value})`
}))

function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))
}

/** Frame the whole bracket centered in the viewport. */
function fit() {
  const vp = viewportRef.value
  const l = layout.value
  if (!vp || !l || l.width === 0 || l.height === 0) return
  const vw = vp.clientWidth
  const vh = vp.clientHeight
  const s = clampScale(Math.min(vw / l.width, vh / l.height) * 0.96)
  scale.value = s
  tx.value = (vw - l.width * s) / 2
  ty.value = (vh - l.height * s) / 2
}

/** Default framing — 100% zoom (scale 1), centered on BOTH axes.
 *  Unlike `fit()` (which scales the whole tree down to the viewport),
 *  this always frames at true 100% so cards read at their native size.
 *  Used on open AND by the Reset control, so Reset returns to the exact
 *  initial-launch view (centered, not top-aligned). */
function frameDefault() {
  scale.value = 1
  const vp = viewportRef.value
  const l = layout.value
  if (!vp || !l) return
  tx.value = Math.max(16, (vp.clientWidth - l.width) / 2)
  ty.value = Math.max(16, (vp.clientHeight - l.height) / 2)
}
function reset() {
  frameDefault()
}

/** Zoom by a factor, keeping the viewport center stationary. */
function zoomBy(factor: number) {
  const vp = viewportRef.value
  if (!vp) return
  zoomAround(vp.clientWidth / 2, vp.clientHeight / 2, factor)
}

/** Zoom keeping the point (px,py) — viewport-relative — fixed. */
function zoomAround(px: number, py: number, factor: number) {
  const newScale = clampScale(scale.value * factor)
  if (newScale === scale.value) return
  tx.value = px - (px - tx.value) * (newScale / scale.value)
  ty.value = py - (py - ty.value) * (newScale / scale.value)
  scale.value = newScale
}

function onWheel(e: WheelEvent) {
  if (!props.interactive) return
  e.preventDefault()
  const vp = viewportRef.value
  if (!vp) return
  const rect = vp.getBoundingClientRect()
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
  zoomAround(e.clientX - rect.left, e.clientY - rect.top, factor)
}

// ── Pan (pointer drag) ───────────────────────────────────────────
const dragging = ref(false)
let lastX = 0
let lastY = 0

function onPointerDown(e: PointerEvent) {
  if (!props.interactive) return
  // Ignore drags that start on a match box's interactive bits.
  dragging.value = true
  lastX = e.clientX
  lastY = e.clientY
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
}
function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return
  tx.value += e.clientX - lastX
  ty.value += e.clientY - lastY
  lastX = e.clientX
  lastY = e.clientY
}
function onPointerUp(e: PointerEvent) {
  dragging.value = false
  ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
}

// ── Match interaction ────────────────────────────────────────────
function onMatchClick(match: BracketMatch) {
  if (match.status === 'not_needed') return
  emit('match-click', match)
}

// ── Lifecycle — open at 100% (centered) on mount, on bracket change,
// and when the viewport first gets a size (e.g. the canvas/stage
// becomes visible). ───────────────────────────────────────────────
let resizeObserver: ResizeObserver | null = null
onMounted(() => {
  frameDefault()
  if (typeof ResizeObserver !== 'undefined' && viewportRef.value) {
    resizeObserver = new ResizeObserver(() => frameDefault())
    resizeObserver.observe(viewportRef.value)
  }
})
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})
watch(() => props.bracket?.id, () => {
  // Defer so the new layout dimensions are available before framing.
  requestAnimationFrame(frameDefault)
})

defineExpose({ fit, reset, zoomBy })
</script>

<template>
  <div class="bracket" :class="{ 'bracket--static': !interactive }">
    <!-- Top-right cluster: host context (corner-right slot) sits to
         the LEFT of the floating close button. -->
    <div v-if="closable || $slots['corner-right']" class="bracket__overlay-tr">
      <slot name="corner-right" />
      <button
        v-if="closable"
        type="button"
        class="bracket__close app-tooltip app-tooltip--left"
        :aria-label="closeLabel"
        :data-tooltip="closeLabel"
        @click="emit('close')"
      >×</button>
    </div>

    <!-- Floating bracket-info card (top-left): bracket name + an
         optional nav slot (prev/next between brackets) + the
         per-bracket stats line. -->
    <div
      v-if="bracket && !hideInfoCard"
      class="bracket__overlay-top"
      :class="{ 'bracket__overlay-top--switch': !!$slots.switch }"
    >
      <!-- Bracket switcher — host renders a segmented switch (one
           segment per bracket). Falls back to a plain name pill when
           no switch is provided (e.g. single-bracket / static use). -->
      <div v-if="$slots.switch" class="bracket__switch-row">
        <slot name="switch" />
      </div>
      <div v-else-if="!hideNameFallback" class="bracket__info-name">{{ bracket.name }}</div>
      <!-- Stats pill below, as-is. -->
      <div v-if="metaLine" class="bracket__info-meta">{{ metaLine }}</div>
      <!-- Optional host-supplied pill below the stats (e.g. the bracket's
           lifecycle status badge). -->
      <slot name="status" />
    </div>

    <!-- Zoom controls -->
    <div v-if="interactive && layout" class="bracket__controls">
      <button type="button" class="bracket__ctrl" aria-label="Zoom out" @click="zoomBy(1 / 1.2)">−</button>
      <span class="bracket__zoom-level">{{ zoomPercent }}%</span>
      <button type="button" class="bracket__ctrl" aria-label="Zoom in" @click="zoomBy(1.2)">+</button>
      <button type="button" class="bracket__ctrl bracket__ctrl--text" @click="fit">Fit</button>
      <button type="button" class="bracket__ctrl bracket__ctrl--text" @click="reset">Reset</button>
    </div>

    <div
      ref="viewportRef"
      class="bracket__viewport"
      :class="{ 'bracket__viewport--dragging': dragging }"
      @wheel="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerUp"
    >
      <div v-if="layout" class="bracket__canvas" :style="canvasStyle">
        <!-- Connector elbows -->
        <svg
          class="bracket__connectors"
          :width="layout.width"
          :height="layout.height"
          :viewBox="`0 0 ${layout.width} ${layout.height}`"
        >
          <path
            v-for="(c, i) in layout.connectors"
            :key="i"
            :d="c.d"
            class="bracket__connector"
            :class="{ 'bracket__connector--dotted': c.dotted }"
          />
        </svg>

        <!-- Sections + matches -->
        <template v-for="section in layout.sections" :key="section.kind">
          <div
            v-if="section.label"
            class="bracket__section-label"
            :style="{ left: `${sectionAnchor(section).left}px`, top: `${sectionAnchor(section).top - 26}px` }"
          >{{ section.label }}</div>

          <template v-for="round in section.rounds">
            <div
              v-for="match in round"
              :key="match.id"
              class="bracket__match"
              :class="{
                'bracket__match--clickable': match.status === 'live' || match.status === 'final',
                'bracket__match--not-needed': match.status === 'not_needed',
                'bracket__match--if-necessary': match.ifNecessary
              }"
              :style="{ left: `${match.left}px`, top: `${match.top}px`, width: '212px', height: `${match.height}px` }"
              @click="onMatchClick(match)"
            >
              <div class="bracket__match-head">
                <span class="bracket__game-name">{{ match.gameName }}</span>
                <span class="bracket__head-right">
                  <!-- Admin actions injected by the host (scheduler), if any -->
                  <slot name="match-actions" :match="match" />
                  <StatusBadge
                    :label="statusBadge(match.status).label"
                    :tone="statusBadge(match.status).tone"
                  />
                </span>
              </div>

              <div
                class="bracket__team"
                :class="{ 'bracket__team--winner': match.team1.isWinner, 'bracket__team--struck': match.team1.strikethrough }"
              >
                <span v-if="match.team1.seed != null" class="bracket__seed">{{ match.team1.seed }}</span>
                <span class="bracket__team-name">{{ match.team1.name || '—' }}</span>
                <span class="bracket__score">{{ match.team1.score ?? '' }}</span>
              </div>
              <div
                class="bracket__team"
                :class="{ 'bracket__team--winner': match.team2.isWinner, 'bracket__team--struck': match.team2.strikethrough }"
              >
                <span v-if="match.team2.seed != null" class="bracket__seed">{{ match.team2.seed }}</span>
                <span class="bracket__team-name">{{ match.team2.name || '—' }}</span>
                <span class="bracket__score">{{ match.team2.score ?? '' }}</span>
              </div>

              <!-- Always render the footer (blank when unscheduled) so
                   every card keeps the same height + layout. -->
              <div class="bracket__meta">
                <span v-if="match.assignedTime">{{ match.assignedTime }}<template v-if="match.assignedDateLabel"> · {{ match.assignedDateLabel }}</template></span>
                <span v-if="match.assignedFieldName" class="bracket__meta-field">{{ match.assignedFieldName }}</span>
              </div>
            </div>
          </template>
        </template>

        <!-- Winner line — extends right from the deciding game; the
             champion's name sits above the line, "WINNER" below. -->
        <div
          v-if="layout.winnerLine"
          class="bracket__winner"
          :style="{ left: `${layout.winnerLine.x}px`, top: `${layout.winnerLine.y}px` }"
        >
          <span v-if="winnerName" class="bracket__winner-name">{{ winnerName }}</span>
          <div class="bracket__winner-line"></div>
          <span class="bracket__winner-label">WINNER</span>
        </div>
      </div>

      <!-- No bracket — host can supply a richer placeholder (e.g. a
           "no bracket yet" message + Create Bracket action) via the
           `empty` slot; falls back to a simple line. -->
      <div v-else class="bracket__empty">
        <slot name="empty">No bracket to display.</slot>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bracket {
  position: relative;
  width: 100%;
  height: 100%;
  /* Fill a flex parent (e.g. the SlideModal body) as well as a
     block parent. */
  flex: 1 1 auto;
  min-height: 0;
}

/* ── Floating top-CENTER overlay: bracket switcher + stats pill ── */
.bracket__overlay-top {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  max-width: calc(100% - 24px);
}
/* Wraps the host-provided segmented switch. */
.bracket__switch-row {
  display: flex;
  align-items: center;
  max-width: 100%;
}

/* When a multi-bracket switch is provided, the top overlay stops being a
   centered floating card and becomes a full-width top BAR: the pills rail
   fills the available width on the LEFT (scrolls when it overflows) while
   the close button sits at the top-right (.bracket__overlay-tr). `right`
   leaves room for that 32px close button + a gap so the rail never slides
   underneath it. */
.bracket__overlay-top--switch {
  left: 12px;
  right: 56px;
  transform: none;
  align-items: flex-start;
  max-width: none;
}
.bracket__overlay-top--switch .bracket__switch-row {
  width: 100%;
  max-width: 100%;
}
/* Bracket name — its own rounded pill. */
.bracket__info-name {
  max-width: 320px;
  padding: 7px 16px;
  border-radius: 999px;
  background: var(--surface-card, #fff);
  border: 1px solid var(--border-divider, rgba(15, 23, 42, 0.12));
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.12);
  font-size: 14px;
  font-weight: 700;
  color: var(--text, #0f172a);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Stats — its own rounded pill below the name. */
.bracket__info-meta {
  max-width: 320px;
  padding: 5px 14px;
  border-radius: 999px;
  background: var(--surface-card, #fff);
  border: 1px solid var(--border-divider, rgba(15, 23, 42, 0.12));
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.1);
  font-size: 11.5px;
  color: var(--secondary, #64748b);
  white-space: nowrap;
}

/* ── Top-right cluster (host context + close) ── */
.bracket__overlay-tr {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 6;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: calc(70% - 24px);
}
.bracket__close {
  flex: 0 0 auto;
  appearance: none;
  border: none;
  width: 32px;
  height: 32px;
  border-radius: 999px;
  /* Solid dark surface (no transparency) so it stays prominent
     over the light canvas. */
  background: #1e293b;
  color: #fff;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background-color 120ms ease;
}
.bracket__close:hover {
  background: #0f172a;
}
html.dark-mode .bracket__close {
  background: #2a323c;
}
html.dark-mode .bracket__close:hover {
  background: #3a434f;
}

/* ── Zoom controls ── */
.bracket__controls {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 5;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border-radius: 999px;
  /* Same raised surface as the match-card footer row. */
  background: var(--surface-raised, #f1f5f9);
  border: 1px solid var(--border-divider, rgba(15, 23, 42, 0.12));
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.12);
}
.bracket__ctrl {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--text, #0f172a);
  width: 28px;
  height: 28px;
  border-radius: 999px;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}
.bracket__ctrl--text {
  width: auto;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 600;
}
.bracket__ctrl:hover {
  background: var(--surface-raised, #f1f5f9);
}
.bracket__zoom-level {
  font-size: 12px;
  font-weight: 600;
  color: var(--secondary, #64748b);
  min-width: 38px;
  text-align: center;
}

/* ── Viewport / canvas ── */
.bracket__viewport {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background:
    radial-gradient(circle at 1px 1px, var(--border-divider, rgba(15, 23, 42, 0.08)) 1px, transparent 0);
  background-size: 22px 22px;
  cursor: grab;
  touch-action: none;
}
.bracket__viewport--dragging {
  cursor: grabbing;
}
.bracket--static .bracket__viewport {
  cursor: default;
}
.bracket__canvas {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
}
.bracket__connectors {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  overflow: visible;
}
.bracket__connector {
  fill: none;
  /* Match the game-card border (color + 1px width, light + dark) so
     the tree lines read as the same hue + weight as the boxes they
     connect. */
  stroke: var(--border-divider, rgba(15, 23, 42, 0.12));
  stroke-width: 1;
}
/* Championship connections (grand final 998 + if-necessary 999) —
   dotted to read as conditional/decider links, distinct from the
   solid in-bracket advancement lines. */
.bracket__connector--dotted {
  stroke-dasharray: 1.5 5;
  stroke-linecap: round;
  stroke-width: 1.75;
  stroke: var(--primary, #2563eb);
  opacity: 0.8;
}

/* ── Section label ── */
.bracket__section-label {
  position: absolute;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--secondary, #64748b);
}

/* ── Match box ── */
.bracket__match {
  position: absolute;
  display: flex;
  flex-direction: column;
  background: var(--surface-card, #fff);
  border: 1px solid var(--border-divider, rgba(15, 23, 42, 0.12));
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
}
.bracket__match--clickable {
  cursor: pointer;
}
.bracket__match--clickable:hover {
  border-color: var(--primary, #2563eb);
  box-shadow: 0 4px 14px rgba(37, 99, 235, 0.18);
}
.bracket__match--not-needed {
  opacity: 0.6;
}
/* "Championship if necessary" — dashed box telegraphs it's a
   conditional decider that may not be played. */
.bracket__match--if-necessary {
  border-style: dashed;
  border-color: var(--primary, #2563eb);
  background: var(--surface-muted, #f9fafd);
}

.bracket__match-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-divider, rgba(15, 23, 42, 0.08));
}
.bracket__game-name {
  font-size: 11px;
  font-weight: 700;
  color: var(--secondary, #64748b);
  /* Truncate long names (e.g. "Championship IF") so the status
     badge keeps its single-line space instead of wrapping. */
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Right cluster — optional admin actions + the shared StatusBadge. */
.bracket__head-right {
  margin-left: auto;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
/* Trim the shared `.status-badge` slightly for the compact match box,
   and keep its label on a single line. */
.bracket__head-right :deep(.status-badge) {
  padding: 2px 8px;
  font-size: 0.68rem;
  white-space: nowrap;
}

.bracket__team {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  flex: 1 1 0;
  min-height: 0;
  font-size: 13px;
  color: var(--text, #0f172a);
}
.bracket__team + .bracket__team {
  border-top: 1px solid var(--border-divider, rgba(15, 23, 42, 0.06));
}
.bracket__team--winner {
  background: var(--primary-light-4, rgba(37, 99, 235, 0.08));
  font-weight: 700;
}
.bracket__team--struck .bracket__team-name {
  text-decoration: line-through;
  color: var(--secondary, #94a3b8);
}
.bracket__seed {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 5px;
  font-size: 10px;
  font-weight: 700;
  color: var(--secondary, #64748b);
  background: var(--surface-raised, #f1f5f9);
}
.bracket__team-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bracket__score {
  flex: 0 0 auto;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text, #0f172a);
}

.bracket__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  /* Reserve a consistent height even when blank (unscheduled game)
     so all cards keep the same footprint. */
  min-height: 23px;
  padding: 4px 8px;
  border-top: 1px solid var(--border-divider, rgba(15, 23, 42, 0.06));
  font-size: 10.5px;
  color: var(--secondary, #64748b);
  /* `--surface-raised` (a touch greyer than `--surface-muted`, which
     renders near-white here) so the footer reads as a distinct row. */
  background: var(--surface-raised, #f1f5f9);
}
.bracket__meta-field {
  margin-left: auto;
}

/* ── Winner line + champion label ── */
.bracket__winner {
  position: absolute;
  width: 150px;
  /* Center the block on the deciding game's vertical center so the
     line lines up with the game it extends from. */
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 5px;
  pointer-events: none;
}
.bracket__winner-name {
  text-align: center;
  font-size: 13px;
  font-weight: 700;
  color: var(--text, #0f172a);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bracket__winner-line {
  height: 2px;
  width: 100%;
  background: var(--primary, #2563eb);
  border-radius: 2px;
}
.bracket__winner-label {
  text-align: center;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.1em;
  color: var(--primary, #2563eb);
}

.bracket__empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--secondary, #64748b);
  font-size: 14px;
}

/* ── Dark mode ── */
html.dark-mode .bracket__match {
  background: #1a2028;
  border-color: rgba(255, 255, 255, 0.12);
}
/* Floating controls / pills — translucent white in dark mode (same
   vocabulary as the close button) so they read as lifted glass over
   the dark canvas rather than solid panels. */
html.dark-mode .bracket__controls,
html.dark-mode .bracket__info-name,
html.dark-mode .bracket__info-meta {
  background: rgba(255, 255, 255, 0.16);
  border-color: rgba(255, 255, 255, 0.12);
}
html.dark-mode .bracket__meta {
  background: rgba(255, 255, 255, 0.03);
}
html.dark-mode .bracket__connector {
  stroke: rgba(255, 255, 255, 0.12);
}
html.dark-mode .bracket__status--final,
html.dark-mode .bracket__seed {
  background: rgba(255, 255, 255, 0.08);
}
</style>
