<script setup lang="ts">
// MatchGeniHeader
// ---------------
// Top bar shared by every MatchGeni page. Two variants:
//   - "dashboard"  — opens from an event row. Left: settings gear.
//                    Center: event name + date range. Right: "Close
//                    MatchGeni" pill that routes back to the events
//                    portal list.
//   - "sub-page"   — opens from a card on the dashboard (officials,
//                    divisions, schedule, …). Left: "Back to
//                    dashboard" pill. Center: page title + subtitle.
//                    Right: small MatchGeni icon (visual anchor).
//
// Both variants render as a `position: sticky; top: 0` bar so the
// content below scrolls under them. The MatchGeni page bodies handle
// their own padding-top via the parent grid layout.

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import StatusBadge from './StatusBadge.vue'
import wifIconUrl from '../assets/wif-icon-only.svg'
import type { EventStatus } from '../types'
import { useRoute, useRouter } from 'vue-router'
import { canEnterMatchGeni, matchGeniContext } from '../matchgeni-context'
import { toggleRailDrawer } from '../mg-rail-drawer'
import { requestShare, requestViewEvent } from '../matchgeni-share-center'

const route = useRoute()
const router = useRouter()
const associationShortName = computed(() => (route.params.associationShortName as string | undefined) ?? '')

// Back to association portal — MatchGeni is a separate frontend/domain, so
// this exits to the portal's events list.
function onBackToPortal() {
  router.push({ name: 'association-events', params: { associationShortName: associationShortName.value } })
}

const props = withDefaults(defineProps<{
  variant: 'dashboard' | 'sub-page'
  /** Title text — event name on dashboard variant, page name on
   *  sub-page variant. */
  title: string
  /** Secondary line. On dashboard: pre-formatted date range
   *  (`Event.dateRangeLabel`). On sub-page: event name so the user
   *  always knows which event the sub-page belongs to. */
  subtitle?: string
  /** Event id (numeric PK string) — used by the sub-page "Back"
   *  button to route back to the dashboard. Required when
   *  `variant === 'sub-page'`. The matchgeni URL carries the
   *  numeric id per the route definition in `src/router.ts`. */
  eventId?: string
  /** When `true`, the title + subtitle slots render shimmer
   *  placeholders instead of the real strings. Used while the
   *  matchgeni access (`my-permissions`) + dashboard fetches are
   *  in flight on entry — the access call decides whether the
   *  user can be inside MatchGeni at all, so we shouldn't paint
   *  the event identity until it confirms. */
  loading?: boolean
}>(), {
  subtitle: '',
  eventId: '',
  loading: false
})

// ── User-avatar menu + theme toggle ──────────────────────────────
// The matchgeni-header takes over the app-level topbar's role on
// matchgeni routes (App.vue's `showTopbar` excludes `/matchgeni`
// paths so we don't double-stack two headers). We host the theme
// toggle + user-avatar dropdown here so the affordances stay
// reachable while the user is inside the matchgeni surface.


