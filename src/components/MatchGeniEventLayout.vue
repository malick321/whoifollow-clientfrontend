<script setup lang="ts">
// MatchGeniEventLayout
// --------------------
// Shared shell for every MatchGeni event sub-page: a fixed left navigation
// rail (Dashboard, Divisions, Scheduler, Field Grid, Teams, Officials,
// Umpires, Facilities, Notifications) + the page content (`<router-view>`),
// and the ONE event-wide Notifications composer (reachable from any page via
// the rail, through `matchgeni-notify-center`).
//
// Mounts once as a nested parent route, so the rail persists across child
// navigation (no remount flicker). Reuses the finalized portal sidebar item
// visuals (`.association-users__nav-item` / `__nav-icon`) — no new pattern.
//
// Each item is gated by its permission key; Dashboard + Field Grid +
// Notifications show for anyone with MatchGeni access. The division list
// loads from the resources API inside the division view, so "Divisions"
// pushes the (now param-optional) division route with no id and the view
// auto-selects the first division.

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import SendNotificationModal, { type NotifyDivision } from './SendNotificationModal.vue'
import EventShareModal from './EventShareModal.vue'
import MatchGeniEventFormModal from './MatchGeniEventFormModal.vue'
import AppIcon from './AppIcon.vue'
import { currentAssociation } from '../constants/associations'
import { canEnterMatchGeni, canMatchGeniWrite, matchGeniContext, setMatchGeniContext } from '../matchgeni-context'
import { fetchMatchGeniDivisions } from '../api/matchGeniDivisions'
import { transitionEventStatus } from '../api/events'
import { buildEventDetailUrl } from '../api/config'
import { pushToast } from '../toast-center'
import { useNotifyCenter } from '../matchgeni-notify-center'
import { useRailDrawer, closeRailDrawer } from '../mg-rail-drawer'
import { useShareSignal, useViewSignal } from '../matchgeni-share-center'
import { themeMode, toggleTheme } from '../theme'
import type { EventPermissionKey, EventStatus, MatchGeniAccessPayload } from '../types'

const route = useRoute()
const notifyOpen = useNotifyCenter()
const railDrawerOpen = useRailDrawer()
// Close the mobile drawer whenever the route changes (a nav item was tapped)
// and on unmount, so it never lingers open across pages.
watch(() => route.fullPath, () => closeRailDrawer())
// The Share button now lives in the header (a separate component); it bumps
// this signal and we open the hosted EventShareModal here.
const shareSignal = useShareSignal()
watch(shareSignal, () => onShare())
const viewSignal = useViewSignal()
watch(viewSignal, () => onViewEvent())

const associationShortName = computed(() => (route.params.associationShortName as string | undefined) ?? '')
const eventId = computed(() => (route.params.eventId as string | undefined) ?? '')
const associationId = computed(() => currentAssociation.value?.id ?? '')
const eventName = computed(() => matchGeniContext.value?.event?.eventName ?? '')

// ── Rail items ───────────────────────────────────────────────────
interface RailItem {
  key: string
  label: string
  icon: string
  routeName: string
  permission?: EventPermissionKey
  always?: boolean
}
const RAIL: RailItem[] = [
  { key: 'dashboard', label: 'Dashboard', icon: 'dashboard', routeName: 'matchgeni-dashboard', always: true },
  { key: 'divisions', label: 'Divisions', icon: 'division', routeName: 'matchgeni-division-detail', permission: 'manage_divisions' },
  { key: 'locations', label: 'Locations', icon: 'location', routeName: 'matchgeni-event-locations', always: true },
  { key: 'scheduler', label: 'Game Scheduler', icon: 'calendar', routeName: 'matchgeni-scheduler', permission: 'manage_scheduling' },
  { key: 'field-grid', label: 'Field Grid', icon: 'field', routeName: 'matchgeni-field-grid', always: true },
  { key: 'teams', label: 'Participating Teams', icon: 'teams', routeName: 'matchgeni-participating-teams', permission: 'manage_team_participation' },
  { key: 'officials', label: 'Officials', icon: 'officials', routeName: 'matchgeni-officials', permission: 'manage_officials' },
  { key: 'umpires', label: 'Umpires', icon: 'umpire', routeName: 'matchgeni-umpires', permission: 'manage_umpires' }
]
const visibleItems = computed(() =>
  RAIL.filter((item) => (item.always ? canEnterMatchGeni.value : !!item.permission && canMatchGeniWrite(item.permission)))
)
// Until the matchgeni access (`my-permissions`) resolves we don't yet know
// which items the user can see, so the rail paints shimmer rows.
const railLoading = computed(() => !canEnterMatchGeni.value)
function isActive(item: RailItem): boolean {
  return route.name === item.routeName
}
// Rail is expanded (icon + label) on a set of "list/feed" pages where the
// content sits comfortably beside a wide rail; collapsed to icons on the
// remaining (canvas/detail) sub-pages, where hovering slides the labels in
// as an overlay (the content stays put — the rail widens over it, not inline).
const EXPANDED_ROUTES = new Set([
  'matchgeni-dashboard',
  'matchgeni-participating-teams',
  'matchgeni-officials',
  'matchgeni-discussions',
  'matchgeni-notifications'
])
const collapsed = computed(() => !EXPANDED_ROUTES.has((route.name as string) ?? ''))
function targetFor(item: RailItem) {
  return {
    name: item.routeName,
    params: { associationShortName: associationShortName.value, eventId: eventId.value }
  }
}

