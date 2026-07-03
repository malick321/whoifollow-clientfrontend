# New Game Time — Teams API contract

Optimised `/v2` replacement for the legacy `POST adminTeam/getTeams`,
`POST adminTeam/getMyTeams`, `POST follower/getFollowers`,
`POST follower/store` and `POST follower/unfollow`. Powers the **Teams**
section of the New Game Time page — three tabs: **Discover Teams**,
**My Teams**, **Following Teams**. Shared rules (envelope, IDs-as-strings,
image URLs, pagination) come from [`conventions.md`](./conventions.md) — only
the deltas are documented here.

## Goals vs legacy

The legacy endpoints are slow because they: (1) call Stripe on every request
for `proStatus`, (2) return full Eloquent models with eager-loaded relations
(`ratings`, `ageGroup`, `sport_type`) plus a per-row `teamFollower` relation
that hardcodes `Auth::id()`, and (3) (My Teams) run an N+1 game-stat
aggregation per team. These v2 endpoints fix all three with **no schema
changes**: pro-status is dropped (removes the Stripe call), follow-state is
batched into one query, the per-team game-stat aggregation is dropped (the card
doesn't show it), and only the fields the card renders are projected.

## Endpoints

```
GET    /v2/discover/teams              (public, auth-aware)  — Discover tab
GET    /v2/discover/teams/mine         (auth)                — My Teams tab
GET    /v2/discover/teams/following    (auth)                — Following tab
POST   /v2/discover/teams/{teamId}/follow   (auth)
DELETE /v2/discover/teams/{teamId}/follow   (auth)
```

`/v2/discover/teams` is public-ish but auth-aware: send the bearer token when
available so `isFollowing` / `followId` resolve for the current user. Without a
token those flags are `false` / `null`. `/mine` and `/following` require auth
(a user context is mandatory) and return `401` without a token.

### Query parameters (all three list endpoints)

| Param | Type | Default | Notes |
|---|---|---|---|
| `page` | int | `1` | 1-based page. |
| `per_page` | int | `25` | Max `50`. |
| `search` | string | — | Case-insensitive `team_name` contains. Maps to legacy `name`. |
| `ageGroup` | string (csv) | — | Age-group ids or names. Server-side filter on `age_group`. |
| `rating` | string (csv) | — | Rating ids. Server-side filter on `rate_id`. |
| `sportType` | string (csv) | — | Sport-type ids or names. Server-side filter on `sport_type`. |
| `gender` | string (csv) | — | e.g. `Male,Female,Coed`. Server-side. |
| `state` | string (csv) | — | State names or 2-letter abbreviations. Server-side. |

### Success response

```json
{
  "responseStatus": { "message": "Teams fetched successfully.", "statusCode": 200, "text": "OK" },
  "data": {
    "teams": {
      "data": [
        {
          "id": "318",
          "name": "DGR Dragons",
          "avatarUrl": "https://cdn.whoifollow.tech/chat/groupAvatar/abc.png?X-Amz-...",
          "ageGroup": "Men's 40+",
          "rating": "Major",
          "sportType": "Softball",
          "gender": "Male",
          "city": "Salisbury",
          "state": "England",
          "wifApproved": true,
          "isFollowing": true,
          "followId": "5501"
        }
      ],
      "current_page": 1,
      "per_page": 25,
      "total": 87,
      "last_page": 4
    }
  }
}
```

#### Field notes

- `id`, `followId` — strings (per conventions).
- `name` — `team_name`.
- `avatarUrl` — fully-resolved URL, opaque to the client. Team avatars live at
  `{cdn}/chat/groupAvatar/{file}`; the backend returns the signed S3 temporary
  URL directly (the `Teams::team_avatar` accessor normally strips this to a
  bare filename — the controller resolves the full URL from the raw column).
  `null` when the team has no avatar (client falls back to `TeamAvatar`
  initials).
- `ageGroup` / `rating` / `sportType` — resolved **display labels**. The Teams
  table stores these inconsistently (sometimes the catalogue id, sometimes the
  literal name); the controller batches one id→name lookup per catalogue
  (`age_groups.name`, `ratings.rate`, `team_sport_types.name`) and returns the
  resolved label, or the literal value when it's already a name. `null` when
  unset.
- `gender`, `city`, `state` — raw column values, `null` when empty.
- `wifApproved` — `wif_approved_status === 1` (the "WIF Verified" badge in the
  legacy UI).
- `isFollowing` / `followId` — resolved in ONE batched `team_follower` query
  (`whereIn team_id ... where user_id = me`), not per-row. `followId` is the
  follow row id used by the unfollow endpoint; `null` when not following.
- **No `proStatus`** here — pro status is deferred (separate concern), removing
  the per-request Stripe call.
- **No game-stats / team-members cluster** on My Teams (minimum card data).

#### Tab scoping

- **Discover** (`index`): `Teams::where('created_by', 1)` — the global,
  publicly-listable teams (mirrors legacy `getTeams`).
- **My Teams** (`mine`): teams where the user is a non-archived,
  non-pending-invite member (mirrors legacy `getMyTeams` membership scope,
  minus game stats).
- **Following** (`following`): teams the user follows via `team_follower`.

### Errors

Standard envelope. `401` when `/mine` or `/following` is called without a
token, `422` for an out-of-range `per_page`, `500` on query failure
(`data: []`).

## Follow / unfollow (shared across Teams tabs)

Replaces legacy `POST follower/store` + `POST follower/unfollow` (both
`multipart/form-data`). RESTful JSON instead:

```
POST   /v2/discover/teams/{teamId}/follow      → { data: { followId: "5501" } }
DELETE /v2/discover/teams/{teamId}/follow      → { data: null }
```

`teamId` is the team's string id. `user_id` comes from the token (not the
body). Follow uses `firstOrCreate` (idempotent); unfollow deletes by
`team_id` + `user_id`.

## Legacy → v2 field mapping (for the downport/merge reference)

| Legacy (raw model) | v2 field |
|---|---|
| `id` | `id` (string) |
| `team_name` | `name` |
| `team_avatar` | `avatarUrl` (resolved signed URL) |
| `age_group` (id or name) | `ageGroup` (resolved label) |
| `rate_id` → `ratings.rate` | `rating` (resolved label) |
| `sport_type` (id or name) | `sportType` (resolved label) |
| `gender` | `gender` |
| `city`, `state` | `city`, `state` |
| `wif_approved_status` | `wifApproved` (bool) |
| `teamFollower[0]` | `isFollowing` + `followId` |
| `email`, `phone_number` | _dropped — not on the v2 card_ |
| `proStatus` | _dropped — no Stripe call_ |
| game stats (My Teams) | _dropped — minimum card data_ |
```
