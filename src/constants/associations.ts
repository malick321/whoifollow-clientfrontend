import { ref, readonly } from 'vue'
import type { MyAssociation } from '../types'

/**
 * Module-level reactive ref for the association the user is currently
 * viewing in the portal. Populated by the router's beforeEach guard on
 * every entry to a `/association/:slug/portal/*` route — see the
 * `fetchMyAssociation` call in `src/router.ts`. Used by:
 *
 *   - `AssociationSidebar.vue` — brand block + nav permission gating
 *   - every `Association*View.vue` — calls API helpers with `.slug` /
 *     `.id` and gates UI off `.fullControl` + `.permissions`.
 *
 * The ref is exposed read-only to the rest of the app; only the router
 * guard should write to it via `setCurrentAssociation`.
 *
 * Shape note: this replaces the v0 `AssociationOption` shape (id +
 * shortName + fullName) that came from a hardcoded `ASSOCIATION_OPTIONS`
 * array. The shape is now the full `MyAssociation` access record
 * returned by `GET /v2/my/associations/{slug}` — adds `guid`, `slug`
 * (URL handle, distinct from numeric `id`), `logoUrl`, `fullControl`,
 * `permissions[]`, and `status`. Existing consumers that read
 * `.shortName` keep working; references to `.fullName` rename to
 * `.associationName`.
 */
const _currentAssociation = ref<MyAssociation | null>(null)

export const currentAssociation = readonly(_currentAssociation)

export function setCurrentAssociation(value: MyAssociation | null): void {
  _currentAssociation.value = value
}

export function clearCurrentAssociation(): void {
  _currentAssociation.value = null
}
