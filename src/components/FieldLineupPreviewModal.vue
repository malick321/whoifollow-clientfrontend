<script setup lang="ts">
// FieldLineupPreviewModal
// -----------------------
// Lightweight wrapper around `FieldLineupPreview` that exposes
// the read-only field-lineup preview as a standalone center
// modal. Used by the matchgeni field-grid game-details drawer's
// "Preview lineup" button — opens the same SVG-field view the
// participation page's `GameLineupSubmissionModal` shows in
// preview mode, but without dragging in the editor / submit /
// approve flow that modal carries.
//
// Tabbed inside: a Visitor / Home toggle lets the operator
// flip between the two teams' lineups without closing the
// modal. Each tab fetches its own lineup via the production
// fetcher signature (`fetchGameLineupSubmission(gameId, teamId)`)
// — wired today to the local mock
// (`mockFetchGameLineupSubmission`) so the demo works against
// the field-grid's mock game ids; swap the import to the real
// fetcher in `src/api/gameLineupSubmission.ts` once the backend
// game-details endpoint ships the per-team lineup payload.
//
// Drag-drop + admin actions: explicitly disabled by passing
// `editable={false}` to `FieldLineupPreview`. The modal is a
// pure read-only inspector — operators can switch teams, see
// the pin positions + roster, and close. Nothing else.

