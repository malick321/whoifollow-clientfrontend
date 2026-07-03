---
status: Draft (v1)
owner: shared
last_updated: 2026-07-02
---

# Player Passport (Player Stats) — REST API contract

## Context

Powers the **Player Passport** — a player's personal, career-spanning batting profile built
from the association-entered scoring data. This is the platform's premium consumer surface: the
one thing WhoIFollow has that nobody else in senior/rec softball owns — **verified, per-player
statistics tied to a stable identity across every event they've ever played**.

It powers:

- `src/views/PlayerPassportView.vue` — the public player profile (`/players/:playerId`) and the
  member's own passport (`/my/stats`).
- The **leaderboards** surface (`/game-time` → association / event leaderboards).
- The teaser cards that appear on rosters, lineups, and the For You feed ("View stats").

Data source of truth is the **plate-appearance ledger** (`game_batting_appearances`) that scorers
fill in through the Scoresheet. Every lineup row carries a stable `user_id`, so one person's
performance is aggregated across all their games, events, and seasons.

All endpoints are rooted under `/v2/players/...` (and `/v2/leaderboards`). For shared rules —
response envelope, pagination shape, auth header, error codes, image-URL handling — see
[`conventions.md`](./conventions.md).

**Naming convention (wire ≠ DB).** Request/response fields and query params are **camelCase**
regardless of the underlying column name. DB column names (`game_batting_appearances`,
`result_code`, `counts_as_at_bat`, …) appear only inside the SQL sketches. IDs serialize as
numeric strings; `playerId` is the `users.id`.

---

## Monetization model — Free vs Player Pro (READ THIS FIRST)

The passport is a **freemium** surface. The *same* endpoints serve both tiers; the backend
decides what to fill in based on the **viewer's** entitlement (`user_profiles.pro_status`), not
the profile owner's. Every stats response therefore carries an `access` block, and locked metric
values come back as `null` (never omitted, never faked) so the UI can render a blur/upgrade
overlay in a stable layout.

| Capability | Free viewer | Player Pro |
|---|---|---|
| Identity header (name, teams, position, photo) | ✅ | ✅ |
| Season **AVG**, Games, Hits, HR, RBI (current season) | ✅ | ✅ |
| **Career** totals (all seasons) | 🔒 teaser (G + AVG only) | ✅ full |
| Advanced rate metrics **OBP / SLG / OPS** | 🔒 | ✅ |
| Per-game **game log** | last **3** games | ✅ unlimited |
| **Season-by-season splits** | 🔒 | ✅ |
| Shareable player card / PDF export | 🔒 | ✅ |
| Leaderboards — see own rank | ✅ | ✅ |
| Leaderboards — full table beyond top 5 | 🔒 | ✅ |

