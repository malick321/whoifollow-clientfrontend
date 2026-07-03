import { createRouter, createWebHistory } from 'vue-router'
import TeamParticipationView from './views/TeamParticipationView.vue'
import ParticipationV2 from './views/ParticipationV2.vue'
import ScoresheetView from './views/ScoresheetView.vue'
import ScoresheetReviewView from './views/ScoresheetReviewView.vue'
import HandoffView from './views/HandoffView.vue'
import NotFoundView from './views/NotFoundView.vue'
import AssociationUsersView from './views/AssociationUsersView.vue'
import AssociationEventsView from './views/AssociationEventsView.vue'
import MatchGeniEventLayout from './components/MatchGeniEventLayout.vue'
import MatchGeniDashboardView from './views/MatchGeniDashboardView.vue'
import MatchGeniSchedulerView from './views/MatchGeniSchedulerView.vue'
import MatchGeniUmpiresView from './views/MatchGeniUmpiresView.vue'
import MatchGeniNotificationsView from './views/MatchGeniNotificationsView.vue'
import MatchGeniEventLocationsView from './views/MatchGeniEventLocationsView.vue'
import MatchGeniDiscussionsView from './views/MatchGeniDiscussionsView.vue'
import MatchGeniFacilitiesView from './views/MatchGeniFacilitiesView.vue'
import MatchGeniParticipatingTeamsView from './views/MatchGeniParticipatingTeamsView.vue'
import MatchGeniDivisionDetailView from './views/MatchGeniDivisionDetailView.vue'
import MatchGeniScoringView from './views/MatchGeniScoringView.vue'
import MatchGeniFieldGridView from './views/MatchGeniFieldGridView.vue'
import EventOfficialsView from './views/EventOfficialsView.vue'
import AssociationTeamsView from './views/AssociationTeamsView.vue'
import AssociationTeamDetailsView from './views/AssociationTeamDetailsView.vue'
import AssociationUmpiresView from './views/AssociationUmpiresView.vue'
import AssociationPlayersView from './views/AssociationPlayersView.vue'
import AssociationShopView from './views/AssociationShopView.vue'
import AssociationFollowersView from './views/AssociationFollowersView.vue'
import AssociationSettingsView from './views/AssociationSettingsView.vue'
import AssociationEventSummaryReportView from './views/AssociationEventSummaryReportView.vue'
import PublicEventView from './views/PublicEventView.vue'
import LoginView from './views/LoginView.vue'
import ChatView from './views/ChatView.vue'
import LifeBookListView from './views/LifeBookListView.vue'
import LifeBookEditorView from './views/LifeBookEditorView.vue'
import LifeBookSharedView from './views/LifeBookSharedView.vue'
import CalendarView from './views/CalendarView.vue'
import TasksView from './views/TasksView.vue'
import ShopView from './views/ShopView.vue'
import ShopCheckoutView from './views/ShopCheckoutView.vue'
import ShopOrderConfirmationView from './views/ShopOrderConfirmationView.vue'
import NewGameTimeLayout from './views/NewGameTimeLayout.vue'
import NewGameTimeForYouView from './views/NewGameTimeForYouView.vue'
import NewGameTimeDiscoverEventsView from './views/NewGameTimeDiscoverEventsView.vue'
import NewGameTimeFollowingEventsView from './views/NewGameTimeFollowingEventsView.vue'
import NewGameTimeMyEventsView from './views/NewGameTimeMyEventsView.vue'
import NewGameTimeDiscoverTeamsView from './views/NewGameTimeDiscoverTeamsView.vue'
import NewGameTimeMyTeamsView from './views/NewGameTimeMyTeamsView.vue'
import NewGameTimeFollowingTeamsView from './views/NewGameTimeFollowingTeamsView.vue'
import NewGameTimeDiscoverAssociationsView from './views/NewGameTimeDiscoverAssociationsView.vue'
import NewGameTimeFollowingAssociationsView from './views/NewGameTimeFollowingAssociationsView.vue'
import { isAuthenticated, clearAuthSession } from './auth-session'
import { fetchMyAssociation } from './api/myAssociations'
import { currentAssociation, setCurrentAssociation, clearCurrentAssociation } from './constants/associations'
import { hasPermission, hasAnyPermission } from './lib/permissions'
import { resolveMatchGeniAccess } from './matchgeni-context'
import type { AssociationPermissionKey, EventPermissionKey } from './types'