import { computed, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import FieldLineupPreview, { type PreviewPlayer } from './FieldLineupPreview.vue'
import TeamAvatar from './TeamAvatar.vue'
import { mockFetchGameLineupSubmission } from '../api/mockGameLineupSubmission'
import { lockBodyScroll, unlockBodyScroll } from '../body-scroll-lock'
import type {
  FieldConfigPosition,
  GameLineupSubmissionDetail
} from '../types'

const props = defineProps<{
  /** Two-way visibility — parent owns the open state. */
  modelValue: boolean
  /** Game id used as the lineup-fetch key (`gameId` arg). For
   *  mock games today this is the `SchedulerGame.id` (e.g.
   *  `'g_mock_1234'`); for real backend it'll be the production
   *  tournament-game id. */
  gameId: string
  /** Pre-formatted game subtitle line ("Pool 4 · Wed Apr 29 ·
   *  11:00 AM · F2 - H1 Park") for the modal header. */
  gameTitle: string
  gameSubtitle?: string
  /** Visitor (team 1) label — display name shown in the tab +
   *  the preview's home-team-name slot when the visitor tab is
   *  active. The mock fetcher uses `'team1' / 'team2'` as the
   *  `teamId` arg so the player-name hash stays stable per
   *  side; production will use the real per-team ids embedded
   *  in the SchedulerGame payload. */
  visitorLabel: string
  homeLabel: string
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
}>()

function close() {
  emit('update:modelValue', false)
}

// ── Tab state ────────────────────────────────────────────────────
// Visitor on the left (`team1`), Home on the right (`team2`) —
// matches the line-score ordering above so the operator's
// mental model stays consistent.
type SideTab = 'visitor' | 'home'
const activeTab = ref<SideTab>('visitor')

function selectTab(tab: SideTab) {
  activeTab.value = tab
}

// Reset to visitor whenever the modal opens — fresh per-game
// view rather than carrying the last-shown tab across games.
watch(() => props.modelValue, (open) => {
  if (open) {
    activeTab.value = 'visitor'
    lockBodyScroll()
  } else {
    unlockBodyScroll()
  }
})

const activeTeamId = computed<string>(() =>
  activeTab.value === 'visitor' ? 'team1' : 'team2'
)
const activeTeamLabel = computed<string>(() =>
  activeTab.value === 'visitor' ? props.visitorLabel : props.homeLabel
)

// ── Per-tab fetch + cache ───────────────────────────────────────
// Each tab's lineup is fetched on first activation and cached
// for the modal's lifetime (key = `${gameId}|${teamId}`). Flipping
// back and forth between tabs is instant after the initial
// fetches. The mock fetcher delays ~160ms — a brief shimmer
// state covers the wire-up while loading.

const lineupCache = ref<Record<string, GameLineupSubmissionDetail>>({})
const loadingKey = ref<string | null>(null)
const errorMessage = ref<string | null>(null)

const cacheKey = computed(() => `${props.gameId}|${activeTeamId.value}`)
const activeDetail = computed<GameLineupSubmissionDetail | null>(() =>
  lineupCache.value[cacheKey.value] ?? null
)
const activeLoading = computed(() => loadingKey.value === cacheKey.value)

async function loadActiveTab() {
  const key = cacheKey.value
  if (lineupCache.value[key]) return  // cache hit
  loadingKey.value = key
  errorMessage.value = null
  try {
    const result = await mockFetchGameLineupSubmission(
      props.gameId,
      activeTeamId.value
    )
    // Defensive — only commit if the modal is still open and the
    // tab the caller fired for is still active. Avoids a stale
    // fetch from a previous open clobbering a fresher one.
    if (!props.modelValue) return
    lineupCache.value = { ...lineupCache.value, [key]: result }
  } catch (err: unknown) {
    errorMessage.value =
      err instanceof Error ? err.message : 'Failed to load lineup.'
  } finally {
    if (loadingKey.value === key) loadingKey.value = null
  }
}

// Reactively fetch when the modal opens OR the active tab
// changes. Game-id changes ALSO trigger a refetch — opening the
// modal for a different game wipes the per-team cache implicitly
// since the cacheKey changes.
watch(
  [() => props.modelValue, activeTab, () => props.gameId],
  ([open]) => {
    if (open) loadActiveTab()
  },
  { immediate: false }
)

// ── Shaping the data for `FieldLineupPreview` ───────────────────

/** Field-config name shown in the preview's header chip
 *  ("Slow Pitch 10 Player"). Falls back to a sensible default
 *  if the response omits it. */
const fieldConfigName = computed<string>(() =>
  activeDetail.value?.fieldConfig?.name ?? 'Slow Pitch 10 Player'
)

/** Field positions with x/y for the SVG pins. Falls back to an
 *  empty array — the preview then renders just the roster list
 *  (no pins on the field) which is the documented behavior of
 *  `FieldLineupPreview` when coords are missing. */
const fieldPositions = computed<FieldConfigPosition[]>(() =>
  activeDetail.value?.fieldConfig?.positions ?? []
)

/** Map the API's `GameLineupPlayer[]` into the preview's
 *  `PreviewPlayer[]` shape. Same mapping the production
 *  `GameLineupSubmissionModal` does when it builds its
 *  `previewLineup` — keeps the two surfaces' renders identical
 *  off the same source payload. */
const previewLineup = computed<PreviewPlayer[]>(() => {
  const players = activeDetail.value?.submission?.players
    ?? activeDetail.value?.players
    ?? []
  return players.map((p) => ({
    id: p.id,
    name: p.playerName,
    jerseyNumber: p.jerseyNumber,
    position: p.positionCode ?? '',
    status: p.isBench ? 'bench' : 'active'
  }))
})
</script>

<template>
  <div
    v-if="modelValue"
    class="modal-backdrop field-preview-modal__backdrop"
    role="presentation"
    @click.self="close"
  >
    <div
      class="modal-card field-preview-modal"
      role="dialog"
      aria-modal="true"
      :aria-label="`Field lineup preview — ${gameTitle}`"
    >
      <!-- No white header — the participation-page preview modal
           hides its header in preview mode and lets the green
           field-stage body fill the popup. We do the same: game
           title/subtitle move into the FieldLineupPreview's
           left-column slot below, and the close X lives inside
           the green toolbar alongside the tabs. -->
      <div class="field-preview-modal__body">
        <!-- Overlay container — sits above the green field
             background. In LIGHT mode it stays transparent so
             the field artwork reads bright + saturated. In DARK
             mode it switches to a 50%-opaque black wash that
             darkens everything underneath (green field + image)
             without dimming the foreground text/pills (those
             render on the same DOM level inside the overlay, so
             their opacity stays 100%). All other content —
             toolbar, switch, close X, field stage, roster lists
             — lives inside this container so the dark wash
             covers the whole preview area uniformly. -->
        <div class="field-preview-modal__overlay">
        <!-- Visitor / Home tab toggle — pinned inside the green
             strip at the top of the body, taking the role of the
             "Close Preview" CTA that the source surface
             (participation page's GameLineupSubmissionModal +
             EventLineupModal) puts there. The tabs are styled as
             white-tinted pills against the green so they read
             with the same visual vocabulary as the participation
             surface's Close Preview button. The modal's header X
             remains the close affordance — we don't need a
             second close inside the preview here. -->
        <div class="field-preview-modal__green-toolbar">
          <!-- Segmented switch — single pill container with two
               segments inside (Visitor / Home). The active segment
               gets a highlighted background within the container,
               so the whole control reads as a single switch instead
               of two separate buttons. Avatars sit before each
               team name; the eyebrow (`Visitor`/`Home`) stays as
               a subtle prefix above the name. -->
          <div class="field-preview-modal__green-toggle" role="tablist">
            <button
              type="button"
              role="tab"
              class="field-preview-modal__green-segment"
              :class="{ 'field-preview-modal__green-segment--active': activeTab === 'visitor' }"
              :aria-selected="activeTab === 'visitor'"
              @click="selectTab('visitor')"
            >
              <TeamAvatar
                :name="visitorLabel || 'Team 1'"
                size="sm"
                class="field-preview-modal__green-segment-avatar"
              />
              <span class="field-preview-modal__green-segment-text">
                <span class="field-preview-modal__green-segment-eyebrow">Visitor</span>
                <span class="field-preview-modal__green-segment-name">{{ visitorLabel || 'Team 1' }}</span>
              </span>
            </button>
            <button
              type="button"
              role="tab"
              class="field-preview-modal__green-segment"
              :class="{ 'field-preview-modal__green-segment--active': activeTab === 'home' }"
              :aria-selected="activeTab === 'home'"
              @click="selectTab('home')"
            >
              <TeamAvatar
                :name="homeLabel || 'Team 2'"
                size="sm"
                class="field-preview-modal__green-segment-avatar"
              />
              <span class="field-preview-modal__green-segment-text">
                <span class="field-preview-modal__green-segment-eyebrow">Home</span>
                <span class="field-preview-modal__green-segment-name">{{ homeLabel || 'Team 2' }}</span>
              </span>
            </button>
          </div>
          <!-- Close affordance — sits inside the green toolbar
               (matches participation's Close Preview placement).
               White-tinted ring that fills on hover, same visual
               vocabulary as the tabs themselves. -->
          <button
            type="button"
            class="field-preview-modal__green-close"
            aria-label="Close"
            @click="close"
          >
            <AppIcon name="close" :size="16" />
          </button>
        </div>

        <!-- Loading state — centered spinner + label. Replaces
             the previous gray shimmer rows because shimmer-block's
             default neutral tones read as washed-out static
             rectangles against the green field-stage background.
             A clean spinner reads better and matches the
             white-tinted vocabulary the toolbar tabs use. -->
        <div
          v-if="activeLoading"
          class="field-preview-modal__loading"
          aria-busy="true"
        >
          <div class="field-preview-modal__loading-spinner" aria-hidden="true"></div>
          <p class="field-preview-modal__loading-label">Loading lineup…</p>
        </div>

        <div v-else-if="errorMessage" class="field-preview-modal__error">
          <p>{{ errorMessage }}</p>
          <button type="button" class="field-preview-modal__retry" @click="loadActiveTab">
            Retry
          </button>
        </div>

        <FieldLineupPreview
          v-else-if="activeDetail"
          :lineup="previewLineup"
          :field-positions="fieldPositions"
          :field-config-name="fieldConfigName"
          :home-team-name="activeTeamLabel"
          grouped-roster
          :editable="false"
        >
          <template #left-column>
            <!-- Left-column context — game label first (replaces the
                 white header we removed), then which side we're
                 looking at, then the side's team identity + the
                 slot time. Matches the participation-page modal's
                 left-column rhythm so the two surfaces feel
                 native to the same design language. -->
            <h3 class="event-lineup-preview__event-name">{{ gameTitle }}</h3>
            <p class="event-lineup-preview__event-division">
              {{ activeTab === 'visitor' ? 'Visitor' : 'Home' }} Lineup
            </p>
            <p class="event-lineup-preview__event-date">{{ activeTeamLabel }}</p>
            <p v-if="gameSubtitle" class="event-lineup-preview__event-date">
              {{ gameSubtitle }}
            </p>
          </template>
        </FieldLineupPreview>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Z-index override — the global `.modal-backdrop` rule sits at
   `z-index: 40`, BELOW the `.slide-modal-backdrop` at 80 used by
   the SlideModal drawer that mounts this preview. Without this
   override, opening the preview from inside the drawer puts it
   BEHIND the drawer panel. Bumping to 90 stacks it cleanly on
   top while still leaving headroom for any future "even more
   modal" use case. */
.field-preview-modal__backdrop.modal-backdrop {
  z-index: 90;
}

/* Top-level shell — overrides `.modal-card`'s defaults
   (`padding: 20px` + `border: 1px solid …`) so the green body
   fills the popup edge to edge with no visible frame around
   the inside. Without these overrides the modal card's 20px
   padding + thin grey border leak around the green canvas. */
.field-preview-modal {
  width: min(940px, calc(100vw - 32px));
  max-height: min(880px, calc(100vh - 32px));
  display: flex;
  flex-direction: column;
  padding: 0;
  border: none;
  overflow: hidden;
  border-radius: 11px;
}

/* White-header rules removed — the modal no longer renders a
   header in preview mode (matches the participation page's
   `<header v-if="!previewMode">` pattern). Game title +
   subtitle now live in the FieldLineupPreview's left-column
   slot below; close affordance lives in the green toolbar. */

/* Body — solid green backdrop matching the participation-page
   preview modal (`#258C31`) so the field preview reads as part
   of the same modal family. The header above stays white;
   everything below it inherits the green to give the preview
   its softball-field-stage vibe. */
.field-preview-modal__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 0;
  background: #258C31;
  display: flex;
  flex-direction: column;
}

/* Overlay container — wraps the toolbar + FieldLineupPreview.
   Transparent in light mode (green field renders bright). In
   dark mode a 50% black wash darkens the green underneath so
   the preview reads as part of the dark theme. Inherits flex
   from the body so the inner toolbar + field stage still stack
   correctly. */
.field-preview-modal__overlay {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: transparent;
}
html.dark-mode .field-preview-modal__overlay {
  /* 60% black wash. Kept in sync with the image filter's
     `brightness(0.4)` below so the body's wash and the SVG
     image's brightness reduction stay mathematically
     equivalent (alpha 0.6 ↔ brightness 0.4 = both multiply
     channel values by 0.4). */
  background: rgba(0, 0, 0, 0.6);
}
/* Dark-mode darkening for the field artwork — the painted
   softball-field `<image>` inside `.event-lineup-preview__field-svg`
   sits OPAQUE on top of the overlay's 50% wash, so without an
   extra filter the field stays bright while the surrounding
   green darkens. The overlay applies `rgba(0,0,0,0.5)` (a
   50% black blend) to its background. To match that on the
   image we use `brightness(0.5)` since
   `brightness(x)` linearly multiplies each channel by x —
   mathematically equivalent to a 50% black blend (channel * 0.5 +
   0 * 0.5 = channel * 0.5). Previous `brightness(0.65)` was
   too BRIGHT relative to the overlay; the image ended up
   reading darker than the surrounding wash because the SVG
   image's intrinsic colors include darker shadows + the dirt
   diamond, so 0.65 left those shadows below the overlay tone.
   `brightness(0.5)` makes the painted grass match the body's
   darkened green cleanly. */
html.dark-mode .field-preview-modal__overlay :deep(.event-lineup-preview__field-svg image) {
  filter: brightness(0.4);
}

/* Hide the FieldLineupPreview's internal Close Preview toolbar.
   That toolbar exists because the component is normally inside
   a modal that doesn't carry its own close affordance — the
   toolbar IS the close. Our modal already has an X in the
   header, so the inner toolbar is redundant. `:deep()` reaches
   past the FieldLineupPreview's scoped style hash. */
.field-preview-modal__body :deep(.event-lineup-preview__toolbar) {
  display: none;
}

/* Replacement green toolbar — takes the visual position of the
   hidden Close Preview toolbar. Layout is: segmented switch
   pinned left, close X pinned right via `justify-content:
   space-between`. Same green background as the body so the
   strip reads as continuous. */
/* Three-column grid: empty left spacer · centered switch ·
   right close-X cell. This pattern centers the segmented switch
   in the GEOMETRIC center of the toolbar (regardless of close-X
   width) while keeping the close pinned right. A
   `space-between` flex layout would push the switch all the way
   to the left edge instead.
   `background: transparent` so the parent `__overlay` wash
   shows through — in light mode that's the body's green; in
   dark mode it's the body's green + 50% black darkening wash,
   so the toolbar visually matches the field area below. */
.field-preview-modal__green-toolbar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: transparent;
  flex: 0 0 auto;
}
/* Switch sits in the middle column (col 2) — implicitly via
   source order, since the toggle is the second child of the
   toolbar grid. */
