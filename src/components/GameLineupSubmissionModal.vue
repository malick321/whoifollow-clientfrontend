<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import StatusBadge from './StatusBadge.vue'
import FieldLineupPreview, { type PreviewPlayer } from './FieldLineupPreview.vue'
import jerseyIcon from '../assets/jersy.svg'
import { fetchGameLineupSubmission, saveGameLineupSubmission } from '../api/team'
import { DEFAULT_SLOW_PITCH_FIELD_POSITIONS } from '../constants/fieldConfig'
import { gameLineupSubmissionStatusMeta } from '../game-lineup-status'
import { pushToast } from '../toast-center'
import { lockBodyScroll, unlockBodyScroll } from '../body-scroll-lock'
import type {
  FieldConfigPosition,
  GameLineupPlayer,
  GameLineupSubmission,
  GameLineupSubmissionDetail,
  LineupPlayer
} from '../types'

const props = withDefaults(defineProps<{
  modelValue: boolean
  gameId: string
  teamId: string
  teamName: string
  opponentName: string
  bracketLabel: string
  gameDateLabel?: string
  gameTimeLabel?: string
  gameTime?: string
  gameFieldName?: string
  gameParkName?: string
  fallbackLineup?: LineupPlayer[]
  fallbackFieldConfigName?: string | null
  fallbackFieldPositions?: FieldConfigPosition[]
  totalInnings?: number
  /* Meta for the field preview. All optional — falls back to an empty
     string when the caller doesn't have a value. Pre-formatted hero
     meta ("Men's 65+ 1300 - Glendale, AZ") is derived from the
     age/rating/city/state fields inside the modal. */
  teamAvatarUrl?: string
  teamAgeGroup?: string
  teamRating?: string
  teamCity?: string
  teamState?: string
  opponentAvatarUrl?: string
  eventName?: string
  eventDate?: string
  division?: string
  /* Game status label + StatusBadge tone for the preview header.
     Values like "Yet to begin" / "Live" / "Delayed" / "Final" — the
     parent derives these from GameSummary.status + delay info. */
  gameStatusLabel?: string
  gameStatusTone?: 'success' | 'warning' | 'info' | 'danger' | 'neutral' | 'primary'
  // When false, every edit control is hidden or disabled. The modal still
  // renders the current lineup as read-only so non-admins can review it.
  isAdmin?: boolean
}>(), {
  teamAvatarUrl: '',
  teamAgeGroup: '',
  teamRating: '',
  teamCity: '',
  teamState: '',
  opponentAvatarUrl: '',
  eventName: '',
  eventDate: '',
  division: '',
  gameStatusLabel: '',
  gameStatusTone: 'info',
  isAdmin: false
})

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'saved', submission: GameLineupSubmission): void
}>()

const DEFAULT_GAME_LINEUP_POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'LC', 'RC', 'RF']

const loading = ref(false)
const saving = ref(false)
const draft = ref<GameLineupPlayer[]>([])
const submissionId = ref<string | null>(null)
const formStatus = ref<GameLineupSubmission['status']>('draft')
const formNotes = ref('')
const fieldConfigName = ref('Slow Pitch 10 Player')
const fieldPositions = ref<FieldConfigPosition[]>(DEFAULT_SLOW_PITCH_FIELD_POSITIONS)
const draggedPlayerId = ref<string | null>(null)
const dropTargetId = ref<string | null>(null)
const expandedBenchPlayerId = ref<string | null>(null)
const substituteDrafts = ref<Record<string, { targetId: string | null; inning: number | null; positionCode: string | null }>>({})

/* Preview-mode flag — when true, the modal body swaps to the shared
   FieldLineupPreview. Header hides so the green field stage fills the
   popup. Reset to false whenever the modal opens. */
const previewMode = ref(false)
const previewBodyRef = ref<HTMLElement | null>(null)

function togglePreview() {
  previewMode.value = !previewMode.value
}

/**
 * Apply position changes emitted by the interactive field preview.
 * Walks the flat {playerId, position} array and patches each matched
 * player's `positionCode` in `draft` (the mutable roster source of
 * truth for this modal). `GameLineupPlayer` uses `positionCode`, not
 * `position` like `LineupPlayer` does — that's the only shape
 * difference versus the EventLineupModal handler. `isBench`,
 * `battingOrder`, substitutions are intentionally untouched; drag
 * only changes fielding positions.
 */
function handleApplyPositionChanges(changes: Array<{ playerId: string; position: string }>): void {
  if (!changes.length) return
  for (const change of changes) {
    const player = draft.value.find((p) => p.id === change.playerId)
    if (player) player.positionCode = change.position
  }
}

/* Snap the preview body's scroll to the top on entry. Matters on
   mobile (≤720 px) where the body becomes a vertical scroll
   container — ensures the user always lands on the Close Preview /
   game meta section, not halfway through the content. No-op on
   tablet/desktop where the body doesn't scroll. */
watch(previewMode, async (open) => {
  if (!open) return
  await nextTick()
  previewBodyRef.value?.scrollTo({ top: 0 })
})

/* Hero meta string ("Men's 65+ 1300 - Glendale, AZ") derived from the
   age/rating/city/state props. Mirrors the participation hero + event
   lineup preview so the home team caption reads the same in every
   surface. */
const homeTeamMeta = computed(() => {
  const left = [props.teamAgeGroup, props.teamRating].filter(Boolean).join(' ')
  const right = [props.teamCity, props.teamState].filter(Boolean).join(', ')
  if (left && right) return `${left} - ${right}`
  return left || right
})

/* Field + park caption for the preview's left column. "North Field -
   Gaddafi Stadium" if both are present; either alone otherwise. */
const gameLocationLabel = computed(() => {
  const field = props.gameFieldName?.trim() ?? ''
  const park = props.gameParkName?.trim() ?? ''
  if (field && park) return `${field} - ${park}`
  return field || park
})

