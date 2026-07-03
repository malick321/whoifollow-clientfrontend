<script setup lang="ts">
// GameLifecycleLogModal
// ----------------------
// Slide-modal showing the full audit log for one scoring game —
// every lifecycle transition (start / mark_delayed / resume /
// end_game / lock / unlock) AND every scoring-side event
// (lineup_submit / add_inning / score_upload / score_correction).
// Opened from the game-details drawer's settings menu when the
// game has started; available regardless of current state (live,
// delayed, final, even locked — the log is read-only).
//
// Pattern mirrors the team-lifecycle timeline on the association
// team-details page: each row carries an actor avatar, the verb
// (e.g. "started the game"), a timestamp, and an optional reason
// / inning number / status diff. Newest entries at the top so
// the operator's most recent action is what they see first.

import { computed, ref, watch } from 'vue'
import SlideModal from './SlideModal.vue'
import TeamAvatar from './TeamAvatar.vue'
import { mockFetchGameLifecycle } from '../api/mockGameLifecycle'
import type {
  GameLifecycleActionType,
  GameLifecycleEntry,
  SchedulerGame
} from '../types'

const props = defineProps<{
  /** Two-way visibility — parent owns the open state. */
  modelValue: boolean
  /** Game whose lifecycle log we're showing. `null` while the
   *  modal is closed (or during the slide-out animation) so the
   *  parent doesn't have to retain the last-shown game. */
  game: SchedulerGame | null
  /** Resolved division name for the header eyebrow. Parent (the
   *  ScoringGameDetailsDrawer) already has this resolved off its
   *  own `divisionName` prop, so it just passes it through. The
   *  lifecycle modal mirrors the drawer's header layout —
   *  eyebrow (division) → title (game label) → subtitle
   *  (date/time) — so the operator sees the same identifying
   *  context they were looking at one click ago in the drawer. */
  divisionName?: string
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
}>()

/* `close()` helper removed — the modal no longer has a custom
 *  footer Close button; the SlideModal's built-in X in the header
 *  handles dismiss and emits `update:modelValue` directly. */

// ── Fetch + cache ────────────────────────────────────────────────
// Cached by game id so re-opening the modal for the same game
// reuses the previous response. Cache invalidates when the game
// id changes (parent passes a different game).
const entries = ref<GameLifecycleEntry[]>([])
const loading = ref(false)
const errorMessage = ref<string | null>(null)
const lastFetchedGameId = ref<string | null>(null)

async function loadLifecycle() {
  if (!props.game) return
  // Reuse cached entries if we already loaded this game.
  if (lastFetchedGameId.value === props.game.id && entries.value.length > 0) {
    return
  }
  loading.value = true
  errorMessage.value = null
  try {
    entries.value = await mockFetchGameLifecycle(props.game)
    lastFetchedGameId.value = props.game.id
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : 'Failed to load lifecycle.'
  } finally {
    loading.value = false
  }
}

// Open the modal → kick off the fetch. Closing doesn't clear the
// cache so a re-open is instant if the game id hasn't changed.
watch(
  () => props.modelValue,
  (open) => {
    if (open && props.game) {
      loadLifecycle()
    }
  }
)
// Game switch while open → reload.
watch(
  () => props.game?.id,
  (id) => {
    if (id && props.modelValue) {
      loadLifecycle()
    }
  }
)

// ── Display helpers ──────────────────────────────────────────────

/** Verb phrase per action type — completes the headline
 *  "<actorName> <verb>". Kept short + past-tense so the timeline
 *  reads as a log of completed events. */
function verbForAction(type: GameLifecycleActionType): string {
  switch (type) {
    case 'start': return 'started the game'
    case 'mark_delayed': return 'marked the game as delayed'
    case 'resume': return 'resumed the game'
    case 'end_game': return 'ended the game'
    case 'reopen_game': return 'reopened the game'
    case 'lock': return 'locked the game'
    case 'unlock': return 'unlocked the game'
    case 'add_inning': return 'opened a new inning'
    case 'delete_inning': return 'deleted an inning'
    case 'swap_sides': return 'swapped home / visitor sides'
    case 'score_upload': return 'uploaded inning-by-inning scores'
    case 'score_correction': return 'corrected an inning score'
    case 'lineup_submit': return 'submitted the lineup'
    default: return 'updated the game'
  }
}

