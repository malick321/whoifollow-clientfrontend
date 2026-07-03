# Scoresheet API Contract Design

This document defines the proposed backend API contract for the scoresheet workflow currently implemented by the frontend in this workspace.

This version reflects the refined architecture decision:

- reuse the existing Game Details API for game metadata
- keep Game Lineup Submission as a separate API
- load the scoresheet once in full
- save plate appearances incrementally per record

It is designed for Laravel `/api/v2` APIs and is based on the frontend contract already present in:

- `src/api/contracts/scoresheet.ts`
- `src/api/payloads/scoresheet.ts`
- `src/api/adapters/scoresheet.ts`
- `src/api/team.ts`

Where schema details are not yet available, this document marks those points as inferred so the backend team can align them to the real database.

## Goals

- Support uploaded handwritten scoresheet review.
- Support incremental create/update/delete of batting appearances.
- Support derived batting totals from batting appearances.
- Return one normalized scoresheet payload for the scoresheet-specific state only.
- Keep lineup submission separate from scoresheet editing.
- Keep publish/finalize behavior explicit.

## Route Namespace

Base prefix:

```txt
/api/v2/scoresheet/{eventTeamGameId}
```

Recommended route set:

1. `GET /api/v2/scoresheet/{eventTeamGameId}`
2. `POST /api/v2/scoresheet/{eventTeamGameId}/plate-appearances`
3. `PATCH /api/v2/scoresheet/{eventTeamGameId}/plate-appearances/{appearanceId}`
4. `DELETE /api/v2/scoresheet/{eventTeamGameId}/plate-appearances/{appearanceId}`
5. `POST /api/v2/scoresheet/{eventTeamGameId}/upload`
6. `POST /api/v2/scoresheet/{eventTeamGameId}/publish`

Related APIs outside this document:

1. existing Game Details API
2. separate Game Lineup Submission API

The intended load/edit flow is:

1. fetch game metadata from the existing Game Details API
2. fetch scoresheet-specific state from `GET /api/v2/scoresheet/{eventTeamGameId}`
3. create/update/delete single plate appearances through dedicated endpoints
4. upload and publish through scoresheet workflow endpoints

## What This API Owns

This scoresheet API should own only scoresheet-specific data:

- scoresheet upload/review state
- review items
- field config if scoring-specific
- event lineup options used for mapping/reference
- batting appearances
- batting stats

This scoresheet API should not duplicate game metadata already owned by the Game Details API:

- team vs opponent header
- event name
- division
- bracket/game label
- game time
- venue
- inning-by-inning game line score
- live/final game status, if already available from Game Details API

## APIs To Reuse

### Existing Game Details API

This should remain the source for:

- matchup header
- division/game title
- game date/time
- venue
- team/opponent labels
- inning-by-inning line score
- current inning / live state, if already exposed there

### Separate Game Lineup Submission API

This should remain separate from the scoresheet API.

It should own:

- game lineup submission status
- game lineup players
- approval/rejection/finalization flow

The scoresheet screen can consume lineup data from that separate API or from whatever consolidated read model the frontend uses, but the write contract should remain separate.

## Primary Read Endpoint

### `GET /api/v2/scoresheet/{eventTeamGameId}`

Purpose:

- Returns scoresheet-specific state for initial page load.
- Returns both editable batting appearance records and derived batting totals.

Response shape:

```json
{
  "event_team_game_id": 9101,
  "event_team_id": 321,
  "event_id": 77,
  "team_id": 44,
  "division_id": 12,
  "tournament_game_id": 501,
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
      { "code": "P", "label": "Pitcher", "area": "battery" },
      { "code": "C", "label": "Catcher", "area": "battery" }
    ]
  },
  "event_lineup_options": [
    {
      "id": "1",
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
      "sport_type_id": 1,
      "game_lineup_player_id": 1001,
      "pitcher_lineup_player_id": null,
      "inning_number": 1,
      "inning_half": "top",
      "batting_sequence_no": 1,
      "plate_appearance_no_for_player": 1,
      "outs_before": 0,
      "outs_after": 0,
      "result_code": "1B",
      "result_detail": "Single into the outfield gap.",
      "counts_as_at_bat": true,
      "counts_as_plate_appearance": true,
      "is_on_base": true,
      "rbi": 0,
      "run_scored": false,
      "is_earned_run": null,
      "source_type": "manual",
      "entered_by_user_id": 12,
      "created_at": "2025-04-19T16:50:00Z",
      "updated_at": "2025-04-19T16:50:00Z"
    }
  ],
  "batting_stats": [
    {
      "id": 8001,
      "tournament_game_id": 501,
      "team_id": 44,
      "sport_type_id": 1,
      "game_lineup_player_id": 1001,
      "plate_appearances": 4,
      "at_bats": 3,
      "runs": 1,
      "hits": 2,
      "rbi": 1,
      "walks": 1,
      "strikeouts": 0,
      "left_on_base": 1,
      "result_counts_json": {
        "1B": 1,
        "2B": 1,
        "BB": 1
      },
      "source_type": "derived_from_pa",
      "is_locked": false,
      "created_at": "2025-04-19T16:50:00Z",
      "updated_at": "2025-04-19T17:10:00Z"
    }
  }
}
```

