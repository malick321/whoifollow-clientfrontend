# Final API Contracts

This file is the schema-aligned backend handoff reference for the current frontend architecture.

It supersedes earlier placeholder naming such as:

- `eventTeamId`
- `eventTeamGameId`

The real identifiers used here are:

- Team Participation side:
  - `event_id`
  - `team_id`
  - `tournament_id`
- Scoresheet side:
  - `tournament_game_id`
  - `team_id`

Reason:

- one `tournament_games.id` represents the whole game
- lineup submission and scoresheet are team-specific within that game

## Team Participation APIs

### 1. Team Participation Summary

Endpoint:

```txt
GET /api/v2/team-participation?event_id={eventId}&team_id={teamId}&tournament_id={tournamentId}
```

Purpose:

- Load the non-game, non-standings, non-editable-lineup data for the Team Participation screen.
- Feed the hero section, manager card, and lineup summary card.

Primary table sources:

- `association_teams`
- `team_events`
- `event_tournaments`
- `event_team_lineup` for lineup summary only

Suggested response:

```json
{
  "team_id": 44,
  "event_id": 77,
  "tournament_id": 12,
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

Field notes:

- `team_id`
  - canonical team identifier for reuse with other APIs
- `event_id`
  - canonical event identifier
- `tournament_id`
  - selected division/tournament identifier used by games and standings APIs
- `participation_status`
  - app-facing derived state like:
    - `confirmed`
    - `awaiting-lineup`
    - `under-review`
- `event_overview.lineup_summary`
  - short string shown above the weather/overview area

Read behavior notes:

- this endpoint should not return:
  - games list
  - standings
  - full `event_team_lineup[]`
- those are intentionally fetched from separate APIs

### 2. Event Lineup Read

Endpoint:

```txt
GET /api/v2/event-lineup?event_id={eventId}&team_id={teamId}
```

Purpose:

- Load the full editable event lineup only when the modal opens.

Primary table sources:

- `event_team_lineup`
- optionally `team_members` / `users` for display enrichment

Suggested response:

```json
{
  "team_id": 44,
  "event_id": 77,
  "tournament_id": 12,
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

Field notes:

- `id`
  - unique `event_team_lineup.id`
- `team_member_id`
  - canonical roster link
- `team_member_id = null`
  - manual/unlinked row

Read behavior notes:

- order rows by `batting_order`
- return all rows needed by the modal

### 3. Event Lineup Save

Endpoint:

```txt
PATCH /api/v2/event-lineup?event_id={eventId}&team_id={teamId}
```

Purpose:

- Save the full editable lineup from the Team Participation modal.

Primary table source:

- `event_team_lineup`

Suggested request:

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

Suggested response:

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
    }
  ]
}
```

Validation rules:

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

Behavior notes:

- treat save as full-list sync for `event_team_lineup`
- persist `team_member_id` when present
- if `team_member_id` is null, treat as manual/unlinked

## Reused Team Participation APIs

### 4. Games API

Endpoint:

```txt
GET /api/v2/games?event_id={eventId}&tournament_id={tournamentId}&team_id={teamId}
```

Purpose:

- fetch only games relevant to the viewed team in the selected tournament/event

Primary table sources:

- `tournament_games`
- `game_lineup_submission` for lineup submitted flag
- scoresheet-related tables for scoresheet status on cards

Suggested response shape per game:

```json
[
  {
    "id": 501,
    "bracket_label": "Pool 1",
    "game_time": "Fri Apr 19, 11:00 AM",
    "date_label": "Fri, April 19, 2025",
    "time_label": "11:00 AM",
    "field": "Field 1",
    "facility_label": "Homefield Baseball Complex",
    "division_label": "Men's 75+ Major",
    "opponent": "Vegas Boyz",
    "opponent_seed": "#1",
    "team_seed": "#4",
    "score_for": 2,
    "score_against": 5,
    "status": "final",
    "status_note": null,
    "badge_count": 1,
    "lineup_submitted": true,
    "scoresheet_status": "mapped"
  }
]
```

Field notes:

- `lineup_submitted`
  - derived from `game_lineup_submission`
- `scoresheet_status`
  - used by the cards and the summary counter

Read behavior notes:

- the summary cards on the Team Participation screen are computed on Vue side from this array:
  - total games
  - total won
  - total lost
  - active games
  - statistics count

### 5. Standings / Event Details API

Purpose:

- fetch standings, tie-breaker text, format text, podium data

Primary table sources:

- `event_tournaments`
- `tournament_teams`
- `tournament_seed_criteria`
- fallback to `team_events` when tournament-level values are null

Read behavior notes:

- if tournament-level seed criteria is missing, inherit from `team_events`
- if tournament-level format is missing, inherit from `team_events`

## Game Lineup Submission APIs

### 6. Game Lineup Read

Endpoint:

```txt
GET /api/v2/game-lineup-submission/{tournamentGameId}?team_id={teamId}
```

Purpose:

- Load the current game-specific lineup for the popup.
- If no game lineup exists yet, return `template_lineup` from `event_team_lineup` so the first game lineup can be created.
- Always return the submission header when it exists so the UI can reflect status immediately.

Primary table sources:

- `game_lineup_submission`
- `game_lineup_players`
- `event_team_lineup`

Suggested response:

```json
{
  "tournament_game_id": 501,
  "team_id": 44,
  "has_existing_submission": true,
  "sport_type_id": 1,
  "field_config": {
    "name": "Slow Pitch 10 Player",
    "positions": [
      {
        "position_name": "P",
        "position_number": 1,
        "x_axis": 50.0,
        "y_axis": 78.0,
        "status": 1
      },
      {
        "position_name": "C",
        "position_number": 2,
        "x_axis": 50.0,
        "y_axis": 92.0,
        "status": 1
      }
    ]
  },
  "submission": {
    "id": 101,
    "tournament_game_id": 501,
    "tournament_game_score_id": 9001,
    "team_id": 44,
    "sport_type_id": 1,
    "submission_status": 2,
    "approval_mode": 1,
    "submitted_by_user_id": 12,
    "submitted_at": "2025-04-19T16:40:00Z",
    "approved_by_user_id": 12,
    "approved_at": "2025-04-19T16:45:00Z",
    "rejected_by_user_id": null,
    "rejected_at": null,
    "rejection_reason": null,
    "source_type": "copied_from_event_lineup",
    "notes": "Approved automatically for the game lineup workflow."
  },
  "players": [
    {
      "id": 1001,
      "game_lineup_submission_id": 101,
      "event_team_lineup_id": 1,
      "team_member_id": 888,
      "user_id": 12,
      "player_name": "John Smith",
      "jersey_number": "4",
      "player_source_type": 1,
      "batting_order": 1,
      "position_code": "P",
      "is_starter": true,
      "is_bench": false,
      "is_substitute": false,
      "is_active": true,
      "entered_inning": null,
      "exited_inning": null,
      "replaces_game_lineup_player_id": null
    }
  ]
}
```

Field notes:

- `has_existing_submission`
  - explicit boolean telling frontend whether the lineup came from saved game rows or a bootstrap fallback
- `replaces_game_lineup_player_id`
  - explicit substitute linkage
- `team_member_id = null`
  - manual/unlinked player row

Read behavior notes:

- frontend should always call this same endpoint when the popup opens
- backend should decide whether to return:
  - saved game lineup rows
  - or `template_lineup` derived from `event_team_lineup`
- `submission` may be `null` on first load
- lineup submission is required before scoresheet/stat tracking can proceed
- `field_config` should match the actual field configuration tables:
  - header from the field configuration main table
  - positions from `field_config_position`
- if no game-specific lineup exists yet:
  - `has_existing_submission = false`
  - `submission = null`
  - `template_lineup` should be returned
  - frontend should initialize the popup from `template_lineup`
  - scoresheet/stat tracking should remain blocked until the lineup is saved
- if a game-specific lineup already exists:
  - `has_existing_submission = true`
  - return `submission`
  - return `players`
  - do not return `template_lineup`

First-time example:

```json
{
  "tournament_game_id": 501,
  "team_id": 44,
  "has_existing_submission": false,
  "sport_type_id": 1,
  "field_config": {
    "name": "Slow Pitch 10 Player",
    "positions": [
      {
        "position_name": "P",
        "position_number": 1,
        "x_axis": 50.0,
        "y_axis": 78.0,
        "status": 1
      },
      {
        "position_name": "C",
        "position_number": 2,
        "x_axis": 50.0,
        "y_axis": 92.0,
        "status": 1
      }
    ]
  },
  "submission": null,
  "template_lineup": [
    {
      "id": 1,
      "team_member_id": 888,
      "user_id": 12,
      "player_name": "John Smith",
      "jersey_number": "4",
      "player_source_type": 1,
      "batting_order": 1,
      "position_code": "P",
      "is_starter": true,
      "is_bench": false,
      "is_substitute": false,
      "is_active": true,
      "entered_inning": null,
      "exited_inning": null,
      "replaces_game_lineup_player_id": null
    },
    {
      "id": 11,
      "team_member_id": null,
      "user_id": null,
      "player_name": "Bobby Luna",
      "jersey_number": "44",
      "player_source_type": 0,
      "batting_order": 11,
      "position_code": "EH",
      "is_starter": false,
      "is_bench": true,
      "is_substitute": false,
      "is_active": false,
      "entered_inning": null,
      "exited_inning": null,
      "replaces_game_lineup_player_id": null
    }
  ]
}
```

Existing-submission example:

```json
{
  "tournament_game_id": 501,
  "team_id": 44,
  "has_existing_submission": true,
  "sport_type_id": 1,
  "field_config": {
    "name": "Slow Pitch 10 Player",
    "positions": [
      {
        "position_name": "P",
        "position_number": 1,
        "x_axis": 50.0,
        "y_axis": 78.0,
        "status": 1
      },
      {
        "position_name": "C",
        "position_number": 2,
        "x_axis": 50.0,
        "y_axis": 92.0,
        "status": 1
      }
    ]
  },
  "submission": {
    "id": 101,
    "tournament_game_id": 501,
    "tournament_game_score_id": 9001,
    "team_id": 44,
    "sport_type_id": 1,
    "submission_status": 2,
    "approval_mode": 0,
    "submitted_by_user_id": 12,
    "submitted_at": "2025-04-19T16:40:00Z",
    "approved_by_user_id": 12,
    "approved_at": "2025-04-19T16:40:00Z",
    "rejected_by_user_id": null,
    "rejected_at": null,
    "rejection_reason": null,
    "source_type": "copied_from_event_lineup",
    "notes": "Auto-approved game lineup."
  },
  "players": [
    {
      "id": 1001,
      "game_lineup_submission_id": 101,
      "event_team_lineup_id": 1,
      "team_member_id": 888,
      "user_id": 12,
      "player_name": "John Smith",
      "jersey_number": "4",
      "player_source_type": 1,
      "batting_order": 1,
      "position_code": "P",
      "is_starter": true,
      "is_bench": false,
      "is_substitute": false,
      "is_active": true,
      "entered_inning": null,
      "exited_inning": null,
      "replaces_game_lineup_player_id": null
    },
    {
      "id": 1011,
      "game_lineup_submission_id": 101,
      "event_team_lineup_id": null,
      "team_member_id": null,
      "user_id": null,
      "player_name": "Bobby Luna",
      "jersey_number": "44",
      "player_source_type": 0,
      "batting_order": 5,
      "position_code": "C",
      "is_starter": false,
      "is_bench": false,
      "is_substitute": true,
      "is_active": true,
      "entered_inning": 6,
      "exited_inning": null,
      "replaces_game_lineup_player_id": 1005
    }
  ]
}
```

### 7. Game Lineup Save

Endpoint:

```txt
PATCH /api/v2/game-lineup-submission/{tournamentGameId}?team_id={teamId}
```

Purpose:

- Upsert the full lineup popup in one transaction.
- Use the same endpoint for first-time creation and later updates.

Primary table sources:

- `game_lineup_submission`
- `game_lineup_players`

Suggested request:

```json
{
  "id": null,
  "tournament_game_id": 501,
  "tournament_game_score_id": 9001,
  "team_id": 44,
  "sport_type_id": 1,
  "submission_status": 2,
  "approval_mode": 1,
  "source_type": "copied_from_event_lineup",
  "submitted_at": "2025-04-19T16:40:00Z",
  "approved_at": "2025-04-19T16:45:00Z",
  "rejection_reason": null,
  "notes": "Approved automatically for the game lineup workflow.",
  "players": [
    {
      "id": 1001,
      "event_team_lineup_id": 1,
      "team_member_id": 888,
      "user_id": 12,
      "player_name": "John Smith",
      "jersey_number": "4",
      "player_source_type": 1,
      "batting_order": 1,
      "position_code": "P",
      "is_starter": true,
      "is_bench": false,
      "is_substitute": false,
      "is_active": true,
      "entered_inning": null,
      "exited_inning": null,
      "replaces_game_lineup_player_id": null
    }
  ]
}
```

Suggested response:

```json
{
  "submission": {
    "id": 101,
    "tournament_game_id": 501,
    "team_id": 44,
    "submission_status": 2,
    "approval_mode": 1,
    "source_type": "copied_from_event_lineup",
    "submitted_at": "2025-04-19T16:40:00Z",
    "approved_at": "2025-04-19T16:45:00Z",
    "notes": "Approved automatically for the game lineup workflow."
  },
  "players": [
    {
      "id": 1001,
      "game_lineup_submission_id": 101,
      "event_team_lineup_id": 1,
      "team_member_id": 888,
      "player_name": "John Smith",
      "jersey_number": "4",
      "batting_order": 1,
      "position_code": "P",
      "is_starter": true,
      "is_bench": false,
      "is_substitute": false,
      "is_active": true,
      "entered_inning": null,
      "exited_inning": null,
      "replaces_game_lineup_player_id": null
    }
  ]
}
```

Validation rules:

- header:
  - `id` nullable numeric
  - `tournament_game_id` required numeric
  - `team_id` required numeric
  - `sport_type_id` required numeric
  - `submission_status` required and one of `0,1,2,3,4`
  - `approval_mode` required and one of `0,1`
  - `source_type` required and one of:
    - `manual`
    - `scoresheet_upload`
    - `system_generated`
    - `ball_by_ball_derived`
    - `copied_from_event_lineup`
- players:
  - `players` required array
  - `id` nullable numeric
  - `event_team_lineup_id` nullable numeric
  - `team_member_id` nullable numeric
  - `player_name` required string
  - `jersey_number` nullable string
  - `batting_order` required integer `>= 1`
  - `position_code` nullable string
  - `is_starter` required boolean
  - `is_bench` required boolean
  - `is_substitute` required boolean
  - `is_active` required boolean
  - `entered_inning` nullable integer `>= 1`
  - `exited_inning` nullable integer `>= 1`
  - `replaces_game_lineup_player_id` nullable numeric

Behavior notes:

- route scope identifies the target by:
  - `tournament_game_id` from path
  - `team_id` from query
- request body `id` is the existing `game_lineup_submission.id`
- on first save:
  - `id` should be `null` or omitted
  - backend should create a new submission for that `tournament_game_id + team_id`
- on later saves:
  - `id` should contain the existing `game_lineup_submission.id`
  - backend should update that submission within the same scoped context
- full popup save in one transaction
- substitutions should use `replaces_game_lineup_player_id`
- after successful save, game lineup submission becomes the required source for scoresheet/stat tracking

First-time save example:

```json
{
  "id": null,
  "tournament_game_id": 501,
  "tournament_game_score_id": 9001,
  "team_id": 44,
  "sport_type_id": 1,
  "submission_status": 2,
  "approval_mode": 0,
  "source_type": "copied_from_event_lineup",
  "submitted_at": "2025-04-19T16:40:00Z",
  "approved_at": "2025-04-19T16:40:00Z",
  "rejection_reason": null,
  "notes": "Auto-approved game lineup.",
  "players": [
    {
      "id": null,
      "event_team_lineup_id": 1,
      "team_member_id": 888,
      "user_id": 12,
      "player_name": "John Smith",
      "jersey_number": "4",
      "player_source_type": 1,
      "batting_order": 1,
      "position_code": "P",
      "is_starter": true,
      "is_bench": false,
      "is_substitute": false,
      "is_active": true,
      "entered_inning": null,
      "exited_inning": null,
      "replaces_game_lineup_player_id": null
    }
  ]
}
```

Update save example:

```json
{
  "id": 101,
  "tournament_game_id": 501,
  "tournament_game_score_id": 9001,
  "team_id": 44,
  "sport_type_id": 1,
  "submission_status": 2,
  "approval_mode": 0,
  "source_type": "copied_from_event_lineup",
  "submitted_at": "2025-04-19T16:40:00Z",
  "approved_at": "2025-04-19T16:40:00Z",
  "rejection_reason": null,
  "notes": "Auto-approved game lineup.",
  "players": [
    {
      "id": 1001,
      "event_team_lineup_id": 1,
      "team_member_id": 888,
      "user_id": 12,
      "player_name": "John Smith",
      "jersey_number": "4",
      "player_source_type": 1,
      "batting_order": 1,
      "position_code": "P",
      "is_starter": true,
      "is_bench": false,
      "is_substitute": false,
      "is_active": true,
      "entered_inning": null,
      "exited_inning": null,
      "replaces_game_lineup_player_id": null
    }
  ]
}
```

## Scoresheet APIs

### 8. Scoresheet Read

Endpoint:

```txt
GET /api/v2/scoresheet/{tournamentGameId}?team_id={teamId}
```

Purpose:

- Load scoresheet-specific state only.
- Official game metadata should come from the existing Game Details API.

Primary table sources:

- scoresheet upload tables
- batting appearance table
- batting stats table
- `event_team_lineup` for mapping/reference options

Suggested response:

```json
{
  "tournament_game_id": 501,
  "team_id": 44,
  "event_id": 77,
  "tournament_id": 12,
  "scoresheet_upload": {
    "status": "review",
    "source_image_name": "sheet-2025-04-19.jpg",
    "extraction_confidence": 92,
    "notes": "Uploaded image is ready for mapping review before team stats publish.",
    "review_items": [
      {
        "id": "r1",
        "title": "Upload captured",
        "detail": "Handwritten sheet is attached and OCR is staged for review.",
        "tone": "success"
      }
    ]
  },
  "field_config": {
    "name": "Slow Pitch 10 Player",
    "positions": [
      {
        "position_name": "P",
        "position_number": 1,
        "x_axis": 50.0,
        "y_axis": 78.0,
        "status": 1
      }
    ]
  },
  "event_lineup_options": [
    {
      "id": 1,
      "team_member_id": 888,
      "jersey_number": "4",
      "player_name": "John Smith",
      "position_code": "P",
      "status": "active"
    }
  ],
  "batting_appearances": [
    {
      "id": 7001,
      "tournament_game_id": 501,
      "team_id": 44,
      "game_lineup_player_id": 1001,
      "inning_number": 1,
      "plate_appearance_no_for_player": 1,
      "result_code": "1B",
      "batter_end_base": "1B",
      "result_detail": "Single into the outfield gap.",
      "rbi": 0
    }
  ],
  "batting_stats": [
    {
      "id": 8001,
      "tournament_game_id": 501,
      "team_id": 44,
      "game_lineup_player_id": 1001,
      "plate_appearances": 4,
      "at_bats": 3,
      "runs": 1,
      "hits": 2,
      "rbi": 1,
      "walks": 1,
      "strikeouts": 0
    }
  ]
}
```

Read behavior notes:

- do not duplicate game header metadata if already provided by Game Details API
- `batting_stats` should still be returned even if fully derived
- `field_config` should be consistent with your tables:
  - `field_config.name` from the field configuration header table
  - `field_config.positions[]` from `field_config_position`

Field config object recommendation:

```json
{
  "field_config": {
    "name": "Slow Pitch 10 Player",
    "positions": [
      {
        "position_name": "P",
        "position_number": 1,
        "x_axis": 50.0,
        "y_axis": 78.0,
        "status": 1
      },
      {
        "position_name": "C",
        "position_number": 2,
        "x_axis": 50.0,
        "y_axis": 92.0,
        "status": 1
      }
    ]
  }
}
```

Field notes:

- `field_config.name`
  - admin-facing configuration name like `10 Player` or `11 Player`
- `positions[].position_name`
  - canonical position key and the value that should match `game_lineup_players.position_code`
- `positions[].position_number`
  - ordering/index if used by your field drawing logic
- `positions[].x_axis`, `positions[].y_axis`
  - coordinate values used to place markers on the field image
- `positions[].status`
  - active/inactive row state if applicable

Optional notes:

- `field_config.id` is optional and only needed if the client must reference a specific configuration row later
- `positions[].id` and `positions[].field_configuration_id` are optional for the current lineup/scoresheet flows

### 9. Plate Appearance Create

Endpoint:

```txt
POST /api/v2/scoresheet/{tournamentGameId}/plate-appearances?team_id={teamId}
```

Purpose:

- Create one batting appearance and recompute the affected player stats.

Primary table sources:

- batting appearance table
- batting stats table
- `sport_result_codes`

Suggested request:

```json
{
  "game_lineup_player_id": 1001,
  "inning_number": 1,
  "plate_appearance_no_for_player": 1,
  "result_code": "1B",
  "batter_end_base": "1B",
  "result_detail": "Single into the outfield gap.",
  "rbi": 0,
  "which_out": null,
  "pitch_type": null
}
```

Suggested response:

```json
{
  "appearance": {
    "id": 7001,
    "tournament_game_id": 501,
    "team_id": 44,
    "game_lineup_player_id": 1001,
    "inning_number": 1,
    "plate_appearance_no_for_player": 1,
    "result_code": "1B",
    "batter_end_base": "1B",
    "result_detail": "Single into the outfield gap.",
    "rbi": 0
  },
  "player_stats": {
    "game_lineup_player_id": 1001,
    "at_bats": 3,
    "runs": 1,
    "hits": 2,
    "rbi": 1,
    "stolen_bases": 0,
    "walks": 1,
    "strikeouts": 0
  }
}
```

Validation rules:

- `game_lineup_player_id` required numeric
- `inning_number` required integer `>= 1`
- `plate_appearance_no_for_player` required integer `>= 1`
- `result_code` required and must exist in `sport_result_codes`
- `batter_end_base` nullable and one of:
  - `1B`
  - `2B`
  - `3B`
  - `HP`
- `rbi` required integer `>= 0`
- `which_out` nullable integer
- `pitch_type` nullable string

Behavior notes:

- mutate only one appearance
- recompute affected player stats immediately

### 10. Plate Appearance Update

Endpoint:

```txt
PATCH /api/v2/scoresheet/{tournamentGameId}/plate-appearances/{appearanceId}?team_id={teamId}
```

Purpose:

- Update one batting appearance and recompute the affected player stats.

Primary table sources:

- batting appearance table
- batting stats table

Suggested request:

```json
{
  "result_code": "2B",
  "batter_end_base": "2B",
  "result_detail": "Driven to the gap for two bases.",
  "rbi": 1,
  "which_out": null,
  "pitch_type": null
}
```

Suggested response:

```json
{
  "appearance": {
    "id": 7001,
    "tournament_game_id": 501,
    "team_id": 44,
    "game_lineup_player_id": 1001,
    "inning_number": 1,
    "plate_appearance_no_for_player": 1,
    "result_code": "2B",
    "batter_end_base": "2B",
    "result_detail": "Driven to the gap for two bases.",
    "rbi": 1
  },
  "player_stats": {
    "game_lineup_player_id": 1001,
    "at_bats": 3,
    "runs": 1,
    "hits": 2,
    "rbi": 2,
    "stolen_bases": 0,
    "walks": 1,
    "strikeouts": 0
  }
}
```

Validation rules:

- same field rules as create, except only changed fields need to be sent

### 11. Plate Appearance Delete

Endpoint:

```txt
DELETE /api/v2/scoresheet/{tournamentGameId}/plate-appearances/{appearanceId}?team_id={teamId}
```

Purpose:

- Delete one batting appearance and recompute the affected player stats.

Primary table sources:

- batting appearance table
- batting stats table

Suggested response:

```json
{
  "deleted_id": 7001,
  "game_lineup_player_id": 1001,
  "player_stats": {
    "game_lineup_player_id": 1001,
    "at_bats": 2,
    "runs": 1,
    "hits": 1,
    "rbi": 0,
    "stolen_bases": 0,
    "walks": 1,
    "strikeouts": 0
  }
}
```

Behavior notes:

- delete only one appearance
- recompute affected player stats immediately

### 12. Scoresheet Upload

Endpoint:

```txt
POST /api/v2/scoresheet/{tournamentGameId}/upload?team_id={teamId}
```

Purpose:

- accept handwritten scoresheet upload
- create/update upload review state

Primary table sources:

- `scoresheet_uploads`
- `scoresheet_upload_review_items`

Request:

- `multipart/form-data`
- file field name: `file`

Suggested response:

- return updated scoresheet read payload or at minimum updated:
  - `scoresheet_upload`
  - `review_items`

Validation rules:

- `file` required
- allow at least:
  - `image/jpeg`
  - `image/png`
  - `image/webp`
  - optionally `application/pdf`

### 13. Scoresheet Publish

Endpoint:

```txt
POST /api/v2/scoresheet/{tournamentGameId}/publish?team_id={teamId}
```

Purpose:

- finalize reviewed batting data for one team in one game

Primary table sources:

- batting appearance table
- batting stats table
- upload/review tables

Suggested request:

```json
{}
```

Suggested response:

- return updated scoresheet read payload or at minimum updated publish status plus final stats

Behavior notes:

- validate review blockers
- recompute final stats
- set publish state

## Reused Scoresheet APIs

### 14. Game Details API

Purpose:

- provide official game metadata for the scoresheet page header

Should provide:

- team vs team
- division / game name
- game date/time
- venue
- inning-by-inning line score
- live/current inning if available

## Schema Changes Recommended

### Strongly recommended

1. Add `replaces_game_lineup_player_id` to `game_lineup_players`
2. Add a uniqueness rule for event lineup rows
3. Add a uniqueness rule for per-player plate appearance sequencing

Recommended logical uniqueness:

```txt
(tournament_game_id, team_id, game_lineup_player_id, inning_number, plate_appearance_no_for_player)
```

### Only if not already present

1. `scoresheet_uploads`
2. `scoresheet_upload_review_items`
3. `game_batting_stats` if you want cached derived stats

### Not recommended

1. Do not introduce a synthetic `eventTeamGameId` if `tournament_game_id + team_id` already identifies the team-side record