/* (`toneClassForAction` helper removed — the timeline now binds
 *  `game-lifecycle__row--<actionType>` directly off `entry.actionType`,
 *  same per-action-type convention the team-lifecycle timeline uses.
 *  Ring colors are mapped per-action in the scoped CSS below.) */

/** Human-readable timestamp — same format the team-lifecycle log
 *  uses on the association team-details page. */
function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

/** Status-diff label per side (e.g. "Live", "Delayed"). Returns
 *  empty string for nulls so the diff row is skipped entirely. */
function statusLabel(s: 'scheduled' | 'live' | 'delayed' | 'final' | null): string {
  if (!s) return ''
  switch (s) {
    case 'scheduled': return 'Scheduled'
    case 'live': return 'Live'
    case 'delayed': return 'Delayed'
    case 'final': return 'Final'
  }
}

function hasStatusDiff(entry: GameLifecycleEntry): boolean {
  return entry.fromStatus !== null && entry.toStatus !== null && entry.fromStatus !== entry.toStatus
}

const isEmpty = computed(
  () => !loading.value && !errorMessage.value && entries.value.length === 0
)

// Header info MIRRORS the parent drawer's header so the operator
// sees the same identifying context one click later. Three lines:
//   - eyebrow → division name (caps, secondary tint)
//   - title   → game label (e.g. "Pool 5")
//   - subtitle → "Wed, Apr 29 · 09:30 AM"

/** Format a scheduled-date ISO string ("2026-04-29") into a
 *  weekday + month + day display ("Wed, Apr 29"). `T00:00:00` on
 *  the parse anchors to local time so the weekday doesn't shift
 *  across a UTC boundary. Same helper logic the drawer uses. */
function formatScheduledDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  })
}

/** Game label for the title — falls back to "Game" when the
 *  drawer is still mid-animation and the prop hasn't landed. */
const modalTitle = computed(() => props.game?.label ?? 'Game')

/** Eyebrow — resolved division name from the parent (mirrors the
 *  drawer's `divisionName` prop). Empty string short-circuits the
 *  SlideModal's `v-if` so no eyebrow row paints when no division
 *  context is available. */
const modalEyebrow = computed(() => props.divisionName ?? '')

/** Subtitle — combined date + time on the same line. Field/park
 *  is intentionally omitted (matches the drawer's `slotLine`
 *  rationale: the meta-cards row already carries Location). */
const modalSubtitle = computed(() => {
  if (!props.game) return ''
  const parts: string[] = []
  const dateLabel = formatScheduledDate(props.game.scheduledDate)
  if (dateLabel) parts.push(dateLabel)
  if (props.game.scheduledTime) parts.push(props.game.scheduledTime)
  return parts.join(' · ')
})
</script>

