import type {
  ApiLifeBook,
  ApiLifeBookPage,
  ApiLifeBookPhoto,
  ApiLifeBookSlot,
  ApiLifeBookSummary
} from '../contracts/lifebook'
import type {
  LifeBook,
  LifeBookPage,
  LifeBookPhoto,
  LifeBookSlot,
  LifeBookSummary
} from '../lifebook'

// Thin, defensive renames from the wire shape to the domain model. The backend
// returns fully-resolved CDN photo URLs + ISO timestamps, so there's no URL
// building or date math here — that all lives server-side per the contract.

function adaptSlot(raw: ApiLifeBookSlot): LifeBookSlot {
  return {
    index: raw.index ?? 0,
    kind: raw.kind === 'text' ? 'text' : 'photo',
    photoUrl: raw.photoUrl ?? null,
    text: raw.text ?? null,
    caption: raw.caption ?? null
  }
}

function adaptPage(raw: ApiLifeBookPage): LifeBookPage {
  const type = raw.type === 'cover' || raw.type === 'back' ? raw.type : 'content'
  return {
    id: String(raw.id),
    pageNumber: raw.pageNumber ?? 0,
    type,
    template: raw.template ?? (type === 'cover' ? 'cover' : type === 'back' ? 'back' : 'full'),
    slots: (raw.slots ?? []).map(adaptSlot),
    isNonDeletable: !!raw.isNonDeletable,
    isLastPage: !!raw.isLastPage
  }
}

export function adaptLifeBook(raw: ApiLifeBook): LifeBook {
  const pages = (raw.pages ?? []).map(adaptPage).sort((a, b) => a.pageNumber - b.pageNumber)
  return {
    id: String(raw.id),
    guid: raw.guid,
    title: raw.title ?? 'Untitled Book',
    theme: raw.theme ?? 'classic',
    coverPhotoUrl: raw.coverPhotoUrl ?? null,
    eventId: raw.eventId ?? null,
    isShared: !!raw.isShared,
    shareSlug: raw.shareSlug ?? null,
    pages,
    createdAt: raw.createdAt ?? '',
    updatedAt: raw.updatedAt ?? ''
  }
}

export function adaptLifeBookSummary(raw: ApiLifeBookSummary): LifeBookSummary {
  return {
    id: String(raw.id),
    guid: raw.guid,
    title: raw.title ?? 'Untitled Book',
    theme: raw.theme ?? 'classic',
    coverPhotoUrl: raw.coverPhotoUrl ?? null,
    pageCount: raw.pageCount ?? 0,
    eventId: raw.eventId ?? null,
    isShared: !!raw.isShared,
    shareSlug: raw.shareSlug ?? null,
    updatedAt: raw.updatedAt ?? ''
  }
}

export function adaptLifeBookPhoto(raw: ApiLifeBookPhoto): LifeBookPhoto {
  return {
    url: raw.url,
    thumbnailUrl: raw.thumbnailUrl ?? raw.url,
    source: raw.source ?? '',
    takenAt: raw.takenAt ?? null
  }
}
