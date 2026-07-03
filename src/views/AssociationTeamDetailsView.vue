<script setup lang="ts">
// AssociationTeamDetailsView
// --------------------------
// /association/:associationShortName/portal/team/:teamId
//
// Dedicated team-details page (replaces the old slide-modal
// approach). Hero card mirrors the credit-card style from the
// modal, but the page also renders three tabs below it:
//   - Events:    every event the team has participated in
//   - Renewals:  registration-renewal history
//   - Payments:  payables with status pills; click a row to open
//                the transaction history in a side panel modal.

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import AssociationSidebar from '../components/AssociationSidebar.vue'
import PaymentTransactionsModal from '../components/PaymentTransactionsModal.vue'
import RegisterTeamModal from '../components/RegisterTeamModal.vue'
import StatusBadge from '../components/StatusBadge.vue'
import SuspendTeamConfirmModal from '../components/SuspendTeamConfirmModal.vue'
import TeamAvatar from '../components/TeamAvatar.vue'
import TeamValidityModal from '../components/TeamValidityModal.vue'
import MultiSelectDropdown from '../components/MultiSelectDropdown.vue'
import jerseyIcon from '../assets/jersy.svg'
import {
  fetchAssociationTeamById,
  fetchTeamLifecycle,
  fetchTeamPayables,
  markAssociationTeamActive,
  reactivateAssociationTeam,
  rejectAssociationTeam,
  renewAssociationTeam,
  suspendAssociationTeam,
  updateAssociationTeamValidity
} from '../api/associationTeams'
import { fetchTeamEvents } from '../api/officialEvents'
import { pushToast } from '../toast-center'
import type {
  AssociationPayable,
  AssociationPaymentCompletionStatus,
  AssociationTeam,
  AssociationTeamStatus,
  OfficialEvent,
  TeamLifecycleActionType,
  TeamLifecycleEntry,
  TeamParticipationStatus
} from '../types'

const route = useRoute()
const router = useRouter()
const associationShortName = computed(
  () => (route.params.associationShortName as string | undefined) ?? ''
)
const teamId = computed(() => (route.params.teamId as string | undefined) ?? '')

// State
const team = ref<AssociationTeam | null>(null)
const loading = ref(true)
const acting = ref(false)

const tab = ref<'events' | 'lifecycle' | 'payments'>('events')

const events = ref<OfficialEvent[]>([])
const eventsLoading = ref(false)

// Lifecycle + payables are now paginated (25/page) — the log/ledger grow over
// time. `*Loading` = first-page spinner; `*LoadingMore` = the Load-more append;
// `*HasMore` gates the Load-more button.
const PAGE_SIZE = 25
const lifecycle = ref<TeamLifecycleEntry[]>([])
const lifecycleLoading = ref(false)
const lifecycleLoadingMore = ref(false)
const lifecyclePage = ref(1)
const lifecycleHasMore = ref(false)
const payables = ref<AssociationPayable[]>([])
const payablesLoading = ref(false)
const payablesLoadingMore = ref(false)
const payablesPage = ref(1)
const payablesHasMore = ref(false)

// Lifecycle type filter — single-select dropdown (empty = all types, the
// default; no type pre-selected). Mirrors the listing filters' standard.
const LIFECYCLE_TYPE_OPTIONS = ['Renewals', 'Status changes', 'Validity changes']
const lifecycleTypeFilter = ref<string[]>([])

// Map the UI filter label → the API `actionType` set (server-side filtering).
function lifecycleActionTypes(): TeamLifecycleActionType[] | undefined {
  switch (lifecycleTypeFilter.value[0]) {
    case 'Renewals': return ['renew', 'mark_active']
    case 'Status changes': return ['suspend', 'reactivate', 'reject', 'register']
    case 'Validity changes': return ['validity_change']
    default: return undefined
  }
}

/** Load a page of the lifecycle log. `reset` → page 1 (replaces); otherwise
 *  appends the next page. Newest-first, filtered by the type dropdown. */
async function loadLifecycle(reset = false) {
  if (!team.value) return
  const nextPage = reset ? 1 : lifecyclePage.value + 1
  if (reset) lifecycleLoading.value = true
  else lifecycleLoadingMore.value = true
  try {
    const res = await fetchTeamLifecycle(associationShortName.value, team.value.id, {
      page: nextPage,
      perPage: PAGE_SIZE,
      order: 'desc',
      actionType: lifecycleActionTypes()
    })
    lifecycle.value = reset ? res.data : [...lifecycle.value, ...res.data]
    lifecyclePage.value = res.currentPage
    lifecycleHasMore.value = res.hasMore
  } finally {
    lifecycleLoading.value = false
    lifecycleLoadingMore.value = false
  }
}

/** Load a page of this team's payables (Statement tab). `reset` → page 1. */
async function loadPayables(reset = false) {
  if (!team.value) return
  const nextPage = reset ? 1 : payablesPage.value + 1
  if (reset) payablesLoading.value = true
  else payablesLoadingMore.value = true
  try {
    const res = await fetchTeamPayables(associationShortName.value, team.value.id, {
      page: nextPage,
      perPage: PAGE_SIZE
    })
    payables.value = reset ? res.data : [...payables.value, ...res.data]
    payablesPage.value = res.currentPage
    payablesHasMore.value = res.hasMore
  } finally {
    payablesLoading.value = false
    payablesLoadingMore.value = false
  }
}

