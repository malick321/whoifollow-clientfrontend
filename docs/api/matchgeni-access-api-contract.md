---
status: Draft
owner: shared
last_updated: 2026-06-15
---

# MatchGeni Access — REST API contract

## Context

Single read endpoint that gates entry into MatchGeni (the per-event admin mode) and returns the caller's effective permission set for one event. Used as the **router-guard / loader** for every `/portal/events/<event-guid>/matchgeni*` route — the response decides whether the user can land in MatchGeni at all, and if so, which actions inside MatchGeni they can perform (view vs add / edit / delete / alter).

Powers:

- The matchgeni entry guard on `MatchGeniDashboardView` and every sub-page route (officials today; divisions / parks / schedule / brackets to follow).
- The per-surface write affordances (e.g. the "Add Official" button is enabled iff the caller holds `manage_officials`).
- The matchgeni header — `event.eventName`, `event.dateRange`, `event.eventStatus` come from this same payload so the header doesn't have to chain a second fetch.

Paired with:

- [`matchgeni-officials-api-contract.md`](./matchgeni-officials-api-contract.md) — the permission catalogue (event-permission keys) used by the response is documented there (§8) and in [`docs/system/shared-catalogues.md` §2](../system/shared-catalogues.md).
- [`association-events-api-contract.md`](./association-events-api-contract.md) — source of the underlying `team_events` row for the event-display fields returned here.
- [`conventions.md`](./conventions.md) — shared envelope, error codes, ID encoding, `permissions_json` encoding, image URLs.

