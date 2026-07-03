# API conventions

Shared rules every WhoIFollow `/v2` API contract relies on. Individual contract files (e.g. `association-users-api-contract.md`) link here instead of repeating the boilerplate. Update this file once when a global rule changes — every contract picks the change up automatically.

---

## URL conventions

- All v2 endpoints are rooted at `/v2/<area>/<entity>/{id}/...` — for example `/v2/association/users/{associationId}` or `/v2/event/scoresheet/{gameGuid}`.
- `<area>` and `<entity>` are lowercase, plural where the entity is a collection.
- Path parameters are wrapped in `{}` in this documentation; on the wire they're literal IDs (no braces).
- The base host is implementation-specific — use `https://api.whoifollow.com/api` in examples.

## Auth

- Every authenticated request carries a bearer token in the `Authorization` header:

  ```
  Authorization: Bearer <token>
  ```

- The `{associationId}` (or equivalent scope) embedded in the URL is enforced server-side against the token's allowed scopes. A token that's valid for one association but not another receives a `403`.
- Endpoints that don't require auth are explicitly called out in the relevant contract.

## IDs and timestamps

- All IDs in request/response bodies are **strings**, even when the underlying database column is `BIGINT UNSIGNED`. This avoids JS number-precision loss for large IDs.
- All timestamps are **ISO 8601 in UTC** — e.g. `"2026-05-08T15:21:00Z"`. The frontend converts to local time for display.
- Display-formatted strings (e.g. `"Apr 30 – May 3, 2026"`) are returned alongside raw timestamps when the UI needs a server-localized rendering — that's documented per-endpoint.

### Doc-example IDs vs wire IDs

JSON examples throughout the v2 contracts use **prefixed stub IDs** — strings like `"au_412"`, `"eo_88"`, `"inv_5501"`, `"u_42"`, `"park_1"`, `"evt_77"` — for documentation readability. The prefix lets a reader skimming a payload tell at a glance which entity an ID refers to:

| Prefix | Source table | Example |
|---|---|---|
| `au_` | `association_users.id` | `"au_412"` |
| `eo_` | `event_officials.id` | `"eo_88"` |
| `inv_` | `invites.id` | `"inv_5501"` |
| `u_` | `users.id` | `"u_42"` |
| `evt_` | `team_events.id` / `events.id` | `"evt_77"` |
| `park_` | `parks.id` | `"park_1"` |
| `div_` | `divisions.id` | `"div_4"` |

**These prefixes are illustrative only — they never appear on the production wire.** Every underlying table uses `BIGINT UNSIGNED AUTO_INCREMENT` PKs (see `docs/system/sql-schema.md`), and the serializer emits the bare PK as a numeric string per the strings-not-numbers rule above. In production, `association_users.id = 412` becomes `"412"` on the wire, not `"au_412"`.

When a contract example shows `"associationUserId": "au_412"`, the equivalent production payload is `"associationUserId": "412"`. Clients should parse IDs as opaque strings; they should NOT try to extract or validate any prefix.

## Image URLs

Every image asset surfaced on the v2 wire — `avatarUrl`, `logoUrl`, `imageUrl`, `coverUrl`, `bannerUrl`, `thumbnailUrl`, and any future image field — follows three rules:

1. **The wire value is a fully-resolved, Cloudflare-transformed URL.** Publicly fetchable, opaque to clients, ready to drop into an `<img src>` without modification. No expiring query parameters, no need for the client to know the storage backend.

2. **Backend serializers route every image field through one shared helper** — `transformImageUrl(sourceUrl, preset)`. The helper picks a named transform preset (`avatar_md`, `cover_card_wide`, etc.) and emits the Cloudflare URL. The preset table, default-per-asset-type, helper signature, and URL shape live in [`shared-catalogues.md` § Image-transform presets](../system/shared-catalogues.md) — the source of truth. Per-endpoint overrides (e.g. an event hero modal that wants `cover_banner` instead of `cover_card_wide`) MUST name the preset in that endpoint's field notes.

3. **Frontend treats image URLs as opaque.** No string concatenation, no host swap, no parsing, no client-side resize hints. The URL the backend hands over is the URL the frontend drops into the DOM verbatim. Per-contract field notes that previously said "public, unsigned URL — never an AWS pre-signed URL" now say "Cloudflare-transformed URL (preset: `<name>`)" pointing at the catalogue.

## Response envelope

Every response — success and error — is wrapped in a top-level `responseStatus` object so the client has a single place to read status from.

### Success

```json
{
  "responseStatus": {
    "message": "Users fetched successfully.",
    "statusCode": 200,
    "text": "OK"
  },
  "data": { /* endpoint-specific payload */ }
}
```

### Error

