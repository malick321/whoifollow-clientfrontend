---
status: Draft (v1)
owner: shared
last_updated: 2026-06-20
---

# Association Registration Settings — REST API contract

## Context

Powers the **Settings → Registration Settings** popup (`src/components/RegistrationSettingsModal.vue`, opened from `src/views/AssociationSettingsView.vue`). An association configures, **per registration type** — team / umpire / player — whether the public may self-register, whether a fee applies (and how much), and the default validity granted on activation (never-expires, or a fixed number of days).

Backed by the `association_reg_settings` table — see [`sql-schema-association.md#association_reg_settings`](../system/sql-schema-association.md#association_reg_settings) (one row per `(association, registration_type)`). When wired, replaces the mock layer in `src/api/associationRegSettings.ts`.

All endpoints are rooted under `/v2/association/{associationId}/registration-settings`. For shared rules — response envelope, auth header, error codes — see [`conventions.md`](./conventions.md). Wire is camelCase; v2 envelope `{ responseStatus, data }`.

## Endpoints summary

| # | Method & path | Purpose |
|---|---|---|
| 1 | `GET /v2/association/{associationId}/registration-settings` | Read all three type settings (defaults filled for any not yet saved). |
| 2 | `PUT /v2/association/{associationId}/registration-settings` | Bulk upsert all three settings in one call. |

## Scope decisions (locked in)

- **Permission gate**: requires `manage_teams` (or `fullControl`) on the caller's `association_users` row. Without it → `403`.
- **`{associationId}` is the numeric association PK** (from `currentAssociation.id`), not the URL slug.
- **Always three types.** The set is closed: `team`, `umpire`, `player`. Read returns exactly one entry per type — the backend fills **defaults** for any type with no saved row (so the UI always renders all three). Write submits all three together (the popup's single Save).
- **Wire uses string types; DB stores an int.** `registrationType` is `team` | `umpire` | `player` on the wire; the backend maps to `association_reg_settings.registration_type` (`0=team`, `1=player`, `2=umpire`). Note the int order differs from the display order — the mapping is by value, not position.
- **Conditional fields.** `applicableFee` is required + `> 0` only when `paymentApplicable` is true (else `null`). `durationDays` is required + `>= 1` only when `neverExpires` is false (else `null`). The app enforces these (`422` on violation); the columns themselves are nullable.
- **Payment rails (`allowCardPayment` / `allowOfflinePayment`).** Per-type booleans that only matter when `paymentApplicable` is true. `allowCardPayment` = online credit-card (Stripe) is accepted; `allowOfflinePayment` = manual cash/cheque/bank-transfer/other is accepted. Card requires an active Stripe Connect account, so the backend stores `allowCardPayment = false` whenever the association isn't Stripe-connected (regardless of what the client sends). **At least one usable rail** must remain when `paymentApplicable` is true (card only counts as usable when Stripe is connected) → `422` otherwise. Turning offline off (card on) funnels all collection for that type through Stripe: the team Register wizard hides the offline collection option and the team Statement hides the manual "Record payment" action for that type's payables.

## Underlying table

| Table | Purpose |
|---|---|
| `association_reg_settings` | One row per `(association_id, registration_type)`. See [`sql-schema-association.md`](../system/sql-schema-association.md#association_reg_settings). |

---

## 1. Get Registration Settings

- **Endpoint**: `GET /v2/association/{associationId}/registration-settings`
- **Purpose**: Hydrate the Registration Settings popup. Returns one entry per type; missing types are returned with defaults (not persisted until a Save).
- **Table sources**: `association_reg_settings` filtered to `association_id = :associationId`.

### Query parameters

| Param | Required | Notes |
|---|---|---|
| `type` | no | `team` \| `umpire` \| `player`. **Omit** → returns all three types (the Settings popup edits all at once). **Provide** → returns just that one type as a 1-element `list` (callers that only need their own type, e.g. the team Register wizard + the team Statement's manual-payment gating, pass `type=team`). The response **shape is unchanged** (`data.list` array) either way — single-type just means a length-1 list. A missing-but-valid type is returned with defaults. Any other value → `422`. Designed so a future public self-registration page can fetch only its own type (least exposure — it won't receive the other types' fee structures). |

### Response

`data.list` is an array of `RegistrationSetting` — exactly three (team, umpire, player) when `type` is omitted, or one when `type` is supplied.

```jsonc
{
  "responseStatus": { "message": "OK", "statusCode": 200, "text": "OK" },
  "data": {
    "list": [
      {
        "registrationType": "team",
        "allowSelfRegistration": true,
        "paymentApplicable": true,
        "applicableFee": 75.00,
        "allowCardPayment": true,
        "allowOfflinePayment": false,
        "neverExpires": false,
        "durationDays": 365,
        "platformFee": {
          "feeType": "percent",
          "feeValue": 5,
          "minFeeAmount": null,
          "maxFeeAmount": null,
          "ruleId": "1"
        }
      },
      {
        "registrationType": "umpire",
        "allowSelfRegistration": false,
        "paymentApplicable": false,
        "applicableFee": null,
        "allowCardPayment": true,
        "allowOfflinePayment": true,
        "neverExpires": true,
        "durationDays": null,
        "platformFee": {
          "feeType": "fixed",
          "feeValue": 0,
          "minFeeAmount": null,
          "maxFeeAmount": null,
          "ruleId": "4"
        }
      },
      {
        "registrationType": "player",
        "allowSelfRegistration": true,
        "paymentApplicable": false,
        "applicableFee": null,
        "allowCardPayment": true,
        "allowOfflinePayment": true,
        "neverExpires": false,
        "durationDays": 180,
        "platformFee": {
          "feeType": "percent",
          "feeValue": 3,
          "minFeeAmount": null,
          "maxFeeAmount": null,
          "ruleId": "3"
        }
      }
    ]
  }
}
```

### Default (unsaved) entry

When a type has no row yet, the backend returns:
`{ allowSelfRegistration: false, paymentApplicable: false, applicableFee: null, allowCardPayment: true, allowOfflinePayment: true, neverExpires: false, durationDays: 365 }`.

### Field notes

- `404` when the association doesn't exist or is soft-deleted.
- **`platformFee`** is **read-only** and **resolved server-side** from [`platform_fee_rules`](../system/sql-schema-payments.md#platform_fee_rules) for this type's `payment_item_type` (team → `association_team_registration`, player → `player_registration`, umpire → `umpire_registration`), after scope/priority/active-window resolution. It's returned so the **registration wizard can preview** the platform fee + total without re-implementing resolution; the client never sends it back on PUT, and the backend re-resolves + is authoritative at charge time. `null` when no rule matches. (Event team-participation gets its rule the same way, on the event GET — `event_team_registration`.)

---

## 2. Update Registration Settings (bulk upsert)

- **Endpoint**: `PUT /v2/association/{associationId}/registration-settings`
- **Purpose**: Save all three type settings at once (the popup commits team + umpire + player together). Upserts the `association_reg_settings` row for each type.
- **Stamps** `updated_by` ← the authenticated admin; `created_by` on first insert of a type.

### Request body

`platformFee` is **read-only** and **not accepted** on write — omit it (the backend resolves it). The example below sends one entry expanded; the popup sends all three.

```jsonc
{
  "settings": [
    {
      "registrationType": "team",
      "allowSelfRegistration": true,
      "paymentApplicable": true,
      "applicableFee": 75.00,
      "allowCardPayment": true,
      "allowOfflinePayment": false,
      "neverExpires": false,
      "durationDays": 365
    },
    {
      "registrationType": "umpire",
      "allowSelfRegistration": false,
      "paymentApplicable": false,
      "applicableFee": null,
      "allowCardPayment": true,
      "allowOfflinePayment": true,
      "neverExpires": true,
      "durationDays": null
    },
    {
      "registrationType": "player",
      "allowSelfRegistration": true,
      "paymentApplicable": false,
      "applicableFee": null,
      "allowCardPayment": true,
      "allowOfflinePayment": true,
      "neverExpires": false,
      "durationDays": 180
    }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `settings` | yes | Array of all three type settings. The backend upserts each by `(associationId, registrationType)`. Sending fewer than three is allowed (only the included types are upserted), but the popup always sends all three. |
| `registrationType` | yes | `team` \| `umpire` \| `player`. Any other value → `422`. |
| `allowSelfRegistration` | yes | bool — public self-registration on/off for this type. |
| `paymentApplicable` | yes | bool — whether a fee applies. |
| `applicableFee` | conditional | Decimal(10,2). **Required + `> 0` when `paymentApplicable` is true**; send `null` otherwise (ignored). |
| `allowCardPayment` | yes | bool — online card (Stripe) accepted for this type. Backend forces `false` when the association isn't Stripe-connected. Only meaningful when `paymentApplicable` is true. |
| `allowOfflinePayment` | yes | bool — manual cash/cheque/bank-transfer/other accepted for this type. Only meaningful when `paymentApplicable` is true. At least one usable rail required when `paymentApplicable` is true (→ `422`). |
| `neverExpires` | yes | bool — default validity policy. |
| `durationDays` | conditional | Int. **Required + `>= 1` when `neverExpires` is false**; send `null` otherwise (ignored). |

### Response

`200` — `data.list` is the saved three-entry array (same shape as §1). `responseStatus.message`: **"Registration settings saved"**.

### Field notes

- `403` without `manage_teams`; `404` for an unknown association; `422` on an invalid `registrationType` or a conditional-field violation (fee/duration).

---

## 3. `RegistrationSetting` shape (reference)

Mirrors `RegistrationSetting` in `src/types.ts`.

```ts
type RegistrationEntityType = 'team' | 'player' | 'umpire'

interface RegistrationSetting {
  registrationType: RegistrationEntityType
  allowSelfRegistration: boolean
  paymentApplicable: boolean
  applicableFee: number | null   // required when paymentApplicable
  allowCardPayment: boolean      // online (Stripe); forced false when not Stripe-connected
  allowOfflinePayment: boolean   // manual cash/cheque/etc.
  neverExpires: boolean
  durationDays: number | null    // required when !neverExpires
  platformFee: {                 // READ-ONLY — resolved WIF platform-fee rule for this type
    feeType: 'fixed' | 'percent' | 'tiered'
    feeValue: number             // flat $ (fixed) or % (percent, e.g. 5 = 5%)
    minFeeAmount: number | null
    maxFeeAmount: number | null
    ruleId?: string
  } | null
}
```

### DB column mapping

| Wire | `association_reg_settings` column |
|---|---|
| `registrationType` | `registration_type` (int: 0=team, 1=player, 2=umpire) |
| `allowSelfRegistration` | `allow_self_registration` (tinyint) |
| `paymentApplicable` | `payment_applicable` (tinyint) |
| `applicableFee` | `applicable_fee` (decimal(10,2)) |
| `allowCardPayment` | `allow_card_payment` (tinyint, default 1) |
| `allowOfflinePayment` | `allow_offline_payment` (tinyint, default 1) |
| `neverExpires` | `never_expires` (tinyint) |
| `durationDays` | `duration_days` (int) |
| `platformFee` | *no column* — resolved read-only from [`platform_fee_rules`](../system/sql-schema-payments.md#platform_fee_rules) (returned on read, not stored on this table) |

## 4. Frontend client (this repo)

- `fetchRegistrationSettings({ associationId, type? })` / `updateRegistrationSettings(associationId, settings)` in `src/api/associationRegSettings.ts` (mock-first behind `REG_SETTINGS_LIVE`). Pass `type` to fetch a single type (the wizard + Statement pass `'team'`); omit it for all three (the Settings popup).
- `RegistrationSetting` / `RegistrationEntityType` types in `src/types.ts`.
- UI: `src/components/RegistrationSettingsModal.vue` (team / umpire / player pill tabs, single Save).

## 5. Out of scope (deferred)

- Wiring `allow_self_registration` to an actual public self-registration entry point.
- Charging `applicable_fee` through the payments flow (Stripe Connect).
- Applying `never_expires` / `duration_days` as the default in the team Register wizard's activation step (a future link to these settings).
