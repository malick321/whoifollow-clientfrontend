import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { hydrateThemeOnBoot } from './theme'
import { registerApiErrorHandlers } from './api/api-error-interceptor'
import { fetchMyAssociation } from './api/myAssociations'
import { currentAssociation, setCurrentAssociation, clearCurrentAssociation } from './constants/associations'
import { clearAuthSession } from './auth-session'
import {
  clearMatchGeniContext,
  clearMatchGeniMenuAccess
} from './matchgeni-context'
import { hasAnyPermission, hasPermission } from './lib/permissions'
import type { AssociationPermissionKey } from './types'
import './styles.css'

// Apply the persisted theme class to <html> BEFORE Vue mounts so the initial
// paint matches the saved preference. The inline script in `index.html`
// already runs an equivalent check even earlier (before CSS paints); this
// call is the belt-and-suspenders mirror that also ensures the reactive
// `themeMode` ref's initial value matches what's on `<html>`.
hydrateThemeOnBoot()

// ── API error interceptor wiring ─────────────────────────────────
// Centralised 401 / 403 recovery (see `api/api-error-interceptor.ts`).
//
//   401 → wipe local session, push to the per-slug handoff so the
//         parent iframe / SSO can hand a fresh token back.
//   403 → refetch the caller's `currentAssociation` payload + flush
//         downstream permission caches (matchgeni context, the
//         per-event matchgeni menu access cache used by the events
//         list). If the active route's required permission is no
//         longer held after reconcile, redirect to a route the user
//         CAN access (or fall back to `not-found`).
//
// Wired here at boot so the api layer doesn't import the router
// directly (would form a circular ref graph).
registerApiErrorHandlers({
  onUnauthorized: () => {
    const slug = currentAssociation.value?.slug
    clearAuthSession()
    clearCurrentAssociation()
    clearMatchGeniContext()
    clearMatchGeniMenuAccess()
    if (slug) {
      router.replace({
        name: 'association-handoff',
        params: { associationShortName: slug }
      }).catch(() => { /* navigation duplication ignored */ })
    } else {
      router.replace({ name: 'not-found' }).catch(() => {})
    }
  },
  onForbidden: async () => {
    const slug = currentAssociation.value?.slug
    if (!slug) return
    try {
      const access = await fetchMyAssociation(slug)
      setCurrentAssociation(access)
      // Permission-dependent caches must reset so the next access
      // check evaluates against the fresh payload.
      clearMatchGeniContext()
      clearMatchGeniMenuAccess()
      // If the active route's required permission is no longer held
      // after the refetch, the user is sitting on a forbidden page —
      // bounce them to a route they can access. The router's own
      // beforeEach already enforces this on navigation; we replicate
      // here so the redirect happens immediately instead of waiting
      // for the next user-initiated nav.
      const required = (router.currentRoute.value.meta as {
        requiresPermission?: AssociationPermissionKey | AssociationPermissionKey[]
      } | undefined)?.requiresPermission
      if (required) {
        const ok = Array.isArray(required)
          ? hasAnyPermission(access, required)
          : hasPermission(access, required)
        if (!ok) {
          // Send to the events list — the closest thing to a "home"
          // for the admin portal. If the user lacks even
          // `manage_events`, the router guard will bounce them again
          // to `not-found`. That's acceptable: it's still a bounded
          // recovery flow.
          router.replace({
            name: 'association-events',
            params: { associationShortName: slug }
          }).catch(() => {})
        }
      }
    } catch {
      // Reconcile itself failed (network / 5xx / etc.). Leave the
      // existing cached payload in place — the user can still see
      // the UI; subsequent actions will keep hitting the interceptor
      // until either backend recovers or the user reloads. No
      // user-facing toast here because the original action's toast
      // already conveyed "permissions changed".
    }
  }
})

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
