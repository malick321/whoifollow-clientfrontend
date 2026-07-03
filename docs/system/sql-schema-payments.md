# SQL Schema — Payments Tables

A **generic, platform-wide money ledger** — NOT association-specific. The same
core tables (orders / payables / transactions, the item-type catalogue, and the
platform-fee rules) serve every collector on WIF:

- **WIF → Association** — portal-usage / platform fees charged to an association.
- **Association → team / player / umpire** — registration fees.
- **Platform → team / user** — verified-badge, tokens, subscriptions, MyLifeBook.
- **(future) Park portal**, shop orders, manual charges.

## Tables in this doc

- [`payment_orders`](#payment_orders) — the payer-facing master record (one payment event).
- [`payables`](#payables) — line items under an order; **each belongs to exactly one entity**.
- [`payment_item_types`](#payment_item_types) — catalogue of *what* a payable can be for.
- [`payment_transactions`](#payment_transactions) — individual payments recorded against an order (partial payments, cash / cheque / card / bank / Stripe objects, refunds).
- [`platform_fee_rules`](#platform_fee_rules) — how WIF's platform fee is computed for a charge (by item type + scope).
- [`platform_fee_tiers`](#platform_fee_tiers) — amount-banded sub-rules for `tiered` fee rules (reserved — not yet used).

## Conventions

- **`owner_type` legend (shared across these tables): `0 = Platform`, `1 = Association`, `2 = Park`.** "Owner" = whoever **collects** the money (the settlement recipient), distinct from the **payer** (`payment_orders.payer_user_id`).
- **Creation is backend-owned.** The frontend never builds orders / payables / transactions. On a registration (or any billable action) the client sends the entity info **plus a few flags/selections** (does a fee apply, collection method); the backend decides whether to create a `payment_order` + `payable(s)` and how. No association fee configured → no order is created at all.
- IDs serialize as numeric strings on the wire per [`conventions.md`](../api/conventions.md); DB names appear only here.

## How the tables fit together

```
payment_orders (1) ──< payables          (line items; 1 order → N payables)
payment_orders (1) ──< payment_transactions (payments; 1 order → N transactions)
payables        (N) >── payment_item_types  (what kind of charge)
payables        (1) ──? payment_transactions.payable_id (optional per-line allocation)
payment_transactions ──? parent_transaction_id (self-ref: refund → its charge, etc.)
```

- An **order** is one payment event with one payer. `order_type = 'single'` → one payable; `order_type = 'mixed'` → several payables bundled under one payment (e.g. a team self-registering for an **event** while not yet **association-registered** → two payables, `event_team_registration` + `association_team_registration`, under one order).
- Because **each payable carries its own `owner_type` / `owner_association_id`**, the lines of a mixed order can settle to **different owners** (association line → that association's Stripe account; platform line → WIF). This is what enables split settlement.
- A **payable points at exactly one entity**: its `payment_item_type_id` says *what kind* (pricing/category), and the entity is identified by the **dedicated id column** for the first-class entities — `team_id`, `player_id`, `umpire_id`, `user_id` (indexed for fast lookup/search) — plus `event_id` / `association_id` for scope. The generic `related_entity_type` / `related_entity_id` pair is **only** for entities that have **no** dedicated column (shop order, MyLifeBook, token, badge, etc.). So an **association team registration** payable sets `team_id` (global team) + `association_id` + `payment_item_type = association_team_registration` — `related_entity_*` is left null.
- **Transactions** are the actual money movements against an order. A balance can be paid in several transactions (partial payments); each records its own method (`cash` / `cheque` / `card` / `bank_transfer` / Stripe object ids) and outcome. Refunds / transfers / payouts link back via `parent_transaction_id`.

> **Scope note:** player / umpire registration item types are seeded (see `payment_item_types`) but their registration tables + flows are a later phase — this doc finalizes the **team** path. The ledger itself is type-agnostic, so the later phases reuse it unchanged.

---

### `payment_orders`

#### Purpose

The payer-facing master record for one payment event — who pays, who collects, the rolled-up amounts, the payment method, and the lifecycle status. Children: `payables` (what's owed) and `payment_transactions` (what was paid).

#### CREATE script

```sql
CREATE TABLE `payment_orders` (
  `id`                          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_number`                VARCHAR(50) NOT NULL,
  `owner_type`                  TINYINT NOT NULL COMMENT '0=Platform, 1=Association, 2=Park',
  `owner_association_id`        BIGINT UNSIGNED DEFAULT NULL,
  `stripe_connected_account_id` BIGINT UNSIGNED DEFAULT NULL,
  `payer_user_id`               BIGINT UNSIGNED DEFAULT NULL,
  `order_type`                  ENUM('single','mixed') NOT NULL DEFAULT 'single',
  `payment_method_type`         ENUM('stripe','cash','manual','cheque','check','mixed') DEFAULT NULL,
  `collection_mode`             ENUM('online','offline') DEFAULT NULL,
  `stripe_customer_id`          VARCHAR(100) DEFAULT NULL,
  `currency`                    VARCHAR(10) NOT NULL DEFAULT 'usd',
  `total_amount`                DECIMAL(12,2) NOT NULL DEFAULT '0.00',
  `discount_amount`             DECIMAL(12,2) NOT NULL DEFAULT '0.00',
  `paid_amount`                 DECIMAL(12,2) NOT NULL DEFAULT '0.00',
  `balance_amount`              DECIMAL(12,2) NOT NULL DEFAULT '0.00',
  `platform_fee_amount`         DECIMAL(12,2) NOT NULL DEFAULT '0.00',
  `processor_fee_amount`        DECIMAL(12,2) DEFAULT NULL,
  `transfer_amount`             DECIMAL(12,2) NOT NULL DEFAULT '0.00',
  `payment_completion_status`   ENUM('unpaid','partially_paid','paid') NOT NULL DEFAULT 'unpaid',
  `payment_proof_status`        ENUM('not_required','pending_verification','verified','rejected') NOT NULL DEFAULT 'not_required',
  `verified_by`                 BIGINT UNSIGNED DEFAULT NULL,
  `verified_at`                 DATETIME DEFAULT NULL,
  `verification_notes`          TEXT,
  `status`                      ENUM('draft','pending','checkout_created','awaiting_offline_payment','processing','paid','failed','cancelled','expired','partially_refunded','refunded') NOT NULL DEFAULT 'draft',
  `paid_at`                     DATETIME DEFAULT NULL,
  `failed_at`                   DATETIME DEFAULT NULL,
  `expired_at`                  DATETIME DEFAULT NULL,
  `cancelled_at`                DATETIME DEFAULT NULL,
  `metadata_json`               JSON DEFAULT NULL,
  `created_at`                  DATETIME DEFAULT NULL,
  `updated_at`                  DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_po_order_number` (`order_number`),
  KEY `idx_po_owner` (`owner_type`, `owner_association_id`),
  KEY `idx_po_status` (`status`),
  KEY `idx_po_payer_user` (`payer_user_id`),
  KEY `idx_po_payment_method_type` (`payment_method_type`),
  KEY `idx_po_collection_mode` (`collection_mode`),
  KEY `fk_po_owner_association` (`owner_association_id`),
  KEY `fk_po_stripe_connected_account` (`stripe_connected_account_id`),
  CONSTRAINT `fk_po_owner_association` FOREIGN KEY (`owner_association_id`) REFERENCES `associations`(`id`),
  CONSTRAINT `fk_po_stripe_connected_account` FOREIGN KEY (`stripe_connected_account_id`) REFERENCES `stripe_connected_accounts`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

> **Note**: the production DDL's `owner_type` comment read `1=System, 2=Association` — that was a typo; the correct, table-consistent legend is **`0=Platform, 1=Association, 2=Park`** (applied above).

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Order identifier. FK target for `payables` + `payment_transactions`. |
| `order_number` | VARCHAR(50) UNIQUE | Human-readable order reference (e.g. `PO-2026-000123`). |
| `owner_type` | TINYINT | Who **collects** — `0=Platform`, `1=Association`, `2=Park`. |
| `owner_association_id` | BIGINT UNSIGNED NULL FK | The collecting association when `owner_type = 1`. → `associations`. |
| `stripe_connected_account_id` | BIGINT UNSIGNED NULL FK | The Connect account the funds settle to (online orders). → `stripe_connected_accounts`. |
| `payer_user_id` | BIGINT UNSIGNED NULL | The user paying. |
| `order_type` | ENUM | `single` (one payable) or `mixed` (several bundled payables). |
| `payment_method_type` | ENUM NULL | `stripe` / `cash` / `manual` / `cheque` / `check` / `mixed`. |
| `collection_mode` | ENUM NULL | `online` (Stripe checkout) or `offline` (recorded manually). |
| `stripe_customer_id` | VARCHAR(100) NULL | Stripe customer handle for the payer, when applicable. |
| `currency` | VARCHAR(10) | ISO currency, default `usd`. |
| `total_amount` / `discount_amount` / `paid_amount` / `balance_amount` | DECIMAL(12,2) | Rolled-up money: gross, discounts, paid so far, outstanding. |
| `platform_fee_amount` / `processor_fee_amount` / `transfer_amount` | DECIMAL(12,2) | WIF platform fee, payment-processor fee, and amount transferred to the owner. |
| `payment_completion_status` | ENUM | `unpaid` / `partially_paid` / `paid` — derived from transactions. |
| `payment_proof_status` | ENUM | Offline-proof workflow: `not_required` / `pending_verification` / `verified` / `rejected`. |
| `verified_by` / `verified_at` / `verification_notes` | FK / DATETIME / TEXT | Who verified an offline payment, when, and any note. |
| `status` | ENUM | Order lifecycle (`draft` → `checkout_created` / `awaiting_offline_payment` → `paid` / `failed` / `cancelled` / `expired` / `refunded` …). |
| `paid_at` / `failed_at` / `expired_at` / `cancelled_at` | DATETIME NULL | Lifecycle timestamps. |
| `metadata_json` | JSON NULL | Escape hatch for extra context. |
| `created_at` / `updated_at` | DATETIME NULL | Audit timestamps. |

#### Indexes

- `uq_po_order_number` — one order per reference.
- `idx_po_owner` `(owner_type, owner_association_id)` — "orders this association collects".
- `idx_po_status` / `idx_po_payer_user` / `idx_po_payment_method_type` / `idx_po_collection_mode` — listing + reconciliation filters.

---

### `payables`

#### Purpose

Line items under a `payment_order`. **Each payable is for exactly one entity** — its `payment_item_type_id` is *what kind* of charge; the entity is the **dedicated id column** (`team_id` / `player_id` / `umpire_id` / `user_id`, indexed) for first-class entities, or `related_entity_type` / `related_entity_id` for column-less ones (shop, MyLifeBook, badge, …). A `mixed` order has several payables (possibly different owners → split settlement).

#### CREATE script

> **Note**: the production DDL had only a `PRIMARY KEY` and mixed three collations (`utf8mb4_general_ci` / `utf8mb4_0900_ai_ci` / `utf8mb4_bin`). Per the agreed cleanup, this canonical version **adds FKs + indexes** and **aligns the table to `utf8mb4_unicode_ci`** (column names/types unchanged). The polymorphic *entity* columns (`event_id` / `team_id` / `player_id` / `umpire_id` / `user_id` / `event_tournament_id`) are kept as **indexed logical references** (not FK-constrained) so the generic ledger stays decoupled from optional modules; only the stable structural links (`payment_order_id`, `payment_item_type_id`, association) are FKs.

```sql
CREATE TABLE `payables` (
  `id`                             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `payment_order_id`               BIGINT UNSIGNED DEFAULT NULL,
  `payment_item_type_id`           BIGINT UNSIGNED DEFAULT NULL,
  `owner_type`                     TINYINT NOT NULL COMMENT '0=Platform, 1=Association, 2=Park',
  `owner_association_id`           BIGINT UNSIGNED DEFAULT NULL,
  `association_id`                 BIGINT UNSIGNED DEFAULT NULL,
  `event_id`                       BIGINT UNSIGNED DEFAULT NULL,
  `event_tournament_id`            BIGINT UNSIGNED DEFAULT NULL,
  `team_id`                        BIGINT UNSIGNED DEFAULT NULL,
  `player_id`                      BIGINT UNSIGNED DEFAULT NULL,
  `umpire_id`                      BIGINT UNSIGNED DEFAULT NULL,
  `user_id`                        BIGINT UNSIGNED DEFAULT NULL,
  `related_entity_type`            VARCHAR(50) DEFAULT NULL,
  `related_entity_id`              BIGINT UNSIGNED DEFAULT NULL,
  `description`                    VARCHAR(500) DEFAULT NULL,
  `quantity`                       INT NOT NULL DEFAULT '1',
  `unit_amount`                    DECIMAL(12,2) NOT NULL DEFAULT '0.00',
  `currency`                       VARCHAR(10) NOT NULL DEFAULT 'usd',
  `total_amount`                   DECIMAL(12,2) NOT NULL DEFAULT '0.00',
  `discount_amount`                DECIMAL(12,2) NOT NULL DEFAULT '0.00',
  `paid_amount`                    DECIMAL(12,2) NOT NULL DEFAULT '0.00',
  `balance_amount`                 DECIMAL(12,2) NOT NULL DEFAULT '0.00',
  `platform_fee_rule_id`           BIGINT UNSIGNED DEFAULT NULL,
  `platform_fee_type`              ENUM('fixed','percent','tiered') DEFAULT NULL,
  `platform_fee_rate`              DECIMAL(12,4) DEFAULT NULL,
  `platform_fee_fixed_amount`      DECIMAL(12,2) DEFAULT NULL,
  `platform_fee_amount`            DECIMAL(12,2) NOT NULL DEFAULT '0.00',
  `platform_fee_settlement_status` ENUM('not_applicable','pending','pending_settlement','settled') NOT NULL DEFAULT 'not_applicable',
  `transfer_amount`                DECIMAL(12,2) NOT NULL DEFAULT '0.00',
  `discount_campaign_id`           BIGINT UNSIGNED DEFAULT NULL,
  `discount_code_id`               BIGINT UNSIGNED DEFAULT NULL,
  `payment_completion_status`      ENUM('unpaid','partially_paid','paid') NOT NULL DEFAULT 'unpaid',
  `status`                         ENUM('draft','pending','payment_in_progress','active','completed','paid','cancelled') NOT NULL DEFAULT 'draft',
  `due_at`                         DATETIME DEFAULT NULL,
  `expires_at`                     DATETIME DEFAULT NULL,
  `paid_at`                        DATETIME DEFAULT NULL,
  `metadata_json`                  JSON DEFAULT NULL,
  `created_at`                     DATETIME DEFAULT NULL,
  `updated_at`                     DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_payables_order`        (`payment_order_id`),
  KEY `idx_payables_item_type`    (`payment_item_type_id`),
  KEY `idx_payables_owner`        (`owner_type`, `owner_association_id`),
  KEY `idx_payables_association`  (`association_id`),
  KEY `idx_payables_event`        (`event_id`),
  KEY `idx_payables_team`         (`team_id`),
  KEY `idx_payables_related`      (`related_entity_type`, `related_entity_id`),
  KEY `idx_payables_status`       (`status`),
  KEY `idx_payables_completion`   (`payment_completion_status`),
  CONSTRAINT `fk_payables_order`     FOREIGN KEY (`payment_order_id`)     REFERENCES `payment_orders`(`id`)     ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT `fk_payables_item_type` FOREIGN KEY (`payment_item_type_id`) REFERENCES `payment_item_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_payables_association` FOREIGN KEY (`association_id`)      REFERENCES `associations`(`id`)       ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Line-item identifier. |
| `payment_order_id` | BIGINT UNSIGNED FK | Parent order. **CASCADE** — lines die with the order. |
| `payment_item_type_id` | BIGINT UNSIGNED FK | *What kind* of charge — → [`payment_item_types`](#payment_item_types). **RESTRICT** (a type in use can't be hard-deleted). |
| `owner_type` / `owner_association_id` | TINYINT / FK | Who **collects this line** (`0=Platform/1=Association/2=Park`). Per-line so a mixed order can split-settle. |
| `association_id` | BIGINT UNSIGNED NULL FK | Association context of the charge (FK'd). |
| `event_id` / `event_tournament_id` / `team_id` / `player_id` / `umpire_id` / `user_id` | BIGINT UNSIGNED NULL | Strongly-typed entity references (indexed logical refs — see note). Exactly the relevant one(s) are set per line. |
| `related_entity_type` / `related_entity_id` | VARCHAR(50) / BIGINT NULL | Generic *which record* pointer — used **only** for entities without a dedicated column (shop order, MyLifeBook, token, badge, …). First-class entities (team / player / umpire / user) use their dedicated id columns instead, so these stay null for a team registration. |
| `description` | VARCHAR(500) NULL | Statement-descriptor text (e.g. "Annual Registration — 2026 Season"). |
| `quantity` / `unit_amount` / `total_amount` | INT / DECIMAL | Line quantity, unit price, gross (`unit × qty`, pre-discount/fee). |
| `discount_amount` / `paid_amount` / `balance_amount` | DECIMAL | Discount, paid so far, outstanding for this line. |
| `platform_fee_rule_id` / `platform_fee_type` / `platform_fee_rate` / `platform_fee_fixed_amount` / `platform_fee_amount` | mixed | How the WIF platform fee was computed (the resolved rule, fixed/percent/tiered, the rate/fixed, and the resulting amount). The rule comes from [`platform_fee_rules`](#platform_fee_rules) — snapshotted here so the charge stays auditable if the rule later changes. |
| `platform_fee_settlement_status` | ENUM | `not_applicable` / `pending` / `pending_settlement` / `settled`. |
| `transfer_amount` | DECIMAL | Amount transferred to the line's owner. |
| `discount_campaign_id` / `discount_code_id` | BIGINT NULL | Applied discount campaign / code (their tables out of scope here). |
| `payment_completion_status` | ENUM | `unpaid` / `partially_paid` / `paid` for this line. |
| `status` | ENUM | Line lifecycle (`draft` → `active` / `paid` / `cancelled` …). |
| `due_at` / `expires_at` / `paid_at` | DATETIME NULL | Line timing. |
| `metadata_json` | JSON NULL | Extra context. |
| `created_at` / `updated_at` | DATETIME NULL | Audit timestamps. |

#### Indexes

- `idx_payables_order` — list a registration/order's line items (the team-details **Statement** tab).
- `idx_payables_related` `(related_entity_type, related_entity_id)` — "payables for this registration".
- `idx_payables_association` / `idx_payables_event` / `idx_payables_team` — per-entity rollups.
- `idx_payables_status` / `idx_payables_completion` — reconciliation.

---

### `payment_item_types`

#### Purpose

A small catalogue of the **kinds of charges** the platform issues. `payables.payment_item_type_id` points here to classify a line (drives the statement descriptor + which fee rules / settlement apply). Reference data — adding a kind is a seed row, not a code change.

#### CREATE script

```sql
CREATE TABLE `payment_item_types` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code`        VARCHAR(100) NOT NULL,
  `name`        VARCHAR(255) NOT NULL,
  `description` TEXT,
  `category`    ENUM('association','event','player','umpire','platform','shop','subscription','park','other') NOT NULL DEFAULT 'other',
  `owner_type`  TINYINT NOT NULL COMMENT '0=Platform, 1=Association, 2=Park — the entity level that owns this item type',
  `is_active`   TINYINT(1) NOT NULL DEFAULT '1',
  `created_at`  DATETIME DEFAULT NULL,
  `updated_at`  DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_payment_item_type_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### Seed data

| id | code | name | category | owner_type | is_active |
|---|---|---|---|---|---|
| 1 | `association_team_registration` | Association Team Registration | association | 1 | 1 |
| 2 | `event_team_registration` | Event Team Registration | event | 1 | 1 |
| 3 | `player_registration` | Player Registration | player | 1 | 1 |
| 4 | `umpire_registration` | Umpire Registration | umpire | 1 | 1 |
| 5 | `wif_user_subscription` | WIF User Subscription | subscription | 2 | 1 |
| 6 | `shop_order` | Shop Order | shop | 2 | 1 |
| 7 | `token_purchase` | Token Purchase | platform | 2 | 1 |
| 8 | `team_verified_badge` | Team Verified Badge | platform | 2 | 1 |
| 9 | `mylifebook_print` | MyLifeBook Print | shop | 2 | 1 |
| 10 | `manual_charge` | Manual Charge | other | 2 | 1 |

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Item-type identifier (FK target for `payables.payment_item_type_id`). |
| `code` | VARCHAR(100) UNIQUE | Stable machine key (e.g. `association_team_registration`). |
| `name` | VARCHAR(255) | Display label. |
| `description` | TEXT NULL | Optional detail. |
| `category` | ENUM | Grouping: `association` / `event` / `player` / `umpire` / `platform` / `shop` / `subscription` / `park` / `other`. |
| `owner_type` | TINYINT | The entity level that owns this kind — `0=Platform`, `1=Association`, `2=Park`. |
| `is_active` | TINYINT(1) | Retire a kind without deleting (history-safe). |
| `created_at` / `updated_at` | DATETIME NULL | Audit timestamps. |

---

### `payment_transactions`

#### Purpose

The actual money movements recorded against a `payment_order`. A balance can be settled across **several** transactions (partial payments), and each captures its own method — `cash` / `cheque` / `card` / `bank_transfer`, or a Stripe object (checkout session / payment intent / charge / invoice / refund / transfer / payout). Refunds and related movements link back to their originating transaction via `parent_transaction_id`.

#### CREATE script

> **Note**: the production DDL already carried good indexes + FKs (`fk_pt_order`, `fk_pt_parent`). Per the agreed cleanup this adds the **`payable_id` FK** and a **`recorded_by` FK** (audit) — column names/types unchanged.

```sql
CREATE TABLE `payment_transactions` (
  `id`                         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `payment_order_id`           BIGINT UNSIGNED NOT NULL,
  `payable_id`                 BIGINT UNSIGNED DEFAULT NULL COMMENT 'Optional per-line allocation',
  `provider_type`              ENUM('stripe','cash','manual') NOT NULL DEFAULT 'stripe',
  `payment_method_type`        ENUM('card','cash','bank_transfer','check','cheque','other') DEFAULT NULL,
  `transaction_type`           ENUM('checkout_session','payment_intent','charge','invoice','subscription','subscription_invoice','refund','application_fee','transfer','payout') NOT NULL,
  `parent_transaction_id`      BIGINT UNSIGNED DEFAULT NULL,
  `stripe_account_id`          VARCHAR(100) DEFAULT NULL,
  `stripe_object_id`           VARCHAR(150) DEFAULT NULL,
  `stripe_checkout_session_id` VARCHAR(100) DEFAULT NULL,
  `stripe_payment_intent_id`   VARCHAR(100) DEFAULT NULL,
  `stripe_charge_id`           VARCHAR(100) DEFAULT NULL,
  `stripe_invoice_id`          VARCHAR(100) DEFAULT NULL,
  `stripe_refund_id`           VARCHAR(100) DEFAULT NULL,
  `stripe_application_fee_id`  VARCHAR(100) DEFAULT NULL,
  `stripe_transfer_id`         VARCHAR(100) DEFAULT NULL,
  `stripe_payout_id`           VARCHAR(100) DEFAULT NULL,
  `stripe_subscription_id`     VARCHAR(100) DEFAULT NULL,
  `offline_reference`          VARCHAR(100) DEFAULT NULL,
  `recorded_by`                BIGINT UNSIGNED DEFAULT NULL,
  `notes`                      TEXT,
  `amount`                     DECIMAL(12,2) NOT NULL DEFAULT '0.00',
  `currency`                   VARCHAR(10) NOT NULL DEFAULT 'usd',
  `status`                     VARCHAR(50) NOT NULL,
  `livemode`                   TINYINT(1) NOT NULL DEFAULT '0',
  `request_payload_json`       JSON DEFAULT NULL,
  `response_payload_json`      JSON DEFAULT NULL,
  `processed_at`               DATETIME DEFAULT NULL,
  `failed_at`                  DATETIME DEFAULT NULL,
  `created_at`                 DATETIME DEFAULT NULL,
  `updated_at`                 DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pt_stripe_object_id` (`stripe_object_id`),
  KEY `idx_pt_order_id` (`payment_order_id`),
  KEY `idx_pt_payable_id` (`payable_id`),
  KEY `idx_pt_provider_type` (`provider_type`),
  KEY `idx_pt_transaction_type` (`transaction_type`),
  KEY `idx_pt_type_status` (`transaction_type`, `status`),
  KEY `idx_pt_stripe_account` (`stripe_account_id`),
  KEY `idx_pt_offline_reference` (`offline_reference`),
  KEY `fk_pt_parent` (`parent_transaction_id`),
  KEY `fk_pt_recorded_by` (`recorded_by`),
  CONSTRAINT `fk_pt_order`       FOREIGN KEY (`payment_order_id`)      REFERENCES `payment_orders`(`id`),
  CONSTRAINT `fk_pt_payable`     FOREIGN KEY (`payable_id`)            REFERENCES `payables`(`id`)            ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_pt_parent`      FOREIGN KEY (`parent_transaction_id`) REFERENCES `payment_transactions`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_pt_recorded_by` FOREIGN KEY (`recorded_by`)          REFERENCES `users`(`id`)               ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Transaction identifier. |
| `payment_order_id` | BIGINT UNSIGNED FK | The order this payment is against. |
| `payable_id` | BIGINT UNSIGNED NULL FK | Optional allocation to a specific line item (else the payment applies at order level). |
| `provider_type` | ENUM | `stripe` / `cash` / `manual`. |
| `payment_method_type` | ENUM NULL | `card` / `cash` / `bank_transfer` / `check` / `cheque` / `other`. |
| `transaction_type` | ENUM | The Stripe/ledger object: `checkout_session` / `payment_intent` / `charge` / `invoice` / `subscription` / `subscription_invoice` / `refund` / `application_fee` / `transfer` / `payout`. |
| `parent_transaction_id` | BIGINT UNSIGNED NULL FK | Self-reference — e.g. a `refund` → its `charge`. SET NULL on parent delete. |
| `stripe_account_id` | VARCHAR(100) NULL | Connect account the object lives under. |
| `stripe_object_id` | VARCHAR(150) UNIQUE NULL | The canonical Stripe object id (deduped — webhook idempotency). |
| `stripe_*_id` (checkout/payment_intent/charge/invoice/refund/application_fee/transfer/payout/subscription) | VARCHAR(100) NULL | Typed Stripe handles for the relevant object, as applicable. |
| `offline_reference` | VARCHAR(100) NULL | Cheque #, receipt #, or other reference for an offline payment. |
| `recorded_by` | BIGINT UNSIGNED NULL FK | The admin who recorded an offline/manual transaction. → `users`. |
| `notes` | TEXT NULL | Free-text note (offline context). |
| `amount` / `currency` | DECIMAL(12,2) / VARCHAR(10) | Transaction amount + currency (a partial payment carries its own amount). |
| `status` | VARCHAR(50) | Provider-reported status (free string — varies by provider/object). |
| `livemode` | TINYINT(1) | Stripe live vs test. |
| `request_payload_json` / `response_payload_json` | JSON NULL | Raw provider request/response for audit + debugging. |
| `processed_at` / `failed_at` | DATETIME NULL | Outcome timestamps. |
| `created_at` / `updated_at` | DATETIME NULL | Audit timestamps. |

#### Indexes

- `uq_pt_stripe_object_id` — idempotency: one row per Stripe object (safe webhook re-delivery).
- `idx_pt_order_id` / `idx_pt_payable_id` — list payments for an order / line.
- `idx_pt_transaction_type` / `idx_pt_type_status` / `idx_pt_provider_type` — ledger filters.
- `idx_pt_stripe_account` / `idx_pt_offline_reference` — reconciliation by Connect account / offline reference.

---

## `platform_fee_rules`

### Purpose

How **WIF's platform fee** is computed for a charge. A payable costs
`gross − discount + platform_fee`; this table is the config that decides that
`platform_fee`. It's intentionally **decoupled from the price** — the *fee* (e.g.
an association's `applicable_fee`) is set by whoever collects; the *platform fee*
WIF takes on top is set here, and can differ by **what** is paid for
(`payment_item_type_id`) and **where** (global / a specific association / a
specific event), as a percent, a flat amount, or (later) a tiered schedule.

One rule is **resolved per charge** — match the item type, narrow by scope
(event > association > global), break ties by `priority`, within the active
window — then computed and **snapshotted** onto the [`payment_transaction`](#payment_transactions)
(`platform_fee_rule_id` / `platform_fee_type` / `platform_fee_rate` /
`platform_fee_fixed_amount` / `platform_fee_amount`) so the charge stays
auditable even if the rule later changes. Reference/config data — adding or
changing a fee is a row edit, not a code change; the **backend** resolves +
applies it (the frontend may only *preview* it).

### CREATE

```sql
CREATE TABLE `platform_fee_rules` (
  `id`                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_type`           TINYINT NOT NULL COMMENT '0=Platform, 1=Association, 2=Park',
  `owner_association_id` BIGINT UNSIGNED NULL,
  `payment_item_type_id` BIGINT UNSIGNED NOT NULL,
  `scope_type`           ENUM('global','association','event') NOT NULL DEFAULT 'global',
  `event_id`             BIGINT UNSIGNED NULL,
  `fee_type`             ENUM('fixed','percent','tiered') NOT NULL,
  `fee_value`            DECIMAL(12,4) NULL,
  `min_fee_amount`       DECIMAL(12,2) NULL,
  `max_fee_amount`       DECIMAL(12,2) NULL,
  `priority`             INT NOT NULL DEFAULT 100,
  `is_active`            BOOLEAN NOT NULL DEFAULT TRUE,
  `starts_at`            DATETIME NULL,
  `ends_at`              DATETIME NULL,
  `created_at`           DATETIME NULL,
  `updated_at`           DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_pfr_owner`                (`owner_type`, `owner_association_id`),
  KEY `idx_pfr_payment_item_type_id` (`payment_item_type_id`),
  KEY `idx_pfr_scope`                (`scope_type`, `event_id`),
  KEY `idx_pfr_active`               (`is_active`, `starts_at`, `ends_at`, `priority`),
  CONSTRAINT `fk_pfr_owner_association` FOREIGN KEY (`owner_association_id`) REFERENCES `associations`(`id`),
  CONSTRAINT `fk_pfr_payment_item_type` FOREIGN KEY (`payment_item_type_id`) REFERENCES `payment_item_types`(`id`),
  CONSTRAINT `fk_pfr_event`             FOREIGN KEY (`event_id`) REFERENCES `events`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

> **Note:** the source DDL had a stray double comma after `owner_type` (`TINYINT NOT NULL,,`) — corrected here. The seed below is normalized to the numeric `owner_type` legend (`0/1/2`); the raw seed mixed quoted ints (`'1'`) with a literal `'platform'` string (won't store in a `TINYINT`) — `'platform'` is documented as `0`.

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Rule identifier. Snapshotted onto `payment_transactions.platform_fee_rule_id` when applied. |
| `owner_type` | TINYINT | Which collection flow the rule applies under — `0=Platform`, `1=Association`, `2=Park`. |
| `owner_association_id` | BIGINT UNSIGNED NULL FK | Set only when the rule targets one association (with `scope_type='association'`). → `associations`. |
| `payment_item_type_id` | BIGINT UNSIGNED FK | **What kind of charge** this rule prices — → [`payment_item_types`](#payment_item_types) (e.g. `1 = association_team_registration`, `2 = event_team_registration`). |
| `scope_type` | ENUM | `global` (everywhere for the item type), `association` (one association — pair with `owner_association_id`), or `event` (one event — pair with `event_id`). Narrower scope wins. |
| `event_id` | BIGINT UNSIGNED NULL FK | The specific event when `scope_type='event'`. → `events`. |
| `fee_type` | ENUM | `fixed` (flat `fee_value`), `percent` (`fee_value`% of the amount), or `tiered` (use [`platform_fee_tiers`](#platform_fee_tiers); `fee_value` ignored). |
| `fee_value` | DECIMAL(12,4) NULL | Flat amount (`fixed`) or percentage (`percent`, e.g. `5.0000` = 5%). Null for `tiered`. |
| `min_fee_amount` / `max_fee_amount` | DECIMAL(12,2) NULL | Optional floor / cap on the computed fee. |
| `priority` | INT | Tie-breaker among matching rules — **lower = higher priority**. Default `100`. |
| `is_active` | BOOLEAN | Inactive rules are skipped. |
| `starts_at` / `ends_at` | DATETIME NULL | Effective window (NULL = open-ended that side). |
| `created_at` / `updated_at` | DATETIME NULL | Audit timestamps. |

#### Indexes

- `idx_pfr_owner` `(owner_type, owner_association_id)` — rules for a flow / association.
- `idx_pfr_payment_item_type_id` — all rules for an item type.
- `idx_pfr_scope` `(scope_type, event_id)` — event-/association-scoped lookups.
- `idx_pfr_active` `(is_active, starts_at, ends_at, priority)` — the resolution scan.

#### Seed (defaults)

`fee_value` is a percent for `percent` rules and a flat dollar amount for `fixed`.
`payment_item_type_id` references [`payment_item_types`](#payment_item_types).

| owner_type | payment_item_type_id | item code | scope | fee_type | fee_value | priority |
|---|---|---|---|---|---|---|
| 1 | 1 | `association_team_registration` | global | percent | 5.0000 (5%) | 100 |
| 1 | 2 | `event_team_registration` | global | fixed | 1.0000 ($1) | 100 |
| 1 | 3 | `player_registration` | global | percent | 3.0000 (3%) | 100 |
| 1 | 4 | `umpire_registration` | global | fixed | 0.0000 | 100 |
| 2 | 5 | `wif_user_subscription` | global | fixed | 0.0000 | 100 |
| 0 | 6 | `shop_order` | global | fixed | 0.0000 | 100 |
| 2 | 7 | `token_purchase` | global | fixed | 0.0000 | 100 |
| 2 | 8 | `team_verified_badge` | global | fixed | 0.0000 | 100 |
| 2 | 9 | `mylifebook_print` | global | fixed | 0.0000 | 100 |

#### Resolution (how a fee is picked at charge time)

The backend resolves **one** rule per payable when it mints the line:

1. **Match** on `payment_item_type_id`, with `is_active = 1` and "now" within `[starts_at, ends_at]`.
2. **Narrow by scope** — most specific wins: `event` (matching `event_id`) → `association` (matching `owner_association_id`) → `global`.
3. **Break ties** by lowest `priority`.
4. **Compute** from `fee_type`: `fixed` → `fee_value`; `percent` → `fee_value%` of the amount; `tiered` → walk [`platform_fee_tiers`](#platform_fee_tiers).
5. **Clamp** to `min_fee_amount` / `max_fee_amount` if set.
6. **Snapshot** the chosen rule + resolved numbers onto the `payment_transaction`.

The registration wizard previews this via the **resolved rule returned on the
reg-settings GET** ([`association-registration-settings-api-contract.md`](../api/association-registration-settings-api-contract.md), the read-only `platformFee` block); team participation will get its rule the same way from the event GET. Previews are informational — the backend re-resolves + is authoritative.

---

## `platform_fee_tiers`

### Purpose

Amount-banded sub-rules for a [`platform_fee_rules`](#platform_fee_rules) row whose
`fee_type = 'tiered'` — e.g. 5% up to $100, then 3% above. **Reserved for a later
phase — not currently used** (no rule seeds `tiered` yet). Documented now so the
model is complete.

### CREATE

```sql
CREATE TABLE `platform_fee_tiers` (
  `id`                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `platform_fee_rule_id` BIGINT UNSIGNED NOT NULL,
  `min_amount`           DECIMAL(12,2) NOT NULL,
  `max_amount`           DECIMAL(12,2) NULL,
  `tier_fee_type`        ENUM('fixed','percent') NOT NULL,
  `tier_fee_value`       DECIMAL(12,4) NOT NULL,
  `min_fee_amount`       DECIMAL(12,2) NULL,
  `max_fee_amount`       DECIMAL(12,2) NULL,
  `created_at`           DATETIME NULL,
  `updated_at`           DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_pft_rule_id` (`platform_fee_rule_id`),
  KEY `idx_pft_range`   (`min_amount`, `max_amount`),
  CONSTRAINT `fk_pft_rule` FOREIGN KEY (`platform_fee_rule_id`)
    REFERENCES `platform_fee_rules`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### Fields

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | Tier identifier. |
| `platform_fee_rule_id` | BIGINT UNSIGNED FK | Parent `tiered` rule. **CASCADE** on delete. |
| `min_amount` | DECIMAL(12,2) | Lower bound (inclusive) of the amount band. |
| `max_amount` | DECIMAL(12,2) NULL | Upper bound; **NULL = open-ended** (top tier). |
| `tier_fee_type` | ENUM | `fixed` or `percent` for amounts in this band. |
| `tier_fee_value` | DECIMAL(12,4) | Flat amount or percentage for this band. |
| `min_fee_amount` / `max_fee_amount` | DECIMAL(12,2) NULL | Optional per-tier floor / cap. |
| `created_at` / `updated_at` | DATETIME NULL | Audit timestamps. |

#### Indexes

- `idx_pft_rule_id` — all tiers for a rule.
- `idx_pft_range` `(min_amount, max_amount)` — band lookup for an amount.

---

## Open items / follow-ups

- **`payables` FKs/indexes + collation alignment** and the **`payment_transactions` `payable_id` / `recorded_by` FKs** above augment the provided DDL — fold into a migration when these tables are aligned in production.
- **Registration-time creation** (backend reads `association_reg_settings` → builds the order + payable(s)) is specified in the team register contract, not here — see [`association-teams-api-contract.md`](../api/association-teams-api-contract.md) (§3) and [`system-payments-api-contract.md`](../api/system-payments-api-contract.md) when it lands.
