<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import AppIcon from './AppIcon.vue'
import TeamAvatar from './TeamAvatar.vue'
import calendarIcon from '../assets/calendar.svg'
import fieldLineIcon from '../assets/field-line.svg'
import type { GameSummary } from '../types'

const props = defineProps<{
  eventId: string
  teamId: string
  tournamentId?: string
  // participationId is required for the standardized scoresheet URL
  // (/event/participation/:participationId/team/:teamId/game/:gameGuid). Optional
  // here so existing callers that haven't been updated still compile, but
  // missing value will degrade the link to an empty-participation path.
  participationId?: string
  teamName: string
  division: string
  game: GameSummary
  // Controls visibility of the 3-dot menu (Game Lineup entry point). The
  // menu is an admin-only affordance; non-admins can click through the
  // card into Game Details for read-only viewing.
  isAdmin?: boolean
}>()
const emit = defineEmits<{
  (event: 'open-lineup', game: GameSummary): void
}>()

const menuOpen = ref(false)
const cardRef = ref<HTMLElement | null>(null)

function normalizeText(value?: string | null) {
  return value?.trim() ?? ''
}

const hasScheduledDateTime = computed(() => {
  return Boolean(normalizeText(props.game.dateLabel) || normalizeText(props.game.timeLabel) || normalizeText(props.game.gameTime))
})

const timeLabel = computed(() => {
  if (props.game.timeLabel && props.game.dateLabel) {
    return `${props.game.timeLabel} - ${props.game.dateLabel}`
  }

  return props.game.timeLabel ?? props.game.gameTime ?? ''
})

const delayLabel = computed(() => {
  const note = props.game.statusNote?.trim() ?? ''
  return /^delayed\b/i.test(note) ? note : ''
})

const rightSummary = computed(() => {
  if (delayLabel.value && props.game.status !== 'live') {
    return delayLabel.value
  }

  if (props.game.status === 'scheduled') {
    return props.game.statusNote ?? 'Match yet to begin'
  }

  return null
})

function normalizeVenueValue(value?: string) {
  const normalized = value?.trim() ?? ''
  if (!normalized) return ''
  if (/^field\s+tbd$/i.test(normalized) || /^tbd$/i.test(normalized)) return ''
  return normalized
}

const displayField = computed(() => normalizeVenueValue(props.game.field))
const displayPark = computed(() => normalizeVenueValue(props.game.facilityLabel))
const fieldVenueLabel = computed(() => {
  const field = displayField.value
  const park = displayPark.value

  if (field && park) return `${field} - ${park}`
  if (field) return field

  return ''
})
const scoresheetLabel = computed(() => {
  if (props.game.scoresheetStatus === 'idle') return 'Scoresheet not started'
  if (props.game.scoresheetStatus === 'review') return 'Scoresheet in review'
  if (props.game.scoresheetStatus === 'mapped') return 'Scoresheet mapped'
  if (props.game.scoresheetStatus === 'published') return 'Scoresheet published'
  return 'Scoresheet uploading'
})

const lineupTone = computed(() => (props.game.lineupSubmitted ? 'success' : 'warning'))

const scoresheetTone = computed(() => {
  if (props.game.scoresheetStatus === 'published' || props.game.scoresheetStatus === 'mapped') return 'success'
  if (props.game.scoresheetStatus === 'review' || props.game.scoresheetStatus === 'uploading') return 'warning'
  return 'neutral'
})

const isFinal = computed(() => props.game.status === 'final')
const teamRows = computed(() => {
  const rows = [
    {
      key: 'opponent',
      name: props.game.opponent,
      imageUrl: props.game.opponentImageUrl,
      seed: props.game.opponentSeed,
      side: props.game.opponentSide,
      score: props.game.scoreAgainst ?? 0,
      won: props.game.opponentWon ?? false
    },
    {
      key: 'team',
      name: props.teamName,
      imageUrl: props.game.teamImageUrl,
      seed: props.game.teamSeed,
      side: props.game.teamSide,
      score: props.game.scoreFor ?? 0,
      won: props.game.teamWon ?? false
    }
  ]

  if (
    isFinal.value &&
    props.game.teamWon == null &&
    props.game.opponentWon == null &&
    props.game.scoreFor !== undefined &&
    props.game.scoreAgainst !== undefined &&
    props.game.scoreFor !== props.game.scoreAgainst
  ) {
    const winningScore = Math.max(props.game.scoreFor, props.game.scoreAgainst)
    rows.forEach((row) => {
      row.won = row.score === winningScore
    })
  }

  return rows.sort((left, right) => {
    if (left.side === right.side) return 0
    if (left.side === 'V') return -1
    if (right.side === 'V') return 1
    return 0
  })
})

