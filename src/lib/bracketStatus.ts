import type { BracketStatus, StandingUnitPlay } from '../types'

// Bracket-status presentation — ONE source of truth for the tone + label
// of each bracket lifecycle state, so the dashboard division list (dots),
// the division-detail bracket cards (badges), and the Announce-result
// modal (dots) all read the same colour for the same state.
//
//   pending     → neutral
//   initiated   → warning
//   in_progress → success
//   completed   → primary
//   cancelled   → danger

export type BracketTone = 'neutral' | 'warning' | 'success' | 'primary' | 'danger'

const STATUS_TONE: Record<BracketStatus, BracketTone> = {
  pending: 'neutral',
  initiated: 'warning',
  in_progress: 'success',
  completed: 'primary',
  cancelled: 'danger'
}

const STATUS_LABEL: Record<BracketStatus, string> = {
  pending: 'Pending',
  initiated: 'Initiated',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled'
}

export function bracketStatusTone(status: BracketStatus): BracketTone {
  return STATUS_TONE[status] ?? 'neutral'
}

export function bracketStatusLabel(status: BracketStatus): string {
  return STATUS_LABEL[status] ?? 'Pending'
}

// The Announce-result modal surfaces a unit's *play* state (which mirrors
// the bracket lifecycle for bracket units, and pool progress for pools).
// Map it to the same palette so the per-unit dots match the bracket tones.
const PLAY_TONE: Record<StandingUnitPlay, BracketTone> = {
  not_started: 'neutral',
  initiated: 'warning',
  in_progress: 'success',
  complete: 'primary',
  cancelled: 'danger'
}

export function unitPlayTone(play: StandingUnitPlay): BracketTone {
  return PLAY_TONE[play] ?? 'neutral'
}
