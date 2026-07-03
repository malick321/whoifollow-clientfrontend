---
status: Draft
owner: shared
last_updated: 2026-05-31
---

# Shared Services — REST API contract

## Context

Home for **cross-cutting, non-domain utility endpoints** that any surface in the app can call — weather today; geocoding / address autocomplete / timezone lookup / static maps / currency, etc. down the line. Unlike the domain contracts (`association-events-api-contract.md`, `matchgeni-*-api-contract.md`, `reports-api-contract.md`), endpoints here aren't scoped to a feature or an `associationId` — they take raw inputs (coordinates, dates, an address string) and return normalized data, so the same endpoint backs the admin portal AND public audience pages.

Most entries are **thin server-side proxies over a third-party API**. The pattern is deliberate: the upstream API key stays on the server, the response is normalized into our own shape (so we can swap providers without touching callers), and the result is cacheable because it's non-personalized.

For shared rules — response envelope, auth header, error codes — see [`conventions.md`](./conventions.md). Wire fields are **camelCase** per the project-wide convention.

## Endpoints

| # | Endpoint | Upstream | Notes |
|---|---|---|---|
| 1 | `GET /v2/weather` | WeatherAPI.com | Daily min/max + condition for a geo-point across dates. |
| 2 | `GET /getBracketFormats` | (internal table) | Global bracket-format catalogue (Single / Double / Triple Elimination, 3 Game Guarantee, Round Robin). |
| 3 | `GET /getAgeGroup` | (internal table) | Global age-group catalogue (youth `8U…18U` + adult `30…85 Older`). |
| 4 | ~~`GET /getAllRatings`~~ | — | **Removed** — ratings are now association-scoped; see [`association-ratings-api-contract.md`](./association-ratings-api-contract.md). |
| 5 | `GET /v2/tournaments/field-configurations/sport-type/{sportsTypeId}` | (internal table) | **(RETIRED — see §8)** Field-configuration catalogue for a sport type (id + name + on-field position layout). |
| 6 | `GET /v2/seeders` | (internal table) | Global seeding-criteria catalogue (W/L, Head to Head, Runs Against, Run Differential, Runs Scored, Coin Flip). Replaces legacy `fetchFilteredSeedars`. |
| 7 | `GET /v2/mediums` | (internal table) | Online-event medium catalogue (Zoom, YouTube Live, …). PROVISIONAL. |
| 8 | `GET /v2/sport-types` (+ `/{sportsTypeId}`) | (internal table) | Unified sport-type resource — sport types with nested field configurations (+ positions) and umpire configs. Supersedes §5. |
| 9 | ~~`GET /v2/association/{associationId}/custom-fields`~~ | — | **Moved** — association-scoped CRUD, see [`association-custom-fields-api-contract.md`](./association-custom-fields-api-contract.md). |

_(Future: geocoding, place autocomplete, timezone lookup — added as `## 10`, `## 11`, … using the same template.)_

---

## 1. Get Weather

- **Endpoint**: `GET /v2/weather`
- **Purpose**: Normalized daily weather (min/max + condition) for a geo-point across one or more dates. Backs every weather surface — the MatchGeni dashboard's per-park playing-facility cards, the scheduler's per-day strip, and the public event detail page — by accepting raw `lat`/`lon` + `dates` rather than an `eventId`, so any caller with coordinates can use it.
- **Upstream source**: WeatherAPI.com. The server selects the correct upstream endpoint **per requested date** based on its distance from "today" (see *Date resolution*), calls it with `q=<lat>,<lon>`, maps the response into the normalized shape below, and caches the result. **The upstream API key never reaches the browser.**
- **Auth**: None required — weather is non-personalized public data, safe to call from authed portal pages **and** public audience pages. The response is identical for all callers, which is what makes it CDN-cacheable (see *Caching*).

### Query parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `lat` | string (decimal degrees) | yes | e.g. `32.5634810`. `400` if missing / unparseable / outside `[-90, 90]`. |
| `lon` | string (decimal degrees) | yes | e.g. `-97.1417230`. `400` if missing / unparseable / outside `[-180, 180]`. |
| `dates` | string (CSV of `YYYY-MM-DD`) | yes\* | Up to **31** dates, comma-separated (e.g. `2026-04-29,2026-04-30`). Server de-dupes + sorts. `400` if any date is malformed or the count exceeds the cap. |
| `from` / `to` | string (`YYYY-MM-DD`) | yes\* | Alternative to `dates`: an inclusive range the server expands. `to − from` capped at 31 days. |
| `units` | `'f' \| 'c'` | no | Temperature unit. Default `f`. Any other value → `400`. |

\* Provide **either** `dates` **or** `from` + `to`, not both. Supplying neither, or both, → `400`.

### Request body

None (GET).

