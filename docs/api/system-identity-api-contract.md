---
status: Draft (v1)
owner: shared
last_updated: 2026-06-20
---

# System Identity — REST API contract

## Context

Platform-wide identity utilities against the global WIF `users` table — not association-scoped (hence the `system-` prefix). Today this is a single, deliberately **privacy-limited** lookup: *does this email already belong to a WIF user?* so an admin form can **link** an existing person instead of inviting a stranger.

First consumer: the Register/Edit Team wizard's manager-email field (`src/components/ManagerEmailLookup.vue`) — links `association_teams.manager_linked_user_id` on a match, flags an invite on no-match. Reusable by any invite flow.

For shared rules — response envelope, auth header, error codes — see [`conventions.md`](./conventions.md). Wire is camelCase; v2 envelope `{ responseStatus, data }`.

## Endpoints summary

| # | Method & path | Purpose |
|---|---|---|
| 1 | `GET /v2/users/lookup?email=` | Privacy-limited identity probe — does this email belong to an existing WIF user? Returns a minimal identity or `null`. |

---

## 1. User Lookup (identity probe)

- **Endpoint**: `GET /v2/users/lookup?email={email}`
- **Purpose**: Answer one narrow question — *does this email belong to an existing WIF user?*
- **Auth**: standard authenticated session. This is a deliberately **privacy-limited** probe — it confirms existence and returns only display essentials; it is **not** a user search/enumeration endpoint and never returns profile data, phone, address, or partial-match lists.
- **Table sources**: `users` — exact, case-insensitive match on the primary email (`WHERE LOWER(email) = LOWER(:email) AND deleted_at IS NULL`), single row.

### Query parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `email` | string | yes | The full email to test. Must be a syntactically valid address (the client only calls after local validation + debounce). Partial / wildcard values are rejected — this is exact-match only. |

### Request body

None (GET).

### Response

`data` is the matched identity, or **`null`** when no account exists for that email (a `200` with `data: null` — *not* a `404`; "no match" is a normal answer, not an error).

```jsonc
// match
{
  "responseStatus": { "message": "OK", "statusCode": 200, "text": "OK" },
  "data": {
    "id": "u_5001",
    "name": "Tom Whitesides",
    "email": "tom.whitesides@example.com",
    "avatarUrl": "https://cdn.whoifollow.tech/users/5001.png"
  }
}

// no match
{ "responseStatus": { "message": "OK", "statusCode": 200, "text": "OK" }, "data": null }
```

### `data` object (`WifUserIdentity`)

| Field | Type | Notes |
|---|---|---|
| `id` | string | `users.id` serialized as a string. The value stored as `manager_linked_user_id` (and similar links) on match. |
| `name` | string | Display name (resolved from the user's profile — first + last, or username fallback). |
| `email` | string | Echo of the matched email. |
| `avatarUrl` | string? | CDN avatar URL when set; omitted otherwise. |

> Exposed columns are intentionally minimal (`id`, display name, avatar). Do **not** widen this payload — anything richer belongs behind an authorized profile endpoint, not an email probe.

### Caching

Not cached at the edge — identity can change (a person signs up moments later) and the result is cheap. The client debounces (~400 ms) and cancels superseded lookups; that's the only throttling.

### Error handling

- Invalid / missing `email` → `422`.
- Any upstream failure → the client treats it as "no match" (shows the invite path) rather than blocking the form — non-critical, degrade gracefully.

### Frontend client (this repo)

`lookupWifUserByEmail(email)` in `src/api/identity.ts` (mock-first behind `IDENTITY_LOOKUP_LIVE`); `WifUserIdentity` type in `src/types.ts`; UI widget `src/components/ManagerEmailLookup.vue`.

## Out of scope (future)

- Lookup by phone (parallel to email).
- Bulk / batch existence checks.
- Any richer profile read — that belongs behind an authorized profile endpoint.
