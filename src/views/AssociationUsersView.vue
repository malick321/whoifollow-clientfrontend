<script setup lang="ts">
// AssociationUsersView
// --------------------
// Association portal page reachable at /association/:associationShortName/portal/users.
// The URL param carries the association's short-name slug (e.g. "ssusa").
// The mock API ignores the value entirely; when the real backend
// lands, the page will resolve the slug → GUID once and pass the
// GUID to the API layer (slug stays in the URL for clean shareable
// links, GUID flows through the network for cheap indexed lookups).
// v1 — frontend only, mock data, no backend integration. The user
// reaches it by typing the URL directly (no nav entry point yet).
//
// Layout:
//   - LEFT sidebar: portal name + nav items (Events / Users / Teams /
//     Followers / Settings). Only "Users" is wired up; the others are
//     static labels with no click handlers — out of scope for v1.
//   - RIGHT main: user count + search → toolbar (Invite + filter) →
//     users list (avatar + identity + status pill + role pill +
//     ellipsis menu).
//
// Ellipsis menu opens a small popover over the row with "Edit Role"
// and "Remove" actions. Edit Role opens the AssociationUserModal in
// Edit mode pre-filled with the row's data. Invite User opens the
// same modal in Invite mode (no `initial`).

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import AssociationSidebar from '../components/AssociationSidebar.vue'
import AssociationUserModal from '../components/AssociationUserModal.vue'
import UserEventsModal from '../components/UserEventsModal.vue'
import StatusBadge from '../components/StatusBadge.vue'
import TeamAvatar from '../components/TeamAvatar.vue'
import { currentAssociation } from '../constants/associations'
// Sidebar / invite-button icons are resolved purely in CSS via
// per-icon mask-image rules in styles.css — Vite handles the asset
// hashing at CSS-build time, which works reliably in production.
// (The previous inline-style approach with `--nav-icon` failed on
// the production build, leaving the icons rendering as solid colored
// squares; the CSS-driven approach matches how the participation
// portal references its own SVG assets.)
import {
  cancelAssociationUserInvite,
  deleteAssociationUser,
  fetchAssociationUsers,
  resendAssociationUserInvite
} from '../api/associationUsers'
import { lockBodyScroll, unlockBodyScroll } from '../body-scroll-lock'
import {
  ASSOCIATION_PERMISSIONS,
  deriveAssociationRoleLabel
} from '../constants/associationPermissions'
import { pushToast } from '../toast-center'
import { formatCompact } from '../utils/formatNumber'
import type { AssociationUser, AssociationUserStatus } from '../types'

// Vue Router 4 + Composition API: useRoute() returns a reactive route
// object directly. Access via `route.params.foo` (no .value).
const route = useRoute()
const associationShortName = computed(() => (route.params.associationShortName as string | undefined) ?? '')

// Server-side state — the list now reflects whichever pages have
// been fetched so far for the current (search, status) combination.
// `users` accumulates rows page-by-page; the load-more sentinel
// triggers the next page fetch from the API.
const users = ref<AssociationUser[]>([])
// `loading` covers the initial page fetch (skeleton state); the
// load-more sentinel uses `loadingMore` so it can show a different
// affordance.
const loading = ref(true)
const loadingMore = ref(false)
const search = ref('')
type StatusFilter = 'all' | AssociationUserStatus
const statusFilter = ref<StatusFilter>('active')

// Server-driven pagination state. Bumped when the load-more sentinel
// asks for another chunk. `totalCount` mirrors the server's reported
// total so the count badge in the header is accurate even when only
// a subset of pages has been fetched. `hasMore` is derived from
// `currentPage` vs `lastPage`.
const PAGE_SIZE = 25
const currentPage = ref(0)
const lastPage = ref(1)
const totalCount = ref(0)

// Modal state — single modal serves both Invite (initial = null) and
// Edit (initial = the row clicked).
const modalOpen = ref(false)
const modalInitial = ref<AssociationUser | null>(null)

