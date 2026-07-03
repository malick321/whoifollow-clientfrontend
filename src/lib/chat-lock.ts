// chat-lock
// ---------
// Client-side PIN lock for the Chat surface (WhatsApp-style "App Lock" +
// per-conversation "Chat Lock"). The PIN is NEVER stored in plaintext — we
// derive a PBKDF2-SHA256 hash (with a random salt) via WebCrypto and persist
// only the hash + salt in localStorage. Verification re-derives from the
// entered PIN and compares.
//
// This is a device-local gate (fast to ship, no backend/schema changes). It
// can be moved server-side later (store the same hash/salt via a /v2/chat/lock
// endpoint) for cross-device sync — the crypto here stays identical.
//
// NOTE: a PIN gate is a privacy/access gate, not encryption-at-rest. To make it
// bulletproof we'd additionally encrypt the IndexedDB message cache with a key
// derived from the PIN (phase 2).

const STORAGE_KEY = 'wif_chat_lock'
const PBKDF2_ITERATIONS = 150_000

export interface ChatLockConfig {
  enabled: boolean
  /** base64 PBKDF2 hash of the PIN. */
  hash: string | null
  /** base64 random salt used for the hash. */
  salt: string | null
  /** Auto-lock after this many minutes hidden/idle (0 = only on reload). */
  autoLockMinutes: number
  /** Conversation ids the user has individually locked. */
  lockedConversationIds: string[]
}

const DEFAULT_CONFIG: ChatLockConfig = {
  enabled: false,
  hash: null,
  salt: null,
  autoLockMinutes: 5,
  lockedConversationIds: []
}

function bytesToB64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

/** Derive a PBKDF2-SHA256 hash for `pin`. Reuses `saltB64` when verifying;
 *  generates a fresh salt when setting a new PIN. */
export async function derivePinHash(
  pin: string,
  saltB64?: string
): Promise<{ hash: string; salt: string }> {
  const enc = new TextEncoder()
  const salt = saltB64 ? b64ToBytes(saltB64) : crypto.getRandomValues(new Uint8Array(16))
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(pin),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  )
  return { hash: bytesToB64(new Uint8Array(bits)), salt: bytesToB64(salt) }
}

/** True when `pin` matches the stored hash/salt. */
export async function verifyPinAgainst(
  pin: string,
  hashB64: string,
  saltB64: string
): Promise<boolean> {
  try {
    const { hash } = await derivePinHash(pin, saltB64)
    return hash === hashB64
  } catch {
    return false
  }
}

export function loadLockConfig(): ChatLockConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_CONFIG }
    const parsed = JSON.parse(raw) as Partial<ChatLockConfig>
    return {
      enabled: !!parsed.enabled,
      hash: parsed.hash ?? null,
      salt: parsed.salt ?? null,
      autoLockMinutes:
        typeof parsed.autoLockMinutes === 'number' ? parsed.autoLockMinutes : DEFAULT_CONFIG.autoLockMinutes,
      lockedConversationIds: Array.isArray(parsed.lockedConversationIds)
        ? parsed.lockedConversationIds.map(String)
        : []
    }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveLockConfig(config: ChatLockConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    /* private mode / quota — lock still applies in-session */
  }
}
