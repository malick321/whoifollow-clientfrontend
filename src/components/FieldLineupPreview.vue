<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import FieldIdentityBlock from './FieldIdentityBlock.vue'
import type { FieldConfigPosition } from '../types'

/**
 * Minimal player shape the preview needs. Both `LineupPlayer` (event
 * lineup) and a normalised view of `GameLineupPlayer` (game lineup)
 * conform to this, so a single preview can serve both consumers.
 */
export interface PreviewPlayer {
  id: string
  name: string
  jerseyNumber: string
  position: string
  status: 'active' | 'bench'
}

// Field artwork. Referenced through new URL() so a missing image during
// development doesn't crash the module graph — Vite just serves a 404
// for the asset request and the SVG <image> renders empty.
const fieldImageUrl = new URL('../assets/softball-field.png', import.meta.url).href

const props = withDefaults(defineProps<{
  lineup: PreviewPlayer[]
  fieldPositions: FieldConfigPosition[]
  fieldConfigName: string
  /** Home team — always shown on the right */
  homeTeamName: string
  homeTeamAvatarUrl?: string
  homeTeamMeta?: string
  /** Opponent — when provided, shown beneath the home team in the
      right column. Used by the game-lineup preview to surface the
      matchup without displacing the benched list below. */
  opponentName?: string
  opponentAvatarUrl?: string
  opponentMeta?: string
  /* When true, the right-column roster list splits into two groups —
     "Starters" (active players) and "Benched" (bench players). When
     false (default), only a "Benched" group is shown containing both
     EH + bench players. Game-lineup preview turns this on; event-
     lineup preview leaves it off. */
  groupedRoster?: boolean
  /* When true, pins on the field become draggable, EH starters in the
     off-field list become draggable, and dropping on another pin triggers
     the swap / send-to-EH / cancel conflict dialog. Defaults to false so
     non-admin viewers get a read-only preview. Both modals pass
     `:editable="isAdmin"`. */
  editable?: boolean
}>(), {
  homeTeamAvatarUrl: '',
  homeTeamMeta: '',
  opponentName: '',
  opponentAvatarUrl: '',
  opponentMeta: '',
  groupedRoster: false,
  editable: false
})

const emit = defineEmits<{
  (event: 'close-preview'): void
  /* Fired when the admin completes a drag-drop that resolves into one or
     more position changes. The payload is a flat array of {playerId,
     position} entries that the parent modal applies verbatim to its own
     lineup / draft ref. Never mutates anything itself. */
  (event: 'apply-position-changes', changes: Array<{ playerId: string; position: string }>): void
}>()

// ─── Field positions ────────────────────────────────────────────────────────
// We only paint pins for positions the backend ships with real x/y (and
// `status !== 0`). EH is a batting-only slot with no x/y — those
// players appear in the benched list below the field instead.

type PinRow = {
  code: string
  xAxis: number
  yAxis: number
  starter: PreviewPlayer | null
  displayName: string // "F.Last" when assigned, empty when not
}

/**
 * Format full name as "F.Last":
 *   "John Smith"        → "J.Smith"
 *   "Abdul Rahman Khan" → "A.Khan"  (last token is the family name)
 *   "Jamal"             → "Jamal"   (single token falls back to itself)
 */
function formatPlayerName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  const firstInitial = parts[0].charAt(0).toUpperCase()
  const lastName = parts[parts.length - 1]
  return `${firstInitial}.${lastName}`
}

const pins = computed<PinRow[]>(() => {
  return props.fieldPositions
    .filter((position) => position.status !== 0)
    .filter((position) => typeof position.xAxis === 'number' && typeof position.yAxis === 'number')
    .map((position) => {
      const starter = props.lineup.find(
        (p) => p.status !== 'bench' && p.position === position.code && !!p.name?.trim()
      ) ?? null
      return {
        code: position.code,
        xAxis: position.xAxis as number,
        yAxis: position.yAxis as number,
        starter,
        displayName: starter ? formatPlayerName(starter.name) : ''
      }
    })
})

const assignedCount = computed(() => pins.value.filter((pin) => pin.starter !== null).length)
const totalPositions = computed(() => pins.value.length)