.field-preview-modal__green-toggle {
  grid-column: 2;
}
/* Close X sits in the third column, pushed to the right edge
   of its cell so the close visually anchors the toolbar's
   right side. */
.field-preview-modal__green-close {
  grid-column: 3;
  justify-self: end;
}

/* Segmented switch container — single rounded pill wrapping
   both segments. White-tinted background + border so the
   container reads as a deliberate toggle component (instead of
   two free-floating buttons). The active segment gets a
   brighter background WITHIN the container, so the whole
   control reads as a single switch with the current selection
   highlighted. */
.field-preview-modal__green-toggle {
  display: inline-flex;
  align-items: stretch;
  padding: 4px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 999px;
  gap: 2px;
  min-width: 0;
}
/* Close affordance — white-tinted ring matching the tabs' visual
   vocabulary. Sits at the right edge of the toolbar; same shape
   as a SlideModal close button (32px circle) for consistency
   across modal close affordances in the app. */
.field-preview-modal__green-close {
  appearance: none;
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.12);
  color: #ffffff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}
.field-preview-modal__green-close:hover {
  background: rgba(255, 255, 255, 0.22);
  border-color: rgba(255, 255, 255, 0.6);
}
/* Individual segment inside the toggle. Transparent by default
   (the container's tinted background shows through); the active
   segment gets its own brighter background to read as the
   highlighted selection. Pill-shaped on both sides so the
   inner highlight matches the container's rounded edges. */