- **`access.tier`** — `"free" | "pro"`. Derived from the bearer token's user.
- **`access.isSelf`** — `true` when the viewer is the profile owner (a player always sees their
  own current-season basics; career/advanced still gated unless Pro — that's the upgrade hook).
- **`access.lockedMetrics`** — array of camelCase metric keys the backend nulled out for this
  viewer (e.g. `["obp","slg","ops","career"]`). The UI reads this to know what to overlay.
- **Entitlement source**: `user_profiles.pro_status` (truthy + unexpired `pro_expiry`). The
  existing `CheckSubscription` middleware resolves it; see the monetization notes in
  `platform-mission-monetization`. B2B tiers (association / recruiter) are out of scope for v1 —
  they unlock the same fields plus roster-wide export, tracked as a later `access.tier` value.

---

## Endpoints summary

| # | Method & path | Purpose | Auth |
|---|---|---|---|
| 1 | `GET /v2/players/{playerId}/profile` | Identity header + headline career line (teaser). | Optional (auth-aware) |
| 2 | `GET /v2/players/{playerId}/stats?scope=&season=` | Aggregated batting stats (career or one season). | Optional (auth-aware) |
| 3 | `GET /v2/players/{playerId}/game-log?season=&page=&perPage=` | Per-game box scores (paginated). | Optional (auth-aware) |
| 4 | `GET /v2/players/{playerId}/splits` | Season-by-season stat rows. **Pro.** | Required |
| 5 | `GET /v2/players/me/summary` | Convenience: the logged-in user's own passport bundle. | Required |
| 6 | `GET /v2/leaderboards?stat=&scope=&season=&limit=` | Ranked leaders for a scope (assoc/event/team). | Optional (auth-aware) |

All reads are **auth-aware but not auth-required** (except #4/#5): a public/anonymous caller gets
the free-tier shape; a bearer token upgrades the response to whatever the viewer is entitled to.

---

## Scope decisions (locked in)

- **`playerId` is `users.id`** (numeric string). A player = a user who appears on any
  `game_lineup_players` row with a non-null `user_id`. Free-text-only lineup entries (no
  `user_id`) have no passport (they're unclaimed — a future "claim your stats" growth loop).
- **Stats are computed from the plate-appearance ledger** (`game_batting_appearances`), never
  from the denormalized `game_batting_stats` (which is a per-game cache). The ledger is the source
  of truth so career/season/splits/leaderboards all agree. `game_batting_stats` MAY be used as a
  read-through cache keyed by `(tournament_game_id, game_lineup_player_id)` — but the contract
  numbers are defined against the ledger (see § Backend computation).
- **Only FINAL games count** — a game contributes to stats only when `tournament_games.status = 2`
  (final). In-progress (`1`) and scheduled (`0`) games are excluded from career/season/leaderboard
  aggregates (they may appear as "live" in the game log with a `live: true` flag, stats provisional).
- **"Season" = calendar year of the game date** (`YEAR(tournament_games.start_date)`), defaulting
  to the current year when `season` is omitted on #2/#3. `scope=career` ignores `season`.
- **Sport scope**: v1 is softball/baseball batting only (`sport_type_id = 2`). Pitching/fielding
  (`game_bowling_stats`, `game_fielding_stats`) are schema-ready but out of scope for v1 — reserve
  `stats.pitching` / `stats.fielding` keys for later, return `null` for now.
- **Rate-stat qualifier**: AVG/OBP/SLG/OPS are returned for any PA count, but a `qualified` flag
  marks whether the player clears the minimum (`minPlateAppearances`, default **10** career / **5**
  season) — leaderboards only rank qualified players. Below the floor, rate stats still compute but
  `qualified: false` so the UI can caveat them.
- **Entitlement gating is server-side.** The frontend NEVER decides what to show from the tier — it
  renders whatever the backend returns and overlays `access.lockedMetrics`. Locked values are
  `null`, never partial/obfuscated numbers (no leaking via the wire).
- **Images**: `avatarUrl` follows the shared image rule (Cloudflare-transformed, preset `avatar_md`).
  Opaque to the client.

---

## Underlying tables

| Table | Role |
|---|---|
| `game_batting_appearances` | **Source of truth.** One row per plate appearance (`result_code`, `rbi`, `run_scored`, `counts_as_at_bat`, `counts_as_plate_appearance`). |
| `game_lineup_players` | Links a PA to a player (`user_id`), team, and game. The identity join. |
| `game_batting_stats` | Per-game aggregate cache (optional read-through). |
| `tournament_games` | Game context: `status`, `start_date`, `team_1_id/team_2_id`, scores, `winner_id`, `event_id`, `tournament_id`. Filters final games + season + opponent + W/L. |
| `event_tournaments` | Division name (`tournamentName`) + event linkage for the game log. |
| `team_events` | Event name / association for the game log. |
| `teams` | Team + opponent names, `team_avatar`. |
| `users` / `user_profiles` | Player identity: `name`, `profile_avatar`, `pro_status` (entitlement). |

---

## 1) `GET /v2/players/{playerId}/profile`

Identity header for the passport. Always returns the identity + a **headline** career line (games
played + career AVG) even for free viewers — that's the teaser that sells the upgrade.

**Response**

```json
{
  "responseStatus": { "message": "Player profile fetched.", "statusCode": 200, "text": "OK" },
  "data": {
    "player": {
      "id": "9",
      "name": "reg fer",
      "avatarUrl": "https://cdn.whoifollow.tech/cdn-cgi/image/.../avatar.jpg",
      "primaryPosition": "EH",
      "teams": [
        { "id": "1263", "name": "wefeaw", "avatarUrl": null, "sportType": "Softball (Fast Pitch)", "ageGroup": "40 Older", "gender": "Female" }
      ],
      "memberSince": "2026-04-09T00:00:00Z",
      "firstGameDate": "2025-06-14",
      "lastGameDate": "2026-04-13"
    },
    "headline": {
      "seasonsPlayed": 2,
      "careerGames": 13,
      "careerAvg": "0.397",
      "careerHomeRuns": 6,
      "careerRbi": 41
    },
    "access": { "tier": "free", "isSelf": false, "lockedMetrics": [] }
  }
}
```

**Field notes**

- `primaryPosition` — most-frequent `position_code` across the player's final-game lineups.
- `teams[]` — distinct teams the player has a lineup row for, most-recent first. `avatarUrl` per
  the image rule.
- `headline.careerAvg` — string, 3 decimals (see § Number formatting). Always present (teaser).
  `careerHomeRuns` / `careerRbi` are cheap counting stats and also always present.
- The headline is intentionally NOT gated — it's the hook. Everything richer lives on #2.

---

## 2) `GET /v2/players/{playerId}/stats`

The core aggregate. One object of counting + rate stats for a scope.

**Query params**

| Param | Type | Default | Notes |
|---|---|---|---|
| `scope` | `career` \| `season` | `season` | `career` = all final games; `season` = one calendar year. |
| `season` | int (year) | current year | Only used when `scope=season`. |

**Response** (Pro viewer, `scope=career`)

```json
{
  "responseStatus": { "message": "Player stats fetched.", "statusCode": 200, "text": "OK" },
  "data": {
    "scope": "career",
    "season": null,
    "player": { "id": "9", "name": "reg fer", "avatarUrl": "…" },
    "stats": {
      "games": 13,
      "plateAppearances": 58,
      "atBats": 49,
      "runs": 22,
      "hits": 21,
      "singles": 11,
      "doubles": 3,
      "triples": 1,
      "homeRuns": 6,
      "rbi": 41,
      "walks": 8,
      "strikeouts": 7,
      "totalBases": 44,
      "avg": "0.429",
      "obp": "0.500",
      "slg": "0.898",
      "ops": "1.398",
      "qualified": true,
      "pitching": null,
      "fielding": null
    },
    "access": { "tier": "pro", "isSelf": false, "lockedMetrics": [] }
  }
}
```

**Response** (Free viewer, `scope=career` — advanced + career depth locked)

```json
{
  "data": {
    "scope": "career",
    "stats": {
      "games": 13, "hits": 21, "homeRuns": 6, "rbi": 41,
      "plateAppearances": null, "atBats": null, "runs": null,
      "singles": null, "doubles": null, "triples": null, "walks": null,
      "strikeouts": null, "totalBases": null,
      "avg": "0.397", "obp": null, "slg": null, "ops": null,
      "qualified": true, "pitching": null, "fielding": null
    },
    "access": { "tier": "free", "isSelf": true, "lockedMetrics": ["obp","slg","ops","careerDepth"] }
  }
}
```

**Field notes**

- Counting stats (`games`…`totalBases`) are integers; rate stats (`avg/obp/slg/ops`) are **strings**
  to 3 decimals to preserve the leading-zero baseball convention (`"0.429"`, `"1.398"`).
- `totalBases` = 1B·1 + 2B·2 + 3B·3 + HR·4 (drives SLG).
- **Free-tier nulling** (see § Monetization): on `scope=career` for a free viewer, everything but
  `games / hits / homeRuns / rbi / avg` is `null`; on `scope=season` a free viewer keeps the basics
  and only `obp/slg/ops` are nulled (season basics are free, career depth + advanced are the wall).
- `qualified` — `plateAppearances >= minPlateAppearances` for the scope (career 10 / season 5).

---

## 3) `GET /v2/players/{playerId}/game-log`

Per-game box scores, newest first.

**Query params**: `season` (year, optional — omit for all), `page` (default 1), `perPage`
(default 25, max 50).

**Response**

```json
{
  "data": {
    "games": {
      "data": [
        {
          "gameId": "981",
          "date": "2026-04-13",
          "eventName": "Spring Kickoff Classic",
          "division": "40+ Women's Major",
          "opponent": { "id": "1258", "name": "Renegades", "avatarUrl": null },
          "result": "W",
          "teamScore": 14,
          "opponentScore": 9,
          "line": { "ab": 4, "r": 2, "h": 3, "rbi": 4, "hr": 1, "bb": 1, "k": 0, "avg": "0.750" },
          "live": false
        }
      ],
      "current_page": 1, "per_page": 25, "total": 13, "last_page": 1
    },
    "access": { "tier": "pro", "isSelf": false, "lockedMetrics": [] }
  }
}
```

**Field notes**

- `result` — `"W" | "L" | "T"` from `tournament_games.winner_id` vs the player's team.
- `line.avg` — the player's AVG **for that game** (game H / game AB), string 3-dp.
- **Free gating**: a free viewer receives only the **3 most-recent** rows; `total` still reflects
  the true count, and `access.lockedMetrics` includes `"gameLogHistory"` so the UI shows a
  "Unlock full game log" row. Pro returns the full paginated set.
- `live: true` when `status = 1` (in-progress) — stats provisional, excluded from #2 aggregates.

---

## 4) `GET /v2/players/{playerId}/splits`  *(Pro)*

Season-by-season breakdown — one row per calendar year the player has final games.

**Response**

```json
{
  "data": {
    "splits": [
      { "season": 2026, "games": 8, "avg": "0.429", "obp": "0.512", "slg": "0.929", "ops": "1.441", "hits": 15, "homeRuns": 4, "rbi": 27, "qualified": true },
      { "season": 2025, "games": 5, "avg": "0.353", "obp": "0.476", "slg": "0.824", "ops": "1.300", "hits": 6, "homeRuns": 2, "rbi": 14, "qualified": true }
    ],
    "access": { "tier": "pro", "isSelf": false, "lockedMetrics": [] }
  }
}
```

**Field notes**: `403` for a free viewer (whole endpoint is Pro) — the UI never calls it for free
users; it renders the locked panel from #2's `access` instead.

---

## 5) `GET /v2/players/me/summary`  *(auth required)*

Convenience bundle for the logged-in user's own passport — resolves `me` → the token's `users.id`
and returns `{ profile, careerStats, currentSeasonStats, recentGames }` in one round-trip (the same
shapes as #1/#2/#3) so `/my/stats` renders without a fan-out. `access.isSelf` is always `true`.

---

## 6) `GET /v2/leaderboards`  *(auth-aware)*

Ranked leaders within a scope. The competitive, viral surface.

**Query params**

| Param | Type | Notes |
|---|---|---|
| `stat` | `avg` \| `obp` \| `slg` \| `ops` \| `hr` \| `rbi` \| `hits` \| `runs` | Ranking metric. Rate stats rank qualified players only. |
| `scope` | `association:{id}` \| `event:{id}` \| `team:{id}` | Population to rank within. |
| `season` | int (year) | Optional; omit for all-time. |
| `limit` | int | Default 25, max 100. |

**Response**

```json
{
  "data": {
    "stat": "avg",
    "scope": "association:12",
    "season": 2026,
    "qualifier": { "metric": "plateAppearances", "min": 5 },
    "rows": [
      { "rank": 1, "player": { "id": "9", "name": "reg fer", "avatarUrl": "…" }, "team": { "id": "1263", "name": "wefeaw" }, "value": "0.429", "games": 8 },
      { "rank": 2, "player": { "id": "23", "name": "Ahmar Reg", "avatarUrl": "…" }, "team": { "id": "1263", "name": "wefeaw" }, "value": "0.361", "games": 8 }
    ],
    "viewerRank": { "rank": 1, "value": "0.429" },
    "access": { "tier": "free", "isSelf": false, "lockedMetrics": ["leaderboardTail"] }
  }
}
```

**Field notes**

- `value` — string for rate stats (3-dp), integer-as-number for counting stats.
- **Free gating**: free viewers get the **top 5** rows + their own `viewerRank` (even if outside
  top 5), and `access.lockedMetrics` carries `"leaderboardTail"`. Pro gets the full `limit`.
- `viewerRank` — null for anonymous callers or players with no qualifying stats in scope.

---

## Stat definitions & backend computation

All aggregates derive from `game_batting_appearances` (`gba`) joined to `game_lineup_players`
(`glp`) on `glp.id = gba.game_lineup_player_id`, filtered to the player and **final** games.

**Result-code semantics** (from `result_code`):

| Code | Meaning | Hit? | Bases | Counts as AB | Counts as PA |
|---|---|---|---|---|---|
| `1B` | single | ✅ | 1 | ✅ | ✅ |
| `2B` | double | ✅ | 2 | ✅ | ✅ |
| `3B` | triple | ✅ | 3 | ✅ | ✅ |
| `HR` | home run | ✅ | 4 | ✅ | ✅ |
| `BB` / `IBB` | walk | ❌ | 0 | ❌ | ✅ |
| `HBP` | hit by pitch | ❌ | 0 | ❌ | ✅ |
| `SF` / `SAC` | sac fly / bunt | ❌ | 0 | ❌ | ✅ |
| `K` / `Kc` | strikeout | ❌ | 0 | ✅ | ✅ |
| `GO` / `FO` / `LO` / `PO` | out in play | ❌ | 0 | ✅ | ✅ |
| `E` / `FC` | reached on error / fielder's choice | ❌ | 0 | ✅ | ✅ |

The authoritative flags are the stored booleans `counts_as_at_bat` / `counts_as_plate_appearance`
(the scorer/UI sets them per code); the table above is the canonical mapping the writer applies.

**Formulas**

```
G   = COUNT(DISTINCT gba.tournament_game_id)
PA  = SUM(counts_as_plate_appearance)
AB  = SUM(counts_as_at_bat)
H   = SUM(result_code IN ('1B','2B','3B','HR'))
1B  = SUM(result_code = '1B');  2B = …; 3B = …; HR = SUM(result_code='HR')
BB  = SUM(result_code IN ('BB','IBB','HBP'))
K   = SUM(result_code IN ('K','Kc'))
R   = SUM(run_scored = 1)
RBI = SUM(rbi)
TB  = 1B*1 + 2B*2 + 3B*3 + HR*4
AVG = H / NULLIF(AB,0)                         → 3-dp string
OBP = (H + BB) / NULLIF(PA,0)                  → 3-dp string   (SF excluded from denom is optional; v1 uses PA)
SLG = TB / NULLIF(AB,0)                        → 3-dp string
OPS = OBP + SLG                                → 3-dp string
```

**Aggregate SQL sketch** (career for one player):

```sql
SELECT
  COUNT(DISTINCT gba.tournament_game_id)                                   AS games,
  SUM(gba.counts_as_plate_appearance)                                      AS pa,
  SUM(gba.counts_as_at_bat)                                                AS ab,
  SUM(gba.result_code IN ('1B','2B','3B','HR'))                            AS h,
  SUM(gba.result_code='2B')                                                AS doubles,
  SUM(gba.result_code='3B')                                                AS triples,
  SUM(gba.result_code='HR')                                                AS hr,
  SUM(gba.result_code IN ('BB','IBB','HBP'))                               AS bb,
  SUM(gba.result_code IN ('K','Kc'))                                       AS k,
  SUM(gba.run_scored=1)                                                    AS r,
  SUM(gba.rbi)                                                             AS rbi
FROM game_batting_appearances gba
JOIN game_lineup_players glp ON glp.id = gba.game_lineup_player_id
JOIN tournament_games   tg  ON tg.id  = gba.tournament_game_id
WHERE glp.user_id = :playerId
  AND tg.status = 2                      -- final games only
  AND glp.deleted_at IS NULL;
  -- season scope adds: AND YEAR(tg.start_date) = :season
```

Leaderboards run the same aggregate grouped by `glp.user_id`, scoped by the population
(association → its events → their `tournament_games`; event → its games; team → `glp.team_id`),
filtered to `PA >= qualifier.min` for rate stats, ordered by the chosen metric.

## Number formatting

- Rate stats (`avg/obp/slg/ops` and leaderboard `value` for rate metrics) are **strings** rounded
  half-up to 3 decimals, keeping the leading zero for values < 1 (`"0.429"`) and no leading zero
  suppression for ≥ 1 (`"1.398"`). Division by zero → `"0.000"` (or `null` when locked).
- Counting stats are JSON numbers.
- Dates in the game log are `YYYY-MM-DD` (date-only, no TZ) since a game belongs to a calendar day;
  `memberSince` / timestamps follow the ISO-8601-UTC rule.

## Errors

Standard envelope (see conventions). Notable cases:

| Code | When |
|---|---|
| `404` | `playerId` has no `users` row, or has zero final-game lineup rows (no passport yet). |
| `403` | #4 splits / #5 me called without a valid token; Pro-only #4 called by a free viewer. |
| `422` | Bad `scope`, non-numeric `season`, unknown `stat`, or malformed `scope` on #6. |

## Frontend wiring (mirror-back plan)

- `src/api/playerPassport.ts` — call entry points (`fetchPlayerProfile`, `fetchPlayerStats`,
  `fetchPlayerGameLog`, `fetchPlayerSplits`, `fetchMySummary`, `fetchLeaderboard`).
- `src/api/adapters/playerPassport.ts` — raw → typed model (`PlayerProfile`, `PlayerStats`,
  `PlayerGameLogRow`, `SeasonSplit`, `LeaderboardRow`) + the `access` block.
- `src/api/contracts/playerPassport.ts` — wire types.
- `src/types.ts` — shared interfaces.
- `src/views/PlayerPassportView.vue` + `src/components/stats/*` — the UI (stat cards reuse
  `SummaryCard`; game log reuses the scoresheet table vocabulary; no new design primitives).
