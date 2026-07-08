import { buildV2ApiUrl } from './config'
import { getAuthHeaders } from '../auth-session'
import {
  adaptLifeBook,
  adaptLifeBookPhoto,
  adaptLifeBookSummary
} from './adapters/lifebook'
import type {
  ApiLifeBookListResponse,
  ApiLifeBookPhotosResponse,
  ApiLifeBookResponse,
  ApiLifeBookShareResponse,
  ApiLifeBookUploadResponse
} from './contracts/lifebook'

// ── Domain model (camelCase) for My Life Book ────────────────────────────────
// Co-located with the api entry point, mirroring how the Discover Events domain
// model lives in discoverEvents.ts. The structured page model (`template` +
// `slots`) is persisted by the backend inside the existing
// `mylife_book_pages.content_json` column — see docs/api/lifebook-api-contract.md.

/** Catalogue keys the frontend + backend agree on (§ Page templates). */
export type LifeBookTemplate =
  | 'cover'
  | 'back'
  | 'full'
  | 'grid-2'
  | 'grid-4'
  | 'collage-3'
  | 'photo-caption'
  | 'text'

/** Book chrome / typography presets. */
export type LifeBookTheme = 'classic' | 'bold' | 'mono' | 'team'

export interface LifeBookSlot {
  index: number
  kind: 'photo' | 'text'
  photoUrl: string | null
  text: string | null
  caption: string | null
}

export interface LifeBookPage {
  id: string
  pageNumber: number
  type: 'cover' | 'content' | 'back'
  /** Catalogue key (§ templates). */
  template: string
  slots: LifeBookSlot[]
  isNonDeletable: boolean
  isLastPage: boolean
}

export interface LifeBook {
  id: string
  guid: string
  title: string
  theme: string
  coverPhotoUrl: string | null
  eventId: string | null
  isShared: boolean
  shareSlug: string | null
  pages: LifeBookPage[]
  createdAt: string
  updatedAt: string
}

export interface LifeBookSummary {
  id: string
  guid: string
  title: string
  theme: string
  coverPhotoUrl: string | null
  pageCount: number
  eventId: string | null
  isShared: boolean
  shareSlug: string | null
  updatedAt: string
}

export interface LifeBookPhoto {
  url: string
  thumbnailUrl: string
  source: string
  takenAt: string | null
}

export interface LifeBookPhotosPage {
  photos: LifeBookPhoto[]
  nextCursor: string | null
}

/** The save-pages payload — only the editable structure per page. */
export interface LifeBookPageInput {
  pageNumber: number
  template: string
  slots: LifeBookSlot[]
}

function jsonHeaders(): Record<string, string> {
  return {
    ...getAuthHeaders(),
    Accept: 'application/json',
    'Content-Type': 'application/json'
  }
}

// ── 1. List Books ────────────────────────────────────────────────────────────
/** `GET /v2/lifebook/books` — the books grid (newest first). */
export async function fetchLifeBooks(): Promise<LifeBookSummary[]> {
  const response = await fetch(buildV2ApiUrl('/lifebook/books'), {
    headers: { ...getAuthHeaders(), Accept: 'application/json' }
  })
  const envelope = (await response.json()) as ApiLifeBookListResponse
  const rows = envelope?.data?.books ?? []
  return rows.map(adaptLifeBookSummary)
}

// ── 2. Create Book ─────────────────────────────────────────────────────────-
/** `POST /v2/lifebook/books` — creates the book + seeds cover/back pages. When
 *  `eventId` is provided the backend ALSO runs auto-build (§7) inline. Returns
 *  the full Book. */
export async function createLifeBook(payload: {
  title: string
  theme?: string
  eventId?: string
}): Promise<LifeBook> {
  const body: { title: string; theme?: string; eventId?: string } = {
    title: payload.title
  }
  if (payload.theme) body.theme = payload.theme
  const eventId = payload.eventId?.trim()
  if (eventId) body.eventId = eventId

  const response = await fetch(buildV2ApiUrl('/lifebook/books'), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(body)
  })
  const envelope = (await response.json()) as ApiLifeBookResponse
  return adaptLifeBook(unwrapBook(envelope))
}