// ── Responsive header chrome ─────────────────────────────────────
// The dashboard header carries up to four chips on the left:
//   Settings · View Event · Share · (Close, on the right)
//
// At desktop / tablet widths, View Event and Share have their own
// standalone icon buttons. As the viewport squeezes below 720px
// the row would crowd, so both buttons disappear and the same
// affordances move into the Settings popover.
//
// The Settings cog itself has a smart visibility rule:
//   - Desktop: hidden when the user has no settings-menu content
//     (no `edit_event` / `manage_hotels` / `manage_sponsors`) —
//     opening an empty popover is dead UI.
//   - Compact (≤720px): ALWAYS visible regardless of permission,
//     because it's now the host for the migrated View Event +
//     Share items so a read-only caller still needs a way to
//     reach them.
//
// `isCompactViewport` tracks the `(max-width: 720px)` media
// query reactively via the matchMedia API — no resize event
// throttling, the browser does the right thing.
// ── Event-status badge helpers ──────────────────────────────────
// Mirror the same `statusBadgeTone` / `statusBadgeLabel` helpers
// used on `AssociationEventsView` so the badge in the matchgeni
// header reads identical to the events-list badge (Published →
// green pill, Cancelled → red, Draft / Completed → neutral grey).
function statusBadgeTone(status: EventStatus): 'success' | 'warning' | 'neutral' | 'danger' {
  switch (status) {
    case 'published': return 'success'
    case 'draft':     return 'neutral'
    case 'completed': return 'neutral'
    case 'cancelled': return 'danger'
    default:          return 'neutral'
  }
}
function statusBadgeLabel(status: EventStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

// No scroll-position tracking — the matchgeni header is the only
// chrome on every matchgeni page (the app-level topbar is hidden
// on `/matchgeni` routes, see App.vue's `showTopbar` exclusion),
// so the WIF brand mark on its left side is always visible and we
// don't need to swap chrome in/out based on whether the header is
// pinning. The chained sticky stack below (park toolbar, date
// strip, thead) is driven purely by CSS `position: sticky` against
// the published `--matchgeni-header-height` variable — no
// IntersectionObserver / sentinel / `isStuck` flag.
const headerRef = ref<HTMLElement | null>(null)
let headerResizeObserver: ResizeObserver | null = null

/** Publish the matchgeni-header's rendered height as a CSS
 *  variable on the document root so any sticky element under it
 *  (the divisions toolbar, the right column, future sub-page
 *  toolbars) can read `top: var(--matchgeni-header-height)` and
 *  pin flush with no gap.
 *
 *  Was a hardcoded `top: 74px` before — that drifted out of sync
 *  with the actual rendered height (varies with title wrap on
 *  narrow viewports, padding tweaks, etc.) and produced the
 *  visible gap the user reported. Computed at runtime now. */
function publishHeaderHeight() {
  const el = headerRef.value
  if (!el) return
  const height = el.getBoundingClientRect().height
  // `Math.floor` (not `round` or `ceil`) so the published height
  // is always <= the element's actual rendered height. Chained
  // sticky elements use this as their `top:` offset, and an
  // under-estimate causes a 0–1px overlap (harmless, both
  // surfaces are opaque) whereas an over-estimate leaves a
  // sub-pixel gap of page background visible between the sticky
  // rows. Same reason the scheduler's own park / date-strip
  // publishers use floor.
  document.documentElement.style.setProperty(
    '--matchgeni-header-height',
    `${Math.floor(height)}px`
  )
}

onMounted(() => {
  // Header-height publisher — runs now + on every resize so the
  // CSS variable stays in sync as the title wraps / unwraps.
  publishHeaderHeight()
  if (typeof ResizeObserver !== 'undefined' && headerRef.value) {
    headerResizeObserver = new ResizeObserver(() => publishHeaderHeight())
    headerResizeObserver.observe(headerRef.value)
  }
  window.addEventListener('resize', publishHeaderHeight)
  // Re-publish after the next render frame so the variable
  // reflects the resolved-content height (not the shimmer
  // placeholder's), and once more shortly after to cover the
  // brief moment when Vue swaps title text from undefined to
  // the real string. Cheap insurance against a 1–2px gap
  // between the matchgeni header and downstream chained sticky
  // rows on first paint.
  nextTick(publishHeaderHeight)
  setTimeout(publishHeaderHeight, 50)
  // Re-publish whenever the shimmer state flips — the title +
  // subtitle text drives header height, and the shimmer
  // placeholders may render at a different size than the
  // resolved strings. Without this, downstream chained sticky
  // rows would use a stale (shimmer-era) header height for one
  // render frame after the access fetch resolves.
  watch(() => props.loading, async () => {
    await nextTick()
    publishHeaderHeight()
  })
})
onBeforeUnmount(() => {
  if (headerResizeObserver) headerResizeObserver.disconnect()
  window.removeEventListener('resize', publishHeaderHeight)
  // Don't clear the CSS variable — a brief flash to default
  // during route transitions is worse than a stale value that's
  // about to be overwritten by the next view's header.
})
</script>

<template>
  <header
    ref="headerRef"
    class="matchgeni-header"
    :data-variant="variant"
  >
    <!-- LEFT slot: mobile menu hamburger + WIF logo -->
    <div class="matchgeni-header__left">
      <!-- Mobile-only hamburger — opens the left nav rail as a slide-in
           drawer (the rail's persistent desktop form is hidden on mobile). -->
      <button
        type="button"
        class="matchgeni-header__menu-btn"
        aria-label="Open menu"
        @click="toggleRailDrawer"
      >
        <span class="matchgeni-header__menu-icon" aria-hidden="true"></span>
      </button>
      <!-- WIF logo — ALWAYS visible on matchgeni pages (both
           dashboard + sub-pages). The app-level topbar is hidden
           on matchgeni routes (see `App.vue`'s `showTopbar`
           exclusion), so this is the only place brand identity
           surfaces while the user is inside matchgeni. Previously
           gated on `isStuck` because the global topbar carried
           the logo at rest; with that topbar gone, the matchgeni
           header owns the brand anchor responsibility now. -->
      <img
        :src="wifIconUrl"
        alt="Who I Follow"
        class="matchgeni-header__brand-img"
      />
      <!-- Settings / View Event / Share moved to the MatchGeni left nav
           rail (MatchGeniEventLayout) — the header left now holds only the
           brand mark. -->
      <!-- Sub-page "Back to dashboard" removed — the persistent MatchGeni
           left nav rail now provides navigation from every sub-page. -->
    </div>

    <!-- CENTER title block. While the access + dashboard fetches
         are in flight, render shimmer placeholders instead of the
         real strings so the user doesn't see "MatchGeni" / blank
         flash while permissions are still being verified.
         On the sub-page variant we render the page-anchor icon
         INLINE on the left of the title (was on the far right of
         the header previously) so the title row reads as a single
         "[icon] Field Grid" unit, with the event name + date range
         stacked beneath it. The right slot now only houses the
         theme toggle + user avatar (and the close ✕ on dashboard);
         no anchor icon on the right of sub-page headers. -->
    <div class="matchgeni-header__title">
      <template v-if="loading">
        <span class="shimmer-block matchgeni-header__title-skeleton matchgeni-header__title-skeleton--main" aria-hidden="true"></span>
        <span class="shimmer-block matchgeni-header__title-skeleton matchgeni-header__title-skeleton--sub" aria-hidden="true"></span>
      </template>
      <template v-else>
        <!-- Page title — anchor icon was removed; the page title
             alone is the headline. Subtitle (event name) + date
             range render on their own muted lines below.
             On the DASHBOARD variant the title IS the event name,
             so a `:title` tooltip surfaces the date range on
             hover (same affordance the sub-page subtitle has). On
             sub-pages the title is the page name ("Field Grid")
             — no event-name tooltip there, since the event-name
             line below already carries it. */ -->
        <!-- Dashboard variant — the title is the event name, so
             the hover affordance shows the event date range. Uses
             the `.app-tooltip` utility (same dark-bubble tooltip
             that paints over the matchgeni header's Settings /
             View Event / Share icon buttons), driven off
             `data-tooltip`. `:data-tooltip` is suppressed
             (`undefined` → attribute removed) on sub-page variant
             since the title there is just the page name and the
             event-name tooltip lives on the subtitle row below. -->
        <div class="matchgeni-header__title-main-row">
          <!-- Title-main slot — lets a host replace the plain page title
               with an interactive control (e.g. the division switcher on
               the division page when the bracket canvas is fullscreen).
               Falls back to the `<h1>` page title otherwise. -->
          <slot name="title-main">
            <h1
              class="matchgeni-header__title-main"
              :class="{
                'app-tooltip': variant === 'dashboard' && !!matchGeniContext?.event.dateRange
              }"
              :data-tooltip="
                variant === 'dashboard' && matchGeniContext?.event.dateRange
                  ? matchGeniContext.event.dateRange
                  : undefined
              "
            >{{ title }}</h1>
          </slot>
          <!-- Title-suffix slot — optional inline content rendered
               right next to the page title. The field-grid view
               uses it to put the scoring permission badge ("All
               games (Full Control)" / "Scoring: 2 parks") beside
               the "Field Grid" title so the badge sits with its
               semantic anchor rather than below the toolbar. -->
          <slot name="title-suffix" />
        </div>
        <!-- Subtitle — on dashboard variant carries the event date
             range; we prepend the event-status badge so admins
             always see the current lifecycle state at a glance.
             Sub-page variants use subtitle for the parent event
             name, so the badge is skipped there. -->
        <!-- Sub-page variant — subtitle row carries the event
             name, so the hover affordance shows the event date
             range via the shared `.app-tooltip` utility (same
             dark bubble that paints over the matchgeni header
             icon buttons). Driven off `data-tooltip`. Dashboard
             variant uses the subtitle FOR the date range itself,
             so the tooltip class + data is suppressed there
             (would just repeat the visible label). -->
        <p
          v-if="subtitle"
          class="matchgeni-header__title-sub"
          :class="{
            'app-tooltip': variant === 'sub-page' && !!matchGeniContext?.event.dateRange
          }"
          :data-tooltip="
            variant === 'sub-page' && matchGeniContext?.event.dateRange
              ? matchGeniContext.event.dateRange
              : undefined
          "
        >
          <StatusBadge
            v-if="variant === 'dashboard' && matchGeniContext?.event.eventStatus"
            class="matchgeni-header__status-badge"
            :label="statusBadgeLabel(matchGeniContext.event.eventStatus)"
            :tone="statusBadgeTone(matchGeniContext.event.eventStatus)"
          />
          <span>{{ subtitle }}</span>
        </p>
      </template>
    </div>

    <!-- RIGHT slot: theme toggle + user-avatar menu (the app-level
         topbar is hidden on matchgeni routes, so these affordances
         live here), then either the close X (dashboard) or the
         sub-page anchor icon. -->
    <div class="matchgeni-header__right">
      <!-- Back to association portal — MatchGeni runs on its own domain, so
           this is the way out to the portal. Icon + text on tablet/desktop,
           icon-only on mobile. Gated on portal access.
           TODO(temp): restore `v-if="canEnterAssociation"` once the backend
           ships association permissions in the my-permissions response. -->
      <button
        v-if="canEnterMatchGeni"
        type="button"
        class="matchgeni-header__portal-btn app-tooltip"
        :data-tooltip="`Go to ${associationShortName} portal`"
        :aria-label="`Go to ${associationShortName} portal`"
        @click="onBackToPortal"
      >
        <span class="matchgeni-header__portal-icon" aria-hidden="true"></span>
        <span class="matchgeni-header__portal-label">{{ associationShortName }}</span>
      </button>
      <!-- View Event + Share — icon + text pills (collapse to icon-only on
           mobile, like the portal pill). They trigger the layout-hosted
           targets via the header-action signals. -->
      <button
        v-if="canEnterMatchGeni"
        type="button"
        class="matchgeni-header__action-btn app-tooltip"
        data-tooltip="View public event page"
        aria-label="View public event page"
        @click="requestViewEvent"
      >
        <span class="matchgeni-header__view-event-icon" aria-hidden="true"></span>
        <span class="matchgeni-header__action-label">View Event</span>
      </button>
      <button
        v-if="canEnterMatchGeni"
        type="button"
        class="matchgeni-header__action-btn app-tooltip"
        data-tooltip="Share event"
        aria-label="Share event"
        @click="requestShare"
      >
        <span class="matchgeni-header__share-icon" aria-hidden="true"></span>
        <span class="matchgeni-header__action-label">Share</span>
      </button>
      <!-- Theme toggle moved to the event menu (rail) footer; the user avatar /
           login menu was removed (MatchGeni runs on its own domain — no
           account menu here). -->
    </div>
  </header>
</template>

<style scoped>
.matchgeni-header {
  position: sticky;
  top: 0;
  z-index: 50;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 16px;
  /* Fixed 56px on desktop — NOT `max-height: 56px`, otherwise
     the dashboard variant (which has only 2 title rows vs the
     sub-page's 3) would render shorter than sub-page headers and
     the matchgeni chrome would jump between pages. With an exact
     `height: 56px` + `align-items: center` on the grid, every
     page in matchgeni renders an identical-height navy bar. The
     chained sticky stack below reads the published
     `--matchgeni-header-height` (also 56) so its `top:` offset
     stays consistent across pages too. */
  padding: 6px 14px;
  height: 56px;
  box-sizing: border-box;
  /* Multi-layer gradient — mirrors the scheduler park-head's
     two-color radial pattern so the navy chrome reads as the
     same "lifted from two corners" depth treatment.
     Distinct hue families on each side:
       LEFT  — vivid primary-blue glow (warm, brand-aligned)
       RIGHT — cooler silver-violet tint (neutral, contrasting)
     The visible asymmetry between corners is the point — both
     radials in the same hue read as ONE diffuse highlight and
     defeat the depth effect. Larger 60% radii so the glows
     bleed gently toward the centre instead of pooling tightly
     in the corners. */
  background:
    radial-gradient(circle at top left, rgba(79, 163, 255, 0.22), transparent 60%),
    radial-gradient(circle at top right, rgba(196, 184, 220, 0.14), transparent 60%),
    linear-gradient(180deg, #2a567f 0%, #254c72 55%, #20446a 100%);
  color: #fff;
  /* Subtle 1px white-ish bottom edge only — no large blur shadow.
     The previous `0 4px 18px` shadow projected ~22px down and
     painted over the top of any sticky bar pinned beneath the
     header (scheduler's park-select, etc.) creating a visible
     dim band that read as a gap between the chained sticky
     rows. The thin top edge highlight is enough to give the
     header a sense of elevation without bleeding onto the
     stuck content below. */
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.08);
}

/* Dark mode — give the matchgeni bar a slightly lifted navy
   distinct from the global app topbar (which sits at
   `var(--surface-chrome)`). Using a higher-elevation slate-navy
   here so the matchgeni bar reads as a separate band of chrome
   right below the topbar instead of visually merging into it. */
html.dark-mode .matchgeni-header {
  /* Same two-distinct-hue radial pattern as light mode, tuned
     for dark mode — primary-blue glow on the left, silver-
     violet on the right. Alphas slightly lower than light
     because the dark base already absorbs light, so a similar
     visible intensity comes from a smaller alpha. */
  background:
    radial-gradient(circle at top left, rgba(79, 163, 255, 0.18), transparent 60%),
    radial-gradient(circle at top right, rgba(196, 184, 220, 0.10), transparent 60%),
    linear-gradient(180deg, #243450 0%, #1f2c44 55%, #1a2638 100%);
  /* Same logic as the light-mode rule above — drop the large
     blur shadow so it doesn't paint over chained sticky rows
     pinned beneath the header. */
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.05);
}

.matchgeni-header__left {
  display: flex;
  align-items: center;
  /* Visually match the right cluster: its avatar uses a 2px `outline`
     (drawn outside the box, eating into the gap) while these buttons use an
     inset border, so an equal `gap` reads looser here — trim 2px to match. */
  gap: 6px;
  justify-self: start;
}

/* Mobile menu hamburger — opens the left nav rail drawer. Hidden on
   desktop/tablet (the rail is persistent there); shown ≤840px before the
   logo. White line-icon to read against the navy header. */
.matchgeni-header__menu-btn {
  display: none;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  border: none;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  padding: 0;
}
.matchgeni-header__menu-btn:hover { background: rgba(255, 255, 255, 0.12); }
.matchgeni-header__menu-icon,
.matchgeni-header__menu-icon::before,
.matchgeni-header__menu-icon::after {
  display: block;
  width: 18px;
  height: 2px;
  border-radius: 2px;
  background: #fff;
  position: relative;
}
.matchgeni-header__menu-icon::before,
.matchgeni-header__menu-icon::after {
  content: '';
  position: absolute;
  left: 0;
}
.matchgeni-header__menu-icon::before { top: -6px; }
.matchgeni-header__menu-icon::after { top: 6px; }
@media (max-width: 840px) {
  .matchgeni-header__menu-btn { display: inline-flex; }
}

/* WIF brand image — only renders while the header is stuck (see
   `v-if="isStuck"` in the template). Sized to fit comfortably
   inside the slim header bar. */
.matchgeni-header__brand-img {
  height: 24px;
  width: auto;
  display: block;
  flex: 0 0 auto;
  /* The asset ships with the blue (#188EF5) brand color baked in.
     Inside the dark navy matchgeni-header we want it white instead
     so it reads cleanly against the bar. `brightness(0)` collapses
     the SVG to pure black, then `invert(1)` flips that to pure
     white — net effect is a re-tinted icon with no extra asset. */
  filter: brightness(0) invert(1);
}

.matchgeni-header__right {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-self: end;
}

/* Back to portal — primary-blue pill in the right cluster, before the theme
   toggle. Icon + text on tablet/desktop; icon-only circle on mobile (≤840). */
.matchgeni-header__portal-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 13px;
  flex: 0 0 auto;
  border: none;
  border-radius: 999px;
  background: var(--primary, #2d8cf0);
  /* `var(--white)` (not `#fff`) so the label matches our primary buttons:
     white-on-blue in light mode, and dark-on-light-blue in dark mode
     (`--white` = #1a2028 there), same as the "New" / invite primary btn. */
  color: var(--white, #ffffff);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 120ms ease;
}
.matchgeni-header__portal-btn:hover { background: var(--primary-dark, #1f78d4); }
.matchgeni-header__portal-icon {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  /* Match the label colour (white in light, dark in dark mode). */
  background-color: var(--white, #ffffff);
  -webkit-mask: url('../assets/association-twotone.svg') center / contain no-repeat;
  mask: url('../assets/association-twotone.svg') center / contain no-repeat;
}
.matchgeni-header__portal-label { white-space: nowrap; text-transform: uppercase; letter-spacing: 0.02em; }
@media (max-width: 840px) {
  .matchgeni-header__portal-btn { width: 34px; padding: 0; justify-content: center; }
  .matchgeni-header__portal-label { display: none; }
}

/* View Event + Share — translucent white-on-navy pills (icon + text) in the
   right cluster, after the portal pill. Collapse to icon-only circles on
   mobile, exactly like the portal button. */
.matchgeni-header__action-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 13px;
  flex: 0 0 auto;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease;
}
.matchgeni-header__action-btn:hover {
  background: rgba(255, 255, 255, 0.18);
  border-color: rgba(255, 255, 255, 0.32);
}
.matchgeni-header__action-label { white-space: nowrap; }
@media (max-width: 840px) {
  .matchgeni-header__action-btn { width: 34px; padding: 0; justify-content: center; }
  .matchgeni-header__action-label { display: none; }
}

/* Right-cluster tooltips (Portal + theme toggle) — keep the default BELOW
   placement but anchor to the button's RIGHT edge so the bubble grows
   leftward and never overflows past the viewport's right side. */
.matchgeni-header__portal-btn.app-tooltip::after,
.matchgeni-header__action-btn.app-tooltip::after,
.matchgeni-header__theme-toggle.app-tooltip::after {
  left: auto;
  right: 0;
  transform: translateX(0) translateY(-2px);
}
.matchgeni-header__portal-btn.app-tooltip:hover::after,
.matchgeni-header__action-btn.app-tooltip:hover::after,
.matchgeni-header__theme-toggle.app-tooltip:hover::after,
.matchgeni-header__portal-btn.app-tooltip:focus-visible::after,
.matchgeni-header__action-btn.app-tooltip:focus-visible::after,
.matchgeni-header__theme-toggle.app-tooltip:focus-visible::after {
  transform: translateX(0) translateY(0);
}
.matchgeni-header__portal-btn.app-tooltip::before,
.matchgeni-header__action-btn.app-tooltip::before,
.matchgeni-header__theme-toggle.app-tooltip::before {
  left: auto;
  right: 14px;
  transform: translateX(0) translateY(-2px);
}
.matchgeni-header__portal-btn.app-tooltip:hover::before,
.matchgeni-header__action-btn.app-tooltip:hover::before,
.matchgeni-header__theme-toggle.app-tooltip:hover::before,
.matchgeni-header__portal-btn.app-tooltip:focus-visible::before,
.matchgeni-header__action-btn.app-tooltip:focus-visible::before,
.matchgeni-header__theme-toggle.app-tooltip:focus-visible::before {
  transform: translateX(0) translateY(0);
}

/* ─── Theme toggle (right cluster) ────────────────────────────
   Same icon language as the app topbar's `.topbar-theme-toggle`
   but sized + tinted for the dark-navy header. White-tinted
   ring that brightens on hover. */
.matchgeni-header__theme-toggle {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease;
}
.matchgeni-header__theme-toggle:hover {
  background: rgba(255, 255, 255, 0.18);
  border-color: rgba(255, 255, 255, 0.32);
}
.matchgeni-header__theme-icon {
  width: 18px;
  height: 18px;
  /* Match the association-portal toggle: sunny amber sun in light mode,
     slate-blue moon in dark mode (rather than a flat white glyph). */
  color: #f5a623;
}
.matchgeni-header__theme-toggle--dark .matchgeni-header__theme-icon {
  color: var(--primary, #4fa3ff);
}

/* ─── User-avatar menu (right cluster) ────────────────────────
   Trigger is a bare button wrapping the TeamAvatar so the
   avatar itself is the visual affordance. Popover anchors to
   the trigger via absolute positioning. */
.matchgeni-header__user {
  position: relative;
  display: inline-flex;
  align-items: center;
}
.matchgeni-header__user-trigger {
  appearance: none;
  background: none;
  border: none;
  padding: 0;
  border-radius: 999px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* Subtle white ring on the avatar so it sits cleanly on the
     dark-navy header. Hover bumps the ring brightness. */
  outline: 2px solid rgba(255, 255, 255, 0.18);
  outline-offset: 0;
  transition: outline-color 120ms ease;
}
.matchgeni-header__user-trigger:hover {
  outline-color: rgba(255, 255, 255, 0.45);
}
.matchgeni-header__user-trigger:focus-visible {
  outline-color: #ffffff;
}
.matchgeni-header__user-menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 60;
  min-width: 220px;
  padding: 4px;
  border-radius: 8px;
  background: var(--white);
  border: 1px solid var(--border-divider);
  box-shadow: 0 12px 32px rgba(13, 30, 58, 0.16);
  display: flex;
  flex-direction: column;
}
html.dark-mode .matchgeni-header__user-menu {
  background: var(--surface-card);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
}
.matchgeni-header__user-email {
  padding: 8px 12px 6px;
  font-size: 12px;
  color: var(--secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 260px;
  border-bottom: 1px solid var(--border-divider);
  margin-bottom: 4px;
}
.matchgeni-header__user-menu-item {
  appearance: none;
  background: none;
  border: none;
  text-align: left;
  width: 100%;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  cursor: pointer;
  transition: background 120ms ease;
}
.matchgeni-header__user-menu-item:hover {
  background: var(--surface-raised);
}

.matchgeni-header__title {
  /* Block stack — title headline (icon + h1), then subtitle, then
     date range. The icon is anchored to the FIRST ROW only (the
     headline div below) instead of being centered against the
     whole text stack. Tight line-heights + 1px gaps keep the
     three-row stack inside the 56px header height. */
  text-align: center;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  line-height: 1.15;
}

/* Inline row that wraps the `<h1>` title + the optional
   `title-suffix` slot (used by the field-grid view to surface
   the scoring permission badge beside the page name). Flex
   row with a small gap so the badge sits at the title's
   right edge. */
.matchgeni-header__title-main-row {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-width: 0;
}
.matchgeni-header__title-main {
  margin: 0;
  /* Slimmed from 18px → 15px so the title row fits inside the
     56px-capped header alongside the subtitle + date range. */
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.01em;
  line-height: 1.15;
  color: #fff;
}

.matchgeni-header__title-sub {
  /* Tightened from `margin: 4px 0 0` → `margin: 1px 0 0` to
     squeeze the three title rows into the 56px header. */
  margin: 1px 0 0;
  font-size: 11px;
  line-height: 1.2;
  color: rgba(255, 255, 255, 0.78);
  /* Inline-flex so the optional `<StatusBadge>` sits on the same
     baseline as the date string with a small gap between them. */
  display: inline-flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
}

/* `.matchgeni-header__title-daterange` rule removed — the
 * dedicated date-range row is gone from sub-page headers. The
 * event date range now surfaces as a `title` tooltip on the
 * event-name subtitle (`__title-sub`), keeping the information
 * accessible on hover without consuming a header row. */

/* Status badge inside the matchgeni header subtitle — make sure
   the pill stays compact and doesn't compete with the title's
   font weight. The base `.status-badge` styling already paints
   the tone-coloured chip; this rule just trims the size a touch
   for the narrower header context. */
.matchgeni-header__status-badge {
  font-size: 11px;
  padding: 2px 8px;
  line-height: 1.2;
}

/* Shimmer placeholders shown in place of the title + subtitle
   while the matchgeni access check is in flight. Sized to match
   the rendered string heights (title-main 18px ≈ 22px box;
   title-sub 13px ≈ 17px box) so the header doesn't change
   height between loading and loaded states. */
.matchgeni-header__title-skeleton {
  display: block;
  margin: 0 auto;
  border-radius: 4px;
  /* Override the global `.shimmer-block` light-mode gradient with
     a translucent-white tone so the placeholder reads against the
     dark navy header background instead of disappearing into it. */
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.10) 0%,
    rgba(255, 255, 255, 0.22) 50%,
    rgba(255, 255, 255, 0.10) 100%
  );
}
.matchgeni-header__title-skeleton--main {
  width: 240px;
  max-width: 70%;
  /* Matches the loaded title-main height (15px font × 1.15
     line-height ≈ 18px) so the header doesn't change size when
     loading flips off. Was 22px when title was 18px. */
  height: 18px;
}
.matchgeni-header__title-skeleton--sub {
  width: 180px;
  max-width: 60%;
  /* Matches loaded subtitle height (11px × 1.2 ≈ 14px). */
  height: 13px;
  margin-top: 2px;
}

/* Settings menu root — positioning anchor for the popover that
   opens when the gear is clicked. `position: relative` so the
   `<div v-if="settingsMenuOpen">` child can absolute-position
   itself directly below the button. `display: inline-flex` keeps
   the wrapper participating in the left-cluster flex layout
   exactly as a plain icon button would. */
.matchgeni-header__settings-root {
  position: relative;
  display: inline-flex;
}

/* Settings popover — opens below the gear button, left-aligned
   with the button so the menu hugs the leftmost edge. Reuses the
   shared `.association-users__row-menu` chrome (white panel /
   soft shadow / divider styling) for cross-portal consistency.
   `position: absolute` is scoped to `.matchgeni-header__settings-
   root`. `top: calc(100% + 6px)` parks it just below the button
   with a small breathing gap. */
.matchgeni-header__settings-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  /* Wide enough to fit the longest label ("Mark Completed" /
     "Cancel Event") plus the leading icon glyph without
     wrapping. */
  min-width: 220px;
  /* Inside the dark navy header bar, text colour from the parent
     button is white — but the popover sits on a white surface,
     so reset to the page text colour for the menu items. */
  color: var(--text);
}

/* Menu-item layout — icon on the left, label after. The shared
   `.association-users__row-menu-item` defines the row chrome
   (padding, hover, danger tone); this extension adds the
   icon-first layout. */
.matchgeni-header__settings-menu-item {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}

/* Leading icon glyph — same `mask-image` + `currentColor`
   pattern the sidebar nav + the row-menu external-link icon use,
   so the icon tints with the menu item's text colour (themes
   light + dark uniformly, picks up the hover / danger tones for
   free). */
.matchgeni-header__settings-menu-icon {
  display: inline-block;
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
  background-color: currentColor;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}
.matchgeni-header__settings-menu-icon--edit {
  -webkit-mask-image: url('../assets/edit.svg');
  mask-image: url('../assets/edit.svg');
}
.matchgeni-header__settings-menu-icon--seed {
  -webkit-mask-image: url('../assets/seed-criteria.svg');
  mask-image: url('../assets/seed-criteria.svg');
}
.matchgeni-header__settings-menu-icon--hotel {
  -webkit-mask-image: url('../assets/hotel.svg');
  mask-image: url('../assets/hotel.svg');
}
.matchgeni-header__settings-menu-icon--sponsor {
  -webkit-mask-image: url('../assets/sponsor.svg');
  mask-image: url('../assets/sponsor.svg');
}

/* `.matchgeni-header__settings-menu-item--readonly` rules were
   removed alongside the lifecycle transitions — the configuration
   items above (Edit Event / Seed Criteria / Hotels / Sponsors)
   now use plain `v-if` permission gating so there's no longer a
   permission-denied state to style. */

/* Settings icon button — circle with subtle background. Applies
   to the dashboard variant's left-side actionable buttons. */
.matchgeni-header__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  cursor: pointer;
  transition: background-color 120ms ease;
}

.matchgeni-header__icon-btn:hover {
  background: rgba(255, 255, 255, 0.16);
}

/* Settings glyph — same asset the association portal sidebar uses
   for the Settings nav item. Mask-tinted with the button's
   currentColor (white) so it reads cleanly on the dark navy bar. */
.matchgeni-header__settings-icon {
  width: 18px;
  height: 18px;
  display: block;
  background-color: currentColor;
  -webkit-mask-image: url('../assets/settings.svg');
  mask-image: url('../assets/settings.svg');
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}

/* External-link glyph — shared `assets/external-link.svg` used by
   the association-events row-menu's "View Event" item. Same
   mask-image pattern as the settings icon above so the chevron
   tints with `currentColor` (white on the navy bar). */
.matchgeni-header__view-event-icon {
  width: 18px;
  height: 18px;
  display: block;
  background-color: currentColor;
  -webkit-mask-image: url('../assets/external-link.svg');
  mask-image: url('../assets/external-link.svg');
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}

/* Share glyph — same mask-image pattern as the view-event icon
   above, sourced from the shared `assets/share.svg`. Tints with
   the button's `currentColor` (white on the navy header). */
.matchgeni-header__share-icon {
  width: 18px;
  height: 18px;
  display: block;
  background-color: currentColor;
  -webkit-mask-image: url('../assets/share.svg');
  mask-image: url('../assets/share.svg');
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}

/* `.matchgeni-header__sub-icon*` rules removed — sub-page anchor
   icon (calendar / teams / admin two-tone masked span that used
   to render before the page title) was retired from the header
   on user request. Page title alone is the headline now; event
   name + date range sit beneath as muted sublines. */

/* Back pill — left-aligned arrow + 2-line label. */
.matchgeni-header__back-btn {
  appearance: none;
  background: none;
  border: none;
  color: #fff;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 0;
  font: inherit;
}

/* Back-pill arrow — CSS-masked `arrow-left.svg` painted via
   `currentColor` so it inherits the white text color of the back
   pill. Previously a unicode "←" glyph which renders inconsistently
   across platforms (different fonts give different stroke weights);
   the SVG mask matches the rest of the design library's stroke
   icons exactly. */
.matchgeni-header__back-arrow {
  display: inline-block;
  width: 22px;
  height: 22px;
  background-color: currentColor;
  -webkit-mask-image: url('../assets/arrow-left.svg');
  mask-image: url('../assets/arrow-left.svg');
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}

.matchgeni-header__back-stack {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.1;
}

.matchgeni-header__back-stack strong {
  font-size: 16px;
  /* Regular weight (not the default `<strong>` 700) — `Back` is
     the main line of a two-line back affordance, not an emphasis
     callout. The browser's default bold reading was visually
     heavy against the matchgeni header's slim chrome. */
  font-weight: 400;
  color: #fff;
}

.matchgeni-header__back-stack small {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.78);
}