// ── Notifications modal — load divisions once for the composer ───
const notifyDivisions = ref<NotifyDivision[]>([])
async function loadDivisions() {
  if (!associationId.value || !eventId.value) return
  try {
    const list = await fetchMatchGeniDivisions(associationId.value, eventId.value)
    notifyDivisions.value = list.map((d) => ({
      id: d.id,
      guid: d.guid,
      tournamentName: d.name,
      teamCount: d.teamCount
    }))
  } catch {
    notifyDivisions.value = []
  }
}
onMounted(loadDivisions)
watch(eventId, loadDivisions)
// Refresh the list the first time the composer opens (cheap; covers a
// division added elsewhere during the session).
watch(notifyOpen, (open) => { if (open) void loadDivisions() })

const railAria = 'MatchGeni event sections'

// ── Event actions (lifted from the header) — Settings cog + View Event +
//    Share, available from the rail on every page. ───────────────────────
const hasSettingsContent = computed(
  () => canMatchGeniWrite('edit_event') || canMatchGeniWrite('manage_hotels') || canMatchGeniWrite('manage_sponsors')
)

// Settings popover — teleported to body + fixed-positioned (measured from the
// trigger) so it escapes the collapsed rail's `overflow: hidden` clip.
const settingsMenuOpen = ref(false)
const settingsBtnRef = ref<HTMLElement | null>(null)
const settingsMenuBottom = ref('0px')
const settingsMenuRight = ref('0px')
function positionSettingsMenu() {
  const el = settingsBtnRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  // The Settings button sits in the rail FOOTER bottom-RIGHT, so the popover
  // opens UPWARD and anchors its RIGHT edge to the button's right edge — it
  // sits on top of the rail and grows leftward (never off the right side).
  settingsMenuBottom.value = `${Math.round(window.innerHeight - r.top + 8)}px`
  settingsMenuRight.value = `${Math.round(window.innerWidth - r.right)}px`
}
function toggleSettingsMenu() {
  if (!settingsMenuOpen.value) positionSettingsMenu()
  settingsMenuOpen.value = !settingsMenuOpen.value
}
function closeSettingsMenu() { settingsMenuOpen.value = false }
function onDocMouseDown(event: MouseEvent) {
  if (!settingsMenuOpen.value) return
  const btn = settingsBtnRef.value
  const menu = document.getElementById('mg-rail-settings-menu')
  const target = event.target as Node | null
  if (target && btn && !btn.contains(target) && menu && !menu.contains(target)) closeSettingsMenu()
}
function onDocKeydown(event: KeyboardEvent) { if (event.key === 'Escape') closeSettingsMenu() }

// View Event — open the public event-detail page in a new tab.
function onViewEvent() {
  closeSettingsMenu()
  const guid = matchGeniContext.value?.event.guid
  if (!guid) return
  window.open(buildEventDetailUrl(guid), '_blank', 'noopener,noreferrer')
}

// Share — open the shared EventShareModal (public URL + copy).
const sharingEvent = ref<{ guid: string; eventName: string } | null>(null)
function onShare() {
  closeSettingsMenu()
  const ctx = matchGeniContext.value
  if (!ctx?.event.guid) return
  sharingEvent.value = { guid: ctx.event.guid, eventName: ctx.event.eventName }
}
function closeShareModal() { sharingEvent.value = null }

// Edit Event — opens the MatchGeni event wizard for the current event.
const eventFormOpen = ref(false)
function onEditEvent() {
  closeSettingsMenu()
  eventFormOpen.value = true
}
function onEventEdited() {
  pushToast({ tone: 'success', title: 'Event updated', message: 'Your changes have been saved.' })
}

