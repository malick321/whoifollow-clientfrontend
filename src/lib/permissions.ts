import type { AssociationPermissionKey, MyAssociation } from '../types'

/**
 * Permission helpers for the association portal.
 *
 * The membership argument is intentionally a `Pick<MyAssociation, ...>`
 * narrowed shape so any object carrying `fullControl` + `permissions`
 * can be passed — not just the full `MyAssociation` record. Useful for
 * unit tests + when calling against a known-subset membership (e.g.
 * inside the router guard before the full association detail is
 * stored).
 *
 * Pattern: `fullControl === true` short-circuits to allow. This mirrors
 * the encoding rule documented in `docs/api/conventions.md`:
 * `fullControl: true` + `permissions: []` is the canonical "every
 * permission" representation. Never inspect `permissions[]` in a
 * full-control context.
 *
 * Returns `false` for `null` / `undefined` membership (e.g. before the
 * router guard has resolved the current association) — fail-closed by
 * default so transient states don't accidentally expose UI.
 */

// Accept BOTH the regular MyAssociation shape AND the `readonly`-wrapped
// shape returned by `readonly()` from constants/associations.ts. Vue's
// `readonly()` makes nested arrays `readonly Foo[]`; the helper doesn't
// mutate anything, so accepting either is safe and avoids a cast at
// every call site.
type Membership =
  | Pick<MyAssociation, 'fullControl' | 'permissions'>
  | { readonly fullControl: boolean; readonly permissions: readonly AssociationPermissionKey[] }
  | null
  | undefined

export function hasPermission(
  membership: Membership,
  key: AssociationPermissionKey
): boolean {
  if (!membership) return false
  if (membership.fullControl) return true
  return membership.permissions.includes(key)
}

/**
 * True iff the user has at least ONE of the supplied permissions.
 * Useful for nav items that surface a section gated on multiple
 * permission keys (e.g. the Shop nav opens products and orders —
 * either permission grants access).
 */
export function hasAnyPermission(
  membership: Membership,
  keys: AssociationPermissionKey[]
): boolean {
  if (!membership) return false
  if (membership.fullControl) return true
  return keys.some((key) => membership.permissions.includes(key))
}

/**
 * True iff the user has EVERY supplied permission. Less commonly
 * needed than `hasAnyPermission` but included for completeness — some
 * compound actions (e.g. "approve a payment AND mark a team active")
 * may want explicit conjunctive checks.
 */
export function hasAllPermissions(
  membership: Membership,
  keys: AssociationPermissionKey[]
): boolean {
  if (!membership) return false
  if (membership.fullControl) return true
  return keys.every((key) => membership.permissions.includes(key))
}

/**
 * Resolve the **first** portal route name the given membership has
 * access to, in the same order the sidebar renders its menu items.
 *
 * Used when switching associations: the destination view shouldn't be
 * hardcoded to one route (e.g. `association-users`) because the target
 * association may not grant that permission — landing there triggers
 * the router guard's `requiresPermission` check and bounces to
 * NotFoundView. This helper returns whichever route the user can
 * actually open first, mirroring what they'd see if they clicked the
 * top sidebar item.
 *
 * Returns `null` only when the membership grants ZERO portal sections
 * (theoretically possible — a `pending` invite or a permissionless
 * direct-add row). Callers handle that as a no-access edge case.
 *
 * Order matches `AssociationSidebar.vue`'s menu definition:
 *   1. Events
 *   2. Users
 *   3. Teams
 *   4. Umpires
 *   5. Players
 *   6. Shop (manage_products OR manage_orders)
 *   7. Followers
 *   8. Settings
 *
 * `fullControl: true` always resolves to the first entry (Events).
 */
export function firstPermittedPortalRoute(membership: Membership): string | null {
  if (!membership) return null

  if (hasPermission(membership, 'manage_events'))    return 'association-events'
  if (hasPermission(membership, 'manage_users'))     return 'association-users'
  if (hasPermission(membership, 'manage_teams'))     return 'association-teams'
  if (hasPermission(membership, 'manage_umpires'))   return 'association-umpires'
  if (hasPermission(membership, 'manage_players'))   return 'association-players'
  if (hasAnyPermission(membership, ['manage_products', 'manage_orders'])) return 'association-shop'
  if (hasPermission(membership, 'manage_followers')) return 'association-followers'
  if (hasPermission(membership, 'manage_reports'))   return 'association-reports-event-summary'
  if (hasPermission(membership, 'manage_settings'))  return 'association-settings'

  return null
}