/* Preview only makes sense when the field config actually carries
   (x, y) coordinates. Positions with `status === 0` or missing
   xAxis/yAxis contribute nothing to the preview. */
const hasFieldCoordinates = computed(() =>
  fieldPositions.value.some(
    (position) => typeof position.xAxis === 'number' && typeof position.yAxis === 'number'
  )
)

/* Normalise GameLineupPlayer[] → PreviewPlayer[] so the shared preview
   can read them with a single interface. Substitute rows are skipped
   (they stand in for benched teammates during in-game substitutions and
   don't belong on the preview). */
const previewLineup = computed<PreviewPlayer[]>(() => {
  return draft.value
    .filter((player) => !player.isSubstitute)
    .map((player) => ({
      id: player.id,
      name: player.playerName ?? '',
      jerseyNumber: player.jerseyNumber ?? '',
      position: player.positionCode ?? '',
      status: player.isBench ? 'bench' : 'active' as 'active' | 'bench'
    }))
})

const statusMeta = computed(() => gameLineupSubmissionStatusMeta(formStatus.value))
// Starters table = all non-substitute, non-bench players. A player who was
// subbed out (isActive=false, isBench=false, isSubstitute=false) stays in
// their original row with their original name, jersey and position — we just
// render them in a "Subbed out" state. The substitute that took their slot
// shows on the right-side bench panel, which already says "Entered inning X
// for {starter}" and is the correct place to surface that relationship.
const starters = computed(() =>
  draft.value
    .filter((player) => !player.isBench && !player.isSubstitute)
    .slice()
    .sort((left, right) => left.battingOrder - right.battingOrder)
)

// Required starter slots = the number of ACTIVE positions in the field
// config. Matches the pattern in EventLineupModal (`requiredPlayers`)
// and the FieldLineupPreview pin filter (`position.status !== 0`).
// Replaces the previously hard-coded `10` denominator on the badge,
// which only happened to be right for a 10-position default and would
// silently mis-render for any other config (e.g. 11-fielder + EH = 11
// slots, or league configs with custom counts).
const requiredStarters = computed(
  () => fieldPositions.value.filter((position) => position.status !== 0).length
)
const startersBadgeTone = computed<'success' | 'warning'>(() =>
  requiredStarters.value > 0 && starters.value.length >= requiredStarters.value
    ? 'success'
    : 'warning'
)

function starterSubbedOutLabel(player: GameLineupPlayer) {
  if (player.isActive) return ''
  const substitute = draft.value.find(
    (entry) => entry.isSubstitute && entry.substitutesForId === player.id
  )
  const inning = substitute?.enteredInning ?? player.exitedInning
  if (!inning) return ''
  const name = substitute?.playerName
  return name ? `Subbed out in inning ${inning} for ${name}` : `Subbed out in inning ${inning}`
}
const bench = computed(() =>
  draft.value
    .filter((player) => player.isBench && !player.isSubstitute)
    .slice()
    .sort((left, right) => left.playerName.localeCompare(right.playerName))
)
const gameRosterPlayers = computed(() =>
  draft.value
    .filter((player) => (player.isBench && !player.isSubstitute) || player.isSubstitute)
    .slice()
    .sort((left, right) => left.playerName.localeCompare(right.playerName))
)
const gameRosterSummary = computed(() => {
  const benchCount = bench.value.length
  const subUsedCount = draft.value.filter((player) => player.isSubstitute).length
  const summaryParts = [`${benchCount} benched`]

  if (subUsedCount > 0) {
    summaryParts.push(`${subUsedCount} ${subUsedCount === 1 ? 'sub' : 'subs'} used`)
  }

  return summaryParts.join(' · ')
})
const inningOptions = computed(() => Array.from({ length: props.totalInnings ?? 27 }, (_, index) => index + 1))
const gameContextLabel = computed(() => {
  const dateLabel = props.gameDateLabel?.trim() ?? ''
  const timeLabel = props.gameTimeLabel?.trim() ?? ''
  const fallbackSchedule = props.gameTime?.trim() ?? ''
  const scheduleLabel = [timeLabel, dateLabel].filter(Boolean).join(' - ') || fallbackSchedule
  const titleLabel = props.bracketLabel?.trim() || 'Game'
  const locationLabel = [props.gameFieldName?.trim(), props.gameParkName?.trim()].filter(Boolean).join(' - ')

  return [scheduleLabel, titleLabel, locationLabel].filter(Boolean).join(' - ')
})

function close() {
  emit('update:modelValue', false)
}

function normalizePlayers(players: GameLineupPlayer[]) {
  return players
    .map((player, index) => ({
      ...player,
      battingOrder: player.battingOrder || index + 1,
      positionCode: player.positionCode ?? null,
      isStarter: player.isBench ? false : player.isStarter,
      isBench: player.isBench,
      isSubstitute: player.isSubstitute ?? false,
      isActive: player.isActive ?? true,
      substitutesForId: player.substitutesForId ?? null,
      playerSourceType: player.playerSourceType ?? 'manual'
    }))
    .sort((left, right) => left.battingOrder - right.battingOrder)
}

function buildFromTemplate(templateLineup: LineupPlayer[]): GameLineupPlayer[] {
  return templateLineup
    .map((player, index) => ({
      id: `draft-${player.id}`,
      eventLineupId: player.id,
      teamMemberId: player.teamMemberId ?? undefined,
      userId: player.userId ?? undefined,
      imageUrl: player.imageUrl,
      playerName: player.name,
      jerseyNumber: player.jerseyNumber,
      battingOrder: player.battingOrder ?? index + 1,
      positionCode: player.position?.trim() ? player.position : DEFAULT_GAME_LINEUP_POSITIONS[index] ?? 'EH',
      isStarter: player.status !== 'bench',
      isBench: player.status === 'bench',
      isSubstitute: false,
      isActive: true,
      substitutesForId: null,
      playerSourceType:
        player.teamMemberId != null || player.userId != null
          ? 'team_member'
          : player.playerSourceType ?? 'manual'
    }))
    .sort((left, right) => left.battingOrder - right.battingOrder)
}