// ── 3. Get Book ────────────────────────────────────────────────────────────-
/** `GET /v2/lifebook/books/{guid}` — the full book (pages ordered). */
export async function fetchLifeBook(guid: string): Promise<LifeBook> {
  const response = await fetch(buildV2ApiUrl(`/lifebook/books/${encodeURIComponent(guid)}`), {
    headers: { ...getAuthHeaders(), Accept: 'application/json' }
  })
  const envelope = (await response.json()) as ApiLifeBookResponse
  return adaptLifeBook(unwrapBook(envelope))
}

// ── 4. Update Book ───────────────────────────────────────────────────────────
/** `PATCH /v2/lifebook/books/{guid}` — title / theme / coverPhotoUrl. */
export async function updateLifeBook(
  guid: string,
  payload: { title?: string; theme?: string; coverPhotoUrl?: string | null }
): Promise<LifeBook> {
  const response = await fetch(buildV2ApiUrl(`/lifebook/books/${encodeURIComponent(guid)}`), {
    method: 'PATCH',
    headers: jsonHeaders(),
    body: JSON.stringify(payload)
  })
  const envelope = (await response.json()) as ApiLifeBookResponse
  return adaptLifeBook(unwrapBook(envelope))
}

// ── 5. Delete Book ───────────────────────────────────────────────────────────
/** `DELETE /v2/lifebook/books/{guid}`. */
export async function deleteLifeBook(guid: string): Promise<void> {
  await fetch(buildV2ApiUrl(`/lifebook/books/${encodeURIComponent(guid)}`), {
    method: 'DELETE',
    headers: { ...getAuthHeaders(), Accept: 'application/json' }
  })
}

// ── 6. Save Pages (bulk upsert — the editor's save) ─────────────────────────-
/** `PUT /v2/lifebook/books/{guid}/pages` — upserts every page by pageNumber.
 *  Returns the full Book. */
export async function saveLifeBookPages(
  guid: string,
  pages: LifeBookPageInput[]
): Promise<LifeBook> {
  const response = await fetch(buildV2ApiUrl(`/lifebook/books/${encodeURIComponent(guid)}/pages`), {
    method: 'PUT',
    headers: jsonHeaders(),
    body: JSON.stringify({ pages })
  })
  const envelope = (await response.json()) as ApiLifeBookResponse
  return adaptLifeBook(unwrapBook(envelope))
}

/** `POST /v2/lifebook/books/{guid}/pages` — append a single content page. */
export async function appendLifeBookPage(
  guid: string,
  payload: { template: string; slots?: LifeBookSlot[] }
): Promise<LifeBook> {
  const response = await fetch(buildV2ApiUrl(`/lifebook/books/${encodeURIComponent(guid)}/pages`), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload)
  })
  const envelope = (await response.json()) as ApiLifeBookResponse
  return adaptLifeBook(unwrapBook(envelope))
}

/** `DELETE /v2/lifebook/books/{guid}/pages/{pageId}` — delete a content page
 *  (409 on a non-deletable cover/back). */
export async function deleteLifeBookPage(guid: string, pageId: string): Promise<LifeBook> {
  const response = await fetch(
    buildV2ApiUrl(
      `/lifebook/books/${encodeURIComponent(guid)}/pages/${encodeURIComponent(pageId)}`
    ),
    { method: 'DELETE', headers: { ...getAuthHeaders(), Accept: 'application/json' } }
  )
  const envelope = (await response.json()) as ApiLifeBookResponse
  return adaptLifeBook(unwrapBook(envelope))
}

// ── 7. Auto-build ✨ ──────────────────────────────────────────────────────────
/** `POST /v2/lifebook/books/{guid}/autobuild` — generate draft content pages
 *  from an event's media (or recent posts-with-pictures). Returns the full
 *  Book for the user to tweak. */
