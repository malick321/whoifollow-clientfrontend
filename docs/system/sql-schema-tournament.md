---
status: Draft
owner: shared
last_updated: 2026-06-15
---

# SQL Schema — Tournament & Games Tables

Domain-split slice of the WhoIFollow schema. **Shared conventions** — engine/charset/collation, primary keys, foreign-key rules, standard audit columns (`created_at`/`updated_at`/`deleted_at`/`created_by`/`updated_by`/`deleted_by`), UTC timestamp handling, soft-delete, and naming — live in [`sql-schema.md`](./sql-schema.md) and apply to every table here.

This doc holds the division (`event_tournaments`) and all game-level tables (games, scores, innings, brackets, pools, seed-criteria overrides).

## Tables in this doc

- [`event_tournaments`](#event_tournaments)
- [`tournament_games`](#tournament_games)
- [`tournament_game_scores`](#tournament_game_scores)
- [`tournament_game_innings`](#tournament_game_innings)
- [`tournament_brackets`](#tournament_brackets)
- [`tournament_bracket_teams`](#tournament_bracket_teams)
- [`tournament_game_delayed`](#tournament_game_delayed)
- [`tournament_pools`](#tournament_pools)
- [`tournament_seed_criteria`](#tournament_seed_criteria)
- [`tournament_teams`](#tournament_teams)

---

### `event_tournaments`

#### Purpose

Child table of `team_events` — one event can host many tournaments / divisions (e.g. "Men's 50+ Major", "Women's 40+ A", "Coed 18+ B"). Per-tournament fields override the event-level defaults from `team_events` (entry_fee, registration window, bracket format).

Existing in production; this section captures the **post-M7a + M7b end-state**. Per locked decisions, no column renames; mixed casing is an inherited artifact preserved for compatibility with existing consumers.

#### CREATE script (target end-state — post-M7a + M7b)

```sql
CREATE TABLE `event_tournaments` (
  `id`                          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,         -- Widened from INT UNSIGNED in M7a
  `guid`                        VARCHAR(45) NULL,
  `event_id`                    BIGINT UNSIGNED NOT NULL,                         -- Narrowed from VARCHAR(255) in M7a so FK type-aligns with team_events.id

  `avatar`                      VARCHAR(255) NULL COMMENT 'Image filename or full source URL — backend wraps via transformImageUrl() before emitting on the wire (see shared-catalogues §7).',
  `tournamentName`              VARCHAR(255) NULL,
  `notes`                       LONGTEXT NULL,
  `format`                      LONGTEXT NULL,

  -- Location (existing)
  `state`                       VARCHAR(255) NULL,
  `city`                        VARCHAR(255) NULL,
  `region`                      VARCHAR(255) NULL,

  -- Dates & timezone.
  -- Legacy camelCase VARCHAR columns preserved verbatim for backwards-
  -- compat with consumers that still read them. New API writes go to
  -- the snake_case `tournament_*` columns grouped in the "NEW columns
  -- added in M7a" block below — the snake_case `start_at_utc` /
  -- `end_at_utc` mirrors source from THOSE, not these legacy columns.
  `startDate`                   VARCHAR(255) NULL,
  `endDate`                     VARCHAR(255) NULL,
  `startTime`                   VARCHAR(255) NULL,
  `endTime`                     VARCHAR(255) NULL,

  -- ── NEW columns added in M7a ─────────────────────────────────────────

  -- Canonical, typed date / time columns the new API reads + writes.
  -- snake_case per the dev-team convention. Named with the
  -- `tournament_*` prefix since this table is per-tournament — the
  -- parent `team_events` row uses `event_*` for its own equivalent.
  -- Legacy rows have these NULL; new writes populate them. The UTC
  -- mirrors below source from these columns, not from the legacy
  -- block above.
  `tournament_start_date`       DATE NULL,
  `tournament_end_date`         DATE NULL,
  `tournament_start_time`       TIME NULL,
  `tournament_end_time`         TIME NULL,
  `time_zone`                   VARCHAR(64) NOT NULL DEFAULT 'America/Los_Angeles',
  `all_day`                     BOOLEAN NOT NULL DEFAULT FALSE,
  -- UTC mirrors source from the NEW snake_case columns. snake_case
  -- names since these are new fields too. App-written nullable TIMESTAMPs
  -- (NOT generated columns): the backend computes CONVERT_TZ in
  -- application code on every INSERT/UPDATE and writes the result here.
  -- Standardized on this style to match team_events — keeps the
  -- conversion testable and decoupled from MySQL's loaded TZ tables.
  -- Legacy rows are one-shot backfilled at migration time.
  `start_at_utc`                TIMESTAMP NULL DEFAULT NULL,
  `end_at_utc`                  TIMESTAMP NULL DEFAULT NULL,

  -- Counts (existing)
  `pastTeamsCount`              INT NULL,
  `currentTeamsCount`           INT NULL,

  -- Simple active flag (existing semantics — not a lifecycle workflow like team_events.event_status).
  -- Values: '0' = inactive, '1' = active. Preserved verbatim from production.
  `status`                      VARCHAR(255) NOT NULL DEFAULT '1' COMMENT '0=inactive, 1=active',

  -- Entry / fees
  `entry_deadline`              DATE NULL,
  `entry_fee`                   FLOAT NULL,

  -- Division / age catalogues (existing free-form strings)
  `months`                      VARCHAR(255) NULL,
  `senior_ages`                 VARCHAR(255) NULL,
  `divisions`                   VARCHAR(255) NULL,
  `age_group`                   VARCHAR(255) NULL,
  `rate_id`                     INT NULL DEFAULT 0,

  -- Bracket / format settings (existing)
  `bracket_format`              VARCHAR(255) NULL,
  `time_limit`                  INT NULL,
  `custom_format`               VARCHAR(255) NULL,
  `pool_game_guarantee`         INT NULL,
  `custom_seed_criteria`        VARCHAR(255) NULL,
  `UseEventSeedCriteria`        BOOLEAN NULL DEFAULT FALSE,
  `use_event_seed`              BOOLEAN NULL DEFAULT TRUE,
  `pool_play_time`              VARCHAR(255) NULL,
  `championship_time`           VARCHAR(255) NULL,
  `bracket_time`                VARCHAR(255) NULL,
  `seed_count_created`          BOOLEAN NULL DEFAULT FALSE,
  `bracket_play_started`        BOOLEAN NULL DEFAULT FALSE,
  `field_config_id`             BIGINT UNSIGNED NULL,
  `continuous_team_sr_no`       BOOLEAN NOT NULL DEFAULT TRUE,

  -- Audit (widened to BIGINT UNSIGNED in M7a)
  `created_by`                  BIGINT UNSIGNED NULL,
  `updated_by`                  BIGINT UNSIGNED NULL,
  `deleted_by`                  BIGINT UNSIGNED NULL,
  `created_at`                  TIMESTAMP NULL DEFAULT NULL,
  `updated_at`                  TIMESTAMP NULL DEFAULT NULL,
  `deleted_at`                  TIMESTAMP NULL DEFAULT NULL,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_event_tournaments_guid` (`guid`),
  KEY `idx_event_tournaments_event`           (`event_id`),
  KEY `idx_event_tournaments_status`          (`event_id`, `status`),
  KEY `idx_event_tournaments_end_at_utc`      (`event_id`, `end_at_utc`),
  KEY `idx_event_tournaments_start_date`      (`event_id`, `tournament_start_date`),
  KEY `idx_event_tournaments_field_config`    (`field_config_id`),
  KEY `idx_event_tournaments_deleted_at`      (`deleted_at`),
  KEY `idx_event_tournaments_created_by`      (`created_by`),
  KEY `idx_event_tournaments_updated_by`      (`updated_by`),
  KEY `idx_event_tournaments_deleted_by`      (`deleted_by`),
  CONSTRAINT `fk_event_tournaments_event`
    FOREIGN KEY (`event_id`) REFERENCES `team_events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_event_tournaments_field_config`
    FOREIGN KEY (`field_config_id`) REFERENCES `game_position_configs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_event_tournaments_created_by` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_event_tournaments_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_event_tournaments_deleted_by` FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment tournament identifier. **Widened from INT UNSIGNED in M7a** (safe — no downstream FK references it). |
| `guid` | VARCHAR(45) NULL | External handle. Globally unique. |
| `event_id` | BIGINT UNSIGNED FK | Parent event. **Narrowed from VARCHAR(255) in M7a** so FK to `team_events.id` (BIGINT UNSIGNED) type-aligns. RESTRICT on delete. |
| `avatar` | VARCHAR(255) NULL | Image filename or full source URL. Backend serializer wraps every read through the shared `transformImageUrl()` helper (Cloudflare Image Transformations). See [`shared-catalogues.md` §7](shared-catalogues.md) + [`conventions.md` § Image URLs](../api/conventions.md). |
| `tournamentName` | VARCHAR(255) NULL | Display name. Existing camelCase preserved. |
| `notes`, `format` | LONGTEXT NULL | Long-form prose (notes + tournament format). |
| `state`, `city`, `region` | VARCHAR(255) NULL | Venue location overrides at the tournament level (event-level defaults inherited from `team_events`). |
| `startDate`, `endDate` | VARCHAR(255) NULL | Tournament start/end days in event's local TZ. Source of truth. VARCHAR preserved from production. |
| `startTime`, `endTime` | VARCHAR(255) NULL | Wall-clock times in event's TZ. NULL when `all_day=TRUE`. |
| `startDateForField`, `endDateForField` | VARCHAR(200) NULL | Existing replicated date strings retained per the column-preservation rule. |
| `exactStartDate`, `exactEndDate`, `exactStartTime`, `exactEndTime` | VARCHAR(255) NULL | Existing replicated columns retained — not authoritative for the UTC computation. |
| `time_zone` | VARCHAR(64) NOT NULL | **NEW in M7a**. IANA identifier (`America/Los_Angeles`, etc.). Defaults to `'America/Los_Angeles'` for existing rows. Drives the generated UTC mirrors. |
| `all_day` | BOOLEAN NOT NULL DEFAULT FALSE | **NEW in M7a**. When TRUE, frontend ignores times and renders dates only. |
| `tournament_start_date`, `tournament_end_date` | DATE NULL | **NEW in M7a**. snake_case canonical date columns (the table is per-tournament, hence the prefix). Source of truth for new API. Legacy rows have these NULL. |
| `tournament_start_time`, `tournament_end_time` | TIME NULL | **NEW in M7a**. Pair with the new date columns. NULL when `all_day = TRUE`. |
| `start_at_utc`, `end_at_utc` | TIMESTAMP NULL | **NEW in M7a**. snake_case (new fields follow the dev-team convention). **App-written** UTC mirrors — the backend computes `CONVERT_TZ(tournament_start_date + tournament_start_time, time_zone, 'UTC')` in application code and writes the result on every INSERT/UPDATE (standardized on the team_events style, **not** generated `STORED` columns — keeps the conversion testable and independent of MySQL's loaded TZ tables). Source from the new snake_case columns, not the legacy `startDate` / `startTime`. Legacy rows one-shot backfilled at migration time. Index-friendly for past-tournament filters across timezones. |
| `pastTeamsCount`, `currentTeamsCount` | INT NULL | Cached counters of teams that participated previously vs. teams currently registered. |
| `status` | VARCHAR(255) NOT NULL DEFAULT '1' | **Simple active flag** — `'0'` = inactive, `'1'` = active. Not a lifecycle workflow (unlike `team_events.event_status`). Preserved verbatim from production. |
| `entry_deadline` | DATE NULL | Registration deadline for this tournament. |
| `entry_fee` | FLOAT NULL | Per-tournament entry fee. Overrides the event-level `team_events.entry_fee` when set. |
| `months`, `senior_ages`, `divisions`, `age_group` | VARCHAR(255) NULL | Division / age catalogues (existing free-form strings). |
| `rate_id` | INT NULL DEFAULT 0 | Reference to a rate lookup. No FK in v1; semantics opaque. |
| `bracket_format` | VARCHAR(255) NULL | Bracket type (single-elimination, double-elimination, round-robin, etc.). |
| `time_limit` | INT NULL | Per-game time limit in minutes. |
| `custom_format` | VARCHAR(255) NULL | Free-form format string when none of the standard bracket types fit. |
| `pool_game_guarantee` | INT NULL | Minimum number of pool-play games each team is guaranteed. |
| `custom_seed_criteria` | VARCHAR(255) NULL | Free-form seeding rules for the bracket. |
| `UseEventSeedCriteria` | BOOLEAN NULL DEFAULT FALSE | When TRUE, defer to the parent event's seed criteria instead of the per-tournament value. Existing camelCase preserved. |
| `use_event_seed` | BOOLEAN NULL DEFAULT TRUE | Similar flag governing seed inheritance. |
| `pool_play_time`, `championship_time`, `bracket_time` | VARCHAR(255) NULL | Per-phase time settings. |
| `seed_count_created` | BOOLEAN NULL DEFAULT FALSE | Marker: has the bracket's seed count been generated yet? |
| `bracket_play_started` | BOOLEAN NULL DEFAULT FALSE | Marker: has bracket play actually started? |
| `field_config_id` | BIGINT UNSIGNED NULL FK | References `game_position_configs.id`. SET NULL on delete. |
| `continuous_team_sr_no` | BOOLEAN NOT NULL DEFAULT TRUE | When TRUE, team serial numbers continue across tournaments instead of resetting per tournament. |
| `created_by`, `updated_by`, `deleted_by` | BIGINT UNSIGNED NULL FK | **Widened from INT UNSIGNED in M7a** so FKs to `users.id` (BIGINT) work. SET NULL on delete. |
| `created_at`, `updated_at`, `deleted_at` | TIMESTAMP NULL | Standard audit timestamps. |

#### Dropped columns

**None.** Per the existing-columns-preservation rule (locked decision #9 + #14), `event_tournaments` retains every production column indefinitely — including the replicated date columns (`startDateForField`, `endDateForField`, `exactStartDate`, `exactEndDate`, `exactStartTime`, `exactEndTime`), the existing `status` VARCHAR (`0`/`1` active flag — not a lifecycle workflow), and miscellaneous flags (`UseEventSeedCriteria`, `seed_count_created`, etc.).

M7a is purely additive; M7b is not needed for this table.

#### Notes on type compatibility

- `event_id` is **narrowed from VARCHAR(255) to BIGINT UNSIGNED in M7a** — required for the FK to `team_events.id` (BIGINT UNSIGNED) to type-align. MySQL rejects cross-type FKs at constraint-creation time. Pre-flight (`SELECT event_id FROM event_tournaments WHERE event_id NOT REGEXP '^[0-9]+$' OR event_id IS NULL`) MUST return 0 rows before the narrowing. See M7a Step 1b.
- All existing camelCase column names (`tournamentName`, `startDate`, `endDate`, `startTime`, `endTime`, `UseEventSeedCriteria`, etc.) are preserved — locked decision per the schema conventions ("no renames").
- `id` and audit-by columns (`created_by`, `updated_by`, `deleted_by`) widened from `INT UNSIGNED` to `BIGINT UNSIGNED` in M7a. The widening is safe (existing INT values fit BIGINT trivially) and required so audit-by FKs can reference `users.id` (which is BIGINT UNSIGNED).
- `team_events.id` is also widened to `BIGINT UNSIGNED` in M5a, completing the FK type alignment for `event_tournaments.event_id → team_events.id`.

---

### `tournament_games`

#### Purpose

Master record for every game in an event. One row per scheduled game within a division/tournament. Holds scheduling (park, field, date, time), the two competing teams, result (winner/loser/scores), bracket/pool structure, and delay/conditional-advancement state. Parent of `tournament_game_scores` and `tournament_game_innings`.

`game_type` discriminates `1 = Pool`, `2 = Bracket`. Conditional-advancement columns (`is_conditional`, `condition_json`, `conditional_status`, …) drive auto-advance of bracket games once a feeder result is known.

Date/timezone storage follows the **local-fields + app-written UTC** pattern (see `team_events`): the existing `start_date` DATE + new typed `game_start_time` TIME are the local source of truth; the backend computes `start_at_utc` / `end_at_utc` via `CONVERT_TZ` in application code and writes them on every INSERT/UPDATE. `time_interval` (minutes) is the per-game duration — the DB counterpart of the scheduler's `durationMinutes` — and is what `end_at_utc` is derived from.

> **Conformance note**: as-built, this table used `int` for `created_by` and `bigint` (signed) for `scoring_user_id` / `game_delayed_id` / `bracket_id`, and carried **no FK constraints**. The script below is the **target conformant shape**: those ID columns widened to `BIGINT UNSIGNED` (lossless `MODIFY`, no rename) and FK constraints added. See [Tournament-tables migration notes](#tournament-tables-migration-notes) for the online-DDL order.

#### CREATE script (target end-state)

```sql
CREATE TABLE `tournament_games` (
  `id`                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `guid`                   VARCHAR(255) DEFAULT NULL,
  `event_id`               BIGINT UNSIGNED DEFAULT NULL,
  `source_type_id`         BIGINT UNSIGNED DEFAULT NULL,
  `tournament_id`          BIGINT UNSIGNED DEFAULT NULL,
  `game_name`              VARCHAR(255) NOT NULL,
  `team_1_id`              BIGINT UNSIGNED DEFAULT NULL,
  `team_2_id`              BIGINT UNSIGNED DEFAULT NULL,
  `source_team_1`          JSON DEFAULT NULL,
  `source_team_2`          JSON DEFAULT NULL,
  `winner_id`              BIGINT UNSIGNED DEFAULT NULL,
  `loser_id`               BIGINT UNSIGNED DEFAULT NULL,
  `team_1_score`           INT DEFAULT NULL,
  `team_2_score`           INT DEFAULT NULL,
  `umpire_id`              BIGINT UNSIGNED DEFAULT NULL,
  `park_id`                BIGINT UNSIGNED DEFAULT NULL,
  `field_id`               BIGINT UNSIGNED DEFAULT NULL,
  `start_date`             DATE DEFAULT NULL,
  `start_time`             VARCHAR(255) DEFAULT NULL,                       -- legacy wall-clock string, preserved
  `time_limit`             VARCHAR(255) DEFAULT NULL,
  `actual_start_time`      VARCHAR(255) DEFAULT NULL,
  `actual_end_time`        VARCHAR(255) DEFAULT NULL,
  `actual_game_duration`   VARCHAR(255) DEFAULT NULL,
  `comments`               TEXT,
  `status`                 INT DEFAULT NULL,
  `win_status`             INT DEFAULT NULL,
  `game_type`              INT DEFAULT NULL COMMENT '1=Pool, 2=Bracket',
  `seed_number`            INT DEFAULT NULL,
  `round_number`           INT DEFAULT NULL,
  `position`               INT DEFAULT NULL,
  `bracket_type`           VARCHAR(255) DEFAULT NULL,
  `delayed_reason`         VARCHAR(45) DEFAULT NULL,
  `game_delayed`           TINYINT(1) DEFAULT '0',
  `scoring_user_id`        BIGINT UNSIGNED DEFAULT NULL,                    -- widened: was bigint (signed)
  `locked`                 TINYINT(1) DEFAULT '0',
  `game_delayed_id`        BIGINT UNSIGNED DEFAULT NULL,                    -- widened: was bigint (signed)
  `created_by`             BIGINT UNSIGNED DEFAULT NULL,                    -- widened: was int (signed)
  `bracket_id`             BIGINT UNSIGNED DEFAULT NULL,                    -- widened: was bigint (signed)
  `not_needed`             TINYINT(1) NOT NULL DEFAULT '0',
  `is_conditional`         TINYINT(1) DEFAULT NULL,
  `condition_json`         LONGTEXT,
  `conditional_status`     ENUM('pending','evaluated','skipped','auto_advance') DEFAULT NULL,
  `condition_result`       TINYINT(1) DEFAULT NULL,
  `condition_evaluated_at` TIMESTAMP NULL DEFAULT NULL,

  -- ── NEW columns (additive; local-fields + app-written UTC pattern) ──
  `game_start_time`        TIME NULL,                                      -- typed local start (legacy start_time is VARCHAR; start_date DATE reused as local date)
  `time_zone`              VARCHAR(64) NOT NULL DEFAULT 'America/Los_Angeles', -- IANA name; defaults to the tournament's TZ, stored per-game so UTC math is self-contained
  `time_interval`          INT NULL,                                       -- per-game duration in MINUTES (scheduler durationMinutes); end_at_utc derives from this
  `start_at_utc`           TIMESTAMP NULL DEFAULT NULL,                    -- app-written: CONVERT_TZ(start_date + game_start_time, time_zone, 'UTC')
  `end_at_utc`             TIMESTAMP NULL DEFAULT NULL,                    -- app-written: start_at_utc + time_interval minutes

  `created_at`             TIMESTAMP NULL DEFAULT NULL,
  `updated_at`             TIMESTAMP NULL DEFAULT NULL,
  `deleted_at`             TIMESTAMP NULL DEFAULT NULL,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tournament_games_guid`        (`guid`),
  KEY `idx_tournament_games_event_park_date`   (`event_id`, `park_id`, `start_date`),
  KEY `idx_tournament_games_tournament_type`   (`tournament_id`, `game_type`),   -- backs tournament_id FK (leftmost)
  KEY `idx_tournament_games_field_date`        (`field_id`, `start_date`),        -- backs field_id FK (leftmost)
  KEY `idx_tournament_games_status`            (`event_id`, `status`),
  KEY `idx_tournament_games_event_start_utc`   (`event_id`, `start_at_utc`),      -- TZ-agnostic schedule / past-game filters
  KEY `idx_tournament_games_field_start_utc`   (`field_id`, `start_at_utc`),      -- TZ-agnostic per-field overlap checks
  KEY `idx_tournament_games_park`              (`park_id`),                       -- park_id is NOT leftmost above → own FK index
  KEY `idx_tournament_games_bracket`           (`bracket_id`),
  KEY `idx_tournament_games_game_delayed`      (`game_delayed_id`),
  KEY `idx_tournament_games_umpire`            (`umpire_id`),
  KEY `idx_tournament_games_team_1`            (`team_1_id`),
  KEY `idx_tournament_games_team_2`            (`team_2_id`),
  KEY `idx_tournament_games_winner`            (`winner_id`),
  KEY `idx_tournament_games_loser`             (`loser_id`),
  KEY `idx_tournament_games_scoring_user`      (`scoring_user_id`),
  KEY `idx_tournament_games_created_by`        (`created_by`),
  KEY `idx_tournament_games_deleted_at`        (`deleted_at`),
  CONSTRAINT `fk_tournament_games_event`
    FOREIGN KEY (`event_id`)        REFERENCES `team_events`(`id`)              ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_tournament_games_tournament`
    FOREIGN KEY (`tournament_id`)   REFERENCES `event_tournaments`(`id`)        ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_tournament_games_park`
    FOREIGN KEY (`park_id`)         REFERENCES `game_parts`(`id`)               ON DELETE RESTRICT ON UPDATE CASCADE,  -- game_parts spelling is intentional (production)
  CONSTRAINT `fk_tournament_games_field`
    FOREIGN KEY (`field_id`)        REFERENCES `park_fields`(`id`)              ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_tournament_games_bracket`
    FOREIGN KEY (`bracket_id`)      REFERENCES `tournament_brackets`(`id`)      ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_tournament_games_game_delayed`
    FOREIGN KEY (`game_delayed_id`) REFERENCES `tournament_game_delayed`(`id`)  ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_tournament_games_umpire`
    FOREIGN KEY (`umpire_id`)       REFERENCES `users`(`id`)                    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_tournament_games_team_1`
    FOREIGN KEY (`team_1_id`)       REFERENCES `teams`(`id`)                    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_tournament_games_team_2`
    FOREIGN KEY (`team_2_id`)       REFERENCES `teams`(`id`)                    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_tournament_games_winner`
    FOREIGN KEY (`winner_id`)       REFERENCES `teams`(`id`)                    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_tournament_games_loser`
    FOREIGN KEY (`loser_id`)        REFERENCES `teams`(`id`)                    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_tournament_games_scoring_user`
    FOREIGN KEY (`scoring_user_id`) REFERENCES `users`(`id`)                    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_tournament_games_created_by`
    FOREIGN KEY (`created_by`)      REFERENCES `users`(`id`)                    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

> **Deferred FK**: `source_type_id` references a table not yet documented. The column is already `BIGINT UNSIGNED`, so the FK is a one-line add once that parent is confirmed.

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment game identifier. FK target for scores + innings + delays. |
| `guid` | VARCHAR(255) NULL | External/opaque handle used in scoresheet + scheduler URLs. Unique. |
| `event_id` | BIGINT UNSIGNED NULL FK | Owning event (`team_events.id`). **RESTRICT**. |
| `source_type_id` | BIGINT UNSIGNED NULL | Origin of the game record. FK deferred. |
| `tournament_id` | BIGINT UNSIGNED NULL FK | Division/tournament (`event_tournaments.id`). **RESTRICT**. |
| `game_name` | VARCHAR(255) | Display name (e.g. "Pool A — Game 3"). |
| `team_1_id` / `team_2_id` | BIGINT UNSIGNED NULL FK | The two competing teams (`teams.id`). NULL until a feeder result resolves a bracket slot. **RESTRICT**. |
| `source_team_1` / `source_team_2` | JSON NULL | Unresolved-feeder descriptor (e.g. "Winner of Game 5") before the team is known. |
| `winner_id` / `loser_id` | BIGINT UNSIGNED NULL FK | Result references to `teams.id`. **RESTRICT**. |
| `team_1_score` / `team_2_score` | INT NULL | Final aggregate score per side. |
| `umpire_id` | BIGINT UNSIGNED NULL FK | Assigned umpire (`users.id`). **SET NULL**. |
| `park_id` | BIGINT UNSIGNED NULL FK | Scheduling park (`game_parts.id` — misspelling intentional/production). **RESTRICT**. |
| `field_id` | BIGINT UNSIGNED NULL FK | Scheduling field (`park_fields.id`). **RESTRICT**. |
| `start_date` | DATE NULL | Logical game date in the game's local TZ. Local source of truth (paired with `game_start_time`). |
| `start_time` | VARCHAR(255) NULL | **Legacy** wall-clock string (e.g. `"08:30 AM"`). Preserved; new writes use `game_start_time`. |
| `time_limit`, `actual_start_time`, `actual_end_time`, `actual_game_duration` | VARCHAR(255) NULL | Free-form clock/limit strings (legacy text). |
| `status` | INT NULL | Game lifecycle status (scheduled / in-progress / final / …). Candidate for ENUM later. |
| `win_status` | INT NULL | Result classification (win / loss / forfeit / tie). |
| `game_type` | INT NULL | `1 = Pool`, `2 = Bracket`. |
| `seed_number`, `round_number`, `position` | INT NULL | Bracket placement geometry. |
| `bracket_type` | VARCHAR(255) NULL | Bracket family (single/double elim, etc.). |
| `game_delayed`, `delayed_reason`, `game_delayed_id` | mixed | Delay state + reason + FK to the delay record (`tournament_game_delayed.id`, **SET NULL**). |
| `scoring_user_id` | BIGINT UNSIGNED NULL FK | User actively scoring (`users.id`). **SET NULL**. Widened from signed bigint. |
| `locked` | TINYINT(1) | When true, the game (and its played duration/score) is frozen — recompute + bulk operations skip it. |
| `bracket_id` | BIGINT UNSIGNED NULL FK | Owning bracket (`tournament_brackets.id`). **RESTRICT**. Widened from signed bigint. |
| `not_needed` | TINYINT(1) | Game slot rendered moot by bracket math ("if necessary" game not played). |
| `is_conditional` / `condition_json` / `conditional_status` / `condition_result` / `condition_evaluated_at` | mixed | Auto-advance engine: whether participants depend on an unresolved condition, the rule, and its evaluation outcome. |
| `game_start_time` | TIME NULL | **NEW**. Typed local start time. Pairs with `start_date`. Source of truth for new writes (legacy `start_time` VARCHAR retained). |
| `time_zone` | VARCHAR(64) NOT NULL | **NEW**. IANA name; defaults `'America/Los_Angeles'`. Defaults to the tournament's TZ but stored per-game so the UTC mirrors are self-contained (no JOIN to resolve the offset). |
| `time_interval` | INT NULL | **NEW**. Per-game duration in **minutes** (the scheduler's `durationMinutes`). `end_at_utc` derives from `start_at_utc` + this. |
| `start_at_utc` / `end_at_utc` | TIMESTAMP NULL | **NEW**. App-written UTC mirrors (backend computes `CONVERT_TZ` on write — team_events style). `end_at_utc = start_at_utc + time_interval`. Index-friendly for cross-TZ schedule/overlap queries. |
| `created_by` | BIGINT UNSIGNED NULL FK | Actor who created the game (`users.id`). **SET NULL**. Widened from `int`. |
| Standard timestamps | (see Conventions) | `created_at` / `updated_at` / `deleted_at`. **Note**: predates the `updated_by` / `deleted_by` audit columns — documented gap, not added here. |

#### Indexes

- `uk_tournament_games_guid` — single-row lookup by guid (scoresheet/scheduler deep links).
- `idx_tournament_games_event_park_date` — the scheduler/field-grid query (filter by event, optionally park, ordered by date). Leftmost prefix also serves event-only filters.
- `idx_tournament_games_tournament_type` — division standings + pool/bracket grouping; backs the `tournament_id` FK.
- `idx_tournament_games_field_date` — per-field day schedule; backs the `field_id` FK.
- `idx_tournament_games_status` — list endpoints filtering by status within an event.
- `idx_tournament_games_event_start_utc` / `idx_tournament_games_field_start_utc` — TZ-agnostic "games now / in window / overlapping" queries on the UTC mirrors.
- FK-backing single-column indexes on `park_id`, `bracket_id`, `game_delayed_id`, `umpire_id`, `team_1_id`, `team_2_id`, `winner_id`, `loser_id`, `scoring_user_id`, `created_by`.

#### FK delete semantics

| FK | Rule | Why |
|---|---|---|
| `event_id`, `tournament_id`, `park_id`, `field_id`, `bracket_id` | **RESTRICT** | Structural parents — never silently delete a structure that still has games under it. |
| `team_1_id`, `team_2_id`, `winner_id`, `loser_id` | **RESTRICT** | Never lose a team that has game history/results. |
| `game_delayed_id` | **SET NULL** | The delay record is supplemental; removing it just nulls the link. |
| `umpire_id`, `scoring_user_id`, `created_by` | **SET NULL** | Actor refs — keep the game, drop the actor reference (schema convention). |

---

### `tournament_game_scores`

#### Purpose

Two rows per game (one per side) created when a game **starts** — tracks which team is home vs visiting (`team_type`), team-vs-opponent flag, and current batting state. Parent of `tournament_game_innings`. Populated at game start, mutated live during scoring.

> **Conformance note**: `team_id` and `tournament_game_id` were `int unsigned` as-built (narrower than the `BIGINT UNSIGNED` parents) and carried no FK. The target shape widens both to `BIGINT UNSIGNED` and adds FKs.

#### CREATE script (target end-state)

```sql
CREATE TABLE `tournament_game_scores` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `team_type`          INT DEFAULT NULL COMMENT '1=Visiting Team, 2=Home Team',
  `team_flag`          INT DEFAULT NULL COMMENT '1=Team, 2=Opponent',
  `batting_flag`       INT DEFAULT NULL COMMENT '1=Batting, 2=Bowling',
  `end_inning_flag`    INT DEFAULT NULL,
  `team_id`            BIGINT UNSIGNED NOT NULL,   -- widened: was int unsigned
  `tournament_game_id` BIGINT UNSIGNED NOT NULL,   -- widened: was int unsigned
  `created_at`         TIMESTAMP NULL DEFAULT NULL,
  `updated_at`         TIMESTAMP NULL DEFAULT NULL,
  `deleted_at`         TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tournament_game_scores_game_team_type`
    (`tournament_game_id`, `team_id`, `team_type`, `deleted_at`),
  KEY `idx_tournament_game_scores_team`       (`team_id`),
  KEY `idx_tournament_game_scores_deleted_at` (`deleted_at`),
  CONSTRAINT `fk_tournament_game_scores_game`
    FOREIGN KEY (`tournament_game_id`) REFERENCES `tournament_games`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_tournament_game_scores_team`
    FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment score-row identifier. FK target for innings. |
| `team_type` | INT NULL | `1 = Visiting`, `2 = Home`. |
| `team_flag` | INT NULL | `1 = Team`, `2 = Opponent` (perspective marker). |
| `batting_flag` | INT NULL | `1 = Batting`, `2 = Bowling/Fielding` — current half-inning role. |
| `end_inning_flag` | INT NULL | Marks the side's innings as concluded. |
| `team_id` | BIGINT UNSIGNED FK | The team this row represents (`teams.id`). **RESTRICT**. Widened from int unsigned. |
| `tournament_game_id` | BIGINT UNSIGNED FK | Owning game. **CASCADE** — a score row has no meaning without its game. Widened from int unsigned. |
| Standard timestamps | (see Conventions) | `created_at` / `updated_at` / `deleted_at`. No `*_by` columns (system-populated at game start). |

#### Indexes

- `uk_tournament_game_scores_game_team_type` — one live score row per `(game, team, side)`; soft-delete-aware. Its leftmost prefix (`tournament_game_id`) is also the join index for "load both sides of a game" and backs the game FK.
- `idx_tournament_game_scores_team` — backs the `team_id` FK.

---

### `tournament_game_innings`

#### Purpose

Inning-by-inning line score: one row per `(score-row, inning)`. Stores runs/HR (`score`, `inning_type`), inning lifecycle (`inning_status`, `end_status`), and live count state (`balls`, `strikes`, `outs`). Children of a `tournament_game_scores` row.

> **Conformance note**: `tournament_game_score_id` and `tournament_game_id` were `int unsigned` as-built; widened to `BIGINT UNSIGNED` and FK'd in the target shape.

#### CREATE script (target end-state)

```sql
CREATE TABLE `tournament_game_innings` (
  `id`                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `score`                    INT DEFAULT NULL,
  `inning_type`              INT DEFAULT NULL COMMENT '1=HR, 2=Score',
  `inning_status`            INT DEFAULT NULL COMMENT '1=Previous, 2=Current, 3=Next',
  `end_status`               INT DEFAULT NULL COMMENT '1=Not Ended, 2=Ended',
  `inning_no`                INT DEFAULT NULL,
  `tournament_game_score_id` BIGINT UNSIGNED NOT NULL,  -- widened: was int unsigned
  `tournament_game_id`       BIGINT UNSIGNED NOT NULL,  -- widened: was int unsigned
  `strikes`                  BIGINT DEFAULT NULL,
  `balls`                    BIGINT DEFAULT NULL,
  `outs`                     BIGINT DEFAULT NULL,
  `created_at`               TIMESTAMP NULL DEFAULT NULL,
  `updated_at`               TIMESTAMP NULL DEFAULT NULL,
  `deleted_at`               TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tournament_game_innings_score_inning` (`tournament_game_score_id`, `inning_no`),
  KEY `idx_tournament_game_innings_game_inning`  (`tournament_game_id`, `inning_no`),
  KEY `idx_tournament_game_innings_deleted_at`   (`deleted_at`),
  CONSTRAINT `fk_tournament_game_innings_score`
    FOREIGN KEY (`tournament_game_score_id`) REFERENCES `tournament_game_scores`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_tournament_game_innings_game`
    FOREIGN KEY (`tournament_game_id`) REFERENCES `tournament_games`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

> **Two-FK / cascade design**: deletion ownership flows `game → scores → innings`, so the `score` FK is **CASCADE** (innings die with their score row). The redundant direct `tournament_game_id` FK is **RESTRICT** (integrity-only) to avoid a dual cascade path to the same row. In practice soft-deletes mean neither cascade fires in normal operation.

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment inning-row identifier. |
| `score` | INT NULL | Runs (or HR count, per `inning_type`) in this inning. |
| `inning_type` | INT NULL | `1 = HR`, `2 = Score`. |
| `inning_status` | INT NULL | `1 = Previous`, `2 = Current`, `3 = Next`. |
| `end_status` | INT NULL | `1 = Not Ended`, `2 = Ended`. |
| `inning_no` | INT NULL | Inning ordinal. Sort key within a score row. |
| `tournament_game_score_id` | BIGINT UNSIGNED FK | Owning score row. **CASCADE**. Widened from int unsigned. |
| `tournament_game_id` | BIGINT UNSIGNED FK | Denormalized game link (fast "all innings for a game"). **RESTRICT**. Widened from int unsigned. |
| `strikes` / `balls` / `outs` | BIGINT NULL | Live count state. (`BIGINT` is oversized for 0–3 values — `TINYINT UNSIGNED` would suffice; left as-is, no rename.) |
| Standard timestamps | (see Conventions) | `created_at` / `updated_at` / `deleted_at`. |

#### Indexes

- `idx_tournament_game_innings_score_inning` — the primary read: load a side's line score ordered by inning. Backs the `score` FK.
- `idx_tournament_game_innings_game_inning` — load all innings for a whole game ordered by inning. Backs the `game` FK.

---

### `tournament_brackets`

#### Purpose

A bracket within a tournament/division. One tournament can have multiple brackets (e.g. Gold / Silver), each with its own format and seeded teams (via `tournament_bracket_teams`). Referenced by `tournament_games.bracket_id`.

> **Conformance note**: `division_id` and the audit-by columns were `bigint` (signed); widened to `BIGINT UNSIGNED` so the audit-by FKs to `users.id` type-align.

#### CREATE script (target end-state)

```sql
CREATE TABLE `tournament_brackets` (
  `id`                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tournament_id`        BIGINT UNSIGNED NOT NULL,
  `status`               INT NOT NULL,
  `image_url`            VARCHAR(255) DEFAULT NULL,
  `guid`                 VARCHAR(255) DEFAULT NULL,
  `bracket_name`         VARCHAR(255) DEFAULT NULL,
  `event_id`             BIGINT UNSIGNED DEFAULT NULL,
  `bracket_description`  TEXT,
  `division_id`          BIGINT UNSIGNED DEFAULT NULL,   -- widened: was bigint (signed)
  `bracket_format`       VARCHAR(255) DEFAULT NULL,
  `bracket_play_started` INT DEFAULT NULL,
  `created_by`           BIGINT UNSIGNED DEFAULT NULL,   -- widened: was bigint (signed)
  `updated_by`           BIGINT UNSIGNED DEFAULT NULL,   -- widened: was bigint (signed)
  `deleted_by`           BIGINT UNSIGNED DEFAULT NULL,   -- widened: was bigint (signed)
  `created_at`           TIMESTAMP NULL DEFAULT NULL,
  `updated_at`           TIMESTAMP NULL DEFAULT NULL,
  `deleted_at`           TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `guid_UNIQUE` (`guid`),
  KEY `idx_tournament_brackets_tournament` (`tournament_id`),
  KEY `idx_tournament_brackets_event`      (`event_id`),
  KEY `idx_tournament_brackets_division`   (`division_id`),
  KEY `idx_tournament_brackets_deleted_at` (`deleted_at`),
  KEY `idx_tournament_brackets_created_by` (`created_by`),
  KEY `idx_tournament_brackets_updated_by` (`updated_by`),
  KEY `idx_tournament_brackets_deleted_by` (`deleted_by`),
  CONSTRAINT `fk_tournament_brackets_tournament`
    FOREIGN KEY (`tournament_id`) REFERENCES `event_tournaments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_tournament_brackets_event`
    FOREIGN KEY (`event_id`)      REFERENCES `team_events`(`id`)       ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_tournament_brackets_created_by` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_tournament_brackets_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_tournament_brackets_deleted_by` FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

> **Deferred FK**: `division_id` references a division catalogue (likely `event_divisions`, not yet documented). Column widened; FK is a one-line add later.

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment bracket identifier. FK target for `tournament_bracket_teams` + `tournament_games.bracket_id`. |
| `tournament_id` | BIGINT UNSIGNED FK | Owning tournament/division (`event_tournaments.id`). **RESTRICT**. |
| `status` | INT | Bracket lifecycle status. **DRAFT — to migrate to a 5-state enum** `pending` (default at create) → `initiated` (seeds moved in) → `in_progress` (first game started) → `completed` (championship / IF game finished), plus **`cancelled`** (terminal: rain/other — bracket can't produce winners, its teams are announced via their pool). `bracket_play_started` is subsumed by `in_progress`. See `matchgeni-division-api-contract.md` §5. |
| `cancel_reason_code` | ENUM(`rain`,`field_conditions`,`time_curfew`,`other`) NULL | **DRAFT — NEW**. Why the bracket was cancelled (set with `status='cancelled'`). |
| `cancel_reason_note` | VARCHAR(255) NULL | **DRAFT — NEW**. Optional free-text detail on the cancellation. |
| `cancelled_at` | TIMESTAMP NULL | **DRAFT — NEW**. When the bracket was cancelled. |
| `cancelled_by` | BIGINT UNSIGNED NULL FK | **DRAFT — NEW**. Actor who cancelled (`users.id`). **SET NULL**. |
| `image_url` | VARCHAR(255) NULL | Rendered bracket image. |
| `guid` | VARCHAR(255) NULL | External handle. Unique. |
| `bracket_name` | VARCHAR(255) NULL | Display name (e.g. "Gold"). |
| `event_id` | BIGINT UNSIGNED NULL FK | Owning event (`team_events.id`). **RESTRICT**. |
| `bracket_description` | TEXT NULL | Free-form description. |
| `division_id` | BIGINT UNSIGNED NULL | Division reference. FK deferred. Widened from signed. |
| `bracket_format` | VARCHAR(255) NULL | Single/double elim, round-robin, etc. |
| `bracket_play_started` | INT NULL | Marker: has bracket play begun. **Superseded by the `in_progress` status** above (kept for back-compat). |
| `created_by`, `updated_by`, `deleted_by` | BIGINT UNSIGNED NULL FK | Audit actors (`users.id`). **SET NULL**. Widened from signed bigint. |
| `created_at`, `updated_at`, `deleted_at` | TIMESTAMP NULL | Standard audit timestamps. |

---

### `tournament_bracket_teams`

#### Purpose

Assigns teams to a specific bracket (the "4 teams to Bracket A, 3 to Bracket B" split within a tournament). One row per `(bracket, team)`.

> **Conformance note**: PK `id` was **`int`** as-built — widened to `BIGINT UNSIGNED` to match the house standard (no downstream FK references it yet, so the widening is safe). FK columns are already `BIGINT UNSIGNED`.

#### CREATE script (target end-state)

```sql
CREATE TABLE `tournament_bracket_teams` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,   -- widened: was int
  `team_id`             BIGINT UNSIGNED NOT NULL,
  `bracket_id`          BIGINT UNSIGNED NOT NULL,
  `guid`                VARCHAR(255) DEFAULT NULL,
  `bracket_name`        VARCHAR(255) DEFAULT NULL,
  `event_id`            BIGINT UNSIGNED DEFAULT NULL,
  `bracket_description` TEXT,
  `division_id`         BIGINT UNSIGNED DEFAULT NULL,
  `created_at`          TIMESTAMP NULL DEFAULT NULL,
  `updated_at`          TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `guid` (`guid`),
  KEY `event_id` (`event_id`),
  KEY `idx_tournament_bracket_teams_bracket`  (`bracket_id`),
  KEY `idx_tournament_bracket_teams_team`     (`team_id`),
  KEY `idx_tournament_bracket_teams_division` (`division_id`),
  CONSTRAINT `fk_tournament_bracket_teams_bracket`
    FOREIGN KEY (`bracket_id`) REFERENCES `tournament_brackets`(`id`) ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT `fk_tournament_bracket_teams_team`
    FOREIGN KEY (`team_id`)    REFERENCES `teams`(`id`)              ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_tournament_bracket_teams_event`
    FOREIGN KEY (`event_id`)   REFERENCES `team_events`(`id`)        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

> **Deferred FK**: `division_id` (same division catalogue as `tournament_brackets`). **No soft-delete / audit-by columns** — preserved as-is (this is a lightweight join table).

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment row id. **Widened from `int`**. |
| `team_id` | BIGINT UNSIGNED FK | Team assigned to the bracket (`teams.id`). **RESTRICT**. |
| `bracket_id` | BIGINT UNSIGNED FK | The bracket (`tournament_brackets.id`). **CASCADE** — membership is meaningless without its bracket. |
| `guid` | VARCHAR(255) NULL | External handle. Unique. |
| `bracket_name` | VARCHAR(255) NULL | Denormalized bracket name snapshot. |
| `event_id` | BIGINT UNSIGNED NULL FK | Owning event (`team_events.id`). **RESTRICT**. |
| `bracket_description` | TEXT NULL | Denormalized description snapshot. |
| `division_id` | BIGINT UNSIGNED NULL | Division reference. FK deferred. |
| `created_at`, `updated_at` | TIMESTAMP NULL | Timestamps (no `deleted_at` — hard-delete only). |

---

### `tournament_game_delayed`

#### Purpose

Audit/record of a game delay (rain, etc.): when it was delayed, by whom, when it resumed, and the total delay time. Referenced by `tournament_games.game_delayed_id`.

> **Conformance note**: PK `id` was **`int`** — widened to `BIGINT UNSIGNED`. This widening is a **prerequisite**: `tournament_games.game_delayed_id` (BIGINT UNSIGNED) cannot FK to an `int` PK. `game_id` / `delayed_by` were `bigint` (signed) → widened to unsigned.

#### CREATE script (target end-state)

```sql
CREATE TABLE `tournament_game_delayed` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,   -- widened: was int (required for the reverse FK from tournament_games)
  `game_id`      BIGINT UNSIGNED NOT NULL,                  -- widened: was bigint (signed)
  `delayed_date` VARCHAR(255) DEFAULT NULL,
  `delayed_time` VARCHAR(255) DEFAULT NULL,
  `delayed_by`   BIGINT UNSIGNED DEFAULT NULL,              -- widened: was bigint (signed)
  `resume_date`  VARCHAR(255) DEFAULT NULL,
  `resume_time`  VARCHAR(255) DEFAULT NULL,
  `total_time`   VARCHAR(255) NOT NULL DEFAULT '00:00:00',
  `created_at`   TIMESTAMP NULL DEFAULT NULL,
  `updated_at`   TIMESTAMP NULL DEFAULT NULL,
  `deleted_at`   TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tournament_game_delayed_game`       (`game_id`),
  KEY `idx_tournament_game_delayed_delayed_by` (`delayed_by`),
  KEY `idx_tournament_game_delayed_deleted_at` (`deleted_at`),
  CONSTRAINT `fk_tournament_game_delayed_game`
    FOREIGN KEY (`game_id`)    REFERENCES `tournament_games`(`id`) ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT `fk_tournament_game_delayed_user`
    FOREIGN KEY (`delayed_by`) REFERENCES `users`(`id`)            ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

> **Mutual-reference note**: `tournament_games.game_delayed_id → tournament_game_delayed.id` (SET NULL) and `tournament_game_delayed.game_id → tournament_games.id` (CASCADE) point at each other. Both are valid in MySQL; the `game_id` CASCADE owns deletion (delay records die with their game), while the `game_delayed_id` side just nulls out.

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment delay-record id. **Widened from `int`** (FK target for `tournament_games.game_delayed_id`). |
| `game_id` | BIGINT UNSIGNED FK | The delayed game (`tournament_games.id`). **CASCADE**. Widened from signed bigint. |
| `delayed_date`, `delayed_time`, `resume_date`, `resume_time` | VARCHAR(255) NULL | Free-form local clock strings for the delay/resume moments. |
| `delayed_by` | BIGINT UNSIGNED NULL FK | Actor who delayed the game (`users.id`). **SET NULL**. Widened from signed bigint. |
| `total_time` | VARCHAR(255) NOT NULL | Total delay duration (`HH:MM:SS`), default `'00:00:00'`. |
| `created_at`, `updated_at`, `deleted_at` | TIMESTAMP NULL | Standard audit timestamps. |

---

### `tournament_pools`

#### Purpose

A pool within a tournament/division (one tournament can have multiple pools). Holds the pool name + seed-generation marker.

#### CREATE script (target end-state)

```sql
CREATE TABLE `tournament_pools` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tournament_id`      BIGINT UNSIGNED NOT NULL,
  `pool_name`          VARCHAR(255) DEFAULT NULL,
  `seed_count_created` INT DEFAULT NULL,
  `created_at`         TIMESTAMP NULL DEFAULT NULL,
  `updated_at`         TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tournament_pools_tournament` (`tournament_id`),
  CONSTRAINT `fk_tournament_pools_tournament`
    FOREIGN KEY (`tournament_id`) REFERENCES `event_tournaments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

> **ON DELETE choice**: `RESTRICT` (not CASCADE) — even though a pool is "owned" by its tournament, tournaments soft-delete in normal operation, and RESTRICT avoids a surprise hard-delete cascade. Flip to CASCADE if the product genuinely hard-deletes tournaments and expects pools to vanish. **No soft-delete / audit-by columns** — preserved as-is.

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment pool id. |
| `tournament_id` | BIGINT UNSIGNED FK | Owning tournament (`event_tournaments.id`). **RESTRICT**. |
| `pool_name` | VARCHAR(255) NULL | Display name (e.g. "Pool A"). |
| `seed_count_created` | INT NULL | Marker: has the pool's seed count been generated. |
| `created_at`, `updated_at` | TIMESTAMP NULL | Timestamps (no `deleted_at`). |

---

### `tournament_seed_criteria`

#### Purpose

The ordered tie-break **seeding criteria** chosen for a division (`event_tournaments` row). One row per selected criterion; `order` defines the tie-break priority. Written by the Add/Edit Division wizard's Seed step (see `matchgeni-division-api-contract.md`) only when the division uses *custom* criteria — otherwise it inherits the event default and no rows are written. `seeding_criteria_id` references the global seeding-criteria catalogue served by `GET /v2/seeders` (shared-services §6).

#### CREATE script (target end-state)

```sql
CREATE TABLE `tournament_seed_criteria` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tournament_id`       BIGINT UNSIGNED NOT NULL,
  `seeding_criteria_id` BIGINT UNSIGNED DEFAULT NULL,
  `order`               INT NOT NULL DEFAULT '1',
  `status`              INT NOT NULL DEFAULT '1',
  `created_at`          TIMESTAMP NULL DEFAULT NULL,
  `updated_at`          TIMESTAMP NULL DEFAULT NULL,
  `deleted_at`          TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tournament_seed_criteria_tournament`        (`tournament_id`),
  KEY `idx_tournament_seed_criteria_tournament_order`  (`tournament_id`, `order`),
  KEY `idx_tournament_seed_criteria_criterion`         (`seeding_criteria_id`),
  KEY `idx_tournament_seed_criteria_deleted_at`        (`deleted_at`),
  CONSTRAINT `fk_tournament_seed_criteria_tournament`
    FOREIGN KEY (`tournament_id`)       REFERENCES `event_tournaments`(`id`)  ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_tournament_seed_criteria_criterion`
    FOREIGN KEY (`seeding_criteria_id`) REFERENCES `seeding_criteria`(`id`)   ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

> **ON DELETE choice**: `RESTRICT` on both FKs — tournaments soft-delete in normal operation (so child seed rows are kept), and a criterion catalogue row should never be hard-deleted while divisions reference it. **`seeding_criteria_id` is widened from the production `bigint NULL`** only in that it gains the FK + index; the column itself is unchanged. `order` keeps its production name (a reserved word — quote it as `` `order` ``).

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment row id. |
| `tournament_id` | BIGINT UNSIGNED FK | Owning division (`event_tournaments.id`). **RESTRICT**. |
| `seeding_criteria_id` | BIGINT UNSIGNED NULL FK | The chosen criterion (`seeding_criteria.id` — the `/v2/seeders` catalogue). **RESTRICT**. |
| `order` | INT NOT NULL (def 1) | 1-based tie-break priority within the division. Reserved word — always quoted. |
| `status` | INT NOT NULL (def 1) | Active flag (1 = active). |
| `created_at`, `updated_at`, `deleted_at` | TIMESTAMP NULL | Standard timestamps + soft-delete. |

> **`seeding_criteria` catalogue table** — the FK parent (the reference list behind `GET /v2/seeders`). Not yet documented here; added to "What's NOT in this doc yet" below. The FK in this section assumes its PK is `BIGINT UNSIGNED`; verify before adding the constraint.

---

### `tournament_teams`

#### Purpose

The teams registered to a division (`event_tournaments` row) — the per-division team registry with serial number, pool assignment, seed count, and running win/loss tally. **Source of the per-division `teamCount`** on the §9 Get Event Resources endpoint (`COUNT` of active rows by `tournament_id`). One row per `(tournament, team)`.

#### CREATE script (target end-state)

```sql
CREATE TABLE `tournament_teams` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `guid`          VARCHAR(255) DEFAULT NULL,
  `event_id`      BIGINT UNSIGNED DEFAULT NULL,
  `tournament_id` BIGINT UNSIGNED NOT NULL,        -- tightened: was NULL (a registry row needs a division)
  `team_sr_no`    INT NOT NULL,
  `team_id`       BIGINT UNSIGNED NOT NULL,        -- tightened: was NULL (a registry row needs a team)
  `win_count`     INT NOT NULL DEFAULT '0',
  `loss_count`    INT NOT NULL DEFAULT '0',
  `status`        INT DEFAULT NULL,
  `deleted_at`    TIMESTAMP NULL DEFAULT NULL,
  `created_at`    TIMESTAMP NULL DEFAULT NULL,
  `updated_at`    TIMESTAMP NULL DEFAULT NULL,
  `pool_id`       BIGINT UNSIGNED DEFAULT NULL,   -- widened: was bigint (signed)
  `seed_count`    INT NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tournament_teams_guid` (`guid`),
  KEY `idx_tournament_teams_tournament` (`tournament_id`, `deleted_at`, `status`),
  KEY `idx_tournament_teams_event`      (`event_id`),
  KEY `idx_tournament_teams_team`       (`team_id`),
  KEY `idx_tournament_teams_pool`       (`pool_id`),
  CONSTRAINT `fk_tournament_teams_event`
    FOREIGN KEY (`event_id`)      REFERENCES `team_events`(`id`)        ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_tournament_teams_tournament`
    FOREIGN KEY (`tournament_id`) REFERENCES `event_tournaments`(`id`)  ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_tournament_teams_team`
    FOREIGN KEY (`team_id`)       REFERENCES `teams`(`id`)              ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_tournament_teams_pool`
    FOREIGN KEY (`pool_id`)       REFERENCES `tournament_pools`(`id`)   ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

> **Conformance changes** (no renames): `pool_id` widened `bigint (signed) → BIGINT UNSIGNED` to align with `tournament_pools.id`; FKs + indexes added; `guid` unique key added; table-level engine/charset added; per-column `CHARACTER SET`/`COLLATE` on `guid` removed (table default applies). The `idx_tournament_teams_tournament (tournament_id, deleted_at, status)` composite covers the §9 `teamCount` count without row visits.
> **`tournament_id` + `team_id` tightened to `NOT NULL`** — a registry row is meaningless without both (production shipped them nullable). `event_id` is left nullable (derivable from the division) and `pool_id` nullable (a team may be registered before pool assignment). The `NOT NULL` change requires backfilling any existing NULL rows before the `MODIFY`.

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment row id. |
| `guid` | VARCHAR(255) NULL | External handle. Unique. |
| `event_id` | BIGINT UNSIGNED NULL FK | Owning event (`team_events.id`). **RESTRICT**. |
| `tournament_id` | BIGINT UNSIGNED **NOT NULL** FK | Owning division (`event_tournaments.id`). **RESTRICT**. |
| `team_sr_no` | INT NOT NULL | Team serial number within the division (display / seeding order). |
| `team_id` | BIGINT UNSIGNED **NOT NULL** FK | The registered team (`teams.id`). **RESTRICT**. |
| `win_count` / `loss_count` | INT NOT NULL (def 0) | Running record within the division. |
| `status` | INT NULL | Active flag (`1` = active). The §9 `teamCount` counts `status = 1`. |
| `pool_id` | BIGINT UNSIGNED NULL FK | Assigned pool (`tournament_pools.id`). **SET NULL**. Widened from signed `bigint`. |
| `seed_count` | INT NOT NULL (def 0) | Seed marker. |
| `created_at`, `updated_at`, `deleted_at` | TIMESTAMP NULL | Standard timestamps + soft-delete. |

#### Relations

- Parents: `team_events.id`, `event_tournaments.id`, `teams.id`, `tournament_pools.id`.
- No children.

---

### Tournament-tables migration notes

Online-DDL order on MySQL 8 / InnoDB for the seven tables above (all `ALGORITHM=INPLACE, LOCK=NONE` unless noted). Take a snapshot before steps 2–5; run each `ALTER` individually (DDL auto-commits).

1. **Indexes first** — `ADD INDEX` on all 7 tables. No dependencies, immediate query win.
2. **Widen IDs** — PKs `tournament_bracket_teams.id` + `tournament_game_delayed.id` (`int → BIGINT UNSIGNED`); child FK cols (`tournament_game_id`, `tournament_game_score_id`, `team_id`) on scores/innings; signed→unsigned on `tournament_games.{created_by, scoring_user_id, game_delayed_id, bracket_id}`, `tournament_brackets.{division_id, created_by, updated_by, deleted_by}`, `tournament_game_delayed.{game_id, delayed_by}`. All lossless.
3. **Additive columns** — `tournament_games`: `game_start_time`, `time_zone`, `time_interval`, `start_at_utc`, `end_at_utc`. `event_tournaments`: convert `start_at_utc`/`end_at_utc` from generated `STORED` to plain nullable `TIMESTAMP` (a `MODIFY`).
4. **Orphan cleanup** — for every FK, `SELECT COUNT(*) FROM <child> c LEFT JOIN <parent> p ON p.id = c.<fk> WHERE c.<fk> IS NOT NULL AND p.id IS NULL` must return 0. Resolve before step 5.
5. **Add FK constraints** parents-before-children: `tournament_games` → (events / tournaments / parks / fields / brackets / delayed / teams / users); `tournament_game_scores` → games + teams; `tournament_game_innings` → scores + games; `tournament_brackets` → tournaments / events / users; `tournament_bracket_teams` → brackets / teams / events; `tournament_game_delayed` → games + users; `tournament_pools` → tournaments.

**Parent-PK prerequisite**: `tournament_game_delayed.id` must be widened (step 2) before `fk_tournament_games_game_delayed` is added (step 5). Verify `event_tournaments`, `team_events`, `game_parts`, `park_fields`, `teams`, `users` all have `BIGINT UNSIGNED` PKs; if any is `int`, widen its PK first.
