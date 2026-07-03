// stripe
// ------
// Thin singleton wrapper around `@stripe/stripe-js`. Loads Stripe.js once with
// the `VITE_STRIPE_PUBLISHABLE_KEY` env var (exposed via Vite's default
// `VITE_` prefix). When no key is configured, callers get `null` and surface a
// "payments unavailable" state instead of crashing — mirrors how
// `lib/googleMaps.ts` degrades without its key.
//
// Used by the Shop checkout (CheckoutView) to mount a Stripe Elements card
// field and confirm the PaymentIntent created by `/v2/shop/create-payment-intent`.

import { loadStripe, type Stripe } from '@stripe/stripe-js'

const publishableKey = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? '').trim()

/** `true` when a Stripe publishable key is configured. */
export function hasStripeKey(): boolean {
  return publishableKey.length > 0
}

let stripePromise: Promise<Stripe | null> | null = null

/** Load Stripe.js once. Resolves to the Stripe instance, or `null` when no key
 *  is set (or loading fails) — callers render their keyless fallback. */
export function getStripe(): Promise<Stripe | null> {
  if (!hasStripeKey()) return Promise.resolve(null)
  if (!stripePromise) {
    stripePromise = loadStripe(publishableKey).catch((err) => {
      if (typeof console !== 'undefined') {
        // eslint-disable-next-line no-console
        console.error('[stripe] failed to load Stripe.js:', err)
      }
      stripePromise = null // allow a later retry
      return null
    })
  }
  return stripePromise
}
