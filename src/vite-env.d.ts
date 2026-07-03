/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_ENV: 'staging' | 'live' | undefined
  /** Google Maps JS API key (Maps JavaScript API + Places API). When unset,
   *  the public Map Explorer falls back to a placeholder. Exposed to the
   *  client via the `envPrefix` whitelist in vite.config.ts. */
  readonly GOOGLE_MAPS_API_KEY?: string
  /** Stripe publishable key (pk_test_… / pk_live_…) for the Shop checkout's
   *  Elements card field. When unset, checkout shows a "payments unavailable"
   *  notice instead of the card form. */
  readonly VITE_STRIPE_PUBLISHABLE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, any>
  export default component
}