/* Close MatchGeni pill — ✕ + label. Background / border / hover
   match the settings `.matchgeni-header__icon-btn` on the left so
   the two ends of the header read as a balanced pair (subtle
   white-on-navy chip), just with a wider pill shape to fit the
   "Close MatchGeni" label. */
/* Close-MatchGeni button — icon-only now. Shares the base
   `.matchgeni-header__icon-btn` shape (36×36 white-on-navy chip)
   as the Settings + View Event buttons on the left so all three
   header chrome buttons read as a uniform family. Just an `✕`
   glyph with a tooltip ("Close MatchGeni") via `.app-tooltip
   .app-tooltip--left` — the long label moved out of the button
   surface and into the tooltip layer. */
.matchgeni-header__close-btn {
  font-size: 16px;
  font-weight: 500;
  line-height: 1;
}

/* Shimmer placeholder for the Settings + View Event icon-buttons
   while the matchgeni access fetch is in flight. Dimensions match
   the loaded `.matchgeni-header__icon-btn` so there's no layout
   jump when the data lands and the real buttons replace them.
   Background overridden to a translucent-white gradient so the
   chips read against the navy header bar in light mode — without
   this they inherit the global `.shimmer-block` white/grey gradient
   which disappears into the dark surface. Mirrors the same
   override used on `.matchgeni-header__title-skeleton` above. */
