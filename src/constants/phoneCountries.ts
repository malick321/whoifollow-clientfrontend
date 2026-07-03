// phoneCountries
// ---------------
// Shared catalogue for the reusable `PhoneInput` component. One row per
// supported country: ISO code, display name, dial code, the input mask, and
// the expected national-digit count. Scaling to a new region = append a row
// here (then mirror in docs/system/shared-catalogues.md + the backend config),
// exactly like the timezone catalogue.
//
// US + Canada both use the +1 / NANP plan and the same `(XXX) XXX-XXXX` mask;
// they're distinct rows so the picker can show each flag, but storage only
// keeps the dial code (`+1`) + the raw national digits — no backend change.
//
// Mask grammar: `X` = a digit slot; every other character is a literal.

export interface PhoneCountry {
  /** ISO 3166-1 alpha-2 (uppercase), e.g. "US". Drives the flag image. */
  iso: string
  name: string
  /** Dialing code, e.g. "+1". Stored as the phone's country code. */
  dialCode: string
  /** Input mask — `X` marks a digit position. */
  mask: string
  /** Expected national-number digit count (caps input + drives validation). */
  digits: number
}

export const COUNTRY_PHONE_CATALOGUE: PhoneCountry[] = [
  { iso: 'US', name: 'United States', dialCode: '+1', mask: '(XXX) XXX-XXXX', digits: 10 },
  { iso: 'CA', name: 'Canada', dialCode: '+1', mask: '(XXX) XXX-XXXX', digits: 10 }
]

/** Fallback country when a dial code doesn't match any row. */
export const DEFAULT_PHONE_COUNTRY: PhoneCountry = COUNTRY_PHONE_CATALOGUE[0]

/** First catalogue row for a dial code (US wins for the shared "+1"). */
export function phoneCountryForDialCode(dialCode: string | null | undefined): PhoneCountry {
  return COUNTRY_PHONE_CATALOGUE.find((c) => c.dialCode === dialCode) ?? DEFAULT_PHONE_COUNTRY
}

export function phoneCountryByIso(iso: string | null | undefined): PhoneCountry {
  return COUNTRY_PHONE_CATALOGUE.find((c) => c.iso === iso) ?? DEFAULT_PHONE_COUNTRY
}

/** Flag image (static CDN, keyed by ISO). Scales to any country for free;
 *  the component falls back to the ISO text if the image fails to load. */
export function flagUrl(iso: string): string {
  return `https://flagcdn.com/w40/${iso.toLowerCase()}.png`
}

/** Strip everything but digits. */
export function digitsOnly(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '')
}

/** Apply a mask to raw digits — fills `X` slots left-to-right, inserting the
 *  literals in between. Progressive (partial input renders cleanly); never
 *  appends a trailing literal once the digits run out. */
export function applyPhoneMask(value: string | null | undefined, mask: string): string {
  const digits = digitsOnly(value)
  if (!digits) return ''
  let out = ''
  let di = 0
  for (const ch of mask) {
    if (di >= digits.length) break
    out += ch === 'X' ? digits[di++] : ch
  }
  return out
}
