<script setup lang="ts">
// AssociationTeamsView
// --------------------
// /association/:associationShortName/portal/teams.
// Mirrors the user-list pattern: sticky toolbar, continuous scroll,
// search + status filter pills. Team rows show a left meta block
// (name + division + location + last-updated) and a right contact
// block (registration numbers + manager contact info).

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import AssociationSidebar from '../components/AssociationSidebar.vue'
import MultiSelectDropdown from '../components/MultiSelectDropdown.vue'
import RegisterTeamModal from '../components/RegisterTeamModal.vue'
import StatusBadge from '../components/StatusBadge.vue'
import SuspendTeamConfirmModal from '../components/SuspendTeamConfirmModal.vue'
import TeamAvatar from '../components/TeamAvatar.vue'
import TeamValidityModal from '../components/TeamValidityModal.vue'
import {
  fetchAssociationTeams,
  fetchAssociationTeamById,
  markAssociationTeamActive,
  reactivateAssociationTeam,
  rejectAssociationTeam,
  renewAssociationTeam,
  suspendAssociationTeam,
  updateAssociationTeamValidity,
  GENDERS,
  US_STATES
} from '../api/associationTeams'
import { fetchAgeGroups } from '../api/ageRatingCatalogue'
import { fetchRatings } from '../api/associationRatings'
import { currentAssociation } from '../constants/associations'
import { pushToast } from '../toast-center'
import { formatCompact } from '../utils/formatNumber'
import type { AssociationTeam, AssociationTeamStatus } from '../types'

const route = useRoute()
const router = useRouter()
const associationShortName = computed(
  () => (route.params.associationShortName as string | undefined) ?? ''
)

// State
const teams = ref<AssociationTeam[]>([])
const loading = ref(true)
const search = ref('')

// Register / Edit Team modal — single component, mode driven by
// whether `teamModalInitial` is null (Register) or a team record
// (Edit). Same Invite/Edit pattern as AssociationUserModal.
const teamModalOpen = ref(false)
const teamModalInitial = ref<AssociationTeam | null>(null)

function openRegisterModal() {
  teamModalInitial.value = null
  teamModalOpen.value = true
}

async function openEditTeamModal(team: AssociationTeam) {
  closeMenu()
  // The list row is the lightweight shape (no customFields) — fetch get-one so
  // the Edit wizard hydrates the team's custom-field values. Fall back to the
  // row if the fetch fails so Edit still opens.
  const full = await fetchAssociationTeamById(associationShortName.value, team.id).catch(() => null)
  teamModalInitial.value = full ?? team
  teamModalOpen.value = true
}

// Team row click — navigates to the dedicated team-details page.
// (The previous slide-modal approach is gone — see
// AssociationTeamDetailsView.vue for the page that replaces it.)
function openTeamDetails(team: AssociationTeam) {
  router.push({
    name: 'association-team-details',
    params: {
      associationShortName: associationShortName.value,
      teamId: team.id
    }
  })
}

function onTeamSaved(team: AssociationTeam) {
  const index = teams.value.findIndex((t) => t.id === team.id)
  if (index === -1) {
    // Newly registered — prepend so it's visible at the top of the
    // listing without scrolling.
    teams.value = [team, ...teams.value]
  } else {
    // Edited — replace in place so the row reflects the new values.
    teams.value = [
      ...teams.value.slice(0, index),
      team,
      ...teams.value.slice(index + 1)
    ]
  }
  // NOTE: don't null `teamModalInitial` here — the wizard also emits `saved`
  // for inline lifecycle actions (Change Validity / Suspend / …) while it's
  // still OPEN. Clearing it would flip the open edit wizard to "New Team".
  // The open handlers (openRegisterModal / openEditTeamModal) reset it.
}

// Validity / status-change flows (mirrors the team-details page).
// `targetTeam` captures which row the admin is acting on so the
// shared modals know which record to operate against.
type ValidityFlow = 'mark-active' | 'renew' | 'reactivate' | 'change-validity'
type ConfirmFlow = 'suspend' | 'reject'
const targetTeam = ref<AssociationTeam | null>(null)
const validityModalOpen = ref(false)
const validityFlow = ref<ValidityFlow | null>(null)
const confirmModalOpen = ref(false)
const confirmFlow = ref<ConfirmFlow | null>(null)
const acting = ref(false)

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

