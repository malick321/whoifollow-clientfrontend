---
status: Draft
owner: shared
last_updated: 2026-05-11
---

# My Associations — REST API contract

## Context

Defines the two endpoints that drive **portal access**: which associations the logged-in user has admin access to, and verification that a given URL slug is one of them. Powers:

- The `beforeEach` router guard that loads `/association/<slug>/portal/*` routes (`src/router.ts`).
- The association switcher modal in the sidebar (`src/components/AssociationSidebar.vue`).
- The branded header + nav gating across every association portal page.

When wired, replaces the mock layer in `src/api/myAssociations.ts`. For shared rules — response envelope, auth header, error codes, the `permissions_json` encoding rule — see [`conventions.md`](./conventions.md).

## Scope decisions (locked in)

- **Two endpoints, not one.** Different cardinality (1 row vs N rows), different trigger points (per-page-load vs per-switcher-open), different cache profiles. Combining wastes payload.
- **Both endpoints return the SAME row shape** — a `MyAssociation` record. The list endpoint returns an array; the single endpoint returns one record. Same query joined to the same tables, just filtered differently.
- **Slim response, not full association detail.** The endpoints answer "do I have access?" + "what associations do I have access to?" — NOT "give me the full association detail." Full visual + contact detail (`coverUrl`, addresses, social URLs, lat/long, mobile, email, etc.) loads via `GET /v2/association/profile/{slug}` only when the profile modal opens.
- **`logoUrl` is included** in both responses, but is the only image asset surfaced here. The sidebar and switcher use it for branding; the rest of the visual detail stays on the profile endpoint.
- **`logoUrl` is a Cloudflare-transformed URL** (default preset: `avatar_md` — 64×64 / fit cover / quality 85 / format auto). Backend wraps every logo through the shared `transformImageUrl()` helper before serialization. Frontend treats it as opaque (no parsing, no re-prefixing). See [`conventions.md` § Image URLs](./conventions.md#image-urls) and [`shared-catalogues.md` §7 — Image-transform presets](../system/shared-catalogues.md). Source images stay valid indefinitely (public-read ACL); if the source is deleted, the URL 404s and the API does not reissue.
- **`fullControl: boolean` and `permissions: string[]` are separate fields** — never collapsed into a sentinel. Full Control admin = `fullControl: true` + `permissions: []`. Mirrors the existing `AssociationUserModal` contract.
- **`status` is the ASSOCIATION's status**, not the membership's. If a row is returned, the user has live access — membership status is implicit. The association's `'active' | 'inactive' | 'suspended'` value lets the UI surface banners or read-only treatment when needed.

## Underlying tables

| Table | Purpose / Key columns |
|---|---|
| `associations` | Identity + branding: `id`, `guid`, `username` (= the URL slug), `short_name`, `association_name`, `logo_url`, `status`. |
| `association_users` | Membership row. The driver of both endpoints. Columns read: `user_id`, `association_id`, `status` (`'pending' \| 'active' \| 'inactive'`), `joined_at` (NULL for pending invites; set on accept), `full_control`, `permissions_json`, `deleted_at`. |

`users` is implicit (the logged-in user — `user_id` comes from the auth token).

---

## 1. List My Associations

- **EndPoint**: `GET /v2/my/associations`
- **Purpose**: Drives the sidebar's association switcher modal — every association the logged-in user has live admin access to, ordered by short name.
- **Table Sources**: `association_users` (the access row, filtered to the current user's live memberships) JOINed to `associations` on `association_users.association_id` (filtered to non-soft-deleted rows). The JOIN is a PK lookup; the filtered table scan on `association_users.user_id` is supported by the existing `(user_id)` index.

### Request

```
GET /v2/my/associations HTTP/1.1
Authorization: Bearer <token>
```

No query params. The current user is derived from the auth token; no `userId` argument is accepted (would be a privilege-escalation surface).

### Response payload (200 OK)

```jsonc
{
  "responseStatus": {
    "statusCode": 200,
    "message": "OK"
  },
  "data": [
    {
      "id": "1234567890",
      "guid": "08bb93ab-3466-4246-a4c1-694a92c2d6d8",
      "slug": "ssusa",
      "shortName": "SSUSA",
      "associationName": "Senior Softball USA",
      // public image URL — no AWS signature
      "logoUrl": "https://cdn.../ssusa-logo.png",
      "fullControl": false,
      "permissions": ["manage_events", "manage_teams"],
      "status": "active",
      "stripeConnected": true
    },
    {
      "id": "1234567891",
      "guid": "1d2a47e0-4c8b-4e83-b1d3-22aa9f3b94a1",
      "slug": "msba",
      "shortName": "MSBA",
      "associationName": "Mid-State Baseball Association",
      // public image URL — no AWS signature
      "logoUrl": "https://cdn.../msba-logo.png",
      "fullControl": true,
      "permissions": [],
      "status": "active",
      "stripeConnected": false
    }
  ]
}
```

### Errors

| Status | When | Frontend reaction |
|---|---|---|
| 401 | No / expired auth token | Existing handoff flow takes over |
| 200 + `data: []` | User has zero live memberships | Switcher modal renders an empty state — not an error |

### Field notes

- `id` — `associations.id` (numeric DB primary key, returned as string per the conventions for safe JSON-number handling).
- `guid` — `associations.guid` (CHAR(36) UUID). Stable across slug renames; preferred when the frontend needs to disambiguate associations across renames.
- `slug` — `associations.username`. The user-facing URL handle. Used as the `:associationShortName` route param. Display-quality; case is preserved.
- `shortName` — `associations.short_name`. Display only.
- `associationName` — `associations.association_name`. Full display name.
- `logoUrl` — **Cloudflare-transformed URL** (see scope decisions for preset + helper details). Empty string if the association hasn't uploaded a logo yet — never `null`.
- `fullControl` — `association_users.full_control`. When `true`, the user has every permission regardless of `permissions[]` content; the UI must short-circuit any permission check to "allow".
- `permissions` — `association_users.permissions_json`, decoded to a string array. Empty array when `fullControl` is true (sentinel pattern documented in `conventions.md`).
- `status` — `associations.status` enum. NOT the membership status — see the filter rule below.
- `stripeConnected` — `boolean`. `true` when the association has an active Stripe Connect account (a live row in `stripe_connected_accounts` for this association). Gates online credit-card payment settings in the UI — e.g. the Add/Edit Event wizard's "Allow credit card payments" toggle is forced off + disabled (with an explanatory banner) when `false`. Offline payments are unaffected.
- **Pending invites are excluded.** The endpoint only returns associations the user has actively joined, i.e. rows where `association_users.status = 'active'` AND `association_users.joined_at IS NOT NULL`. Pending (`status='pending'` / `joined_at IS NULL`) and inactive (`status='inactive'`) memberships are not surfaced — once the invitee accepts, the association appears on the next fetch. See §3 for the canonical rule.

### SQL sketch

```sql
SELECT
  a.id, a.guid, a.username AS slug,
  a.short_name AS shortName,
  a.association_name AS associationName,
  a.logo_url AS logoUrl,
  a.status,
  au.full_control AS fullControl,
  au.permissions_json AS permissions
FROM association_users au
JOIN associations a ON a.id = au.association_id
WHERE au.user_id = :currentUserId
  AND au.status = 'active'
  AND au.joined_at IS NOT NULL
  AND au.deleted_at IS NULL
  AND a.deleted_at IS NULL
ORDER BY a.short_name ASC;
```

### Caching

- Per-request, not cached server-side — membership grants change frequently relative to other reads, and the response is small.
- Frontend caches the result in memory for the lifetime of the switcher modal session (refetches on every open).

---

## 2. Get My Association by Slug

- **EndPoint**: `GET /v2/my/associations/{slug}`
- **Purpose**: Verifies the logged-in user has access to the association at `<slug>` and returns the access record. Called by the router beforeEach guard for every `/association/:slug/portal/*` navigation.
- **Table Sources**: Same as §1, with an additional filter on `associations.username = :slug`.

### Request

```
GET /v2/my/associations/ssusa HTTP/1.1
Authorization: Bearer <token>
```

Path param: `slug` — the value from `associations.username`. Case-insensitive match recommended (URL slugs are typically lowercase but admins typing the URL might use mixed case).

### Response payload (200 OK)

```jsonc
{
  "responseStatus": {
    "statusCode": 200,
    "message": "OK"
  },
  "data": {
    "id": "1234567890",
    "guid": "08bb93ab-3466-4246-a4c1-694a92c2d6d8",
    "slug": "ssusa",
    "shortName": "SSUSA",
    "associationName": "Senior Softball USA",
    // public image URL — no AWS signature
    "logoUrl": "https://cdn.../ssusa-logo.png",
    "fullControl": false,
    "permissions": ["manage_events", "manage_teams"],
    "status": "active",
    "stripeConnected": true
  }
}
```

### Errors

| Status | When | Frontend reaction |
|---|---|---|
| 401 | No / expired auth token | Existing handoff flow takes over |
| 403 | Slug exists but the user has no live `association_users` row on it | Route to the existing NotFoundView (same UX as a typo'd URL — "this isn't yours to see"). |
| 404 | Slug doesn't match any `associations.username` (or the association is soft-deleted) | Route to the existing NotFoundView |

### Field notes

Same as §1 — including the rule that pending invites are excluded. A user who has been invited to the association at `<slug>` but hasn't accepted yet will receive a `403` from this endpoint (their `association_users` row exists but with `joined_at IS NULL`), correctly routing them to the NotFoundView.

### SQL sketch

```sql
SELECT
  a.id, a.guid, a.username AS slug,
  a.short_name AS shortName,
  a.association_name AS associationName,
  a.logo_url AS logoUrl,
  a.status,
  au.full_control AS fullControl,
  au.permissions_json AS permissions
FROM association_users au
JOIN associations a ON a.id = au.association_id
WHERE a.username = :slug
  AND au.user_id = :currentUserId
  AND au.status = 'active'
  AND au.joined_at IS NOT NULL
  AND au.deleted_at IS NULL
  AND a.deleted_at IS NULL
LIMIT 1;
```

Distinguishing 403 from 404:

```sql
-- Run BEFORE the main query if the membership query returns 0 rows.
SELECT id FROM associations
 WHERE username = :slug AND deleted_at IS NULL LIMIT 1;
```

If the slug-existence probe returns a row but the membership query didn't → **403**.
If the slug-existence probe also returns 0 rows → **404**.

### Caching

- Per-request, not cached server-side.
- Frontend stores the latest resolved record in a module-level reactive ref (`currentAssociation`). The guard refetches whenever the route's `:slug` param changes; consecutive route changes within the same slug (e.g. team-id deep-link inside the same portal) skip the refetch.

---

## 3. Cross-cutting field rules

| Rule | Applies to | Where it's enforced |
|---|---|---|
| `logoUrl` is a Cloudflare-transformed URL (`avatar_md` preset) wrapped via `transformImageUrl()` | Both endpoints | Backend serializer routes every image URL through the shared helper — see [`shared-catalogues.md` §7](../system/shared-catalogues.md) |
| `fullControl: true` ⇒ `permissions: []` | Both endpoints | Backend serializer collapses redundant permission entries when full_control is set |
| `permissions[]` keys are drawn from the `AssociationPermissionKey` enum | Both endpoints | Backend validates against `config/permissions.php` catalogue; rejected values 500 (server bug) |
| Numeric `id` returned as a string | Both endpoints | Conventions doc — avoids JSON `Number.MAX_SAFE_INTEGER` truncation |
| Soft-deleted associations and soft-deleted memberships are excluded | Both endpoints | `WHERE` clause filters |
| Pending invites are excluded — only memberships where `association_users.status = 'active'` AND `association_users.joined_at IS NOT NULL` appear in either response. | Both endpoints | `WHERE` clause filters. Once a user accepts their invite, the association becomes visible on the next fetch. Direct-add memberships (no `invites` row, `invite_status IS NULL`) pass the filter because `joined_at` is set at create time. |

## 4. Frontend integration points

| File | Role |
|---|---|
| `src/api/myAssociations.ts` | Mock implementation of both endpoints during v1. Replaced with real axios calls at downport time via `dist/legacy/api/_http.js`. |
| `src/constants/associations.ts` | Holds the module-level `currentAssociation` reactive ref. Populated by the router guard from API #2's response. |
| `src/router.ts` | `beforeEach` guard calls `fetchMyAssociation(slug)` on every entry to a `/association/:slug/portal/*` route. 403/404 → `not-found`. |
| `src/components/AssociationSidebar.vue` | Opens the switcher modal; calls `fetchMyAssociations()` to populate the list. Nav items gated via `hasPermission` / `hasAnyPermission` helpers reading `currentAssociation.value.permissions`. |
| `src/lib/permissions.ts` | `hasPermission(membership, key)` + `hasAnyPermission(membership, keys[])` — Full Control short-circuits to `true`. |

## 5. Out of scope for this contract

- `GET /v2/association/profile/{slug}` — full association detail (logo + cover + addresses + social URLs + lat/long + Stripe details). Documented separately.
- `POST/PATCH/DELETE` on `association_users` — already covered by the association-users contract (`docs/api/association-users-api-contract.md`).
- Public-facing `/association/<slug>/` (non-portal) pages — separate access model, separate effort. The slug shape is consistent.
- Permissions enforcement at the per-button level inside individual portal views — this contract delivers the data; the gating wiring per-button happens incrementally in component-level work.
