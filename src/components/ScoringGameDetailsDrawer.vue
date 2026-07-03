<script setup lang="ts">
// ScoringGameDetailsDrawer
// ------------------------
// Right-edge slide-out drawer used when a scorekeeper / umpire
// taps a permitted game cell on the matchgeni field-grid. Replaces
// the earlier centered `ScoringGameActionsModal` per the user's
// "use the inspector-drawer shape we use everywhere else" feedback.
//
// Layout, top-to-bottom inside the drawer body:
//   1. Game info header   — division eyebrow + game label + status
//                           badge, teams "vs" line, time / field /
//                           park slot line.
//   2. Actions toolbar    — 4 stub buttons (Score game / Enter
//                           score by inning / Upload inning-by-
//                           inning / Mark as delayed). Each emits
//                           a `('action', id)` so the parent can
//                           wire downstream behavior without the
//                           drawer knowing what each action means.
//   3. Line-score table   — inning-by-inning runs for BOTH teams,
//                           with R / H / E totals on the right.
//                           Mirrors the line-score layout from
//                           `ScoresheetView` (CSS grid, sticky
//                           team column on narrow viewports,
//                           tabular-nums for clean digit alignment)
//                           so the two surfaces read the same.
//
// Why a per-game DRAWER vs a centered modal:
//   - Drawer reads as "inspector for this game" rather than
//     "blocking dialog" — matches the user's mental model of
//     navigating between cells in the grid without losing context.
//   - The grid stays partially visible behind the drawer, so the
//     TD can see neighboring fields / times for situational
//     awareness while acting on the selected game.
//   - Mobile (≤720px) — `SlideModal` flips the panel to full-
//     viewport-width, so the same component scales without a
//     separate mobile path.

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import SlideModal from './SlideModal.vue'
import LineScore, { type LineScoreHeadBadge, type LineScoreRow } from './scoring-lib/LineScore.vue'
import FieldLineupPreviewModal from './FieldLineupPreviewModal.vue'
import GameLifecycleLogModal from './GameLifecycleLogModal.vue'
import TeamAvatar from './TeamAvatar.vue'
import { canScoreGame, canMatchGeniWrite } from '../matchgeni-context'
import { mockFetchGameLineupSubmission } from '../api/mockGameLineupSubmission'
import type { GameLineupSubmissionDetail } from '../types'
import type { SchedulerGame } from '../types'

/** Action identifiers emitted to the parent. The set of actions
 *  available at any given moment is GATED by game status (see
 *  `primaryAction` / `uploadAction` / `overflowActions` below).
 *  Action matrix (post-redesign):
 *
 *  ┌──────────────────┬───────────────────────┬─────────┬───────────────────────────┐
 *  │ Status           │ Primary               │ Upload  │ Overflow (settings ⋯)     │
 *  ├──────────────────┼───────────────────────┼─────────┼───────────────────────────┤
 *  │ scheduled        │ Start Game            │ Upload  │ (none — kebab hidden)     │
 *  │ live             │ Resume Scoring        │ Upload  │ Mark as delayed, End game │
 *  │ delayed          │ Remove Game Delay (W) │ Upload  │ (none — kebab hidden)     │
 *  │ final + unlocked │ —                     │ Upload  │ Lock game                 │
 *  │ final + locked   │ —                     │ —       │ Unlock game               │
 *  └──────────────────┴───────────────────────┴─────────┴───────────────────────────┘
 *  (W) = warning tone — `Remove Game Delay` paints in the warning
 *  palette since flipping a delay flag is a state-reversing
 *  transition, not a forward step like `Start` / `Resume Scoring`.
 *
 *  Notes on the redesign:
 *  - The old `Enter score by inning` overflow item collapsed into
 *    the primary button — labelled per-state ("Start Game" on
 *    scheduled, "Resume Scoring" on live) so the affordance reads
 *    as the literal lifecycle transition.
 *  - `Upload inning by inning` was promoted out of the overflow
 *    menu into a permanent secondary toolbar button labelled just
 *    `Upload` — one click away regardless of lifecycle state.
 *  - The settings ⋯ kebab is hidden entirely whenever there are
 *    no items to put inside it (was always visible before, with
 *    only the upload/enter pair as items — both now relocated).
 *  - `final` games gained the `Lock` / `Unlock` lifecycle. A
 *    locked final game shows zero controls except the Unlock
 *    affordance, so admins can freeze scores after confirmation.
 *
 *  The `start-game` action ALSO opens an inline form in the
 *  drawer (home-team picker, actual start time, time limit)
 *  before emitting — the parent receives the action id on
 *  Confirm, then reads the form's snapshot via the
 *  `start-game-confirm` payload on `('action-payload', …)` if
 *  needed. v1 emits the id only; the actual start payload wiring
 *  lands in the backend follow-up. */
export type ScoringDrawerAction =
  | 'start-game'        // scheduled — opens the start-game form, then triggers scoring
  | 'enter-by-inning'   // live — opens the scoresheet for inning-by-inning entry
  | 'upload-by-inning'  // any unlocked state — opens the bulk-upload flow
  | 'mark-delayed'      // live → delayed
  | 'resume-game'       // delayed → live
  | 'end-game'          // live → final
  | 'lock-game'         // final unlocked → final locked
  | 'unlock-game'       // final locked → final unlocked
  | 'view-lifecycle'    // ANY status except scheduled — open the lifecycle log modal
  | 'assign-umpires'    // open the umpire crew assignment for this game

const props = defineProps<{
  /** Two-way visibility — parent owns the open state and routes
   *  `update:modelValue` through to `SlideModal`. */
  modelValue: boolean
  /** Game being inspected. `null` while the drawer is closed (or
   *  during the slide-out animation) so the parent doesn't have
   *  to retain the last-shown game. */
  game: SchedulerGame | null
  /** Resolved division name for the header eyebrow. Parent
   *  resolves it (it owns the division catalogue) so the drawer
   *  stays data-fetch-free. */
  divisionName?: string
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'action', action: ScoringDrawerAction): void
  (event: 'edit'): void
}>()

// ── Permission-driven affordances ────────────────────────────────
// The drawer renders the SAME options no matter which surface opened
// it (scheduler / division page / field grid). What a given user sees
// is decided here, by their MatchGeni permissions for THIS game — NOT
// by the calling surface. Each affordance has its own gate:
//   - Scoring lifecycle toolbar → scope-aware `manage_scoring`.
//   - "Edit game" (pool matchup/slot/limit) → `manage_scheduling`
//     OR `manage_divisions`.
//   - Assign / Change umpires → `manage_umpires`.

/** Can the caller drive this game's scoring lifecycle (Start / Resume /
 *  Upload / Mark delayed / End / Lock…)? Scope-aware via `canScoreGame`. */
const canScore = computed<boolean>(() =>
  !!props.game && canScoreGame({ parkId: props.game.parkId ?? '', divisionId: props.game.divisionId })
)

/** Can the caller edit this game (pool only — matchup / time slot / time
 *  limit)? A scheduling OR divisions manager qualifies. */
const canEdit = computed<boolean>(() =>
  !!props.game &&
  props.game.type === 'pool' &&
  (canMatchGeniWrite('manage_scheduling') || canMatchGeniWrite('manage_divisions'))
)

/** Can the caller assign / change the umpire crew for this game? */
const canAssignUmpires = computed<boolean>(() => canMatchGeniWrite('manage_umpires'))

function close() {
  emit('update:modelValue', false)
}
function onEdit() {
  emit('edit')
}

// ── Header derivations ──────────────────────────────────────────

/** Parse an ISO `YYYY-MM-DD` into a short display label
 *  ("Wed, Apr 29"). Uses `T00:00:00` on the parse so the local-
 *  time Date constructor doesn't shift the weekday across a UTC
 *  boundary. Returns the raw ISO string if parsing fails (rare —
 *  malformed backend data). */
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

/** Single-line label combining the slot's date + time — used as
 *  the SlideModal subtitle. Field / park is INTENTIONALLY OMITTED
 *  here because the meta-cards row below the header already
 *  carries Location as its own dedicated card; duplicating the
 *  field on the title strip read as noisy. Date comes first so
 *  multi-day-event users can immediately confirm which day's
 *  game they opened. */
const slotLine = computed(() => {
  if (!props.game) return ''
  const parts: string[] = []
  const dateLabel = formatScheduledDate(props.game.scheduledDate)
  if (dateLabel) parts.push(dateLabel)
  if (props.game.scheduledTime) parts.push(props.game.scheduledTime)
  return parts.join(' · ')
})

/** Resolved status badge for the `LineScore` component's
 *  `headBadge` prop — renders in the first cell of the line-score
 *  head row, matching ScoresheetView's convention. Delayed games
 *  collapse the reason into the badge label
 *  ("Delayed - Lightning in area") so the chip carries the full
 *  why-and-what in one element instead of needing a separate
 *  reason span.
 *
 *  Label rules:
 *    - `'Live'` / `'Delayed [- reason]'` / `'F'` (matches the
 *      compact glyph used on the field-grid cell so the same
 *      status reads identically on the cell + the drawer) /
 *      `'Yet to begin'`.
 *  Tone rules:
 *    - `live` → `danger`, `delayed` → `warning`,
 *      `final` → `neutral`, default → `info`. */
const lineScoreHeadBadge = computed<LineScoreHeadBadge | null>(() => {
  if (!props.game) return null
  const status = props.game.status
  if (status === 'live') return { label: 'Live', tone: 'danger' }
  if (status === 'delayed') {
    const reason = props.game.delayReason
    return {
      label: reason ? `Delayed - ${reason}` : 'Delayed',
      tone: 'warning'
    }
  }
  if (status === 'final') return { label: 'F', tone: 'neutral' }
  return { label: 'Yet to begin', tone: 'info' }
})

// ── Meta box derivations ────────────────────────────────────────
// Mirrors the trio of meta cards on `ScoresheetView` (Started /
// Scheduled / Unscheduled time, Time Limit, Location). Same rules
// as the source surface — labels flip with game state, time-limit
// dashes when missing, location renders top/bottom lines for
// venue + city/state — so the two screens read identically.

/** Label above the time value:
 *   - `'Started'`     — actual start recorded (live/delayed/final).
 *   - `'Scheduled'`   — schedule on file but not yet started.
 *   - `'Unscheduled'` — neither.
 *  Matches the `displayStartTimeLabel` rules in ScoresheetView. */
const metaStartLabel = computed<string>(() => {
  if (!props.game) return 'Unscheduled'
  const started = props.game.status === 'live'
    || props.game.status === 'delayed'
    || props.game.status === 'final'
  if (started && props.game.scheduledTime) return 'Started'
  if (props.game.scheduledTime) return 'Scheduled'
  return 'Unscheduled'
})

/** Time value displayed alongside `metaStartLabel`. Empty string
 *  for unscheduled games so the template can hide the strong
 *  element entirely (label-only card, same as ScoresheetView's
 *  `v-if="displayStartTime"` pattern). */
const metaStartValue = computed<string>(() =>
  props.game?.scheduledTime ?? ''
)

/** Time-limit value — dash placeholder when missing so the card
 *  always has a value line below the label (label-only would make
 *  the card look broken). Mocked from the game id hash since the
 *  v1 `SchedulerGame` doesn't carry a `timeLimit` field; backend
 *  will ship this explicitly. */
const metaTimeLimit = computed<string>(() => {
  if (!props.game) return '-'
  const started = props.game.status === 'live'
    || props.game.status === 'delayed'
    || props.game.status === 'final'
  // Backend only assigns timeLimit once the game has started in
  // the real wire shape — preserve the same rule here so a
  // scheduled game shows '-'.
  if (!started) return '-'
  // Mock — hash the game id so each game gets a stable, varied
  // value across 60 / 65 / 70 / 75 / 80 minute caps.
  let h = 0
  for (let i = 0; i < props.game.id.length; i++) {
    h = (h * 31 + props.game.id.charCodeAt(i)) >>> 0
  }
  const caps = [60, 65, 70, 75, 80]
  return `${caps[h % caps.length]} min`
})

