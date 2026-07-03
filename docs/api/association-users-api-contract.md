---
status: Approved
owner: shared
last_updated: 2026-05-08
---

# Association Users — REST API contract

## Context

Powers the Association Users page (`src/views/AssociationUsersView.vue`) and its modals (`AssociationUserModal`, `UserEventsModal`, `EventOfficialAccessModal`). When wired, replaces the mock layer in `src/api/associationUsers.ts` and the user/event grant calls in `src/api/officialEvents.ts`.

All endpoints are rooted under `/v2/association/users/{associationId}/...`. For shared rules — response envelope, pagination shape, auth header, error codes, and the `permissions_json` encoding — see [`conventions.md`](./conventions.md).

ID literals in the JSON examples below use prefixed stubs (`u_…`, `au_…`, `inv_…`, `eo_…`, etc.) for doc readability only — production serializes the bare `BIGINT UNSIGNED` PK as a numeric string. See [`conventions.md` § Doc-example IDs vs wire IDs](./conventions.md#doc-example-ids-vs-wire-ids) for the full mapping.

## Storage decisions (locked in)

Changes to the existing `association_users` table to support this contract; the encoding rules they reference live in [`conventions.md#permission-key-encoding-permissions_json`](./conventions.md#permission-key-encoding-permissions_json).

- The existing `association_users` table is reused. The `role_id` column is **dropped**. Permissions (and Full Control) are stored on a single `permissions_json` JSON column on the same row.
- `association_users.user_id` is **NULLABLE**. The invitee may not yet have a `users` row at invite-send time — the user record is created only when they accept. The membership row exists from the moment the invite is sent (so the user list is single-table), with `user_id` filled in on accept.
- The central polymorphic `invites` table (already used for team invites) is reused for association invites. Three fields are denormalized onto `association_users` so the hottest read path (the users list) stays single-table:
  - `invite_id` — FK to `invites.id`. Live while the invite row exists; SET NULL once the cleanup cron purges the invite (post-acceptance retention window).
  - `invite_status` — cached mirror of `invites.status` (`'pending' | 'accepted' | 'expired' | null`). Updated in the same transaction as any change to the `invites` row. Note: `cancelled` is a valid `invites.status` value but never appears here, because cancelling a pending invite hard-deletes (or soft-deletes) the `association_users` row entirely.
  - `invited_by_user_id` — durable FK to `users.id` of the inviting admin. Survives `invites` cleanup, so "who invited Jane?" stays answerable indefinitely even years after the invite row is purged.

  No invite tokens or timestamps live on `association_users` — those stay in `invites`.

## Underlying tables

Only the tables this contract reads / writes. Cross-area tables (e.g. `events`, `parks`, `divisions`) are referenced where they participate in JOINs.

| Table | Purpose / Key columns |
|---|---|
| `users` | Global user identity: `id`, `name`, `email`, `avatar_url`. |
| `association_users` | Membership row. Columns include `id`, `association_id`, **`user_id` (NULLABLE — populated on accept)**, `status`, **`permissions_json`** (replaces `role_id`), `invited_at`, `joined_at`, **`invite_id`** (FK to `invites.id`), **`invite_status`** (cached mirror of `invites.status`), **`invited_by_user_id`** (durable inviter FK). |
| `invites` | Polymorphic invites table. Holds full invite metadata: `id`, `token`, `invite_type` (`'association_user' \| 'team_member' \| 'platform_signup'`), `target_type` (`'email' \| 'phone'`), `target_value`, `first_name`, `last_name`, `user_id` (pre-resolved if invitee is already a user), `association_id` (top-level FK), `team_id` (top-level FK for team-member invites), `inviter_user_id`, `metadata_json`, `status` (`'pending' \| 'accepted' \| 'cancelled' \| 'expired'`), `sent_at`, `expires_at`. |
| `event_officials` | Per-event grant row: `id`, `event_id`, `user_id`, **`permissions_json`**, **`scoring_scope_json`**. |
| `events` | Read-only here — joined to look up event metadata (name, dates, …) for §7. |
| `parks` | Event-scoped park catalogue: `id`, `event_id`, `name`. Read for §7; validated on grant writes (now in [`matchgeni-officials-api-contract.md` §3](./matchgeni-officials-api-contract.md)). |
| `divisions` | Event-scoped division catalogue: `id`, `event_id`, `name`. Same role as `parks`. |

> The association- and event-scoped permission catalogues (§8) are NOT database tables. They live as static JSON in the Laravel application config — single source of truth that ships with the backend release, not the database schema.

---

## 1. List Association Users

- **EndPoint**: `GET /v2/association/users/{associationId}`
- **Purpose**: Drives the main user list with server-side search, status filter, sorting, and continuous-scroll paging.
- **Table Sources**: `association_users` (the canonical row for every user — pending, active, inactive), LEFT JOIN `users` on `association_users.user_id` (populated for accepted users only), LEFT JOIN `invites` on `association_users.invite_id` (populated for pending users + accepted users still inside the post-accept retention window), `event_officials` (for the per-user `eventOfficialCount` aggregation). Both LEFT JOINs are PK lookups — fast even at 100k+ rows. The cached `invite_status` on `association_users` removes the need to JOIN `invites` for the status filter itself; the JOIN to `invites` only fires when surfacing pending users' display fields (see "Display-field fallback" below).

### Query parameters

In addition to the standard `page` / `per_page` pagination params from [`conventions.md#pagination-envelope-laravel-paginator`](./conventions.md#pagination-envelope-laravel-paginator):

| Name | Type | Default | Notes |
|---|---|---|---|
| `search` | string | `""` | Case-insensitive partial match on `users.name` OR `users.email`. |
| `status` | `'all' \| 'active' \| 'inactive' \| 'pending'` | `all` | Filters `association_users.status`. |
| `sort` | `'name' \| 'joined' \| 'invited'` | `name` | |
| `order` | `'asc' \| 'desc'` | `asc` | |

### Request body

None (GET).

### Response (paginated)

`data` is the standard Laravel paginator (see [conventions](./conventions.md#pagination-envelope-laravel-paginator)). Each row in `data.data[]`:

```json
{
  "id": "u_123",
  "name": "Jane Doe",
  "email": "jane@example.com",
  // public image URL — no AWS signature
  "avatarUrl": "https://cdn/.../jane.png",
  "status": "active",
  "fullControl": false,
  "permissions": ["manage_events", "manage_teams"],
  "invitedAt": "2026-04-12T18:00:00Z",
  "joinedAt": "2026-04-13T09:32:00Z",
  "inviteId": "inv_4421",
  "inviteStatus": "accepted",
  "invitedByUserId": "u_42",
  "eventOfficialCount": 3
}
```

### Field notes

- `id` is the `association_users.id`, **not** the underlying `users.id`. Stays stable from invite-send through the entire membership lifecycle even if `user_id` is NULL while pending.
- `eventOfficialCount` is `COUNT(*) FROM event_officials WHERE user_id = ?` — surfaced so the row chip ("3 events") renders without a second roundtrip. Always 0 for pending users (their `user_id` is NULL).
- `permissions` + `fullControl` derive from `association_users.permissions_json` per the [permission-key encoding](./conventions.md#permission-key-encoding-permissions_json). **Set at invite-send time** from the admin's role-preset choice; preserved on accept.
- `invitedAt` populates for users created via invite (every row, since every membership starts as an invite). `joinedAt` is set only after the invite is accepted; NULL while pending.
- `inviteStatus` is the cached mirror of `invites.status` stored on `association_users.invite_status`. Possible values: `'pending'`, `'accepted'`, `'expired'`, or `null` (post-cleanup or never-had-an-invite-row scenarios). Drives whether the UI surfaces "Resend invite" vs "Cancel invite" actions.
- `inviteId` is the FK to the live `invites` row. Opaque from the UI's perspective — it's passed back to resend / cancel calls. NULL after the post-acceptance retention window when the cleanup cron purges the invite.
- `invitedByUserId` is the **durable** inviter reference. Set at invite-send time and never modified, so support / admin queries can answer "who invited Jane?" indefinitely (even after the invite row is purged).
- `avatarUrl` is a **fully-resolved Cloudflare-transformed URL** (default preset: `avatar_md` — 64×64 / fit cover / quality 85 / format auto). Backend wraps every avatar source via the shared `transformImageUrl()` helper before serialization. See [`conventions.md` § Image URLs](./conventions.md#image-urls) and [`shared-catalogues.md` §7 — Image-transform presets](../system/shared-catalogues.md) for the preset catalogue, helper signature, and URL shape. Frontend treats the URL as opaque (no parsing, no re-prefixing). Source images live behind public-read ACLs (or via CloudFront with public access) so the URL stays valid indefinitely without re-signing; if the source is deleted, the URL 404s and the API does not reissue.

#### Display-field fallback (pending users)

For users where `association_users.user_id IS NULL` (invitee hasn't signed up yet), `name` / `email` / `avatarUrl` come from the linked `invites` row instead of `users`:

| Wire field | Accepted users | Pending users (no `users` row yet) |
|---|---|---|
| `name` | `users.name` | `CONCAT(invites.first_name, ' ', invites.last_name)` |
| `email` | `users.email` | `invites.target_value` (when `target_type='email'`) |
| `avatarUrl` | `users.avatar_url` | `null` (no avatar exists yet) |

The server uses `COALESCE` in the SQL projection to pick the right source per row in a single query (see `sql-schema-association.md#association_users` for the canonical query shape).

---

## 2. Invite a New User

- **EndPoint**: `POST /v2/association/users/{associationId}/invite`
- **Purpose**: Create a new association membership in `pending` status and dispatch the invite email.
- **Table Sources**: `users` (read-only — looked up by email/phone to pre-resolve `user_id` if the invitee already has a user account; **NOT** inserted at this point), `invites` (insert: `invite_type='association_user'`, `target_type` + `target_value`, `first_name` + `last_name`, `user_id` (NULL if no match), `association_id`, `inviter_user_id`, `metadata_json={permissions, full_control}`, `status='pending'`, `token`, `sent_at`, `expires_at`), `association_users` (insert: `user_id` matches `invites.user_id` (nullable), `status=0`, `permissions_json`, `invite_id` linking to the new invite, `invite_status='pending'`, `invited_at=NOW()`, `invited_by_user_id`). All writes happen in one transaction.

  **No stub user is created at invite-send.** If the recipient's email/phone doesn't match an existing `users` row, `user_id` stays NULL on both `invites` and `association_users` until the invitee accepts and signs up — at which point a `users` row is INSERTed and `association_users.user_id` is updated.

### Request body

```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "fullControl": false,
  "permissions": ["manage_events", "manage_teams"]
}
```

### Response

`data` is the full new user record (same shape as a row in §1):

```json
{
  "id": "u_124",
  "name": "Jane Doe",
  "email": "jane@example.com",
  // public image URL — no AWS signature
  "avatarUrl": null,
  "status": "pending",
  "fullControl": false,
  "permissions": ["manage_events", "manage_teams"],
  "invitedAt": "2026-05-09T15:21:00Z",
  "joinedAt": null,
  "inviteId": "inv_4422",
  "inviteStatus": "pending",
  "invitedByUserId": "u_42",
  "eventOfficialCount": 0
}
```

`name` and `email` here come from the `invites` row's `first_name`/`last_name`/`target_value` fallbacks documented in §1's "Display-field fallback" table — the recipient hasn't signed up yet, so there's no `users` row to source them from.

`responseStatus.statusCode` is `201` with `text: "Created"`.

### Field notes

- Server packs the body into `permissions_json` per the [encoding rules](./conventions.md#permission-key-encoding-permissions_json): `fullControl: true` → store `["*"]`; otherwise store the `permissions` array verbatim.
- `409` if `(association_id, email)` already exists.
- Server validates every entry of `permissions` against the application-level association permission catalogue (Laravel JSON config — see §8). The literal `"*"` is reserved — reject with `422` if present in the request body.

---

## 3. Update an Existing User

- **EndPoint**: `PATCH /v2/association/users/{associationId}/{userId}`
- **Purpose**: Edit name, email, status, Full Control flag, and / or association-level permission set. Partial update — any field omitted is left unchanged.
- **Table Sources**: `users` (name / email), `association_users` (status, `permissions_json`).

### Request body

```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "status": "active",
  "fullControl": false,
  "permissions": ["manage_events", "manage_teams", "manage_users"]
}
```

### Response

`data` is the full updated `AssociationUser` (same row shape as §1).

### Field notes

- `404` if `userId` is not in this association; `409` on email collision (different user already holds the email).
- If either `fullControl` or `permissions` is present in the body, the server rewrites `permissions_json` from scratch:
  - `fullControl: true` → store `["*"]` (any `permissions` array in the body is ignored).
  - `fullControl: false` → store the `permissions` array as-is.
- Editing `email` does NOT re-issue an invite. To resend, call §5.

---

## 4. Remove a User from the Association

- **EndPoint**: `DELETE /v2/association/users/{associationId}/{userId}`
- **Purpose**: End the user's association membership. Cascade-removes their per-event grants for events owned by this association.
- **Table Sources**: `association_users` (soft-delete: set `deleted_at = NOW()`, `deleted_by = <admin>`), `event_officials` (cascade delete for rows where `events.association_id = {associationId}`). The `invites` table is NOT touched by this endpoint — by the time a member is being removed, their invite is either long-since accepted-and-purged (post-retention-window) or doesn't exist at all (manually-added member). If the member is somehow still pending (their invite hasn't been accepted yet), use §6 Cancel Invite instead.

### Request body

None.

### Response

`data` is omitted; `responseStatus.statusCode: 200` with a `message` such as `"User removed from association."`.

### Field notes

- Does NOT delete the row in `users`; the user keeps their global identity for use in other associations.
- Idempotent: deleting an already-removed user still returns `200` with the same envelope.

---

## 5. Resend Invitation

- **EndPoint**: `POST /v2/association/users/{associationId}/{userId}/invites/resend`
- **Purpose**: Re-fire the invite email for a `status === 'pending'` user. Does NOT change permissions.
- **Table Sources**: `association_users` (read `invite_id` + validate `status === 'pending'`), `invites` (UPDATE: bump `sent_at` to NOW(), refresh `expires_at`, optionally rotate `token`). `association_users.invite_status` already says `'pending'` so no write needed there on a resend.

### Request body

None (or `{}`).

### Response

```json
{ "sentAt": "2026-05-08T15:21:00Z" }
```

### Field notes

- `409` if `association_users.status !== 'pending'`.
- Server should rate-limit per user (e.g. one resend per 60 s) to prevent inbox flooding.

---

## 6. Cancel a Pending Invite

- **EndPoint**: `DELETE /v2/association/users/{associationId}/{userId}/invites`
- **Purpose**: Revoke a pending invite and remove the membership row.
- **Table Sources**: `invites` (UPDATE `status='cancelled'` on the row referenced by `association_users.invite_id`; the row stays for the 90-day retention window so support can answer "did Jane get invited last month?" before the cleanup cron purges it), `association_users` (DELETE the membership row, or soft-delete via `deleted_at` if the team prefers an audit trail). Both writes happen in one transaction.

### Request body

None.

### Response

`data` is omitted; `responseStatus.statusCode: 200` with a `message` such as `"Invitation cancelled."`.

### Field notes

- Only valid when `status === 'pending'`. `409` otherwise.
- Recommend hard-delete since the user never accepted; soft-archive (flip status to `inactive`) is acceptable if backend wants an audit trail — call out the choice in the implementation PR.

---

## 7. List Events a User is Official On

- **EndPoint**: `GET /v2/association/users/{associationId}/{userId}/events`
- **Purpose**: Drives the `UserEventsModal` — every event the user is rostered on, with their per-event grant fully expanded for display + edit.
- **Table Sources**: `event_officials`, `events`, `parks`, `divisions`.

### Query parameters

In addition to the standard `page` / `per_page` pagination params:

| Name | Type | Default | Notes |
|---|---|---|---|
| `search` | string | `""` | Match on `events.name`. |

### Request body

None.

### Response (paginated)

`data` is the standard Laravel paginator. Each row in `data.data[]`:

```json
{
  "id": "evt_77",
  "officialId": "eo_88",
  "imageUrl": "https://cdn/.../battle-of-roses.png",
  "name": "Battle of the Roses",
  "subtitle": "Senior Softball USA",
  "dateRange": "Apr 30 – May 3, 2026",
  "location": "York, PA",
  "director": "Tom Smith",
  "fullControl": false,
  "permissions": ["manage_scoring", "manage_scheduling"],
  "parks": [
    { "id": "park_1", "name": "Park A" },
    { "id": "park_2", "name": "Park B" }
  ],
  "divisions": [
    { "id": "div_1", "name": "Men's 50+ Major+" }
  ],
  "scoringScope": {
    "mode": "parks",
    "parkIds": ["park_1"],
    "divisionIds": []
  }
}
```

### Field notes

- `id` is the event id (`events.id`). `officialId` is the `event_officials.id` for THIS user's grant on that event.
- **`officialId`** is surfaced specifically so the `UserEventsModal` Edit / Remove access buttons can call the event-scoped write endpoints in [`matchgeni-officials-api-contract.md`](./matchgeni-officials-api-contract.md) (§5 `PUT .../events/{eventId}/officials/{officialId}` and §6 `DELETE .../events/{eventId}/officials/{officialId}`) directly, without a second lookup. The MatchGeni Officials list already has the same field on its rows; both surfaces share the same write endpoints.
- `parks` and `divisions` are the FULL event-scoped catalogues (not just the user's selected ones) — the modal needs them as picker options.
- `permissions` + `fullControl` derive from `event_officials.permissions_json` using the same [encoding](./conventions.md#permission-key-encoding-permissions_json) as the association side.
- `scoringScope` derives from `event_officials.scoring_scope_json`. When the JSON column is NULL OR `permissions` does not include `manage_scoring`, the server returns the default `{ "mode": "all", "parkIds": [], "divisionIds": [] }`.
- `dateRange` and `subtitle` are server-formatted display strings (already-localized to the event's TZ) so the UI doesn't have to format dates per row.
- `imageUrl` is a **Cloudflare-transformed URL** (default preset: `cover_card_wide` — 600×338 / 16:9 / quality 80 / format auto), suitable for the modal's row thumbnail. See [`conventions.md` § Image URLs](./conventions.md#image-urls) and [`shared-catalogues.md` §7](../system/shared-catalogues.md). Frontend treats it as opaque.

### SQL sketch (relevant projection)

```sql
SELECT
  e.id                AS event_id,         -- → "id" on the wire
  eo.id               AS official_id,      -- → "officialId" on the wire (NEW)
  e.image_url, e.name, e.subtitle, e.date_range, e.location, e.director,
  eo.permissions_json, eo.scoring_scope_json
FROM event_officials eo
INNER JOIN events e ON e.id = eo.event_id
WHERE eo.user_id = :userId
  AND e.association_id = :associationId
  AND eo.deleted_at IS NULL;
```

The `eo.id` projection is the only addition over what the response already needed — it's free since the row is already in scope.

---

> **Moved.** The two per-event grant mutation endpoints that used to live here as §8 (Update Per-Event Grant) and §9 (Remove a User from a Single Event) now live in [`matchgeni-officials-api-contract.md`](./matchgeni-officials-api-contract.md) §5 and §6. Their user-scoped URLs are preserved verbatim there; the read-side (§7 above) stays here because it serves the association users page.

---

## 8. Permission Catalogues

- **EndPoint**: `GET /v2/association/users/{associationId}/permission-catalogue`
- **Purpose**: Powers the permission grids in `AssociationUserModal` and `EventOfficialAccessModal`. Server-driven so labels / descriptions can change without a frontend deploy.
- **Table Sources**: None — both catalogues are read from static JSON config inside the Laravel application (no DB tables involved). The endpoint exists so the frontend can fetch them at runtime instead of hard-coding the keys.

### Request body

None.

### Response

```json
{
  "associationPermissions": [
    {
      "key": "manage_events",
      "label": "Manage Events",
      "description": "Create, edit, archive tournament events for the association."
    }
  ],
  "eventPermissions": [
    {
      "key": "manage_scoring",
      "label": "Manage Scoring",
      "description": "Can enter and edit game scores (scoped to parks or divisions).",
      "expandable": true
    }
  ]
}
```

### Field notes

- `key` literals MUST exactly match the `AssociationPermissionKey` and `EventPermissionKey` unions in `src/types.ts` so the UI can switch on them.
- The literal `"*"` MUST NOT appear in either catalogue's JSON config — see [permission-key encoding](./conventions.md#permission-key-encoding-permissions_json).
- `expandable: true` on `manage_scoring` flags it for the parks / divisions scope picker. Future expandable permissions can flip this without an API contract change.
- The endpoint is `{associationId}`-scoped to leave the door open for per-association feature flags later.

---

## Endpoint summary

| # | Method | URL | Purpose |
|---|---|---|---|
| 1 | GET | `/v2/association/users/{associationId}` | List users (search, filter, page) |
| 2 | POST | `/v2/association/users/{associationId}/invite` | Invite a new user |
| 3 | PATCH | `/v2/association/users/{associationId}/{userId}` | Edit user / permissions |
| 4 | DELETE | `/v2/association/users/{associationId}/{userId}` | Remove user from association |
| 5 | POST | `/v2/association/users/{associationId}/{userId}/invites/resend` | Resend invite email |
| 6 | DELETE | `/v2/association/users/{associationId}/{userId}/invites` | Cancel pending invite |
| 7 | GET | `/v2/association/users/{associationId}/{userId}/events` | List user's events as Official |
| 8 | GET | `/v2/association/users/{associationId}/permission-catalogue` | Permission key / label lookup |

The per-event grant mutations (`PUT .../events/{eventId}/access`, `DELETE .../events/{eventId}`) moved to [`matchgeni-officials-api-contract.md`](./matchgeni-officials-api-contract.md) §5 and §6.

---

## Out of scope (today)

- Audit log endpoints (who changed what, when). Recommend a follow-up `GET /v2/association/users/{associationId}/{userId}/audit-log` once the basic CRUD lands.
- Bulk endpoints (bulk-invite via CSV, bulk-permission-update). Defer until a clear UX need surfaces.
- DB migration to drop `role_id` from `association_users`, add `permissions_json`, make `user_id` nullable, and add the three denormalized invite columns (`invite_id` FK, `invite_status` cached, `invited_by_user_id` durable). The full ALTER sequence lives in `docs/system/sql-migrations.md` (M1) and is owned by the backend team.
