# Game Lineup Submission API Contract Design

This document defines the API contract for the game lineup submission popup used on the scoresheet screen.

This contract is intentionally separate from:

- `docs/team-participation-api-contract.md`
- `docs/scoresheet-api-contract.md`

The responsibilities are different:

- Event Lineup API
  - reusable event-level lineup template
- Game Lineup Submission API
  - one game-specific lineup
  - starters, bench, substitutions, batting order, field positions
  - submission / approval / rejection / finalization metadata
- Scoresheet API
  - batting appearances, upload/review, publish flow

## Recommended Endpoint Set

1. `GET /api/v2/game-lineup-submission/{eventTeamGameId}`
2. `PATCH /api/v2/game-lineup-submission/{eventTeamGameId}`

Recommended related reuse:

- existing Game Details API for game header context
- existing Event Lineup API as the source template when no game lineup exists yet

## Why This Split

- The popup manages lineup-specific actions, not batting ledger edits.
- The user edits multiple rows together before saving.
- Substitution setup affects multiple lineup rows at once.
- This is better modeled as one game-lineup document save, not per-row micro endpoints.

## 1. Game Lineup Submission Read API

### `GET /api/v2/game-lineup-submission/{eventTeamGameId}`

Purpose:

- Load the current game-specific lineup for the popup.
- If no game lineup has been submitted yet, return `template_lineup` from `event_team_lineup` so the first game lineup can be created.
- Always return the submission header when it exists so the UI can reflect status immediately.

Primary table sources based on your schema notes:

- `game_lineup_submission`
- `game_lineup_players`
- `event_team_lineup`

Supporting lookups:

- field positions config for the sport/variant if stored elsewhere

### Suggested response

```json
{
  "event_team_game_id": 9101,
  "event_team_id": 321,
  "event_id": 77,
  "team_id": 44,
  "division_id": 12,
  "tournament_game_id": 501,
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

### Read behavior notes

- `has_existing_submission` should explicitly indicate whether the returned `players` rows are persisted game rows or first-load bootstrap rows.
- `submission` may be `null` if no game-specific lineup exists yet.
- lineup submission is required before scoresheet/stat tracking can proceed.
- `field_config` should come from:
  - field configuration header table for `name`
  - `field_config_position` for the positions array
- `positions[].position_name` should be the canonical key that matches `game_lineup_players.position_code`
- if no game-specific lineup exists yet:
  - `has_existing_submission = false`
  - `submission = null`
  - `template_lineup` should be returned
  - frontend should initialize the popup from `template_lineup`
  - scoresheet/stat tracking should remain blocked until save
- if a game-specific lineup already exists:
  - `has_existing_submission = true`
  - return `submission`
  - return `players`
  - do not return `template_lineup`
- `replaces_game_lineup_player_id` is strongly recommended.
  - It is safer than inferring substitutions only from shared batting order.
- `team_member_id = null` means the player row is manual/unlinked.

### First-time example

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
    }
  ]
}
```

### Existing-submission example

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
    }
  ]
}
```

## 2. Game Lineup Submission Save API

### `PATCH /api/v2/game-lineup-submission/{eventTeamGameId}`

Purpose:

- Create or update the full game lineup submission.
- Save all lineup rows from the popup in one transaction.
- Persist substitutions, bench status, batting order, field positions, and submission metadata.

### Suggested request

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
    },
    {
      "id": 1011,
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

### Suggested response

Return the saved game lineup state:

```json
{
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

### Validation rules

- header:
  - `id` nullable numeric
  - `tournament_game_id` required numeric
  - `tournament_game_score_id` nullable numeric if not available yet
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
  - `players` required array, minimum 1
  - `id` nullable numeric
  - `event_team_lineup_id` nullable numeric
  - `team_member_id` nullable numeric
  - `user_id` nullable numeric
  - `player_name` required string
  - `jersey_number` nullable string
  - `player_source_type` required and one of `0,1,2,3,4`
  - `batting_order` required integer `>= 1`
  - `position_code` nullable string
  - `is_starter` required boolean
  - `is_bench` required boolean
  - `is_substitute` required boolean
  - `is_active` required boolean
  - `entered_inning` nullable integer `>= 1`
  - `exited_inning` nullable integer `>= 1`
  - `replaces_game_lineup_player_id` nullable numeric

## Save Behavior Rules

- Route scope identifies the target by:
  - `tournament_game_id` from path
  - `team_id` from query
- Request body `id` is the existing `game_lineup_submission.id`
- On first save:
  - `id` should be `null` or omitted
  - backend should create a new submission for that `tournament_game_id + team_id`
- On later saves:
  - `id` should contain the existing `game_lineup_submission.id`
  - backend should update that submission within the same scoped context
- Treat the popup save as a full-list synchronized save for one game lineup submission.
- Save the submission header and all players in one transaction.
- Omitted existing player rows should be deleted or soft-archived according to audit policy.
- Preserve explicit `batting_order`.
- Preserve explicit `position_code`.
- Preserve bench vs starter state.

Substitution rules:

- The original player being replaced should generally have:
  - `is_active = false`
  - `exited_inning = n`
- The substitute row should generally have:
  - `is_substitute = true`
  - `is_active = true`
  - `entered_inning = n`
  - `replaces_game_lineup_player_id = replaced player's row id`
- A substitute should typically inherit the replaced player’s `batting_order`.

Linking rules:

- `event_team_lineup_id`
  - links back to the reusable event lineup row when applicable
- `team_member_id`
  - canonical teammate/roster link when the player is tied to a known team member
- `team_member_id = null`
  - means manual/unlinked player row

### First-time save example

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

### Update save example

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

## Submission Status Codes

- `0` = draft
- `1` = submitted
- `2` = approved
- `3` = rejected
- `4` = finalized

## Approval Mode Codes

- `0` = auto
- `1` = manual

## Player Source Type Codes

- `0` = manual
- `1` = team_member
- `2` = invited_member
- `3` = association_entered
- `4` = uploaded_scoresheet

## Suggested UI Flow

1. Scoresheet screen opens
   - fetch game metadata from existing Game Details API
   - fetch scoresheet-specific data from Scoresheet API

2. User opens Manage Game Lineup popup
   - `GET /api/v2/game-lineup-submission/{eventTeamGameId}`

3. User reorders starters / benches player / applies substitute / changes field position
   - changes stay local in popup until save

4. User clicks Save / Approve lineup
   - `PATCH /api/v2/game-lineup-submission/{eventTeamGameId}`

5. On successful save
   - update popup state
   - update any scoresheet-side lineup display using the returned saved rows

## Suggested Laravel Surface

Suggested controller methods:

```php
GET    /api/v2/game-lineup-submission/{eventTeamGameId}
PATCH  /api/v2/game-lineup-submission/{eventTeamGameId}
```

Suggested controllers:

- `GameLineupSubmissionController@show`
- `GameLineupSubmissionController@update`

Suggested request classes:

- `UpdateGameLineupSubmissionRequest`

Suggested services:

- `BuildGameLineupSubmissionViewData`
- `SaveGameLineupSubmission`

## Final Recommendation

For the game lineup popup, keep the API surface simple:

1. `GET /api/v2/game-lineup-submission/{eventTeamGameId}`
2. `PATCH /api/v2/game-lineup-submission/{eventTeamGameId}`

That is enough for:

- loading current lineup
- loading event lineup fallback
- managing starters
- benching players
- applying substitutes
- saving approval/submission metadata

This keeps lineup management separate from both event lineup management and scoresheet batting edits.
