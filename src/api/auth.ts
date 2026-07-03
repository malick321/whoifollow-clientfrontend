import { buildLegacyApiUrl } from './config'

interface LoginResponseEnvelope {
  [key: string]: any
}

function findDeviceToken(payload: any): string | null {
  const candidates = [
    payload?.data?.token,
    payload?.token
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate
  }

  return null
}

export async function loginWithEmailPassword(email: string, password: string) {
  const response = await fetch(buildLegacyApiUrl('/login'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email,
      password
    })
  })

  const payload = (await response.json().catch(() => ({}))) as LoginResponseEnvelope

  if (!response.ok) {
    throw new Error(payload?.message || `Login failed: ${response.status}`)
  }

  const deviceToken = findDeviceToken(payload)
  if (!deviceToken) {
    throw new Error(
      payload?.message
        ? `${payload.message} The API response did not include a usable token.`
        : 'Login response did not include a usable token.'
    )
  }

  return {
    payload,
    deviceToken
  }
}