// ── Event lifecycle workflow (Publish / Mark Completed / Cancel) ─────────
function allowedTransitionsFor(status: EventStatus): { target: EventStatus; label: string; danger?: boolean }[] {
  switch (status) {
    case 'draft': return [
      { target: 'published', label: 'Publish Event' },
      { target: 'cancelled', label: 'Cancel Event', danger: true }
    ]
    case 'published': return [
      { target: 'completed', label: 'Mark Completed' },
      { target: 'cancelled', label: 'Cancel Event', danger: true }
    ]
    default: return []
  }
}
const workflowTransitions = computed(() => {
  const status = matchGeniContext.value?.event.eventStatus
  return status ? allowedTransitionsFor(status) : []
})
const showSettingsCog = computed(() => hasSettingsContent.value || workflowTransitions.value.length > 0)

const confirmingTransition = ref<{ target: EventStatus; label: string; danger: boolean } | null>(null)
const confirmTransitionSaving = ref(false)
function onWorkflowTransition(target: EventStatus) {
  closeSettingsMenu()
  const meta = workflowTransitions.value.find((t) => t.target === target)
  if (!meta) return
  confirmingTransition.value = { target, label: meta.label, danger: meta.danger === true }
}
function cancelTransition() {
  if (confirmTransitionSaving.value) return
  confirmingTransition.value = null
}
function onTransitionBackdrop(event: MouseEvent) {
  if (event.target === event.currentTarget) cancelTransition()
}
function statusLabel(status: EventStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1)
}
function transitionConfirmCopy(target: EventStatus): string {
  switch (target) {
    case 'published': return 'Publish this event? It will become visible to teams and registration controls will activate per the registration window.'
    case 'completed': return 'Mark this event as completed? This is a terminal state — no further status changes will be possible.'
    case 'cancelled': return 'Cancel this event? Teams will be notified, registration will close, and no further changes can be made.'
    default: return 'Confirm the status change for this event?'
  }
}
async function confirmTransition() {
  const pending = confirmingTransition.value
  const ctx = matchGeniContext.value
  if (!pending || !ctx) return
  confirmTransitionSaving.value = true
  try {
    await transitionEventStatus(currentAssociation.value?.id ?? '', associationShortName.value, ctx.event.id, pending.target)
    setMatchGeniContext({ ...ctx, event: { ...ctx.event, eventStatus: pending.target } } as MatchGeniAccessPayload)
    pushToast({
      tone: 'success',
      title: pending.target === 'cancelled' ? 'Event cancelled' : pending.target === 'published' ? 'Event published' : pending.target === 'completed' ? 'Event marked completed' : 'Event updated',
      message: `${ctx.event.eventName} → ${statusLabel(pending.target)}.`
    })
    confirmingTransition.value = null
  } catch (err) {
    pushToast({ tone: 'warning', title: 'Could not update event', message: err instanceof Error ? err.message : 'Please try again.' })
  } finally {
    confirmTransitionSaving.value = false
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onDocMouseDown)
  document.addEventListener('keydown', onDocKeydown)
  window.addEventListener('resize', positionSettingsMenu)
  window.addEventListener('scroll', positionSettingsMenu, { passive: true })
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMouseDown)
  document.removeEventListener('keydown', onDocKeydown)
  window.removeEventListener('resize', positionSettingsMenu)
  window.removeEventListener('scroll', positionSettingsMenu)
})
</script>

