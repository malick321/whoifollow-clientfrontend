---
status: Draft (v1)
owner: shared
last_updated: 2026-07-29
---

# Team Event Games — REST API contract

## Context

Powers the "Add Game" popup on the member-facing Team Event Detail page
(`src/views/TeamEventDetailView.vue` → `CreateGameModal`). It is the `/v2`
replacement for the legacy Vue 2 `POST game/create` flow, writing the shared
`games` table so the game appears in the event's boxscores + Games/Won/Lost record.

Rooted under `/v2/chat/teams/{teamId}/...` (served by `TeamEventDetailController`,
alongside the event overview/attendance/boxscores reads). For shared rules —
response envelope, IDs, auth — see [`conventions.md`](./conventions.md).

**IDs:** `{teamId}` is the firebase-style `teams.team_id` **string**; `{eventId}`
is the numeric `team_events.id`. Both come straight from the event-detail route
and match the other event-detail endpoints.

---

## 1. Create Game

- **Endpoint**: `POST /v2/chat/teams/{teamId}/events/{eventId}/games`
- **Purpose**: A team admin adds a game to a team-owned event.
- **Table sources**: INSERT into `games` (`team_id` = route string, `event_id` = numeric `team_events.id`).
- **Auth**: bearer token; caller must be a **team admin** (team creator or a `team_members` row with `admin = 1`) → else `403`.

### Request body (JSON)

```jsonc
{
  "name": "Game 1",                    // required, <= 60
  "opponentName": "Rangers",           // required, <= 60
  "opponentCountry": "United States",  // optional (defaults to "United States")
  "opponentState": "LA",               // optional
  "opponentCity": "New Orleans",       // optional
  "startDate": "2026-07-30",           // required, YYYY-MM-DD
  "startTime": "10:00 AM",             // optional
  "eventAlert": null,                  // optional reminder key
  "note": "Bring extra bats."          // optional, <= 200
}
```

Server-set fields (never sent): `guid`, `status = 1`, `team_id`, `event_id`,
`field_configuration_id` (best-effort from the team's age group),
`exactDateFormat`, `created_by`.

### Response

`201` with the created game:
```jsonc
{
  "responseStatus": { "statusCode": 201, "message": "Game created successfully.", "text": "Created" },
  "data": { "game": { "id": "9001", "guid": "…", "name": "Game 1", "opponentName": "Rangers", "startDate": "2026-07-30", "startTime": "10:00 AM" } }
}
```

The created game immediately appears in `GET /v2/chat/teams/{teamId}/events/{eventId}/boxscores`
and increments the overview `record.games` count.

### Errors

| Code | When |
|---|---|
| `401` | No/invalid bearer token. |
| `403` | Caller is not a team admin. |
| `404` | No team/event for `{teamId}`/`{eventId}`. |
| `422` | Missing `name`/`opponentName`/`startDate`, or bad `startDate` format. |

## Out of scope (deferred, matching v1 UI)

- Park/field pickers (legacy game-park system not present in the new frontend).
- Update / delete game, scoring, lineups (handled by the scoresheet flow).