### Response

```json
{
  "responseStatus": { "statusCode": 200, "message": "Weather fetched successfully.", "text": "OK" },
  "data": {
    "location": {
      "lat": 32.563481,
      "lon": -97.141723,
      "name": "Mansfield",
      "region": "Texas",
      "tzId": "America/Chicago"
    },
    "units": "f",
    "days": [
      {
        "date": "2026-04-29",
        "source": "future",
        "available": true,
        "tempMin": 58,
        "tempMax": 81,
        "tempAvg": 70,
        "conditionText": "Partly cloudy",
        "conditionCode": 1003,
        "iconUrl": "https://cdn.weatherapi.com/weather/64x64/day/116.png",
        "chanceOfRain": 20
      },
      {
        "date": "2027-09-01",
        "source": "none",
        "available": false,
        "tempMin": null,
        "tempMax": null,
        "tempAvg": null,
        "conditionText": null,
        "conditionCode": null,
        "iconUrl": null,
        "chanceOfRain": null
      }
    ]
  }
}
```

### `location` object

| Field | Type | Notes |
|---|---|---|
| `lat` / `lon` | number | Echoed back, rounded to the cache precision (4 dp ≈ 11 m). |
| `name` / `region` | string \| null | Resolved place name from the upstream (display only). |
| `tzId` | string \| null | IANA timezone of the point — lets the client compute "today" correctly for the forecast/future boundary. |

### `days[]` entry

`days[]` is sorted ascending and is 1:1 with the resolved request dates.

| Field | Type | Notes |
|---|---|---|
| `date` | string | ISO `YYYY-MM-DD`, echoes the request. |
| `source` | `'current' \| 'forecast' \| 'future' \| 'history' \| 'none'` | Which upstream produced the row — transparency for the client (`none` = outside every horizon). |
| `available` | boolean | `false` when the date is beyond every horizon (e.g. > 300 days out, or unsupported by the plan tier). All metric fields are `null` when `false`. |
| `tempMin` / `tempMax` / `tempAvg` | number \| null | In the requested `units`, rounded to whole degrees. |
| `conditionText` | string \| null | e.g. `"Partly cloudy"`. |
| `conditionCode` | number \| null | WeatherAPI condition code (stable; lets the client map to its own icon set if preferred over `iconUrl`). |
| `iconUrl` | string \| null | **https-normalized** absolute URL. Upstream returns protocol-relative (`//cdn.weatherapi.com/...`); the server prepends `https:`. |
| `chanceOfRain` | number \| null | 0–100 %. Useful for tournament ops. Omit from the implementation if not needed — additive later. |

### Date resolution (server picks the upstream per date)

Computed in the **point's** timezone (`location.tzId`), not the caller's:

| Requested date vs "today" | Upstream | Notes |
|---|---|---|
| past | `history.json?dt=` | Back to 2010-01-01. |
| today | `current.json` (or forecast day 0) | Live conditions. |
| +1 … +14 days | `forecast.json?days=N` | **Batched** — one call covers all near-term dates for the point. |
| +15 … +300 days | `future.json?dt=` | One call per date. Statistical estimate, **not** a live forecast. |
| > +300 days | — | `available: false`, `source: "none"`. |

> The server groups a request's dates by bucket so the near-term set collapses into a **single** `forecast.json` call while far-out dates issue one `future.json` each. `history.json` / `future.json` availability depends on the WeatherAPI **plan tier**; unsupported dates degrade to `available: false` rather than failing the whole request.

### Caching

Non-personalized → cache aggressively at two complementary layers:

- **Origin cache (Redis / app)** — the quota guardrail + key holder. Caches each normalized day keyed by `round(lat,4) | round(lon,4) | date | units`, so overlapping requests (multiple parks sharing dates, many viewers) reuse entries and the upstream is hit at most ~once per point-day per TTL. Per-date rows are cached individually.
- **CDN edge (Cloudflare)** — absorbs public/mobile traffic volume; honors the headers the origin emits so most repeat requests never reach the origin.
- **Response headers**: `Cache-Control: public, max-age=1800, s-maxage=3600, stale-while-revalidate=86400`. No `Set-Cookie` / no `Vary` that would defeat edge caching.
- **TTL guidance**: forecast / current ~30–60 min; future ~6–24 h; history ~30 d (immutable once past).

### Error handling (degrade, don't break — weather is non-critical)

| Code | When |
|---|---|
| `400` | Missing / invalid `lat` or `lon`; malformed date; both `dates` and `from`/`to` supplied (or neither); date count over the cap; bad `units`. |
| `200` | Even when the upstream is down or a date is unsupported — affected `days[]` rows return `available: false` so the widget hides gracefully instead of erroring the page. **This is the recommended default.** |
| `502` | Reserved if the team prefers to hard-fail on total upstream failure instead of the graceful `200` above. |

