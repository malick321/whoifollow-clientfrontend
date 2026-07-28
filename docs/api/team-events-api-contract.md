---
status: Draft (v1)
owner: shared
last_updated: 2026-07-28
---

# Team Events — REST API contract

## Context

Powers the **team-owned** event-creation flow launched from the team detail page
(`src/views/TeamDetailView.vue` → "Add Event" → `MatchGeniEventFormModal` in *team mode*).
It is the `/v2` replacement for the legacy Vue 2 `POST /event/create` team flow.

The single endpoint here is rooted under `/v2/chat/teams/{teamId}/...` (it lives alongside the
existing team-detail reads — `GET /v2/chat/teams/{teamId}/events` etc. — served by
`ChatTeamController`). Create is handled by `AssociationEventsController@storeForTeam`, which
reuses the same validation / payload-mapping / avatar / slug machinery as the association create
(§4 of [`association-events-api-contract.md`](./association-events-api-contract.md)) — only the
ownership + scoping fields and the authorization gate differ. For shared rules — response
envelope, pagination shape, auth header, error codes — see [`conventions.md`](./conventions.md).

**Naming convention (wire ≠ DB).** As with all v2 contracts, request bodies, responses, and
query params are **camelCase**; DB column names (`event_start_date`, `owner_type`, …) appear only
in SQL sketches. The `{teamId}` path param is the firebase-style `teams.team_id` **string**, not
the numeric PK — the same key the team-detail reads use.