**Wire format is camelCase**, matching the rest of the v2 API. ID literals in the JSON examples below use prefixed stubs (`evt_…`, `park_…`, `d_…`) for doc readability only — production serializes the bare `BIGINT UNSIGNED` PK as a numeric string. See [`conventions.md` § Doc-example IDs vs wire IDs](./conventions.md#doc-example-ids-vs-wire-ids).

## Scope decisions (locked in)

- **One endpoint, one read.** No "list my matchgeni events" — this contract is exclusively the *per-event* gate. The events list view uses [`association-events-api-contract.md` §1](./association-events-api-contract.md).
- **MatchGeni is association-owned only.** Backend enforces parent `team_events.owner_type = 1`. Team-owned events → `409` (MatchGeni isn't available for those at all).
- **Entry permission ladder** (any one is sufficient):
  1. A non-deleted `event_officials` row for this event with at least one permission key, OR
  2. `event_officials.fullControl = TRUE` (event-scoped Full Control), OR
  3. Association-level `manage_events` on the caller's `association_users` row, OR
  4. Association-level `fullControl = TRUE`.
  None of the above → `403`.
- **Per-action gate inside MatchGeni follows the same catalogue.** Once the user is in, each write surface (officials, divisions, scoring, scheduling, parks, umpires, …) checks for its own specific key from the returned `permissions` array. See §2 below for the full mapping.
- **`{eventId}` accepts either the numeric event id OR the event GUID.** This endpoint is special — it's the router-guard call fired before any other paint, so the frontend would otherwise need a separate guid→id resolve hop. Backend detects the format: hyphenated → guid lookup, all-digits → id lookup. Every *other* event endpoint in the v2 surface remains strict-numeric.
- **Soft-deleted grants are excluded.** The endpoint never returns a `permissions` array sourced from a soft-deleted `event_officials` row. If the user only had a soft-deleted grant, the response is `403`.

## Underlying tables

| Table | Purpose |
|---|---|
| `team_events` | Parent event. Validated for `owner_type = 1` AND `association_id = :associationId` AND `deleted_at IS NULL`. Source of the `event.*` response fields. |
| `event_officials` | The caller's per-event grant row. Read for `permissions_json`, `scoring_scope_json`, and the `fullControl` sentinel. Soft-deleted rows excluded. |
| `association_users` | The caller's association membership. Read for `permissions_json` (for the association-level `manage_events` and `fullControl` fallbacks) and `status` (must be `'active'`). |

---

## 1. Get My MatchGeni Permissions

- **Endpoint**: `GET /v2/association/events/{associationId}/{eventId}/my-permissions`
- **Purpose**: Resolve the caller's effective permission set for this event + return the event-display fields the MatchGeni header needs. Drives the matchgeni entry guard.
- **Table sources**: SELECT the `team_events` row for display fields; LEFT JOIN `event_officials` to find the caller's per-event grant; LEFT JOIN `association_users` for the association-level fallback. Single round-trip.

### Path parameters

| Name | Type | Notes |
|---|---|---|
| `associationId` | string | The association's numeric PK (NOT the slug). |
| `eventId` | string | Either the event's numeric PK **or** the event's GUID. Backend detects format: contains a `-` → guid lookup; pure digits → id lookup. Both modes hit the same SQL otherwise. |

### Query parameters

None.

### Request body

None (GET).

### Response

```json
{
  "responseStatus": {
    "statusCode": 200,
    "message": "MatchGeni permissions resolved.",
    "text": "OK"
  },
  "data": {
    "event": {
      "id": "evt_5042",
      "guid": "evt_aBc123XYZ",
      "eventName": "DGR Event 2026",
      "dateRange": "May 4 to May 9, 2026 (Central Time)",
      "dateRangeShort": "May 4–9, 2026",
      "startDate": "2026-05-04",
      "endDate": "2026-05-09",
      "eventStartTime": "08:00:00",
      "eventEndTime": "20:00:00",
      "startDateUtc": "2026-05-04T13:00:00Z",
      "endDateUtc": "2026-05-10T01:00:00Z",
      "allDay": false,
      "sportsTypeId": 1,
      "timeZone": "America/Chicago",
      "eventStatus": "published",
      "directorName": "Pat Rivera",
      "directorEmail": "pat.rivera@example.com",
      "directorCountryCode": "+1",
      "directorNumber": "5125550199",
      "defaults": {
        "poolPlayTimeLimit": 65,
        "bracketTimeLimit": 70,
        "championshipTimeLimit": 80,
        "gameTimeSlot": 90,
        "poolPlayGuarantee": 3,
        "bracketFormatId": "4",
        "fieldConfigId": "10"
      }
    },
    "access": {
      "fullControl": false,
      "permissions": ["manage_officials", "manage_scoring"],
      "scoringScope": {
        "mode": "parks",
        "parkIds": ["park_58"],
        "divisionIds": []
      }
    }
  }
}
```

### Field notes — `event.*`

The **caller-independent event entity** — the display strings the MatchGeni header needs, a few raw values the Add/Edit Division + Add-Facility forms seed from, and the nested `defaults` object (event-level config a new division / park / game inherits). Caller-*specific* data (the user's grants) lives in the sibling `access` member, NOT here. Heavier event data (location, organizer, fees, …) stays behind `fetchEvent` (§3 of `association-events-api-contract.md`) — this gate endpoint stays lean.

- `id` — numeric PK string. Returned even if the request came in by guid so the frontend can cache by either key.
- `guid` — returned even if the request came in by id (same reason).
- `eventName`, `dateRange`, `dateRangeShort`, `eventStatus` — server-formatted display strings. `dateRange` includes the TZ label ("Central Time"); `dateRangeShort` is the compact card-style variant ("May 4–9, 2026"). `eventStatus` is one of the catalogue values from `EVENT_STATUS_CATALOGUE` (`draft` / `published` / `completed` / `cancelled`).
- `startDate` / `endDate` — **raw** event dates, plain `YYYY-MM-DD` with **no timezone or formatting** (deliberately unlike `dateRange`). They bind straight to the Add/Edit Division date controls as the default Start / End. Sourced from `team_events.event_start_date` / `event_end_date`.
- `eventStartTime` / `eventEndTime` — **raw** event times, plain `HH:MM:SS` with **no timezone or formatting**, sourced from `team_events.event_start_time` / `event_end_time`. `null` (or absent) when the event is all-day. The **Add Facility (park) wizard** seeds its default per-day scheduling window from these (start-of-day / end-of-day), so a new park's day window matches the event's operating hours out of the box.
- `startDateUtc` / `endDateUtc` — the event's start / end as absolute **UTC instants**, ISO 8601 with the `Z` suffix (e.g. `"2026-05-04T13:00:00Z"`). **Computed server-side** by resolving the raw event-local `startDate` + `eventStartTime` (resp. `endDate` + `eventEndTime`) against the event's `timeZone`; for all-day events the server uses start-of-day / end-of-day in the event tz. Derived — *not* stored columns. Consumers that need a precise moment (countdowns to event start, "is the event live now", cross-timezone sorting) use these directly instead of recombining the raw local parts + tz on the client.
- `allDay` — boolean, `true` when the event has no specific start/end time (i.e. `eventStartTime` / `eventEndTime` are null). **Derived** server-side from the existing start/end-time columns — *not* a new stored column. When `true`, the facility wizard defaults the scheduling window to 8:00 AM – 8:00 PM.
- `sportsTypeId` — the event's sport type id (number). The Add/Edit Division form passes it to `GET /v2/tournaments/field-configurations/sport-type/{sportsTypeId}` (shared-services §5) to load the Field Configuration options. Sourced from the existing event sport-type column (`team_events.sport_type_id`); the serializer emits it under the camelCase wire key `sportsTypeId` (note the plural "sports") — the underlying column keeps its current name.
- `timeZone` — the event's **IANA** timezone id (e.g. `"America/Chicago"`), sourced from `team_events.time_zone`. Shipped so any surface that needs to turn an event-local date into a precise instant computes it against the **event's** tz, not the viewer's browser tz. (The division-create flow stores plain `DATE`s and doesn't persist a tz today — see `matchgeni-division-api-contract.md` — but the field is here for correctness now and future instant-level needs.)
- `directorName` / `directorEmail` / `directorCountryCode` / `directorNumber` — the event director's contact details, surfaced so MatchGeni surfaces (e.g. a "contact the director" affordance / event header) can show them without a second event fetch. Sourced from `team_events.director_name` / `director_email` / `mob_code` (dialing country code, e.g. `"+1"`) / `director_phone` respectively. Any may be `null`/empty when not set on the event; the serializer emits them under these camelCase wire keys (underlying columns keep their current names).
- `defaults` — nested object of event-level config a freshly-created division / park / game inherits. Lives under `event` (not a top-level sibling) because it's caller-independent event-entity data from the same `team_events` row. Optional — absent on older payloads. See the next section.

### Field notes — `event.defaults.*`

Event-level **config defaults a freshly-created division / park / game inherits** as its starting point. Every member is optional + nullable: `null` when the event hasn't set that default, and the whole object may be absent on older payloads — the form reads each defensively and only pre-fills a control when the value is present. These are *defaults only*; the user can override any of them in the wizard, and the saved record's own persisted values win once saved.

- `poolPlayTimeLimit` / `bracketTimeLimit` / `championshipTimeLimit` — minutes; the official **regulation time limit** per game type. They default the Division Info → Time Limits fields, and a game created under a division inherits the matching value as its per-game time limit (the value the live-scoring surface uses for "remaining" / "over time"). **Distinct from the game's *time slot*** (how much room the game occupies on the schedule grid) — see the note below.
- `gameTimeSlot` — minutes; the default **game time slot** — how much room a game occupies on the schedule grid. A single event-level value (not per game type). Sourced from the **existing `team_events.time_interval` column** (no new column needed). Used to seed (a) a **new park's** default game slot when a park is added, and (b) a **new game's** slot when a pool / bracket game is created under a division. Distinct from the time limit: the slot can be shortened on the grid (e.g. a rain-pivot reslot) without changing the regulation time limit.
- `poolPlayGuarantee` — integer 1–5; default the Pool Play Guaranteed select (shown when the division uses a custom format).
- `bracketFormatId` — string FK into the `/getBracketFormats` catalogue (shared-services §2); default the Bracket Format select. The client resolves the label from its cached catalogue.
- `fieldConfigId` — string FK into the field-configuration catalogue (shared-services §5, scoped by `event.sportsTypeId`); default the Field Configuration select.
- `seedCriteriaIds` — the event-level tie-breaker (seed-criteria) ids **in priority order** (`event_seed_criteria`). Lets the Add/Edit Division popup show the inherited tie breakers in its "Event default" mode (resolved to names via the `/v2/seeders` catalogue) and pre-seed the Custom selection. Omitted / `[]` when the event has no custom seed default.

> **Time limit vs game time slot.** Both are **event-level defaults** returned here (they live in the same `team_events` defaults row). The **time limit** is the fixed regulation length the live-scoring surface counts against; the **game time slot** is the grid footprint used for scheduling / packing and can be reslotted (e.g. shortened during a rain-pivot) without changing the regulation limit. The slot default flows down to a park when it's created (the park then carries its own effective `defaultGameDurationMinutes`, which the parks/resources API returns and the scheduler reads); a new game seeds its own slot + time limit from the matching per-type values here.

### Field notes — `access.*`

The caller's effective permission set for THIS event. Identical wire shape to the `OfficialEvent`-style payload other surfaces consume, so the frontend can drop it into the same gating helpers.

- `fullControl: boolean` — `true` when the caller holds Full Control via *any* path: event-scoped FC on their `event_officials` row, OR association-level FC on their `association_users` row. `true` short-circuits every per-key check — every action inside MatchGeni is allowed.
- `permissions: EventPermissionKey[]` — the keys the caller holds for this event. **Always empty when `fullControl: true`** (wire encoding rule — FC implies every key, so the array is `[]` per [the conventions encoding](./conventions.md#permission-key-encoding-permissions_json)).
- `scoringScope: ScoringScope | null` — the parks/divisions slice the caller's `manage_scoring` permission applies to. `null` when (a) the caller doesn't hold `manage_scoring`, OR (b) `fullControl: true` (FC implies all parks + all divisions), OR (c) the caller holds `manage_scoring` with no restriction ("all games"). When present, `mode` is one of `'parks'` / `'divisions'` and the matching id array (`parkIds` / `divisionIds`) is populated. **The unrestricted ("all games") case MUST serialize as `null` — backend never emits a `{ "mode": "all", … }` object on the wire.** The frontend treats `null` as "all games"; the `'all'` mode value exists only as an internal client convenience. Same shape every other surface uses.

### Association-portal standing is NOT on this payload (by design)

This endpoint does **not** report the caller's association-portal permissions. MatchGeni and the association portal run in the **same app on the same subdomain**, and **every MatchGeni user is an association member** — an event-official invite always creates an `association_users` row (with no permissions for an external official, so the association can still track them under Portal → Users). Because of that, `currentAssociation` (resolved from `GET /v2/my/associations/{slug}` for the slug→id hop on every matchgeni route) is **always loaded** and already carries `fullControl` / `permissions`.

- **"Back to portal" button:** the rail footer shows it iff the caller has any portal access — read directly from `currentAssociation` (`fullControl === true || permissions.length > 0`), see `canEnterAssociation` in `src/matchgeni-context.ts`. A no-permission official (empty `permissions`, `fullControl: false`) sees no button.
- **History note:** earlier drafts duplicated `associationFullControl` / `associationPermissions` onto this payload (under a "separate frontends on separate domains" assumption that no longer holds). Those fields were **removed as redundant** — they came from the same `association_users.permissions_json` already exposed via `currentAssociation`, on a call that fires after the one that has it.

#### Source-of-permission cases (informational)

The `permissions` array is composed by the backend at request time from the strongest grant path. The composition rules:

| Grant path | What `permissions` contains | `fullControl` | `scoringScope` |
|---|---|---|---|
| Event FC on `event_officials.permissions_json = ["*"]` | `[]` | `true` | `null` |
| Association FC on `association_users.permissions_json` includes `"*"` | `[]` | `true` | `null` |
| Per-event grant with explicit keys | the explicit keys verbatim | `false` | from `event_officials.scoring_scope_json` (or `null`) |
| Association `manage_events` (no per-event grant) | `[]` | `false` | `null` |

The fourth row is the "association admin without a per-event grant" case. They can enter MatchGeni and see every surface read-only — but `permissions` is empty, so every write check fails. To unlock writes for an association admin, the admin would either toggle the association FC flag OR grant themselves the per-event keys via the standard officials flow.

### Field notes — error codes

| Status | When |
|---|---|
| `401` | Caller isn't authenticated. |
| `403` | None of the four entry conditions in "Scope decisions" §3 above pass. Response body's `responseStatus.message` reads "You don't have access to MatchGeni for this event." |
| `404` | `eventId` (or `eventGuid`) doesn't exist, is soft-deleted, or belongs to a different association. |
| `409` | Parent event is team-owned (`owner_type ≠ 1`). MatchGeni doesn't apply to those. |

### SQL sketch

```sql
-- 1) Parent gate — fail fast (404 / 409) before reading permissions.
SELECT
  te.id, te.guid, te.event_name,
  te.event_start_date, te.event_end_date, te.event_start_time, te.event_end_time,
  te.time_zone, te.event_status,
  -- event director contact (directorName/Email/CountryCode/Number):
  te.director_name, te.director_email, te.mob_code, te.director_phone,
  -- event.sportsTypeId + the event.defaults.* values a new division /
  -- park / game inherits (columns may need adding if not persisted today):
  te.sport_type_id,
  -- regulation time limits (per type):
  te.default_pool_play_minutes, te.default_bracket_minutes, te.default_championship_minutes,
  -- game time slot / grid footprint (single event-level default) —
  -- the EXISTING `time_interval` column (no new column needed):
  te.time_interval,
  te.default_pool_play_guarantee, te.default_bracket_format_id, te.default_field_config_id,
  te.owner_type
FROM team_events te
WHERE
  (
    (:eventIsGuid = 1 AND te.guid    = :eventId) OR
    (:eventIsGuid = 0 AND te.id      = CAST(:eventId AS UNSIGNED))
  )
  AND te.association_id = :associationId
  AND te.deleted_at IS NULL;
-- → not found → 404
-- → owner_type != 1 → 409

-- 2) Per-event grant (may be NULL).
SELECT eo.permissions_json, eo.scoring_scope_json
FROM event_officials eo
INNER JOIN association_users au
  ON au.id = eo.association_user_id AND au.status = 'active'
WHERE eo.event_id = :eventNumericId
  AND au.user_id  = :callerUserId
  AND au.association_id = :associationId
  AND eo.deleted_at IS NULL
LIMIT 1;

-- 3) Association-level fallback (always read; cheap).
SELECT permissions_json
FROM association_users
WHERE user_id = :callerUserId
  AND association_id = :associationId
  AND status = 'active'
LIMIT 1;
```

Resolution order in the application layer:

1. If §2 returned a row with `permissions_json = ["*"]` → respond `fullControl: true`, `permissions: []`, `scoringScope: null`.
2. Else if §3 returned a row with `permissions_json` containing `"*"` → respond `fullControl: true`, `permissions: []`, `scoringScope: null`.
3. Else if §2 returned a row with a non-empty array → respond `fullControl: false`, `permissions: <keys>`, `scoringScope: <parsed json or null>`.
4. Else if §3 returned a row containing `manage_events` → respond `fullControl: false`, `permissions: []`, `scoringScope: null`.
5. Else → `403`.

---

## 2. Permission semantics — view vs add / edit / delete / alter

The single rule, in plain language:

> **Anyone who passes the entry gate sees every MatchGeni surface, but writes are gated per-permission.** If a user holds `manage_officials` (and no other keys), they can browse the officials list, the divisions list, the scoring grid, the schedule, the parks list, etc. — but the only write actions they can perform are add/edit/revoke officials. Every other surface is rendered read-only for them.

This produces a consistent UX: the matchgeni nav doesn't shapeshift per user (everyone sees the same sidebar / tabs), and write affordances inside each surface (toolbar buttons, row ellipsis menus, drag-handles, inline-edit fields) are toggled individually based on the matching key.

### Catalogue → surface mapping

`fullControl: true` implicitly grants every row in this table.

| Permission key | What it unlocks (writes) | Where it lives in the UI |
|---|---|---|
| `edit_event` | Edit event metadata (name, dates, description, settings). | MatchGeni Dashboard's "Edit event" button + Event Form modal. |
| `manage_team_participation` | Approve / reject / waitlist / withdraw team registrations; alter participation status. | Teams sub-page (future) — registrations toolbar + row ellipsis. |
| `manage_divisions` | Add / edit / delete divisions; assign teams to divisions. | Divisions sub-page (future) — add button, row edit, row delete. |
| `manage_scoring` | Enter and edit game scores within `scoringScope` (if `null`, all games; otherwise restricted to `parkIds` / `divisionIds`). | Scoring sub-page (future) — score-grid cells, lock buttons. |
| `manage_umpires` | Invite umpires to the event; assign umpires to games. | Umpires sub-page (future) — invite button, assignment dropdowns. |
| `manage_officials` | Add existing user / invite new user as event official; edit access; revoke access. | Officials sub-page — "Add Official" / "Invite" buttons, row ⋯ menu (Edit access, Revoke). See [`matchgeni-officials-api-contract.md`](./matchgeni-officials-api-contract.md). |
| `manage_scheduling` | Schedule / unschedule pool and bracket games; reorder game slots; reassign games to parks/times. | Schedule sub-page (future) — drag handles, time edits, game-create button. |
| `manage_parks` | Add / edit / delete park venues. | Parks sub-page (future) — add button, row edit, row delete. |
| `manage_hotels` | Add / edit / delete hotel blocks and accommodation info. | Hotels sub-page (future). |
| `manage_sponsors` | Add / edit / remove event sponsors. | Sponsors sub-page (future). |

> **Note on `manage_reports`.** Reports are an association-level feature (gated by `manage_reports` on the caller's `association_users` row), not an event-level one — they have their own contract (`reports-api-contract.md`) and don't appear in the event-permission catalogue. The MatchGeni dashboard may surface a "View reports" shortcut, but the actual reports page lives outside MatchGeni.

### Read access (informational)

Every MatchGeni surface (dashboard tiles, officials list, divisions list, scoring grid, schedule, parks list, etc.) is visible to anyone who passed the entry gate. There is no per-surface read gate. The rationale:

- **Coordination.** An umpires manager benefits from seeing the divisions / schedule / parks even if they can't edit them.
- **Discoverability.** Hiding entire sections based on the key the user has produces a confusing "where did that page go" experience for users who switch roles or who are part of multiple events with different grants.
- **Simplicity.** One entry gate (HTTP 403) + per-action write gates (UI affordance toggle) is easier to reason about than two layers of read gating.

If a future feature requires a per-surface read gate, that surface's contract will document it explicitly. Until then, "read = everyone who entered, write = key holder" is the universal rule.

### Frontend gate helper (illustrative)

```ts
import { matchGeniContext } from '@/composables/matchGeniContext'

function canWrite(key: EventPermissionKey): boolean {
  const ctx = matchGeniContext.value
  if (!ctx) return false
  if (ctx.access.fullControl) return true
  return ctx.access.permissions.includes(key)
}

// Component usage:
const canManageOfficials = computed(() => canWrite('manage_officials'))
const canEditEvent      = computed(() => canWrite('edit_event'))
```

Buttons / menu items bind to those computeds via `:disabled` or `v-if`. The same helpers are used by `MatchGeniDashboardView`, `EventOfficialsView`, and every future MatchGeni sub-page.

### Scoring-scope gate (special case)

`manage_scoring` carries an additional scope restriction via `access.scoringScope`. When the caller attempts to enter a score for a game, the UI compares the game's `parkId` / `divisionId` against the scope:

```ts
function canScoreGame(game: { parkId: string; divisionId: string }): boolean {
  const ctx = matchGeniContext.value
  if (!ctx) return false
  if (ctx.access.fullControl) return true
  if (!ctx.access.permissions.includes('manage_scoring')) return false
  const scope = ctx.access.scoringScope
  if (!scope || scope.mode === 'all') return true
  if (scope.mode === 'parks')     return scope.parkIds.includes(game.parkId)
  if (scope.mode === 'divisions') return scope.divisionIds.includes(game.divisionId)
  return false
}
```

The backend re-applies the same check on score-write attempts; this client gate is for affordance only.

---

## 3. Cross-cutting field rules

| Rule | Notes |
|---|---|
| Wire format is camelCase. | DB columns translated by the serializer. |
| Numeric IDs serialize as strings. | Per conventions. |
| `permissions[]` never contains the literal `"*"` on the wire. | Server translates the Full Control sentinel per [conventions](./conventions.md#permission-key-encoding-permissions_json). |
| `{eventId}` accepts numeric id OR guid. | Detected by format. Other event endpoints stay numeric-only. |
| MatchGeni is association-owned only. | `409` when parent event has `owner_type ≠ 1`. |
| Soft-deleted `event_officials` rows are invisible to this endpoint. | A caller with only soft-deleted grants is treated as having no per-event grant. |
| Cancelled / completed events still resolve. | `eventStatus: 'cancelled'` or `'completed'` doesn't block read access — the caller can still enter MatchGeni in read-only / archival mode. (Compare to `matchgeni-officials-api-contract.md` §3/§4, which DO block new grants on a closed event.) |

---

## 4. Frontend integration points

| File | Role |
|---|---|
| `src/api/matchGeniAccess.ts` | Wired client for §1. Exposes `fetchMatchGeniAccess(associationId, eventIdOrGuid)`. |
| `src/composables/matchGeniContext.ts` | Module-level reactive store for the resolved payload + permission-check helpers (`canWrite`, `canScoreGame`). Shared across every MatchGeni view + sub-page. |
| `src/views/MatchGeniDashboardView.vue` | Composition root for MatchGeni. Fetches §1 alongside the dashboard payload on mount; redirects on `403`. |
| `src/views/EventOfficialsView.vue` | MatchGeni Officials sub-page. Reads the same context for write affordances (Add / Invite / Edit / Revoke). |
| `src/types.ts` | `MatchGeniAccessPayload`, `MatchGeniEvent` (carries nested `defaults: EventDefaults`), `MatchGeniAccess` types match this contract. |

---

## 5. Endpoint summary

| # | Method | URL | Purpose |
|---|---|---|---|
| 1 | GET | `/v2/association/events/{associationId}/{eventId}/my-permissions` | Resolve caller's matchgeni entry gate + per-action permissions for one event. `{eventId}` accepts numeric id or guid. |

---

## 6. Out of scope (deferred)

- **Bulk "my permissions across N events"** — when a multi-event MatchGeni surface lands (e.g. an admin's "events I can manage" page) it'll need its own list endpoint. v1 is per-event only.
- **Live permission revalidation** — the frontend currently fetches on view mount + on browser-tab refocus. A websocket / SSE feed that pushes "your access just changed" notifications is a future enhancement.
- **Read-gate per surface** — every surface is currently visible to anyone who entered. If we ever need to hide a specific sub-page from users without that key, it lands in that sub-page's contract; this one stays "view = everyone, write = key holder".
- **Audit log of MatchGeni entries** — capturing who landed in MatchGeni for which event and when. Pairs naturally with the broader grant-audit work deferred from `matchgeni-officials-api-contract.md` §11.