// Events-modal state — opens when the admin clicks the "Official in
// N events" chip on a user row. Lists every event the user is on as
// an Official; supports per-event removal.
const eventsModalOpen = ref(false)
const eventsModalUser = ref<AssociationUser | null>(null)

function openEventsModal(user: AssociationUser) {
  closeMenu()
  eventsModalUser.value = user
  eventsModalOpen.value = true
}

/** When the events modal removes a user from an event, decrement
 *  the matching user row's `eventOfficialCount` so the chip's
 *  count (and visibility) updates instantly. */
function onUserEventCountChanged(payload: { userId: string; newCount: number }) {
  const index = users.value.findIndex((u) => u.id === payload.userId)
  if (index === -1) return
  users.value = [
    ...users.value.slice(0, index),
    { ...users.value[index], eventOfficialCount: payload.newCount },
    ...users.value.slice(index + 1)
  ]
  // Keep the modal's `user` prop in sync too so the modal eyebrow /
  // subtitle reflect the updated count if the modal stays open.
  if (eventsModalUser.value?.id === payload.userId) {
    eventsModalUser.value = { ...eventsModalUser.value, eventOfficialCount: payload.newCount }
  }
}

// Sticky toolbar drop-shadow — toggled when the toolbar is pinned to
// the top of the viewport (i.e. the user has scrolled past it). We use
// a sentinel sitting just above the toolbar + IntersectionObserver:
// when the sentinel leaves the viewport, the toolbar is "stuck".
const toolbarStuck = ref(false)
const stickySentinelRef = ref<HTMLElement | null>(null)
let stickyObserver: IntersectionObserver | null = null

// Per-row ellipsis menu — only one row's menu open at a time.
const openMenuId = ref<string | null>(null)
function toggleMenu(id: string) {
  openMenuId.value = openMenuId.value === id ? null : id
}
function closeMenu() {
  openMenuId.value = null
}

function onDocClick(event: MouseEvent) {
  // Close any open ellipsis popover if the user clicks outside it.
  // Each menu trigger button stops propagation so its own click
  // doesn't bubble here and re-close itself.
  if (!openMenuId.value) return
  const target = event.target as HTMLElement
  if (!target.closest('.association-users__row-menu') && !target.closest('.association-users__row-menu-btn')) {
    openMenuId.value = null
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onDocClick)
  if (typeof IntersectionObserver !== 'undefined' && stickySentinelRef.value) {
    stickyObserver = new IntersectionObserver(
      ([entry]) => {
        toolbarStuck.value = !entry.isIntersecting
      },
      { rootMargin: '0px 0px 0px 0px', threshold: 0 }
    )
    stickyObserver.observe(stickySentinelRef.value)
  }
  void load()
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocClick)
  if (stickyObserver) stickyObserver.disconnect()
  if (loadMoreObserver) loadMoreObserver.disconnect()
})

/** Token the most recent fetch was issued under — guards against a
 *  stale page response landing after a newer search/filter has
 *  already moved on. Each new (search, status) combination bumps
 *  the token; an in-flight request whose token doesn't match the
 *  current one drops its result on the floor. */
let fetchToken = 0

/** Fetch a page from the server. `mode = 'reset'` clears the list
 *  and starts at page 1; `mode = 'append'` advances to the next
 *  page and concatenates results. */
