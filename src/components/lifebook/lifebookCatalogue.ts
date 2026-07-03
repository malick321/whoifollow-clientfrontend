// Shared catalogue metadata for My Life Book — the single source of truth for
// the template list (slot shape per template) + theme presets. Both the editor
// and the renderers import from here so they never drift.
//
// Page model lives in content_json as `{ template, slots }` — see
// docs/api/lifebook-api-contract.md.

import type { LifeBookSlot } from '../../api/lifebook'

export interface TemplateMeta {
  key: string
  label: string
  /** Ordered slot kinds the template defines. */
  slotKinds: Array<'photo' | 'text'>
  /** Short helper line shown in the template picker. */
  hint: string
  /** Whether the user can switch the active page TO this template. cover/back
   *  are structural and locked. */
  selectable: boolean
}

/** The catalogue — keys the backend agrees on (§ Page templates). */
export const TEMPLATES: TemplateMeta[] = [
  { key: 'cover', label: 'Cover', slotKinds: ['photo', 'text'], hint: 'Title page', selectable: false },
  { key: 'back', label: 'Back', slotKinds: ['text'], hint: 'Closing note', selectable: false },
  { key: 'full', label: 'Full bleed', slotKinds: ['photo'], hint: 'One hero photo', selectable: true },
  { key: 'grid-2', label: 'Two up', slotKinds: ['photo', 'photo'], hint: 'Side by side', selectable: true },
  { key: 'grid-4', label: 'Quad', slotKinds: ['photo', 'photo', 'photo', 'photo'], hint: 'Four photos', selectable: true },
  { key: 'collage-3', label: 'Collage', slotKinds: ['photo', 'photo', 'photo'], hint: '1 large + 2 small', selectable: true },
  { key: 'photo-caption', label: 'Photo + caption', slotKinds: ['photo', 'text'], hint: 'Photo with a story', selectable: true },
  { key: 'text', label: 'Note', slotKinds: ['text'], hint: 'A written page', selectable: true }
]

export function templateMeta(key: string): TemplateMeta {
  return TEMPLATES.find((t) => t.key === key) ?? TEMPLATES[2]
}

/** Build a fresh, empty slot array matching a template's shape. Preserves any
 *  existing slot values that line up by index/kind so switching templates
 *  doesn't needlessly drop content. */
export function slotsForTemplate(key: string, existing: LifeBookSlot[] = []): LifeBookSlot[] {
  const meta = templateMeta(key)
  return meta.slotKinds.map((kind, index) => {
    const prior = existing[index]
    if (prior && prior.kind === kind) {
      return { ...prior, index }
    }
    return { index, kind, photoUrl: null, text: null, caption: null }
  })
}

export interface ThemeMeta {
  key: string
  label: string
  /** Cover accent + chrome colour. */
  accent: string
  /** A soft gradient pair used for empty covers / chrome. */
  gradient: [string, string]
  /** Cover/heading font stack (kept within the project's Open Sans family but
   *  varying weight/letter-spacing for character — see the scoped styles). */
  headingStyle: 'serif-ish' | 'wide' | 'mono' | 'plain'
}

/** A small preset set controlling the book's chrome/typography. */
export const THEMES: ThemeMeta[] = [
  {
    key: 'classic',
    label: 'Classic',
    accent: '#2f5f98',
    gradient: ['#2f5f98', '#6f92bb'],
    headingStyle: 'serif-ish'
  },
  {
    key: 'bold',
    label: 'Bold',
    accent: '#ff5a68',
    gradient: ['#ff5a68', '#ffd45a'],
    headingStyle: 'wide'
  },
  {
    key: 'mono',
    label: 'Mono',
    accent: '#2e3137',
    gradient: ['#2e3137', '#787f8d'],
    headingStyle: 'mono'
  },
  {
    key: 'team',
    label: 'Team',
    accent: '#2d8cf0',
    gradient: ['#2d8cf0', '#29cf59'],
    headingStyle: 'plain'
  }
]

export function themeMeta(key: string): ThemeMeta {
  return THEMES.find((t) => t.key === key) ?? THEMES[0]
}