```json
{
  "responseStatus": {
    "message": "Email is already a member of this association.",
    "statusCode": 409,
    "text": "Conflict"
  },
  "data": { "field": "email" }
}
```

Field reference:

| Field | Required | Description |
|---|---|---|
| `responseStatus.message` | Yes | Human-readable summary. Safe to surface in toasts. |
| `responseStatus.statusCode` | Yes | Numeric HTTP-style code. Mirrors the actual HTTP status returned on the wire. |
| `responseStatus.text` | No | Short textual tag (`"OK"`, `"Created"`, `"Validation Error"`, …). Useful for telemetry / debugging; not required by the client. |
| `data` | Conditional | Endpoint-specific payload. Omitted on responses that have nothing to return (formerly 204-style). On error responses `data` may carry field-level details such as `{ "field": "email" }`. |

## Pagination envelope (Laravel paginator)

Paginated endpoints return the standard Laravel paginator object **at `data`** inside the response envelope. The frontend reads only `total`, `current_page`, `per_page`, `from`, and `to`; the URL helpers (`first_page_url`, `last_page_url`, `prev_page_url`, `next_page_url`, `path`, `links[]`) are kept for cross-endpoint consistency even though most v2 UIs use continuous scroll.

```json
{
  "responseStatus": {
    "message": "Items fetched successfully.",
    "statusCode": 200,
    "text": "OK"
  },
  "data": {
    "current_page": 1,
    "data": [ /* the page's items */ ],
    "first_page_url": "https://api.whoifollow.com/api/v2/<endpoint>?page=1",
    "from": 1,
    "last_page": 6,
    "last_page_url": "https://api.whoifollow.com/api/v2/<endpoint>?page=6",
    "links": [
      { "url": null, "label": "&laquo; Previous", "active": false },
      { "url": "https://api.whoifollow.com/api/v2/<endpoint>?page=1", "label": "1", "active": true },
      { "url": "https://api.whoifollow.com/api/v2/<endpoint>?page=2", "label": "2", "active": false },
      { "url": "https://api.whoifollow.com/api/v2/<endpoint>?page=2", "label": "Next &raquo;", "active": false }
    ],
    "next_page_url": "https://api.whoifollow.com/api/v2/<endpoint>?page=2",
    "path": "https://api.whoifollow.com/api/v2/<endpoint>",
    "per_page": 25,
    "prev_page_url": null,
    "to": 25,
    "total": 142
  }
}
```

Standard pagination query parameters (each contract redocs them with their own defaults / caps):

| Name | Type | Default | Notes |
|---|---|---|---|
| `page` | int | `1` | 1-indexed Laravel paginator page. |
| `per_page` | int | `25` | Server caps at 100 unless documented otherwise. |

## Common error codes

All errors follow the envelope above. Numeric `statusCode` mirrors the HTTP status header.

| `statusCode` | `text` | Typical meaning |
|---|---|---|
| 400 | Bad Request | Malformed JSON or missing required fields. |
| 401 | Unauthorized | No token, expired token, or token signature invalid. |
| 403 | Forbidden | Token is valid but lacks the required permission for this resource. Includes scope mismatches (e.g. token for association A hitting association B). |
| 404 | Not Found | Path or referenced resource doesn't exist (or isn't visible to this caller). |
| 409 | Conflict | Uniqueness collision (e.g. duplicate email) or a state-machine violation (e.g. cancelling an invite that's not pending). |
| 422 | Validation Error | Body parsed fine but failed semantic validation. `data.errors` is a `{ field: [messages] }` map when multiple fields fail. |
| 500 | Server Error | Unhandled exception — surface a generic toast and log the request id from `responseStatus`. |

## Permission-key encoding (`permissions_json`)

Multiple tables (`association_users`, `event_officials`) store a user's granted permissions in a single `permissions_json` column. The encoding is identical across tables:

| DB value | Wire format | Meaning |
|---|---|---|
| `["*"]` | `{ "fullControl": true, "permissions": [] }` | Full Control — implicitly grants every permission key in this scope. UI ignores the keys list when Full Control is on. |
| `["manage_events", …]` | `{ "fullControl": false, "permissions": ["manage_events", …] }` | Granular permission keys — subset of the relevant catalogue (`association_permission_catalogue` / `event_permission_catalogue`). |
| `[]` | `{ "fullControl": false, "permissions": [] }` | No access. Mostly relevant for `pending` invites that haven't had perms assigned yet. |

The literal `"*"` is **reserved** as the Full Control sentinel — it must never appear in a request body's `permissions` array, and it must never appear in either permission catalogue as a user-selectable key. Servers that receive `"*"` in `permissions` should reject with `422`.

The wire format always exposes `fullControl: boolean` + `permissions: string[]` separately. Translation between the wire shape and `permissions_json` happens server-side; clients never see `["*"]`.