async function loadPage(mode: 'reset' | 'append') {
  const myToken = ++fetchToken
  const nextPage = mode === 'reset' ? 1 : currentPage.value + 1
  if (mode === 'reset') {
    loading.value = true
  } else {
    loadingMore.value = true
  }
  try {
    // The `/v2/association/users/{associationId}` endpoint expects the
    // ASSOCIATION'S NUMERIC PK, not the URL slug. We always have it on
    // `currentAssociation` by the time this view mounts (router guard
    // populated it before navigation completed). Defensive: bail if
    // somehow it isn't set yet — caller will retry on the next nav.
    const associationId = currentAssociation.value?.id
    if (!associationId) return
    const result = await fetchAssociationUsers(associationId, {
      search: search.value,
      status: statusFilter.value,
      page: nextPage,
      perPage: PAGE_SIZE
    })
    if (myToken !== fetchToken) return // stale response — discard
    if (mode === 'reset') {
      users.value = result.data
    } else {
      users.value = [...users.value, ...result.data]
    }
    currentPage.value = result.current_page
    lastPage.value = result.last_page
    totalCount.value = result.total
  } catch (error) {
    if (myToken !== fetchToken) return
    pushToast({
      tone: 'warning',
      title: 'Could not load users',
      message: error instanceof Error ? error.message : 'Please refresh and try again.'
    })
    if (mode === 'reset') users.value = []
  } finally {
    if (myToken === fetchToken) {
      if (mode === 'reset') loading.value = false
      else loadingMore.value = false
    }
  }
}

async function load() {
  await loadPage('reset')
}

// Refetch when the route's slug changes (rare, but the page is
// route-driven so good to handle).
watch(associationShortName, () => {
  if (associationShortName.value) void load()
})

// `users` already represents the visible page slice — the server
// applied the filters. Keep `paginatedUsers` as an alias so the
// template stays unchanged.
const paginatedUsers = computed(() => users.value)
const hasMore = computed(() => currentPage.value < lastPage.value)

// Search / status filter changes refetch from page 1. Search input
// is debounced 500ms to avoid hammering the API on every keystroke;
// status flips immediately since clicking a tab is a deliberate
// action.
const SEARCH_DEBOUNCE_MS = 500
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null
watch(search, () => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  searchDebounceTimer = setTimeout(() => {
    searchDebounceTimer = null
    void loadPage('reset')
  }, SEARCH_DEBOUNCE_MS)
})
watch(statusFilter, () => {
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer)
    searchDebounceTimer = null
  }
  void loadPage('reset')
})

// Continuous scroll — when the load-more sentinel enters the
// viewport, ask the server for the next page. Re-observe whenever
// the sentinel element is recreated (e.g. after a filter wipes the
// list and re-renders it).
const loadMoreSentinelRef = ref<HTMLElement | null>(null)
let loadMoreObserver: IntersectionObserver | null = null

watch(loadMoreSentinelRef, (el, prev) => {
  if (loadMoreObserver && prev) loadMoreObserver.unobserve(prev)
  if (!el || typeof IntersectionObserver === 'undefined') return
  if (!loadMoreObserver) {
    loadMoreObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (
            entry.isIntersecting &&
            hasMore.value &&
            !loadingMore.value &&
            !loading.value
          ) {
            void loadPage('append')
          }
        }
      },
      { rootMargin: '200px 0px', threshold: 0 }
    )
  }
  loadMoreObserver.observe(el)
})

function openInviteModal() {
  closeMenu()
  modalInitial.value = null
  modalOpen.value = true
}

function openEditModal(user: AssociationUser) {
  closeMenu()
  modalInitial.value = user
  modalOpen.value = true
}

function onUserSaved(saved: AssociationUser) {
  // Trust the API response as the new source of truth for the row.
  const index = users.value.findIndex((u) => u.id === saved.id)
  if (index !== -1) {
    // Edit path — splice the updated row in place.
    users.value = [
      ...users.value.slice(0, index),
      saved,
      ...users.value.slice(index + 1)
    ]
    // If the edit changed the row's status to one that no longer
    // matches the current tab filter, drop the row immediately —
    // otherwise it'd sit there with a mismatched status badge until
    // the next refetch (e.g. when the admin flips Active → Inactive
    // while viewing the Active tab, the row should disappear right
    // away). The 'all' tab matches every status so it's exempt.
    const filter = statusFilter.value
    const stillMatchesFilter = filter === 'all' || filter === saved.status
    if (!stillMatchesFilter) {
      users.value = users.value.filter((u) => u.id !== saved.id)
      totalCount.value = Math.max(0, totalCount.value - 1)
    }
  } else {
    // Invite path — a brand-new pending user. Whether to surface
    // it depends on the current status filter:
    //   - 'all' or 'pending' → prepend so it appears immediately.
    //   - any other filter → don't insert (would lie about the
    //     filter); user will see it once they switch tabs.
    const showInList =
      statusFilter.value === 'all' || statusFilter.value === 'pending'
    if (showInList) {
      users.value = [saved, ...users.value]
    }
    totalCount.value = totalCount.value + 1
  }
  modalInitial.value = null
}

