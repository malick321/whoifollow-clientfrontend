---
status: Draft
owner: matchgeni
last_updated: 2026-06-04
---

# Public Event Page — REST API contract (DRAFT)

## Context

A **public, unauthenticated** event showcase served at `<domain>/public/event/<event-slug>`. It renders, read-only: the event identity (name, dates, association, tournament type), the event's **divisions** (each with its brackets, team pools/standings, and pool-play schedule), a **registration / countdown** panel, an **event-details** summary, and optional **sponsors / hotels**.

The whole page is a **single cacheable GET** keyed by the event's public **slug** — no auth, no per-row joins on the request path (the backend materialises a read model). The frontend ships against this mock-first (`src/api/publicEvent.ts`, `PUBLIC_EVENT_ENDPOINT_LIVE = false`); display shapes live in `src/types.ts` (`PublicEventPage` + children).

> **DRAFT — finalize jointly.** Endpoint shape, slug resolution, and the read-model assembly are not locked. The page is intentionally decoupled from the authenticated MatchGeni payloads so it can be served (and cached) to anonymous traffic.

For shared rules — response envelope, error codes — see [`conventions.md`](./conventions.md). Wire fields are **camelCase**.

### Related contracts
- [`matchgeni-division-api-contract.md`](./matchgeni-division-api-contract.md) — the authed division surface this page mirrors read-only (brackets / standings).
- [`association-events-api-contract.md`](./association-events-api-contract.md) — event identity + the `slug` source.

## 1. Get public event page
- **Endpoint**: `GET /v2/public/events/{slug}`
- **Auth**: **none** (public). Cache-friendly (e.g. short CDN TTL); no PII beyond what's already public (director contact is event-published).
- **Path params**: `slug` — the event's public slug.
- **Returns** `PublicEventPage`:

```jsonc
{
  "slug": "southwest-championship-2026",
  "eventName": "Southwest Championship of Pakistan",
  "associationName": "SSUSA",
  "tournamentType": "Softball (Slow Pitch) Tournament",
  "dateRangeLabel": "Tue, Apr 7 – Sun, Apr 12, 2026",
  "location": "Carson City, NV",
  "registration": {
    "open": true,
    "deadline": "2026-04-12T23:59:00Z",   // ISO — drives the live countdown
    "deadlineLabel": "Friday, April 12, 2026 at 11:59PM Central Time",
    "feeLabel": "$500",
    "spotsLeft": 12,
    "registerUrl": "https://whoifollow.tech/register/..."
  },
  "details": {
    "followersLabel": "3.3K people following",
    "sportType": "SSUSA - Softball (Slow Pitch) Tournament",
    "directorName": "Tom Whitesides",
    "directorPhone": "+1 (908) 132-4567",
    "directorEmail": "info@user.com",
    "entryFeeLabel": "$500",
    "entryDeadlineLabel": "Fri, Apr 14, 2026",
    "umpires": ["Jerry Smith", "Bret Pavlicek"],
    "timeLimit": "RR = 65 + open inn, Bracket = 70 + open inn, Championship = 80 + open inn",
    "seedCriteria": "Head to Head, W/L, Runs Differential",
    "format": "3 games Round Robin to seed, Double Elimination bracket.",
    "description": "Longer blurb revealed by 'See more'."
  },
  "divisions": [
    {
      "id": "pub_div_0",
      "name": "Men's 40 Major+",
      "dateRangeLabel": "Apr 8 – Apr 10, 2026",
      "teamCount": 8,
      "brackets": [
        { "id": "bk_0", "name": "Gold Bracket", "format": "Double Elimination", "status": "in_progress", "teamCount": 8 }
      ],
      "pools": [
        { "id": "pa", "name": "Pool A", "teams": [
          { "teamName": "#1 Dallas Hawks", "teamMeta": "Men's 50+ AA", "location": "Dallas, TX", "seed": 1, "wins": 3, "losses": 1 }
        ] }
      ],
      "games": [
        { "id": "g0", "label": "Pool 1", "team1": "#1 Dallas Hawks", "team2": "#2 Austin Bandits",
          "date": "2026-04-08", "time": "09:00 AM", "field": "Field 1", "park": "Centennial Park",
          "status": "final", "team1Score": 7, "team2Score": 4 }
      ]
    }
  ],
  "sponsors": [ { "id": "1", "name": "Nike", "websiteUrl": "...", "imageUrl": "..." } ],
  "hotels":   [ { "id": "1", "name": "Marriott Downtown", "address": "...", "distanceLabel": "0.6 mi", "position": { "lat": 39.16, "lng": -119.77 }, "bookingUrl": null } ],
  "parks":    [ { "id": "1", "name": "Centennial Park", "location": "Carson City, NV", "position": { "lat": 39.16, "lng": -119.77 } } ]
}
```

- `registration.deadline` is the source of truth for the countdown; `deadlineLabel` is the pre-formatted human line. `open: false` (or a past deadline) renders the closed state.
- `divisions[].brackets[].status` uses the bracket-state palette (`pending`/`initiated`/`in_progress`/`completed`/`cancelled` — see `src/lib/bracketStatus.ts`).
- Read-only: no admin/write fields are exposed.
- `parks[]` / `hotels[].position` carry `{ lat, lng }` for the **Map Explorer** pins (full-screen modal opened from the Venue Guide). Pins without a position are listed but not mapped. Per-pin enrichment (address / phone / rating / photos) is fetched client-side from Google Places (or a future `GET …/place-details`); see `src/api/placeDetails.ts` (mock-first) + `src/lib/googleMaps.ts` (loader, `VITE_GOOGLE_MAPS_API_KEY`). Without a Maps key the explorer falls back to the keyless map iframe + venue lists.

## Notes / read model
- Slug → event resolution must not leak existence of unpublished/cancelled events (404 for non-public).
- The page composes the same underlying data as the authed division surface (brackets / `event_tournament_standings` / `tournament_games`) but flattened into the display shapes above; the backend should assemble a cached read model rather than fan out per request.

> Frontend: client `fetchPublicEventBySlug` (`src/api/publicEvent.ts`, mock); types `PublicEventPage` / `PublicDivision` / `PublicEventRegistration` / `PublicEventDetails` (`src/types.ts`). UI: `src/views/PublicEventView.vue` + `src/components/public/*` (`PublicEventHeader`, `PublicDivisionList`, `PublicDivisionPanel`, `PublicEventRegisterCard`, `PublicEventDetailsCard`); countdown via `src/lib/useCountdown.ts`. Route `/public/event/:eventSlug` (`meta.public`, guard-exempt) in `src/router.ts`.

## Deferred
- Real slug minting + canonical public URLs; CDN caching strategy; live registration flow (the Register CTA currently points at the parent-site registration URL); follower count source; localization of the date/deadline labels.
