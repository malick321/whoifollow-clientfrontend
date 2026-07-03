// matchgeni-context
// -----------------
// Module-level reactive state for the currently-loaded MatchGeni
// permission payload. Populated by `MatchGeniDashboardView` on
// mount (and on tab refocus) via `fetchMatchGeniAccess`; read by
// every MatchGeni sub-page + every write affordance inside MatchGeni.
//
// The single source of truth for "what can this user do in
// MatchGeni for THIS event". See `docs/api/matchgeni-access-api-contract.md`
// for the wire shape + entry/write-gate semantics.
//
// Pattern mirrors `src/constants/associations.ts` (currentAssociation)
// — a plain module-level ref so any component can `import` it
// without prop-drilling.

import { ref, computed, readonly } from 'vue'
import type { Router } from 'vue-router'
import { currentAssociation } from './constants/associations'
import { fetchMatchGeniAccess, MatchGeniAccessApiError } from './api/matchGeniAccess'
import { pushToast } from './toast-center'
import type {
  EventPermissionKey,
  MatchGeniAccessPayload
} from './types'

/** The active MatchGeni permission payload, or `null` when the
 *  user isn't currently inside a MatchGeni view. Cleared on
 *  `MatchGeniDashboardView` unmount so stale data can't bleed
 *  into a later visit to a different event. */
const _matchGeniContext = ref<MatchGeniAccessPayload | null>(null)

/** Read-only handle so views can subscribe but not mutate. Writes
 *  go through `setMatchGeniContext` / `clearMatchGeniContext`
 *  below to keep the lifecycle obvious. */
export const matchGeniContext = readonly(_matchGeniContext)

/** Set the active context. Called by `MatchGeniDashboardView`
 *  after a successful `fetchMatchGeniAccess` resolves. */
export function setMatchGeniContext(payload: MatchGeniAccessPayload | null) {
  _matchGeniContext.value = payload
}

/** Clear the active context. Called by `MatchGeniDashboardView`
 *  on unmount + on entry-gate failure (403 / 404 / 409). */
export function clearMatchGeniContext() {
  _matchGeniContext.value = null
}

// ── Per-event MatchGeni menu access cache ────────────────────────
// Lifted into this module (was a local ref on AssociationEventsView)
// so the global 403 interceptor can flush it during permission
// reconciliation — events-list MatchGeni menu items recompute
// against fresh `/my-permissions` results after a permission
// change instead of showing stale cached verdicts.
export type MatchGeniMenuAccess = 'loading' | 'allowed' | 'denied'

const _matchGeniMenuAccess = ref<Record<string, MatchGeniMenuAccess>>({})
export const matchGeniMenuAccess = readonly(_matchGeniMenuAccess)

export function setMatchGeniMenuAccess(eventId: string, state: MatchGeniMenuAccess) {
  _matchGeniMenuAccess.value = { ..._matchGeniMenuAccess.value, [eventId]: state }
}

export function getMatchGeniMenuAccess(eventId: string): MatchGeniMenuAccess | undefined {
  return _matchGeniMenuAccess.value[eventId]
}

/** Wipe every cached per-event matchgeni verdict. Called by the
 *  401 / 403 interceptor's `reconcilePermissions` so the events
 *  list re-fetches access on the next menu open. */
export function clearMatchGeniMenuAccess() {
  _matchGeniMenuAccess.value = {}
}

/** Discriminated-union result of the pure matchgeni access
 *  resolver. The router guard uses this to decide where to
 *  redirect; views can opt into the legacy wrapper below which
 *  also calls `router.push` on denial.
 *
 *  `reason` values:
 *    - `'invalid'`: missing associationId or eventId — caller
 *      bug; route to not-found.
 *    - `'no-access'`: backend returned 403 (no matchgeni access
 *      for this event). Route to not-found (no leakage).
 *    - `'not-found'`: backend returned 404 (event doesn't exist).
 *      Route to not-found.
 *    - `'unavailable'`: backend returned 409 (matchgeni not
 *      available for this event, e.g. partner-owned). Route to
 *      not-found.
 *    - `'no-sub-permission'`: caller has matchgeni access but
 *      not the specific per-page permission key. Route to the
 *      matchgeni dashboard (they CAN see other matchgeni
 *      surfaces, just not this one).
 *    - `'unknown'`: 5xx / network / malformed response. Route to
 *      not-found rather than leaving the user stranded. */
