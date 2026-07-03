---
status: Draft
owner: shared
last_updated: 2026-05-19
---

# Reports — REST API contract

## Context

Powers the Reports section of the association portal (`/association/<slug>/portal/reports/*`). Each report has its own endpoint under the `/v2/reports/` namespace and renders inside a dedicated view component:

| Report | View | Endpoint |
|---|---|---|
| Event Summary | `src/views/AssociationEventSummaryReportView.vue` | `GET /v2/reports/event/games-summary/{eventId}` (§1) |

When wired, replaces the mock layer in `src/api/associationReports.ts`.

All endpoints are rooted under `/v2/reports/...`. For shared rules — response envelope, pagination shape, auth header, error codes, and `permissions_json` encoding — see [`conventions.md`](./conventions.md).

**Naming convention (wire ≠ DB).** Request bodies, response payloads, and query parameters all use **camelCase consistently** on the v2 wire. Underlying DB columns may be snake_case; the backend serializer translates. DB column names appear in this contract only inside the SQL sketches — every other reference is the wire field name.

ID literals in the JSON examples below use prefixed stubs (`evt_…`, `div_…`, etc.) for doc readability only — production serializes the bare `BIGINT UNSIGNED` PK as a numeric string. See [`conventions.md` § Doc-example IDs vs wire IDs](./conventions.md#doc-example-ids-vs-wire-ids).

## Scope decisions (locked in)

- **Read-only.** Every report endpoint is `GET`. Reports never mutate state — they project existing event / game data into a printable view.
- **Permission gate.** Each endpoint requires `manage_reports` on the caller's `association_users` row for the association that owns the target event (or `fullControl = TRUE`). Without it → `403`. Backend resolves the event's owning association from `team_events.owner_type` + `owner_linked_id` and runs the gate against that.
- **Ownership scope.** Reports are valid only against association-owned events (`team_events.owner_type = 1`). Team-owned events → `409 Conflict` (matches the same constraint MatchGeni applies — see [`matchgeni-officials-api-contract.md` "Scope decisions"](./matchgeni-officials-api-contract.md)).
- **Soft-delete aware.** Cancelled / deleted events still appear in reports (the historical record matters more than the event's current state) — the report endpoints DO NOT filter on `deleted_at`. The view layer can choose to dim or annotate based on `eventStatus` if needed.
- **Server-side sorting only.** Every report endpoint returns rows pre-sorted per its own contract; the frontend re-asserts the sort defensively but does not expose user-driven sort controls on the report UI.
- **No pagination in v1.** Report payloads are bounded by the parent event's row count (game-by-game / team-by-team) and fit comfortably in a single response. If a report grows beyond a few hundred rows we'll add pagination on a per-report basis — flagged in that report's section.

## Underlying tables

| Table | Purpose |
|---|---|
| `team_events` | The target event the report is generated for. Used to scope auth (owning association) and stamp the report header. |
| `event_tournaments` | Per-event divisions/tournaments — provides `divisionName` for the Event Summary group key. |
| `team_event_games` | Game rows under each division. Source of `gameName` / `gameDate` / `gameTime` / `gameType` / both teams' identities. |
| `tournament_game_scores` | Per-game score + HR aggregates. Joined for each team's `score` + `hr`. |
| `association_teams` | Source of the **external** registration number (`registration_no`) surfaced as `team1RegNo` / `team2RegNo`. |

---

## 1. Event Summary report

- **Endpoint**: `GET /v2/reports/event/games-summary/{eventId}`
- **Purpose**: Game-by-game scores for the event, grouped visually by division. Used by the **Event Summary** report page (admin picks an event → sees every scored game with both teams' external reg numbers, score, and HR count, plus the underlying division / date / time / game-type metadata).
- **Path parameter**: `eventId` — the `team_events.id` of the event being reported on.

### Query parameters

None in v1.

### Request body

None (GET).

### Response

`data` is a flat array of `EventSummaryReportRow` objects, pre-sorted by:

1. `divisionName` (ascending)
2. `gameDate` + `gameTime` (ascending)
3. `gameType` — `'pool'` rows before `'bracket'` rows within the same date/time bucket
4. `gameName` (ascending) as a final tie-breaker so the order is deterministic across reloads

The frontend re-asserts this sort defensively (see `sortRows()` in `src/api/associationReports.ts`) but the server is the authority.

```json
{
  "responseStatus": { "statusCode": 200, "message": "OK" },
  "data": [
    {
      "id": "evt_2003-1-0",
      "divisionName": "Men's 50+ Major+",
      "gameName": "Game 1",
      "gameDate": "2026-05-21",
      "gameTime": "08:00:00",
      "gameType": "pool",
      "team1RegNo": "REG-1004",
      "team1Name": "Sacramento Kings",
      "team1Score": 11,
      "team1HR": 3,
      "team2RegNo": "REG-1018",
      "team2Name": "Dallas Diamonds",
      "team2Score": 9,
      "team2HR": 2
    },
    {
      "id": "evt_2003-11-3",
      "divisionName": "Men's 50+ Major+",
      "gameName": "Game 11",
      "gameDate": "2026-05-22",
      "gameTime": "09:00:00",
      "gameType": "bracket",
      "team1RegNo": "REG-1004",
      "team1Name": "Sacramento Kings",
      "team1Score": 13,
      "team1HR": 4,
      "team2RegNo": "REG-1009",
      "team2Name": "Phoenix Heat",
      "team2Score": 10,
      "team2HR": 2
    }
  ]
}
```

### Field notes

- `id` — stable row identifier for Vue's list-key. Backend can emit `${eventId}-${gameId}` or any opaque string; the frontend does not parse it.
- `divisionName` — denormalized from `event_tournaments.tournament_name`. Used by the listing UI as the group header / first sort axis.
- `gameName` — display name from `team_event_games.game_name` (e.g. `"Game 12"`, `"Pool A-1"`, `"Championship"`). Free-form; the UI renders it verbatim.
- `gameDate` — `YYYY-MM-DD` in the event's local timezone. Frontend formats to "May 21, 2026".
- `gameTime` — `HH:MM:SS` (24-hour) in the event's local timezone. Frontend formats to "8:00 AM".
- `gameType` — one of:
  - `'pool'` — pool-play game
  - `'bracket'` — bracket / elimination game
  Drives the secondary sort within a date+time bucket (pool first, bracket second) and the pool/bracket chip in the UI.
- `team1RegNo` / `team2RegNo` — the **external** association-issued registration number (`association_teams.registration_no`), NOT the database PK. Surfaced as **"Team 1 Ext #"** / **"Team 2 Ext #"** in the UI. Always populated — every association_team row has a reg-no by the time it can be in a scored game.
- `team1Name` / `team2Name` — the team's display name at game time. Backend snapshot, NOT a live join — matches what was on the scoresheet so historic reports stay accurate after a team rename.
- `team1Score` / `team2Score` — final score for each team. `null` when the game was scheduled but never scored (forfeit, cancelled, etc.); the frontend renders `null` as `"—"`.
- `team1HR` / `team2HR` — home-run count for each team in the game. Same null semantics as score.

### Error codes

| Code | When |
|---|---|
| `403` | Caller lacks `manage_reports` on the event's owning association. |
| `404` | `eventId` doesn't exist (or is soft-deleted). |
| `409` | Event is team-owned (`owner_type ≠ 1`) — reports only apply to association-owned events. |

### SQL sketch (relevant projection)

Names are illustrative — adjust to match the actual game / score / team tables when wiring.

```sql
SELECT
  CONCAT(te.id, '-', g.id)                  AS id,
  et.tournament_name                         AS divisionName,
  g.game_name                                AS gameName,
  DATE(g.game_at_local)                      AS gameDate,
  TIME(g.game_at_local)                      AS gameTime,
  g.game_type                                AS gameType,        -- 'pool' | 'bracket'
  at1.registration_no                        AS team1RegNo,
  g.team1_name_snapshot                      AS team1Name,
  s.team1_score                              AS team1Score,
  s.team1_hr                                 AS team1HR,
  at2.registration_no                        AS team2RegNo,
  g.team2_name_snapshot                      AS team2Name,
  s.team2_score                              AS team2Score,
  s.team2_hr                                 AS team2HR
FROM team_events te
JOIN event_tournaments et            ON et.event_id = te.id
JOIN team_event_games g              ON g.tournament_id = et.id
LEFT JOIN tournament_game_scores s   ON s.game_id = g.id
LEFT JOIN association_teams at1      ON at1.id = g.team1_association_team_id
LEFT JOIN association_teams at2      ON at2.id = g.team2_association_team_id
WHERE te.id = :eventId
ORDER BY
  et.tournament_name ASC,
  g.game_at_local ASC,
  CASE g.game_type WHEN 'pool' THEN 0 ELSE 1 END ASC,
  g.game_name ASC;
```

### Frontend consumer

- `src/api/associationReports.ts` — `fetchEventSummaryReport(associationId, eventId)`. The mock currently returns seed rows for any non-empty `eventId`; once this endpoint ships, replace the body with `fetchEnvelope<EventSummaryReportRow[]>(path)`.
- `src/views/AssociationEventSummaryReportView.vue` — picker + table view. Already handles the response shape end-to-end.
- Wire `EventSummaryReportRow` + `ReportGameType` types live in `src/types.ts` and match the contract field-for-field.

---

## Endpoint summary

| # | Method | Path | Purpose |
|---|---|---|---|
| 1 | GET | `/v2/reports/event/games-summary/{eventId}` | Per-event game-by-game scoresheet roll-up |

Future reports get appended to this table as they land. Suggested path-naming pattern for new reports:

```
/v2/reports/<scope>/<report-slug>/{primaryId}
```

Where:
- `<scope>` — the entity the report is keyed on (`event`, `association`, `team`, etc.).
- `<report-slug>` — kebab-case identifier for the specific report (e.g. `games-summary`, `registrations`, `payments`).
- `{primaryId}` — the entity's BIGINT PK in the URL.

The frontend's `Reports` sidebar group lists one sub-item per report; each sub-item routes to a dedicated view under `/portal/reports/<slug>/`.