### Read Behavior Notes

- The Game Details API should provide the page header and official game metadata.
- `event_lineup_options` is used for mapping/reference on the scoresheet side.
- `batting_stats` should be returned even if fully derived, so the frontend can render totals directly.
- `scoresheet_upload.review_items` is presentation-oriented and may be computed from unresolved OCR/mapping issues.

## Plate Appearance Create API

### `POST /api/v2/scoresheet/{eventTeamGameId}/plate-appearances`

Purpose:

- Create one batting appearance.
- Recompute affected batting stats immediately after create.

Suggested request:

```json
{
  "game_lineup_player_id": 1001,
  "inning_number": 1,
  "inning_half": "top",
  "batting_sequence_no": 1,
  "plate_appearance_no_for_player": 1,
  "result_code": "1B",
  "result_detail": "Single into the outfield gap.",
  "rbi": 0,
  "outs_on_play": 0,
  "contact_type": "Line Drive",
  "baserunning": "Batter to 1B",
  "field_zone": "Left Center",
  "fielders_involved": "LF"
}
```

Suggested response:

```json
{
  "appearance": {
    "id": 7001,
    "tournament_game_id": 501,
    "team_id": 44,
    "sport_type_id": 1,
    "game_lineup_player_id": 1001,
    "pitcher_lineup_player_id": null,
    "inning_number": 1,
    "inning_half": "top",
    "batting_sequence_no": 1,
    "plate_appearance_no_for_player": 1,
    "outs_before": 0,
    "outs_after": 0,
    "result_code": "1B",
    "result_detail": "Single into the outfield gap.",
    "counts_as_at_bat": true,
    "counts_as_plate_appearance": true,
    "is_on_base": true,
    "rbi": 0,
    "run_scored": false,
    "is_earned_run": null,
    "source_type": "manual",
    "entered_by_user_id": 12,
    "created_at": "2025-04-19T16:50:00Z",
    "updated_at": "2025-04-19T16:50:00Z"
  },
  "player_stats": {
    "id": 8001,
    "tournament_game_id": 501,
    "team_id": 44,
    "sport_type_id": 1,
    "game_lineup_player_id": 1001,
    "plate_appearances": 4,
    "at_bats": 3,
    "runs": 1,
    "hits": 2,
    "rbi": 1,
    "walks": 1,
    "strikeouts": 0,
    "left_on_base": 1,
    "result_counts_json": {
      "1B": 1,
      "2B": 1,
      "BB": 1
    },
    "source_type": "derived_from_pa",
    "is_locked": false,
    "created_at": "2025-04-19T16:50:00Z",
    "updated_at": "2025-04-19T17:10:00Z"
  }
}
```

## Plate Appearance Update API

### `PATCH /api/v2/scoresheet/{eventTeamGameId}/plate-appearances/{appearanceId}`

Purpose:

- Update one batting appearance.
- Recompute affected batting stats immediately after update.

Suggested request:

```json
{
  "result_code": "2B",
  "result_detail": "Driven to the gap for two bases.",
  "rbi": 1,
  "outs_on_play": 0,
  "contact_type": "Line Drive",
  "baserunning": "Batter to 2B",
  "field_zone": "Right Center",
  "fielders_involved": "CF"
}
```

Suggested response:

```json
{
  "appearance": {
    "id": 7001,
    "tournament_game_id": 501,
    "team_id": 44,
    "sport_type_id": 1,
    "game_lineup_player_id": 1001,
    "pitcher_lineup_player_id": null,
    "inning_number": 1,
    "inning_half": "top",
    "batting_sequence_no": 1,
    "plate_appearance_no_for_player": 1,
    "outs_before": 0,
    "outs_after": 0,
    "result_code": "2B",
    "result_detail": "Driven to the gap for two bases.",
    "counts_as_at_bat": true,
    "counts_as_plate_appearance": true,
    "is_on_base": true,
    "rbi": 1,
    "run_scored": false,
    "is_earned_run": null,
    "source_type": "manual",
    "entered_by_user_id": 12,
    "created_at": "2025-04-19T16:50:00Z",
    "updated_at": "2025-04-19T17:15:00Z"
  },
  "player_stats": {
    "id": 8001,
    "tournament_game_id": 501,
    "team_id": 44,
    "sport_type_id": 1,
    "game_lineup_player_id": 1001,
    "plate_appearances": 4,
    "at_bats": 3,
    "runs": 1,
    "hits": 2,
    "rbi": 2,
    "walks": 1,
    "strikeouts": 0,
    "left_on_base": 1,
    "result_counts_json": {
      "2B": 2,
      "BB": 1
    },
    "source_type": "derived_from_pa",
    "is_locked": false,
    "created_at": "2025-04-19T16:50:00Z",
    "updated_at": "2025-04-19T17:15:00Z"
  }
}
```