/** Location top / bottom lines — top carries `field - park`, the
 *  optional bottom carries `city, state`. Same render contract as
 *  ScoresheetView's `venueSummary` (we don't have city/state in
 *  the mock SchedulerGame so the bottom line is always empty;
 *  caller can extend later). When the top line is empty too, the
 *  template falls through to a single dash. */
const metaLocationTop = computed<string>(() =>
  props.game?.scheduledFieldLabel ?? ''
)
const metaLocationBottom = computed<string>(() => '')

/** Assigned umpires for the game. Mock derived from a small pool
 *  hashed off the game id so each game shows a stable but varied
 *  assignment. Backend will ship `umpires: string[]` once the
 *  assignment endpoint lands; the meta card just needs a display
 *  array today. Returns an empty array to fall through to the
 *  "Not assigned" placeholder when the game id is missing.
 *
 *  Crew size varies per game: 1, 2, or 3 umpires depending on
 *  the hash — covers the realistic spread (single-ump games,
 *  two-ump assignments, and rare three-ump finals) so the
 *  "+N more" affordance in the card has something to surface. */
const MOCK_UMPIRE_POOL = [
  'A. Smith', 'J. Johnson', 'R. Williams', 'D. Brown',
  'M. Davis', 'K. Miller', 'P. Wilson', 'T. Moore',
  'S. Taylor', 'L. Anderson'
]
const metaUmpires = computed<string[]>(() => {
  const g = props.game
  if (!g) return []
  let h = 0
  for (let i = 0; i < g.id.length; i++) {
    h = (h * 31 + g.id.charCodeAt(i)) >>> 0
  }
  // Crew size: 1 (40%), 2 (45%), 3 (15%) — weighted toward 2,
  // which is the common slow-pitch assignment.
  const sizeRoll = h % 20
  const crewSize = sizeRoll < 8 ? 1 : sizeRoll < 17 ? 2 : 3
  // Pick `crewSize` distinct names from the pool by stepping
  // through different bit-shifted moduli. `>>>` (unsigned shift)
  // matters here — a plain `>>` propagates the sign bit when
  // `h` has the high bit set (common, since the hash overflows
  // 32-bit signed for most game ids), and `negativeIdx % length`
  // in JS returns NEGATIVE, which then indexes the pool at
  // `undefined` and leaves empty spans in the rendered list.
  const picks: string[] = []
  for (let i = 0; i < crewSize; i++) {
    const idx = ((h >>> (i * 5)) + i * 3) % MOCK_UMPIRE_POOL.length
    const name = MOCK_UMPIRE_POOL[idx]
    if (name && !picks.includes(name)) picks.push(name)
  }
  return picks
})

/** Current-scorer name — same mock-derived pattern as
 *  `metaUmpires`, drawn from a small dedicated pool so the value
 *  stays deterministic per `game.id` across renders. Used by the
 *  umpires-banner head row's right-side "Current Scorer: <name>"
 *  label. Production wiring: replace the hash lookup with the
 *  actual `currentScorer` field on the game payload once backend
 *  ships it. */
const MOCK_SCORER_POOL = [
  'B. Carter', 'N. Reed', 'F. Lopez', 'G. Patel',
  'C. Wright', 'E. Harris', 'V. Singh', 'O. Khan'
]
const metaScorer = computed<string | null>(() => {
  const g = props.game
  if (!g) return null
  let h = 0
  for (let i = 0; i < g.id.length; i++) {
    h = (h * 31 + g.id.charCodeAt(i)) >>> 0
  }
  return MOCK_SCORER_POOL[h % MOCK_SCORER_POOL.length] ?? null
})

/* `metaUmpiresDisplay` removed — the umpires moved into a
 * dedicated full-width strip that renders the names as a flex
 * list directly, so the "+N more" string formatter is no longer
 * needed. */

// ── Line-score derivations ──────────────────────────────────────
// Data shaping for the reusable `LineScore` component. The grid
// template + viewport-width listener live INSIDE `LineScore` now;
// this view only owns the data shape it passes through.

/** True once the game has STARTED — gates the inning columns +
 *  Runs/HR summary in `LineScore`. Pre-start games show only the
 *  team-identity row, matching the rules in ScoresheetView. */
const hasStarted = computed(() => {
  if (!props.game) return false
  const s = props.game.status
  return s === 'live' || s === 'delayed' || s === 'final'
})

/** Inning numbers `[1, 2, … N]`. Length = max of the two teams'
 *  inning-array lengths (handles mid-inning games where the
 *  bottom team hasn't batted yet). */
const lineScoreInnings = computed<number[]>(() => {
  const g = props.game
  if (!g) return []
  const t1 = g.team1InningScores?.length ?? 0
  const t2 = g.team2InningScores?.length ?? 0
  return Array.from({ length: Math.max(t1, t2) }, (_, i) => i + 1)
})

function totalRuns(scores: number[] | undefined): number {
  return (scores ?? []).reduce((a, b) => a + b, 0)
}
/** Mock HR derived from the run total so the column stays
 *  populated without extending the SchedulerGame shape. Backend
 *  will ship an explicit `homeRuns` per team later. */
function mockHomeRuns(scores: number[] | undefined): number {
  return Math.floor(totalRuns(scores) / 4)
}

/** Rows for the `LineScore` component. Team 1 = Visitor (listed
 *  first on the scoreboard), Team 2 = Home — mock convention
 *  until backend ships per-team side. `isBatting` for live games
 *  is the side whose inning count is shorter (in the in-progress
 *  inning); no batting team for final / scheduled. */
const lineScoreRows = computed<LineScoreRow[]>(() => {
  const g = props.game
  if (!g) return []
  const t1Len = g.team1InningScores?.length ?? 0
  const t2Len = g.team2InningScores?.length ?? 0
  const t1Batting = g.status === 'live' && t1Len < t2Len
  const t2Batting = g.status === 'live' && t2Len < t1Len
  return [
    {
      key: 'team1',
      name: g.team1Label ?? 'Team 1',
      imageUrl: '',
      seed: '',
      side: 'V',
      isBatting: t1Batting,
      scores: g.team1InningScores ?? [],
      runs: totalRuns(g.team1InningScores),
      homeRuns: hasStarted.value ? mockHomeRuns(g.team1InningScores) : '-'
    },
    {
      key: 'team2',
      name: g.team2Label ?? 'Team 2',
      imageUrl: '',
      seed: '',
      side: 'H',
      isBatting: t2Batting,
      scores: g.team2InningScores ?? [],
      runs: totalRuns(g.team2InningScores),
      homeRuns: hasStarted.value ? mockHomeRuns(g.team2InningScores) : '-'
    }
  ]
})

/** Currently-batting inning for the active highlight. Pulled
 *  from the longer inning array — in-progress inning is one past
 *  whichever team has fewer entries. `null` for non-live games. */
const currentInning = computed<number | null>(() => {
  const g = props.game
  if (!g || g.status !== 'live') return null
  const t1 = g.team1InningScores?.length ?? 0
  const t2 = g.team2InningScores?.length ?? 0
  return Math.max(t1, t2)
})

// ── Actions toolbar — lifecycle-aware ────────────────────────────
// The action set the operator sees depends on the current game
// status. Rules captured in the `ScoringDrawerAction` type doc
// above. Tone drives visual emphasis (primary = recommended next
// step, warning = delay action, success = resume, neutral = the
// rest).

interface ActionButton {
  id: ScoringDrawerAction
  label: string
  tone: 'primary' | 'neutral' | 'warning' | 'success' | 'danger'
}

/** Overflow-menu item — either a clickable action OR a visual
 *  divider separating two action groups inside the popover. The
 *  divider has no `id` / `label` / `tone`; the template checks
 *  `kind === 'divider'` to render an `<li>` separator instead of
 *  a button. Used to split the Game Lifecycle entry (always at
 *  the top) from the lifecycle-transition actions below it. */
type OverflowItem = ActionButton | { kind: 'divider' }

/** Whether the game is "locked" — a final game that's been frozen
 *  by an admin so no further scoring edits are allowed. When
 *  locked, NO controls render except the Unlock affordance in
 *  the overflow menu. Only meaningful for `status === 'final'`;
 *  for other statuses the flag is ignored. */
const isLocked = computed(
  () => props.game?.status === 'final' && props.game?.locked === true
)

/** Primary lifecycle action for the current status — the
 *  recommended next step, rendered as a real button in the
 *  header-actions cluster. Each status carries its own verb so
 *  the affordance reads as the literal transition the operator
 *  is firing:
 *    - scheduled → "Start Game"  (kicks off the start-game form,
 *      then transitions scheduled → live)
 *    - live      → "Resume Scoring"  (jumps to the scoresheet for
 *      ongoing inning-by-inning entry)
 *    - delayed   → "Remove Game Delay"  (warning tone — clearing
 *      a delay flag flips back to live; warning palette signals
 *      "this changes state away from a paused condition")
 *
 *  Returns `null` for `final` (no lifecycle transition to take —
 *  Lock/Unlock lives in the overflow), and for `locked` games (no
 *  controls at all until unlocked). */
const primaryAction = computed<ActionButton | null>(() => {
  if (isLocked.value) return null
  const status = props.game?.status ?? 'scheduled'
  if (status === 'scheduled') {
    return { id: 'start-game', label: 'Start Game', tone: 'primary' }
  }
  if (status === 'live') {
    return { id: 'enter-by-inning', label: 'Resume Scoring', tone: 'primary' }
  }
  if (status === 'delayed') {
    return { id: 'resume-game', label: 'Remove Game Delay', tone: 'warning' }
  }
  // final (unlocked) — no primary CTA; Lock lives in overflow.
  return null
})

/** Upload action — promoted out of the overflow menu and into
 *  the main toolbar as a secondary button alongside the primary
 *  action. Always available EXCEPT on locked games (which display
 *  no controls). Same Upload affordance regardless of lifecycle
 *  state — it routes to the bulk inning-by-inning upload flow. */
const uploadAction = computed<ActionButton | null>(() => {
  if (isLocked.value) return null
  return { id: 'upload-by-inning', label: 'Upload', tone: 'neutral' }
})

/** Remaining actions for the current status — shown inside the
 *  overflow (⋯) settings menu. The kebab affordance only renders
 *  when this array is non-empty.
 *
 *  Menu ordering (rewritten):
 *    1. `Game Lifecycle` — ALWAYS the first item (when present),
 *       so the audit-log entry point is in the same predictable
 *       slot regardless of game state.
 *    2. Visual divider separating the lifecycle entry from the
 *       transition actions below (only inserted when there ARE
 *       transition actions to follow).
 *    3. Lifecycle-transition actions (`Mark as delayed`, etc.).
 *    4. Destructive / terminal actions LAST — `End game`,
 *       `Lock game`, `Unlock game` — painted in the `danger`
 *       tone (red) so they read as state-altering operations
 *       the operator should weigh deliberately.
 *
 *  Per-status matrix:
 *    - scheduled        → []                                    (no kebab)
 *    - live             → [Lifecycle, ÷, Mark as delayed, End game (R)]
 *    - delayed          → [Lifecycle]                           (kebab has only the log)
 *    - final + unlocked → [Lifecycle, ÷, Lock game (R)]
 *    - final + locked   → [Lifecycle, ÷, Unlock game (R)]
 *  (R) = `danger` tone, paints red.
 *  (÷) = visual divider <li>.
 */