.matchgeni-header__icon-btn-skeleton {
  display: inline-block;
  width: 36px;
  height: 36px;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.10) 0%,
    rgba(255, 255, 255, 0.22) 50%,
    rgba(255, 255, 255, 0.10) 100%
  );
}

@media (max-width: 720px) {
  /* Mobile shared rules — same regardless of variant. The fixed
     desktop `height: 56px` is released here because the two-row
     dashboard mobile layout needs more vertical space, and the
     single-row sub-page mobile layout can be slimmer. Each
     variant sets its own appropriate height below. */
  .matchgeni-header {
    padding: 10px 14px;
    height: auto;
  }
  /* Hide the WIF brand mark on SUB-PAGES only — the back button
     occupies the left slot there, so adding the WIF icon alongside
     would crowd the limited horizontal real estate. On the
     dashboard variant the left slot just holds the (optional)
     settings cog, so the WIF icon fits comfortably and gives the
     compact mobile dashboard a clear brand anchor. */
  .matchgeni-header[data-variant='sub-page'] .matchgeni-header__brand-img {
    display: none;
  }
  .matchgeni-header__title-main {
    font-size: 15px;
  }
  .matchgeni-header__title-sub {
    font-size: 11px;
  }
  /* Mobile back affordance — collapse to icon-only. Hide the WHOLE
     text stack ("Back" + "to dashboard") so the back button is just
     the masked `arrow-left.svg` glyph in the compact header. */
  .matchgeni-header__back-stack {
    display: none;
  }

  /* ── Dashboard variant — two-row layout ──────────────────────
     Left + right slots share row 1 (settings + close). Title
     stack moves onto its OWN row 2 spanning the full width, so
     the centered event name + date range have room to breathe.
     The 56px desktop cap is dropped here because the second row
     necessarily makes the header taller; the chained sticky stack
     below reads the live ResizeObserver-published height, so it
     auto-adapts. Scoped to `data-variant="dashboard"` only — sub-
     pages keep the single-row layout (see rules below). */
  .matchgeni-header[data-variant='dashboard'] {
    grid-template-columns: auto 1fr;
    grid-template-rows: auto auto;
    grid-template-areas:
      'left right'
      'title title';
    row-gap: 6px;
  }
  .matchgeni-header[data-variant='dashboard'] .matchgeni-header__left {
    grid-area: left;
  }
  .matchgeni-header[data-variant='dashboard'] .matchgeni-header__right {
    grid-area: right;
  }
  .matchgeni-header[data-variant='dashboard'] .matchgeni-header__title {
    grid-area: title;
    /* Full-width centered text block on its own row — no longer
       fighting the left/right action clusters for horizontal space. */
    width: 100%;
  }

  /* ── Sub-page variant — keep single-row layout ───────────────
     The title stays on the same row as the back button + right
     action cluster (no second row). Text left-aligned (not
     centered) and aggressively ellipsis-truncated so long event
     names + date ranges don't overlap the right-side theme +
     avatar buttons. `min-width: 0` on the grid cell lets the
     ellipsis kick in (without it, the grid track widens to fit
     the full string and pushes the right cluster off-screen).
     Grid cols change to `auto 1fr auto` so the back button takes
     its natural width on the left, the title cell grows to fill
     the rest, and the right action cluster takes its natural
     width on the right. With the global `gap: 16px` overridden to
     `column-gap: 10px`, the title sits 10px after the back arrow
     instead of being centered in a large blank middle column. */
  .matchgeni-header[data-variant='sub-page'] {
    /* `minmax(0, 1fr)` — NOT plain `1fr`. Plain `1fr` is shorthand
       for `minmax(auto, 1fr)` where the lower bound is the cell's
       intrinsic content minimum. That makes the title track refuse
       to shrink below its widest line of text — long event names
       blow the grid wider than the viewport, the right cluster
       overflows past the viewport edge, and the visible result is
       the title text overlapping the theme/avatar buttons. With
       `minmax(0, 1fr)` the track can shrink to 0, so the title's
       `max-width: 100%` + `overflow: hidden; text-overflow: ellipsis`
       actually trigger at the cell's allocated width. */
    grid-template-columns: auto minmax(0, 1fr) auto;
    column-gap: 10px;
  }
  .matchgeni-header[data-variant='sub-page'] .matchgeni-header__title {
    text-align: left;
    align-items: flex-start;
    min-width: 0;
    justify-self: start;
    /* Force the flex-column to fill its grid cell (instead of
       sizing to the widest child). Without this the column shrinks
       to its widest text content, defeating the children's
       `max-width: 100%` constraint. */
    width: 100%;
  }
  .matchgeni-header[data-variant='sub-page'] .matchgeni-header__title-main {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
    display: block;
  }
  /* Subtitle keeps `display: flex` (NOT inline-flex) so it takes
     the full width of its parent — necessary for the ellipsis on
     the inner `<span>` to clip at the cell's right edge instead of
     at the inline-flex container's natural content width. */
  .matchgeni-header[data-variant='sub-page'] .matchgeni-header__title-sub {
    display: flex;
    justify-content: flex-start;
    width: 100%;
    min-width: 0;
  }
  .matchgeni-header[data-variant='sub-page'] .matchgeni-header__title-sub > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    /* `flex: 1 1 auto` lets the span shrink past its content size
       (combined with `min-width: 0`) so ellipsis can clip mid-word.
       Without it the span sticks at its intrinsic width and the
       overflow blows the parent. */
    flex: 1 1 auto;
  }

  /* `.matchgeni-header__view-event-btn` / `.matchgeni-header__share-btn`
     visibility at this breakpoint is now driven by Vue `v-if`
     (`!isCompactViewport`) inside the template — the same flag
     also flips the View Event + Share menu items inside the
     Settings popover to visible. No CSS hide rule needed. */
}
</style>
