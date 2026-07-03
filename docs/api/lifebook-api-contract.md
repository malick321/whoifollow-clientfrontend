---
status: Draft
owner: shared
last_updated: 2026-06-25
---

# My Life Book — REST API contract (`/v2/lifebook`)

## Context

The rebuilt **My Life Book** — a digital scrapbook / photo-book builder of the
user's sports life. v1 is **digital-first** (create/edit, auto-build from an
event, share link, client-side PDF) with **template/slot pages** (NOT freeform
canvas). Print-on-demand is a deliberate **phase 2** — the model below leaves
room for it with no rework.

Optimised `/v2` replacement for the legacy `MyLifeBookController` (`/lifebook/*`).
Shared rules (envelope, IDs-as-strings, auth, camelCase, image URLs) —
[`conventions.md`](./conventions.md).

## Scope decisions (locked)
- **No schema changes.** Reuse `mylife_books` (guid, user_id, title, …) +
  `mylife_book_pages` (book_id, page_number, **`content_json`**, is_non_deletable,
  is_last_page). The structured page model below is stored **inside
  `content_json`** as `{ template, slots, ... }` — the column already exists.
- **Template/slot pages.** Each page has a `template` (a named layout) and an
  array of `slots` the template defines (photo or text). No absolute positioning.
- **Auth:** every endpoint requires the logged-in user; books are per-user;
  ownership enforced (`403` otherwise). The public **shared** read endpoint is
  the only unauthenticated one.
- IDs strings; timestamps ISO-8601 UTC; wire camelCase.

## Page templates (the catalogue — frontend + backend agree on these keys)

| `template` | Slots | Use |
|---|---|---|
| `cover` | 1 photo (cover) + title/subtitle text | First page (non-deletable). |
| `back` | 1 text (closing note) | Last page (non-deletable). |
| `full` | 1 photo (full-bleed) | Hero photo. |
| `grid-2` | 2 photo | Two side-by-side. |
| `grid-4` | 4 photo | Quad grid. |
| `collage-3` | 3 photo | 1 large + 2 small. |
| `photo-caption` | 1 photo + 1 text | Photo with a caption block. |
| `text` | 1 text | A note / story page. |

`slots[]` entry: `{ "index": 0, "kind": "photo" | "text", "photoUrl": "…"|null, "text": "…"|null, "caption": "…"|null }`.
A page is stored in `content_json` as: `{ "template": "grid-4", "slots": [ … ] }`.
Themes: a small preset set (`classic`, `bold`, `mono`, `team`) controlling the
book's chrome/typography — stored on the book (in a JSON/`theme` field within
`content_json` of the cover, or a book-level attribute if present; if no column,
persist on the cover page's content_json as `theme`).

## Underlying tables (existing — no changes)
`mylife_books`, `mylife_book_pages`. Photo sources come from the user's posts
with pictures (legacy `PostController@fetchMyLifePostsWithPictures` /
`fetchPostForMyLifeBook`) + event/tournament media.

---

## 1. List Books
`GET /v2/lifebook/books` → `data: { books: [ BookSummary ] }`.
`BookSummary`: `{ id, guid, title, theme, coverPhotoUrl, pageCount, eventId|null, isShared, shareSlug|null, updatedAt }`.
Newest first. `coverPhotoUrl` = the cover page's photo slot (or null).

## 2. Create Book
`POST /v2/lifebook/books` — body `{ title, theme?, eventId? }`.
Creates the book + seeds pages: a `cover` (non-deletable) + a `back`
(non-deletable, last). If `eventId` is provided, ALSO runs auto-build (§7) to
populate content pages between them. Returns the full `Book` (§9). `201`.

## 3. Get Book
`GET /v2/lifebook/books/{guid}` → `data: { book: Book }` (full, pages ordered
cover → content (by page_number) → back). `404` if not found / not owner.

## 4. Update Book
`PATCH /v2/lifebook/books/{guid}` — `{ title?, theme?, coverPhotoUrl? }` → updated `Book`.

## 5. Delete Book
`DELETE /v2/lifebook/books/{guid}` — deletes the book + pages (mirror legacy `deleteBook`). `data` omitted.

