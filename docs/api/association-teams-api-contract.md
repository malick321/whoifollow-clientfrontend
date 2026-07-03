---
status: Draft (v1)
owner: shared
last_updated: 2026-06-20
---

# Association Teams — REST API contract

## Context

Powers the Association Portal **Teams** page (`src/views/AssociationTeamsView.vue`), the **team-details** page (`src/views/AssociationTeamDetailsView.vue`) and their modals (Register Team, Edit Team, the validity/status-change popups, and the Lifecycle timeline). When wired, replaces the mock layer in `src/api/associationTeams.ts` (the function signatures there already mirror these endpoints 1:1, so the view doesn't need to know it moved off mock).

All endpoints are rooted under `/v2/association/teams/{associationId}/...`. For shared rules — response envelope, pagination shape, auth header, error codes, and the `permissions_json` encoding — see [`conventions.md`](./conventions.md).

**Naming convention (wire ≠ DB).** Request bodies, response payloads, and query parameters all use **camelCase consistently** — every field on the v2 wire is camelCase regardless of how the underlying column is named in the database. DB column names (`registration_no`, `external_reg_no`, `expiry_date`, `never_expires`, …) appear in this contract only inside the SQL sketches; every other reference is the wire field name.

ID literals in the JSON examples below use prefixed stubs (`at_…`, `u_…`, `po_…`) for doc readability only — production serializes the bare `BIGINT UNSIGNED` PK as a numeric string. See [`conventions.md` § Doc-example IDs vs wire IDs](./conventions.md#doc-example-ids-vs-wire-ids).

## Endpoints summary

| # | Method & path | Purpose |
|---|---|---|
| 1 | `GET /v2/association/teams/{associationId}` | Paginated, filtered, searchable team roster (the listing). |
| 2 | `GET /v2/association/teams/{associationId}/{associationTeamId}` | One registration — hydrates the details page + Edit modal. |
| 3 | `POST /v2/association/teams/{associationId}` | Register a new team — initial status (`pending` or `active`) chosen in the wizard. |
| 4 | `PATCH /v2/association/teams/{associationId}/{associationTeamId}` | Edit an existing registration's profile fields. |
| 5 | `POST /v2/association/teams/{associationId}/{associationTeamId}/activate` | `mark_active` — `pending`/`rejected` → `active` (+ validity + source). |
| 6 | `POST /v2/association/teams/{associationId}/{associationTeamId}/renew` | `renew` — `expired`/`active` → `active` (+ validity + source). |
| 7 | `POST /v2/association/teams/{associationId}/{associationTeamId}/suspend` | `suspend` — `active` → `suspended` (reason required). |
| 8 | `POST /v2/association/teams/{associationId}/{associationTeamId}/reactivate` | `reactivate` — `suspended` → `active` (+ validity). |
| 9 | `PATCH /v2/association/teams/{associationId}/{associationTeamId}/validity` | `validity_change` — change expiry, status unchanged. |
| 10 | `POST /v2/association/teams/{associationId}/{associationTeamId}/reject` | `reject` — `pending`/`active` → `rejected` (reason required). |
| 11 | `GET /v2/association/teams/{associationId}/{associationTeamId}/lifecycle` | The append-only lifecycle audit log (timeline) — **paginated** (25/page). |

Every lifecycle mutation (#5–#10) appends exactly one `association_team_lifecycle` row and returns the **updated `AssociationTeam`** (§12). The new audit row is readable via #11.

## Scope decisions (locked in)

- **Permission gate**: every endpoint requires `manage_teams` on the caller's `association_users` row (or `fullControl = TRUE`). Without it → `403`.
- **`{associationTeamId}` is the `association_teams.id`** (numeric string), NOT the global `teams.id`. The route may also accept `association_team_guid` — backend resolves either to the row; this contract uses the numeric id in examples.
- **Two ids, two identities.** Every team object carries both: `id` (the **registration** — `association_teams.id`, what every endpoint in this portal operates on) and `teamId` (the **global team** — `association_teams.team_id`, FK to the `teams` table). `teamId` back-links the registration to the underlying WIF team that owns members, team chat, schedules, etc. One global team can register with many associations — each registration is its own `association_teams` row but shares the same `teamId`. **`teamId` is always returned** on the list (§1) and get-one (§2).
- **Two onboarding flows, one model.** Normally a user signs up, creates their WIF **team**, then registers that team with an association. This admin flow runs it in reverse: the admin registers a team here, the backend **creates the global `teams` row** (→ `teamId`) and links it via `association_teams.team_id`, then (when the manager isn't on WIF) emails an invite so the manager joins and takes over the team. Either direction lands the same shape: a `teams` row + an `association_teams` registration pointing at it.
- **Ownership / scoping (server-derived, never in the body).** `association_id` ← the numeric `{associationId}` path param. Every read and write is filtered to `association_id = :associationId AND deleted_at IS NULL`. A registration belonging to a different association → `404` (never leaks).
- **`registration_no` (the WIF-issued "system" reg number) is server-generated and read-only** — assigned on register (per-association unique), never client-set or editable. Same spirit as the event `slug` / custom-field `key`.
- **Create sets the initial status; edit never changes it.** On create, the frontend submits `registrationStatus` (`pending` or `active` only) — **derived** from whether a fee applies + the collection choice (no fee + "Activate now", or a fee paid offline → `active`; otherwise `pending`), not a free toggle. The backend re-derives it against `association_reg_settings` + the payment outcome (a fee collected online stays `pending` until paid). `expired` / `suspended` / `rejected` are reached only via the lifecycle endpoints. After create, status moves **only** through the lifecycle action endpoints (#5–#10). The Edit endpoint (#4) touches profile fields only — it cannot change `registration_status`, `registration_no`, or validity.
- **Validity has two shapes, mutually exclusive**: `neverExpires: true` (no expiry; `validUntil` ignored/cleared) OR `neverExpires: false` + a concrete `validUntil` date.
- **Reason is required for `suspend` and `reject`**, optional for every other action. Enforced at the app layer (the DB intentionally has no CHECK constraint) → `422` on empty.
- **`source` (`payment` | `manual`) is only meaningful for `activate` / `renew`.** When `source = payment`, `paymentOrderId` is required and `amountCents` is recorded; for `manual` both are null.
- **Soft delete only.** There is no hard-delete endpoint — a cancelled registration becomes `rejected` and stays in the table (the audit chain is protected by `ON DELETE RESTRICT` on the lifecycle FK). Removing a registration entirely is out of scope for v1.
- **`expired` is a passive, system-driven transition** (nightly auto-expire job on `expiry_date`), not an admin action — there is no "expire" endpoint. It surfaces in the timeline as a system-actor row (`actorUserId: null`).

## Underlying tables

| Table | Purpose |
|---|---|
| `association_teams` | The registration master record. See [`sql-schema-association.md`](../system/sql-schema-association.md#association_teams). |
| `association_team_lifecycle` | Append-only status/validity audit log. See [`sql-schema-association.md`](../system/sql-schema-association.md#association_team_lifecycle). |
| `teams` | Global team identity (`team_id` FK). Out of scope for this contract. |
| `age_groups` | Age-group lookup (`age_group_id` FK). Shared catalogue — see [`shared-services-api-contract.md`](./shared-services-api-contract.md). |
| `ratings` | Association-scoped skill-tier catalogue (`rating_id` FK). See [`association-ratings-api-contract.md`](./association-ratings-api-contract.md). |
| `users` | Manager link (`manager_linked_user_id`) + lifecycle `actor_user_id` resolution. |

## Status enum

The wire always carries the **string** status — one of `pending | active | expired | rejected | suspended`. The DB stores `registration_status` as an `INT` today; the backend serializer maps int ↔ string on read/write, and a migration to a string `ENUM` (matching `association_team_lifecycle.to_status`) is planned (see `sql-migrations.md`). The int↔string mapping is **backend-internal** — clients must never send or assume the integer. Illustrative only (must match production's existing values):

| String | Int (illustrative) | Meaning |
|---|---|---|
| `pending` | 0 | Registered, awaiting activation. No validity yet. |
| `active` | 1 | Live registration; honors `expiry_date` unless `neverExpires`. |
| `expired` | 2 | Past `expiry_date` (set by the nightly job). Renewable. |
| `rejected` | 3 | Cancelled / never approved. |
| `suspended` | 4 | Admin hold; validity preserved for reactivation. |

---

## 1. List Association Teams

- **Endpoint**: `GET /v2/association/teams/{associationId}`
- **Purpose**: Drives the main Teams listing — status filter, multi-select age-group / rating / gender / state facets, search, and continuous scroll (page size 25).
- **Table sources**: `association_teams` filtered to `association_id = :associationId AND deleted_at IS NULL`, LEFT JOIN `age_groups` + `ratings` for the display labels.

### Query parameters

In addition to the standard `page` / `per_page` pagination params from [conventions](./conventions.md#pagination-envelope-laravel-paginator):

| Name | Type | Default | Notes |
|---|---|---|---|
| `status` | `AssociationTeamStatus` | `active` | Single-value lifecycle filter. The UI defaults to `active`; the status pills switch it. A value outside the enum → `422`. |
| `ageGroupId` | string (comma-separated ids) | `""` | Multi-select facet — comma-joined `age_groups.id` list (`IN`). Empty = no constraint. |
| `ratingId` | string (comma-separated ids) | `""` | Multi-select facet — comma-joined `ratings.id` list (`IN`). Empty = no constraint. |
| `gender` | string (comma-separated) | `""` | Multi-select — comma-joined subset of `Male,Female,Coed`. Empty = no constraint. |
| `state` | string (comma-separated) | `""` | Multi-select — comma-joined two-letter state codes. Empty = no constraint. |
| `search` | string | `""` | Case-insensitive partial match on registered team name, manager name, `registration_no`, `external_reg_no`, city, and state. |
| `sort` | `'name' \| 'lastUpdatedAt' \| 'validUntil'` | `'name'` | |
| `order` | `'asc' \| 'desc'` | `'asc'` | |

> Wire format for the multi-select facets is comma-separated for URL friendliness; the backend explodes on `,` into the `IN` list. The frontend stores them as arrays (`ageGroupFilter[]`, `ratingFilter[]`, `genderFilter[]`, `stateFilter[]`) and joins on the way out.

### Request body

None (GET).

### Response (paginated)

`data` is the standard Laravel paginator. Each row in `data.data[]` is a **base** `AssociationTeam` (§12) — **without `customFields`** (the list stays lightweight; fetch get-one §2 for those).

```jsonc
{
  "responseStatus": { "message": "OK", "statusCode": 200, "text": "OK" },
  "data": {
    "current_page": 1,
    "per_page": 25,
    "total": 1710,
    "from": 1,
    "to": 25,
    "data": [
      {
        "id": "at_382",
        "teamId": "t_382",
        "name": "Action Jackson",
        "avatarUrl": "https://cdn.whoifollow.tech/teams/382.png",
        "status": "active",
        "gender": "Male",
        "ageGroup": "50 Older",
        "ageGroupId": "ag_7",
        "rating": "Major+",
        "ratingId": "r_4",
        "city": "Austin",
        "state": "TX",
        "lastUpdatedAt": "2026-05-04T00:00:00.000Z",
        "systemRegNo": "SSUSA00382",
        "externalRegNo": "4821",
        "managerName": "Tom Whitesides",
        "managerEmail": "tom.whitesides@example.com",
        "managerDialCode": "+1",
        "managerPhone": "5125550182",
        "neverExpires": true,
        "validUntil": null
      }
      // … 24 more
    ]
    // first_page_url / last_page_url / links[] … per conventions
  }
}
```

### Field notes

- `404` when the association doesn't exist or is soft-deleted.
- Soft-deleted registrations are excluded (`WHERE deleted_at IS NULL`).
- `id` is the registration (`association_teams.id`); `teamId` is the global team FK (`association_teams.team_id`) — both always returned. See the "Two ids" scope note.
- `ageGroup` / `rating` are the resolved **display labels** (from the joined lookup tables); `ageGroupId` / `ratingId` are the FK ids the filters and the Edit modal use.
- `validUntil` is `null` for `pending` rows and whenever `neverExpires = true`; otherwise an ISO date (`YYYY-MM-DD`).
- `lastUpdatedAt` mirrors `last_update_date` (the user-facing freshness stamp), NOT the raw `updated_at`.

### SQL sketch

```sql
SELECT
  at.id, at.association_team_guid, at.team_id, at.association_id,
  at.registered_team_name AS name, at.team_avatar AS avatarUrl,
  at.registration_status, at.gender,
  at.age_group_id, ag.label AS ageGroupLabel,
  at.rating_id, r.name AS ratingName,
  at.city, at.state, at.region, at.last_update_date,
  at.registration_no, at.external_reg_no,
  at.manager_name, at.manager_email, at.mob_code, at.manager_phone,
  at.never_expires, at.expiry_date
FROM association_teams at
LEFT JOIN age_groups ag ON ag.id = at.age_group_id
LEFT JOIN ratings     r  ON r.id  = at.rating_id
WHERE at.association_id = :associationId
  AND at.deleted_at IS NULL
  AND (:status   = '' OR at.registration_status = :statusInt)
  AND (:ageGroupId = '' OR FIND_IN_SET(at.age_group_id, :ageGroupId))
  AND (:ratingId   = '' OR FIND_IN_SET(at.rating_id,   :ratingId))
  AND (:gender     = '' OR FIND_IN_SET(at.gender,      :gender))
  AND (:state      = '' OR FIND_IN_SET(at.state,       :state))
  AND (
    :search = '' OR
    at.registered_team_name LIKE CONCAT('%', :search, '%') OR
    at.manager_name         LIKE CONCAT('%', :search, '%') OR
    at.registration_no      LIKE CONCAT('%', :search, '%') OR
    at.external_reg_no       LIKE CONCAT('%', :search, '%') OR
    at.city                 LIKE CONCAT('%', :search, '%') OR
    at.state                LIKE CONCAT('%', :search, '%')
  )
ORDER BY {sort column} {order}
LIMIT :per_page OFFSET :offset;
```

The serializer maps each DB column to its camelCase wire name and the int status to its string.

---

## 2. Get One Team

- **Endpoint**: `GET /v2/association/teams/{associationId}/{associationTeamId}`
- **Purpose**: Hydrate the team-details page header + the Edit modal. Returns the **detail** shape — the base `AssociationTeam` (§12) **plus `customFields`** (the team's saved custom-field answers, which the list omits). This is the endpoint to call before opening Edit so the custom-field values populate.
- **Table sources**: Same joins as §1, single record by `association_teams.id`, plus a LEFT JOIN to `custom_field_values` for this team's answers.

### Response

`data` is the **detail** object — every base `AssociationTeam` field (§12) **plus the `customFields` array** (the list omits the latter). The `customFields` block is the part a dev is most likely to miss, so it's shown in full here:

```jsonc
{
  "responseStatus": { "message": "OK", "statusCode": 200, "text": "OK" },
  "data": {
    // ── base AssociationTeam (same fields as a §1 list row) ──
    "id": "at_382",
    "teamId": "t_382",
    "name": "Action Jackson",
    "avatarUrl": "https://cdn.whoifollow.tech/teams/382.png",
    "status": "active",
    "gender": "Male",
    "ageGroup": "50 Older",
    "ageGroupId": "ag_7",
    "rating": "Major+",
    "ratingId": "r_4",
    "sportType": "Softball - Slow Pitch",
    "sportsTypeId": "st_1",
    "city": "Austin",
    "state": "TX",
    "region": "Southwest",
    "lastUpdatedAt": "2026-05-04T00:00:00.000Z",
    "systemRegNo": "SSUSA00382",
    "externalRegNo": "4821",
    "managerName": "Tom Whitesides",
    "managerEmail": "tom.whitesides@example.com",
    "managerDialCode": "+1",
    "managerPhone": "5125550148",
    "managerLinkedUserId": "u_5001",
    "neverExpires": false,
    "validUntil": "2027-05-04",

    // ── detail-only: present on get-one (and register/edit), OMITTED on the §1 list ──
    "customFields": [
      { "definitionId": "cf_31", "value": "AA" },
      { "definitionId": "cf_32", "value": "true" },
      { "definitionId": "cf_33", "value": "Returning roster — 12 players" }
    ]
  }
}
```

- `customFields[]` is `{ definitionId, value }[]` — the team's saved answers to the association's **team** custom fields. Empty array `[]` when the team has no answers (still present — not omitted). Definitions + per-type value encoding: [`association-custom-fields-api-contract.md`](./association-custom-fields-api-contract.md).

### Field notes

- `404` if the registration doesn't exist, is soft-deleted, or belongs to a different association.
- The Lifecycle timeline + Payments are fetched separately (§11 + the [payables contract](./association-payables-api-contract.md)) — this endpoint returns only the registration record (+ its custom fields).

---

## 3. Register Team

- **Endpoint**: `POST /v2/association/teams/{associationId}`
- **Purpose**: Create a new registration via the Register wizard. The backend creates the global `teams` identity (if needed) + the `association_teams` row. `registration_no` is server-generated. Whether a **fee** applies + the **default validity** come from the team's [`association_reg_settings`](../system/sql-schema-association.md#association_reg_settings) (the wizard inherits them — not overridable); the client only sends the **collection choice**. If a fee applies the backend also creates the payment order/payable — see **Payment behavior** below.
- **Maps to**: `registerAssociationTeam(...)` in the mock.
- **Content type**: JSON, **or** `multipart/form-data` when a logo file is attached (the `logo` part is the binary; other fields are form fields — same pattern as the event avatar upload).

### Request body

```jsonc
{
  "name": "River Bandits",
  "externalRegNo": "5104",
  "city": "Davenport",
  "state": "IA",
  "region": "Southwest",
  "gender": "Male",
  "ageGroupId": "ag_9",
  "ratingId": "r_3",
  "sportsTypeId": "st_2",               // FK to the sports-type catalogue
  "lastUpdateDate": "2026-06-21",       // user-input freshness date (YYYY-MM-DD)
  "managerName": "Greg Foster",
  "managerEmail": "greg.foster@example.com",
  "managerDialCode": "+1",
  "managerPhone": "5635550148",
  "managerLinkedUserId": "u_5001",      // or null — see lookup note below
  "sendManagerInvite": false,           // true when no WIF account matched
  "registrationStatus": "active",       // "pending" | "active" — derived (see below)
  "activation": {                       // present only when status="active"; validity INHERITED from reg-settings
    "neverExpires": false,
    "validUntil": "2027-05-04",
    "source": "payment"                 // "payment" when a fee applies, else "manual"
  },
  "payment": {                          // present only when reg-settings make a fee applicable
    "collection": "offline",            // "later" | "online" | "offline"
    "method": "cash",                   // offline only — cash|cheque|check|bank_transfer|other
    "amount": 150.00,                   // offline only — amount received now; may be PARTIAL (< payable)
    "paidAt": "2026-06-21",             // offline only — date the payment was received (YYYY-MM-DD)
    "reference": "Cheque #1042",        // offline only, optional
    "notes": "Paid at front desk"       // offline only, optional
  },
  "customFields": [                      // team custom-field answers (Additional-details step)
    { "definitionId": "cf_12", "value": "AA" }
  ]
  // logo: sent as a multipart file part, not a JSON field
}
```

| Field | Required | Notes |
|---|---|---|
| `name` | yes | Registered team name (`registered_team_name`). Max 255. |
| `externalRegNo` | no | Partner / league number. Free-form, max 255. |
| `city` | yes | Max 50. The wizard sources `city` + `state` from a Google Places pick (so they're never mistyped); the wire still carries the resolved strings. |
| `state` | yes | Two-letter code (the Places `administrative_area_level_1` short name). |
| `region` | no | Coarse region grouping above state level (e.g. `"Southwest"`). From the shared **regions catalogue** — see [shared-catalogues §10](../system/shared-catalogues.md). Stored verbatim in `association_teams.region`; empty when not chosen. |
| `gender` | yes | `Male` \| `Female` \| `Coed`. |
| `ageGroupId` | yes | FK to `age_groups`. `422` if not in the shared catalogue. |
| `ratingId` | yes | FK to the association's `ratings`. `422` if it doesn't belong to this association. |
| `sportsTypeId` | yes | FK to the sports-type catalogue (`association_teams.sports_type_id`). The wizard loads the catalogue from `GET /v2/sport-types` (page-cached) and submits the selected id; `422` if not in the catalogue. The response joins the label back as `sportType` (like `ageGroup`/`ageGroupId`). |
| `lastUpdateDate` | yes | User-input "last updated" freshness date (`YYYY-MM-DD`) → `last_update_date`. **Always sent from the form.** Distinct from the system-managed `updated_at` (which the backend stamps on every write regardless). |
| `managerName` | yes | Max 150. |
| `managerEmail` | yes | Max 45 (DB), validated as email. |
| `managerDialCode` | yes | Country dial code, e.g. `+1` (`mob_code`). |
| `managerPhone` | yes | Raw national digits, no formatting (`manager_phone`). The frontend `PhoneInput` stores dial code + raw digits separately (no E.164) — same convention as the event director phone. |
| `managerLinkedUserId` | no | The WIF `users.id` to link as the manager, or `null`. The client resolves this **before** submit via the identity probe (`GET /v2/users/lookup?email=`, see [`system-identity-api-contract.md`](./system-identity-api-contract.md)) — when the manager email matches an existing user. The backend should re-verify rather than trust it blindly. |
| `sendManagerInvite` | no | `true` when the manager email had **no** WIF account (so `managerLinkedUserId` is null) and the admin wants them invited. Triggers a `team_member` invite on create. Mutually exclusive with a non-null `managerLinkedUserId`. |
| `registrationStatus` | yes | The initial status — **`pending`** or **`active`** only (any other → `422`). **Derived** by the wizard, not a free toggle: `active` when (no fee + "Activate now") **or** (a fee **paid IN FULL offline now**); otherwise `pending` (no fee + save-pending, fee collected online / later, **or a partial offline payment** that leaves a balance). Backend re-derives + is authoritative. |
| `activation` | conditional | Present only when `registrationStatus = "active"`. `{ neverExpires, validUntil?, source }` — the **validity is inherited from the team's reg-settings** (`never_expires` / `duration_days`), **not** admin-entered (no override). `source = "payment"` when a fee applies (paid offline), else `"manual"`. No `paymentOrderId` here — the backend mints the order (see `payment`). |
| `payment` | conditional | Present only when the team's `association_reg_settings.payment_applicable` is true. `{ collection: "later"\|"online"\|"offline", method?, amount?, paidAt?, reference?, notes? }` — the admin's **collection choice** for this registration (`method`/`amount`/`paidAt`/`reference`/`notes` apply to `offline` only). `amount` is the cash received now and **may be partial** (less than the payable), leaving a balance; `paidAt` is the receipt date. The **fee is NOT sent** — the backend uses `applicable_fee` (no override). See the behavior note below + [`sql-schema-payments.md`](../system/sql-schema-payments.md). |
| `logo` | no | Team logo image (multipart file part). Cropped 1:1 client-side; stored as `team_avatar` (CDN URL). |
| `customFields` | no | Answers to the association's **team** custom fields (the wizard's Additional-details step), wire-encoded `{ definitionId, value }[]` — same shape + per-type encoding as the event form. Definitions come from `GET …/custom-fields?entityType=team`; values persist to `custom_field_values`. See [`association-custom-fields-api-contract.md`](./association-custom-fields-api-contract.md). |

### Server-derived / forced (never in the body)

- `registration_no` ← generated WIF number, unique per association (e.g. `SSUSA00411`).
- `association_id` ← `{associationId}`; `registration_date` ← `NOW()`. (`last_update_date` is **submitted by the form**, not server-forced — see the body; `updated_at` is the system stamp set on every write.)
- `team_id` ← the global `teams` row (created/resolved server-side).
- `registration_status` ← the submitted `registrationStatus` (`pending` or `active`; reject anything else), **re-derived/validated** against the fee + collection (see Payment behavior).
- `never_expires` / `expiry_date` ← from `activation` (which mirrors the team's reg-settings `never_expires` / `duration_days`) when status is `active`, else `0` / `NULL`.
- `manager_linked_user_id` ← `managerLinkedUserId` when provided + verified; else resolved from `managerEmail` if a `users` row matches; else `NULL`.
- Audit: a `register` lifecycle row is always appended (`fromStatus: null`, `toStatus: pending`); when the team ends up `active`, a second `mark_active` row is appended (`pending → active`) carrying its source (`payment`/`manual`) + `payment_order_id` when a fee was charged — so the timeline matches the standalone §5 flow.
- Invite: when `sendManagerInvite` is true (and no linked user), a `team_member` invite is opened to `managerEmail`.

### Payment behavior (backend, driven by reg-settings)

The fee is **never trusted from the client** — the backend reads the team's [`association_reg_settings`](../system/sql-schema-association.md#association_reg_settings) row:

- **`payment_applicable = false`** → no order is created. The team activates per the `registrationStatus` + inherited validity (or stays `pending` if "save pending").
- **`payment_applicable = true`** → the backend creates a [`payment_order`](../system/sql-schema-payments.md#payment_orders) (owner = association) + a [`payable`](../system/sql-schema-payments.md#payables) (`payment_item_type = association_team_registration`, **`team_id`** = the global team + **`association_id`** = this association — the dedicated indexed columns, not `related_entity_*`; amount = `applicable_fee`). Then per `payment.collection`:
  - **`offline`** → record a [`payment_transaction`](../system/sql-schema-payments.md#payment_transactions) for the submitted **`amount`** on **`paidAt`** (`provider_type` cash/manual, `payment_method_type` = `method`, `offline_reference` = `reference`, `notes`, `recorded_by` = the admin). If `amount` **covers the payable in full** → order `paid` → registration → **active** (inherited validity applied). If `amount` is a **partial payment** → order `partially_paid`, registration stays **pending** with the balance outstanding (collect the rest later from the Statement).
  - **`online`** → leave the order awaiting payment + send the manager a Stripe payment link → registration stays **pending** until the order reaches `payment_completion_status = paid` (then auto-activates).
  - **`later`** → create the order unpaid → registration **pending**; the admin records payment later from the team's Statement (or sends a link).
- **Partial payments are allowed** on the `offline` path: the admin can record less than the payable (e.g. a deposit), leaving a balance. The fee + platform fee are still backend-computed (`applicable_fee` + the platform-fee rule); the wizard's preview mirrors that math but is informational.
- The wizard sends the **collection choice** (+ for offline, the `amount`/`paidAt`/`method`/`reference`/`notes`); it never sends the fee itself, the `payment_order_id`, or the platform-fee amount.

### Response

`201` — `data` is the full new `AssociationTeam` (§12) with the generated `systemRegNo`, the new **`teamId`** (the just-created/linked global team), the resolved `managerLinkedUserId`, and either `status: "pending"` (no activation) or `status: "active"` + the chosen `validUntil` / `neverExpires`.

`responseStatus.message`: **"Team registered"**.

---

## 4. Edit Team

- **Endpoint**: `PATCH /v2/association/teams/{associationId}/{associationTeamId}`
- **Purpose**: Update the editable profile fields. **Partial** — any omitted field is left unchanged.
- **Maps to**: `updateAssociationTeam(...)` in the mock.

### Request body

Same editable fields as §3 (`name`, `externalRegNo`, `city`, `state`, `region`, `gender`, `ageGroupId`, `ratingId`, `sportsTypeId`, `lastUpdateDate`, `managerName`, `managerEmail`, `managerDialCode`, `managerPhone`, `managerLinkedUserId`, `customFields`, and `logo` via multipart) — all optional. Changing `managerEmail` re-runs the identity lookup client-side, so `managerLinkedUserId` may change (or `sendManagerInvite` flip true) on a manager swap.

**Not editable here** (ignored / `422` if present): `status`, `systemRegNo`, `neverExpires`, `validUntil`, `activation`. Status + validity move only through the lifecycle endpoints (#5–#10) — which the Edit **wizard** surfaces inline (the Registration step opens the §5–§10 popups), but they remain separate calls, not part of this PATCH.

### Server behavior

- `last_update_date` ← the submitted `lastUpdateDate` (user-input freshness date). `updated_at` ← `NOW()` (system stamp) on every successful save.
- No lifecycle row is appended (profile edits aren't status/validity mutations).

### Response

`200` — `data` is the updated `AssociationTeam` (§12). `responseStatus.message`: **"Team updated"**.

---

## 5–10. Lifecycle actions

All six share these traits:

- **Permission**: `manage_teams` (or `fullControl`).
- Each **validates the current status** is a legal "from" state for the action → `409 Conflict` otherwise (with a message naming the current status).
- Each **appends exactly one `association_team_lifecycle` row** capturing `from/to` status + validity, the actor (`actor_user_id` ← the authenticated admin), `occurred_at`, and any `reason` / `source` / `payment_order_id` / `amount_cents`.
- Each returns `200` with the **updated `AssociationTeam`** (§12).

### The validity sub-object

Actions that set validity (`activate`, `renew`, `reactivate`, `validity`) accept:

```jsonc
{
  "neverExpires": false,
  "validUntil": "2027-05-04",     // required when neverExpires=false; ignored when true
  "reason": "Comp renewal …",     // optional (free-text admin note)
  "source": "payment",            // activate/renew only: "payment" | "manual"
  "paymentOrderId": "po_102204"   // required iff source="payment"
}
```

- `422` when `neverExpires=false` and `validUntil` is missing/not a valid future date.
- `422` when `source="payment"` and `paymentOrderId` is missing.
- For `payment`, the backend records `amount_cents` from the linked order; for `manual`, `source/paymentOrderId/amountCents` are null.

---

### 5. Mark Active

- **Endpoint**: `POST /v2/association/teams/{associationId}/{associationTeamId}/activate`
- **From → To**: `pending` → `active`, or `rejected` → `active` (the "restore a cancelled registration" path).
- **Body**: the validity sub-object (`source` required: `payment` | `manual`).
- **Audit**: `action_type = mark_active`.
- `responseStatus.message`: **"Team activated"**.

### 6. Renew

- **Endpoint**: `POST /v2/association/teams/{associationId}/{associationTeamId}/renew`
- **From → To**: `expired` → `active`, or `active` → `active` (early renewal).
- **Body**: the validity sub-object (`source` required).
- **Audit**: `action_type = renew`.
- `responseStatus.message`: **"Registration renewed"**.

### 7. Suspend

- **Endpoint**: `POST /v2/association/teams/{associationId}/{associationTeamId}/suspend`
- **From → To**: `active` → `suspended`. Validity is **preserved** (re-confirmed on reactivation).
- **Body**: `{ "reason": "…" }` — **required**, non-empty (`422` otherwise).
- **Audit**: `action_type = suspend`.
- `responseStatus.message`: **"Team suspended"**.

### 8. Reactivate

- **Endpoint**: `POST /v2/association/teams/{associationId}/{associationTeamId}/reactivate`
- **From → To**: `suspended` → `active`.
- **Body**: the validity sub-object (admin re-picks expiry; `source` optional here — reactivation isn't a payment event by default).
- **Audit**: `action_type = reactivate`.
- `responseStatus.message`: **"Team reactivated"**.

### 9. Change Validity

- **Endpoint**: `PATCH /v2/association/teams/{associationId}/{associationTeamId}/validity`
- **From → To**: `active` → `active` (**status unchanged**; only `never_expires` / `expiry_date` move).
- **Body**: the validity sub-object (no `source`).
- **Audit**: `action_type = validity_change` (`fromStatus === toStatus`).
- `responseStatus.message`: **"Validity updated"**.

### 10. Reject (Cancel registration)

- **Endpoint**: `POST /v2/association/teams/{associationId}/{associationTeamId}/reject`
- **From → To**: `pending` → `rejected`, or `active` → `rejected`. (Reuses the `rejected` enum value for both never-approved and admin-cancelled records.)
- **Body**: `{ "reason": "…" }` — **required**, non-empty (`422` otherwise).
- **Audit**: `action_type = reject`.
- `responseStatus.message`: **"Registration cancelled"**.

---

## 11. Lifecycle Log

- **Endpoint**: `GET /v2/association/teams/{associationId}/{associationTeamId}/lifecycle`
- **Purpose**: The append-only audit trail for one registration — every status/validity transition since `register`. Rendered as the team-details Lifecycle timeline. **Paginated** — the log grows over a registration's life, so it's never returned all at once.
- **Table sources**: `association_team_lifecycle` for the row, LEFT JOIN `users` to resolve `actorName` (the DB does **not** store the display name — the API hydrates it).

### Query parameters

In addition to the standard `page` / `per_page` pagination params from [conventions](./conventions.md#pagination-envelope-laravel-paginator) (**`per_page` defaults to `25`**):

| Name | Type | Default | Notes |
|---|---|---|---|
| `actionType` | string (comma-separated) | `""` | Filter to a subset of action types (`IN`). Empty = no constraint. |
| `order` | `'asc' \| 'desc'` | `'desc'` | Sort by `occurred_at`. Default **newest-first** so page 1 shows the most recent activity; pass `asc` for the oldest-first chronological read. |

### Response (paginated)

`data` is the standard Laravel paginator. Each row in `data.data[]` is a `TeamLifecycleEntry` (§13).

```jsonc
{
  "responseStatus": { "message": "OK", "statusCode": 200, "text": "OK" },
  "data": {
    "current_page": 1,
    "per_page": 25,
    "total": 42,
    "from": 1,
    "to": 25,
    "data": [
      {
        "id": "1",
        "associationTeamId": "at_382",
        "teamId": "t_382",
        "actionType": "mark_active",
        "actorUserId": "u_2",
        "actorName": "Lisa Trent",
        "occurredAt": "2024-01-12T16:04:00.000Z",
        "fromStatus": "pending",
        "toStatus": "active",
        "fromNeverExpires": false,
        "fromValidUntil": null,
        "toNeverExpires": false,
        "toValidUntil": "2025-01-12",
        "source": "payment",
        "paymentOrderId": "po_100501",
        "paymentReference": "PO #100501",
        "amount": 95,
        "reason": null,
        "metadata": {}
      }
      // … one row per mutation
    ]
  }
}
```

### Field notes

- `actorUserId` is `null` for system-driven rows (e.g. the nightly auto-expire that produces an `expired` transition); `actorName` then resolves to a system label (e.g. `"System"`).
- `amount` is dollars (derived from `amount_cents / 100`); `null` unless `source = payment`.
- `paymentReference` is a hydrated display string (e.g. `"PO #100501"`), not a stored column.
- `metadata` is the JSON escape-hatch column; `{}` when empty.

---

## 12. `AssociationTeam` shape (response reference)

The **list** (§1) and the lifecycle actions (§5–§10) return this **base** shape. **Get-one** (§2), **register** (§3), and **edit** (§4) return the **detail** shape — the base **plus `customFields`** (see the note after the interface). Mirrors `AssociationTeam` in `src/types.ts`.

```ts
interface AssociationTeam {
  id: string                     // association_teams.id — the REGISTRATION id (this portal's PK)
  teamId: string                 // association_teams.team_id — FK to the global `teams` row
  name: string                   // registered_team_name
  avatarUrl?: string             // team_avatar (CDN URL)
  status: 'pending' | 'active' | 'expired' | 'rejected' | 'suspended'
  gender: 'Male' | 'Female' | 'Coed'
  ageGroup: string               // resolved label
  ageGroupId: string             // age_groups FK (for filters + edit)
  rating: string                 // resolved label
  ratingId: string               // ratings FK (for filters + edit)
  sportType: string              // resolved label
  sportsTypeId: string           // sports-type catalogue FK (for edit)
  city: string
  state: string                  // two-letter code
  region: string                 // shared regions catalogue value
  lastUpdatedAt: string          // ISO — mirrors the user-input last_update_date (NOT updated_at)
  systemRegNo: string            // registration_no (server-generated, read-only)
  externalRegNo: string          // external_reg_no
  managerName: string
  managerEmail: string
  managerDialCode: string        // mob_code (e.g. "+1")
  managerPhone: string           // raw national digits (no formatting)
  neverExpires: boolean
  validUntil: string | null      // YYYY-MM-DD; null when pending or neverExpires
}
```

**Detail shape** — get-one (§2), register (§3), and edit (§4) return the base above **plus the team's custom-field answers**:

```ts
interface AssociationTeamDetail extends AssociationTeam {
  customFields: { definitionId: string; value: string }[]  // team custom-field answers
}
```

The **list (§1) omits `customFields`** to stay lightweight (a roster of 1000s of rows shouldn't carry every team's custom-field blob). Load them via get-one (§2) — e.g. the Edit modal opened from the listing fetches the full record first.

> **Frontend note**: the current `src/types.ts` `AssociationTeam` carries a single formatted `managerPhone` string and no `ageGroupId` / `ratingId` (the mock filters on labels). When wiring this contract, split the phone into `managerDialCode` + raw `managerPhone` (adopting the shared `PhoneInput`) and add the `*Id` fields so the facets and Edit modal speak FK ids — same migration the events director-phone went through.

## 13. `TeamLifecycleEntry` shape (lifecycle log reference)

Returned by §11. Mirrors `TeamLifecycleEntry` in `src/types.ts`.

```ts
interface TeamLifecycleEntry {
  id: string
  associationTeamId: string
  teamId: string
  actionType: 'register' | 'mark_active' | 'renew' | 'suspend'
            | 'reactivate' | 'reject' | 'validity_change'
  actorUserId: string | null     // null for system-driven rows
  actorName: string              // hydrated on read (not stored)
  occurredAt: string             // ISO, ms precision
  fromStatus: AssociationTeamStatus | null   // null only on register
  toStatus: AssociationTeamStatus            // == fromStatus for validity_change
  fromNeverExpires: boolean | null
  fromValidUntil: string | null
  toNeverExpires: boolean
  toValidUntil: string | null
  source: 'payment' | 'manual' | null        // activate/renew only
  paymentOrderId: string | null
  paymentReference: string | null            // hydrated, e.g. "PO #1234"
  amount: number | null                      // dollars (amount_cents/100)
  reason: string | null                      // required for suspend/reject
  metadata: Record<string, unknown>
}
```

## 14. Cross-cutting field rules

- **Dates**: `validUntil` / `*ValidUntil` are date-only (`YYYY-MM-DD`). `lastUpdatedAt` / `occurredAt` / `createdAt` / `updatedAt` are ISO-8601 timestamps.
- **Money**: stored as `amount_cents` (INT, avoid float); the wire exposes dollars in `amount`.
- **Reason**: app-enforced non-empty for `suspend` + `reject`; trimmed before store; surfaced verbatim in the timeline.
- **Idempotency / races**: a lifecycle action whose precondition no longer holds (status changed underneath the admin) → `409 Conflict`; the client re-fetches (§2) and re-renders the available actions.
- **Error envelope + codes**: per [`conventions.md`](./conventions.md#common-error-codes) (`401/403/404/409/422/500`).

## 15. Out of scope (deferred)

- **Payments tab** (payment orders / payables / transactions) — documented separately in [`association-payables-api-contract.md`](./association-payables-api-contract.md) (the shared, filterable, paginated payables list + order drill-in). Not part of this contract.
- **Auto-renew** (`auto_renew` column) — surfaced in the schema but no UI/endpoint yet.
- **Bulk actions** (multi-select activate/renew/suspend) — single-registration only in v1.
- **Hard delete / merge** of registrations.
- **Manager-user invitation** flow (linking `manager_linked_user_id` via an invite).
