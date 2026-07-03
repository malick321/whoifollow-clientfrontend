---
status: Draft
owner: shared
last_updated: 2026-05-09
scope: Local-only — not yet shipped upstream
---

# SQL Migrations — System

ALTER sequences that evolve the production database from its current state to the canonical target shape in [`sql-schema.md`](./sql-schema.md). One section per table needing migration. Each section has a status flag at the top; bump it as the migration progresses through environments.

> **Companion doc**: [`sql-schema.md`](./sql-schema.md) is the canonical TARGET schema — what the database SHOULD look like once every migration in this doc has been applied. This doc holds the path from production → target. Once a migration is fully applied to production, its section can stay (for history) or be archived; the schema doc reflects the post-migration shape regardless.

## Conventions

### Status flag legend

| Status | Meaning |
|---|---|
| `Pending` | Written but not yet applied to any environment. |
| `In Progress` | Applied to staging; production pending. |
| `Applied` | Landed in production. Schema doc + production are in sync for this table. |
| `Skipped` | Decision made not to run. Status row carries the reason. |

### Per-migration section template

Every migration follows the same shape:

1. **Title + status flag**
2. **Goal** — short paragraph naming the diff between current production and the target shape in `sql-schema.md`.
3. **Pre-flight checks** — SELECT queries the team runs first to surface migration-blocking issues (orphaned FK references, unique-violation candidates, type-conversion failures).
4. **ALTER sequence** — numbered steps. Order matters; steps that must complete before the next can run are clearly sequenced. Each step is a single ALTER block.
5. **Post-validation** — SELECT queries to confirm the migration succeeded.
6. **Rollback notes** — when a step is reversible, how to roll back.

### Rule of thumb for production application

- Run pre-flight checks against a recent production dump first.
- Apply each migration to staging, run post-validation, soak for at least one full feature cycle.
- Apply to production during a planned window (most of these are non-blocking online operations, but FK additions can lock the table briefly).
- Bump the status flag after each environment.

---

## M1 — `associations`: tighten guid, status enum, audit-by columns + indexes + FKs

**Status: Pending**

### Goal