// Routes that require an authenticated user. If the user hits one of these
// without a saved auth token, the beforeEach guard sends them to the handoff
// view so the parent iframe can hand over credentials.
const PROTECTED_ROUTE_NAMES = new Set([
  'team-participation',
  'team-participation-legacy',
  'team-participation-old',
  'scoresheet',
  'scoresheet-review'
])

function resolveParticipationIdFromRoute(
  params: Record<string, string | undefined>,
  query: Record<string, string | (string | null)[] | undefined>
): string {
  return (
    params.teamParticipationId ??
    params.participationId ??
    (typeof query.team_participation_id === 'string' ? query.team_participation_id : '') ??
    ''
  )
}

const router = createRouter({
  history: createWebHistory(),
  // Reset document scroll to top on forward navigation so moving from the
  // participation page into a game's details doesn't inherit a mid-page
  // scroll offset (which left users confused about what had just loaded).
  // Browser back/forward still restores the previous position via the
  // savedPosition branch — that's native-feeling behavior we want to
  // preserve.
  scrollBehavior(_to, _from, savedPosition) {
    if (savedPosition) return savedPosition
    return { top: 0, left: 0 }
  },
  routes: [
    // Public, unauthenticated event showcase. `meta.public` exempts it
    // from both auth guards below. Keyed by event slug.
    {
      path: '/public/event/:eventSlug',
      name: 'public-event',
      component: PublicEventView,
      meta: { public: true }
    },
    // SEO-friendly event DETAIL page — same PublicEventView component in
    // "detail" mode (no app-promo / sign-in marketing, just the event info).
    // This is where Game Time cards link; slug in the URL, no GUID.
    {
      path: '/event/:eventSlug',
      name: 'event-detail',
      component: PublicEventView,
      meta: { public: true }
    },
    // Standalone login (local/standalone). In the embedded product the parent
    // hands the token over via the handoff flow instead; here the user signs in
    // with email/password and we store the returned token.
    {
      path: '/login',
      name: 'login',
      component: LoginView,
      meta: { public: true }
    },
    // App entry — send members to their personalized feed.
    { path: '/', redirect: { name: 'newgametime-for-you' } },
    // Chat — WhatsApp-style messaging (logged-in members; not anonymous).
    { path: '/chat', name: 'chat', component: ChatView },
    // My Life Book — digital photo-book builder (members; shared flipbook is public)
    { path: '/lifebook', name: 'lifebook', component: LifeBookListView },
    { path: '/lifebook/:guid/edit', name: 'lifebook-editor', component: LifeBookEditorView },
    { path: '/lifebook/shared/:slug', name: 'lifebook-shared', component: LifeBookSharedView, meta: { public: true } },
    // Calendar + My Tasks (Codex-built, members-only)
    { path: '/calendar', name: 'calendar', component: CalendarView },
    { path: '/tasks', name: 'tasks', component: TasksView },
    { path: '/shop', name: 'shop', component: ShopView },
    { path: '/shop/checkout', name: 'shop-checkout', component: ShopCheckoutView },
    { path: '/shop/thanks', name: 'shop-thanks', component: ShopOrderConfirmationView },
    { path: '/opinions', name: 'opinions', component: () => import('./views/OpinionsView.vue') },
    // Player Passport — verified career batting stats (freemium consumer surface).
    { path: '/players/:playerId', name: 'player-passport', component: () => import('./views/PlayerPassportView.vue') },
    { path: '/my/stats', name: 'my-stats', component: () => import('./views/PlayerPassportView.vue') },
    // New Game Time — member surface (general logged-in WhoIFollow users).
    // NOT anonymous: every tab needs a signed-in user + bearer token (the
    // backend list endpoints sit behind auth:api). It is NOT association-
    // permission gated, though — that gating is the separate portal. So no
    // `meta.public` here (these aren't anonymous pages). The layout owns the
    // left nav rail; each tab is a child route in its `<router-view>`.
    // New Game Time — now mounted at TOP-LEVEL paths (no `/game-time` prefix):
    // /events (discover, where the "Game Time" nav lands), /my/events,
    // /events/following, and the same for teams + associations, plus /for-you.
    // The children use ABSOLUTE paths so they render inside NewGameTimeLayout's
    // <router-view> while owning clean top-level URLs. Route NAMES are unchanged
    // so existing name-based links keep working. Old `/game-time/*` paths
    // redirect (below) for back-compat.
    {
      path: '/game-time',
      component: NewGameTimeLayout,
      children: [
        { path: '', redirect: { name: 'newgametime-discover-events' } },
        { path: '/for-you', name: 'newgametime-for-you', component: NewGameTimeForYouView },
        { path: '/events', name: 'newgametime-discover-events', component: NewGameTimeDiscoverEventsView },
        { path: '/events/following', name: 'newgametime-following-events', component: NewGameTimeFollowingEventsView },
        { path: '/my/events', name: 'newgametime-my-events', component: NewGameTimeMyEventsView },
        { path: '/teams', name: 'newgametime-discover-teams', component: NewGameTimeDiscoverTeamsView },
        { path: '/teams/following', name: 'newgametime-following-teams', component: NewGameTimeFollowingTeamsView },
        { path: '/my/teams', name: 'newgametime-my-teams', component: NewGameTimeMyTeamsView },
        { path: '/associations', name: 'newgametime-discover-associations', component: NewGameTimeDiscoverAssociationsView },
        { path: '/associations/following', name: 'newgametime-following-associations', component: NewGameTimeFollowingAssociationsView }
      ]
    },
    // Back-compat: old /game-time/* URLs → the new top-level paths.
    { path: '/game-time/for-you', redirect: { name: 'newgametime-for-you' } },
    { path: '/game-time/events', redirect: { name: 'newgametime-discover-events' } },
    { path: '/game-time/events/following', redirect: { name: 'newgametime-following-events' } },
    { path: '/game-time/events/mine', redirect: { name: 'newgametime-my-events' } },
    { path: '/game-time/teams', redirect: { name: 'newgametime-discover-teams' } },
    { path: '/game-time/teams/following', redirect: { name: 'newgametime-following-teams' } },
    { path: '/game-time/teams/mine', redirect: { name: 'newgametime-my-teams' } },
    { path: '/game-time/associations', redirect: { name: 'newgametime-discover-associations' } },
    { path: '/game-time/associations/following', redirect: { name: 'newgametime-following-associations' } },
    {
      path: '/event/participation/:teamParticipationId',
      name: 'team-participation',
      component: ParticipationV2
    },
    {
      path: '/event/participation/:teamParticipationId/handoff',
      name: 'handoff',
      component: HandoffView
    },
    // Association-scoped handoff variant. Lives INSIDE the `/portal/`
    // namespace — that segment is the canonical "admin boundary" for
    // the association, and the handoff is conceptually the auth gate
    // for entering it (not a sibling of it). Used by the first
    // beforeEach guard when an unauthenticated user navigates to any
    // `/association/<slug>/portal/*` route. After auth lands, the view
    // resolves the user's first permitted portal section for the slug
    // (so a user without `manage_events` doesn't land on the events
    // page) and navigates there.
    //
    // Leaving `/association/:slug/` (bare) and `/association/:slug/*`
    // outside of `/portal/` free for the future PUBLIC association
    // profile pages — visible to anyone without auth.
    {
      path: '/association/:associationShortName/portal/handoff',
      name: 'association-handoff',
      component: HandoffView
    },
    {
      path: '/event/participation-legacy',
      name: 'team-participation-old',
      component: TeamParticipationView
    },
    {
      path: '/events/:eventId/teams/:teamId',
      name: 'team-participation-legacy',
      component: ParticipationV2
    },
    {
      path: '/event/participation/:participationId/team/:teamId/game/:gameGuid',
      name: 'scoresheet',
      component: ScoresheetView
    },
    {
      path: '/event/participation/:participationId/team/:teamId/game/:gameGuid/review',
      name: 'scoresheet-review',
      component: ScoresheetReviewView
    },
    // Association portal — admin-facing pages live under the
    // `/portal/` path segment so:
    //   1. The URL itself signals "this is administration UI" — easy
    //      to gate via path inclusion check (deferred until the
    //      backend lands; auth is not enforced in v1).
    //   2. The non-portal namespace `/association/<slug>/<page>` is
    //      reserved for future PUBLIC-facing association profile
    //      pages (events list, teams roster, etc.) without competing
    //      with admin URLs.
    // Route names are unchanged so every <router-link :to="{ name }">
    // binding keeps working.
    // `meta.requiresPermission` gates each portal route on the user's
    // effective permissions for the current association. Read by the
    // post-handoff guard below — a missing permission redirects to
    // `not-found` (same outcome as 403/404 from the access endpoint).
    // Use `string` for single-permission routes, `string[]` for any-of
    // (e.g. Shop accepts either `manage_products` or `manage_orders`).
    {
      path: '/association/:associationShortName/portal/users',
      name: 'association-users',
      component: AssociationUsersView,
      meta: { requiresPermission: 'manage_users' }
    },
    {
      path: '/association/:associationShortName/portal/events',
      name: 'association-events',
      component: AssociationEventsView,
      meta: { requiresPermission: 'manage_events' }
    },
    // MatchGeni — per-event admin "mode" that opens from an event row's
    // overflow menu. Each sub-page (officials, divisions, schedule, …)
    // reuses the same `:eventId` parent param so saved deep links
    // stay stable across the dashboard / sub-page transitions.
    //
    // The route param is the event's NUMERIC PK (string-serialized,
    // per the v2 convention), NOT the guid. Earlier MatchGeni shipped
    // with the guid in the URL, but every backend endpoint MatchGeni
    // calls (`/my-permissions`, `/officials`, `/resources`, etc.)
    // keys on the numeric id — using the id in the URL too means a
    // page refresh on a deep link doesn't need a guid→id resolve hop
    // before the permission check can fire.
    // ── Matchgeni routes ──────────────────────────────────────────
    // Auth model is DIFFERENT from the portal routes below: matchgeni
    // access is per-EVENT (granted via event-official invitations) and
    // independent of portal-level association permissions. A user
    // with zero portal `manage_*` permissions can still be a valid
    // event scorekeeper / umpire / official for a specific event.
    //
    // Each matchgeni route carries:
    //   - `matchgeniRoute: true`          → tells the beforeEach guard
    //                                       to use `resolveMatchGeniAccess`
    //                                       instead of the portal
    //                                       `requiresPermission` check.
    //   - `matchgeniPermission?: ...`     → per-sub-page permission key.
    //                                       Omitted on the dashboard
    //                                       (any matchgeni access OK).
    //                                       On sub-pages, missing this
    //                                       key bounces the user to the
    //                                       matchgeni dashboard (not
    //                                       not-found — they HAVE
    //                                       matchgeni access, just not
    //                                       this specific sub-page).
    //   - `matchgeniPermissionLabel?: ...`→ human-readable label for the
    //                                       denial toast copy.
    {
      // Shared MatchGeni event shell — fixed left nav rail + the single
      // event-wide Notifications composer, wrapping every sub-page. The
      // children below keep their original route `name`s (so all existing
      // `router.push({ name })` calls are unaffected); only `path` becomes
      // relative. The guard reads `to.meta` (Vue Router merges parent +
      // child), so `matchgeniRoute` (parent) + each child's
      // `matchgeniPermission` resolve correctly.
      path: '/association/:associationShortName/portal/events/:eventId/matchgeni',
      component: MatchGeniEventLayout,
      meta: { matchgeniRoute: true },
      children: [
    {
      path: '',
      name: 'matchgeni-dashboard',
      component: MatchGeniDashboardView,
      // Dashboard — any matchgeni access is sufficient (no per-page
      // permission required). The dashboard is the matchgeni entry
      // point; sub-pages enforce their own permission keys.
      meta: { matchgeniRoute: true }
    },
    {
      path: 'officials',
      name: 'matchgeni-officials',
      component: EventOfficialsView,
      meta: {
        matchgeniRoute: true,
        matchgeniPermission: 'manage_officials',
        matchgeniPermissionLabel: 'Event Officials'
      }
    },
    {
      // Drag-drop game scheduler — division/phase picker on the
      // left, park × date × field grid on the right.
      path: 'scheduler',
      name: 'matchgeni-scheduler',
      component: MatchGeniSchedulerView,
      meta: {
        matchgeniRoute: true,
        matchgeniPermission: 'manage_scheduling',
        matchgeniPermissionLabel: 'Game Scheduler'
      }
    },
    // Matchgeni umpires sub-page — placeholder until the real
    // umpires roster + invite + game-assignment UI lands.
    {
      path: 'umpires',
      name: 'matchgeni-umpires',
      component: MatchGeniUmpiresView,
      meta: {
        matchgeniRoute: true,
        matchgeniPermission: 'manage_umpires',
        matchgeniPermissionLabel: 'Umpires'
      }
    },
    // Matchgeni facilities (parks) sub-page — placeholder.
    {
      path: 'facilities',
      name: 'matchgeni-facilities',
      component: MatchGeniFacilitiesView,
      meta: {
        matchgeniRoute: true,
        matchgeniPermission: 'manage_parks',
        matchgeniPermissionLabel: 'Playing Facilities'
      }
    },
    // Matchgeni participating teams sub-page — placeholder.
    {
      path: 'teams',
      name: 'matchgeni-participating-teams',
      component: MatchGeniParticipatingTeamsView,
      meta: {
        matchgeniRoute: true,
        matchgeniPermission: 'manage_team_participation',
        matchgeniPermissionLabel: 'Participating Teams'
      }
    },
    // Matchgeni division detail sub-page — sticky division sidebar +
    // selected division's detail panel. `:divisionId` selects which
    // division's panel renders.
    {
      path: 'division/:divisionId?',
      name: 'matchgeni-division-detail',
      component: MatchGeniDivisionDetailView,
      meta: {
        matchgeniRoute: true,
        matchgeniPermission: 'manage_divisions',
        matchgeniPermissionLabel: 'Division Details'
      }
    },
    // Matchgeni scorebook sub-page — list-based scoring surface
    // (kept around alongside the field-grid view below).
    {
      path: 'scoring',
      name: 'matchgeni-scoring',
      component: MatchGeniScoringView,
      meta: {
        matchgeniRoute: true,
        matchgeniPermission: 'manage_scoring',
        matchgeniPermissionLabel: 'Game Scoring'
      }
    },
    // Field Grid — park-day-at-a-glance read surface for everyone
    // with matchgeni access. The PAGE shows every game in the
    // selected park; the per-game scoring-rights gate runs inside
    // the view (only games in the caller's `scoringScope` get the
    // primary-tinted "permitted" highlight + clickable actions).
    // Users without `manage_scoring` get a read-only view (no
    // highlights, no actions modal) but can still browse the
    // park's day to coordinate / spectate / verify their
    // colleagues' work. No sub-page permission key on this route.
    {
      path: 'field-grid',
      name: 'matchgeni-field-grid',
      component: MatchGeniFieldGridView,
      meta: { matchgeniRoute: true }
    },
    // Event-wide notifications — history listing + the "New" composer.
    // No sub-page permission key: available to anyone with matchgeni
    // access (matches the left-rail "Notifications" item gating).
    {
      path: 'notifications',
      name: 'matchgeni-notifications',
      component: MatchGeniNotificationsView,
      meta: { matchgeniRoute: true }
    },
    // Event Locations — venue map (parks + hotels), formerly a full-screen
    // Map Explorer modal opened from the dashboard. Now a dedicated page
    // (rail "Locations" item). No sub-page permission key: viewable by
    // anyone with matchgeni access; the in-map Add control is gated inside.
    {
      path: 'event-locations',
      name: 'matchgeni-event-locations',
      component: MatchGeniEventLocationsView,
      meta: { matchgeniRoute: true }
    },
    // Discussions — topic list + composer. No sub-page permission key:
    // viewable by anyone with matchgeni access (matches the rail item).
    {
      path: 'discussions',
      name: 'matchgeni-discussions',
      component: MatchGeniDiscussionsView,
      meta: { matchgeniRoute: true }
    }
      ]
    },
    {
      path: '/association/:associationShortName/portal/teams',
      name: 'association-teams',
      component: AssociationTeamsView,
      meta: { requiresPermission: 'manage_teams' }
    },
    {
      path: '/association/:associationShortName/portal/team/:teamId',
      name: 'association-team-details',
      component: AssociationTeamDetailsView,
      meta: { requiresPermission: 'manage_teams' }
    },
    {
      path: '/association/:associationShortName/portal/umpires',
      name: 'association-umpires',
      component: AssociationUmpiresView,
      meta: { requiresPermission: 'manage_umpires' }
    },
    {
      path: '/association/:associationShortName/portal/players',
      name: 'association-players',
      component: AssociationPlayersView,
      meta: { requiresPermission: 'manage_players' }
    },
    {
      path: '/association/:associationShortName/portal/shop',
      name: 'association-shop',
      component: AssociationShopView,
      meta: { requiresPermission: ['manage_products', 'manage_orders'] }
    },
    {
      path: '/association/:associationShortName/portal/followers',
      name: 'association-followers',
      component: AssociationFollowersView,
      meta: { requiresPermission: 'manage_followers' }
    },
    {
      path: '/association/:associationShortName/portal/settings',
      name: 'association-settings',
      component: AssociationSettingsView,
      meta: { requiresPermission: 'manage_settings' }
    },
    // Reports — each report renders under its own slug inside
    // `/portal/reports/`. v1 ships the Event Summary report; future
    // reports (financials, registrations, etc.) extend this group
    // with sibling routes + sub-menu items in the sidebar.
    {
      path: '/association/:associationShortName/portal/reports/event-summary',
      name: 'association-reports-event-summary',
      component: AssociationEventSummaryReportView,
      meta: { requiresPermission: 'manage_reports' }
    },
    // Backwards-compat redirects for the pre-/portal/ URL shape that
    // PR #31 shipped to staging. Each old path maps 1:1 onto its new
    // /portal/ equivalent so saved bookmarks keep working.
    {
      path: '/association/:associationShortName/users',
      redirect: (to) => `/association/${encodeURIComponent((to.params.associationShortName as string) ?? '')}/portal/users`
    },
    {
      path: '/association/:associationShortName/events',
      redirect: (to) => `/association/${encodeURIComponent((to.params.associationShortName as string) ?? '')}/portal/events`
    },
    {
      path: '/association/:associationShortName/teams',
      redirect: (to) => `/association/${encodeURIComponent((to.params.associationShortName as string) ?? '')}/portal/teams`
    },
    {
      path: '/association/:associationShortName/umpires',
      redirect: (to) => `/association/${encodeURIComponent((to.params.associationShortName as string) ?? '')}/portal/umpires`
    },
    {
      path: '/association/:associationShortName/players',
      redirect: (to) => `/association/${encodeURIComponent((to.params.associationShortName as string) ?? '')}/portal/players`
    },
    {
      path: '/association/:associationShortName/shop',
      redirect: (to) => `/association/${encodeURIComponent((to.params.associationShortName as string) ?? '')}/portal/shop`
    },
    // Legacy scoresheet path — redirect to the standardized URL so old
    // bookmarks / shared links keep working.
    {
      path: '/events/:eventId/teams/:teamId/games/:gameId/scoresheet',
      redirect: (to) => {
        const teamId = (to.params.teamId as string) ?? ''
        const gameId = (to.params.gameId as string) ?? ''
        const participationId = (to.query.team_participation_id as string) ?? ''
        const gameGuid = (to.query.game_guid as string) ?? gameId
        return `/event/participation/${encodeURIComponent(participationId)}/team/${encodeURIComponent(teamId)}/game/${encodeURIComponent(gameGuid)}`
      }
    },
    {
      path: '/events/:eventId/teams/:teamId/games/:gameId/scoresheet/review',
      redirect: (to) => {
        const teamId = (to.params.teamId as string) ?? ''
        const gameId = (to.params.gameId as string) ?? ''
        const participationId = (to.query.team_participation_id as string) ?? ''
        const gameGuid = (to.query.game_guid as string) ?? gameId
        return `/event/participation/${encodeURIComponent(participationId)}/team/${encodeURIComponent(teamId)}/game/${encodeURIComponent(gameGuid)}/review`
      }
    },
    // Catch-all: any URL that doesn't match the routes above falls into the
    // friendly "not available" page. Must remain LAST in the routes array —
    // Vue Router matches in order and '*' swallows everything.
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: NotFoundView
    }
  ]
})

