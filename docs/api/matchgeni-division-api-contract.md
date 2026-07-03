---
status: Draft
owner: matchgeni
last_updated: 2026-06-19
---

# MatchGeni Divisions — REST API contract

## Endpoints

| # | Endpoint | Notes |
|---|---|---|
| 1 | `POST /v2/association/events/{associationId}/{eventId}/divisions` | Create a division — `event_tournaments` row + `tournament_seed_criteria` + default pool, in one transaction. |
| 2 | `PATCH /v2/association/events/{associationId}/{eventId}/divisions/{divisionId}` | Update a division (replaces the row's fields + reconciles its seed-criteria set). |
| 3 | `DELETE /v2/association/events/{associationId}/{eventId}/divisions/{divisionId}` | Soft-delete a division (+ its child seed-criteria rows). |
| 4 | `GET /v2/association/events/{associationId}/{eventId}/divisions` | Dashboard division list — lightweight, navigation-only rows + two compute-on-read counts. |
| 5 | `GET /v2/association/events/{associationId}/{eventId}/divisions/{divisionId}` | Division **detail-page shell** — config + pools (meta) + brackets (meta + light team identity). |
| 6 | `GET /v2/association/events/{associationId}/{eventId}/divisions/{divisionId}/teams` | Division **teams** — full team info + seed + pool-play W/L record. Reusable (portal, client pages, detail Pool Play). |
| 7.1 | `GET …/divisions/{divisionId}/pools` | Load the Manage Team Pools modal — eligible teams + pools + flags. |
| 7.2 | `PUT …/divisions/{divisionId}/pools` | **Bulk save** the whole pool layout — add / rename / delete pools + team placement, reconciled in one transaction. |
| 8.1 | `GET …/divisions/{divisionId}/standings` | Division standings (winners) — per-unit podiums. **DRAFT.** |
| 8.2 | `PUT …/divisions/{divisionId}/units/{kind}/{refId}/standings` | Announce result for one unit (manual). **DRAFT.** |
| 8.3 | `PUT …/divisions/{divisionId}/brackets/{bracketId}/cancel` | Cancel a bracket (releases its teams to their pool). **DRAFT.** |

All endpoints require a session whose caller holds `manage_divisions` (or `fullControl`) for the event — the same gate as entering the division surface (`matchgeni-access-api-contract.md` §2). Shared rules (response envelope, auth header, error codes) live in [`conventions.md`](./conventions.md); wire fields are **camelCase**.

---

## Context

Create + edit a **division** (a `event_tournaments` row, MatchGeni's "tournament") under an event. Backs the **Add/Edit Division** wizard (`MatchGeniDivisionFormModal`) reached from the MatchGeni dashboard's division list and the division-detail page.

The wizard has three steps — **Details → Format → Review** (mirrors the Event wizard's shell) — but they are **not** three API calls. The Details step captures name, dates, team-entry restriction, serial numbering and notes; the Format step captures time limits plus the three overridable sections; the Review step is a read-only confirmation. Field config is a column on the same `event_tournaments` row as the division info, and seed criteria (the UI's "Tie breakers") are child rows (`tournament_seed_criteria`). So the whole division is written in **one atomic call**: the wizard's intermediate "Next" buttons are pure client-side navigation, and the final **Save** fires a single `POST` (create) or `PATCH` (edit) that the backend executes in one transaction. No partial divisions, no multi-call orchestration on the client.

This replaces the legacy `POST /associationEvent/createTournament` (which carried four redundant date representations and computed a UTC instant in the *browser's* timezone — a correctness bug when the admin's tz ≠ the event's tz).

### Override model (Format step)

The Format step exposes **three independent sections**, each with a **Default / Custom** switch (the same control as the Event wizard's in-person/online toggle). Each section **always sends an explicit toggle flag** (a 0/1 column on `event_tournaments`); the section's value field(s) are sent only when it's on Custom, otherwise null/empty so the backend keeps the event default. Flipping to Custom pre-seeds the control(s) from the event default.

| Section | Toggle flag (wire → column) | Flag polarity | Value field(s) when Custom (wire → column) |
|---|---|---|---|
| **Format** | `customFormat` → `custom_format` | `1` = **custom** chosen | `poolPlayGuarantee` → `pool_game_guarantee`, `bracketFormatId` → `bracket_format` |
| **Tie breakers** | `useEventSeed` → `use_event_seed` | `1` = **use event default** | `seedCriteria[]` → `tournament_seed_criteria` rows (ordered) |
| **Field config** | `useEventFieldConfig` → `use_event_field_config` | `1` = **use event default** | `fieldConfigId` → `field_config_id` |

> Note the polarity difference: **`custom_format` is `1` when overriding**, whereas **`use_event_seed` / `use_event_field_config` are `1` when inheriting** (`0` when overriding). The frontend sends booleans (`customFormat = isCustom`, `useEventSeed = !isCustom`, `useEventFieldConfig = !isCustom`); the backend stores them as the 0/1 tinyints above. The toggle flags are **always present** in the body so the backend can set the column unconditionally — it never has to infer the mode from whether a value field is null.

**Sport type is inherited and read-only** — sourced from the event (`event.sportsTypeId` on the access payload) and shown on the field card; it is **never** sent in the create/edit body. Time limits are always sent (pre-filled from the event but freely editable).

### Related contracts / catalogues
- [`matchgeni-access-api-contract.md`](./matchgeni-access-api-contract.md) §1 — the form seeds its defaults from that payload's `event.startDate/endDate/sportsTypeId/timeZone` + `event.defaults`.
- Catalogues the form binds to: bracket formats (shared-services §2), age groups (shared-services §3), sport types / field configurations (shared-services §8), seeding criteria (shared-services §6), and **ratings** — now association-scoped, see [`association-ratings-api-contract.md`](./association-ratings-api-contract.md) §1 (active only).

## Dates & timezone (locked decision)

Division boundaries are **calendar dates** as the user picks them: the body sends **plain `DATE`s** (`startDate`/`endDate` = `YYYY-MM-DD`) — no time-of-day, no UTC pre-computed in the browser. This is drift-proof: the client never resolves the instant in the *browser's* tz the way the legacy `…T07:00:00Z` value did.

The wizard's DateRangePicker **defaults the division range to the event's own `startDate`/`endDate`** and **bounds the selectable range to it** (`minDate`/`maxDate` = the event dates) — a division can't be scheduled outside its event. The backend should still validate `event.startDate ≤ startDate ≤ endDate ≤ event.endDate` (`422` on violation) since the client bound is advisory.

**The body also sends the event's IANA `timeZone`** (`event.timeZone` from the access payload — e.g. `"America/Chicago"`). The backend combines it with the plain dates to derive UTC instants for storage — `startAtUtc` = **start-of-day** of `startDate` in `timeZone`, `endAtUtc` = **end-of-day** of `endDate` in `timeZone`. Resolving the instant **server-side** (not in the browser) is what keeps it correct when the admin's tz ≠ the event's tz. `timeZone` is `null` only when the event itself has none (all-day / unspecified), in which case the backend falls back to its own default.

## Underlying tables

| Table | Role |
|---|---|
| `event_tournaments` ([sql-schema-tournament.md#event_tournaments](../system/sql-schema-tournament.md#event_tournaments)) | The division row — info fields, the plain `start_date` / `end_date` **plus backend-derived `start_at_utc` / `end_at_utc`** (resolved from those dates + the submitted `timeZone`), the `restrict_teams_entry` toggle, the three section-toggle columns (`custom_format`, `use_event_seed`, `use_event_field_config`), and their override values (`pool_game_guarantee`, `bracket_format`, `field_config_id`). Created/updated here. |
| `tournament_seed_criteria` ([sql-schema-tournament.md#tournament_seed_criteria](../system/sql-schema-tournament.md#tournament_seed_criteria)) | Ordered seed-criteria child rows. Written only when `use_event_seed = 0` (custom); reconciled on edit. |
| `tournament_pools` ([sql-schema-tournament.md#tournament_pools](../system/sql-schema-tournament.md#tournament_pools)) | A default pool is created alongside the division (the response returns its id). |

---

## 1. Create Division

- **Endpoint**: `POST /v2/association/events/{associationId}/{eventId}/divisions`
- **Purpose**: Create a division under an event — the `event_tournaments` row (info + field config) plus its `tournament_seed_criteria` rows — in one transaction, and seed a default pool.
- **Auth**: Standard session header. Caller must hold `manage_divisions` (or `fullControl`) for the event — same gate as entering the division surface (`matchgeni-access-api-contract.md` §2).

### Path parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `associationId` | string | yes | Association numeric PK. |
| `eventId` | string | yes | Event numeric PK or GUID (same dual-format rule as the access endpoint). |

### Request body

```jsonc
{
  "tournamentName": "W85 Gold",
  "startDate": "2026-05-27",          // plain YYYY-MM-DD
  "endDate":   "2026-05-31",          // plain YYYY-MM-DD
  "timeZone":  "America/Chicago",     // event IANA tz → backend derives startAtUtc / endAtUtc
  "poolPlayTime": 65,                 // minutes | null
  "bracketTime": 70,                  // minutes | null
  "championshipTime": 80,             // minutes | null
  "continuousTeamSrNo": true,

  "customFormat": false,              // → custom_format (1=custom). When true, the two below carry values
  "poolPlayGuarantee": null,          // → pool_game_guarantee. 1–5, only when customFormat
  "bracketFormatId": null,            // → bracket_format. /getBracketFormats id, only when customFormat

  "restrictTeamsEntry": false,        // → restrict_teams_entry (1=restricted). When true, the two lists carry values
  "ageGroupIds": [],                  // /getAgeGroup ids, only when restrictTeamsEntry
  "ratingIds": [],                    // association-ratings ids (association-ratings-api-contract §1), only when restrictTeamsEntry

  "useEventSeed": true,               // → use_event_seed (1=inherit). When false, seedCriteria carries the list
  "seedCriteria": [],                 // UI "Tie breakers" → tournament_seed_criteria rows; empty when useEventSeed
  // when useEventSeed=false: [{ "seedingCriteriaId": "1", "order": 1 }, { "seedingCriteriaId": "2", "order": 2 }]

  "useEventFieldConfig": true,        // → use_event_field_config (1=inherit). When false, fieldConfigId carries the value
  "fieldConfigId": null,              // → field_config_id. field-configurations id, only when useEventFieldConfig=false

  "notes": ""
}
```

| Field | Type | Notes |
|---|---|---|
| `tournamentName` | string | Required, division display name. |
| `startDate` / `endDate` | string `YYYY-MM-DD` | Required. Stored as plain `DATE`s. |
| `timeZone` | string \| null | Event IANA timezone (from `event.timeZone`). The backend combines it with the dates to derive `startAtUtc` (start-of-day) / `endAtUtc` (end-of-day). `null` when the event has none → backend default. |
| `poolPlayTime` / `bracketTime` / `championshipTime` | number \| null | Time limits (minutes). Required by the UI; `null` allowed at the wire level. |
| `continuousTeamSrNo` | boolean | Maintain continuous team serial numbering across pools. |
| `customFormat` | boolean | **Format** section toggle → `custom_format` (0/1). `true` = Custom (send `poolPlayGuarantee` + `bracketFormatId`); `false` = Default (both `null`, backend inherits). **Always sent.** |
| `poolPlayGuarantee` | number \| null | → `pool_game_guarantee`. Pool-play game guarantee (1–5). Non-null only when `customFormat`. |
| `bracketFormatId` | string \| null | → `bracket_format`. FK → `/getBracketFormats`. Non-null only when `customFormat`. |
| `restrictTeamsEntry` | boolean | **Restrict Team Entry** toggle → `restrict_teams_entry` (0/1). `true` = only teams matching the selected age groups + ratings may be added; `false` = open entry. **Always sent.** |
| `ageGroupIds` / `ratingIds` | string[] | **Restrict Team Entry** selections (age groups + association ratings). Non-empty only when `restrictTeamsEntry` is `true`; `[]` when the toggle is off. |
| `useEventSeed` | boolean | **Tie breakers** section toggle → `use_event_seed` (0/1). `true` = inherit the event's default seeding (`seedCriteria` empty); `false` = Custom (send the ordered `seedCriteria`). **Always sent.** |
| `seedCriteria` | `{ seedingCriteriaId, order }[]` | Ordered (selection order = priority) → `tournament_seed_criteria`. Non-empty only when `useEventSeed` is `false`; `[]` when inheriting (no child rows written). |
| `useEventFieldConfig` | boolean | **Field config** section toggle → `use_event_field_config` (0/1). `true` = inherit the event field config (`fieldConfigId` null); `false` = Custom (send `fieldConfigId`). **Always sent.** |
| `fieldConfigId` | string \| null | → `field_config_id`. FK → field-configurations. Non-null only when `useEventFieldConfig` is `false`. |
| `notes` | string | Free text. |

### Response

```json
{
  "responseStatus": { "statusCode": 200, "message": "Division created", "text": "OK" },
  "data": {
    "tournamentId": 1273,
    "tournamentGuid": "fc1a5e69-0811-4704-9c43-8225c48daaf3"
  }
}
```

| Field | Type | Notes |
|---|---|---|
| `tournamentId` | number | New `event_tournaments.id`. |
| `tournamentGuid` | string | New division GUID (shareable id / deep-link target). |

> Just the created row's identity. A default pool **is** seeded server-side, but its id is **not** returned — no client surface consumes it (the wizard only toasts + reloads the list). The legacy `createTournament` returned the snake_case `{ tournament_id, tournament_guid, tournament_pool_id }`; the v2 endpoint drops `tournament_pool_id` and returns the remaining two camelCased in the standard `responseStatus` envelope. The frontend client (`src/api/matchGeniDivisions.ts`) maps it to `CreateDivisionResult`.

### Error handling

| Code | When |
|---|---|
| `401` | Not authenticated. |
| `403` | Caller lacks `manage_divisions` / `fullControl` for the event. |
| `404` | Event missing / soft-deleted / belongs to another association. |
| `422` | Validation — missing `tournamentName`, bad date range, unknown `bracketFormatId` / `fieldConfigId` / `seedingCriteriaId`, etc. |

---

## 2. Update Division

- **Endpoint**: `PATCH /v2/association/events/{associationId}/{eventId}/divisions/{divisionId}`
- **Purpose**: Update an existing division. Replaces the `event_tournaments` row's fields — including the three toggle columns (`custom_format`, `use_event_seed`, `use_event_field_config`) and their values (`pool_game_guarantee` / `bracket_format` / `field_config_id`, cleared to null when their section inherits) — and **reconciles** its `tournament_seed_criteria` set to match the submitted `seedCriteria` (insert/soft-delete/re-order to the new ordered list). When `useEventSeed = true` the reconcile clears any custom seeds back to the event default (no child rows).
- **Auth**: Same `manage_divisions` / `fullControl` gate.
- **Path**: adds `divisionId` (the `event_tournaments` id) to the §1 path.
- **Request body**: identical shape to §1.
- **Response**: identical shape to §1 (`message` reads "Division updated") — `{ tournamentId, tournamentGuid }`.

### Edit-flow note (frontend, current state)
The Edit flow opens with the division's name and lets the admin jump freely between the three rail steps (every step is already valid); Create only allows revisiting steps at/before the current one. **Dates currently seed from the event's `startDate`/`endDate`** (and stay bounded to the event range) because `EventTournament` (the list/detail model) doesn't yet carry the division's own persisted ISO dates. Once a division-fetch payload exposes them, the form should prefer the division's own dates. Tracked as a TODO in `MatchGeniDivisionFormModal`.

Same current-state limitation applies to the Format step: the three section switches (Format / Tie breakers / Field config) **always open in Default** on edit, seeded from the **event** defaults — the division's own persisted overrides aren't loaded yet (no division-fetch payload). Once that payload exists, the form should open a section in **Custom** when the division carries its own override (non-null `poolPlayGuarantee`/`bracketFormatId`, a `fieldConfigId`, or non-empty `seedCriteria`). The Review step echoes the final values (name, dates, ages & ratings, team serial #, time limits, format, tie breakers, field config, notes) before Save.

---

## 3. Delete Division

- **Endpoint**: `DELETE /v2/association/events/{associationId}/{eventId}/divisions/{divisionId}`
- **Purpose**: Soft-delete a division — sets `event_tournaments.deleted_at` and soft-deletes its child `tournament_seed_criteria` rows in one transaction. Surfaced as the **Delete Division** action in the Edit Division wizard footer.
- **Auth**: Same `manage_divisions` / `fullControl` gate.
- **Request body**: none.
- **Response**: standard `responseStatus` envelope (`message` "Division deleted"); `data` may be `null` or echo the deleted id.

### Error handling

| Code | When |
|---|---|
| `401` / `403` | Not authenticated / lacks `manage_divisions`. |
| `404` | Division missing / already deleted / belongs to another event. |
| `409` | Division can't be deleted because dependent data exists (e.g. games already scored) — server may block; client surfaces the message. |

> The frontend (`src/api/matchGeniDivisions.ts` → `deleteDivision`) confirms with the user first, then calls this; on success it reloads the division list and toasts. The wizard's footer button is **edit-mode only**.

---

## 4. List Divisions (dashboard)

- **Endpoint**: `GET /v2/association/events/{associationId}/{eventId}/divisions`
- **Purpose**: Feed the **MatchGeni dashboard's division list** — a fast, **navigation-only** surface. Returns one lightweight row per division: the division's config (all on the single `event_tournaments` row) plus **two cheap compute-on-read counts** (`teamCount` / `bracketCount`). Clicking a row opens the division-detail page, which loads the full pool / seed / bracket breakdown for that one division.
- **Auth**: Same `manage_divisions` / `fullControl` gate as the rest of the division surface.

### What this endpoint deliberately does NOT return

No **phase statuses** (pool / seed / bracket), no **progress percent**, and no **game count**.

This is a locked design decision (read-vs-write trade-off):

- **Statuses + progress are high-churn aggregates.** They'd have to be recomputed (or a denormalised counter bumped) on *every game-end* across the event — a centralized write path that's drift-prone and disproportionate to the value of showing a status chip in a list. The division-detail page already renders the live status for one division at a time, loaded on demand.
- **For a 50–60-division event**, attaching statuses/progress/gameCount to each row would force per-row joins across `event_tournaments` + `tournament_pools` + `brackets` + `tournament_games`, turning a cheap list into an expensive multi-table aggregation.
- **The two counts we DO return are cheap**: indexed `LEFT JOIN ... COUNT(...) GROUP BY tournament_id` over `tournament_teams` and `brackets`. No counter maintenance, no drift — computed fresh per request. Everything else (`tournamentName`, dates, `poolPlayGuarantee`, `bracketFormat`, `fieldConfigId`) already lives on the one `event_tournaments` row, so it's free to project.

### Path parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `associationId` | string | yes | Association numeric PK. |
| `eventId` | string | yes | Event numeric PK or GUID (same dual-format rule as §1). |

### Response

```json
{
  "responseStatus": { "statusCode": 200, "message": "OK", "text": "OK" },
  "data": [
    {
      "id": 7001,
      "guid": "fc1a5e69-0811-4704-9c43-8225c48daaf3",
      "tournamentName": "Men's 65+ Division",
      "dateRangeLabel": "Tue, May 12 – Thu, May 14, 2026",
      "startDate": "2026-05-12",
      "endDate": "2026-05-14",
      "teamCount": 6,
      "bracketCount": 1,
      "poolPlayGuarantee": 3,
      "bracketFormat": "Single Elimination",
      "poolTieBreaker": "Win %, head-to-head, run differential",
      "brackets": [
        { "name": "Gold Bracket", "teamCount": 6, "format": "Single Elimination", "status": "Completed", "statusTone": "primary" }
      ]
    }
  ]
}
```

| Field | Type | Source | Notes |
|---|---|---|---|
| `id` | number | `event_tournaments.id` | Division PK; the row's deep-link target. |
| `guid` | string | `event_tournaments.guid` | Optional shareable id. |
| `tournamentName` | string | `event_tournaments` | Division display name. |
| `dateRangeLabel` | string | computed | Pre-formatted label (weekday + month + year). `""` when no scheduled days. |
| `startDate` / `endDate` | string `YYYY-MM-DD` \| null | `event_tournaments` | Plain `DATE`s (no TZ). Present for client-side sort/grouping. |
| `teamCount` | number | **compute-on-read** | `COUNT` of the division's `tournament_teams` rows. |
| `bracketCount` | number | **compute-on-read** | `COUNT` of the division's `brackets` rows. `0` before any bracket is initiated. |
| `poolPlayGuarantee` | number \| null | `event_tournaments` | Pool-play game guarantee (1–5). `null` = inherit event default. |
| `bracketFormat` | string \| null | join → bracket-format label | Human-readable label (e.g. "Single Elimination"). `null` = inherit event default. |
| `poolTieBreaker` | string \| null | `event_tournaments` / seed criteria | Pool tie-breaker order shown in the row's Pool Play section (e.g. "Win %, head-to-head, run differential"). `null` = none / event default. |
| `brackets` | array | join → `brackets` (+ per-bracket `COUNT(bracket_teams)`) | Per-bracket summary lines for the row's Brackets section: `{ name, teamCount, format, status?, statusTone? }`. `status` is the bracket's lifecycle label ("Completed" / "In progress" / "Generated") rendered as a badge; `statusTone` ∈ `neutral`/`primary`/`success`/`warning`. Empty `[]` before any bracket exists. A small bounded join (a division has a handful of brackets), unlike the avoided high-churn status/progress aggregates. |

### Reference query shape

```sql
SELECT t.id, t.guid, t.tournament_name, t.start_date, t.end_date,
       t.pool_play_guarantee, bf.name AS bracket_format,
       COUNT(DISTINCT tt.id) AS team_count,
       COUNT(DISTINCT b.id)  AS bracket_count
FROM event_tournaments t
LEFT JOIN tournament_teams tt ON tt.tournament_id = t.id AND tt.deleted_at IS NULL
LEFT JOIN brackets         b  ON b.tournament_id  = t.id AND b.deleted_at  IS NULL
LEFT JOIN bracket_formats  bf ON bf.id = t.bracket_format_id
WHERE t.event_id = :eventId AND t.deleted_at IS NULL
GROUP BY t.id, bf.name
ORDER BY t.start_date, t.tournament_name;
```

### Error handling

| Code | When |
|---|---|
| `401` / `403` | Not authenticated / lacks `manage_divisions`. |
| `404` | Event missing / soft-deleted / belongs to another association. |

> The frontend client `fetchMatchGeniDivisions(associationId, eventId)` (`src/api/matchGeniDivisions.ts`) maps the rows to `MatchGeniDivisionSummary` (`src/types.ts`) and falls back to deterministic mock rows when the route is absent (v1 dev). The dashboard list (`MatchGeniDivisionList.vue`) renders date + name + format summary + the two count pills; clicking a row routes to the division-detail page.

---

## 5. Get Division Details

- **Endpoint**: `GET /v2/association/events/{associationId}/{eventId}/divisions/{divisionId}`
- **Purpose**: The **detail-page shell** for one division — backs `MatchGeniDivisionDetailView`. Returns the division's own `event_tournaments` row (config + the section toggles/values, with denormalized display labels), its **pools** (meta) and its **brackets** (meta + **light team identity** for the tree). It deliberately does **not** carry the pool roster, seeds, win/loss, or games — those are the separate **Division Teams** (§6) and games resources, fetched by the surfaces that need them. This is the rich get-one read (distinct from the lightweight navigation-only §4 list).
- **Auth**: Same `manage_divisions` / `fullControl` gate as the rest of the division surface.

### Path parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `associationId` | string | yes | Association numeric PK. |
| `eventId` | string | yes | Event numeric PK or GUID (same dual-format rule as §1). |
| `divisionId` | string | yes | The `event_tournaments` id. |

### Request body

None (GET).

### Response

```jsonc
{
  "responseStatus": { "statusCode": 200, "message": "OK", "text": "OK" },
  "data": {
    "division": {
      "id": "7001",
      "guid": "fc1a5e69-0811-4704-9c43-8225c48daaf3",
      "tournamentName": "Men's 65+ Division",
      "startDate": "2026-05-12",
      "endDate": "2026-05-14",
      "dateRangeLabel": "Tue, May 12 – Thu, May 14, 2026",

      // Section toggles + values (mirror the create/edit body, §1), with
      // denormalized labels so the panel needn't re-join catalogues.
      "customFormat": true,
      "poolPlayGuarantee": 3,
      "bracketFormatId": "1",
      "bracketFormatName": "Single Elimination",
      "useEventSeed": false,
      "seedCriteria": [ { "seedingCriteriaId": "1", "order": 1 }, { "seedingCriteriaId": "3", "order": 2 } ],
      "useEventFieldConfig": false,
      "fieldConfigId": "10",
      "fieldConfigName": "Softball",
      "poolPlayTime": 65,
      "bracketTime": 70,
      "championshipTime": 80,
      "continuousTeamSrNo": true,
      "restrictTeamsEntry": true,
      "ageGroups": ["65 Older"],
      "ratings": ["AAA", "Major"],
      "notes": "",
      "teamCount": 6,
      "bracketCount": 1
    },
    "brackets": [
      {
        "id": "bk_1",
        "guid": "9a2c-…",
        "divisionId": "7001",
        "name": "Gold Bracket",
        "description": "Top seeds, single elimination to the final.",
        "bracketFormatId": "1",
        "bracketFormatName": "Single Elimination",
        "status": "in_progress",
        "teams": [
          { "id": "55", "name": "Thunder 65", "avatarUrl": "https://cdn.example.com/teams/55.png" }
        ]
      }
    ],
    "pools": [
      { "id": "pool_a", "name": "Pool A", "seedCount": 6 },
      { "id": "pool_b", "name": "Pool B", "seedCount": 5 }
    ]
  }
}
```

### `data.division`

The division's `event_tournaments` row. Carries the same config fields as the §1 body (`customFormat` / `poolPlayGuarantee` / `bracketFormatId` / `useEventSeed` / `seedCriteria` / `useEventFieldConfig` / `fieldConfigId` / time limits / `continuousTeamSrNo` / `restrictTeamsEntry` / `notes` / dates), **plus** read-only denormalized labels (`bracketFormatName`, `fieldConfigName`, `ageGroups[]`, `ratings[]`, `dateRangeLabel`) and the cheap counts (`teamCount`, `bracketCount`) so the panel renders without extra catalogue joins.

### `brackets[]`

| Field | Type | Source | Notes |
|---|---|---|---|
| `id` | string | `tournament_brackets.id` | Bracket PK. |
| `guid` | string | `tournament_brackets.guid` | Shareable id. |
| `divisionId` | string | `tournament_brackets.tournament_id` | The owning division (echoes the path `divisionId`). |
| `name` | string | `tournament_brackets.name` | Bracket display name (e.g. "Gold Bracket"). |
| `description` | string \| null | `tournament_brackets.description` | Optional free-text blurb. |
| `bracketFormatId` | string \| null | `tournament_brackets.bracket_format_id` | FK → `/getBracketFormats`. `null` = inherit the division format. |
| `bracketFormatName` | string \| null | join → bracket-format label | Denormalized label for display. |
| `status` | string key | `tournament_brackets.status` | Lifecycle **key** (not display text), matching the event pattern: `pending` / `initiated` / `in_progress` / `completed` / `cancelled` (the 5-state enum). The frontend maps the key to its label + badge tone (`src/lib/bracketStatus.ts`). |
| `teams` | array | join → `bracket_teams` → `teams` | The bracket's teams (see below). Empty `[]` before any team is assigned. |

### `brackets[].teams[]` — light identity only

A bracket carries just enough to render its tree **standalone** (a public / client bracket view shouldn't have to pull the full roster). **No seed, no win/loss** — those are pool-play standings and live on the Division Teams resource (§6). The `id` lets the frontend optionally cross-link to that record when both are loaded.

| Field | Type | Source | Notes |
|---|---|---|---|
| `id` | string | `teams.id` | Team PK — cross-links to the §6 Division Teams record. |
| `name` | string | `teams.name` | Team display name (denormalized for standalone render). |
| `avatarUrl` | string \| null | `teams.avatar` (via `transformImageUrl()`) | Team logo; `null` when none. |

### `pools[]`

The division's pools (`tournament_pools`) with a count of how many seeds (teams) have been created in each — drives the detail panel's Pool Play section.

| Field | Type | Source | Notes |
|---|---|---|---|
| `id` | string | `tournament_pools.id` | Pool PK. |
| `name` | string | `tournament_pools.name` | Pool display name (e.g. "Pool A"). |
| `seedCount` | number | **compute-on-read** | Number of seeds (teams) created in the pool — `COUNT` of its `tournament_pool_teams` rows. `0` for an empty pool. |

### Error handling

| Code | When |
|---|---|
| `401` / `403` | Not authenticated / lacks `manage_divisions`. |
| `404` | Division missing / soft-deleted, or not owned by `{eventId}` / `{associationId}`. |

> Frontend: a `fetchMatchGeniDivisionDetails(associationId, eventId, divisionId)` client (`src/api/matchGeniDivisions.ts`) maps the envelope onto a `MatchGeniDivisionDetail` type (`src/types.ts`), mock-first behind a `DIVISION_DETAIL_ENDPOINT_LIVE` flag until the route ships. Consumed by `MatchGeniDivisionDetailView`.

---

## 6. Get Division Teams

- **Endpoint**: `GET /v2/association/events/{associationId}/{eventId}/divisions/{divisionId}/teams`
- **Purpose**: The division's **team roster with pool-play standings** — full team info, the **seed** (once seeding is generated), the **pool-play win/loss record**, and **pool membership**. This is the **reusable** team resource: consumed by the MatchGeni division-detail **Pool Play** section, the **Participating Teams** surface, and the **participation portal / public client pages**. Kept separate from §5 so the expensive standings aggregate is computed in exactly one place and only when a surface actually needs it.
- **Auth**: Same `manage_divisions` / `fullControl` gate as the rest of the division surface. (Public/client read access, when it ships, will be a separate unauthenticated route — out of scope here.)

### Path parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `associationId` | string | yes | Association numeric PK. |
| `eventId` | string | yes | Event numeric PK or GUID (same dual-format rule as §1). |
| `divisionId` | string | yes | The `event_tournaments` id. |

### Request body

None (GET).

### Response

```jsonc
{
  "responseStatus": { "statusCode": 200, "message": "OK", "text": "OK" },
  "data": {
    "list": [
      {
        "id": "55",
        "name": "Thunder 65",
        "avatarUrl": "https://cdn.example.com/teams/55.png",
        "gender": "Male",
        "ageGroup": "65 Older",
        "rating": "Major",
        "city": "Phoenix",
        "state": "AZ",
        "seed": 1,                         // null until seeding is generated
        "poolId": "pool_a",
        "poolName": "Pool A",
        "record": { "wins": 3, "losses": 1, "ties": 0 }   // pool-play record; defaults 0-0-0
      }
    ]
  }
}
```

### `data.list[]`

| Field | Type | Source | Notes |
|---|---|---|---|
| `id` | string | `teams.id` | Team PK (matches the light identity in §5 brackets, so the two can be joined client-side). |
| `name` | string | `teams.name` | Team display name. |
| `avatarUrl` | string \| null | `teams.avatar` (via `transformImageUrl()`) | Team logo; `null` when none. |
| `gender` | `Male`/`Female`/`Coed` | `teams` | Player gender division. |
| `ageGroup` | string | join → age-group label | e.g. "65 Older". |
| `rating` | string | join → rating label | e.g. "Major" (association-scoped, see [`association-ratings-api-contract.md`](./association-ratings-api-contract.md)). |
| `city` | string | `teams.city` | Home city. |
| `state` | string | `teams.state` | Home state/region. |
| `seed` | number \| null | `tournament_pool_teams.seed` (or division seeding) | The team's seed. **`null` until seeding is generated**; a number once it is. |
| `poolId` | string \| null | `tournament_pool_teams.pool_id` | Which pool the team is in (`null` if not yet assigned). Lets the client group by pool against §5's `pools[]` meta — no roster duplication in `pools[]`. |
| `poolName` | string \| null | join → `tournament_pools.name` | Denormalized pool name for display. |
| `record` | `{ wins, losses, ties }` | **compute-on-read** | **Pool-play** win/loss/tie record — indexed aggregate over the division's pool `tournament_games`. **Always present**, defaulting to `{0,0,0}` before any pool game is played. Bracket results are NOT counted here (those are §7 standings). |

> Suggested extras if a consuming surface needs them: `systemRegNo` (WIF reg number), `manager` (name/contact), `runsFor`/`runsAgainst` (for tie-break display). Add when required — keep the base list lean.

### Error handling

| Code | When |
|---|---|
| `401` / `403` | Not authenticated / lacks `manage_divisions`. |
| `404` | Division missing / soft-deleted, or not owned by `{eventId}` / `{associationId}`. |

> Frontend: a `fetchMatchGeniDivisionTeams(associationId, eventId, divisionId)` client (`src/api/matchGeniDivisions.ts`) maps `data.list` onto a `MatchGeniDivisionTeam` type (`src/types.ts`), mock-first behind a `DIVISION_TEAMS_ENDPOINT_LIVE` flag until the route ships. The detail page can fetch §5 + §6 in parallel; the brackets render from §5's light identity while the Pool Play section renders from §6.

---

## 7. Manage Team Pools

Backs the **Manage Team Pools** modal (`MatchGeniManagePoolsModal`) — the drag-and-drop pool builder opened from the division page. **Two endpoints only:** a **load** (§7.1) and a **single bulk save** (§7.2).

**Why one bulk save, not granular CRUD.** The modal is a **working-copy editor with Save / Cancel** — the admin adds / renames / deletes pools and drags teams freely against a local copy, then commits once. A single **declarative, desired-state** save maps to that exactly: it's **atomic** (all changes apply or none) and **Cancel-safe** (nothing persists until Save). Granular per-pool create/rename/delete would fire mid-edit and break Cancel (an added pool couldn't be undone) — so it's deliberately *not* used here. The save sends the **whole intended state**; the backend **diffs it against the current rows** and reconciles create / rename / delete / placement in one transaction.

**Data model.** A pool is a `tournament_pools` row (`{ id, name, is_default }`) scoped to the division. Team membership lives on `tournament_teams.pool_id` (`NULL` = the modal's "Available" column). The save touches both tables in one transaction.

**Auth.** Both require a session whose caller holds `manage_divisions` / `fullControl` for the event.

### 7.1 Get pools (modal load)

- **Endpoint**: `GET /v2/association/events/{associationId}/{eventId}/divisions/{divisionId}/pools`
- **Purpose**: One read that composes everything the modal needs: the division's pools (each with its placed teams in order), the **Available** teams (eligible `event_joined_team` rows — filtered by the division's age-group / rating restrictions — whose `pool_id` is `NULL`), and the division's `continuousSerial` flag + restriction labels.

```jsonc
{
  "responseStatus": { "statusCode": 200, "message": "OK", "text": "OK" },
  "data": {
    "continuousSerial": true,
    "restrictTeams": true,
    "ageGroups": ["40+", "50+", "55+"],
    "ratings": ["AA", "AAA"],
    "available": [
      { "id": "team-9",  "name": "Aces 60",   "meta": "Men's 60 · AAA - Mesa, AZ" }
    ],
    "pools": [
      {
        "id": "pool_a", "name": "Pool A", "isDefault": true,
        "teams": [ { "id": "team-1", "name": "Thunder 60", "meta": "Men's 60 · Major - Dallas, TX" } ]
      }
    ]
  }
}
```

| Field | Type | Notes |
|---|---|---|
| `continuousSerial` | boolean | The division's `continuous_team_sr_no` — drives whether serials run unbroken across pools or restart per pool (display-only). |
| `restrictTeams` / `ageGroups` / `ratings` | boolean / string[] / string[] | Eligibility line; mirror the division's restriction. |
| `available[]` | `ManagePoolTeam[]` | Eligible, unplaced teams. `meta` is a pre-joined "age · rating - city, ST" line. |
| `pools[]` | `DivisionPool[]` | `{ id, name, isDefault, teams[] }` — `teams[]` in placement order. |

### 7.2 Save pools (bulk reconcile)

- **Endpoint**: `PUT /v2/association/events/{associationId}/{eventId}/divisions/{divisionId}/pools`
- **Purpose**: Commit the modal's entire working copy in **one transaction**. The body is the **complete desired state** — every pool the division should have (with its name + ordered team ids). The backend **diffs it against the current rows** and reconciles pool lifecycle **and** team placement together.

**Request body** — the full intended layout (Available is *not* sent; it's inferred):

```jsonc
{
  "pools": [
    { "id": "12",      "name": "Pool A",      "teamIds": ["team-1", "team-3", "team-5"] },
    { "id": "15",      "name": "Gold Pool",   "teamIds": ["team-2"] },          // renamed existing
    { "id": null,      "name": "Pool C",      "teamIds": ["team-4"] }           // newly added
  ]
}
```

| Field | Type | Notes |
|---|---|---|
| `pools[]` | array | The **complete** set of pools the division should end up with, in display order. |
| `pools[].id` | string \| null | The existing `tournament_pools.id` for a pool that's being kept/renamed/re-placed; **`null` for a newly-added pool** (the modal's `new-*` working-copy ids are sent as `null`). |
| `pools[].name` | string | Pool display name (trimmed, required, ≤255). A rename is just a changed `name` on an existing `id`. |
| `pools[].teamIds` | string[] | The pool's member team ids **in placement order** (order drives serial numbering with the division's `continuousSerial`). |

**Reconcile rules the backend applies (diff current vs. submitted):**

1. **Create** — a `pools[]` entry with `id: null` → insert a new `tournament_pools` row.
2. **Rename** — an entry whose `id` exists but `name` changed → update.
3. **Delete** — an existing pool **absent from `pools[]`** → delete the row and **set its teams' `pool_id` to `NULL`** (they return to Available). No team is ever orphaned or deleted.
4. **Placement** — set each listed team's `pool_id` + order from its pool's `teamIds`; any eligible team **not listed in any pool** → `pool_id = NULL` (Available).
5. **Default pool** — the `is_default` pool may be **renamed but not deleted**; if it's missing from the payload, reject (don't silently drop it).
6. All of the above run in **one transaction** — if any step fails, **nothing is applied**.

**Critical backend notes**

- **Deletion is by absence**, so the client MUST send the full state built from a fresh §7.1 load — never a partial payload. (The modal does exactly this.) Document this as the contract: a missing pool means "delete it."
- **New-pool id remap** — because new pools arrive as `id: null`, the **response MUST return the reconciled state with the real assigned ids** (see below) so the modal re-syncs and a subsequent save doesn't re-create them.
- **One team in one pool** — a team id appearing in two `teamIds[]` arrays is a `400` (the client guarantees this, but validate).
- **Blocked changes fail the whole save** — if a delete/placement conflicts with already-generated seeding or scheduled games, return `409` with a message and apply nothing; the modal keeps the user's edits and surfaces the reason.

**Response** — the **refreshed §7.1 payload** (full `DivisionPoolsData`: `available[]`, `pools[]` with **real ids**, flags). The modal replaces its working copy with this so newly-created pools pick up their server ids.

| Code | When |
|---|---|
| `200` | Saved — returns the reconciled layout. |
| `400` | A team id in two pools; unknown/ineligible team id; blank/too-long pool name; default pool missing. |
| `401` / `403` | Not authenticated / lacks `manage_divisions`. |
| `404` | Division missing / soft-deleted, or not owned by `{eventId}` / `{associationId}`. |
| `409` | A change conflicts with generated seeding / scheduled games (nothing applied). |

> Frontend: `src/api/matchGeniPools.ts` — `fetchDivisionPools` (§7.1) + `saveDivisionPools` (§7.2), mock-first behind a `POOLS_ENDPOINT_LIVE` flag. On save the client sends each working-copy pool as `{ id: pool.id.startsWith('new-') ? null : pool.id, name, teamIds }` and adopts the returned layout (real ids). Types `DivisionPool` / `DivisionPoolsData` / `ManagePoolTeam` (`src/types.ts`) are unchanged.

---

## 8. Division Standings (winners) — DRAFT

> **DRAFT — to be finalized jointly across all MatchGeni APIs.** The schema (`event_tournament_standings`) and the GET/PUT routes below are not locked; the frontend ships against them mock-first (`src/api/matchGeniStandings.ts`). Revisit table columns + endpoint shapes together with the rest of the MatchGeni surface before backend implementation.

### Concept
"Standings" here means **final placements (winners)** — distinct from the pool win/loss table (`DivisionStandingEntry`, §legacy). A division's result is **not a single division-wide basis**. It's a set of **per-unit** podiums, where a *unit* is an **existing bracket OR an existing pool** (referenced by id — never a new grouping; pools, brackets, `bracket_teams` and team selection are all unchanged):

- **A team is decided by the BRACKET it's selected into UNLESS that bracket is cancelled; otherwise by its POOL.** So each team belongs to exactly one unit. A non-cancelled bracket (pending/initiated/in_progress/completed) **claims** its teams; a **cancelled** bracket **releases** them back to their pool.
- **Bracket unit** — its `bracket_teams`. A `completed` bracket materializes **auto** winners (read-only). A **`completed` bracket is never manually overridden** here — fixing it is done by reopening the game and re-ending it (recalculation, future revision). An **`in_progress`** bracket reached a callable stage **can be announced manually** from its own teams (admin chooses "Announce result"; `source = 'manual'`). `pending`/`initiated` show status only (no result yet). A `cancelled` bracket is informational (carries the cancellation reason — its teams are announced under their pool).
- **Pool unit** — that pool's teams **not claimed by a non-cancelled bracket** — i.e. never-bracketed (leftover) teams **plus** teams whose bracket was cancelled (each team falls back to **its own** pool). Always manual.

This handles the real mixed case (e.g. a bracket rained out mid-play → cancelled → its teams announced from their pool; another bracket completed → auto winners) in one division, and units are **announced independently / incrementally** — finalize one now, others later.

Placements arise two ways, both stored:
- **Auto** (`source = 'auto'`) — materialized when a bracket **completes** (1st/2nd/3rd from its final games). No admin action; **read-only.**
- **Manual** (`source = 'manual'`) — admin-announced on a **pool** unit OR an **`in_progress` bracket** unit: podiums, **co-champions** (two shared rank-1 rows, `is_co_champion = 1`), or a per-unit **no-result**. Podium depth is **variable** (top-N capped by the unit's team count).

The admin opens **Announce result** from the division-detail left panel. It lists every unit. Pool rows carry the pickers directly. A bracket row is read-only EXCEPT when `in_progress` — then it offers **"Announce result"** (reveals the pickers, sourced from the bracket's own teams) and **"Cancel bracket"** (rain/other — see §8.3 — releases its teams to their pool). `completed` brackets show their auto podium read-only; `pending`/`initiated` show status only.

**`event_tournament_standings` is the single source of truth** — reads return rows straight from it and **never re-scan `tournament_games`**.

### Underlying table — `event_tournament_standings` (sql-schema, to add in the joint pass)

| Column | Type | Notes |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | |
| `tournament_id` | BIGINT UNSIGNED FK → `event_tournaments.id` | The division. CASCADE. |
| `bracket_id` | BIGINT UNSIGNED FK → `tournament_brackets.id`, NULL | Set when the unit is a bracket. **Exactly one of `bracket_id` / `pool_id` is non-null.** |
| `pool_id` | BIGINT UNSIGNED FK → `tournament_pools.id`, NULL | Set when the unit is a pool (its non-bracket teams). |
| `team_id` | BIGINT UNSIGNED FK → `teams.id` | RESTRICT (never lose a placed team). |
| `rank` | TINYINT | 1/2/3/… Co-champions share `rank = 1`. |
| `is_co_champion` | TINYINT(1) | Two `rank = 1` rows in a unit when set. |
| `source` | ENUM(`auto`,`manual`) | Materialized-from-bracket vs admin-announced. |
| `status` | ENUM(`announced`,`no_result`) | A unit declared no-result keeps a marker row with no placements. |
| `created_by` / `updated_by` | BIGINT UNSIGNED FK → `users.id`, NULL | Audit; SET NULL. |
| `created_at` / `updated_at` / `deleted_at` | TIMESTAMP NULL | |

Index/uniqueness (TBD): unique-ish `(tournament_id, bracket_id, pool_id, team_id)`; `(tournament_id, bracket_id, pool_id, rank)`. There is **no** division-level `basis` column — source/status live per unit.

### 8.1 Get standings
- **Endpoint**: `GET /v2/association/events/{associationId}/{eventId}/divisions/{divisionId}/standings`
- **Returns** `DivisionStandings` — the division's **units** (brackets + leftover-team pools), each with its own source/status:
```jsonc
{
  "divisionId": "1273",
  "complete": true,
  "needsManual": true,          // any unit still 'pending'
  "units": [
    {
      "kind": "bracket",        // 'bracket' | 'pool'
      "refId": "bk_1",          // the existing bracket id (or pool id when kind='pool')
      "name": "Gold Bracket",
      "teamCount": 4,
      "playStatus": "complete", // 'not_started' | 'initiated' | 'in_progress' | 'complete' | 'cancelled'
      "source": "auto",         // 'auto' | 'manual'
      "status": "announced",    // 'pending' | 'announced' | 'no_result'
      "editable": false,        // bracket units are always read-only; pool units true
      "placements": [
        { "rank": 1, "rankLabel": "1st", "teamId": "55", "teamName": "Thunder 60" },
        { "rank": 2, "rankLabel": "2nd", "teamId": "61", "teamName": "Mavericks 65" },
        { "rank": 3, "rankLabel": "3rd", "teamId": "48", "teamName": "Outlaws 80" }
      ]
    },
    {
      "kind": "pool", "refId": "pool_a", "name": "60 AAA Pool",
      "teamCount": 8, "playStatus": "complete",
      "source": "manual", "status": "pending", "editable": true, "placements": []
    }
  ]
}
```
- `needsManual = true` when any unit is still `pending` (drives the **Announce result** CTA). A `no_result` unit records no placements. Each podium is up to its team count (variable); co-champions return two `rank: 1` rows with `coChampion: true`.

### 8.2 Announce result — per unit (manual)
- **Endpoint**: `PUT /v2/association/events/{associationId}/{eventId}/divisions/{divisionId}/units/{kind}/{refId}/standings`
- **Auth**: `manage_divisions` / `fullControl`.
- **Body** (`SetUnitStandingsPayload`): `{ kind, refId, noResult?, placements: [{ rank, teamId?, teamName, coChampion? }] }`. **Replaces just this unit's** result with `source = 'manual'` rows. Valid for **pool** units and **`in_progress` bracket** units (a bracket called manually before it auto-completes); `completed`/`cancelled`/`pending`/`initiated` brackets are not manually announced. `noResult: true` records the unit no-result (no placements). Other units are untouched (incremental).
- **Response**: the refreshed `DivisionStandings` (§8.1 shape).

### 8.3 Cancel bracket — DRAFT
- **Endpoint**: `PUT /v2/association/events/{associationId}/{eventId}/divisions/{divisionId}/brackets/{bracketId}/cancel`
- **Auth**: `manage_divisions` / `fullControl`.
- **Body**: `{ reasonCode, note? }` where `reasonCode ∈ { rain, field_conditions, time_curfew, other }`.
- **Effect**: sets `tournament_brackets.status = 'cancelled'` and records `cancel_reason_code` / `cancel_reason_note` / `cancelled_at` / `cancelled_by`. A cancelled bracket can't produce winners → its teams become announceable under their pool (§8.1 re-derivation). Games already scored stay on record (`tournament_games`). Offered only while the bracket is `initiated` / `in_progress`.
- **Response**: the refreshed `DivisionStandings` (§8.1 shape).

> Frontend: clients `fetchDivisionStandings` / `setUnitStandings` (`src/api/matchGeniStandings.ts`) + `cancelBracket` (`src/api/matchGeniBrackets.ts`), all mock; types `DivisionStandings` / `StandingUnit` / `StandingPlacement` / `SetUnitStandingsPayload` / `BracketStatus` / `BracketCancellation` (`src/types.ts`). UI: the division-detail left overview card shows a **Winners panel** (union of announced units) once any unit is announced; the **Announce result** action (read-only bracket rows by status + manual pool pickers) lives in that left panel via `AnnounceResultModal.vue`; **Cancel bracket** uses the shared `CancelBracketModal.vue` from both the modal and the bracket canvas (`MatchGeniDivisionDetail.vue`).

## Implementation checklist

| Item | Where |
|---|---|
| `event_tournament_standings` table (`bracket_id` XOR `pool_id`, per-unit `source`/`status`) + auto-materialize on bracket completion (DRAFT) | Backend, `sql-schema.md` |
| `tournament_brackets.status` 5-state enum (`pending`/`initiated`/`in_progress`/`completed`/`cancelled`) + `cancel_reason_code` / `cancel_reason_note` / `cancelled_at` / `cancelled_by` (DRAFT) | Backend, `sql-schema.md` |
| `GET` standings + **per-pool-unit** `PUT` announce route + **`PUT …/brackets/{id}/cancel`** (read table only, no games scan) (DRAFT) | Backend |
| `fetchDivisionStandings` / `setUnitStandings` + `cancelBracket` clients + standings/bracket types (`StandingUnit` / `SetUnitStandingsPayload` / `BracketStatus` / `BracketCancellation`) | `src/api/matchGeniStandings.ts`, `src/api/matchGeniBrackets.ts`, `src/types.ts` |
| Winners panel (progress ↔ winners) + Announce Result modal (read-only bracket rows by status + manual pool pickers) + shared Cancel-bracket modal | `src/components/MatchGeniDivisionDetail.vue`, `src/components/AnnounceResultModal.vue`, `src/components/CancelBracketModal.vue` |
| `event_tournaments` toggle columns: `restrict_teams_entry`, `custom_format`, `use_event_seed`, `use_event_field_config` (tinyint 0/1) + `pool_game_guarantee` / `bracket_format` / `field_config_id` value columns | Backend, `sql-schema-tournament.md#event_tournaments` |
| `POST` / `PATCH` routes + one-transaction write (row incl. the three toggle columns + seed-criteria reconcile gated by `use_event_seed` + default pool) | Backend |
| `event.timeZone` on the access payload (already documented) | Backend + `matchgeni-access-api-contract.md` §1 |
| `start_at_utc` / `end_at_utc` columns + derive them server-side from `startDate` / `endDate` + submitted `timeZone` (start-of-day / end-of-day) on create + update | Backend, `sql-schema-tournament.md#event_tournaments` |
| `tournament_seed_criteria` table + FK indexes | `sql-schema-tournament.md#tournament_seed_criteria` |
| `createDivision()` / `updateDivision()` client + `CreateDivisionPayload` / `CreateDivisionResult` types | `src/api/matchGeniDivisions.ts`, `src/types.ts` |
| Wizard `save()` → calls the client; seeds defaults from the access payload | `src/components/MatchGeniDivisionFormModal.vue` |
| `GET` list route + compute-on-read `teamCount` / `bracketCount` (indexed `LEFT JOIN COUNT GROUP BY`); NO statuses/progress/gameCount | Backend |
| `fetchMatchGeniDivisions()` client + `MatchGeniDivisionSummary` type | `src/api/matchGeniDivisions.ts`, `src/types.ts` |
| Dashboard list renders date + name + format + count pills; row → division-detail | `src/components/MatchGeniDivisionList.vue`, `src/views/MatchGeniDashboardView.vue` |
