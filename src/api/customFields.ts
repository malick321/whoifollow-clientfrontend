// customFields
// ------------
// Generalized, association-owned "custom fields" framework. Admins define
// controls per entity (event / division / game) that render dynamically on
// the matching form; values are stored per entity. Catalogue =
// `custom_field_definitions`, values = `custom_field_values`.
//
// Read (forms):    GET /v2/association/{associationId}/custom-fields?entityType&sportsTypeId
// Manage (settings): list / create / update / delete the same definitions.
//
// Contract: `docs/api/association-custom-fields-api-contract.md` — standard v2
// envelope, camelCase `CustomFieldDefinition` on the wire. `entityType` /
// `inputType` are shared-catalogue string keys (see CUSTOM_FIELD_ENTITY_TYPES /
// CUSTOM_FIELD_INPUT_TYPES below + docs/system/shared-catalogues.md) — stored
// verbatim in the VARCHAR columns, no numeric codes anywhere.
//
// Mock-first (mirrors `mediums.ts` / `sportTypes.ts` / `associationRatings.ts`)
// — flip `CUSTOM_FIELDS_LIVE` and wire the live branches once the endpoints
// ship. The `StoredDefinition` below simulates the DB row (snake_case columns,
// string keys); the live client reads the camelCase definition straight off
// the envelope's `data` / `data.list`.

import { getJson, postJson, patchJson, deleteJson } from './client'
import type {
  CustomFieldDefinition,
  CustomFieldDefinitionInput,
  CustomFieldEntityType,
  CustomFieldInputType
} from '../types'

const CUSTOM_FIELDS_LIVE = true

/** Standard v2 envelope. */
interface Envelope<T> {
  responseStatus?: { statusCode: number; message?: string; text?: string }
  data: T
}

// ── Shared catalogues (single source of truth) ─────────────────────────────
// Both columns store the snake_case KEY as a string (VARCHAR), not a numeric
// code — see docs/system/shared-catalogues.md. Keep these in lockstep with the
// backend config + the `CustomFieldEntityType` / `CustomFieldInputType` unions.

/** Entity surfaces a custom field can attach to (the "Appears on" choices +
 *  the list filter). Ordered for display. */
export const CUSTOM_FIELD_ENTITY_TYPES: { value: CustomFieldEntityType; label: string }[] = [
  { value: 'event', label: 'Event' },
  { value: 'division', label: 'Division' },
  { value: 'game', label: 'Game' },
  { value: 'team', label: 'Team' },
  { value: 'umpire', label: 'Umpire' },
  { value: 'player', label: 'Player' },
  { value: 'product', label: 'Product' }
]

/** Control widgets the renderer supports. */
export const CUSTOM_FIELD_INPUT_TYPES: { value: CustomFieldInputType; label: string }[] = [
  { value: 'boolean', label: 'Toggle (yes / no)' },
  { value: 'single_select', label: 'Single choice' },
  { value: 'multi_select', label: 'Multiple choice' },
  { value: 'number', label: 'Number' },
  { value: 'text', label: 'Text' },
  { value: 'date', label: 'Date' },
  { value: 'textarea', label: 'Long text' }
]

export function entityTypeLabel(v?: CustomFieldEntityType): string {
  return CUSTOM_FIELD_ENTITY_TYPES.find((o) => o.value === v)?.label ?? '—'
}
export function inputTypeLabel(v: CustomFieldInputType): string {
  return CUSTOM_FIELD_INPUT_TYPES.find((o) => o.value === v)?.label ?? v
}

// ── Mock store ───────────────────────────────────────────────────────────
// Simulates the `custom_field_definitions` row. The DB stores the catalogue
// string keys directly (entity_type / input_type are VARCHAR), so the mock
// holds the same strings — no code translation. Seeded with the two agreed
// uses: an event Classification (single-select) and an SSUSA TOC boolean.
// `sports_type_id` null = applies to every sport.
interface StoredDefinition {
  id: number
  association_short: string           // owning association (mock scope)
  entity_type: CustomFieldEntityType
  field_key: string
  label: string
  input_type: CustomFieldInputType
  options: string[] | null
  is_required: number
  sort_order: number
  status: number                      // 1 = active
  sports_type_id: string | null
}