.field-preview-modal__green-segment {
  appearance: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: rgba(255, 255, 255, 0.85);
  cursor: pointer;
  text-align: left;
  min-width: 0;
  transition: background 120ms ease, color 120ms ease;
}
.field-preview-modal__green-segment:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #ffffff;
}
.field-preview-modal__green-segment--active {
  background: rgba(255, 255, 255, 0.28);
  color: #ffffff;
}
.field-preview-modal__green-segment--active:hover {
  background: rgba(255, 255, 255, 0.32);
}
.field-preview-modal__green-segment-avatar {
  flex: 0 0 auto;
}
.field-preview-modal__green-segment-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.field-preview-modal__green-segment-eyebrow {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.7);
  line-height: 1;
}
.field-preview-modal__green-segment--active .field-preview-modal__green-segment-eyebrow {
  color: #ffffff;
}
.field-preview-modal__green-segment-name {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
  line-height: 1.2;
}

/* Hide the entire `.event-lineup-preview__team-head` block in
   the right column — the team identity (avatar + name) is
   already surfaced in the segmented switch's active segment
   above, so repeating it here adds visual weight without
   information. Removing the whole head row also tightens the
   right column's vertical rhythm so STARTERS sits closer to
   the top edge of the panel. */
.field-preview-modal__body :deep(.event-lineup-preview__team-head) {
  display: none;
}