// Re-pull page 1 of the lifecycle whenever the type filter changes.
watch(lifecycleTypeFilter, () => { void loadLifecycle(true) })

// Transactions modal state — opened when admin clicks a payable.
// The modal fetches the parent payment_order + line items by id so
// it can render the rich payment context (order number, method,
// transactions, etc.). `undefined` (not `null`) is used for the
// "not picked yet" state because Vue 2.7's runtime prop validator
// rejects `null` as a constructor type.
const transactionsModalOpen = ref(false)
const transactionsModalPayableId = ref<string | undefined>(undefined)
const transactionsModalPaymentOrderId = ref<string | undefined>(undefined)

// Hero ellipsis menu — secondary actions (Edit Team for now).
const heroMenuOpen = ref(false)
function toggleHeroMenu() {
  heroMenuOpen.value = !heroMenuOpen.value
}
function closeHeroMenu() {
  heroMenuOpen.value = false
}
function onHeroMenuOutside(event: MouseEvent) {
  if (!heroMenuOpen.value) return
  const target = event.target as HTMLElement
  if (
    !target.closest('.team-details-page__hero-menu') &&
    !target.closest('.team-details-page__hero-menu-btn')
  ) {
    heroMenuOpen.value = false
  }
}

// Edit Team modal — opened from the ellipsis menu's Edit Team item.
const editModalOpen = ref(false)
function openEditModal() {
  closeHeroMenu()
  editModalOpen.value = true
}
function onTeamEdited(updated: AssociationTeam) {
  team.value = updated
}

// Condensed sticky header — same pattern as ParticipationV2 (a
// secondary mini-header pinned to the top once the user scrolls
// past the hero, with the team name + status badge).
const condensedHeaderVisible = ref(false)
function handleScroll() {
  condensedHeaderVisible.value = window.scrollY > 140
}

onMounted(() => {
  window.addEventListener('scroll', handleScroll, { passive: true })
  document.addEventListener('mousedown', onHeroMenuOutside)
  void load()
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', handleScroll)
  document.removeEventListener('mousedown', onHeroMenuOutside)
})

watch([associationShortName, teamId], () => {
  if (teamId.value) void load()
})

async function load() {
  loading.value = true
  try {
    const found = await fetchAssociationTeamById(associationShortName.value, teamId.value)
    team.value = found
    if (found) {
      // Eager-load all three tabs in parallel — events as a whole list, the
      // lifecycle + payables as their first paginated page (25 each).
      eventsLoading.value = true
      await Promise.all([
        fetchTeamEvents(found.id)
          .then((evts) => { events.value = evts })
          .finally(() => { eventsLoading.value = false }),
        loadLifecycle(true),
        loadPayables(true)
      ])
    }
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not load team',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    loading.value = false
    eventsLoading.value = false
  }
}

function goBackToList() {
  router.push({
    name: 'association-teams',
    params: { associationShortName: associationShortName.value }
  })
}

// Status display
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

const division = computed(() => {
  if (!team.value) return ''
  // Map raw gender enum to its possessive division-name form:
  // Male → Men's, Female → Women's, Coed stays as-is.
  const genderLabel =
    team.value.gender === 'Male' ? "Men's"
    : team.value.gender === 'Female' ? "Women's"
    : team.value.gender
  return `${genderLabel} ${team.value.ageGroup} ${team.value.rating}`
})

/** Registration identifiers as a single line — system reg # plus
 *  the optional external reg #. Used on the hero and the
 *  condensed sticky header. No leading "#" prefix on the system
 *  reg because the format already reads as an identifier. */
const registrationLine = computed(() => {
  if (!team.value) return ''
  const sys = team.value.systemRegNo
  const ext = team.value.externalRegNo
  if (sys && ext) return `${sys} / Ext # ${ext}`
  return sys || ''
})

const validThruDate = computed(() => {
  if (!team.value) return ''
  if (team.value.neverExpires) return 'Never Expires'
  if (!team.value.validUntil) return ''
  const d = new Date(team.value.validUntil)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' })
})

// Whether the hero should render a validity badge at all. Pending
// teams have no validity until activated, so the badge is hidden.
const hasValidity = computed(() => {
  if (!team.value) return false
  if (team.value.status === 'pending') return false
  return team.value.neverExpires || !!team.value.validUntil
})

// Validity popup — single component reused across mark-active,
// renew, reactivate, change-validity flows. The `validityFlow` ref
// captures which action we're committing to so the popup's submit
// can dispatch the right API call.
type ValidityFlow = 'mark-active' | 'renew' | 'reactivate' | 'change-validity'
const validityModalOpen = ref(false)
const validityFlow = ref<ValidityFlow | null>(null)

const validityModalTitle = computed(() => {
  switch (validityFlow.value) {
    case 'mark-active': return 'Mark Registration Active'
    case 'renew': return 'Renew Registration'
    case 'reactivate': return 'Reactivate Registration'
    case 'change-validity': return 'Change Validity'
    default: return 'Set Validity'
  }
})

const validityModalSubtitle = computed(() => {
  switch (validityFlow.value) {
    case 'mark-active': return 'Choose how long this registration should remain valid.'
    case 'renew': return 'Set the new validity for the renewed registration.'
    case 'reactivate': return 'Set the validity for the reactivated registration.'
    case 'change-validity': return 'Update when this registration expires.'
    default: return ''
  }
})