let MOCK_DEFINITIONS: StoredDefinition[] = [
  { id: 1, association_short: 'ssusa', entity_type: 'event', field_key: 'classification', label: 'Classification', input_type: 'single_select', options: ['Qualifier', 'Championship'], is_required: 0, sort_order: 1, status: 1, sports_type_id: null },
  { id: 2, association_short: 'ssusa', entity_type: 'event', field_key: 'toc', label: 'Tournament of Champions', input_type: 'boolean', options: null, is_required: 0, sort_order: 2, status: 1, sports_type_id: null },
  { id: 3, association_short: 'ssusa', entity_type: 'event', field_key: 'tournament_format', label: 'Tournament Format', input_type: 'textarea', options: null, is_required: 0, sort_order: 3, status: 1, sports_type_id: null },
  { id: 4, association_short: 'ssusa', entity_type: 'event', field_key: 'refund_policy', label: 'Refund Policy', input_type: 'textarea', options: null, is_required: 0, sort_order: 4, status: 1, sports_type_id: null },
  { id: 5, association_short: 'ssusa', entity_type: 'event', field_key: 'reminder', label: 'Reminder', input_type: 'textarea', options: null, is_required: 0, sort_order: 5, status: 1, sports_type_id: null }
]
let nextId = 6

function mapDefinition(d: StoredDefinition): CustomFieldDefinition {
  return {
    id: String(d.id),
    key: d.field_key,
    label: d.label,
    inputType: d.input_type,
    options: Array.isArray(d.options) ? d.options : [],
    required: d.is_required === 1,
    sortOrder: d.sort_order,
    entityType: d.entity_type,
    sportsTypeId: d.sports_type_id,
    active: d.status === 1
  }
}

/** Machine key from a label: lowercase, alnum + underscores. */
function slugify(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'field'
}

/** Pull the definitions array off a live response, tolerating both envelope
 *  shapes: the documented `{ data: { list: [...] } }` AND a bare `{ data: [...] }`
 *  (some v2 endpoints ship `data` as a bare array — sport-types/resources do).
 *  Without this, a bare-array response silently reads as empty. */
function extractDefinitions(env: unknown): CustomFieldDefinition[] {
  const data = (env as { data?: unknown } | null)?.data
  if (Array.isArray(data)) return data as CustomFieldDefinition[]
  const list = (data as { list?: unknown } | null | undefined)?.list
  return Array.isArray(list) ? (list as CustomFieldDefinition[]) : []
}

// Bust the render-fetch cache whenever definitions change.
function invalidate() { formCache.clear() }

// ── Read (forms) ─────────────────────────────────────────────────────────
// Memoized per form context — keyed by `entityType | associationId |
// associationShortName | sportsTypeId` so the event popup and the division
// popup (different entities) stay cached simultaneously, and re-opening the
// same popup serves from memory. Busted on any definition edit (`invalidate`).
const formCache = new Map<string, Promise<CustomFieldDefinition[]>>()

/** Active definitions that apply to a form — filtered by association +
 *  entity, plus sport scope when `sportsTypeId` is given. Resolves to `[]`
 *  on any error (non-critical lookup). */
export async function fetchCustomFieldDefinitions(
  entityType: CustomFieldEntityType,
  opts: { associationId?: string; associationShortName?: string; sportsTypeId?: string } = {}
): Promise<CustomFieldDefinition[]> {
  const key = `${entityType}|${opts.associationId ?? ''}|${opts.associationShortName ?? ''}|${opts.sportsTypeId ?? ''}`
  const hit = formCache.get(key)
  if (hit) return hit
  const inFlight = loadFormDefinitions(entityType, opts).catch((err) => {
    formCache.delete(key)
    if (typeof console !== 'undefined') console.warn('[customFields] fetch failed.', err)
    return [] as CustomFieldDefinition[]
  })
  formCache.set(key, inFlight)
  return inFlight
}

async function loadFormDefinitions(
  entityType: CustomFieldEntityType,
  opts: { associationId?: string; associationShortName?: string; sportsTypeId?: string }
): Promise<CustomFieldDefinition[]> {
  if (CUSTOM_FIELDS_LIVE) {
    // GET /v2/association/{associationId}/custom-fields?entityType&sportsTypeId&active=1
    // `data.list` is already the camelCase `CustomFieldDefinition` shape.
    const id = encodeURIComponent(opts.associationId ?? '')
    const q = new URLSearchParams({ entityType, active: '1' })
    if (opts.sportsTypeId) q.set('sportsTypeId', opts.sportsTypeId)
    const env = await getJson<Envelope<{ list: CustomFieldDefinition[] }>>(
      `/association/${id}/custom-fields?${q.toString()}`
    )
    return extractDefinitions(env)
  }
  const assoc = (opts.associationShortName ?? '').toLowerCase()
  return MOCK_DEFINITIONS
    .filter((d) => d.entity_type === entityType && d.status === 1)
    .filter((d) => !assoc || d.association_short === assoc)
    .filter((d) => d.sports_type_id == null || d.sports_type_id === (opts.sportsTypeId ?? ''))
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(mapDefinition)
}

