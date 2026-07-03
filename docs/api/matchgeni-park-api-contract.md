---
status: Draft
owner: shared
last_updated: 2026-06-03
---

# MatchGeni Parks (Playing Facilities) — REST API contract

> **DRAFT — not yet implemented.** The frontend ships **mock-first**: the
> client + types below live in `src/api/matchGeniParks.ts` + `src/types.ts`
> and back the "Add Playing Facility" wizard
> (`src/components/MatchGeniFacilityFormModal.vue`) with in-memory data.
> The endpoints, payloads, `parks` / `park_fields` / facility-schedule
> **SQL schema, and the Google Maps integration are finalised jointly with
> the user** before any backend work. Treat everything here as a proposal
> to react to, not a settled contract.

## Context

Owns the **playing facilities** (parks) attached to a tournament event and
the multi-step "Add Facility" flow that creates / attaches them. A park is
a venue with one or more **fields**; an event selects which of a park's
fields are **in use** and a **per-day scheduling window** (which dates the
park is used + that day's start/end time). The same `Park` / `ParkFieldInUse`
/ `ParkScheduleEntry` shapes are already consumed read-side by the §9
event-resources endpoint (see
[`association-events-api-contract.md`](./association-events-api-contract.md))
and the MatchGeni scheduler / field-grid.

Powers:

- **Add Playing Facility wizard** (`MatchGeniFacilityFormModal.vue`),
  opened from the dashboard's "Playing Facilities" carousel header:
  1. **Playing Facility** — location autocomplete (Google Places) → pick a
     place → drop/adjust a pin → nearby-park check.
  2. **Fields In Use** — choose which of the park's fields are active.
  3. **Scheduling** — per-day window across the event date range.

All endpoints are rooted under
`/v2/association/events/{associationId}/{eventId}/facilities/...` (proposed).
For shared rules — response envelope, auth header, error codes — see
[`conventions.md`](./conventions.md). **Wire format is camelCase.** ID
literals below use prefixed stubs (`park_…`, `pf_…`, `place_…`) for doc
readability only; production serializes the bare `BIGINT UNSIGNED` PK as a
numeric string.

## Maps integration (to finalise)

- The location search is **Google Places Autocomplete**; on select, the
  frontend resolves coordinates (Place Details / Geocoding). The mock
  `searchPlaces(query)` returns Google-Places-shaped suggestions
  (`placeId` / `name` / `address` / `latitude` / `longitude`) so swapping
  in the real Places client is a drop-in — callers only see
  `PlaceSuggestion`.
- **Open question:** does the nearby-park dedupe (below) run client-side
  against an already-loaded park list, or server-side via a dedicated
  endpoint? The draft assumes **server-side** (the backend owns the park
  catalogue + the distance math + the radius constant).

## Scope decisions (proposed — confirm)

- **Nearby dedupe radius** = **200 m** (`NEARBY_RADIUS_M` in the client).
  On step-1 Next, the backend checks whether a park already exists within
  this radius of the picked coordinates. A hit → reuse that park (skip
  create); a miss → the frontend shows a "Create New Facility" popup that
  collects a **default field count** and creates the park.
- **Parks are association-scoped, attached to events.** A park created for
  one event can be matched (via the nearby check) and reused by another
  event in the same association.
- **Fields belong to the park**, not the event. The event selects a
  **subset** of the park's fields as "in use" + a per-day schedule; that
  selection is event-scoped.
- **Caller permission gate**: event-level `manage_scheduling` (or
  `manage_scoring`) on the caller's grant for this event, OR `fullControl`,
  OR association-level `manage_events`. Without any → `403`. (Confirm the
  exact key against the event-permission catalogue.)
- **Soft delete** for both parks and field rows, consistent with the rest
  of the v2 schema.

## Underlying tables (proposed — schema finalised jointly)

| Table | Purpose |
|---|---|
| `parks` | Venue row: `id`, `association_id`, `name`, `address`, `city`, `state`, `latitude` DECIMAL(10,7), `longitude` DECIMAL(10,7), `google_place_id` (nullable), `created_by` / `updated_by`, timestamps, `deleted_at`. |
| `park_fields` | A field within a park: `id`, `park_id` (FK), `name`, `sort_order`, timestamps, `deleted_at`. |
| `event_facility_fields` | Which park fields are **in use** for an event: `id`, `event_id` (FK `team_events`), `park_id` (FK), `park_field_id` (FK), `sort_order`. Unique per (`event_id`, `park_field_id`). |
| `event_facility_schedule` | Per-day window for a park at an event: `id`, `event_id` (FK), `park_id` (FK), `date` DATE, `start_time` TIME, `end_time` TIME. Unique per (`event_id`, `park_id`, `date`). |

> Distances use the haversine formula against `latitude` / `longitude`;
> a spatial index (or a bounding-box prefilter) is a backend concern.

---

## 1. Location autocomplete (search places)

- **Client**: `searchPlaces(query)` → `PlaceSuggestion[]`.
- **Real backing**: Google Places Autocomplete + Place Details, called
  **directly from the frontend** with a browser key, OR proxied through a
  backend endpoint `GET …/facilities/places?q={query}` (TBD — decide based
  on API-key exposure + billing controls).
- **Response shape** (`PlaceSuggestion`):

```json
{
  "placeId": "place_arbab_niaz",
  "name": "Arbab Niaz Cricket Stadium",
  "address": "University Rd, Peshawar, Khyber Pakhtunkhwa, Pakistan",
  "latitude": 34.0019,
  "longitude": 71.5571
}
```

## 2. Nearby-park check

- **Endpoint** (proposed): `GET /v2/association/events/{associationId}/{eventId}/facilities/nearby?lat={lat}&lng={lng}`
- **Client**: `checkNearbyPark(associationId, eventId, lat, lng)` →
  `NearbyParkResult` (`{ park: Park | null }`).
- **Purpose**: After the user drops the pin (step 1 → Next), determine
  whether a park already exists within `NEARBY_RADIUS_M` (200 m) of the
  coordinates. A hit returns the existing `Park` (with `fieldsInUse`) so
  the wizard skips create and pre-selects all fields; a miss returns
  `{ park: null }` → the "Create New Facility" popup.

## 3. Create park

- **Endpoint** (proposed): `POST /v2/association/events/{associationId}/{eventId}/facilities/parks`
- **Client**: `createPark(associationId, payload)` → `Park`.
- **Body** (`CreateParkPayload`):

```json
{
  "name": "Riverside Athletic Fields",
  "address": "88 Riverside Dr, Austin, TX, USA",
  "latitude": 30.2422,
  "longitude": -97.7431,
  "fieldCount": 4
}
```

- **Behaviour**: creates the `parks` row + `fieldCount` `park_fields`
  rows auto-named `Field 1…N`. Returns the `Park` with its
  `fieldsInUse[]`. The caller then refines the in-use selection in step 2.

## 4. Add a field to a park

- **Endpoint** (proposed): `POST /v2/association/events/{associationId}/{eventId}/facilities/parks/{parkId}/fields`
- **Client**: `addParkField(associationId, parkId, name)` → `ParkFieldInUse`.
- **Body**: `{ "name": "Show Court" }`. Appends a `park_fields` row;
  returns the created field. (The wizard adds it to the in-use set.)

## 5. Save event facility (attach park + fields + schedule)

- **Endpoint** (proposed): `PUT /v2/association/events/{associationId}/{eventId}/facilities`
- **Client**: `saveEventFacility(associationId, eventId, payload)` →
  `{ parkId }`.
- **Body** (`EventFacilityPayload`):

```json
{
  "parkId": "park_riverside",
  "fieldIds": ["pf_1", "pf_2", "pf_3"],
  "schedule": [
    { "date": "2026-04-07", "startTime": "08:00", "endTime": "20:00" },
    { "date": "2026-04-08", "startTime": "08:00", "endTime": "18:30" }
  ]
}
```

- **Behaviour**: replaces the event's `event_facility_fields` for this
  park with `fieldIds`, and its `event_facility_schedule` rows with the
  `schedule` entries (only days the admin marked **in use** are sent).
  Default per-day times come from the event's `eventStartTime` /
  `eventEndTime`, or **8:00 AM – 8:00 PM** when the event is all-day.
- The saved facility then flows back through the read-side §9
  event-resources endpoint as a `Park` with `fieldsInUse[]` + `schedule[]`.

---

## Frontend artifacts (mock today)

| Artifact | Location |
|---|---|
| Mock client (`searchPlaces`, `checkNearbyPark`, `createPark`, `addParkField`, `saveEventFacility`, `NEARBY_RADIUS_M`) | `src/api/matchGeniParks.ts` |
| Types (`PlaceSuggestion`, `NearbyParkResult`, `CreateParkPayload`, `FacilityScheduleDay`, `EventFacilityPayload`; reuses `Park` / `ParkFieldInUse` / `ParkScheduleEntry`) | `src/types.ts` |
| Wizard UI | `src/components/MatchGeniFacilityFormModal.vue` |
| Entry point | `MatchGeniDashboardView.vue` → `onAddFacility()` |

## To finalise jointly with the user

- [ ] `parks` / `park_fields` / `event_facility_fields` /
      `event_facility_schedule` SQL in
      [`sql-schema.md`](../system/sql-schema.md).
- [ ] Google Maps: direct-from-browser vs backend-proxied Places; API-key
      handling + billing guardrails.
- [ ] Nearby check: server-side endpoint (assumed) vs client-side against a
      preloaded park list; confirm the 200 m radius.
- [ ] Exact caller permission key (`manage_scheduling` vs `manage_scoring`).
- [ ] Whether step-5 is a single `PUT` (replace) or separate field /
      schedule sub-resources.
