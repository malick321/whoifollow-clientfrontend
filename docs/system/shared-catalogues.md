# Shared catalogues — backend + frontend single source of truth

Static lookup tables, enums, and presets that both the backend (Laravel) and frontend (Vue) must keep in lockstep. Adding a row to one side without mirroring the other will surface as silent data drift — most painfully in IANA timezones (a missing value collapses `CONVERT_TZ` to `NULL`) and in the permission catalogues (a key the frontend ships but the backend doesn't accept gets rejected as 422 during invites/edits).

This document is the canonical reference. Frontend ships these as TypeScript constants; backend should ship a 1:1 mirror in `config/catalogues.php` (or equivalent) so both sides resolve to the same values on every release.

**Owner**: any change here is a cross-team change — update both the frontend constant and the backend config in the same PR, and bump the relevant API contract if the catalogue is exposed on the wire.

**Scope.** This doc covers catalogues that are referenced from multiple contracts or aren't tied to a single endpoint family — IANA timezones, the permission catalogues (both association + event), the registration-window-status enum, and the `*` Full Control sentinel. Catalogues that belong to a single contract live inside that contract instead — for example **sport types**, **bracket formats**, **payment terms + partial-payment-type enums**, **team-participation statuses**, and the **event lifecycle / transitions** all live in [`docs/api/association-events-api-contract.md`](../api/association-events-api-contract.md). Don't duplicate them here.

---

## 1. IANA Timezone catalogue

Three labels per entry — different UI surfaces pick the appropriate one. The IANA `value` is what gets persisted in `team_events.time_zone` (and `event_tournaments.time_zone`); the labels are display-only.

| `value` (IANA) | `formLabel` | `nameLabel` | `shortLabel` |
|---|---|---|---|
| `America/Los_Angeles` | `(UTC-08:00) Pacific Time` | `Pacific Time` | `PST` |
| `America/Denver` | `(UTC-07:00) Mountain Time` | `Mountain Time` | `MST` |
| `America/Phoenix` | `(UTC-07:00) Arizona Time (no DST)` | `Arizona Time` | `MST` |
| `America/Chicago` | `(UTC-06:00) Central Time` | `Central Time` | `CST` |
| `America/New_York` | `(UTC-05:00) Eastern Time` | `Eastern Time` | `EST` |
| `Pacific/Honolulu` | `(UTC-10:00) Hawaii Time` | `Hawaii Time` | `HST` |

**Where each label is used:**

| Surface | Label |
|---|---|
| EventFormModal dropdown | `formLabel` (offset prefix helps the admin pick) |
| Listing `dateRangeLabel` ("Apr 19 to May 24, 2026 (Eastern Time)") | `nameLabel` |
| Compact / short surfaces (`dateRangeLabelShort`, mobile chips) | `shortLabel` |

**Notes:**

- The UTC offsets in `formLabel` and the `shortLabel` abbreviations represent **standard time** (winter). Both drift during DST (`PST → PDT`, `EST → EDT`) — acceptable because these are UI hints, not math claims. `CONVERT_TZ` on the DB uses the IANA `value`, which handles DST correctly regardless of the displayed label.
- The DB must have `mysql.time_zone_name` populated (`mysql_tzinfo_to_sql /usr/share/zoneinfo | mysql -u root mysql`) or `CONVERT_TZ` silently returns `NULL` and all `start_at_utc` / `end_at_utc` generated columns collapse.
- US-focused for v1. International expansion appends entries here; the IANA `value` must match the OS's zoneinfo entry exactly (case-sensitive).

**Source of truth:**
- Frontend: `src/api/events.ts` → `EVENT_TIMEZONES: EventTimezoneOption[]`
- Backend: TBD (suggest `config/catalogues/timezones.php`)
- Contract reference: `docs/api/association-events-api-contract.md` (used for `Event.timeZone`)

---

## 2. Event-type catalogue

The canonical kinds of association event. Stored in `team_events.event_type` (snake_case key), filtered on by the listing `eventType` query param (single-select), and rendered via the human-readable label in the create / edit form + dropdowns.

| `key` (wire + DB) | `label` (display) |
|---|---|
| `tournament` | Tournament |
| `league` | League |
| `other` | Other |

> `online_meeting` is **deprecated** as a selectable type — in-person vs. online is now a separate toggle (`team_events.location_type`), so it's no longer offered in `EVENT_TYPES_CATALOGUE`. The `online_meeting` literal is retained in the `EventType` union + `eventTypeLabel()` resolver (label "Online Meeting") so legacy rows that still carry it keep rendering.

**Notes:**

- **Single-select** on the listing filter (`GET /v2/association/events/{associationId}?eventType=<key>`). Multi-value selection is not supported.
- The wire / DB value is always the snake_case `key`. The frontend resolves `key → label` via `eventTypeLabel()` in `src/api/events.ts`; the backend mirrors the same mapping for its own renders.
- Adding a new event type is a coordinated change: backend ENUM gains the value, this catalogue gains the row, `EventType` union in `src/types.ts` gains the literal, and `EVENT_TYPES_CATALOGUE` in `src/api/events.ts` gains the entry. All four must land in the same release.
- Older rows pre-dating the catalogue (if any) carry `eventType = NULL`; the UI tolerates the null and renders nothing in the slot.

**Source of truth:**
- Frontend: `src/api/events.ts` → `EVENT_TYPES_CATALOGUE: { key, label }[]` + `EventType` union in `src/types.ts`
- Backend: TBD (suggest `config/catalogues/event-types.php`) — must match the catalogue rows above 1:1
- Contract reference: `docs/api/association-events-api-contract.md` (`Event.eventType` field + §1 listing filter)

---

## 3. Event-permission catalogue

Per-event grants in `event_officials.permissions_json`. Order here drives chip-render order in the UI.

| `key` | `label` | `description` | `expandable` |
|---|---|---|---|
| `edit_event` | Edit Event | Can edit event name, dates, description, settings. | — |
| `manage_team_participation` | Manage Team Participation | Can manage team registrations and participation. | — |
| `manage_divisions` | Manage Divisions | Can create, edit, delete divisions within the event. | — |
| `manage_scoring` | Manage Scoring | Can enter and edit game scores (scoped to parks or divisions). | **yes** |
| `manage_umpires` | Manage Umpires | Can invite umpires to the event and assign them to games. | — |
| `manage_officials` | Manage Officials | Can add, invite, edit access and revoke access for event officials on this event. Gates every write endpoint in `matchgeni-officials-api-contract.md` (§3–§6). | — |
| `manage_scheduling` | Manage Scheduling | Can schedule / unschedule pool and bracket games. | — |
| `manage_parks` | Manage Parks | Can create, edit, delete park venues for the event. | — |
| `manage_hotels` | Manage Hotels | Can manage hotel blocks and accommodation info. | — |
| `manage_sponsors` | Manage Sponsors | Can add, edit, remove event sponsors. | — |

**Notes:**

- `expandable: true` flags permissions that the EventOfficialAccessModal renders an inline scope picker for. Currently only `manage_scoring` (parks / divisions / all games). Future scope-aware permissions (e.g. division-scoped umpire assignments) would flip this flag without touching the modal's plumbing.
- The reserved sentinel `"*"` represents Full Control inside the underlying `permissions_json` (`["*"]`). It MUST NEVER appear in this catalogue and MUST NEVER be accepted on the wire — see `conventions.md` § Permission-key encoding.
- Wire format: `fullControl: boolean` + `permissions: EventPermissionKey[]`. Backend translates to/from `permissions_json` per the conventions encoding.

**Source of truth:**
- Frontend: `src/constants/eventPermissions.ts` → `EVENT_PERMISSIONS: EventPermissionMeta[]`
- Backend: TBD (suggest `config/catalogues/event-permissions.php`)
- Contract reference: `docs/api/matchgeni-officials-api-contract.md` §8

---

## 4. Association-permission catalogue

Association-wide grants in `association_users.permissions_json`. Order here drives chip-render order in the user listing + toggle-grid in the invite modal.

| `key` | `label` | `description` |
|---|---|---|
| `manage_events` | Manage Events | Create, edit and delete events. |
| `manage_users` | Manage Users | Invite, edit and remove association users. |
| `manage_teams` | Manage Teams | Can approve, reject and suspend team registrations. |
| `manage_umpires` | Manage Umpires | Can approve, reject and suspend umpire registrations. |
| `manage_players` | Manage Players | Can approve, reject and suspend player registrations. |
| `manage_followers` | Manage Followers | View and manage association followers. |
| `manage_financials` | Manage Financials | View and manage payment orders and fees. |
| `manage_products` | Manage Products | Can view, add, edit products information and their pricing. |
| `manage_orders` | Manage Orders | Can view and manage orders received from the product listing. |
| `manage_settings` | Manage Settings | Edit association name, logo and profile. |

**Notes:**

- Same `"*"` Full Control sentinel rule as the event-permission catalogue.
- The sequence above is intentional: admin-scope grants (events / users / teams) first, then registration-approval (umpires / players), then the lower-frequency operational ones. The role-pill derivation in `deriveAssociationRoleLabel` collapses Full Control to "Admin" and everything else to "Member" — the breakdown only matters for the chip strip + the toggle grid.
- The route-guard in `src/router.ts` reads `meta.requiresPermission` against this catalogue's keys (or an array for any-of gating, as the Shop route uses).

**Source of truth:**
- Frontend: `src/constants/associationPermissions.ts` → `ASSOCIATION_PERMISSIONS: AssociationPermissionMeta[]`
- Backend: TBD (suggest `config/catalogues/association-permissions.php`)
- Contract reference: `docs/api/association-users-api-contract.md`

---

## 5. Registration-window status (read-only derived)

`team_events.registrationStatus` is computed at read time, not stored. Backend derives from `registration_opening_utc`, `entry_fee_deadline_utc`, and `UTC_TIMESTAMP()`.

| Value | When |
|---|---|
| `not_open` | `UTC_TIMESTAMP() < registration_opening_utc`, OR `allowTeamRegistration = false` |
| `open` | `registration_opening_utc <= UTC_TIMESTAMP() <= entry_fee_deadline_utc` |
| `closed` | `UTC_TIMESTAMP() > entry_fee_deadline_utc` |

**Companion display strings:**

- `registrationOpensLabel: "Opens Apr 15, 2026"` — only set when `registrationStatus === 'not_open'`
- `registrationClosesLabel: "Closes May 15, 2026"` — only set when `registrationStatus === 'open'`

**Source of truth:**
- Backend: SQL `CASE` expression in the listing query (see `association-events-api-contract.md` §1 SQL sketch)
- Frontend type: `EventRegistrationStatus` in `src/types.ts`

---

## 6. Reserved sentinels

| Sentinel | Where | Meaning |
|---|---|---|
| `["*"]` | `association_users.permissions_json`, `event_officials.permissions_json` | Full Control — implicitly grants every key in the corresponding catalogue. UI ignores the `permissions[]` array when `fullControl: true`. |
| `"*"` in wire `permissions[]` | Anywhere | **Reserved — never accept.** Servers must reject `422` if `"*"` appears in any incoming wire payload's `permissions` array. The `fullControl` boolean is the canonical wire-side flag. |

**Source of truth:**
- Convention: `docs/api/conventions.md` § Permission-key encoding (`permissions_json`)
- Cross-references: every contract that exposes `permissions[]` (events officials, association users, …)

---

## 7. Image-transform presets

We serve every image asset (user / team / association avatars, association logos, event covers, group covers, user profile covers, banners, thumbnails) through **Cloudflare Image Transformations** on `cdn.whoifollow.tech`. Backend wraps every image URL through a single shared helper before serializing, picking one of the nine named presets below. Frontend treats the resulting URL as opaque — never parses it, never re-prefixes the host, never appends size hints client-side.

### Preset catalogue

| Key | Cloudflare options | Use case |
|---|---|---|
| `avatar_sm` | `width=32,height=32,fit=cover,quality=85,format=auto` | Edge cases only (dense lists, inline mentions). |
| `avatar_md` | `width=64,height=64,fit=cover,quality=85,format=auto` | **DEFAULT** for every avatar / logo field. |
| `avatar_lg` | `width=128,height=128,fit=cover,quality=85,format=auto` | Hero rows, profile cards. |
| `avatar_xl` | `width=256,height=256,fit=cover,quality=85,format=auto` | Profile pages, large detail surfaces. |
| `cover_thumb_sq` | `width=200,height=200,fit=cover,quality=80,format=auto` | Event cover (square) thumbnails. |
| `cover_card_sq` | `width=400,height=400,fit=cover,quality=80,format=auto` | Event cover (square) on list rows. |
| `cover_card_wide` | `width=600,height=338,fit=cover,quality=80,format=auto` | Event cover (16:9) on list rows. |
| `cover_banner` | `width=1200,height=675,fit=cover,quality=80,format=auto` | Event cover (16:9) on hero / detail pages. |
| `cover_banner_xl` | `width=1920,height=1080,fit=cover,quality=80,format=auto` | User profile covers, full-bleed banners. |

All avatar presets are 1:1; cover presets come in 1:1 and 16:9 flavours. Avatars use `quality=85` (faces benefit from the extra detail); covers use `quality=80`. Every preset sets `fit=cover` and `format=auto` so the CDN serves WebP / AVIF when the client supports it.

### Default preset per asset type

When a serializer doesn't specify a preset, it picks the default for the asset type:

| Asset type | Default preset |
|---|---|
| User avatar | `avatar_md` |
| Team avatar | `avatar_md` |
| Association avatar / logo | `avatar_md` |
| Event cover — list row | `cover_card_wide` |
| Event cover — hero / detail page | `cover_banner` |
| User profile cover | `cover_banner_xl` |
| Group cover | `cover_card_wide` |

Per-endpoint overrides (e.g. an event hero modal that wants `cover_banner` instead of `cover_card_wide`) MUST be named in that endpoint's field notes inside the contract file, so the wire field's preset is unambiguous on read.

### Canonical URL shape

```
https://cdn.whoifollow.tech/cdn-cgi/image/<comma-separated-options>/<source-image-url>
```

Worked example (a user avatar):

```
https://cdn.whoifollow.tech/cdn-cgi/image/width=64,height=64,fit=cover,quality=85,format=auto/https%3A%2F%2Fcdn.whoifollow.tech%2Fusers%2Favatar%2F9041b357-abda-4f7d-92cd-02e03f08e59d%2Fnq5Bt4sJ.jpg
```

Notes:
- The source URL (the part after the preset segment) is **`rawurlencode`d** (NOT `urlencode` — `rawurlencode` preserves `/` and matches RFC 3986). This guards against `?`, `&`, `+`, spaces, and other characters that break path parsing mid-URL.
- Source URLs that live on hostnames OTHER than `cdn.whoifollow.tech` (e.g. external S3 buckets) must be listed under the Cloudflare zone's **Transform Sources** allowlist or the request 403s. If a backend serializer ever needs to wrap an off-zone URL, the zone admin first adds the hostname.

### Backend helper signature (source of truth)

Every serializer routes through ONE function. The shape, in pseudo-PHP for reference (real implementation lives in the backend repo):

```php
const CDN_TRANSFORM_BASE = 'https://cdn.whoifollow.tech';

const IMAGE_TRANSFORM_PRESETS = [
    'avatar_sm'       => 'width=32,height=32,fit=cover,quality=85,format=auto',
    'avatar_md'       => 'width=64,height=64,fit=cover,quality=85,format=auto',
    'avatar_lg'       => 'width=128,height=128,fit=cover,quality=85,format=auto',
    'avatar_xl'       => 'width=256,height=256,fit=cover,quality=85,format=auto',
    'cover_thumb_sq'  => 'width=200,height=200,fit=cover,quality=80,format=auto',
    'cover_card_sq'   => 'width=400,height=400,fit=cover,quality=80,format=auto',
    'cover_card_wide' => 'width=600,height=338,fit=cover,quality=80,format=auto',
    'cover_banner'    => 'width=1200,height=675,fit=cover,quality=80,format=auto',
    'cover_banner_xl' => 'width=1920,height=1080,fit=cover,quality=80,format=auto',
];

function transformImageUrl(?string $sourceUrl, string $preset = 'avatar_md'): ?string {
    if (!$sourceUrl) return null;
    if (!isset(IMAGE_TRANSFORM_PRESETS[$preset])) {
        throw new InvalidArgumentException("Unknown image-transform preset: {$preset}");
    }
    $opts = IMAGE_TRANSFORM_PRESETS[$preset];
    $encoded = rawurlencode($sourceUrl);
    return CDN_TRANSFORM_BASE . '/cdn-cgi/image/' . $opts . '/' . $encoded;
}
```

Rules:
- Helper is called from every place an image URL goes on the wire — no field-by-field URL composition anywhere else in the codebase.
- `null` / empty input returns `null`. Callers do not need a separate guard.
- The source URL may be a raw CDN filename path (`https://cdn.whoifollow.tech/users/avatar/foo.jpg`) OR an absolute external URL (when allow-listed). The helper treats them identically — it just `rawurlencode`s and prefixes.
- The helper does NOT validate that the source image exists. If the source 404s, Cloudflare serves the 404 from the transform too.

### How this section stays honest

- Whenever a preset is added, renamed, or its options string changes, the same PR must update:
  1. This document (`shared-catalogues.md` §8) — the source of truth.
  2. The backend `IMAGE_TRANSFORM_PRESETS` constant.
  3. Any contract field notes that name the old preset explicitly.
  4. The `transformImageUrl()` callers IF the preset key changes (e.g. a rename — additions to the map are caller-transparent).
- Removing a preset is risky: any URL already cached by a client (browser, CDN edge) using that preset stops resolving the moment the backend stops referencing it. Removals need a soft-deprecation cycle — keep the old preset in the map for at least one release after the last serializer drops it.

---

## 8. Custom-field entity-type catalogue

The entity surfaces a **custom field** can attach to. Stored as the snake_case `key` in `custom_field_definitions.entity_type` (`VARCHAR` — **not** a numeric code and **not** a reference table; see the rationale in [`association-custom-fields-api-contract.md`](../api/association-custom-fields-api-contract.md)). It's the same wire value carried by the API and the `entityType` filter on the Settings manager.

| `key` (wire + DB) | `label` (display) |
|---|---|
| `event` | Event |
| `division` | Division |
| `game` | Game |
| `team` | Team |
| `umpire` | Umpire |
| `player` | Player |
| `product` | Product |

**Notes:**

- A genuinely **open, growing** taxonomy — it'll gain more surfaces over time (the above is the v1 set). It lives here (not inside the custom-fields contract) because it's a polymorphic discriminator referenced across many subsystems.
- **Adding a value is a code change, not a migration** — append a row here, the union, and the constant, in one PR. No DDL (the column is `VARCHAR`), and no `CHECK` constraint (which would reintroduce a migration on every addition). Validity is developer-controlled.
- A new entity type only *works* once its host form is wired to fetch + render + save custom fields — so additions are inherently developer work, which is why this is a constant, not a runtime-editable DB lookup.

**Source of truth:**
- Frontend: `src/api/customFields.ts` → `CUSTOM_FIELD_ENTITY_TYPES` (+ `CustomFieldEntityType` union in `src/types.ts`)
- Backend: TBD (suggest `config/catalogues/custom-field-entity-types.php`)
- Contract reference: `docs/api/association-custom-fields-api-contract.md`; column in [`sql-schema-shared.md#custom_field_definitions`](./sql-schema-shared.md#custom_field_definitions)

---

## 9. Custom-field input-type catalogue

The control widget a custom field renders as. Stored as the `key` in `custom_field_definitions.input_type` (`VARCHAR`). Closed set — each value maps to a branch in `CustomFieldsRenderer.vue`, so adding one is always a frontend code change.

| `key` (wire + DB) | `label` (display) | Renders as |
|---|---|---|
| `boolean` | Toggle (yes / no) | `ToggleSwitch` |
| `single_select` | Single choice | `<select>` |
| `multi_select` | Multiple choice | `TagsMultiSelect` |
| `number` | Number | numeric `<input>` |
| `text` | Text | text `<input>` |
| `date` | Date | `DateTimePicker` (date-only) |
| `textarea` | Long text | `<textarea>` |

**Notes:**

- `options` is required + non-empty only for `single_select` / `multi_select`; `[]` for every other type.
- `entity_type` and `input_type` are **immutable after creation** (the Settings manager locks both) — stored answers in `custom_field_values` are strings encoded per the original `input_type`, so changing it would corrupt history. See the contract's §3.

**Source of truth:**
- Frontend: `src/api/customFields.ts` → `CUSTOM_FIELD_INPUT_TYPES` (+ `CustomFieldInputType` union in `src/types.ts`)
- Backend: TBD (suggest `config/catalogues/custom-field-input-types.php`)
- Contract reference: `docs/api/association-custom-fields-api-contract.md`

---

## 10. Region catalogue

Coarse geographic groupings **above** state level that a team registration can belong to (e.g. `Southwest`). Stored verbatim as a free `VARCHAR` in `association_teams.region` — the catalogue value IS the wire + DB value. Surfaced as the **Region** dropdown on the Register/Edit Team wizard.

Starts **US-only**; structured by country so other countries can be added later without touching consumers.

### United States

| `value` (wire + DB + label) |
|---|
| North |
| South |
| East |
| West |
| Northeast |
| Northwest |
| Southeast |
| Southwest |
| Midwest |
| Far East |
| Far West |

**Notes:**

- ⚠️ **Starter set — confirm against the real registration data before go-live.** These directional values are a reasonable first cut; adjust the list to the association's actual regions (it's a one-row-per-region edit, no migration since the column is free `VARCHAR`).
- `label === value` today (kept distinct in the type so a value can be relabeled without a data migration).
- Adding a value is a code change, not a migration (free `VARCHAR`, no `CHECK`).

**Source of truth:**
- Frontend: `src/constants/regions.ts` → `US_REGIONS` / `REGION_CATALOGUE` (+ `RegionOption` type)
- Backend: TBD (suggest `config/catalogues/regions.php`)
- Contract reference: [`association-teams-api-contract.md`](../api/association-teams-api-contract.md) §3 (`region` field); column in [`sql-schema-association.md#association_teams`](./sql-schema-association.md#association_teams)

---

## 11. How to keep this document honest

- Whenever a catalogue value is added or changed, the same PR must update:
  1. The frontend constant (`src/api/events.ts`, `src/constants/*.ts`)
  2. The backend config (or DB table)
  3. This document
  4. The relevant API contract if the catalogue surfaces on the wire
- Removing values is dangerous — if any existing row references the removed key, reads break. Soft-deletion + migration is the safe path; outright removal needs a backfill plan.
- A periodic audit script (suggested): walk this doc's tables, parse the markdown, and assert each row exists 1:1 in both the frontend constant and the backend config. Wire this into CI when the backend's catalogue mirror lands.