## Plate Appearance Delete API

### `DELETE /api/v2/scoresheet/{eventTeamGameId}/plate-appearances/{appearanceId}`

Purpose:

- Delete one batting appearance.
- Recompute affected batting stats immediately after delete.

Suggested response:

```json
{
  "deleted_id": 7001,
  "game_lineup_player_id": 1001,
  "player_stats": {
    "id": 8001,
    "tournament_game_id": 501,
    "team_id": 44,
    "sport_type_id": 1,
    "game_lineup_player_id": 1001,
    "plate_appearances": 3,
    "at_bats": 2,
    "runs": 1,
    "hits": 1,
    "rbi": 0,
    "walks": 1,
    "strikeouts": 0,
    "left_on_base": 1,
    "result_counts_json": {
      "1B": 1,
      "BB": 1
    },
    "source_type": "derived_from_pa",
    "is_locked": false,
    "created_at": "2025-04-19T16:50:00Z",
    "updated_at": "2025-04-19T17:20:00Z"
  }
}
```

## Plate Appearance Validation Rules

- `game_lineup_player_id` required on create
- `inning_number` required integer `>= 1`
- `result_code` required and must map to `sport_result_codes.code`
- `plate_appearance_no_for_player` required integer `>= 1`
- `batting_sequence_no` nullable or required depending on inning sequencing design
- `result_detail` nullable string
- `rbi` required integer `>= 0`
- `outs_on_play` nullable integer `>= 0`
- `contact_type` nullable string
- `baserunning` nullable string
- `field_zone` nullable string
- `fielders_involved` nullable string

## Plate Appearance Save Rules

- Each mutation should affect only one batting appearance row.
- After each create/update/delete:
  - recompute batting stats for the affected `game_lineup_player_id`
  - optionally recompute team-level batting aggregates if the UI depends on them
- The backend should derive these stored flags from `result_code` when possible:
  - `counts_as_at_bat`
  - `counts_as_plate_appearance`
  - `is_on_base`
- If canonical storage uses `outs_before` and `outs_after`, backend should translate from `outs_on_play` or derive inning state appropriately.
- Recommended uniqueness:
  - `(tournament_game_id, team_id, game_lineup_player_id, inning_number, plate_appearance_no_for_player)`

## Batting Stats Rules

- Batting stats should be backend-derived, not client-authoritative.
- On appearance mutation, recompute the affected player’s batting stats immediately.
- If cached totals are stored, write them in the same transaction.
- `is_locked = true` should prevent automatic overwrite unless an admin correction flow is used.

## Scoresheet Upload Endpoint

### `POST /api/v2/scoresheet/{eventTeamGameId}/upload`

Purpose:

- Accept image upload for handwritten scoresheet extraction.
- Create or update upload/review state.

Request:

- `multipart/form-data`
- file field name currently used by frontend: `file`

Recommended response:

- Return the full `GET /scoresheet` response with updated:
  - `scoresheet_upload.status`
  - `scoresheet_upload.source_image_name`
  - `scoresheet_upload.extraction_confidence`
  - `scoresheet_upload.review_items`
  - optionally staged `batting_appearances`

Validation:

- `file` required.
- Allowed mime types should be at least:
  - `image/jpeg`
  - `image/png`
  - `image/webp`
  - optionally `application/pdf`

Behavior:

- Store upload metadata.
- Set upload state to `uploading` then `review` once extraction completes.
- Create unresolved review items for OCR ambiguities, lineup mismatches, or incomplete result mapping.

## Publish Endpoint

### `POST /api/v2/scoresheet/{eventTeamGameId}/publish`

Purpose:

- Finalize reviewed batting data for game/team usage.
- Mark upload workflow complete.

Request body:

```json
{}
```

Recommended response:

- Return the full `GET /scoresheet` response with `scoresheet_upload.status = "published"`.

Publish behavior:

- Validate that the game lineup exists or can be derived.
- Validate that required review blockers are resolved.
- Recompute batting stats from final batting appearances.
- Persist final status on the game score context.
- Optionally mark lineup submission as finalized if business rules require it.

## Code Tables and Enums

### `submission_status`

- `0` = draft
- `1` = submitted
- `2` = approved
- `3` = rejected
- `4` = finalized

### `approval_mode`

- `0` = auto
- `1` = manual

### `player_source_type`

- `0` = manual
- `1` = team_member
- `2` = invited_member
- `3` = association_entered
- `4` = uploaded_scoresheet

