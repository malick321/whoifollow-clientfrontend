// Wire (API) types for My Life Book → /v2/lifebook/*.
// Mirrors docs/api/lifebook-api-contract.md (Draft). These describe the RAW
// response shapes; the adapter (../adapters/lifebook.ts) maps them to the
// camelCase domain models (`LifeBook` / `LifeBookPage` / `LifeBookSlot`) in
// ../lifebook.ts.
//
// The backend serializes each page's structured `{ template, slots }` into the
// existing `mylife_book_pages.content_json` column and parses it back out, so
// the wire is always the structured shape — never a raw JSON string.

export interface ApiLifeBookSlot {
  index: number
  kind: 'photo' | 'text'
  photoUrl: string | null
  text: string | null
  caption: string | null
}

export interface ApiLifeBookPage {
  id: string
  pageNumber: number
  type: 'cover' | 'content' | 'back'
  template: string
  slots: ApiLifeBookSlot[] | null
  isNonDeletable: boolean | null
  isLastPage: boolean | null
}

export interface ApiLifeBook {
  id: string
  guid: string
  title: string | null
  theme: string | null
  coverPhotoUrl: string | null
  eventId: string | null
  isShared: boolean | null
  shareSlug: string | null
  pages: ApiLifeBookPage[] | null
  createdAt: string | null
  updatedAt: string | null
}

export interface ApiLifeBookSummary {
  id: string
  guid: string
  title: string | null
  theme: string | null
  coverPhotoUrl: string | null
  pageCount: number | null
  eventId: string | null
  isShared: boolean | null
  shareSlug: string | null
  updatedAt: string | null
}

export interface ApiLifeBookPhoto {
  url: string
  thumbnailUrl: string | null
  source: string | null
  takenAt: string | null
}

// ── Envelope responses ──────────────────────────────────────────────────────

export interface ApiLifeBookListResponse {
  responseStatus?: { statusCode?: number; message?: string }
  data?: { books?: ApiLifeBookSummary[] | null } | null
}

export interface ApiLifeBookResponse {
  responseStatus?: { statusCode?: number; message?: string }
  data?: { book?: ApiLifeBook | null } | null
}

export interface ApiLifeBookPhotosResponse {
  responseStatus?: { statusCode?: number; message?: string }
  data?: {
    photos?: ApiLifeBookPhoto[] | null
    nextCursor?: string | null
  } | null
}

export interface ApiLifeBookShareResponse {
  responseStatus?: { statusCode?: number; message?: string }
  data?: { isShared?: boolean | null; shareSlug?: string | null } | null
}

export interface ApiLifeBookUploadResponse {
  responseStatus?: { statusCode?: number; message?: string }
  data?: { url?: string | null } | null
}
