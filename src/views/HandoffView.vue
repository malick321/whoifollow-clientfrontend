<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { validateHandoffToken } from '../api/handoff'
import { isAuthenticated, setAuthSession } from '../auth-session'
import {
  ALLOWED_PARENT_ORIGINS,
  HANDOFF_REQUEST_TYPE,
  HANDOFF_TOKEN_TYPE,
  HANDOFF_ERROR_TYPE,
  isHandoffInboundMessage
} from '../handoff-types'
import type { HandoffInboundMessage, HandoffStatus } from '../handoff-types'
import { openLoginModal } from '../login-modal-center'
import { fetchMyAssociation } from '../api/myAssociations'
import { setCurrentAssociation } from '../constants/associations'
import { firstPermittedPortalRoute } from '../lib/permissions'

// HandoffView
// -----------
// Mounted on EITHER of two routes when the first router beforeEach guard
// detects an unauthenticated user trying to enter a protected resource:
//
//   - /event/participation/:teamParticipationId/handoff   (participation flow)
//   - /association/:associationShortName/handoff          (association portal flow)
//
// In both cases the view:
//   1. Posts a `wif:request-handoff-token` message to the parent window on
//      each whitelisted origin.
//   2. Listens for a `wif:handoff-token` (or `wif:handoff-error`) reply.
//   3. Exchanges the handoff token for a real auth token via
//      validateHandoffToken() and persists the session.
//   4. Routes the user to the appropriate destination:
//        - Participation: back to the team-participation page they
//          came from.
//        - Portal: fetches the user's membership for the slug and lands
//          them on the FIRST sidebar section they have permission for
//          (so a user without `manage_events` doesn't end up on the
//          events page that triggered the handoff).
//
// User-facing status copy is deliberately ambient ("Getting things ready",
// "Loading your event", ...) so the experience feels like a normal app boot,
// not an auth flow. The small Login button at the bottom is a temporary
// fallback — it will be removed once the parent app handoff is reliable on
// live.

const route = useRoute()
const router = useRouter()

const teamParticipationId = computed(() => (route.params.teamParticipationId as string | undefined) ?? '')
const associationShortName = computed(() => (route.params.associationShortName as string | undefined) ?? '')

/** Mode flag: are we handing off for the participation flow or the
 *  association-portal flow? Determined by which route mounted us
 *  (i.e. which path param is populated). The two flows differ only
 *  in (a) the postMessage payload to the parent and (b) where we
 *  route the user on success — see `redirectAfterAuth`. */
const isPortalHandoff = computed(() => !!associationShortName.value)

const status = ref<HandoffStatus>('getting-ready')

// Dev helper: accept postMessages from the current origin too so we can
// manually simulate the parent from the devtools console. In production the
// whitelist is strict to whoifollow.tech / whoifollow.com.
const allowedOrigins = computed<string[]>(() => {
  const base = [...ALLOWED_PARENT_ORIGINS]
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    base.push(window.location.origin)
  }
  return base
})

const statusCopy = computed<{ title: string }>(() => {
  switch (status.value) {
    case 'getting-ready':
      return { title: 'One moment…' }
    case 'waiting':
      return { title: 'Getting you in…' }
    case 'verifying':
      return { title: 'Almost done…' }
    case 'loading-data':
      return { title: 'Here we go…' }
    case 'error':
      return { title: 'Just a sec…' }
    default:
      return { title: 'One moment…' }
  }
})

let messageListener: ((event: MessageEvent) => void) | null = null
let waitingTransitionTimeout: number | null = null
let processing = false

// Dev-only tracer — no-op in production builds. Use for every state change
// and message so a developer can follow the flow in devtools.
function logDev(...args: unknown[]) {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log('[handoff]', ...args)
  }
}

function postRequestToParent() {
  if (typeof window === 'undefined') return
  const parent = window.parent
  if (!parent || parent === window) {
    // Not in an iframe — no parent to post to. Stay in the 'waiting' state
    // in BOTH dev and production so the experience is consistent when the
    // URL is opened directly in a browser. The always-visible "Login with
    // email and password" fallback under the status card gives the user a
    // manual escape hatch. NotFoundView is still used for genuine errors
    // (wif:handoff-error from the parent, or a failed verifyToken call) —
    // those branches are handled inside handleMessage / processToken.
    logDev(
      'not inside an iframe — staying in "waiting" state. To simulate a',
      'parent reply (dev only), dispatch: window.postMessage({ type: "wif:handoff-token",',
      'token: "TEST", participationId: "' + teamParticipationId.value + '" }, window.location.origin)'
    )
    return
  }

  const message = {
    type: HANDOFF_REQUEST_TYPE,
    source: 'matchgeni' as const,
    // Participation flow carries the id so the parent can scope the
    // issued handoff token; portal flow leaves it empty and the parent
    // issues a general-purpose session.
    participationId: teamParticipationId.value
  }

  logDev('posting request to parent', message, 'targetOrigins:', allowedOrigins.value)

  // Browsers only accept one targetOrigin per call, so fan the request out
  // across every whitelisted origin. The parent on the correct origin picks
  // it up; the others ignore it.
  for (const origin of allowedOrigins.value) {
    try {
      parent.postMessage(message, origin)
    } catch (err) {
      // Some origins may throw (e.g. localhost variants in dev). Safe to
      // swallow — the other origins still get the message.
      logDev('postMessage threw for origin', origin, err)
    }
  }
}