// ── Document title ────────────────────────────────────────────────
// Browser-tab title per surface, set SYNCHRONOUSLY at the start of every
// navigation (registered first, before the async auth / access guards) so the
// tab updates the instant the route is known — not after the per-event access
// check or membership fetch resolves. MatchGeni pages (any route under the
// matchgeni shell — `meta.matchgeniRoute`) and the association portal
// (`/portal/*`) each get their own product title; everything else
// (participation, scoresheet, public event) keeps the plain product name.
// If a later guard redirects, that redirect re-runs this guard and corrects
// the title for the final destination.
const BASE_TITLE = 'Who I Follow'
router.beforeEach((to) => {
  let title = BASE_TITLE
  if ((to.meta as { matchgeniRoute?: boolean }).matchgeniRoute) {
    title = `MatchGeni - ${BASE_TITLE}`
  } else if (to.path.includes('/portal/')) {
    title = `Association Portal - ${BASE_TITLE}`
  }
  document.title = title
})

// Auth guard: unauthenticated users hitting a protected route get redirected
// to the slug-scoped handoff page. Both handoff routes themselves are exempt
// so we don't loop.
router.beforeEach((to, _from, next) => {
  // Public routes (e.g. /public/event/:slug) are unauthenticated — never
  // bounce them through the handoff/auth flow.
  if ((to.meta as { public?: boolean }).public) {
    next()
    return
  }
  if (to.name === 'handoff' || to.name === 'association-handoff') {
    next()
    return
  }

  if (isAuthenticated.value) {
    next()
    return
  }

  // Association portal: any route under `/association/:slug/portal/*`.
  // These are gated by the SECOND beforeEach guard below (permission
  // check + membership fetch); BEFORE that can run the user needs a
  // valid session. Bounce them through the slug-scoped handoff page —
  // the slug in the path is enough for HandoffView to resolve the
  // user's first permitted section after auth lands, so a user without
  // `manage_events` doesn't end up on the events page they typed in.
  const slug =
    typeof to.params.associationShortName === 'string'
      ? to.params.associationShortName
      : ''
  if (slug.length > 0) {
    next({
      name: 'association-handoff',
      params: { associationShortName: slug }
    })
    return
  }

  // Participation / scoresheet keep the existing parent-handoff flow (the URL
  // carries the participation id, which HandoffView uses to recover a token).
  if (typeof to.name === 'string' && PROTECTED_ROUTE_NAMES.has(to.name)) {
    const participationId = resolveParticipationIdFromRoute(
      to.params as Record<string, string | undefined>,
      to.query as Record<string, string | (string | null)[] | undefined>
    )
    if (participationId) {
      next({
        name: 'handoff',
        params: { teamParticipationId: participationId }
      })
      return
    }
  }

  // Everything else that needs a signed-in user (New Game Time, etc.) →
  // standalone login page. (In the embedded product the parent hands the token
  // over instead, so these routes are normally reached already-authenticated.)
  next({ name: 'login', query: { redirect: to.fullPath } })
})