const overflowActions = computed<OverflowItem[]>(() => {
  const status = props.game?.status ?? 'scheduled'
  if (status === 'scheduled') return []

  const items: OverflowItem[] = [
    // Lifecycle entry — always first when present.
    { id: 'view-lifecycle', label: 'Game Lifecycle', tone: 'neutral' }
  ]

  if (status === 'live') {
    items.push({ kind: 'divider' })
    items.push({ id: 'mark-delayed', label: 'Mark as delayed', tone: 'warning' })
    items.push({ id: 'end-game', label: 'End game', tone: 'danger' })
  } else if (status === 'final') {
    items.push({ kind: 'divider' })
    if (isLocked.value) {
      items.push({ id: 'unlock-game', label: 'Unlock game', tone: 'danger' })
    } else {
      items.push({ id: 'lock-game', label: 'Lock game', tone: 'danger' })
    }
  }
  // `delayed` → lifecycle only, no divider, no transition actions.

  return items
})

/** Type-narrowing helper used by the template to distinguish
 *  divider <li>s from action <li>s. Vue's `v-if` doesn't narrow
 *  union types in the template the way an `if` block does in
 *  script, so we expose this as a function for the loop body. */
function isDivider(item: OverflowItem): item is { kind: 'divider' } {
  return 'kind' in item && item.kind === 'divider'
}

// Overflow menu open/close — anchored to the kebab button via
// absolute positioning. Click-outside dismisses; Esc handler in
// SlideModal handles the modal close path.
const overflowOpen = ref(false)
const overflowAnchorRef = ref<HTMLElement | null>(null)
function toggleOverflow() {
  overflowOpen.value = !overflowOpen.value
}
function closeOverflow() {
  overflowOpen.value = false
}

// ── Inline Game Lineups (tabbed Team 1 / Team 2) ────────────────
// Rendered as a section below the Umpires banner — operator sees
// the active team's batting order + positions without opening the
// full preview modal. Clicking the Preview button anchored to the
// right of the tabs opens the field-art view in a popup.
//
// Fetching strategy: lazy + cached per `(gameId, teamId)`. First
// tab activation fires `mockFetchGameLineupSubmission`; flipping
// back hits the cache. Modal open uses the SAME cache key
// scheme inside (independent fetch today, but they'll hit the
// same backend response cache in production).
type LineupTab = 'team1' | 'team2'
const lineupActiveTab = ref<LineupTab>('team1')
const lineupCache = ref<Record<string, GameLineupSubmissionDetail>>({})
const lineupLoadingKey = ref<string | null>(null)
const lineupErrorKey = ref<string | null>(null)
const lineupErrorMessage = ref<string | null>(null)

const lineupCacheKey = computed(() =>
  props.game ? `${props.game.id}|${lineupActiveTab.value}` : ''
)
const activeLineupDetail = computed<GameLineupSubmissionDetail | null>(() =>
  lineupCache.value[lineupCacheKey.value] ?? null
)
const lineupLoading = computed(
  () => lineupLoadingKey.value !== null
    && lineupLoadingKey.value === lineupCacheKey.value
)
const lineupError = computed(
  () => lineupErrorKey.value === lineupCacheKey.value
    ? lineupErrorMessage.value
    : null
)

/** Players for the active tab, sorted by batting order. Mapped
 *  off the API's `GameLineupPlayer[]` so the row template stays
 *  simple. */
interface InlineLineupRow {
  id: string
  battingOrder: number
  jerseyNumber: string
  playerName: string
  positionCode: string
  isBench: boolean
}
const activeLineupRows = computed<InlineLineupRow[]>(() => {
  const detail = activeLineupDetail.value
  const players = detail?.submission?.players ?? detail?.players ?? []
  return [...players]
    .sort((a, b) => a.battingOrder - b.battingOrder)
    .map((p) => ({
      id: p.id,
      battingOrder: p.battingOrder,
      jerseyNumber: p.jerseyNumber,
      playerName: p.playerName,
      positionCode: p.positionCode ?? '',
      isBench: !!p.isBench
    }))
})

async function loadActiveLineupTab() {
  if (!props.game) return
  const key = lineupCacheKey.value
  if (lineupCache.value[key]) return  // cache hit
  lineupLoadingKey.value = key
  lineupErrorKey.value = null
  lineupErrorMessage.value = null
  try {
    const result = await mockFetchGameLineupSubmission(
      props.game.id,
      lineupActiveTab.value
    )
    // Defensive — only commit if we're still on the same game/tab
    // pair the fetch was kicked off for (operator may have
    // switched games/tabs mid-flight).
    if (lineupCacheKey.value !== key) return
    lineupCache.value = { ...lineupCache.value, [key]: result }
  } catch (err: unknown) {
    lineupErrorKey.value = key
    lineupErrorMessage.value =
      err instanceof Error ? err.message : 'Failed to load lineup.'
  } finally {
    if (lineupLoadingKey.value === key) lineupLoadingKey.value = null
  }
}

function selectLineupTab(tab: LineupTab) {
  if (lineupActiveTab.value === tab) return
  lineupActiveTab.value = tab
  loadActiveLineupTab()
}

/** Strip the leading "#<number>:" prefix from a team label so the
 *  tab shows the plain team name. Server-side labels arrive in the
 *  form "#5: Old Guard" / "#4: Steel Curtain" — useful in the
 *  scoresheet roster where the user wants to scan by jersey number,
 *  but redundant on the Visitor / Home tabs where the role is
 *  self-evident. Strips leading whitespace, "#", any digits, the
 *  colon, and trailing whitespace; leaves the rest of the string
 *  untouched (so labels without the prefix pass through verbatim). */
function stripTeamLabelPrefix(label: string | null | undefined): string {
  if (!label) return ''
  return label.replace(/^\s*#\d+:\s*/, '')
}

/** Max-character limits for the Visitor / Home tab name labels —
 *  per-viewport so long team names get character-truncated (NOT
 *  pixel-truncated by CSS overflow) before they push the pill
 *  wider than the row can absorb. Centralised here as the single
 *  source of truth — if design wants different limits later we
 *  only change these constants, not multiple template usages. */
const TAB_NAME_MAX_CHARS = {
  mobile: 15,
  desktop: 25
} as const

/** Truncate a string to at most `max` visible characters, with a
 *  single-char ellipsis ("…", U+2026) in the LAST position when
 *  the source overflows. The ellipsis itself counts toward `max`
 *  so the total rendered width is always ≤ `max` chars — keeps
 *  the column-width math predictable. Leaves short labels
 *  untouched (no ellipsis appended). */
function truncateChars(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max - 1).trimEnd() + '…'
}

/** Compose strip + truncate in one go for the tab-name slot. The
 *  template just calls `formatTabName(rawLabel)` and the helper
 *  picks the right per-viewport limit reactively (`isCompactViewport`
 *  is defined further down in the script — see compact-viewport
 *  tracker section). */
function formatTabName(label: string | null | undefined, fallback: string): string {
  const stripped = stripTeamLabelPrefix(label) || fallback
  const max = isCompactViewport.value
    ? TAB_NAME_MAX_CHARS.mobile
    : TAB_NAME_MAX_CHARS.desktop
  return truncateChars(stripped, max)
}

// Game switch → reset tab + clear cache (previous game's data
// shouldn't bleed). Then refire the fetch for the new game's
// default tab.
watch(() => props.game?.id, () => {
  lineupActiveTab.value = 'team1'
  lineupCache.value = {}
  lineupLoadingKey.value = null
  lineupErrorKey.value = null
  lineupErrorMessage.value = null
  if (props.game) loadActiveLineupTab()
}, { immediate: true })

/* `POSITION_LABELS` + `positionLabel` removed — the new bench-
   card-style rows render the position pill with just the CODE
   (P / C / SS / EH), matching the source surface
   (`.lineup-manager-bench__position`). Operators reading the
   drawer's lineup section already know the codes; the pill
   reads cleaner without the long-form label. */

// ── Field-lineup preview modal ──────────────────────────────────
// Opens the standalone `FieldLineupPreviewModal` over the drawer
// when the operator clicks the Preview button next to the lineup
// tabs. View-only (no DnD, no edit). Modal's tab state defaults
// to the side currently active in the inline section so the two
// surfaces stay in sync visually.
const previewOpen = ref(false)
function openLineupPreview() {
  if (!props.game) return
  previewOpen.value = true
}
// Reset when the drawer's game switches — open-state for game A
// shouldn't carry into game B.
watch(() => props.game?.id, () => { previewOpen.value = false })
function onDocumentClickForOverflow(evt: MouseEvent) {
  if (!overflowOpen.value) return
  const anchor = overflowAnchorRef.value
  if (anchor && evt.target instanceof Node && anchor.contains(evt.target)) return
  closeOverflow()
}

// ── Compact-viewport tracker ────────────────────────────────────
// `isCompactViewport` reactively tracks `(max-width: 720px)` via
// matchMedia so the template can swap the lifecycle toolbar
// (Primary / Upload / settings ⋯) from the slide-modal header
// down into a STICKY FOOTER on mobile. Same pattern MatchGeniHeader
// uses for its compact-viewport detection.
const isCompactViewport = ref(false)
let compactMql: MediaQueryList | null = null
function syncCompactViewport(eventOrList: MediaQueryListEvent | MediaQueryList) {
  isCompactViewport.value = eventOrList.matches
}

onMounted(() => {
  if (typeof document !== 'undefined') {
    document.addEventListener('click', onDocumentClickForOverflow)
  }
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    compactMql = window.matchMedia('(max-width: 720px)')
    isCompactViewport.value = compactMql.matches
    if (compactMql.addEventListener) {
      compactMql.addEventListener('change', syncCompactViewport)
    } else if ((compactMql as MediaQueryList & { addListener?: (listener: (e: MediaQueryListEvent) => void) => void }).addListener) {
      (compactMql as MediaQueryList & { addListener: (listener: (e: MediaQueryListEvent) => void) => void }).addListener(syncCompactViewport)
    }
  }
})
onBeforeUnmount(() => {
  if (typeof document !== 'undefined') {
    document.removeEventListener('click', onDocumentClickForOverflow)
  }
  if (compactMql) {
    if (compactMql.removeEventListener) {
      compactMql.removeEventListener('change', syncCompactViewport)
    } else if ((compactMql as MediaQueryList & { removeListener?: (listener: (e: MediaQueryListEvent) => void) => void }).removeListener) {
      (compactMql as MediaQueryList & { removeListener: (listener: (e: MediaQueryListEvent) => void) => void }).removeListener(syncCompactViewport)
    }
  }
})
// Reset overflow when the drawer's game changes (avoid stale-open
// menu carrying across navigation).
watch(() => props.game?.id, () => { overflowOpen.value = false })

// ── Start-game inline form ──────────────────────────────────────
// Clicking the `Start game` action opens an inline form below the
// action buttons (rather than emitting `'start-game'` immediately)
// so the operator can confirm home team + actual start time +
// time limit before the lifecycle transition fires. Confirm
// emits `('action', 'start-game')`; v1 doesn't carry the form
// snapshot on the wire (parent stubs the action), but the form
// state is already in the right shape for backend wiring.

const showStartForm = ref(false)
/** Which side is the home team. `null` until the operator picks
 *  — Confirm stays disabled while null. */
const startHomeSide = ref<'team1' | 'team2' | null>(null)
/** Actual start time in `HH:MM` (24h). Defaults to "now" rounded
 *  to the nearest minute when the form opens. */
const startActualTime = ref('')
/** Time-limit cap in minutes. Defaults to 70 (the most common
 *  cap in mock data); operator can edit. */
const startTimeLimit = ref(70)

/** Compute a default "now" time string in `HH:MM` for the
 *  actual-start-time input default. */