// ─── Roster groupings for the right-column list ─────────────────────────────
// `offFieldPlayers` → the "benched-only" default: EH + bench players (those
//     without a fielding pin on the field image).
// `startersList` / `benchedList` → used when `groupedRoster` is true. Splits
//     the full roster into Starters (active, any position) and Benched
//     (status === 'bench') so the game-lineup preview can show both groups.

type OffFieldEntry = {
  player: PreviewPlayer
  label: 'EH' | 'Bench'
}

const offFieldPlayers = computed<OffFieldEntry[]>(() => {
  const entries: OffFieldEntry[] = []
  for (const player of props.lineup) {
    if (!player.name?.trim()) continue
    if (player.status === 'bench') {
      entries.push({ player, label: 'Bench' })
    } else if (player.position === 'EH') {
      entries.push({ player, label: 'EH' })
    }
  }
  return entries
})

const startersList = computed<PreviewPlayer[]>(() =>
  props.lineup.filter((p) => p.status !== 'bench' && !!p.name?.trim())
)

const benchedList = computed<PreviewPlayer[]>(() =>
  props.lineup.filter((p) => p.status === 'bench' && !!p.name?.trim())
)

// ─── Drag & drop: position swap ─────────────────────────────────────────────
// HTML5 DnD matches the existing pattern used in LineupTable.vue +
// GameLineupSubmissionModal.vue (drag handle + dataTransfer text id +
// onDragOver preventDefault + onDrop reads the id). Works on SVG <g>
// elements in all modern browsers. We never mutate lineup here; the parent
// modal owns the state and receives an `apply-position-changes` payload.

/** Id of the player currently being dragged. Drives visual state on both
 *  the source (dim / "dragging") and drop targets (highlight ring). */
const draggedPlayerId = ref<string | null>(null)

/** Handle to the temporary DOM node used as a custom drag ghost. The
 *  browser's default ghost for an SVG <rect> screenshots the rect's
 *  bounding box (including the field artwork behind it), producing a
 *  cropped-square artefact. We build a clean chip showing the dragged
 *  player's name + jersey instead, so the admin sees WHAT they're
 *  dragging as it follows the cursor. Recreated per drag (so the name
 *  matches the current source) and removed on dragend. */
let activeDragGhost: HTMLDivElement | null = null

/** Build a transient DOM element styled like a dark pill with the
 *  player name (and jersey #, if present). Appended offscreen so the
 *  browser can snapshot it for setDragImage but it doesn't flash in
 *  the viewport. Cleaned up via `removeDragGhost()` on dragend. */
function createDragGhost(label: string, jersey: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'field-preview-drag-ghost'
  const nameNode = document.createElement('span')
  nameNode.className = 'field-preview-drag-ghost__name'
  nameNode.textContent = label
  el.appendChild(nameNode)
  if (jersey) {
    const jerseyNode = document.createElement('span')
    jerseyNode.className = 'field-preview-drag-ghost__jersey'
    jerseyNode.textContent = `#${jersey}`
    el.appendChild(jerseyNode)
  }
  document.body.appendChild(el)
  return el
}

function removeDragGhost(): void {
  if (activeDragGhost && activeDragGhost.parentNode) {
    activeDragGhost.parentNode.removeChild(activeDragGhost)
  }
  activeDragGhost = null
}

/** Position code of the pin currently being hovered as a drop target.
 *  Cleared on dragleave / drop / dragend. */
const dropTargetPositionCode = ref<string | null>(null)

/** Pending swap when the admin drops onto an occupied pin. Null means no
 *  dialog is open. When set, renders the conflict dialog overlay. */
const pendingConflict = ref<{
  draggedId: string
  draggedOriginCode: string
  targetOccupantId: string
  targetCode: string
} | null>(null)

/** Truthy only when the preview is editable AND we currently have a live
 *  drag (source picked, target in flight or just dropped but dialog open).
 *  Used to apply `--dragging` on the source pin. */
function isSource(playerId: string | null): boolean {
  return !!playerId && draggedPlayerId.value === playerId
}

