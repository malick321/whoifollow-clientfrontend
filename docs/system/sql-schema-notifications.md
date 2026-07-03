---
status: Draft
owner: shared
last_updated: 2026-06-15
---

# SQL Schema — Notifications Tables

Domain-split slice of the WhoIFollow schema. **Shared conventions** — engine/charset/collation, primary keys, foreign-key rules, standard audit columns (`created_at`/`updated_at`/`deleted_at`/`created_by`/`updated_by`/`deleted_by`), UTC timestamp handling, soft-delete, and naming — live in [`sql-schema.md`](./sql-schema.md) and apply to every table here.

## Tables in this doc

- [`team_notifications` + `team_notification_recipients`](#team_notifications--team_notification_recipients)

---

### `team_notifications` + `team_notification_recipients` (DRAFT)

> **DRAFT — not yet implemented.** Backs the admin → team **"Notify teams"**
> composer (`src/components/SendNotificationModal.vue`,
> `src/api/matchGeniNotifications.ts`). Mock-first; finalise jointly with the
> user before backend work. API draft:
> [`../api/matchgeni-notifications-api-contract.md`](../api/matchgeni-notifications-api-contract.md).

A **notification** is one admin-composed message targeted at a set of a
division's teams; **recipients** fan it out one row per resolved contact ×
channel so each delivery has its own status. The composer keys recipients on
team **name** today (the standings payload carries no `teamId`) — the join to
`association_teams` resolves the manager / linked-user contact at send time.

```sql
CREATE TABLE `team_notifications` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `association_id` BIGINT UNSIGNED NOT NULL,
  `event_id`       BIGINT UNSIGNED NOT NULL,             -- team_events.id
  `division_id`    BIGINT UNSIGNED NOT NULL,             -- event_tournaments.id
  `category`       ENUM('result','schedule_change','custom',
                        'payment_reminder','registration_reminder','promotion')
                   NOT NULL DEFAULT 'custom',
  `audience`       ENUM('team','manager') NOT NULL DEFAULT 'team',
  `channels`       JSON NOT NULL,                          -- ["in_app","email"]
  `subject`        VARCHAR(200) NOT NULL,
  `body`           TEXT NULL,
  `status`         ENUM('sent','queued','failed') NOT NULL DEFAULT 'queued',
  `created_by`     BIGINT UNSIGNED NULL,                   -- users.id (admin)
  `created_at`     TIMESTAMP NULL DEFAULT NULL,
  `updated_at`     TIMESTAMP NULL DEFAULT NULL,
  `deleted_at`     TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_team_notifications_division`        (`division_id`, `created_at`),
  KEY `idx_team_notifications_event`           (`event_id`),
  KEY `idx_team_notifications_association`      (`association_id`),
  KEY `idx_team_notifications_deleted_at`      (`deleted_at`),
  CONSTRAINT `fk_team_notifications_division`
    FOREIGN KEY (`division_id`) REFERENCES `event_tournaments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_team_notifications_created_by`
    FOREIGN KEY (`created_by`)  REFERENCES `users`(`id`)             ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `team_notification_recipients` (
  `id`                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `notification_id`          BIGINT UNSIGNED NOT NULL,
  `association_team_id`      BIGINT UNSIGNED NULL,         -- association_teams.id (resolved)
  `team_name`                VARCHAR(150) NOT NULL,        -- snapshot (mock identity / audit)
  `manager_linked_user_id`   BIGINT UNSIGNED NULL,         -- users.id, if the manager has an account
  `channel`                  ENUM('in_app','email') NOT NULL,
  `delivery_status`          ENUM('sent','queued','failed') NOT NULL DEFAULT 'queued',
  `error_detail`             VARCHAR(255) NULL,
  `created_at`               TIMESTAMP NULL DEFAULT NULL,
  `updated_at`               TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tnr_notification`        (`notification_id`),
  KEY `idx_tnr_association_team`    (`association_team_id`),
  KEY `idx_tnr_linked_user`         (`manager_linked_user_id`),
  CONSTRAINT `fk_tnr_notification`
    FOREIGN KEY (`notification_id`)        REFERENCES `team_notifications`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_tnr_association_team`
    FOREIGN KEY (`association_team_id`)     REFERENCES `association_teams`(`id`)  ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_tnr_linked_user`
    FOREIGN KEY (`manager_linked_user_id`)  REFERENCES `users`(`id`)             ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

> **ON DELETE choices**: recipients `CASCADE` off the parent notification
> (no orphan deliveries); the `association_team` / linked-user FKs
> `SET NULL` (keep the delivery audit row — with its `team_name` snapshot —
> even if a team or user is later removed). The division FK is `RESTRICT`
> (divisions soft-delete; their notification history is retained).
> `channels` on the parent is the **composed** channel set; each recipient
> row records the **actual** per-channel delivery so a partial failure
> (email bounced, in-app fine) is representable.

#### `team_notifications` fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment row id. |
| `association_id` / `event_id` / `division_id` | BIGINT UNSIGNED | Scope. `division_id` **RESTRICT** to `event_tournaments`. |
| `category` | ENUM | Drives the default template + the History badge tone. |
| `audience` | ENUM | `team` = whole team; `manager` = manager only. |
| `channels` | JSON | Composed channel set, e.g. `["in_app","email"]`. |
| `subject` / `body` | VARCHAR / TEXT | Message. `{teamName}` personalised per recipient at send. |
| `status` | ENUM | Roll-up delivery state. |
| `created_by` | BIGINT UNSIGNED NULL | Sending admin (`users.id`). **SET NULL**. |
| `created_at`, `updated_at`, `deleted_at` | TIMESTAMP NULL | Standard timestamps + soft-delete. |

#### `team_notification_recipients` fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment row id. |
| `notification_id` | BIGINT UNSIGNED FK | Owning notification. **CASCADE**. |
| `association_team_id` | BIGINT UNSIGNED NULL FK | Resolved team (`association_teams.id`). **SET NULL**. |
| `team_name` | VARCHAR(150) | Snapshot of the targeted team name (mock identity + audit). |
| `manager_linked_user_id` | BIGINT UNSIGNED NULL FK | Manager's account (`users.id`) if linked. **SET NULL**. |
| `channel` | ENUM | This delivery's channel (`in_app` / `email`). |
| `delivery_status` | ENUM | Per-channel state (`sent` / `queued` / `failed`). |
| `error_detail` | VARCHAR(255) NULL | Failure reason (e.g. bounce) when `failed`. |
| `created_at`, `updated_at` | TIMESTAMP NULL | Standard timestamps. |