### Edge cases

| Case | Handling |
|---|---|
| Point in a different timezone than the user | "Today" is computed in the **point's** tz (`location.tzId`) so the forecast/future boundary is correct. |
| Same `(lat, lon, date)` requested by many parks / users | One cache entry serves all. |
| Plan tier lacks `future.json` (or history) | Those dates return `available: false`; the client renders nothing for them. |
| Coordinates `null` (park without a geocode) | The caller skips the request entirely; no weather shown for that point. |

### Frontend client (this repo)

`src/api/weather.ts` (currently exports the event-scoped `fetchEventWeather` over the legacy `/event/getApiWeatherData` proxy) gains a coordinate-based helper:

```ts
interface WeatherDay {
  date: string
  available: boolean
  tempMin: number | null
  tempMax: number | null
  conditionText: string | null
  iconUrl: string | null
  // tempAvg / conditionCode / chanceOfRain optional, per fields above
}

/** Keyed by date; dates the plan can't cover are omitted (or present
 *  with available:false). Any transport error resolves to an empty
 *  map so the non-critical widget simply hides. */
export async function fetchWeatherForDates(
  lat: string | number,
  lon: string | number,
  datesISO: string[],
  units?: 'f' | 'c'
): Promise<Map<string, WeatherDay>>
```

Consumers:
- **Dashboard playing facilities** — call per park (`park.latitude` / `park.longitude` from §9 Event Resources + `schedule[].date`) → fill the facility card's `forecast`.
- **Scheduler** — call with the selected park's lat/long + active date. Requires carrying `latitude` / `longitude` onto `SchedulerPark` (the `Park → SchedulerPark` adapter currently drops them).
- **Event detail (future)** — call with the event's lat/long.

---

## 2. Get Bracket Formats

- **Endpoint**: `GET /getBracketFormats` — **legacy path** (mounted at `/api/...`, **no** `/v2` prefix).
- **Purpose**: Returns the global catalogue of bracket formats the platform supports. It's a shared lookup consumed wherever a bracket format is picked: **event add/edit**, **bracket add/edit**, and **division add/edit**. Centralizing it here (rather than per-domain) keeps every dropdown in lockstep when a format is added.
- **Upstream source**: Internal — backed by a small reference table, not a third-party proxy. Listed in this shared contract because, like weather, it's a cross-cutting lookup with no `associationId` scoping and an identical response for every caller (so it's cacheable).
- **Auth**: Standard session header (same as other legacy endpoints). The list is the same for all authed callers.

### Query parameters

None. The endpoint takes no request parameters.

### Request body

None (GET).

### Response

```json
{
  "data": {
    "list": [
      { "id": 1, "bracket_name": "Single Elimination", "status": 1, "created_at": "2023-01-10 12:00:00", "updated_at": "2023-01-10 12:00:00" },
      { "id": 2, "bracket_name": "Double Elimination", "status": 1, "created_at": "2023-01-10 12:00:00", "updated_at": "2023-01-10 12:00:00" },
      { "id": 3, "bracket_name": "Triple Elimination", "status": 1, "created_at": "2023-01-10 12:00:00", "updated_at": "2023-01-10 12:00:00" },
      { "id": 4, "bracket_name": "3 Game Guarantee", "status": 1, "created_at": "2023-01-10 12:00:00", "updated_at": "2023-01-10 12:00:00" },
      { "id": 5, "bracket_name": "Round Robin", "status": 1, "created_at": "2023-01-10 12:00:00", "updated_at": "2023-01-10 12:00:00" }
    ]
  },
  "message": "Bracket formats fetched successfully.",
  "statusCode": 200
}
```

> ⚠️ **Legacy envelope.** Unlike the §1 `responseStatus` envelope, this endpoint returns the older `{ data, message, statusCode }` shape with **snake_case** row fields (`bracket_name`, `created_at`). The frontend client normalizes each row onto the project-wide camelCase `{ id, name }` option shape.

### `data.list[]` entry

