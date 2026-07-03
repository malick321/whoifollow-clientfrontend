<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import LineupTable from './LineupTable.vue'
import StatusBadge from './StatusBadge.vue'
import FieldLineupPreview from './FieldLineupPreview.vue'
import { fetchEventLineup, saveEventLineup } from '../api/eventLineup'
import { pushToast } from '../toast-center'
import { DEFAULT_SLOW_PITCH_FIELD_POSITIONS } from '../constants/fieldConfig'
import { lockBodyScroll, unlockBodyScroll } from '../body-scroll-lock'
import type { FieldConfigPosition, LineupPlayer, TeamMemberOption } from '../types'

const props = withDefaults(defineProps<{
  modelValue: boolean
  participationId: string
  teamName: string
  eventName: string
  eventDate: string
  division?: string
  /* Team meta — shown in the right column of the preview alongside the
     team name, rendered in the "<age-group> <rating> - City, State"
     format used on the participation hero. All optional; missing bits
     collapse out of the display string. */
  teamAvatarUrl?: string
  teamAgeGroup?: string
  teamRating?: string
  teamCity?: string
  teamState?: string
  participationStatusLabel?: string
  participationStatusTone?: string
  fieldConfigName?: string | null
  fieldConfigPositions?: FieldConfigPosition[]
  teammates?: TeamMemberOption[]
  isAdmin?: boolean
}>(), {
  division: '',
  teamAvatarUrl: '',
  teamAgeGroup: '',
  teamRating: '',
  teamCity: '',
  teamState: '',
  fieldConfigPositions: () => [],
  teammates: () => [],
  isAdmin: false
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'saved', lineup: LineupPlayer[]): void
}>()

const loading = ref(false)
const loadError = ref('')
const saving = ref(false)
const lineup = ref<LineupPlayer[]>([])
const bodyRef = ref<HTMLElement | null>(null)

// Preview mode flag — when true, the modal body swaps from the editable
// LineupTable to the read-only field-placement preview. Admin-only UI
// toggle; resets to false whenever the popup is re-opened so users don't
// land back in the preview if they dismissed the modal mid-preview.
const previewMode = ref(false)
// Player ids flagged by the last submit attempt for having an empty name.
// Rendered as red borders + inline error text in LineupTable. Cleared per-row
// as the user types a non-empty name into a previously invalid field.
const invalidPlayerIds = ref<Set<string>>(new Set())

// Field config fetched alongside the event lineup itself. The GET/PATCH
// /tournaments/event-lineup/ endpoint returns `field_config` on the same
// payload as `lineup`; when present it drives the per-player position
// dropdown. When the endpoint returns no field_config we fall back first
// to the prop (passed from ParticipationV2) and finally to the client's
// DEFAULT_SLOW_PITCH_FIELD_POSITIONS so the modal is always usable.
const fetchedFieldConfigName = ref<string | null>(null)
const fetchedFieldPositions = ref<FieldConfigPosition[]>([])

// Positions that define the STARTING field (drives `requiredPlayers` and the
// "x/N starters" badge). EH is deliberately NOT appended here — it's a
// batting-only slot that doesn't reserve a fielding spot. LineupTable adds
// EH to its dropdown separately so users can always pick it.
const fieldPositions = computed<FieldConfigPosition[]>(() => {
  if (fetchedFieldPositions.value.length) return fetchedFieldPositions.value
  if (props.fieldConfigPositions?.length) return props.fieldConfigPositions
  return DEFAULT_SLOW_PITCH_FIELD_POSITIONS
})

const displayFieldConfigName = computed<string>(() =>
  fetchedFieldConfigName.value ?? props.fieldConfigName ?? 'Slow Pitch 10 Player'
)
const requiredPlayers = computed(() => fieldPositions.value.length)
const filledPlayers = computed(
  () => lineup.value.filter((p) => p.status !== 'bench' && !!p.name.trim()).length
)
const playerBadgeTone = computed(() => (filledPlayers.value >= requiredPlayers.value ? 'success' : 'warning'))
const statusBadgeTone = computed(
  (): 'success' | 'warning' | 'info' | 'danger' | 'neutral' | 'primary' =>
    (props.participationStatusTone as 'success' | 'warning' | 'info' | 'danger' | 'neutral' | 'primary') ?? 'info'
)