function onPinDragStart(event: DragEvent, playerId: string, originCode: string): void {
  if (!props.editable) return
  draggedPlayerId.value = playerId
  dropTargetPositionCode.value = null
  event.dataTransfer?.setData('text/plain', playerId)
  // Carry the origin so we can distinguish "EH source" from "pin source" at
  // drop time — matters for swap-vs-send-to-EH semantics when the origin
  // is an EH slot rather than a fielded position.
  event.dataTransfer?.setData('application/x-origin-code', originCode)
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    // Replace the default drag ghost — for SVG <rect>, the browser's
    // auto-generated ghost captures the rect's bounding box INCLUDING
    // the painted field behind it, producing a weird cropped-square
    // image. Build a clean HTML pill showing the player's name +
    // jersey so the admin sees what they're dragging without the
    // field-artwork artefact. The element is appended offscreen to
    // `document.body` so the browser can rasterise it for the drag
    // snapshot but it doesn't flash in the viewport.
    const player = props.lineup.find((p) => p.id === playerId)
    if (player) {
      // Match the pin-label format (F.Last) so the drag ghost reads as
      // the same identity the admin sees on the field. Same helper the
      // pins use (formatPlayerName), so a name like "Dylan Melosi"
      // renders as "D.Melosi" both on the pin AND in the dragged chip.
      // This path fires for BOTH pin-to-pin drags AND EH-list drags
      // because both call into onPinDragStart — consistent ghost
      // regardless of drag source.
      const label = player.name ? formatPlayerName(player.name) : playerId
      const jersey = player.jerseyNumber || ''
      removeDragGhost() // defensive: clear any leftover from a prior drag
      activeDragGhost = createDragGhost(label, jersey)
      // Offset halfway into the chip so the cursor sits near the chip's
      // leading edge — feels attached to the pointer rather than floating
      // off to the side.
      event.dataTransfer.setDragImage(activeDragGhost, 16, 16)
    }
  }
}

function onPinDragEnd(): void {
  draggedPlayerId.value = null
  dropTargetPositionCode.value = null
  removeDragGhost()
}

function onPinDragOver(event: DragEvent, targetCode: string): void {
  if (!props.editable) return
  if (!draggedPlayerId.value) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dropTargetPositionCode.value = targetCode
}

function onPinDragLeave(targetCode: string): void {
  if (dropTargetPositionCode.value === targetCode) {
    dropTargetPositionCode.value = null
  }
}

function onPinDrop(event: DragEvent, targetPin: PinRow): void {
  if (!props.editable) return
  event.preventDefault()
  const draggedId = event.dataTransfer?.getData('text/plain') || draggedPlayerId.value
  const originCode = event.dataTransfer?.getData('application/x-origin-code') || ''
  dropTargetPositionCode.value = null
  draggedPlayerId.value = null
  if (!draggedId) return
  // Same-pin drop: treat as cancel.
  if (originCode === targetPin.code) return

  if (targetPin.starter) {
    // Occupied: open the conflict dialog. The dialog controls the final
    // apply-position-changes emission.
    pendingConflict.value = {
      draggedId,
      draggedOriginCode: originCode || 'EH',
      targetOccupantId: targetPin.starter.id,
      targetCode: targetPin.code
    }
    return
  }

  // Empty target: straight move.
  emit('apply-position-changes', [{ playerId: draggedId, position: targetPin.code }])
}

/** Apply the user's choice from the conflict dialog. */
function resolveConflict(action: 'swap' | 'send-to-eh'): void {
  const c = pendingConflict.value
  if (!c) return
  pendingConflict.value = null
  if (action === 'swap') {
    emit('apply-position-changes', [
      { playerId: c.draggedId, position: c.targetCode },
      { playerId: c.targetOccupantId, position: c.draggedOriginCode }
    ])
  } else {
    emit('apply-position-changes', [
      { playerId: c.draggedId, position: c.targetCode },
      { playerId: c.targetOccupantId, position: 'EH' }
    ])
  }
}

function cancelConflict(): void {
  pendingConflict.value = null
}

// Resolve the pending conflict payload into display strings for the dialog.
const conflictOccupantName = computed<string>(() => {
  const c = pendingConflict.value
  if (!c) return ''
  return props.lineup.find((p) => p.id === c.targetOccupantId)?.name ?? ''
})

const conflictOccupantFirstName = computed<string>(() => {
  const fullName = conflictOccupantName.value
  if (!fullName) return 'them'
  return fullName.trim().split(/\s+/)[0] || fullName
})

