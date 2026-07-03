# New Game Time — Discover Events API contract

Optimised `/v2` replacement for the legacy `POST event/adminCreatedEventListings`.
Powers the **Events › Discover** tab of the New Game Time page. Shared rules
(envelope, IDs-as-strings, image URLs, pagination) come from
[`conventions.md`](./conventions.md) — only the deltas are documented here.

## Goals vs legacy

The legacy endpoint is slow because it: (1) calls Stripe on every request for
`isUserPro`, (2) runs an N+1 — one `EventJoinedTeam` query and one
`AssociationUser` query per event row, (3) returns full Eloquent models. This v2
endpoint fixes all three with **no schema changes**: pro-status is dropped from
the list response (removes the Stripe call), the per-event `EventJoinedTeam`
query is **dropped entirely** (the public card shows minimum data — no team
cluster), association-admin gating and follow-state are each batched into a
single query, and only the fields the card renders are projected.

## Endpoint

```
GET /v2/discover/events
```

Public-ish but auth-aware: send the bearer token when available so `isFollowing`
and `isUmpireOrAdmin` resolve for the current user. Without a token those flags
are `false`.

### Query parameters

| Param | Type | Default | Notes |
|---|---|---|---|
| `page` | int | `1` | 1-based page. |
| `per_page` | int | `25` | Max `50`. |
| `year` | int | current year | Maps to legacy `selectedYear`. Filters events active in that year. |
| `pastEvents` | bool | `false` | `false` = upcoming/ongoing (default), `true` = past. Maps to legacy `eventStatus`. |
| `associationIds` | string (csv) | — | Comma-separated association IDs. Server-side filter. |
| `states` | string (csv) | — | Comma-separated state names or 2-letter abbreviations. Server-side. |
| `search` | string | — | Case-insensitive `eventName` contains. Maps to legacy `name`. |
| `timezone` | string (IANA) | UTC | Used only to compute "today" for the upcoming/past split, matching legacy behavior. |

### Success response

```json
{
  "responseStatus": { "message": "Discover events fetched successfully.", "statusCode": 200, "text": "OK" },
  "data": {
    "events": {
      "data": [
        {
          "id": "412",
          "guid": "22db7770-e620-4e87-a4af-287d0cb39ef2",
          "name": "DGR Event 2026",
          "eventType": "League",
          "startDate": "2026-05-04",
          "endDate": "2026-06-30",
          "timeZone": "Asia/Karachi",
          "dateRangeLabel": "May 4 to Jun 30, 2026",
          "status": "1",
          "externalUrl": null,
          "association": { "id": "12", "name": "Seniors Softball USA" },
          "directorName": "Abeer Khan",
          "location": { "city": "Salisbury", "state": "England", "lat": "51.07", "lng": "-1.79" },
          "avatarUrl": "https://cdn.whoifollow.tech/events/avatar/dgr.png",
          "isFollowing": true,
          "followId": "5501",
          "isUmpireOrAdmin": false
        }
      ],
      "current_page": 1,
      "per_page": 25,
      "total": 132,
      "last_page": 6
    },
    "availableYears": [2027, 2026, 2025, 2024]
  }
}
```

#### Field notes

- `id`, `guid`, `association.id`, `followId` — strings (per conventions).
- `startDate` / `endDate` — raw `YYYY-MM-DD` (from `startDateForField` /
  `endDateForField`). The client formats the human label, but `dateRangeLabel`
  is also returned server-side for convenience / parity with the legacy UI.
- `timeZone` — IANA string; frontend strips any `(UTC±..)` prefix for display.
- `status` — string. `"2"` = an external-link event: `externalUrl` is set and the
  card shows the link instead of a map location (matches legacy `event.status === '2'`).
- `avatarUrl` — fully-resolved CDN URL, opaque to the client (event avatars
  live at `events/avatar/`). No team cluster on the public card (minimum data).
- `isFollowing` / `followId` — resolved in ONE batched `eventfollower` query
  (`whereIn event_id ... where user_id = me`), not per-row. `followId` is the
  follow row id used by the unfollow endpoint; `null` when not following.
- `isUmpireOrAdmin` — batched: one `association_users` query for the current
  user across all association_ids on the page.
- **No `isUserPro`** here — pro status is deferred (separate cached endpoint /
  client concern), removing the per-request Stripe call.
- **No weather** here — see the batched weather endpoint below.

### Errors

Standard envelope. `422` for an out-of-range `per_page`, `500` on query failure
(`data: []`). Invalid `year` falls back to the current year.

## Follow / unfollow (shared across Events tabs)

Replaces legacy `POST eventfollower/store` + `POST eventfollower/unfollow`
(both `multipart/form-data`). RESTful JSON instead:

```
POST   /v2/discover/events/{eventId}/follow      → { data: { followId: "5501" } }
DELETE /v2/discover/events/{eventId}/follow      → { data: null }
```

`eventId` is the event's string id. `user_id` comes from the token (not the body).

## Weather — use the shared service (no bespoke endpoint)

The legacy UI fires one weather request **per visible card** (`WeatherData.vue`
→ `event/getApiWeatherData` by `eventId`). We do **not** add an event-scoped
weather endpoint. Instead the card uses the colleague's existing shared service,
**`GET /v2/weather`** (see [`shared-services-api-contract.md` §1](./shared-services-api-contract.md)),
which takes raw `lat`/`lon` + `dates` and is server-cached.

This list endpoint already returns everything that call needs per event:
`location.lat`, `location.lng`, and `startDate`/`endDate`. For each event within
the near-term window (the client computes it, as the legacy
`isEventWithinFiveDays` did), the frontend calls the shared client helper:

```ts
// src/api/weather.ts (shared-services contract §1)
fetchWeatherForDates(event.location.lat, event.location.lng, [event.startDate], 'f')
```

Skip events with no coordinates. Because `/v2/weather` is cached by
`(lat,lon,date)`, many cards sharing a venue collapse to one upstream hit.

## Legacy → v2 field mapping (for the downport/merge reference)

| Legacy (raw model) | v2 field |
|---|---|
| `id` | `id` (string) |
| `guid` | `guid` |
| `eventName` | `name` |
| `eventType` | `eventType` |
| `startDateForField` | `startDate` |
| `endDateForField` | `endDate` |
| `time_zone` | `timeZone` |
| `status` + `Url` | `status` + `externalUrl` |
| `association` (name) + `association_id` | `association.{ name, id }` |
| `director_name` | `directorName` |
| `city`,`state`,`lan`,`long` | `location.{ city, state, lat, lng }` |
| `avatar` | `avatarUrl` (resolved) |
| `eventTeam[]` (full teams) | _dropped — no team cluster on public card_ |
| `EventFollower[0]` | `isFollowing` + `followId` |
| `isUmpireOrAdmin` | `isUmpireOrAdmin` |
