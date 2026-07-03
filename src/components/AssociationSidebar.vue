<script setup lang="ts">
// AssociationSidebar
// ------------------
// Shared sidebar rendered by every page in the association portal:
// Users, Teams, Umpires, Players, Shop, Followers, Settings, etc.
// Owns the brand block + nav + switcher modal. Each page tells the
// sidebar which nav item to highlight via the `activeKey` prop.
//
// State sources:
//   - `currentAssociation` (from `constants/associations.ts`) — the
//     access record resolved by the router beforeEach guard from
//     `GET /v2/my/associations/{slug}`. Drives the brand block.
//   - Nav items are gated on `currentAssociation.permissions` /
//     `fullControl` via the `hasPermission` / `hasAnyPermission`
//     helpers. A user with only `manage_users` sees just the Users
//     nav; full-control users see everything.
//   - Switcher modal fetches `GET /v2/my/associations` lazily on
//     open, so the popup reflects the current backend state every
//     time it's opened.

import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from './AppIcon.vue'
import { currentAssociation, setCurrentAssociation } from '../constants/associations'
import { hasPermission, hasAnyPermission, firstPermittedPortalRoute } from '../lib/permissions'
import { fetchMyAssociations } from '../api/myAssociations'
import { ASSOCIATION_PERMISSIONS } from '../constants/associationPermissions'
import { lockBodyScroll, unlockBodyScroll } from '../body-scroll-lock'
import { pushToast } from '../toast-center'
import type { MyAssociation } from '../types'

/** Each portal page passes its own key so the sidebar highlights the
 *  correct nav item without needing to inspect the route shape.
 *
 *  `reports` is the parent key shared by every page under
 *  `/portal/reports/*` — the sidebar highlights the Reports row when
 *  it's set, and auto-expands the sub-menu so the active child is
 *  visible. New reports add a sub-menu entry without needing a new
 *  parent key. */
const props = defineProps<{
  activeKey: 'events' | 'users' | 'teams' | 'umpires' | 'players' | 'shop' | 'followers' | 'settings' | 'reports'
}>()

/** Viewport breakpoint check — the sidebar collapses to a
 *  horizontal pill strip + popover dropdown at ≤840px (matches the
 *  CSS @media rules). On mobile the dropdown is a positioned
 *  popover, so we don't want it auto-expanded on mount (it would
 *  cover the page content on first paint). On desktop it's an
 *  inline column section so auto-expanding is fine. */
function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(max-width: 840px)').matches
}

/** Reports parent expansion. Defaults to expanded whenever the user
 *  is on a Reports child page so the active sub-item is visible —
 *  but ONLY on desktop. On mobile we keep it collapsed so the
 *  dropdown doesn't pop open on top of the page content; the
 *  Reports pill's active styling already signals the section. */
const reportsExpanded = ref(props.activeKey === 'reports' && !isMobileViewport())

/** Refs + coordinates for the mobile-only dropdown variant. On
 *  mobile the horizontal nav has `overflow-x: auto` (per CSS spec
 *  that forces overflow-y to auto too), which clips any
 *  absolutely-positioned descendant. To escape the clip we render
 *  the submenu with `position: fixed` and feed it the Reports
 *  button's viewport-relative coords via CSS variables on the
 *  wrapper element. */
const reportsButtonRef = ref<HTMLElement | null>(null)
const reportsMenuTop = ref('0px')
const reportsMenuLeft = ref('0px')

function recomputeReportsMenuPosition() {
  const el = reportsButtonRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  reportsMenuTop.value = `${rect.bottom + 6}px`
  reportsMenuLeft.value = `${rect.left}px`
}

function toggleReports() {
  // While the user is currently ON a Reports child page (Event
  // Summary etc.), keep the parent expanded — collapsing it would
  // hide the active sub-item the user is staring at, which is
  // disorienting. The toggle is only allowed to CLOSE the parent
  // when we're not on a Reports child route. Opening is always
  // allowed.
  if (reportsExpanded.value && props.activeKey === 'reports') return
  // Position must be measured BEFORE the dropdown becomes visible
  // so the first paint already shows it in the right place — no
  // flicker from a default 0,0 origin.
  if (!reportsExpanded.value) recomputeReportsMenuPosition()
  reportsExpanded.value = !reportsExpanded.value
}