// Show the Source picker (Payment vs Manual + PO ID field) only
// for flows where money may be involved.
const validityModalShowSource = computed(() => {
  return validityFlow.value === 'mark-active' || validityFlow.value === 'renew'
})

function openValidityFlow(team: AssociationTeam, flow: ValidityFlow) {
  closeMenu()
  targetTeam.value = team
  validityFlow.value = flow
  validityModalOpen.value = true
}

function openSuspendConfirm(team: AssociationTeam) {
  closeMenu()
  targetTeam.value = team
  confirmFlow.value = 'suspend'
  confirmModalOpen.value = true
}

function openRejectConfirm(team: AssociationTeam) {
  closeMenu()
  targetTeam.value = team
  confirmFlow.value = 'reject'
  confirmModalOpen.value = true
}

function commitLocalTeamUpdate(team: AssociationTeam) {
  const index = teams.value.findIndex((t) => t.id === team.id)
  if (index === -1) return
  teams.value = [
    ...teams.value.slice(0, index),
    team,
    ...teams.value.slice(index + 1)
  ]
}

async function onValiditySubmit(payload: {
  neverExpires: boolean
  validUntil: string
  reason: string
  source: 'payment' | 'manual' | null
  paymentOrderId: string
}) {
  if (!targetTeam.value || acting.value || !validityFlow.value) return
  acting.value = true
  try {
    const slug = associationShortName.value
    const id = targetTeam.value.id
    const apiPayload = {
      neverExpires: payload.neverExpires,
      validUntil: payload.validUntil,
      reason: payload.reason || undefined,
      source: payload.source ?? undefined,
      paymentOrderId: payload.paymentOrderId || undefined
    }
    let updated: AssociationTeam | undefined
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
    if (updated) commitLocalTeamUpdate(updated)
    pushToast({ tone: 'success', title: toastTitle, message: toastMessage })
    validityModalOpen.value = false
    validityFlow.value = null
    targetTeam.value = null
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

async function onConfirmModalConfirm(payload: { reason: string }) {
  if (!targetTeam.value || acting.value || !confirmFlow.value) return
  acting.value = true
  try {
    const slug = associationShortName.value
    const id = targetTeam.value.id
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
    commitLocalTeamUpdate(updated)
    pushToast({ tone: 'success', title: toastTitle, message: toastMessage })
    confirmModalOpen.value = false
    confirmFlow.value = null
    targetTeam.value = null
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

// Filters. Status is single-value (always one selected, default
// 'active' to keep the initial view focused on teams in good
// standing). The other four are multi-select arrays — empty array
// means no constraint; any non-empty array is treated as applied.
const STATUS_OPTIONS: AssociationTeamStatus[] = ['pending', 'active', 'expired', 'rejected', 'suspended']
const STATUS_LABELS = ['Pending', 'Active', 'Expired', 'Rejected', 'Suspended']
const statusFilter = ref<AssociationTeamStatus>('active')
const ageGroupFilter = ref<string[]>([])
const ratingFilter = ref<string[]>([])

// Filter dropdown options — names from the shared catalogues (page-cached:
// fetch-once, reuse). Age groups are global; ratings are association-scoped.
// Populating these here also warms the cache the Add/Edit wizard reuses.
const ageGroupOptions = ref<string[]>([])
const ratingOptions = ref<string[]>([])
async function loadFilterCatalogues() {
  const [ages, rates] = await Promise.all([
    fetchAgeGroups(),
    fetchRatings({ associationId: currentAssociation.value?.id })
  ])
  ageGroupOptions.value = ages.map((a) => a.name)
  ratingOptions.value = rates.map((r) => r.name)
}
const genderFilter = ref<string[]>([])
const stateFilter = ref<string[]>([])

function statusLabel(value: AssociationTeamStatus): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** Bridge between the multi-select component (which works in
 *  string[] terms with capitalized labels) and the underlying
 *  single-value `statusFilter` ref (which stores the lowercase enum
 *  value). The getter returns `[Active]` etc.; the setter takes the
 *  last selected label, lowercases it, and writes the enum back. */
const statusFilterAsArray = computed<string[]>({
  get: () => [statusLabel(statusFilter.value)],
  set: (next) => {
    if (next.length === 0) return
    const picked = next[next.length - 1].toLowerCase()
    if (STATUS_OPTIONS.includes(picked as AssociationTeamStatus)) {
      statusFilter.value = picked as AssociationTeamStatus
    }
  }
})

/** True when any filter is set to a non-default value. Drives the
 *  "Reset" link's visibility — only shows when there's actually
 *  something to reset. */
const hasFilterChanges = computed(() =>
  statusFilter.value !== 'active' ||
  ageGroupFilter.value.length > 0 ||
  ratingFilter.value.length > 0 ||
  genderFilter.value.length > 0 ||
  stateFilter.value.length > 0
)

function resetFilters() {
  statusFilter.value = 'active'
  ageGroupFilter.value = []
  ratingFilter.value = []
  genderFilter.value = []
  stateFilter.value = []
}

// Per-row ellipsis menu
const openMenuId = ref<string | null>(null)
function toggleMenu(id: string) {
  openMenuId.value = openMenuId.value === id ? null : id
}
function closeMenu() {
  openMenuId.value = null
}
function onDocClick(event: MouseEvent) {
  if (!openMenuId.value) return
  const target = event.target as HTMLElement
  if (
    !target.closest('.association-users__row-menu') &&
    !target.closest('.association-users__row-menu-btn')
  ) {
    openMenuId.value = null
  }
}

// Sticky toolbar drop-shadow when pinned.
const toolbarStuck = ref(false)
const stickySentinelRef = ref<HTMLElement | null>(null)
let stickyObserver: IntersectionObserver | null = null

onMounted(() => {
  document.addEventListener('mousedown', onDocClick)
  if (typeof IntersectionObserver !== 'undefined' && stickySentinelRef.value) {
    stickyObserver = new IntersectionObserver(
      ([entry]) => {
        toolbarStuck.value = !entry.isIntersecting
      },
      { rootMargin: '0px', threshold: 0 }
    )
    stickyObserver.observe(stickySentinelRef.value)
  }
  void load()
  void loadFilterCatalogues()
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocClick)
  if (stickyObserver) stickyObserver.disconnect()
})

async function load() {
  loading.value = true
  try {
    teams.value = await fetchAssociationTeams(associationShortName.value)
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not load teams',
      message: error instanceof Error ? error.message : 'Please refresh and try again.'
    })
    teams.value = []
  } finally {
    loading.value = false
  }
}

watch(associationShortName, () => {
  if (associationShortName.value) {
    void load()
    void loadFilterCatalogues()
  }
})

// Search debounce — the input updates `search` immediately so the
// field stays responsive, but the filter / API only reads
// `debouncedSearch` which lags by 500ms. This avoids re-running the
// filter (and, when search goes server-side, hitting the backend)
// on every keystroke.
const SEARCH_DEBOUNCE_MS = 500
const debouncedSearch = ref('')
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null
watch(search, (next) => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  searchDebounceTimer = setTimeout(() => {
    searchDebounceTimer = null
    debouncedSearch.value = next
  }, SEARCH_DEBOUNCE_MS)
})