watch(
  () => props.modelValue,
  (open, wasOpen) => {
    if (open) {
      void load()
      // Default to edit mode on every open.
      previewMode.value = false
    } else {
      // Leaving the popup resets any previous validation state so the next
      // open starts clean.
      invalidPlayerIds.value = new Set()
    }
    // Lock the page scroll behind the modal while it's open — otherwise
    // the popup scroll bleeds into the page scroll and the user ends up
    // on a different part of the participation page when they close it.
    // Paired unlock on close OR on unmount (guards against the component
    // being torn down mid-open, e.g. during a route change).
    if (open && !wasOpen) lockBodyScroll()
    else if (!open && wasOpen) unlockBodyScroll()
  }
)

onBeforeUnmount(() => {
  // If we unmount while still open (route change, parent v-if flip, etc.)
  // make sure we release the scroll lock so the page remains usable.
  if (props.modelValue) unlockBodyScroll()
})

// Preview is only meaningful when we actually have x/y data. Hide the
// toggle if every position in fieldPositions is missing coordinates.
const hasFieldCoordinates = computed(() =>
  fieldPositions.value.some(
    (position) => typeof position.xAxis === 'number' && typeof position.yAxis === 'number'
  )
)

/* Snap the modal body's scroll back to the top whenever preview mode
   becomes active. Matters on mobile (≤720 px) where the body becomes a
   vertical scroll container — without this the body carries its
   previous edit-mode scroll position into preview mode and the user
   lands halfway down the stacked content. No-op on desktop/tablet
   (body doesn't scroll). */
watch(previewMode, async (open) => {
  if (!open) return
  await nextTick()
  bodyRef.value?.scrollTo({ top: 0 })
})

/**
 * Hero-style meta string: "<age-group> <rating> - City, State".
 * Pre-formatted here so the shared FieldLineupPreview stays agnostic
 * to age/rating/city/state and only cares about a rendered caption.
 */
const homeTeamMeta = computed(() => {
  const left = [props.teamAgeGroup, props.teamRating].filter(Boolean).join(' ')
  const right = [props.teamCity, props.teamState].filter(Boolean).join(', ')
  if (left && right) return `${left} - ${right}`
  return left || right
})

function togglePreview() {
  previewMode.value = !previewMode.value
}

/**
 * Apply position changes emitted by the interactive field preview.
 * The preview never mutates `lineup` itself — it just describes what
 * should change as a flat array of {playerId, position} entries (one
 * entry for a plain move, two for a swap or send-to-EH). We walk the
 * array and patch each matched player's `position` in place so Vue's
 * reactivity picks up the update. Status is intentionally left alone —
 * bench players can't be drag sources in the preview, so we never have
 * to flip them back to active here.
 */
function handleApplyPositionChanges(changes: Array<{ playerId: string; position: string }>): void {
  if (!changes.length) return
  for (const change of changes) {
    const player = lineup.value.find((p) => p.id === change.playerId)
    if (player) player.position = change.position
  }
}

// Clear per-row invalid flags as soon as the user types a non-empty name
// into a previously invalid row. No reason to keep the red border after the
// field is valid again.
watch(
  lineup,
  (next) => {
    if (invalidPlayerIds.value.size === 0) return
    const updated = new Set(invalidPlayerIds.value)
    let changed = false
    for (const player of next) {
      if (updated.has(player.id) && player.name && player.name.trim()) {
        updated.delete(player.id)
        changed = true
      }
    }
    if (changed) invalidPlayerIds.value = updated
  },
  { deep: true }
)