// Outside-click + ESC handlers apply ONLY on mobile, where the
// submenu renders as a floating popover (and standard popover UX
// is "click outside to dismiss"). On desktop the submenu is an
// inline accordion section in the sidebar column — clicking
// elsewhere on the page shouldn't collapse it. Also: while the
// user is currently ON a Reports child page, the parent stays
// pinned open (same rule as `toggleReports`) so the active sub-
// item never disappears from under them.
function onDocClick(event: MouseEvent) {
  if (!reportsExpanded.value) return
  if (!isMobileViewport()) return
  if (props.activeKey === 'reports') return
  const target = event.target as Node | null
  const button = reportsButtonRef.value
  const menu = document.getElementById('association-sidebar-reports-submenu')
  if (
    target &&
    button && !button.contains(target) &&
    menu && !menu.contains(target)
  ) {
    reportsExpanded.value = false
  }
}
function onEsc(event: KeyboardEvent) {
  if (!isMobileViewport()) return
  if (props.activeKey === 'reports') return
  if (event.key === 'Escape') reportsExpanded.value = false
}
function onWindowMove() {
  if (reportsExpanded.value) recomputeReportsMenuPosition()
}

watch(
  () => props.activeKey,
  (next, prev) => {
    // Coming INTO Reports from a sibling section — auto-expand so
    // the child the user is heading to is immediately visible.
    // Skipped on mobile per the doc-comment on `reportsExpanded`
    // initialiser above (popover would cover page content).
    if (next === 'reports' && prev !== 'reports' && !isMobileViewport()) {
      reportsExpanded.value = true
    }
  }
)

const router = useRouter()

const switcherOpen = ref(false)
const switcherLoading = ref(false)
const switcherOptions = ref<MyAssociation[]>([])
const switcherError = ref<string | null>(null)
const navRef = ref<HTMLElement | null>(null)

/** On mobile the nav becomes a horizontal scroller. Each page
 *  navigation re-mounts this component, so without intervention
 *  the scroller resets to its left edge — a tab the user just
 *  tapped on the right side of the strip vanishes off-screen.
 *  Scroll the active item into view after every mount + every
 *  activeKey change so the tapped tab stays visible. */
function ensureActiveTabVisible() {
  const nav = navRef.value
  if (!nav) return
  const active = nav.querySelector<HTMLElement>(
    '.association-users__nav-item--active'
  )
  if (!active) return
  active.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'auto' })
}

onMounted(() => {
  void nextTick(ensureActiveTabVisible)
  document.addEventListener('mousedown', onDocClick)
  document.addEventListener('keydown', onEsc)
  window.addEventListener('resize', onWindowMove)
  window.addEventListener('scroll', onWindowMove, { passive: true })
})

watch(
  () => props.activeKey,
  () => {
    void nextTick(ensureActiveTabVisible)
  }
)

async function openSwitcher() {
  switcherOpen.value = true
  await loadSwitcherOptions()
}

async function loadSwitcherOptions() {
  switcherLoading.value = true
  switcherError.value = null
  try {
    switcherOptions.value = await fetchMyAssociations()
  } catch (err) {
    switcherError.value = err instanceof Error ? err.message : 'Could not load associations.'
    pushToast({
      tone: 'warning',
      title: 'Could not load associations',
      message: switcherError.value
    })
  } finally {
    switcherLoading.value = false
  }
}

function closeSwitcher() {
  switcherOpen.value = false
}

