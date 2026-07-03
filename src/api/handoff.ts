import { buildV2ApiUrl } from './config'

// Handoff token verification.
//
// Exchanges the short-lived handoff token (received from the parent app via
// postMessage — see src/views/HandoffView.vue) for a long-lived auth token
// that we persist via setAuthSession() and attach to every subsequent API
// call as `Authorization: Bearer …`.
//
// Explicitly unauthenticated: this endpoint is the exchange point, so the
// user hasn't signed into matchgeni yet. We intentionally bypass the
// postJson wrapper (which auto-attaches Bearer from localStorage via
// getAuthHeaders) because a stale invalid token sitting in storage could
// cause the backend's auth middleware to reject the request before it
// reaches the handoff handler. Using a direct fetch with a Content-Type-
// only header guarantees the call stays unauthenticated on our side.
//
// Response envelope matches the rest of the v2 API: `statusCode`, `message`,
// optional `data`.

interface VerifyHandoffEnvelope {
  statusCode?: number | null
  message?: string | null
  data?: {
    authToken?: string | null
    email?: string | null
    userId?: string | number | null
  } | null
}

export interface HandoffValidateResult {
  /** Kept named `deviceToken` so the caller can pass it straight into
   *  setAuthSession({ email, deviceToken }) without renaming. The backing
   *  localStorage key (`wif_device_token`) is unchanged. */
  deviceToken: string
  email: string
}

export async function validateHandoffToken(
  handoffToken: string
): Promise<HandoffValidateResult> {
  const response = await fetch(buildV2ApiUrl('/matchgeniHandoff/verifyToken'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handoffToken })
  })
  const envelope = (await response.json().catch(() => ({}))) as VerifyHandoffEnvelope

  const authToken = envelope?.data?.authToken?.trim()
  if (!response.ok || !authToken) {
    throw new Error(
      envelope?.message ||
        `Handoff token is invalid or expired. (HTTP ${response.status})`
    )
  }

  return {
    deviceToken: authToken,
    email: envelope?.data?.email ?? ''
  }
}