const validityModalSubmitLabel = computed(() => {
  switch (validityFlow.value) {
    case 'mark-active': return 'Mark Active'
    case 'renew': return 'Renew'
    case 'reactivate': return 'Reactivate'
    case 'change-validity': return 'Save'
    default: return 'Save'
  }
})

// Show the Source picker only for flows where money is involved
// (mark-active, renew). Reactivate / change-validity hide it.
const validityModalShowSource = computed(() => {
  return validityFlow.value === 'mark-active' || validityFlow.value === 'renew'
})

function openValidityFlow(flow: ValidityFlow) {
  closeHeroMenu()
  validityFlow.value = flow
  validityModalOpen.value = true
}

async function onValiditySubmit(payload: {
  neverExpires: boolean
  validUntil: string
  reason: string
  source: 'payment' | 'manual' | null
  paymentOrderId: string
}) {
  if (!team.value || acting.value || !validityFlow.value) return
  acting.value = true
  try {
    const slug = associationShortName.value
    const id = team.value.id
    const apiPayload = {
      neverExpires: payload.neverExpires,
      validUntil: payload.validUntil,
      reason: payload.reason || undefined,
      source: payload.source ?? undefined,
      paymentOrderId: payload.paymentOrderId || undefined
    }
    let updated
    let toastTitle = ''
    let toastMessage = ''
    switch (validityFlow.value) {
      case 'mark-active':
        updated = await markAssociationTeamActive(slug, id, apiPayload)
        toastTitle = 'Registration activated'
        toastMessage = `${updated.name} is now active.`
        break
      case 'renew':
        updated = await renewAssociationTeam(slug, id, apiPayload)
        toastTitle = 'Registration renewed'
        toastMessage = `${updated.name} is active again.`
        break
      case 'reactivate':
        updated = await reactivateAssociationTeam(slug, id, apiPayload)
        toastTitle = 'Team reactivated'
        toastMessage = `${updated.name} is active again.`
        break
      case 'change-validity':
        updated = await updateAssociationTeamValidity(slug, id, apiPayload)
        toastTitle = 'Validity updated'
        toastMessage = `${updated.name}'s registration validity has been updated.`
        break
    }
    if (updated) team.value = updated
    // Refresh the lifecycle log so the new entry shows up under
    // the Lifecycle tab without a manual refresh.
    await loadLifecycle(true)
    pushToast({ tone: 'success', title: toastTitle, message: toastMessage })
    validityModalOpen.value = false
    validityFlow.value = null
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not save',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    acting.value = false
  }
}

// Suspend / reject flows — share the same confirm modal, swapped
// via the `mode` prop. `confirmFlow` captures which one is active
// so the confirm handler routes to the right API.
type ConfirmFlow = 'suspend' | 'reject'
const confirmModalOpen = ref(false)
const confirmFlow = ref<ConfirmFlow | null>(null)

function openSuspendConfirm() {
  closeHeroMenu()
  confirmFlow.value = 'suspend'
  confirmModalOpen.value = true
}

function openRejectConfirm() {
  closeHeroMenu()
  confirmFlow.value = 'reject'
  confirmModalOpen.value = true
}

async function onConfirmModalConfirm(payload: { reason: string }) {
  if (!team.value || acting.value || !confirmFlow.value) return
  acting.value = true
  try {
    const slug = associationShortName.value
    const id = team.value.id
    let updated: AssociationTeam
    let toastTitle = ''
    let toastMessage = ''
    if (confirmFlow.value === 'suspend') {
      updated = await suspendAssociationTeam(slug, id, payload)
      toastTitle = 'Team suspended'
      toastMessage = `${updated.name} has been marked suspended.`
    } else {
      updated = await rejectAssociationTeam(slug, id, payload)
      toastTitle = 'Registration cancelled'
      toastMessage = `${updated.name} has been marked rejected.`
    }
    team.value = updated
    await loadLifecycle(true)
    pushToast({ tone: 'success', title: toastTitle, message: toastMessage })
    confirmModalOpen.value = false
    confirmFlow.value = null
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: confirmFlow.value === 'reject' ? 'Could not cancel' : 'Could not suspend',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    acting.value = false
  }
}

// Payments — clicking a payable row drills into the parent
// payment_order. The modal renders the order header (PO number,
// method, totals, status) plus this team's payable lines and the
// transaction ledger.
function openPayableTransactions(payable: AssociationPayable) {
  transactionsModalPayableId.value = payable.id
  transactionsModalPaymentOrderId.value = payable.paymentOrderId
  transactionsModalOpen.value = true
}

function paymentCompletionLabel(status: AssociationPaymentCompletionStatus): string {
  switch (status) {
    case 'unpaid': return 'Pending'
    case 'partially_paid': return 'Partially Paid'
    case 'paid': return 'Paid'
  }
}

function paymentCompletionTone(
  status: AssociationPaymentCompletionStatus
): 'success' | 'warning' | 'neutral' {
  switch (status) {
    case 'paid': return 'success'
    case 'partially_paid': return 'warning'
    case 'unpaid':
    default: return 'neutral'
  }
}

/** Computed "Payable" amount for a line item:
 *    payable = totalAmount − discountAmount + platformFeeAmount
 *
 *  Mirrors the backend formula (`payables.total_amount` is gross —
 *  discount and platform fee are tracked separately). The `paid`
 *  and `balance` figures on the row are pre-calculated against
 *  this same formula so they reconcile. */
function payableAmount(payable: AssociationPayable): number {
  return payable.totalAmount - payable.discountAmount + payable.platformFeeAmount
}