Bring the production `associations` table in line with the canonical schema in [`sql-schema-association.md#associations`](./sql-schema-association.md#associations). Specifically:

- `guid` VARCHAR(255) → `CHAR(36)`
- `status` INT → `ENUM('active', 'inactive', 'suspended')`
- Strip per-column CHARACTER SET / COLLATE overrides (utf8mb3 → table-default utf8mb4_unicode_ci)
- Add audit-by columns: `created_by`, `updated_by`, `deleted_by`
- Add unique indexes on `guid`, `username`, `short_name`
- Add non-unique indexes on `status`, `deleted_at`, audit-by columns
- Add FK constraints from audit-by columns to `users.id` (SET NULL)

No column renames, no column drops, no behavioral changes for the application.

### Pre-flight checks

```sql
-- 1. GUID conformance check — every row must have a 36-char value before CHAR(36) MODIFY
SELECT id, guid, LENGTH(guid) AS len
FROM associations
WHERE guid IS NULL OR LENGTH(guid) <> 36;

-- 2. GUID duplicates (must be empty before unique index)
SELECT guid, COUNT(*) AS dup_count
FROM associations
GROUP BY guid
HAVING COUNT(*) > 1;

-- 3. Username duplicates
SELECT username, COUNT(*) AS dup_count
FROM associations
WHERE username IS NOT NULL
GROUP BY username
HAVING COUNT(*) > 1;

-- 4. Short_name duplicates
SELECT short_name, COUNT(*) AS dup_count
FROM associations
WHERE short_name IS NOT NULL
GROUP BY short_name
HAVING COUNT(*) > 1;

-- 5. Status int values currently in use — confirm the int → enum mapping
SELECT status, COUNT(*) AS row_count
FROM associations
GROUP BY status
ORDER BY status;
```

Resolve every non-empty result before proceeding. For (5), confirm with backend code which int value maps to which enum string (`active` / `inactive` / `suspended`) before Step 2.

### ALTER sequence

```sql
-- Step 1: Tighten + normalize column types. No CHARACTER SET / COLLATE per column —
-- inherit from table default (utf8mb4 / utf8mb4_unicode_ci).
ALTER TABLE `associations`
  MODIFY COLUMN `guid`       CHAR(36) DEFAULT NULL,
  MODIFY COLUMN `short_name` VARCHAR(45) DEFAULT NULL,
  MODIFY COLUMN `notes`      VARCHAR(500) DEFAULT NULL;

-- Step 2: Backfill status int → string, then convert column to ENUM.
-- Confirm the mapping with backend code BEFORE running the UPDATEs.
-- Example (placeholder values — verify):
UPDATE `associations` SET `status` = 'active'    WHERE `status` = 1;
UPDATE `associations` SET `status` = 'inactive'  WHERE `status` = 2;
UPDATE `associations` SET `status` = 'suspended' WHERE `status` = 3;
-- After backfill, MODIFY:
ALTER TABLE `associations`
  MODIFY COLUMN `status` ENUM('active', 'inactive', 'suspended') NOT NULL DEFAULT 'active';

-- Step 3: Add audit-by columns
ALTER TABLE `associations`
  ADD COLUMN `created_by` BIGINT UNSIGNED NULL DEFAULT NULL AFTER `deleted_at`,
  ADD COLUMN `updated_by` BIGINT UNSIGNED NULL DEFAULT NULL AFTER `created_by`,
  ADD COLUMN `deleted_by` BIGINT UNSIGNED NULL DEFAULT NULL AFTER `updated_by`;

-- Step 4: Indexes
ALTER TABLE `associations`
  ADD UNIQUE KEY `uk_associations_guid`       (`guid`),
  ADD UNIQUE KEY `uk_associations_username`   (`username`),
  ADD UNIQUE KEY `uk_associations_short_name` (`short_name`),
  ADD KEY `idx_associations_status`     (`status`),
  ADD KEY `idx_associations_deleted_at` (`deleted_at`),
  ADD KEY `idx_associations_created_by` (`created_by`),
  ADD KEY `idx_associations_updated_by` (`updated_by`),
  ADD KEY `idx_associations_deleted_by` (`deleted_by`);

-- Step 5: FK constraints (requires `users` table to exist with BIGINT UNSIGNED PK)
ALTER TABLE `associations`
  ADD CONSTRAINT `fk_associations_created_by` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_associations_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_associations_deleted_by` FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
```

### Post-validation

```sql
-- Schema confirmation
SHOW CREATE TABLE `associations`\G

-- All rows have valid GUIDs
SELECT COUNT(*) FROM associations WHERE LENGTH(guid) <> 36;
-- Expected: 0

-- All status values are now valid enum members
SELECT status, COUNT(*) FROM associations GROUP BY status;
-- Expected: only 'active', 'inactive', 'suspended'

-- FK constraints in place
SELECT CONSTRAINT_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'associations'
  AND CONSTRAINT_NAME LIKE 'fk_%';
-- Expected: 3 rows for fk_associations_created_by/_updated_by/_deleted_by
```

### Rollback notes

- Step 5 (FKs): `ALTER TABLE associations DROP FOREIGN KEY fk_associations_created_by, ...` — instant.
- Step 4 (indexes): `DROP INDEX uk_associations_guid ON associations, ...` — instant on a 47-row table.
- Step 3 (columns): `DROP COLUMN created_by, ...` — instant; data lost on the audit-by columns.
- Step 2 (status): re-MODIFY back to `INT`, then UPDATE rows back to int values. Recoverable but tedious.
- Step 1 (column types): MODIFY back to VARCHAR(255) — instant; safe.

---

## M2 — `association_teams`: id widening, FK addition, indexes

**Status: Pending**

### Goal

Bring the production `association_teams` table in line with [`sql-schema-association.md#association_teams`](./sql-schema-association.md#association_teams). Specifically:

- `id INT` → `BIGINT UNSIGNED`
- All FK columns (`team_id`, `association_id`, `manager_linked_user_id`, `age_group_id`, `rating_id`, audit-by columns) widened to `BIGINT UNSIGNED` to match parent PKs
- `association_team_guid` widened conceptually to `CHAR(36)` (currently `VARCHAR(100)` — same constraint)
- Add indexes for every FK + composite indexes for listing-page filters
- Add unique keys on `(association_id, team_id, deleted_at)` and `(association_id, registration_no, deleted_at)` (soft-delete-aware)
- Add FK constraints with appropriate delete rules

No column renames, no column drops.

### Prerequisites

- `users` table must exist with `BIGINT UNSIGNED` PK before audit-by FKs can be added.
- `teams` table must exist with `BIGINT UNSIGNED` PK before `fk_association_teams_team` can be added.
- `age_groups` and `ratings` lookup tables must exist with `BIGINT UNSIGNED` PKs before their FKs.
- If any of these parent tables currently use `INT` PKs in production, they need to be widened first (separate migrations).

### Pre-flight checks

```sql
-- 1. Orphan check on every prospective FK column. Each query should return 0 rows.
SELECT COUNT(*) FROM association_teams at
LEFT JOIN associations a ON a.id = at.association_id
WHERE at.association_id IS NOT NULL AND a.id IS NULL;

SELECT COUNT(*) FROM association_teams at
LEFT JOIN teams t ON t.id = at.team_id
WHERE at.team_id IS NOT NULL AND t.id IS NULL;

SELECT COUNT(*) FROM association_teams at
LEFT JOIN users u ON u.id = at.manager_linked_user_id
WHERE at.manager_linked_user_id IS NOT NULL AND u.id IS NULL;

SELECT COUNT(*) FROM association_teams at
LEFT JOIN age_groups ag ON ag.id = at.age_group_id
WHERE at.age_group_id IS NOT NULL AND ag.id IS NULL;

SELECT COUNT(*) FROM association_teams at
LEFT JOIN ratings r ON r.id = at.rating_id
WHERE at.rating_id IS NOT NULL AND r.id IS NULL;

-- 2. Duplicate check for the new soft-delete-aware unique keys
SELECT association_id, team_id, deleted_at, COUNT(*) AS dup_count
FROM association_teams
WHERE team_id IS NOT NULL
GROUP BY association_id, team_id, deleted_at
HAVING COUNT(*) > 1;

SELECT association_id, registration_no, deleted_at, COUNT(*) AS dup_count
FROM association_teams
WHERE registration_no IS NOT NULL
GROUP BY association_id, registration_no, deleted_at
HAVING COUNT(*) > 1;
```

For (1): NULL out invalid FK references before adding FK constraints (e.g. `UPDATE association_teams SET manager_linked_user_id = NULL WHERE manager_linked_user_id NOT IN (SELECT id FROM users)`).

For (2): resolve duplicates manually before adding the unique keys.

### ALTER sequence

```sql
-- Step 1: Type widening. Required before FKs can match parent PK widths.
ALTER TABLE `association_teams`
  MODIFY COLUMN `id`                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  MODIFY COLUMN `team_id`                BIGINT UNSIGNED DEFAULT NULL,
  MODIFY COLUMN `association_id`         BIGINT UNSIGNED NOT NULL,
  MODIFY COLUMN `manager_linked_user_id` BIGINT UNSIGNED DEFAULT NULL,
  MODIFY COLUMN `age_group_id`           BIGINT UNSIGNED DEFAULT NULL,
  MODIFY COLUMN `rating_id`              BIGINT UNSIGNED DEFAULT NULL,
  MODIFY COLUMN `created_by`             BIGINT UNSIGNED DEFAULT NULL,
  MODIFY COLUMN `updated_by`             BIGINT UNSIGNED DEFAULT NULL,
  MODIFY COLUMN `deleted_by`             BIGINT UNSIGNED DEFAULT NULL;

-- Step 2: Indexes
ALTER TABLE `association_teams`
  ADD UNIQUE KEY `uk_association_teams_assoc_team`  (`association_id`, `team_id`, `deleted_at`),
  ADD UNIQUE KEY `uk_association_teams_assoc_regno` (`association_id`, `registration_no`, `deleted_at`),
  ADD KEY `idx_association_teams_association_id`   (`association_id`),
  ADD KEY `idx_association_teams_team_id`          (`team_id`),
  ADD KEY `idx_association_teams_reg_status`       (`association_id`, `registration_status`),
  ADD KEY `idx_association_teams_age_rating`       (`association_id`, `age_group_id`, `rating_id`),
  ADD KEY `idx_association_teams_expiry`           (`association_id`, `expiry_date`),
  ADD KEY `idx_association_teams_manager_user`     (`manager_linked_user_id`),
  ADD KEY `idx_association_teams_age_group`        (`age_group_id`),
  ADD KEY `idx_association_teams_rating`           (`rating_id`),
  ADD KEY `idx_association_teams_deleted_at`       (`deleted_at`),
  ADD KEY `idx_association_teams_created_by`       (`created_by`),
  ADD KEY `idx_association_teams_updated_by`       (`updated_by`),
  ADD KEY `idx_association_teams_deleted_by`       (`deleted_by`);

-- Step 3: FK constraints
ALTER TABLE `association_teams`
  ADD CONSTRAINT `fk_association_teams_association`
    FOREIGN KEY (`association_id`) REFERENCES `associations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_association_teams_team`
    FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_association_teams_manager_user`
    FOREIGN KEY (`manager_linked_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_association_teams_age_group`
    FOREIGN KEY (`age_group_id`) REFERENCES `age_groups`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_association_teams_rating`
    FOREIGN KEY (`rating_id`) REFERENCES `ratings`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_association_teams_created_by` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_association_teams_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_association_teams_deleted_by` FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
```

### Post-validation

```sql
-- Schema confirmation
SHOW CREATE TABLE `association_teams`\G

-- All FK constraints in place
SELECT CONSTRAINT_NAME, REFERENCED_TABLE_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'association_teams'
  AND CONSTRAINT_NAME LIKE 'fk_%';
-- Expected: 8 rows

-- No orphans introduced (run the same orphan-check queries from pre-flight)

-- Listing-page index actually used (run EXPLAIN on the typical query)
EXPLAIN SELECT * FROM association_teams
WHERE association_id = 42 AND registration_status = 1
ORDER BY last_update_date DESC LIMIT 25;
-- Expected: idx_association_teams_reg_status used
```

### Rollback notes

- Step 3 (FKs): `DROP FOREIGN KEY` for each.
- Step 2 (indexes): `DROP INDEX` for each.
- Step 1 (type widening): MODIFY back to `INT`. Note: rolling back the PK width is risky if any rows were inserted after the widening; their `id` values may exceed the INT range. Don't rollback Step 1 unless you've also confirmed `MAX(id) < 2147483647`.

---

## M3 — `stripe_connected_accounts`: RESTRICT FK + audit-by columns

**Status: Pending**

### Goal

Bring the production `stripe_connected_accounts` table in line with [`sql-schema-association.md#stripe_connected_accounts`](./sql-schema-association.md#stripe_connected_accounts). Specifically:

- Change `fk_sca_association` from `ON DELETE CASCADE` to `ON DELETE RESTRICT` (current production violates the schema convention — cascade-deleting an association silently drops its Stripe Connect record, which is critical financial data).
- Add audit-by columns: `created_by`, `updated_by`, `deleted_by`, `deleted_at`.
- Add indexes for the new audit-by columns.
- (Optional) `created_at` / `updated_at` from `DATETIME` → `TIMESTAMP` for explicit UTC handling.

### Pre-flight checks

```sql
-- 1. Orphan check on association_id
SELECT COUNT(*) FROM stripe_connected_accounts sca
LEFT JOIN associations a ON a.id = sca.association_id
WHERE a.id IS NULL;
-- Expected: 0
```

### ALTER sequence

```sql
-- Step 1: Drop the existing CASCADE FK; add RESTRICT FK.
ALTER TABLE `stripe_connected_accounts`
  DROP FOREIGN KEY `fk_sca_association`;

ALTER TABLE `stripe_connected_accounts`
  ADD CONSTRAINT `fk_sca_association`
    FOREIGN KEY (`association_id`) REFERENCES `associations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Step 2: Add audit-by columns + deleted_at
ALTER TABLE `stripe_connected_accounts`
  ADD COLUMN `deleted_at`         TIMESTAMP NULL DEFAULT NULL AFTER `updated_at`,
  ADD COLUMN `created_by`         BIGINT UNSIGNED NULL DEFAULT NULL AFTER `deleted_at`,
  ADD COLUMN `updated_by`         BIGINT UNSIGNED NULL DEFAULT NULL AFTER `created_by`,
  ADD COLUMN `deleted_by`         BIGINT UNSIGNED NULL DEFAULT NULL AFTER `updated_by`;

-- Step 3: Indexes for the new columns
ALTER TABLE `stripe_connected_accounts`
  ADD KEY `idx_sca_onboarding_status` (`onboarding_status`),
  ADD KEY `idx_sca_deleted_at` (`deleted_at`),
  ADD KEY `idx_sca_created_by` (`created_by`),
  ADD KEY `idx_sca_updated_by` (`updated_by`),
  ADD KEY `idx_sca_deleted_by` (`deleted_by`);

-- Step 4: FK constraints for audit-by columns
ALTER TABLE `stripe_connected_accounts`
  ADD CONSTRAINT `fk_sca_created_by` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_sca_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_sca_deleted_by` FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Step 5 (Optional): created_at / updated_at DATETIME → TIMESTAMP
-- Only run if all writes already pass UTC-aware values; otherwise leave as DATETIME.
ALTER TABLE `stripe_connected_accounts`
  MODIFY COLUMN `created_at` TIMESTAMP NULL DEFAULT NULL,
  MODIFY COLUMN `updated_at` TIMESTAMP NULL DEFAULT NULL;
```

### Post-validation

```sql
-- Confirm new FK rule
SELECT DELETE_RULE
FROM information_schema.REFERENTIAL_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = DATABASE()
  AND CONSTRAINT_NAME = 'fk_sca_association';
-- Expected: 'RESTRICT'

-- Confirm audit columns + indexes added
SHOW CREATE TABLE `stripe_connected_accounts`\G

-- Behavior check: hard-deleting an association with a Stripe row should now fail
-- (run on staging only; do NOT run in production!)
-- DELETE FROM associations WHERE id = <some-test-id>;
-- Expected error: ERROR 1451 (23000): Cannot delete or update a parent row
```

### Rollback notes

- Step 1: drop the RESTRICT FK and re-add the CASCADE FK. Instant.
- Steps 2–4: drop columns + indexes + FKs in reverse order.
- Step 5: MODIFY back to DATETIME. Instant.

---

## M4 — `invites`: full refactor of the polymorphic invites schema

**Status: Pending**

### Goal

Replace the messy production `invites` table (mixed types, no indexes, no FKs, ad-hoc varchar columns) with the canonical schema in [`sql-schema-shared.md#invites`](./sql-schema-shared.md#invites). This is the largest migration in this doc — see the dedicated planning section in [`humming-drifting-russell.md`](file:///C:/Users/OMEN/.claude/plans/humming-drifting-russell.md) for the full rationale.

Highlights:
- Bump PK from `INT UNSIGNED` to `BIGINT UNSIGNED`.
- Replace varchar status with ENUM, varchar user-id columns with BIGINT FKs.
- Drop dead columns (`level`, `c_id`, etc.); rename / restructure remaining ones into a typed shape.
- Add token uniqueness, target lookup index, type+status composite, retention-cleanup support.
- Add FK constraints with appropriate delete rules.

### Migration phases

The migration is staged across multiple deploys to keep production live throughout. Detailed steps are in the original plan:

1. **Phase 1 — Additive ALTER**: add new columns alongside the old. Old columns stay populated, new columns NULL.
2. **Phase 2 — Backfill**: per-row mapping script. Verify each row's mapping with logs before proceeding.
3. **Phase 3 — NOT NULL upgrades + indexes**: lock new column values; add unique + non-unique indexes.
4. **Phase 4 — FK constraints**: add the FKs after verifying no orphans.
5. **Phase 5 — Application cutover**: deploy code that reads/writes new columns; stops touching old columns.
6. **Phase 6 — Drop old columns + rename**: post-soak, hard-cut to the new shape.
7. **Phase 7 — PK widening**: optional last step (safe to do early since the table is small).

### Pre-flight checks

```sql
-- 1. Sample existing target values to drive the email/phone target_type sniff
SELECT id, target,
       CASE WHEN target LIKE '%@%.%' THEN 'email' ELSE 'phone' END AS sniff_type
FROM invites
LIMIT 100;

-- 2. user_link conformance — any non-numeric values?
SELECT id, user_link
FROM invites
WHERE user_link IS NOT NULL AND user_link NOT REGEXP '^[0-9]+$';

-- 3. user_link orphans
SELECT COUNT(*) FROM invites
WHERE user_link IS NOT NULL
  AND CAST(user_link AS UNSIGNED) NOT IN (SELECT id FROM users);

-- 4. invite_type values currently in use
SELECT invite_type, COUNT(*) FROM invites GROUP BY invite_type;

-- 5. status varchar values
SELECT status, COUNT(*) FROM invites GROUP BY status;
```

### Detailed ALTER sequence

See the "Migration plan (existing 2383 rows → new schema)" section in `humming-drifting-russell.md` for the seven-step ALTER plan with full SQL. That doc has the per-row backfill mapping table. Those steps will be lifted into this section once they're finalized.

### Post-validation

```sql
-- Sample 10 rows of each invite_type post-backfill
SELECT * FROM invites WHERE invite_type = 'association_user' LIMIT 10;
SELECT * FROM invites WHERE invite_type = 'team_member' LIMIT 10;
SELECT * FROM invites WHERE invite_type = 'platform_signup' LIMIT 10;

-- All FK constraints in place
SELECT CONSTRAINT_NAME, REFERENCED_TABLE_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invites'
  AND CONSTRAINT_NAME LIKE 'fk_%';

-- App smoke test: create + accept + cancel + expire one invite of each type on staging
```

### Rollback notes

The phased migration is designed so each phase is reversible until the application cutover (Phase 5). After cutover, rollback requires re-deploying the previous app version + reviving the old columns from a backup or from soak data.

---

## M5 — `association_followers`: audit-by columns + index naming + FK constraints

**Status: Pending**

### Goal

Bring the production `association_followers` table in line with [`sql-schema-association.md#association_followers`](./sql-schema-association.md#association_followers). Specifically:

- Add missing audit-by columns: `created_by`, `updated_by` (`deleted_by` already exists).
- Rename indexes from `idx_association_id` / `idx_user_id` to `idx_association_followers_association_id` / `idx_association_followers_user_id` per the naming convention.
- Add a soft-delete-aware unique key on `(association_id, user_id, deleted_at)` to enforce one live follow per pair (and prevent duplicate-follow race conditions).
- Add FK constraints with appropriate delete rules.

### Pre-flight checks

```sql
-- 1. Duplicate live follows that would block the unique key
SELECT association_id, user_id, COUNT(*) AS dup_count
FROM association_followers
WHERE deleted_at IS NULL
GROUP BY association_id, user_id
HAVING COUNT(*) > 1;

-- 2. Orphan check on association_id and user_id
SELECT COUNT(*) FROM association_followers af
LEFT JOIN associations a ON a.id = af.association_id
WHERE a.id IS NULL;

SELECT COUNT(*) FROM association_followers af
LEFT JOIN users u ON u.id = af.user_id
WHERE u.id IS NULL;
```

For (1): collapse duplicates manually before running Step 2 (keep the oldest live row, hard-delete the rest).

### ALTER sequence

```sql
-- Step 1: Add the missing audit-by columns
ALTER TABLE `association_followers`
  ADD COLUMN `created_by` BIGINT UNSIGNED NULL DEFAULT NULL AFTER `deleted_at`,
  ADD COLUMN `updated_by` BIGINT UNSIGNED NULL DEFAULT NULL AFTER `created_by`;

-- Step 2: Drop existing badly-named indexes; add convention-named ones + the unique key
ALTER TABLE `association_followers`
  DROP INDEX `idx_association_id`,
  DROP INDEX `idx_user_id`,
  ADD UNIQUE KEY `uk_association_followers_assoc_user` (`association_id`, `user_id`, `deleted_at`),
  ADD KEY `idx_association_followers_association_id` (`association_id`),
  ADD KEY `idx_association_followers_user_id`        (`user_id`),
  ADD KEY `idx_association_followers_deleted_at`     (`deleted_at`),
  ADD KEY `idx_association_followers_created_by`     (`created_by`),
  ADD KEY `idx_association_followers_updated_by`     (`updated_by`),
  ADD KEY `idx_association_followers_deleted_by`     (`deleted_by`);

-- Step 3: FK constraints
ALTER TABLE `association_followers`
  ADD CONSTRAINT `fk_association_followers_association`
    FOREIGN KEY (`association_id`) REFERENCES `associations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_association_followers_user`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_association_followers_created_by` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_association_followers_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_association_followers_deleted_by` FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
```

### Post-validation

```sql
-- Schema confirmation
SHOW CREATE TABLE `association_followers`\G

-- Unique key working
INSERT INTO association_followers (association_id, user_id) VALUES (1, 1);
INSERT INTO association_followers (association_id, user_id) VALUES (1, 1);
-- Expected: ERROR 1062 (23000): Duplicate entry on uk_association_followers_assoc_user

-- FK constraints in place
SELECT CONSTRAINT_NAME, REFERENCED_TABLE_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'association_followers'
  AND CONSTRAINT_NAME LIKE 'fk_%';
-- Expected: 5 rows
```

### Rollback notes

All three steps are independently reversible — `DROP COLUMN`, re-add old indexes, `DROP FOREIGN KEY`. Instant ops on a small table.

---

## M5a — `team_events`: additive cleanup (column type alignment + parallel snake_case date/time columns + UTC mirrors + event_status ENUM + indexes + FKs)

**Status**: Pending
**Sibling**: M5b drops only the old `status` VARCHAR column after soak. Everything else stays.

### Goal

Align `team_events` with the canonical schema (`sql-schema-event.md#team_events`) while preserving every production column name. Concretely M5a:
- **Type widenings** (safe — values fit the wider type):
  - `id INT UNSIGNED` → `BIGINT UNSIGNED`
  - `created_by`, `updated_by`, `deleted_by` `INT UNSIGNED` → `BIGINT UNSIGNED`
  - `sports_type_id BIGINT` → `BIGINT UNSIGNED`
- **Type narrowings** (only safe when existing values are numeric strings — pre-flight required):
  - `team_id VARCHAR(255)` → `BIGINT UNSIGNED`
  - `association_id VARCHAR(191)` → `BIGINT UNSIGNED`
  - `medium_id VARCHAR(100)` → `BIGINT UNSIGNED`
- **Column rename** (one-off — correcting an existing typo per dev team confirmation):
  - `lan VARCHAR(255)` → `lat VARCHAR(255)` (latitude)
- **One-shot backfills** of existing columns (no schema change):
  - `owner_type` + `owner_linked_id` — set from the named `team_id` / `association_id` columns on every legacy row that's missing them. `owner_type = 1` for association-owned rows, `owner_type = 2` for team-owned rows (the `2` value is provisional pending backend confirmation — see Step 4b).
- **New columns**:
  - `event_status ENUM('draft','published','completed','cancelled') NULL` — backfilled from `status` VARCHAR.
  - `event_start_date DATE NULL`, `event_end_date DATE NULL`, `event_start_time TIME NULL`, `event_end_time TIME NULL` — parallel snake_case canonical date/time columns the new API writes to. Legacy `startDate` / `endDate` / `startTime` / `endTime` stay untouched. No backfill — legacy rows have these NULL.
  - `start_at_utc`, `end_at_utc`, `registration_opening_utc`, `entry_fee_deadline_utc` — regular nullable `TIMESTAMP` columns the backend writes to directly on every create / update. Legacy rows get one-shot backfilled at migration time via `CONVERT_TZ(...)` from the existing `startDateForField` / `endDateForField` + `startTime` / `endTime` + `time_zone` triples (see Step 7b). Previously these were STORED generated columns — we backed away from `CONVERT_TZ` at the DB level because (a) it couples the schema to MySQL's loaded TZ tables, and (b) the backend already has the full timezone context on write so the conversion belongs in application code where it can be unit-tested and the source-of-truth picker (`startDateForField` vs `event_start_date`) is explicit per code path.
- **Indexes** for the listing query's filter/sort axes (`idx_team_events_event_year` hits the new `event_start_date` DATE column).
- **FK constraints** for every FK-shaped column, after orphan pre-flight + NULL repair.

**Not** in M5a:
- No drop of `startDateForField`, `endDateForField`, `exactStartDate`/`...Time`, `location`, `tournament_id`, `createdByDate`, `createdByName`, `association`, `reminder`, `Url`, `allDay` (VARCHAR), etc. ALL existing columns are retained.
- No type changes to LONGTEXT columns (`avatar`, `time_zone`, `reminder`, `refund_policy`, `tournament_format`).
- No conversion of `startDate`/`endDate`/`startTime`/`endTime` VARCHAR → DATE/TIME (would require parseability guarantees we don't want to enforce yet).

### Pre-flight checks

```sql
-- 1) time_zone values must all be valid IANA names (CONVERT_TZ in the generated columns).
SELECT DISTINCT time_zone FROM team_events ORDER BY time_zone;
-- If any value is a display string (e.g. '(UTC-05:00) Eastern Time'), backfill to IANA equivalent:
--   '(UTC-08:00) Pacific Time'           → 'America/Los_Angeles'
--   '(UTC-07:00) Mountain Time'          → 'America/Denver'
--   '(UTC-07:00) Arizona Time (no DST)'  → 'America/Phoenix'
--   '(UTC-06:00) Central Time'           → 'America/Chicago'
--   '(UTC-05:00) Eastern Time'           → 'America/New_York'
--   '(UTC-09:00) Alaska Time'            → 'America/Anchorage'
--   '(UTC-10:00) Hawaii Time'            → 'Pacific/Honolulu'
UPDATE team_events SET time_zone = 'America/Los_Angeles' WHERE time_zone IS NULL OR time_zone = '';

-- 2) Verify MySQL TZ tables loaded.
SELECT CONVERT_TZ('2026-01-01 12:00:00', 'America/Los_Angeles', 'UTC');
-- Expected: '2026-01-01 20:00:00'. NULL = TZ tables not loaded; halt migration.

-- 3) For VARCHAR → BIGINT UNSIGNED narrowings — every value must be a numeric string (or NULL).
SELECT id, team_id FROM team_events
WHERE team_id IS NOT NULL AND team_id NOT REGEXP '^[0-9]+$';
SELECT id, association_id FROM team_events
WHERE association_id IS NOT NULL AND association_id NOT REGEXP '^[0-9]+$';
SELECT id, medium_id FROM team_events
WHERE medium_id IS NOT NULL AND medium_id NOT REGEXP '^[0-9]+$';
-- All three queries must return 0 rows. NULL or fix any non-numeric values before the ALTER.

-- 4) status VARCHAR values must be in the known set for the enum backfill mapping.
SELECT DISTINCT status FROM team_events ORDER BY status;
-- Expected: subset of {'0','1','2','3'} (production currently uses these strings).
-- Any other value needs manual triage.

-- 5) Orphan FK checks — every column that becomes an FK in this migration.
SELECT COUNT(*) FROM team_events WHERE team_id IS NOT NULL
  AND CAST(team_id AS UNSIGNED) NOT IN (SELECT id FROM teams);
SELECT COUNT(*) FROM team_events WHERE association_id IS NOT NULL
  AND CAST(association_id AS UNSIGNED) NOT IN (SELECT id FROM associations);
SELECT COUNT(*) FROM team_events WHERE sports_type_id IS NOT NULL
  AND sports_type_id NOT IN (SELECT id FROM team_sports_types);
SELECT COUNT(*) FROM team_events WHERE field_config_id IS NOT NULL
  AND field_config_id NOT IN (SELECT id FROM game_position_configs);
SELECT COUNT(*) FROM team_events WHERE medium_id IS NOT NULL
  AND CAST(medium_id AS UNSIGNED) NOT IN (SELECT id FROM mediums);
SELECT COUNT(*) FROM team_events WHERE created_by IS NOT NULL
  AND created_by NOT IN (SELECT id FROM users);
SELECT COUNT(*) FROM team_events WHERE updated_by IS NOT NULL
  AND updated_by NOT IN (SELECT id FROM users);
SELECT COUNT(*) FROM team_events WHERE deleted_by IS NOT NULL
  AND deleted_by NOT IN (SELECT id FROM users);
-- Every count must be 0. NULL out any orphans before adding the FK:
-- UPDATE team_events SET team_id = NULL WHERE CAST(team_id AS UNSIGNED) NOT IN (SELECT id FROM teams);
```

### ALTER sequence

```sql
-- Step 1: Rename lan → lat (latitude typo fix).
ALTER TABLE team_events CHANGE COLUMN `lan` `lat` VARCHAR(255) DEFAULT NULL COMMENT 'Latitude';

-- Step 2: Widen integer types — safe, values fit.
ALTER TABLE team_events
  MODIFY COLUMN `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  MODIFY COLUMN `created_by` BIGINT UNSIGNED DEFAULT NULL,
  MODIFY COLUMN `updated_by` BIGINT UNSIGNED DEFAULT NULL,
  MODIFY COLUMN `deleted_by` BIGINT UNSIGNED DEFAULT NULL,
  MODIFY COLUMN `sports_type_id` BIGINT UNSIGNED DEFAULT NULL;

-- Step 3: Narrow VARCHAR FK columns to BIGINT UNSIGNED.
-- Preconditioned on the regex pre-flight in step 0 — values are guaranteed numeric.
ALTER TABLE team_events
  MODIFY COLUMN `team_id`        BIGINT UNSIGNED DEFAULT NULL,
  MODIFY COLUMN `association_id` BIGINT UNSIGNED DEFAULT NULL,
  MODIFY COLUMN `medium_id`      BIGINT UNSIGNED DEFAULT NULL;

-- Step 4: ADD event_status ENUM (NULL initially so the ALTER doesn't reject existing rows).
ALTER TABLE team_events
  ADD COLUMN `event_status` ENUM('draft', 'published', 'completed', 'cancelled') DEFAULT NULL AFTER `status`;

-- Step 4b: Backfill owner_type + owner_linked_id for legacy rows.
-- These columns already exist in production but were never populated
-- for older rows that pre-date the polymorphic-ownership pattern.
-- Production code currently reads them; this UPDATE puts them in sync
-- with the named team_id / association_id XOR pair.
--
-- Canonical mapping:
--   1 = association  → owner_linked_id := association_id
--   2 = team         → owner_linked_id := team_id
--
-- The `2` value is provisional pending backend confirmation. If the
-- backend uses a different code for team, update this CASE before
-- running and amend the comment + the schema doc in lockstep.

-- A) Association-owned: team_id IS NULL AND association_id IS NOT NULL.
UPDATE team_events
   SET owner_type      = 1,
       owner_linked_id = association_id
 WHERE team_id IS NULL
   AND association_id IS NOT NULL
   AND owner_type IS NULL;

-- B) Team-owned: team_id IS NOT NULL.
UPDATE team_events
   SET owner_type      = 2,
       owner_linked_id = team_id
 WHERE team_id IS NOT NULL
   AND owner_type IS NULL;

-- Sanity check — every row should now have a non-NULL owner pair.
-- Non-zero indicates rows missing BOTH team_id AND association_id —
-- inspect by hand (they're likely test / orphan data and should
-- either be assigned an owner or deleted).
SELECT COUNT(*) FROM team_events WHERE owner_type IS NULL OR owner_linked_id IS NULL;

-- Step 5: Backfill event_status from the existing VARCHAR status.
UPDATE team_events SET event_status = CASE status
  WHEN '0' THEN 'draft'
  WHEN '1' THEN 'published'
  WHEN '2' THEN 'completed'
  WHEN '3' THEN 'cancelled'
END
WHERE event_status IS NULL;

-- Step 5b: Safe-default fallback for rows whose legacy `status` was
-- NULL / outside '0'..'3'. We pick 'published' because the only
-- production paths that surface in the listing UI are past-events
-- filters — keeping these rows visible (rather than invisibly
-- 'draft' or 'cancelled') matches the historic UX where they were
-- always shown.
UPDATE team_events
   SET event_status = 'published'
 WHERE event_status IS NULL;

-- Step 6: ADD parallel canonical date / time columns the new API
-- writes to. Legacy `startDate` / `endDate` / `startTime` / `endTime`
-- VARCHAR columns stay untouched. No backfill — legacy rows have
-- the new columns NULL and stay invisible to the new app's
-- past-events / year filters by design.
ALTER TABLE team_events
  ADD COLUMN `event_start_date` DATE NULL,
  ADD COLUMN `event_end_date`   DATE NULL,
  ADD COLUMN `event_start_time` TIME NULL,
  ADD COLUMN `event_end_time`   TIME NULL;

-- Step 7: ADD the four UTC mirror columns as REGULAR nullable
-- TIMESTAMPs (NOT generated). The backend writes these on every
-- create / update — the DB no longer recomputes them via
-- CONVERT_TZ. Decision rationale: see Goal §1 above. Index-friendly
-- equivalent — these still get the same composite indexes as the
-- old generated columns did (Step 8 below).
ALTER TABLE team_events
  ADD COLUMN `start_at_utc`             TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN `end_at_utc`               TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN `registration_opening_utc` TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN `entry_fee_deadline_utc`   TIMESTAMP NULL DEFAULT NULL;

-- Step 7b: One-shot backfill of the UTC mirrors for legacy rows
-- from the existing `startDateForField` / `endDateForField` +
-- `startTime` / `endTime` + `time_zone` triples (the source the
-- backend will also use going forward when only the legacy date
-- columns are populated). Done as separate UPDATEs — start_at_utc
-- first, end_at_utc second — to keep each statement single-purpose
-- and trivially restartable if either is interrupted. Rows where
-- the source date is NULL or empty stay NULL (the backend then
-- treats them as "no UTC pinned yet" which is the intended state).
--
-- IMPORTANT: NULLIF(...) protects against empty-string dates leaking
-- through to CONVERT_TZ as '0000-00-00' (legal in some MySQL configs
-- but garbage downstream). The IFNULL on the time component carries
-- the same semantics the old generated expressions had (00:00:00 for
-- start, 23:59:59 for end).
UPDATE team_events
   SET start_at_utc = CONVERT_TZ(
         CONCAT(NULLIF(startDateForField, ''), ' ', IFNULL(NULLIF(startTime, ''), '00:00:00')),
         time_zone,
         'UTC'
       )
 WHERE startDateForField IS NOT NULL
   AND startDateForField <> ''
   AND time_zone IS NOT NULL
   AND time_zone <> '';

UPDATE team_events
   SET end_at_utc = CONVERT_TZ(
         CONCAT(NULLIF(endDateForField, ''), ' ', IFNULL(NULLIF(endTime, ''), '23:59:59')),
         time_zone,
         'UTC'
       )
 WHERE endDateForField IS NOT NULL
   AND endDateForField <> ''
   AND time_zone IS NOT NULL
   AND time_zone <> '';

-- Registration-window mirrors. These two source from the existing
-- `registration_opening` DATETIME and `entry_fee_deadline` DATE
-- (full DATE so we pin to the end of day, matching the old
-- generated-column semantics).
UPDATE team_events
   SET registration_opening_utc = CONVERT_TZ(registration_opening, time_zone, 'UTC')
 WHERE registration_opening IS NOT NULL
   AND time_zone IS NOT NULL
   AND time_zone <> '';

UPDATE team_events
   SET entry_fee_deadline_utc = CONVERT_TZ(
         CONCAT(entry_fee_deadline, ' 23:59:59'),
         time_zone,
         'UTC'
       )
 WHERE entry_fee_deadline IS NOT NULL
   AND time_zone IS NOT NULL
   AND time_zone <> '';

-- Step 8: ADD indexes for the listing query's filter/sort axes.
-- (The `team_count` cache slot was intentionally never added —
--  the listing endpoint aggregates event_joined_team status at read
--  time. See plan §11.) Event-year index hits the NEW snake_case
--  `event_start_date` DATE column so YEAR(...) is a typed call.
ALTER TABLE team_events
  ADD KEY `idx_team_events_team`           (`team_id`),
  ADD KEY `idx_team_events_association`    (`association_id`),
  ADD KEY `idx_team_events_status`         (`association_id`, `event_status`),
  ADD KEY `idx_team_events_event_year`     (`association_id`, `event_start_date`),
  ADD KEY `idx_team_events_end_at_utc`     (`association_id`, `end_at_utc`),
  ADD KEY `idx_team_events_reg_open_utc`   (`association_id`, `registration_opening_utc`),
  ADD KEY `idx_team_events_entry_dl_utc`   (`association_id`, `entry_fee_deadline_utc`),
  ADD KEY `idx_team_events_sports_type`    (`sports_type_id`),
  ADD KEY `idx_team_events_field_config`   (`field_config_id`),
  ADD KEY `idx_team_events_medium`         (`medium_id`),
  ADD KEY `idx_team_events_deleted_at`     (`deleted_at`),
  ADD KEY `idx_team_events_created_by`     (`created_by`),
  ADD KEY `idx_team_events_updated_by`     (`updated_by`),
  ADD KEY `idx_team_events_deleted_by`     (`deleted_by`);

-- Step 9: ADD FK constraints (preconditioned on the orphan pre-flight).
ALTER TABLE team_events
  ADD CONSTRAINT `fk_team_events_team`
    FOREIGN KEY (`team_id`)         REFERENCES `teams`(`id`)                 ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_team_events_association`
    FOREIGN KEY (`association_id`)  REFERENCES `associations`(`id`)          ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_team_events_sports_type`
    FOREIGN KEY (`sports_type_id`)  REFERENCES `team_sports_types`(`id`)     ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_team_events_field_config`
    FOREIGN KEY (`field_config_id`) REFERENCES `game_position_configs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_team_events_medium`
    FOREIGN KEY (`medium_id`)       REFERENCES `mediums`(`id`)               ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_team_events_created_by` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_team_events_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_team_events_deleted_by` FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON DELETE SET NULL;
```

### Post-validation

```sql
-- Every row that has a usable startDateForField + time_zone should
-- have a populated start_at_utc after the Step 7b backfill.
SELECT COUNT(*) FROM team_events
 WHERE startDateForField IS NOT NULL
   AND startDateForField <> ''
   AND time_zone IS NOT NULL
   AND time_zone <> ''
   AND start_at_utc IS NULL;
-- Expected: 0. Non-zero indicates either an unparseable date string
-- or a time_zone that wasn't normalized to an IANA name — fix the
-- source row(s) and re-run the Step 7b UPDATE for those rows only.

-- Same check for end_at_utc.
SELECT COUNT(*) FROM team_events
 WHERE endDateForField IS NOT NULL
   AND endDateForField <> ''
   AND time_zone IS NOT NULL
   AND time_zone <> ''
   AND end_at_utc IS NULL;
-- Expected: 0.

-- event_status populated for every row (Step 5 + Step 5b).
SELECT COUNT(*) FROM team_events WHERE event_status IS NULL;
-- Expected: 0.

-- owner_type + owner_linked_id populated for every row that has
-- either a team_id or association_id (Step 4b).
SELECT COUNT(*) FROM team_events
 WHERE (team_id IS NOT NULL OR association_id IS NOT NULL)
   AND (owner_type IS NULL OR owner_linked_id IS NULL);
-- Expected: 0. Non-zero indicates a Step 4b CASE branch that didn't
-- match — inspect by hand.

-- Spot-check the owner_type / owner_linked_id mapping makes sense.
SELECT owner_type, COUNT(*) AS n
  FROM team_events
 WHERE owner_type IS NOT NULL
 GROUP BY owner_type
 ORDER BY owner_type;
-- Expected: only rows with owner_type IN (1, 2). Any other value is
-- a sign the provisional `2 = team` assumption was wrong — confirm
-- with backend, then re-run Step 4b's branch B with the correct value.

-- Rename took effect — lat exists, lan doesn't.
SELECT COLUMN_NAME FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'team_events'
  AND COLUMN_NAME IN ('lan', 'lat');
-- Expected: one row, COLUMN_NAME = 'lat'.

-- FK constraints all in place.
SELECT CONSTRAINT_NAME, REFERENCED_TABLE_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'team_events'
  AND CONSTRAINT_NAME LIKE 'fk_%'
ORDER BY CONSTRAINT_NAME;
-- Expected: 8 rows.
```

### Rollback notes

- Step 1 (rename): reversible via `CHANGE COLUMN lat lan VARCHAR(255)`.
- Steps 2–3 (type changes): reversible via `MODIFY COLUMN` back to original type. The narrowing rollback (BIGINT → VARCHAR) is data-preserving since BIGINT values serialize cleanly.
- Steps 4–7 (ADD COLUMN): reversible via `DROP COLUMN`. (Step 6 adds the new snake_case `event_*` date/time columns; Step 7 adds the four regular nullable UTC mirror columns.)
- Step 4b (owner_type / owner_linked_id backfill): reversible by `UPDATE team_events SET owner_type = NULL, owner_linked_id = NULL` — both columns are pre-existing in production, so the rollback only undoes the value writes, not any schema change.
- Step 5 (backfill UPDATE on `event_status`): reversible by setting back to NULL.
- Step 5b (`event_status` fallback to 'published'): reversible by setting back to NULL. Rolling back both Step 5 and Step 5b leaves `event_status` fully NULL again, matching pre-migration state.
- Step 7b (one-shot UTC backfill UPDATEs): reversible by `UPDATE team_events SET start_at_utc = NULL, end_at_utc = NULL, registration_opening_utc = NULL, entry_fee_deadline_utc = NULL` — or rolled back implicitly when Step 7's `DROP COLUMN` runs.
- Step 8 (ADD INDEX): reversible via `DROP INDEX`.
- Step 9 (ADD CONSTRAINT): reversible via `DROP FOREIGN KEY`.

Until M5b runs, the old `status VARCHAR` column stays in place — full rollback to pre-M5a state is straightforward.

---

## M5b — `team_events`: drop old VARCHAR status (post-soak follow-up, NOT in this branch)

**Status**: Documented; deferred to a future migration after M5a soaks.

### Goal

After M5a + app cutover have soaked (suggest 2–4 weeks minimum), drop the obsolete VARCHAR `status` column. `event_status` becomes the sole lifecycle column going forward — no rename needed (it was named correctly from the start in M5a).

Per locked decisions, **no other columns are dropped** in M5b — `startDateForField`, `endDateForField`, `exactStartDate`/`...Time`, `location`, `tournament_id`, `createdByDate`, `createdByName`, `association`, `reminder`, `Url`, `allDay`, etc. all stay indefinitely. Production consumers reference them; the cost of keeping a few unused VARCHARs is trivial vs. the breakage risk of dropping them.

### Pre-flight checks

```sql
-- 1) Confirm no application code reads the old VARCHAR status column directly.
--    Grep the app codebase: every status read should go through event_status.
--    All non-migration references to `team_events`.`status` must be ZERO.

-- 2) Verify event_status is fully populated.
SELECT COUNT(*) FROM team_events WHERE event_status IS NULL;
-- Expected: 0.
```

### ALTER sequence

```sql
-- Drop the obsolete VARCHAR status column. event_status remains as the sole lifecycle column.
ALTER TABLE team_events DROP COLUMN `status`;
```

### Post-validation

```sql
DESCRIBE team_events;
-- The old `status` column is gone; `event_status` is the lifecycle column.

SELECT COLUMN_NAME FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'team_events' AND COLUMN_NAME = 'status';
-- Expected: 0 rows.
```

### Rollback notes

Reversible: re-ADD `status VARCHAR(255) NOT NULL DEFAULT '1'`, backfill from `event_status` via ENUM → string mapping. Recommend full DB backup before applying — but the drop itself is fast.

---

## M6 — `event_officials`: initial CREATE

**Status**: Pending
**No data preservation needed** — brand new table.

### Goal

Create the per-event grant table. References `team_events(id)` (RESTRICT — don't lose grants on event deletion) + `association_users(id)` (CASCADE — membership removal cascades to grants).

### CREATE script

See `sql-schema-event.md#event_officials` — applied verbatim.

### Post-validation

```sql
SHOW CREATE TABLE event_officials;

-- Unique key working.
INSERT INTO event_officials (event_id, association_user_id) VALUES (1, 1);
INSERT INTO event_officials (event_id, association_user_id) VALUES (1, 1);
-- Expected: ERROR 1062 (23000): Duplicate entry on uk_event_officials_event_user

-- FK constraints in place.
SELECT CONSTRAINT_NAME, REFERENCED_TABLE_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_officials'
  AND CONSTRAINT_NAME LIKE 'fk_%'
ORDER BY CONSTRAINT_NAME;
-- Expected: 5 rows.
```

### Rollback notes

`DROP TABLE event_officials` — fully reversible.

---

## M7a — `event_tournaments`: additive cleanup (UTC mirrors, time_zone + all_day, type widenings, FKs)

**Status**: Pending

### Goal

Mirror M5a's approach on `event_tournaments`, **minus the status ENUM**. The existing VARCHAR `status` on `event_tournaments` is a simple active flag (`'0'` = inactive, `'1'` = active) — not a lifecycle workflow like `team_events`. No `event_status` column is introduced.

What M7a does:
- Widen `id`, `created_by`, `updated_by`, `deleted_by` from INT UNSIGNED → BIGINT UNSIGNED.
- Narrow `event_id` from VARCHAR(255) → BIGINT UNSIGNED so the FK to `team_events.id` type-aligns.
- ADD parallel snake_case canonical date/time columns (`tournament_start_date`, `tournament_end_date`, `tournament_start_time`, `tournament_end_time`). The `tournament_*` prefix is intentional — this table is per-tournament; the parent `team_events` row uses `event_*` for its own equivalent. Legacy `startDate` / `endDate` / `startTime` / `endTime` stay untouched. No backfill.
- ADD `time_zone`, `all_day` columns.
- ADD generated UTC mirrors (`start_at_utc`, `end_at_utc` — snake_case, new-field convention) sourced from the NEW canonical columns.
- ADD indexes for listing queries.
- ADD FK constraints with orphan pre-flight + NULL repair.

What M7a does NOT do:
- No ENUM lifecycle conversion of `status` (existing `'0'`/`'1'` semantics stay).
- No drops, no renames of the legacy camelCase columns.
- No narrowing of the legacy `startDate` / `endDate` / `startTime` / `endTime` VARCHARs — the new app reads/writes the snake_case columns instead.

### Pre-flight checks

```sql
-- 1) event_id values must all be numeric strings (FK target is team_events.id BIGINT).
SELECT event_id FROM event_tournaments
WHERE event_id NOT REGEXP '^[0-9]+$' OR event_id IS NULL;
-- Expected: 0 rows. Fix any non-numeric / NULL values before adding the FK.

-- 2) startDate / endDate / startTime / endTime must be parseable (the CONVERT_TZ expression
--    coerces the strings to dates; unparseable values produce NULL in the generated column).
SELECT id, startDate, startTime
FROM event_tournaments
WHERE startDate IS NOT NULL
  AND STR_TO_DATE(CONCAT(startDate, ' ', IFNULL(startTime, '00:00:00')), '%Y-%m-%d %H:%i:%s') IS NULL;
-- Expected: 0 rows. Fix unparseable values manually first.

-- 3) Verify CONVERT_TZ works on the DB (MySQL TZ tables loaded).
SELECT CONVERT_TZ('2026-01-01 12:00:00', 'America/Los_Angeles', 'UTC');
-- Expected: '2026-01-01 20:00:00'. NULL = TZ tables not loaded; halt migration.

-- 4) Orphan FK pre-flight for event_id + field_config_id + audit-by columns.
SELECT COUNT(*) FROM event_tournaments WHERE event_id IS NOT NULL
  AND CAST(event_id AS UNSIGNED) NOT IN (SELECT id FROM team_events);
SELECT COUNT(*) FROM event_tournaments WHERE field_config_id IS NOT NULL
  AND field_config_id NOT IN (SELECT id FROM game_position_configs);
SELECT COUNT(*) FROM event_tournaments WHERE created_by IS NOT NULL
  AND created_by NOT IN (SELECT id FROM users);
-- (repeat for updated_by, deleted_by)
-- All must be 0; NULL out orphans first.
```

### ALTER sequence

```sql
-- Step 1: Widen id + audit-by columns from INT UNSIGNED to BIGINT UNSIGNED.
--          Required so audit-by FKs can reference users.id (BIGINT UNSIGNED).
ALTER TABLE event_tournaments
  MODIFY COLUMN `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  MODIFY COLUMN `created_by` BIGINT UNSIGNED NULL,
  MODIFY COLUMN `updated_by` BIGINT UNSIGNED NULL,
  MODIFY COLUMN `deleted_by` BIGINT UNSIGNED NULL;

-- Step 2: Narrow event_id from VARCHAR(255) to BIGINT UNSIGNED.
--          REQUIRED for the FK to team_events.id (BIGINT UNSIGNED).
--          Preconditioned on the regex pre-flight (every value is a numeric string).
ALTER TABLE event_tournaments MODIFY COLUMN `event_id` BIGINT UNSIGNED NOT NULL;

-- Step 3a: ADD parallel snake_case canonical date / time columns
-- the new API writes to. Named with the `tournament_*` prefix since
-- this table is per-tournament — the parent `team_events` row uses
-- `event_*` for its own equivalent. Legacy `startDate` / `endDate` /
-- `startTime` / `endTime` VARCHAR columns stay untouched (M7b drops
-- them later if desired). No backfill — legacy rows have these NULL.
ALTER TABLE event_tournaments
  ADD COLUMN `tournament_start_date` DATE NULL AFTER `endTime`,
  ADD COLUMN `tournament_end_date`   DATE NULL AFTER `tournament_start_date`,
  ADD COLUMN `tournament_start_time` TIME NULL AFTER `tournament_end_date`,
  ADD COLUMN `tournament_end_time`   TIME NULL AFTER `tournament_start_time`;

-- Step 3b: ADD time_zone + all_day + generated UTC columns.
-- The UTC mirrors use snake_case names too — they're new fields and
-- follow the dev-team convention. Expressions reference the NEW
-- snake_case columns added in Step 3a. Legacy rows produce NULL
-- mirrors by design.
ALTER TABLE event_tournaments
  ADD COLUMN `time_zone`    VARCHAR(64) NOT NULL DEFAULT 'America/Los_Angeles' AFTER `tournament_end_time`,
  ADD COLUMN `all_day`      BOOLEAN     NOT NULL DEFAULT FALSE                 AFTER `time_zone`,
  ADD COLUMN `start_at_utc` TIMESTAMP GENERATED ALWAYS AS (
    CONVERT_TZ(CONCAT(`tournament_start_date`, ' ', IFNULL(`tournament_start_time`, '00:00:00')), `time_zone`, 'UTC')
  ) STORED,
  ADD COLUMN `end_at_utc`   TIMESTAMP GENERATED ALWAYS AS (
    CONVERT_TZ(CONCAT(`tournament_end_date`, ' ', IFNULL(`tournament_end_time`, '23:59:59')), `time_zone`, 'UTC')
  ) STORED;

-- Step 4: ADD indexes.
ALTER TABLE event_tournaments
  ADD KEY `idx_event_tournaments_event`        (`event_id`),
  ADD KEY `idx_event_tournaments_status`       (`event_id`, `status`),
  ADD KEY `idx_event_tournaments_end_at_utc`   (`event_id`, `end_at_utc`),
  ADD KEY `idx_event_tournaments_start_date`   (`event_id`, `tournament_start_date`),
  ADD KEY `idx_event_tournaments_field_config` (`field_config_id`),
  ADD KEY `idx_event_tournaments_deleted_at`   (`deleted_at`),
  ADD KEY `idx_event_tournaments_created_by`   (`created_by`),
  ADD KEY `idx_event_tournaments_updated_by`   (`updated_by`),
  ADD KEY `idx_event_tournaments_deleted_by`   (`deleted_by`);

-- Step 5: ADD FK constraints.
ALTER TABLE event_tournaments
  ADD CONSTRAINT `fk_event_tournaments_event`
    FOREIGN KEY (`event_id`)        REFERENCES `team_events`(`id`)            ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_event_tournaments_field_config`
    FOREIGN KEY (`field_config_id`) REFERENCES `game_position_configs`(`id`)  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_event_tournaments_created_by` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_event_tournaments_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_event_tournaments_deleted_by` FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON DELETE SET NULL;
```

### Post-validation

```sql
SELECT COUNT(*) FROM event_tournaments WHERE tournament_start_date IS NOT NULL AND start_at_utc IS NULL;
-- Expected: 0.

SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_tournaments'
  AND CONSTRAINT_NAME LIKE 'fk_%';
-- Expected: 5 rows.
```

### Rollback notes

Mirror of M5a (minus the ENUM/backfill steps) — reversible via column DROPs / INDEX DROPs / FK DROPs. Type widening (INT → BIGINT) reverses with `MODIFY COLUMN` (data fits; safe).

> **Note**: M7b is not required for `event_tournaments`. The existing VARCHAR `status` column is preserved indefinitely as a simple active flag; no follow-up drop migration needed.

---

## M8 — `ratings`: association-scope the global rating catalogue (add `association_id` + `sort_order` + FK + unique key + indexes)

**Status: Pending**

### Goal

Migrate the production `ratings` table from a **global** lookup to an **association-scoped** catalogue per [`sql-schema-association.md#ratings`](./sql-schema-association.md#ratings). Specifically:

- Add `association_id BIGINT UNSIGNED NOT NULL` (the new owning-association FK).
- Add `sort_order INT NOT NULL DEFAULT 0` (display order within the association).
- Add the soft-delete-aware unique key `(association_id, rate, deleted_at)` so a label is unique per association and re-creatable after a retire (soft delete).
- Add the FK `association_id → associations(id)` (CASCADE) + audit-by FKs to `users(id)` (SET NULL) if not already present.
- Add indexes `(association_id, status)`, `(deleted_at)`, and the audit-by columns.

The existing columns (`id`, `rate`, `status`, audit) are **unchanged** — `rate` is **NOT** renamed. No column drops.

> **Backfill (important).** Production `ratings` rows are currently global (no `association_id`). The new column is `NOT NULL`, so it must be backfilled before the constraint is enforced. **The dev team confirms the mapping** — existing global rows are assigned to the relevant association(s) (e.g. the legacy SSUSA tiers `AA` / `AAA` / `Major` / `Major +` / `Major Gold` map to the SSUSA association; if more than one association historically shared the global list, the rows are duplicated per association so each owns its own copy). Do **not** run the FK / NOT-NULL step until the backfill mapping is signed off.

### Prerequisites

- `associations` table exists with a `BIGINT UNSIGNED` PK (M1).
- `users` table exists with a `BIGINT UNSIGNED` PK before the audit-by FKs.
- The dev-team-confirmed global-row → association mapping (see backfill note above).

### Pre-flight checks

```sql
-- 1. Current global rows — confirm the set being migrated + plan the per-association mapping.
SELECT id, rate, status, deleted_at FROM ratings ORDER BY id;

-- 2. Duplicate-label check WITHIN the planned per-association assignment.
--    After mapping every row to an association_id, no live (association_id, rate)
--    pair may repeat or the unique key add (Step 3) fails. Run this against a
--    scratch column / staging copy that already has the mapping applied:
SELECT association_id, rate, deleted_at, COUNT(*) AS dup_count
FROM ratings
WHERE deleted_at IS NULL
GROUP BY association_id, rate, deleted_at
HAVING COUNT(*) > 1;

-- 3. Audit-by orphan check (only if those columns hold stale ids).
SELECT COUNT(*) FROM ratings WHERE created_by IS NOT NULL
  AND created_by NOT IN (SELECT id FROM users);
-- (repeat for updated_by, deleted_by)
```

### ALTER sequence

```sql
-- Step 1: Add the new columns. association_id is added NULLABLE first so the
-- ALTER doesn't reject the existing global rows; it's tightened to NOT NULL in
-- Step 3 after the backfill.
ALTER TABLE `ratings`
  ADD COLUMN `association_id` BIGINT UNSIGNED NULL DEFAULT NULL AFTER `id`,
  ADD COLUMN `sort_order`     INT NOT NULL DEFAULT 0 AFTER `rate`;

-- Step 2: Backfill association_id from the dev-team-confirmed mapping.
-- Example (placeholder ids — verify with the dev team BEFORE running). If a
-- single global row must serve multiple associations, INSERT a per-association
-- copy for each (rather than UPDATE) so every association owns its own row.
UPDATE `ratings` SET `association_id` = <SSUSA_ID>   WHERE `id` IN (/* SSUSA tier ids */);
-- INSERT ... SELECT to duplicate a shared global row into another association,
-- assigning a fresh sort_order, as needed.

-- Sanity: every row now has an owning association.
SELECT COUNT(*) FROM ratings WHERE association_id IS NULL;
-- Expected: 0 before proceeding.

-- Step 3: Tighten association_id to NOT NULL, add the unique key + indexes.
ALTER TABLE `ratings`
  MODIFY COLUMN `association_id` BIGINT UNSIGNED NOT NULL,
  ADD UNIQUE KEY `uk_ratings_assoc_rate` (`association_id`, `rate`, `deleted_at`),
  ADD KEY `idx_ratings_assoc_status` (`association_id`, `status`),
  ADD KEY `idx_ratings_deleted_at`   (`deleted_at`),
  ADD KEY `idx_ratings_created_by`   (`created_by`),
  ADD KEY `idx_ratings_updated_by`   (`updated_by`),
  ADD KEY `idx_ratings_deleted_by`   (`deleted_by`);

-- Step 4: FK constraints.
ALTER TABLE `ratings`
  ADD CONSTRAINT `fk_ratings_association` FOREIGN KEY (`association_id`) REFERENCES `associations`(`id`) ON DELETE CASCADE  ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_ratings_created_by`  FOREIGN KEY (`created_by`)     REFERENCES `users`(`id`)        ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_ratings_updated_by`  FOREIGN KEY (`updated_by`)     REFERENCES `users`(`id`)        ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_ratings_deleted_by`  FOREIGN KEY (`deleted_by`)     REFERENCES `users`(`id`)        ON DELETE SET NULL ON UPDATE CASCADE;
```

> The `divisions.rating_id → ratings(id)` and `association_teams.rating_id → ratings(id)` FKs are both `ON DELETE RESTRICT` (added in M2 for `association_teams`; the `divisions` side lands with that table's migration). RESTRICT is what makes an in-use rating un-hard-deletable — it must be retired (soft-deleted) instead. See [`sql-schema-association.md#ratings`](./sql-schema-association.md#ratings) "Delete rule".

### Post-validation

```sql
-- Schema confirmation.
SHOW CREATE TABLE `ratings`\G

-- Every row owns an association.
SELECT COUNT(*) FROM ratings WHERE association_id IS NULL;
-- Expected: 0.

-- Unique key working (per association).
INSERT INTO ratings (association_id, rate) VALUES (1, 'AA');
INSERT INTO ratings (association_id, rate) VALUES (1, 'AA');
-- Expected: ERROR 1062 (23000): Duplicate entry on uk_ratings_assoc_rate
-- But the same label under a DIFFERENT association is allowed:
INSERT INTO ratings (association_id, rate) VALUES (2, 'AA');
-- Expected: OK.

-- FK constraints in place.
SELECT CONSTRAINT_NAME, REFERENCED_TABLE_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ratings'
  AND CONSTRAINT_NAME LIKE 'fk_%';
-- Expected: 4 rows (association + 3 audit-by).
```

### Rollback notes

- Step 4 (FKs): `DROP FOREIGN KEY` for each — instant.
- Step 3 (unique key + indexes + NOT NULL): `DROP INDEX` for each; re-`MODIFY` `association_id` back to NULLABLE.
- Steps 1–2 (columns + backfill): `DROP COLUMN association_id, sort_order` — instant; data lost on the new columns only. The original global `rate` / `status` rows are untouched throughout, so reverting to the pre-migration global-lookup behaviour just requires dropping the two new columns + re-pointing the API at the legacy `GET /getAllRatings`.

---

## M9 — `association_reg_settings`: drop mistaken invite columns + add unique key / FKs / indexes

**Status: Pending**

### Goal

Align the production `association_reg_settings` table with the documented shape in [`sql-schema-association.md#association_reg_settings`](./sql-schema-association.md#association_reg_settings). The original DDL carried four columns copied from the invite pattern that **do not belong** on a registration-settings table; drop them and add the keys it was missing:

- **Drop** `permissions_json`, `invite_id`, `invite_status`, `invited_at` (and any index on `invite_id`).
- Add the unique key `(association_id, registration_type)` — one settings row per association per type (`0=team / 1=player / 2=umpire`).
- Add the FK `association_id → associations(id)` (CASCADE) + audit-by FKs to `users(id)` (SET NULL).
- Add indexes backing the audit-by columns.

The settings columns (`registration_type`, `allow_self_registration`, `payment_applicable`, `applicable_fee`, `never_expires`, `duration_days`) and the PK are **unchanged** — no renames.

> **Data note.** The four dropped columns were never part of the feature's intent and are expected to be empty/unused. Confirm they hold no data worth keeping before dropping (pre-flight check 1). The drop is destructive for those columns only.

### Prerequisites

- `associations` table exists with a `BIGINT UNSIGNED` PK (M1).
- `users` table exists with a `BIGINT UNSIGNED` PK before the audit-by FKs.

### Pre-flight checks

```sql
-- 1. Confirm the invite columns are unused before dropping (expect 0 / all NULL).
SELECT
  COUNT(*) AS total,
  COUNT(`permissions_json`) AS has_permissions,
  COUNT(`invite_id`)        AS has_invite_id,
  COUNT(`invite_status`)    AS has_invite_status,
  COUNT(`invited_at`)       AS has_invited_at
FROM `association_reg_settings`;

-- 2. Duplicate (association_id, registration_type) check — must be empty or the
--    unique-key add (Step 2) fails. Collapse / clean duplicates first if any.
SELECT `association_id`, `registration_type`, COUNT(*) AS dup_count
FROM `association_reg_settings`
GROUP BY `association_id`, `registration_type`
HAVING COUNT(*) > 1;

-- 3. Orphaned association_id (would block the FK).
SELECT COUNT(*) FROM `association_reg_settings`
WHERE `association_id` IS NOT NULL
  AND `association_id` NOT IN (SELECT `id` FROM `associations`);

-- 4. Orphaned audit-by ids (repeat for updated_by).
SELECT COUNT(*) FROM `association_reg_settings`
WHERE `created_by` IS NOT NULL
  AND `created_by` NOT IN (SELECT `id` FROM `users`);
```

### ALTER sequence

```sql
-- Step 1: Drop the mistaken invite columns. Drop the invite_id index first if
-- one exists (otherwise the column DROP fails / is slower).
-- ALTER TABLE `association_reg_settings` DROP INDEX `idx_association_reg_settings_invite_id`; -- only if present
ALTER TABLE `association_reg_settings`
  DROP COLUMN `permissions_json`,
  DROP COLUMN `invite_id`,
  DROP COLUMN `invite_status`,
  DROP COLUMN `invited_at`;

-- Step 2: Unique key + audit indexes.
ALTER TABLE `association_reg_settings`
  ADD UNIQUE KEY `uk_association_reg_settings_assoc_type` (`association_id`, `registration_type`),
  ADD KEY `idx_association_reg_settings_created_by` (`created_by`),
  ADD KEY `idx_association_reg_settings_updated_by` (`updated_by`);

-- Step 3: FK constraints.
ALTER TABLE `association_reg_settings`
  ADD CONSTRAINT `fk_association_reg_settings_association` FOREIGN KEY (`association_id`) REFERENCES `associations`(`id`) ON DELETE CASCADE  ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_association_reg_settings_created_by`  FOREIGN KEY (`created_by`)     REFERENCES `users`(`id`)        ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_association_reg_settings_updated_by`  FOREIGN KEY (`updated_by`)     REFERENCES `users`(`id`)        ON DELETE SET NULL ON UPDATE CASCADE;
```

### Post-validation

```sql
-- Schema confirmation — the four invite columns are gone; keys present.
SHOW CREATE TABLE `association_reg_settings`\G

-- Unique key working: one row per (association, type).
INSERT INTO association_reg_settings (association_id, registration_type) VALUES (1, 0);
INSERT INTO association_reg_settings (association_id, registration_type) VALUES (1, 0);
-- Expected: ERROR 1062 (23000): Duplicate entry on uk_association_reg_settings_assoc_type
-- A different type under the same association is allowed:
INSERT INTO association_reg_settings (association_id, registration_type) VALUES (1, 1);
-- Expected: OK.

-- FK constraints in place.
SELECT CONSTRAINT_NAME, REFERENCED_TABLE_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'association_reg_settings'
  AND CONSTRAINT_NAME LIKE 'fk_%';
-- Expected: 3 rows (association + created_by + updated_by).
```

### Rollback notes

- Step 3 (FKs): `DROP FOREIGN KEY` for each — instant.
- Step 2 (keys): `DROP INDEX uk_association_reg_settings_assoc_type` / the two audit indexes — instant.
- Step 1 (dropped columns): re-add via `ADD COLUMN` with the original definitions if a true revert is needed — but the dropped column **data is lost** (acceptable, since the columns were unused by design).

---

## M10 — `association_reg_settings`: add per-type payment-rail columns

**Status: Pending**

### Goal

Add the two per-type payment-rail flags introduced with the Registration Settings popup's "Registration Fees" section, so each `(association, registration_type)` can declare which collection rails it accepts:

- **`allow_card_payment`** `TINYINT(1) DEFAULT 1` — online credit-card (Stripe) accepted for this type. Only meaningful when `payment_applicable = 1`. Stored `0` when the association has no Stripe Connect account (card can't be a rail without it).
- **`allow_offline_payment`** `TINYINT(1) DEFAULT 1` — manual cash/cheque/bank-transfer/other accepted. Turning it `0` (with card on) funnels all collection for the type through Stripe — admins can't record manual payments and the team Register wizard hides the offline collection option.

Both default `1` so existing rows keep today's behavior (both rails open). Application rule (enforced in the API, not the DB): at least one **usable** rail when `payment_applicable = 1` (card only counts as usable when Stripe is connected). Matches the documented shape in [`sql-schema-association.md#association_reg_settings`](./sql-schema-association.md#association_reg_settings).

### Prerequisites

- M9 applied (canonical `association_reg_settings` shape — invite columns dropped, keys/FKs in place).

### Pre-flight checks

```sql
-- Confirm the columns don't already exist (expect 0 rows).
SELECT COLUMN_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'association_reg_settings'
  AND COLUMN_NAME IN ('allow_card_payment', 'allow_offline_payment');
```

### ALTER sequence

```sql
ALTER TABLE `association_reg_settings`
  ADD COLUMN `allow_card_payment`    TINYINT(1) NOT NULL DEFAULT 1 AFTER `applicable_fee`,
  ADD COLUMN `allow_offline_payment` TINYINT(1) NOT NULL DEFAULT 1 AFTER `allow_card_payment`;
```

### Post-validation

```sql
-- Columns present with the expected default.
SELECT COLUMN_NAME, COLUMN_DEFAULT, IS_NULLABLE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'association_reg_settings'
  AND COLUMN_NAME IN ('allow_card_payment', 'allow_offline_payment');
-- Expected: 2 rows, COLUMN_DEFAULT = 1, IS_NULLABLE = NO.

-- Existing rows defaulted to both rails open.
SELECT COUNT(*) AS rows_total,
       SUM(allow_card_payment)    AS card_on,
       SUM(allow_offline_payment) AS offline_on
FROM `association_reg_settings`;
-- Expected: card_on = offline_on = rows_total.
```

### Rollback notes

- `ALTER TABLE association_reg_settings DROP COLUMN allow_offline_payment, DROP COLUMN allow_card_payment;` — instant; the flags carry no referential data.

---

## Future migrations

Append new sections here as additional production tables are aligned with the canonical schema. Suggested next:

- `users` — once the user provides the canonical production schema.
- `event_divisions`, `event_parks` — when these tables are documented in `sql-schema.md`.
- `event_joined_team` — team-participation rows. Add covering index `idx_ejt_event_status (event_id, deleted_at, status)` to back the events-list status-breakdown aggregate (no cached counter on `team_events`).
- `payment_orders`, `payables` — when the payments tables get their canonical schema.
- `teams`, `team_members` — when the team-roster tables are documented.
- A coordinated **collation alignment** migration to bring `association_teams` from `utf8mb4_general_ci` to `utf8mb4_unicode_ci` along with the rest of the schema. Cross-table; needs a planned window.
- A **webhook events retention** migration to add a periodic-cleanup cron for `stripe_webhook_events`.
