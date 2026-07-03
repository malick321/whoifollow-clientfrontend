// identity
// --------
// Lightweight, privacy-limited lookup of the global WIF `users` table by
// email. Used wherever an admin types a person's email and we want to know
// whether that person already has a WIF account — so we can LINK the existing
// user instead of inviting a stranger.
//
// First consumer: the Register/Edit Team wizard's manager-email field. When a
// match is found we store its id as `managerLinkedUserId`; when none is found
// we flag that an invite should be emailed (`sendManagerInvite`).
//
// Mock-first (mirrors the rest of `src/api/*`): flip `IDENTITY_LOOKUP_LIVE` and
// the live branch hits `GET /v2/users/lookup?email=`. See
// `docs/api/system-identity-api-contract.md`.

import { getJson } from './client'
import type { WifUserIdentity } from '../types'

const IDENTITY_LOOKUP_LIVE = false

const SIMULATED_LATENCY_MS = 360

/** Standard v2 envelope. */
interface Envelope<T> {
  responseStatus?: { statusCode: number; message?: string; text?: string }
  data: T
}

/** A small, deterministic set of "already on WIF" people so QA can exercise
 *  the found path with stable, recognizable names. Keyed by lowercase email. */
const MOCK_WIF_USERS: WifUserIdentity[] = [
  { id: 'u_5001', name: 'Tom Whitesides', email: 'tom.whitesides@example.com', avatarUrl: 'https://cdn.whoifollow.tech/users/5001.png' },
  { id: 'u_5002', name: 'Lisa Trent', email: 'lisa.trent@example.com' },
  { id: 'u_5003', name: 'Marcus Holloway', email: 'marcus.holloway@example.com' },
  { id: 'u_5004', name: 'Patricia Vance', email: 'patricia.vance@example.com' },
  { id: 'u_5005', name: 'Diego Mendez', email: 'diego.mendez@example.com' }
]

function delay<T>(value: T, ms = SIMULATED_LATENCY_MS): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

/** Synthesize a stable identity from an email so the "found" path is easy to
 *  trigger in the demo: any address whose local part contains `wif` or
 *  `member` resolves to a made-up-but-consistent WIF user. */
function syntheticMatch(email: string): WifUserIdentity | null {
  const local = email.split('@')[0] ?? ''
  if (!/(wif|member)/i.test(local)) return null
  const pretty = local
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
  // Deterministic id from the email so re-typing the same address links the
  // same user across keystrokes / reloads.
  let hash = 0
  for (let i = 0; i < email.length; i++) hash = (hash * 31 + email.charCodeAt(i)) >>> 0
  return { id: `u_${6000 + (hash % 3000)}`, name: pretty || 'WIF Member', email }
}

/**
 * Look up a WIF user by email. Returns the matched identity or `null` when no
 * account exists for that address.
 */
export async function lookupWifUserByEmail(email: string): Promise<WifUserIdentity | null> {
  const trimmed = email.trim()
  if (!trimmed) return null

  if (IDENTITY_LOOKUP_LIVE) {
    const env = await getJson<Envelope<WifUserIdentity | null>>(
      `/users/lookup?email=${encodeURIComponent(trimmed)}`
    )
    const data: unknown = (env as { data?: unknown })?.data
    return data ? (data as WifUserIdentity) : null
  }

  const lower = trimmed.toLowerCase()
  const seeded = MOCK_WIF_USERS.find((u) => u.email.toLowerCase() === lower)
  return delay(seeded ? { ...seeded } : syntheticMatch(trimmed))
}