function playerLinkageLabel(player: GameLineupPlayer) {
  return player.teamMemberId || player.userId ? 'Linked teammate' : 'Manual Player'
}

// Render a dash when the jersey number is missing — cleaner than a blank
// space inside the jersey chip / bench avatar circle.
function displayJersey(value: string | null | undefined) {
  const trimmed = value?.trim() ?? ''
  return trimmed || '-'
}

function syncStarterState(players: GameLineupPlayer[]) {
  const orderedStarters = players
    .filter((player) => !player.isBench && player.isActive)
    .slice()
    .sort((left, right) => left.battingOrder - right.battingOrder)
  const orderedBench = players
    .filter((player) => player.isBench)
    .slice()
    .sort((left, right) => left.playerName.localeCompare(right.playerName))
  const orderedInactive = players
    .filter((player) => !player.isBench && !player.isActive)
    .slice()
    .sort((left, right) => {
      const leftOrder = left.exitedInning ?? left.battingOrder
      const rightOrder = right.exitedInning ?? right.battingOrder
      return leftOrder - rightOrder
    })

  let starterIndex = 0
  for (const player of orderedStarters) {
    starterIndex += 1
    player.isStarter = true
    player.isBench = false
    player.battingOrder = starterIndex
    if (!player.positionCode) {
      player.positionCode = DEFAULT_GAME_LINEUP_POSITIONS[starterIndex - 1] ?? 'EH'
    }
  }

  for (const [benchIndex, player] of orderedBench.entries()) {
    player.isStarter = false
    player.battingOrder = 90 + benchIndex + 1
    if (!player.positionCode) player.positionCode = 'EH'
  }

  players.splice(0, players.length, ...orderedStarters, ...orderedInactive, ...orderedBench)
}

function applyFieldConfig(detail: GameLineupSubmissionDetail) {
  fieldConfigName.value = detail.fieldConfig?.name ?? props.fallbackFieldConfigName ?? 'Slow Pitch 10 Player'
  fieldPositions.value = detail.fieldConfig?.positions?.length
    ? detail.fieldConfig.positions
    : props.fallbackFieldPositions?.length
      ? props.fallbackFieldPositions
      : DEFAULT_SLOW_PITCH_FIELD_POSITIONS
}

async function load() {
  if (!props.gameId || !props.teamId) return
  loading.value = true
  try {
    const lineupDetail = await fetchGameLineupSubmission(props.gameId, props.teamId)
    applyFieldConfig(lineupDetail)
    const sourcePlayers = lineupDetail.hasExistingSubmission
      ? lineupDetail.players ?? lineupDetail.submission?.players ?? []
      : buildFromTemplate(lineupDetail.templateLineup ?? props.fallbackLineup ?? [])
    draft.value = normalizePlayers(sourcePlayers)
    syncStarterState(draft.value)
    expandedBenchPlayerId.value = null
    substituteDrafts.value = {}
    submissionId.value = lineupDetail.submission?.id ?? null
    formStatus.value = lineupDetail.submission?.status ?? 'draft'
    formNotes.value = lineupDetail.submission?.notes ?? ''
  } catch (error) {
    const fallbackPlayers = buildFromTemplate(props.fallbackLineup ?? [])
    draft.value = normalizePlayers(fallbackPlayers)
    syncStarterState(draft.value)
    expandedBenchPlayerId.value = null
    substituteDrafts.value = {}
    submissionId.value = null
    formStatus.value = 'draft'
    formNotes.value = ''
    fieldConfigName.value = props.fallbackFieldConfigName ?? 'Slow Pitch 10 Player'
    fieldPositions.value = props.fallbackFieldPositions?.length
      ? props.fallbackFieldPositions
      : DEFAULT_SLOW_PITCH_FIELD_POSITIONS
    pushToast({
      tone: 'warning',
      title: 'Unable to load lineup',
      message: error instanceof Error
        ? `${error.message}. Showing the event lineup template so you can continue.`
        : 'The game lineup submission could not be loaded. Showing the event lineup template so you can continue.'
    })
  } finally {
    loading.value = false
  }
}

function setPlayerBench(playerId: string, isBench: boolean) {
  const player = draft.value.find((entry) => entry.id === playerId)
  if (!player) return
  player.isBench = isBench
  player.isSubstitute = false
  player.substitutesForId = null
  player.enteredInning = null
  player.exitedInning = null
  player.isActive = !isBench
  player.positionCode = isBench ? 'EH' : player.positionCode ?? DEFAULT_GAME_LINEUP_POSITIONS[0]
  if (expandedBenchPlayerId.value === playerId) expandedBenchPlayerId.value = null
  cancelSubstitute(playerId)
  syncStarterState(draft.value)
}

function substituteLabel(playerId: string | null | undefined) {
  if (!playerId) return ''
  return draft.value.find((entry) => entry.id === playerId)?.playerName ?? ''
}

function substitutionTargetsFor(player: GameLineupPlayer) {
  return draft.value
    .filter((entry) => !entry.isBench && entry.id !== player.id && (entry.isActive || entry.id === player.substitutesForId))
    .slice()
    .sort((left, right) => left.battingOrder - right.battingOrder)
}

function prepareSubstitute(playerId: string) {
  const player = draft.value.find((entry) => entry.id === playerId)
  if (!player) return
  const existingDraft = substituteDrafts.value[playerId]
  const options = substitutionTargetsFor(player)
  expandedBenchPlayerId.value = playerId
  substituteDrafts.value = {
    [playerId]: {
      targetId: existingDraft?.targetId ?? player.substitutesForId ?? options[0]?.id ?? null,
      inning: existingDraft?.inning ?? player.enteredInning ?? 5,
      positionCode: existingDraft?.positionCode ?? player.positionCode ?? 'EH'
    }
  }
}

