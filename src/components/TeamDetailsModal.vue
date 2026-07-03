<script setup lang="ts">
// TeamDetailsModal
// ----------------
// Slide-in modal opened by clicking a team row. Shows the team's
// registration card on top (system + external reg #, status pill,
// name, division, manager, valid-thru date) and is a placeholder
// for additional team-info sections that will land later.

import { computed, ref, watch } from 'vue'
import SlideModal from './SlideModal.vue'
import StatusBadge from './StatusBadge.vue'
import { fetchTeamEvents } from '../api/officialEvents'
import {
  reactivateAssociationTeam,
  renewAssociationTeam,
  suspendAssociationTeam
} from '../api/associationTeams'
import { pushToast } from '../toast-center'
import type {
  AssociationTeam,
  AssociationTeamStatus,
  OfficialEvent
} from '../types'

const props = defineProps<{
  modelValue: boolean
  team?: AssociationTeam | null
  associationShortName?: string
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'team-updated', team: AssociationTeam): void
}>()

const acting = ref(false)

async function onRenew() {
  if (!props.team || acting.value) return
  acting.value = true
  try {
    const updated = await renewAssociationTeam(
      props.associationShortName ?? '',
      props.team.id,
      { neverExpires: true }
    )
    emit('team-updated', updated)
    pushToast({
      tone: 'success',
      title: 'Registration renewed',
      message: `${updated.name} is active again.`
    })
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not renew',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    acting.value = false
  }
}

async function onSuspend() {
  if (!props.team || acting.value) return
  acting.value = true
  try {
    const updated = await suspendAssociationTeam(
      props.associationShortName ?? '',
      props.team.id,
      { reason: 'Suspended via legacy team-details modal.' }
    )
    emit('team-updated', updated)
    pushToast({
      tone: 'success',
      title: 'Team suspended',
      message: `${updated.name} has been marked suspended.`
    })
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not suspend',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    acting.value = false
  }
}

async function onReactivate() {
  if (!props.team || acting.value) return
  acting.value = true
  try {
    const updated = await reactivateAssociationTeam(
      props.associationShortName ?? '',
      props.team.id,
      { neverExpires: true }
    )
    emit('team-updated', updated)
    pushToast({
      tone: 'success',
      title: 'Team reactivated',
      message: `${updated.name} is active again.`
    })
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not reactivate',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    acting.value = false
  }
}

// Events list — fetched when the modal opens with a team. Reuses
// the existing OfficialEvent shape + the same event-row styling
// from UserEventsModal so the two modals visually echo each other.
const events = ref<OfficialEvent[]>([])
const loadingEvents = ref(false)

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) {
      events.value = []
      return
    }
    if (props.team) await loadEvents(props.team.id)
  }
)

watch(
  () => props.team,
  async (next) => {
    if (props.modelValue && next) await loadEvents(next.id)
  }
)

async function loadEvents(teamId: string) {
  loadingEvents.value = true
  try {
    events.value = await fetchTeamEvents(teamId)
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not load events',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
    events.value = []
  } finally {
    loadingEvents.value = false
  }
}

function statusBadgeTone(
  status: AssociationTeamStatus
): 'success' | 'danger' | 'warning' | 'neutral' {
  switch (status) {
    case 'active':
      return 'success'
    case 'suspended':
      return 'warning'
    case 'rejected':
    case 'expired':
      return 'danger'
    case 'pending':
    default:
      return 'neutral'
  }
}