export async function autoBuildLifeBook(
  guid: string,
  payload: { eventId?: string; photoUrls?: string[] } = {}
): Promise<LifeBook> {
  const response = await fetch(
    buildV2ApiUrl(`/lifebook/books/${encodeURIComponent(guid)}/autobuild`),
    { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(payload) }
  )
  const envelope = (await response.json()) as ApiLifeBookResponse
  return adaptLifeBook(unwrapBook(envelope))
}

// ── 8. Photo sources (for the editor's photo picker) ─────────────────────────
/** `GET /v2/lifebook/photos?eventId=&cursor=` — cursor-paginated photo source. */
export async function fetchLifeBookPhotos(
  options: { eventId?: string; cursor?: string } = {}
): Promise<LifeBookPhotosPage> {
  const params = new URLSearchParams()
  if (options.eventId) params.set('eventId', options.eventId)
  if (options.cursor) params.set('cursor', options.cursor)
  const qs = params.toString()
  const response = await fetch(buildV2ApiUrl(`/lifebook/photos${qs ? `?${qs}` : ''}`), {
    headers: { ...getAuthHeaders(), Accept: 'application/json' }
  })
  const envelope = (await response.json()) as ApiLifeBookPhotosResponse
  return {
    photos: (envelope?.data?.photos ?? []).map(adaptLifeBookPhoto),
    nextCursor: envelope?.data?.nextCursor ?? null
  }
}

// ── 8b. Upload a device photo ────────────────────────────────────────────────
/** `POST /v2/lifebook/upload` — multipart upload of a single image from the
 *  user's device (field `file`, ≤10MB). Returns a durable CDN URL the caller
 *  drops straight into a slot, exactly like a picked photo.
 *
 *  Important: we deliberately DO NOT set `Content-Type` here. `fetch` sets the
 *  correct `multipart/form-data; boundary=…` header for us when the body is a
 *  `FormData`; setting it manually would omit the boundary and the server would
 *  fail to parse the parts. We send only the auth headers + Accept. */
export async function uploadLifeBookPhoto(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const response = await fetch(buildV2ApiUrl('/lifebook/upload'), {
    method: 'POST',
    headers: { ...getAuthHeaders(), Accept: 'application/json' },
    body: form
  })
  if (!response.ok) {
    throw Object.assign(new Error('Upload failed'), { code: response.status })
  }
  const envelope = (await response.json()) as ApiLifeBookUploadResponse
  const url = envelope?.data?.url
  if (!url) {
    throw new Error('Malformed upload response: missing data.url')
  }
  return url
}

// ── 9. Share (digital flipbook) ──────────────────────────────────────────────
/** `POST /v2/lifebook/books/{guid}/share` — toggle the public read-only link. */
export async function setLifeBookShared(
  guid: string,
  shared: boolean
): Promise<{ isShared: boolean; shareSlug: string | null }> {
  const response = await fetch(buildV2ApiUrl(`/lifebook/books/${encodeURIComponent(guid)}/share`), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ shared })
  })
  const envelope = (await response.json()) as ApiLifeBookShareResponse
  return {
    isShared: !!envelope?.data?.isShared,
    shareSlug: envelope?.data?.shareSlug ?? null
  }
}

/** `GET /v2/lifebook/shared/{slug}` — PUBLIC, unauthenticated. Backs the public
 *  flipbook viewer. Returns the read-only Book (only when shared). */
export async function fetchSharedLifeBook(slug: string): Promise<LifeBook> {
  const response = await fetch(buildV2ApiUrl(`/lifebook/shared/${encodeURIComponent(slug)}`), {
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) {
    throw Object.assign(new Error('Shared book not available'), { code: response.status })
  }
  const envelope = (await response.json()) as ApiLifeBookResponse
  return adaptLifeBook(unwrapBook(envelope))
}

// ── helpers ──────────────────────────────────────────────────────────────────
function unwrapBook(envelope: ApiLifeBookResponse) {
  const book = envelope?.data?.book
  if (!book) {
    throw new Error('Malformed lifebook response: missing data.book')
  }
  return book
}
