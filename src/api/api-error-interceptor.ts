// API error interceptor
// ---------------------
// Cross-cutting handler for 401 / 403 responses from any backend
// call. Each API client's fetch helper invokes
// `interceptApiError(status, body, options)` BEFORE throwing its
// own typed error; the interceptor decides whether to:
//
//   - **401** wipe the local session + redirect to the per-slug
//     handoff route. Token's gone, the user has to sign back in.
//   - **403** trigger `reconcilePermissions()`: refetch the
//     caller's `currentAssociation` payload + clear downstream
//     permission caches (matchgeni context + the matchgeni
//     events-list menu cache). If the active route's required
//     permission is no longer held, redirect to a route the user
//     CAN access. The caller still throws so per-action error
//     handling (toasts, retry buttons) continues to work; the
//     interceptor's job is purely to keep the UI in sync with
//     the backend's authoritative permission state.
//
// Why a registration hook (`registerApiErrorHandler`) rather than
// direct imports of router / fetchMyAssociation:
//   - `src/api/*` modules are imported by `src/router.ts` and
//     `src/views/*` — importing the router back would form a
//     circular reference graph that Vite resolves but TypeScript
//     warns on. The hook lets `main.ts` wire the concrete
//     navigation + refetch implementations at app boot without
//     the API layer needing to reach into Vue Router.

export interface ApiErrorContext {
  /** When `false`, the interceptor is being called by the
   *  reconcile-permissions refetch itself — skip the 403 handler
   *  to avoid an infinite loop (a stale token / revoked
   *  association would otherwise re-trigger reconciliation
   *  forever). */
  isRecoveryCall?: boolean
}

/** Registered by `main.ts` after the router + association
 *  helpers are wired. Lets the interceptor hand off the actual
 *  redirect + refetch work without importing the router into the
 *  api layer. */
export interface ApiErrorHandlers {
  /** Called when ANY API returns 401. Implementation typically
   *  clears the local session + replaces the route with the
   *  per-slug handoff so the user can sign back in. */
  onUnauthorized: () => void
  /** Called when ANY API returns 403. Implementation refetches
   *  the caller's `currentAssociation` payload, invalidates
   *  permission-dependent caches, and re-evaluates the active
   *  route's required permission. */
  onForbidden: () => Promise<void> | void
}

let handlers: ApiErrorHandlers | null = null

/** Wired once from `main.ts` at app boot. Subsequent calls
 *  overwrite the previous registration (useful for testing). */
export function registerApiErrorHandlers(next: ApiErrorHandlers) {
  handlers = next
}

// ── Loop guards ─────────────────────────────────────────────────
// `reconcilePermissions` fires `fetchMyAssociation` which itself
// flows through this interceptor. If that fetch 403s we MUST NOT
// recurse — the caller is already in recovery. Same logic for 401:
// if the unauthorized handler is in flight, swallow further 401s.
let reconcileInFlight = false
let unauthorizedFired = false

/** Called by each API client's fetch helper on non-2xx responses
 *  BEFORE the typed error is thrown. Inspects `status` and
 *  dispatches to the registered handlers. Returns nothing — the
 *  caller continues to throw its own typed error so per-action
 *  handling (toasts, retry, etc.) is unchanged. */
export async function interceptApiError(
  status: number,
  _body: unknown,
  ctx: ApiErrorContext = {}
): Promise<void> {
  // 401 — token expired / revoked.
  if (status === 401) {
    if (unauthorizedFired) return
    unauthorizedFired = true
    // Reset the flag on the next tick so a fresh interactive flow
    // can re-trigger the handler if the user gets stuck.
    setTimeout(() => { unauthorizedFired = false }, 5000)
    if (handlers) handlers.onUnauthorized()
    return
  }

  // 403 — permission denied. Reconcile UNLESS we're already
  // inside a reconcile-driven request.
  if (status === 403) {
    if (ctx.isRecoveryCall) return
    if (reconcileInFlight) return
    if (!handlers) return
    reconcileInFlight = true
    try {
      // Silent reconciliation — no toast. The original action that
      // 403'd already surfaces its own "you don't have permission"
      // message from the caller's catch block; piling a second
      // "Permissions updated" toast on top read as redundant +
      // noisy in QA. The reconcile still runs in the background so
      // the next interaction sees fresh permissions.
      await handlers.onForbidden()
    } finally {
      // Brief debounce window — additional 403s landing in the
      // same tick (parallel reads on view mount) won't re-trigger
      // reconciliation. Clear after a beat so a future 403 caused
      // by a different action can drive a fresh refetch.
      setTimeout(() => { reconcileInFlight = false }, 1500)
    }
  }
}
