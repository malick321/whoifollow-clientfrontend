---
status: Draft (rework — supersedes v0)
owner: shared
last_updated: 2026-05-12
---

# Association Events — REST API contract

## Context

Powers the Events portal page (`src/views/AssociationEventsView.vue`) and its modals (`EventFormModal`, future `EventOfficialAccessModal` per-event grants). When wired, replaces the mock layer in `src/api/events.ts`.

All endpoints are rooted under `/v2/association/events/{associationId}/...`. For shared rules — response envelope, pagination shape, auth header, error codes, and the `permissions_json` encoding — see [`conventions.md`](./conventions.md).

**Naming convention (wire ≠ DB).** Request bodies, response payloads, and query parameters all use **camelCase consistently** — every field on the v2 wire is camelCase regardless of how the underlying column is named in the database. New columns added to `team_events` (e.g. `event_start_date`, `event_end_date`, `event_start_time`, `event_end_time`) are snake_case at the DB level per the dev-team's new-column convention; the backend serializer translates them to camelCase on the wire (`eventStartDate`, `eventEndDate`, `eventStartTime`, `eventEndTime`). DB column names appear in this contract only inside the SQL sketches — every other reference is the wire field name.

ID literals in the JSON examples below use prefixed stubs (`evt_…`, `au_…`, `u_…`, etc.) for doc readability only — production serializes the bare `BIGINT UNSIGNED` PK as a numeric string. See [`conventions.md` § Doc-example IDs vs wire IDs](./conventions.md#doc-example-ids-vs-wire-ids) for the full mapping.

## Scope decisions (locked in)

- **Date storage is LOCAL** (in the event's TZ). The API exposes both the raw local strings AND backend-computed UTC mirrors / display strings so the frontend never does timezone math.
- **`eventStatus` ENUM is the lifecycle column** (4-state machine: `draft` → `published` → `completed`/`cancelled`).
- **Permission gate**: every endpoint requires `manage_events` on the caller's `association_users` row (or `fullControl = TRUE`). Without it → `403`.
- **Ownership**: `owner_type` is a `TINYINT UNSIGNED` — **`0 = team, 1 = association, 2 = platform, 3 = user`**. Association-portal endpoints only read/write rows where `owner_type = 1`, filtered by `associationId` derived from the route. Team-owned events don't leak in.
- **Server-derived scoping/ownership fields (never sent in the request body).** On create/update the backend sets these from the route's numeric `{associationId}` + the authorized membership (the association row is already loaded for the permission check, so it's no extra query):
  - `association_id` ← the numeric `{associationId}` path param.
  - `association` (denormalized short-name snapshot) ← `associations.short_name` of that record.
  - `owner_type` ← `1` (association); `owner_linked_id` ← `association_id`.
  - `team_id` ← `NULL` (only populated when `owner_type = 0`, i.e. a team-owned event — never via this portal flow).
- **Soft delete only.** Hard delete is not exposed; cancelled events stay in the table.
- **No bulk endpoints in v1.** Single-event create / update / cancel. Bulk lands when the UI grows multi-select.

## Underlying tables

| Table | Purpose |
|---|---|
| `team_events` | The event master record. See [`sql-schema-event.md`](../system/sql-schema-event.md#team_events) for the full column reference. |
| `team_sports_types` | Sport-type catalogue (joined for `sportsTypeName`). |
| `mediums` | Medium catalogue (joined for `mediumName`). |
| `game_position_configs` | Field config catalogue (referenced by `fieldConfigId`). |
| `associations` | Owning association (`associationShortName` is denormalized on `team_events`). |
| `event_officials` | Per-event grants — covered by `matchgeni-officials-api-contract.md`. |
| `event_tournaments` | Child tournaments — covered by separate contract (deferred). |
| `event_joined_team` (future) | Source of truth for the on-read `teamCounts` aggregate (status breakdown). No cached counter lives on `team_events`. |

---

## 1. List Association Events

- **Endpoint**: `GET /v2/association/events/{associationId}`
- **Purpose**: Drives the main events list with year filter, past-events toggle, event-type filter, search, sort, and paging.
- **Table sources**: `team_events` filtered to `association_id = :associationId AND deleted_at IS NULL`, LEFT JOIN `team_sports_types` for the sport name.

### Query parameters

In addition to the standard `page` / `per_page` pagination params from [conventions](./conventions.md#pagination-envelope-laravel-paginator):

| Name | Type | Default | Notes |
|---|---|---|---|
| `year` | int \| `'all'` | First non-past year that has events (server-derived) | Filters by the event's local year. `'all'` skips the filter. |
| `pastEvents` | bool | `false` | When `true`, returns events whose end has already passed (UTC comparison). When `false`, returns upcoming + in-flight events. |
| `eventType` | string | `""` | Substring match against the event's type label. |
| `eventStatus` | string (comma-separated `EventStatus[]`) | `""` | Lifecycle filter — comma-joined subset of `'draft'`, `'published'`, `'completed'`, `'cancelled'` (e.g. `eventStatus=draft,published`). Empty / omitted = no constraint. Wire format is comma-separated for URL friendliness; backend explodes on `,` into the IN list shown in the SQL sketch. Values not in the catalogue → `422`. See §6 for the lifecycle state machine. |
| `sportsTypeId` | string | `null` | When set, filters by the joined sport type. |
| `search` | string | `""` | Case-insensitive partial match on event name, type, city, state, director name. |
| `sort` | `'eventStartDate' \| 'eventName' \| 'createdAt'` | `'eventStartDate'` | |
| `order` | `'asc' \| 'desc'` | `'asc'` when `pastEvents=false`, `'desc'` when `pastEvents=true` | |

### Request body

None (GET).

### Response (paginated)

`data` is the standard Laravel paginator. Each row in `data.data[]` is an `EventSummary` — a slim subset of the full `Event` shape that carries only the fields the listing UI renders. See §11 for `Event` and §12 for `EventSummary`.

The split exists so the list payload stays lean — a typical 25-row page is ~3 KB gzipped on `EventSummary` vs ~10 KB on the full `Event`. The full record is fetched on demand via §3 (single event) when the admin opens the Edit modal or detail page.

### Field notes

- `404` when the association doesn't exist or is soft-deleted.
- Soft-deleted events are excluded (`WHERE deleted_at IS NULL`).
- `slug` is always returned (auto-generated, read-only) and backs the public `/public/event/:slug` URL — see the read-only rule in §10 and the `EventSummary` shape in §13.
- Default `order` flips with `pastEvents`: upcoming view is ascending (next-up first); past view is descending (most-recently-ended first).
- `startAtUtc` / `endAtUtc` / `registrationOpeningUtc` / `entryFeeDeadlineUtc` are returned as ISO-8601 UTC strings, computed by the DB from the local fields + `timeZone`.
- `dateRangeLabel` and `dateRangeLabelShort` are pre-formatted by the backend (e.g. `"Apr 19 to May 24, 2026 (Eastern Time)"` / `"Apr 19 to May 24, 2026 (EST)"`). The frontend renders them as-is — no TZ math.

### SQL sketch

```sql
SELECT
  e.id, e.guid, e.slug, e.team_id, e.association_id,
  e.eventName, e.eventType, e.association AS associationShortName,
  e.avatar, e.address, e.location, e.city, e.state, e.zipCode,
  e.lat, e.long,
  e.event_start_date, e.event_end_date, e.event_start_time, e.event_end_time,
  e.allDay, e.time_zone, e.start_at_utc, e.end_at_utc,
  YEAR(e.event_start_date) AS eventYear,
  (e.end_at_utc < UTC_TIMESTAMP()) AS isPast,
  e.note, e.reminder,
  e.medium_id, e.medium AS mediumName,
  e.Url, e.color,
  e.event_status,
  e.director_email, e.director_phone, e.director_name, e.mob_code,
  e.entry_fee, e.refund_policy, e.tournament_format, e.entry_fee_deadline,
  e.pool_play, e.game_guarantee, e.division_type,
  e.pool_play_time, e.championship_time, e.bracket_time, e.time_interval,
  e.sports_type_id, st.name AS sportsTypeName,
  e.allow_team_registration, e.registration_opening,
  e.registration_opening_utc, e.entry_fee_deadline_utc,
  e.payment_required, e.payment_terms, e.partial_payment_type,
  e.partial_payment_value, e.allow_offline_payment,
  e.auto_confirm_on_full_payment, e.auto_confirm_on_partial_payment,
  e.field_config_id, e.team_count,
  e.created_by, e.updated_by, e.created_at, e.updated_at
FROM team_events e
LEFT JOIN team_sports_types st ON st.id = e.sports_type_id
WHERE e.association_id = :associationId
  AND e.deleted_at IS NULL
  AND (:year = 'all' OR YEAR(e.event_start_date) = :year)
  AND (
    (:pastEvents = TRUE  AND e.end_at_utc <  UTC_TIMESTAMP()) OR
    (:pastEvents = FALSE AND (e.end_at_utc >= UTC_TIMESTAMP() OR e.end_at_utc IS NULL))
  )
  AND (:eventType = '' OR e.eventType LIKE CONCAT('%', :eventType, '%'))
  AND (:eventStatus = '' OR FIND_IN_SET(e.event_status, :eventStatus))
  AND (:sportsTypeId IS NULL OR e.sports_type_id = :sportsTypeId)
  AND (
    :search = '' OR
    e.eventName     LIKE CONCAT('%', :search, '%') OR
    e.eventType     LIKE CONCAT('%', :search, '%') OR
    e.city          LIKE CONCAT('%', :search, '%') OR
    e.state         LIKE CONCAT('%', :search, '%') OR
    e.director_name LIKE CONCAT('%', :search, '%')
  )
ORDER BY {sort column} {order}
LIMIT :per_page OFFSET :offset;
```

The serializer maps every DB column above to its camelCase wire name (see §11).

---

## 2. List Distinct Event Years

- **Endpoint**: `GET /v2/association/events/{associationId}/years`
- **Purpose**: Feeds the Year filter dropdown — only years that actually have events. UI uses `defaultYear` as the initial selection.
- **Table sources**: `team_events` distinct `YEAR(event_start_date)`.

### Request body

None.

### Response

`data`:

```json
{
  "years": [2024, 2025, 2026, 2027],
  "defaultYear": 2026
}
```

### Field notes

- `years` — distinct local-year values across non-deleted events, ascending.
- `defaultYear` — the earliest year whose events aren't all in the past. Falls back to the latest year when every event is in the past. Frontend uses this to pre-select the dropdown.

### SQL sketch

```sql
SELECT DISTINCT YEAR(event_start_date) AS year
FROM team_events
WHERE association_id = :associationId AND deleted_at IS NULL AND event_start_date IS NOT NULL
ORDER BY year ASC;

-- defaultYear:
SELECT COALESCE(
  (SELECT MIN(YEAR(event_start_date))
   FROM team_events
   WHERE association_id = :associationId AND deleted_at IS NULL
     AND end_at_utc >= UTC_TIMESTAMP()),
  (SELECT MAX(YEAR(event_start_date))
   FROM team_events
   WHERE association_id = :associationId AND deleted_at IS NULL)
) AS defaultYear;
```

---

## 3. Get One Event

- **Endpoint**: `GET /v2/association/events/{associationId}/{eventId}`
- **Purpose**: Hydrate the EventFormModal in Edit mode + power the future detail page.
- **Table sources**: Same row as §1, single record by `team_events.id`.

### Response

`data` is the full `Event` row — see §11.

### Field notes

- `404` if the event doesn't exist, is soft-deleted, or belongs to a different association.
- `slug` is always returned (auto-generated, read-only) and backs the public `/public/event/:slug` URL — see the read-only rule in §10 and the `Event` shape in §12.
- `stripeConnected` is returned on get-one — a read-only boolean indicating whether the owning association has an active Stripe Connect account. Same field name + boolean shape as `stripeConnected` on the my-associations response (§ my-associations contract), so the client reads one consistent key everywhere. The Edit form uses it to gate the online-payment toggle (create resolves the same status from the association instead).

---

## 4. Create Event

- **Endpoint**: `POST /v2/association/events/{associationId}`
- **Purpose**: Admin creates a new event via the EventFormModal.
- **Table sources**: INSERT into `team_events`.

### Request encoding

**`multipart/form-data`** (not JSON) — because the event image is uploaded as a **binary file**. The legacy app submits it as `avatar[0]` (a single-element file array); v2 keeps that field name. All the scalar fields below are sent as form fields alongside it; object/array fields (`seedCriteria`) are sent JSON-encoded under their key. On **edit**, **omit `avatar[0]`** to keep the existing image (sending it replaces; sending an explicit empty `avatar` clears it). The server stores the uploaded file and persists its filename in `team_events.avatar`; reads return the filename (wrapped via `transformImageUrl()`).

> **Multipart PUT (edit):** PHP doesn't parse `multipart/form-data` bodies on `PUT`, so the edit call is sent as **`POST`** to the §5 URL with a **`_method=PUT`** form field (Laravel method spoofing). The route is still the logical `PUT`.
>
> **Why not `PATCH` like the other contracts?** The sibling JSON contracts (division, [ratings](./association-ratings-api-contract.md), [custom fields](./association-custom-fields-api-contract.md)) use `PATCH` for edits. Events differ **only because the body is `multipart/form-data`** (it carries the `avatar[0]` binary) — events use full-replace `PUT` semantics, spoofed over `POST` for the PHP reason above. This is a transport constraint, **not** a deviation from the edit-verb standard.

**Field encoding (everything crosses the wire as a string in multipart).** To keep the backend a direct cast-and-store, values are pre-encoded to match the column storage:

| Field group | Wire encoding |
|---|---|
| Boolean flags (`allDay`, `allowTeamRegistration`, `paymentRequired`, `allowOfflinePayment`, `autoConfirmOnFullPayment`, `autoConfirmOnPartialPayment`) | `"1"` / `"0"` (→ tinyint) |
| `paymentTerms` | **`"0"` = full, `"1"` = partial** (→ `payment_terms` tinyint) |
| `partialPaymentType` | **`"0"` = fixed_amount, `"1"` = percentage** (→ `partial_payment_type` tinyint) |
| `eventType` | the catalogue **key** (`"tournament"`, not `"Tournament"`) — the backend stores + returns the key verbatim in `team_events.eventType`; the frontend maps key → label for display |
| `medium` | the denormalized medium-name snapshot (note the field is **`medium`**, not `mediumName`) |
| `seedCriteria` | `JSON.stringify(...)` under the `seedCriteria` key |
| `customFields` | `JSON.stringify(...)` under the `customFields` key — array of `{ definitionId, value }`; each `value` is a string (see Field notes) |
| Numbers (`entryFee`, `partialPaymentValue`, times, `poolPlayGuaranteed`) | numeric string |
| Null / blank fields | **omitted** entirely (don't send empty values for nullable DATE/INT/FK columns) |

Frontend encoder: `eventPayloadToFormData()` in `src/api/events.ts`.

### Request body

The JSON below documents the **field set + types**; on the wire these are multipart form fields (+ the `avatar[0]` binary part above), not a JSON document.

```jsonc
{
  "eventName": "Spring National Pakistan",
  "eventType": "tournament",                     // catalogue KEY (not the "Tournament" label)
  // avatar[0] — binary image file (multipart part); omit on edit to keep current

  "locationType": "in_person",                  // 'in_person' | 'online' — drives which block below is populated

  // ── when locationType = 'in_person' (online → all null/omitted) ──
  "address": "Hayatabad Sports Complex",
  "location": "Hayatabad",
  "city": "Peshawar",
  "state": "Khyber Pakhtunkhwa",
  "zipCode": "25000",
  "lat": "33.9931",
  "long": "71.4378",

  // ── when locationType = 'online' (in_person → all null/omitted) ──
  "mediumId":   null,                           // FK → mediums.id (shared-services)
  "medium":     null,                           // denormalized medium name snapshot (text)
  "url":        null,                           // event/stream URL

  "eventStartDate": "2026-04-19",               // local date in event TZ (YYYY-MM-DD)
  "eventEndDate":   "2026-05-24",
  "eventStartTime": "08:00:00",                 // local time (HH:MM:SS) — null when allDay
  "eventEndTime":   "20:00:00",
  "timeZone":  "Asia/Karachi",                  // IANA identifier
  "allDay":    false,

  "note": "...",
  "reminder": "Bring own bats.",

  "color": "#1F8FFF",

  "eventStatus": "draft",                       // 'draft' | 'published' only on create

  "directorName":  "PKSA",
  "directorEmail": "pksa@ssusa.org",
  "directorPhone": "+92 300 1234567",
  "mobCode":       "+92",

  "entryFee": 350.00,
  "refundPolicy":     "...",
  "tournamentFormat": "...",
  "entryFeeDeadline": "2026-04-12",             // local DATE in event TZ
  "poolPlayGuaranteed": 3,                      // integer (games) | null
  "bracketFormatId":    "2",
  "poolPlayTime":       65,                     // minutes (number) | null — regulation time limit
  "championshipTime":  80,                      // minutes
  "bracketTime":       70,                      // minutes
  "timeInterval":      90,                      // minutes — the event-default game time SLOT (grid footprint)

  "sportsTypeId":   "1",
  "fieldConfigId":  null,

  "seedCriteria": [                             // → event_seed_criteria rows; [] = no event-level default seeding
    { "seedingCriteriaId": "1", "order": 1 },
    { "seedingCriteriaId": "2", "order": 2 }
  ],

  "customFields": [                             // → custom_field_values rows; [] = no custom values
    { "definitionId": "10", "value": "Championship" },  // single_select → option string
    { "definitionId": "11", "value": "1" }              // boolean → "1"/"0"
  ],

  "allowTeamRegistration": true,
  "registrationOpening":   "2026-02-01 09:00:00",   // local datetime in event TZ
  "paymentRequired":       true,
  "paymentTerms":          0,                       // tinyint code: 0=full, 1=partial
  "partialPaymentType":    null,                    // tinyint code: 0=fixed_amount, 1=percentage | null
  "partialPaymentValue":   null,
  "allowOfflinePayment":   false,
  "autoConfirmOnFullPayment":    true,
  "autoConfirmOnPartialPayment": false
}
```

### Response

`data` is the full new `Event` (same shape as §12), with server-managed fields populated (`id`, `guid`, **`slug`**, `startAtUtc`, `endAtUtc`, `registrationOpeningUtc`, `entryFeeDeadlineUtc`, `eventYear`, `isPast`, `dateRangeLabel`, `teamCounts: { pending: 0, confirmed: 0, waitlisted: 0, withdrawn: 0 }`, `createdAt`, `updatedAt`).

`responseStatus.statusCode` is `201` with `text: "Created"`.

### Field notes

- Booleans + `paymentTerms` / `partialPaymentType` are pre-encoded to their `TINYINT` codes on the wire (see the Field-encoding table above) — `"1"`/`"0"` for flags, `0=full/1=partial` and `0=fixed_amount/1=percentage` for the two enums — so the backend casts and stores directly with no name→code lookup. `eventType` is sent as its catalogue **key** (`"tournament"`), persisted verbatim in `team_events.eventType` and returned as the key on read; the frontend resolves key → label for display. (Legacy rows created before this change may hold the label — the frontend's read resolver accepts either.)
- **`locationType`** is `'in_person'` or `'online'` and decides which location block is meaningful:
  - `'in_person'` → `address` / `location` / `city` / `state` / `zipCode` / `lat` / `long` are populated; the online trio (`mediumId` / `medium` / `url`) is `null`.
  - `'online'` → `mediumId` (FK → `mediums.id`, shared-services), `medium` (denormalized name snapshot so reads don't re-join), and `url` are populated; the in-person address/geo fields are `null`.
  - The backend stores `locationType` so edits round-trip deterministically (the form knows which toggle state to restore without inferring from which fields are non-null).
- **Time fields are numeric minutes** (not legacy strings): `poolPlayTime` / `bracketTime` / `championshipTime` are the regulation **time limits** (minutes); `timeInterval` is the event-default **game time slot** (minutes — the grid footprint, mirrors `team_events.time_interval` / `event.defaults.gameTimeSlot` on the access payload); `poolPlayGuaranteed` is an integer count. All accept `null`.
- **`seedCriteria`** is an ordered `{ seedingCriteriaId, order }[]` written to `event_seed_criteria` in the same transaction as the event row — the event-level **default** seeding a division inherits unless it overrides with its own `tournament_seed_criteria`. `[]` = no event-level default. Each `seedingCriteriaId` must exist in the `seeding_criteria` catalogue (shared-services §6) or `422`. Mirrors the Division contract's `seedCriteria` handling.
- **`customFields`** is a `{ definitionId, value }[]` of the admin-defined custom-field answers for this event (the controls fetched via [`association-custom-fields-api-contract.md`](./association-custom-fields-api-contract.md) §1), reconciled into `custom_field_values` (`entity_type = 'event'`, `entity_id = team_events.id`) in the same transaction as the event row — insert / update / soft-delete to match the submitted set, same semantics as `seedCriteria`. `[]` = no custom values. Each `value` is a **string** encoded per the definition's `input_type`: `"1"`/`"0"` for boolean, the chosen option for single_select, a JSON-stringified array for multi_select, the raw value for number / text. Each `definitionId` must belong to this association + the event entity type (and pass any sport scope) or `422`.
- UTC mirrors and `teamCounts` / `eventYear` / `isPast` / `dateRangeLabel` are read-only — ignored if present in the request body.
- **`slug`** is **auto-generated server-side and read-only** — never sent on create/edit (ignored/stripped if present), always returned on read (§1 list + §3 get-one). On create the backend slugifies `eventName` — lowercase, runs of non-alphanumerics → single `-`, trimmed (e.g. `"2026 My Event"` → `"2026-my-event"`) — and guarantees **global uniqueness** by appending a `-2`, `-3`, … counter when the base slug already exists (same scheme as the custom-field `key`). The slug does **not** change when the event is later renamed (stable handle for the public `/public/event/:slug` URL). Stored in `team_events.slug` (UNIQUE).
- `eventStatus` must be `'draft'` or `'published'` on create — `'completed'` / `'cancelled'` are rejected with `422`.
- `timeZone` must be a valid IANA name (verified via `CONVERT_TZ`); otherwise `422`.
- When `allowTeamRegistration = true`, `registrationOpening` and `entryFeeDeadline` are required and must satisfy `registrationOpening < entryFeeDeadline <= eventEndDate` in the event's TZ. Otherwise `422`.
- `mediumId` / `sportsTypeId` / `fieldConfigId` must exist in their lookup tables (when non-null) — otherwise `422`.

---

## 5. Update Event

- **Endpoint**: `PUT /v2/association/events/{associationId}/{eventId}`
- **Purpose**: Edit an existing event via the EventFormModal.
- **Table sources**: UPDATE on `team_events`.

### Request body

Same shape + multipart encoding as §4. Full-replace semantics — the frontend always sends the complete form. PATCH is intentionally not supported in v1.

> Sent as **`POST`** with a **`_method=PUT`** field (multipart-PUT spoofing — see §4). The cover image (`avatar[0]`) is **only included when it changed this session**: a new pick replaces it, an explicit empty `avatar` clears it, and an untouched cover omits both (the existing image is preserved).

### Response

`data` is the full updated `Event` (same shape as §11). `updatedAt` reflects the new modification.

### Field notes

- `404` if the event doesn't exist or belongs to a different association.
- `eventStatus` transitions are governed by the state machine in §6 — illegal transitions return `409 Conflict`.
- `seedCriteria` is **reconciled** to the submitted ordered list (insert / soft-delete / re-order the `event_seed_criteria` rows to match; `[]` clears the event-level default) — same semantics as the Division contract.
- `customFields` is **reconciled** to the submitted set (insert / update / soft-delete the `custom_field_values` rows to match; `[]` clears all custom values) — same semantics as `seedCriteria`. Encoding + `definitionId` validation (`422`) per §4.
- Switching `locationType` on edit clears the now-irrelevant block server-side (e.g. `in_person → online` nulls the address/geo fields and persists `mediumId`/`medium`/`url`).
- All other validation rules from §4 apply.

---

## 6. Event lifecycle (`eventStatus`)

The canonical reference for the event-status state machine. Every contract endpoint that mutates `eventStatus` (`POST` create, `POST /status` lifecycle change) enforces these rules. The frontend mirrors the table in `src/api/events.ts` (`EVENT_STATUSES` + `isAllowedTransition()`).

### States

| Value | Meaning |
|---|---|
| `draft` | Event is being authored. Not visible to teams; admin-only. Default for new events created from the EventFormModal. |
| `published` | Event is live. Visible to teams; registration can run when `allowTeamRegistration = true` and the registration window is open. |
| `completed` | Event has finished. Terminal state; no further admin edits to lifecycle. Set manually by the admin (no automatic transition from `end_at_utc` passing — the admin confirms wrap-up). |
| `cancelled` | Event was called off before/during execution. Terminal state. Set via the `POST /status` endpoint (§7) with a required `reason` captured for the audit log. |

### Allowed transitions

| From | Allowed targets |
|---|---|
| `draft` | `draft`, `published`, `cancelled` |
| `published` | `published`, `completed`, `cancelled` |
| `completed` | `completed` only (terminal) |
| `cancelled` | `cancelled` only (terminal) |

Any other transition is rejected with `409 Conflict` and an error body identifying the from/to pair.

### Endpoint-specific constraints

- **`POST` Create (§4)** — `eventStatus` must be `'draft'` or `'published'`. Submitting `'completed'` or `'cancelled'` returns `422` (you can't create an event already in a terminal state).
- **`PUT` Update (§5)** — **content edits only; does not change `eventStatus`.** Lifecycle moves go through `POST /status` (§7), not `PUT`. (Any `eventStatus` in a `PUT` body is ignored / read-only.)
- **`POST /status` Change Status (§7)** — the single path for publish / complete / cancel. Validates the transition against the matrix above (`409` on an illegal move); `cancelled` requires a `reason` (`422` if blank).
- **`DELETE` Soft-Delete (§8)** — orthogonal to lifecycle. Only permitted when `eventStatus = 'cancelled'`; non-cancelled events return `409`.

### Storage notes

- DB column: `team_events.event_status` (new ENUM column added in M5a). Source of truth.
- Legacy `team_events.status` TINYINT stays during the M5a→M5b soak so legacy readers don't break; the v2 wire surfaces only `eventStatus`.
- Source-of-truth references:
  - Frontend: `EVENT_STATUSES` constant + `isAllowedTransition(from, to)` helper in `src/api/events.ts`.
  - Backend: ENUM constraint on `team_events.event_status` + transition middleware on the update + cancel endpoints.

---

## 7. Change Event Status

- **Endpoint**: `POST /v2/association/events/{associationId}/{eventId}/status`
- **Purpose**: A **single consolidated lifecycle-action endpoint** for every status milestone — **publish**, **mark completed**, and **cancel**. Separate from `PUT` (§5) because these are state transitions with side effects (notifications, audience visibility, registration activation, audit) — `PUT` is reserved strictly for **content edits**, never lifecycle moves. One endpoint = one authoritative place to enforce the state machine (§6).
- **Table sources**: UPDATE `team_events SET event_status = :status` (+ side effects per target).

> **Replaces the earlier dedicated `/cancel` endpoint.** Cancel, publish, and complete were going to be (or were) separate actions; they're folded into this one because the event lifecycle is a single state machine. The frontend calls it via `changeEventStatus(associationId, eventId, status, { reason? })` (in `src/api/events.ts`); `transitionEventStatus(...)` is a thin wrapper over it.

### Request body

```jsonc
{
  "status": "cancelled",                               // 'published' | 'completed' | 'cancelled' (required)
  "reason": "Insufficient registrations — moved to Q3" // required ONLY when status = 'cancelled'
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `status` | `'published' \| 'completed' \| 'cancelled'` | **yes** | Target lifecycle state. Must be a legal transition from the event's current `eventStatus` per §6, else `409`. (`draft` is never a target — it's only the initial state.) |
| `reason` | string | **conditional** | **Required when `status = 'cancelled'`** (the admin UI enforces it; backend rejects blank / missing with `422`). Recorded for the cancellation audit log. Trimmed; ≤ 500 chars. Ignored for `published` / `completed`. |

> **Publish-readiness (v1):** publishing is a guarded status flip — the only gate is the state-machine legality check (`draft → published`). Field-completeness rules ("can't publish without a valid registration window / location") are **deferred**; they'll be added here as additional `422` cases later.

### Response

`data` is the full updated `Event` with the new `eventStatus`.

### Field notes

- `404` if the event doesn't exist.
- `409` on an illegal transition (e.g. already terminal `cancelled` / `completed`, or an unsupported move) — the §6 state machine is the source of truth.
- `422` if `status` is missing / not one of the three, or `status = 'cancelled'` with a missing / blank `reason`.

---

## 8. Soft-Delete Event

- **Endpoint**: `DELETE /v2/association/events/{associationId}/{eventId}`
- **Purpose**: Soft-delete an event entirely (removes from listings + admin views). v1 only allows deleting `cancelled` events.
- **Table sources**: UPDATE `team_events SET deleted_at = NOW()`.

### Request body

None.

### Response

`data` is omitted; `responseStatus.statusCode: 200` with a `message` such as `"Event deleted."`.

### Field notes

- `404` if the event doesn't exist.
- `409` when attempting to delete a non-cancelled event.
- Idempotent: deleting an already-deleted event returns `200` with the same envelope.

---

## 9. Get Event Resources

- **Endpoint**: `GET /v2/association/events/{associationId}/{eventId}/resources`
- **Purpose**: Catalogue lookup for an event's resources — parks (venues), divisions, **sponsors, and hotels** — used by every UI surface that needs a resource-aware list / dropdown / summary: the `EventOfficialAccessModal` scoring-scope picker, the MatchGeni Game Scheduler, the dashboard's Sponsors rail + Hotels card, the public event page's schedule preview, the lineup builder, etc. Parks return the full venue shape (location + per-day `schedule[]` + `fieldsInUse[]`) and divisions their date window so consumers don't chain a second endpoint; sponsors/hotels return their display fields (see below).
- **Table sources** (canonical schemas in [`sql-schema-shared.md`](../system/sql-schema-shared.md) and [`sql-schema-event.md`](../system/sql-schema-event.md)):
  - `game_parts` (parks master, JOIN via `event_playing_facilities`)
  - `event_playing_facilities` (parks added on the event)
  - `event_field_selections` (event-scoped field selection, resolves to `park_fields`)
  - `park_fields` (master field catalogue per park)
  - `park_scheduling_windows` (per-event per-park per-day availability windows — source of `schedule[]`)
  - `divisions` (event divisions, JOIN to aggregate date windows from `games`)
  - `event_sponsors` / `event_hotels` (sponsors + hotels buckets — now served live as read-only lists by this endpoint; their dedicated **CRUD** endpoints + final table schema are still being finalized separately)

  Every JOIN also filters the parent `team_events` to enforce `association_id = :associationId AND deleted_at IS NULL` so the endpoint can't be used to leak resources across associations.

### Query parameters

| Name | Type | Default | Notes |
|---|---|---|---|
| `type` | comma-separated `EventResourceBucket[]` **or** `'all'` | — (**required**) | Selects which bucket(s) to return. Either the literal `all` (every bucket: `parks` + `divisions` + `sponsors` + `hotels`) **or** a comma-separated list of buckets — `parks` / `divisions` / `sponsors` / `hotels` — e.g. `type=parks,hotels`. Backend explodes on `,` (same convention as `eventStatus` in §1), trims + dedupes the tokens, and runs each requested bucket's query block. Keys the caller didn't ask for are omitted from the response. **Required — there is no default**: an omitted, empty, or unknown-token `type` → `422`. `all` is an exclusive shorthand (not combinable, e.g. `all,parks` → `422`). (The legacy `both` value was removed — request `type=parks,divisions` explicitly.) |

> **Status:** **all four buckets are live** — `parks`, `divisions`, `sponsors`, `hotels` (comma-separated `type` or `all`). `fetchEventResources` in `src/api/events.ts` issues one network call for whatever buckets the caller requests and returns the envelope's `data` as-is (no client-side mock split). Note: only the **read-side list** here is live; the dedicated sponsor/hotel **CRUD** endpoints + their final table schema are still being finalized separately.

No pagination — the per-event resource lists are bounded (single-digit parks, low-double-digit divisions in the worst case) and ship in a single payload.

### Request body

None (GET).

### Response

```json
{
  "responseStatus": {
    "message": "Event scoring resources fetched successfully.",
    "statusCode": 200,
    "text": "OK"
  },
  "data": {
    "parks": [
      {
        "id": "58",
        "name": "park no .1",
        "address": "1200 Walnut Creek Pkwy",
        "city": "Mansfield",
        "state": "TX",
        "latitude": "32.5634810",
        "longitude": "-97.1417230",
        "fieldsInUse": [
          { "id": "f_201", "name": "Field 1" },
          { "id": "f_202", "name": "Field 2" },
          { "id": "f_203", "name": "Field 3" }
        ],
        "schedule": [
          {
            "date": "2026-04-29",
            "startTime": "08:00",
            "endTime": "18:30",
            "dateLabel": "Wednesday, April 29, 2026",
            "dateLabelShort": "Wed, Apr 29, 2026",
            "timeRangeLabel": "8:00 AM – 6:30 PM"
          },
          {
            "date": "2026-04-30",
            "startTime": "08:00",
            "endTime": "18:30",
            "dateLabel": "Thursday, April 30, 2026",
            "dateLabelShort": "Thu, Apr 30, 2026",
            "timeRangeLabel": "8:00 AM – 6:30 PM"
          }
        ]
      }
    ],
    "divisions": [
      {
        "id": "247",
        "name": "test division one",
        "startDate": "2026-04-29",
        "endDate": "2026-05-03",
        "startDateUtc": "2026-04-29T13:00:00Z",
        "endDateUtc": "2026-05-04T01:30:00Z",
        "teamCount": 12,
        "dateRangeLabel": "Wed, Apr 29 – Sun, May 3, 2026",
        "dateRangeLabelShort": "Apr 29 – May 3"
      },
      {
        "id": "248",
        "name": "testats",
        "startDate": null,
        "endDate": null,
        "startDateUtc": null,
        "endDateUtc": null,
        "teamCount": 0,
        "dateRangeLabel": "",
        "dateRangeLabelShort": ""
      }
    ],
    "sponsors": [
      {
        "id": "15",
        "eventId": "665",
        "name": "VCC",
        "websiteUrl": "https://visitcarsoncity.com/",
        "imageUrl": "https://cdn.example.com/sponsors/9R0JdB2nJDRPQ2dXDM5QoTzG9hV5v9AYllcVtBcA.jpg",
        "status": 1
      }
    ],
    "hotels": [
      {
        "id": "1",
        "eventId": "665",
        "name": "Marriott Downtown",
        "websiteUrl": "https://marriott.com/ccnv",
        "imageUrl": "https://cdn.example.com/hotels/marriott-downtown.jpg",
        "phoneNumber": "7755550150",
        "mobCode": "+1",
        "latitude": "39.1637450",
        "longitude": "-119.7674190",
        "addressDescription": "Downtown, near the convention center",
        "streetAddress": "88 Center St",
        "city": "Carson City",
        "state": "NV",
        "zip": "89701",
        "notes": "Tournament block rate available",
        "status": 1
      }
    ]
  }
}
```

### Park row

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Numeric park id, stringified per conventions. |
| `name` | `string` | Display name. |
| `address` | `string` | Single-line street address. Empty string (`""`) when not recorded. |
| `city` | `string` | Empty string when not recorded. |
| `state` | `string` | US state code (e.g. `"TX"`) or full name as stored. Empty string when not recorded. |
| `latitude` | `string \| null` | Decimal degrees, stringified to preserve precision (same pattern as numeric IDs). `null` when no geocode is on file. |
| `longitude` | `string \| null` | As above. |
| `fieldsInUse[]` | `Array<{ id: string, name: string }>` | Fields the event admin **added against this park during event setup** — the curated set of park fields that are designated for use on this event. Sourced from the `event_park_fields` join table (NOT derived from scheduled games). Sorted by `name` ASC (case-insensitive). Empty array when the admin hasn't added any fields for this park yet. |
| `schedule[]` | `Array<{ date, startTime, endTime, dateLabel, dateLabelShort, timeRangeLabel }>` | One entry per calendar day this park is in use. Sorted by `date` ASC. Empty array when no games are scheduled at this park yet. See "Schedule entry" below for the per-row shape. |

#### Schedule entry

| Field | Type | Notes |
|---|---|---|
| `date` | `string` | ISO `YYYY-MM-DD`. Local-to-the-event-timezone, not UTC. |
| `startTime` | `string` | 24-hour `HH:MM`. Earliest game start at this park on this day. |
| `endTime` | `string` | 24-hour `HH:MM`. Latest game end at this park on this day (start + duration of the last slot). |
| `dateLabel` | `string` | Backend-rendered long form, e.g. `"Wednesday, April 29, 2026"`. Frontend treats as opaque. |
| `dateLabelShort` | `string` | Backend-rendered short form with weekday, e.g. `"Wed, Apr 29, 2026"`. |
| `timeRangeLabel` | `string` | Backend-rendered time-range string in the event's timezone, e.g. `"8:00 AM – 6:30 PM"` (en dash separator, leading-zero-stripped 12-hour). |

### Division row

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Numeric division id, stringified. |
| `name` | `string` | Display name. |
| `startDate` | `string \| null` | ISO `YYYY-MM-DD` — first day this division has a scheduled game (local to the event tz). `null` when the division has no scheduled games. |
| `endDate` | `string \| null` | ISO `YYYY-MM-DD` — last scheduled day (local). `null` when the division has no scheduled games. |
| `startDateUtc` | `string \| null` | Absolute **UTC instant** (ISO 8601, `Z`) of the division's earliest scheduled game — `MIN(tournament_games.start_at_utc)`. `null` when no scheduled games. For countdowns / cross-tz sorting without recombining local parts. |
| `endDateUtc` | `string \| null` | Absolute **UTC instant** of the division's latest scheduled game end — `MAX(tournament_games.end_at_utc)`. `null` when no scheduled games. |
| `teamCount` | `number` | Count of teams in the division (`tournament_teams` rows for the division, active + not soft-deleted). `0` when none assigned yet — independent of whether games are scheduled. |
| `dateRangeLabel` | `string` | Backend-rendered full label with weekdays + year, e.g. `"Wed, Apr 29 – Sun, May 3, 2026"`. Single-day divisions render as a single date (e.g. `"Sat, May 2, 2026"`). Empty string when `startDate` / `endDate` are `null`. |
| `dateRangeLabelShort` | `string` | Backend-rendered short form WITHOUT weekday or year, e.g. `"Apr 29 – May 3"`. Single-day divisions render as `"May 2"`. Empty string when `startDate` / `endDate` are `null`. |

### Sponsor / hotel rows (proposed buckets)

```json
// sponsors[] — id, owning event, name, site, logo CDN url, active flag
{ "id": "15", "eventId": "665", "name": "VCC",
  "websiteUrl": "https://visitcarsoncity.com/",
  "imageUrl": "https://cdn.example.com/sponsors/<file>.jpg", "status": 1 }

// hotels[] — full event_hotels row (camelCased). lat/long drive the Map Explorer pin.
{ "id": "1", "eventId": "665", "name": "Marriott Downtown",
  "websiteUrl": "https://marriott.com/ccnv",
  "imageUrl": "https://cdn.example.com/hotels/<file>.jpg",
  "phoneNumber": "7755550150", "mobCode": "+1",
  "latitude": "39.1637450", "longitude": "-119.7674190",
  "addressDescription": "Downtown, near the convention center",
  "streetAddress": "88 Center St", "city": "Carson City", "state": "NV", "zip": "89701",
  "notes": "Tournament block rate available", "status": 1 }
```

### Hotel row

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Numeric hotel id, stringified. |
| `eventId` | `string` | Owning event id. |
| `name` | `string \| null` | Hotel display name. |
| `websiteUrl` | `string \| null` | Booking / info link. |
| `imageUrl` | `string \| null` | Logo / photo CDN url (wrapped via `transformImageUrl()` on read). |
| `phoneNumber` | `string \| null` | Local phone number. |
| `mobCode` | `string \| null` | Dialing country code, e.g. `"+1"`. |
| `latitude` | `string \| null` | Decimal degrees, stringified to preserve precision (same convention as `parks[].latitude`). **Drives the Map Explorer pin.** `null` when no geocode. |
| `longitude` | `string \| null` | As above. |
| `addressDescription` | `string \| null` | Free-form locality / landmark note. |
| `streetAddress` | `string \| null` | Street line. |
| `city` / `state` / `zip` | `string \| null` | Address parts. |
| `notes` | `string \| null` | Free-text note. |
| `status` | `number` | `1` active, `0` inactive (clients filter inactive out). |

### Field notes

- Numeric IDs serialize as strings, per conventions.
- **Server-side label formatting** — `dateLabel`, `dateLabelShort`, `timeRangeLabel`, `dateRangeLabel`, `dateRangeLabelShort` are all rendered by the backend in the event's `timeZone`. Frontend treats every label as opaque, exactly the same rule §10 already documents for `dateRangeLabel` / `registrationOpensLabel` / `registrationClosesLabel` on the event row. Locale is `en-US` for v1; future i18n is a server-only change.
- Order: every array (`parks[]`, `divisions[]`, `sponsors[]`, `hotels[]`) sorts by `name` ASC (case-insensitive), stable secondary key on `id` for identical names.
- Empty arrays are valid — events with no parks (single-venue tournaments), no divisions (pre-publish drafts), no sponsors, or no hotels return the key with `[]`, never `null`.
- A park with no admin-added fields is included in `parks[]` with `fieldsInUse: []`. A park with no scheduled games is included with `schedule: []`. A division with no scheduled games is included in `divisions[]` with `startDate: null`, `endDate: null`, and empty label strings. The two states (no fields added vs no games scheduled) are independent — a park can have `fieldsInUse: [Field 1, Field 2]` and `schedule: []` if the admin set it up but hasn't published games yet.
- **`sponsors[]`** (proposed) — `imageUrl` is the logo CDN URL (the stored object key prefixed with the CDN base on read; may be a signed URL). `""`/absent when no logo uploaded — the UI renders a wordmark fallback. `status`: `1` active, `0` inactive (clients filter inactive out).
  - **Logo display / theming.** The client renders each logo on a **pure-white plate in both light and dark mode** and does NOT mask/recolour/invert the image — uploads are arbitrary (transparent-dark SVG/PNG, white-background JPEG, or full-colour) and a consistent white canvas is the only treatment that renders all of them correctly. A CSS mask would flatten a colour logo to a silhouette, so it's intentionally avoided. **Edge case** (logo authored *white-on-transparent* for dark backgrounds) reads poorly on the white plate; the bulletproof fix is a **product/schema decision, not CSS** — either ship **dual logo variants** (`imageUrl` + an optional `imageUrlDark`, the client swaps by theme) or a per-sponsor `logoBackground` hint. Both are **future enhancements**, deferred until the backend sponsor bucket ships; today's single `imageUrl` + white plate covers the realistic majority.
- **`hotels[]`** (proposed) — full `event_hotels` row (camelCased). **`latitude`/`longitude`** (stringified decimal degrees, `null` when no geocode) drive the **Map Explorer** pin; the client computes any distance from the venue itself, so there is no `distanceLabel` and no single-line `address` field — the address is the granular `streetAddress` / `city` / `state` / `zip` (+ optional `addressDescription`). `status`: `1` active, `0` inactive.
- `404` if `eventId` doesn't exist, is soft-deleted, or belongs to a different association.
- `409` if the event is team-owned (`owner_type ≠ 1`) — matches the gate every other endpoint in this contract uses.
- `422` if `type` is provided with a value outside the enum above.
- Permission gate: `manage_events` OR `manage_officials` on the caller's `association_users` row (either is sufficient — the scoring-scope picker in `EventOfficialAccessModal` lives behind the officials grant, but other surfaces that surface dropdowns sit behind the broader events permission).

### SQL sketch

Five round-trips total — the parent gate plus four buckets the application layer stitches together in memory. No N+1: every per-park / per-division read is a single statement across the event, app code buckets by id. All table + column names match the canonical schema in [`sql-schema-shared.md`](../system/sql-schema-shared.md) and [`sql-schema-event.md`](../system/sql-schema-event.md). Index plan listed at the bottom of this section.

```sql
-- 0. Parent gate — short-circuit to 404 / 409 before any bucket
--    runs. `owner_type = 1` is the association-owned filter.
--    Single row by PK; trivially fast. `time_zone` selected here
--    drives the server-side label formatting in steps 3 + 4.
SELECT id, owner_type, time_zone
FROM team_events
WHERE id = :eventId
  AND association_id = :associationId
  AND deleted_at IS NULL;

-- 1. parks bucket (when the requested set includes 'parks') —
--    `game_parts` joined via `event_playing_facilities`. One row
--    per park on the event. Note legacy column names:
--    park_name / lat / lng.
SELECT gp.id, gp.park_name, gp.address, gp.city, gp.state,
       gp.lat, gp.lng
FROM event_playing_facilities epf
JOIN game_parts gp ON gp.id = epf.park_id
WHERE epf.event_id   = :eventId
  AND epf.deleted_at IS NULL
  AND gp.deleted_at  IS NULL
ORDER BY LOWER(gp.park_name) ASC, gp.id ASC;

-- 2. fieldsInUse across ALL parks on the event (when the
--    requested set includes 'parks') — sourced from `event_field_selections`
--    (event-scoped admin selection at event setup time). NOT
--    derived from `games`, so the answer is stable before any
--    games are scheduled. `park_fields.is_selected` is a
--    DEPRECATED column on the master and is intentionally not
--    referenced — only `event_field_selections.is_selected`
--    matters. Returns `park_id` on every row so the application
--    layer buckets fields into the matching park.
SELECT pf.park_id,
       pf.id        AS field_id,
       pf.field_name
FROM event_field_selections efs
JOIN park_fields pf ON pf.id = efs.park_field_id
WHERE efs.event_id    = :eventId
  AND efs.is_selected = 1
  AND pf.deleted_at   IS NULL
ORDER BY pf.park_id ASC,
         efs.order_no ASC,
         LOWER(pf.field_name) ASC,
         pf.id ASC;

-- 3. schedule[] per park (when the requested set includes 'parks') —
--    flat read of `park_scheduling_windows`. One row per
--    (park_id, available_date) the admin set up during event
--    creation. No aggregation; the windows are authored
--    directly, not derived from games. Backend formats
--    `dateLabel` / `dateLabelShort` / `timeRangeLabel` from
--    `available_date` + `start_time` + `end_time` using the
--    event's `time_zone` from step 0 (NOT `game_parts.time_zone`,
--    which is a DEAD column on the parks master).
SELECT park_id, available_date, start_time, end_time
FROM park_scheduling_windows
WHERE event_id   = :eventId
  AND deleted_at IS NULL
ORDER BY park_id ASC, available_date ASC, start_time ASC;

-- 4. divisions bucket (when the requested set includes 'divisions') —
--    division rows + their local + UTC date window + team count.
--    Divisions are `event_tournaments`; games are `tournament_games`.
--    LEFT JOIN games so divisions with no scheduled games still
--    appear (NULL start/end → empty labels). `teamCount` comes from a
--    correlated subquery on `tournament_teams` so it's independent of
--    whether games exist yet (a division can have teams but no schedule).
SELECT d.id,
       d.name,
       MIN(g.start_date)   AS start_date,     -- local date (event tz)
       MAX(g.start_date)   AS end_date,
       MIN(g.start_at_utc) AS start_at_utc,    -- absolute UTC instants
       MAX(g.end_at_utc)   AS end_at_utc,
       (SELECT COUNT(*)
          FROM tournament_teams tt
         WHERE tt.tournament_id = d.id
           AND tt.deleted_at IS NULL
           AND tt.status = 1) AS team_count
FROM event_tournaments d
LEFT JOIN tournament_games g
  ON g.tournament_id = d.id
 AND g.event_id      = :eventId
 AND g.deleted_at    IS NULL
 AND g.start_date    IS NOT NULL
WHERE d.event_id = :eventId AND d.deleted_at IS NULL
GROUP BY d.id, d.name
ORDER BY LOWER(d.name) ASC, d.id ASC;
```

#### Wire-field ↔ DB-column mapping

| Wire field | DB source |
|---|---|
| `parks[].id` | `game_parts.id` |
| `parks[].name` | `game_parts.park_name` |
| `parks[].address` | `game_parts.address` |
| `parks[].city` | `game_parts.city` |
| `parks[].state` | `game_parts.state` |
| `parks[].latitude` | `game_parts.lat` |
| `parks[].longitude` | `game_parts.lng` |
| `parks[].fieldsInUse[].id` | `park_fields.id` |
| `parks[].fieldsInUse[].name` | `park_fields.field_name` |
| `parks[].schedule[].date` | `park_scheduling_windows.available_date` |
| `parks[].schedule[].startTime` | `park_scheduling_windows.start_time` |
| `parks[].schedule[].endTime` | `park_scheduling_windows.end_time` |
| `parks[].schedule[].dateLabel` | server-rendered from `available_date` + `team_events.time_zone` |
| `parks[].schedule[].dateLabelShort` | server-rendered (short form, includes weekday) |
| `parks[].schedule[].timeRangeLabel` | server-rendered from `start_time` + `end_time` + `team_events.time_zone` |
| `divisions[].id` | `event_tournaments.id` |
| `divisions[].name` | `event_tournaments.name` |
| `divisions[].startDate` | `MIN(tournament_games.start_date)` for the division (local) |
| `divisions[].endDate` | `MAX(tournament_games.start_date)` for the division (local) |
| `divisions[].startDateUtc` | `MIN(tournament_games.start_at_utc)` for the division |
| `divisions[].endDateUtc` | `MAX(tournament_games.end_at_utc)` for the division |
| `divisions[].teamCount` | `COUNT(tournament_teams)` where `tournament_id = division.id`, active + not deleted |
| `divisions[].dateRangeLabel` | server-rendered (full form with weekdays + year) |
| `divisions[].dateRangeLabelShort` | server-rendered (month/day only, no weekday, no year) |
| `hotels[].id` | `event_hotels.id` |
| `hotels[].eventId` | `event_hotels.event_id` |
| `hotels[].name` | `event_hotels.name` |
| `hotels[].websiteUrl` | `event_hotels.website_url` |
| `hotels[].imageUrl` | `event_hotels.image_url` |
| `hotels[].phoneNumber` | `event_hotels.phone_number` |
| `hotels[].mobCode` | `event_hotels.mob_code` |
| `hotels[].latitude` | `event_hotels.latitude` |
| `hotels[].longitude` | `event_hotels.longitude` |
| `hotels[].addressDescription` | `event_hotels.address_description` |
| `hotels[].streetAddress` | `event_hotels.street_address` |
| `hotels[].city` / `state` / `zip` | `event_hotels.city` / `state` / `zip` |
| `hotels[].notes` | `event_hotels.notes` |
| `hotels[].status` | `event_hotels.status` |
| `sponsors[].*` | `event_sponsors.{id, event_id, name, website_url, image_url, status}` |

#### Required indexes

Order matters — these are the covering / range-scan keys each query above hits. All but query 4 are defined in the schema doc; `games` indexes for query 4 are pending when the `games` table lands.

| Query | Index | Why |
|---|---|---|
| 0. Parent gate | `team_events (id)` PK + `(association_id, deleted_at)` | PK lookup with the association + soft-delete filter applied in the WHERE; both already exist. |
| 1. Parks bucket | `event_playing_facilities (event_id, deleted_at, park_id)` — `idx_epf_event_lookup` | Covering for the WHERE + JOIN to `game_parts`. Planner reads only the index. |
| 2. fieldsInUse | `event_field_selections (event_id, park_field_id)` UNIQUE — `unique_event_park_field` | Already exists for the dupe-prevention invariant; the leading `event_id` column doubles as the lookup key. JOIN to `park_fields` rides the PK. |
| 3. Schedule windows | `park_scheduling_windows (event_id, deleted_at, park_id, available_date, start_time, end_time)` — `idx_psw_lookup` | Covering composite — entire SELECT served from the index without row visits. |
| 4. Divisions + window | `tournament_games (event_id, deleted_at, tournament_id, start_date, start_at_utc, end_at_utc)` + `event_tournaments (event_id, deleted_at)` + `tournament_teams (tournament_id, deleted_at, status)` | LEFT JOIN drives off `event_tournaments`; the games index supports the join + `MIN/MAX` on `start_date` / `start_at_utc` / `end_at_utc` from the index. The `tournament_teams` index backs the per-division `teamCount` subquery (counts are read straight from the index). |

If `tournament_games` only has `(event_id, deleted_at)` today, query 4 degrades to a full event-wide games scan + GROUP BY. SSUSA-scale events have hundreds-to-low-thousands of games per event, so the scan is still sub-100 ms, but the covering index above keeps this endpoint flat at every event size. The `teamCount` subquery is `O(teams-in-division)` per division (dozens at most) and is fully index-served.
#### Sponsors / hotels buckets (proposed)

Served from a client-side mock today; finalise the `event_sponsors` / `event_hotels` columns when the backend buckets ship. Each runs only when its bucket is in the requested set (`all`, or a comma-separated `type` containing `sponsors` / `hotels`).

```sql
-- sponsors bucket (when the requested set includes 'sponsors')
SELECT id, event_id, name, website_url, image_url, status
FROM event_sponsors
WHERE event_id = :eventId AND deleted_at IS NULL
ORDER BY LOWER(name) ASC, id ASC;

-- hotels bucket (when the requested set includes 'hotels')
SELECT id, event_id, name, website_url, image_url,
       phone_number, mob_code, latitude, longitude,
       address_description, street_address, city, state, zip,
       notes, status
FROM event_hotels
WHERE event_id = :eventId AND deleted_at IS NULL
ORDER BY LOWER(name) ASC, id ASC;
```

---

## 10. Cross-cutting field rules

| Rule | Notes |
|---|---|
| Wire format is camelCase. | Every wire field uses camelCase regardless of how the DB column is named. New `team_events` columns are snake_case at the DB level (`event_start_date`, …) — the backend serializer translates to camelCase (`eventStartDate`, …) on the wire. See §3 for the naming-convention note. |
| Legacy `team_events` date / time VARCHARs are not exposed. | `startDate` / `endDate` / `startTime` / `endTime` still exist in the table (M5b drops them later) but the v2 wire surfaces only the new `eventStartDate` / `eventEndDate` / `eventStartTime` / `eventEndTime` fields (DB-side: `event_start_date` / `event_end_date` / `event_start_time` / `event_end_time`). Legacy reads remain available through legacy endpoints not covered by this contract. |
| `avatar` is a filename only when writing. On read, the API returns a fully-qualified Cloudflare-transformed URL in `avatarUrl`. | The returned `avatarUrl` is a **Cloudflare-transformed URL** (default preset: `cover_card_wide` for the listing thumbnail, `cover_banner` for the hero / detail page). Backend wraps every event cover through the shared `transformImageUrl()` helper before serialization. See [`conventions.md` § Image URLs](./conventions.md#image-urls) and [`shared-catalogues.md` §7 — Image-transform presets](../system/shared-catalogues.md). Frontend treats the URL as opaque. Source images stay valid indefinitely (public-read ACL); if the source is deleted, the URL 404s and the API does not reissue. |
| Numeric IDs serialize as strings. | Per conventions. |
| Soft-deleted events excluded from every read endpoint. | `WHERE deleted_at IS NULL`. |
| `teamCounts` is read-only. | Backend-computed on every read via `LEFT JOIN event_joined_team` + conditional `SUM(...)` per status. Index `idx_ejt_event_status (event_id, deleted_at, status)` on `event_joined_team` keeps it sub-30 ms at SSUSA scale. Stripped from writes if present. |
| `startAtUtc`, `endAtUtc`, `registrationOpeningUtc`, `entryFeeDeadlineUtc` are read-only. | DB-generated from local fields + `timeZone`. |
| Permission gate: `manage_events` on the caller's `association_users` row. | Middleware on every endpoint. |
| Frontend never does TZ math. | API returns `dateRangeLabel`, `dateRangeLabelShort`, `registrationStatus`, `registrationOpensLabel`, `registrationClosesLabel`, `isPast`, `eventYear` — all backend-computed. |

---

## 11. Frontend integration points

| File | Role |
|---|---|
| `src/api/events.ts` | Mock layer in v1 — types match the wire shapes here. Production swap via the axios layer. Also exports `fetchEventResources` (§9). |
| `src/views/AssociationEventsView.vue` | Lists + filters via §1. Year dropdown via §2. Create modal via §4. |
| `src/components/EventFormModal.vue` | Create + Edit via §4/§5. Reads `timeZone` catalogue from the `EVENT_TIMEZONES` constant. |
| `src/components/EventOfficialAccessModal.vue` | Calls §9 on open to populate the scoring-scope picker (parks + divisions) — replaces the previous "parks/divisions inlined on the OfficialEvent payload" model. |
| `src/types.ts` | `Event`, `EventListParams`, `SaveEventPayload`, `EventStatus`, `EventResources` types match this contract. |

---

## 12. `Event` shape (response reference)

The full row returned by §1 / §3 / §4 / §5 / §7.

```ts
interface Event {
  // Identity
  id: string
  guid: string
  slug: string          // auto-generated, globally-unique URL handle (read-only)

  // Ownership
  teamId: string | null
  associationId: string | null
  associationShortName: string | null

  // Identity + display
  eventName: string
  eventType: string | null
  // public image URL — no AWS signature; see §9 cross-cutting rules
  avatarUrl: string | null

  // Location
  address: string | null
  location: string | null
  city: string | null
  state: string | null
  zipCode: string | null
  lat: string | null
  long: string | null

  // Dates & timezone (source-of-truth local fields)
  // camelCase on the wire; underlying DB columns are
  // `event_start_date` / `event_end_date` / `event_start_time` /
  // `event_end_time` (snake_case per the new-column DB convention).
  eventStartDate: string | null          // YYYY-MM-DD
  eventEndDate: string | null
  eventStartTime: string | null          // HH:MM:SS — null when allDay
  eventEndTime: string | null
  timeZone: string                       // IANA name
  allDay: boolean

  // Derived UTC + display (read-only)
  startAtUtc: string                     // ISO 8601 UTC
  endAtUtc: string
  eventYear: number
  isPast: boolean
  dateRangeLabel: string                 // "Apr 19 to May 24, 2026 (Eastern Time)"
  dateRangeLabelShort: string            // "Apr 19 to May 24, 2026 (EST)"

  // Misc
  note: string | null
  reminder: string | null
  mediumId: string | null
  mediumName: string | null
  url: string | null
  color: string | null

  // Lifecycle
  eventStatus: 'draft' | 'published' | 'completed' | 'cancelled'

  // Director contact
  directorName: string | null
  directorEmail: string | null
  directorPhone: string | null
  mobCode: string | null

  // Tournament settings (event-level defaults)
  entryFee: number | null
  refundPolicy: string | null
  tournamentFormat: string | null
  entryFeeDeadline: string | null        // YYYY-MM-DD (local)
  entryFeeDeadlineUtc: string | null     // ISO UTC (read-only)
  poolPlayGuaranteed: string | null      // games guaranteed in pool play
  bracketFormatId: string | null         // FK to bracket-format catalogue
  bracketFormat: string | null           // READ-ONLY denormalized name
  poolPlayTime: string | null
  championshipTime: string | null
  bracketTime: string | null
  timeInterval: string | null

  // Sport type (joined)
  sportsTypeId: string | null
  sportsTypeName: string | null

  // Registration controls
  allowTeamRegistration: boolean
  registrationOpening: string | null        // local DATETIME
  registrationOpeningUtc: string | null     // ISO UTC (read-only)
  registrationStatus: 'not_open' | 'open' | 'closed'
  registrationOpensLabel: string | null
  registrationClosesLabel: string | null

  // Payment
  paymentRequired: boolean
  paymentTerms: 'full' | 'partial' | null
  partialPaymentType: 'fixed_amount' | 'percentage' | null
  partialPaymentValue: number | null
  allowOfflinePayment: boolean
  autoConfirmOnFullPayment: boolean
  autoConfirmOnPartialPayment: boolean
  // READ-ONLY. Whether the owning association has an active Stripe Connect
  // account — resolved by the backend on get-one. Same field name + boolean
  // shape as `stripeConnected` on the my-associations response. Gates the
  // Edit form's online-payment toggle.
  stripeConnected: boolean

  // Field configuration
  fieldConfigId: string | null

  // Custom fields (read-only) — the admin-defined custom-field answers for
  // this event, sourced from custom_field_values joined to their definitions,
  // so the edit form can prefill. Omitted / empty when the event has no
  // custom values. Submitted back as `customFields` on create/update (§4/§5).
  customFields: Array<{
    definitionId: string                  // custom_field_definitions.id
    fieldKey: string                      // e.g. "classification"
    label: string                         // e.g. "Classification"
    value: string                         // encoded per the definition's input_type (see §4)
  }>

  // Participation counts — backend-computed at read time via
  // LEFT JOIN + conditional SUM on event_joined_team. Read-only.
  teamCounts: {
    pending: number       // status: pending_approval
    confirmed: number     // status: confirmed
    waitlisted: number    // status: waitlisted
    withdrawn: number     // status: withdrawn
  }

  // Audit
  createdAt: string                       // ISO UTC
  updatedAt: string
  createdByUserId: string | null
  updatedByUserId: string | null
}
```

---

## 13. `EventSummary` shape (list response reference)

The shape returned by §1's `data.data[]`. Slim subset of `Event` — only the fields the listing row renders. Detail / edit flows fetch the full `Event` via §3.

```ts
interface EventSummary {
  // Identity
  id: string
  guid: string
  slug: string          // auto-generated, globally-unique URL handle (read-only)

  // Display
  eventName: string
  eventType: string | null
  // public image URL — no AWS signature; see §9 cross-cutting rules
  avatarUrl: string | null
  eventStatus: EventStatus

  // Pre-formatted date (single label; the short variant is detail-only)
  dateRangeLabel: string                  // "Apr 19 to May 24, 2026 (Eastern Time)"

  // Sport / location / director (display only)
  sportsTypeName: string | null
  city: string | null
  state: string | null
  directorName: string | null             // no email / phone in the list response

  // Stats row — same `teamCounts` shape as the full Event row.
  // Listing UI sums `pending + confirmed + waitlisted` to display
  // "N Teams Participating"; the detail view shows the full split.
  teamCounts: {
    pending: number
    confirmed: number
    waitlisted: number
    withdrawn: number
  }
  entryFee: number | null
  entryFeeDeadline: string | null         // YYYY-MM-DD (local)
  paymentRequired: boolean

  // Registration badge
  allowTeamRegistration: boolean
  registrationStatus: 'not_open' | 'open' | 'closed'
  registrationOpensLabel: string | null   // "Opens Apr 15, 2026" — only when status='not_open'
  registrationClosesLabel: string | null  // "Closes Apr 15, 2026" — only when status='open'
}
```

**17 fields.** Drops the 50+ fields the list row doesn't render: UTC mirrors (`startAtUtc`, `endAtUtc`, `registrationOpeningUtc`, `entryFeeDeadlineUtc`), address / zip / `lat`-`long`, the short timezone label, every writable form field (`eventStartDate`, `eventEndDate`, `eventStartTime`, `eventEndTime`, `timeZone`, `allDay`, `note`, `reminder`, `url`, `color`, `mediumId`, `mediumName`, `address`, `location`, `zipCode`, `lat`, `long`), all tournament settings except `entryFee` (`refundPolicy`, `tournamentFormat`, `poolPlayGuaranteed`, `bracketFormatId`, `bracketFormat`, `poolPlayTime`, `championshipTime`, `bracketTime`, `timeInterval`), all payment config except `paymentRequired` (`paymentTerms`, `partialPaymentType`, `partialPaymentValue`, `allowOfflinePayment`, `autoConfirmOnFullPayment`, `autoConfirmOnPartialPayment`), director contact (`directorEmail`, `directorPhone`, `mobCode`), `fieldConfigId`, `sportsTypeId`, identity (`teamId`, `associationId`, `associationShortName`), and audit (`createdAt`, `updatedAt`, `createdByUserId`, `updatedByUserId`).

### SQL implication

The listing query SELECTs roughly 15 columns (down from 50+); the only generated columns it reads are `end_at_utc` (for the past-events filter, never returned) and `registration_opening_utc` + `entry_fee_deadline_utc` (only when deriving `registrationStatus`). The four pre-formatted labels (`dateRangeLabel`, `registrationOpensLabel`, `registrationClosesLabel`, plus `registrationStatus` itself) stay backend-computed so the frontend never does TZ math.

---

## 14. Out of scope (deferred)

- **Event detail page** (`AssociationEventDetailsView`) — clicking a row currently does nothing.
- **Tournaments** (child rows) — `event-tournaments-api-contract.md` deferred to a follow-up branch.
- **Divisions** / **parks** / **schedule** / **brackets** — separate contracts when those tables land.
- **Team participation** (`event_joined_team`) — source of truth for `teamCounts`. Separate.
- **Hero image upload** — separate endpoint; the current form sends a filename only.
- **Event lifecycle audit log** — captures status transitions with reasons.
- **Bulk operations** — multi-select clone / cancel / delete.

---

## 15. Field-name migration map (v0 → v1)

For consumer code that referenced the old v0 names:

| v0 field | v1 field | Notes |
|---|---|---|
| `name` | `eventName` | |
| `shortName` | `eventType` | Repurposed — v0 vanity label; v1 is production sub-categorization. |
| `sportType` (ENUM) | `sportsTypeId` + `sportsTypeName` | v0 hardcoded 4 sport types; v1 references the production catalogue. |
| `timezone` | `timeZone` | |
| `venueCity`, `venueState` | `city`, `state` | |
| `imageUrl` | `avatarUrl` (read) / `avatar` (write) | |
| `description` | _(removed)_ | Use `note` (short) or `tournamentFormat` (long-form). |
| `registrationOpensAt`, `registrationClosesAt` | `registrationOpening`, `entryFeeDeadline` | `entryFeeDeadline` is a date (no time). |
| `status` | `eventStatus` | Canonical lifecycle column. |
| `startDate` | `eventStartDate` | camelCase on the wire. DB column is `event_start_date` (DATE; legacy `startDate` was VARCHAR). |
| `endDate` | `eventEndDate` | Same — DB column is `event_end_date`. |
| `startTime` | `eventStartTime` | TIME (DB column `event_start_time`). NULL when `allDay`. |
| `endTime` | `eventEndTime` | Same — DB column is `event_end_time`. |