### `scoresheet_upload.status`

- `idle`
- `uploading`
- `review`
- `mapped`
- `published`

### `result_code`

The frontend already expects codes like:

- `1B`
- `2B`
- `3B`
- `HR`
- `GRH`
- `K`
- `KC`
- `GO`
- `FO`
- `LO`
- `PO`
- `SF`
- `GDP`
- `LDP`
- `FDP`
- `TP`
- `BB`
- `IBB`
- `HBP`
- `E`
- `FC`
- `CI`
- `OBI`
- `OBR`
- `OBS`
- `IFR`
- `SAC`
- `SB`
- `CS`
- `PB`
- `WP`

These should align with `sport_result_codes`.

## Derived vs Editable

Editable by user:

- batting appearance result code
- batting appearance detail notes
- batting appearance RBI
- upload/review notes

Derived by backend:

- batting stats totals
- result count breakdown
- appearance-level flags such as `counts_as_at_bat`
- review items if generated from OCR/matching pipeline

Should not be client-authoritative unless explicitly allowed:

- `hits`
- `walks`
- `strikeouts`
- `plate_appearances`
- `left_on_base`

## Transaction Boundaries

Recommended:

1. `POST /plate-appearances`
   - insert appearance
   - recompute batting stats
   - commit

2. `PATCH /plate-appearances/{appearanceId}`
   - update appearance
   - recompute batting stats
   - commit

3. `DELETE /plate-appearances/{appearanceId}`
   - delete appearance
   - recompute batting stats
   - commit

4. `POST /publish`
   - validate review state
   - recompute final stats
   - mark published/finalized statuses
   - commit

## Table Mapping

This section is inferred from the frontend naming and your earlier table list.

Likely reads from:

- `sport_result_codes`
- `event_team_lineup`
- game lineup-related tables for lookup/reference only, not write ownership
- scoresheet upload tables
- batting appearance / batting stats tables

Likely new or relevant write tables:

- `game_batting_appearances`
- `game_batting_stats`
- `scoresheet_uploads`
- `scoresheet_upload_review_items`

If your actual schema already uses different names, the API contract can stay the same while Laravel maps to those real tables.

## Error Shape

Recommended Laravel error shape:

```json
{
  "message": "The given data was invalid.",
  "errors": {
    "players.0.player_name": [
      "The player name field is required."
    ]
  }
}
```

Recommended business-rule error example:

```json
{
  "message": "Scoresheet cannot be published until all review blockers are resolved.",
  "code": "SCORESHEET_REVIEW_INCOMPLETE"
}
```

## Open Questions To Confirm Against Schema

1. Should batting appearances be stored as the source of truth, with batting stats always derived?
2. Does upload review live in existing OCR tables, or should new scoresheet upload tables be introduced?
3. Should publish update only the team-facing scoresheet state, or also official game stats state?
4. Does the existing Game Details API already expose current inning/live state so scoresheet does not need to duplicate it?

## Recommended Laravel Controller Surface

Suggested controller methods:

```php
GET     /api/v2/scoresheet/{eventTeamGameId}
POST    /api/v2/scoresheet/{eventTeamGameId}/plate-appearances
PATCH   /api/v2/scoresheet/{eventTeamGameId}/plate-appearances/{appearanceId}
DELETE  /api/v2/scoresheet/{eventTeamGameId}/plate-appearances/{appearanceId}
POST    /api/v2/scoresheet/{eventTeamGameId}/upload
POST    /api/v2/scoresheet/{eventTeamGameId}/publish
```

Suggested Laravel classes:

- `ScoresheetController@show`
- `ScoresheetPlateAppearanceController@store`
- `ScoresheetPlateAppearanceController@update`
- `ScoresheetPlateAppearanceController@destroy`
- `ScoresheetUploadController@store`
- `ScoresheetPublishController@store`

Suggested request classes:

- `StoreScoresheetPlateAppearanceRequest`
- `UpdateScoresheetPlateAppearanceRequest`
- `UploadScoresheetImageRequest`

Suggested services:

- `BuildScoresheetViewData`
- `CreateScoresheetPlateAppearance`
- `UpdateScoresheetPlateAppearance`
- `DeleteScoresheetPlateAppearance`
- `DeriveBattingStatsFromAppearances`
- `PublishScoresheet`

## Current Frontend Alignment

The current frontend still uses a more bundled scoresheet write flow, but this revised contract is the recommended target architecture.

Recommended frontend behavior after alignment:

1. fetch game metadata from the existing Game Details API
2. fetch scoresheet-specific data from `GET /api/v2/scoresheet/{eventTeamGameId}`
3. keep game lineup submission on its own API
4. create/update/delete one plate appearance at a time
5. let backend recompute batting stats after each mutation

This gives the cleanest separation of concerns and the most reliable long-term architecture.
