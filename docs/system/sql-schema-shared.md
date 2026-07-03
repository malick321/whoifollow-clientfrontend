---
status: Draft
owner: shared
last_updated: 2026-06-15
---

# SQL Schema — Shared & Catalogue Tables

Domain-split slice of the WhoIFollow schema. **Shared conventions** — engine/charset/collation, primary keys, foreign-key rules, standard audit columns (`created_at`/`updated_at`/`deleted_at`/`created_by`/`updated_by`/`deleted_by`), UTC timestamp handling, soft-delete, and naming — live in [`sql-schema.md`](./sql-schema.md) and apply to every table here.

This doc holds cross-domain master/catalogue tables referenced by multiple domains — the parks master (`game_parts`, `park_fields`), the polymorphic `invites` table, and the sport/seeding/position catalogues.

## Tables in this doc

- [`game_parts`](#game_parts)
- [`park_fields`](#park_fields)
- [`invites`](#invites)
- [`mediums`](#mediums)
- [`team_sport_types`](#team_sport_types)
- [`sport_type_field_configurations`](#sport_type_field_configurations)
- [`sports_type_umpire_configs`](#sports_type_umpire_configs)
- [`custom_field_definitions`](#custom_field_definitions)
- [`custom_field_values`](#custom_field_values)

## Planned (not yet documented)

- `age_groups` — age-group catalogue.
- `sport_result_codes` — per-sport result-code catalogue.
- `game_position_config_types` — position-config type catalogue.
- `game_position_configs` — position-config catalogue.
- `seeding_criteria` — seeding-criteria catalogue (FK parent of `event_seed_criteria` / `tournament_seed_criteria`).

---

### `game_parts`

#### Purpose

Master catalogue of every physical park (venue) in the WIF system. Referenced by every event that uses a venue (via `event_playing_facilities`) and by every field at that venue (via `park_fields`).

The table name is intentionally retained ("game parts" is misleading — it's the parks master). Legacy callers across the codebase reference this name, so renaming would cascade through dozens of touch-points with no behavioural gain. Treat as canonical going forward.

#### CREATE script

```sql
CREATE TABLE `game_parts` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `park_name`  VARCHAR(255)  NOT NULL,
  `status`     INT           DEFAULT NULL,
  `lat`        VARCHAR(191)  DEFAULT NULL,
  `lng`        VARCHAR(191)  DEFAULT NULL,
  `address`    LONGTEXT          DEFAULT NULL,
  `city`       VARCHAR(255)  DEFAULT NULL,
  `state`      VARCHAR(255)  DEFAULT NULL,
  `zip_code`   VARCHAR(255)  DEFAULT NULL,
  `number`     VARCHAR(191)  DEFAULT NULL,
  `created_at` TIMESTAMP     NULL DEFAULT NULL,
  `updated_at` TIMESTAMP     NULL DEFAULT NULL,
  `deleted_at` TIMESTAMP     NULL DEFAULT NULL,
  `startDate`  VARCHAR(255)  DEFAULT NULL, -- legacy, not used by v2
  `endDate`    VARCHAR(255)  DEFAULT NULL, -- legacy, not used by v2
  `startTime`  VARCHAR(255)  DEFAULT NULL, -- legacy, not used by v2
  `endTime`    VARCHAR(255)  DEFAULT NULL, -- legacy, not used by v2
  `time_slot`  VARCHAR(45)   DEFAULT NULL, -- legacy, not used by v2
  `time_zone`  VARCHAR(45)   DEFAULT NULL, -- DEAD COLUMN — do not read or write
  PRIMARY KEY (`id`),
  KEY `idx_game_parts_status_deleted` (`status`, `deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment park identifier. |
| `park_name` | VARCHAR(255) | Display name of the venue. |
| `status` | INT | `0 = inactive`, `1 = active`. Independent of `deleted_at` — both `status = 0` and `deleted_at NOT NULL` hide the row from active reads. |
| `lat` | VARCHAR(191) NULL | Latitude in decimal degrees, stored stringified to preserve full precision. NULL when geocode is unknown. |
| `lng` | VARCHAR(191) NULL | Longitude (same convention as `lat`). |
| `address` | LONGTEXT NULL | Single-line street address. |
| `city` | VARCHAR(255) NULL | |
| `state` | VARCHAR(255) NULL | US state code or full name as stored upstream. |
| `zip_code` | VARCHAR(255) NULL | |
| `number` | VARCHAR(191) NULL | Free-form venue contact number or admin-defined park number. |
| `startDate`, `endDate`, `startTime`, `endTime`, `time_slot` | VARCHAR | **Legacy fields** from a pre-event-scoped scheduling model. Replaced by `park_scheduling_windows` (per-event-per-day windows). Not read or written by any v2 endpoint. Kept in place because legacy v1 callers still reference them; v2 ignores. |
| `time_zone` | VARCHAR(45) NULL | **DEAD COLUMN** — do not read, do not write, do not reference in queries. Per-event timezone lives on `team_events.time_zone`. |
| `created_at` / `updated_at` / `deleted_at` | TIMESTAMP NULL | Standard timestamps. No audit-by columns on this table (legacy). |

#### Indexes

- `idx_game_parts_status_deleted (status, deleted_at)` — supports "list all active parks" admin lookups. PK serves point reads.

#### Relations

- Children: `park_fields.park_id`, `event_playing_facilities.park_id`, `park_scheduling_windows.park_id`.
- No parent FK — this is a master catalogue.

---

### `park_fields`

#### Purpose

Master catalogue of fields at each park. One row per field per park. Static identity — the "Field 1, Field 2, …" set at a park rarely changes year-over-year. Event-scoped selection of *which* fields are used for a given event lives in `event_field_selections`.

#### CREATE script

```sql
CREATE TABLE `park_fields` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `park_id`           BIGINT UNSIGNED NOT NULL,
  `field_name`        VARCHAR(255)   DEFAULT NULL,
  `file_name`         VARCHAR(250)   DEFAULT NULL,
  `stream_content_id` VARCHAR(1000)  DEFAULT NULL,
  `status`            INT            DEFAULT NULL,
  `created_at`        TIMESTAMP      NULL DEFAULT NULL,
  `updated_at`        TIMESTAMP      NULL DEFAULT NULL,
  `deleted_at`        TIMESTAMP      NULL DEFAULT NULL,
  `is_selected`       TINYINT        DEFAULT '1', -- DEPRECATED — do not query
  PRIMARY KEY (`id`),
  KEY `idx_park_fields_park_deleted` (`park_id`, `deleted_at`),
  CONSTRAINT `fk_park_fields_park`
    FOREIGN KEY (`park_id`) REFERENCES `game_parts`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment field identifier. |
| `park_id` | BIGINT UNSIGNED FK | Parent park. RESTRICT — fields can't outlive their park. Widened from `INT UNSIGNED` to align with `game_parts.id`. |
| `field_name` | VARCHAR(255) NULL | Display name (e.g. "Field 1", "Diamond A"). |
| `file_name` | VARCHAR(250) NULL | Asset reference for any park diagram / overlay image. |
| `stream_content_id` | VARCHAR(1000) NULL | Live-stream content id for the field (legacy integration). |
| `status` | INT | `0 = inactive`, `1 = active`. |
| `is_selected` | TINYINT | **DEPRECATED — DO NOT QUERY.** Pre-event-scoped selection flag. Event-scoped selection now lives on `event_field_selections.is_selected`. This column is kept only for legacy v1 reads; v2 endpoints ignore it. |
| Standard timestamps | TIMESTAMP NULL | No audit-by columns on this table (legacy). |

#### Indexes

- `idx_park_fields_park_deleted (park_id, deleted_at)` — supports "all live fields at park" lookups (no event scope). FK auto-index on `park_id` is replaced/covered by this composite.

#### Relations

- Parent: `game_parts.id`.
- Children: `event_field_selections.park_field_id`.

---

### `invites`

#### Purpose

Polymorphic invitations table. Holds the live + recently-terminal state of every invite across the platform. Each row carries enough info to identify the recipient (who may not yet be a user), the scoping FKs for the invite type, and the metadata snapshot needed to actually grant access on accept.

**Invite types** (`invite_type` enum):
- `association_user` — admin invites someone to join the association with admin permissions.
- `team_member` — admin invites someone to join a team's roster.
- `platform_signup` — top-of-funnel signup invitation (referral / marketing).

**Important constraint** (per the strategy's "association is the gateway" rule):
- Event-side actors (event officials) are **NOT** invited via this table independently. An event official is always already an `association_users` row; the event-side workflow picks from the existing association users list rather than sending a fresh invite.

**Lifecycle is paired with `association_users`** — every `association_user` invite creates a paired row in both `invites` and `association_users` so the user-list query stays single-table. See [`association_users`](./sql-schema-association.md#association_users) Lifecycle for the full state machine.

**Cancellation is non-destructive** at the invite-row level: the row stays for a 90-day retention window with `status='cancelled'` so support can answer "did Jane get invited last month?" Then the cleanup cron purges it. The matching `association_users` row, however, IS hard-deleted on cancel (or soft-deleted via `deleted_at` if the team prefers an audit trail).

#### CREATE script

```sql
CREATE TABLE `invites` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

  -- Lookup token (the URL the recipient clicks)
  `token`           CHAR(64) NOT NULL,

  -- Type discriminator
  `invite_type`     ENUM('association_user', 'team_member', 'platform_signup') NOT NULL,

  -- Recipient identifying info (captured at invite send time)
  `target_type`     ENUM('email', 'phone') NOT NULL,
  `target_value`    VARCHAR(190) NOT NULL,
  `first_name`      VARCHAR(120) NULL DEFAULT NULL,
  `last_name`       VARCHAR(120) NULL DEFAULT NULL,

  -- Existing-user link (if recipient already has a users row at invite time)
  `user_id`         BIGINT UNSIGNED NULL DEFAULT NULL,

  -- Scoping FKs (presence depends on invite_type — both NULL for platform_signup)
  `association_id`  BIGINT UNSIGNED NULL DEFAULT NULL,
  `team_id`         BIGINT UNSIGNED NULL DEFAULT NULL,

  -- Who sent the invite
  `inviter_user_id` BIGINT UNSIGNED NULL DEFAULT NULL,

  -- Type-specific extras (see "Metadata shapes" below)
  `metadata_json`   JSON NULL DEFAULT NULL,

  -- State machine. All terminal states persist briefly so the membership row's
  -- invite_id FK stays live during the post-accept retention window. Cleanup cron
  -- hard-deletes per-state windows: accepted=30d, cancelled=90d, expired=90d.
  `status`          ENUM('pending', 'accepted', 'cancelled', 'expired') NOT NULL DEFAULT 'pending',
  `sent_at`         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at`      TIMESTAMP NOT NULL,

  -- Standard audit
  `created_at`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`      TIMESTAMP NULL DEFAULT NULL,
  `created_by`      BIGINT UNSIGNED NULL DEFAULT NULL,
  `updated_by`      BIGINT UNSIGNED NULL DEFAULT NULL,
  `deleted_by`      BIGINT UNSIGNED NULL DEFAULT NULL,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_invites_token` (`token`),
  KEY `idx_invites_target` (`target_type`, `target_value`),
  KEY `idx_invites_type_status` (`invite_type`, `status`),
  KEY `idx_invites_user_id` (`user_id`),
  KEY `idx_invites_association_status` (`association_id`, `status`),
  KEY `idx_invites_team_status` (`team_id`, `status`),
  KEY `idx_invites_inviter` (`inviter_user_id`),
  KEY `idx_invites_status_expires` (`status`, `expires_at`),
  KEY `idx_invites_deleted_at` (`deleted_at`),
  KEY `idx_invites_created_by` (`created_by`),
  KEY `idx_invites_updated_by` (`updated_by`),
  KEY `idx_invites_deleted_by` (`deleted_by`),

  CONSTRAINT `fk_invites_user`         FOREIGN KEY (`user_id`)         REFERENCES `users`(`id`)        ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_invites_association`  FOREIGN KEY (`association_id`)  REFERENCES `associations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_invites_team`         FOREIGN KEY (`team_id`)         REFERENCES `teams`(`id`)        ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_invites_inviter`      FOREIGN KEY (`inviter_user_id`) REFERENCES `users`(`id`)        ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_invites_created_by`   FOREIGN KEY (`created_by`)      REFERENCES `users`(`id`)        ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_invites_updated_by`   FOREIGN KEY (`updated_by`)      REFERENCES `users`(`id`)        ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_invites_deleted_by`   FOREIGN KEY (`deleted_by`)      REFERENCES `users`(`id`)        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment invite identifier. Referenced by `association_users.invite_id` (and future `team_members.invite_id`). |
| `token` | CHAR(64) | Cryptographically random URL-safe token the recipient clicks. Globally unique. |
| `invite_type` | ENUM | What kind of invite this is — discriminates which destination table the accept flow inserts into. |
| `target_type` | ENUM | `'email'` or `'phone'` — discriminates how `target_value` is interpreted. |
| `target_value` | VARCHAR(190) | The actual email or phone number invitation was sent to. Captured at invite-send time so it survives independent of any later changes to the user's record. |
| `first_name`, `last_name` | VARCHAR(120) NULL | Recipient name as captured by the inviting admin (display-only fallback before the recipient signs up and provides their real name). |
| `user_id` | BIGINT UNSIGNED NULL FK | Pre-resolved link to existing `users.id` if the target email/phone already matched a user at invite-send time. NULL otherwise — populated post-accept via `association_users.user_id` instead. SET NULL if the user is hard-deleted. |
| `association_id` | BIGINT UNSIGNED NULL FK | Scoping FK for `association_user` and `team_member` invites that flow through an association. NULL for `platform_signup`. **RESTRICT** on delete — an association with active invites can't be hard-deleted. |
| `team_id` | BIGINT UNSIGNED NULL FK | Scoping FK for `team_member` invites. NULL otherwise. **RESTRICT** on delete — a team with active invites can't be hard-deleted. |
| `inviter_user_id` | BIGINT UNSIGNED NULL FK | Admin who sent the invite. NULL when system-generated. SET NULL on user delete. |
| `metadata_json` | JSON NULL | Type-specific extras (see "Metadata shapes" below). Schemaless — application enforces shape. |
| `status` | ENUM | `pending` → `accepted` (success), or `pending` → `cancelled` (admin cancelled), or `pending` → `expired` (TTL hit by cron). All terminal states persist briefly per their retention window before the cleanup cron hard-deletes them. |
| `sent_at` | TIMESTAMP | When the invite email/SMS was most recently dispatched. Updated on resend. |
| `expires_at` | TIMESTAMP | When the token stops being acceptable. The hourly auto-expire cron flips pending rows past this to `'expired'`. |
| Standard audit columns | (see Conventions) | created_at / updated_at / deleted_at + created_by / updated_by / deleted_by. |

#### Metadata shapes (per `invite_type`)

The application enforces these on write; the DB just stores JSON.

##### `invite_type = 'association_user'`

```json
{
  "permissions": ["manage_events", "manage_teams"],
  "full_control": false
}
```

On accept, `association_users.permissions_json` is seeded from these values.

##### `invite_type = 'team_member'`

`team_id` is a top-level column (FK-enforced, indexable). The metadata holds display snapshots + recipient-specific extras:

```json
{
  "team_name": "Eagles 50+",
  "team_avatar_url": "https://cdn/.../eagles.png",
  "jersey_number": "12",
  "position": "P"
}
```

Snapshots of team identity at invite-send time so the email + accept page stay consistent if the team renames before the recipient clicks. On accept, the app inserts a `team_members` row keyed off the column-level `team_id`, copies `jersey_number` + `position` if applicable.

##### `invite_type = 'platform_signup'`

```json
{
  "referral_source": "google_ads",
  "campaign_id": "summer_2026"
}
```

Free-form marketing / attribution tracking. App-side validation only.

#### Retention cleanup cron

Daily job purges terminal invites past their per-state window:

```sql
DELETE FROM invites WHERE status = 'accepted'  AND updated_at < NOW() - INTERVAL 30 DAY;
DELETE FROM invites WHERE status = 'cancelled' AND updated_at < NOW() - INTERVAL 90 DAY;
DELETE FROM invites WHERE status = 'expired'   AND updated_at < NOW() - INTERVAL 90 DAY;
```

When a row is deleted, FK SET NULL fires on every `association_users.invite_id` (and future `team_members.invite_id`) that pointed at it — the membership row survives, just loses its now-stale invite reference. Durable history (who/when/permissions) lives on the membership row via columns set at invite-send and accept time.

#### Indexes

- `uk_invites_token` — primary read path: every accept-link click is a token lookup.
- `idx_invites_target` — supports "find existing invite for this email/phone" before sending a new one (dedup check).
- `idx_invites_type_status` — supports admin dashboards counting outstanding invites per type.
- `idx_invites_user_id` — supports "list every invite ever sent to this user" for support queries.
- `idx_invites_association_status` — supports per-association invite filtering (e.g. dashboard widgets).
- `idx_invites_team_status` — supports per-team invite filtering (roster page).
- `idx_invites_inviter` — supports per-admin activity reports ("how many invites has admin Jane sent?").
- `idx_invites_status_expires` — supports the hourly auto-expire cron.

---

### `mediums`

#### Purpose

Catalogue of **online-event mediums** (e.g. "Zoom", "YouTube Live", "Google Meet", "Teams"). Referenced by an event when `team_events.location_type = 'online'`: the event stores `medium_id` (FK here) plus a denormalized `medium` name snapshot so reads don't re-join. Fetched by the Add/Edit Event wizard's Online location step (shared-services "Get Mediums" endpoint).

#### CREATE script (target end-state)

```sql
CREATE TABLE `mediums` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`       VARCHAR(255) NOT NULL,
  `status`     INT          DEFAULT NULL,
  `created_at` TIMESTAMP    NULL DEFAULT NULL,
  `updated_at` TIMESTAMP    NULL DEFAULT NULL,
  `deleted_at` TIMESTAMP    NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_mediums_status_deleted` (`status`, `deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

> **Conformance** (no renames): only the `idx_mediums_status_deleted` index + table-level engine/charset are added; the per-column `CHARACTER SET`/`COLLATE` on `name` is dropped (table default applies). Columns are unchanged. Small catalogue — no pagination.

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment medium id. FK target for `team_events.medium_id`. |
| `name` | VARCHAR(255) NOT NULL | Display name (e.g. "Zoom", "YouTube Live"). |
| `status` | INT NULL | `1` = active, `0` = inactive. Active-only filter on the lookup endpoint. |
| `created_at`, `updated_at`, `deleted_at` | TIMESTAMP NULL | Standard timestamps + soft-delete. No audit-by columns (lightweight catalogue). |

#### Indexes

- `idx_mediums_status_deleted (status, deleted_at)` — supports the "list active mediums" lookup.

#### Relations

- Children: `team_events.medium_id` (online events). No parent FK — master catalogue.

---

### `team_sport_types`

#### Purpose

Master catalogue of every **sport type** in the WIF system (e.g. "Softball - Slow Pitch", "Baseball"). The canonical sport-type list the Add/Edit Event wizard picks from, and the parent of both the per-sport field-config link table ([`sport_type_field_configurations`](#sport_type_field_configurations)) and the per-sport umpire role configs ([`sports_type_umpire_configs`](#sports_type_umpire_configs)).

#### CREATE script

```sql
CREATE TABLE `team_sport_types` (
  `id`                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`                    VARCHAR(255)    DEFAULT NULL,
  `field_configuration_id`  VARCHAR(120)    DEFAULT NULL, -- LEGACY — comma-separated field-config id list (see Notes)
  `status`                  INT             DEFAULT NULL,
  `created_at`              TIMESTAMP       NULL DEFAULT NULL,
  `updated_at`              TIMESTAMP       NULL DEFAULT NULL,
  `deleted_at`              TIMESTAMP       NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_team_sport_types_status` (`status`),
  KEY `idx_team_sport_types_deleted_at` (`deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

> **Conformance** (no renames): only the two indexes + table-level engine/charset are added; the per-column `CHARACTER SET`/`COLLATE` on `name` / `field_configuration_id` is dropped (table default applies). Columns — including the legacy `field_configuration_id` — are unchanged.

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment sport-type id. FK target for `sport_type_field_configurations.sport_type_id` and `sports_type_umpire_configs.sports_type_id`. |
| `name` | VARCHAR(255) NULL | Display name (e.g. "Softball - Slow Pitch", "Baseball"). |
| `field_configuration_id` | VARCHAR(120) NULL | **LEGACY / DENORMALIZED.** Historically stored a **comma-separated list** of field-config ids supported by this sport type. That responsibility has shifted to the [`sport_type_field_configurations`](#sport_type_field_configurations) link table, which is the source of truth going forward. Retained for legacy v1 callers; do not treat as canonical. |
| `status` | INT NULL | `0 = inactive`, `1 = active`. |
| `created_at` / `updated_at` / `deleted_at` | TIMESTAMP NULL | Standard timestamps + soft-delete. No audit-by columns (lightweight catalogue). |

#### Indexes

- `idx_team_sport_types_status (status)` — supports the "list active sport types" lookup.
- `idx_team_sport_types_deleted_at (deleted_at)` — soft-delete filtering.

#### Relations

- Children: `sport_type_field_configurations.sport_type_id`, `sports_type_umpire_configs.sports_type_id`. No parent FK — master catalogue.

#### Notes

- The legacy `field_configuration_id` varchar is **not** an FK and is **not** the canonical sport↔field-config mapping. Use the [`sport_type_field_configurations`](#sport_type_field_configurations) join table for that.

---

### `sport_type_field_configurations`

#### Purpose

**M:N link table** between sport types and field configurations: which field configurations each sport type supports. This is the **canonical** source for the sport↔field-config relationship, superseding the legacy comma-separated `team_sport_types.field_configuration_id`. A "field configuration" is the catalogue entry currently modeled as `game_position_configs` (the same table `team_events.field_config_id` references — see [`sql-schema-event.md`](./sql-schema-event.md)).

#### CREATE script

```sql
CREATE TABLE `sport_type_field_configurations` (
  `id`                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `sport_type_id`           BIGINT UNSIGNED NOT NULL,
  `field_configuration_id`  BIGINT UNSIGNED NOT NULL, -- FK to game_position_configs(id) — DEFERRED (see below)
  `created_at`              TIMESTAMP       NULL DEFAULT NULL,
  `updated_at`              TIMESTAMP       NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_stfc_sport_field` (`sport_type_id`, `field_configuration_id`),
  KEY `idx_stfc_field_configuration` (`field_configuration_id`),
  CONSTRAINT `fk_stfc_sport_type`
    FOREIGN KEY (`sport_type_id`) REFERENCES `team_sport_types`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

> **Conformance changes \ flags** (no renames): the `sport_type_id` FK + its backing unique key, the `field_configuration_id` index, and table-level engine/charset are added. Column types are unchanged.
> ⚠️ **Deferred FK**: `field_configuration_id → game_position_configs(id)` is **not** constrained here — `game_position_configs` is not yet documented (it's in the "Planned" list, and referenced by `team_events.field_config_id` in [`sql-schema-event.md`](./sql-schema-event.md)). Add the live constraint once that parent is documented.

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment link-row id. |
| `sport_type_id` | BIGINT UNSIGNED FK | Parent sport type (`team_sport_types.id`). **CASCADE** — link rows die with their sport type. |
| `field_configuration_id` | BIGINT UNSIGNED | Field-config id — references `game_position_configs.id` (deferred FK; see above). |
| `created_at` / `updated_at` | TIMESTAMP NULL | Standard timestamps. No soft-delete / audit-by columns (pure link table). |

#### Indexes

- `uk_stfc_sport_field (sport_type_id, field_configuration_id)` — enforces one link per sport-type/field-config pair; also serves "field configs for this sport type" lookups.
- `idx_stfc_field_configuration (field_configuration_id)` — supports the reverse "sport types using this field config" lookup and backs the deferred FK.

#### Relations

- Parent: `team_sport_types.id` (live FK).
- Parent (deferred): `game_position_configs.id` via `field_configuration_id`.

---

### `sports_type_umpire_configs`

#### Purpose

Per-sport-type **umpire role configs** (e.g. `PLATE` / "Plate Umpire", `BASE` / "Base Umpire"). One row per umpire role a sport type defines, ordered by `sort_order`. Consumed wherever umpire roles are assigned/displayed for an event's sport type.

#### CREATE script

```sql
CREATE TABLE `sports_type_umpire_configs` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, -- widened from INT
  `sports_type_id` BIGINT UNSIGNED NOT NULL,                -- widened from BIGINT to match team_sport_types.id
  `code`           VARCHAR(255)    NOT NULL,
  `name`           VARCHAR(255)    NOT NULL,
  `sort_order`     INT             DEFAULT '0',
  `status`         INT             DEFAULT '1',
  `created_at`     TIMESTAMP       NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     TIMESTAMP       NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`     TIMESTAMP       NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_stuc_sport_code` (`sports_type_id`, `code`),
  KEY `idx_stuc_sports_type` (`sports_type_id`),
  KEY `idx_stuc_status` (`status`),
  KEY `idx_stuc_sort_order` (`sort_order`),
  KEY `idx_stuc_deleted_at` (`deleted_at`),
  CONSTRAINT `fk_stuc_sport_type`
    FOREIGN KEY (`sports_type_id`) REFERENCES `team_sport_types`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

> **Conformance changes \ flags** (no renames): `id` widened `INT → BIGINT UNSIGNED`; `sports_type_id` widened `BIGINT → BIGINT UNSIGNED` to align with `team_sport_types.id`; the `sports_type_id` FK + indexes (`sports_type_id`, `status`, `sort_order`, `deleted_at`) + unique key `(sports_type_id, code)` + table-level engine/charset are added. No new business columns introduced.

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment umpire-config id. Widened from `INT`. |
| `sports_type_id` | BIGINT UNSIGNED FK | Parent sport type (`team_sport_types.id`). **CASCADE** — config rows die with their sport type. Widened from `BIGINT` to align with `team_sport_types.id`. |
| `code` | VARCHAR(255) | Stable role code (e.g. `"PLATE"`, `"BASE"`). Unique per sport type. |
| `name` | VARCHAR(255) | Display label (e.g. `"Plate Umpire"`). |
| `sort_order` | INT | Display order within a sport type's umpire roles. Default `0`. |
| `status` | INT | `0 = inactive`, `1 = active`. Default `1`. |
| `created_at` / `updated_at` / `deleted_at` | TIMESTAMP NULL | Standard timestamps + soft-delete. No audit-by columns (lightweight catalogue). |

#### Indexes

- `uk_stuc_sport_code (sports_type_id, code)` — one config per role code per sport type.
- `idx_stuc_sports_type (sports_type_id)` — supports "umpire configs for this sport type" lookups.
- `idx_stuc_status (status)` — active-only filtering.
- `idx_stuc_sort_order (sort_order)` — ordered reads.
- `idx_stuc_deleted_at (deleted_at)` — soft-delete filtering.

#### Relations

- Parent: `team_sport_types.id` (live FK, CASCADE).

---

### `custom_field_definitions`

#### Purpose

Catalogue of **admin-defined custom fields** — the controls an association configures to render dynamically on entity forms (events, divisions, games, team/umpire/player registrations, products…). The *catalogue* half of a catalogue + per-entity-values pair, mirroring the [`seeding_criteria`](#planned-not-yet-documented) → `event_seed_criteria` pattern: this table says **what** custom fields exist (and how to render them), while [`custom_field_values`](#custom_field_values) holds the **chosen value** per entity.

**Entity-agnostic from day one.** A definition is polymorphic over the entity it attaches to via `entity_type` — a snake_case **string key** (`event`, `division`, `game`, `team`, `umpire`, `player`, `product`, …) from the [entity-type shared catalogue](./shared-catalogues.md#8-custom-field-entity-type-catalogue), stored verbatim in a `VARCHAR` column (no numeric code, no reference table). The same framework backs every form without per-entity tables, and a new surface is a catalogue/constant addition — no migration.

**Scope semantics** — a definition applies to an entity when **all** hold:
- `entity_type` matches the form being rendered (the entity-type catalogue key), **and**
- `sports_type_id IS NULL` (sport-agnostic) **OR** equals the entity's sport, **and**
- the definition belongs to the entity's owning association (association scoping **is** the `association_id` owner).

First seeded uses: an event **Classification** (`field_key = 'classification'`, single-select Qualifier / Championship, scoped to a softball `sports_type_id`) and an SSUSA **TOC** boolean flag (`field_key = 'toc'`, a definition owned by the SSUSA association).

#### CREATE script

```sql
CREATE TABLE `custom_field_definitions` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `association_id` BIGINT UNSIGNED NOT NULL,                 -- owning association
  `entity_type`    VARCHAR(32) NOT NULL COMMENT 'catalogue key: event|division|game|team|umpire|player|product|…',
  `field_key`      VARCHAR(120) NOT NULL,                    -- machine key, e.g. 'classification', 'toc'
  `label`          VARCHAR(255) NOT NULL,                    -- display label
  `input_type`     VARCHAR(32) NOT NULL COMMENT 'catalogue key: boolean|single_select|multi_select|number|text|date|textarea',
  `options_json`   JSON NULL,                                -- ["Qualifier","Championship"] for selects; NULL otherwise
  `sports_type_id` BIGINT UNSIGNED NULL,                     -- optional scope: applies only to this sport (NULL = all sports)
  `is_required`    TINYINT(1) NOT NULL DEFAULT 0,
  `sort_order`     INT NOT NULL DEFAULT 0,
  `status`         TINYINT NOT NULL DEFAULT 1,               -- 1=active, 0=inactive

  -- Standard audit
  `created_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`     TIMESTAMP NULL DEFAULT NULL,
  `created_by`     BIGINT UNSIGNED NULL DEFAULT NULL,
  `updated_by`     BIGINT UNSIGNED NULL DEFAULT NULL,
  `deleted_by`     BIGINT UNSIGNED NULL DEFAULT NULL,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_cfd_assoc_entity_key` (`association_id`, `entity_type`, `field_key`, `deleted_at`),
  KEY `idx_cfd_assoc_entity_status` (`association_id`, `entity_type`, `status`),
  KEY `idx_cfd_sports_type` (`sports_type_id`),
  KEY `idx_cfd_deleted_at` (`deleted_at`),
  KEY `idx_cfd_created_by` (`created_by`),
  KEY `idx_cfd_updated_by` (`updated_by`),
  KEY `idx_cfd_deleted_by` (`deleted_by`),

  CONSTRAINT `fk_cfd_association` FOREIGN KEY (`association_id`) REFERENCES `associations`(`id`)       ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT `fk_cfd_sports_type` FOREIGN KEY (`sports_type_id`) REFERENCES `team_sport_types`(`id`)   ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_cfd_created_by`  FOREIGN KEY (`created_by`)     REFERENCES `users`(`id`)              ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_cfd_updated_by`  FOREIGN KEY (`updated_by`)     REFERENCES `users`(`id`)              ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_cfd_deleted_by`  FOREIGN KEY (`deleted_by`)     REFERENCES `users`(`id`)              ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment definition id. FK target for `custom_field_values.definition_id`. |
| `association_id` | BIGINT UNSIGNED FK | Owning association — the scoping owner. **CASCADE** — definitions die with their association. |
| `entity_type` | VARCHAR(32) | Which entity surface this field attaches to — a string key from the [entity-type catalogue](../system/shared-catalogues.md#8-custom-field-entity-type-catalogue) (`event`, `division`, `game`, `team`, `umpire`, `player`, `product`, …). Stored verbatim. |
| `field_key` | VARCHAR(120) | Stable machine key (e.g. `"classification"`, `"toc"`). Unique per association + entity type (see unique key). |
| `label` | VARCHAR(255) | Display label rendered on the form (e.g. `"Classification"`, `"Tournament of Champions"`). |
| `input_type` | VARCHAR(32) | Control type the frontend maps to — a string key from the [input-type catalogue](../system/shared-catalogues.md#9-custom-field-input-type-catalogue) (`boolean`, `single_select`, `multi_select`, `number`, `text`, `date`, `textarea`). |
| `options_json` | JSON NULL | Option list for select types (e.g. `["Qualifier","Championship"]`); `NULL` for non-select types. |
| `sports_type_id` | BIGINT UNSIGNED NULL FK | Optional sport scope — when set, the definition applies only to that sport (`NULL` = all sports). SET NULL if the sport type is hard-deleted. |
| `is_required` | TINYINT(1) | `1` = the control must be answered before the form submits; `0` = optional. Default `0`. |
| `sort_order` | INT | Display order within an entity form's custom fields. Default `0`. |
| `status` | TINYINT | `1 = active`, `0 = inactive`. Inactive definitions are excluded from form rendering. Default `1`. |
| Standard audit columns | (see Conventions) | created_at / updated_at / deleted_at + created_by / updated_by / deleted_by. |

##### `entity_type` / `input_type` values

Both store a **string key**, not a numeric code — the canonical lists (key + display label) live in [`shared-catalogues.md`](../system/shared-catalogues.md) (§8 entity types, §9 input types) and are mirrored by the `CustomFieldEntityType` / `CustomFieldInputType` TS unions. `options_json` is required + non-empty only for the `single_select` / `multi_select` input types; `NULL` for the rest.

#### Indexes

- `uk_cfd_assoc_entity_key (association_id, entity_type, field_key, deleted_at)` — enforces one live `field_key` per association + entity type; `deleted_at` in the key allows re-creating a key after a soft delete (two soft-deleted rows differ by `deleted_at`).
- `idx_cfd_assoc_entity_status (association_id, entity_type, status)` — primary read path: "active definitions for this association + entity form" (the [`association-custom-fields-api-contract.md`](../api/association-custom-fields-api-contract.md) §1 fetch endpoint).
- `idx_cfd_sports_type (sports_type_id)` — backs the `sports_type_id` FK and the sport-scope resolution.
- `idx_cfd_deleted_at (deleted_at)` — soft-delete filtering.
- `idx_cfd_created_by` / `idx_cfd_updated_by` / `idx_cfd_deleted_by` — back the audit-by FKs.

#### Relations

- Parent: `associations.id` (live FK, CASCADE); `team_sport_types.id` (optional scope FK, SET NULL).
- Children: `custom_field_values.definition_id`.

#### Notes

- **Association scoping is the `association_id` owner** — e.g. the SSUSA TOC flag is simply a definition row owned by SSUSA. There is no separate per-association allow-list table.

---

### `custom_field_values`

#### Purpose

Per-entity **chosen values** for the custom fields defined in [`custom_field_definitions`](#custom_field_definitions) — the values half of the catalogue + values pair (mirrors `event_seed_criteria` against the `seeding_criteria` catalogue). One row per (definition, entity) holds the entity's answer for that field, reconciled in the same transaction as the entity write (insert / update / soft-delete to match the submitted set — same semantics as `seedCriteria` → `event_seed_criteria`).

#### CREATE script

```sql
CREATE TABLE `custom_field_values` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `definition_id` BIGINT UNSIGNED NOT NULL,
  `entity_type`   VARCHAR(32) NOT NULL,        -- mirrors the definition's entity_type key (denormalized for polymorphic lookup)
  `entity_id`     BIGINT UNSIGNED NOT NULL,    -- e.g. team_events.id when entity_type='event'
  `value`         TEXT NULL,                   -- boolean → "1"/"0"; single_select → option string; multi_select → JSON array; number/text → raw

  -- Standard audit
  `created_at`    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`    TIMESTAMP NULL DEFAULT NULL,
  `created_by`    BIGINT UNSIGNED NULL DEFAULT NULL,
  `updated_by`    BIGINT UNSIGNED NULL DEFAULT NULL,
  `deleted_by`    BIGINT UNSIGNED NULL DEFAULT NULL,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_cfv_definition_entity` (`definition_id`, `entity_type`, `entity_id`),
  KEY `idx_cfv_entity` (`entity_type`, `entity_id`),
  KEY `idx_cfv_deleted_at` (`deleted_at`),
  KEY `idx_cfv_created_by` (`created_by`),
  KEY `idx_cfv_updated_by` (`updated_by`),
  KEY `idx_cfv_deleted_by` (`deleted_by`),

  CONSTRAINT `fk_cfv_definition`  FOREIGN KEY (`definition_id`) REFERENCES `custom_field_definitions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_cfv_created_by`  FOREIGN KEY (`created_by`)    REFERENCES `users`(`id`)                    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_cfv_updated_by`  FOREIGN KEY (`updated_by`)    REFERENCES `users`(`id`)                    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_cfv_deleted_by`  FOREIGN KEY (`deleted_by`)    REFERENCES `users`(`id`)                    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

> ⚠️ **Deferred FK**: `entity_id` is **polymorphic** — the table it points at (`team_events`, `divisions`, `games`, a team / umpire / player registration row, a product, …) depends on the `entity_type` key — so it **cannot** carry a single hard FK. This is an intentional deferred / soft reference (mirrors the deferred-FK note style in [`sql-schema-event.md`](./sql-schema-event.md)); the application enforces that `entity_id` resolves against the table selected by `entity_type`. Only `definition_id` is FK-constrained.

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment value-row id. |
| `definition_id` | BIGINT UNSIGNED FK | Parent definition (`custom_field_definitions.id`). **RESTRICT** — a definition with stored values can't be hard-deleted (it must be *retired* via soft-delete instead; see the definitions table's Notes). Protects historical event/division/game data. |
| `entity_type` | VARCHAR(32) | Mirrors the definition's `entity_type` string key (e.g. `event`, `team`, `product`). Denormalized onto the value row so the polymorphic `(entity_type, entity_id)` lookup needs no join to the definition. |
| `entity_id` | BIGINT UNSIGNED | **Polymorphic** entity id — `team_events.id` when `entity_type='event'`, a division id for `division`, a game id for `game`, and so on per the entity-type catalogue. Soft reference (no hard FK; see above). |
| `value` | TEXT NULL | The stored answer, encoded per the definition's `input_type`: boolean → `"1"`/`"0"`; single_select → the option string; multi_select → a JSON-stringified array; number / text → the raw value. |
| Standard audit columns | (see Conventions) | created_at / updated_at / deleted_at + created_by / updated_by / deleted_by. |

#### Indexes

- `uk_cfv_definition_entity (definition_id, entity_type, entity_id)` — one value per definition per entity; also backs the upsert during reconciliation.
- `idx_cfv_entity (entity_type, entity_id)` — primary read path: "all custom values for this entity" (e.g. prefilling the Edit Event form).
- `idx_cfv_deleted_at (deleted_at)` — soft-delete filtering.
- `idx_cfv_created_by` / `idx_cfv_updated_by` / `idx_cfv_deleted_by` — back the audit-by FKs.

#### Relations

- Parent: `custom_field_definitions.id` (live FK, **RESTRICT** — see below).
- Parent (deferred / polymorphic): the table named by `entity_type` (`team_events` / `divisions` / `games` / registration / product / …) via `(entity_type, entity_id)` — soft reference, no hard FK. When an entity is (soft-)deleted, the app soft-deletes its value rows (no cascade — polymorphic).

> **Delete rule.** `fk_cfv_definition` is `ON DELETE RESTRICT`: a definition that has any value rows **cannot be hard-deleted** (the DB rejects it), so an in-use field can never silently drop event/division/game data. To remove an in-use field, **retire it** — soft-delete the definition (set `deleted_at`, or `status = 0` to merely hide) — which keeps the row + its values so historical reads still resolve the label, while it stops rendering on forms. Hard delete is only valid when the definition has **zero** values. Mirrors how the app already retires rather than destroys other in-use catalogue rows.