| Field | Type | Notes |
|---|---|---|
| `id` | number | Stable format id — persisted on the consuming record (e.g. `event.bracketFormatId`, the bracket row's format). The client stringifies it for `<select>` value binding. |
| `bracket_name` | string | Display label (e.g. `"Single Elimination"`). Mapped to `name`. |
| `status` | number | Active flag (1 = active). Inactive formats may be filtered server-side; the client renders whatever rows come back. |
| `created_at` / `updated_at` | string \| null | Audit timestamps; unused by the UI. |

### Caching

Static reference data — safe to cache for hours. The catalogue changes only when an admin adds/edits a format. Client may hold the result for the session; a `Cache-Control: public, max-age=3600` is appropriate at the edge.

### Error handling (degrade, don't break)

| Code | When |
|---|---|
| `200` | Normal — `data.list` populated. |
| `200` (empty `list`) / transport error | The frontend client (`src/api/bracketFormats.ts`) catches any failure and resolves to an **empty array** so the consuming form renders an empty `<select>` rather than erroring. Callers that need a guaranteed list fall back to the static `BRACKET_FORMAT_CATALOGUE`. |

### Frontend client (this repo)

`src/api/bracketFormats.ts`:

```ts
import type { BracketFormatOption } from '../types' // { id: string; name: string }

/** Fetch the global bracket-format catalogue. Maps the legacy
 *  { id, bracket_name } rows onto { id, name }. Resolves to []
 *  on any error (non-critical lookup). */
export async function fetchBracketFormats(): Promise<BracketFormatOption[]>
```

Consumers: Add/Edit Bracket modal (MatchGeni scheduler Brackets tab), Add/Edit Event (`EventFormModal`), Add/Edit Division.

---

## 3. Get Age Groups

- **Endpoint**: `GET /getAgeGroup` — **legacy path** (mounted at `/api/...`, **no** `/v2` prefix).
- **Purpose**: Returns the global catalogue of age groups the platform supports — youth (`8U`–`18U`) and adult (`30 Older`–`85 Older`). A shared lookup consumed wherever a division or team is constrained to specific age groups: **Add/Edit Division** ("Teams" → restrict by age + rating), team registration, event filters.
- **Upstream source**: Internal — backed by a reference table, not a third-party proxy. Cross-cutting (no `associationId` scoping); identical response for every caller, so it's cacheable.
- **Auth**: Standard session header (same as other legacy endpoints).

### Query parameters

None. The endpoint takes no request parameters.

### Request body

None (GET).

### Response

```json
{
  "data": {
    "list": [
      { "id": 13, "name": "8U", "type": 2, "fieldconfig_id": 2, "created_at": null, "updated_at": null, "deleted_at": null },
      { "id": 1,  "name": "30 Older", "type": 1, "fieldconfig_id": 2, "created_at": null, "updated_at": null, "deleted_at": null },
      { "id": 8,  "name": "65 Older", "type": 1, "fieldconfig_id": 1, "created_at": null, "updated_at": null, "deleted_at": null }
    ]
  },
  "message": "Age groups list fetched successfully.",
  "statusCode": 200,
  "optional": ""
}
```

> ⚠️ **Legacy envelope.** Same older `{ data, message, statusCode }` shape as §2 with **snake_case** row fields (`fieldconfig_id`). The frontend client normalizes each row onto camelCase `AgeGroupOption`.

### `data.list[]` entry

| Field | Type | Notes |
|---|---|---|
| `id` | number | Stable age-group id — persisted on the consuming record. The client stringifies it for option binding. |
| `name` | string | Display label (e.g. `"12U"`, `"50 Older"`). Mapped to `name`. |
| `type` | number | Group class: `2` = youth (`xxU`), `1` = adult (`xx Older`). Lets a surface section youth vs adult. |
| `fieldconfig_id` | number \| null | Default field configuration this group plays under. Mapped to `fieldConfigId`. |
| `created_at` / `updated_at` / `deleted_at` | string \| null | Audit timestamps; unused by the UI. |

### Caching

Static reference data — safe to cache for hours / the session. Client holds the result for the page lifetime (`src/api/ageRatingCatalogue.ts`); `Cache-Control: public, max-age=3600` is appropriate at the edge.

### Error handling (degrade, don't break)

| Code | When |
|---|---|
| `200` | Normal — `data.list` populated. |
| `200` (empty `list`) / transport error | The frontend client catches any failure and resolves to an **empty array** so the consuming control renders empty rather than erroring. |

---

## 4. Get All Ratings (removed)

> **Removed — migrated to [`association-ratings-api-contract.md`](./association-ratings-api-contract.md).** The legacy global `GET /getAllRatings` lookup no longer exists. Ratings (team skill tiers) are now **association-scoped**: each association owns and manages its own tiers (e.g. SSUSA: AA / AAA / Major / Major +; PSA: REC / COMP) via a full CRUD rooted at `{associationId}`, managed from Settings → Ratings. The catalogue is no longer a global, cross-cutting lookup, so it leaves this shared-services contract. See the [association-ratings contract](./association-ratings-api-contract.md) for the endpoints, response shape (`rate → name`, `status → active`), and the `RatingOption` / `RatingInput` TS shapes.

(Section heading kept and **not renumbered** — §5–§9 below retain their numbers and existing cross-references.)

---

## 5. Get Field Configurations (by sport type)

> ⚠️ **RETIRED — superseded by §8 (`GET /v2/sport-types`).** Kept for reference only; **do not build new callers against it.** Field configurations (with their position layouts) are now sourced nested inside each sport type from the unified §8 sport-types resource, which removes the duplication between this endpoint and the sport-type catalogue. The existing frontend client (`src/api/fieldConfigurations.ts`) is re-pointed to read `fieldConfigurations` off `fetchSportType(id)` (see §8) rather than calling this path.

- **Endpoint**: `GET /v2/tournaments/field-configurations/sport-type/{sportsTypeId}` — **v2 path** (this one carries the `/v2` prefix, unlike §2–§4).
- **Purpose**: Returns the field configurations available for a sport type — each a named on-field position layout (e.g. "Softball", "Baseball"). Consumed wherever a field configuration is picked: **Add/Edit Division** (Field Config step), and the field-layout / lineup surfaces. Listed here because it's a cross-cutting lookup keyed only by `sportsTypeId` (no `associationId`/`eventId` scoping) with an identical response for every caller, so it's cacheable.
- **Upstream source**: Internal reference table.
- **Auth**: Standard session header.

### Path parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `sportsTypeId` | number | yes | The event's sport type id. Surfaced on the MatchGeni access payload as `event.sportsTypeId` (see `matchgeni-access-api-contract.md` §1), which is where the Add/Edit Division form sources it. |

### Query parameters

None.

### Request body

None (GET).

### Response

```json
{
  "data": [
    {
      "id": 10,
      "name": "Softball",
      "image": null,
      "sport_types": [
        { "id": 1, "name": "Softball (Slow Pitch)" }
      ],
      "positions": [
        { "id": 81, "position_name": "ab", "position_number": 1, "x_axis": 217.174, "y_axis": 271.198, "status": 1 },
        { "id": 82, "position_name": "ac", "position_number": 2, "x_axis": 75.3058, "y_axis": 342.836, "status": 1 }
      ]
    }
  ],
  "message": "Field configurations loaded successfully.",
  "statusCode": 200,
  "optional": ""
}
```

> ⚠️ **`data` is a bare array** here (not `{ data: { list: [...] } }` like §2–§4). The frontend client reads `payload.data` directly.

### `data[]` entry

| Field | Type | Notes |
|---|---|---|
| `id` | number | Stable field-config id — persisted on the consuming record (e.g. the division's `fieldConfigId`, and `event.defaults.fieldConfigId`). The client stringifies it for `<select>` value binding. |
| `name` | string | Display label (e.g. `"Softball"`). Mapped to `name`. |
| `image` | string \| null | Optional diagram image; unused by the division form. |
| `sport_types` | array | The sport types this config applies to (`{ id, name }`). Informational for this form. |
| `positions` | array | On-field position layout (`{ id, position_name, position_number, x_axis, y_axis, status }`). Used by the field-layout / lineup surfaces, **not** the division form (which only needs `{ id, name }`). |

### Caching

Static reference data — safe to cache for hours / the session. Because the list varies per sport type, the client caches **per `sportsTypeId`** (one entry per sport). `Cache-Control: public, max-age=3600` is appropriate at the edge.

### Error handling (degrade, don't break)

| Code | When |
|---|---|
| `200` | Normal — `data` populated. |
| `200` (empty `data`) / transport error | The frontend client (`src/api/fieldConfigurations.ts`) catches any failure and resolves to an **empty array** so the Field Configuration select renders empty rather than erroring. |

### Frontend client (this repo)

`src/api/fieldConfigurations.ts`:

```ts
import type { FieldConfigurationOption } from '../types' // { id: string; name: string }

/** Page-cached per sportsTypeId. Resolves to [] on any error (or a
 *  missing sportsTypeId). */
export async function fetchFieldConfigurations(
  sportsTypeId: number | null | undefined
): Promise<FieldConfigurationOption[]>
```

Consumers: Add/Edit Division (Field Config step), fed by `event.sportsTypeId` from the access payload.

---

## 6. Get Seeders (seeding-criteria catalogue)

- **Endpoint**: `GET /v2/seeders`.
- **Purpose**: Returns the global catalogue of tie-break **seeding criteria** ("seeders") available across the WIF system — W/L, Head to Head, Runs Against, Run Differential, Runs Scored, Coin Flip. The admin picks from this list to build an **event-level default** order (and a division can override with its own). A shared lookup consumed by the **Add/Edit Event** wizard AND the **Add/Edit Division** Seed step; centralized here (rather than per-domain) so both surfaces stay in lockstep.
- **Upstream source**: Internal reference table (`seeding_criteria`).
- **Auth**: Standard session header.

> **Replaces the legacy `GET /associationEvent/fetchFilteredSeedars`** (no `/v2` prefix, bare `data[]`, snake_case `criteria_name`, legacy `update_at` typo). The v2 endpoint returns the standard envelope + camelCase `{ id, name }`, so the frontend no longer maps `criteria_name`. The legacy path is retired.

### Query parameters

None. (Future: an optional `status` filter; default returns active only.)

### Request body

None (GET).

### Response

```json
{
  "responseStatus": { "statusCode": 200, "message": "Seeders fetched successfully.", "text": "OK" },
  "data": {
    "list": [
      { "id": "1", "name": "Win / Loss" },
      { "id": "2", "name": "Head to Head" },
      { "id": "3", "name": "Runs Against" },
      { "id": "4", "name": "Run Differential" },
      { "id": "5", "name": "Runs Scored" },
      { "id": "6", "name": "Coin Flip" }
    ]
  }
}
```

### `data.list[]` entry

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable seeding-criterion id — persisted on `event_seed_criteria.seeding_criteria_id` (event default) and `tournament_seed_criteria.seeding_criteria_id` (division override). |
| `name` | string | Display label (e.g. `"Run Differential"`). |

Active-only and ordered for display by the backend; the client renders the list as-is.

### Caching

Static reference data — page-lifetime client cache (`src/api/seedingCriteria.ts`); `Cache-Control: public, max-age=3600` at the edge.

### Error handling (degrade, don't break)

| Code | When |
|---|---|
| `200` | Normal — `data.list` populated. |
| `200` (empty) / transport error | The frontend client catches any failure and resolves to an **empty array** so the Seed step renders empty rather than erroring. |

### Frontend client (this repo)

`src/api/seedingCriteria.ts` — **mock-first** (mirrors `mediums.ts`); flip `SEEDERS_LIVE` once the endpoint ships, the signature stays:

```ts
import type { SeedingCriterionOption } from '../types' // { id: string; name: string }

/** Page-cached. Resolves to [] on any error (non-critical lookup). */
export async function fetchSeedingCriteria(): Promise<SeedingCriterionOption[]>
```

Consumers: the Add/Edit Event wizard (event-level default → `event_seed_criteria`) and Add/Edit Division (Seed step → `tournament_seed_criteria`) — see `association-events-api-contract.md` and `matchgeni-division-api-contract.md`.

## 7. Get Mediums (online-event mediums)

> **Status: PROVISIONAL.** Shape sketched here so the Add/Edit Event wizard's **Online location** step can bind to it; finalized when we do the full shared-services pass. Treat the path + envelope as not-yet-locked.

- **Endpoint**: `GET /v2/mediums` *(provisional path)*.
- **Purpose**: Returns the catalogue of **online-event mediums** (e.g. "Zoom", "YouTube Live", "Google Meet", "Teams"). Consumed by the Add/Edit Event wizard when `locationType = 'online'` — the picked medium's `id` persists to `team_events.medium_id` and its name is snapshotted to `team_events.medium`. Backed by the `mediums` catalogue ([`sql-schema-shared.md#mediums`](../system/sql-schema-shared.md#mediums)).
- **Auth**: Standard session header.

### Query parameters

None. (Future: an optional `status` filter; default returns active only.)

### Request body

None (GET).

### Response

```json
{
  "data": {
    "list": [
      { "id": 1, "name": "Zoom", "status": 1 },
      { "id": 2, "name": "YouTube Live", "status": 1 },
      { "id": 3, "name": "Google Meet", "status": 1 }
    ]
  },
  "message": "Mediums fetched successfully.",
  "statusCode": 200
}
```

### `data.list[]` entry

| Field | Type | Notes |
|---|---|---|
| `id` | number | Stable medium id — persisted on `team_events.medium_id`. Stringified for option binding. |
| `name` | string | Display label (e.g. `"Zoom"`). Snapshotted to `team_events.medium` on the event. |
| `status` | number | Active flag (1 = active). Endpoint returns active only. |

### Caching

Static reference data — page-lifetime client cache; `Cache-Control: public, max-age=3600` at the edge (same policy as §3 / §6).

### Error handling (degrade, don't break)

Any failure resolves to an **empty array** so the Online step renders an empty medium picker rather than erroring (non-critical lookup).

### Frontend client (this repo)

`src/api/mediums.ts` *(to add when the wizard lands)*:

```ts
import type { MediumOption } from '../types' // { id: string; name: string }

/** Page-cached. Resolves to [] on any error (non-critical lookup). */
export async function fetchMediums(): Promise<MediumOption[]>
```

Consumer: Add/Edit Event wizard — Online location step.

## 8. Get Sport Types (unified — sport types + field configs + umpire configs)

- **Endpoint**: `GET /v2/sport-types` (all) and `GET /v2/sport-types/{sportsTypeId}` (one) — **v2 path** (carries the `/v2` prefix, like §5).
- **Purpose**: One canonical sport-type resource that returns each sport type **with its field configurations (and their on-field position layouts) and umpire configs nested inline**. Two scopes, identical object shape:
  - `GET /v2/sport-types` — **all** sport types. Backs the **Add/Edit Event** form, which needs the sport-type list, the chosen sport's field configs, and its umpire configs in **one** call (this previously meant the sport-type list + a §5 field-configs call + an umpire-configs call — three round-trips).
  - `GET /v2/sport-types/{sportsTypeId}` — **one** sport type (same object shape). Backs the **Add/Edit Division** form, where the sport type is fixed/inherited from the event and the user can't change it, so only that sport's configs are needed.

  This **supersedes §5**: field configurations now come nested inside each sport type rather than from a separate per-sport endpoint, collapsing one canonical resource that both forms read from and removing the §5 duplication.
- **Upstream source**: Internal — backed by [`team_sport_types`](../system/sql-schema-shared.md#team_sport_types) (catalogue), [`sport_type_field_configurations`](../system/sql-schema-shared.md#sport_type_field_configurations) (the canonical sport↔field-config link), [`sports_type_umpire_configs`](../system/sql-schema-shared.md#sports_type_umpire_configs) (umpire roles), and `game_position_configs` (positions, in [`sql-schema-event.md`](../system/sql-schema-event.md)). Cross-cutting lookup with no `associationId`/`eventId` scoping; identical for every caller, so cacheable.
- **Auth**: Standard session header.

### Path parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `sportsTypeId` | number | yes (id scope only) | Only for `GET /v2/sport-types/{sportsTypeId}`. The event's sport type id — surfaced on the MatchGeni access payload as `event.sportsTypeId` (see `matchgeni-access-api-contract.md` §1), which is where the Add/Edit Division form sources it. Omitted for the list scope. |

### Query parameters

None.

### Request body

None (GET).

### Response

`GET /v2/sport-types` — `data` is a **bare array** of sport types:

```json
{
  "data": [
    {
      "id": 1,
      "name": "Softball - Slow Pitch",
      "field_configuration_ids": "10,11",
      "field_configurations": [
        {
          "id": 10,
          "name": "Softball",
          "image": null,
          "positions": [
            { "id": 81, "position_name": "P", "position_number": 1, "x_axis": 50, "y_axis": 55, "status": 1 }
          ]
        }
      ],
      "umpire_configs": [
        { "id": 5, "code": "PLATE", "name": "Plate Umpire", "sort_order": 1, "status": 1 }
      ]
    }
  ],
  "message": "Sport types loaded successfully.",
  "statusCode": 200,
  "optional": ""
}
```

`GET /v2/sport-types/{sportsTypeId}` — `data` is a **single object** of the same shape (not wrapped in an array):

```json
{
  "data": {
    "id": 1,
    "name": "Softball - Slow Pitch",
    "field_configuration_ids": "10,11",
    "field_configurations": [ /* … as above … */ ],
    "umpire_configs": [ /* … as above … */ ]
  },
  "message": "Sport type loaded successfully.",
  "statusCode": 200,
  "optional": ""
}
```

> ⚠️ **RAW backend response is snake_case** (matching §5 / §6 conventions), and `data` is **bare** — an array for the list endpoint, a single object for the `/{id}` endpoint (not `{ data: { list: [...] } }` like §2–§4). The frontend client reads `payload.data` directly and maps onto the camelCase shape below.

### Sport-type entry

| Field | Type | Notes |
|---|---|---|
| `id` | number | Stable sport-type id (`team_sport_types.id`). The client stringifies it for option binding. |
| `name` | string | Display label (e.g. `"Softball - Slow Pitch"`). |
| `field_configuration_ids` | string \| null | **Legacy / informational** — the comma-separated id string from `team_sport_types.field_configuration_id` (e.g. `"10,11"`). The structured `field_configurations[]` array is **canonical**; treat this as a denormalized convenience only. |
| `field_configurations` | array | The field configurations this sport type supports (sourced from `sport_type_field_configurations`). See entry below. |
| `umpire_configs` | array | The sport type's umpire role configs, ordered by `sort_order`. See entry below. |

### `field_configurations[]` entry

| Field | Type | Notes |
|---|---|---|
| `id` | number | Field-config id — persisted on the consuming record (e.g. the division's `fieldConfigId`, `event.defaults.fieldConfigId`). Stringified for `<select>` binding. |
| `name` | string | Display label (e.g. `"Softball"`). |
| `image` | string \| null | Optional diagram image; unused by the division form. |
| `positions` | array | On-field position layout — `{ id, position_name, position_number, x_axis, y_axis, status }`, the **same shape as §5's `positions`** (see §5 for the per-column meaning). Used by the field-layout / lineup surfaces, not the division form (which only needs `{ id, name }`). |

### `umpire_configs[]` entry

`umpire_configs[]` is ordered ascending by `sort_order`.

| Field | Type | Notes |
|---|---|---|
| `id` | number | Umpire-config id (`sports_type_umpire_configs.id`). Stringified for option binding. |
| `code` | string | Stable role code (e.g. `"PLATE"`, `"BASE"`). |
| `name` | string | Display label (e.g. `"Plate Umpire"`). Mapped to `name`. |
| `sort_order` | number | Display order; the array is pre-sorted by this. Mapped to `sortOrder`. |
| `status` | number | Active flag (1 = active). |

### Caching

Static reference data — safe to cache for hours / the session. The list scope (`/v2/sport-types`) caches as a single page-lifetime entry; the id scope (`/v2/sport-types/{id}`) caches **per `sportsTypeId`** (one entry per sport, like §5 did). `Cache-Control: public, max-age=3600` is appropriate at the edge.

### Error handling (degrade, don't break)

| Code | When |
|---|---|
| `200` | Normal — `data` populated (array for list, object for id). |
| `200` (empty `data`) / transport error | The frontend client (`src/api/sportTypes.ts`) catches any failure and resolves to an **empty array** (`fetchSportTypes`) or **`null`** (`fetchSportType`) so the consuming form renders empty rather than erroring. |

### Frontend client (this repo)

`src/api/sportTypes.ts` — **mock-first** (like `src/api/mediums.ts`) until the endpoint ships; swap the mock for a `fetchEnvelope` call then, the signatures stay:

```ts
import type { SportType } from '../types'
// SportType            = { id: string; name: string; fieldConfigurations: FieldConfigurationOption[]; umpireConfigs: SportTypeUmpireConfig[] }
// SportTypeUmpireConfig = { id: string; code: string; name: string; sortOrder: number }
// FieldConfigurationOption = { id: string; name: string } (existing)

/** All sport types (Add/Edit Event). Resolves to [] on any error. */
export async function fetchSportTypes(): Promise<SportType[]>

/** One sport type by id (Add/Edit Division — sport type is fixed/inherited).
 *  Resolves to null on any error or missing id. */
export async function fetchSportType(
  sportsTypeId: number | null | undefined
): Promise<SportType | null>
```

`SportType` / `SportTypeUmpireConfig` are added to `src/types.ts`.

> **§5 re-point.** `src/api/fieldConfigurations.ts` (`fetchFieldConfigurations`) keeps its signature but is re-pointed to read `fieldConfigurations` off `fetchSportType(sportsTypeId)` so the Add/Edit Division form keeps working from the unified resource instead of the retired §5 path.

Consumers:
- **Add/Edit Event** — `fetchSportTypes()` (sport-type list + each sport's field configs + umpire configs in one call).
- **Add/Edit Division** — `fetchSportType(event.sportsTypeId)` (sport type fixed/inherited), via `fetchFieldConfigurations` for the Field Config step.

## 9. Custom Fields (moved)

> **Moved — see [`association-custom-fields-api-contract.md`](./association-custom-fields-api-contract.md).** Custom fields are **association-scoped CRUD** (definitions an admin authors per association from Settings → Custom Fields), not a global cross-cutting lookup, so they left this shared-services contract — same reasoning as ratings (former §4). The new contract covers the read (`GET …/custom-fields`) plus create / update / delete, the `CustomFieldDefinition` (camelCase, standard envelope), the DB-layer `entity_type` / `input_type` tinyint encodings, and the RESTRICT→retire delete rule.

(Section heading kept and **not renumbered** — earlier §1–§8 cross-references stay valid.)

## Implementation checklist

| Item | Where |
|---|---|
| `GET /v2/weather` route + per-date upstream resolution + normalization | Backend |
| Origin cache (Redis) keyed by `lat,lon,date,units` + `Cache-Control` headers | Backend |
| Cloudflare edge caching honoring the headers | Infra |
| `fetchWeatherForDates()` client + types | `src/api/weather.ts`, `src/types.ts` |
| Carry `latitude` / `longitude` onto `SchedulerPark` | `src/types.ts`, `src/api/matchGeniScheduler.ts` |
| Wire dashboard facility cards + scheduler strip to the client | `MatchGeniDashboardView.vue`, scheduler views |
| `GET /v2/sport-types` (+ `/{sportsTypeId}`) route — sport types with nested field configs (+ positions) + umpire configs | Backend |
| `fetchSportTypes()` / `fetchSportType()` client (mock-first) + `SportType` / `SportTypeUmpireConfig` types | `src/api/sportTypes.ts`, `src/types.ts` |
| Re-point `fetchFieldConfigurations` to read off `fetchSportType(id)` (retire §5 path) | `src/api/fieldConfigurations.ts` |
