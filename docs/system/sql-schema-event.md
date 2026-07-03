---
status: Draft
owner: shared
last_updated: 2026-06-15
---

# SQL Schema — Event Tables

Domain-split slice of the WhoIFollow schema. **Shared conventions** — engine/charset/collation, primary keys, foreign-key rules, standard audit columns (`created_at`/`updated_at`/`deleted_at`/`created_by`/`updated_by`/`deleted_by`), UTC timestamp handling, soft-delete, and naming — live in [`sql-schema.md`](./sql-schema.md) and apply to every table here.

## Tables in this doc

- [`team_events`](#team_events)
- [`event_officials`](#event_officials)
- [`event_seed_criteria`](#event_seed_criteria)
- [`event_playing_facilities`](#event_playing_facilities)
- [`event_field_selections`](#event_field_selections)
- [`park_scheduling_windows`](#park_scheduling_windows)
- [`event_hotels`](#event_hotels)
- [`event_sponsors`](#event_sponsors)
- [`event_umpires`](#event_umpires)
- [`event_joined_teams`](#event_joined_teams)
- [`event_team_lineup`](#event_team_lineup)
- [`event_followers`](#event_followers)

---

### `team_events`

#### Purpose

Tournament / league events. A row may be owned by a team (`team_id` populated, `association_id` NULL) or by an association (`association_id` populated, `team_id` NULL). The association admin portal (`AssociationEventsView`) lists only rows where the user's `association_id` matches.

Drives:

- The association-side admin views (list / create / edit / cancel).
- Per-event grants in `event_officials` (separate table; FKs into this).
- Child tournaments via `event_tournaments.event_id → team_events.id` (one event can host many tournament brackets).
- Per-event participation rows in future `event_joined_team`.

Lifecycle ENUM (`draft / published / completed / cancelled`) is introduced as `event_status` alongside the existing VARCHAR `status` column — see migration M5a. Date/timezone storage uses the **local-fields + computed-UTC** pattern (see Conventions §UTC timestamps): admins enter wall-clock dates/times in the event's local TZ; the DB auto-computes UTC mirrors via STORED generated columns so cross-TZ "is past?" queries are indexable and timezone-agnostic.

#### CREATE script (post-M5a end-state)

This reflects the table AFTER M5a runs — production columns preserved verbatim (no renames), with M5a additions appended. Every existing column keeps its original name, type, and collation; new columns are clearly marked. M5b (deferred) is a tiny follow-up that drops the old VARCHAR `status` column after soak. `event_status` is the permanent lifecycle column name from M5a onward.

```sql
CREATE TABLE `team_events` (
  -- PK widened from INT UNSIGNED in M5a (safe; values fit BIGINT trivially)
  `id`                              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `guid`                            VARCHAR(255) DEFAULT NULL,
  `slug`                            VARCHAR(255) DEFAULT NULL COMMENT 'Auto-generated unique URL handle from eventName (M5a); UNIQUE. Read-only — never client-set.',

  -- Ownership: team_id XOR association_id. Types widened to BIGINT UNSIGNED in M5a
  -- so FK constraints can reference teams.id / associations.id.
  -- M5a pre-flight verifies every existing value is a numeric string before narrowing.
  `team_id`                         BIGINT UNSIGNED DEFAULT NULL,                      -- Was VARCHAR(255); narrowed M5a
  `association_id`                  BIGINT UNSIGNED DEFAULT NULL,                      -- Was VARCHAR(191); narrowed M5a

  -- Polymorphic-ownership pair (existing production columns). Carries
  -- the SAME ownership identity as the (team_id, association_id) XOR
  -- pair above, just encoded as (type-tag, single-id) — production
  -- code reads from this pair while legacy code still references the
  -- two named FK columns. Both representations stay in sync; M5a
  -- backfills owner_type + owner_linked_id for legacy rows where
  -- only the named columns were populated.
  --   owner_type values (canonical mapping):
  --     1 = association   (owner_linked_id = associations.id)
  --     2 = team          (owner_linked_id = teams.id)
  -- NOTE: the `2 = team` value is provisional pending backend
  -- confirmation. Once confirmed, drop this NOTE.
  `owner_type`                      TINYINT UNSIGNED DEFAULT NULL COMMENT '1=association, 2=team (provisional — confirm with backend)',
  `owner_linked_id`                 BIGINT UNSIGNED DEFAULT NULL COMMENT 'associations.id when owner_type=1; teams.id when owner_type=2',

  `avatar`                          LONGTEXT DEFAULT NULL COMMENT 'Image filename or full source URL — backend wraps via transformImageUrl() before emitting on the wire (see shared-catalogues §7).',
  `eventName`                       VARCHAR(255) DEFAULT NULL,
  `eventType`                       VARCHAR(255) DEFAULT NULL,

  -- Denormalized snapshot of the association's SHORT NAME (`associations.short_name`).
  -- Kept so listing queries don't have to JOIN associations.
  `association`                     VARCHAR(255) DEFAULT NULL COMMENT 'Denormalized snapshot of associations.short_name',

  -- Location type — NEW (M5a). Discriminates the two location modes the
  -- Add/Edit Event wizard captures: 'in_person' populates address/geo below;
  -- 'online' populates medium_id/medium/Url instead. Stored so edits round-trip
  -- deterministically (no inferring mode from which fields are non-null).
  `location_type`                   VARCHAR(20)  NOT NULL DEFAULT 'in_person', -- 'in_person' | 'online'

  -- Location (both `address` and `location` preserved — they hold the same data per
  -- the existing convention; consumer code still references both).
  `address`                         VARCHAR(255) DEFAULT NULL,
  `location`                        VARCHAR(255) DEFAULT NULL,
  `city`                            VARCHAR(255) DEFAULT NULL,
  `state`                           VARCHAR(255) DEFAULT NULL,
  `zipCode`                         VARCHAR(255) DEFAULT NULL,

  -- Dates & timezone.
  -- Legacy camelCase VARCHAR columns kept verbatim for backwards-compat
  -- with consumers that still read them. New API writes go to the
  -- snake_case `event_start_date` / `event_end_date` / `event_start_time` /
  -- `event_end_time` columns grouped in the "NEW columns added in M5a"
  -- block below — the generated UTC mirrors reference THOSE, not these
  -- legacy columns, so the past-events / year filters operate on new data.
  `startDate`                       VARCHAR(255) DEFAULT NULL,
  `endDate`                         VARCHAR(255) DEFAULT NULL,
  `startDateForField`               VARCHAR(200) DEFAULT NULL,
  `endDateForField`                 VARCHAR(200) DEFAULT NULL,
  `startTime`                       VARCHAR(255) DEFAULT NULL,
  `endTime`                         VARCHAR(255) DEFAULT NULL,
  `exactStartDate`                  VARCHAR(255) DEFAULT NULL,
  `exactEndDate`                    VARCHAR(255) DEFAULT NULL,
  `exactStartTime`                  VARCHAR(255) DEFAULT NULL,
  `exactEndTime`                    VARCHAR(255) DEFAULT NULL,
  `allDay`                          VARCHAR(255) DEFAULT NULL COMMENT 'Boolean-as-string (existing pattern); app coerces "1"/"0" → bool',

  `note`                            VARCHAR(1000) DEFAULT NULL,

  -- Coordinates (existing column names preserved)
  `lat`                             VARCHAR(255) DEFAULT NULL COMMENT 'Latitude',
  `long`                            VARCHAR(255) DEFAULT NULL COMMENT 'Longitude',

  -- Medium reference. medium_id narrowed from VARCHAR(100) → BIGINT UNSIGNED in M5a so FK works.
  `medium_id`                       BIGINT UNSIGNED DEFAULT NULL,                      -- Was VARCHAR(100); narrowed M5a
  `medium`                          VARCHAR(255) DEFAULT NULL COMMENT 'Denormalized snapshot of mediums.name',

  `Url`                             VARCHAR(255) DEFAULT NULL,                         -- Preserve capital U (existing)
  `color`                           VARCHAR(10) DEFAULT NULL COMMENT '#RRGGBB',

  -- Creator metadata (existing camelCase denormalized snapshot columns)
  `createdByDate`                   VARCHAR(255) DEFAULT NULL,
  `createdByName`                   VARCHAR(255) DEFAULT NULL,

  -- Status: existing VARCHAR kept (dropped in M5b); event_status ENUM added in M5a.
  -- App reads event_status. event_status is the permanent column name.
  `status`                          VARCHAR(255) NOT NULL DEFAULT '1',
  `event_status`                    ENUM('draft', 'published', 'completed', 'cancelled') DEFAULT NULL COMMENT 'Canonical lifecycle column. Backfilled from status in M5a; old status dropped in M5b.',

  -- Director contact (existing snake_case names preserved)
  `director_email`                  VARCHAR(255) DEFAULT NULL,
  `director_phone`                  VARCHAR(255) DEFAULT NULL,
  `director_name`                   VARCHAR(255) DEFAULT NULL,

  -- Vestigial: tournaments are children via event_tournaments.event_id → team_events.id.
  -- Kept because production references it; no FK added.
  `tournament_id`                   INT DEFAULT NULL,

  `time_zone`                       LONGTEXT DEFAULT NULL COMMENT 'IANA name; LONGTEXT preserved from production',

  -- Audit (existing INT UNSIGNED widened to BIGINT UNSIGNED in M5a so audit-by FKs to users.id work)
  `created_by`                      BIGINT UNSIGNED DEFAULT NULL,                      -- Was INT UNSIGNED; widened M5a
  `updated_by`                      BIGINT UNSIGNED DEFAULT NULL,                      -- Was INT UNSIGNED; widened M5a
  `deleted_by`                      BIGINT UNSIGNED DEFAULT NULL,                      -- Was INT UNSIGNED; widened M5a
  `created_at`                      TIMESTAMP NULL DEFAULT NULL,
  `updated_at`                      TIMESTAMP NULL DEFAULT NULL,
  `deleted_at`                      TIMESTAMP NULL DEFAULT NULL,

  `reminder`                        LONGTEXT DEFAULT NULL,

  -- Fees
  `entry_fee`                       DOUBLE DEFAULT NULL,
  `refund_policy`                   LONGTEXT DEFAULT NULL,
  `tournament_format`               LONGTEXT DEFAULT NULL,
  `entry_fee_deadline`              DATE DEFAULT NULL,

  -- Note: production stores this with a different collation (utf8mb4_0900_ai_ci).
  -- Preserved exactly so existing comparisons don't change behavior.
  `mob_code`                        VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,

  -- Tournament settings (event-level defaults inherited by event_tournaments rows)
  `pool_play`                       VARCHAR(255) DEFAULT NULL,
  `game_guarantee`                  VARCHAR(255) DEFAULT NULL,
  `division_type`                   VARCHAR(255) DEFAULT NULL,
  `pool_play_time`                  VARCHAR(255) DEFAULT NULL,
  `championship_time`               VARCHAR(255) DEFAULT NULL,
  `bracket_time`                    VARCHAR(255) DEFAULT NULL,
  `time_interval`                   VARCHAR(255) DEFAULT NULL,

  -- Categorical FK. Original is BIGINT (no UNSIGNED); aligned to BIGINT UNSIGNED in M5a so FK works.
  `sports_type_id`                  BIGINT UNSIGNED DEFAULT NULL,                      -- Was BIGINT (signed); aligned M5a

  -- Registration controls (existing flags preserved as TINYINT(1) — MySQL's BOOLEAN alias)
  `allow_team_registration`         TINYINT(1) NOT NULL DEFAULT 0,
  `registration_opening`            DATETIME DEFAULT NULL,
  `payment_required`                TINYINT(1) NOT NULL DEFAULT 0,
  `payment_terms`                   TINYINT UNSIGNED DEFAULT NULL COMMENT '0=full, 1=partial',
  `partial_payment_type`            TINYINT UNSIGNED DEFAULT NULL COMMENT '0=fixed_amount, 1=percentage',
  `partial_payment_value`           DECIMAL(12,2) DEFAULT NULL,
  `allow_offline_payment`           TINYINT(1) NOT NULL DEFAULT 0,
  `auto_confirm_on_full_payment`    TINYINT(1) NOT NULL DEFAULT 0,
  `auto_confirm_on_partial_payment` TINYINT(1) NOT NULL DEFAULT 0,
  `field_config_id`                 BIGINT UNSIGNED DEFAULT NULL,
  `registration_open`               INT NOT NULL DEFAULT 0 COMMENT 'Existing flag — current semantics unclear; treat as opaque per dev team',

  -- ── NEW columns added in M5a ─────────────────────────────────────────

  -- Canonical, typed date / time columns the new API reads + writes.
  -- snake_case per the dev-team convention for new additions. Legacy
  -- rows have these NULL; new writes populate them. UTC mirrors below
  -- source from these columns, not from the legacy `startDate` /
  -- `endDate` / `startTime` / `endTime` block above.
  `event_start_date`                DATE NULL,
  `event_end_date`                  DATE NULL,
  `event_start_time`                TIME NULL,
  `event_end_time`                  TIME NULL,

  -- UTC mirrors for indexable past-event + registration-open queries.
  -- Regular nullable TIMESTAMPs — the backend computes & writes these
  -- on every INSERT/UPDATE (the DB no longer auto-derives them).
  -- Decision rationale: CONVERT_TZ at the DB level couples the schema
  -- to MySQL's loaded TZ tables and hides the conversion from unit
  -- tests; doing it in application code keeps the source-of-truth
  -- picker explicit per code path. Legacy rows are one-shot
  -- backfilled at M5a time from `startDateForField` / `endDateForField`
  -- + `startTime` / `endTime` + `time_zone` (see sql-migrations.md
  -- M5a Step 7b).
  `start_at_utc`                    TIMESTAMP NULL DEFAULT NULL,
  `end_at_utc`                      TIMESTAMP NULL DEFAULT NULL,
  `registration_opening_utc`        TIMESTAMP NULL DEFAULT NULL,
  `entry_fee_deadline_utc`          TIMESTAMP NULL DEFAULT NULL,

  -- Participation counts are NOT cached here. The listing query
  -- aggregates `event_joined_team` per event with a single LEFT JOIN
  -- + conditional SUM (see association-events-api-contract.md §1).
  -- Backed by index `idx_ejt_event_status (event_id, deleted_at,
  -- status)` on event_joined_team — covers the JOIN + filter + group.

  PRIMARY KEY (`id`),
  UNIQUE KEY `guid_UNIQUE` (`guid`),
  UNIQUE KEY `uk_team_events_slug` (`slug`),

  KEY `idx_team_events_team`            (`team_id`),
  KEY `idx_team_events_association`     (`association_id`),
  KEY `idx_team_events_status`          (`association_id`, `event_status`),
  KEY `idx_team_events_event_year`      (`association_id`, `event_start_date`),
  KEY `idx_team_events_end_at_utc`      (`association_id`, `end_at_utc`),
  KEY `idx_team_events_reg_open_utc`    (`association_id`, `registration_opening_utc`),
  KEY `idx_team_events_entry_dl_utc`    (`association_id`, `entry_fee_deadline_utc`),
  KEY `idx_team_events_sports_type`     (`sports_type_id`),
  KEY `idx_team_events_field_config`    (`field_config_id`),
  KEY `idx_team_events_medium`          (`medium_id`),
  KEY `idx_team_events_deleted_at`      (`deleted_at`),
  KEY `idx_team_events_created_by`      (`created_by`),
  KEY `idx_team_events_updated_by`      (`updated_by`),
  KEY `idx_team_events_deleted_by`      (`deleted_by`),

  CONSTRAINT `fk_team_events_team`         FOREIGN KEY (`team_id`)         REFERENCES `teams`(`id`)                 ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_team_events_association`  FOREIGN KEY (`association_id`)  REFERENCES `associations`(`id`)          ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_team_events_sports_type`  FOREIGN KEY (`sports_type_id`)  REFERENCES `team_sports_types`(`id`)     ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_team_events_field_config` FOREIGN KEY (`field_config_id`) REFERENCES `game_position_configs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_team_events_medium`       FOREIGN KEY (`medium_id`)       REFERENCES `mediums`(`id`)               ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_team_events_created_by`   FOREIGN KEY (`created_by`)      REFERENCES `users`(`id`)                 ON DELETE SET NULL,
  CONSTRAINT `fk_team_events_updated_by`   FOREIGN KEY (`updated_by`)      REFERENCES `users`(`id`)                 ON DELETE SET NULL,
  CONSTRAINT `fk_team_events_deleted_by`   FOREIGN KEY (`deleted_by`)      REFERENCES `users`(`id`)                 ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment event identifier. Widened from INT UNSIGNED in M5a (safe — no downstream FK referenced it before). FK target for `event_officials.event_id`, `event_tournaments.event_id`. |
| `guid` | VARCHAR(255) NULL | External handle. Globally unique. |
| `slug` | VARCHAR(255) NULL, UNIQUE | Auto-generated URL handle from `eventName` on create — slugified (lowercase, non-alnum → `-`) + `-2`/`-3`… counter on collision (same scheme as the custom-field key). **Read-only** (never client-set); always returned on read. Backs `/public/event/:slug`. Stays stable on rename. |
| `team_id` | BIGINT UNSIGNED NULL FK | Set when the event is owned by a team. Narrowed from VARCHAR(255) in M5a so FK works. RESTRICT on delete. |
| `association_id` | BIGINT UNSIGNED NULL FK | Set when the event is owned by an association. Narrowed from VARCHAR(191) in M5a. RESTRICT on delete. |
| `owner_type` | TINYINT UNSIGNED NULL | Polymorphic-ownership type tag (existing production column). Canonical mapping: **1 = association**, **2 = team** (the `2` value is provisional pending backend confirmation). Carries the same identity as the `team_id` / `association_id` XOR pair, in (type-tag, single-id) form. Production code reads from this pair; legacy code still references the two named columns. M5a Step 4b backfills it for legacy rows where it was NULL. |
| `owner_linked_id` | BIGINT UNSIGNED NULL | Polymorphic owner id (existing production column). Resolves against `associations.id` when `owner_type=1`, `teams.id` when `owner_type=2`. M5a Step 4b backfills from the matching named FK column (`association_id` or `team_id`). No DB-level FK — backend enforces referential integrity at the application layer because the target table varies by `owner_type`. |
| `avatar` | LONGTEXT NULL | Image filename or full source URL. Backend serializer wraps every read through the shared `transformImageUrl()` helper (Cloudflare Image Transformations) — API consumers receive a fully-transformed, publicly fetchable URL. See [`shared-catalogues.md` §7](shared-catalogues.md) for the preset catalogue + helper signature, and [`conventions.md` § Image URLs](../api/conventions.md) for the wire rule. |
| `eventName` | VARCHAR(255) NULL | Display name. |
| `eventType` | VARCHAR(255) NULL | Free-form sub-categorization (e.g. "Tournament", "League", "Showcase"). |
| `association` | VARCHAR(255) NULL | **Denormalized snapshot of `associations.short_name`** — kept so listing queries don't have to JOIN. |
| `location_type` | VARCHAR(20) NOT NULL (def `'in_person'`) | **NEW (M5a).** `'in_person'` → address/geo populated, medium trio null; `'online'` → `medium_id`/`medium`/`Url` populated, address/geo null. Drives the Add/Edit Event wizard's location toggle. |
| `address`, `location` | VARCHAR(255) NULL | Same data; both retained per existing convention. Consumer code may reference either. |
| `city`, `state`, `zipCode` | VARCHAR(255) NULL | Venue location. |
| `startDate`, `endDate` | VARCHAR(255) NULL | Event start/end days in event's local TZ. Source of truth. VARCHAR preserved from production. |
| `startDateForField`, `endDateForField` | VARCHAR(200) NULL | Existing replicated date strings retained. The new UTC mirrors derive from `startDate` + `startTime`. |
| `startTime`, `endTime` | VARCHAR(255) NULL | Wall-clock times in event's TZ. NULL when `allDay='1'`. |
| `exactStartDate`, `exactEndDate`, `exactStartTime`, `exactEndTime` | VARCHAR(255) NULL | Existing replicated columns retained — not authoritative for the UTC computation. |
| `allDay` | VARCHAR(255) NULL | Boolean-as-string. App coerces `'1'` → true, anything else → false. (Existing pattern.) |
| `note` | VARCHAR(1000) NULL | Short free-form note. |
| `lat`, `long` | VARCHAR(255) NULL | Latitude / longitude. |
| `medium_id` | BIGINT UNSIGNED NULL FK | Narrowed from VARCHAR(100) in M5a. References `mediums.id`. SET NULL on delete. |
| `medium` | VARCHAR(255) NULL | Denormalized name snapshot of `mediums.name`. |
| `Url` | VARCHAR(255) NULL | External event URL. Capital `U` preserved from production. |
| `color` | VARCHAR(10) NULL | `#RRGGBB` hex code for UI tagging. |
| `createdByDate`, `createdByName` | VARCHAR(255) NULL | Existing denormalized creator snapshot columns. |
| `status` | VARCHAR(255) DEFAULT '1' | Original column kept during M5a soak. M5b will drop it; `event_status` is the canonical name post-soak. |
| `event_status` | ENUM(...) NULL | **NEW in M5a**. Backfilled from `status` via mapping (`'0'→draft, '1'→published, '2'→completed, '3'→cancelled`). App reads `event_status` from M5a onward. Permanent column name (no rename in M5b). |
| `director_email`, `director_phone`, `director_name` | VARCHAR(255) NULL | Director contact. |
| `tournament_id` | INT NULL | Vestigial — relationship is reversed (`event_tournaments.event_id → team_events.id`). Kept for production compat; no FK added. |
| `time_zone` | LONGTEXT NULL | IANA name (e.g. `America/Los_Angeles`). LONGTEXT preserved; M5a pre-flight normalizes any non-IANA values. |
| `created_by`, `updated_by`, `deleted_by` | BIGINT UNSIGNED NULL FK | Widened from INT UNSIGNED in M5a so FKs to `users.id` (BIGINT) work. SET NULL on delete. |
| `created_at`, `updated_at`, `deleted_at` | TIMESTAMP NULL | Standard audit timestamps. |
| `reminder` | LONGTEXT NULL | Free-form reminder prose. |
| `entry_fee` | DOUBLE NULL | Event-level entry fee. Per-tournament overrides via `event_tournaments`. |
| `refund_policy`, `tournament_format` | LONGTEXT NULL | Long-form prose. |
| `entry_fee_deadline` | DATE NULL | Date in event's TZ. Generated `entry_fee_deadline_utc` mirror added in M5a. |
| `mob_code` | VARCHAR(255) NULL | Country code for `director_phone`. **Different collation** (`utf8mb4_0900_ai_ci`) — preserved from production. |
| `pool_play`, `game_guarantee`, `division_type`, `pool_play_time`, `championship_time`, `bracket_time`, `time_interval` | VARCHAR(255) NULL | Tournament defaults inherited by child `event_tournaments`. |
| `sports_type_id` | BIGINT UNSIGNED NULL FK | References `team_sports_types.id`. UNSIGNED added in M5a so FK type-aligns. RESTRICT on delete. |
| `allow_team_registration` | TINYINT(1) | Master switch — when 0, the registration window UI is hidden. |
| `registration_opening` | DATETIME NULL | Wall-clock datetime in event's TZ. Source of truth. Generated `registration_opening_utc` mirror added in M5a. |
| `payment_required`, `payment_terms`, `partial_payment_type`, `partial_payment_value`, `allow_offline_payment`, `auto_confirm_on_full_payment`, `auto_confirm_on_partial_payment` | TINYINT / DECIMAL | Fee-collection controls. |
| `field_config_id` | BIGINT UNSIGNED NULL FK | References `game_position_configs.id`. SET NULL on delete. |
| `registration_open` | INT NOT NULL DEFAULT 0 | Existing flag — semantics unclear; treat as opaque per dev team. |
| `startDate`, `endDate`, `startTime`, `endTime` | VARCHAR(255) NULL | Legacy. Kept verbatim for backwards-compat with consumers that still read them. New API writes go to `event_start_date` / `event_end_date` / `event_start_time` / `event_end_time` (see below); the UTC mirrors source from THOSE, not these. M5b drops these after the new columns soak. |
| `event_start_date`, `event_end_date` | DATE NULL | **NEW in M5a**. snake_case per the dev-team convention for new additions. Source of truth for the new API. Legacy rows have these NULL → past-events / year filters skip them. |
| `event_start_time`, `event_end_time` | TIME NULL | **NEW in M5a**. Pair with the new date columns. NULL when `all_day = TRUE`. |
| `start_at_utc`, `end_at_utc`, `registration_opening_utc`, `entry_fee_deadline_utc` | TIMESTAMP NULL | **NEW in M5a**. UTC mirrors written by the backend on every INSERT/UPDATE. Regular nullable TIMESTAMPs — the DB no longer auto-derives them via `CONVERT_TZ` (decision: keep the conversion in app code where it's testable and the source-of-truth picker is explicit). Legacy rows are one-shot backfilled at migration time from `startDateForField` / `endDateForField` + `startTime` / `endTime` + `time_zone` via `CONVERT_TZ(...)` (see sql-migrations.md M5a Step 7b). Index-friendly for past-event + registration-open filters across timezones. |

> **No cached participation counter.** The listing endpoint surfaces a status breakdown (`pending`/`confirmed`/`waitlisted`/`withdrawn`) computed at read time via a single `LEFT JOIN event_joined_team` + conditional `SUM(...)` per status. Backed by the covering index `idx_ejt_event_status (event_id, deleted_at, status)` on `event_joined_team`. See `association-events-api-contract.md` §1 for the query shape; cost analysis sits in plan §11 (humming-drifting-russell). The earlier `team_count` cached column is intentionally not added.

#### Indexes

- `guid_UNIQUE` — globally-unique external handle (existing index preserved).
- `idx_team_events_team`, `idx_team_events_association` — FK indexes for owner-specific queries.
- `idx_team_events_status` `(association_id, event_status)` — listing's primary status filter.
- `idx_team_events_event_year` `(association_id, event_start_date)` — Year filter dropdown (`WHERE YEAR(event_start_date) = ?`) + default chronological sort. Operates on the typed DATE column so it's both crash-safe and faster than the legacy VARCHAR-based index would be.
- `idx_team_events_end_at_utc` `(association_id, end_at_utc)` — Past Events filter (`WHERE end_at_utc < UTC_TIMESTAMP()`). Indexable across timezones because the generated column is UTC.
- `idx_team_events_reg_open_utc`, `idx_team_events_entry_dl_utc` — registration-window "is open now?" filters, same pattern.
- `idx_team_events_sports_type`, `idx_team_events_field_config`, `idx_team_events_medium` — FK indexes.
- `idx_team_events_deleted_at`, audit-by indexes — schema convention compliance.

#### FK delete semantics

| FK | Rule | Why |
|---|---|---|
| `team_events.association_id → associations.id` | **RESTRICT** | Events carry business value (history, payments, scoring). An association can't be deleted while events exist; admin must cancel + soft-delete every event first. |
| `team_events.team_id → teams.id` | **RESTRICT** | Same reasoning for team-owned events. |
| `team_events.sports_type_id → team_sports_types.id` | **RESTRICT** | Sport type is reference data; deletion shouldn't cascade. |
| `team_events.field_config_id → game_position_configs.id` | **SET NULL** | If a field config is removed, the event keeps existing — just no longer references the removed catalogue entry. |
| `team_events.medium_id → mediums.id` | **SET NULL** | The denormalized `medium` snapshot keeps the historical name; the FK going NULL just removes the live link. |
| Audit-by FKs | **SET NULL** | Schema convention. |

#### Lifecycle notes

Four-state ENUM:

- **draft** — work in progress. Not visible publicly. Default for new rows.
- **published** — visible publicly. Registration window (the two timestamp fields) governs whether teams can sign up.
- **completed** — event has wrapped. Scores + brackets are read-only.
- **cancelled** — terminal. Event won't happen.

Transitions enforced by the API contract: `draft → published / cancelled`, `published → completed / cancelled`. `completed` and `cancelled` are terminal.

#### M5b — minimal drop list

Per the existing-columns-preservation rule (locked decision #9), the only thing M5b drops is the obsolete VARCHAR `status` column after `event_status` ENUM takes over. Everything else stays — even columns that look redundant (`startDateForField` / `endDateForField`, `exactStartDate` / etc., `location`, `tournament_id`, `createdByDate` / `createdByName`, `association`) — because production consumers still reference them.

| Column | When dropped | Why eventually removed |
|---|---|---|
| `status` (old VARCHAR) | M5b after soak | `event_status` ENUM (added in M5a) is the canonical lifecycle column. M5b just drops the old `status` — no rename. |

All other "redundant-looking" columns are explicitly **retained indefinitely** per the dev team's instruction. The schema is comfortable carrying them.

See `sql-migrations.md` M5a / M5b for the phased application.

---

### `event_officials`

#### Purpose

Per-event grant records — `(event, association_user)` pairs with their own permission set + scoring scope. References `association_users.id` (not `users.id`) so the association stays the gateway to event participation; a user who's not an association member can't be granted event-level powers.

Application-layer invariant: a row is only valid when the parent `team_events` row has `owner_type = 1` (association). Backend rejects 422 otherwise.

#### CREATE script

```sql
CREATE TABLE `event_officials` (
  `id`                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_id`            BIGINT UNSIGNED NOT NULL,
  `association_user_id`      BIGINT UNSIGNED NOT NULL,
  `full_control`             BOOLEAN NOT NULL DEFAULT FALSE,
  `permissions_json`         JSON NULL,
  `scoring_scope_json`       JSON NULL,
  `created_at`               TIMESTAMP NULL DEFAULT NULL,
  `updated_at`               TIMESTAMP NULL DEFAULT NULL,
  `deleted_at`               TIMESTAMP NULL DEFAULT NULL,
  `created_by`               BIGINT UNSIGNED NULL,
  `updated_by`               BIGINT UNSIGNED NULL,
  `deleted_by`               BIGINT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_event_officials_event_user` (`event_id`, `association_user_id`, `deleted_at`),
  KEY `idx_event_officials_event`           (`event_id`),
  KEY `idx_event_officials_user`            (`association_user_id`),
  KEY `idx_event_officials_deleted_at`      (`deleted_at`),
  KEY `idx_event_officials_created_by`      (`created_by`),
  KEY `idx_event_officials_updated_by`      (`updated_by`),
  KEY `idx_event_officials_deleted_by`      (`deleted_by`),
  CONSTRAINT `fk_event_officials_event`
    FOREIGN KEY (`event_id`) REFERENCES `team_events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_event_officials_assoc_user`
    FOREIGN KEY (`association_user_id`) REFERENCES `association_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_event_officials_created_by`  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_event_officials_updated_by`  FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_event_officials_deleted_by`  FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment grant identifier. |
| `event_id` | BIGINT UNSIGNED FK | Parent event. RESTRICT on delete — don't lose grants by silent event deletion. |
| `association_user_id` | BIGINT UNSIGNED FK | The grantee. CASCADE on delete — membership removal cascades to event grants (orphaned grants are nonsensical). |
| `full_control` | BOOLEAN | When TRUE, every event-level permission is implicitly granted regardless of `permissions_json` content. Same encoding rule as `association_users.full_control`. |
| `permissions_json` | JSON NULL | Array of permission keys drawn from the `EventPermissionKey` enum (`'edit_event'`, `'manage_divisions'`, `'manage_parks'`, etc.). Empty array when `full_control=TRUE`. |
| `scoring_scope_json` | JSON NULL | When `permissions_json` includes `'manage_scoring'`, scopes which games the user can score. Shape: `{ mode: 'all'\|'parks'\|'divisions', parkIds: [...], divisionIds: [...] }`. NULL when scoring permission isn't granted. |
| Standard audit columns | (see Conventions) | |

#### Indexes

- `uk_event_officials_event_user` `(event_id, association_user_id, deleted_at)` — one live grant per `(event, user)`. Soft-delete-aware so re-grant is possible.
- `idx_event_officials_event`, `idx_event_officials_user` — FK lookups.
- `idx_event_officials_deleted_at`, audit-by indexes — convention.

#### FK delete semantics

| FK | Rule | Why |
|---|---|---|
| `event_officials.event_id → team_events.id` | **RESTRICT** | Don't lose grants by silent event deletion. Admin must explicitly remove officials first OR soft-cancel the event (cancellation doesn't trigger RESTRICT). |
| `event_officials.association_user_id → association_users.id` | **CASCADE** | Membership removal is a real action; orphaned grants are nonsensical. Drop them with the membership. |
| Audit-by FKs | **SET NULL** | Convention. |

---

### `event_seed_criteria`

#### Purpose

Event-level **default** tie-break seeding criteria. One row per selected criterion; `order` defines the tie-break priority. These are the defaults a division (`event_tournaments`) inherits **unless** the division overrides them with its own rows in `tournament_seed_criteria` (tournament doc). `seeding_criteria_id` references the global seeding-criteria catalogue served by `GET /v2/seeders` (shared-services §6).

#### CREATE script (target end-state)

```sql
CREATE TABLE `event_seed_criteria` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_id`            BIGINT UNSIGNED NOT NULL,
  `seeding_criteria_id` BIGINT UNSIGNED NOT NULL,
  `order`               INT NOT NULL DEFAULT '1',
  `status`              INT NOT NULL DEFAULT '1',
  `created_at`          TIMESTAMP NULL DEFAULT NULL,
  `updated_at`          TIMESTAMP NULL DEFAULT NULL,
  `deleted_at`          TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_event_seed_criteria_event`       (`event_id`),
  KEY `idx_event_seed_criteria_event_order` (`event_id`, `order`),
  KEY `idx_event_seed_criteria_criterion`   (`seeding_criteria_id`),
  KEY `idx_event_seed_criteria_deleted_at`  (`deleted_at`),
  CONSTRAINT `fk_event_seed_criteria_event`
    FOREIGN KEY (`event_id`)            REFERENCES `team_events`(`id`)      ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_event_seed_criteria_criterion`
    FOREIGN KEY (`seeding_criteria_id`) REFERENCES `seeding_criteria`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

> **As-provided vs. conformant**: production ships this table with only `PRIMARY KEY (id)` and no indexes/FKs. The script above keeps every column and the `id BIGINT UNSIGNED` type **unchanged** (no renames) and only *adds* the FK indexes + constraints. `order` is a reserved word — always quoted. `ON DELETE RESTRICT` mirrors `tournament_seed_criteria`.

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment row id. |
| `event_id` | BIGINT UNSIGNED FK | Owning event (`team_events.id`). **RESTRICT**. |
| `seeding_criteria_id` | BIGINT UNSIGNED FK | The chosen criterion (`seeding_criteria.id` — the `/v2/seeders` catalogue). **RESTRICT**. |
| `order` | INT NOT NULL (def 1) | 1-based tie-break priority. Reserved word — always quoted. |
| `status` | INT NOT NULL (def 1) | Active flag (1 = active). |
| `created_at`, `updated_at`, `deleted_at` | TIMESTAMP NULL | Standard timestamps + soft-delete. |

#### Relation to `tournament_seed_criteria`

`event_seed_criteria` holds the **event default**; `tournament_seed_criteria` (tournament doc) holds the **per-division override**. Resolution: a division uses its own `tournament_seed_criteria` rows if any exist; otherwise it falls back to the event's `event_seed_criteria`.

---

### `event_playing_facilities`

#### Purpose

Join table — which parks are added to an event. Read by every UI surface that needs the event's venue list (scheduler, public event page, audience-facing schedule preview, official-access modal's park picker, etc.).

#### CREATE script

```sql
CREATE TABLE `event_playing_facilities` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_id`   BIGINT UNSIGNED NOT NULL,
  `park_id`    BIGINT UNSIGNED NOT NULL,
  `status`     INT             DEFAULT '1',
  `created_at` TIMESTAMP       NULL DEFAULT NULL,
  `updated_at` TIMESTAMP       NULL DEFAULT NULL,
  `deleted_at` TIMESTAMP       NULL DEFAULT NULL,
  `created_by` VARCHAR(45)     DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_epf_event_lookup` (`event_id`, `deleted_at`, `park_id`),
  CONSTRAINT `fk_epf_event`
    FOREIGN KEY (`event_id`) REFERENCES `team_events`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_epf_park`
    FOREIGN KEY (`park_id`) REFERENCES `game_parts`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment row identifier. |
| `event_id` | BIGINT UNSIGNED FK | Parent event. RESTRICT — physical event delete is blocked while it has facilities; soft-cancel is the supported lifecycle. Widened from `INT UNSIGNED` to align with `team_events.id`. |
| `park_id` | BIGINT UNSIGNED FK | The added park. RESTRICT — the park master is referenced by other events too; physical removal must clean up child rows first. Widened from `INT UNSIGNED`. |
| `status` | INT (default 1) | `0 = inactive`, `1 = active`. |
| `created_by` | VARCHAR(45) NULL | Legacy free-form audit string (not a real FK to `users.id`). Kept as-is per "no rename" rule. |
| Standard timestamps | TIMESTAMP NULL | |

#### Indexes

- `idx_epf_event_lookup (event_id, deleted_at, park_id)` — covering index for the §9 endpoint's parks-on-event lookup. Planner reads only the index for the WHERE + JOIN.

#### Relations

- Parents: `team_events.id`, `game_parts.id`.
- No children directly; downstream consumers join through `park_scheduling_windows.event_id + .park_id` and `event_field_selections.event_id + park_fields.park_id`.

---

### `event_field_selections`

#### Purpose

Join table — which fields are selected for use on a given event, scoped per `park_field`. One row per `(event, park_field)` pair the admin picked during event setup. Carries display ordering (`order_no`) used by every UI surface that lists fields (scheduler's column order, public page's field list, etc.).

#### Lifecycle

Hard delete — when an admin unselects a field on the event, the row is removed entirely. There is intentionally no `deleted_at` column. The `is_selected` column is kept for back-compat but is redundant under this lifecycle (every live row is selected); v2 queries still apply `is_selected = 1` as a defensive filter.

#### CREATE script

```sql
CREATE TABLE `event_field_selections` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_id`      BIGINT UNSIGNED NOT NULL,
  `park_field_id` BIGINT UNSIGNED NOT NULL,
  `is_selected`   INT             DEFAULT NULL,
  `created_at`    TIMESTAMP       NULL DEFAULT NULL,
  `updated_at`    TIMESTAMP       NULL DEFAULT NULL,
  `order_no`      INT             DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_event_park_field` (`event_id`, `park_field_id`),
  CONSTRAINT `fk_efs_event`
    FOREIGN KEY (`event_id`) REFERENCES `team_events`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_efs_park_field`
    FOREIGN KEY (`park_field_id`) REFERENCES `park_fields`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment row identifier. Widened from `INT` (signed) to `BIGINT UNSIGNED` for consistency with the rest of the schema. |
| `event_id` | BIGINT UNSIGNED FK | Parent event. RESTRICT. Widened from nullable `INT` to non-null `BIGINT UNSIGNED`. |
| `park_field_id` | BIGINT UNSIGNED FK | The selected field. RESTRICT. Resolves to the park transitively via `park_fields.park_id`. Widened from nullable `INT` to non-null `BIGINT UNSIGNED`. |
| `is_selected` | INT NULL | `1 = selected`, `0 = not selected`. Redundant under hard-delete lifecycle (every row is `1`); kept for back-compat. v2 reads still filter `WHERE is_selected = 1` defensively. |
| `order_no` | INT NULL | Display order of the field across every UI surface that lists fields on the event (scheduler columns, public schedule, etc.). Lower = first. NULL = unordered (sort alphabetical fallback). |
| `created_at`, `updated_at` | TIMESTAMP NULL | No `deleted_at` (hard-delete lifecycle). No audit-by columns. |

#### Indexes

- `unique_event_park_field (event_id, park_field_id)` — prevents duplicate selections AND covers the §9 lookup (`WHERE event_id = :eventId` rides the leading column).
- FK auto-index on `park_field_id` supports the JOIN to `park_fields`.

#### Relations

- Parents: `team_events.id`, `park_fields.id`.
- No children.

---

### `park_scheduling_windows`

#### Purpose

Per-event, per-park, per-day availability windows. One row per calendar day a park is in use on a given event, with `start_time` / `end_time` marking the daily play window. Source of the `schedule[]` array on the §9 Get Event Resources endpoint and the input to the scheduler's grid layout. Park-level (NOT field-level) — every field at the selected park inherits the same daily window.

#### CREATE script

```sql
CREATE TABLE `park_scheduling_windows` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_id`       BIGINT UNSIGNED NOT NULL,
  `park_id`        BIGINT UNSIGNED NOT NULL,
  `available_date` VARCHAR(255)    NOT NULL,
  `start_time`     VARCHAR(255)    NOT NULL,
  `end_time`       VARCHAR(255)    NOT NULL,
  `status`         TINYINT         NOT NULL DEFAULT '1',
  `created_by`     BIGINT UNSIGNED DEFAULT NULL,
  `updated_by`     BIGINT UNSIGNED DEFAULT NULL,
  `deleted_by`     BIGINT UNSIGNED DEFAULT NULL,
  `created_at`     TIMESTAMP       NULL DEFAULT NULL,
  `updated_at`     TIMESTAMP       NULL DEFAULT NULL,
  `deleted_at`     TIMESTAMP       NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_psw_lookup`
    (`event_id`, `deleted_at`, `park_id`, `available_date`,
     `start_time`, `end_time`),
  CONSTRAINT `fk_psw_event`
    FOREIGN KEY (`event_id`) REFERENCES `team_events`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_psw_park`
    FOREIGN KEY (`park_id`) REFERENCES `game_parts`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment row identifier. |
| `event_id` | BIGINT UNSIGNED FK | Parent event. RESTRICT. |
| `park_id` | BIGINT UNSIGNED FK | The park whose window this is. RESTRICT. |
| `available_date` | VARCHAR(255) | ISO `YYYY-MM-DD` (stored as string per legacy convention; v2 readers parse). Local-to-the-event-timezone. |
| `start_time` | VARCHAR(255) | 24-hour `HH:MM` (stored as string per legacy convention). |
| `end_time` | VARCHAR(255) | 24-hour `HH:MM`. |
| `status` | TINYINT (default 1) | `0 = inactive`, `1 = active`. |
| `created_by` / `updated_by` / `deleted_by` | BIGINT UNSIGNED NULL | Advisory audit columns — NO FK to `users.id` (matches the pattern used elsewhere for opt-in audit; soft-deleted users don't break window rows). |
| `created_at` / `updated_at` / `deleted_at` | TIMESTAMP NULL | |

#### Indexes

- `idx_psw_lookup (event_id, deleted_at, park_id, available_date, start_time, end_time)` — covering index for the §9 schedule-windows query. Planner serves the full SELECT from the index without row visits.

#### Server-side label formatting

The §9 endpoint formats `dateLabel`, `dateLabelShort`, `timeRangeLabel` from this table's `available_date` + `start_time` + `end_time` using the **event's** `team_events.time_zone` (not `game_parts.time_zone`, which is a dead column on the parks master). Frontend treats the labels as opaque per the v2 wire conventions.

#### Relations

- Parents: `team_events.id`, `game_parts.id`.
- No children.

---

### Relations diagram — parks & scheduling

```
                  team_events (id)
                       │
        ┌──────────────┼──────────────────────────┐
        │              │                          │
        ▼              ▼                          ▼
event_playing      event_field             park_scheduling
  _facilities      _selections                  _windows
  (event_id,       (event_id,                 (event_id,
   park_id)         park_field_id)             park_id,
                                              available_date,
                                              start_time,
                                              end_time)
        │              │
        │              ▼
        │         park_fields ──┐
        │         (park_id)      │
        │                        │
        ▼                        ▼
   game_parts (id) ◄──────────────
   (master parks catalogue)
```

`event_field_selections` resolves to a park only transitively, via `park_fields.park_id`. The application layer joins these in-memory when building the §9 response per the SQL in `docs/api/association-events-api-contract.md` §9.

---

### `event_hotels`

#### Purpose

Hotel blocks listed for an event — the source of the dashboard's Hotels card and the §9 Get Event Resources `hotels` bucket (served from a client-side mock today until this table ships; see `association-events-api-contract.md` §9). One row per hotel on the event.

#### CREATE script (target end-state)

```sql
CREATE TABLE `event_hotels` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_id`            BIGINT UNSIGNED NOT NULL,   -- widened: was int unsigned
  `name`                VARCHAR(500) DEFAULT NULL,
  `website_url`         VARCHAR(500) DEFAULT NULL,
  `image_url`           VARCHAR(500) DEFAULT NULL,
  `phone_number`        VARCHAR(255) DEFAULT NULL,
  `mob_code`            VARCHAR(255) DEFAULT NULL,
  `latitude`            VARCHAR(500) DEFAULT NULL,
  `longitude`           VARCHAR(500) DEFAULT NULL,
  `address_description` VARCHAR(500) DEFAULT NULL,
  `street_address`      VARCHAR(500) DEFAULT NULL,
  `city`                VARCHAR(255) DEFAULT NULL,
  `state`               VARCHAR(255) DEFAULT NULL,
  `zip`                 VARCHAR(255) DEFAULT NULL,
  `notes`               VARCHAR(500) DEFAULT NULL,
  `status`              INT DEFAULT '1',
  `created_at`          TIMESTAMP NULL DEFAULT NULL,
  `updated_at`          TIMESTAMP NULL DEFAULT NULL,
  `deleted_at`          TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_event_hotels_event` (`event_id`, `deleted_at`),
  CONSTRAINT `fk_event_hotels_event`
    FOREIGN KEY (`event_id`) REFERENCES `team_events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

> **Conformance changes from production** (no renames): `event_id` widened `int unsigned → BIGINT UNSIGNED` to align with `team_events.id`, FK + covering index added, and the table-level `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci` clause added. **Per-column `CHARACTER SET`/`COLLATE` removed** — every string column inherits the table default per the Conventions (per-column collation causes silent JOIN slowness + drift). No `*_by` audit columns in production; kept as-is (timestamps only), matching the other event-resource tables.

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment hotel id. |
| `event_id` | BIGINT UNSIGNED FK | Owning event (`team_events.id`). **RESTRICT**. Widened from `int unsigned`. |
| `name` | VARCHAR(500) NULL | Hotel display name. |
| `website_url` | VARCHAR(500) NULL | Booking / info link. |
| `image_url` | VARCHAR(500) NULL | Logo / photo (wrapped via `transformImageUrl()` on read). |
| `phone_number` / `mob_code` | VARCHAR(255) NULL | Local number + dialing country code (e.g. `"+1"`). |
| `latitude` / `longitude` | VARCHAR(500) NULL | Geocode, stringified (matches `game_parts` lat/lng convention). |
| `address_description` / `street_address` / `city` / `state` / `zip` | VARCHAR NULL | Address parts. |
| `notes` | VARCHAR(500) NULL | Free-text note. |
| `status` | INT (default 1) | `0 = inactive`, `1 = active`. |
| `created_at` / `updated_at` / `deleted_at` | TIMESTAMP NULL | Standard timestamps + soft-delete. |

#### Relations

- Parent: `team_events.id`. No children.

---

### `event_sponsors`

#### Purpose

Sponsors listed for an event — the source of the dashboard's Sponsors rail and the §9 `sponsors` bucket (mock today until this table ships). One row per sponsor on the event.

#### CREATE script (target end-state)

```sql
CREATE TABLE `event_sponsors` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_id`    BIGINT UNSIGNED NOT NULL,   -- widened: was int unsigned
  `name`        VARCHAR(500) DEFAULT NULL,
  `website_url` VARCHAR(500) DEFAULT NULL,
  `image_url`   VARCHAR(500) DEFAULT NULL,
  `status`      INT DEFAULT '1',
  `created_at`  TIMESTAMP NULL DEFAULT NULL,
  `updated_at`  TIMESTAMP NULL DEFAULT NULL,
  `deleted_at`  TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_event_sponsors_event` (`event_id`, `deleted_at`),
  CONSTRAINT `fk_event_sponsors_event`
    FOREIGN KEY (`event_id`) REFERENCES `team_events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

> **Conformance changes** (no renames): `event_id` widened to `BIGINT UNSIGNED`, FK + index added, table-level charset/engine added, per-column `CHARACTER SET`/`COLLATE` removed.

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment sponsor id. |
| `event_id` | BIGINT UNSIGNED FK | Owning event (`team_events.id`). **RESTRICT**. Widened from `int unsigned`. |
| `name` | VARCHAR(500) NULL | Sponsor display name. |
| `website_url` | VARCHAR(500) NULL | Sponsor link. |
| `image_url` | VARCHAR(500) NULL | Logo (wrapped via `transformImageUrl()` on read; empty → wordmark fallback). |
| `status` | INT (default 1) | `0 = inactive`, `1 = active`. |
| `created_at` / `updated_at` / `deleted_at` | TIMESTAMP NULL | Standard timestamps + soft-delete. |

#### Relations

- Parent: `team_events.id`. No children.

---

### `event_umpires`

#### Purpose

The event-level umpire roster — which umpires are assigned to an event (the pool the Umpires page draws from, and the source for per-game crew assignment). One row per `(event, umpire)`.

#### CREATE script (target end-state)

```sql
CREATE TABLE `event_umpires` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_id`   BIGINT UNSIGNED NOT NULL,   -- widened: was int unsigned
  `umpire_id`  BIGINT UNSIGNED NOT NULL,   -- widened: was int unsigned
  `status`     INT DEFAULT '1',
  `created_at` TIMESTAMP NULL DEFAULT NULL,
  `updated_at` TIMESTAMP NULL DEFAULT NULL,
  `deleted_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_event_umpires_event_umpire` (`event_id`, `umpire_id`, `deleted_at`),
  KEY `idx_event_umpires_umpire` (`umpire_id`),
  CONSTRAINT `fk_event_umpires_event`
    FOREIGN KEY (`event_id`)  REFERENCES `team_events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_event_umpires_umpire`
    FOREIGN KEY (`umpire_id`) REFERENCES `users`(`id`)       ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

> **Conformance changes** (no renames): `event_id` + `umpire_id` widened to `BIGINT UNSIGNED`; FKs + a soft-delete-aware uniqueness index added; table-level engine/charset added.
> ⚠️ **Verify FK target for `umpire_id`.** This assumes umpires are `users` (consistent with `tournament_games.umpire_id → users.id`). If your system has a dedicated umpire/official table instead, repoint `fk_event_umpires_umpire` accordingly before shipping.

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment row id. |
| `event_id` | BIGINT UNSIGNED FK | Owning event (`team_events.id`). **RESTRICT**. Widened from `int unsigned`. |
| `umpire_id` | BIGINT UNSIGNED FK | The rostered umpire (`users.id` — verify). **RESTRICT**. Widened from `int unsigned`. |
| `status` | INT (default 1) | `0 = inactive`, `1 = active`. |
| `created_at` / `updated_at` / `deleted_at` | TIMESTAMP NULL | Standard timestamps + soft-delete. |

#### Relations

- Parents: `team_events.id`, `users.id` (umpire — verify). No children.

---

### `event_joined_teams`

#### Purpose

Team-side participation rows — which teams have joined / registered for an event, and their request + participation lifecycle. The listing endpoint aggregates the status breakdown per event at read time (see `association-events-api-contract.md` §1); no cached counter lives on `team_events`.

#### CREATE script (target end-state)

```sql
CREATE TABLE `event_joined_teams` (
  `id`                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `guid`                   VARCHAR(255) NOT NULL,
  `event_id`               BIGINT UNSIGNED NOT NULL,
  `team_id`                BIGINT UNSIGNED NOT NULL,
  `association_id`         BIGINT UNSIGNED NULL,
  `association_team_id`    BIGINT UNSIGNED NULL,
  `request_date`           DATETIME NULL,
  `request_status`         TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0=pending, 1=approved, 2=rejected',
  `participation_status`   TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0=initiated, 1=pending_approval, 2=confirmed, 3=waitlisted, 4=withdrawn, 5=cancelled',
  `joined_at`              DATETIME NULL,
  `approved_at`            DATETIME NULL,
  `rejected_at`            DATETIME NULL,
  `confirmed_at`           DATETIME NULL,
  `withdrawn_at`           DATETIME NULL,
  `is_exhibition_team`     TINYINT(1) NOT NULL DEFAULT 0,
  `is_seeded_last`         TINYINT(1) NOT NULL DEFAULT 0,
  `approved_by_user_id`    BIGINT UNSIGNED NULL,
  `rejection_reason`       VARCHAR(500) NULL,
  `lineup_update_required` TINYINT(1) NOT NULL DEFAULT 0,
  `status`                 TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1=active, 0=inactive',
  `created_at`             TIMESTAMP NULL DEFAULT NULL,
  `updated_at`             TIMESTAMP NULL DEFAULT NULL,
  `deleted_at`             TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_event_joined_teams_guid`       (`guid`),
  UNIQUE KEY `uq_event_joined_teams_event_team` (`event_id`, `team_id`, `deleted_at`),
  KEY `idx_ejt_team_id`              (`team_id`),
  KEY `idx_ejt_association_id`       (`association_id`),
  KEY `idx_ejt_association_team_id`  (`association_team_id`),
  KEY `idx_ejt_request_status`       (`request_status`),
  KEY `idx_ejt_event_status`         (`event_id`, `deleted_at`, `participation_status`),
  KEY `idx_ejt_approved_by`          (`approved_by_user_id`),
  CONSTRAINT `fk_ejt_event`
    FOREIGN KEY (`event_id`)            REFERENCES `team_events`(`id`)        ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_ejt_team`
    FOREIGN KEY (`team_id`)             REFERENCES `teams`(`id`)              ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_ejt_association`
    FOREIGN KEY (`association_id`)      REFERENCES `associations`(`id`)       ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_ejt_association_team`
    FOREIGN KEY (`association_team_id`) REFERENCES `association_teams`(`id`)  ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_ejt_approved_by`
    FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`)             ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

> **Discrepancies fixed / flagged from the provided DDL** (no column/table renames):
> - **FK target corrected**: production references `events(id)` / `events` — there is no `events` table; the event master is **`team_events`**. FKs repointed to `team_events(id)`. ⚠️ confirm.
> - **`registration_no` unique key dropped**: production declared `UNIQUE KEY uq_event_joined_teams_registration_no (registration_no)` but **no `registration_no` column exists** in the table. The key is omitted here. ⚠️ **Decide**: add a `registration_no` column, or drop the key permanently. (`idx_ejt_event_team_status` from production is superseded by `idx_ejt_event_status` above.)
> - **Syntax**: production was missing commas after the `guid` unique key and the `registration_no` key (would not parse) — fixed.
> - `association_id` FK uses **RESTRICT** per the Conventions rule (every direct child FK into `associations`).
> - `approved_by_user_id` → `users.id` **SET NULL** (actor ref).
> - Datetime lifecycle columns (`request_date`, `joined_at`, …) kept as `DATETIME` as provided (app-written local moments); `created_at`/`updated_at`/`deleted_at` are `TIMESTAMP`.
> - **Naming note**: earlier docs/contracts referenced this table as `event_joined_team` (singular) with a `status`-based breakdown; the real table is **`event_joined_teams`** (plural) with `participation_status`. Contract prose should align to the plural name + `participation_status`.

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment row id. |
| `guid` | VARCHAR(255) | Shareable external handle. Unique. |
| `event_id` | BIGINT UNSIGNED FK | Owning event (`team_events.id`). **RESTRICT**. |
| `team_id` | BIGINT UNSIGNED FK | Joined team (`teams.id`). **RESTRICT**. |
| `association_id` | BIGINT UNSIGNED NULL FK | Association the team is registered under (`associations.id`). **RESTRICT**. |
| `association_team_id` | BIGINT UNSIGNED NULL FK | Association-team registration (`association_teams.id`). **RESTRICT**. |
| `request_date` | DATETIME NULL | When the join request was made. |
| `request_status` | TINYINT UNSIGNED (def 0) | `0=pending`, `1=approved`, `2=rejected`. |
| `participation_status` | TINYINT UNSIGNED (def 0) | `0=initiated`, `1=pending_approval`, `2=confirmed`, `3=waitlisted`, `4=withdrawn`, `5=cancelled`. |
| `joined_at` / `approved_at` / `rejected_at` / `confirmed_at` / `withdrawn_at` | DATETIME NULL | Lifecycle moment stamps. |
| `is_exhibition_team` / `is_seeded_last` | TINYINT(1) (def 0) | Flags for exhibition / seed-last placement. |
| `approved_by_user_id` | BIGINT UNSIGNED NULL FK | Approver (`users.id`). **SET NULL**. |
| `rejection_reason` | VARCHAR(500) NULL | Free-text rejection note. |
| `lineup_update_required` | TINYINT(1) (def 0) | Flags a stale lineup needing resubmission. |
| `status` | TINYINT UNSIGNED (def 1) | `1=active`, `0=inactive`. |
| `created_at` / `updated_at` / `deleted_at` | TIMESTAMP NULL | Standard timestamps + soft-delete. |

#### Relations

- Parents: `team_events.id`, `teams.id`, `associations.id`, `association_teams.id`, `users.id` (approver).
- Children: `event_team_lineup.event_joined_team_id`.

---

### `event_team_lineup`

#### Purpose

Per-team event lineup — one row per player on a joined team's lineup for an event (batting order, field position, starter/bench, lineup lifecycle). Children of an `event_joined_teams` row.

#### CREATE script (target end-state)

```sql
CREATE TABLE `event_team_lineup` (
  `id`                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_joined_team_id` BIGINT UNSIGNED NOT NULL,
  `event_id`             BIGINT UNSIGNED NOT NULL,
  `team_id`              BIGINT UNSIGNED NOT NULL,
  `team_member_id`       BIGINT UNSIGNED DEFAULT NULL,
  `user_id`              BIGINT UNSIGNED DEFAULT NULL,
  `player_name`          VARCHAR(150) NOT NULL,
  `batting_order`        TINYINT UNSIGNED DEFAULT NULL,
  `field_position_code`  VARCHAR(20) DEFAULT NULL,
  `is_starter`           TINYINT(1) NOT NULL DEFAULT '1',
  `is_bench`             TINYINT(1) NOT NULL DEFAULT '0',
  `is_active`            TINYINT(1) NOT NULL DEFAULT '1',
  `jersey_number`        VARCHAR(20) DEFAULT NULL,
  `lineup_status`        TINYINT UNSIGNED NOT NULL DEFAULT '0' COMMENT '0=draft, 1=submitted, 2=approved, 3=inactive',
  `player_source_type`   TINYINT UNSIGNED NOT NULL DEFAULT '0' COMMENT '0=manual, 1=team_member, 2=invited_member, 3=association_entered',
  `submitted_at`         DATETIME DEFAULT NULL,
  `approved_at`          DATETIME DEFAULT NULL,
  `notes`                VARCHAR(500) DEFAULT NULL,
  `created_at`           TIMESTAMP NULL DEFAULT NULL,
  `updated_at`           TIMESTAMP NULL DEFAULT NULL,
  `deleted_at`           TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_event_team` (`event_id`, `team_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_etl_joined_team` (`event_joined_team_id`),
  KEY `idx_etl_team` (`team_id`),
  CONSTRAINT `fk_etl_joined_team`
    FOREIGN KEY (`event_joined_team_id`) REFERENCES `event_joined_teams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_etl_event`
    FOREIGN KEY (`event_id`)             REFERENCES `team_events`(`id`)         ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_etl_team`
    FOREIGN KEY (`team_id`)              REFERENCES `teams`(`id`)               ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_etl_user`
    FOREIGN KEY (`user_id`)              REFERENCES `users`(`id`)               ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

> **Conformance changes / flags** (no renames): FKs + their backing indexes added; per-column `COLLATE` removed (table default applies); table-level engine/charset added. Production indexes `idx_event_team` + `idx_user_id` preserved.
> ⚠️ **Deferred FKs**: `team_member_id → team_members(id)` (table not yet documented) and `field_position_code → game_position_configs` (a code value — confirm whether it's an FK or a free string) are **not** constrained here; add once those parents are documented.

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment lineup-row id. |
| `event_joined_team_id` | BIGINT UNSIGNED FK | Owning participation row (`event_joined_teams.id`). **RESTRICT**. |
| `event_id` | BIGINT UNSIGNED FK | Denormalized event link (`team_events.id`). **RESTRICT**. |
| `team_id` | BIGINT UNSIGNED FK | Team (`teams.id`). **RESTRICT**. |
| `team_member_id` | BIGINT UNSIGNED NULL | Team-roster member (`team_members.id` — deferred FK). |
| `user_id` | BIGINT UNSIGNED NULL FK | Linked user account (`users.id`). **SET NULL**. |
| `player_name` | VARCHAR(150) | Display name (manual or snapshotted). |
| `batting_order` | TINYINT UNSIGNED NULL | 1-based batting slot. |
| `field_position_code` | VARCHAR(20) NULL | Position code (e.g. `"P"`, `"SS"`). |
| `is_starter` / `is_bench` / `is_active` | TINYINT(1) | Lineup placement flags. |
| `jersey_number` | VARCHAR(20) NULL | Jersey number (string — leading zeros / non-numeric allowed). |
| `lineup_status` | TINYINT UNSIGNED (def 0) | `0=draft`, `1=submitted`, `2=approved`, `3=inactive`. |
| `player_source_type` | TINYINT UNSIGNED (def 0) | `0=manual`, `1=team_member`, `2=invited_member`, `3=association_entered`. |
| `submitted_at` / `approved_at` | DATETIME NULL | Lifecycle stamps. |
| `notes` | VARCHAR(500) NULL | Free-text note. |
| `created_at` / `updated_at` / `deleted_at` | TIMESTAMP NULL | Standard timestamps + soft-delete. |

#### Relations

- Parents: `event_joined_teams.id`, `team_events.id`, `teams.id`, `users.id`. Deferred: `team_members.id`.
- No children.

---

### `event_followers`

#### Purpose

Users following an event (for notifications / "my events"). One row per `(user, event)`.

#### CREATE script (target end-state)

```sql
CREATE TABLE `event_followers` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,   -- widened: was bigint (signed)
  `event_id`   BIGINT UNSIGNED DEFAULT NULL,              -- widened: was bigint (signed)
  `user_id`    BIGINT UNSIGNED DEFAULT NULL,              -- widened: was bigint (signed)
  `created_at` TIMESTAMP NULL DEFAULT NULL,
  `updated_at` TIMESTAMP NULL DEFAULT NULL,
  `deleted_at` TIMESTAMP NULL DEFAULT NULL,
  `deleted_by` BIGINT UNSIGNED NULL DEFAULT NULL,         -- FIXED: was mistyped `timestamp` in production
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_user_event` (`user_id`, `event_id`),
  KEY `idx_event_followers_event` (`event_id`),
  KEY `idx_event_followers_deleted_by` (`deleted_by`),
  CONSTRAINT `fk_event_followers_event`
    FOREIGN KEY (`event_id`)   REFERENCES `team_events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_event_followers_user`
    FOREIGN KEY (`user_id`)    REFERENCES `users`(`id`)       ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT `fk_event_followers_deleted_by`
    FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`)       ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

> **Discrepancies fixed / flagged** (no renames):
> - ⚠️ **`deleted_by` was typed `timestamp` in production — almost certainly a bug.** A `*_by` column is an actor reference, so it's retyped to `BIGINT UNSIGNED` with an FK to `users.id` (SET NULL), per the Conventions audit-by rule. Confirm before migrating (a column-type `MODIFY` is lossy if real timestamp data was ever written there).
> - `id` / `event_id` / `user_id` widened `bigint (signed) → BIGINT UNSIGNED`.
> - FKs + indexes added; table-level engine/charset added.
> - `user_id` FK uses **CASCADE** (a follow has no meaning without its user); `event_id` uses **RESTRICT** (events soft-delete). `event_id` / `user_id` kept **nullable** as provided — consider `NOT NULL` since the `uniq_user_event` key and the concept both assume both are present.

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment row id. Widened from signed `bigint`. |
| `event_id` | BIGINT UNSIGNED NULL FK | Followed event (`team_events.id`). **RESTRICT**. |
| `user_id` | BIGINT UNSIGNED NULL FK | Following user (`users.id`). **CASCADE**. |
| `created_at` / `updated_at` / `deleted_at` | TIMESTAMP NULL | Standard timestamps + soft-delete. |
| `deleted_by` | BIGINT UNSIGNED NULL FK | Actor who soft-deleted the follow (`users.id`). **SET NULL**. **Retyped from `timestamp`** (production bug). |

#### Relations

- Parents: `team_events.id`, `users.id`.
- No children.