export type MatchGeniAccessResolveResult =
  | { ok: true }
  | {
      ok: false
      reason: 'invalid' | 'no-access' | 'not-found' | 'unavailable' | 'no-sub-permission' | 'unknown'
    }

/** Pure resolver — fetches matchgeni access for the event (or
 *  reuses the cache when context is already loaded for the SAME
 *  event id) and reports the outcome via the discriminated-union
 *  result. Does NOT call `router.push` / `router.replace` — the
 *  caller decides where to send the user.
 *
 *  This is the router-callable version of the matchgeni access
 *  check. Used by the second `beforeEach` guard in `router.ts`
 *  so unauthorized visitors never see the view mount.
 *
 *  Side effects (kept minimal so the function is safe to call
 *  from inside a navigation guard):
 *    - Writes `_matchGeniContext` on a successful fetch (the
 *      view needs it populated before mount anyway — pre-warming
 *      from the guard means the view's own
 *      `ensureMatchGeniAccess` call hits the cache for free).
 *    - Pushes a toast on denial. Toasts don't affect navigation,
 *      so they're safe inside the guard. */
export async function resolveMatchGeniAccess(
  associationId: string,
  eventId: string,
  /** Optional per-page permission key. When set, the resolver
   *  also checks that the loaded matchgeni context has this
   *  permission (or `fullControl`) AFTER the entry gate passes.
   *
   *  Omit on the dashboard route (entry gate only — any
   *  matchgeni access is sufficient).
   *  Pass the matching key on every sub-page route. */
  requiredPermission?: EventPermissionKey,
  /** Human-readable name of the sub-page for the toast copy
   *  ("Game Scheduler", "Officials", "Umpires", …). Falls back
   *  to the bare permission key. */
  subPageLabel?: string
): Promise<MatchGeniAccessResolveResult> {
  if (!associationId || !eventId) return { ok: false, reason: 'invalid' }

  // Cache hit — context is already loaded for THIS event. Skip
  // the round-trip; the per-page permission check below still
  // runs against the cached context.
  let context = _matchGeniContext.value
  if (context?.event.id !== eventId) {
    try {
      context = await fetchMatchGeniAccess(associationId, eventId)
      _matchGeniContext.value = context
    } catch (err) {
      _matchGeniContext.value = null
      if (err instanceof MatchGeniAccessApiError) {
        if (err.code === 403) {
          pushToast({
            tone: 'warning',
            title: 'No access',
            message: "You don't have permission to enter MatchGeni for this event."
          })
          return { ok: false, reason: 'no-access' }
        }
        if (err.code === 404) {
          pushToast({
            tone: 'warning',
            title: 'Event not found',
            message: 'This event no longer exists or has been removed.'
          })
          return { ok: false, reason: 'not-found' }
        }
        if (err.code === 409) {
          pushToast({
            tone: 'warning',
            title: 'MatchGeni unavailable',
            message: 'MatchGeni is only available for association-owned events.'
          })
          return { ok: false, reason: 'unavailable' }
        }
      }
      if (typeof console !== 'undefined') {
        // 5xx / network / malformed — log + still report unknown
        // so the caller routes to not-found instead of leaving
        // the user stranded on a half-loaded page.
        // eslint-disable-next-line no-console
        console.error('[matchgeni] my-permissions fetch failed:', err)
      }
      return { ok: false, reason: 'unknown' }
    }
  }

  // Per-page permission gate — only runs after the entry gate
  // resolved a valid context. `fullControl` short-circuits to
  // true; otherwise the key must be in the user's permissions
  // array. Denial reports `no-sub-permission` so the caller can
  // route to the matchgeni dashboard (the user HAS matchgeni
  // access — they just lack this specific sub-page key).
  if (requiredPermission && context) {
    const allowed = context.access.fullControl
      || context.access.permissions.includes(requiredPermission)
    if (!allowed) {
      pushToast({
        tone: 'warning',
        title: 'No access',
        message: `You don't have permission to access ${subPageLabel ?? requiredPermission}.`
      })
      return { ok: false, reason: 'no-sub-permission' }
    }
  }

  return { ok: true }
}

