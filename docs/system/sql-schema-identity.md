---
status: Draft
owner: shared
last_updated: 2026-06-15
---

# SQL Schema — Identity Tables

Domain-split slice of the WhoIFollow schema. **Shared conventions** — engine/charset/collation, primary keys, foreign-key rules, standard audit columns (`created_at`/`updated_at`/`deleted_at`/`created_by`/`updated_by`/`deleted_by`), UTC timestamp handling, soft-delete, and naming — live in [`sql-schema.md`](./sql-schema.md) and apply to every table here.

This doc holds global identity tables — the `users` master that every other table's audit-by columns (`created_by`/`updated_by`/`deleted_by`) reference. Future auth/session/device tables land here too.

## Tables in this doc

- [`users`](#users)

---

### `users`

> **🚧 Tentative — pending user-supplied production schema.** Do not implement against this section. The CREATE script + field table below is the placeholder design we sketched while building the `association_users` and `invites` contracts. The canonical `users` table will be pasted in here when the team shares its production DDL.

#### Purpose

Global user identity. Every human in the platform — admins, association staff, team managers, players, followers — has exactly one row here. Other tables (`association_users`, `event_officials`, `team_members`, etc.) reference `users.id` to attach role / scope / association-specific state without duplicating identity fields.

#### CREATE script

```sql
CREATE TABLE `users` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`         VARCHAR(160) NOT NULL,
  `email`        VARCHAR(190) NOT NULL,
  `email_verified_at` TIMESTAMP NULL DEFAULT NULL,
  `avatar_url`   VARCHAR(500) NULL DEFAULT NULL,
  `phone_code`   VARCHAR(8) NULL DEFAULT NULL,
  `phone_number` VARCHAR(32) NULL DEFAULT NULL,
  `password_hash` VARCHAR(255) NULL DEFAULT NULL,
  `last_login_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`   TIMESTAMP NULL DEFAULT NULL,
  `created_by`   BIGINT UNSIGNED NULL DEFAULT NULL,
  `updated_by`   BIGINT UNSIGNED NULL DEFAULT NULL,
  `deleted_by`   BIGINT UNSIGNED NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_users_email` (`email`),
  KEY `idx_users_deleted_at` (`deleted_at`),
  KEY `idx_users_created_by` (`created_by`),
  KEY `idx_users_updated_by` (`updated_by`),
  KEY `idx_users_deleted_by` (`deleted_by`),
  CONSTRAINT `fk_users_created_by` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_users_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_users_deleted_by` FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment user identifier. |
| `name` | VARCHAR(160) | Display name shown across the portal. |
| `email` | VARCHAR(190) | Login email. Globally unique. 190 cap to fit in a utf8mb4 unique index. |
| `email_verified_at` | TIMESTAMP NULL | Set when the user confirms their email. Drives "verified" badges. |
| `avatar_url` | VARCHAR(500) NULL | CDN URL of the user's avatar. NULL falls back to initial-on-color in the UI. |
| `phone_code` | VARCHAR(8) NULL | Country dial code, e.g. `"+1"`. |
| `phone_number` | VARCHAR(32) NULL | Local phone digits. |
| `password_hash` | VARCHAR(255) NULL | Bcrypt / Argon2 hash. NULL only for SSO / invite-only users who haven't set a password yet. |
| `last_login_at` | TIMESTAMP NULL | Updated on every successful authentication. Drives "active in last 30 days" reports. |
| `created_at` / `updated_at` / `deleted_at` | TIMESTAMP | Standard audit + soft-delete (see Conventions). |
| `created_by` / `updated_by` / `deleted_by` | BIGINT UNSIGNED NULL | Self-FK to `users.id`. NULL on the bootstrap admin row (chicken-and-egg). |