ID literals in the JSON examples use prefixed stubs (`evt_…`, `u_…`, `tm_…`) for readability;
production serializes the bare `BIGINT UNSIGNED` PK as a numeric string. See
[`conventions.md` § Doc-example IDs vs wire IDs](./conventions.md#doc-example-ids-vs-wire-ids).

## Scope decisions (locked in)

- **Ownership**: `owner_type` is a `TINYINT UNSIGNED` — **`0 = team, 1 = association, 2 = platform, 3 = user`**. This endpoint always writes `owner_type = 0` and populates `team_id`. Association-portal endpoints only read/write `owner_type = 1`, so team events never leak into association listings, and vice-versa.
- **Server-derived scoping/ownership fields (never sent in the request body).** On create the backend sets these from the route's `{teamId}` + the authorized team membership:
  - `team_id` ← the `{teamId}` path param (firebase-style string).
  - `owner_type` ← `0` (team); `owner_linked_id` ← the resolved `teams.id` (numeric PK).
  - `association_id` ← `NULL`; `association` ← `NULL` (a team event is not association-scoped).
  - `guid`, `slug`, `created_by`, `createdByName`, `createdByDate` ← generated server-side (same as the association create).
- **Authorization is TEAM-scoped, not association-scoped.** The caller must be a **team admin** — the team creator (`teams.created_by`) OR a `team_members` row with `admin = 1`. There is no `manage_events` association permission check on this route. Without it → `403`.
- **Date storage is LOCAL** (in the event's TZ), with backend-computed UTC mirrors / display strings — identical to the association contract.
- **Attendance**: on create the backend inserts the **creator's** `team_events_attendences` row with `member_status = 1` ("going"), mirroring the legacy flow (so the new event surfaces as attended). Broad team-member auto-attach is out of scope for v1.
- **Reduced field set (team mode).** The team wizard collects only Details + Location; tournament format, registration, payment, seed-criteria and custom fields are not part of the team flow. Those columns accept `null`/defaults and the endpoint does not require them.
- **Soft delete only.** No hard delete exposed.

## Underlying tables

| Table | Purpose |
|---|---|
| `team_events` | The event master record (`owner_type = 0`, `team_id` set). Same table as association events. |
| `team_events_attendences` | Per-member attendance rows; the creator's "going" row is inserted on create. |
| `teams` | The owning team (`{teamId}` resolves to a `teams.team_id` row; `owner_linked_id` = its PK). |
| `team_members` | Membership + `admin` flag — source of the create authorization gate. |
| `team_sport_types` | Sport-type catalogue (joined for `sportsTypeName`). |

---

## 1. Create Team Event

- **Endpoint**: `POST /v2/chat/teams/{teamId}/events`
- **Purpose**: A team admin creates a team-owned event from the team detail page.
- **Table sources**: INSERT into `team_events` (+ the creator's `team_events_attendences` row).
- **Auth**: bearer token; caller must be a team admin (creator or `team_members.admin = 1`) → else `403`.

### Request encoding

**`multipart/form-data`** (not JSON) — the event cover image is uploaded as a binary part
`avatar[0]` (single-element file array), identical to the association create. Scalar fields are
sent as form fields; the encoding rules are the same as
[association §4 → Field encoding](./association-events-api-contract.md#field-encoding-everything-crosses-the-wire-as-a-string-in-multipart)
(booleans `"1"`/`"0"`, `eventType` as catalogue key, null/blank fields omitted). The shared
frontend encoder is `eventPayloadToFormData()` in `src/api/events.ts`; the team call is
`createTeamEvent(teamId, payload, avatar?)` in the same file.

### Request body

The JSON below documents the **field set + types** the team flow sends; on the wire these are
multipart form fields (+ the `avatar[0]` binary part). Ownership/scoping fields (`teamId`,
`ownerType`, `associationId`) are **NOT** sent — the backend derives them from the route.

```jsonc
{
  "eventName": "Maradona Event",
  "eventType": "league",                        // catalogue KEY (not the "League" label)
  // avatar[0] — binary image file (multipart part); omit to create without a cover

  "locationType": "in_person",                  // 'in_person' | 'online'

  // ── when locationType = 'in_person' ──
  "address": "Salisbury Sports Ground",
  "location": "Salisbury",
  "city": "Salisbury",
  "state": "England",
  "zipCode": "SP1",
  "lat": "51.0688",
  "long": "-1.7945",

  // ── when locationType = 'online' (in_person fields → null/omitted) ──
  "mediumId": null,
  "medium":   null,
  "url":      null,

  "eventStartDate": "2026-04-26",               // local date in event TZ (YYYY-MM-DD)
  "eventEndDate":   "2026-07-31",
  "eventStartTime": "08:00:00",                 // local time (HH:MM:SS) — null when allDay
  "eventEndTime":   "20:00:00",
  "timeZone":  "America/Denver",                // IANA identifier
  "allDay":    false,

  "note": "Team league fixtures.",

  "sportsTypeId": "1",

  "eventStatus": "published"                    // 'draft' | 'published' only on create
}
```

### Response

`data` is the full new `Event` (same shape as
[association §12](./association-events-api-contract.md#12-event-shape-response-reference)), with
server-managed fields populated (`id`, `guid`, **`slug`**, `teamId`, `ownerType: 0`,
`associationId: null`, `startAtUtc`, `endAtUtc`, `dateRangeLabel`, `teamCounts`, `createdAt`,
`updatedAt`).

`responseStatus.statusCode` is `201` with `text: "Created"`.

```jsonc
{
  "responseStatus": { "statusCode": 201, "message": "Event created successfully.", "text": "Created" },
  "data": {
    "id": "evt_9001",
    "guid": "b3f1…-uuid",
    "slug": "maradona-event",
    "teamId": "tm_0pEPWrFg…",                   // the firebase-style team key
    "ownerType": 0,
    "associationId": null,
    "eventName": "Maradona Event",
    "eventStatus": "published"
    // … remaining Event fields per association §12
  }
}
```

### Field notes

- **Ownership/scoping is server-derived** — any `teamId` / `ownerType` / `associationId` sent in
  the body is ignored. `team_id` comes from the route; `owner_type` is forced to `0`.
- **`slug`** is auto-generated from `eventName` (lowercase, non-alphanumerics → `-`, globally
  unique via `-2`, `-3` … suffix) and read-only — same scheme as the association create.
- **`eventStatus`** must be `'draft'` or `'published'` on create — `'completed'`/`'cancelled'` → `422`.
- **`timeZone`** must be a valid IANA name → else `422`.
- The reduced team field set means tournament/registration/payment fields are absent; they are
  not required and default to `null`. If sent, they are validated with the same rules as the
  association create but the team wizard never collects them.
- The created event appears immediately in `GET /v2/chat/teams/{teamId}/events` (that reader
  queries `team_events` by `team_id`), and does **not** appear in any association listing
  (those filter `owner_type = 1`).

### Errors

| Code | When |
|---|---|
| `401` | No/invalid bearer token. |
| `403` | Caller is not a team admin (not the creator and no `team_members.admin = 1` row). |
| `404` | No `teams` row for `{teamId}`. |
| `422` | Validation failure (missing `eventName`/dates/`timeZone`, bad date format, invalid IANA tz, bad `eventStatus`, unknown `sportsTypeId`/`mediumId`). |
| `500` | Unexpected server error (the just-uploaded avatar is deleted on rollback). |

---

## Out of scope (deferred)

- Update / cancel / delete of team events (add mirroring the association §5–§8 when the UI needs it).
- Team-event listing/get-one beyond the existing lean `GET /v2/chat/teams/{teamId}/events` reader.
- Registration / payment / custom-fields / seed-criteria for team events.
- Auto-attaching all team members as attendance rows (v1 rows only the creator).