function buildSeededLineupFromTeammates(): LineupPlayer[] {
  // First-time submit: default every row to "EH" (Extra Hitter). The
  // manager then explicitly assigns fielding positions before saving.
  // Editing an existing lineup (the `else` branch in load()) keeps each
  // row's stored position as-is.
  return props.teammates
    .filter((member) => member.isPlayer ?? true)
    .map((member, index) => ({
      id: `seeded-${member.id}`,
      battingOrder: index + 1,
      teamMemberId: member.id,
      userId: member.userId ?? null,
      jerseyNumber: member.jerseyNumber,
      name: member.name,
      position: 'EH',
      status: member.status,
      playerSourceType: 'team_member' as const,
      imageUrl: member.imageUrl
    }))
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const result = await fetchEventLineup(props.participationId)
    fetchedFieldConfigName.value = result.fieldConfigName
    fetchedFieldPositions.value = result.fieldConfigPositions
    // First-time flow: the backend returns an empty lineup when no event
    // lineup has been submitted yet. Pre-seed one row per player teammate
    // so the manager sees their roster already dropped into batting order
    // slots — they can save as-is, reorder, or edit individual rows.
    if (result.lineup.length === 0 && props.teammates.length > 0) {
      lineup.value = buildSeededLineupFromTeammates()
    } else {
      lineup.value = result.lineup
    }
  } catch (error) {
    lineup.value = []
    fetchedFieldConfigName.value = null
    fetchedFieldPositions.value = []
    loadError.value = error instanceof Error ? error.message : 'The event lineup could not be loaded.'
    pushToast({ tone: 'warning', title: 'Unable to load lineup', message: loadError.value })
  } finally {
    loading.value = false
  }
}

function close() {
  emit('update:modelValue', false)
}

function addPlayer() {
  lineup.value = [
    ...lineup.value,
    {
      id: `manual-${Date.now()}`,
      battingOrder: lineup.value.length + 1,
      teamMemberId: null,
      jerseyNumber: '',
      name: '',
      position: 'EH',
      status: 'active',
      playerSourceType: 'manual'
    }
  ]
  // Scroll the popup body to the bottom so the newly added row and the
  // "+ Add player" affordance both remain in view. Runs after Vue has
  // rendered the new row, so the up-to-date scrollHeight is measured.
  void nextTick(() => {
    const body = bodyRef.value
    if (!body) return
    body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' })
  })
}