function cancelSubstitute(playerId: string) {
  const { [playerId]: _removed, ...remaining } = substituteDrafts.value
  substituteDrafts.value = remaining
}

function applySubstitute(playerId: string) {
  const substitute = draft.value.find((entry) => entry.id === playerId)
  const subDraft = substituteDrafts.value[playerId]
  if (!substitute || !subDraft?.targetId || !subDraft.inning) return
  const target = draft.value.find((entry) => entry.id === subDraft.targetId)
  if (!target) return
  const previousTarget = substitute.substitutesForId
    ? draft.value.find((entry) => entry.id === substitute.substitutesForId)
    : null

  if (previousTarget && previousTarget.id !== target.id) {
    previousTarget.isActive = true
    previousTarget.isStarter = true
    previousTarget.exitedInning = null
  }

  target.isActive = false
  target.isStarter = false
  target.exitedInning = subDraft.inning

  substitute.isBench = false
  substitute.isSubstitute = true
  substitute.isActive = true
  substitute.enteredInning = subDraft.inning
  substitute.substitutesForId = target.id
  substitute.battingOrder = target.battingOrder
  substitute.positionCode = subDraft.positionCode ?? target.positionCode ?? 'EH'
  syncStarterState(draft.value)
  cancelSubstitute(playerId)
  expandedBenchPlayerId.value = null
}

function toggleBenchPlayer(playerId: string) {
  if (expandedBenchPlayerId.value === playerId) {
    expandedBenchPlayerId.value = null
    cancelSubstitute(playerId)
    return
  }

  const player = draft.value.find((entry) => entry.id === playerId)
  if (player?.isSubstitute) {
    prepareSubstitute(playerId)
    return
  }

  expandedBenchPlayerId.value = playerId
  substituteDrafts.value = {}
}

function undoSubstitute(playerId: string) {
  const substitute = draft.value.find((entry) => entry.id === playerId)
  if (!substitute || !substitute.substitutesForId) return
  const target = draft.value.find((entry) => entry.id === substitute.substitutesForId)
  if (target) {
    target.isActive = true
    target.isStarter = true
    target.exitedInning = null
  }

  substitute.isBench = true
  substitute.isSubstitute = false
  substitute.isActive = false
  substitute.enteredInning = null
  substitute.substitutesForId = null
  substitute.positionCode = 'EH'
  cancelSubstitute(playerId)
  expandedBenchPlayerId.value = null
  syncStarterState(draft.value)
}

function onDragStart(event: DragEvent, playerId: string) {
  draggedPlayerId.value = playerId
  dropTargetId.value = null
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', playerId)
  }
}

function onDragEnd() {
  draggedPlayerId.value = null
  dropTargetId.value = null
}

function onDragOver(event: DragEvent, targetPlayerId: string) {
  event.preventDefault()
  dropTargetId.value = targetPlayerId
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

// For drag-reorder purposes, each batting-order slot is represented by its
// currently ACTIVE player (the sub if the starter was subbed out, otherwise
// the starter). This lets the user grab a subbed-out starter's row and move
// the whole slot — the paired sub moves with them.
function resolveSlotAnchor(playerId: string) {
  const player = draft.value.find((entry) => entry.id === playerId)
  if (!player) return playerId
  if (!player.isActive && !player.isBench && !player.isSubstitute) {
    const sub = draft.value.find(
      (entry) => entry.isSubstitute && entry.substitutesForId === player.id
    )
    if (sub) return sub.id
  }
  return playerId
}

function moveStarterTo(event: DragEvent, targetPlayerId: string) {
  event.preventDefault()
  const rawDraggedId = event.dataTransfer?.getData('text/plain') || draggedPlayerId.value
  if (!rawDraggedId) return

  const draggedId = resolveSlotAnchor(rawDraggedId)
  const resolvedTargetId = resolveSlotAnchor(targetPlayerId)
  if (!draggedId || draggedId === resolvedTargetId) return

  // Reorder runs over the 10 active slot anchors only. Subbed-out starters
  // are re-pinned to their paired sub's new batting_order below, so they
  // always share a slot with their sub (the invariant the scoresheet
  // adapter relies on).
  const orderedStarters = draft.value
    .filter((player) => !player.isBench && player.isActive)
    .slice()
    .sort((left, right) => left.battingOrder - right.battingOrder)
  const draggedIndex = orderedStarters.findIndex((player) => player.id === draggedId)
  const targetIndex = orderedStarters.findIndex((player) => player.id === resolvedTargetId)
  if (draggedIndex < 0 || targetIndex < 0) return

  const reordered = orderedStarters.slice()
  const [draggedPlayer] = reordered.splice(draggedIndex, 1)
  reordered.splice(targetIndex, 0, draggedPlayer)
  reordered.forEach((player, index) => {
    player.battingOrder = index + 1
  })
  syncStarterState(draft.value)
  // Propagate each sub's final batting_order back to its paired starter so
  // the (starter, sub) pair always shares the same slot number.
  for (const sub of draft.value) {
    if (sub.isSubstitute && sub.substitutesForId) {
      const starter = draft.value.find((entry) => entry.id === sub.substitutesForId)
      if (starter) starter.battingOrder = sub.battingOrder
    }
  }
  draggedPlayerId.value = null
  dropTargetId.value = null
}

function availablePositions(forPlayerId: string) {
  const taken = new Set(
    draft.value
      .filter((player) => !player.isBench && player.id !== forPlayerId)
      .map((player) => player.positionCode)
      .filter(Boolean)
  )
  // EH must always be selectable even when the sport's field_config doesn't
  // define it — Extra Hitter is a batting-only slot that doesn't reserve a
  // fielding position, so multiple players can carry it. Append a synthetic
  // EH option when the fetched config omits it.
  const hasEH = fieldPositions.value.some((p) => p.code === 'EH')
  const source = hasEH
    ? fieldPositions.value
    : [...fieldPositions.value, { code: 'EH', label: 'Extra Hitter', area: 'flex' as const }]
  return source.filter(
    (position) => position.code === 'EH' || !taken.has(position.code)
  )
}

async function save() {
  saving.value = true
  try {
    const normalizedPlayers = normalizePlayers(draft.value)
    syncStarterState(normalizedPlayers)
    const timestamp = new Date().toISOString()
    const nextSubmission: GameLineupSubmission = {
      id: submissionId.value,
      status: formStatus.value,
      approvalMode: 'manual',
      sourceType: 'manual',
      submittedAt: timestamp,
      rejectionReason: null,
      notes: formNotes.value.trim(),
      players: normalizedPlayers
    }
    const savedSubmission = await saveGameLineupSubmission(props.gameId, props.teamId, nextSubmission)
    submissionId.value = savedSubmission.id ?? null
    draft.value = normalizePlayers(savedSubmission.players)
    formStatus.value = savedSubmission.status
    emit('saved', savedSubmission)
    pushToast({
      tone: 'success',
      title: 'Lineup submitted',
      message: 'The game lineup submission was saved successfully.'
    })
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Unable to submit lineup',
      message: error instanceof Error ? error.message : 'Something went wrong while saving the game lineup submission.'
    })
  } finally {
    saving.value = false
  }
}

