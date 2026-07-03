---
status: Draft
owner: shared
last_updated: 2026-05-19
---

# MatchGeni Officials — REST API contract

## Context

Owns the **per-event officials** surface — every `event_officials` row that grants a single user access to a single association-owned event. Read and write endpoints share this contract because both sides of the URL tree live under the same `/v2/association/events/{associationId}/{eventId}/officials/...` prefix and are tightly coupled (the writes return rows in the same shape the list returns; both UI surfaces — MatchGeni and the association-users portal — consume both halves).

Powers:

- **Per-event Officials list** on `EventOfficialsView` (MatchGeni's officials sub-page) and the Officials tab inside the event details modal.
- **`EventOfficialAccessModal`** opened from MatchGeni and from the association-users page (`UserEventsModal`) — covers both flows (add existing user + invite brand-new user) and edit / revoke.

All endpoints are rooted under `/v2/association/events/{associationId}/{eventId}/officials/...`. For shared rules — response envelope, pagination shape, auth header, error codes, and the [`permissions_json` encoding](./conventions.md#permission-key-encoding-permissions_json) — see [`conventions.md`](./conventions.md).

Paired with:

- [`association-events-api-contract.md`](./association-events-api-contract.md) — the parent `team_events` row plus the event-resources endpoint (§9 there) the modal uses to populate the scoring-scope picker.
- [`association-users-api-contract.md`](./association-users-api-contract.md) — the `association_users` rows that grants attach to. The invite flow (§4 here) silently creates one of these with empty association-level permissions on the user's behalf.

**Wire format is camelCase**, matching the rest of the v2 API. DB column names (`permissions_json`, `scoring_scope_json`, `deleted_at`, etc.) appear only in SQL sketches and DB-mechanics descriptions. ID literals in the JSON examples below use prefixed stubs (`eo_…`, `au_…`, `u_…`, `inv_…`, `park_…`, `d_…`) for doc readability only — production serializes the bare `BIGINT UNSIGNED` PK as a numeric string. See [`conventions.md` § Doc-example IDs vs wire IDs](./conventions.md#doc-example-ids-vs-wire-ids) for the full mapping.

## Scope decisions (locked in)

- **Grants belong to association-owned events only.** Backend enforces parent `team_events.owner_type = 1` before any grant write. Team-owned events → `409`.
- **One active grant per (event, associationUser) pair.** Re-granting an existing pair via the Add endpoint (§3) → `409`. Updates go through §5.
- **`fullControl: true` short-circuits permission checks** for the event — the user holds every key in the event-permission catalogue. Wire format follows the standard `fullControl` + `permissions[]` split per conventions.
- **`scoringScope` is optional.** When `null`, the official is permitted on every park + division. When populated, restricts scoring permissions to listed parks/divisions only.
- **Invite-as-official creates a zero-permission association membership.** The new `association_users` row carries `permissions_json = []` and `invite_status = 'pending'`. The grantee is an event-only collaborator until an association admin elevates them later via [`association-users-api-contract.md` §3](./association-users-api-contract.md).
- **Soft delete.** Revoking sets `deleted_at`. The same (event, associationUser) pair can be re-granted later — backend re-uses the soft-deleted row when possible.
- **Caller permission gate**: event-level `manage_officials` on the caller's `event_officials` row for this event, OR `fullControl = TRUE` on either their event-officials row OR their association membership, OR the broader association-level `manage_events`. Without any of these → `403`. The key lives in the event-permission catalogue ([`docs/system/shared-catalogues.md` §2](../system/shared-catalogues.md)); the association-side `manage_events` falls back because association admins implicitly manage officials on every event they own.

## Underlying tables

| Table | Purpose |
|---|---|
| `event_officials` | The grant row. See [`sql-schema-event.md`](../system/sql-schema-event.md#event_officials). |
| `team_events` | Parent event. Validated for `owner_type = 1` and `association_id = :associationId`. |
| `association_users` | The grantee membership. Must be `status = 'active'` for §3 (read endpoints exclude pending / inactive too). Created with empty `permissions_json` by §4's invite flow. |
| `invites` | Polymorphic invites row used by §4 to dispatch the email. See [`association-users-api-contract.md`](./association-users-api-contract.md) "Storage decisions" for the schema notes. |
| `users` | Joined for display (`name`, `email`, `avatarUrl`) on responses. Looked up by email in §4 to pre-resolve `user_id` when the invitee already has a global identity. |
| `parks`, `divisions` | Read-only here — referenced by `scoring_scope_json` and validated on writes. The dropdown catalogue is fetched separately via [`association-events-api-contract.md` §9](./association-events-api-contract.md). |

> The event-permission catalogue (allowed `permissions[]` keys) lives in the Laravel application config — not the database. See §8 below for the canonical key list reference.

---

## 1. List Event Officials

- **Endpoint**: `GET /v2/association/events/{associationId}/{eventId}/officials`
- **Purpose**: Renders the "Officials" tab on the event details modal AND `EventOfficialsView` (MatchGeni's officials sub-page). Returns the granted users with their permission summary and quick-edit affordance.
- **Table sources**: `event_officials` filtered to `event_id = :eventId AND deleted_at IS NULL`, INNER JOIN `association_users` (for membership status), INNER JOIN `users` (for display).

### Query parameters

In addition to the standard `page` / `per_page` pagination params:

| Name | Type | Default | Notes |
|---|---|---|---|
| `search` | string | `""` | Case-insensitive partial match on `users.name` OR `users.email`. |
| `permission` | string | `""` | When set, returns only grants whose `permissions` contains this key OR has `fullControl = true`. |
| `sort` | `'name' \| 'createdAt'` | `'name'` | |
| `order` | `'asc' \| 'desc'` | `'asc'` | |

### Request body

None (GET).

### Response (paginated)

`data` is the standard Laravel paginator. Each row in `data.data[]`:

```json
{
  "id": "eo_88",
  "eventId": "5042",
  "associationUserId": "au_412",
  "userId": "u_123",

  "name": "Jane Doe",
  "email": "jane@example.com",
  "avatarUrl": "https://cdn/.../jane.png",

  "fullControl": false,
  "permissions": ["record_scores", "lock_inning"],

  "scoringScope": {
    "parkIds": ["p_1", "p_3"],
    "divisionIds": ["d_4"]
  },

  "createdAt": "2026-04-12T18:00:00Z",
  "updatedAt": "2026-04-13T09:32:00Z",
  "createdByUserId": "u_42"
}
```

### Field notes

- `fullControl` + `permissions` are the wire encoding of `event_officials.permissions_json` per [the conventions encoding](./conventions.md#permission-key-encoding-permissions_json). When `fullControl: true`, `permissions` is `[]` — the UI ignores it.
- `scoringScope` is the parsed form of `event_officials.scoring_scope_json`. `null` on the wire (not an empty object) when the DB column is `NULL` — meaning "no scoping; all parks/divisions allowed".
- `userId` is always non-null because grants are only issued to `status = 'active'` association users. For pending invites surfaced via §4's response, `userId` may be `null` until the invitee accepts.
- `avatarUrl` is a Cloudflare-transformed URL (default preset: `avatar_md`). See [`conventions.md` § Image URLs](./conventions.md#image-urls) and [`shared-catalogues.md` §7 — Image-transform presets](../system/shared-catalogues.md). Frontend treats it as opaque.
- `404` if `associationId` or `eventId` doesn't exist, is soft-deleted, or belongs to a different association.
- `409` if the parent event is team-owned (`owner_type ≠ 1`).

### SQL sketch

```sql
SELECT
  eo.id, eo.event_id, eo.association_user_id, au.user_id,
  u.name, u.email, u.avatar_url AS avatar_url,
  eo.permissions_json, eo.scoring_scope_json,
  eo.created_at, eo.updated_at, eo.created_by
FROM event_officials eo
INNER JOIN association_users au ON au.id = eo.association_user_id AND au.status = 'active'
INNER JOIN users u ON u.id = au.user_id
WHERE eo.event_id = :eventId AND eo.deleted_at IS NULL
  AND (:search = '' OR u.name LIKE CONCAT('%', :search, '%') OR u.email LIKE CONCAT('%', :search, '%'))
  AND (
    :permission = ''
    OR JSON_CONTAINS(eo.permissions_json, JSON_QUOTE(:permission))
    OR JSON_CONTAINS(eo.permissions_json, '"*"')
  )
ORDER BY {sort column} {order}
LIMIT :per_page OFFSET :offset;
```

---

## 2. Get One Grant

- **Endpoint**: `GET /v2/association/events/{associationId}/{eventId}/officials/{officialId}`
- **Purpose**: Hydrate the per-user edit drawer in `EventOfficialAccessModal`.
- **Table sources**: Same row as §1, single record by `event_officials.id`.

### Response

`data` is the full grant row (same shape as a §1 row).

### Field notes

- `404` if the grant doesn't exist, is soft-deleted, or its event doesn't belong to this association.

---

## 3. Add Existing User as Event Official

- **Endpoint**: `POST /v2/association/events/{associationId}/{eventId}/officials`
- **Purpose**: Grant an existing **active** association user access to this event from the MatchGeni "Add Official" flow.
- **Table sources**: INSERT into `event_officials`. Backend may re-use a soft-deleted row for the same (event, associationUser) pair — clears `deleted_at` and overwrites `permissions_json` + `scoring_scope_json`.

### Request body

```json
{
  "associationUserId": "au_412",
  "fullControl": false,
  "permissions": ["manage_scoring", "manage_scheduling"],
  "scoringScope": {
    "mode": "parks",
    "parkIds": ["park_1", "park_2"],
    "divisionIds": []
  }
}
```

### Response

`data` is the new grant row (same shape as the §1 row). `responseStatus.statusCode: 201` with `text: "Created"`.

### Field notes

- Server packs the body into `permissions_json` per the [encoding rules](./conventions.md#permission-key-encoding-permissions_json): `fullControl: true` → store `["*"]`; otherwise store the `permissions` array verbatim.
- Every entry of `permissions` must exist in the event-permission catalogue. The literal `"*"` is reserved — reject with `422` if present in the request body's `permissions`.
- `scoringScope` write rules:
  - `permissions` does not include `manage_scoring` **and** `fullControl = false` → server forces `scoring_scope_json = NULL`.
  - `fullControl = true` OR `mode === 'all'` → server forces `scoring_scope_json = NULL`.
  - `manage_scoring` granted, `mode === 'parks'` or `'divisions'` → store the full `scoringScope` object verbatim.
- `422` when `scoringScope.mode === 'parks'` and `parkIds` is empty (or same for `divisions`).
- `422` when `parkIds` references a `parks.id` whose `event_id ≠ {eventId}` (or same for divisions).
- `422` when `associationUserId` doesn't reference an `active` membership in this association.
- `409` if a non-deleted grant already exists for this (event, associationUser) pair, or if the parent event is team-owned.
- `404` if the event doesn't exist or belongs to a different association.

---

## 4. Invite New User as Event Official

- **Endpoint**: `POST /v2/association/events/{associationId}/{eventId}/officials/invite`
- **Purpose**: Bring a new collaborator onto an event when they're not yet in the association's user list. The flow creates the invite + a zero-permission association membership + the event-officials grant in a single transaction, then dispatches the invite email.
- **Table sources**: All writes happen in one transaction.
  - `users` — read-only lookup by email to pre-resolve `user_id` if the invitee already has a global account. **No stub `users` row is created** at invite-send.
  - `invites` — INSERT row with `invite_type = 'association_user'`, `target_type = 'email'`, `target_value = <email>`, `first_name` / `last_name` (split from `name` when provided), `user_id` (NULL if no match), `association_id`, `inviter_user_id`, `metadata_json = { eventId, permissions, fullControl, scoringScope }`, `status = 'pending'`, `token`, `sent_at = NOW()`, `expires_at`.
  - `association_users` — INSERT row with `user_id` matching `invites.user_id` (nullable), `status = 'pending'`, **`permissions_json = []`** (zero association-level permissions — the invite is event-scoped), `invite_id` linking to the new invite, `invite_status = 'pending'`, `invited_at = NOW()`, `invited_by_user_id`.
  - `event_officials` — INSERT row referencing the new `association_users.id` with the event-level `permissions_json` + optional `scoring_scope_json`. The grant is live the instant the invite is sent; the invitee gets access the moment they accept the invite (no extra step needed).

### Request body

```json
{
  "email": "newcoach@example.com",
  "name": "Pat Newcoach",
  "fullControl": false,
  "permissions": ["manage_scoring"],
  "scoringScope": {
    "mode": "parks",
    "parkIds": ["park_1"],
    "divisionIds": []
  }
}
```

### Response

`data` mirrors the §1 row shape, with the invite metadata surfaced so the UI can render "Pending invite" state without a second fetch:

```json
{
  "id": "eo_88",
  "eventId": "5042",
  "associationUserId": "au_999",
  "userId": null,

  "name": "Pat Newcoach",
  "email": "newcoach@example.com",
  "avatarUrl": null,

  "fullControl": false,
  "permissions": ["manage_scoring"],

  "scoringScope": {
    "mode": "parks",
    "parkIds": ["park_1"],
    "divisionIds": []
  },

  "invite": {
    "inviteId": "inv_5501",
    "inviteStatus": "pending",
    "invitedAt": "2026-05-13T15:00:00Z",
    "invitedByUserId": "u_42"
  },

  "createdAt": "2026-05-13T15:00:00Z",
  "updatedAt": "2026-05-13T15:00:00Z",
  "createdByUserId": "u_42"
}
```

`responseStatus.statusCode: 201` with `text: "Invitation sent"`.

### Field notes

- `email` is required and case-insensitive-unique within `(association_id, email)`. `409` if an active or pending association membership already exists for this email — the caller should switch to §3 against the existing `associationUserId` instead.
- `name` is optional. When provided, the server splits on the first whitespace into `first_name` / `last_name` on the `invites` row. When omitted, `first_name = invites.target_value` and `last_name = NULL`.
- `userId` on the response is `null` because the invitee has no `users` row yet; `name` / `email` / `avatarUrl` fall back to the `invites` row per the same rules used in [`association-users-api-contract.md` §1](./association-users-api-contract.md) "Display-field fallback".
- The new `association_users` row carries `permissions_json = []` — the invitee is an event-only collaborator. An association admin can elevate them later via [`association-users-api-contract.md` §3](./association-users-api-contract.md).
- Event-level permission validation is identical to §3 (catalogue check, `"*"` reserved, scoring-scope rules).
- `422` when `permissions` is empty AND `fullControl = false` — an invite with zero event-level permissions is rejected (it would let the invitee onto the event with no actual rights). Use §3 against an existing user if you really want a no-permission shell.
- `422` on invalid email shape.
- `409` if the parent event is team-owned, or already cancelled / completed (no new officials onto a closed event).
- `404` if the event doesn't exist or belongs to a different association.
- Server should rate-limit by IP + by `(association_id, email)` (e.g. 5 invites per email per hour) to prevent inbox flooding.

### Acceptance flow (informational)

The acceptance handler (out-of-scope for this contract — lives in the signup / accept-invite contract) does the following when the invitee clicks the email link:

1. Create or reuse a `users` row from the signup details.
2. UPDATE `invites.user_id` + `invites.status = 'accepted'`.
3. UPDATE `association_users.user_id` (now non-null) + `status = 'active'` + `joined_at = NOW()` + `invite_status = 'accepted'`.

The `event_officials` row needs no edit on accept — it referenced `association_users.id` from the start, and that ID is stable across the pending → active transition.

---

## 5. Update Event-Official Grant

- **Endpoint**: `PUT /v2/association/events/{associationId}/{eventId}/officials/{officialId}`
- **Purpose**: Replace the entire grant for one `event_officials` row — Full Control flag, permission set, and scoring scope. Full-replace semantics (no PATCH in v1).
- **Table sources**: `event_officials` (UPDATE `permissions_json` + `scoring_scope_json`).
- **Consumers**: MatchGeni Officials list (admin clicks ⋯ → Edit access on a row), AND the Association Portal → Users page → "Events" modal (`UserEventsModal`) → Edit access button. Both surfaces have the `officialId` on the row they're editing — see [`association-users-api-contract.md` §7](./association-users-api-contract.md) which surfaces `officialId` on each row of a user's events list specifically so this endpoint can be called from the user-portal surface too.

### Request body

```json
{
  "fullControl": false,
  "permissions": ["manage_scoring", "manage_scheduling"],
  "scoringScope": {
    "mode": "parks",
    "parkIds": ["park_1", "park_2"],
    "divisionIds": []
  }
}
```

### Response

`data` is the full updated `EventOfficial` row (same shape as §1).

### Field notes

- Server packs the body into `permissions_json`:
  - `fullControl: true` → store `["*"]`. `permissions` and `scoringScope` from the body are ignored — Full Control implicitly grants every permission across every park / division.
  - `fullControl: false` → store `permissions` verbatim.
- `scoring_scope_json` write rules:
  - `permissions` does not include `manage_scoring` → set `scoring_scope_json = NULL`.
  - `manage_scoring` granted, `mode === 'all'` → set `scoring_scope_json = NULL` (default; no row needed).
  - `manage_scoring` granted, `mode === 'parks'` or `'divisions'` → store the full `scoringScope` object verbatim.
- `associationUserId` cannot be changed via PUT — to move a grant to a different user, revoke (§6) + re-add (§3).
- `422` when `scoringScope.mode === 'parks'` and `parkIds` is empty (or same for `divisions`).
- `422` when `parkIds` references a `parks.id` whose `event_id` ≠ `{eventId}` (or same for divisions).
- `404` if the grant doesn't exist, is soft-deleted, or its event isn't owned by `{associationId}`.
- The literal `"*"` is reserved — reject with `422` if present in the request body's `permissions` array.

---

## 6. Revoke Event-Official Grant

- **Endpoint**: `DELETE /v2/association/events/{associationId}/{eventId}/officials/{officialId}`
- **Purpose**: Remove a user's access to one event without affecting their other event grants or association membership. Soft-delete; the same (event, associationUser) pair can be re-granted later via §3.
- **Table sources**: `event_officials` (soft-delete: `deleted_at = NOW()`, `deleted_by = <caller>`).
- **Consumers**: same dual UI surface as §5 — MatchGeni Officials list (⋯ → Revoke access) AND the Association Portal → Users → Events modal (Remove access button).

### Request body

None (or optional `{ "reason": "..." }` for a future audit table — currently ignored).

### Response

```json
{
  "newEventOfficialCount": 2,
  "associationUserId": "au_412"
}
```

### Field notes

- `newEventOfficialCount` is the user's remaining `event_officials` count across the association. Returning it lets the `UserEventsModal` and the association users list ([`association-users-api-contract.md` §1](./association-users-api-contract.md) `eventOfficialCount`) update without a second fetch. `associationUserId` is returned so the user-portal caller can correlate the response back to its source row.
- Idempotent: revoking an already-revoked grant returns `200` with the current count for the same user.
- `404` if the grant doesn't exist or its event isn't owned by `{associationId}`.

---

## 7. Cross-cutting field rules

| Rule | Notes |
|---|---|
| Wire format is camelCase. | DB columns translated by the serializer. |
| Caller permission gate: event-level `manage_officials` on the caller's `event_officials` row, OR `fullControl = TRUE`, OR association-level `manage_events`. | Middleware on every endpoint — see "Scope decisions" for the full ladder. |
| Soft-deleted grants are excluded from every read endpoint. | `WHERE event_officials.deleted_at IS NULL`. |
| `permissions[]` never contains the literal `"*"` on the wire. | Server translates the Full Control sentinel per conventions. |
| Numeric IDs serialize as strings. | Per conventions. |
| Grants are only valid against association-owned events. | `409` when parent has `owner_type ≠ 1`. |
| Cannot add (§3) a grant to pending / inactive association users. | `422`. (§4 explicitly creates the pending membership for the invitee.) |
| Single-event close-out blocks new grants. | `409` from §3 / §4 when the parent event is `cancelled` or `completed`. |

---

## 8. Event-permission catalogue (informational)

The set of allowed `permissions` keys for `event_officials` is the canonical event-permission catalogue documented in [`docs/system/shared-catalogues.md` §2](../system/shared-catalogues.md). Maintained server-side in the Laravel config; mirrored on the frontend in `src/constants/eventPermissions.ts`. The UI fetches it via a separate read-only endpoint not covered in this contract.

Of particular note: **`manage_officials`** is the key that gates every write endpoint (§3, §4, §5, §6) — adding, inviting, updating, and revoking officials all require it on the caller's grant (or one of the fallbacks listed in "Scope decisions" / §7).

The literal `"*"` is reserved as the Full Control sentinel and must never appear in the catalogue or in any request body's `permissions` array.

---

## 9. Frontend integration points

| File | Role |
|---|---|
| `src/api/eventOfficials.ts` | Wired client for every endpoint in this contract — list, get-one, add, invite, update, revoke. |
| `src/api/officialEvents.ts` | Wired client for the user-portal `UserEventsModal` reads (`/users/{userId}/events` — see [`association-users-api-contract.md` §7](./association-users-api-contract.md)); its update / revoke calls route through `eventOfficials.ts` against §5 / §6 since both surfaces share the same backend. |
| `src/components/EventOfficialAccessModal.vue` | Opened from both the MatchGeni Officials list AND the user-portal `UserEventsModal`. Covers add / invite (with internal user-search step in invite mode) and the edit drawer. Receives `officialId` on edit/revoke from either calling surface. |
| `src/components/UserEventsModal.vue` | Per-user list of granted events. Each row carries `officialId`; the edit / remove buttons call §5 / §6 directly. |
| `src/views/EventOfficialsView.vue` | MatchGeni's officials sub-page; lists officials via §1 and routes edit / remove actions to §5 / §6. |
| `src/views/MatchGeniDashboardView.vue` | Composition root — exposes the officials shortcut from the dashboard tile. |
| `src/views/AssociationUsersView.vue` | Hosts `UserEventsModal`, which reads via [`association-users-api-contract.md` §7](./association-users-api-contract.md) and routes per-row writes back to this contract's §5 / §6. |
| `src/types.ts` | `EventOfficial`, `EventOfficialListParams`, `SaveEventOfficialPayload`, `InviteEventOfficialPayload`, `EventPermissionKey` types match this contract. |

---

## 10. Endpoint summary

| # | Method | URL | Purpose |
|---|---|---|---|
| 1 | GET | `/v2/association/events/{associationId}/{eventId}/officials` | List event officials (paginated). |
| 2 | GET | `/v2/association/events/{associationId}/{eventId}/officials/{officialId}` | Get one grant. |
| 3 | POST | `/v2/association/events/{associationId}/{eventId}/officials` | Add an existing association user as event official. |
| 4 | POST | `/v2/association/events/{associationId}/{eventId}/officials/invite` | Invite a brand-new user directly as an event official (creates invite + zero-perm association membership + grant). |
| 5 | PUT | `/v2/association/events/{associationId}/{eventId}/officials/{officialId}` | Replace per-event grant. |
| 6 | DELETE | `/v2/association/events/{associationId}/{eventId}/officials/{officialId}` | Revoke per-event grant. |

All six routes share the same event-scoped base path. Both UI surfaces that mutate grants (MatchGeni Officials list + Association Portal Users → Events modal) call this contract's endpoints — the user-portal surface receives `officialId` from [`association-users-api-contract.md` §7](./association-users-api-contract.md) so it has everything needed to call §5 / §6 directly.

---

## 11. Out of scope (deferred)

- **Bulk grant** ("grant 8 officials to this event in one POST"). Lands when the UI grows multi-select.
- **Grant audit log** — captures grant / revoke / permission-change events with reasons.
- **Resend invite from MatchGeni** — for now the invitee's resend / cancel flow lives in the association-users page; MatchGeni surfaces "Pending invite" badge but defers actions to that page.

### Adjacent MatchGeni surfaces (not officials, listed here for traceability)

These are not part of this officials contract; they each get their own contract when wired. Captured here so the historical "future MatchGeni endpoints" inventory survives in one place after the doc merge:

- **MatchGeni dashboard composite endpoint** (`GET /v2/matchgeni/{associationId}/{eventId}/dashboard`) — composite read for the MatchGeni landing tile.
- **Divisions / parks / schedule / brackets management** endpoints — each becomes its own `matchgeni-<surface>-api-contract.md`.
