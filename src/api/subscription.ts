// subscription
// ------------
// "Go Pro" — Player/Pro upgrade, kept IDENTICAL to the legacy system for now:
// a Stripe hosted pricing-table embed backed by the two still-live legacy
// endpoints (no `/v2` equivalent exists yet; a native in-app checkout is a
// planned upgrade). Contract: docs/api/go-pro-api-contract.md.
//
//   1. POST /getUrlforPackages  (auth)  → the viewer's Stripe customer +
//      current pro status/expiry + an encrypted-email handle.
//   2. POST /decryptEmail       (public) → a fresh Stripe CustomerSession
//      client secret used to authenticate the <stripe-pricing-table>.
//
// Both are legacy (non-`/v2`) routes, so we go through postLegacyJson.

import { postLegacyJson } from './client'
import { getAuthUserId } from '../auth-session'

/** Current Pro standing + the handle needed to open a pricing-table session. */
export interface PackagesInfo {
  encryptedEmail: string
  /** 1 when an active subscription exists, else null. */
  proStatus: number | null
  /** ISO-ish "Y-m-d H:i:s" renewal date when active, else null. */
  expiryDate: string | null
  /** Product name of the active plan (e.g. "Pro"), else null. */
  subscriptionPlan: string | null
  /** 1 when the user has never taken a subscription, else null. */
  noSubscriptionAvailed: number | null
}

/** Stripe CustomerSession handle for the pricing-table web component. */
export interface PricingTableSession {
  email: string
  customerSessionSecret: string
}

// ── Raw wire shapes ─────────────────────────────────────────────────
// getUrlforPackages uses the legacy envelope { data, message, statusCode };
// decryptEmail returns a bare object.
interface PackagesEnvelope {
  statusCode?: number | null
  message?: string | null
  data?: {
    encrypted_email?: string | null
    proStatus?: number | null
    expiryDate?: string | null
    subscriptionPlan?: string | null
    noSubscriptionAvailed?: number | null
  } | null
}

interface DecryptEmailResponse {
  email?: string | null
  customer_session_secret?: string | null
  error?: string | null
  message?: string | null
}

/** Fetch the viewer's pro status + encrypted-email handle. Ensures a Stripe
 *  customer exists server-side as a side effect (legacy behaviour). */
export async function fetchPackagesInfo(): Promise<PackagesInfo> {
  const res = await postLegacyJson<PackagesEnvelope>('/getUrlforPackages', {})
  const d = res?.data ?? {}
  return {
    encryptedEmail: d.encrypted_email ?? '',
    proStatus: d.proStatus ?? null,
    expiryDate: d.expiryDate ?? null,
    subscriptionPlan: d.subscriptionPlan ?? null,
    noSubscriptionAvailed: d.noSubscriptionAvailed ?? null
  }
}

/** Exchange the encrypted-email handle for a fresh pricing-table CustomerSession
 *  client secret. `user_id` is only a decrypt fallback, passed when known. */
export async function openPricingTableSession(encryptedEmail: string): Promise<PricingTableSession> {
  const res = await postLegacyJson<DecryptEmailResponse>('/decryptEmail', {
    encrypted_email: encryptedEmail,
    user_id: getAuthUserId() ?? ''
  })
  const secret = res?.customer_session_secret ?? ''
  if (!secret) {
    throw new Error(res?.error || res?.message || 'Could not start the checkout session.')
  }
  return { email: res?.email ?? '', customerSessionSecret: secret }
}