<template>
  <SlideModal
    :model-value="modelValue"
    :eyebrow="modalEyebrow"
    :title="modalTitle"
    :subtitle="modalSubtitle"
    @update:model-value="(v) => emit('update:modelValue', v)"
  >
    <div class="game-lifecycle">
      <!-- Loading state — same shimmer-row pattern as the
           game-lineups list inside the drawer. -->
      <div
        v-if="loading"
        class="game-lifecycle__loading"
      >
        <span
          v-for="i in 4"
          :key="`lc-skel-${i}`"
          class="shimmer-block game-lifecycle__loading-row"
        ></span>
      </div>

      <!-- Error state — retry button hits `loadLifecycle()` again. -->
      <div
        v-else-if="errorMessage"
        class="game-lifecycle__error"
      >
        <p>{{ errorMessage }}</p>
        <button
          type="button"
          class="game-lifecycle__retry"
          @click="loadLifecycle"
        >Retry</button>
      </div>

      <!-- Empty state — happens for `scheduled` games (no actions
           recorded yet) and as a defensive fallback. -->
      <div
        v-else-if="isEmpty"
        class="game-lifecycle__empty"
      >
        No lifecycle activity yet — the log populates once the game starts.
      </div>

      <!-- Timeline — `<ol>` so the entries are semantically an
           ordered list (newest first). Each row gets a tone
           modifier so the left-rail dot picks up an event-type
           color. -->
      <ol v-else class="game-lifecycle__timeline">
        <li
          v-for="entry in entries"
          :key="entry.id"
          class="game-lifecycle__row"
          :class="`game-lifecycle__row--${entry.actionType}`"
        >
          <!-- Avatar — reuses the same TeamAvatar used in the
               team-lifecycle log so the two timelines feel like
               one design pattern. -->
          <span class="game-lifecycle__avatar">
            <TeamAvatar :name="entry.actorName" size="md" />
          </span>
          <div class="game-lifecycle__body">
            <p class="game-lifecycle__headline">
              <strong>{{ entry.actorName }}</strong>
              <span>{{ verbForAction(entry.actionType) }}</span>
              <span class="game-lifecycle__date">
                {{ formatTimestamp(entry.occurredAt) }}
              </span>
            </p>
            <!-- Status diff — rendered for any entry whose
                 from→to status actually moved. Hidden for
                 non-transitioning rows like `add_inning` or
                 `score_upload`. -->
            <p
              v-if="hasStatusDiff(entry)"
              class="game-lifecycle__diff"
            >
              Status:
              <span class="game-lifecycle__diff-from">{{ statusLabel(entry.fromStatus) }}</span>
              →
              <span class="game-lifecycle__diff-to">{{ statusLabel(entry.toStatus) }}</span>
            </p>
            <!-- Inning context — `add_inning` says which inning was
                 opened; `score_correction` says which inning was
                 edited. Skipped for entries without an inning. -->
            <p
              v-if="entry.inningNumber !== null"
              class="game-lifecycle__inning"
            >
              Inning {{ entry.inningNumber }}
            </p>
            <!-- Reason — present for `mark_delayed` (mandatory)
                 and `score_correction` (operator note). Rendered
                 as a quoted block to read as the actor's own
                 explanation. -->
            <p
              v-if="entry.reason"
              class="game-lifecycle__reason"
            >“{{ entry.reason }}”</p>
          </div>
        </li>
      </ol>
    </div>
    <!-- (No footer — the modal's only affordance is "close" which
         the SlideModal header's X button already provides; a
         second close button at the bottom is redundant.) -->
  </SlideModal>
</template>