function nowHHMM(): string {
  const d = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/** Whenever the drawer's game changes, reset the form state. New
 *  game = new defaults; stale field values from the previous
 *  game shouldn't leak into the next start form. */
watch(() => props.game?.id, () => {
  showStartForm.value = false
  startHomeSide.value = null
  startActualTime.value = nowHHMM()
  startTimeLimit.value = 70
})

const canConfirmStart = computed(() => startHomeSide.value !== null)

// Lifecycle-log modal — internal to this component (not emitted
// to the parent because the log is purely read-only and self-
// contained). Open state flips on when the overflow menu's
// "Game Lifecycle" item is clicked.
const lifecycleModalOpen = ref(false)

function onAction(id: ScoringDrawerAction) {
  if (id === 'start-game') {
    // Pre-fill the form with sensible defaults the first time
    // it's opened, then expand. Confirm emits the action.
    if (!startActualTime.value) startActualTime.value = nowHHMM()
    showStartForm.value = true
    return
  }
  if (id === 'view-lifecycle') {
    // Lifecycle log is owned by this component — no parent emit.
    // Opens the nested `GameLifecycleLogModal` which fetches the
    // audit-log entries for the current game.
    lifecycleModalOpen.value = true
    return
  }
  emit('action', id)
}

function onCancelStart() {
  showStartForm.value = false
}

function onConfirmStart() {
  if (!canConfirmStart.value) return
  // Snapshot is held in `startHomeSide` / `startActualTime` /
  // `startTimeLimit`; parent doesn't read it in v1 but can
  // refactor to receive a payload once backend ships the
  // `/v2/.../start` endpoint.
  emit('action', 'start-game')
  showStartForm.value = false
}
</script>

<template>
  <SlideModal
    :model-value="modelValue"
    :title="game?.label ?? 'Game'"
    :subtitle="slotLine"
    :eyebrow="divisionName ?? ''"
    flush-body
    @update:model-value="(v) => emit('update:modelValue', v)"
  >
    <!-- Title block — default eyebrow + title + subtitle layout.
         Status badge + delay reason were MOVED into the
         `LineScore` component's head cell (matches ScoresheetView's
         convention: status lives in the first cell of the line-
         score head row, not in a separate page header). -->

    <!-- Header actions — lifecycle-gated controls pinned to the
         header's right edge, below the X close button. The
         PRIMARY action (next lifecycle transition: Start /
         Resume / Enter score) renders as a real button; the rest
         go behind a ⋯ overflow menu so the header stays compact
         regardless of how many actions a given status carries.
         Hidden entirely when neither primary nor overflow has
         anything to show (defensive — current matrix always has
         something). -->
    <template #header-actions>
      <!-- Edit game — shown for editable pool games when the caller can
           manage scheduling / divisions (permission-gated, not surface-
           gated). Clicking it emits `edit` so the host opens its add/edit
           pool-game form. -->
      <div
        v-if="canEdit"
        class="scoring-drawer__header-actions"
      >
        <button
          type="button"
          class="scoring-drawer__action scoring-drawer__action--neutral"
          @click="onEdit"
        >Edit game</button>
      </div>
      <!-- Desktop only — on mobile (≤720px) this toolbar moves to
           the slide-modal footer so the narrow header keeps just
           the title + close button. See the `#footer` slot below. -->
      <div
        v-if="canScore && !isCompactViewport && game && (primaryAction || uploadAction || overflowActions.length > 0)"
        class="scoring-drawer__header-actions"
      >
        <button
          v-if="primaryAction"
          type="button"
          class="scoring-drawer__action"
          :class="`scoring-drawer__action--${primaryAction.tone}`"
          @click="onAction(primaryAction.id)"
        >{{ primaryAction.label }}</button>
        <!-- Upload — always-on secondary button (except on locked
             games). Promoted out of the overflow menu and into the
             main toolbar so the affordance is one click away no
             matter what lifecycle state the game is in. -->
        <button
          v-if="uploadAction"
          type="button"
          class="scoring-drawer__action"
          :class="`scoring-drawer__action--${uploadAction.tone}`"
          @click="onAction(uploadAction.id)"
        >{{ uploadAction.label }}</button>
        <div
          v-if="overflowActions.length > 0"
          ref="overflowAnchorRef"
          class="scoring-drawer__overflow"
        >
          <button
            type="button"
            class="scoring-drawer__overflow-trigger"
            aria-label="More actions"
            :aria-expanded="overflowOpen"
            @click.stop="toggleOverflow"
          >
            <!-- Settings glyph — design-library `settings.svg`
                 painted via CSS mask so it inherits the trigger
                 button's `currentColor`. Replaces the bare `⋯`
                 character so the affordance reads as a settings
                 / configuration menu rather than ambiguous "more". -->
            <span class="scoring-drawer__overflow-icon" aria-hidden="true"></span>
          </button>
          <!-- Popover — anchored absolutely to the trigger. Click
               outside (handled by document-click listener) or
               selecting an item dismisses the menu. Two `<li>`
               variants: visual divider OR clickable action.
               Divider <li>s have no `role` (purely decorative
               separator); action <li>s carry `role="none"` with
               the inner `<button>` carrying `role="menuitem"`. -->
          <ul
            v-if="overflowOpen"
            class="scoring-drawer__overflow-menu"
            role="menu"
          >
            <template v-for="(item, idx) in overflowActions" :key="idx">
              <li
                v-if="isDivider(item)"
                class="scoring-drawer__overflow-divider"
                aria-hidden="true"
              ></li>
              <li
                v-else
                role="none"
              >
                <button
                  type="button"
                  role="menuitem"
                  class="scoring-drawer__overflow-item"
                  :class="`scoring-drawer__overflow-item--${item.tone}`"
                  @click="(closeOverflow(), onAction(item.id))"
                >{{ item.label }}</button>
              </li>
            </template>
          </ul>
        </div>
      </div>
    </template>
    <!-- Mobile only — sticky-footer copy of the lifecycle toolbar.
         Same buttons (Primary action + Upload + settings ⋯) that
         render in the slide-modal header on desktop, relocated
         to a sticky footer on phones so the limited header width
         only carries the title + close. The slide-modal panel's
         `flex-direction: column` natively pins the footer to the
         bottom of the panel; we add a soft top-shadow so the
         strip reads as lifted over the scrolling body content. -->
    <template
      v-if="canScore && isCompactViewport && game && (primaryAction || uploadAction || overflowActions.length > 0)"
      #footer
    >
      <div class="scoring-drawer__header-actions scoring-drawer__header-actions--mobile">
        <button
          v-if="primaryAction"
          type="button"
          class="scoring-drawer__action"
          :class="`scoring-drawer__action--${primaryAction.tone}`"
          @click="onAction(primaryAction.id)"
        >{{ primaryAction.label }}</button>
        <button
          v-if="uploadAction"
          type="button"
          class="scoring-drawer__action"
          :class="`scoring-drawer__action--${uploadAction.tone}`"
          @click="onAction(uploadAction.id)"
        >{{ uploadAction.label }}</button>
        <div
          v-if="overflowActions.length > 0"
          ref="overflowAnchorRef"
          class="scoring-drawer__overflow scoring-drawer__overflow--mobile"
        >
          <button
            type="button"
            class="scoring-drawer__overflow-trigger"
            aria-label="More actions"
            :aria-expanded="overflowOpen"
            @click.stop="toggleOverflow"
          >
            <span class="scoring-drawer__overflow-icon" aria-hidden="true"></span>
          </button>
          <!-- Popover OPENS UPWARD on mobile — anchored at the
               trigger's TOP edge (footer is at the bottom of the
               panel, downward popover would be clipped). Class
               `--up` shifts the menu's `bottom` instead of `top`. -->
          <ul
            v-if="overflowOpen"
            class="scoring-drawer__overflow-menu scoring-drawer__overflow-menu--up"
            role="menu"
          >
            <template v-for="(item, idx) in overflowActions" :key="idx">
              <li
                v-if="isDivider(item)"
                class="scoring-drawer__overflow-divider"
                aria-hidden="true"
              ></li>
              <li
                v-else
                role="none"
              >
                <button
                  type="button"
                  role="menuitem"
                  class="scoring-drawer__overflow-item"
                  :class="`scoring-drawer__overflow-item--${item.tone}`"
                  @click="(closeOverflow(), onAction(item.id))"
                >{{ item.label }}</button>
              </li>
            </template>
          </ul>
        </div>
      </div>
    </template>
    <div v-if="game" class="scoring-drawer">
      <!-- Game info lives in the SlideModal header now (see the
           `#title-block` slot above) — division eyebrow + status
           badge inline, game label as the title, time/field as
           the subtitle. The teams' "vs" line was redundant with
           the line-score below and got dropped. -->

      <!-- Lifecycle controls moved into the SlideModal header
           (right side, below the X close button) via the
           `#header-actions` slot — see the slot template above. -->

      <!-- Start-game inline form — only renders when the operator
           has clicked `Start game` on a `scheduled` game. Captures
           home-team side, actual start time, and time-limit cap
           before firing the lifecycle transition. Cancel just
           collapses the form; Confirm emits `('action',
           'start-game')` (parent stubs the actual transition in
           v1). -->
      <section
        v-if="showStartForm && game"
        class="scoring-drawer__start-form"
        aria-label="Start game"
      >
        <h4 class="scoring-drawer__start-form-title">Start this game</h4>
        <!-- Home team picker — radio between team 1 and team 2.
             Required before Confirm enables. -->
        <fieldset class="scoring-drawer__start-form-field">
          <legend class="scoring-drawer__start-form-label">Home team</legend>
          <div class="scoring-drawer__start-form-options">
            <label
              v-if="game.team1Label"
              class="scoring-drawer__start-form-option"
              :class="{ 'scoring-drawer__start-form-option--checked': startHomeSide === 'team1' }"
            >
              <input
                v-model="startHomeSide"
                type="radio"
                value="team1"
              />
              <span>{{ game.team1Label }}</span>
            </label>
            <label
              v-if="game.team2Label"
              class="scoring-drawer__start-form-option"
              :class="{ 'scoring-drawer__start-form-option--checked': startHomeSide === 'team2' }"
            >
              <input
                v-model="startHomeSide"
                type="radio"
                value="team2"
              />
              <span>{{ game.team2Label }}</span>
            </label>
          </div>
        </fieldset>

        <!-- Two inputs side-by-side on the same row: actual start
             time + time limit. Stack on narrow viewports via the
             flex-wrap on the wrapper. -->
        <div class="scoring-drawer__start-form-row">
          <label class="scoring-drawer__start-form-field">
            <span class="scoring-drawer__start-form-label">Actual start time</span>
            <input
              v-model="startActualTime"
              type="time"
              class="scoring-drawer__start-form-input"
            />
          </label>
          <label class="scoring-drawer__start-form-field">
            <span class="scoring-drawer__start-form-label">Time limit (minutes)</span>
            <input
              v-model.number="startTimeLimit"
              type="number"
              min="1"
              step="1"
              class="scoring-drawer__start-form-input"
            />
          </label>
        </div>

        <!-- Confirm + Cancel pair, Confirm disabled until a home
             team has been chosen. -->
        <div class="scoring-drawer__start-form-buttons">
          <button
            type="button"
            class="scoring-drawer__action scoring-drawer__action--neutral"
            @click="onCancelStart"
          >Cancel</button>
          <button
            type="button"
            class="scoring-drawer__action scoring-drawer__action--primary"
            :disabled="!canConfirmStart"
            @click="onConfirmStart"
          >Start game</button>
        </div>
      </section>

      <!-- Meta cards — Started/Scheduled time, Time Limit, Location.
           Three equal cards in a single row on wide viewports
           (the drawer has the horizontal real-estate for it); on
           narrow viewports the row collapses to a 2+1 grid where
           Started / Time Limit sit on top and Location spans the
           full row below. Reuses the global `.scoresheet-meta-box`
           classes from `src/styles.css` for label/value typography
           — the drawer-scoped overrides below adjust the layout
           container + dark-mode chrome (the source rules use a
           hardcoded light gradient that reads as "glossy silver"
           against a dark surface). -->
      <section class="scoring-drawer__meta-wrap">
        <div class="scoring-drawer__meta-cards">
          <!-- Started / Scheduled time — `time.svg` clock glyph. -->
          <div class="scoresheet-meta-box scoresheet-meta-box--compact">
            <span class="scoring-drawer__meta-label">
              <span
                class="scoring-drawer__meta-icon scoring-drawer__meta-icon--time"
                aria-hidden="true"
              ></span>
              {{ metaStartLabel }}
            </span>
            <strong v-if="metaStartValue">{{ metaStartValue }}</strong>
          </div>
          <!-- Time limit — `stopwatch.svg` glyph. -->
          <div class="scoresheet-meta-box scoresheet-meta-box--compact">
            <span class="scoring-drawer__meta-label">
              <span
                class="scoring-drawer__meta-icon scoring-drawer__meta-icon--stopwatch"
                aria-hidden="true"
              ></span>
              Time Limit
            </span>
            <strong>{{ metaTimeLimit }}</strong>
          </div>
          <!-- Location — existing `location.svg` pin glyph. -->
          <div class="scoresheet-meta-box scoresheet-meta-box--location">
            <span class="scoring-drawer__meta-label">
              <span
                class="scoring-drawer__meta-icon scoring-drawer__meta-icon--location"
                aria-hidden="true"
              ></span>
              Location
            </span>
            <template v-if="metaLocationTop">
              <strong>{{ metaLocationTop }}</strong>
              <em v-if="metaLocationBottom">{{ metaLocationBottom }}</em>
            </template>
            <strong v-else>-</strong>
          </div>
        </div>
      </section>

      <!-- Line score — DOM mirrors `ScoresheetView`'s line-score
           block exactly so it inherits the `.scoresheet-linescore__*`
           rules from `src/styles.css`. Same grid template, same
           sticky team column on narrow viewports, same Runs/HR
           summary cells, same active-column highlight for the
           currently-batting inning of a live game. The wrapper
           `.scoresheet-matchup-card` is the styles.css hook that
           toggles horizontal scroll at ≤1080px so long-inning
           games stay browsable on mobile. -->
      <!-- Line score — single shared `LineScore` component
           (`src/components/scoring-lib/LineScore.vue`) used by
           both this drawer AND `ScoresheetView`. Component owns
           the responsive grid template + pre-game / started
           gating rules; this view just shapes its mock data into
           the rows + innings + headBadge props the component
           consumes. -->
      <section class="scoring-drawer__line-score-wrap">
        <LineScore
          :innings="lineScoreInnings"
          :rows="lineScoreRows"
          :game-has-started="hasStarted"
          :current-inning="currentInning"
          :head-badge="lineScoreHeadBadge"
        />
      </section>

      <!-- Game Umpires — full-width banner BELOW the line-score.
           Primary-tinted strip (mirrors the dashboard's Field
           Grid card visual weight) so the assigned crew reads as
           a deliberate section, not a footnote. Stretches edge-
           to-edge of the panel via the parent body's `--flush`
           padding setting. -->
      <section class="scoring-drawer__umpires-banner">
        <div class="scoring-drawer__umpires-banner-head">
          <!-- Left cluster — umpire glyph + "Game Umpires" title. -->
          <div class="scoring-drawer__umpires-banner-head-left">
            <span
              class="scoring-drawer__umpires-banner-icon"
              aria-hidden="true"
            ></span>
            <span class="scoring-drawer__umpires-banner-title">Game Umpires</span>
            <button
              v-if="canAssignUmpires"
              type="button"
              class="scoring-drawer__umpires-banner-action"
              @click="onAction('assign-umpires')"
            >{{ metaUmpires.length > 0 ? 'Change Umpires' : 'Assign Umpires' }}</button>
          </div>
          <!-- Right label — current scorer assigned to this game.
               Eyebrow ("Current Scorer") + name on a single inline
               row, pushed to the right edge of the banner head via
               `justify-content: space-between` on the parent. -->
          <div
            v-if="metaScorer"
            class="scoring-drawer__umpires-banner-scorer"
          >
            <span class="scoring-drawer__umpires-banner-scorer-label">Current Scorer:</span>
            <span class="scoring-drawer__umpires-banner-scorer-name">{{ metaScorer }}</span>
          </div>
        </div>
        <div
          v-if="metaUmpires.length > 0"
          class="scoring-drawer__umpires-banner-list"
        >
          <span
            v-for="(name, i) in metaUmpires"
            :key="`ump-${i}`"
            class="scoring-drawer__umpires-banner-name"
          >{{ name }}</span>
        </div>
        <span v-else class="scoring-drawer__umpires-banner-empty">
          Not assigned
        </span>
      </section>

      <!-- Game Lineups — tabbed Visitor / Home with the field-
           lineup preview button anchored right of the tabs.
           Read-only batting order + position table per tab; the
           preview button opens the SVG-field view in a popup.
           Lazy-fetches the active team's lineup on tab
           activation; flips back hit the per-modal cache. -->
      <section v-if="game" class="scoring-drawer__lineups">
        <header class="scoring-drawer__lineups-head">
          <div class="scoring-drawer__lineups-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              class="scoring-drawer__lineups-tab"
              :class="{ 'scoring-drawer__lineups-tab--active': lineupActiveTab === 'team1' }"
              :aria-selected="lineupActiveTab === 'team1'"
              @click="selectLineupTab('team1')"
            >
              <span class="scoring-drawer__lineups-tab-text">
                <span class="scoring-drawer__lineups-tab-eyebrow">Visitor</span>
                <span
                  class="scoring-drawer__lineups-tab-name"
                  :title="stripTeamLabelPrefix(game.team1Label) || 'Team 1'"
                >{{ formatTabName(game.team1Label, 'Team 1') }}</span>
              </span>
            </button>
            <button
              type="button"
              role="tab"
              class="scoring-drawer__lineups-tab"
              :class="{ 'scoring-drawer__lineups-tab--active': lineupActiveTab === 'team2' }"
              :aria-selected="lineupActiveTab === 'team2'"
              @click="selectLineupTab('team2')"
            >
              <span class="scoring-drawer__lineups-tab-text">
                <span class="scoring-drawer__lineups-tab-eyebrow">Home</span>
                <span
                  class="scoring-drawer__lineups-tab-name"
                  :title="stripTeamLabelPrefix(game.team2Label) || 'Team 2'"
                >{{ formatTabName(game.team2Label, 'Team 2') }}</span>
              </span>
            </button>
          </div>
          <!-- Preview lineup — eye icon + label on desktop, icon-only
               round chip on mobile. The label collapses out below
               720px to keep the head row breathable when the
               sibling tab pills are already character-truncated
               to fit. `aria-label` keeps the affordance readable
               for screen readers in both modes. -->
          <button
            type="button"
            class="scoring-drawer__lineup-preview-btn"
            :class="{ 'scoring-drawer__lineup-preview-btn--icon-only': isCompactViewport }"
            :aria-label="isCompactViewport ? 'Preview lineup' : undefined"
            @click="openLineupPreview"
          >
            <span class="scoring-drawer__lineup-preview-icon" aria-hidden="true"></span>
            <span
              v-if="!isCompactViewport"
              class="scoring-drawer__lineup-preview-label"
            >Preview lineup</span>
          </button>
        </header>

        <!-- Body — loading shimmer on first tab activation, error
             banner on failure, read-only batting-order table
             once data lands. The table is a CSS grid for
             consistent column widths across rows. -->
        <div
          v-if="lineupLoading"
          class="scoring-drawer__lineups-loading"
          aria-busy="true"
        >
          <div
            v-for="i in 6"
            :key="`ll-${i}`"
            class="shimmer-block scoring-drawer__lineups-loading-row"
          ></div>
        </div>
        <div
          v-else-if="lineupError"
          class="scoring-drawer__lineups-error"
        >
          <p>{{ lineupError }}</p>
          <button
            type="button"
            class="scoring-drawer__lineups-retry"
            @click="loadActiveLineupTab"
          >Retry</button>
        </div>
        <div
          v-else-if="activeLineupRows.length === 0"
          class="scoring-drawer__lineups-empty"
        >
          No lineup submitted yet.
        </div>
        <!-- Row layout mirrors the benched-players card style
             from `GameLineupSubmissionModal` (`.lineup-manager-bench__item`):
             avatar + jersey-icon block + player name on the
             left, position pill anchored right. Batting order
             sits as a small number to the far left so the
             operator still has the scoring sequence at a glance.
             No "Manual Player" / source label — read-only
             inspection doesn't need the source-of-truth chip. -->
        <div v-else class="scoring-drawer__lineups-rows">
          <div
            v-for="row in activeLineupRows"
            :key="row.id"
            class="scoring-drawer__lineups-row"
            :class="{ 'scoring-drawer__lineups-row--bench': row.isBench }"
          >
            <span class="scoring-drawer__lineups-row-order">
              {{ row.isBench ? '—' : row.battingOrder }}
            </span>
            <TeamAvatar
              :name="row.playerName"
              size="sm"
              class="scoring-drawer__lineups-row-avatar"
            />
            <div class="scoring-drawer__lineups-row-jersey">
              <!-- Shared jersey icon (`jersy.svg` — the same shirt the
                   association Players nav uses) painted via CSS mask so
                   it picks up `currentColor`. Light mode: muted
                   secondary tone; dark mode bumps to a lighter tone for
                   visibility (see override below). -->
              <span
                class="scoring-drawer__lineups-row-jersey-icon"
                aria-hidden="true"
              ></span>
              <span class="scoring-drawer__lineups-row-jersey-number">
                {{ row.jerseyNumber }}
              </span>
            </div>
            <div class="scoring-drawer__lineups-row-copy">
              <strong class="scoring-drawer__lineups-row-name">{{ row.playerName }}</strong>
            </div>
            <span class="scoring-drawer__lineups-row-position">
              <template v-if="row.isBench">Bench</template>
              <template v-else>{{ row.positionCode || 'EH' }}</template>
            </span>
          </div>
        </div>
      </section>
    </div>

    <!-- Footer removed — header X closes; no labeled footer
         button needed (operators consistently hit the X). -->
  </SlideModal>

  <!-- Field-lineup preview modal — opens over the drawer when
       the operator clicks "Preview lineup" in the Game Umpires
       banner. View-only, with Visitor / Home tab toggle inside.
       The drawer stays mounted behind so closing the preview
       returns to the current game in context. -->
  <FieldLineupPreviewModal
    v-if="game"
    v-model="previewOpen"
    :game-id="game.id"
    :game-title="game.label"
    :game-subtitle="slotLine"
    :visitor-label="game.team1Label ?? 'Visitor'"
    :home-label="game.team2Label ?? 'Home'"
  />
  <!-- Game lifecycle log — nested slide-modal opened from the
       drawer's settings ⋯ menu via `view-lifecycle`. Read-only
       audit timeline of every lifecycle transition and scoring-
       side event on this game. Drawer stays mounted behind. -->
  <GameLifecycleLogModal
    v-if="game"
    v-model="lifecycleModalOpen"
    :game="game"
    :division-name="divisionName ?? ''"
  />