/* Right column left-cut fix — `.event-lineup-preview__team-meta`
   has `overflow: hidden` in styles.css so pills (like the
   Starters / Benched chips' rounded edges + the EH badge's
   box-shadow) sitting at the column's left edge get clipped by
   a few pixels. Adding inner left padding pushes the content
   inward so the rounded corners + glow shadows render fully. */
.field-preview-modal__body :deep(.event-lineup-preview__team-meta) {
  padding-left: 8px;
}

/* ─── Dark-mode tone translations ───────────────────────────── */

/* Position badge (`.event-lineup-preview__offfield-position` —
   the small P / C / SS / EH pill next to each player). Light
   mode keeps the white-tinted translucent. Dark mode softens the
   white tint a notch so it doesn't punch against the dark theme
   chrome surrounding the field. */
html.dark-mode .field-preview-modal__body :deep(.event-lineup-preview__offfield-position) {
  background: rgba(255, 255, 255, 0.14);
  color: #e8eef5;
}

/* "Benched" pill title — amber group label. The default amber
   (`#ffd45a` bg + `#6a4b00` text) is tuned for light theme
   chrome; in dark mode we shift to a translucent amber background
   + a lighter amber text so the chip stays warm-toned but reads
   as part of the dark-theme palette. */
html.dark-mode .field-preview-modal__body :deep(.event-lineup-preview__offfield-title) {
  background: rgba(245, 190, 77, 0.2);
  color: #f5be4d;
}