/** The Payments row's leading bold line is a "statement descriptor"
 *  derived from `payables.related_entity_type` rather than the raw
 *  description. Keeps the listing scannable: every association
 *  registration reads the same way, every event participation reads
 *  the same way. The event name is shown as a secondary line for
 *  `event_joined_team` rows. */
function statementDescriptor(payable: AssociationPayable): string {
  switch (payable.relatedEntityType) {
    case 'association_team': return 'Team Association Registration'
    case 'event_joined_team': return 'Team Event Participation'
    default: return payable.description
  }
}

/** Label used for the gross-total line in the Payments breakdown.
 *  Reads the related-entity type so admins see "Event
 *  Participation Fee" vs "Association Registration Fee" instead of
 *  a generic "Total" — gives the breakdown column a clearer
 *  business meaning. */
function feeLabel(payable: AssociationPayable): string {
  switch (payable.relatedEntityType) {
    case 'association_team': return 'Association Registration Fee'
    case 'event_joined_team': return 'Event Participation Fee'
    default: return 'Total'
  }
}

// Lifecycle timeline — the list is already sorted (newest-first) AND filtered
// server-side (by `actionType`), so the template renders `lifecycle` directly;
// no client-side sort/filter computeds needed.

function lifecycleVerb(actionType: TeamLifecycleActionType): string {
  switch (actionType) {
    case 'register': return 'registered the team'
    case 'mark_active': return 'marked the registration active'
    case 'renew': return 'renewed the registration'
    case 'suspend': return 'suspended the team'
    case 'reactivate': return 'reactivated the team'
    case 'reject': return 'cancelled the registration'
    case 'validity_change': return 'updated the validity'
  }
}

function lifecycleStatusLabel(status: AssociationTeamStatus | null): string {
  if (status === null) return '—'
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function lifecycleValidityLabel(neverExpires: boolean | null, validUntil: string | null): string {
  if (neverExpires === null) return '—'
  if (neverExpires) return 'Never Expires'
  if (!validUntil) return 'No expiry set'
  const d = new Date(validUntil)
  if (Number.isNaN(d.getTime())) return validUntil
  return d.toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' })
}

function lifecycleStatusChanged(entry: TeamLifecycleEntry): boolean {
  return entry.fromStatus !== entry.toStatus
}

function lifecycleValidityChanged(entry: TeamLifecycleEntry): boolean {
  return (
    entry.fromNeverExpires !== entry.toNeverExpires
    || entry.fromValidUntil !== entry.toValidUntil
  )
}

function formatLifecycleDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' })
    + ' · '
    + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}


// Per-event participation status — distinct from the team-level
// AssociationTeamStatus. Each event row in the Participations tab
// carries its own status (initiated / pending_approval / confirmed
// / waitlisted / withdrawn / cancelled).
function participationStatusLabel(status: TeamParticipationStatus): string {
  switch (status) {
    case 'initiated': return 'Initiated'
    case 'pending_approval': return 'Pending'
    case 'confirmed': return 'Confirmed'
    case 'waitlisted': return 'Waitlisted'
    case 'withdrawn': return 'Withdrawn'
    case 'cancelled': return 'Cancelled'
  }
}

function participationStatusTone(
  status: TeamParticipationStatus
): 'success' | 'warning' | 'danger' | 'neutral' | 'info' {
  switch (status) {
    case 'confirmed': return 'success'
    case 'waitlisted': return 'info'
    case 'withdrawn':
    case 'cancelled': return 'danger'
    case 'pending_approval':
    case 'initiated':
    default: return 'neutral'
  }
}

// Lineup card helpers — split the per-event lineup into two
// comma-joined name lists (starters + bench), mirroring the
// ParticipationV2 side-rail "Event Lineup" card format.
function lineupStartersText(event: OfficialEvent): string {
  return (event.lineupSummary ?? [])
    .filter((p) => p.isStarter)
    .map((p) => p.name)
    .filter(Boolean)
    .join(', ')
}

function lineupBenchText(event: OfficialEvent): string {
  return (event.lineupSummary ?? [])
    .filter((p) => p.isBench)
    .map((p) => p.name)
    .filter(Boolean)
    .join(', ')
}

function hasLineupSubmitted(event: OfficialEvent): boolean {
  return (event.lineupSummary ?? []).length > 0
}

// Formatting
function formatCurrency(value: number): string {
  return value.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' })
}

/** Same as formatDate, plus a separator + clock time. Used in the
 *  Payments listing where the row's leading meta line shows the
 *  precise moment the payable / order was created. */
function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' })
    + ' · '
    + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
</script>

