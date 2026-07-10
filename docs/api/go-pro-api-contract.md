# Go Pro — API contract

Subscription upgrade ("Go Pro"). Kept **identical to the legacy system** for now:
a Stripe hosted `<stripe-pricing-table>` embed (recurring subscription managed by
Stripe). A native in-app checkout — reusing the Shop's Stripe Elements flow — is
a planned upgrade; this contract documents the interim faithful replica.

> ⚠️ These are **legacy** (non-`/v2`) endpoints, reused as-is. No new backend was
> written. When the native checkout lands, a `/v2/subscription/*` contract
> supersedes this file.

## Endpoints (reused, legacy)

### 1. `POST /getUrlforPackages`  (auth required)
`PayController@getUrlforPackages`. Ensures the viewer has a Stripe Customer,
reads their current subscription, and returns an encrypted-email handle.

Request: `{}` (empty; auth identifies the user).

Response — legacy envelope (`{ data, message, statusCode }`), `data`:
```jsonc
{
  "encrypted_email": "eyJpd…",         // Laravel Crypt handle for the user email
  "proStatus": 1,                       // 1 = active subscription, else null
  "expiryDate": "2027-01-10 12:00:00",  // renewal date when active, else null
  "subscriptionPlan": "Pro",            // active plan product name, else null
  "noSubscriptionAvailed": null,        // 1 = never subscribed, else null
  "customer_session_url": "https://…",  // (unused here)
  "getPackageUrl": "https://…"          // (unused here)
}
```

### 2. `POST /decryptEmail`  (public)
`LoginController@decryptEmail`. Exchanges the encrypted-email handle for a fresh
Stripe **CustomerSession** client secret that authorises the pricing table.

Request:
```jsonc
{ "encrypted_email": "eyJpd…", "user_id": "1234" }  // user_id is a decrypt fallback
```

Response — bare object (NOT enveloped):
```jsonc
{ "email": "user@example.com", "customer_session_secret": "cuss_…" }
```
Errors: `404 { error }` (user not found) / `400 { error, message }`.

## Frontend wiring

- `src/api/subscription.ts` → `fetchPackagesInfo()` + `openPricingTableSession(encryptedEmail)`
  (both via `postLegacyJson`).
- `src/lib/stripePricingTable.ts` → loads `js.stripe.com/v3/pricing-table.js` once.
- `src/views/GoProView.vue` (`/go-pro`) → on mount: load script + `fetchPackagesInfo()`;
  if `proStatus` → show plan + renewal date; else `openPricingTableSession()` →
  render `<stripe-pricing-table>`. Keyless/errored → "payments unavailable".
- Triggers: `MemberTopBar.vue` "Go Pro" button and every `PlayerPassportView.vue`
  `goPro()` upsell button route to `/go-pro`.

## Config

- `VITE_STRIPE_PUBLISHABLE_KEY` — Stripe publishable key (shared with Shop).
- `VITE_STRIPE_PRICING_TABLE_ID` — `prctbl_…` id from the Stripe Dashboard.
- Backend Stripe secret (`STRIPE_SECRET`) is already configured server-side.
- `vite.config.ts` registers `stripe-pricing-table` as a custom element.
