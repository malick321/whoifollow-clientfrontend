import { mockParticipation, mockScoresheet } from './mockData'
import type { ScoresheetDetail, TeamParticipation } from '../types'

let participationState: TeamParticipation = structuredClone(mockParticipation)
let scoresheetState: ScoresheetDetail = structuredClone(mockScoresheet)

export function getParticipationState() {
  return structuredClone(participationState)
}

export function setParticipationState(next: TeamParticipation) {
  participationState = structuredClone(next)
}

export function getScoresheetState() {
  return structuredClone(scoresheetState)
}

export function setScoresheetState(next: ScoresheetDetail) {
  scoresheetState = structuredClone(next)
}
