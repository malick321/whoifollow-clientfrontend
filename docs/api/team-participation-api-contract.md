# Team Participation API Contract Design

This document defines the API contract for the Team Participation screen and the Event Lineup modal.

It is intentionally separate from the game scoresheet contract in `docs/scoresheet-api-contract.md`.

This version reflects the current architectural decisions:

- reuse the existing Games API for game cards
- reuse the existing Event Details / Standings API for division standings and overview
- keep Team Participation API lightweight
- keep Event Lineup API separate because the modal lazy-loads

## Recommended Endpoint Set

### Team Participation

1. `GET /api/v2/team-participation/{eventTeamId}`

Purpose:

- Returns only the team/event-specific data needed for the Team Participation screen header and side summary card content.
- Does not include full editable lineup rows.
- Does not include games if those already come from the existing Games API.
- Does not include standings if those already come from the existing Event Details / Standings API.

### Event Lineup Modal

1. `GET /api/v2/event-lineup/{eventTeamId}`
2. `PATCH /api/v2/event-lineup/{eventTeamId}`

Purpose:

- Load the editable event lineup when the modal opens.
- Save lineup edits made inside the modal.

### Existing APIs To Reuse

1. Existing Games API
   - fetch games using `event_id`, `division_id`, and `team_id`
2. Existing Event Details / Standings API
   - fetch division standings, tie-breaker rules, and format text

## Why This Split

- The Team Participation page does not need the full editable lineup payload immediately.
- The lineup modal is lazy-loaded, so the API should follow that UI behavior.
- Games already have their own API and should not be duplicated here.
- Standings/division overview already exist elsewhere and should not be duplicated here.
- This reduces payload size and keeps each API focused.

## 1. Team Participation API

### `GET /api/v2/team-participation/{eventTeamId}`

Purpose:

- Load the non-game, non-standings, non-editable-lineup data for the Team Participation screen.

Primary table sources based on your schema notes:

- `association_teams`
  - team name
  - registration status
  - manager / team contact
- `team_events`
  - event name
  - timezone
  - event-level fallback format / seed criteria
- `event_tournaments`
  - division name
  - tournament/division start date
  - tournament/division end date
  - tournament-specific format / seed criteria override if present
- `event_team_lineup`
  - summarized lineup text only, not full modal rows

### Suggested response

```json
{
  "event_team_id": 321,
  "team_id": 44,
  "event_id": 77,
  "division_id": 12,
  "team_name": "Dudley Lightning 65",
  "fee_status": "registered",
  "association_status": "pending",
  "participation_status": "awaiting-lineup",
  "manager": {
    "name": "John Smith",
    "email": "john.smith@wifsoftball.com",
    "phone": "(480) 555-0114"
  },
  "event": {
    "name": "2025 Midwest Championship",
    "timezone": "America/Los_Angeles"
  },
  "division": {
    "id": 12,
    "name": "Men's 75+ Major",
    "start_date": "2025-04-13",
    "end_date": "2025-04-17"
  },
  "event_overview": {
    "lineup_summary": "John Smith, David Marcus, Anthony Simons, Tim Kool, Bretly Martins",
    "venue_text": "Century Sports Complex, Bullhead City, AZ"
  }
}
```

### Field notes

- `event_team_id`
  - canonical key for this team’s participation in the event
- `team_id`
  - canonical team identifier if frontend needs it for existing Games API filters
- `event_id`
  - existing event identifier for reuse with other APIs
- `division_id`
  - required so the frontend can call the existing Games API and standings API without guessing
- `fee_status`
  - can remain string-based if that is easier for backend consistency
- `association_status`
  - same as above
- `participation_status`
  - derived app-level status such as:
    - `confirmed`
    - `awaiting-lineup`
    - `under-review`
- `event_overview.lineup_summary`
  - used for the small lineup display above the weather card
- `event_overview.venue_text`
  - optional if this is already available from another reused API

### What this endpoint should not include

- full `event_team_lineup[]`
- games list
- standings list
- podium data
- tie-breaker text
- format text

Those should come from specialized existing APIs.

## 2. Event Lineup Read API

### `GET /api/v2/event-lineup/{eventTeamId}`

Purpose:

- Load the full editable lineup only when the modal opens.

Primary table source:

- `event_team_lineup`

Possible supporting lookups:

- `association_teams`
- `team_members`
- `users`

depending on how player identity is stored.

### Suggested response

```json
{
  "event_team_id": 321,
  "team_id": 44,
  "event_id": 77,
  "division_id": 12,
  "lineup": [
    {
      "id": 1,
      "batting_order": 1,
      "team_member_id": 888,
      "jersey_number": "4",
      "player_name": "John Smith",
      "position_code": "P",
      "status": "active",
      "user_id": 12
    },
    {
      "id": 2,
      "batting_order": 2,
      "team_member_id": 889,
      "jersey_number": "11",
      "player_name": "David Marcus",
      "position_code": "SS",
      "status": "active",
      "user_id": 13
    },
    {
      "id": 11,
      "batting_order": 11,
      "team_member_id": null,
      "jersey_number": "44",
      "player_name": "Bobby Luna",
      "position_code": "EH",
      "status": "bench",
      "user_id": null
    }
  ]
}
```

### Read behavior notes

- Order rows by `batting_order`.
- Return all lineup rows needed by the modal.
- Allow rows that are manually entered and not tied to a `team_member_id`.
- `team_member_id` is the canonical roster link back to the team member record.
- `team_member_id = null` means the lineup row is manual/unlinked.

## 3. Event Lineup Save API

