// money
// -----
// Shared helpers for currency inputs / display so the rules live in ONE place
// (don't reimplement per screen). Used by the event form's entry-fee/partial
// inputs and the registration-settings fee input.

import type { PlatformFeeRule } from '../types'

/** Trim a money input string to at most 2 decimal places (as the user types —
 *  the native `step` only validates on submit). Pure; returns the clamped
 *  string. */
export function limitTwoDecimals(value: string): string {
  const dot = value.indexOf('.')
  if (dot !== -1 && value.length - dot - 1 > 2) return value.slice(0, dot + 3)
  return value
}

/** Format a number as `$N` (integers) or `$N.NN` (otherwise). */
export function formatMoney(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`
}

/** Apply a resolved platform-fee rule to an amount → the fee (2-decimal,
 *  clamped to the rule's optional min/max). Mirrors the backend resolution for
 *  PREVIEW only — the backend re-resolves + is authoritative. `tiered` is not
 *  used yet (returns 0). Pass `null`/undefined → 0. */
export function applyPlatformFee(
  amount: number,
  rule: PlatformFeeRule | null | undefined
): number {
  if (!rule || !(amount > 0)) return 0
  let fee = 0
  if (rule.feeType === 'fixed') fee = rule.feeValue
  else if (rule.feeType === 'percent') fee = amount * (rule.feeValue / 100)
  // 'tiered' → reserved; no tiers shipped yet, so 0.
  if (rule.minFeeAmount != null) fee = Math.max(fee, rule.minFeeAmount)
  if (rule.maxFeeAmount != null) fee = Math.min(fee, rule.maxFeeAmount)
  return Math.round(fee * 100) / 100
}
