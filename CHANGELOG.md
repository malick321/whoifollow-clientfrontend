# Changelog

All notable changes to this product are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this product adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Branch flow: `feature/* → staging (QA) → main (prod)`. Staging QA builds are
tagged as pre-releases (`vX.Y.Z-rc.N`); the final `vX.Y.Z` tag + GitHub Release
is cut on `main` when a version is promoted to production.

## [Unreleased]

_Changes landed on `staging` and awaiting the next version. Add new entries here._

## [2.0.0] - 2026-06-09

First versioned baseline of the v2 product (the Vue 3 rewrite; the legacy app was v1).
Pre-released for staging QA as `v2.0.0-rc.1`.

### Added
- **Game Scheduler** — resources-driven game list + field grid, breaks CRUD, bulk
  duration, bracket preview/pager. Source game cards: status badge beside the game
  name, team scores + winner/loser highlighting, inline **Un-schedule** (gated to
  not-started games), Field · Park meta, click-to-open game details drawer. Pool/
  bracket info banners with status dot + tooltip, team/game counts, tie-breaker.
- **Division detail** — shared Pool-Play list shell + interactive game cards,
  brackets rail, standings, winners, manage team pools, notify teams.
- **Brackets** — pure layout engine, single/double/3-game-guarantee renderer with
  zoom/pan canvas, status lifecycle (pending → initiated → in progress → completed
  → cancelled), cancel + announce-result gating.
- **Notifications** and **Discussions** pages (mock-first) on the shared Officials
  list surface — sticky header, filters (Channel single-select), full-bleed mobile.
- **Event navigation rail** layout hosting all MatchGeni sub-pages, with a mobile
  push-drawer.
- **Map Explorer** — in-map "Add Venue" flow (park + hotel) on live Google Places
  (Autocomplete + Place Details), `place_id` identity + dedup, fit-bounds on open.
- **Public event page** — read-only event/division/schedule view with registration,
  countdown, venue guide, sponsors, hotels.
- **Mock-first API clients + types** — scheduler, brackets, pools, standings,
  divisions, umpires, notifications, discussions, hotels, places, public event,
  field configurations, seeding criteria, age/rating catalogues.
- **Docs** — MatchGeni park / division / notifications / public-event / shared-
  services API contracts; `sql-schema.md` parks + tournament/bracket/pool tables;
  Event Resources §9 contract.

### Fixed
- Mobile sticky regression across MatchGeni pages — `.mg-shell` uses
  `overflow-x: clip` (not `hidden`) so sticky bars keep pinning at ≤840px.

[Unreleased]: https://github.com/A2-HL/whoifollow-matchgenifrontend/compare/v2.0.0...staging
[2.0.0]: https://github.com/A2-HL/whoifollow-matchgenifrontend/releases/tag/v2.0.0-rc.1