</template>

<style scoped>
/* No padding on the outer container — sections own their own
   horizontal padding so the line-score can stretch edge-to-edge
   of the drawer body and use the full available width before
   the `.scoresheet-matchup-card`'s built-in horizontal-scroll
   kicks in. */
.scoring-drawer {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0;
}

/* SlideModal title-block + status badge + delay-reason CSS all
   removed. Badge moved into the line-score head cell via the
   shared `LineScore` component; SlideModal renders the default
   eyebrow + title + subtitle layout. */

/* ─── Header actions (primary CTA + overflow menu) ──────────── */

/* Cluster rendered into the SlideModal `#header-actions` slot —
   sits below the X close button, right-aligned. Primary lifecycle
   CTA on the left, ⋯ overflow trigger on the right. */
.scoring-drawer__header-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.scoring-drawer__action {
  appearance: none;
  padding: 8px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
}
.scoring-drawer__action--primary {
  background: var(--primary);
  /* `var(--white)` flips to dark text on the bright-blue primary in
     dark mode — consistent with the dashboard "Add Division" button. */
  color: var(--white, #ffffff);
  border: 1px solid var(--primary);
}
.scoring-drawer__action--primary:hover {
  background: var(--primary-dark, var(--primary));
}
.scoring-drawer__action--neutral {
  background: var(--surface-card);
  border: 1px solid var(--border-divider);
  color: var(--text);
}
.scoring-drawer__action--neutral:hover {
  border-color: var(--border-accent);
  background: var(--surface-raised);
}
.scoring-drawer__action--warning {
  background: var(--surface-card);
  border: 1px solid #e0a200;
  color: #b56e00;
}
.scoring-drawer__action--warning:hover {
  background: rgba(224, 162, 0, 0.08);
}
html.dark-mode .scoring-drawer__action--warning {
  color: #f5be4d;
  border-color: rgba(245, 190, 77, 0.5);
}
/* Success tone — used for the "Resume game" action that flips
   a delayed game back to live. Green border so it reads as the
   recovery / forward-motion CTA without competing with the
   primary blue (which carries the "primary lifecycle action"
   weight on other states). */
.scoring-drawer__action--success {
  background: var(--surface-card);
  border: 1px solid #1f9c5b;
  color: #1f7a47;
}
.scoring-drawer__action--success:hover {
  background: rgba(31, 156, 91, 0.08);
}
html.dark-mode .scoring-drawer__action--success {
  color: #5cd397;
  border-color: rgba(92, 211, 151, 0.5);
}
/* Disabled state — applies to any tone (e.g. the start-form
   Confirm button before a home team is picked). Drop opacity +
   freeze the cursor so the button's "not yet" semantics are
   obvious. */
.scoring-drawer__action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ─── Overflow (kebab) menu ─────────────────────────────────── */

/* Anchor — gives the absolute-positioned popover a relative
   parent so it lands directly beneath the ⋯ trigger. */
.scoring-drawer__overflow {
  position: relative;
  display: inline-flex;
}

.scoring-drawer__overflow-trigger {
  appearance: none;
  background: var(--white);
  border: 1px solid var(--border-divider);
  /* `6px` (NOT a pill `999px`) so the settings trigger reads as
     part of the same rectangular button family as the
     `.scoring-drawer__action` toolbar buttons sitting beside it.
     The previous pill shape looked out-of-theme once the toolbar
     gained sibling rectangular Primary + Upload buttons. */
  border-radius: 6px;
  /* Height matches `.scoring-drawer__action`'s rendered height
     (~34px from `padding: 8px 14px` + 13px text) so all three
     toolbar buttons line up on the same baseline. */
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--secondary);
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}
.scoring-drawer__overflow-trigger:hover {
  background: var(--surface-raised);
  color: var(--text);
}
html.dark-mode .scoring-drawer__overflow-trigger {
  background: var(--surface-card);
}
/* Settings glyph — design-library `settings.svg` painted via
   CSS mask so it picks up the button's `currentColor`. Same
   pattern the matchgeni header settings button uses. */
