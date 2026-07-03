---
status: Draft
owner: matchgeni
last_updated: 2026-06-18
---

# Association Ratings — REST API contract

## Context

Per-association catalogue of **team skill tiers** ("ratings") — e.g. SSUSA's `AA` / `AAA` / `Major` / `Major +`, or PSA's `REC` / `COMP`. Each association manages its own list from **Settings → Ratings** (`RatingsManagerModal`), and the **Add/Edit Division** form's rating picker (`MatchGeniDivisionFormModal`) reads the active subset.

**This replaces the legacy global `GET /getAllRatings`** (formerly shared-services §4), which served a single platform-wide list to every association. Ratings are now association-owned full CRUD: the `ratings` table gained an `association_id` FK (+ `sort_order`), so SSUSA and PSA no longer share one list. See [`sql-schema-association.md#ratings`](../system/sql-schema-association.md#ratings) for the table and [`sql-migrations.md`](../system/sql-migrations.md) (M8) for the migration off the global lookup.

For shared rules — response envelope, auth header, error codes — see [`conventions.md`](./conventions.md). Wire fields are **camelCase** per the project-wide convention.

### Wire ↔ column mapping

The existing DB column `rate` is **not** renamed; the API maps it to `name` on the wire (the same way the rest of the app exposes friendly names). `status` (tinyint `1`/`0`) maps to the boolean `active`.

| Wire field | Column | Notes |
|---|---|---|
| `id` | `id` | String on the wire (numeric PK). |
| `name` | `rate` | Display label, e.g. `"Major +"`. Unique per association (soft-delete-aware). |
| `sortOrder` | `sort_order` | Display order within the association's list. |
| `active` | `status` | `true` ↔ `1`, `false` ↔ `0`. Inactive = hidden from the picker, not retired. |

### Underlying table

| Table | Role |
|---|---|
| `ratings` ([sql-schema-association.md#ratings](../system/sql-schema-association.md#ratings)) | The rating row — `association_id` + `rate` + `sort_order` + `status` + audit. Created/updated/retired here. Parent of `divisions.rating_id` and `association_teams.rating_id` (both `ON DELETE RESTRICT`). |

## Endpoints

| # | Endpoint | Notes |
|---|---|---|
| 1 | `GET /v2/association/{associationId}/ratings` | List an association's ratings (optionally active-only). |
| 2 | `POST /v2/association/{associationId}/ratings` | Create a rating. |
| 3 | `PATCH /v2/association/{associationId}/ratings/{ratingId}` | Update a rating (label / order / active). |
| 4 | `DELETE /v2/association/{associationId}/ratings/{ratingId}` | Delete an **unused** rating; an in-use rating is **retired** (soft-deleted) instead. |

The **write** endpoints (2–4) require a session whose caller holds `manage_settings` (or `fullControl`) for the association in the path. The **read** (1) uses the standard session header — any authenticated member of the association can read the list, so the Add/Edit Division picker (whose editors hold `manage_divisions`, not `manage_settings`) still works.

---

## 1. List Ratings

- **Endpoint**: `GET /v2/association/{associationId}/ratings`
- **Purpose**: Return an association's rating catalogue, ordered by `sortOrder`. Backs both the Settings manager (all ratings, incl. inactive) and the division-form picker (active only, via `active=1`).
- **Auth**: Standard session header — any authenticated member of `associationId` may read. (No `manage_settings` gate, so the Add/Edit Division picker can read the active ratings with only `manage_divisions`.)

### Path parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `associationId` | string | yes | Association numeric PK — the scoping owner. |

### Query parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `active` | `'1' \| '0'` | no | `1` → active ratings only (the picker). Omitted → all non-deleted ratings incl. inactive (the Settings manager). Soft-deleted (retired) ratings are **never** returned. |

### Request body

None (GET).

### Response

```json
{
  "responseStatus": { "statusCode": 200, "message": "Ratings fetched successfully.", "text": "OK" },
  "data": {
    "list": [
      { "id": "1", "name": "AA",      "sortOrder": 1, "active": true },
      { "id": "2", "name": "AAA",     "sortOrder": 2, "active": true },
      { "id": "3", "name": "Major",   "sortOrder": 3, "active": true },
      { "id": "4", "name": "Major +", "sortOrder": 4, "active": true }
    ]
  }
}
```

`data.list[]` is sorted ascending by `sortOrder`, then `name` as a tiebreaker.

---

## 2. Create Rating

- **Endpoint**: `POST /v2/association/{associationId}/ratings`
- **Purpose**: Add a rating to the association's catalogue.
- **Auth**: Standard session header + `manage_settings` / `fullControl` for `associationId`.

### Path parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `associationId` | string | yes | Owning association — server stamps it onto `ratings.association_id`. The client does **not** send it in the body. |

### Request body

```jsonc
{
  "name": "Major Gold",   // → ratings.rate (trimmed, required, ≤255)
  "sortOrder": 5,         // → ratings.sort_order (default 0 if omitted)
  "active": true          // → ratings.status (default true → 1)
}
```

### Response

```json
{
  "responseStatus": { "statusCode": 201, "message": "Rating created successfully.", "text": "OK" },
  "data": { "id": "7", "name": "Major Gold", "sortOrder": 5, "active": true }
}
```

### Errors

| Code | When |
|---|---|
| `400` | `name` missing / blank / > 255 chars. |
| `409` | A **live** rating with the same `name` already exists for this association (`uk_ratings_assoc_rate`). A previously-retired label can be re-created (the unique key is soft-delete-aware). |

---

## 3. Update Rating

- **Endpoint**: `PATCH /v2/association/{associationId}/ratings/{ratingId}`
- **Purpose**: Rename a rating, reorder it, or toggle its active flag.
- **Auth**: Standard session header + `manage_settings` / `fullControl` for `associationId`.

### Path parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `associationId` | string | yes | Must own `ratingId` (404 otherwise — no cross-association edits). |
| `ratingId` | string | yes | Rating numeric PK. |

### Request body

Partial — any subset of the writable fields. Toggling `active: false` hides the rating from the picker without retiring it (history still resolves the label).

```jsonc
{
  "name": "Major Gold",   // optional
  "sortOrder": 6,         // optional
  "active": false         // optional
}
```

### Response

```json
{
  "responseStatus": { "statusCode": 200, "message": "Rating updated successfully.", "text": "OK" },
  "data": { "id": "7", "name": "Major Gold", "sortOrder": 6, "active": false }
}
```

### Errors

| Code | When |
|---|---|
| `400` | `name` provided but blank / > 255 chars. |
| `404` | `ratingId` not found, or not owned by `associationId`. |
| `409` | Rename collides with another live rating's `name` for this association. |

---

## 4. Delete Rating

- **Endpoint**: `DELETE /v2/association/{associationId}/ratings/{ratingId}`
- **Purpose**: Remove a rating from the catalogue.
- **Auth**: Standard session header + `manage_settings` / `fullControl` for `associationId`.

### Delete rule (RESTRICT → retire)

`divisions.rating_id → ratings(id)` and `association_teams.rating_id → ratings(id)` are both **`ON DELETE RESTRICT`**, so the behaviour depends on whether the rating is in use:

- **Unused** (zero referencing divisions / team registrations) → **hard delete** (row removed).
- **In use** → the row is **retired** (soft-deleted, `deleted_at` set) instead of destroyed, so historical division / registration reads still resolve the label. The retired rating stops appearing in the picker and the Settings list. The endpoint succeeds either way — the caller doesn't need to know which path ran (the response `mode` reports it).

This mirrors how the app retires rather than destroys other in-use catalogue rows (see [`sql-schema-shared.md#custom_field_values`](../system/sql-schema-shared.md#custom_field_values) "Delete rule").

### Path parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `associationId` | string | yes | Must own `ratingId`. |
| `ratingId` | string | yes | Rating numeric PK. |

### Request body

None (DELETE).

### Response

```json
{
  "responseStatus": { "statusCode": 200, "message": "Rating removed successfully.", "text": "OK" },
  "data": { "id": "7", "mode": "retired" }
}
```

`data.mode` is `"deleted"` (row removed) or `"retired"` (soft-deleted because in use).

### Errors

| Code | When |
|---|---|
| `404` | `ratingId` not found, or not owned by `associationId`. |

---

## Frontend client (this repo)

`src/api/associationRatings.ts` — **mock-first** (mirrors `mediums.ts` / `customFields.ts`) until the endpoints ship; flip `RATINGS_LIVE` + wire the `fetchEnvelope` branches then, the signatures stay:

```ts
import type { RatingOption, RatingInput } from '../types'
// RatingOption = { id: string; name: string; sortOrder?: number; active?: boolean }
// RatingInput  = { name: string; sortOrder: number; active?: boolean }

/** Active ratings for the Add/Edit Division picker. Resolves to [] on any error. */
export async function fetchRatings(opts: { associationId?: string; associationShortName?: string }): Promise<RatingOption[]>
/** All ratings incl. inactive — the Settings manager. */
export async function fetchAllRatings(opts: { associationId?: string; associationShortName?: string }): Promise<RatingOption[]>
export async function createRating(scope: { associationShortName: string }, input: RatingInput): Promise<RatingOption>
export async function updateRating(id: string, input: RatingInput): Promise<RatingOption>
export async function deleteRating(id: string): Promise<void>
```

> The client's `updateRating` currently sends the full `RatingInput` (name + sortOrder + active) on every edit. Documenting §3 as `PATCH` (partial) keeps the door open for field-level edits without a contract change; sending the full set is valid PATCH.

**Consumers:** the Settings manager (`RatingsManagerModal.vue`) authors ratings; the Add/Edit Division form (`MatchGeniDivisionFormModal.vue`) reads the active subset for its rating picker.

## Implementation checklist

| Item | Where |
|---|---|
| `GET` / `POST` / `PATCH` / `DELETE` `…/ratings` routes (RESTRICT→retire on delete) | Backend |
| `ratings` table: add `association_id` FK + `sort_order` + indexes; backfill global rows per association | DB ([sql-schema-association.md#ratings](../system/sql-schema-association.md#ratings), [sql-migrations.md](../system/sql-migrations.md) M8) |
| `fetchRatings` / `fetchAllRatings` / create / update / delete client (mock-first) + `RatingOption` / `RatingInput` types | `src/api/associationRatings.ts`, `src/types.ts` |
| Settings manager + division-form picker consumer | `src/components/RatingsManagerModal.vue`, `src/components/MatchGeniDivisionFormModal.vue` |
