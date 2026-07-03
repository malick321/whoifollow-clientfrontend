import { getJson, patchJson } from './client'
import { adaptParticipationLineupPlayer } from './adapters/participation'
import { adaptFieldConfigPositions } from './adapters/scoresheet'
import type { ApiFieldConfigPosition } from './contracts/scoresheet'
import type { ApiParticipationLineupPlayer } from './contracts/participation'
import { buildParticipationLineupPayload } from './payloads/participation'
import type { FieldConfigPosition, LineupPlayer } from '../types'

type ApiEventLineupFieldConfig = {
  name?: string | null
  positions?: ApiFieldConfigPosition[] | null
} | null

type ApiEventLineupData = {
  event_team_id?: number | string | null
  team_id?: number | string | null
  event_id?: number | string | null
  division_id?: number | string | null
  lineup?: ApiParticipationLineupPlayer[] | null
  field_config?: ApiEventLineupFieldConfig
}

type ApiEventLineupResponse = {
  data?: ApiEventLineupData | null
  lineup?: ApiParticipationLineupPlayer[] | null
  field_config?: ApiEventLineupFieldConfig
  message?: string | null
  statusCode?: number | null
}

/**
 * Shape returned by fetchEventLineup / saveEventLineup.
 *
 * `fieldConfigPositions` drives the position `<option>` list in the Event
 * Lineup Modal's per-player dropdowns (via `LineupTable`). If the API does
 * not include a field_config (older events, or ones without a configuration
 * attached), the list comes back empty and the modal falls back to the
 * client-side DEFAULT_SLOW_PITCH_FIELD_POSITIONS.
 */
export type EventLineupResult = {
  lineup: LineupPlayer[]
  fieldConfigName: string | null
  fieldConfigPositions: FieldConfigPosition[]
}

function unwrap(response: ApiEventLineupResponse): EventLineupResult {
  const rawLineup = response.data?.lineup ?? response.lineup ?? []
  const rawFieldConfig = response.data?.field_config ?? response.field_config ?? null

  return {
    lineup: rawLineup.map(adaptParticipationLineupPlayer),
    fieldConfigName: rawFieldConfig?.name ?? null,
    fieldConfigPositions: rawFieldConfig?.positions?.length
      ? adaptFieldConfigPositions(rawFieldConfig.positions)
      : []
  }
}

export async function fetchEventLineup(participationId: string): Promise<EventLineupResult> {
  const response = await getJson<ApiEventLineupResponse>(
    `/tournaments/event-lineup/${encodeURIComponent(participationId)}`
  )
  return unwrap(response)
}

export async function saveEventLineup(participationId: string, lineup: LineupPlayer[]): Promise<EventLineupResult> {
  const response = await patchJson<ApiEventLineupResponse>(
    `/tournaments/event-lineup/${encodeURIComponent(participationId)}`,
    buildParticipationLineupPayload(lineup)
  )
  return unwrap(response)
}
