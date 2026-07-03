import type { AssociationPermissionKey } from '../types'

/**
 * Permissions a user can be granted within an association. Used to:
 *   1. Render the toggle grid inside the AssociationUserModal.
 *   2. Derive a role-pill label for the users list (Admin / Member).
 *
 * The order here is the order they're rendered in the toggle grid.
 * `description` is shown in muted copy under the toggle label so the
 * admin can see what each toggle actually unlocks before flipping it
 * on. Keep these short — they should fit on one line at the toggle
 * grid's narrowest column.
 */
export interface AssociationPermissionMeta {
  key: AssociationPermissionKey
  label: string
  description: string
}

// Order here drives BOTH the toggle grid in the invite/edit user
// modal AND the permission-chip sequence on the user listing
// (rendered via `permissionLabelsFor` which filters in array order).
// The intentional sequence groups admin scope (events, users, teams)
// before registration-approval permissions (umpires, players),
// followed by the lower-frequency operational ones.
export const ASSOCIATION_PERMISSIONS: AssociationPermissionMeta[] = [
  {
    key: 'manage_events',
    label: 'Manage Events',
    description: 'Create, edit and delete events.'
  },
  {
    key: 'manage_users',
    label: 'Manage Users',
    description: 'Invite, edit and remove association users.'
  },
  {
    key: 'manage_teams',
    label: 'Manage Teams',
    description: 'Can approve, reject and suspend team registrations.'
  },
  {
    key: 'manage_umpires',
    label: 'Manage Umpires',
    description: 'Can approve, reject and suspend umpire registrations.'
  },
  {
    key: 'manage_players',
    label: 'Manage Players',
    description: 'Can approve, reject and suspend player registrations.'
  },
  {
    key: 'manage_followers',
    label: 'Manage Followers',
    description: 'View and manage association followers.'
  },
  {
    key: 'manage_financials',
    label: 'Manage Financials',
    description: 'View and manage payment orders and fees.'
  },
  {
    key: 'manage_products',
    label: 'Manage Products',
    description: 'Can view add edit products information and their pricing.'
  },
  {
    key: 'manage_orders',
    label: 'Manage Orders',
    description: 'Can view and manage orders received from the product listing.'
  },
  {
    key: 'manage_settings',
    label: 'Manage Settings',
    description: 'Edit association name, logo and profile.'
  },
  {
    key: 'manage_reports',
    label: 'Manage Reports',
    description: 'Generate and export event and game summary reports.'
  }
]

/**
 * Derive the role-pill label rendered in the users list:
 *   - Full control → "Admin"
 *   - Otherwise → "Member"
 */
export function deriveAssociationRoleLabel(
  fullControl: boolean,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _permissions: AssociationPermissionKey[]
): 'Admin' | 'Member' {
  return fullControl ? 'Admin' : 'Member'
}
