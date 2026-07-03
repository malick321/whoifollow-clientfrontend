<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import type { PropType } from 'vue'
import type { FieldConfigPosition, LineupPlayer, TeamMemberOption } from '../types'
import { DEFAULT_SLOW_PITCH_FIELD_POSITIONS } from '../constants/fieldConfig'

const props = defineProps({
  modelValue: {
    type: Array as PropType<LineupPlayer[]>,
    required: true
  },
  teammates: {
    type: Array as PropType<TeamMemberOption[]>,
    default: () => []
  },
  fieldPositions: {
    type: Array as PropType<FieldConfigPosition[]>,
    default: () => DEFAULT_SLOW_PITCH_FIELD_POSITIONS
  },
  showAddRow: {
    type: Boolean,
    default: true
  },
  // Player ids whose name field failed validation on the most recent submit
  // attempt. Used to paint the cell red + render the inline error hint.
  invalidPlayerIds: {
    type: Object as PropType<Set<string>>,
    default: () => new Set<string>()
  },
  // When false, every editing affordance (drag handles, dropdowns, text
  // inputs, Bench toggle, row remove menu, "+ Add player" row) is hidden
  // or disabled. Non-admins still see the full lineup as read-only.
  isAdmin: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits<{
  (event: 'update:modelValue', value: LineupPlayer[]): void
  (event: 'add-manual-player'): void
}>()

const draggedPlayerId = ref<string | null>(null)
const dropTargetId = ref<string | null>(null)
const openMenuPlayerId = ref<string | null>(null)

const orderedPlayers = computed(() =>
  props.modelValue.map((player, index) => ({
    ...player,
    battingOrder: player.battingOrder ?? index + 1,
    teamMemberId: player.teamMemberId ?? null,
    playerSourceType: player.playerSourceType ?? (player.teamMemberId ? 'team_member' : 'manual')
  }))
)

const teammateMap = computed(() => new Map(props.teammates.map((member) => [member.id, member])))

// Dropdown options = the field config's positions + EH (always appended if
// the config doesn't already include it). EH belongs in the picker but NOT
// in the parent's "required starters" count — the parent keeps
// fieldPositions as the pure fielding roster.
const positionOptions = computed<FieldConfigPosition[]>(() => {
  const source = props.fieldPositions.length ? props.fieldPositions : DEFAULT_SLOW_PITCH_FIELD_POSITIONS
  if (source.some((p) => p.code === 'EH')) return source
  return [...source, { code: 'EH', label: 'Extra Hitter', area: 'flex' }]
})

// Set of teammate ids that are already linked to SOME row in the lineup.
// Dropdowns use this to hide teammates that are already taken, so the same
// teammate can't be mapped to multiple batting slots. The row's own current
// selection is always kept visible (see teammateOptionsFor below) so the
// user can see what this row is currently linked to.
const usedTeamMemberIds = computed(() => {
  const used = new Set<string>()
  for (const player of props.modelValue) {
    if (player.teamMemberId) used.add(player.teamMemberId)
  }
  return used
})

// Set of fielding positions currently assigned in the lineup. Used to hide
// taken positions from other rows' dropdowns so the same fielding position
// can't be assigned twice. EH is intentionally excluded — multiple players
// bat as Extra Hitter without taking a fielding slot. Benched players also
// don't hold a position in the field, so their position doesn't reserve
// a slot for the starters.
const usedPositions = computed(() => {
  const used = new Set<string>()
  for (const player of props.modelValue) {
    if (player.status === 'bench') continue
    if (!player.position) continue
    if (player.position === 'EH') continue
    used.add(player.position)
  }
  return used
})

function teammateOptionsFor(currentTeamMemberId: string | null | undefined): TeamMemberOption[] {
  return props.teammates.filter(
    (teammate) =>
      teammate.id === currentTeamMemberId || !usedTeamMemberIds.value.has(teammate.id)
  )
}

function positionOptionsFor(currentPosition: string | null | undefined): FieldConfigPosition[] {
  return positionOptions.value.filter(
    (position) =>
      // Always show EH (infinitely assignable) and the row's own current
      // selection (so the user can see what's picked). Otherwise hide any
      // position already taken by another starter.
      position.code === 'EH' ||
      position.code === currentPosition ||
      !usedPositions.value.has(position.code)
  )
}

function syncBattingOrder(players: LineupPlayer[]) {
  return players.map((player, index) => ({
    ...player,
    battingOrder: index + 1
  }))
}

function emitNext(players: LineupPlayer[]) {
  emit('update:modelValue', syncBattingOrder(players))
}

function updatePlayer(playerId: string, patch: Partial<LineupPlayer>) {
  const next = orderedPlayers.value.map((player) => (player.id === playerId ? { ...player, ...patch } : player))
  emitNext(next)
}

function updateText(playerId: string, field: 'jerseyNumber' | 'name' | 'position', value: string) {
  updatePlayer(playerId, { [field]: value } as Partial<LineupPlayer>)
}

function updateStatus(playerId: string, value: string) {
  updatePlayer(playerId, { status: value as LineupPlayer['status'] })
}

function toggleBench(playerId: string, shouldBench: boolean) {
  updateStatus(playerId, shouldBench ? 'bench' : 'active')
}

function selectValue(event: Event) {
  const target = event.target as HTMLSelectElement | null
  return target?.value ?? ''
}

function inputValue(event: Event) {
  const target = event.target as HTMLInputElement | null
  return target?.value ?? ''
}

function handleTeamMemberChange(playerId: string, rawValue: string) {
  if (!rawValue) {
    updatePlayer(playerId, {
      teamMemberId: null,
      playerSourceType: 'manual'
    })
    return
  }

  const teammate = teammateMap.value.get(rawValue)
  if (!teammate) return

  updatePlayer(playerId, {
    teamMemberId: teammate.id,
    jerseyNumber: teammate.jerseyNumber,
    name: teammate.name,
    position: teammate.defaultPosition,
    playerSourceType: 'team_member'
  })
}

function removePlayer(playerId: string) {
  const next = orderedPlayers.value.filter((player) => player.id !== playerId)
  emitNext(next)
}

function clearLinkedPlayer(playerId: string) {
  updatePlayer(playerId, {
    teamMemberId: null,
    playerSourceType: 'manual'
  })
}

function onDragStart(event: DragEvent, playerId: string) {
  draggedPlayerId.value = playerId
  event.dataTransfer?.setData('text/plain', playerId)
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
  }
}

function onDragEnd() {
  draggedPlayerId.value = null
  dropTargetId.value = null
}

function onDragOver(event: DragEvent, playerId: string) {
  event.preventDefault()
  if (!draggedPlayerId.value || draggedPlayerId.value === playerId) return
  dropTargetId.value = playerId
}

function onDrop(event: DragEvent, playerId: string) {
  event.preventDefault()
  const sourceId = draggedPlayerId.value || event.dataTransfer?.getData('text/plain')
  if (!sourceId || sourceId === playerId) return

  const next = [...orderedPlayers.value]
  const sourceIndex = next.findIndex((player) => player.id === sourceId)
  const targetIndex = next.findIndex((player) => player.id === playerId)
  if (sourceIndex === -1 || targetIndex === -1) return

  const [moved] = next.splice(sourceIndex, 1)
  next.splice(targetIndex, 0, moved)
  emitNext(next)
  onDragEnd()
}

function teammateLabel(teammate: TeamMemberOption) {
  return teammate.name
}

function toggleRowMenu(playerId: string) {
  openMenuPlayerId.value = openMenuPlayerId.value === playerId ? null : playerId
}

function removeLineupPlayer(playerId: string) {
  openMenuPlayerId.value = null
  removePlayer(playerId)
}
</script>

<template>
  <div class="event-lineup-editor">
    <section class="event-lineup-editor__panel">
      <div class="event-lineup-grid">
        <div class="event-lineup-grid__header">Order</div>
        <div class="event-lineup-grid__header">Teammate</div>
        <div class="event-lineup-grid__header">Jersey</div>
        <div class="event-lineup-grid__header">Player Name</div>
        <div class="event-lineup-grid__header">Position</div>
        <div class="event-lineup-grid__header"></div>

        <template v-for="player in orderedPlayers" :key="player.id">
          <div
            class="event-lineup-grid__order"
            :class="{
              'event-lineup-grid__cell--active': draggedPlayerId === player.id,
              'event-lineup-grid__cell--drop-target': dropTargetId === player.id
            }"
            :draggable="isAdmin ? 'true' : 'false'"
            @dragstart="isAdmin && onDragStart($event, player.id)"
            @dragend="onDragEnd"
            @dragover="isAdmin && onDragOver($event, player.id)"
            @drop="isAdmin && onDrop($event, player.id)"
          >
            <span v-if="isAdmin" class="event-lineup-grid__drag-handle" aria-hidden="true"></span>
            <strong class="event-lineup-grid__order-number">{{ player.battingOrder }}</strong>
          </div>

          <div
            class="event-lineup-grid__teammate"
            :class="{
              'event-lineup-grid__cell--active': draggedPlayerId === player.id,
              'event-lineup-grid__cell--drop-target': dropTargetId === player.id
            }"
            @dragover="isAdmin && onDragOver($event, player.id)"
            @drop="isAdmin && onDrop($event, player.id)"
          >
            <select
              :value="player.teamMemberId ?? ''"
              class="event-lineup-select"
              :disabled="!isAdmin"
              @change="handleTeamMemberChange(player.id, selectValue($event))"
            >
              <option value="">Select teammate</option>
              <option
                v-for="teammate in teammateOptionsFor(player.teamMemberId)"
                :key="teammate.id"
                :value="teammate.id"
              >
                {{ teammateLabel(teammate) }}
              </option>
            </select>
            <div class="event-lineup-grid__subrow">
              <div class="event-lineup-grid__meta">
                <span class="event-lineup-grid__source">
                  {{ player.teamMemberId ? 'Linked teammate' : 'Manual player' }}
                </span>
              </div>
              <div class="event-lineup-grid__actions-inline">
                <button
                  v-if="isAdmin && player.teamMemberId"
                  class="event-lineup-grid__link"
                  type="button"
                  @click="clearLinkedPlayer(player.id)"
                >
                  Unlink
                </button>
              </div>
            </div>
          </div>

          <div
            class="event-lineup-grid__jersey"
            :class="{
              'event-lineup-grid__cell--active': draggedPlayerId === player.id,
              'event-lineup-grid__cell--drop-target': dropTargetId === player.id
            }"
            @dragover="isAdmin && onDragOver($event, player.id)"
            @drop="isAdmin && onDrop($event, player.id)"
          >
            <input
              :value="player.jerseyNumber"
              :readonly="!isAdmin"
              @input="updateText(player.id, 'jerseyNumber', inputValue($event))"
            />
          </div>

          <div
            class="event-lineup-grid__player"
            :class="{
              'event-lineup-grid__cell--active': draggedPlayerId === player.id,
              'event-lineup-grid__cell--drop-target': dropTargetId === player.id,
              'event-lineup-grid__player--invalid': invalidPlayerIds.has(player.id)
            }"
            @dragover="isAdmin && onDragOver($event, player.id)"
            @drop="isAdmin && onDrop($event, player.id)"
          >
            <input
              :value="player.name"
              :readonly="!isAdmin"
              @input="updateText(player.id, 'name', inputValue($event))"
            />
            <span v-if="invalidPlayerIds.has(player.id)" class="event-lineup-grid__player-error">
              Player name is required
            </span>
          </div>

          <div
            class="event-lineup-grid__position"
            :class="{
              'event-lineup-grid__cell--active': draggedPlayerId === player.id,
              'event-lineup-grid__cell--drop-target': dropTargetId === player.id
            }"
            @dragover="isAdmin && onDragOver($event, player.id)"
            @drop="isAdmin && onDrop($event, player.id)"
          >
            <select
              :value="player.position"
              class="event-lineup-select"
              :disabled="!isAdmin"
              @change="updateText(player.id, 'position', selectValue($event))"
            >
              <option v-for="position in positionOptionsFor(player.position)" :key="position.code" :value="position.code">
                {{ position.code }}
              </option>
            </select>
          </div>

          <div
            class="event-lineup-grid__row-actions"
            :class="{
              'event-lineup-grid__cell--active': draggedPlayerId === player.id,
              'event-lineup-grid__cell--drop-target': dropTargetId === player.id
            }"
            @dragover="isAdmin && onDragOver($event, player.id)"
            @drop="isAdmin && onDrop($event, player.id)"
          >
            <template v-if="isAdmin">
              <button
                class="lineup-manager-mini"
                :class="{ 'lineup-manager-mini--warning': player.status === 'bench' }"
                type="button"
                :aria-pressed="player.status === 'bench'"
                @click="toggleBench(player.id, player.status !== 'bench')"
              >
                Bench
              </button>
              <button class="ellipsis-button ellipsis-button--sm" type="button" @click.stop="toggleRowMenu(player.id)">
                <AppIcon name="ellipsis" :size="16" />
              </button>
              <div v-if="openMenuPlayerId === player.id" class="event-lineup-grid__menu">
                <button class="event-lineup-grid__menu-link event-lineup-grid__menu-link--danger" type="button" @click="removeLineupPlayer(player.id)">
                  Remove
                </button>
              </div>
            </template>
          </div>

        </template>

        <button v-if="isAdmin && showAddRow" class="event-lineup-grid__add-row" type="button" @click="emit('add-manual-player')">
          + Add player
        </button>
      </div>
    </section>
  </div>
</template>