/** Row click — switch to the chosen association.
 *
 *  Two things make this non-trivial:
 *
 *  1. **Destination depends on the target's permissions.** The previous
 *     implementation always navigated to `association-users`, which
 *     bounced any user without `manage_users` to NotFoundView. Now we
 *     compute the first sidebar item the user CAN open on the target
 *     association (events → users → teams → … in sidebar order) and
 *     navigate there. `firstPermittedPortalRoute` returns the resolved
 *     route name; null when the membership grants zero sections (a
 *     pending invite or empty-perms direct-add — caller toasts).
 *
 *  2. **No API delay during the switch.** The switcher options we just
 *     fetched already carry `fullControl` + `permissions` for every
 *     association — the same data the router guard would refetch. By
 *     pre-seeding `currentAssociation` with the clicked option, the
 *     guard's cache check hits and skips its fetch. The destination
 *     page mounts immediately and shows its own loading shimmers while
 *     it pulls page-specific data — visible feedback without the
 *     frozen-screen pause an extra round-trip would cause.
 *
 *  Defensive: if the user clicked their already-current association,
 *  just close the popup (no navigation). */
function selectAssociation(option: MyAssociation) {
  if (currentAssociation.value && currentAssociation.value.slug === option.slug) {
    closeSwitcher()
    return
  }

  const routeName = firstPermittedPortalRoute(option)
  if (!routeName) {
    pushToast({
      tone: 'warning',
      title: 'No portal access',
      message: `${option.shortName} hasn't granted you any portal sections yet.`
    })
    closeSwitcher()
    return
  }

  // Pre-seed the shared membership ref so the router beforeEach guard
  // reuses this record (its slug-match cache check now hits regardless
  // of the previous slug — see src/router.ts).
  setCurrentAssociation(option)
  closeSwitcher()
  router.push({
    name: routeName,
    params: { associationShortName: option.slug }
  })
}

function onSwitcherBackdrop(event: MouseEvent) {
  if (event.target === event.currentTarget) closeSwitcher()
}

/** Resolve display labels for a switcher option's permission keys,
 *  ordered to match the sidebar / invite-modal sequence so the chips
 *  read consistently with the rest of the portal. Full Control is
 *  handled inline in the template (single highlighted chip), so this
 *  helper is only called when `fullControl === false`. */
function permissionLabelsForOption(option: MyAssociation): string[] {
  return ASSOCIATION_PERMISSIONS
    .filter((p) => option.permissions.includes(p.key))
    .map((p) => p.label)
}

watch(switcherOpen, (open, wasOpen) => {
  if (open && !wasOpen) lockBodyScroll()
  else if (!open && wasOpen) unlockBodyScroll()
})

onBeforeUnmount(() => {
  // Defensive — drop the body scroll lock if the page unmounts while
  // the picker is still open (route change with the modal up).
  if (switcherOpen.value) unlockBodyScroll()
  document.removeEventListener('mousedown', onDocClick)
  document.removeEventListener('keydown', onEsc)
  window.removeEventListener('resize', onWindowMove)
  window.removeEventListener('scroll', onWindowMove)
})
</script>