// ── Manage (settings) ────────────────────────────────────────────────────

/** Settings-manager listing for ONE entity type. `entityType` is **required**
 *  (the backend enforces it — keeps the list bounded as data grows). **No
 *  `active` param**: the manager must show BOTH active and inactive so the
 *  admin can toggle them, so it omits `active` and the backend returns all
 *  statuses. The manager's entity dropdown drives this (one call per selected
 *  entity, defaulting to `event`). */
export async function fetchManagerCustomFieldDefinitions(
  entityType: CustomFieldEntityType,
  opts: { associationId?: string; associationShortName?: string } = {}
): Promise<CustomFieldDefinition[]> {
  if (CUSTOM_FIELDS_LIVE) {
    const id = encodeURIComponent(opts.associationId ?? '')
    const q = new URLSearchParams({ entityType }) // no `active` → all statuses
    const env = await getJson<Envelope<{ list: CustomFieldDefinition[] }>>(
      `/association/${id}/custom-fields?${q.toString()}`
    )
    return extractDefinitions(env).sort((a, b) => a.sortOrder - b.sortOrder)
  }
  const assoc = (opts.associationShortName ?? '').toLowerCase()
  return MOCK_DEFINITIONS
    .filter((d) => d.entity_type === entityType)
    .filter((d) => !assoc || d.association_short === assoc)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(mapDefinition)
}

export async function createCustomFieldDefinition(
  opts: { associationId: string; associationShortName?: string },
  input: CustomFieldDefinitionInput
): Promise<CustomFieldDefinition> {
  if (CUSTOM_FIELDS_LIVE) {
    const env = await postJson<Envelope<CustomFieldDefinition>>(
      `/association/${encodeURIComponent(opts.associationId)}/custom-fields`,
      {
        entityType: input.entityType,
        label: input.label.trim(),
        inputType: input.inputType,
        options: input.options,
        required: input.required,
        sportsTypeId: input.sportsTypeId,
        sortOrder: input.sortOrder,
        active: input.active
      }
    )
    invalidate()
    return env.data
  }
  const def: StoredDefinition = {
    id: nextId++,
    association_short: (opts.associationShortName ?? '').toLowerCase(),
    entity_type: input.entityType,
    field_key: slugify(input.label),
    label: input.label.trim(),
    input_type: input.inputType,
    options: input.options.length ? input.options : null,
    is_required: input.required ? 1 : 0,
    sort_order: input.sortOrder,
    status: input.active ? 1 : 0,
    sports_type_id: input.sportsTypeId
  }
  MOCK_DEFINITIONS.push(def)
  invalidate()
  return mapDefinition(def)
}

export async function updateCustomFieldDefinition(
  associationId: string,
  id: string,
  input: CustomFieldDefinitionInput
): Promise<CustomFieldDefinition> {
  if (CUSTOM_FIELDS_LIVE) {
    // entityType / inputType are immutable server-side; send the editable
    // subset (the backend accepts the full object on PATCH).
    const env = await patchJson<Envelope<CustomFieldDefinition>>(
      `/association/${encodeURIComponent(associationId)}/custom-fields/${encodeURIComponent(id)}`,
      {
        label: input.label.trim(),
        options: input.options,
        required: input.required,
        sportsTypeId: input.sportsTypeId,
        sortOrder: input.sortOrder,
        active: input.active
      }
    )
    invalidate()
    return env.data
  }
  const d = MOCK_DEFINITIONS.find((x) => String(x.id) === id)
  if (!d) throw new Error('Definition not found.')
  d.entity_type = input.entityType
  d.label = input.label.trim()
  d.field_key = slugify(input.label)
  d.input_type = input.inputType
  d.options = input.options.length ? input.options : null
  d.is_required = input.required ? 1 : 0
  d.sort_order = input.sortOrder
  d.status = input.active ? 1 : 0
  d.sports_type_id = input.sportsTypeId
  invalidate()
  return mapDefinition(d)
}

export async function deleteCustomFieldDefinition(associationId: string, id: string): Promise<void> {
  // RESTRICT → retire: an in-use definition is soft-deleted server-side.
  if (CUSTOM_FIELDS_LIVE) {
    await deleteJson<Envelope<{ id: string; mode: string }>>(
      `/association/${encodeURIComponent(associationId)}/custom-fields/${encodeURIComponent(id)}`
    )
    invalidate()
    return
  }
  MOCK_DEFINITIONS = MOCK_DEFINITIONS.filter((x) => String(x.id) !== id)
  invalidate()
}