watch(
  () => props.modelValue,
  (isOpen, wasOpen) => {
    if (isOpen) {
      void load()
      // Every open lands in edit mode; user explicitly opts into preview.
      previewMode.value = false
    }
    // Lock the page scroll behind the modal while it's open — otherwise
    // the popup scroll bleeds into the underlying page and the user ends
    // up on a different part of the page when they close it. `wasOpen`
    // is undefined on the immediate first call, so the !wasOpen guard
    // skips the initial mount when the modal renders closed.
    if (isOpen && !wasOpen) lockBodyScroll()
    else if (!isOpen && wasOpen) unlockBodyScroll()
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  // If we unmount while still open (route change, parent v-if flip, etc.)
  // release the scroll lock so the underlying page stays usable.
  if (props.modelValue) unlockBodyScroll()
})
</script>

<template>
  <div v-if="modelValue" class="modal-backdrop" @click.self="close">
    <!-- `--previewing` class forces the modal to fill the viewport height
         when the field preview is active, so the preview content has a
         concrete flex-parent height to grow into. Without this the
         max-height ceiling is never hit and the popup shrinks to the
         preview's intrinsic (small) size. -->
    <section
      class="modal-card lineup-manager-modal"
      :class="{ 'lineup-manager-modal--previewing': previewMode }"
    >
      <!-- Header is hidden entirely in preview mode — the preview body
           shows the game meta (left column) and team identity (right
           column), and a Close Preview CTA handles return to edit. -->
      <header v-if="!previewMode" class="modal-card__header lineup-manager-modal__header">
        <div class="lineup-manager-modal__title-block">
          <!-- Title row: two columns.
               Left column  — the user's team name (h2).
               Right column — a two-row stack:
                 top row  = roster status badges
                 bottom row = "vs opponent"
               Second row (outside this grid) = date/time subtitle. -->
          <div class="lineup-manager-modal__title-row">
            <h2 class="lineup-manager-modal__title-primary">{{ teamName }}</h2>
            <div class="lineup-manager-modal__title-meta">
              <div v-if="!loading" class="lineup-manager-modal__title-badges">
                <StatusBadge :label="statusMeta.label" :tone="statusMeta.tone" />
                <StatusBadge :label="fieldConfigName" tone="info" />
                <StatusBadge :label="`${starters.length}/${requiredStarters} starters`" :tone="startersBadgeTone" />
              </div>
              <!-- Shimmer placeholders stand in for the three status badges
                   while the lineup + field config are being fetched. Widths
                   approximate the real badge copy so the header doesn't
                   jump when data arrives (Draft → ~68px, field config →
                   wider ~100px, "10/10 starters" → widest ~120px). -->
              <div v-else class="lineup-manager-modal__title-badges">
                <span class="lineup-manager-modal__badge-skeleton shimmer-block"></span>
                <span class="lineup-manager-modal__badge-skeleton lineup-manager-modal__badge-skeleton--medium shimmer-block"></span>
                <span class="lineup-manager-modal__badge-skeleton lineup-manager-modal__badge-skeleton--wide shimmer-block"></span>
              </div>
              <p class="lineup-manager-modal__title-secondary">vs {{ opponentName || 'Opponent' }}</p>
            </div>
          </div>
          <p class="lineup-manager-modal__subtitle">
            {{ gameContextLabel }}
          </p>
        </div>
        <div class="lineup-manager-modal__header-actions">
          <!-- Preview toggle, admin-only and hidden when the config
               doesn't carry x/y coords. Disappears in preview mode —
               the in-stage Close Preview pill handles return to edit. -->
          <button
            v-if="isAdmin && hasFieldCoordinates"
            class="secondary-button"
            type="button"
            :disabled="loading"
            @click="togglePreview"
          >
            Preview
          </button>
          <button v-if="isAdmin" class="primary-button" type="button" :disabled="saving || loading" @click="save">
            {{ saving ? 'Submitting Lineup...' : 'Submit Lineup' }}
          </button>
          <button class="ellipsis-button ellipsis-button--close" type="button" @click="close">
            <AppIcon name="close" :size="16" />
          </button>
        </div>
      </header>

      <!-- Preview mode: same shared shell as the Event Lineup modal, but
           the left column shows the game context (bracket label, division,
           event name + dates) and the right column adds the opponent
           under the home-team identity. -->
      <div
        v-if="previewMode && !loading"
        ref="previewBodyRef"
        class="lineup-manager-modal__body lineup-manager-modal__body--preview"
      >
        <FieldLineupPreview
          :lineup="previewLineup"
          :field-positions="fieldPositions"
          :field-config-name="fieldConfigName"
          :home-team-name="teamName"
          :home-team-avatar-url="teamAvatarUrl"
          :home-team-meta="homeTeamMeta"
          grouped-roster
          :editable="isAdmin"
          @close-preview="previewMode = false"
          @apply-position-changes="handleApplyPositionChanges"
        >
          <template #left-column>
            <!-- Game status badge first (Yet to begin / Live / Delayed
                 / Final — parent-derived from GameSummary.status +
                 delay info), then bracket label, game date+time, field
                 + park. A 20px gap below the location separates the
                 game-level info from the broader event context
                 (division, event name, event date range). -->
            <StatusBadge
              v-if="gameStatusLabel"
              class="event-lineup-preview__status-badge"
              :label="gameStatusLabel"
              :tone="gameStatusTone"
            />
            <h3 v-if="bracketLabel" class="event-lineup-preview__event-name">{{ bracketLabel }}</h3>
            <p v-if="opponentName" class="event-lineup-preview__event-vs">
              <span class="event-lineup-preview__event-vs-label">vs</span>
              <span class="event-lineup-preview__event-vs-name">{{ opponentName }}</span>
            </p>
            <p v-if="gameDateLabel || gameTimeLabel" class="event-lineup-preview__event-date">
              {{ [gameTimeLabel, gameDateLabel].filter(Boolean).join(' · ') }}
            </p>
            <p v-if="gameLocationLabel" class="event-lineup-preview__event-date event-lineup-preview__event-location">
              {{ gameLocationLabel }}
            </p>
            <p v-if="division" class="event-lineup-preview__event-division event-lineup-preview__event-division--event-context">
              {{ division }}
            </p>
            <p v-if="eventName" class="event-lineup-preview__event-date">{{ eventName }}</p>
            <p v-if="eventDate" class="event-lineup-preview__event-date">{{ eventDate }}</p>
          </template>
        </FieldLineupPreview>
      </div>

      <div v-else-if="loading" class="game-lineup-skeleton">
        <section class="lineup-manager-modal__panel lineup-manager-modal__panel--bare">
          <div class="game-lineup-skeleton__sectionhead">
            <span class="game-lineup-skeleton__badge shimmer-block"></span>
          </div>

          <div class="game-lineup-skeleton__grid">
            <span class="game-lineup-skeleton__header shimmer-block"></span>
            <span class="game-lineup-skeleton__header shimmer-block"></span>
            <span class="game-lineup-skeleton__header shimmer-block"></span>
            <span class="game-lineup-skeleton__header shimmer-block"></span>

            <template v-for="rowIndex in 7" :key="`starter-skel-${rowIndex}`">
              <span class="game-lineup-skeleton__cell game-lineup-skeleton__cell--order shimmer-block"></span>
              <div class="game-lineup-skeleton__player">
                <span class="game-lineup-skeleton__jersey shimmer-block"></span>
                <div class="game-lineup-skeleton__player-copy">
                  <span class="game-lineup-skeleton__line shimmer-block"></span>
                  <span class="game-lineup-skeleton__line game-lineup-skeleton__line--short shimmer-block"></span>
                </div>
              </div>
              <span class="game-lineup-skeleton__cell game-lineup-skeleton__cell--select shimmer-block"></span>
              <span class="game-lineup-skeleton__cell game-lineup-skeleton__cell--button shimmer-block"></span>
            </template>
          </div>
        </section>

        <aside class="lineup-manager-modal__aside">
          <section class="lineup-manager-modal__panel lineup-manager-modal__panel--bare">
            <div class="game-lineup-skeleton__panel-title">
              <span class="game-lineup-skeleton__line game-lineup-skeleton__line--title shimmer-block"></span>
              <span class="game-lineup-skeleton__line shimmer-block"></span>
            </div>
            <div class="game-lineup-skeleton__bench-list">
              <div v-for="rowIndex in 4" :key="`bench-${rowIndex}`" class="game-lineup-skeleton__bench-item">
                <span class="game-lineup-skeleton__line shimmer-block"></span>
                <span class="game-lineup-skeleton__line game-lineup-skeleton__line--short shimmer-block"></span>
                <div class="game-lineup-skeleton__bench-actions">
                  <span class="game-lineup-skeleton__mini-button shimmer-block"></span>
                  <span class="game-lineup-skeleton__mini-button game-lineup-skeleton__mini-button--wide shimmer-block"></span>
                </div>
              </div>
            </div>
          </section>

          <section class="lineup-manager-modal__panel lineup-manager-modal__panel--bare">
            <div class="game-lineup-skeleton__panel-title">
              <span class="game-lineup-skeleton__line game-lineup-skeleton__line--title shimmer-block"></span>
              <span class="game-lineup-skeleton__line shimmer-block"></span>
            </div>
            <span class="game-lineup-skeleton__notes shimmer-block"></span>
          </section>
        </aside>
      </div>

      <div v-else class="lineup-manager-modal__body">
        <section class="lineup-manager-modal__panel lineup-manager-modal__panel--bare">
          <!-- Header row is a SIBLING of the grid (not a grid item) so
               position: sticky anchors cleanly to the modal body's scroll
               viewport. Sticky on grid items inside a CSS grid is
               unreliable because the sticky offset competes with grid
               row tracks. Nested grid here matches the row grid's column
               template so labels align with the cells below. -->
          <div class="lineup-manager-grid__header-row">
            <div class="lineup-manager-grid__header">Order</div>
            <div class="lineup-manager-grid__header">Player</div>
            <div class="lineup-manager-grid__header">Position</div>
          </div>
          <div class="lineup-manager-grid">

            <template v-for="player in starters" :key="player.id">
              <div
                class="lineup-manager-grid__order lineup-manager-grid__order--draggable"
                :class="{
                  'lineup-manager-grid__order--active': draggedPlayerId === player.id,
                  'lineup-manager-grid__order--drop-target': dropTargetId === player.id,
                  'lineup-manager-grid__order--subbed-out': !player.isActive
                }"
                :draggable="isAdmin ? 'true' : 'false'"
                @dragstart="isAdmin && onDragStart($event, player.id)"
                @dragend="onDragEnd"
                @dragover="isAdmin && onDragOver($event, player.id)"
                @drop="isAdmin && moveStarterTo($event, player.id)"
              >
                <span v-if="isAdmin" class="lineup-manager-drag-handle" aria-hidden="true"></span>
                <strong>{{ player.battingOrder }}</strong>
              </div>
              <div
                class="lineup-manager-grid__player"
                :class="{
                  'lineup-manager-grid__player--active': draggedPlayerId === player.id,
                  'lineup-manager-grid__player--drop-target': dropTargetId === player.id,
                  'lineup-manager-grid__player--subbed-out': !player.isActive
                }"
                :draggable="isAdmin ? 'true' : 'false'"
                @dragstart="isAdmin && onDragStart($event, player.id)"
                @dragend="onDragEnd"
                @dragover="isAdmin && onDragOver($event, player.id)"
                @drop="isAdmin && moveStarterTo($event, player.id)"
              >
                <div class="lineup-manager-grid__player-jersey">
                  <img :src="jerseyIcon" alt="" class="lineup-manager-grid__player-icon" />
                  <span class="lineup-manager-grid__player-jersey-number">{{ displayJersey(player.jerseyNumber) }}</span>
                </div>
                <div class="lineup-manager-grid__player-copy">
                  <div class="lineup-manager-grid__player-name">{{ player.playerName }}</div>
                  <div class="lineup-manager-grid__player-meta">
                    <span>{{ playerLinkageLabel(player) }}</span>
                    <span v-if="!player.isActive" class="lineup-manager-grid__subbed-out-chip">
                      {{ starterSubbedOutLabel(player) || 'Subbed out' }}
                    </span>
                  </div>
                </div>
              </div>
              <div
                class="lineup-manager-grid__position"
                :class="{
                  'lineup-manager-grid__position--active': draggedPlayerId === player.id,
                  'lineup-manager-grid__position--drop-target': dropTargetId === player.id,
                  'lineup-manager-grid__position--subbed-out': !player.isActive
                }"
                :draggable="isAdmin ? 'true' : 'false'"
                @dragstart="isAdmin && onDragStart($event, player.id)"
                @dragend="onDragEnd"
                @dragover="isAdmin && onDragOver($event, player.id)"
                @drop="isAdmin && moveStarterTo($event, player.id)"
              >
                <select v-model="player.positionCode" class="lineup-manager-select" :disabled="!isAdmin || !player.isActive">
                  <option v-for="position in availablePositions(player.id)" :key="position.code" :value="position.code">
                    {{ position.code }}
                  </option>
                </select>
                <button v-if="isAdmin" class="lineup-manager-mini" type="button" :disabled="!player.isActive" @click="setPlayerBench(player.id, true)">Bench</button>
              </div>
            </template>
          </div>
        </section>

        <aside class="lineup-manager-modal__aside">
          <section class="lineup-manager-modal__panel lineup-manager-modal__panel--bare">
            <div class="lineup-manager-modal__sectionhead">
              <div>
                <h3>Bench</h3>
              </div>
            </div>

            <div class="lineup-manager-bench">
              <div
                v-for="player in gameRosterPlayers"
                :key="player.id"
                class="lineup-manager-bench__item"
                :class="{
                  'lineup-manager-bench__item--open': expandedBenchPlayerId === player.id,
                  'lineup-manager-bench__item--substitute': player.isSubstitute
                }"
                @click="isAdmin && toggleBenchPlayer(player.id)"
              >
                <div class="lineup-manager-bench__identity">
                  <div class="lineup-manager-bench__avatar">
                    <img v-if="player.imageUrl" :src="player.imageUrl" :alt="player.playerName" />
                    <template v-else>
                      <img :src="jerseyIcon" alt="" class="lineup-manager-bench__jersey-icon" />
                      <span>{{ displayJersey(player.jerseyNumber) }}</span>
                    </template>
                  </div>
                  <div class="lineup-manager-bench__copy">
                    <strong>{{ player.playerName }}</strong>
                    <div class="lineup-manager-bench__meta">
                      <span class="lineup-manager-bench__source">{{ playerLinkageLabel(player) }}</span>
                      <span class="lineup-manager-bench__position">{{ player.positionCode ?? 'EH' }}</span>
                    </div>
                    <p v-if="player.isSubstitute" class="lineup-manager-bench__context">
                      Entered inning {{ player.enteredInning }} for {{ substituteLabel(player.substitutesForId) }}
                    </p>
                  </div>
                </div>
                <button
                  v-if="isAdmin"
                  class="lineup-manager-bench__toggle"
                  type="button"
                  :aria-expanded="expandedBenchPlayerId === player.id"
                  :aria-label="expandedBenchPlayerId === player.id ? `Close ${player.playerName} options` : `Open ${player.playerName} options`"
                  @click.stop="toggleBenchPlayer(player.id)"
                >
                  <span class="lineup-manager-bench__chevron" aria-hidden="true"></span>
                </button>
                <div v-if="isAdmin && expandedBenchPlayerId === player.id" class="lineup-manager-bench__drawer" @click.stop>
                  <div v-if="player.isSubstitute && !substituteDrafts[player.id]" class="lineup-manager-bench__drawer-actions">
                    <button class="lineup-manager-mini lineup-manager-mini--danger" type="button" @click="undoSubstitute(player.id)">Undo sub</button>
                  </div>
                  <div v-else-if="!substituteDrafts[player.id]" class="lineup-manager-bench__drawer-actions">
                    <button class="lineup-manager-mini" type="button" @click="setPlayerBench(player.id, false)">Make starter</button>
                    <button class="lineup-manager-mini" type="button" @click="prepareSubstitute(player.id)">Use as substitute</button>
                  </div>
                </div>
                <div v-if="isAdmin && substituteDrafts[player.id]" class="lineup-manager-substitute" @click.stop>
                  <div class="lineup-manager-substitute__grid">
                    <label>
                      <span>Replacing</span>
                      <select v-model="substituteDrafts[player.id].targetId" class="lineup-manager-select">
                        <option v-for="target in substitutionTargetsFor(player)" :key="target.id" :value="target.id">
                          {{ target.battingOrder }} - {{ target.playerName }}
                        </option>
                      </select>
                    </label>
                    <label>
                      <span>Entered inning</span>
                      <select v-model="substituteDrafts[player.id].inning" class="lineup-manager-select">
                        <option v-for="inning in inningOptions" :key="inning" :value="inning">{{ inning }}</option>
                      </select>
                    </label>
                    <label>
                      <span>Field position</span>
                      <select v-model="substituteDrafts[player.id].positionCode" class="lineup-manager-select">
                        <option v-for="position in fieldPositions" :key="position.code" :value="position.code">
                          {{ position.code }} - {{ position.label }}
                        </option>
                      </select>
                    </label>
                  </div>
                  <div class="lineup-manager-substitute__footer">
                    <button class="lineup-manager-mini" type="button" @click.stop="cancelSubstitute(player.id)">Cancel</button>
                    <button class="lineup-manager-mini lineup-manager-mini--danger" type="button" @click.stop="undoSubstitute(player.id)" v-if="player.isSubstitute">Undo sub</button>
                    <button class="lineup-manager-mini lineup-manager-mini--primary" type="button" @click.stop="applySubstitute(player.id)">{{ player.isSubstitute ? 'Update' : 'Apply sub' }}</button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section class="lineup-manager-modal__panel lineup-manager-modal__panel--bare">
            <div class="lineup-manager-modal__sectionhead">
              <div>
                <h3>Submission Notes</h3>
              </div>
            </div>

            <textarea
              v-model="formNotes"
              class="lineup-manager-notes"
              rows="5"
              :readonly="!isAdmin"
              :placeholder="isAdmin ? 'Add notes for lineup approval or field setup.' : ''"
            />
          </section>
        </aside>
      </div>

    </section>
  </div>
