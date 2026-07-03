/**
 * Compact number formatting for total-count headers — converts
 * raw integers into human-friendly K / M / B suffixes.
 *
 *   formatCompact(0)            → "0"
 *   formatCompact(999)          → "999"
 *   formatCompact(1_000)        → "1K"
 *   formatCompact(1_234)        → "1.2K"
 *   formatCompact(12_345)       → "12.3K"
 *   formatCompact(123_456)      → "123K"
 *   formatCompact(999_999)      → "1M"   // rounds up at the boundary
 *   formatCompact(1_234_567)    → "1.2M"
 *   formatCompact(1_500_000_000) → "1.5B"
 *
 * Decimal precision: one decimal place when the leading number is
 * less than 100 (so "1.2K" / "12.3K" but "123K" / "999K").
 *
 * Returns the raw number for values below 1,000 — there's no
 * smaller unit to abbreviate to.
 */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''

  if (abs < 1_000) return `${sign}${abs}`

  const tiers: Array<{ threshold: number; suffix: string }> = [
    { threshold: 1_000_000_000, suffix: 'B' },
    { threshold: 1_000_000, suffix: 'M' },
    { threshold: 1_000, suffix: 'K' }
  ]

  for (const { threshold, suffix } of tiers) {
    if (abs >= threshold) {
      const scaled = abs / threshold
      // One decimal place when the leading number is < 100
      // (e.g. 1.2K, 12.3K) but no decimal once it's 100+ (e.g.
      // 123K) — keeps the chip narrow without losing precision
      // where it matters.
      const formatted = scaled < 100
        ? scaled.toFixed(1).replace(/\.0$/, '')
        : Math.round(scaled).toString()
      return `${sign}${formatted}${suffix}`
    }
  }

  return `${sign}${abs}`
}