.scoring-drawer__overflow-icon {
  display: inline-block;
  width: 16px;
  height: 16px;
  background-color: currentColor;
  -webkit-mask-image: url('../assets/settings.svg');
  mask-image: url('../assets/settings.svg');
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}

.scoring-drawer__overflow-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 5;
  list-style: none;
  margin: 0;
  padding: 4px;
  min-width: 200px;
  background: var(--white);
  border: 1px solid var(--border-divider);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(13, 30, 58, 0.12);
}
html.dark-mode .scoring-drawer__overflow-menu {
  background: var(--surface-card);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

/* Upward-opening popover — used by the mobile footer toolbar
   where the kebab trigger sits at the bottom of the panel. A
   downward menu would either be clipped by the viewport edge OR
   render below the panel entirely. `bottom: calc(100% + 4px)`
   anchors the menu's BOTTOM 4px above the trigger's top edge so
   it grows upward into the scrolling body content. `top: auto`
   neutralises the desktop rule above so the two anchors don't
   fight each other. */
.scoring-drawer__overflow-menu--up {
  top: auto;
  bottom: calc(100% + 4px);
}

.scoring-drawer__overflow-item {
  appearance: none;
  background: none;
  border: none;
  width: 100%;
  text-align: left;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  cursor: pointer;
  transition: background 120ms ease;
}
.scoring-drawer__overflow-item:hover {
  background: var(--surface-raised);
}
/* Warning-toned overflow item (e.g. "Mark as delayed") gets the
   same amber tint as the warning button tone so the destructive
   nature reads even inside the neutral menu list. */
.scoring-drawer__overflow-item--warning {
  color: #b56e00;
}
html.dark-mode .scoring-drawer__overflow-item--warning {
  color: #f5be4d;
}

/* Danger-toned overflow item (e.g. "End game", "Lock game",
   "Unlock game") — red text so the irreversible / state-altering
   nature of the action reads at a glance inside the otherwise
   neutral menu list. Hover bumps the bg to a faint red wash. */
.scoring-drawer__overflow-item--danger {
  color: #c1413a;
}
.scoring-drawer__overflow-item--danger:hover {
  background: rgba(193, 65, 58, 0.08);
}
html.dark-mode .scoring-drawer__overflow-item--danger {
  color: #f08379;
}
html.dark-mode .scoring-drawer__overflow-item--danger:hover {
  background: rgba(240, 131, 121, 0.14);
}

/* Visual divider <li> separating the Game Lifecycle entry from
   the lifecycle-transition actions below. Thin border-divider
   line with small vertical padding so the two action groups
   read as distinct. Decorative only — `aria-hidden="true"` on
   the template, no `role` so screen readers skip past it. */
.scoring-drawer__overflow-divider {
  margin: 4px 0;
  border-top: 1px solid var(--border-divider);
  list-style: none;
}

/* ─── Start-game inline form ────────────────────────────────── */

/* Sits below the actions toolbar when the operator clicks
   `Start game`. Reuses the same horizontal gutter as the rest
   of the drawer sections (20px) so the form aligns visually
   with the actions and meta cards. */
.scoring-drawer__start-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-divider);
  background: var(--surface-card);
}
.scoring-drawer__start-form-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.scoring-drawer__start-form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: none;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.scoring-drawer__start-form-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0;
}

/* Home-team radio options — pill-shaped, click-anywhere-on-the-
   row affordance. Checked state pulls the primary color through
   so the choice reads as committed. The native radio input
   stays visible (small) on the left so screen readers /
   keyboard users get the standard control. */
.scoring-drawer__start-form-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.scoring-drawer__start-form-option {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--border-divider);
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text);
  transition: background 120ms ease, border-color 120ms ease;
  min-width: 0;
}
.scoring-drawer__start-form-option:hover {
  border-color: var(--border-accent);
  background: var(--surface-raised);
}
.scoring-drawer__start-form-option--checked {
  border-color: var(--primary);
  background: var(--primary-light-3);
  color: var(--primary);
  font-weight: 600;
}
html.dark-mode .scoring-drawer__start-form-option--checked {
  background: rgba(45, 140, 240, 0.18);
}
.scoring-drawer__start-form-option input {
  flex: 0 0 auto;
  margin: 0;
}
.scoring-drawer__start-form-option > span {
  flex: 1 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Two-up row of inputs (start time + time limit) — wraps to
   stacked on narrow widths via flex-wrap on the row. */
.scoring-drawer__start-form-row {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}
.scoring-drawer__start-form-row > .scoring-drawer__start-form-field {
  flex: 1 1 160px;
}
.scoring-drawer__start-form-input {
  appearance: none;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border-divider);
  border-radius: 6px;
  background: var(--white);
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
}
html.dark-mode .scoring-drawer__start-form-input {
  background: var(--surface-card);
}
.scoring-drawer__start-form-input:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(45, 140, 240, 0.2);
}

.scoring-drawer__start-form-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.scoring-drawer__start-form-buttons .scoring-drawer__action {
  flex: 0 0 auto;
  min-width: 110px;
}

/* ─── Line score ────────────────────────────────────────────── */

/* Meta-cards wrap — three cards (Started, Time Limit, Location).
   Reuses the global `.scoresheet-meta-box` styles from styles.css
   for typography + chrome; the inline-grid layout below is
   drawer-local since the source surface stacks them in a column.
   Gutter padding only (matches the other padded sections) so the
   cards sit inside the same 20px-rail as the header / actions. */
.scoring-drawer__meta-wrap {
  padding: 16px 20px 0;
}

/* Three cards on the row (Started · Time Limit · Location).
   Umpires moved out into a dedicated full-width strip below
   (see `.scoring-drawer__umpires-card`). Location gets ~2x
   width because its value — field + park (and future
   city/state) — needs the room. */
.scoring-drawer__meta-cards {
  display: grid;
  grid-template-columns:
    minmax(0, 1fr)
    minmax(0, 1fr)
    minmax(0, 2fr);
  gap: 12px;
}

/* Label row inside each meta-box — small icon + caps text on a
   single line. Replaces the bare `<span>` the global
   `.scoresheet-meta-box span` rule expects, but keeps the same
   tone (caps, secondary color) by inheriting that rule. */
.scoring-drawer__meta-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.scoring-drawer__meta-icon {
  display: inline-block;
  width: 12px;
  height: 12px;
  flex: 0 0 12px;
  background-color: currentColor;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  opacity: 0.9;
}
.scoring-drawer__meta-icon--time {
  -webkit-mask-image: url('../assets/time.svg');
  mask-image: url('../assets/time.svg');
}
.scoring-drawer__meta-icon--stopwatch {
  -webkit-mask-image: url('../assets/stopwatch.svg');
  mask-image: url('../assets/stopwatch.svg');
}
.scoring-drawer__meta-icon--location {
  -webkit-mask-image: url('../assets/location.svg');
  mask-image: url('../assets/location.svg');
}
.scoring-drawer__meta-icon--admin {
  /* `umpire-line.svg` is a mono line-drawn shield + person —
     cleaner alpha under CSS mask than the two-tone version
     (whose 0.4-opacity paths would mute the rendered glyph
     against the secondary-tinted label color). */
  -webkit-mask-image: url('../assets/umpire-line.svg');
  mask-image: url('../assets/umpire-line.svg');
}

/* ─── Game Umpires banner ───────────────────────────────────── */

/* Full-width primary-tinted banner sitting below the line-score.
   Mirrors the visual weight of the dashboard's Field Grid card
   (`.matchgeni-scoring` in `MatchGeniScoringCard.vue`) — same
   primary-light-3 fill, same 3px left accent border — so the
   assigned crew reads as a deliberate page section, not a
   footnote. Stretches edge-to-edge of the panel since the
   parent body is in `--flush` mode. */