function handleMessage(event: MessageEvent) {
  if (processing) return
  if (!allowedOrigins.value.includes(event.origin)) {
    logDev('ignoring message from non-whitelisted origin', event.origin)
    return
  }
  if (event.source !== window.parent && event.source !== window) {
    logDev('ignoring message — event.source is neither parent nor self')
    return
  }
  if (!isHandoffInboundMessage(event.data)) return

  const data = event.data as HandoffInboundMessage
  logDev('received inbound message', data)

  if (data.type === HANDOFF_ERROR_TYPE) {
    processing = true
    logDev('parent reported error — routing to NotFoundView', data.code, data.message)
    // Parent told us it can't issue a token (user not signed in on the
    // main app, getToken 4xx, etc.) — per product spec we land on the
    // friendly "not available" page rather than lingering on an ambient
    // loading screen.
    router.replace({ name: 'not-found' })
    return
  }

  if (data.type === HANDOFF_TOKEN_TYPE) {
    if (!data.token || typeof data.token !== 'string') {
      logDev('handoff-token message missing a valid token field — routing to NotFoundView')
      router.replace({ name: 'not-found' })
      return
    }
    processing = true
    void processToken(data.token)
  }
}

async function processToken(handoffToken: string) {
  logDev('processing handoff token → calling validateHandoffToken')
  status.value = 'verifying'
  try {
    // No participationId argument — verifyToken derives it from the handoff
    // token itself on the backend side.
    const result = await validateHandoffToken(handoffToken)
    logDev('token validated, auth session established for', result.email || '(no email)')
    setAuthSession({ email: result.email, deviceToken: result.deviceToken })
    status.value = 'loading-data'
    void redirectAfterAuth()
  } catch (err) {
    // Invalid / expired / already-consumed handoff token → NotFoundView per
    // product spec. The ambient "error" status flash is no longer needed
    // because we're leaving the view entirely.
    logDev('validateHandoffToken failed — routing to NotFoundView', err)
    router.replace({ name: 'not-found' })
  }
}

/** Send the freshly-authenticated user to the right destination.
 *
 *  Participation flow: back to the team-participation page they came
 *  from (path param `teamParticipationId` is already on the route).
 *
 *  Portal flow: fetch the user's membership for the slug, pre-seed
 *  `currentAssociation` (so the second beforeEach guard reuses it
 *  instead of refetching), and navigate to the FIRST permitted
 *  sidebar section. Outcomes:
 *    - User has at least one portal permission → lands on that route.
 *    - 403 (slug exists but user has no membership / pending invite)
 *      or 404 (slug doesn't exist or is soft-deleted) → NotFoundView.
 *    - User has membership but ZERO portal permissions → NotFoundView
 *      (no sensible default landing page — they shouldn't have made
 *      it past the invite stage with no perms; safe-default deny).
 */
async function redirectAfterAuth() {
  if (!isPortalHandoff.value) {
    router.replace({
      name: 'team-participation',
      params: { teamParticipationId: teamParticipationId.value }
    })
    return
  }

  status.value = 'loading-data'
  try {
    const membership = await fetchMyAssociation(associationShortName.value)
    setCurrentAssociation(membership)
    const routeName = firstPermittedPortalRoute(membership)
    if (!routeName) {
      logDev('portal handoff: membership has zero portal permissions — routing to NotFoundView')
      router.replace({ name: 'not-found' })
      return
    }
    router.replace({
      name: routeName,
      params: { associationShortName: membership.slug }
    })
  } catch (err: unknown) {
    const code = (err as { code?: number } | null)?.code
    logDev('portal handoff: membership fetch failed', code, err)
    router.replace({ name: 'not-found' })
  }
}

// Redirect whenever auth flips to true. Covers two paths:
//   1. Successful handoff token exchange (processToken calls setAuthSession)
//   2. Manual fallback login via the LoginModal (sets auth session but has no
//      knowledge of this view's purpose)
// Using a watcher keeps redirect logic in one place and reactive.
watch(isAuthenticated, (authed) => {
  if (authed) void redirectAfterAuth()
})

onMounted(() => {
  if (isAuthenticated.value) {
    void redirectAfterAuth()
    return
  }

  messageListener = handleMessage
  window.addEventListener('message', messageListener)

  // Brief "getting ready" beat so the transition to "waiting" feels
  // intentional rather than instant-flicker.
  waitingTransitionTimeout = window.setTimeout(() => {
    if (status.value === 'getting-ready') status.value = 'waiting'
  }, 450)

  postRequestToParent()
})

onBeforeUnmount(() => {
  if (messageListener) {
    window.removeEventListener('message', messageListener)
    messageListener = null
  }
  if (waitingTransitionTimeout != null) {
    window.clearTimeout(waitingTransitionTimeout)
    waitingTransitionTimeout = null
  }
})

function onLoginClick() {
  openLoginModal()
}
</script>

<template>
  <div class="handoff-view">
    <div class="handoff-view__card" role="status" aria-live="polite">
      <div class="handoff-view__spinner" aria-hidden="true">
        <span class="handoff-view__dot"></span>
        <span class="handoff-view__dot"></span>
        <span class="handoff-view__dot"></span>
      </div>

      <h1 class="handoff-view__title">{{ statusCopy.title }}</h1>

      <button class="handoff-view__login" type="button" @click="onLoginClick">
        Login with email and password
      </button>
    </div>
  </div>
</template>