<template>
  <!-- The wrapper uses `display: contents` (see styles.css) so it
       disappears from layout — the <aside> still acts as the first
       grid item of `.association-users`, and the switcher modal at
       the bottom of this template renders as a SIBLING of the
       sidebar rather than a child. That keeps the modal's
       position:fixed backdrop out of the sidebar's overflow + sticky
       stacking context, so other sticky elements in the main
       content can never paint above it. -->
  <div class="association-sidebar-wrapper">
    <aside class="association-users__sidebar">
      <!-- Brand block doubles as the association switcher trigger.
           Click anywhere on the card to open the picker modal. The
           brand block stays rendered (with skeleton placeholders)
           even during the router-guard's in-flight fetch, so the
           sidebar layout doesn't jump on first load. -->
      <button
        type="button"
        class="association-users__brand association-users__brand--button"
        :aria-haspopup="'dialog'"
        :aria-expanded="switcherOpen ? 'true' : 'false'"
        :disabled="!currentAssociation"
        @click="openSwitcher"
      >
        <template v-if="currentAssociation">
          <span class="association-users__brand-mark" aria-hidden="true">{{ currentAssociation.shortName.slice(0, 2) }}</span>
          <span class="association-users__brand-shortname">{{ currentAssociation.shortName }}</span>
          <span class="association-users__brand-name">{{ currentAssociation.associationName }}</span>
        </template>
        <template v-else>
          <span class="shimmer-block association-users__brand-mark association-users__brand-mark--skeleton" aria-hidden="true"></span>
          <span class="shimmer-block association-users__brand-shortname association-users__brand-shortname--skeleton"></span>
          <span class="shimmer-block association-users__brand-name association-users__brand-name--skeleton"></span>
        </template>
      </button>

      <nav
        ref="navRef"
        class="association-users__nav"
        aria-label="Association portal sections"
      >
        <router-link
          v-if="hasPermission(currentAssociation, 'manage_events')"
          v-slot="{ navigate, href }"
          :to="{ name: 'association-events', params: { associationShortName: currentAssociation?.slug } }"
          custom
        >
          <a
            :href="href"
            class="association-users__nav-item"
            :class="activeKey === 'events' ? 'association-users__nav-item--active' : 'association-users__nav-item--inactive'"
            @click="navigate"
          >
            <span class="association-users__nav-icon association-users__nav-icon--calendar" aria-hidden="true"></span>
            <span>Events</span>
          </a>
        </router-link>
        <router-link
          v-if="hasPermission(currentAssociation, 'manage_users')"
          v-slot="{ navigate, href }"
          :to="{ name: 'association-users', params: { associationShortName: currentAssociation?.slug } }"
          custom
        >
          <a
            :href="href"
            class="association-users__nav-item"
            :class="activeKey === 'users' ? 'association-users__nav-item--active' : 'association-users__nav-item--inactive'"
            @click="navigate"
          >
            <span class="association-users__nav-icon association-users__nav-icon--users" aria-hidden="true"></span>
            <span>Users</span>
          </a>
        </router-link>
        <router-link
          v-if="hasPermission(currentAssociation, 'manage_teams')"
          v-slot="{ navigate, href }"
          :to="{ name: 'association-teams', params: { associationShortName: currentAssociation?.slug } }"
          custom
        >
          <a
            :href="href"
            class="association-users__nav-item"
            :class="activeKey === 'teams' ? 'association-users__nav-item--active' : 'association-users__nav-item--inactive'"
            @click="navigate"
          >
            <span class="association-users__nav-icon association-users__nav-icon--teams" aria-hidden="true"></span>
            <span>Teams</span>
          </a>
        </router-link>
        <router-link
          v-if="hasPermission(currentAssociation, 'manage_umpires')"
          v-slot="{ navigate, href }"
          :to="{ name: 'association-umpires', params: { associationShortName: currentAssociation?.slug } }"
          custom
        >
          <a
            :href="href"
            class="association-users__nav-item"
            :class="activeKey === 'umpires' ? 'association-users__nav-item--active' : 'association-users__nav-item--inactive'"
            @click="navigate"
          >
            <span class="association-users__nav-icon association-users__nav-icon--umpire" aria-hidden="true"></span>
            <span>Umpires</span>
          </a>
        </router-link>
        <router-link
          v-if="hasPermission(currentAssociation, 'manage_players')"
          v-slot="{ navigate, href }"
          :to="{ name: 'association-players', params: { associationShortName: currentAssociation?.slug } }"
          custom
        >
          <a
            :href="href"
            class="association-users__nav-item"
            :class="activeKey === 'players' ? 'association-users__nav-item--active' : 'association-users__nav-item--inactive'"
            @click="navigate"
          >
            <span class="association-users__nav-icon association-users__nav-icon--jersey" aria-hidden="true"></span>
            <span>Players</span>
          </a>
        </router-link>
        <router-link
          v-if="hasAnyPermission(currentAssociation, ['manage_products', 'manage_orders'])"
          v-slot="{ navigate, href }"
          :to="{ name: 'association-shop', params: { associationShortName: currentAssociation?.slug } }"
          custom
        >
          <a
            :href="href"
            class="association-users__nav-item"
            :class="activeKey === 'shop' ? 'association-users__nav-item--active' : 'association-users__nav-item--inactive'"
            @click="navigate"
          >
            <span class="association-users__nav-icon association-users__nav-icon--shop" aria-hidden="true"></span>
            <span>Shop</span>
          </a>
        </router-link>
        <router-link
          v-if="hasPermission(currentAssociation, 'manage_followers')"
          v-slot="{ navigate, href }"
          :to="{ name: 'association-followers', params: { associationShortName: currentAssociation?.slug } }"
          custom
        >
          <a
            :href="href"
            class="association-users__nav-item"
            :class="activeKey === 'followers' ? 'association-users__nav-item--active' : 'association-users__nav-item--inactive'"
            @click="navigate"
          >
            <span class="association-users__nav-icon association-users__nav-icon--bell" aria-hidden="true"></span>
            <span>Followers</span>
          </a>
        </router-link>
        <!-- Reports group — clicking the parent expands the sub-menu
             rather than navigating immediately, because the parent
             route doesn't exist on its own (every report lives under
             its own slug). On desktop the wrapper is an inline flex
             column so the submenu appears as indented child rows
             below the parent. On mobile (≤840px) the wrapper acts
             as a positioning anchor and the submenu pops out as an
             absolute-positioned dropdown beneath the Reports pill,
             keeping the horizontal nav strip uncluttered. -->
        <div
          v-if="hasPermission(currentAssociation, 'manage_reports')"
          class="association-users__nav-reports-group"
          :style="{
            '--reports-menu-top': reportsMenuTop,
            '--reports-menu-left': reportsMenuLeft
          }"
        >
          <button
            ref="reportsButtonRef"
            type="button"
            class="association-users__nav-item association-users__nav-item--parent"
            :class="[
              activeKey === 'reports' ? 'association-users__nav-item--active' : 'association-users__nav-item--inactive',
              reportsExpanded ? 'association-users__nav-item--expanded' : ''
            ]"
            :aria-expanded="reportsExpanded ? 'true' : 'false'"
            aria-controls="association-sidebar-reports-submenu"
            @click.stop="toggleReports"
          >
            <span class="association-users__nav-icon association-users__nav-icon--reports" aria-hidden="true"></span>
            <span>Reports</span>
            <span
              class="association-users__nav-chevron"
              :class="reportsExpanded ? 'association-users__nav-chevron--open' : ''"
              aria-hidden="true"
            ></span>
          </button>
          <ul
            v-show="reportsExpanded"
            id="association-sidebar-reports-submenu"
            class="association-users__nav-submenu"
          >
            <li>
              <router-link
                v-slot="{ navigate, href, isActive }"
                :to="{ name: 'association-reports-event-summary', params: { associationShortName: currentAssociation?.slug } }"
                custom
              >
                <a
                  :href="href"
                  class="association-users__nav-subitem"
                  :class="isActive ? 'association-users__nav-subitem--active' : ''"
                  @click="navigate"
                >
                  <span>Event Summary</span>
                </a>
              </router-link>
            </li>
          </ul>
        </div>

        <!-- Settings — always last in the nav order. Sits below
             Reports so it acts as the "tail" item of the sidebar. -->
        <router-link
          v-if="hasPermission(currentAssociation, 'manage_settings')"
          v-slot="{ navigate, href }"
          :to="{ name: 'association-settings', params: { associationShortName: currentAssociation?.slug } }"
          custom
        >
          <a
            :href="href"
            class="association-users__nav-item"
            :class="activeKey === 'settings' ? 'association-users__nav-item--active' : 'association-users__nav-item--inactive'"
            @click="navigate"
          >
            <span class="association-users__nav-icon association-users__nav-icon--settings" aria-hidden="true"></span>
            <span>Settings</span>
          </a>
        </router-link>
      </nav>
    </aside>

    <!-- Switcher modal — rendered as a SIBLING of the <aside> (not a
         child) so its position:fixed backdrop sits in the root
         stacking context, free of any overflow / sticky / z-index
         traps inside the sidebar. -->
    <Transition name="slide-modal-backdrop">
      <div
        v-if="switcherOpen"
        class="association-switcher-backdrop"
        role="presentation"
        @click="onSwitcherBackdrop"
      >
        <div
          class="association-switcher-panel"
          role="dialog"
          aria-modal="true"
          aria-label="Switch association"
        >
          <header class="association-switcher-panel__header">
            <div class="association-switcher-panel__title-block">
              <h2 class="association-switcher-panel__title">Switch Association</h2>
              <p class="association-switcher-panel__subtitle">
                Select an association to continue.
              </p>
            </div>
            <button
              type="button"
              class="association-switcher-panel__close"
              aria-label="Close"
              @click="closeSwitcher"
            >
              <AppIcon name="close" :size="16" />
            </button>
          </header>
          <div class="association-switcher-panel__body">
            <!-- Loading state: 4 shimmer rows mirroring the real row
                 layout (identity column on the left + chip cluster on
                 the right) so the modal doesn't pop in awkwardly. -->
            <ul v-if="switcherLoading" class="association-switcher-skeleton">
              <li
                v-for="n in 4"
                :key="'skel-' + n"
                class="association-switcher-skeleton__row"
              >
                <div class="association-switcher-skeleton__identity">
                  <span class="shimmer-block association-switcher-skeleton__short"></span>
                  <span class="shimmer-block association-switcher-skeleton__name"></span>
                </div>
                <div class="association-switcher-skeleton__chips">
                  <span class="shimmer-block association-switcher-skeleton__chip"></span>
                  <span class="shimmer-block association-switcher-skeleton__chip association-switcher-skeleton__chip--narrow"></span>
                  <span class="shimmer-block association-switcher-skeleton__chip"></span>
                </div>
              </li>
            </ul>

            <!-- Empty state: user has zero accessible associations. -->
            <div
              v-else-if="switcherOptions.length === 0 && !switcherError"
              class="association-switcher-empty"
            >
              <p>You don't have access to any associations yet.</p>
            </div>

            <!-- Error state: API call failed. Toast already surfaces
                 the message; the modal shows a retry pill so the user
                 can recover without closing. -->
            <div
              v-else-if="switcherError"
              class="association-switcher-empty association-switcher-empty--error"
            >
              <p>Could not load associations.</p>
              <button
                type="button"
                class="secondary-button"
                @click="loadSwitcherOptions"
              >Retry</button>
            </div>

            <!-- Loaded list. Two columns per row, no header:
                   - Identity column: shortName (strong) + associationName (subtitle)
                   - Permissions column: Full Control chip OR per-permission chips
                 The active row mirrors the current association's slug so
                 the user can visually confirm which one they're on. -->
            <ul v-else class="association-switcher-list">
              <li
                v-for="option in switcherOptions"
                :key="option.id"
                class="association-switcher-row"
                :class="{ 'association-switcher-row--active': currentAssociation && option.slug === currentAssociation.slug }"
                role="button"
                tabindex="0"
                @click="selectAssociation(option)"
                @keydown.enter.prevent="selectAssociation(option)"
                @keydown.space.prevent="selectAssociation(option)"
              >
                <div class="association-switcher-row__identity">
                  <span class="association-switcher-row__short">{{ option.shortName }}</span>
                  <span class="association-switcher-row__name">{{ option.associationName }}</span>
                </div>
                <!-- Permissions column. Pill style + Full Control treatment
                     match the users-list rows (`.association-users__row-permission-chip`)
                     so the two surfaces read as one consistent visual
                     vocabulary. -->
                <div class="association-switcher-row__permissions">
                  <template v-if="option.fullControl">
                    <span class="association-users__row-permission-chip association-users__row-permission-chip--full">
                      Full Control · all permissions
                    </span>
                  </template>
                  <template v-else-if="option.permissions.length > 0">
                    <span
                      v-for="label in permissionLabelsForOption(option)"
                      :key="label"
                      class="association-users__row-permission-chip"
                    >{{ label }}</span>
                  </template>
                  <template v-else>
                    <span class="association-users__row-permission-empty">No permissions assigned</span>
                  </template>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