/** Shared "ensure matchgeni access" helper. Every matchgeni view
 *  (dashboard, scheduler, officials, future sub-pages) calls this
 *  on mount + whenever the active eventId changes.
 *
 *  Behaviour:
 *    - If `matchGeniContext` is already loaded for the SAME
 *      `eventId`, no-op + return true. Makes dashboard → scheduler
 *      → officials navigation instant (no re-fetch).
 *    - Otherwise calls the `/my-permissions` endpoint, caches the
 *      payload on `matchGeniContext`, returns true.
 *    - On 403 / 404 / 409 — toasts the appropriate message and
 *      redirects to the global NotFoundView. Mirrors the portal
 *      authentication pattern (`src/router.ts` membership gate)
 *      so MatchGeni denies surface the same "not-found" outcome
 *      whether the user lacks portal-level access OR matchgeni-
 *      level access. Returns false either way.
 *    - On other errors (5xx, network, malformed response) — also
 *      redirects to NotFoundView rather than leaving the user
 *      stuck on a half-painted page. Same defensive rationale as
 *      the router's slug-resolution path. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function ensureMatchGeniAccess(
  router: Router,
  associationId: string,
  eventId: string,
  _associationShortName: string,
  /** Optional per-page permission key. When set, the helper also
   *  checks that the loaded matchgeni context has this permission
   *  (or `fullControl`) AFTER the entry gate passes. If the user
   *  lacks the permission, they're bounced to the matchgeni
   *  dashboard (NOT not-found — they have matchgeni access, just
   *  not for this specific sub-page) with a toast explaining why.
   *
   *  Pass nothing on the dashboard view itself (entry gate only).
   *  Pass the matching key on every sub-page (`manage_scheduling`
   *  on scheduler, `manage_officials` on officials, etc.). */
  requiredPermission?: EventPermissionKey,
  /** Optional human-readable name of the sub-page for the toast
   *  copy ("Game Scheduler", "Officials", "Umpires", …). Falls
   *  back to the bare permission key if not provided. */
  subPageLabel?: string
): Promise<boolean> {
  // `_associationShortName` kept in the signature for back-compat
  // with the dashboard / scheduler / officials call sites, but no
  // longer used now that 403/404/409 routes to the global
  // `not-found` route instead of `association-events`.
  if (!associationId || !eventId) {
    router.replace({ name: 'not-found' })
    return false
  }

  // Cache hit — context is already loaded for THIS event. Skip
  // the round-trip so nav between matchgeni sub-pages is instant.
  // The per-page permission check below still runs against the
  // cached context.
  let context = _matchGeniContext.value
  if (context?.event.id !== eventId) {
    try {
      context = await fetchMatchGeniAccess(associationId, eventId)
      _matchGeniContext.value = context
    } catch (err) {
      _matchGeniContext.value = null
      if (err instanceof MatchGeniAccessApiError) {
        if (err.code === 403) {
          pushToast({
            tone: 'warning',
            title: 'No access',
            message: 'You don\'t have permission to enter MatchGeni for this event.'
          })
        } else if (err.code === 404) {
          pushToast({
            tone: 'warning',
            title: 'Event not found',
            message: 'This event no longer exists or has been removed.'
          })
        } else if (err.code === 409) {
          pushToast({
            tone: 'warning',
            title: 'MatchGeni unavailable',
            message: 'MatchGeni is only available for association-owned events.'
          })
        }
      } else if (typeof console !== 'undefined') {
        // 5xx / network / malformed — log + still route to
        // not-found so the user isn't stranded on a half-loaded page.
        // eslint-disable-next-line no-console
        console.error('[matchgeni] my-permissions fetch failed:', err)
      }
      router.replace({ name: 'not-found' })
      return false
    }
  }

  // Per-page permission gate — only runs after the entry gate has
  // resolved a valid context. `fullControl` short-circuits to true;
  // otherwise the key must be in the user's permissions array.
  // Deny → bounce to matchgeni-dashboard (NOT not-found, since the
  // user has matchgeni access — just not for this sub-page).
  if (requiredPermission && context) {
    const allowed = context.access.fullControl
      || context.access.permissions.includes(requiredPermission)
    if (!allowed) {
      pushToast({
        tone: 'warning',
        title: 'No access',
        message: `You don't have permission to access ${subPageLabel ?? requiredPermission}.`
      })
      router.replace({
        name: 'matchgeni-dashboard',
        params: { associationShortName: _associationShortName, eventId }
      })
      return false
    }
  }

  return true
}