// Association portal access guard. Runs AFTER the handoff guard (vue-router
// 4 executes registered guards in declaration order). For every entry to a
// `/association/:associationShortName/portal/*` route:
//
//   1. Resolve the URL slug via `GET /v2/my/associations/{slug}` (mock in
//      v1). On 403 or 404 → redirect to NotFoundView (same UX outcome).
//      On any other error → re-throw so the unhandled-rejection bubbles
//      into devtools rather than silently swallowing.
//   2. Store the resolved access record in the module-level
//      `currentAssociation` ref (read by the sidebar, switcher, views).
//   3. Check the destination route's `meta.requiresPermission` against
//      the resolved membership. Mismatch → redirect to NotFoundView
//      (prevents direct-URL deep-link bypass of the sidebar gating).
//
// Skip-conditions:
//   - The slug didn't change AND `currentAssociation` is already loaded:
//     skip the refetch (e.g. navigation from team list to a team detail
//     within the same association). Still re-evaluates the permission
//     check against the cached membership.
//   - The route has no `:associationShortName` param: skip entirely.
router.beforeEach(async (to) => {
  const slug = (to.params.associationShortName as string | undefined)
  if (!slug) return true

  // The handoff routes themselves are the AUTH-RECOVERY surface — they
  // shouldn't be gated by a membership fetch. If the membership fetch
  // 401s here, this guard redirects right back to the handoff route,
  // and the cycle repeats until Vue Router's loop guard kicks in (three
  // 401s in the console = three loop iterations). Skip the guard so
  // the handoff view can mount cleanly; it handles the post-auth
  // membership fetch itself in `redirectAfterAuth()`.
  if (to.name === 'association-handoff' || to.name === 'handoff') {
    return true
  }

  // Reuse the cached membership whenever its slug matches the target —
  // covers both same-association deep-link navigation AND the
  // association-switcher's pre-seed (see AssociationSidebar.vue's
  // `selectAssociation`, which writes the target membership into
  // `currentAssociation` before calling `router.push`). The previous
  // implementation also required the source slug to match, which
  // forced a refetch on every cross-association switch — wasteful
  // when the switcher already has fresh data, and slow enough that
  // the user saw the source page freeze during the round-trip.
  const reuseCached =
    currentAssociation.value !== null &&
    currentAssociation.value.slug === slug

  if (!reuseCached) {
    try {
      const access = await fetchMyAssociation(slug)
      setCurrentAssociation(access)
    } catch (err: unknown) {
      const code = (err as { code?: number } | null)?.code

      // 401 = the locally-stored token is no longer valid on the
      // backend (expired, revoked, or never accepted). The frontend
      // still believed it was authed because we only ever clear the
      // session on explicit logout. Wipe the stale session and bounce
      // through the slug-scoped handoff so the parent iframe can hand
      // over a fresh token. Without this branch the error re-throws
      // below, Vue Router aborts the navigation, and the user lands
      // on a blank page.
      if (code === 401) {
        clearAuthSession()
        clearCurrentAssociation()
        return {
          name: 'association-handoff',
          params: { associationShortName: slug }
        }
      }

      // 403 (slug exists but no membership / pending invite) and
      // 404 (slug doesn't exist or is soft-deleted) both route to
      // NotFoundView — same UX outcome, no slug-existence leak.
      if (code === 403 || code === 404) {
        clearCurrentAssociation()
        return { name: 'not-found' }
      }

      // Anything else (5xx, network failure, malformed response,
      // unknown). Log it and route to NotFoundView rather than
      // re-throwing — re-throwing aborts the navigation and leaves
      // the user on a blank page, which is the worst possible UX.
      if (typeof console !== 'undefined') {
        // eslint-disable-next-line no-console
        console.error('[router] membership fetch failed for slug', slug, err)
      }
      clearCurrentAssociation()
      return { name: 'not-found' }
    }
  }

  // ── Matchgeni route branch ────────────────────────────────────
  // Matchgeni access is per-EVENT, NOT per-association — a user
  // can have ZERO portal-level association permissions and still
  // be a valid event official / scorekeeper / umpire for a
  // specific event. Standard `requiresPermission` checks (below)
  // would lock those users out, so matchgeni routes opt OUT of
  // that path via `meta.matchgeniRoute: true` and instead resolve
  // access through the per-event `/my-permissions` endpoint.
  //
  // Doing the check HERE (before the view mounts) gives solid
  // protection: an unauthorized visitor never sees view chrome,
  // never sees inner-view fetches, never sees half-painted
  // content. The matchgeni context is pre-warmed on success so
  // the view's own defensive `ensureMatchGeniAccess` call hits
  // the module-level cache and no-ops.
  const matchgeniMeta = to.meta as {
    matchgeniRoute?: boolean
    matchgeniPermission?: EventPermissionKey
    matchgeniPermissionLabel?: string
  } | undefined
  if (matchgeniMeta?.matchgeniRoute) {
    const associationId = currentAssociation.value?.id ?? ''
    const eventId = (to.params.eventId as string | undefined) ?? ''
    const result = await resolveMatchGeniAccess(
      associationId,
      eventId,
      matchgeniMeta.matchgeniPermission,
      matchgeniMeta.matchgeniPermissionLabel
    )
    if (!result.ok) {
      // `no-sub-permission` = user has matchgeni access but not
      // this specific sub-page. Bounce to the matchgeni dashboard
      // (they CAN see other matchgeni surfaces). Every other
      // denial reason → not-found (no permission leak).
      if (result.reason === 'no-sub-permission') {
        return {
          name: 'matchgeni-dashboard',
          params: { associationShortName: slug, eventId }
        }
      }
      return { name: 'not-found' }
    }
    // Matchgeni branch handles its own auth; SKIP the portal
    // `requiresPermission` check below (matchgeni routes never
    // carry that meta key).
    return true
  }

  // ── Portal permission check ───────────────────────────────────
  // Non-matchgeni routes — gated by association-level permissions
  // declared via `meta.requiresPermission`.
  const required = (to.meta as { requiresPermission?: AssociationPermissionKey | AssociationPermissionKey[] } | undefined)?.requiresPermission
  if (required) {
    const ok = Array.isArray(required)
      ? hasAnyPermission(currentAssociation.value, required)
      : hasPermission(currentAssociation.value, required)
    if (!ok) return { name: 'not-found' }
  }

  return true
})

export default router
