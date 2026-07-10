// stripePricingTable
// ------------------
// Loads Stripe's hosted pricing-table web component script
// (`https://js.stripe.com/v3/pricing-table.js`) exactly once, mirroring the
// legacy GoSubscribe.vue `loadStripeScript`. This registers the
// <stripe-pricing-table> custom element used by the Go Pro page.
//
// Separate from lib/stripe.ts (which loads Stripe.js / Elements for the Shop
// checkout) — the pricing-table script is a distinct bundle.

const PRICING_TABLE_SRC = 'https://js.stripe.com/v3/pricing-table.js'

const pricingTableId = (import.meta.env.VITE_STRIPE_PRICING_TABLE_ID ?? '').trim()
const publishableKey = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? '').trim()

/** `true` when both the publishable key and pricing-table id are configured. */
export function hasPricingTableConfig(): boolean {
  return pricingTableId.length > 0 && publishableKey.length > 0
}

export function getPricingTableId(): string {
  return pricingTableId
}

export function getPublishableKey(): string {
  return publishableKey
}

let loadPromise: Promise<boolean> | null = null

/** Inject the pricing-table script once. Resolves `true` when the element is
 *  ready, `false` if the script fails to load (caller renders a fallback). */
export function loadPricingTableScript(): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(false)
  if (loadPromise) return loadPromise

  loadPromise = new Promise<boolean>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${PRICING_TABLE_SRC}"]`)
    if (existing) {
      // Already present (e.g. a prior visit) — the custom element is defined.
      resolve(true)
      return
    }
    const script = document.createElement('script')
    script.src = PRICING_TABLE_SRC
    script.async = true
    script.onload = () => resolve(true)
    script.onerror = () => {
      loadPromise = null // allow a later retry
      resolve(false)
    }
    document.head.appendChild(script)
  })

  return loadPromise
}