### `PATCH /api/v2/event-lineup/{eventTeamId}`

Purpose:

- Save the full editable lineup from the modal.
- Update `event_team_lineup`.

Primary table source:

- `event_team_lineup`

### Suggested request

```json
{
  "lineup": [
    {
      "id": 1,
      "batting_order": 1,
      "team_member_id": 888,
      "jersey_number": "4",
      "player_name": "John Smith",
      "position_code": "P",
      "status": "active"
    },
    {
      "id": 2,
      "batting_order": 2,
      "team_member_id": 889,
      "jersey_number": "11",
      "player_name": "David Marcus",
      "position_code": "SS",
      "status": "active"
    },
    {
      "id": 11,
      "batting_order": 11,
      "team_member_id": null,
      "jersey_number": "44",
      "player_name": "Bobby Luna",
      "position_code": "EH",
      "status": "bench"
    }
  ]
}
```

### Suggested response

Return the same shape as `GET /api/v2/event-lineup/{eventTeamId}` after save:

```json
{
  "event_team_id": 321,
  "team_id": 44,
  "event_id": 77,
  "division_id": 12,
  "lineup": [
    {
      "id": 1,
      "batting_order": 1,
      "team_member_id": 888,
      "jersey_number": "4",
      "player_name": "John Smith",
      "position_code": "P",
      "status": "active",
      "user_id": 12
    }
  ]
}
```

### Validation rules

- `lineup` required array
- each row:
  - `id` nullable numeric
  - `batting_order` required integer `>= 1`
  - `team_member_id` nullable numeric
  - `jersey_number` nullable string
  - `player_name` required string
  - `position_code` nullable string
  - `status` required and one of:
    - `active`
    - `bench`

### Save behavior notes

- Treat this as a full-list replace or synchronized upsert for `event_team_lineup`.
- Persist the batting order explicitly.
- Persist `team_member_id` as the canonical teammate link when present.
- Rows missing from the request should be deleted or soft-archived according to audit policy.
- Manual rows without `team_member_id` should be supported.
- If `team_member_id` is null, treat the row as manual/unlinked.
- If `team_member_id` changes, backend should update the roster link for that lineup row.
- If only one lineup per `event_team_id` should exist, enforce uniqueness at that scope.

## Reused Existing Games API

This screen should continue using the existing Games API instead of embedding games inside Team Participation.

Expected usage:

```txt
GET /api/v2/games?event_id={eventId}&division_id={divisionId}&team_id={teamId}
```

Purpose:

- fetch only games relevant to the viewed team in the selected division/event

Primary table source:

- `tournament_games`

Supporting data:

- `game_lineup_submission`
  - whether lineup was submitted for a game
- scoresheet-related table(s)
  - current scoresheet upload/publish status if shown on each game card

The Team Participation screen already needs from each game card:

- game id
- bracket label
- date/time
- field/facility
- opponent
- seed labels
- scores if final/live
- game status
- lineup submitted flag
- scoresheet status

## Reused Existing Standings / Event Details API

This screen should continue using the existing standings/event-details API instead of embedding division overview inside Team Participation.

Purpose:

- fetch tie-breaker text
- fetch format text
- fetch standings rows
- fetch podium/summary rows if required

Primary table sources:

- `event_tournaments`
- `tournament_teams`
- `tournament_seed_criteria`
- fallback to `team_events` event-level format / seed criteria when tournament-level values are null

### Inheritance rules to preserve

From your schema notes:

- if tournament-level seed criteria is absent, inherit from `team_events`
- if tournament-level format is absent, inherit from `team_events`

That logic should live in the standings/event-details API, not the Team Participation API.

## Frontend Loading Plan

Recommended frontend load pattern for the Team Participation screen:

1. On page load:
   - `GET /api/v2/team-participation/{eventTeamId}`
   - existing `GET /api/v2/games?...`
   - existing standings/event-details API

2. When user opens Manage Lineup modal:
   - `GET /api/v2/event-lineup/{eventTeamId}`

3. When user saves modal:
   - `PATCH /api/v2/event-lineup/{eventTeamId}`

4. After lineup save:
   - either:
     - update local lineup summary from saved lineup
   - or:
     - refetch `GET /api/v2/team-participation/{eventTeamId}` if you want strict server truth

## Do We Need Any POST API Here?

For the current Team Participation screen: no.

Current behavior only requires:

- read team participation summary
- read full event lineup when modal opens
- update event lineup

So `GET` + `PATCH` is enough.

Possible future reasons for a `POST`:

- add a brand-new player row separately
- invite/add roster member into event lineup
- submit attendance RSVP
- submit team participation confirmation

But none of those are required for the current UI.

## Suggested Laravel Surface

Suggested controller methods:

```php
GET    /api/v2/team-participation/{eventTeamId}
GET    /api/v2/event-lineup/{eventTeamId}
PATCH  /api/v2/event-lineup/{eventTeamId}
```

Suggested controllers:

- `TeamParticipationController@show`
- `EventLineupController@show`
- `EventLineupController@update`

Suggested request class:

- `UpdateEventLineupRequest`

Suggested services:

- `BuildTeamParticipationSummary`
- `BuildEventLineup`
- `SaveEventLineup`

## Final Recommendation

Use these APIs for the participation-side flow:

1. `GET /api/v2/team-participation/{eventTeamId}`
2. `GET /api/v2/event-lineup/{eventTeamId}`
3. `PATCH /api/v2/event-lineup/{eventTeamId}`

Reuse instead of duplicating:

1. existing Games API
2. existing Event Details / Standings API

This is the cleanest fit for the current UI and your existing backend direction.