// Remove-user confirmation lives in a centered popup so both entry
// points (the row's ellipsis menu and the edit modal's Remove button)
// share a single confirmation flow. v1 only mutates the in-memory
// list — when the backend lands the confirm handler swaps for an API
// call.
const confirmingRemoveUser = ref<AssociationUser | null>(null)

function startRemove(id: string) {
  closeMenu()
  const user = users.value.find((u) => u.id === id) ?? null
  if (!user) return
  confirmingRemoveUser.value = user
}

function cancelRemove() {
  confirmingRemoveUser.value = null
}

async function confirmRemove() {
  const user = confirmingRemoveUser.value
  if (!user) return
  // Optimistic local removal so the UI doesn't lag behind the
  // confirmation click. If the API call fails we re-insert the row
  // and surface a toast.
  const before = users.value
  users.value = users.value.filter((u) => u.id !== user.id)
  totalCount.value = Math.max(0, totalCount.value - 1)
  confirmingRemoveUser.value = null
  if (modalOpen.value && modalInitial.value?.id === user.id) {
    modalOpen.value = false
    modalInitial.value = null
  }
  try {
    await deleteAssociationUser(currentAssociation.value?.id ?? '', user.id)
    pushToast({
      tone: 'success',
      title: 'User removed',
      message: `${user.name} has been removed from the association.`
    })
  } catch (error) {
    users.value = before
    totalCount.value = totalCount.value + 1
    pushToast({
      tone: 'warning',
      title: 'Could not remove user',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  }
}

function onRemoveBackdrop(event: MouseEvent) {
  if (event.target === event.currentTarget) cancelRemove()
}

watch(confirmingRemoveUser, (user, prev) => {
  if (user && !prev) lockBodyScroll()
  else if (!user && prev) unlockBodyScroll()
})

/** Resolve a user's effective permissions into the label list rendered
 *  inline on each row. Full Control short-circuits to every defined
 *  permission so the row tells the truth about what the user can do. */
function permissionLabelsFor(user: AssociationUser): string[] {
  const source = user.fullControl
    ? ASSOCIATION_PERMISSIONS.map((p) => p.key)
    : user.permissions
  return ASSOCIATION_PERMISSIONS
    .filter((p) => source.includes(p.key))
    .map((p) => p.label)
}

function formatJoinedDate(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Map an AssociationUserStatus to a StatusBadge tone. Active gets the
 *  success (green) tone used elsewhere in the app for "in good
 *  standing"; inactive falls back to the muted neutral tone. */
function statusBadgeTone(
  status: AssociationUserStatus
): 'success' | 'danger' | 'neutral' {
  if (status === 'active') return 'success'
  if (status === 'pending') return 'neutral'
  return 'danger'
}

function statusBadgeLabel(status: AssociationUserStatus): string {
  if (status === 'active') return 'Active'
  if (status === 'pending') return 'Pending'
  return 'Inactive'
}

/** Pending invites haven't been accepted yet. Cancel hits the API
 *  and drops the row; Resend bumps the invite's `sent_at` server-
 *  side and surfaces a confirmation toast. Both swallow API errors
 *  by surfacing a warning toast and (for cancel) restoring the row
 *  the optimistic update removed. */
async function cancelInvite(user: AssociationUser) {
  closeMenu()
  const before = users.value
  users.value = users.value.filter((u) => u.id !== user.id)
  totalCount.value = Math.max(0, totalCount.value - 1)
  try {
    await cancelAssociationUserInvite(currentAssociation.value?.id ?? '', user.id)
    pushToast({
      tone: 'success',
      title: 'Invite cancelled',
      message: `Invitation to ${user.email} has been cancelled.`
    })
  } catch (error) {
    users.value = before
    totalCount.value = totalCount.value + 1
    pushToast({
      tone: 'warning',
      title: 'Could not cancel invite',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  }
}

async function resendInvite(user: AssociationUser) {
  closeMenu()
  try {
    await resendAssociationUserInvite(currentAssociation.value?.id ?? '', user.id)
    pushToast({
      tone: 'success',
      title: 'Invite resent',
      message: `A fresh invitation has been emailed to ${user.email}.`
    })
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not resend invite',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  }
}

/** Map a derived role label to a StatusBadge tone. Admin → primary
 *  blue (matches the Admin chips on the participation page), Umpire →
 *  success green (umpire association = "go" status visually), Member
 *  → muted neutral. */
function roleBadgeTone(
  role: 'Admin' | 'Umpire' | 'Member'
): 'primary' | 'success' | 'neutral' {
  if (role === 'Admin') return 'primary'
  if (role === 'Umpire') return 'success'
  return 'neutral'
}
</script>

<template>
  <main class="association-users">
    <AssociationSidebar active-key="users" />

    <!-- Main content: count + search header, toolbar (Invite + filter),
         and the users list. -->
    <section class="association-users__main">
      <!-- Sticky-stack pattern (mirrors AssociationTeamsView) — the
           sentinel sits ABOVE the wrapper so the stuck shadow
           toggles when the entire two-row stack starts pinning to
           the viewport top, not just the toolbar. -->
      <div ref="stickySentinelRef" class="association-users__sticky-sentinel" aria-hidden="true"></div>
      <div
        class="association-teams__sticky-stack"
        :class="{ 'association-teams__sticky-stack--stuck': toolbarStuck }"
      >
      <header class="association-users__header">
        <p class="association-users__count">
          <strong :title="`${totalCount} users`">{{ formatCompact(totalCount) }}</strong>
          <span>users</span>
        </p>
        <div class="association-teams__header-actions">
          <label class="association-users__search">
            <AppIcon name="search" :size="14" />
            <input
              v-model="search"
              type="search"
              placeholder="Search users"
              class="association-users__search-input"
            />
          </label>
          <button
            class="association-users__invite-btn"
            type="button"
            @click="openInviteModal"
          >
            <span class="association-users__invite-icon" aria-hidden="true"></span>
            <span>Invite User</span>
          </button>
        </div>
      </header>

      <div class="association-users__toolbar association-teams__toolbar">
        <!-- Status filter sits on the LEFT of the toolbar row.
             (No floating "N users" count here — the header above
             already shows it, and the sticky stack now pins both
             rows together so the count is always visible.) -->
        <div class="association-users__filter" role="tablist">
          <button
            type="button"
            class="association-users__filter-btn"
            :class="{ 'association-users__filter-btn--active': statusFilter === 'all' }"
            role="tab"
            :aria-selected="statusFilter === 'all'"
            @click="statusFilter = 'all'"
          >All</button>
          <button
            type="button"
            class="association-users__filter-btn"
            :class="{ 'association-users__filter-btn--active': statusFilter === 'active' }"
            role="tab"
            :aria-selected="statusFilter === 'active'"
            @click="statusFilter = 'active'"
          >Active</button>
          <button
            type="button"
            class="association-users__filter-btn"
            :class="{ 'association-users__filter-btn--active': statusFilter === 'inactive' }"
            role="tab"
            :aria-selected="statusFilter === 'inactive'"
            @click="statusFilter = 'inactive'"
          >Inactive</button>
          <button
            type="button"
            class="association-users__filter-btn"
            :class="{ 'association-users__filter-btn--active': statusFilter === 'pending' }"
            role="tab"
            :aria-selected="statusFilter === 'pending'"
            @click="statusFilter = 'pending'"
          >Pending</button>
        </div>
      </div>
      </div><!-- /.association-teams__sticky-stack -->

      <!-- Users list. Each row carries its own ellipsis popover for
           Edit Role + Remove. The Remove action swaps the row content
           to an inline "Are you sure?" confirm strip per the spec. -->
      <div v-if="loading" class="association-users__list">
        <!-- 3-column skeleton matching the real row grid:
             identity (avatar + 2 lines), permissions, actions. -->
        <div v-for="i in 6" :key="`skeleton-${i}`" class="association-users__row association-users__row--skeleton">
          <div class="association-users__row-identity">
            <span class="shimmer-circle association-users__skeleton-avatar"></span>
            <div class="association-users__skeleton-stack">
              <span class="shimmer-block association-users__skeleton-name"></span>
              <span class="shimmer-block association-users__skeleton-email"></span>
            </div>
          </div>
          <div class="association-users__row-permissions">
            <span class="shimmer-block association-users__skeleton-pill"></span>
            <span class="shimmer-block association-users__skeleton-pill"></span>
          </div>
          <span class="shimmer-block association-users__skeleton-pill association-users__skeleton-pill--action"></span>
        </div>
      </div>

      <div v-else-if="users.length === 0" class="association-users__empty">
        <p v-if="search.trim()">No users match "{{ search }}".</p>
        <p v-else-if="statusFilter !== 'all'">No {{ statusFilter }} users.</p>
        <p v-else>No users in this association yet.</p>
      </div>

      <div v-else class="association-users__list">
        <div
          v-for="user in paginatedUsers"
          :key="user.id"
          class="association-users__row"
        >
          <!-- Default row layout. The Remove action no longer swaps
               the row to an inline confirm strip — it opens a shared
               confirmation popup instead. -->
            <div class="association-users__row-identity">
              <!-- TeamAvatar handles the deterministic light-color
                   palette + initial fallback already used across the
                   app (participation hero, attendee list, etc.). No
                   need for a separate avatar implementation here. -->
              <TeamAvatar :name="user.name" :image-url="user.avatarUrl" size="md" />
              <div class="association-users__row-copy">
                <div class="association-users__row-name-line">
                  <!-- Status pill sits BEFORE the name so the user's
                       active/inactive state reads first when scanning
                       the list. -->
                  <StatusBadge
                    :label="statusBadgeLabel(user.status)"
                    :tone="statusBadgeTone(user.status)"
                  />
                  <strong class="association-users__row-name">{{ user.name }}</strong>
                </div>
                <span class="association-users__row-email">{{ user.email }}</span>
              </div>
            </div>

            <!-- Permissions summary. Full Control short-circuits to a
                 single "all permissions" chip — and intentionally
                 SUPPRESSES the official-count chip, since by definition
                 a Full Control user already has everything anyway.

                 For everyone else, the warning-tone "Official in N
                 events" chip leads (signalling activity / event
                 involvement) and is followed by the specific permission
                 labels granted. If the user has zero permissions AND
                 zero event involvement, the "No permissions assigned"
                 empty-state copy stands in. -->
            <div class="association-users__row-permissions">
              <template v-if="user.fullControl">
                <span class="association-users__row-permission-chip association-users__row-permission-chip--full">
                  Full Control · all permissions
                </span>
              </template>
              <template v-else>
                <button
                  v-if="user.eventOfficialCount > 0"
                  type="button"
                  class="association-users__row-event-chip"
                  :aria-label="`View the ${user.eventOfficialCount} events ${user.name} is rostered on as Official`"
                  @click="openEventsModal(user)"
                >
                  <span class="association-users__row-event-chip-icon" aria-hidden="true"></span>
                  Official in {{ user.eventOfficialCount }} {{ user.eventOfficialCount === 1 ? 'event' : 'events' }}
                </button>
                <span
                  v-for="label in permissionLabelsFor(user)"
                  :key="label"
                  class="association-users__row-permission-chip"
                >{{ label }}</span>
                <span
                  v-if="permissionLabelsFor(user).length === 0 && user.eventOfficialCount === 0"
                  class="association-users__row-permission-empty"
                >No permissions assigned</span>
              </template>
            </div>

            <div class="association-users__row-actions">
              <!-- Pending invites swap the ellipsis menu for two
                   inline text links so the admin can cancel or
                   resend without going through a popover. -->
              <template v-if="user.status === 'pending'">
                <button
                  type="button"
                  class="association-users__row-link association-users__row-link--danger"
                  @click="cancelInvite(user)"
                >Cancel Invite</button>
                <button
                  type="button"
                  class="association-users__row-link"
                  @click="resendInvite(user)"
                >Resend Invite</button>
              </template>
              <template v-else>
                <button
                  type="button"
                  class="association-users__row-menu-btn"
                  :aria-label="`Actions for ${user.name}`"
                  :aria-expanded="openMenuId === user.id ? 'true' : 'false'"
                  @click.stop="toggleMenu(user.id)"
                >
                  <AppIcon name="ellipsis" :size="16" />
                </button>
                <div v-if="openMenuId === user.id" class="association-users__row-menu" role="menu">
                  <button
                    type="button"
                    class="association-users__row-menu-item"
                    role="menuitem"
                    @click="openEditModal(user)"
                  >Edit User</button>
                  <button
                    type="button"
                    class="association-users__row-menu-item association-users__row-menu-item--danger"
                    role="menuitem"
                    @click="startRemove(user.id)"
                  >Remove User</button>
                </div>
              </template>
            </div>
        </div>
      </div>

      <!-- Continuous scroll sentinel — sits ~200px below the visible
           list edge so the next chunk loads before the user actually
           hits the end of the rendered rows. Only mounts while there
           are more rows to reveal. -->
      <div
        v-if="!loading && hasMore"
        ref="loadMoreSentinelRef"
        class="association-users__load-more"
        aria-hidden="true"
      >
        <span class="association-users__load-more-spinner"></span>
        <span>Loading more users…</span>
      </div>
    </section>

    <AssociationUserModal
      :model-value="modalOpen"
      :association-id="(currentAssociation?.id || '')"
      :association-name="(currentAssociation?.associationName || '')"
      :initial="modalInitial"
      @update:modelValue="modalOpen = $event"
      @saved="onUserSaved"
      @remove="(user) => startRemove(user.id)"
    />

    <UserEventsModal
      :model-value="eventsModalOpen"
      :user="eventsModalUser"
      :association-name="(currentAssociation?.associationName || '')"
      @update:modelValue="eventsModalOpen = $event"
      @count-changed="onUserEventCountChanged"
    />

    <!-- Remove-user confirmation modal. Shared between the row's
         ellipsis menu and the edit modal's "Remove User" button so
         both entry points use a single, consistent confirmation. -->
    <Transition name="slide-modal-backdrop">
      <div
        v-if="confirmingRemoveUser"
        class="association-switcher-backdrop"
        role="presentation"
        @click="onRemoveBackdrop"
      >
        <div
          class="association-switcher-panel association-confirm-panel"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="remove-user-title"
        >
          <header class="association-switcher-panel__header">
            <h2 id="remove-user-title" class="association-switcher-panel__title">Remove User</h2>
            <button
              type="button"
              class="association-switcher-panel__close"
              aria-label="Close"
              @click="cancelRemove"
            >
              <AppIcon name="close" :size="16" />
            </button>
          </header>
          <div class="association-confirm-panel__body">
            <p class="association-confirm-panel__copy">
              Remove <strong>{{ confirmingRemoveUser.name }}</strong> from the association?
              They will lose access immediately.
            </p>
          </div>
          <footer class="association-confirm-panel__footer">
            <button class="secondary-button" type="button" @click="cancelRemove">Cancel</button>
            <button class="danger-light-button" type="button" @click="confirmRemove">Yes, remove</button>
          </footer>
        </div>
      </div>
    </Transition>
  </main>
</template>
