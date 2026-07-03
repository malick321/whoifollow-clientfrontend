// sportTypes
// ----------
// Unified sport-type catalogue. Each sport type carries everything it
// needs: its supported field configurations (with on-field positions) and
// its umpire role configs. Backed by `GET /v2/sport-types` (all) and
// `GET /v2/sport-types/{id}` (one) — see `shared-services-api-contract.md`
// §8. This supersedes the per-sport §5 field-config endpoint: field configs
// are now sourced from here (the event form needs the full list to pick a
// sport; the division form fetches one by id since its sport is fixed).
//
// Backing tables: `team_sport_types` (master), `sport_type_field_configurations`
// (M:N sport↔field-config), `sports_type_umpire_configs`, and the field-config
// positions catalogue (`game_position_configs`). See `sql-schema-shared.md`.
//
// Mock-first (mirrors `mediums.ts`) — flip `SPORT_TYPES_ENDPOINT_LIVE` and
// wire the `getJson` branch once the endpoint ships. Page-cached so repeated
// opens of the wizard / division form don't refetch.

import { getJson } from './client'
import type {
  SportType,
  SportTypeUmpireConfig,
  FieldConfigurationOption,
  FieldConfigPosition
} from '../types'

const SPORT_TYPES_ENDPOINT_LIVE = true

// ── Mock dataset ───────────────────────────────────────────────────────
// Positions use the 460×460 reference frame (viewBox "0 -50 460 460" — the
// same frame the backend `x_axis`/`y_axis` use and the shared
// FieldPositionPreview / FieldLineupPreview render in), home plate at the
// bottom-centre. A standard 9-position diamond.
const DIAMOND_9: FieldConfigPosition[] = [
  { code: 'P', label: 'Pitcher', area: 'battery', positionNumber: 1, xAxis: 230, yAxis: 232, status: 1 },
  { code: 'C', label: 'Catcher', area: 'battery', positionNumber: 2, xAxis: 230, yAxis: 332, status: 1 },
  { code: '1B', label: 'First Base', area: 'infield', positionNumber: 3, xAxis: 322, yAxis: 232, status: 1 },
  { code: '2B', label: 'Second Base', area: 'infield', positionNumber: 4, xAxis: 286, yAxis: 158, status: 1 },
  { code: '3B', label: 'Third Base', area: 'infield', positionNumber: 5, xAxis: 138, yAxis: 232, status: 1 },
  { code: 'SS', label: 'Shortstop', area: 'infield', positionNumber: 6, xAxis: 174, yAxis: 158, status: 1 },
  { code: 'LF', label: 'Left Field', area: 'outfield', positionNumber: 7, xAxis: 96, yAxis: 92, status: 1 },
  { code: 'CF', label: 'Center Field', area: 'outfield', positionNumber: 8, xAxis: 230, yAxis: 56, status: 1 },
  { code: 'RF', label: 'Right Field', area: 'outfield', positionNumber: 9, xAxis: 364, yAxis: 92, status: 1 }
]

// A 10-position layout (adds a rover / short fielder) for slow-pitch.
const DIAMOND_10: FieldConfigPosition[] = [
  ...DIAMOND_9,
  { code: 'RV', label: 'Rover', area: 'outfield', positionNumber: 10, xAxis: 230, yAxis: 118, status: 1 }
]

const PLATE_BASE: SportTypeUmpireConfig[] = [
  { id: '1', code: 'UIC', name: 'Umpire in Chief', sortOrder: 1 },
  { id: '2', code: 'PU', name: 'Plate Umpire', sortOrder: 2 },
  { id: '3', code: 'BU1', name: 'Base Umpire 1', sortOrder: 3 },
  { id: '4', code: 'BU2', name: 'Base Umpire 2', sortOrder: 4 }
]

function fieldConfig(id: string, name: string, positions: FieldConfigPosition[]): FieldConfigurationOption {
  return { id, name, positions }
}

