// divisionTone
// ------------
// Deterministic per-division colour palette, shared so every surface
// that colour-codes a division (the grid game card, the bulk-action
// preview lists, …) resolves the SAME division id to the SAME colour —
// users recognise divisions by colour across screens. Two parallel
// palettes (light / dark) keyed by a `charCodeAt`-sum hash of the
// division id, mirroring the `TeamAvatar` strategy.

export interface DivisionTone {
  bg: string
  border: string
  fg: string
}

export const DIVISION_LIGHT_PALETTE: DivisionTone[] = [
  { bg: '#fbe4e6', border: '#f1b9c0', fg: '#bb5964' }, // red
  { bg: '#e7f1ff', border: '#b9d4f4', fg: '#477bb2' }, // blue
  { bg: '#eaf8eb', border: '#bde0c2', fg: '#468957' }, // green
  { bg: '#fff0df', border: '#f1d4ad', fg: '#b57a34' }, // orange
  { bg: '#efe8ff', border: '#d2c5f0', fg: '#7360b7' }, // purple
  { bg: '#e4f7f6', border: '#b6dedb', fg: '#3c8e89' }  // teal
]
export const DIVISION_DARK_PALETTE: DivisionTone[] = [
  { bg: '#4a2530', border: '#6d3a48', fg: '#ff8a98' },
  { bg: '#2a3a52', border: '#3f5476', fg: '#7fb0e8' },
  { bg: '#243d2c', border: '#3a5b46', fg: '#7ad48a' },
  { bg: '#4a3320', border: '#6c4d31', fg: '#e8b075' },
  { bg: '#33294a', border: '#4d3f6d', fg: '#b29bdc' },
  { bg: '#1d3a3a', border: '#305a5a', fg: '#6ec9c1' }
]

/** Deterministic division-id → palette index (same `charCodeAt` sum
 *  strategy as `TeamAvatar`, so the two surfaces agree). */
export function divisionPaletteIndex(divisionId: string): number {
  const hash = Array.from(divisionId).reduce((sum, c) => sum + c.charCodeAt(0), 0)
  return hash % DIVISION_LIGHT_PALETTE.length
}

/** Resolve a division id to its tone for the current theme. */
export function divisionTone(divisionId: string, dark: boolean): DivisionTone {
  const palette = dark ? DIVISION_DARK_PALETTE : DIVISION_LIGHT_PALETTE
  return palette[divisionPaletteIndex(divisionId)]
}