## 6. Save Pages (bulk upsert — the editor's save)
`PUT /v2/lifebook/books/{guid}/pages` — body `{ pages: [ { pageNumber, template, slots } ] }`.
Upserts every page by `pageNumber` (mirror legacy `createPage`, but the v2 body
is the structured `{template, slots}` which the backend serializes into
`content_json`). Enforces: page 1 = `cover` non-deletable, last = `back`
non-deletable. Returns the full `Book`. Single-page helpers:
- `POST /v2/lifebook/books/{guid}/pages` — append a content page `{ template, slots? }`.
- `DELETE /v2/lifebook/books/{guid}/pages/{pageId}` — delete a content page (`409` if non-deletable cover/back).

## 7. Auto-build ✨ (the flagship)
`POST /v2/lifebook/books/{guid}/autobuild` — body `{ eventId?, photoUrls?: string[] }`.
Pulls the user's photos (for `eventId` if given, else recent posts-with-pictures
via the legacy post sources) — or uses the provided `photoUrls` — and generates
draft **content pages**, auto-distributing photos across `full` / `grid-2` /
`grid-4` / `collage-3` templates between the cover and back. Returns the full
`Book` for the user to tweak. (Idempotent-ish: replaces existing auto-generated
content pages; preserves user-edited ones if flagged — v1 may simply append.)

## 8. Photo sources (for the editor's photo picker)
`GET /v2/lifebook/photos?eventId=&cursor=` → `data: { photos: [ { url, thumbnailUrl, source, takenAt } ], nextCursor }`.
The user's available photos to drop into slots — from their posts-with-pictures
(legacy `fetchMyLifePostsWithPictures`) and, when `eventId` is set, that event's
media. Cursor-paginated.

## 9. Share (digital flipbook)
- `POST /v2/lifebook/books/{guid}/share` — body `{ shared: true|false }` → `{ data: { isShared, shareSlug } }`. Toggles a public read-only link; mints a `shareSlug` (stored on the book, e.g. in cover `content_json` or a guid-derived slug).
- `GET /v2/lifebook/shared/{slug}` — **public, unauthenticated** → `data: { book: Book }` read-only (only when `isShared`). Backs the public flipbook viewer + is the page the "Share" link opens. `404`/`403` when not shared.

> **PDF export** is **client-side in v1** — the frontend renders the flipbook
> pages and exports to PDF in the browser (no server PDF infra). A server
> `GET …/export.pdf` is a phase-2 option. **Print-on-demand** is phase 2:
> the `Book`/`Page` model (templates + slot photo URLs + theme) is print-ready,
> so a future provider integration consumes the same structure.

---

## 10. `Book` shape (response reference)
```ts
interface LifeBookSlot {
  index: number
  kind: 'photo' | 'text'
  photoUrl: string | null
  text: string | null
  caption: string | null
}
interface LifeBookPage {
  id: string
  pageNumber: number
  type: 'cover' | 'content' | 'back'
  template: string          // catalogue key (§ templates)
  slots: LifeBookSlot[]
  isNonDeletable: boolean
  isLastPage: boolean
}
interface LifeBook {
  id: string
  guid: string
  title: string
  theme: string             // 'classic' | 'bold' | 'mono' | 'team'
  coverPhotoUrl: string | null
  eventId: string | null
  isShared: boolean
  shareSlug: string | null
  pages: LifeBookPage[]
  createdAt: string
  updatedAt: string
}
```

## 11. Cross-cutting
- Page `content_json` ⇄ `{ template, slots }` is serialized/parsed by the
  backend; the wire is always the structured shape, never raw JSON strings.
- Photo URLs are resolved CDN URLs, opaque to the client.
- `cover`/`back` are non-deletable and always first/last; the editor disables
  deleting them.
- Ownership enforced on every authed endpoint; only `GET /shared/{slug}` is public.

## 12. Frontend integration
| File | Role |
|---|---|
| `src/api/lifebook.ts` + `adapters/` + `contracts/` | `/v2/lifebook` client + domain `LifeBook`/`LifeBookPage`/`LifeBookSlot`. |
| `src/views/LifeBookListView.vue` | Books grid (covers) + create + auto-build entry. |
| `src/views/LifeBookEditorView.vue` | The page editor: page thumbnails rail + the active page with its template slots; photo picker (§8); add/reorder/delete pages; template switcher; theme; save (§6); share (§9); export PDF (client). |
| `src/views/LifeBookSharedView.vue` | Public flipbook viewer (`/lifebook/shared/:slug`, `meta.public`). |
| `src/components/lifebook/*` | `PageTemplate.vue` (renders a template + slots, edit/readonly), `PhotoPickerModal.vue`, `TemplatePickerModal.vue`, `BookCover.vue`. Reuse colleague tokens; no bold. |