<style scoped>
.game-lifecycle {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Loading shimmer — four rows roughly matching the timeline row
   height so the layout doesn't jump when entries land. */
.game-lifecycle__loading {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.game-lifecycle__loading-row {
  height: 60px;
  border-radius: 8px;
}

/* Error + empty + retry — borrowed from the drawer's
   `.scoring-drawer__lineups-*` states so the visual vocabulary
   stays consistent across this drawer + modal pair. */
.game-lifecycle__error,
.game-lifecycle__empty {
  padding: 24px 16px;
  text-align: center;
  color: var(--secondary);
  font-size: 14px;
}
.game-lifecycle__retry {
  appearance: none;
  margin-top: 12px;
  padding: 6px 14px;
  border-radius: 6px;
  border: none;
  background: var(--primary);
  color: #ffffff;
  font-weight: 600;
  cursor: pointer;
}

/* Timeline ordered list — `<ol>` semantics, no default list
   chrome since the avatars stand in for the bullet column.
   Spacing + connector-rail strategy mirrors the team-lifecycle
   timeline (`.team-lifecycle-timeline` in styles.css) so both
   surfaces feel native to the same design language. */
.game-lifecycle__timeline {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.game-lifecycle__row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  position: relative;
}

/* Connector rail PER ROW — drawn from the center of one avatar
   down into the next row's gap. Hidden on the last row so the
   line doesn't dangle past the final entry. Same `::before`
   pattern the team-lifecycle log uses. */
.game-lifecycle__row::before {
  content: '';
  position: absolute;
  left: 21px;        /* half of avatar wrapper width (42/2) */
  top: 46px;         /* below the avatar */
  bottom: -18px;     /* into the next row's gap */
  width: 1px;
  background: var(--border-divider);
}
.game-lifecycle__row:last-child::before {
  display: none;
}

/* Avatar wrapper — 42×42 padded ring around a `size="md"`
   TeamAvatar. Matches `.team-lifecycle-timeline__avatar` exactly
   so the two timeline surfaces share the same scale + visual
   weight. `position: relative; z-index: 1` keeps the avatar
   sitting above the connector rail behind it. */
.game-lifecycle__avatar {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: 999px;
  padding: 2px;
  background: var(--white);
  border: 2px solid var(--border-divider);
  position: relative;
  z-index: 1;
}
html.dark-mode .game-lifecycle__avatar {
  background: var(--surface-card);
}

/* Action-specific ring colors. Same palette mapping the team-
   lifecycle log uses (green = forward progress, amber = pause /
   correction / configuration, red = destructive, blue = info /
   neutral). Per-action-type modifiers (NOT generic tone
   classes) match the team timeline's `__row--<actionType>`
   convention — keeps the audit log surfaces consistent. */
.game-lifecycle__row--start         .game-lifecycle__avatar,
.game-lifecycle__row--resume        .game-lifecycle__avatar,
.game-lifecycle__row--reopen_game   .game-lifecycle__avatar {
  border-color: rgba(46, 174, 102, 0.6);
}
.game-lifecycle__row--mark_delayed     .game-lifecycle__avatar,
.game-lifecycle__row--score_correction .game-lifecycle__avatar,
.game-lifecycle__row--swap_sides       .game-lifecycle__avatar {
  border-color: rgba(255, 184, 0, 0.7);
}
.game-lifecycle__row--delete_inning .game-lifecycle__avatar {
  border-color: rgba(192, 65, 58, 0.6);
}
.game-lifecycle__row--end_game .game-lifecycle__avatar,
.game-lifecycle__row--lock     .game-lifecycle__avatar {
  border-color: rgba(108, 117, 125, 0.7);
}
.game-lifecycle__row--unlock        .game-lifecycle__avatar,
.game-lifecycle__row--add_inning    .game-lifecycle__avatar,
.game-lifecycle__row--score_upload  .game-lifecycle__avatar,
.game-lifecycle__row--lineup_submit .game-lifecycle__avatar {
  border-color: rgba(45, 140, 240, 0.6);
}

.game-lifecycle__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 6px;
}

.game-lifecycle__headline {
  margin: 0;
  font-size: 0.92rem;
  color: var(--text);
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: baseline;
}
.game-lifecycle__headline strong {
  font-weight: 600;
}
.game-lifecycle__date {
  color: var(--secondary, #62748a);
  font-size: 0.82rem;
}

.game-lifecycle__diff {
  margin: 0;
  font-size: 0.85rem;
  color: var(--secondary, #62748a);
}
.game-lifecycle__diff-from {
  color: var(--text);
}
.game-lifecycle__diff-to {
  color: var(--text);
  font-weight: 500;
}

.game-lifecycle__inning {
  margin: 0;
  font-size: 0.85rem;
  color: var(--text);
  font-weight: 500;
}

.game-lifecycle__reason {
  margin: 0;
  font-size: 0.85rem;
  color: var(--text);
  font-style: italic;
  padding: 6px 10px;
  background: var(--surface-pill);
  border-left: 2px solid var(--border-divider);
  border-radius: 0 5px 5px 0;
}

/* `.game-lifecycle__close-btn` rule removed — footer Close
 *  affordance was retired; SlideModal's header X is the only
 *  dismiss control now. */
</style>