// Filter pipeline: status (always single-value) + age group +
// rating + gender + state, then the search query against several
// fields. All run client-side against the in-memory mock list.
const filteredTeams = computed(() => {
  const q = debouncedSearch.value.trim().toLowerCase()
  return teams.value.filter((team) => {
    if (team.status !== statusFilter.value) return false
    if (ageGroupFilter.value.length > 0 && !ageGroupFilter.value.includes(team.ageGroup)) return false
    if (ratingFilter.value.length > 0 && !ratingFilter.value.includes(team.rating)) return false
    if (genderFilter.value.length > 0 && !genderFilter.value.includes(team.gender)) return false
    if (stateFilter.value.length > 0 && !stateFilter.value.includes(team.state)) return false
    if (!q) return true
    return (
      team.name.toLowerCase().includes(q) ||
      team.systemRegNo.toLowerCase().includes(q) ||
      team.externalRegNo.toLowerCase().includes(q) ||
      team.managerName.toLowerCase().includes(q) ||
      team.managerEmail.toLowerCase().includes(q) ||
      team.city.toLowerCase().includes(q) ||
      team.state.toLowerCase().includes(q)
    )
  })
})

const totalCount = computed(() => teams.value.length)
const visibleCount = computed(() => filteredTeams.value.length)

// Continuous scroll
const pageSize = 25
const visibleLimit = ref(pageSize)
const loadMoreSentinelRef = ref<HTMLElement | null>(null)
let loadMoreObserver: IntersectionObserver | null = null

