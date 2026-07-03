# New Game Time — Associations API contract

Optimised `/v2` replacement for the legacy `GET association/fetchAllAssociations`
+ `POST associationfollower/getFollowedAssociations` + `associationfollower/store|unfollow`.
Powers the **Associations › Discover** and **Associations › Following** tabs of
the New Game Time page. Shared rules (envelope, IDs-as-strings, image URLs,
pagination) come from [`conventions.md`](./conventions.md) — only the deltas are
documented here. Mirrors [`newgametime-discover-events-api-contract.md`](./newgametime-discover-events-api-contract.md).

## Goals vs legacy

The legacy endpoints return full Eloquent `Association` models with eager-loaded
relations and resolve follow-state via a per-row `associationFollower` relation
that hardcodes `Auth::id()`. This v2 slice fixes that with **no schema changes**:
only the card columns are projected, follow-state is resolved with ONE batched
`association_followers` query for the whole page, and follower/team counts come
from cheap `withCount` subqueries.

## Endpoints

```
GET    /v2/discover/associations                              (public, auth-aware)
GET    /v2/discover/associations/following                    (auth)
POST   /v2/discover/associations/{associationId}/follow       (auth)
DELETE /v2/discover/associations/{associationId}/follow       (auth)
```

The list endpoint is public but auth-aware: send the bearer token when available
so `isFollowing` / `followId` resolve for the current user. Without a token those
are `false` / `null`.

### Query parameters (both list endpoints)

| Param | Type | Default | Notes |
|---|---|---|---|
| `page` | int | `1` | 1-based page. |
| `per_page` | int | `25` | Max `50`. |
| `search` | string | — | Case-insensitive `association_name` contains. Maps to legacy `search`/`name`. |

### Success response — `GET /v2/discover/associations`

```json
{
  "responseStatus": { "message": "Discover associations fetched successfully.", "statusCode": 200, "text": "OK" },
  "data": {
    "associations": {
      "data": [
        {
          "id": "12",
          "guid": "22db7770-e620-4e87-a4af-287d0cb39ef2",
          "name": "Seniors Softball USA",
          "shortName": "SSUSA",
          "logoUrl": "https://cdn.whoifollow.tech/associations/logo/<guid>/logo.png",
          "city": "Salisbury",
          "state": "England",
          "followerCount": 320,
          "teamCount": 18,
          "isFollowing": true,
          "followId": "5501"
        }
      ],
      "current_page": 1,
      "per_page": 25,
      "total": 132,
      "last_page": 6
    }
  }
}
```

`GET /v2/discover/associations/following` returns the identical envelope/shape;
only the rows differ (associations the authed user follows, ordered by most
recently followed). `followId` is always present on these rows.

#### Field notes

- `id`, `guid`, `followId` — strings (per conventions).
- `logoUrl` — fully-resolved CDN URL (`{cdn}/associations/logo/{guid}/{logo}`),
  opaque to the client; `null` when the association has no logo. Built
  server-side (the `Association` model has no `logo` accessor, so the controller
  resolves it the same way the legacy follower controller did).
- `followerCount` / `teamCount` — `withCount('associationFollower')` /
  `withCount('associationTeams')` subqueries (cheap, no full-collection load).
- `isFollowing` / `followId` — resolved in ONE batched `association_followers`
  query (`whereIn association_id ... where user_id = me`), not per-row.
  `followId` is the follow row id used by the unfollow endpoint; `null` when not
  following.
- **No `proStatus` / pro-gating** here — the legacy "free users cannot follow"
  Stripe gate is dropped from this list response (separate client/cached concern).

### Errors

Standard envelope. `422` for an out-of-range `per_page`, `401` on the
auth-required endpoints without a token, `500` on query failure (`data: []`).

## Follow / unfollow

Replaces legacy `POST associationfollower/store` (`association_id` + `user_id` in
`multipart/form-data`) + `POST associationfollower/unfollow` (`follow_id`).
RESTful JSON instead:

```
POST   /v2/discover/associations/{associationId}/follow   → { data: { followId: "5501" } }
DELETE /v2/discover/associations/{associationId}/follow   → { data: null }
```

`associationId` is the association's string id. `user_id` comes from the token
(not the body). Follow is idempotent (`firstOrCreate`).

## Legacy → v2 field mapping (for the downport/merge reference)

| Legacy (raw model) | v2 field |
|---|---|
| `id` | `id` (string) |
| `guid` | `guid` |
| `association_name` | `name` |
| `short_name` | `shortName` |
| `logo` (filename) | `logoUrl` (resolved CDN URL) |
| `city` | `city` |
| `state` | `state` |
| `associationFollower` count | `followerCount` |
| `associationTeams` count | `teamCount` |
| `associationFollower[0]` (for me) | `isFollowing` + `followId` |
| `email`, `mobile_*`, `website_url` | _dropped — minimum data on the public card_ |