// Close the dialog on Escape — parity with standard modal behaviour.
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && pendingConflict.value) {
    event.stopPropagation()
    cancelConflict()
  }
}

onMounted(() => {
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', onKeydown)
  }
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', onKeydown)
  }
  // Defensive: if the component unmounts mid-drag (e.g. user closed the
  // preview with dragend about to fire), nuke any lingering ghost node
  // so it doesn't orphan in document.body.
  removeDragGhost()
})
</script>

<template>
  <div class="event-lineup-preview">
    <!-- Close Preview toolbar: a full-width green strip that wraps the
         Close Preview pill. Sticky on mobile so the CTA stays visible
         + legible as the stacked content scrolls underneath (the solid
         green background fully occludes the field image / pins that
         would otherwise bleed through a transparent row). -->
    <div class="event-lineup-preview__toolbar">
      <button
        type="button"
        class="event-lineup-preview__close-cta"
        @click="emit('close-preview')"
      >
        <AppIcon name="close" :size="14" />
        <span>Close Preview</span>
      </button>
    </div>

    <!-- Stage: three-column layout on wide viewports. Left column is a
         slot so each consumer (event-lineup vs game-lineup) can fill it
         with their own meta content. Narrow viewports collapse to a
         single stacked column. -->
    <div class="event-lineup-preview__stage">

      <!-- LEFT COLUMN: consumer-provided (event meta OR game meta). -->
      <aside class="event-lineup-preview__event-meta">
        <slot name="left-column" />
      </aside>

      <!-- SVG field. Coordinates are calibrated against a 460 × 360
           landscape reference frame; viewBox `0 -50 460 460` centres
           the 0..360 y-range inside a square viewBox so the 1:1
           painted-field image fits undistorted AND pins land on the
           painted bases. See FieldLineupPreview coord-math notes. -->
      <div class="event-lineup-preview__field-frame">
        <!-- Info caption stack — centered at the top of the field frame.
             Line 1: field-config name · X/N filled (always visible).
             Line 2: drag hint (only when editable). Stacked flush with
             no gap per design. Wrapper handles the absolute positioning
             so both lines share one anchor point. -->
        <div class="event-lineup-preview__info-stack">
          <div class="event-lineup-preview__info-chip">
            <span class="event-lineup-preview__info-chip-name">{{ fieldConfigName }}</span>
            <span class="event-lineup-preview__info-chip-sep">·</span>
            <span class="event-lineup-preview__info-chip-count">
              {{ assignedCount }}/{{ totalPositions }} filled
            </span>
          </div>
          <div v-if="editable" class="event-lineup-preview__info-hint">
            Drag &amp; drop to reposition players
          </div>
        </div>

        <svg
          class="event-lineup-preview__field-svg"
          viewBox="0 -50 460 460"
          preserveAspectRatio="xMidYMid meet"
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          :aria-label="`${fieldConfigName} field preview`"
        >
          <image
            :href="fieldImageUrl"
            x="0" y="-50"
            width="460" height="460"
            preserveAspectRatio="xMidYMid meet"
          />

          <!-- See the EventLineupFieldPreview history for why this sits
               on a real element (Vue 2 can't key a <template v-for>).
               When `editable` is true, assigned pins become drag sources
               (admin drags a starter off this pin) and every pin becomes
               a drop target (the drag lands here to move/swap). -->
          <!-- Two-element-per-pin structure when editable:
               * Outer <g> = drop target (dragover / dragleave / drop
                 + drop-target highlight class).
               * Inner <rect> on assigned pins = drag source (the element
                 that carries `draggable="true"` and fires dragstart).
                 SVG <g> drag support is unreliable in some browsers —
                 <rect> is the safest SVG element for HTML5 DnD. -->
          <g
            v-for="pin in pins"
            :key="`pin-${pin.code}`"
            :transform="`translate(${pin.xAxis}, ${pin.yAxis})`"
            :class="{
              'event-lineup-preview__assigned': !!pin.starter,
              'event-lineup-preview__pin': !pin.starter,
              'event-lineup-preview__pin--unassigned': !pin.starter,
              'event-lineup-preview__assigned--draggable': editable && !!pin.starter,
              'event-lineup-preview__assigned--dragging': editable && !!pin.starter && isSource(pin.starter.id),
              'event-lineup-preview__pin--drop-target': editable && dropTargetPositionCode === pin.code
            }"
            @dragover="onPinDragOver($event, pin.code)"
            @dragleave="onPinDragLeave(pin.code)"
            @drop="onPinDrop($event, pin)"
          >
            <template v-if="pin.starter">
              <!-- Invisible drag-handle rect for assigned pins. Covers
                   the player label area. The rect (not the surrounding
                   <g>) carries `draggable="true"` + @dragstart because
                   SVG <rect> is reliably draggable across browsers
                   whereas <g> support is flaky. Pointer-events on the
                   text nodes are disabled via CSS so mousedown falls
                   through to this rect instead of starting a text
                   selection. -->
              <rect
                v-if="editable"
                class="event-lineup-preview__assigned-handle"
                x="-44"
                y="-12"
                width="88"
                height="34"
                fill="transparent"
                draggable="true"
                @dragstart="onPinDragStart($event, pin.starter.id, pin.code)"
                @dragend="onPinDragEnd"
              />
              <text
                class="event-lineup-preview__assigned-text"
                text-anchor="middle"
              >
                <tspan x="0" dy="0">{{ pin.displayName }}</tspan>
                <tspan
                  v-if="pin.starter.jerseyNumber"
                  x="0"
                  dy="1.15em"
                  class="event-lineup-preview__assigned-jersey"
                >#{{ pin.starter.jerseyNumber }}</tspan>
              </text>
            </template>
            <template v-else>
              <circle class="event-lineup-preview__pin-circle" r="13" />
              <text class="event-lineup-preview__pin-code" text-anchor="middle" dominant-baseline="middle">
                {{ pin.code }}
              </text>
            </template>
          </g>
        </svg>
      </div>

      <!-- RIGHT COLUMN: home team identity at top, optional opponent
           beneath it, "Benched" list at bottom. Flex column with
           space-between so team/opponent cluster at the top and the
           benched list drops to the bottom. -->
      <aside class="event-lineup-preview__team-meta">
        <div class="event-lineup-preview__team-head">
          <FieldIdentityBlock
            :name="homeTeamName"
            :avatar-url="homeTeamAvatarUrl"
            :meta="homeTeamMeta"
            size="md"
            variant="primary"
          />
          <div v-if="opponentName" class="event-lineup-preview__opponent">
            <span class="event-lineup-preview__vs-label">vs</span>
            <!-- Avatar hidden on the opponent block — too noisy next to
                 our own team identity above. Just the name (+ optional
                 meta) is enough to communicate the matchup. -->
            <FieldIdentityBlock
              :name="opponentName"
              :meta="opponentMeta"
              size="sm"
              variant="secondary"
              hide-avatar
            />
          </div>
        </div>

        <!-- Grouped (game-lineup) layout: Starters + Benched sections.
             Wrapped in a `.roster-groups` container so the two lists
             stay clustered at the BOTTOM of the team-meta column (the
             outer column uses `justify-content: space-between` — team
             identity pins to the top, this wrapper pins to the bottom)
             with a fixed 20px gap between the two sections. -->
        <div v-if="groupedRoster" class="event-lineup-preview__roster-groups">
          <div v-if="startersList.length > 0" class="event-lineup-preview__offfield">
            <span class="event-lineup-preview__offfield-title event-lineup-preview__offfield-title--starters">Starters</span>
            <ul class="event-lineup-preview__offfield-list">
              <li
                v-for="player in startersList"
                :key="`starter-${player.id}`"
                class="event-lineup-preview__offfield-row"
                :class="{
                  'event-lineup-preview__offfield-row--draggable': editable && player.position === 'EH',
                  'event-lineup-preview__offfield-row--dragging': editable && isSource(player.id)
                }"
                :draggable="editable && player.position === 'EH' ? 'true' : 'false'"
                @dragstart="player.position === 'EH' && onPinDragStart($event, player.id, 'EH')"
                @dragend="onPinDragEnd"
              >
                <span
                  class="event-lineup-preview__offfield-position"
                  :class="{ 'event-lineup-preview__offfield-position--eh': player.position === 'EH' }"
                >
                  {{ player.position || '—' }}
                </span>
                <span v-if="player.jerseyNumber" class="event-lineup-preview__offfield-jersey">
                  #{{ player.jerseyNumber }}
                </span>
                <span class="event-lineup-preview__offfield-name">{{ player.name }}</span>
              </li>
            </ul>
          </div>
          <div v-if="benchedList.length > 0" class="event-lineup-preview__offfield">
            <span class="event-lineup-preview__offfield-title">Benched</span>
            <ul class="event-lineup-preview__offfield-list">
              <li
                v-for="player in benchedList"
                :key="`bench-${player.id}`"
                class="event-lineup-preview__offfield-row"
              >
                <span class="event-lineup-preview__offfield-position">
                  {{ player.position || '—' }}
                </span>
                <span v-if="player.jerseyNumber" class="event-lineup-preview__offfield-jersey">
                  #{{ player.jerseyNumber }}
                </span>
                <span class="event-lineup-preview__offfield-name">{{ player.name }}</span>
              </li>
            </ul>
          </div>
        </div>

        <!-- Default (event-lineup) layout: single "Benched" section with
             EH + bench mixed together. EH entries get the draggable
             treatment; bench entries don't (per v1 scope — bench is
             intentionally non-draggable). -->
        <div v-else-if="offFieldPlayers.length > 0" class="event-lineup-preview__offfield">
          <span class="event-lineup-preview__offfield-title">Benched</span>
          <ul class="event-lineup-preview__offfield-list">
            <li
              v-for="entry in offFieldPlayers"
              :key="`off-${entry.player.id}`"
              class="event-lineup-preview__offfield-row"
              :class="{
                'event-lineup-preview__offfield-row--draggable': editable && entry.label === 'EH',
                'event-lineup-preview__offfield-row--dragging': editable && isSource(entry.player.id)
              }"
              :draggable="editable && entry.label === 'EH' ? 'true' : 'false'"
              @dragstart="entry.label === 'EH' && onPinDragStart($event, entry.player.id, 'EH')"
              @dragend="onPinDragEnd"
            >
              <span
                class="event-lineup-preview__offfield-position"
                :class="{ 'event-lineup-preview__offfield-position--eh': entry.label === 'EH' }"
              >
                {{ entry.player.position || '—' }}
              </span>
              <span v-if="entry.player.jerseyNumber" class="event-lineup-preview__offfield-jersey">
                #{{ entry.player.jerseyNumber }}
              </span>
              <span class="event-lineup-preview__offfield-name">{{ entry.player.name }}</span>
            </li>
          </ul>
        </div>
      </aside>

    </div><!-- /.stage -->

    <!-- Conflict dialog: drawn on top of the preview when a drag lands
         on an already-occupied pin. Admin picks Swap, Send to EH, or
         Cancel. Backdrop click also cancels. Escape key is wired up via
         the window-level onKeydown listener above. -->
    <div
      v-if="pendingConflict"
      class="field-preview-conflict-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="field-preview-conflict-title"
      @click.self="cancelConflict"
    >
      <div class="field-preview-conflict-dialog__card">
        <h3 id="field-preview-conflict-title" class="field-preview-conflict-dialog__title">
          Position already filled
        </h3>
        <p class="field-preview-conflict-dialog__body">
          <strong>{{ conflictOccupantName || 'The current occupant' }}</strong>
          is currently at <strong>{{ pendingConflict.targetCode }}</strong>.
          What would you like to do?
        </p>
        <div class="field-preview-conflict-dialog__actions">
          <button
            type="button"
            class="field-preview-conflict-dialog__btn field-preview-conflict-dialog__btn--primary"
            @click="resolveConflict('swap')"
          >
            Swap positions
          </button>
          <button
            type="button"
            class="field-preview-conflict-dialog__btn field-preview-conflict-dialog__btn--secondary"
            @click="resolveConflict('send-to-eh')"
          >
            Send {{ conflictOccupantFirstName }} to EH
          </button>
          <button
            type="button"
            class="field-preview-conflict-dialog__btn field-preview-conflict-dialog__btn--cancel"
            @click="cancelConflict"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
