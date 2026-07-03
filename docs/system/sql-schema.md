---
status: Draft
owner: shared
last_updated: 2026-06-15
scope: Local-only — not yet shipped upstream
---

# SQL Schema — WhoIFollow System

Canonical MySQL schema for the entire WhoIFollow platform. This file is the **index + conventions hub**; the table definitions live in **per-domain documents** (see the index below). Every table — in every domain doc — follows the conventions in the [Conventions](#conventions) section here.

> **Why split by domain.** The schema outgrew a single file (26+ tables). Tables are now grouped by domain so each doc stays focused and editable, and **referenced by table name** (stable anchors like `#park_fields`) rather than by section number — so adding or reordering a table never breaks cross-references again.

> **About `invites`**: the `invites` table (in [`sql-schema-shared.md`](./sql-schema-shared.md#invites)) is the new canonical design that replaces the messy production schema (mixed types, no indexes, no FKs, ad-hoc varchar columns). The current production schema and the migration steps from old → new are tracked in the corresponding plan file (`humming-drifting-russell.md`).

---

## Domain index

Conventions (this doc) apply to all of these. Each doc carries its own "Planned (not yet documented)" list for tables still to be added.

### [`sql-schema-identity.md`](./sql-schema-identity.md) — Identity
- [`users`](./sql-schema-identity.md#users)

### [`sql-schema-association.md`](./sql-schema-association.md) — Association
- [`associations`](./sql-schema-association.md#associations)
- [`association_users`](./sql-schema-association.md#association_users)
- [`association_teams`](./sql-schema-association.md#association_teams)
- [`association_team_lifecycle`](./sql-schema-association.md#association_team_lifecycle)
- [`association_followers`](./sql-schema-association.md#association_followers)
- [`stripe_connected_accounts`](./sql-schema-association.md#stripe_connected_accounts)
- [`stripe_webhook_events`](./sql-schema-association.md#stripe_webhook_events)

### [`sql-schema-event.md`](./sql-schema-event.md) — Event
- [`team_events`](./sql-schema-event.md#team_events)
- [`event_officials`](./sql-schema-event.md#event_officials)
- [`event_seed_criteria`](./sql-schema-event.md#event_seed_criteria)
- [`event_playing_facilities`](./sql-schema-event.md#event_playing_facilities)
- [`event_field_selections`](./sql-schema-event.md#event_field_selections)
- [`park_scheduling_windows`](./sql-schema-event.md#park_scheduling_windows)
- [`event_hotels`](./sql-schema-event.md#event_hotels)
- [`event_sponsors`](./sql-schema-event.md#event_sponsors)
- [`event_umpires`](./sql-schema-event.md#event_umpires)
- [`event_joined_teams`](./sql-schema-event.md#event_joined_teams)
- [`event_team_lineup`](./sql-schema-event.md#event_team_lineup)
- [`event_followers`](./sql-schema-event.md#event_followers)

### [`sql-schema-tournament.md`](./sql-schema-tournament.md) — Tournament & Games
- [`event_tournaments`](./sql-schema-tournament.md#event_tournaments)
- [`tournament_games`](./sql-schema-tournament.md#tournament_games)
- [`tournament_game_scores`](./sql-schema-tournament.md#tournament_game_scores)
- [`tournament_game_innings`](./sql-schema-tournament.md#tournament_game_innings)
- [`tournament_brackets`](./sql-schema-tournament.md#tournament_brackets)
- [`tournament_bracket_teams`](./sql-schema-tournament.md#tournament_bracket_teams)
- [`tournament_game_delayed`](./sql-schema-tournament.md#tournament_game_delayed)
- [`tournament_pools`](./sql-schema-tournament.md#tournament_pools)
- [`tournament_seed_criteria`](./sql-schema-tournament.md#tournament_seed_criteria)
- [`tournament_teams`](./sql-schema-tournament.md#tournament_teams)

### [`sql-schema-shared.md`](./sql-schema-shared.md) — Shared & Catalogue
- [`game_parts`](./sql-schema-shared.md#game_parts)
- [`park_fields`](./sql-schema-shared.md#park_fields)
- [`invites`](./sql-schema-shared.md#invites)
- [`mediums`](./sql-schema-shared.md#mediums)

### [`sql-schema-notifications.md`](./sql-schema-notifications.md) — Notifications
- [`team_notifications` + `team_notification_recipients`](./sql-schema-notifications.md#team_notifications--team_notification_recipients)

---

## Conventions

These rules apply to **every** table in the system. Each per-table CREATE script repeats the column definitions for paste-ability, but the rationale lives once here so we can change conventions globally without re-explaining per table.

### Engine, charset, collation

- `ENGINE=InnoDB` everywhere — for transactions, FK enforcement, row-level locking.
- `DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci` — set **only at the table level**. Full Unicode (emoji-safe), case-insensitive accent-aware collation; matches production.
- **Never specify `CHARACTER SET` or `COLLATE` on individual columns.** All string columns inherit from the table default. Per-column overrides cause silent JOIN slowness when columns with mismatched collations are compared, and they accumulate as drift over time. If a table needs a different default collation, change it once at the table level.
- The deprecated `utf8mb3` family must not appear anywhere — it loses 4-byte Unicode (emoji, some CJK) and is removed in future MySQL versions.

### Primary keys

- Every table has a single `id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY` unless explicitly noted.
- IDs are surfaced to the API as **strings** (the wire format is opaque about underlying type) — frontend types treat IDs as `string` to dodge JS number-precision issues for very large IDs.

### Foreign keys

- Every FK column is named `<parent_singular>_id` (e.g. `association_id`, `user_id`).
- Every FK is `BIGINT UNSIGNED` matching the parent's `id` type.
- Every FK column gets its own index (MySQL FKs require it; we name them `idx_<table>_<column>`).
- `ON DELETE` rules:
  - **CASCADE** when the child row has no value without the parent (e.g. `association_team_lifecycle.association_team_id` — if a team registration is hard-deleted, its audit history is meaningless and goes with it). Use sparingly; only for genuinely owned hierarchies.
  - **SET NULL** in two specific cases:
    - **Always** for the audit-by columns (`created_by`, `updated_by`, `deleted_by`). This is non-negotiable — keep the row, drop the actor reference. Never block a user delete just because they once touched a record. The `created_at` / `updated_at` / `deleted_at` timestamps still preserve the *when*; we accept losing the *who*.
    - For non-audit references where the child stands alone (e.g. `association_team_lifecycle.actor_user_id`, `association_teams.manager_user_id`).
  - **RESTRICT** when the parent must never be hard-deleted while children exist. Specifically:
    - **Every direct child FK into `associations`** uses RESTRICT. Associations carry business-critical history (memberships, team registrations, lifecycle audit, future payments). Hard-deleting an association must require explicit cleanup OR a soft-delete (`deleted_at` flip), never a silent cascade. This applies to `association_users.association_id`, `association_teams.association_id`, and every future `*.association_id`.
    - Other regulated / financial FKs (e.g. future `payment_orders.user_id`) follow the same logic — covered in their respective table docs.
- `ON UPDATE CASCADE` everywhere — IDs don't change, but the rule is harmless and future-proof.

### Indexes

- **Every FK is indexed.** Required by MySQL's FK enforcement; covered by the FK constraint's auto-index.
- **Every status / filter column on a list endpoint is indexed**, usually as a composite index with the scoping FK first (e.g. `(association_id, status)` — supports the users-list status filter).
- **Every multi-column filter combo** the UI exposes gets a composite covering index (e.g. `(association_id, age_group, rating)` for the teams list's filter dropdown).
- **Every unique business identifier** gets a `UNIQUE KEY` (e.g. `users.email`, `associations.username`, `association_teams.system_reg_no`).
- Index naming: `idx_<table>_<columns>` for non-unique, `uk_<table>_<columns>` for unique.

### Standard columns (every table includes these)

```sql
`created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
`updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
`deleted_at` TIMESTAMP NULL DEFAULT NULL,
`created_by` BIGINT UNSIGNED NULL DEFAULT NULL,
`updated_by` BIGINT UNSIGNED NULL DEFAULT NULL,
`deleted_by` BIGINT UNSIGNED NULL DEFAULT NULL,
```

Plus matching constraints + indexes:

```sql
KEY `idx_<table>_deleted_at` (`deleted_at`),
KEY `idx_<table>_created_by` (`created_by`),
KEY `idx_<table>_updated_by` (`updated_by`),
KEY `idx_<table>_deleted_by` (`deleted_by`),
CONSTRAINT `fk_<table>_created_by` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
CONSTRAINT `fk_<table>_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
CONSTRAINT `fk_<table>_deleted_by` FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
```

| Column | Purpose |
|---|---|
| `created_at` | When the row was first inserted. Server clock, UTC. |
| `updated_at` | Auto-bumped on any row update. UTC. |
| `deleted_at` | Soft-delete marker. NULL = active row. Soft-delete is the default; hard-delete only for system-pruning jobs. |
| `created_by` | `users.id` of the actor who inserted the row. NULL only for system-seeded rows (e.g. the very first admin user). |
| `updated_by` | `users.id` of the actor who most recently updated the row. NULL = never updated by a user (just system-touched). |
| `deleted_by` | `users.id` of the actor who soft-deleted the row. Set in the same transaction as `deleted_at`. |

The `users` table itself uses NULL self-references for the audit-by columns on the bootstrap admin row (chicken-and-egg).

### UTC timestamps

- **All timestamps stored in UTC.** MySQL's `TIMESTAMP` type implicitly converts session-local writes to UTC internally — but we still set `time_zone = '+00:00'` at the connection level to make the conversion explicit and avoid DST surprises.
- `DATE` columns (e.g. `valid_until`) hold a logical date, not a moment in time — no TZ conversion applies.
- Sub-second precision: use `TIMESTAMP(3)` (millisecond) where ordering of consecutive same-second rows matters (e.g. audit logs). Default `TIMESTAMP` (second precision) is fine elsewhere.
- API responses serialize timestamps as ISO 8601 with the `Z` suffix (`"2026-05-08T15:21:00.000Z"`). Frontend converts to local time only at display.

### Soft delete

- `deleted_at IS NULL` is "active". Application queries always filter on this.
- Hard-delete is reserved for system-pruning jobs (e.g. invites past TTL by 90 days).

### Naming summary

| What | Convention | Example |
|---|---|---|
| Table | snake_case, plural | `association_users`, `event_officials` |
| Column | snake_case, singular | `user_id`, `created_at` |
| PK | `id` | `id` |
| FK | `<parent_singular>_id` | `association_id`, `user_id` |
| Index | `idx_<table>_<columns>` | `idx_association_users_status` |
| Unique index | `uk_<table>_<columns>` | `uk_associations_username` |
| FK constraint | `fk_<table>_<column>` | `fk_association_users_user` |
| ENUM | snake_case values | `'pending'`, `'mark_active'` |
| JSON column | `<concept>_json` | `permissions_json`, `scoring_scope_json` |

---

## What's NOT in any doc yet

These tables exist in the codebase / API contracts but aren't documented yet. Add them as sections in the matching domain doc using the same template (Purpose / CREATE script / Field table). All will follow the conventions above (standard columns + UTC + indexed FKs). Each domain doc also lists its own planned tables.

- **`teams`** — global team identity referenced by `association_teams.team_id` and `invites.team_id`. (→ identity/shared.)
- **`team_members`** — team roster row. Will mirror the `association_users` pattern: `invite_id` + `invite_status` + `invited_by_user_id` columns supporting the same dual-row invite lifecycle.
- **`event_divisions`** — event-scoped division catalogue referenced by the scoring scope, and the deferred FK target for `tournament_brackets.division_id` / `tournament_bracket_teams.division_id`. FK to `team_events.id` with CASCADE (when an event is hard-deleted, its divisions go with it). The park/field tables it sits alongside are documented in [`sql-schema-shared.md`](./sql-schema-shared.md) (`game_parts`, `park_fields`) and [`sql-schema-event.md`](./sql-schema-event.md) (`event_playing_facilities`, `event_field_selections`, `park_scheduling_windows`) — they are the FK targets for `tournament_games.park_id` / `tournament_games.field_id`; verify both have `BIGINT UNSIGNED` PKs before adding those FKs.
- **`team_sports_types`** — sport-type catalogue referenced by `team_events.sports_type_id`. (→ shared.) Existing table; canonical schema doc entry pending.
- **`game_position_configs`** — field/positional configuration catalogue referenced by `team_events.field_config_id` and `event_tournaments.field_config_id`. (→ shared.) Existing table; canonical schema doc entry pending.
- **`age_groups`**, **`ratings`** — lookup tables FK'd from `association_teams` (and `divisions`/`event_tournaments`), feeding the Add/Edit Division team-restriction multi-selects. `age_groups` is still the global catalogue behind `GET /getAgeGroup` (shared-services §3). `ratings` has been **association-scoped** — it carries an `association_id` FK and is managed via full CRUD (see [`sql-schema-association.md#ratings`](./sql-schema-association.md#ratings) + [`api/association-ratings-api-contract.md`](../api/association-ratings-api-contract.md)); the legacy global `GET /getAllRatings` (former shared-services §4) is **removed**.
- **`seeding_criteria`** — the global tie-break-criteria catalogue (behind `GET /v2/seeders`, shared-services §6). (→ shared.) FK target for `event_seed_criteria.seeding_criteria_id` and `tournament_seed_criteria.seeding_criteria_id`. Existing table; canonical schema doc entry pending. Verify `BIGINT UNSIGNED` PK before adding those FKs.
- **`payment_orders`** — payment intents at the order level.
- **`payables`** — line items within an order, with `payment_completion_status`.

> **Forward-looking FK policy reminder.** Every direct child FK into `associations` (e.g. future `events.association_id`) and every direct child FK into `association_users` (e.g. future `event_officials.association_user_id`) follows the **RESTRICT** policy from the Conventions section above. Same rationale: associations and their memberships carry business-critical history that must not vanish via silent cascade.