function handleDocumentClick(event: MouseEvent) {
  if (!menuOpen.value) return
  const target = event.target as Node | null
  if (cardRef.value?.contains(target)) return
  menuOpen.value = false
}

onMounted(() => {
  document.addEventListener('click', handleDocumentClick)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentClick)
})
</script>

<template>
  <article ref="cardRef" class="boxscore-card">
    <div class="boxscore-card__header">
      <div class="boxscore-card__stack">
        <div class="boxscore-card__topline">
          <div class="boxscore-card__labels">
            <span v-if="game.status === 'live'" class="boxscore-card__live">Live</span>
            <span class="boxscore-card__pool">{{ game.bracketLabel }}</span>
          </div>
        </div>

        <div v-if="hasScheduledDateTime" class="boxscore-card__time">
          <img :src="calendarIcon" alt="" class="boxscore-card__time-icon" />
          <span>{{ timeLabel }}</span>
        </div>
        <div v-else class="boxscore-card__time">
          <img :src="calendarIcon" alt="" class="boxscore-card__time-icon" />
          <span>Not Scheduled</span>
        </div>

        <div v-if="displayField && fieldVenueLabel" class="boxscore-card__field">
          <img :src="fieldLineIcon" alt="" class="boxscore-card__field-icon" />
          <span>{{ fieldVenueLabel }}</span>
        </div>

        <div class="boxscore-card__flags boxscore-card__flags--stacked">
          <span v-if="delayLabel" class="mini-flag" data-state="warning">
            {{ delayLabel }}
          </span>
          <span class="mini-flag" :data-state="lineupTone">
            {{ game.lineupSubmitted ? 'Lineup submitted' : 'Lineup pending' }}
          </span>
          <span class="mini-flag" :data-state="scoresheetTone">{{ scoresheetLabel }}</span>
        </div>
      </div>

      <div class="boxscore-card__actions">
        <span v-if="game.badgeCount !== undefined" class="boxscore-card__count">{{ game.badgeCount }}</span>
        <button v-if="isAdmin" class="ellipsis-button ellipsis-button--sm" type="button" @click.stop="menuOpen = !menuOpen">
          <AppIcon name="ellipsis" :size="16" />
        </button>
      </div>
    </div>

    <div class="boxscore-card__rows" :class="{ 'boxscore-card__rows--scheduled': !!rightSummary }">
      <div v-for="row in teamRows" :key="row.key" class="boxscore-team-row">
        <div class="boxscore-team-row__identity">
          <TeamAvatar :name="row.name" :image-url="row.imageUrl" size="md" />
          <div class="boxscore-team-row__copy">
            <span :class="{ 'boxscore-team-row__winner': row.won }">{{ row.seed ?? '' }}: {{ row.name }}</span>
          </div>
        </div>
        <div v-if="!rightSummary" class="boxscore-team-row__score" :class="{ 'boxscore-team-row__winner': row.won }">
          <span v-if="row.won" class="boxscore-team-row__cup" aria-hidden="true"></span>
          {{ row.score }}
        </div>
      </div>

      <div v-if="rightSummary" class="boxscore-card__column-status">
        {{ rightSummary }}
      </div>
    </div>

    <div v-if="isAdmin && menuOpen" class="menu-panel menu-panel--boxscore">
      <button
        class="menu-link menu-link--button"
        type="button"
        @click="menuOpen = false; emit('open-lineup', game)"
      >
        Lineup
      </button>
    </div>
  </article>
</template>