<template>
  <main class="association-users">
    <AssociationSidebar active-key="teams" />

    <!-- Condensed sticky header — appears once the user scrolls
         past the hero, showing the team avatar + name + status. -->
    <section
      v-if="team"
      class="condensed-team-header team-details-page__condensed"
      :class="{ 'condensed-team-header--visible': condensedHeaderVisible }"
    >
      <div class="condensed-team-header__main">
        <div class="condensed-team-header__top">
          <TeamAvatar :name="team.name" :image-url="team.avatarUrl" size="md" />
          <span class="condensed-team-header__name">{{ team.name }}</span>
          <div class="condensed-team-header__badges">
            <StatusBadge
              :label="statusBadgeLabel(team.status)"
              :tone="statusBadgeTone(team.status)"
            />
            <StatusBadge
              v-if="hasValidity && team.neverExpires"
              label="Never Expires"
              tone="info"
            />
            <StatusBadge
              v-else-if="hasValidity"
              :label="`Valid Thru ${validThruDate}`"
              tone="neutral"
            />
          </div>
        </div>
        <!-- Desktop subline: division joined with the
             registration identifier, e.g.
             "Coed 14U AAA · SSUSA00001 / Ext # 5457".
             Mobile subline: only the division here — the
             registration line drops below as its own muted line
             via `condensed-team-header__regline` (see below). -->
        <div class="condensed-team-header__subline">
          <span>{{ division }}</span>
          <template v-if="registrationLine">
            <span class="condensed-team-header__regline-sep" aria-hidden="true"> · </span>
            <span class="condensed-team-header__regline">{{ registrationLine }}</span>
          </template>
        </div>
      </div>
      <div class="condensed-team-header__meta">
        <div class="condensed-team-header__manager-row">
          <span class="condensed-team-header__meta-label">Team Manager</span>
          <strong class="condensed-team-header__meta-value">{{ team.managerName }}</strong>
        </div>
      </div>
    </section>

    <section class="association-users__main">
      <!-- Loading skeleton — shimmer placeholders for hero + tab
           panel so the page doesn't flash an empty state while
           data is in flight. -->
      <div v-if="loading" class="team-details-page__skeleton">
        <section class="hero team-details-page__hero">
          <div class="hero__main">
            <div class="hero-title-row">
              <span class="shimmer-block team-details-skeleton__eyebrow"></span>
              <span class="shimmer-block team-details-skeleton__badge"></span>
            </div>
            <div class="team-heading">
              <span class="shimmer-circle team-details-skeleton__avatar"></span>
              <span class="shimmer-block team-details-skeleton__title"></span>
            </div>
            <span class="shimmer-block team-details-skeleton__line"></span>
            <span class="shimmer-block team-details-skeleton__line team-details-skeleton__line--short"></span>
            <span class="shimmer-block team-details-skeleton__line team-details-skeleton__line--short"></span>
          </div>
          <div class="hero-status">
            <div class="hero-manager-card">
              <span class="shimmer-block team-details-skeleton__line team-details-skeleton__line--short"></span>
              <span class="shimmer-block team-details-skeleton__title"></span>
              <span class="shimmer-block team-details-skeleton__line"></span>
              <span class="shimmer-block team-details-skeleton__line"></span>
            </div>
          </div>
        </section>
        <div class="team-details-page__panel-card">
          <div class="team-details-page__tabs">
            <span class="shimmer-block team-details-skeleton__tab"></span>
            <span class="shimmer-block team-details-skeleton__tab"></span>
            <span class="shimmer-block team-details-skeleton__tab"></span>
          </div>
          <div
            v-for="i in 4"
            :key="`row-skel-${i}`"
            class="team-details-skeleton__row"
          >
            <span class="shimmer-block team-details-skeleton__line"></span>
            <span class="shimmer-block team-details-skeleton__line team-details-skeleton__line--short"></span>
          </div>
        </div>
      </div>

      <div v-else-if="!team" class="team-details-page__empty">
        <p>That team could not be found.</p>
        <button class="primary-button" type="button" @click="goBackToList">Back to Teams</button>
      </div>

      <template v-else>
        <!-- Hero — mirrors the ParticipationV2 layout: eyebrow +
             status badges in a top row, a `team-heading` row with
             the avatar + team name, then meta lines below it.
             Right column carries a manager-info card. -->
        <section class="hero team-details-page__hero">
          <div class="hero__main">
            <div class="hero-title-row">
              <p class="eyebrow">Team Details</p>
              <div class="hero-inline-badges">
                <StatusBadge
                  :label="statusBadgeLabel(team.status)"
                  :tone="statusBadgeTone(team.status)"
                />
                <!-- Pending teams have no validity until they're
                     marked active — skip the validity badge
                     entirely until then. -->
                <StatusBadge
                  v-if="hasValidity && team.neverExpires"
                  label="Never Expires"
                  tone="info"
                />
                <StatusBadge
                  v-else-if="hasValidity"
                  :label="`Valid Thru ${validThruDate}`"
                  tone="neutral"
                />
              </div>
            </div>
            <div class="team-heading">
              <TeamAvatar :name="team.name" :image-url="team.avatarUrl" size="lg" />
              <h1>{{ team.name }}</h1>
            </div>
            <p class="hero-team-meta">{{ division }}</p>
            <p class="hero-copy">{{ team.city }}<template v-if="team.state">, {{ team.state }}</template></p>
            <p class="hero-copy">{{ registrationLine }}</p>

            <!-- Hero strip — Back to Teams link only. Status-driven
                 action buttons live in the top-right hero-status
                 column (same pattern as the scoresheet's "Manage
                 Lineup" CTA). -->
            <div class="hero-strip">
              <button
                class="hero-strip__item hero-strip__item--button"
                type="button"
                @click="goBackToList"
              >Back to Teams</button>
            </div>
          </div>
          <div class="hero-status team-details-page__hero-status">
            <!-- Top-right action cluster: status-driven action +
                 secondary 3-dot ellipsis menu. The status action
                 uses `.ledger-action-button` (same as the scoresheet's
                 Manage Lineup CTA); the ellipsis is anchored to its
                 right and opens a small popover with "Edit Team" and
                 future admin actions. -->
            <div class="team-details-page__hero-action-row">
              <!-- Mobile-only Back to Teams pill — sits alongside the
                   status action + ellipsis on narrow screens so all
                   the hero buttons land in one row below the manager
                   card. The desktop "Back to Teams" pill in the
                   hero-strip below is hidden on mobile via CSS. -->
              <button
                type="button"
                class="hero-strip__item hero-strip__item--button team-details-page__hero-back-mobile"
                @click="goBackToList"
              >Back to Teams</button>
              <!-- Status-driven primary action.
                   Pending → Mark Active (opens validity popup).
                   Expired → Renew Registration (opens validity popup).
                   Active → Change Validity (opens validity popup).
                   Suspended → Reactivate (opens validity popup).
                   Rejected → no primary action. -->
              <button
                v-if="team.status === 'pending'"
                class="ledger-action-button team-details-page__hero-action"
                type="button"
                :disabled="acting"
                @click="openValidityFlow('mark-active')"
              >Mark Active</button>
              <button
                v-else-if="team.status === 'expired'"
                class="ledger-action-button team-details-page__hero-action"
                type="button"
                :disabled="acting"
                @click="openValidityFlow('renew')"
              >Renew Registration</button>
              <button
                v-else-if="team.status === 'active'"
                class="ledger-action-button team-details-page__hero-action"
                type="button"
                :disabled="acting"
                @click="openValidityFlow('change-validity')"
              >Change Validity</button>
              <button
                v-else-if="team.status === 'suspended'"
                class="ledger-action-button team-details-page__hero-action"
                type="button"
                :disabled="acting"
                @click="openValidityFlow('reactivate')"
              >Reactivate</button>

              <div class="team-details-page__hero-menu-wrap">
                <button
                  type="button"
                  class="team-details-page__hero-menu-btn"
                  :aria-expanded="heroMenuOpen ? 'true' : 'false'"
                  aria-label="More actions"
                  @click.stop="toggleHeroMenu"
                >
                  <AppIcon name="ellipsis" :size="16" />
                </button>
                <div
                  v-if="heroMenuOpen"
                  class="team-details-page__hero-menu"
                  role="menu"
                >
                  <button
                    type="button"
                    class="team-details-page__hero-menu-item"
                    role="menuitem"
                    @click="openEditModal"
                  >Edit Team</button>
                  <!-- Mark Suspended is a destructive action — keep
                       it in the ellipsis menu (out of the way of the
                       primary CTA) and confirm before committing. -->
                  <button
                    v-if="team.status === 'active'"
                    type="button"
                    class="team-details-page__hero-menu-item team-details-page__hero-menu-item--danger"
                    role="menuitem"
                    @click="openSuspendConfirm"
                  >Mark Suspended</button>
                  <!-- Cancel Registration — flips status to 'rejected'.
                       Available on active and pending registrations
                       so admin can cancel before approval too. -->
                  <button
                    v-if="team.status === 'active' || team.status === 'pending'"
                    type="button"
                    class="team-details-page__hero-menu-item team-details-page__hero-menu-item--danger"
                    role="menuitem"
                    @click="openRejectConfirm"
                  >Cancel Registration</button>
                </div>
              </div>
            </div>

            <div class="hero-manager-card">
              <span class="hero-manager-card__label">Team Manager</span>
              <span class="hero-manager-card__name">{{ team.managerName }}</span>
              <span v-if="team.managerPhone" class="hero-manager-card__meta-item">
                <span class="association-teams__row-icon association-teams__row-icon--phone" aria-hidden="true"></span>
                {{ team.managerPhone }}
              </span>
              <span class="hero-manager-card__meta-item">
                <span class="association-teams__row-icon association-teams__row-icon--email" aria-hidden="true"></span>
                {{ team.managerEmail }}
              </span>
            </div>
          </div>
        </section>

        <!-- Tabs + tab content live in a single white-card panel so
             the section reads as one unit below the hero. -->
        <div class="team-details-page__panel-card">
        <!-- Tab nav -->
        <nav class="team-details-page__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            :aria-selected="tab === 'events' ? 'true' : 'false'"
            class="team-details-page__tab"
            :class="{ 'team-details-page__tab--active': tab === 'events' }"
            @click="tab = 'events'"
          >Participations <span class="team-details-page__tab-count">{{ events.length }}</span></button>
          <button
            type="button"
            role="tab"
            :aria-selected="tab === 'lifecycle' ? 'true' : 'false'"
            class="team-details-page__tab"
            :class="{ 'team-details-page__tab--active': tab === 'lifecycle' }"
            @click="tab = 'lifecycle'"
          >Lifecycle</button>
          <button
            type="button"
            role="tab"
            :aria-selected="tab === 'payments' ? 'true' : 'false'"
            class="team-details-page__tab"
            :class="{ 'team-details-page__tab--active': tab === 'payments' }"
            @click="tab = 'payments'"
          >Statement</button>
        </nav>

        <!-- Events panel -->
        <section v-if="tab === 'events'" class="team-details-page__panel">
          <div v-if="eventsLoading" class="team-details-page__loading">Loading events…</div>
          <div v-else-if="events.length === 0" class="team-details-page__empty-state">
            This team hasn't participated in any events yet.
          </div>
          <ul v-else class="user-events-modal__list">
            <li v-for="event in events" :key="event.id" class="user-events-modal__row team-details-modal__event-row team-details-modal__event-row--split">
              <div class="user-events-modal__event team-details-modal__event-main">
                <img :src="event.imageUrl" alt="" aria-hidden="true" class="user-events-modal__thumbnail" />
                <div class="user-events-modal__meta">
                  <span
                    v-if="event.participationNo"
                    class="team-details-modal__event-ref-row"
                  >
                    <StatusBadge
                      v-if="event.participationStatus"
                      :label="participationStatusLabel(event.participationStatus)"
                      :tone="participationStatusTone(event.participationStatus)"
                    />
                    <span class="team-details-modal__event-ref"># {{ event.participationNo }}</span>
                  </span>
                  <span class="user-events-modal__date">{{ event.dateRange }}</span>
                  <strong class="user-events-modal__name">{{ event.name }} - {{ division }}</strong>
                  <span class="user-events-modal__location">{{ event.location }}</span>
                  <span class="user-events-modal__subtitle">{{ event.subtitle }}</span>
                  <span class="user-events-modal__director">Director: {{ event.director }}</span>
                </div>
              </div>
              <!-- Right column: submitted lineup, shown as plain
                   multi-line text. Row 1 = jersey icon + comma-
                   joined starters; row 2 = "BENCHED" tag + comma-
                   joined bench. Lines wrap naturally; no card,
                   no heading. -->
              <div class="team-details-modal__event-lineup">
                <template v-if="hasLineupSubmitted(event)">
                  <div
                    v-if="lineupStartersText(event)"
                    class="team-details-modal__event-lineup-line team-details-modal__event-lineup-line--starters"
                  >
                    <img
                      :src="jerseyIcon"
                      alt=""
                      class="event-overview-card__row-icon event-overview-card__row-icon--jersey team-details-modal__event-lineup-icon"
                    />
                    <span>{{ lineupStartersText(event) }}</span>
                  </div>
                  <div
                    v-if="lineupBenchText(event)"
                    class="team-details-modal__event-lineup-line team-details-modal__event-lineup-line--bench"
                  >
                    <strong class="event-roster__bench-label">Benched</strong>
                    <span>{{ lineupBenchText(event) }}</span>
                  </div>
                </template>
                <span v-else class="team-details-modal__event-lineup-empty">
                  No lineup submitted for this event yet.
                </span>
              </div>
            </li>
          </ul>
        </section>

        <!-- Lifecycle panel — vertical timeline of every status /
             validity transition (renew / suspend / reactivate /
             reject / validity_change / mark_active / register).
             Filter pills above the list subset to a category. -->
        <section v-else-if="tab === 'lifecycle'" class="team-details-page__panel">
          <div v-if="lifecycleLoading" class="team-details-page__loading">Loading lifecycle…</div>
          <template v-else>
            <div class="team-lifecycle-filter-row">
              <MultiSelectDropdown
                v-model="lifecycleTypeFilter"
                :options="LIFECYCLE_TYPE_OPTIONS"
                placeholder="Type"
                single
                :searchable="false"
              />
              <button
                v-if="lifecycleTypeFilter.length"
                type="button"
                class="association-teams__filter-reset"
                @click="lifecycleTypeFilter = []"
              >Reset filter</button>
            </div>
            <div
              v-if="lifecycle.length === 0"
              class="team-details-page__empty-state"
            >No entries match this filter.</div>
            <ol v-else class="team-lifecycle-timeline">
              <li
                v-for="entry in lifecycle"
                :key="entry.id"
                class="team-lifecycle-timeline__row"
                :class="`team-lifecycle-timeline__row--${entry.actionType}`"
              >
                <span class="team-lifecycle-timeline__avatar">
                  <TeamAvatar :name="entry.actorName" size="md" />
                </span>
                <div class="team-lifecycle-timeline__body">
                  <p class="team-lifecycle-timeline__headline">
                    <strong>{{ entry.actorName }}</strong>
                    <span>{{ lifecycleVerb(entry.actionType) }}</span>
                    <span class="team-lifecycle-timeline__date">{{ formatLifecycleDate(entry.occurredAt) }}</span>
                  </p>
                  <p
                    v-if="lifecycleStatusChanged(entry)"
                    class="team-lifecycle-timeline__diff"
                  >
                    Status:
                    <span class="team-lifecycle-timeline__diff-from">{{ lifecycleStatusLabel(entry.fromStatus) }}</span>
                    →
                    <span class="team-lifecycle-timeline__diff-to">{{ lifecycleStatusLabel(entry.toStatus) }}</span>
                  </p>
                  <p
                    v-if="lifecycleValidityChanged(entry)"
                    class="team-lifecycle-timeline__diff"
                  >
                    Validity:
                    <span class="team-lifecycle-timeline__diff-from">{{ lifecycleValidityLabel(entry.fromNeverExpires, entry.fromValidUntil) }}</span>
                    →
                    <span class="team-lifecycle-timeline__diff-to">{{ lifecycleValidityLabel(entry.toNeverExpires, entry.toValidUntil) }}</span>
                  </p>
                  <p
                    v-if="entry.source === 'payment' && entry.paymentReference"
                    class="team-lifecycle-timeline__source"
                  >
                    via <strong>{{ entry.paymentReference }}</strong>
                    <template v-if="entry.amount !== null">
                      — {{ formatCurrency(entry.amount) }}
                    </template>
                  </p>
                  <p
                    v-else-if="entry.source === 'manual'"
                    class="team-lifecycle-timeline__source team-lifecycle-timeline__source--manual"
                  >Manual</p>
                  <p
                    v-if="entry.reason"
                    class="team-lifecycle-timeline__reason"
                  >“{{ entry.reason }}”</p>
                </div>
              </li>
            </ol>
            <div v-if="lifecycleHasMore" class="team-details-page__load-more">
              <button
                type="button"
                class="secondary-button"
                :disabled="lifecycleLoadingMore"
                @click="loadLifecycle(false)"
              >
                <span v-if="lifecycleLoadingMore" class="btn-spinner" aria-hidden="true"></span>
                {{ lifecycleLoadingMore ? 'Loading…' : 'Load more' }}
              </button>
            </div>
          </template>
        </section>

        <!-- Payments panel -->
        <section v-else-if="tab === 'payments'" class="team-details-page__panel">
          <div v-if="payablesLoading" class="team-details-page__loading">Loading payments…</div>
          <div v-else-if="payables.length === 0" class="team-details-page__empty-state">
            No payables on this team's account.
          </div>
          <ul v-else class="payables-list">
            <li
              v-for="payable in payables"
              :key="payable.id"
              class="payables-list__row"
              role="button"
              tabindex="0"
              @click="openPayableTransactions(payable)"
              @keyup.enter="openPayableTransactions(payable)"
              @keyup.space.prevent="openPayableTransactions(payable)"
            >
              <div class="payables-list__main">
                <span class="payables-list__ref-row">
                  <StatusBadge
                    :label="paymentCompletionLabel(payable.paymentCompletionStatus)"
                    :tone="paymentCompletionTone(payable.paymentCompletionStatus)"
                  />
                  <span class="payables-list__order-ref">
                    # {{ payable.paymentOrderNumber }}
                  </span>
                </span>
                <span
                  v-if="payable.createdAt"
                  class="payables-list__date"
                >{{ formatDateTime(payable.createdAt) }}</span>
                <strong class="payables-list__description">{{ statementDescriptor(payable) }}</strong>
                <span
                  v-if="payable.relatedEntityType === 'event_joined_team' && payable.eventName"
                  class="payables-list__event-name"
                >{{ payable.eventName }}</span>
              </div>
              <div class="payables-list__amounts">
                <!-- Breakdown that explains how the Payable column
                     was derived: gross Total, then Discount, then
                     Platform fee. All values come straight from the
                     payable line item. -->
                <div class="payables-list__financial-extras">
                  <span class="payables-list__financial-extra">
                    {{ feeLabel(payable) }} {{ formatCurrency(payable.totalAmount) }}
                  </span>
                  <span class="payables-list__financial-extra">
                    Discount {{ formatCurrency(payable.discountAmount) }}
                  </span>
                  <span class="payables-list__financial-extra">
                    Platform fee {{ formatCurrency(payable.platformFeeAmount) }}
                  </span>
                  <span
                    v-if="payable.quantity > 1"
                    class="payables-list__financial-extra"
                  >Qty {{ payable.quantity }}</span>
                </div>
                <div class="payables-list__amount-rows">
                  <span class="payables-list__amount-row">
                    <span class="payables-list__amount-label">Payable</span>
                    <strong>{{ formatCurrency(payableAmount(payable)) }}</strong>
                  </span>
                  <span class="payables-list__amount-row">
                    <span class="payables-list__amount-label">Paid</span>
                    <strong>{{ formatCurrency(payable.paidAmount) }}</strong>
                  </span>
                  <span class="payables-list__amount-row">
                    <span class="payables-list__amount-label">Balance</span>
                    <strong>{{ formatCurrency(payable.balanceAmount) }}</strong>
                  </span>
                </div>
              </div>
            </li>
          </ul>
          <div v-if="payablesHasMore" class="team-details-page__load-more">
            <button
              type="button"
              class="secondary-button"
              :disabled="payablesLoadingMore"
              @click="loadPayables(false)"
            >
              <span v-if="payablesLoadingMore" class="btn-spinner" aria-hidden="true"></span>
              {{ payablesLoadingMore ? 'Loading…' : 'Load more' }}
            </button>
          </div>
        </section>
        </div><!-- /.team-details-page__panel-card -->
      </template>
    </section>

    <PaymentTransactionsModal
      :model-value="transactionsModalOpen"
      :association-short-name="associationShortName"
      :team-id="team?.id ?? ''"
      :payment-order-id="transactionsModalPaymentOrderId"
      :focused-payable-id="transactionsModalPayableId"
      @update:modelValue="transactionsModalOpen = $event"
      @updated="load"
    />

    <RegisterTeamModal
      :model-value="editModalOpen"
      :association-short-name="associationShortName"
      :initial="team"
      @update:modelValue="editModalOpen = $event"
      @saved="onTeamEdited"
    />

    <TeamValidityModal
      :model-value="validityModalOpen"
      :title="validityModalTitle"
      :subtitle="validityModalSubtitle"
      :submit-label="validityModalSubmitLabel"
      :initial-never-expires="team?.neverExpires ?? false"
      :initial-valid-until="team?.validUntil ?? ''"
      :show-source="validityModalShowSource"
      :saving="acting"
      @update:modelValue="validityModalOpen = $event"
      @submit="onValiditySubmit"
    />

    <SuspendTeamConfirmModal
      :model-value="confirmModalOpen"
      :mode="confirmFlow ?? 'suspend'"
      :team-name="team?.name ?? ''"
      :saving="acting"
      @update:modelValue="confirmModalOpen = $event"
      @confirm="onConfirmModalConfirm"
    />
  </main>
</template>
