import { ASSOCIATION_PERMISSIONS } from '../constants/associationPermissions'
import { EVENT_PERMISSIONS } from '../constants/eventPermissions'
import type { PermissionCatalogue } from '../types'

/**
 * Mock for `GET /v2/association/users/{associationId}/permission-catalogue`.
 * In production the catalogue is read from static JSON config inside
 * the Laravel application (no database table involved); the mock
 * derives the same shape from the local constants files so the two
 * sides stay in lock-step.
 *
 * The returned shape is the §10 contract verbatim (see
 * `docs/association-users-api-contract.md`).
 */

const SIMULATED_LATENCY_MS = 120

function delay<T>(value: T, ms = SIMULATED_LATENCY_MS): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

export async function fetchPermissionCatalogue(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _associationId: string
): Promise<PermissionCatalogue> {
  const catalogue: PermissionCatalogue = {
    associationPermissions: ASSOCIATION_PERMISSIONS.map((entry) => ({
      key: entry.key,
      label: entry.label,
      description: entry.description
    })),
    eventPermissions: EVENT_PERMISSIONS.map((entry) => ({
      key: entry.key,
      label: entry.label,
      description: entry.description,
      // `expandable` is optional — only `manage_scoring` flips it
      // today. Future expandable permissions will land here without
      // any contract change.
      expandable: entry.expandable
    }))
  }
  return delay(catalogue)
}