// ── Gate helpers ────────────────────────────────────────────────
// Every MatchGeni write affordance routes through these. The rule
// is the one documented in `matchgeni-access-api-contract.md` §2:
//
//   - Entry gate: `matchGeniContext.value` non-null = user passed
//     the 403 gate and can see every surface in read-only mode.
//   - Write gate per key: `fullControl` short-circuits to true;
//     otherwise check if the key is in the `permissions` array.

/** `true` when the caller is currently inside MatchGeni — i.e.
 *  the `my-permissions` endpoint returned `200` for the active
 *  event. Used to gate the matchgeni view's loading / error /
 *  ready states. */
export const canEnterMatchGeni = computed(() => _matchGeniContext.value !== null)

/** `true` when the active caller holds Full Control over the
 *  active event via ANY path (event-scoped FC OR association FC). */
export const matchGeniFullControl = computed(() =>
  _matchGeniContext.value?.access.fullControl === true
)

/** `true` when the caller also has access to the association PORTAL
 *  (association full control OR at least one association permission). Drives
 *  the rail-footer "Back to portal" button. Reads `currentAssociation` —
 *  which is ALWAYS loaded on matchgeni routes (the router resolves it for the
 *  slug→id hop, and every matchgeni user is an association member). A no-perm
 *  official (empty `permissions`, `fullControl: false`) sees no button —
 *  there's nowhere in the portal for them to go. This used to read duplicated
 *  `associationFullControl` / `associationPermissions` off the matchgeni
 *  payload; those were redundant (same source) and have been removed. */
export const canEnterAssociation = computed(() => {
  const assoc = currentAssociation.value
  if (!assoc) return false
  return assoc.fullControl === true || assoc.permissions.length > 0
})

/** Predicate-style write gate. Call from any MatchGeni view /
 *  component to ask "can the active caller perform a write
 *  action gated by `key` for the active event?".
 *
 *  Rules (see `matchgeni-access-api-contract.md` §2):
 *    - Returns `false` when no context is loaded (defensive — UI
 *      shouldn't be rendering write affordances outside MatchGeni).
 *    - Returns `true` when `fullControl` is on.
 *    - Otherwise returns `true` iff `key` is in `permissions`.
 *
 *  NOTE: this does NOT check `scoringScope`. For score-write
 *  affordances on a specific game, use `canScoreGame()` below. */
export function canMatchGeniWrite(key: EventPermissionKey): boolean {
  const ctx = _matchGeniContext.value
  if (!ctx) return false
  if (ctx.access.fullControl) return true
  return ctx.access.permissions.includes(key)
}

/** Scoring-scope-aware write gate for one specific game.
 *  Returns `true` when the caller can enter / edit scores for
 *  this game's `parkId` + `divisionId`. Follows the rules in
 *  `matchgeni-access-api-contract.md` §2 "Scoring-scope gate":
 *
 *    - `fullControl: true` → true (FC implies every park + division).
 *    - Caller doesn't hold `manage_scoring` → false.
 *    - `scoringScope` is `null` or `mode === 'all'` → true.
 *    - `mode === 'parks'` → true iff `parkIds` includes `game.parkId`.
 *    - `mode === 'divisions'` → true iff `divisionIds` includes
 *      `game.divisionId`.
 *
 *  Backend re-applies the same check on score-write attempts;
 *  this client gate is purely for affordance toggling. */
export function canScoreGame(game: { parkId: string; divisionId: string }): boolean {
  const ctx = _matchGeniContext.value
  if (!ctx) return false
  if (ctx.access.fullControl) return true
  if (!ctx.access.permissions.includes('manage_scoring')) return false
  const scope = ctx.access.scoringScope
  if (!scope || scope.mode === 'all') return true
  if (scope.mode === 'parks')     return scope.parkIds.includes(game.parkId)
  if (scope.mode === 'divisions') return scope.divisionIds.includes(game.divisionId)
  return false
}