.scoring-drawer__umpires-banner {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
  /* Inset from the panel's edges instead of stretching flush —
     the banner now reads as a contained card rather than a
     full-width strip. Margins match the line-score's outer
     gutter so the banner aligns with the table's left/right
     edges above it. */
  margin: 16px 20px 0;
  background: var(--primary-light-3, #e5f1ff);
  border: 1px solid var(--primary-light-2, #c9e1fc);
  border-left: 3px solid var(--primary);
  border-radius: 8px;
}
html.dark-mode .scoring-drawer__umpires-banner {
  background: rgba(45, 140, 240, 0.12);
  border-color: rgba(45, 140, 240, 0.32);
}

.scoring-drawer__umpires-banner-head {
  display: flex;
  align-items: center;
  /* `space-between` so the umpires left-cluster sits on the left
     and the "Current Scorer" label hugs the right edge of the
     banner. `gap: 12px` is the minimum breathing space between
     them when both are present; flex pushes the rest apart. */
  justify-content: space-between;
  gap: 12px;
}

/* Left cluster — icon + "Game Umpires" caps title. Inherits the
   primary-tinted caps styling that USED to live on the
   `banner-head` itself before the head became a flex justifier
   for two clusters. */
.scoring-drawer__umpires-banner-head-left {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--primary);
  min-width: 0;
}

/* Right cluster — "Current Scorer:" eyebrow + scorer name. Two
   inline tokens so the relationship reads "label → value" at a
   glance. Eyebrow stays in the banner's caps-token vocabulary;
   the name uses normal-case primary-text styling so it doesn't
   compete with the umpire names listed below it. */
.scoring-drawer__umpires-banner-scorer {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}
.scoring-drawer__umpires-banner-scorer-label {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--primary);
  white-space: nowrap;
}
.scoring-drawer__umpires-banner-scorer-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
}

/* ─── Inline Game Lineups (tabbed) ──────────────────────────── */

/* Section sits below the umpires banner — same outer gutter so
   the left/right edges line up with the line-score above and
   the umpires banner just above it. Visual chrome is a neutral
   bordered card so the lineup rows read as data (not as a
   tinted CTA). */
.scoring-drawer__lineups {
  /* Edge-to-edge (NO horizontal margin) — the lineup roster reads
     as a flat, full-width data surface flush against the panel's
     left and right edges. Top margin kept (16px) so the section
     still separates visually from the line-score above. The
     inner head row + roster rows carry their own per-element
     padding for breathing room, so the section itself doesn't
     need an outer gutter. Side borders + rounded corners dropped
     too — both belong to "card chrome" which the user explicitly
     wanted off here for a cleaner look. */
  margin: 16px 0 0;
  background: var(--surface-card);
  border-top: 1px solid var(--border-divider);
  border-bottom: 1px solid var(--border-divider);
  border-radius: 0;
  overflow: hidden;
}

/* Head row — tabs on the left, Preview button anchored right.
   Sticky to the slide-modal's body scroll container so the tab
   row + Preview button stay pinned directly under the popup
   header when the user scrolls past the long lineup roster.
   `top: 0` pins against the modal-body's scrolling viewport top
   (the popup header sits OUTSIDE the body's scroll region, so
   visually the head appears to butt right against the popup
   header chrome above). `z-index: 1` keeps the head above the
   lineup rows that scroll underneath. The `.scoring-drawer__lineups`
   parent below has `overflow: hidden` set on it to keep the
   rounded card corners clipping the inner rows — that doesn't
   break sticky here because sticky pins against the modal-body
   scrolling ancestor, NOT the immediate `overflow:hidden` parent. */
.scoring-drawer__lineups-head {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border-divider);
  background: var(--surface-muted, #f4f7fb);
}
html.dark-mode .scoring-drawer__lineups-head {
  background: rgba(255, 255, 255, 0.03);
}

/* Visitor / Home tabs — standalone rounded pills (NOT in a
   segmented-switch container). Same pattern the association
   portal's mobile sidebar nav uses: each pill carries its own
   border + background, so the row reads as a set of independent
   chips instead of two segments inside a container. The active
   pill flips to a primary-tinted background + white text so it
   reads as the highlighted choice. */
