// associationRegSettings
// -----------------------
// Per-association registration settings for each registration TYPE (team /
// player / umpire): self-registration on/off, payment applicable + fee, and
// the default validity granted on activation (never-expires or N days).
//
// Backed by `association_reg_settings` (one row per association per type) — see
// `docs/system/sql-schema-association.md#association_reg_settings` +
// `docs/api/association-registration-settings-api-contract.md`. Mock-first
// (mirrors `associationRatings.ts` / `customFields.ts`) — flip
// `REG_SETTINGS_LIVE` + wire the live branches once the endpoints ship.

import { getJson, putJson } from './client'
import type { PlatformFeeRule, RegistrationEntityType, RegistrationSetting } from '../types'

const REG_SETTINGS_LIVE = false

const SIMULATED_LATENCY_MS = 300

/** Standard v2 envelope. */
interface Envelope<T> {
  responseStatus?: { statusCode: number; message?: string; text?: string }
  data: T
}

/** The three types, in display order — also the set every read returns. */
export const REGISTRATION_TYPES: RegistrationEntityType[] = ['team', 'player', 'umpire']

function delay<T>(value: T, ms = SIMULATED_LATENCY_MS): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

// Resolved platform-fee rule per registration type — mirrors the global seed in
// `platform_fee_rules` (team = item 1 → 5%, player = item 3 → 3%, umpire =
// item 4 → flat $0). The live backend resolves this per scope/priority and
// returns it on the settings GET; the mock returns the global default.
const PLATFORM_FEE_BY_TYPE: Record<RegistrationEntityType, PlatformFeeRule> = {
  team: { feeType: 'percent', feeValue: 5, minFeeAmount: null, maxFeeAmount: null, ruleId: '1' },
  player: { feeType: 'percent', feeValue: 3, minFeeAmount: null, maxFeeAmount: null, ruleId: '3' },
  umpire: { feeType: 'fixed', feeValue: 0, minFeeAmount: null, maxFeeAmount: null, ruleId: '4' }
}

/** Sensible defaults for a type that has no saved row yet. */
function defaultSetting(type: RegistrationEntityType): RegistrationSetting {
  return {
    registrationType: type,
    allowSelfRegistration: false,
    paymentApplicable: false,
    applicableFee: null,
    allowCardPayment: true,
    allowOfflinePayment: true,
    neverExpires: false,
    durationDays: 365,
    platformFee: { ...PLATFORM_FEE_BY_TYPE[type] }
  }
}

// In-memory store keyed by associationId so edits persist across opens in dev.
const mockStore = new Map<string, RegistrationSetting[]>()
function mockFor(associationId: string): RegistrationSetting[] {
  if (!mockStore.has(associationId)) {
    mockStore.set(associationId, REGISTRATION_TYPES.map(defaultSetting))
  }
  return mockStore.get(associationId)!
}

/** Normalize a raw list → exactly one entry per type, in canonical order,
 *  filling any missing type with defaults. Keeps the UI simple (always 3). */
function normalize(list: RegistrationSetting[]): RegistrationSetting[] {
  return REGISTRATION_TYPES.map(
    (type) => list.find((s) => s.registrationType === type) ?? defaultSetting(type)
  )
}

/**
 * Fetch registration settings for an association.
 *
 * - Omit `type` → returns one entry per type (team / player / umpire), with
 *   defaults for any not yet saved (the Settings popup edits all three at once).
 * - Pass `type` → returns just that type as a 1-element list (the team Register
 *   wizard / Statement gating only need their own type). The response **shape is
 *   identical** either way (a `RegistrationSetting[]`), so callers always
 *   `.find(...)` / read `[0]` without branching.
 */
export async function fetchRegistrationSettings(opts: {
  associationId: string
  type?: RegistrationEntityType
}): Promise<RegistrationSetting[]> {
  if (REG_SETTINGS_LIVE) {
    const id = encodeURIComponent(opts.associationId)
    const query = opts.type ? `?type=${encodeURIComponent(opts.type)}` : ''
    const env = await getJson<Envelope<{ list: RegistrationSetting[] }>>(
      `/association/${id}/registration-settings${query}`
    )
    const data: unknown = (env as { data?: unknown })?.data
    const list = Array.isArray(data)
      ? (data as RegistrationSetting[])
      : ((data as { list?: RegistrationSetting[] } | null)?.list ?? [])
    return opts.type
      ? [list.find((s) => s.registrationType === opts.type) ?? defaultSetting(opts.type)]
      : normalize(list)
  }
  const all = mockFor(opts.associationId)
  const rows = opts.type
    ? [all.find((s) => s.registrationType === opts.type) ?? defaultSetting(opts.type)]
    : all
  // Overlay the resolved platform-fee rule on every row — it's backend-resolved
  // (not user-editable) so saved rows from the popup don't carry it.
  return delay(rows.map((s) => ({ ...s, platformFee: { ...PLATFORM_FEE_BY_TYPE[s.registrationType] } })))
}

/**
 * Bulk-save all three registration settings in one go. Returns the saved list.
 */
export async function updateRegistrationSettings(
  associationId: string,
  settings: RegistrationSetting[]
): Promise<RegistrationSetting[]> {
  const normalized = normalize(settings)
  if (REG_SETTINGS_LIVE) {
    const id = encodeURIComponent(associationId)
    const env = await putJson<Envelope<{ list: RegistrationSetting[] }>>(
      `/association/${id}/registration-settings`,
      { settings: normalized }
    )
    const data: unknown = (env as { data?: unknown })?.data
    const list = Array.isArray(data)
      ? (data as RegistrationSetting[])
      : ((data as { list?: RegistrationSetting[] } | null)?.list ?? normalized)
    return normalize(list)
  }
  mockStore.set(associationId, normalized.map((s) => ({ ...s })))
  return delay(normalized.map((s) => ({ ...s })))
}
