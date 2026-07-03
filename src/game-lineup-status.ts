import type { GameLineupSubmissionStatus } from './types'

export function gameLineupSubmissionStatusMeta(status?: GameLineupSubmissionStatus | null) {
  switch (status) {
    case 'submitted':
      return { label: 'Submitted', tone: 'info' as const }
    case 'approved':
      return { label: 'Approved', tone: 'success' as const }
    case 'rejected':
      return { label: 'Rejected', tone: 'danger' as const }
    case 'finalized':
      return { label: 'Finalized', tone: 'primary' as const }
    case 'draft':
    default:
      return { label: 'Draft', tone: 'neutral' as const }
  }
}