<template>
  <div class="mg-shell" :class="{ 'mg-shell--collapsed': collapsed, 'mg-shell--drawer-open': railDrawerOpen }">
    <!-- Mobile drawer backdrop — taps close the rail. Desktop: never shown. -->
    <div
      v-if="railDrawerOpen"
      class="mg-rail__backdrop"
      aria-hidden="true"
      @click="closeRailDrawer"
    ></div>
    <aside
      class="mg-rail"
      :class="{ 'mg-rail--collapsed': collapsed, 'mg-rail--drawer-open': railDrawerOpen }"
    >
      <nav class="association-users__nav mg-rail__nav" :aria-label="railAria">
        <!-- Loading — shimmer rows until matchgeni access resolves. -->
        <template v-if="railLoading">
          <div v-for="n in 9" :key="`mgskel-${n}`" class="mg-rail__skel" aria-hidden="true">
            <span class="shimmer-circle mg-rail__skel-icon"></span>
            <span class="shimmer-block mg-rail__skel-bar"></span>
          </div>
        </template>
        <template v-else>
        <router-link
          v-for="item in visibleItems"
          :key="item.key"
          v-slot="{ navigate, href }"
          :to="targetFor(item)"
          custom
        >
          <a
            :href="href"
            class="association-users__nav-item"
            :class="isActive(item) ? 'association-users__nav-item--active' : 'association-users__nav-item--inactive'"
            @click="navigate"
          >
            <span class="association-users__nav-icon" :class="`mg-rail-icon--${item.icon}`" aria-hidden="true"></span>
            <span class="mg-rail__label">{{ item.label }}</span>
          </a>
        </router-link>
        <!-- Discussions — dedicated topic-list page. -->
        <router-link
          v-if="canEnterMatchGeni"
          v-slot="{ navigate }"
          :to="{ name: 'matchgeni-discussions', params: { associationShortName, eventId } }"
          custom
        >
          <a
            href="#"
            class="association-users__nav-item"
            :class="route.name === 'matchgeni-discussions' ? 'association-users__nav-item--active' : 'association-users__nav-item--inactive'"
            @click="navigate"
          >
            <span class="association-users__nav-icon mg-rail-icon--discussions" aria-hidden="true"></span>
            <span class="mg-rail__label">Discussions</span>
          </a>
        </router-link>
        <!-- Notifications — dedicated page (history listing + New composer). -->
        <router-link
          v-if="canEnterMatchGeni"
          v-slot="{ navigate }"
          :to="{ name: 'matchgeni-notifications', params: { associationShortName, eventId } }"
          custom
        >
          <a
            href="#"
            class="association-users__nav-item"
            :class="route.name === 'matchgeni-notifications' ? 'association-users__nav-item--active' : 'association-users__nav-item--inactive'"
            @click="navigate"
          >
            <span class="association-users__nav-icon mg-rail-icon--notification" aria-hidden="true"></span>
            <span class="mg-rail__label">Notifications</span>
          </a>
        </router-link>
        </template>
      </nav>

      <!-- Footer event actions — Theme toggle + Settings (popover) + View
           Event + Share. Collapsed shows icon-only. -->
      <div class="mg-rail__sep" aria-hidden="true"></div>
      <div class="mg-rail__actions mg-rail__footer">
        <!-- Theme (light/dark) toggle — moved here from the header. -->
        <button
          type="button"
          class="mg-rail__action mg-rail__action--icon app-tooltip app-tooltip--top"
          :data-tooltip="`Switch to ${themeMode === 'dark' ? 'light' : 'dark'} mode`"
          :aria-label="`Switch to ${themeMode === 'dark' ? 'light' : 'dark'} mode`"
          @click="toggleTheme"
        >
          <svg v-if="themeMode !== 'dark'" class="mg-rail__theme-icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="4.2" fill="currentColor" />
            <g stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="12" y1="1.8" x2="12" y2="4.8" />
              <line x1="12" y1="19.2" x2="12" y2="22.2" />
              <line x1="1.8" y1="12" x2="4.8" y2="12" />
              <line x1="19.2" y1="12" x2="22.2" y2="12" />
              <line x1="4.0" y1="4.0" x2="6.2" y2="6.2" />
              <line x1="17.8" y1="17.8" x2="20.0" y2="20.0" />
              <line x1="4.0" y1="20.0" x2="6.2" y2="17.8" />
              <line x1="17.8" y1="6.2" x2="20.0" y2="4.0" />
            </g>
          </svg>
          <svg v-else class="mg-rail__theme-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="currentColor" />
          </svg>
          <span class="mg-rail__label">Theme</span>
        </button>
        <button
          v-if="showSettingsCog"
          ref="settingsBtnRef"
          type="button"
          class="mg-rail__action mg-rail__action--icon app-tooltip app-tooltip--top"
          data-tooltip="Settings"
          :aria-expanded="settingsMenuOpen ? 'true' : 'false'"
          aria-haspopup="menu"
          @click="toggleSettingsMenu"
        >
          <span class="association-users__nav-icon mg-rail-icon--settings" aria-hidden="true"></span>
          <span class="mg-rail__label">Settings</span>
        </button>
      </div>
    </aside>

    <div class="mg-shell__main">
      <router-view />
    </div>

    <!-- One event-wide Notifications composer, reachable from any sub-page. -->
    <SendNotificationModal
      v-model="notifyOpen"
      :divisions="notifyDivisions"
      division-id=""
      :event-name="eventName"
      :association-id="associationId"
      :event-id="eventId"
      hide-history
    />

    <!-- Settings popover — teleported + fixed so it escapes the rail clip. -->
    <Teleport to="body">
      <div
        v-if="settingsMenuOpen"
        id="mg-rail-settings-menu"
        class="association-users__row-menu mg-rail__settings-menu"
        role="menu"
        :style="{ position: 'fixed', top: 'auto', left: 'auto', bottom: settingsMenuBottom, right: settingsMenuRight, zIndex: 60 }"
      >
        <button
          v-if="canMatchGeniWrite('edit_event')"
          type="button"
          class="association-users__row-menu-item"
          role="menuitem"
          @click="onEditEvent"
        >Edit Event</button>
        <template v-if="canMatchGeniWrite('edit_event') && workflowTransitions.length">
          <div class="association-users__row-menu-divider" role="separator" aria-hidden="true"></div>
          <button
            v-for="t in workflowTransitions"
            :key="t.target"
            type="button"
            class="association-users__row-menu-item"
            :class="{ 'association-users__row-menu-item--danger': t.danger }"
            role="menuitem"
            @click="onWorkflowTransition(t.target)"
          >{{ t.label }}</button>
        </template>
      </div>
    </Teleport>

    <!-- Share popup — same EventShareModal the events list uses. -->
    <EventShareModal :event="sharingEvent" @close="closeShareModal" />

    <!-- Edit Event — the MatchGeni event wizard, opened from Settings → Edit Event. -->
    <MatchGeniEventFormModal
      v-model="eventFormOpen"
      :association-name="associationShortName"
      :event-id="eventId"
      @saved="onEventEdited"
    />

    <!-- Event lifecycle confirm (Publish / Mark Completed / Cancel). -->
    <Teleport to="body">
      <Transition name="slide-modal-backdrop">
        <div
          v-if="confirmingTransition"
          class="association-switcher-backdrop"
          role="presentation"
          @click="onTransitionBackdrop"
        >
          <div class="association-switcher-panel association-confirm-panel" role="alertdialog" aria-modal="true" aria-labelledby="mg-rail-transition-title">
            <header class="association-switcher-panel__header">
              <h2 id="mg-rail-transition-title" class="association-switcher-panel__title">{{ confirmingTransition.label }}</h2>
              <button type="button" class="association-switcher-panel__close" aria-label="Close" :disabled="confirmTransitionSaving" @click="cancelTransition">
                <AppIcon name="close" :size="16" />
              </button>
            </header>
            <div class="association-confirm-panel__body">
              <p class="association-confirm-panel__copy">
                <strong>{{ matchGeniContext?.event.eventName }}</strong> —
                {{ transitionConfirmCopy(confirmingTransition.target) }}
              </p>
            </div>
            <footer class="association-confirm-panel__footer">
              <button type="button" class="secondary-button" :disabled="confirmTransitionSaving" @click="cancelTransition">Cancel</button>
              <button v-if="confirmingTransition.danger" type="button" class="danger-light-button" :disabled="confirmTransitionSaving" @click="confirmTransition">{{ confirmTransitionSaving ? 'Saving…' : `Yes, ${confirmingTransition.label.toLowerCase()}` }}</button>
              <button v-else type="button" class="primary-button" :disabled="confirmTransitionSaving" @click="confirmTransition">{{ confirmTransitionSaving ? 'Saving…' : confirmingTransition.label }}</button>
            </footer>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