async function save() {
  // Block submit if any row has a blank player name. Flag the offending rows
  // so LineupTable can paint their inputs red and show the "Player name is
  // required" inline hint.
  const missingNameIds = new Set<string>()
  for (const player of lineup.value) {
    if (!player.name || !player.name.trim()) {
      missingNameIds.add(player.id)
    }
  }
  if (missingNameIds.size > 0) {
    // Inline error hints on each invalid row already tell the user what to
    // fix — no toast needed on top of that.
    invalidPlayerIds.value = missingNameIds
    return
  }
  invalidPlayerIds.value = new Set()

  saving.value = true
  try {
    const result = await saveEventLineup(props.participationId, lineup.value)
    lineup.value = result.lineup
    // PATCH response carries the same field_config — keep our local copy in
    // sync so the dropdown list doesn't drift after a save.
    fetchedFieldConfigName.value = result.fieldConfigName
    fetchedFieldPositions.value = result.fieldConfigPositions
    emit('saved', result.lineup)
    pushToast({ tone: 'success', title: 'Lineup submitted', message: 'The event lineup was saved successfully.' })
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Unable to submit lineup',
      message: error instanceof Error ? error.message : 'Something went wrong while saving the event lineup.'
    })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div v-if="modelValue" class="modal-backdrop" @click.self="close">
    <section
      class="modal-card event-lineup-modal"
      :class="{ 'event-lineup-modal--previewing': previewMode }"
    >
      <!-- Header is hidden entirely in preview mode — the preview body
           shows the event meta (left column) and team name (right column)
           itself, and the "Close Preview" CTA handles return to edit. -->
      <header v-if="!previewMode" class="modal-card__header event-lineup-modal__header">
        <div class="event-lineup-modal__title-block">
          <div class="event-lineup-modal__title-row">
            <h2>{{ teamName }}</h2>
            <div v-if="!loading" class="event-lineup-modal__title-badges">
              <StatusBadge
                v-if="participationStatusLabel"
                :label="participationStatusLabel"
                :tone="statusBadgeTone"
              />
              <StatusBadge :label="displayFieldConfigName" tone="info" />
              <StatusBadge
                :label="`${filledPlayers}/${requiredPlayers} starters`"
                :tone="playerBadgeTone"
              />
            </div>
            <!-- Shimmer placeholders while the event lineup + field config
                 are being fetched. Widths approximate the real badges so
                 the header row doesn't jump when data arrives. -->
            <div v-else class="event-lineup-modal__title-badges">
              <span class="event-lineup-modal__badge-skeleton shimmer-block"></span>
              <span class="event-lineup-modal__badge-skeleton event-lineup-modal__badge-skeleton--medium shimmer-block"></span>
              <span class="event-lineup-modal__badge-skeleton event-lineup-modal__badge-skeleton--wide shimmer-block"></span>
            </div>
          </div>
          <p class="event-lineup-modal__subtitle">{{ eventName }} {{ eventDate }}</p>
        </div>
        <div class="event-lineup-modal__header-actions">
          <!-- Admin-only Preview toggle. Hidden when the fetched field_config
               carries no x/y coordinates (preview would be an empty field).
               While in preview mode the button disappears entirely — the
               "Close Preview" pill inside the green stage handles return
               to edit, so we don't need a second affordance in the header. -->
          <button
            v-if="isAdmin && hasFieldCoordinates && !previewMode"
            class="secondary-button"
            type="button"
            :disabled="loading"
            @click="togglePreview"
          >
            Preview
          </button>
          <button v-if="isAdmin" class="primary-button" type="button" :disabled="saving || loading || previewMode" @click="save">
            {{ saving ? 'Submitting Lineup...' : 'Submit Lineup' }}
          </button>
          <button class="ellipsis-button ellipsis-button--close" type="button" @click="close">
            <AppIcon name="close" :size="16" />
          </button>
        </div>
      </header>

      <div ref="bodyRef" class="event-lineup-modal__body" :class="{ 'event-lineup-modal__body--preview': previewMode }">
        <template v-if="loading">
          <div class="event-lineup-modal__info-box event-lineup-modal__info-box--skeleton">
            <span class="shimmer-block event-lineup-skeleton__info-line"></span>
          </div>

          <div class="event-lineup-skeleton__grid" aria-hidden="true">
            <span v-for="n in 6" :key="`skel-h-${n}`" class="shimmer-block event-lineup-skeleton__header"></span>
            <template v-for="row in 10" :key="`skel-r${row}`">
              <span class="shimmer-block event-lineup-skeleton__cell event-lineup-skeleton__cell--order"></span>
              <span class="shimmer-block event-lineup-skeleton__cell"></span>
              <span class="shimmer-block event-lineup-skeleton__cell event-lineup-skeleton__cell--narrow"></span>
              <span class="shimmer-block event-lineup-skeleton__cell"></span>
              <span class="shimmer-block event-lineup-skeleton__cell event-lineup-skeleton__cell--narrow"></span>
              <span class="shimmer-block event-lineup-skeleton__cell event-lineup-skeleton__cell--narrow"></span>
            </template>
          </div>
        </template>

        <template v-else>
          <!-- Preview mode: read-only SVG field with pins.
               Left column slot renders the event meta (name + division
               + dates). Home team identity is always on the right;
               there's no opponent here (event-level preview). -->
          <FieldLineupPreview
            v-if="previewMode"
            :lineup="lineup"
            :field-positions="fieldPositions"
            :field-config-name="displayFieldConfigName"
            :home-team-name="teamName"
            :home-team-avatar-url="teamAvatarUrl"
            :home-team-meta="homeTeamMeta"
            grouped-roster
            :editable="isAdmin"
            @close-preview="previewMode = false"
            @apply-position-changes="handleApplyPositionChanges"
          >
            <template #left-column>
              <h3 class="event-lineup-preview__event-name">{{ eventName }}</h3>
              <p v-if="division" class="event-lineup-preview__event-division">{{ division }}</p>
              <p class="event-lineup-preview__event-date">{{ eventDate }}</p>
            </template>
          </FieldLineupPreview>

          <!-- Edit mode: the existing editor. -->
          <template v-else>
            <div class="event-lineup-modal__info-box">
              <span v-if="loadError">{{ loadError }}</span>
              <span v-else>Set the event-level batting order, link teammates when available, and keep manual players available for scoresheet continuity.</span>
            </div>

            <LineupTable
              :model-value="lineup"
              :teammates="teammates"
              :field-positions="fieldPositions"
              :invalid-player-ids="invalidPlayerIds"
              :is-admin="isAdmin"
              @update:modelValue="lineup = $event"
              @add-manual-player="addPlayer"
            />
          </template>
        </template>
      </div>
    </section>
  </div>
</template>