// Reset the page slice whenever the *applied* filters change. Note
// we watch `debouncedSearch`, not `search`, so the list doesn't
// snap back to page 1 on every keystroke — only after the debounce
// window has settled and a new filter is actually committed.
watch(
  [debouncedSearch, statusFilter, ageGroupFilter, ratingFilter, genderFilter, stateFilter],
  () => {
    visibleLimit.value = pageSize
  }
)

const paginatedTeams = computed(() =>
  filteredTeams.value.slice(0, visibleLimit.value)
)

const hasMore = computed(() => visibleLimit.value < filteredTeams.value.length)

watch(loadMoreSentinelRef, (el, prev) => {
  if (loadMoreObserver && prev) loadMoreObserver.unobserve(prev)
  if (!el || typeof IntersectionObserver === 'undefined') return
  if (!loadMoreObserver) {
    loadMoreObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && hasMore.value) {
            visibleLimit.value = Math.min(
              visibleLimit.value + pageSize,
              filteredTeams.value.length
            )
          }
        }
      },
      { rootMargin: '200px 0px', threshold: 0 }
    )
  }
  loadMoreObserver.observe(el)
})

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
  return statusLabel(status)
}
</script>

<template>
  <main class="association-users">
    <AssociationSidebar active-key="teams" />
    <section class="association-users__main">
      <!-- Sticky stack — both the header (count + search + register
           button) and the toolbar (filter dropdowns) pin to the top
           together as the user scrolls the team list. The sentinel
           sits ABOVE this wrapper so the stuck shadow toggles when
           the entire two-row stack starts pinning. -->
      <div ref="stickySentinelRef" class="association-users__sticky-sentinel" aria-hidden="true"></div>
      <div
        class="association-teams__sticky-stack"
        :class="{ 'association-teams__sticky-stack--stuck': toolbarStuck }"
      >
      <header class="association-users__header">
        <p class="association-users__count">
          <strong :title="`${totalCount} teams`">{{ formatCompact(totalCount) }}</strong>
          <span>teams</span>
        </p>
        <div class="association-teams__header-actions">
          <label class="association-users__search">
            <AppIcon name="search" :size="14" />
            <input
              v-model="search"
              type="search"
              placeholder="Search teams"
              class="association-users__search-input"
            />
          </label>
          <button class="association-users__invite-btn" type="button" @click="openRegisterModal">
            <span class="association-users__invite-icon association-teams__create-icon" aria-hidden="true"></span>
            <span>New Team</span>
          </button>
        </div>
      </header>

      <div class="association-users__toolbar association-teams__toolbar">
        <!-- (No floating "N teams" count here — the header above
             already shows it, and the sticky stack now pins both
             rows together so the count is always visible.) -->
        <!-- Filter row — Status is a single-value native <select>;
             the other four are multi-select dropdowns with search
             and a "+N" overflow badge. Status is ALWAYS treated as
             applied (it always carries one of the five status
             values); the multi-selects are applied iff their array
             is non-empty. -->
        <div class="association-teams__filters">
          <!-- Status uses the same MultiSelectDropdown component for
               visual consistency, but with `single` (no multi-pick,
               clicking an option replaces the value and closes the
               popover) and `searchable={false}` so there's no search
               input or clear button — the dropdown always carries
               exactly one of the 5 statuses. -->
          <MultiSelectDropdown
            v-model="statusFilterAsArray"
            :options="STATUS_LABELS"
            placeholder="Status"
            single
            :searchable="false"
          />

          <MultiSelectDropdown
            v-model="ageGroupFilter"
            :options="ageGroupOptions"
            placeholder="Age Group"
          />
          <MultiSelectDropdown
            v-model="ratingFilter"
            :options="ratingOptions"
            placeholder="Rating"
          />
          <MultiSelectDropdown
            v-model="genderFilter"
            :options="GENDERS"
            placeholder="Gender"
          />
          <MultiSelectDropdown
            v-model="stateFilter"
            :options="US_STATES"
            placeholder="State"
          />

          <!-- Reset link — only visible when at least one filter
               differs from its default. Sits at the far right of the
               filter row via `margin-left: auto` in CSS. -->
          <button
            v-if="hasFilterChanges"
            type="button"
            class="association-teams__filter-reset"
            @click="resetFilters"
          >Reset filter</button>
        </div>
      </div>
      </div><!-- /.association-teams__sticky-stack -->

      <!-- Loading skeleton -->
      <div v-if="loading" class="association-users__list">
        <div v-for="i in 6" :key="`skeleton-${i}`" class="association-users__row association-users__row--skeleton">
          <div class="association-users__row-identity">
            <span class="shimmer-circle association-users__skeleton-avatar"></span>
            <div class="association-users__skeleton-stack">
              <span class="shimmer-block association-users__skeleton-name"></span>
              <span class="shimmer-block association-users__skeleton-email"></span>
            </div>
          </div>
          <div class="association-teams__row-contact">
            <span class="shimmer-block association-users__skeleton-pill"></span>
            <span class="shimmer-block association-users__skeleton-pill"></span>
          </div>
          <span class="shimmer-block association-users__skeleton-pill association-users__skeleton-pill--action"></span>
        </div>
      </div>

      <div v-else-if="filteredTeams.length === 0" class="association-users__empty">
        <p v-if="search.trim()">No teams match "{{ search }}".</p>
        <p v-else>No {{ statusFilter }} teams match the current filters.</p>
      </div>

      <div v-else class="association-users__list">
        <div
          v-for="team in paginatedTeams"
          :key="team.id"
          class="association-users__row association-teams__row association-teams__row--clickable"
          role="button"
          tabindex="0"
          @click="openTeamDetails(team)"
          @keyup.enter="openTeamDetails(team)"
          @keyup.space.prevent="openTeamDetails(team)"
        >
          <!-- LEFT: avatar + identity stack -->
          <div class="association-users__row-identity">
            <TeamAvatar :name="team.name" :image-url="team.avatarUrl" size="md" />
            <div class="association-users__row-copy">
              <!-- Registration numbers above the team name. External
                   reg # is optional — when missing we drop the
                   "/ Ext #" segment entirely so the line just reads
                   the system number. -->
              <span v-if="team.systemRegNo" class="association-teams__row-regline">
                {{ team.systemRegNo }}<template v-if="team.externalRegNo"> / Ext # {{ team.externalRegNo }}</template>
              </span>
              <div class="association-users__row-name-line">
                <StatusBadge
                  :label="statusBadgeLabel(team.status)"
                  :tone="statusBadgeTone(team.status)"
                />
                <strong class="association-users__row-name">{{ team.name }}</strong>
              </div>
              <span class="association-teams__row-division">
                {{ team.gender }} {{ team.ageGroup }} {{ team.rating }}
              </span>
              <span class="association-teams__row-location">
                <span class="association-teams__row-icon association-teams__row-icon--location" aria-hidden="true"></span>
                {{ team.city }}, {{ team.state }}
              </span>
            </div>
          </div>

          <!-- MIDDLE: contact block. Each line carries a 20×20 SVG
               glyph painted via CSS mask + secondary background so
               the icons pick up the page palette without needing
               per-icon sizing. (System / external reg numbers moved
               to a line above the team name in the identity column.) -->
          <div class="association-teams__row-contact">
            <span class="association-teams__row-contact-line">
              <span class="association-teams__row-contact-text">
                <span class="association-teams__row-contact-label">Team Manager</span>
                {{ team.managerName }}
              </span>
            </span>
            <span class="association-teams__row-contact-line">
              <a
                class="association-teams__row-contact-text association-teams__row-contact-link"
                :href="`mailto:${team.managerEmail}`"
              >{{ team.managerEmail }}</a>
              <span class="association-teams__row-icon association-teams__row-icon--email" aria-hidden="true"></span>
            </span>
            <span v-if="team.managerPhone" class="association-teams__row-contact-line">
              <a
                class="association-teams__row-contact-text association-teams__row-contact-link"
                :href="`tel:${team.managerPhone.replace(/[^0-9+]/g, '')}`"
              >{{ team.managerPhone }}</a>
              <span class="association-teams__row-icon association-teams__row-icon--phone" aria-hidden="true"></span>
            </span>
          </div>

          <!-- RIGHT: ellipsis menu. Click events are stopped here so
               opening / interacting with the menu doesn't also fire
               the row's "open team details" click handler. -->
          <div class="association-users__row-actions" @click.stop>
            <button
              type="button"
              class="association-users__row-menu-btn"
              :aria-label="`Actions for ${team.name}`"
              :aria-expanded="openMenuId === team.id ? 'true' : 'false'"
              @click.stop="toggleMenu(team.id)"
            >
              <AppIcon name="ellipsis" :size="16" />
            </button>
            <div v-if="openMenuId === team.id" class="association-users__row-menu" role="menu">
              <button
                type="button"
                class="association-users__row-menu-item"
                role="menuitem"
                @click="openEditTeamModal(team)"
              >Edit Team</button>
              <!-- Status-driven actions: each row only shows the
                   transitions valid from its current state. -->
              <button
                v-if="team.status === 'pending'"
                type="button"
                class="association-users__row-menu-item"
                role="menuitem"
                @click="openValidityFlow(team, 'mark-active')"
              >Mark Active</button>
              <button
                v-if="team.status === 'expired'"
                type="button"
                class="association-users__row-menu-item"
                role="menuitem"
                @click="openValidityFlow(team, 'renew')"
              >Renew Registration</button>
              <button
                v-if="team.status === 'active'"
                type="button"
                class="association-users__row-menu-item"
                role="menuitem"
                @click="openValidityFlow(team, 'change-validity')"
              >Change Validity</button>
              <button
                v-if="team.status === 'suspended'"
                type="button"
                class="association-users__row-menu-item"
                role="menuitem"
                @click="openValidityFlow(team, 'reactivate')"
              >Reactivate</button>
              <button
                v-if="team.status === 'active'"
                type="button"
                class="association-users__row-menu-item association-users__row-menu-item--danger"
                role="menuitem"
                @click="openSuspendConfirm(team)"
              >Mark Suspended</button>
              <!-- Cancel Registration — flips status to 'rejected'.
                   Available on active and pending rows. -->
              <button
                v-if="team.status === 'active' || team.status === 'pending'"
                type="button"
                class="association-users__row-menu-item association-users__row-menu-item--danger"
                role="menuitem"
                @click="openRejectConfirm(team)"
              >Cancel Registration</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Continuous scroll sentinel -->
      <div
        v-if="!loading && hasMore"
        ref="loadMoreSentinelRef"
        class="association-users__load-more"
        aria-hidden="true"
      >
        <span class="association-users__load-more-spinner"></span>
        <span>Loading more teams…</span>
      </div>

      <p v-if="!loading && totalCount > 0 && visibleCount === 0" class="association-users__filter-summary">
        No matches.
      </p>
    </section>
    <RegisterTeamModal
      :model-value="teamModalOpen"
      :association-short-name="associationShortName"
      :initial="teamModalInitial"
      @update:modelValue="teamModalOpen = $event"
      @saved="onTeamSaved"
    />

    <TeamValidityModal
      :model-value="validityModalOpen"
      :title="validityModalTitle"
      :subtitle="validityModalSubtitle"
      :submit-label="validityModalSubmitLabel"
      :initial-never-expires="targetTeam?.neverExpires ?? false"
      :initial-valid-until="targetTeam?.validUntil ?? ''"
      :show-source="validityModalShowSource"
      :saving="acting"
      @update:modelValue="validityModalOpen = $event"
      @submit="onValiditySubmit"
    />

    <SuspendTeamConfirmModal
      :model-value="confirmModalOpen"
      :mode="confirmFlow ?? 'suspend'"
      :team-name="targetTeam?.name ?? ''"
      :saving="acting"
      @update:modelValue="confirmModalOpen = $event"
      @confirm="onConfirmModalConfirm"
    />

  </main>
</template>