/* App-shell like the association portal: the page's MatchGeniHeader spans
   the FULL width at the top (sticky), and the nav rail sits BELOW it on the
   left, with the page content inset to clear the rail.

   The header lives inside each view (router-view → .mg-shell__main). We pad
   the content column left by the rail width, then let the sticky header
   break back out to full viewport width with a negative margin (its `width:
   auto` refills the freed space). Body content stays inset; header is
   full-bleed — matching the portal's topbar-over-sidebar layout. */
/* `--mg-rail-width` = the width the rail insets the content by (NOT the hover
   overlay width). Descendants — including `position: fixed` chrome like the
   scheduler's source-toggle — read it to offset themselves clear of the rail. */
.mg-shell { display: block; min-height: 100vh; --mg-rail-width: 240px; }
.mg-shell--collapsed { --mg-rail-width: 64px; }

.mg-rail {
  position: fixed;
  top: var(--matchgeni-header-height, 56px);
  left: 0;
  width: 240px;
  bottom: 0;
  overflow-x: hidden;
  overflow-y: auto;
  /* No visible scrollbar inside the rail — keep it scrollable on very short
     viewports but hide the chrome so the menu reads as a clean panel. */
  scrollbar-width: none;
  -ms-overflow-style: none;
  z-index: 40;
  background: var(--white, #fff);
  border-right: 1px solid var(--border-divider);
  padding: 20px 10px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  transition: width 160ms ease, box-shadow 160ms ease;
}
.mg-rail::-webkit-scrollbar { width: 0; height: 0; }
html.dark-mode .mg-rail { background: var(--surface-card); }

.mg-rail__nav { gap: 2px; }
.mg-rail__notify { width: 100%; border: none; background: transparent; font: inherit; text-align: left; }
/* Labels slide in/out by fading (the rail's width animates the slot). */
.mg-rail__label { white-space: nowrap; transition: opacity 120ms ease; }

/* Collapsed (sub-pages): icon-only rail; labels hidden until hover, where
   the rail widens as an OVERLAY (fixed + raised) so page content stays put. */
.mg-rail--collapsed { width: 64px; }
.mg-rail--collapsed .mg-rail__label { opacity: 0; }
.mg-rail--collapsed:hover { width: 240px; box-shadow: 8px 0 28px rgba(15, 23, 42, 0.16); }
.mg-rail--collapsed:hover .mg-rail__label { opacity: 1; }
.mg-rail--collapsed .association-users__nav-item { overflow: hidden; }
/* Collapsed + not hovered: each item is a centered 44px square (icon
   centered, no label gutter) so the active highlight reads as a tidy
   square rather than a stretched, left-aligned pill. Reverts on hover. */
.mg-rail--collapsed:not(:hover) { padding-left: 0; padding-right: 0; }
.mg-rail--collapsed:not(:hover) .association-users__nav-item,
.mg-rail--collapsed:not(:hover) .mg-rail__notify {
  width: 44px;
  height: 44px;
  margin: 0 auto;
  padding: 0;
  gap: 0;
  justify-content: center;
}
/* Footer action pills collapse to a 36px circle (same as the expanded
   Settings pill) — not the 44px nav squares, so it doesn't grow on collapse. */
.mg-rail--collapsed:not(:hover) .mg-rail__action {
  width: 36px;
  height: 36px;
  margin: 0 auto;
  padding: 0;
  gap: 0;
  justify-content: center;
}
/* Collapse the label to zero width (not just opacity) so it stops
   occupying flex space — otherwise the centered icon is pushed left and
   clipped by the item's overflow. */
.mg-rail--collapsed:not(:hover) .mg-rail__label {
  width: 0;
  overflow: hidden;
}
/* Collapsed: the action row stacks vertically as icon-only squares too. */
.mg-rail--collapsed:not(:hover) .mg-rail__actions { flex-direction: column; gap: 10px; }
.mg-shell__main { padding-left: 240px; box-sizing: border-box; min-width: 0; }
/* Header breaks out of the content inset to span the full viewport width. */
.mg-shell__main :deep(.matchgeni-header) { margin-left: -240px; }
/* Sub-pages: content clears only the COLLAPSED rail width, so the hover
   expansion overlays the content without shifting it. */
.mg-shell--collapsed .mg-shell__main { padding-left: 64px; }
.mg-shell--collapsed .mg-shell__main :deep(.matchgeni-header) { margin-left: -64px; }

/* Rail icons — reuse the global `.association-users__nav-icon` base (mask
   sizing + secondary/active tint); each modifier just sets the mask image. */
.mg-rail-icon--dashboard { -webkit-mask-image: url('../assets/dashboard.svg'); mask-image: url('../assets/dashboard.svg'); }
.mg-rail-icon--division { -webkit-mask-image: url('../assets/division.svg'); mask-image: url('../assets/division.svg'); }
.mg-rail-icon--calendar { -webkit-mask-image: url('../assets/calendar.svg'); mask-image: url('../assets/calendar.svg'); }
.mg-rail-icon--field { -webkit-mask-image: url('../assets/field-line.svg'); mask-image: url('../assets/field-line.svg'); }
.mg-rail-icon--teams { -webkit-mask-image: url('../assets/teams.svg'); mask-image: url('../assets/teams.svg'); }
.mg-rail-icon--officials { -webkit-mask-image: url('../assets/admin.svg'); mask-image: url('../assets/admin.svg'); }
.mg-rail-icon--umpire { -webkit-mask-image: url('../assets/umpire-line.svg'); mask-image: url('../assets/umpire-line.svg'); }
.mg-rail-icon--park { -webkit-mask-image: url('../assets/park.svg'); mask-image: url('../assets/park.svg'); }
.mg-rail-icon--location { -webkit-mask-image: url('../assets/location.svg'); mask-image: url('../assets/location.svg'); }
.mg-rail-icon--notification { -webkit-mask-image: url('../assets/notification.svg'); mask-image: url('../assets/notification.svg'); }
.mg-rail-icon--discussions { -webkit-mask-image: url('../assets/chat.svg'); mask-image: url('../assets/chat.svg'); }
.mg-rail-icon--settings { -webkit-mask-image: url('../assets/settings.svg'); mask-image: url('../assets/settings.svg'); }
.mg-rail-icon--view { -webkit-mask-image: url('../assets/external-link.svg'); mask-image: url('../assets/external-link.svg'); }
.mg-rail-icon--share { -webkit-mask-image: url('../assets/share.svg'); mask-image: url('../assets/share.svg'); }
/* Footer event actions — rounded pills (Settings icon-only + its menu, then
   View / Share as icon + text), pinned to the bottom of the rail. */
.mg-rail__actions { display: flex; flex-direction: row; align-items: center; flex-wrap: nowrap; gap: 6px; }
/* Footer row: Theme toggle pinned left, Settings pinned right. (In the
   collapsed icon-column the items pack to content height, so this only
   spreads them in the expanded row.) */
.mg-rail__footer { justify-content: space-between; }
.mg-rail__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 0;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--border-divider);
  border-radius: 999px;
  background: var(--white, #fff);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}
html.dark-mode .mg-rail__action { background: rgba(255, 255, 255, 0.04); }
.mg-rail__action:hover { background: var(--primary-light-3, #e5f1ff); border-color: var(--primary-light-2, #b9d4f4); color: var(--text); }
html.dark-mode .mg-rail__action:hover { background: rgba(45, 140, 240, 0.12); border-color: rgba(45, 140, 240, 0.45); }
.mg-rail__action .mg-rail__label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Icon-only footer action (Settings + View Event) — a fixed square so it
   reads as an icon button; its text label is visually hidden (kept for a11y
   via the `app-tooltip` title + aria-label). */
.mg-rail__action--icon { width: 36px; flex: 0 0 auto; padding: 0; }
.mg-rail__action--icon .mg-rail__label { display: none; }
/* Share keeps its icon + text and grows to fill the rest of the footer row
   (Settings + View Event stay fixed squares to its left). View Event + Share
   show whenever the rail is expanded (incl. on hover); only the compact
   (collapsed, not-hovered) bar hides them. */
.mg-rail__action--grow { flex: 1 1 0; }
.mg-rail--collapsed:not(:hover) .mg-rail__action--extra { display: none; }
/* Footer-action icons run smaller than the nav icons. */
.mg-rail__footer .mg-rail__action .association-users__nav-icon { width: 16px; height: 16px; }
/* Theme toggle glyph — amber sun (light) / primary moon (dark). */
.mg-rail__theme-icon { width: 18px; height: 18px; color: #f5a623; }
html.dark-mode .mg-rail__theme-icon { color: var(--primary, #4fa3ff); }
/* `margin-top: auto` pins the separator + the footer actions below it to
   the bottom of the rail column. */
.mg-rail__sep { flex: 0 0 auto; height: 1px; background: var(--border-divider); margin: auto 6px 8px; }
.mg-rail__settings-menu { min-width: 200px; }
/* Drawer backdrop is mobile-only — never shown on desktop (its overlay
   styling lives in the ≤840px block below). */
.mg-rail__backdrop { display: none; }

/* Loading shimmer rows — mirror the nav-item row dims. */
.mg-rail__skel { display: flex; align-items: center; gap: 10px; height: 52px; padding: 0 14px; }
.mg-rail__skel-icon { width: 20px; height: 20px; border-radius: 50%; flex: 0 0 auto; }
.mg-rail__skel-bar { height: 12px; border-radius: 6px; flex: 1 1 auto; max-width: 150px; }
.mg-rail--collapsed:not(:hover) .mg-rail__skel { justify-content: center; padding: 0; gap: 0; }
.mg-rail--collapsed:not(:hover) .mg-rail__skel-bar { display: none; }

/* ≤840px — the rail becomes an OFF-CANVAS LEFT DRAWER toggled by the header's
   hamburger (`mg-rail-drawer` store). Hidden by default (slid out left); the
   content runs full-width with no rail inset. The drawer always renders in the
   FULL/expanded state (the desktop collapse-on-subpage behaviour is neutralized
   here) so every label + footer action shows. */
@media (max-width: 840px) {
  /* Content is never inset by the rail on mobile; header spans full width.
     Clip the off-screen overhang created when the view is pushed right by
     the open drawer.
     MUST be `overflow-x: clip`, NOT `hidden`: `hidden` silently promotes the
     other axis to `overflow-y: auto`, turning `.mg-shell` into a scroll
     container — which re-anchors every `position: sticky` bar inside
     (division pills / Pool-Bracket tabs / pools-bar / date rows) to
     `.mg-shell` instead of the viewport, so they stop pinning to the top as
     the window scrolls. `clip` clips the same overhang without creating a
     scroll container, so the sticky chain keeps working. */
  .mg-shell,
  .mg-shell--collapsed { --mg-rail-width: 0px; }
  .mg-shell { overflow-x: clip; }
  .mg-shell__main,
  .mg-shell--collapsed .mg-shell__main {
    padding-left: 0;
    padding-bottom: 0;
    /* PUSH drawer: tapping the menu icon slides the whole current view
       (sticky header + body) to the right; the menu is revealed in the
       vacated space at the left. */
    transition: transform 220ms ease;
  }
  .mg-shell--drawer-open .mg-shell__main {
    transform: translateX(256px);
    box-shadow: -10px 0 28px rgba(15, 23, 42, 0.28);
  }
  .mg-shell__main :deep(.matchgeni-header),
  .mg-shell--collapsed .mg-shell__main :deep(.matchgeni-header) { margin-left: 0; }

  /* Mask over the pushed-aside view (tap to close). Sits above the content
     but below the menu (z 1200), so only the content reads as dimmed. */
  .mg-rail__backdrop {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 1100;
  }

  .mg-rail {
    top: 0;
    bottom: 0;
    left: 0;
    right: auto;
    width: 256px;
    height: auto;
    flex-direction: column;
    overflow-y: auto;
    overflow-x: hidden;
    border-right: 1px solid var(--border-divider);
    border-top: none;
    padding: 16px 12px;
    transform: translateX(-100%);
    transition: transform 220ms ease;
    z-index: 1200;
  }
  .mg-rail--drawer-open { transform: translateX(0); }

  /* Force the expanded presentation regardless of the `--collapsed` class. */
  .mg-rail--collapsed,
  .mg-rail--collapsed:hover { width: 256px; box-shadow: none; }
  .mg-rail__nav { flex-direction: column; gap: 2px; }
  /* Restore the FULL desktop-expanded nav-item form (the collapsed rules
     shrink each item to a centered 44px square — undo that completely so the
     drawer items read identically to the desktop expanded rail). */
  .mg-rail .association-users__nav-item,
  .mg-rail--collapsed:not(:hover) .association-users__nav-item {
    width: auto;
    height: 52px;
    margin: 0;
    padding: 0 14px;
    gap: 10px;
    justify-content: flex-start;
    /* Undo the Association sidebar's mobile PILL-STRIP treatment (bordered
       999px pills) that leaks in via the shared classes — the drawer must
       read like the desktop expanded rail: flat full-width rows. */
    border: none;
    border-radius: 8px;
    background: transparent;
    font-size: 0.92rem;
    white-space: normal;
  }
  .mg-rail .mg-rail__label,
  .mg-rail--collapsed:not(:hover) .mg-rail__label { width: auto; overflow: visible; opacity: 1; }
  /* Nav icons back to the desktop 20px (mobile pill-strip shrinks them to 16). */
  .mg-rail .association-users__nav-item .association-users__nav-icon { width: 20px; height: 20px; }
  /* Hover + active/inactive colours match the desktop rail (override the
     mobile pill-strip's primary-fill active + dark-mode outline). */
  .mg-rail .association-users__nav-item:hover { background-color: rgba(36, 60, 91, 0.06); }
  .mg-rail .association-users__nav-item--active,
  .mg-rail .association-users__nav-item--active:hover {
    background: rgba(45, 140, 240, 0.12);
    border-color: transparent;
    color: var(--primary, #2d8cf0);
  }
  .mg-rail .association-users__nav-item--active .association-users__nav-icon { background-color: var(--primary, #2d8cf0); }
  html.dark-mode .mg-rail .association-users__nav-item:hover { background-color: rgba(255, 255, 255, 0.06); }
  html.dark-mode .mg-rail .association-users__nav-item--active,
  html.dark-mode .mg-rail .association-users__nav-item--active:hover {
    background: rgba(45, 140, 240, 0.12);
    border-color: transparent;
    color: var(--primary, #2d8cf0);
  }
  /* Restore the rail's horizontal padding (collapsed zeroes it). */
  .mg-rail--collapsed:not(:hover) { padding-left: 12px; padding-right: 12px; }
  /* Footer actions: the desktop-expanded row — icon circles (Settings / View /
     portal) + a growing Share pill, everything visible. Undo the collapsed
     "every action is a 36px centered circle" treatment. */
  .mg-rail--collapsed:not(:hover) .mg-rail__actions { flex-direction: row; gap: 6px; }
  .mg-rail--collapsed:not(:hover) .mg-rail__action {
    width: auto;
    height: 36px;
    margin: 0;
    padding: 0 12px;
    gap: 6px;
    justify-content: center;
  }
  .mg-rail--collapsed:not(:hover) .mg-rail__action--icon { width: 36px; flex: 0 0 auto; padding: 0; }
  .mg-rail--collapsed:not(:hover) .mg-rail__action--grow { flex: 1 1 0; }
  .mg-rail--collapsed:not(:hover) .mg-rail__action--extra { display: inline-flex; }
}
</style>
