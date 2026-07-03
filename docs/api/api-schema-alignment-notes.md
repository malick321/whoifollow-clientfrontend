# API Schema Alignment Notes

These notes supersede the placeholder identifier naming used in earlier drafts.

## Identifier Alignment

### Team Participation Screen

Use real schema keys:

- `event_id`
- `team_id`
- `tournament_id`

Recommended APIs:

- `GET /api/v2/team-participation?event_id={eventId}&team_id={teamId}&tournament_id={tournamentId}`
- `GET /api/v2/event-lineup?event_id={eventId}&team_id={teamId}`
- `PATCH /api/v2/event-lineup?event_id={eventId}&team_id={teamId}`

Why:

- the Team Participation screen is event/team scoped
- the reusable lineup is event/team scoped
- no separate `eventTeamId` key has been confirmed in your schema

### Scoresheet Screen

Use real schema keys:

- `tournament_game_id`
- `team_id`

Recommended APIs:

- `GET /api/v2/scoresheet/{tournamentGameId}?team_id={teamId}`
- `POST /api/v2/scoresheet/{tournamentGameId}/plate-appearances?team_id={teamId}`
- `PATCH /api/v2/scoresheet/{tournamentGameId}/plate-appearances/{appearanceId}?team_id={teamId}`
- `DELETE /api/v2/scoresheet/{tournamentGameId}/plate-appearances/{appearanceId}?team_id={teamId}`
- `POST /api/v2/scoresheet/{tournamentGameId}/upload?team_id={teamId}`
- `POST /api/v2/scoresheet/{tournamentGameId}/publish?team_id={teamId}`

Why:

- one `tournament_games.id` represents the whole game
- the scoresheet is team-specific
- lineup submission and batting ledger belong to one team in that game

### Game Lineup Submission Popup

Use the same scope as the scoresheet:

- `tournament_game_id`
- `team_id`

Recommended APIs:

- `GET /api/v2/game-lineup-submission/{tournamentGameId}?team_id={teamId}`
- `PATCH /api/v2/game-lineup-submission/{tournamentGameId}?team_id={teamId}`

Why:

- the popup manages one team's lineup for one game
- no separate `eventTeamGameId` key has been confirmed

## Frontend Alignment

### Team Participation Screen

Use:

- Team Participation API for header/status/summary data
- existing Games API for cards
- existing Event Details/Standings API for standings/format
- Event Lineup API for the lazy-loaded modal

### Scoresheet Screen

Use:

- existing Game Details API for game metadata
- Scoresheet API for scoresheet-specific state
- Game Lineup Submission API for the lineup popup
- per-plate-appearance scoresheet mutation APIs for add/edit/delete

## Schema Changes Worth Considering

### Strongly Recommended

1. `game_lineup_players.replaces_game_lineup_player_id`
   - lets substitutes explicitly point to the player they replace
   - safer than inferring substitution only from shared batting order

2. Unique constraint for event lineup rows
   - one practical option:
   - `(event_id, team_id, batting_order)`
   - or another uniqueness rule that matches your actual `event_team_lineup` design

3. Unique constraint for game batting appearance sequencing
   - recommended logical uniqueness:
   - `(tournament_game_id, team_id, game_lineup_player_id, inning_number, plate_appearance_no_for_player)`

### Probably Needed If Not Already Present

1. Scoresheet upload storage
   - a table like `scoresheet_uploads`
   - linked by `tournament_game_id` + `team_id`

2. Scoresheet review items / OCR issues
   - a table like `scoresheet_upload_review_items`
   - only if review items are persisted and not generated on the fly

3. Batting stats cache table
   - if you want persisted derived stats instead of on-the-fly calculation

### Likely Not Needed

1. A new synthetic `eventTeamGameId`
   - unnecessary if `tournament_game_id + team_id` already identifies the team-side scoresheet context

2. A new participation-side synthetic ID
   - unnecessary if `event_id + team_id (+ tournament_id when needed)` already identifies the page context

## Existing Draft Docs

These older docs are still useful for field shapes and examples, but their route identifiers should now be read through the alignment above:

- `docs/team-participation-api-contract.md`
- `docs/scoresheet-api-contract.md`
- `docs/game-lineup-submission-api-contract.md`

When implementing backend or revising frontend adapters, prefer the aligned identifiers from this file.
