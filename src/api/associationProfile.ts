import type { AssociationProfile } from '../types'

/**
 * Frontend-only mock store for the Association Profile editor on
 * the settings page. Keyed by association id (the URL slug).
 *
 * When the real backend lands, swap each function body for a
 * fetch / put call against the `associations` resource. The shape
 * already mirrors the editable subset of the MySQL table.
 */

const SIMULATED_LATENCY_MS = 280

function delay<T>(value: T, ms = SIMULATED_LATENCY_MS): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

// In-memory profiles keyed by association id. Persists for the
// session so saving in the modal sticks across re-opens.
const profilesById = new Map<string, AssociationProfile>()

if (import.meta.hot) {
  import.meta.hot.accept()
}

/** Lazy-seed a believable profile for an association on first
 *  fetch so the modal isn't empty out of the gate. The SSUSA seed
 *  carries plausible production-style values; other associations
 *  start mostly blank with just the legal name filled in. */
function seedProfileFor(associationId: string): AssociationProfile {
  if (associationId === 'ssusa') {
    return {
      id: associationId,
      logoUrl: '',
      coverUrl: '',
      associationName: 'Senior Softball USA',
      websiteUrl: 'https://www.seniorsoftball.com',
      email: 'info@seniorsoftball.com',
      mobileCode: '+1',
      mobileNumber: '(916) 326-5303',
      fbUrl: 'https://facebook.com/seniorsoftballusa',
      instaUrl: 'https://instagram.com/seniorsoftball',
      streetAddress: '9823 Old Winery Place, Suite 12',
      city: 'Sacramento',
      state: 'CA',
      zipCode: '95827',
      lat: '38.5491',
      long: '-121.3897',
      notes: 'Annual senior softball association — running tournaments since 1988.'
    }
  }
  return {
    id: associationId,
    logoUrl: '',
    coverUrl: '',
    associationName: '',
    websiteUrl: '',
    email: '',
    mobileCode: '+1',
    mobileNumber: '',
    fbUrl: '',
    instaUrl: '',
    streetAddress: '',
    city: '',
    state: '',
    zipCode: '',
    lat: '',
    long: '',
    notes: ''
  }
}

/** Fetch the editable profile for an association. */
export async function fetchAssociationProfile(
  associationId: string
): Promise<AssociationProfile> {
  if (!profilesById.has(associationId)) {
    profilesById.set(associationId, seedProfileFor(associationId))
  }
  return delay({ ...profilesById.get(associationId)! })
}

/** Persist the profile. Returns the saved record so the caller
 *  can splice it into local state without a separate refetch. */
export async function saveAssociationProfile(
  profile: AssociationProfile
): Promise<AssociationProfile> {
  profilesById.set(profile.id, { ...profile })
  return delay({ ...profilesById.get(profile.id)! })
}