</template>

<style scoped>
.game-lineup-skeleton {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(300px, 0.82fr);
  gap: 18px;
}

/* Status-badge shimmer placeholder for the modal header while the
   lineup fetch is in flight. Sizes are tuned to the real badges:
   base (~"Draft") 60px, --medium (~"10 - 4 OF") 90px, --wide
   (~"10/10 starters") 120px. Height matches the real .status-badge
   (5px + 0.74rem text + 5px ≈ 24px). */
.lineup-manager-modal__badge-skeleton {
  display: inline-block;
  width: 60px;
  height: 24px;
  border-radius: 999px;
}

.lineup-manager-modal__badge-skeleton--medium {
  width: 90px;
}

.lineup-manager-modal__badge-skeleton--wide {
  width: 120px;
}

.game-lineup-skeleton__sectionhead {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 14px;
}

.game-lineup-skeleton__badge {
  width: 92px;
  height: 24px;
  border-radius: 999px;
}

.game-lineup-skeleton__grid {
  display: grid;
  grid-template-columns: 76px minmax(0, 1.4fr) minmax(220px, 1fr) 172px;
  overflow: hidden;
  border: 1px solid rgba(197, 209, 223, 0.72);
  border-radius: 8px;
}

.game-lineup-skeleton__header {
  height: 44px;
  border-radius: 0;
  background: var(--primary-light-3);
}

