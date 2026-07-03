---
status: Draft
owner: shared
last_updated: 2026-06-15
---

# SQL Schema — Association Tables

Domain-split slice of the WhoIFollow schema. **Shared conventions** — engine/charset/collation, primary keys, foreign-key rules, standard audit columns (`created_at`/`updated_at`/`deleted_at`/`created_by`/`updated_by`/`deleted_by`), UTC timestamp handling, soft-delete, and naming — live in [`sql-schema.md`](./sql-schema.md) and apply to every table here.

## Tables in this doc

- [`associations`](#associations)
- [`association_users`](#association_users)
- [`association_teams`](#association_teams)
- [`association_team_lifecycle`](#association_team_lifecycle)
- [`association_followers`](#association_followers)
- [`association_reg_settings`](#association_reg_settings)
- [`ratings`](#ratings)
- [`stripe_connected_accounts`](#stripe_connected_accounts)
- [`stripe_webhook_events`](#stripe_webhook_events)

---

### `associations`

#### Purpose

Parent organization that runs events, registers teams, and grants its admins per-event scopes. Every association-prefixed table FKs into this one. The `username` column is the slug used in public URLs (`/association/<username>/portal/...`); `short_name` is an internal key.

The Stripe Connect onboarding state (account ID, charges/payouts enabled, country, currency) lives in the dedicated [`stripe_connected_accounts`](#8-stripe_connected_accounts) table — 1:1 with `associations`. The `stripe_connected` boolean here is a fast cached lookup.

#### CREATE script

```sql
CREATE TABLE `associations` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `guid`              CHAR(36) NOT NULL,
  `username`          VARCHAR(45) DEFAULT NULL,
  `logo_url`          VARCHAR(255) DEFAULT NULL,
  `cover_url`         VARCHAR(255) DEFAULT NULL,
  `association_name`  VARCHAR(255) NOT NULL,
  `short_name`        VARCHAR(45) DEFAULT NULL,
  `website_url`       VARCHAR(255) DEFAULT NULL,
  `email`             VARCHAR(150) DEFAULT NULL,
  `mobile_code`       VARCHAR(45) DEFAULT NULL,
  `mobile_number`     VARCHAR(45) DEFAULT NULL,
  `fb_url`            VARCHAR(45) DEFAULT NULL,
  `insta_url`         VARCHAR(45) DEFAULT NULL,
  `street_address`    VARCHAR(255) DEFAULT NULL,
  `city`              VARCHAR(45) DEFAULT NULL,
  `state`             VARCHAR(45) DEFAULT NULL,
  `zip_code`          VARCHAR(45) DEFAULT NULL,
  `latitude`          DECIMAL(10,7) DEFAULT NULL,
  `longitude`         DECIMAL(10,7) DEFAULT NULL,
  `notes`             VARCHAR(500) DEFAULT NULL,
  `stripe_connected`  BIT(1) DEFAULT NULL,
  `status`            ENUM('active', 'inactive', 'suspended') NOT NULL DEFAULT 'active',
  `created_at`        TIMESTAMP NULL DEFAULT NULL,
  `updated_at`        TIMESTAMP NULL DEFAULT NULL,
  `deleted_at`        TIMESTAMP NULL DEFAULT NULL,
  `created_by`        BIGINT UNSIGNED NULL DEFAULT NULL,
  `updated_by`        BIGINT UNSIGNED NULL DEFAULT NULL,
  `deleted_by`        BIGINT UNSIGNED NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_associations_guid`       (`guid`),
  UNIQUE KEY `uk_associations_username`   (`username`),
  UNIQUE KEY `uk_associations_short_name` (`short_name`),
  KEY `idx_associations_status`     (`status`),
  KEY `idx_associations_deleted_at` (`deleted_at`),
  KEY `idx_associations_created_by` (`created_by`),
  KEY `idx_associations_updated_by` (`updated_by`),
  KEY `idx_associations_deleted_by` (`deleted_by`),
  CONSTRAINT `fk_associations_created_by` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_associations_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_associations_deleted_by` FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Internal identifier referenced by every association-prefixed child table. |
| `guid` | CHAR(36) | External UUID handle (e.g. `08bb93ab-3466-4246-a4c1-694a92c2d6d8`). Used in API URLs / external integrations where exposing the auto-increment is undesirable. Globally unique. |
| `username` | VARCHAR(45) NULL | **Public URL slug** — used in `/association/<username>/portal/...` URLs. Globally unique. Lowercase recommended; immutable after creation (changing it breaks bookmarks). NULLABLE matches production but in practice every active row has one. |
| `short_name` | VARCHAR(45) NULL | **Internal key only** — stable handle used by admin tooling, reports, support. Not user-facing. Globally unique. |
| `association_name` | VARCHAR(255) | Public display name, e.g. `"Senior Softball USA"`. |
| `logo_url`, `cover_url` | VARCHAR(255) NULL | CDN URLs for the circular avatar (square at rest) and 16:9 cover photo. Edited via Settings → Profile. |
| `website_url`, `fb_url`, `insta_url` | VARCHAR | Social / web links surfaced on the public association page. |
| `email` | VARCHAR(150) NULL | Public contact email. |
| `mobile_code`, `mobile_number` | VARCHAR(45) NULL | Country dial code + local number for the association's contact phone. |
| `street_address`, `city`, `state`, `zip_code` | VARCHAR | Mailing / venue address fields. |
| `latitude`, `longitude` | DECIMAL(10,7) NULL | Geocoded coordinates of the address; populated server-side after edits, used for map / radius features. |
| `notes` | VARCHAR(500) NULL | Free-form internal notes (admin-visible, not public). |
| `stripe_connected` | BIT(1) | Cached boolean: true when [`stripe_connected_accounts`](#8-stripe_connected_accounts) has a row for this association with `onboarding_status='active'`. The actual Stripe data lives there, not here. Updated by the Stripe webhook handlers in the same transaction as the `stripe_connected_accounts` row. |
| `status` | ENUM | Platform-side status — `active` is default, `inactive` hides from public listings, `suspended` is set by support. Not editable from the portal. |
| Standard audit columns | (see Conventions) | created_at / updated_at / deleted_at + created_by / updated_by / deleted_by. |

---

### `association_users`

#### Purpose

Per-association membership row. One row per `(association, user)` tuple. Stores the user's status within this association, their granted permissions (as a JSON array), and a denormalized snapshot of their pending invite — see [`api/association-users-api-contract.md`](../api/association-users-api-contract.md) for the full API surface.

A user can be a member of many associations; each membership has independent permissions and status. **The association has full control over its users**: every event-side actor (e.g. event officials) is selected from this table, never invited independently. That means the `(association_id, user_id)` tuple is the gateway — if a user isn't here, they can't participate in any of the association's events.

#### CREATE script

```sql
CREATE TABLE `association_users` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `association_id`      BIGINT UNSIGNED NOT NULL,
  `user_id`             BIGINT UNSIGNED NULL DEFAULT NULL,                       -- NULL while pending, populated on accept
  `status`              TINYINT(1) NOT NULL DEFAULT 0,
  `permissions_json`    JSON NOT NULL,
  `invite_id`           BIGINT UNSIGNED NULL DEFAULT NULL,                       -- live FK while invite alive; NULL after retention cleanup
  `invite_status`       ENUM('pending', 'accepted', 'expired') NULL DEFAULT NULL,-- cached mirror; useful both during pending and post-accept retention
  `invited_at`          TIMESTAMP NULL DEFAULT NULL,
  `joined_at`           TIMESTAMP NULL DEFAULT NULL,
  `invited_by_user_id`  BIGINT UNSIGNED NULL DEFAULT NULL,                       -- durable inviter reference; survives invite cleanup
  `created_at`          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`          TIMESTAMP NULL DEFAULT NULL,
  `created_by`          BIGINT UNSIGNED NULL DEFAULT NULL,
  `updated_by`          BIGINT UNSIGNED NULL DEFAULT NULL,
  `deleted_by`          BIGINT UNSIGNED NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_association_users_assoc_user` (`association_id`, `user_id`, `deleted_at`),
  KEY `idx_association_users_user_id` (`user_id`),
  KEY `idx_association_users_status` (`association_id`, `status`),
  KEY `idx_association_users_invite_status` (`association_id`, `invite_status`),
  KEY `idx_association_users_invite_id` (`invite_id`),
  KEY `idx_association_users_invited_by` (`invited_by_user_id`),
  KEY `idx_association_users_deleted_at` (`deleted_at`),
  KEY `idx_association_users_created_by` (`created_by`),
  KEY `idx_association_users_updated_by` (`updated_by`),
  KEY `idx_association_users_deleted_by` (`deleted_by`),
  CONSTRAINT `fk_association_users_association`
    FOREIGN KEY (`association_id`) REFERENCES `associations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_association_users_user`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_association_users_invite`
    FOREIGN KEY (`invite_id`) REFERENCES `invites`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_association_users_invited_by`
    FOREIGN KEY (`invited_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_association_users_created_by` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_association_users_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_association_users_deleted_by` FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment membership identifier. **This is the FK target for any per-event user assignment** — `event_officials.association_user_id` will reference this column, not `users.id` directly, so the association stays the gateway. |
| `association_id` | BIGINT UNSIGNED FK | Owning association. **RESTRICT** prevents hard-deletion of an association while any membership rows still reference it — admins must soft-delete the association (set `deleted_at`) OR explicitly cancel every membership first. Protects audit trails, payment references, and lifecycle history from silent loss. |
| `user_id` | BIGINT UNSIGNED **NULL** FK | The user being granted access. **NULLABLE because the invitee may not yet have a `users` row** — admin invites by email/phone and the recipient might not have signed up yet. Populated when the invite is accepted (or on invite-send if the email/phone already matched an existing `users` row). **RESTRICT** on delete: users are normally soft-deleted, never hard-deleted; the 30-day post-self-delete cleanup job walks every user-referencing table explicitly. RESTRICT forces that orchestration. |
| `status` | TINYINT(1) | Membership flag. `0` = inactive, `1` = active. **There is no `'pending'` status value** — pending semantics are carried by the `invite_status` column instead (see Lifecycle below). API responses derive a surface `'pending'` value when `invite_status = 'pending'`, regardless of this column's value. |
| `permissions_json` | JSON | Permission set encoded per [`api/conventions.md#permission-key-encoding-permissions_json`](../api/conventions.md#permission-key-encoding-permissions_json). `["*"]` = Full Control; `["manage_events", …]` = granular keys; `[]` = no permissions yet. **Set at invite-send time** from the admin's role-preset choice; preserved on accept. |
| `invite_id` | BIGINT UNSIGNED NULL FK | Live FK reference to `invites.id`. Populated from the moment the invite is sent (membership row and invite row are created together in one transaction) and stays live through the post-accept retention window (default 30 days). After the cleanup cron purges the invite, `SET NULL` fires here. |
| `invite_status` | ENUM NULL | Cached mirror of `invites.status`. Updated in the same transaction whenever the invite changes state. Useful BOTH during pending (drives the API's surface `'pending'`) AND during the post-accept retention window (lets queries cheaply distinguish "fresh accept" from "long-time member" without a JOIN to `invites`). After invite cleanup, this stays as last-cached value (or app clears it). |
| `invited_at` | TIMESTAMP NULL | When the invite was first sent. Set on initial invite-send INSERT and unchanged by resends. Distinct from `created_at` (which never changes) because in future re-invite scenarios this can advance. |
| `joined_at` | TIMESTAMP NULL | When the user accepted the invite. NULL while the membership is still pending (`invite_status = 'pending'`). Set to `NOW()` on accept. |
| `invited_by_user_id` | BIGINT UNSIGNED NULL FK | The admin who sent the original invite. **Durable** — set at invite-send time and never modified. Survives invite cleanup so the question "who invited Jane?" is answerable indefinitely, even years after the original invite row was purged. SET NULL if that admin's user record is hard-deleted. |
| Standard audit columns | (see Conventions) | created_at / updated_at / deleted_at + created_by / updated_by / deleted_by. |

#### Lifecycle (dual-row model)

`association_users` and `invites` are written together so that **every user — pending, active, inactive — has a single row in `association_users` from invite-send onward**. This is the architectural choice that keeps the user-list query single-table and fast at scale (no UNION across tables).

The surface "pending / active / inactive" the API exposes is derived from `(status, invite_status)`. Transitions:

| Event | `association_users` writes | `invites` writes | API surface |
|---|---|---|---|
| Admin invites user | INSERT row: `user_id`=<existing-or-NULL>, `status=0`, `invite_id=<new>`, `invite_status='pending'`, `invited_at=NOW()`, `invited_by_user_id=<admin>`, `permissions_json=<from request>` | INSERT row: `status='pending'`, `target_value`, `metadata_json`, `sent_at=NOW()`, `expires_at=NOW()+30d` | `'pending'` |
| Admin resends invite | (no change) | UPDATE: `sent_at=NOW()`, `expires_at` refreshed | `'pending'` |
| User accepts the invite | If `user_id` was NULL → INSERT/resolve `users` row, then UPDATE `user_id`=<new>. THEN UPDATE: `status=1`, `invite_status='accepted'`, `joined_at=NOW()` | UPDATE: `status='accepted'` (kept for retention) | `'active'` |
| Admin disables an active user | UPDATE: `status=0` (`invite_status` unchanged) | (n/a — invite already accepted/cleaned) | `'inactive'` |
| Admin re-enables an inactive user | UPDATE: `status=1` | (n/a) | `'active'` |
| Admin cancels a pending invite | DELETE row (or soft-delete via `deleted_at`) | UPDATE: `status='cancelled'` (kept for retention) | row gone from list |
| Invite expires (cron) | UPDATE: `invite_status='expired'` (admin can resend or remove) | UPDATE: `status='expired'` (kept for retention) | `'pending'` (with expired invite badge in UI) |
| Admin removes a member | Soft-delete: `deleted_at=NOW()`, `deleted_by=<admin>` | (n/a) | row gone from list |
| Retention cleanup (cron) | (no direct change; FK `SET NULL` fires on `invite_id` when invite purged) | DELETE rows past their per-state retention window: `accepted` >30d, `cancelled`/`expired` >90d | (no API impact) |

**There is no transition back to "pending" once a user has accepted the invite.** Once `invite_status = 'accepted'`, the only state changes are toggling `status` between 0 and 1, or removing the row. To re-grant access to a previously-removed user, the admin issues a **fresh invite** (new `invites` row, new `association_users` row — the soft-deleted one stays for history, and the new row coexists with it because the unique key includes `deleted_at`).

API derivation rule (server-side, on read):

```
if invite_status === 'pending':                    surface = 'pending'
elif status === 1:                                  surface = 'active'
else:                                               surface = 'inactive'
```

Status filter SQL predicates (used by the users-list endpoint):

| API filter | SQL |
|---|---|
| `?status=pending` | `AND au.invite_status = 'pending'` |
| `?status=active`  | `AND au.status = 1 AND (au.invite_status IS NULL OR au.invite_status = 'accepted')` |
| `?status=inactive`| `AND au.status = 0 AND au.invite_status IS NULL` |
| `?status=all`     | (no extra predicate) |

#### Single-table user-list query

The list endpoint (`GET /v2/association/users/{associationId}`) reads from this one table with two PK-lookup LEFT JOINs:

```sql
SELECT
  au.id, au.user_id, au.status, au.invite_status,
  au.permissions_json, au.invited_at, au.joined_at,
  au.invited_by_user_id, au.invite_id,
  COALESCE(u.name,  CONCAT(i.first_name, ' ', i.last_name)) AS display_name,
  COALESCE(u.email, CASE WHEN i.target_type='email' THEN i.target_value END) AS display_email,
  u.avatar_url
FROM association_users au
LEFT JOIN users   u ON u.id = au.user_id      -- PK lookup; populated for accepted users
LEFT JOIN invites i ON i.id = au.invite_id    -- PK lookup; populated while invite alive
WHERE au.association_id = ?
  AND au.deleted_at IS NULL
ORDER BY display_name
LIMIT 25 OFFSET ?;
```

Both LEFT JOINs are PK lookups (~µs each). For a 25-row page that's 50 PK lookups total — scales comfortably to 100k+ rows per association.

#### Indexes

- `uk_association_users_assoc_user (association_id, user_id, deleted_at)` — enforces one live row per `(association, user)` while allowing soft-deleted history (MySQL treats NULL `deleted_at` as distinct from any timestamp value, so soft-deleted rows can coexist with new active rows). NULL `user_id` rows for pending invites coexist with each other; uniqueness for those is enforced at the app layer via the linked invite's `target_value`.
- `idx_association_users_user_id` — supports "list every association this user belongs to" queries.
- `idx_association_users_status` — supports the users-list active/inactive filter when combined with `invite_status` predicates.
- `idx_association_users_invite_status` — supports the pending-invite filter and the dashboard's "any pending invites?" aggregate.
- `idx_association_users_invite_id` — supports the LEFT JOIN to `invites` in the users-list query.
- `idx_association_users_invited_by` — supports per-admin reports ("who has admin Jane invited?").

---

### `association_teams`

#### Purpose

Team registrations within an association. One row per `(association, team)` tuple, where `team_id` is a global team identity (separate `teams` table — out of scope for this batch). Teams can be registered with multiple associations independently, each with its own validity window, status, and registration numbers.

Drives the `/association/<username>/portal/teams` listing + team-details page.

`age_group_id` and `rating_id` reference small lookup tables — `age_groups` (out of scope for this doc) and [`ratings`](#ratings) (the association-scoped skill-tier catalogue, documented below) — both FK'd in here with `ON DELETE RESTRICT`.

#### CREATE script

```sql
CREATE TABLE `association_teams` (
  `id`                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `association_team_guid`    CHAR(36) DEFAULT NULL,
  `team_id`                  BIGINT UNSIGNED DEFAULT NULL,
  `association_id`           BIGINT UNSIGNED NOT NULL,
  `registered_team_name`     VARCHAR(255) DEFAULT NULL,
  `registration_no`          VARCHAR(50) DEFAULT NULL,
  `external_reg_no`          VARCHAR(255) DEFAULT NULL,
  `registration_date`        DATETIME DEFAULT NULL,
  `street_address`           VARCHAR(150) DEFAULT NULL,
  `state`                    VARCHAR(255) DEFAULT NULL,
  `region`                   VARCHAR(255) DEFAULT NULL,
  `city`                     VARCHAR(50) DEFAULT NULL,
  `sports_type`              VARCHAR(255) DEFAULT NULL,
  `gender`                   VARCHAR(255) DEFAULT NULL,
  `age_group_id`             BIGINT UNSIGNED DEFAULT NULL,
  `rating_id`                BIGINT UNSIGNED DEFAULT NULL,
  `last_update_date`         DATETIME DEFAULT NULL,
  `manager_name`             VARCHAR(150) DEFAULT NULL,
  `mob_code`                 VARCHAR(255) DEFAULT NULL,
  `manager_phone`            VARCHAR(45) DEFAULT NULL,
  `manager_email`            VARCHAR(45) DEFAULT NULL,
  `manager_linked_user_id`   BIGINT UNSIGNED DEFAULT NULL,
  `registration_status`      INT DEFAULT NULL,
  `never_expires`            BIT(1) DEFAULT b'0',
  `expiry_date`              DATETIME DEFAULT NULL,
  `auto_renew`               BIT(1) DEFAULT b'0',
  `team_avatar`              VARCHAR(255) DEFAULT NULL,
  `created_at`               DATETIME DEFAULT NULL,
  `updated_at`               DATETIME DEFAULT NULL,
  `deleted_at`               DATETIME DEFAULT NULL,
  `created_by`               BIGINT UNSIGNED DEFAULT NULL,
  `updated_by`               BIGINT UNSIGNED DEFAULT NULL,
  `deleted_by`               BIGINT UNSIGNED DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_association_teams_guid`        (`association_team_guid`),
  UNIQUE KEY `uk_association_teams_assoc_team`  (`association_id`, `team_id`, `deleted_at`),
  UNIQUE KEY `uk_association_teams_assoc_regno` (`association_id`, `registration_no`, `deleted_at`),
  KEY `idx_association_teams_association_id`   (`association_id`),
  KEY `idx_association_teams_team_id`          (`team_id`),
  KEY `idx_association_teams_reg_status`       (`association_id`, `registration_status`),
  KEY `idx_association_teams_age_rating`       (`association_id`, `age_group_id`, `rating_id`),
  KEY `idx_association_teams_expiry`           (`association_id`, `expiry_date`),
  KEY `idx_association_teams_manager_user`     (`manager_linked_user_id`),
  KEY `idx_association_teams_age_group`        (`age_group_id`),
  KEY `idx_association_teams_rating`           (`rating_id`),
  KEY `idx_association_teams_deleted_at`       (`deleted_at`),
  KEY `idx_association_teams_created_by`       (`created_by`),
  KEY `idx_association_teams_updated_by`       (`updated_by`),
  KEY `idx_association_teams_deleted_by`       (`deleted_by`),
  CONSTRAINT `fk_association_teams_association`
    FOREIGN KEY (`association_id`) REFERENCES `associations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_association_teams_team`
    FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_association_teams_age_group`
    FOREIGN KEY (`age_group_id`) REFERENCES `age_groups`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_association_teams_rating`
    FOREIGN KEY (`rating_id`) REFERENCES `ratings`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_association_teams_manager_user`
    FOREIGN KEY (`manager_linked_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_association_teams_created_by` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_association_teams_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_association_teams_deleted_by` FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
```

> **Collation note**: this table uses `utf8mb4_general_ci` to match production. The rest of the schema uses `utf8mb4_unicode_ci`. The discrepancy should eventually be resolved with a coordinated collation pass — out of scope for this doc.

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment registration identifier. FK target for `association_team_lifecycle`. |
| `association_team_guid` | CHAR(36) NULL | External UUID handle. Used in API URLs / external integrations. Globally unique. |
| `team_id` | BIGINT UNSIGNED NULL FK | Global team identifier (`teams.id`). One team can register with many associations. **RESTRICT** on delete. |
| `association_id` | BIGINT UNSIGNED FK | Owning association. **RESTRICT** prevents hard-deletion of an association while any team registration rows still reference it. |
| `registered_team_name` | VARCHAR(255) NULL | Display name as registered with this association. May differ from the global team name in `teams.name`. |
| `registration_no` | VARCHAR(50) NULL | WIF-issued registration number (e.g. `"SSUSA00382"`). Unique per association (with soft-delete-aware unique key). |
| `external_reg_no` | VARCHAR(255) NULL | Partner / league registration number. Free-form. |
| `registration_date` | DATETIME NULL | When the team registered with this association. |
| `street_address`, `city`, `state`, `region` | VARCHAR | Team home location. Drives the listing's location filter. |
| `sports_type` | VARCHAR(255) NULL | Sport (softball, baseball, etc.). Could be ENUM later if values stabilize. |
| `gender` | VARCHAR(255) NULL | Player gender division. Could be ENUM later. |
| `age_group_id` | BIGINT UNSIGNED NULL FK | Reference to the `age_groups` lookup table. **RESTRICT** on delete (don't lose a registration's age-group context). |
| `rating_id` | BIGINT UNSIGNED NULL FK | Reference to the association-scoped [`ratings`](#ratings) skill-tier catalogue. **RESTRICT** on delete — a rating in use by any team registration (or division) can't be hard-deleted; it's retired (soft-deleted) instead. See the [`ratings`](#ratings) Notes. |
| `last_update_date` | DATETIME NULL | When the team's roster / profile was last meaningfully changed. Distinct from `updated_at` (raw row update) — this is the user-facing freshness indicator. |
| `manager_name` | VARCHAR(150) NULL | Manager display name captured at registration time. |
| `mob_code` | VARCHAR(255) NULL | Manager mobile country code. |
| `manager_phone` | VARCHAR(45) NULL | Manager local phone digits. |
| `manager_email` | VARCHAR(45) NULL | Manager email captured at registration time. |
| `manager_linked_user_id` | BIGINT UNSIGNED NULL FK | Set when the manager has a `users` row. NULL for managers tracked only by name/email (legacy / external). SET NULL on user delete. |
| `registration_status` | INT NULL | Lifecycle status (currently int — see corresponding migration to ENUM in `sql-migrations.md` when ready). Existing values map to `pending / active / expired / rejected / suspended`. |
| `never_expires` | BIT(1) | When true, the registration never expires; `expiry_date` is ignored. Surfaced by the team-card "Never Expires" badge. |
| `expiry_date` | DATETIME NULL | Expiry of the registration. Only meaningful when `never_expires = 0`. NULL for `pending` rows. |
| `auto_renew` | BIT(1) | When true, the system auto-renews the registration on expiry (if payment is on file). |
| `team_avatar` | VARCHAR(255) NULL | CDN URL of the team's avatar in this association context. |
| Standard audit columns | (see Conventions) | created_at / updated_at / deleted_at + created_by / updated_by / deleted_by. |

#### Indexes

- `uk_association_teams_guid` — globally-unique external handle.
- `uk_association_teams_assoc_team` `(association_id, team_id, deleted_at)` — one live registration per `(association, team)`. Soft-delete-aware: a removed team can be re-registered later without violating uniqueness.
- `uk_association_teams_assoc_regno` `(association_id, registration_no, deleted_at)` — registration numbers unique per association, soft-delete-aware.
- `idx_association_teams_reg_status` — supports the listing's primary filter axis.
- `idx_association_teams_age_rating` — supports the multi-dimensional filter dropdown.
- `idx_association_teams_expiry` — supports the nightly auto-expire job.

---

### `association_team_lifecycle`

#### Purpose

Append-only audit log of every status / validity change a team registration goes through. One row per mutation. The Lifecycle tab on the team-details page renders these as a timeline; admin tooling queries them by action_type / actor / date range for auditing.

The frontend type is [`TeamLifecycleEntry`](../../src/types.ts) and the action enum is `TeamLifecycleActionType`.

#### CREATE script

```sql
CREATE TABLE `association_team_lifecycle` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `association_team_id` BIGINT UNSIGNED NOT NULL,
  `team_id`             BIGINT UNSIGNED NOT NULL,
  `action_type`         ENUM(
    'register',
    'mark_active',
    'renew',
    'suspend',
    'reactivate',
    'reject',
    'validity_change'
  ) NOT NULL,
  `actor_user_id`       BIGINT UNSIGNED NULL DEFAULT NULL,
  `occurred_at`         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `from_status`         ENUM('pending', 'active', 'expired', 'rejected', 'suspended') NULL DEFAULT NULL,
  `to_status`           ENUM('pending', 'active', 'expired', 'rejected', 'suspended') NOT NULL,
  `from_never_expires`  TINYINT(1) NULL DEFAULT NULL,
  `from_valid_until`    DATE NULL DEFAULT NULL,
  `to_never_expires`    TINYINT(1) NOT NULL,
  `to_valid_until`      DATE NULL DEFAULT NULL,
  `source`              ENUM('payment', 'manual') NULL DEFAULT NULL,
  `payment_order_id`    BIGINT UNSIGNED NULL DEFAULT NULL,
  `amount_cents`        INT UNSIGNED NULL DEFAULT NULL,
  `reason`              TEXT NULL,
  `metadata`            JSON NULL DEFAULT NULL,
  `created_at`          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`          TIMESTAMP NULL DEFAULT NULL,
  `created_by`          BIGINT UNSIGNED NULL DEFAULT NULL,
  `updated_by`          BIGINT UNSIGNED NULL DEFAULT NULL,
  `deleted_by`          BIGINT UNSIGNED NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_atl_team_occurred` (`association_team_id`, `occurred_at` DESC),
  KEY `idx_atl_action_occurred` (`action_type`, `occurred_at` DESC),
  KEY `idx_atl_actor` (`actor_user_id`),
  KEY `idx_atl_deleted_at` (`deleted_at`),
  KEY `idx_atl_created_by` (`created_by`),
  KEY `idx_atl_updated_by` (`updated_by`),
  KEY `idx_atl_deleted_by` (`deleted_by`),
  CONSTRAINT `fk_atl_association_team`
    FOREIGN KEY (`association_team_id`) REFERENCES `association_teams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_atl_actor`
    FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_atl_created_by` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_atl_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_atl_deleted_by` FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment audit-row identifier. |
| `association_team_id` | BIGINT UNSIGNED FK | The `association_teams` row being mutated. **RESTRICT** by policy: `association_teams` rows are permanent records (soft-delete only — `deleted_at` is the only allowed delete path). RESTRICT enforces this at the DB level — any attempt to `DELETE FROM association_teams` while audit history exists is blocked outright. Self-documenting + protects the audit chain from accidental loss. |
| `team_id` | BIGINT UNSIGNED | Denormalized copy of the parent's `team_id` so timeline queries don't need a JOIN. |
| `action_type` | ENUM | What happened. Set is closed: every status / validity mutation maps to exactly one of these. |
| `actor_user_id` | BIGINT UNSIGNED NULL FK | Admin who performed the action. NULL for system-driven rows (e.g. nightly auto-expire job). Distinct from `created_by` because for this table the actor IS the cause of the row, not just whoever happened to insert it. |
| `occurred_at` | TIMESTAMP(3) | When the change took effect. Millisecond precision so consecutive actions stay correctly ordered. |
| `from_status` / `to_status` | ENUM | Status before / after. `from_status` is NULL only on the initial `register` row. For `validity_change`, `from_status === to_status` (only validity moved). |
| `from_never_expires` / `from_valid_until` | TINYINT / DATE | Previous validity snapshot. NULL only on `register`. |
| `to_never_expires` / `to_valid_until` | TINYINT / DATE | New validity. `to_valid_until` is NULL when `to_never_expires = 1`. |
| `source` | ENUM NULL | How the renewal happened. Only set for `renew` / `mark_active`; NULL elsewhere. `payment` = customer paid; `manual` = admin override. |
| `payment_order_id` | BIGINT UNSIGNED NULL | Logical FK to a future `payment_orders` row. Non-null iff `source = 'payment'`. Not enforced as DB-level FK yet. |
| `amount_cents` | INT UNSIGNED NULL | Renewal amount in cents (avoid float for currency). Only set for `source = 'payment'`. |
| `reason` | TEXT NULL | Free-text admin note. App enforces non-empty for `suspend` / `reject`; optional elsewhere. |
| `metadata` | JSON NULL | Escape hatch for future fields without migration churn. |
| Standard audit columns | (see Conventions) | created_at / updated_at / deleted_at + created_by / updated_by / deleted_by. |

#### Indexes

- `idx_atl_team_occurred` — primary read path (timeline tab fetches one team's rows newest-first).
- `idx_atl_action_occurred` — supports admin reports filtering by action type across associations.
- `idx_atl_actor` — supports per-admin activity reports.

---

### `association_followers`

#### Purpose

Per-association follower relationship. One row per `(association, user)` follow. Inserted when a user follows the association; **hard-deleted when they unfollow**. Drives the followers count on the association profile and the "associations I follow" list on the user profile.

A simple join table — no permissions, no scoping beyond the FK pair. Distinct from `association_users` (which is a privileged membership granting admin permissions to act on behalf of the association); a follower has zero authority within the association — they just opt-in to receive its public updates.

#### CREATE script

```sql
CREATE TABLE `association_followers` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `association_id`  BIGINT UNSIGNED NOT NULL,
  `user_id`         BIGINT UNSIGNED NOT NULL,
  `created_at`      TIMESTAMP NULL DEFAULT NULL,
  `updated_at`      TIMESTAMP NULL DEFAULT NULL,
  `deleted_at`      TIMESTAMP NULL DEFAULT NULL,
  `created_by`      BIGINT UNSIGNED NULL DEFAULT NULL,
  `updated_by`      BIGINT UNSIGNED NULL DEFAULT NULL,
  `deleted_by`      BIGINT UNSIGNED NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_association_followers_assoc_user` (`association_id`, `user_id`, `deleted_at`),
  KEY `idx_association_followers_association_id` (`association_id`),
  KEY `idx_association_followers_user_id`        (`user_id`),
  KEY `idx_association_followers_deleted_at`     (`deleted_at`),
  KEY `idx_association_followers_created_by`     (`created_by`),
  KEY `idx_association_followers_updated_by`     (`updated_by`),
  KEY `idx_association_followers_deleted_by`     (`deleted_by`),
  CONSTRAINT `fk_association_followers_association`
    FOREIGN KEY (`association_id`) REFERENCES `associations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_association_followers_user`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_association_followers_created_by` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_association_followers_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_association_followers_deleted_by` FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment row identifier. |
| `association_id` | BIGINT UNSIGNED FK | The association being followed. **RESTRICT** on delete — same policy as every other direct child of `associations`. |
| `user_id` | BIGINT UNSIGNED FK | The user doing the following. **RESTRICT** on delete — the 30-day post-self-delete cleanup job removes followings explicitly before hard-deleting the user. |
| Standard audit columns | (see Conventions) | created_at / updated_at / deleted_at + created_by / updated_by / deleted_by. |

#### Soft-delete column note

`deleted_at` and `deleted_by` are present per the schema convention but are **rarely set in normal use** — unfollows hard-delete the row. The soft-delete columns exist for the rare admin-force-remove scenario where preserving history matters (e.g. spam-control review trail). Application code can elect to soft-delete instead of hard-delete on a case-by-case basis without any schema change.

The unique key includes `deleted_at` to remain compatible with both modes — under hard-delete (the default), every live row has `deleted_at = NULL` and the constraint enforces one row per `(association, user)`. Under soft-delete, multiple soft-deleted history rows can coexist with the live one because MySQL treats NULL as distinct from any timestamp value.

#### Indexes

- `uk_association_followers_assoc_user` — enforces one live follow per `(association, user)` tuple. Soft-delete-aware.
- `idx_association_followers_association_id` — supports the per-association follower count + listing (the most common query: "show me followers of association X, paginated").
- `idx_association_followers_user_id` — supports the per-user "associations I follow" list on the user's profile.

---

### `association_reg_settings`

#### Purpose

Per-association **registration settings** — the rules an association sets for each registration *type* (team / player / umpire): whether the public may **self-register**, whether a **fee** applies (and how much), and the default **validity** granted on activation (never-expires, or a fixed number of days).

**One row per `(association, registration_type)`** — team, player, and umpire each get their own row per association, so every association can set different rules + fee structures per type. These feed the registration flows: e.g. the team Register wizard's activation defaults (`never_expires` / `duration_days` → the default validity; `payment_applicable` / `applicable_fee` → the fee; `allow_card_payment` / `allow_offline_payment` → which payment rails are accepted for that type), and `allow_self_registration` gates whether a public self-registration entry point is offered for that type.

#### CREATE script

```sql
CREATE TABLE `association_reg_settings` (
  `id`                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `association_id`           BIGINT UNSIGNED DEFAULT NULL,
  `registration_type`        INT DEFAULT NULL COMMENT '0=team, 1=player, 2=umpire',
  `allow_self_registration`  TINYINT(1) DEFAULT NULL,
  `payment_applicable`       TINYINT(1) DEFAULT NULL,
  `applicable_fee`           DECIMAL(10,2) DEFAULT NULL,
  `allow_card_payment`       TINYINT(1) DEFAULT 1,
  `allow_offline_payment`    TINYINT(1) DEFAULT 1,
  `never_expires`            TINYINT(1) DEFAULT NULL,
  `duration_days`            INT DEFAULT NULL,
  `created_by`               BIGINT UNSIGNED DEFAULT NULL,
  `updated_by`               BIGINT UNSIGNED DEFAULT NULL,
  `created_at`               TIMESTAMP NULL DEFAULT NULL,
  `updated_at`               TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_association_reg_settings_assoc_type` (`association_id`, `registration_type`),
  KEY `idx_association_reg_settings_created_by` (`created_by`),
  KEY `idx_association_reg_settings_updated_by` (`updated_by`),
  CONSTRAINT `fk_association_reg_settings_association`
    FOREIGN KEY (`association_id`) REFERENCES `associations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_association_reg_settings_created_by`
    FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_association_reg_settings_updated_by`
    FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

> **Note**: the original DDL also carried `permissions_json` / `invite_id` / `invite_status` / `invited_at` columns copied from the invite pattern — these do **not** belong on a registration-settings table and are **intentionally removed** here. If they exist in the live DB, drop them in a migration. The PK was kept; the FKs + indexes above were added per schema convention (no column renames).

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment settings-row identifier. |
| `association_id` | BIGINT UNSIGNED NULL FK | Owning association (`associations.id`). **CASCADE** on delete — settings are pure config with no audit value, so they go with the association. Nullable per the source DDL. |
| `registration_type` | INT NULL | Which registration this row configures: **`0` = team, `1` = player, `2` = umpire** (per the column comment). Could migrate to an ENUM later if the set stabilizes. |
| `allow_self_registration` | TINYINT(1) NULL | When `1`, the public self-registration entry point is offered for this type; `0`/`NULL` = admin-only registration. |
| `payment_applicable` | TINYINT(1) NULL | When `1`, registration of this type requires a fee (`applicable_fee`). |
| `applicable_fee` | DECIMAL(10,2) NULL | The fee amount when `payment_applicable = 1`. |
| `allow_card_payment` | TINYINT(1) DEFAULT 1 | Whether online credit-card payment (Stripe) is an accepted rail for this type. Only meaningful when `payment_applicable = 1`. Stored `0` when the association has no Stripe Connect account (card can't be a rail without it). |
| `allow_offline_payment` | TINYINT(1) DEFAULT 1 | Whether offline payment (cash / cheque / bank transfer / other) is an accepted rail for this type. Turning it `0` (with card on) funnels all collection through Stripe — admins can't record manual payments for registrations of this type, and the team Register wizard hides the offline collection option. At least one of `allow_card_payment` / `allow_offline_payment` must be a usable rail when `payment_applicable = 1`. |
| `never_expires` | TINYINT(1) NULL | Default validity policy: `1` → registrations of this type never expire; `0` → use `duration_days`. |
| `duration_days` | INT NULL | Default validity length in days when `never_expires = 0` (e.g. `365`). Used to derive the activation expiry date. |
| `created_by` / `updated_by` | BIGINT UNSIGNED NULL FK | The `users` who created / last updated the row. **SET NULL** on user delete. |
| `created_at` / `updated_at` | TIMESTAMP NULL | Audit timestamps (no `deleted_at` — this table is not soft-deleted). |

#### Indexes

- `uk_association_reg_settings_assoc_type` `(association_id, registration_type)` — enforces **one settings row per association per registration type** (team / player / umpire), the natural integrity rule given the `registration_type` encoding. *(Drop this if multiple rows per type are ever intended.)*
- `idx_association_reg_settings_created_by` / `idx_association_reg_settings_updated_by` — back the audit FKs.

---

### `ratings`

#### Purpose

Per-association catalogue of **team skill tiers** (rating labels) — e.g. SSUSA's `AA` / `AAA` / `Major` / `Major +`, or PSA's `REC` / `COMP`. The parent of `association_teams.rating_id` and `divisions.rating_id`; consumed by the Add/Edit Division form's rating picker and managed from Settings → Ratings.

**Was a global lookup, now association-scoped.** This table historically held a single platform-wide rating list (the legacy read-only `GET /getAllRatings` lookup). It's been migrated to an **association-owned full CRUD**: each association manages its own tiers via the new `association_id` FK, so SSUSA and PSA no longer share one list. The existing columns (`id`, `rate`, `status`, audit) are retained — `rate` is **not** renamed; `association_id` + `sort_order` are the new additions. See [`api/association-ratings-api-contract.md`](../api/association-ratings-api-contract.md) for the API surface and [`sql-migrations.md`](./sql-migrations.md) for the migration.

#### CREATE script

```sql
CREATE TABLE `ratings` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `association_id` BIGINT UNSIGNED NOT NULL,   -- NEW: owning association (was a global lookup)
  `rate`           VARCHAR(255) NOT NULL,      -- display label, e.g. 'AA', 'Major +', 'REC'  (existing column; not renamed)
  `sort_order`     INT NOT NULL DEFAULT 0,     -- NEW: display order within the association
  `status`         TINYINT NOT NULL DEFAULT 1, -- 1=active, 0=inactive
  `created_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`     TIMESTAMP NULL DEFAULT NULL,
  `created_by`     BIGINT UNSIGNED NULL DEFAULT NULL,
  `updated_by`     BIGINT UNSIGNED NULL DEFAULT NULL,
  `deleted_by`     BIGINT UNSIGNED NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ratings_assoc_rate` (`association_id`, `rate`, `deleted_at`),
  KEY `idx_ratings_assoc_status` (`association_id`, `status`),
  KEY `idx_ratings_deleted_at` (`deleted_at`),
  KEY `idx_ratings_created_by` (`created_by`),
  KEY `idx_ratings_updated_by` (`updated_by`),
  KEY `idx_ratings_deleted_by` (`deleted_by`),
  CONSTRAINT `fk_ratings_association` FOREIGN KEY (`association_id`) REFERENCES `associations`(`id`) ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT `fk_ratings_created_by`  FOREIGN KEY (`created_by`)     REFERENCES `users`(`id`)        ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_ratings_updated_by`  FOREIGN KEY (`updated_by`)     REFERENCES `users`(`id`)        ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_ratings_deleted_by`  FOREIGN KEY (`deleted_by`)     REFERENCES `users`(`id`)        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment rating id. FK target for `association_teams.rating_id` and `divisions.rating_id`. |
| `association_id` | BIGINT UNSIGNED FK | **NEW** — owning association (the scoping owner). **CASCADE** — ratings die with their association (consistent with the per-association catalogues like [`custom_field_definitions`](./sql-schema-shared.md#custom_field_definitions)). |
| `rate` | VARCHAR(255) | Display label, e.g. `"AA"`, `"Major +"`, `"REC"`. **Existing column — not renamed.** The API maps `rate → name` on the wire. Unique per association (soft-delete-aware; see unique key). |
| `sort_order` | INT | **NEW** — display order within the association's rating list. Default `0`. The picker + Settings manager order by this. |
| `status` | TINYINT | `1 = active`, `0 = inactive`. Inactive ratings are hidden from the picker without being retired. Default `1`. |
| Standard audit columns | (see Conventions) | created_at / updated_at / deleted_at + created_by / updated_by / deleted_by. |

#### Indexes

- `uk_ratings_assoc_rate (association_id, rate, deleted_at)` — enforces one live `rate` label per association; `deleted_at` in the key allows re-creating a label after a soft delete (MySQL treats NULL `deleted_at` as distinct from any timestamp value, so a retired row can coexist with a freshly-recreated one).
- `idx_ratings_assoc_status (association_id, status)` — primary read path: "active ratings for this association", ordered by `sort_order`.
- `idx_ratings_deleted_at (deleted_at)` — soft-delete filtering.
- `idx_ratings_created_by` / `idx_ratings_updated_by` / `idx_ratings_deleted_by` — back the audit-by FKs.

#### Relations

- Parent: `associations.id` (live FK, **CASCADE**); audit-by columns reference `users.id` (SET NULL).
- Children: `association_teams.rating_id`, `divisions.rating_id` — both **`ON DELETE RESTRICT`** (see Notes).

#### Notes

- **Association scoping is the `association_id` owner** — there is no separate per-association allow-list table; a rating is simply a row owned by the association (same pattern as [`custom_field_definitions`](./sql-schema-shared.md#custom_field_definitions)).
- **Delete rule.** `divisions.rating_id → ratings(id)` is `ON DELETE RESTRICT` (as is `association_teams.rating_id`), so a rating **in use by any division** (or team registration) **cannot be hard-deleted** — the DB rejects it. To remove an in-use rating, **retire it** — soft-delete (set `deleted_at`) — which keeps the row so historical division / registration reads still resolve the label, while it stops appearing in the picker. Setting `status = 0` (inactive) merely hides it without retiring. **Hard delete is only valid for an unused rating** (zero referencing divisions / registrations). This mirrors how the app already retires rather than destroys other in-use catalogue rows — see [`sql-schema-shared.md#custom_field_values`](./sql-schema-shared.md#custom_field_values) "Delete rule".

---

### `stripe_connected_accounts`

#### Purpose

Stripe Connect onboarding state per association. **1:1 with `associations`** — each association has at most one connected Stripe account. The `associations.stripe_connected` boolean flag is a fast cached lookup; this table holds the actual Stripe account ID, onboarding status, charges/payouts capability flags, and the country/currency the account is configured for.

Lives separate from `associations` because the Stripe state has its own lifecycle (onboarding can take days, capabilities can be revoked by Stripe independently of any user action) and ties neatly into the Stripe webhook event handlers — webhooks for a connected account update this table directly.

#### CREATE script

```sql
CREATE TABLE `stripe_connected_accounts` (
  `id`                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `association_id`           BIGINT UNSIGNED NOT NULL,
  `stripe_account_id`        VARCHAR(100) NOT NULL,
  `account_type`             ENUM('express', 'standard', 'custom') NOT NULL DEFAULT 'express',
  `country`                  VARCHAR(10) DEFAULT NULL,
  `default_currency`         VARCHAR(10) DEFAULT NULL,
  `email`                    VARCHAR(255) DEFAULT NULL,
  `charges_enabled`          TINYINT(1) NOT NULL DEFAULT 0,
  `payouts_enabled`          TINYINT(1) NOT NULL DEFAULT 0,
  `details_submitted`        TINYINT(1) NOT NULL DEFAULT 0,
  `onboarding_status`        ENUM('pending', 'restricted', 'active', 'disabled') NOT NULL DEFAULT 'pending',
  `onboarding_completed_at`  DATETIME DEFAULT NULL,
  `last_synced_at`           DATETIME DEFAULT NULL,
  `created_at`               TIMESTAMP NULL DEFAULT NULL,
  `updated_at`               TIMESTAMP NULL DEFAULT NULL,
  `deleted_at`               TIMESTAMP NULL DEFAULT NULL,
  `created_by`               BIGINT UNSIGNED NULL DEFAULT NULL,
  `updated_by`               BIGINT UNSIGNED NULL DEFAULT NULL,
  `deleted_by`               BIGINT UNSIGNED NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sca_stripe_account_id` (`stripe_account_id`),
  UNIQUE KEY `uk_sca_association_id`    (`association_id`),
  KEY `idx_sca_onboarding_status` (`onboarding_status`),
  KEY `idx_sca_deleted_at`        (`deleted_at`),
  KEY `idx_sca_created_by`        (`created_by`),
  KEY `idx_sca_updated_by`        (`updated_by`),
  KEY `idx_sca_deleted_by`        (`deleted_by`),
  CONSTRAINT `fk_sca_association`  FOREIGN KEY (`association_id`) REFERENCES `associations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_sca_created_by`   FOREIGN KEY (`created_by`)     REFERENCES `users`(`id`)        ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_sca_updated_by`   FOREIGN KEY (`updated_by`)     REFERENCES `users`(`id`)        ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_sca_deleted_by`   FOREIGN KEY (`deleted_by`)     REFERENCES `users`(`id`)        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment row identifier. |
| `association_id` | BIGINT UNSIGNED FK | Owning association. **RESTRICT** on delete — Stripe history is critical for financial reconciliation; never let an association be silently deleted while a connected Stripe account row references it. |
| `stripe_account_id` | VARCHAR(100) | Stripe-issued account ID, e.g. `acct_1Hh2ABCdefGHI`. Globally unique. |
| `account_type` | ENUM | Stripe Connect account flavor — `express` is the default; `standard` and `custom` are supported but rare. |
| `country` | VARCHAR(10) NULL | ISO 3166-1 alpha-2 country code the Stripe account is registered in. |
| `default_currency` | VARCHAR(10) NULL | ISO 4217 currency code (`USD`, `CAD`, …) for the account's default payout currency. |
| `email` | VARCHAR(255) NULL | Email Stripe holds on file for the account (may differ from the association's contact email). |
| `charges_enabled` | TINYINT(1) | Stripe-reported flag — true when the account can accept charges. |
| `payouts_enabled` | TINYINT(1) | Stripe-reported flag — true when payouts to the account's bank are enabled. |
| `details_submitted` | TINYINT(1) | Stripe-reported flag — true when the account has submitted all required onboarding details. |
| `onboarding_status` | ENUM | Coarse status — `pending` (just started), `restricted` (Stripe needs more info), `active` (fully onboarded), `disabled` (account suspended). The `associations.stripe_connected` cached boolean derives from `onboarding_status='active'`. |
| `onboarding_completed_at` | DATETIME NULL | When `onboarding_status` first transitioned to `active`. Drives the "Stripe Connect: connected since …" UI hint. |
| `last_synced_at` | DATETIME NULL | When the row was last refreshed from Stripe (either via webhook or a polling sync). Used to detect stale rows. |
| Standard audit columns | (see Conventions) | created_at / updated_at / deleted_at + created_by / updated_by / deleted_by. |

#### Indexes

- `uk_sca_stripe_account_id` — webhook handlers look up rows by Stripe's account ID; needs uniqueness for the dispatch path.
- `uk_sca_association_id` — enforces the 1:1 with associations and supports the "find this association's Stripe account" query in O(1).
- `idx_sca_onboarding_status` — supports admin dashboards counting accounts by status.

---

### `stripe_webhook_events`

#### Purpose

System log of every Stripe webhook event received by the platform. Each row stores the full Stripe event payload as JSON for replay / audit, plus a processing-status flag the worker uses to track which events have been handled. Handlers are expected to be idempotent — the unique key on `stripe_event_id` enforces single-processing; retried deliveries don't create duplicate rows.

This is a **system-write-only log table** — there are no user-facing CRUD operations. As a deliberate convention exception, it does not carry the standard `created_by` / `updated_by` / `deleted_by` audit columns (every write is from the Stripe webhook handler, never from a user action).

#### CREATE script

```sql
CREATE TABLE `stripe_webhook_events` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `stripe_event_id`     VARCHAR(100) NOT NULL,
  `stripe_account_id`   VARCHAR(100) DEFAULT NULL COMMENT 'Null for platform events, populated for connected accounts',
  `event_type`          VARCHAR(100) NOT NULL,
  `livemode`            TINYINT(1) NOT NULL DEFAULT 0,
  `payload_json`        JSON NOT NULL,
  `processing_status`   ENUM('pending', 'processed', 'failed', 'ignored') NOT NULL DEFAULT 'pending',
  `processed_at`        DATETIME DEFAULT NULL,
  `failure_reason`      TEXT,
  `created_at`          TIMESTAMP NULL DEFAULT NULL,
  `updated_at`          TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_swe_stripe_event_id`     (`stripe_event_id`),
  KEY `idx_swe_event_type`                 (`event_type`),
  KEY `idx_swe_processing_status`          (`processing_status`),
  KEY `idx_swe_created_at`                 (`created_at`),
  KEY `idx_swe_account_event`              (`stripe_account_id`, `event_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Auto-increment row identifier. |
| `stripe_event_id` | VARCHAR(100) | Stripe-issued event ID, e.g. `evt_1Hh2…`. **Globally unique** — Stripe redelivers the same event ID on retry; the unique key makes the handler idempotent (INSERT IGNORE or ON DUPLICATE KEY UPDATE). |
| `stripe_account_id` | VARCHAR(100) NULL | NULL for platform-level events (e.g. `account.application.deauthorized`); populated for events scoped to a specific connected account. Not FK'd to `stripe_connected_accounts` because Stripe may emit events for accounts we don't have rows for yet (deferred handling). |
| `event_type` | VARCHAR(100) | Stripe event type, e.g. `account.updated`, `charge.succeeded`, `payout.paid`. |
| `livemode` | TINYINT(1) | True when the event came from Stripe's live mode; false for test mode. |
| `payload_json` | JSON | Full Stripe event payload, retained for replay / audit / debugging. |
| `processing_status` | ENUM | `pending` (received, not yet handled), `processed` (handler completed successfully), `failed` (handler errored — see `failure_reason`), `ignored` (handler decided this event type is not relevant). |
| `processed_at` | DATETIME NULL | When the handler last finished processing (success or failure). |
| `failure_reason` | TEXT NULL | Human-readable error from the most recent failed processing attempt. |
| `created_at`, `updated_at` | TIMESTAMP | When the webhook arrived / was last touched. |

#### Indexes

- `uk_swe_stripe_event_id` — idempotency dedup (Stripe retries deliver the same event ID).
- `idx_swe_event_type` — supports type-filtered admin views ("show me all `payout.failed` events").
- `idx_swe_processing_status` — supports the worker scheduler ("find all `pending` rows to process") and the stuck-event monitor ("find all rows in `failed` for >1h").
- `idx_swe_created_at` — supports time-range queries (last hour / last day) for monitoring dashboards.
- `idx_swe_account_event` — supports per-account event timelines ("show all events for this Stripe account, newest first").

#### Retention

Webhook events accumulate indefinitely under this design. A future retention policy (e.g. archive or drop events past 365 days for `processed` rows; keep `failed` rows longer for forensic value) is recommended but not part of this canonical schema. Track as a follow-up task.
