# Association Payables API Contract

The **shared, filterable, paginated** read API for `payables` (line items in the
money ledger), plus the per-order drill-in (order + its payables + transactions)
and the two collection actions (record a manual payment, send a Stripe link).

One list endpoint serves **every** payable surface — the team-details Statement,
the (future) player / umpire statements, and association-level payment reports —
by varying the filters. The ledger tables themselves live in
[`sql-schema-payments.md`](../system/sql-schema-payments.md); how the platform
fee on each line is computed lives in
[`platform_fee_rules`](../system/sql-schema-payments.md#platform_fee_rules).

## Endpoints

| # | Method + path | Purpose |
|---|---|---|
| 1 | `GET /v2/association/payables/{associationId}` | **Shared** paginated, filtered payables list. |
| 2 | `GET /v2/association/payables/{associationId}/orders/{paymentOrderId}` | One payment order drilled in — the order + its payables + its transactions. |
| 3 | `POST /v2/association/payables/{associationId}/orders/{paymentOrderId}/transactions` | Record a manual (offline) payment against the order. |
| 4 | `POST /v2/association/payables/{associationId}/orders/{paymentOrderId}/send-link` | Create a Stripe checkout + email the payer a payment link. |

## Scope decisions (locked in)

- **Permission gate**: `manage_teams` (or `fullControl`) on the caller's `association_users` row → else `403`. (A future finance-specific permission can replace this.)
- **`{associationId}` is the numeric association PK.** Every query is scoped to `payables.association_id = :associationId` — an association only ever sees payables in its own scope (registration dues for its teams/players/umpires + participation in its events). A payable in another association's scope → never returned (no leak).
- **List returns rolled-up payable rows** — each line carries its own `paid` / `balance` / completion status + its parent-order linkage. **Transactions are NOT included in the list** (they'd bloat it); fetch them per order via #2 on drill-in.
- **Filter by dedicated columns.** team / player / umpire / user payables are matched on their **dedicated indexed columns** (`team_id` / `player_id` / `umpire_id` / `user_id`), not `related_entity_*` (which is only for column-less entities). This is what keeps the shared list fast for each surface.
- **Read + collect only.** This contract does not create orders/payables — that's backend-owned at registration/participation time (see [`association-teams-api-contract.md`](./association-teams-api-contract.md) §3). It only **reads** them and **records payments** against an existing order.
- IDs serialize as numeric strings; timestamps are ISO-8601 UTC; money is dollars on the wire (`amount_cents / 100`).

## Underlying tables

| Table | Purpose |
|---|---|
| `payables` | Line items — the list rows. See [`sql-schema-payments.md`](../system/sql-schema-payments.md#payables). |
| `payment_orders` | Parent order (drill-in #2). |
| `payment_transactions` | Individual payments under an order (#2 detail, #3 append). |
| `payment_item_types` | The `itemType` filter values. |

---

## 1. List Payables (shared)

- **Endpoint**: `GET /v2/association/payables/{associationId}`
- **Purpose**: The one list every payable surface uses. Drives the team-details Statement (filter `teamId`), the future player/umpire statements (`userId` / `playerId` / `umpireId`), and association payment reports (filter by status / item type / event).
- **Table sources**: `payables` scoped to `association_id = :associationId`, LEFT JOIN `payment_orders` (for order number + method) and `events` (for `eventName` on participation lines).

### Query parameters

In addition to the standard `page` / `per_page` pagination params from [conventions](./conventions.md#pagination-envelope-laravel-paginator) (**`per_page` defaults to `25`**), all filters are optional and **combine with AND**:

| Name | Type | Default | Notes |
|---|---|---|---|
| `teamId` | string | `""` | `payables.team_id` — the team-details Statement passes this (the global team id). |
| `userId` | string | `""` | `payables.user_id` — the person a payable belongs to (player / umpire statements). |
| `playerId` | string | `""` | `payables.player_id`. |
| `umpireId` | string | `""` | `payables.umpire_id`. |
| `eventId` | string | `""` | `payables.event_id` — all participation payables for one event. |
| `itemType` | string (comma-separated codes) | `""` | `IN` over [`payment_item_types.code`](../system/sql-schema-payments.md#payment_item_types) — e.g. `association_team_registration` (registration payments), `event_team_registration` (event participation payments), `player_registration`, `umpire_registration`. Empty = all kinds. |
| `paymentStatus` | string (comma-separated) | `""` | `IN` over the payable's **completion** status — `unpaid` \| `partially_paid` \| `paid`. The "outstanding balances" report passes `unpaid,partially_paid`. |
| `search` | string | `""` | Case-insensitive partial match on order number + payable description (+ event name). |
| `sort` | `'createdAt' \| 'totalAmount' \| 'balanceAmount'` | `'createdAt'` | |
| `order` | `'asc' \| 'desc'` | `'desc'` | Newest-first by default. |

> Wire format for the multi-select filters (`itemType`, `paymentStatus`) is comma-separated for URL friendliness; the backend explodes on `,` into the `IN` list.

### Usage examples

- **Team Statement** → `?teamId=t_382` (association scope from the path).
- **Player statement** → `?userId=u_55&itemType=player_registration`.
- **Outstanding-balances report** → `?paymentStatus=unpaid,partially_paid&sort=balanceAmount&order=desc`.
- **Event participation revenue** → `?eventId=ev_12&itemType=event_team_registration`.
- **All registration dues** → `?itemType=association_team_registration,player_registration,umpire_registration`.

### Response (paginated)

`data` is the standard Laravel paginator. Each row in `data.data[]` is a rolled-up `Payable` (§5) — its own paid/balance/status plus the parent-order link. **No `transactions` array here** (see #2).

```jsonc
{
  "responseStatus": { "message": "OK", "statusCode": 200, "text": "OK" },
  "data": {
    "current_page": 1,
    "per_page": 25,
    "total": 134,
    "from": 1,
    "to": 25,
    "data": [
      {
        "id": "pay_5001",
        "paymentOrderId": "po_100501",
        "paymentOrderNumber": "PO-2026-00102",
        "description": "Association Team Registration — 2026",
        "itemType": "association_team_registration",
        "relatedEntityType": "association_team",
        "teamId": "t_382",
        "userId": null,
        "eventId": null,
        "eventName": null,
        "quantity": 1,
        "unitAmount": 234.00,
        "totalAmount": 234.00,
        "discountAmount": 0.00,
        "platformFeeAmount": 11.70,
        "payableAmount": 245.70,
        "paidAmount": 120.00,
        "balanceAmount": 125.70,
        "paymentCompletionStatus": "partially_paid",
        "status": "active",
        "currency": "USD",
        "createdAt": "2026-06-21T15:00:00.000Z"
      }
      // … more payables
    ]
  }
}
```

### Field notes

- `payableAmount = totalAmount − discountAmount + platformFeeAmount`; `balanceAmount = payableAmount − paidAmount`. Both are returned (not recomputed client-side) so every surface shows identical math.
- `paymentCompletionStatus` (`unpaid` / `partially_paid` / `paid`) is the **rolled-up** status used by the status filter + the row badge.
- `404` for an unknown / soft-deleted association.

---

## 2. Get Payment Order (drill-in)

- **Endpoint**: `GET /v2/association/payables/{associationId}/orders/{paymentOrderId}`
- **Purpose**: When the admin opens a payable, load its **parent order** with **all its payables** and its **transaction ledger** — backs `PaymentTransactionsModal`.
- **Table sources**: `payment_orders` + its `payables` + its `payment_transactions` (ordered by `paid_at`).

### Response

```jsonc
{
  "responseStatus": { "message": "OK", "statusCode": 200, "text": "OK" },
  "data": {
    "order": {
      "id": "po_100501",
      "orderNumber": "PO-2026-00102",
      "orderType": "single",
      "paymentMethodType": "cash",
      "collectionMode": "offline",
      "currency": "USD",
      "totalAmount": 234.00,
      "discountAmount": 0.00,
      "platformFeeAmount": 11.70,
      "paidAmount": 120.00,
      "balanceAmount": 125.70,
      "paymentCompletionStatus": "partially_paid",
      "paymentProofStatus": "not_required",
      "status": "awaiting_offline_payment",
      "paidAt": null,
      "createdAt": "2026-06-21T15:00:00.000Z",
      "transactions": [
        {
          "id": "tx_1",
          "paidAt": "2026-06-21T15:02:00.000Z",
          "amount": 120.00,
          "method": "Cash",
          "reference": "Front desk"
        }
      ]
    },
    "payables": [ /* the order's Payable rows (§5), same shape as the list */ ]
  }
}
```

### Field notes

- `404` when the order doesn't exist or isn't in this association's scope.
- `transactions` is the per-order ledger; the list endpoint (#1) intentionally omits it.

---

## 3. Record Manual Payment

- **Endpoint**: `POST /v2/association/payables/{associationId}/orders/{paymentOrderId}/transactions`
- **Purpose**: Log an offline payment (cash / cheque / bank transfer / other) the admin received — appends a `payment_transaction`, recomputes the order's `paid` / `balance` / completion + status, marks fully-paid payables `paid`, and (for a registration order) activates the team when it becomes fully paid.
- **Permission**: `manage_teams`. **Gated** — hidden in the UI when the relevant type's `allow_offline_payment` is off (see [`association-registration-settings-api-contract.md`](./association-registration-settings-api-contract.md)); the backend rejects with `422` if offline isn't permitted for that item type.

### Request body

```jsonc
{
  "method": "cash",            // cash | check | bank_transfer | other
  "amount": 125.70,            // > 0 and ≤ outstanding balance (partials allowed)
  "paidAt": "2026-06-21",      // date received (YYYY-MM-DD)
  "reference": "Cheque #1042", // optional
  "notes": "Balance settled"   // optional
}
```

| Field | Required | Notes |
|---|---|---|
| `method` | yes | One of `cash` / `check` / `bank_transfer` / `other` (non-card). |
| `amount` | yes | `> 0` and `≤ balanceAmount` → `422` otherwise. Partial payments allowed. |
| `paidAt` | yes | Date the payment was received. **Persisted to `payment_transactions.processed_at`** (the manual payment has no provider callback, so the admin-entered receipt date is the processed timestamp). |
| `reference` / `notes` | no | Free text. |

### Server behavior

- Appends one `payment_transactions` row with **`status = 'succeeded'`** (a recorded manual payment is final — there's no pending/authorization step like a card) and **`processed_at = paidAt`** (`failed_at` stays null).
- Other columns set per the manual payment: `provider_type` cash/manual, `payment_method_type = method`, `amount`, `offline_reference = reference`, `notes`, `recorded_by` = the admin.
- Recomputes the order's `paid` / `balance` / completion + status, marks fully-paid payables `paid`, and (for a registration order) activates the team once the balance hits zero.

### Response

`200` with the **updated order + payables** (same shape as #2). `responseStatus.message`: **"Payment recorded"**.

---

## 4. Send Payment Link

- **Endpoint**: `POST /v2/association/payables/{associationId}/orders/{paymentOrderId}/send-link`
- **Purpose**: Create a Stripe checkout for the outstanding balance and email the payer (e.g. the team manager) a link. Order → `checkout_created` / `collection_mode = online`; the registration stays **pending** until Stripe reports it paid.
- **Permission**: `manage_teams`. **Requires the association to be Stripe-connected** (`stripeConnected = true`) and card to be an allowed rail for the item type → else `422`.

### Request body

```jsonc
{}
```

(No body — the backend reads the order's outstanding balance + the payer from the order.)

### Response

`200` with the **updated order + payables** (#2 shape; `status: "checkout_created"`). `responseStatus.message`: **"Payment link sent"**.

---

## 5. `Payable` shape (reference)

Rolled-up line item — mirrors `AssociationPayable` in `src/types.ts` (+ the filterable id columns).

```ts
interface Payable {
  id: string
  paymentOrderId: string
  paymentOrderNumber: string
  description: string
  itemType: string                  // payment_item_types.code
  relatedEntityType: 'association_team' | 'event_joined_team' | null
  // dedicated entity columns (the filter targets) — one populated per payable
  teamId: string | null
  userId: string | null
  playerId: string | null
  umpireId: string | null
  eventId: string | null
  eventName: string | null          // hydrated for event_team_registration lines
  quantity: number
  unitAmount: number
  totalAmount: number               // gross (unit × qty), pre-discount/fee
  discountAmount: number
  platformFeeAmount: number
  payableAmount: number             // total − discount + platformFee
  paidAmount: number
  balanceAmount: number             // payable − paid
  paymentCompletionStatus: 'unpaid' | 'partially_paid' | 'paid'
  status: 'draft' | 'pending' | 'payment_in_progress' | 'active' | 'completed' | 'paid' | 'cancelled'
  currency: string
  createdAt: string                 // ISO
}
```

## 6. Frontend client (this repo)

- `fetchPayables(filters)` in `src/api/associationTeams.ts` — the generic, paginated, filterable list (#1); returns `Paginated<AssociationPayable>`. `fetchTeamPayables(assoc, teamId, { page, perPage })` is a thin wrapper over it for the Statement tab. `fetchPaymentOrder` / `recordTeamPayment` / `sendTeamPaymentLink` map onto #2 / #3 / #4. Mock-first; flip to live when the backend ships.
- The lifecycle log (teams contract §11) is paginated the same way — `fetchTeamLifecycle(assoc, teamId, { page, perPage, order, actionType })` → `Paginated<TeamLifecycleEntry>`.
- UI: `src/views/AssociationTeamDetailsView.vue` (Statement tab) + `src/components/PaymentTransactionsModal.vue` (order drill-in + record/send actions).

## 7. Out of scope (deferred)

- **Refunds / partial refunds** and `parent_transaction_id` chains — read in #2 if present, but no issue-refund endpoint yet.
- **Proof upload / verification** (`payment_proof_status`) flow.
- **Platform/Park-scoped payable reports** (non-association collectors) — this contract is the association surface; a platform-admin report is separate.
- **CSV / export** of the report list.