const MOCK_SPORT_TYPES: SportType[] = [
  {
    id: '1',
    name: 'Softball - Slow Pitch',
    fieldConfigurations: [
      fieldConfig('10', 'Softball', DIAMOND_10),
      fieldConfig('11', 'Softball (9-position)', DIAMOND_9)
    ],
    umpireConfigs: PLATE_BASE
  },
  {
    id: '2',
    name: 'Softball - Fast Pitch',
    fieldConfigurations: [fieldConfig('12', 'Softball', DIAMOND_9)],
    umpireConfigs: PLATE_BASE
  },
  {
    id: '3',
    name: 'Baseball',
    fieldConfigurations: [fieldConfig('13', 'Baseball', DIAMOND_9)],
    umpireConfigs: PLATE_BASE
  },
  {
    id: '4',
    name: 'Senior Softball',
    fieldConfigurations: [fieldConfig('14', 'Softball', DIAMOND_10)],
    umpireConfigs: PLATE_BASE
  }
]

// ── Live response shapes (shared-services §8 — RAW snake_case, bare `data`) ──
interface RawPosition {
  id?: number
  position_name?: string
  position_number?: number | null
  x_axis?: number | null
  y_axis?: number | null
  status?: number | null
}
interface RawFieldConfig {
  id: number | string
  name: string
  image?: string | null
  positions?: RawPosition[]
}
interface RawUmpireConfig {
  id: number | string
  code: string
  name: string
  sort_order?: number
  status?: number
}
interface RawSportType {
  id: number | string
  name: string
  field_configurations?: RawFieldConfig[]
  umpire_configs?: RawUmpireConfig[]
}
/** Sport-types uses the bare-`data` envelope (NOT `{ responseStatus, data }`). */
interface SportTypesEnvelope { data?: RawSportType[] }

function mapPosition(p: RawPosition): FieldConfigPosition {
  return {
    id: p.id,
    code: p.position_name ?? '',
    label: p.position_name ?? '',
    // The response carries no `area`; positions only feed preview surfaces,
    // and the forms read just `{ id, name }`, so default to a valid enum.
    area: 'flex',
    positionName: p.position_name,
    positionNumber: p.position_number ?? null,
    xAxis: p.x_axis ?? null,
    yAxis: p.y_axis ?? null,
    status: p.status ?? null
  }
}
function mapFieldConfig(f: RawFieldConfig): FieldConfigurationOption {
  return { id: String(f.id), name: f.name, positions: (f.positions ?? []).map(mapPosition) }
}
function mapUmpireConfig(u: RawUmpireConfig): SportTypeUmpireConfig {
  return { id: String(u.id), code: u.code, name: u.name, sortOrder: u.sort_order ?? 0 }
}
function mapSportType(s: RawSportType): SportType {
  return {
    id: String(s.id),
    name: s.name,
    fieldConfigurations: (s.field_configurations ?? []).map(mapFieldConfig),
    umpireConfigs: (s.umpire_configs ?? [])
      .map(mapUmpireConfig)
      .sort((a, b) => a.sortOrder - b.sortOrder)
  }
}

// ── Client ─────────────────────────────────────────────────────────────
let cached: Promise<SportType[]> | null = null

async function loadSportTypes(): Promise<SportType[]> {
  if (!SPORT_TYPES_ENDPOINT_LIVE) return MOCK_SPORT_TYPES
  // GET /v2/sport-types — bare `data` array of snake_case sport types.
  const payload = await getJson<SportTypesEnvelope>('/sport-types')
  return (payload?.data ?? []).map(mapSportType)
}

/** Fetch the full sport-type catalogue (each with nested field configs +
 *  umpire configs). Page-cached; resolves to `[]` on any error. */
export async function fetchSportTypes(): Promise<SportType[]> {
  if (!cached) {
    cached = loadSportTypes().catch((err) => {
      cached = null
      if (typeof console !== 'undefined') {
        console.warn('[sportTypes] fetch failed.', err)
      }
      return [] as SportType[]
    })
  }
  return cached
}

/** Fetch a single sport type by id (the division form's scope — sport type
 *  is fixed/inherited). Reads from the cached catalogue; `null` if absent. */
export async function fetchSportType(
  sportsTypeId: string | number | null | undefined
): Promise<SportType | null> {
  if (sportsTypeId == null || String(sportsTypeId).trim() === '') return null
  const id = String(sportsTypeId)
  const all = await fetchSportTypes()
  return all.find((s) => s.id === id) ?? null
}