function statusBadgeLabel(status: AssociationTeamStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

/** Derive the registration's valid-thru date as `lastUpdatedAt + 1
 *  year`. v1 mock doesn't store an explicit expiry on the team
 *  record — when the backend lands and returns its own validity
 *  field, swap this to read it directly. Teams flagged as
 *  `neverExpires` short-circuit to a literal "Never Expires" copy
 *  instead of computing a date. */
const validThruDate = computed(() => {
  if (props.team?.neverExpires) return 'Never Expires'
  if (!props.team?.lastUpdatedAt) return ''
  const d = new Date(props.team.lastUpdatedAt)
  if (Number.isNaN(d.getTime())) return ''
  d.setFullYear(d.getFullYear() + 1)
  return d.toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' })
})

const division = computed(() => {
  if (!props.team) return ''
  return `${props.team.gender} ${props.team.ageGroup} ${props.team.rating}`
})
</script>

<template>
  <SlideModal
    :model-value="modelValue"
    title="Team Details"
    @update:modelValue="emit('update:modelValue', $event)"
  >
    <div v-if="team" class="team-details-modal__body">
      <!-- Registration card. Mirrors the reference layout: reg
           numbers + status pill + name + division stacked at the
           top-left, ID-shape glyph at top-right, manager on
           bottom-left, valid-thru on bottom-right. -->
      <article class="team-card">
        <div class="team-card__head">
          <div class="team-card__head-copy">
            <span class="team-card__regline">
              {{ team.systemRegNo }}<template v-if="team.externalRegNo"> / Ext # {{ team.externalRegNo }}</template>
            </span>
            <!-- Status pill + team name on one line, status first. -->
            <div class="team-card__name-row">
              <StatusBadge
                :label="statusBadgeLabel(team.status)"
                :tone="statusBadgeTone(team.status)"
              />
              <strong class="team-card__name">{{ team.name }}</strong>
            </div>
            <span class="team-card__division">{{ division }}</span>
          </div>
          <span class="team-card__icon" aria-hidden="true">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="3" />
              <path d="M8 9h4M8 13h6M8 17h3" />
              <circle cx="16" cy="13" r="1" fill="currentColor" />
            </svg>
          </span>
        </div>

        <div class="team-card__footer">
          <div class="team-card__footer-block">
            <span class="team-card__label">Manager</span>
            <span class="team-card__value">{{ team.managerName }}</span>
          </div>
          <div class="team-card__footer-block team-card__footer-block--right">
            <span class="team-card__label">Valid Thru</span>
            <span class="team-card__value">{{ validThruDate }}</span>
          </div>
        </div>
      </article>

      <!-- Status-driven action bar. Surfaces the most-relevant
           registration management action(s) for the current state:
             - Expired (and not Never-Expires) → Renew Registration
             - Active → Mark Suspended
             - Suspended → Reactivate
           Pending / Rejected fall through to no actions for now —
           those workflows belong with the umpire/player approval
           queues, which are out of scope for this view. -->
      <div
        v-if="
          (team.status === 'expired' && !team.neverExpires)
          || team.status === 'active'
          || team.status === 'suspended'
        "
        class="team-details-modal__actions"
      >
        <button
          v-if="team.status === 'expired' && !team.neverExpires"
          class="primary-button"
          type="button"
          :disabled="acting"
          @click="onRenew"
        >Renew Registration</button>

        <button
          v-if="team.status === 'active'"
          class="danger-light-button"
          type="button"
          :disabled="acting"
          @click="onSuspend"
        >Mark Suspended</button>

        <button
          v-if="team.status === 'suspended'"
          class="primary-button"
          type="button"
          :disabled="acting"
          @click="onReactivate"
        >Reactivate</button>
      </div>

      <!-- Events section — list of events this team has participated
           in. Reuses the row styling from UserEventsModal so the
           two modals share the same event-card visual language. -->
      <section class="team-details-modal__events">
        <header class="team-details-modal__events-head">
          <h3 class="team-details-modal__events-title">Events Participated</h3>
        </header>

        <ul v-if="loadingEvents" class="user-events-modal__list" aria-hidden="true">
          <li
            v-for="n in 3"
            :key="`skeleton-${n}`"
            class="user-events-modal__row user-events-modal__row--skeleton"
          >
            <div class="user-events-modal__event">
              <span class="shimmer-block user-events-modal__skeleton-thumbnail"></span>
              <div class="user-events-modal__skeleton-stack">
                <span class="shimmer-block user-events-modal__skeleton-line user-events-modal__skeleton-line--date"></span>
                <span class="shimmer-block user-events-modal__skeleton-line user-events-modal__skeleton-line--name"></span>
                <span class="shimmer-block user-events-modal__skeleton-line user-events-modal__skeleton-line--location"></span>
                <span class="shimmer-block user-events-modal__skeleton-line user-events-modal__skeleton-line--director"></span>
              </div>
            </div>
          </li>
        </ul>

        <div
          v-else-if="events.length === 0"
          class="team-details-modal__events-empty"
        >
          This team hasn't participated in any events yet.
        </div>

        <ul v-else class="user-events-modal__list">
          <li
            v-for="event in events"
            :key="event.id"
            class="user-events-modal__row team-details-modal__event-row"
          >
            <div class="user-events-modal__event">
              <img
                :src="event.imageUrl"
                alt=""
                aria-hidden="true"
                class="user-events-modal__thumbnail"
              />
              <div class="user-events-modal__meta">
                <span class="user-events-modal__date">{{ event.dateRange }}</span>
                <strong class="user-events-modal__name">{{ event.name }}</strong>
                <span class="user-events-modal__location">{{ event.location }}</span>
                <span class="user-events-modal__subtitle">{{ event.subtitle }}</span>
                <span class="user-events-modal__director">Director: {{ event.director }}</span>
              </div>
            </div>
          </li>
        </ul>
      </section>
    </div>
  </SlideModal>
</template>