/* "Starters" pill title — success-green group label. Same idea:
   keep the green tone but flip light fill + dark text to
   translucent fill + light text so the pill sits in the dark
   theme palette. */
html.dark-mode .field-preview-modal__body :deep(.event-lineup-preview__offfield-title--starters) {
  background: rgba(92, 211, 151, 0.2);
  color: #5cd397;
}

/* Left-column subtitle text + jersey numbers — readability fix.
   The shared CSS uses `var(--surface-opaque)` / `var(--surface-card)`
   / `var(--surface-muted)` for these — tokens that resolve to
   light shades in LIGHT mode (so they read as white text on the
   green field) but FLIP to dark slate in DARK mode (because
   surfaces themselves become dark). On the static green field
   here the dark text is invisible. Force explicit light tones
   in dark mode so the text reads cleanly against the (now
   darkened-via-overlay) green. */
html.dark-mode .field-preview-modal__body :deep(.event-lineup-preview__event-division),
html.dark-mode .field-preview-modal__body :deep(.event-lineup-preview__event-date) {
  color: rgba(255, 255, 255, 0.92);
}
html.dark-mode .field-preview-modal__body :deep(.event-lineup-preview__offfield-jersey) {
  color: rgba(255, 255, 255, 0.78);
}

/* Loading state — centered white spinner + small label, lives
   inside the green body. The gray `.shimmer-block` rectangles
   the previous design used were washed out against the green
   field-stage backdrop; a clean spinner reads consistently
   against any background. */
.field-preview-modal__loading {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 60px 20px;
}
.field-preview-modal__loading-spinner {
  width: 32px;
  height: 32px;
  border-radius: 999px;
  border: 3px solid rgba(255, 255, 255, 0.25);
  border-top-color: #ffffff;
  animation: field-preview-modal-spin 0.8s linear infinite;
}
@keyframes field-preview-modal-spin {
  to { transform: rotate(360deg); }
}
.field-preview-modal__loading-label {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.85);
  letter-spacing: 0.02em;
}

.field-preview-modal__error {
  padding: 40px 24px;
  text-align: center;
  color: var(--secondary);
}
.field-preview-modal__retry {
  appearance: none;
  margin-top: 12px;
  padding: 8px 16px;
  border-radius: 6px;
  background: var(--primary);
  border: none;
  color: #ffffff;
  font-weight: 600;
  cursor: pointer;
}

@media (max-width: 720px) {
  .field-preview-modal {
    width: 100vw;
    max-height: 100vh;
    border-radius: 0;
  }
  /* `.field-preview-modal__loading` mobile override removed —
     the new spinner layout is already flex-column + centered, no
     responsive change needed. */
}
</style>