.scoring-drawer__lineups-tabs {
  display: inline-flex;
  align-items: stretch;
  gap: 8px;
  flex: 1 1 auto;
  min-width: 0;
  /* No container background / border / padding — pills sit
     directly on the drawer's surface. */
}
.scoring-drawer__lineups-tab {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  /* `min-height: 36px` matches the association-portal mobile-nav
     pill height so the two affordance languages stay consistent
     across the portal. Previously sat at ~28px which read smaller
     than every other pill in the design system. */
  min-height: 36px;
  background: var(--white);
  border: 1px solid var(--border-divider);
  border-radius: 999px;
  cursor: pointer;
  min-width: 0;
  color: var(--text);
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}
.scoring-drawer__lineups-tab:hover {
  background: rgba(45, 140, 240, 0.06);
}
.scoring-drawer__lineups-tab--active {
  background: var(--primary, #2d8cf0);
  border-color: var(--primary, #2d8cf0);
  /* `var(--white)` → dark text on the bright-blue primary in dark
     mode (same pattern as the dashboard "Add Division" button). */
  color: var(--white, #ffffff);
}
.scoring-drawer__lineups-tab--active:hover {
  background: var(--primary, #2d8cf0);
}
html.dark-mode .scoring-drawer__lineups-tab {
  background: var(--surface-card);
}
/* Active tab in dark mode — outline only (primary border + primary
   text) instead of the bright primary fill, which is too heavy on
   dark. The nested eyebrow/name flip to primary below. */
html.dark-mode .scoring-drawer__lineups-tab--active {
  background: var(--surface-card);
  border-color: var(--primary);
}
html.dark-mode .scoring-drawer__lineups-tab--active .scoring-drawer__lineups-tab-name {
  color: var(--primary);
}
html.dark-mode .scoring-drawer__lineups-tab--active .scoring-drawer__lineups-tab-eyebrow {
  color: var(--primary);
  opacity: 0.78;
}
/* Inner text block — eyebrow ("Visitor" / "Home") stacked above
   the team name, sitting beside the icon. Tight `gap: 1px` keeps
   the two lines hugging each other inside the 36px pill height. */
.scoring-drawer__lineups-tab-text {
  display: inline-flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  align-items: flex-start;
  line-height: 1;
}

.scoring-drawer__lineups-tab-eyebrow {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--secondary);
  line-height: 1;
}

/* Active pill flips its child text to white-on-primary. Eyebrow
   uses a slightly translucent white so the secondary label reads
   as a step softer than the primary `__name` line — same
   foreground-hierarchy rhythm the inactive pill uses (secondary
   vs text), just inverted for the dark-pill background. */
.scoring-drawer__lineups-tab--active .scoring-drawer__lineups-tab-eyebrow {
  /* `var(--white)` + opacity so the eyebrow tracks the active label's
     color in both themes (white@78% in light, dark@78% in dark). */
  color: var(--white, #ffffff);
  opacity: 0.78;
}
.scoring-drawer__lineups-tab--active .scoring-drawer__lineups-tab-name {
  color: var(--white, #ffffff);
}
.scoring-drawer__lineups-tab-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  /* No `max-width` cap — the team-name string is already
     CHARACTER-truncated in the script (`formatTabName` →
     `truncateChars`), so a pixel-width hardcode is redundant.
     `nowrap` + ellipsis stay as a safety net in case the
     character-truncated string still overflows its pill at an
     extreme zoom level. */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* "Preview lineup" button — anchored right of the tab row. Uses
   the same default-tone shape as `.scoring-drawer__action--neutral`
   (border-radius: 6px, surface-card background, border-divider
   outline) so it reads as a standard portal button instead of a
   primary-tinted pill that visually competed with the active tab
   on the same row. */
.scoring-drawer__lineup-preview-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  /* Match the standard portal medium button — `min-height: 36px`,
     `padding: 0 18px`, `font-size: 14px`, `font-weight: 400` —
     same baseline as `.primary-button` / `.secondary-button`
     elsewhere in the app. Previously this button sat at ~28px
     tall (12px font, 6px vertical padding), which looked
     under-sized next to the 36px-baseline pill tabs to its left. */
  min-height: 36px;
  padding: 0 18px;
  border-radius: 6px;
  border: 1px solid var(--border-divider);
  background: var(--surface-card);
  color: var(--text);
  font-size: 14px;
  font-weight: 400;
  line-height: 1;
  cursor: pointer;
  flex: 0 0 auto;
  transition: background 120ms ease, border-color 120ms ease;
}
.scoring-drawer__lineup-preview-btn:hover {
  background: var(--surface-raised);
  border-color: var(--border-accent);
}

/* Eye glyph — design-library `eye.svg` painted via CSS mask so
   it inherits the button's `currentColor`. 14×14 sits on the
   baseline with the 12px text — visually a hair taller than the
   x-height which reads "icon, not capital letter". */
.scoring-drawer__lineup-preview-icon {
  display: inline-block;
  width: 14px;
  height: 14px;
  flex: 0 0 14px;
  background-color: currentColor;
  -webkit-mask-image: url('../assets/eye.svg');
  mask-image: url('../assets/eye.svg');
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}

/* Icon-only mode — used on mobile (≤720px) where the head row
   doesn't have room for a labelled secondary button alongside
   the tab pills. Collapses to a 32×32 round chip with just the
   eye glyph centered inside. `aria-label` on the button (set in
   the template when this modifier is active) preserves screen-
   reader access to the affordance name. */
.scoring-drawer__lineup-preview-btn--icon-only {
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 999px;
  justify-content: center;
}
.scoring-drawer__lineup-preview-btn--icon-only .scoring-drawer__lineup-preview-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
}

/* Lineup row list — bench-card-style rows (mirrors the
   `.lineup-manager-bench__item` pattern from
   GameLineupSubmissionModal). Each row carries: batting order,
   round avatar, jersey-icon block, player name, position pill.
   No "source" / "Manual Player" label — the drawer's lineup is
   read-only inspection, not editing. */
.scoring-drawer__lineups-rows {
  display: flex;
  flex-direction: column;
}
.scoring-drawer__lineups-row {
  display: grid;
  grid-template-columns: 22px 34px 40px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-top: 1px solid var(--border-divider);
}
.scoring-drawer__lineups-row:first-of-type {
  border-top: none;
}

/* Order # — small, secondary tone, right-aligned so it reads
   as supporting metadata next to the larger identity block on
   its right. Bench rows show `—` here. */
.scoring-drawer__lineups-row-order {
  font-size: 12px;
  font-weight: 600;
  color: var(--secondary);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

/* Round avatar — `TeamAvatar size="sm"`. Sits BEFORE the jersey
   block per the bench-card pattern. */
.scoring-drawer__lineups-row-avatar {
  /* TeamAvatar self-styles via `data-size="sm"` — wrapper class
     is only here for any future overrides we might need. */
}

/* Jersey icon + overlay number — real-vector jersey silhouette
   painted via CSS mask so it picks up `currentColor` from the
   parent. Number sits on top of the icon (absolute positioned),
   nudged down so it lands inside the jersey's print area
   instead of on the collar. */
.scoring-drawer__lineups-row-jersey {
  position: relative;
  width: 30px;
  height: 28px;
  display: grid;
  place-items: center;
  color: var(--secondary);
}
.scoring-drawer__lineups-row-jersey-icon {
  width: 100%;
  height: 100%;
  display: block;
  background-color: currentColor;
  /* Shared jersey icon — `jersy.svg`, the SAME finalized shirt icon
     the association Players nav item uses (see
     `.association-users__nav-icon--jersey`). Painted via CSS mask so
     `background-color: currentColor` tints it in the parent's color;
     light + dark both use the one asset, only the tint changes per
     the `.scoring-drawer__lineups-row-jersey` overrides below. We
     reuse this one icon app-wide rather than per-surface variants. */
  -webkit-mask-image: url('../assets/jersy.svg');
  mask-image: url('../assets/jersy.svg');
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}
.scoring-drawer__lineups-row-jersey-number {
  position: absolute;
  font-size: 11px;
  font-weight: 700;
  /* Use `--text` — the icon is now line-art (stroke only, no
     fill), so the number sits on the DRAWER's surface, not on a
     filled silhouette. `--text` themes correctly: dark in light
     mode (readable on white drawer), light in dark mode
     (readable on dark drawer). No per-mode override needed. */
  color: var(--text);
  /* Bump down a hair so the number sits visually inside the
     jersey's print area, not on the collar. */
  margin-top: 2px;
}
/* Dark mode — paint the jersey OUTLINE in the same lighter-
   primary blue tone the dark theme uses for other accent
   elements (matchgeni header logo, division names in stuck
   thead, etc.). `#7fb0e8` reads as a clear cool-tinted glyph
   against the dark-slate drawer surface — visible enough to
   frame the centered jersey number, tonal enough to read as a
   subtle accent rather than competing with the player name
   beside it. The number's color comes from `--text` above and
   auto-themes for dark mode. */
html.dark-mode .scoring-drawer__lineups-row-jersey {
  color: #7fb0e8;
}

/* Name block — bold, ellipsis-truncating, fills the available
   width between the jersey block and the position pill. */
.scoring-drawer__lineups-row-copy {
  min-width: 0;
}
.scoring-drawer__lineups-row-name {
  display: block;
  min-width: 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Position pill — outlined primary-tinted chip anchored to the
   right of the row, same visual as
   `.lineup-manager-bench__position`. */
.scoring-drawer__lineups-row-position {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 38px;
  height: 22px;
  padding: 0 10px;
  border: 1.5px solid var(--primary);
  border-radius: 999px;
  background: var(--white);
  color: var(--secondary);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1;
}
html.dark-mode .scoring-drawer__lineups-row-position {
  background: var(--surface-card);
  border-color: rgba(45, 140, 240, 0.6);
}

/* Bench rows — softer treatment so the row reads as "not in the
   batting order right now" without disappearing. Faded order
   slot (already `—`), greyed name. */
.scoring-drawer__lineups-row--bench .scoring-drawer__lineups-row-name {
  color: var(--secondary);
}
.scoring-drawer__lineups-row--bench .scoring-drawer__lineups-row-position {
  border-color: var(--border-divider);
  color: var(--secondary);
}

/* Loading / error / empty states inside the lineups table card. */
.scoring-drawer__lineups-loading {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 14px;
}
.scoring-drawer__lineups-loading-row {
  height: 28px;
  border-radius: 4px;
}
.scoring-drawer__lineups-error,
.scoring-drawer__lineups-empty {
  padding: 20px 14px;
  text-align: center;
  color: var(--secondary);
  font-size: 13px;
}
.scoring-drawer__lineups-retry {
  appearance: none;
  margin-top: 8px;
  padding: 6px 14px;
  border-radius: 6px;
  border: none;
  background: var(--primary);
  color: var(--white, #ffffff);
  font-weight: 600;
  cursor: pointer;
}
.scoring-drawer__umpires-banner-icon {
  display: inline-block;
  width: 14px;
  height: 14px;
  background-color: currentColor;
  -webkit-mask-image: url('../assets/umpire-line.svg');
  mask-image: url('../assets/umpire-line.svg');
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}
.scoring-drawer__umpires-banner-title {
  /* Inherits caps treatment from the `__head-left` cluster
     (parent flex-row carries the font-size + letter-spacing +
     uppercase + primary color). */
}
/* Assign / Change umpires — text link beside the title. */
.scoring-drawer__umpires-banner-action {
  appearance: none;
  border: 0;
  background: transparent;
  padding: 0;
  font: inherit;
  font-weight: 600;
  color: var(--primary);
  cursor: pointer;
  text-transform: none;
  letter-spacing: 0;
}
.scoring-drawer__umpires-banner-action:hover { text-decoration: underline; }
/* Dark-mode tint flip — both clusters (`__head-left` + the
   scorer label) carry the same primary-tinted caps tone, so the
   override needs to hit both. */
html.dark-mode .scoring-drawer__umpires-banner-head-left,
html.dark-mode .scoring-drawer__umpires-banner-scorer-label {
  color: #7fb0e8;
}

.scoring-drawer__umpires-banner-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.4;
}
.scoring-drawer__umpires-banner-name {
  display: inline-block;
  white-space: nowrap;
}
/* Bullet separator between names (except after the last) —
   matches the `·` rhythm used in the SlideModal subtitle slot
   line so the visual vocabulary stays consistent. */
.scoring-drawer__umpires-banner-name:not(:last-child)::after {
  content: '·';
  margin-left: 14px;
  color: var(--secondary);
  font-weight: 400;
}
.scoring-drawer__umpires-banner-empty {
  font-size: 14px;
  color: var(--secondary);
}

/* Dark-mode override — the source `.scoresheet-meta-box` rule
   in styles.css uses a hardcoded light gradient
   (`linear-gradient(180deg, var(--surface-opaque), rgba(246,
   250, 255, 0.96))`) which reads as glossy silver against the
   dark drawer surface. Replace with a flat dark-card background
   + a darker border + a softer label color. Scoped to the
   drawer's meta-cards container so the fix doesn't leak to the
   scoresheet page (where the layout might depend on the
   gradient). */
html.dark-mode .scoring-drawer__meta-cards .scoresheet-meta-box {
  background: var(--surface-card);
  border-color: var(--border-divider);
  background-image: none;
}
html.dark-mode .scoring-drawer__meta-cards .scoresheet-meta-box span {
  color: var(--secondary);
}
html.dark-mode .scoring-drawer__meta-cards .scoresheet-meta-box strong {
  color: var(--text);
}
html.dark-mode .scoring-drawer__meta-cards .scoresheet-meta-box em {
  color: var(--secondary);
}

/* Narrow viewport — 2+1 grid. Started + Time Limit on row 1,
   Location spans row 2 so its multi-line `field - park`
   (+ future city/state) value renders without truncation.
   Umpires card is its own full-width strip below the grid so
   it doesn't need responsive treatment here. */
@media (max-width: 720px) {
  /* Keep ALL THREE meta cards on a single row at mobile widths —
     user prefers a compact tri-column over the previous 2+1 wrap
     where Location got its own row below Started + Time Limit.
     Tightened column ratio + smaller gap so the trio fits
     comfortably in a phone-width drawer.
     Outer gutter dropped entirely on mobile (`padding: 0`) — the
     row sits flush against the panel's top + side edges; the
     inner meta cards already carry their own padding so the
     content doesn't butt right against the panel walls. */
  .scoring-drawer__meta-wrap {
    padding: 0;
  }
  .scoring-drawer__meta-cards {
    grid-template-columns:
      minmax(0, 1fr)
      minmax(0, 1fr)
      minmax(0, 1.4fr);
    gap: 8px;
  }
  .scoring-drawer__meta-cards .scoresheet-meta-box {
    padding: 8px 10px;
  }

  /* Umpires banner — stretched edge-to-edge on mobile (no
     horizontal margin gutter) so it consumes the full panel
     width for maximum readable area. Desktop keeps the inset
     20px margin + rounded card chrome. The 3px primary-tinted
     left-accent strip stays — that's a deliberate design cue,
     not chrome to strip. */
  .scoring-drawer__umpires-banner {
    margin-left: 0;
    margin-right: 0;
    border-right: 0;
    border-radius: 0;
  }
  /* `.scoring-drawer__lineups` mobile rule removed — the lineup
     card is already edge-to-edge on the desktop base rule now
     (no horizontal margin, no side borders, no border-radius);
     the previous mobile-specific stripping is redundant. */
}

/* Line-score wrap — no top padding so the table butts directly
   against the meta-cards row above. Horizontal padding stays 0
   so the inning grid uses the FULL drawer body width; the
   `.scoresheet-matchup-card` inside carries its own internal
   padding (`14px 16px` from styles.css) which gives the table
   its breathing room. */
.scoring-drawer__line-score-wrap {
  padding: 0;
}
/* `.scoring-drawer__section-title` was the "LINE SCORE" heading
   above the table — removed since the SlideModal header now
   carries the game identity (division eyebrow + status badge +
   game label + slot subtitle) and the table that follows speaks
   for itself. */

/* The line-score block reuses `.scoresheet-linescore__*` classes
   defined globally in `src/styles.css` (see ScoresheetView for
   the canonical surface). Nothing local needed here — the
   wrapping `.scoresheet-matchup-card` carries the responsive
   overflow rules and the inner rows use the shared CSS for
   styling. */

/* `.scoring-drawer__line-score-empty` removed — the line-score
   now renders for ALL game states. Pre-game rows show just the
   team-identity strip per the rules mirrored from ScoresheetView. */

/* Footer button rules removed — drawer no longer renders a
   footer (header X is the only close affordance). */

/* ─── Mobile responsive ─────────────────────────────────────── */

@media (max-width: 720px) {
  .scoring-drawer {
    padding: 14px;
    gap: 16px;
  }

  /* Header-actions row on mobile — the slide-modal panel header
     drops this row onto its own line below the title+close row
     (see `.slide-modal-panel__header` mobile rule in styles.css).
     Inside the row we want the two action buttons (Primary +
     Upload) to share the available width EQUALLY while the
     settings kebab stays its natural fixed width on the right. */
  .scoring-drawer__header-actions {
    /* `flex` instead of the desktop `inline-flex` so the wrapper
       takes the full panel width handed to it by the grid area. */
    display: flex;
    width: 100%;
  }
  .scoring-drawer__action {
    /* `flex: 1 1 0` — equal share of the row regardless of label
       length. Primary ("Resume Scoring") and Upload now each
       occupy ~50% of the available width minus the kebab. */
    flex: 1 1 0;
    min-width: 0;
    /* Center the label inside the equal-width pill (otherwise a
       short "Upload" label would sit left-aligned in a wide cell). */
    text-align: center;
  }
  .scoring-drawer__overflow {
    /* Settings kebab keeps its 34×34 fixed size — pinned to the
     row's right edge, not stretched. */
    flex: 0 0 auto;
  }

  /* Start-game inline form buttons (NOT the header toolbar) still
     stack one-per-row in their own narrow context — restore the
     old "wrap to own line" behaviour for them specifically so the
     equal-width rule above doesn't bleed in. */
  .scoring-drawer__start-form-buttons .scoring-drawer__action {
    flex: 1 1 100%;
  }

  /* Mobile-footer styling — the slide-modal panel's `__footer`
     element is global; we only need to add elevation to it WHEN
     it's hosting this drawer's mobile toolbar. `:has()` scopes
     the shadow so other slide-modal consumers' footers don't
     pick it up. Soft upward shadow makes the footer strip read
     as a sticky bar lifted above the scrolling body content. */
  :global(.slide-modal-panel__footer:has(.scoring-drawer__header-actions--mobile)) {
    box-shadow: 0 -8px 24px rgba(13, 30, 58, 0.12);
    /* The base `padding: 10px` is fine, but force the footer to
       span the full panel width with our toolbar inside (the
       slide-modal default is `justify-content: flex-end` which
       would push a single-item content to the right edge). */
    justify-content: stretch;
  }
  :global(html.dark-mode .slide-modal-panel__footer:has(.scoring-drawer__header-actions--mobile)) {
    box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.5);
  }

  /* Mobile-toolbar layout INSIDE the footer — same flex
     distribution as the desktop header-actions row, just hosted
     in a different parent. The `--mobile` modifier carries the
     full-width sizing so we don't fight the footer's default
     `justify-content: flex-end`. */
  .scoring-drawer__header-actions--mobile {
    width: 100%;
  }

  /* Line-score responsiveness lives in the global
     `.scoresheet-matchup-card` / `.scoresheet-linescore` rules
     in src/styles.css — sticky team column + horizontal scroll
     activate automatically at the same breakpoint
     ScoresheetView uses. No drawer-specific overrides needed. */
}
</style>