.game-lineup-skeleton__cell,
.game-lineup-skeleton__player {
  min-height: 72px;
  border-top: 1px solid rgba(197, 209, 223, 0.72);
}

.game-lineup-skeleton__cell {
  align-self: stretch;
  margin: 16px 14px;
  border-radius: 8px;
}

.game-lineup-skeleton__cell--order {
  width: 34px;
  justify-self: center;
}

.game-lineup-skeleton__cell--select {
  width: min(190px, calc(100% - 28px));
}

.game-lineup-skeleton__cell--button {
  width: 72px;
  justify-self: end;
}

.game-lineup-skeleton__player {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
}

.game-lineup-skeleton__jersey {
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  border-radius: 8px;
}

.game-lineup-skeleton__player-copy,
.game-lineup-skeleton__panel-title,
.game-lineup-skeleton__bench-list,
.game-lineup-skeleton__bench-item {
  display: grid;
  gap: 10px;
}

.game-lineup-skeleton__line {
  width: 100%;
  height: 15px;
  border-radius: 8px;
}

.game-lineup-skeleton__line--short {
  width: 68%;
}

.game-lineup-skeleton__line--title {
  width: 150px;
  height: 20px;
}

.game-lineup-skeleton__bench-item {
  padding: 12px 14px;
  border: 1px solid rgba(197, 209, 223, 0.72);
  border-radius: 8px;
}

.game-lineup-skeleton__bench-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.game-lineup-skeleton__mini-button {
  width: 92px;
  height: 36px;
  border-radius: 5px;
}

.game-lineup-skeleton__mini-button--wide {
  width: 126px;
}

.game-lineup-skeleton__notes {
  display: block;
  width: 100%;
  min-height: 140px;
  border-radius: 8px;
}

@media (max-width: 1024px) {
  .game-lineup-skeleton {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .game-lineup-skeleton__grid {
    grid-template-columns: 72px minmax(0, 1fr);
  }

  .game-lineup-skeleton__header:nth-child(3),
  .game-lineup-skeleton__header:nth-child(4),
  .game-lineup-skeleton__cell--select,
  .game-lineup-skeleton__cell--button {
    grid-column: 2;
  }
}
</style>
