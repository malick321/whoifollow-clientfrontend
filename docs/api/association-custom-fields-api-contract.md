---
status: Draft
owner: matchgeni
last_updated: 2026-06-18
---

# Association Custom Fields — REST API contract

## Context

A generalized, **association-owned** framework for extra fields that admins attach to an entity form — **event**, **division**, or **game** — without a schema change per field. Each association authors its own **definitions** (label + control type + options + scope) from **Settings → Custom Fields** (`CustomFieldsManagerModal`); the matching entity forms render those definitions as dynamic controls (`CustomFieldsRenderer`), and the values the user fills in are persisted per-entity.

This is the catalogue-and-values pattern (mirroring `seeding_criteria` / `event_seed_criteria`):

- **Definitions** — the catalogue ([`custom_field_definitions`](../system/sql-schema-shared.md#custom_field_definitions)): what fields exist, owned by an association, optionally scoped to an entity type and a sport.
- **Values** — the per-entity chosen data ([`custom_field_values`](../system/sql-schema-shared.md#custom_field_values)): what a specific event/division/game has filled in. **Values are not written here** — they ride along on the owning entity's own create/update call (e.g. events send a `customFields` array; see [`association-events-api-contract.md`](./association-events-api-contract.md) §4 / §5).

**Was in shared-services.** This used to live in `shared-services-api-contract.md` (§9). It's been split out because shared-services is reserved for **global, non-scoped, common GET utilities** (weather, catalogues, sport types). Custom fields are **association-scoped CRUD**, so — like [`association-ratings-api-contract.md`](./association-ratings-api-contract.md) — they get their own contract.

For shared rules — **response envelope** (`responseStatus` + `data`), auth header, error codes — see [`conventions.md`](./conventions.md). Wire fields are **camelCase** per the project-wide convention, and every response (including the list) is wrapped in the standard envelope.

### The `CustomFieldDefinition` object

The definition shape returned by every endpoint here, and the body shape the client sends on create / update (minus the server-assigned `id` / `key`).

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable definition id. Persisted as `definitionId` on each submitted custom-field value (see [`association-events-api-contract.md`](./association-events-api-contract.md) §4). |
| `key` | string | Stable machine key, e.g. `"classification"`, `"toc"`. Server-derived from `label` on create if not supplied; immutable thereafter. |
| `label` | string | Display label for the control (e.g. `"Classification"`). |
| `entityType` | string key | Which entity surface the field renders on — `event` / `division` / `game` / `team` / `umpire` / `player` / `product` (the [entity-type catalogue](../system/shared-catalogues.md#8-custom-field-entity-type-catalogue); grows over time). |
| `inputType` | string key | Control type — `boolean` / `single_select` / `multi_select` / `number` / `text` / `date` / `textarea` (the [input-type catalogue](../system/shared-catalogues.md#9-custom-field-input-type-catalogue)). |
| `options` | string[] | Choice list — non-empty for `single_select` / `multi_select`; `[]` for all other types. |
| `required` | boolean | Whether the control is required on the form. |
| `sportsTypeId` | string \| null | Sport scope; `null` = applies to all sports. |
| `sortOrder` | number | Display order within its entity type; lists are sorted ascending by this. |
| `active` | boolean | `false` hides it from forms without retiring it. |

> **Storage.** `entity_type` and `input_type` store the **catalogue string key verbatim** in `VARCHAR` columns — no numeric codes, no reference table (the keys are a developer-owned [shared catalogue](../system/shared-catalogues.md#8-custom-field-entity-type-catalogue)). Only `is_required` / `status` are tinyint `1`/`0`, mapped to the boolean `required` / `active` on the wire. See [`sql-schema-shared.md#custom_field_definitions`](../system/sql-schema-shared.md#custom_field_definitions).

### Underlying tables

| Table | Role |
|---|---|
| `custom_field_definitions` ([sql-schema-shared.md#custom_field_definitions](../system/sql-schema-shared.md#custom_field_definitions)) | The definition catalogue — created/updated/retired here. |
| `custom_field_values` ([sql-schema-shared.md#custom_field_values](../system/sql-schema-shared.md#custom_field_values)) | Per-entity chosen values (written by the owning entity's own endpoint, not here). `definition_id → custom_field_definitions(id)` is **`ON DELETE RESTRICT`**. |

## Endpoints

| # | Endpoint | Notes |
|---|---|---|
| 1 | `GET /v2/association/{associationId}/custom-fields` | List definitions for an entity (`entityType` required). Form → `&active=1` (active only); Settings manager → omit `active` (all statuses). |
| 2 | `POST /v2/association/{associationId}/custom-fields` | Create a definition. |
| 3 | `PATCH /v2/association/{associationId}/custom-fields/{id}` | Update a definition. |
| 4 | `DELETE /v2/association/{associationId}/custom-fields/{id}` | Delete an **unused** definition; an in-use one is **retired** (soft-deleted) instead. |

The write endpoints (2–4) require a session whose caller holds `manage_settings` (or `fullControl`) for the association. The read (1) uses the standard session header — any user who can open the entity form can read its definitions.

---

## 1. Get Custom Fields (definitions for an entity form)

- **Endpoint**: `GET /v2/association/{associationId}/custom-fields`
- **Purpose**: Return the active custom-field definitions that apply to a given entity form for this association — consumed by the Add/Edit Event wizard (and later Division / Game forms) to render dynamic controls.
- **Auth**: Standard session header.

### Path parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `associationId` | number | yes | Owning association — only definitions with this `association_id` are returned. |

### Query parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `entityType` | string key | **yes** | Which entity surface the controls belong to — an [entity-type catalogue](../system/shared-catalogues.md#8-custom-field-entity-type-catalogue) key (`event`, `division`, `game`, `team`, …). **Always required** — scoping by entity keeps the list bounded as definitions grow (no "fetch everything" call). `400` when missing or not a known key. |
| `sportsTypeId` | number | no | When given, **includes** sport-scoped definitions for that sport (`sports_type_id = sportsTypeId`) **in addition to** sport-agnostic ones (`sports_type_id IS NULL`). When omitted, only sport-agnostic definitions are returned. |
| `active` | `'1'` | no | `1` → **active definitions only** (the **entity form** sends this — it only renders active controls). When **omitted**, returns **all** definitions regardless of status — active *and* inactive (the **Settings manager** sends nothing, because it must list inactive controls so an admin can re-activate them). Retired (soft-deleted) definitions are never returned either way. |

> **Two consumers, two call shapes** (both always send `entityType`):
> - **Entity form** (event / division wizard) → `?entityType=<key>&active=1` (+ `sportsTypeId` when relevant): one entity, active only — the controls to render.
> - **Settings manager** → `?entityType=<key>` (no `active`): one entity, **all statuses** (active + inactive). The manager's entity dropdown is a **server-side filter** — it fetches one entity at a time, defaulting to `event` on open, and re-fetches on dropdown change. (A multi-entity "show all" view is deferred until this list needs pagination.)

### Request body

None (GET).

### Response

```json
{
  "responseStatus": { "statusCode": 200, "message": "Custom fields loaded.", "text": "OK" },
  "data": {
    "list": [
      { "id": "10", "key": "classification", "label": "Classification", "entityType": "event", "inputType": "single_select", "options": ["Qualifier", "Championship"], "required": false, "sportsTypeId": null, "sortOrder": 1, "active": true },
      { "id": "11", "key": "toc", "label": "Tournament of Champions", "entityType": "event", "inputType": "boolean", "options": [], "required": false, "sportsTypeId": null, "sortOrder": 2, "active": true }
    ]
  }
}
```

`data.list[]` is sorted ascending by `sortOrder`. Each entry is a `CustomFieldDefinition` (see above).

### Error handling (degrade, don't break)

| Code | When |
|---|---|
| `400` | `entityType` missing, or not a known catalogue key. |
| `200` | Normal — `data` populated. |
| `200` (empty `data`) / transport error | The frontend client (`src/api/customFields.ts`) catches any failure and resolves to an **empty array** so the form renders no custom controls rather than erroring (non-critical — the framework is additive). |

### Caching

Reference data, but **admin-editable** — admins can add / edit / reorder definitions, so cache **short-lived**. The client caches per `associationId` + `entityType` + `sportsTypeId` (one entry per distinct form context); `Cache-Control: public, max-age=60` is appropriate at the edge.

---

## 2. Create Custom Field

- **Endpoint**: `POST /v2/association/{associationId}/custom-fields`
- **Purpose**: Add a definition to the association's catalogue.
- **Auth**: Standard session header + `manage_settings` / `fullControl` for `associationId`.

### Path parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `associationId` | number | yes | Owning association — server stamps it onto `association_id`. Not sent in the body. |

### Request body

A `CustomFieldDefinition` minus the server-assigned `id` / `key`:

```jsonc
{
  "entityType": "event",                      // required
  "label": "Classification",                  // required
  "inputType": "single_select",               // required
  "options": ["Qualifier", "Championship"],   // required & non-empty for select types; [] otherwise
  "required": false,
  "sportsTypeId": null,                       // null = all sports
  "sortOrder": 3,                             // auto-maintained client-side (existing of that entity + 1)
  "active": true
}
```

`key` is derived server-side from `label` (slugified, uniqued per association + entity type).

### Response

```json
{
  "responseStatus": { "statusCode": 201, "message": "Custom field created.", "text": "Created" },
  "data": { "id": "12", "key": "classification", "label": "Classification", "entityType": "event", "inputType": "single_select", "options": ["Qualifier", "Championship"], "required": false, "sportsTypeId": null, "sortOrder": 3, "active": true }
}
```

### Errors

| Code | When |
|---|---|
| `400` | `label` missing / blank; select type with empty `options`; `entityType` / `inputType` not a known value. |
| `409` | A live definition with the same `key` already exists for this association + entity type. |

---

## 3. Update Custom Field

- **Endpoint**: `PATCH /v2/association/{associationId}/custom-fields/{id}`
- **Purpose**: Edit a definition (label / type / options / scope / required / order / active).
- **Auth**: Standard session header + `manage_settings` / `fullControl` for `associationId`.

### Path parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `associationId` | number | yes | Must own `{id}` (404 otherwise — no cross-association edits). |
| `id` | number | yes | Definition id. |

### Request body

Partial — any subset of the writable fields (`label`, `options`, `required`, `sportsTypeId`, `sortOrder`, `active`). Toggling `active: false` hides the field from forms without retiring it (history still resolves the label). The Settings manager currently sends the full object on every edit, which is valid `PATCH`.

> **`entityType` and `inputType` are immutable after creation** (the UI locks both). Stored answers in `custom_field_values` are strings encoded per the field's *original* `inputType` (`"1"`/`"0"` for boolean, the chosen option for single_select, a JSON array for multi_select, etc.), so changing the type would reinterpret — and corrupt — every historical value. To use a different type, create a new field. The backend must **reject** an attempt to change either field with `409` (it shouldn't happen via the UI, but the API enforces it). Renaming the `label` is always safe.

> **Editing `options` is allowed but handle removals carefully.** **Adding** a choice is always safe (and a common need — e.g. a new tier next season). **Removing or renaming** an existing choice can orphan stored values: an entity that saved `"Qualifier"` would no longer match any current option. The raw value stays intact in `custom_field_values`, so the backend / read path must **still resolve and display the original stored string** even when its choice was later removed (don't blank it out) — the option list governs only what's *selectable on new input*, not how history renders. The UI keeps `options` editable for this reason.

### Response

```json
{
  "responseStatus": { "statusCode": 200, "message": "Custom field updated.", "text": "OK" },
  "data": { "id": "12", "key": "classification", "label": "Division Classification", "entityType": "event", "inputType": "single_select", "options": ["Qualifier", "Championship"], "required": true, "sportsTypeId": null, "sortOrder": 3, "active": true }
}
```

### Errors

| Code | When |
|---|---|
| `400` | Same validation as create. |
| `404` | `{id}` not found, or not owned by `associationId`. |
| `409` | `key` collision, or an attempt to change the immutable `entityType` / `inputType`. |

---

## 4. Delete Custom Field

- **Endpoint**: `DELETE /v2/association/{associationId}/custom-fields/{id}`
- **Purpose**: Remove a definition from the catalogue.
- **Auth**: Standard session header + `manage_settings` / `fullControl` for `associationId`.

### Delete rule (RESTRICT → retire)

`custom_field_values.definition_id → custom_field_definitions(id)` is **`ON DELETE RESTRICT`**, so behaviour depends on whether the definition has stored values:

- **No stored values** → **hard delete** (row removed).
- **Has values** → the definition is **retired** (soft-deleted, `deleted_at` set) instead of destroyed. Its row + values are kept so historical reads still resolve the label; it stops rendering on forms. A hard `DELETE` against an in-use definition is rejected at the DB (RESTRICT), so the backend converts it to a retire. Setting `active = 0` (`status = 0`) merely hides it without retiring.

This mirrors how the app retires rather than destroys other in-use catalogue rows (see [`association-ratings-api-contract.md`](./association-ratings-api-contract.md) §4 and [`sql-schema-shared.md#custom_field_values`](../system/sql-schema-shared.md#custom_field_values) "Delete rule").

The UI presents this in plain language ("This field will no longer appear when adding or editing. Anything already filled in on past entries stays safe.").

### Path parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `associationId` | number | yes | Must own `{id}`. |
| `id` | number | yes | Definition id. |

### Request body

None (DELETE).

### Response

```json
{
  "responseStatus": { "statusCode": 200, "message": "Custom field removed.", "text": "OK" },
  "data": { "id": "12", "mode": "retired" }
}
```

`data.mode` is `"deleted"` (row removed) or `"retired"` (soft-deleted because in use).

### Errors

| Code | When |
|---|---|
| `404` | `{id}` not found, or not owned by `associationId`. |

---

## Frontend client (this repo)

`src/api/customFields.ts` — **mock-first** (like `src/api/mediums.ts` / `src/api/associationRatings.ts`) until the endpoints ship; flip the `*_LIVE` flag + wire the `fetchEnvelope` branches then, the signatures stay:

```ts
import type { CustomFieldDefinition, CustomFieldDefinitionInput } from '../types'
// CustomFieldDefinition = {
//   id: string; key: string; label: string
//   inputType: 'boolean'|'single_select'|'multi_select'|'number'|'text'|'date'|'textarea'
//   options: string[]; required: boolean; sortOrder: number
//   entityType?: 'event'|'division'|'game'; sportsTypeId?: string|null; active?: boolean
// }

/** Active definitions for an entity form. Resolves to [] on any error. */
export async function fetchCustomFieldDefinitions(
  entityType: 'event' | 'division' | 'game',
  opts: { associationId: number | string; sportsTypeId?: number | null }
): Promise<CustomFieldDefinition[]>

// Settings manager CRUD:
export async function fetchAllCustomFieldDefinitions(opts): Promise<CustomFieldDefinition[]>
export async function createCustomFieldDefinition(scope, input: CustomFieldDefinitionInput): Promise<CustomFieldDefinition>
export async function updateCustomFieldDefinition(id: string, input: CustomFieldDefinitionInput): Promise<CustomFieldDefinition>
export async function deleteCustomFieldDefinition(id: string): Promise<void>
```

`CustomFieldDefinition` / `CustomFieldDefinitionInput` / `CustomFieldValue` are in `src/types.ts`.

**Consumers:** the Settings manager (`CustomFieldsManagerModal.vue`, with a live `CustomFieldsRenderer` preview) authors definitions; the Add/Edit Event wizard renders them and submits chosen values as `customFields` (see [`association-events-api-contract.md`](./association-events-api-contract.md) §4 / §5). Later: Add/Edit Division, Game forms.

## Implementation checklist

| Item | Where |
|---|---|
| `GET /v2/association/{associationId}/custom-fields` route — active definitions per association + `entityType` (+ `sportsTypeId` scope) | Backend |
| `POST` / `PATCH` / `DELETE` custom-fields routes (create / update / retire-on-RESTRICT) | Backend |
| `custom_field_definitions` + `custom_field_values` tables (FK `definition_id` RESTRICT) | DB ([sql-schema-shared.md](../system/sql-schema-shared.md)) |
| `fetchCustomFieldDefinitions()` + manager CRUD client (mock-first) + types | `src/api/customFields.ts`, `src/types.ts` |
| Renderer + Settings manager (with live preview) | `src/components/CustomFieldsRenderer.vue`, `src/components/CustomFieldsManagerModal.vue` |
| Event consumer (render + submit `customFields`) | `src/components/MatchGeniEventFormModal.vue` |
