import type { EventPermissionKey } from '../types'

/**
 * Permissions a user can be granted PER-EVENT when they're added as
 * an Official to that event. Distinct from AssociationPermissionKey
 * (which scopes the user across the whole association). The same
 * user can be Official on multiple events with different event-
 * level subsets.
 *
 * Order here drives the order chips render in the user-events modal.
 * `description` is preserved for future use (tooltip on the chip,
 * or detail view) — it isn't shown in the row chip today.
 */
export interface EventPermissionMeta {
  key: EventPermissionKey
  label: string
  description: string
  /** When true, the EventOfficialAccessModal renders an inline
   *  scope picker beneath the toggle so the admin can narrow the
   *  permission to specific parks or divisions. v1 only marks
   *  `manage_scoring` expandable; future permissions can flip
   *  this flag without changing the modal's plumbing. */
  expandable?: boolean
}

export const EVENT_PERMISSIONS: EventPermissionMeta[] = [
  {
    key: 'edit_event',
    label: 'Edit Event',
    description: 'Can edit event name, dates, description, settings.'
  },
  {
    key: 'manage_team_participation',
    label: 'Manage Team Participation',
    description: 'Can manage team registrations and participation.'
  },
  {
    key: 'manage_divisions',
    label: 'Manage Divisions',
    description: 'Can create, edit, delete divisions within the event.'
  },
  {
    key: 'manage_scoring',
    label: 'Manage Scoring',
    description: 'Can enter and edit game scores (scoped to parks or divisions).',
    expandable: true
  },
  {
    key: 'manage_umpires',
    label: 'Manage Umpires',
    description: 'Can invite umpires to the event and assign them to games.'
  },
  {
    key: 'manage_officials',
    label: 'Manage Officials',
    description: 'Can add, invite, edit access and revoke access for event officials.'
  },
  {
    key: 'manage_scheduling',
    label: 'Manage Scheduling',
    description: 'Can schedule / unschedule pool and bracket games.'
  },
  {
    key: 'manage_parks',
    label: 'Manage Parks',
    description: 'Can create, edit, delete park venues for the event.'
  },
  {
    key: 'manage_hotels',
    label: 'Manage Hotels',
    description: 'Can manage hotel blocks and accommodation info.'
  },
  {
    key: 'manage_sponsors',
    label: 'Manage Sponsors',
    description: 'Can add, edit, remove event sponsors.'
  }
]
