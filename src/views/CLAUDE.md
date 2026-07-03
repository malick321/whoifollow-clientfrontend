# CLAUDE.md — src/views

## Views Overview

### ParticipationV2.vue (PRIMARY)
The active team participation page served at `/event/participation/:teamParticipationId`.
- Scoped component ID: `data-v-9ca7f1b4`
- Condensed sticky header becomes visible after 140px scroll (`condensedHeaderVisible`)
- `condensedSubline` computed shows: `division - eventName - eventDate`
- Hero copy order: row 1 = `division - eventName`, row 2 = `eventDate`
- Summary grid: 5 `SummaryCard` components in `.summary-grid`
- Hero ellipsis + menu gated on `v-if="participation.isAdmin"`; menu label is "Event Lineup" (renamed from "Manage Lineup")
- Game card 3-dot admin-only (`v-if="participation.isAdmin"`), menu label "Game Lineup"
- Sticky header menu rendered as a **sibling** of `.condensed-team-header` (not inside) because the sticky section uses `overflow: hidden` — menu uses `position: fixed` + `.hero-menu-panel--sticky` class, `top: 88px` (auth) / `176px` (unauth)
- `lineupTeammates` computed prefers live `/chat/getTeamMembers` fetch over participation payload and self-derived fallback
- `EventLineupModal` + `GameLineupSubmissionModal` both receive `:is-admin="participation?.isAdmin ?? false"`

### TeamParticipationView.vue (LEGACY)
Older participation view at `/event/participation-legacy` — mirrors ParticipationV2 patterns; has its own inline game lineup modal (not the shared component).
- Same `isAdmin` gating + new link shapes as ParticipationV2.
- Hero ellipsis gated on `v-if="participation?.isAdmin"`, menu label "Event Lineup"
- Hero copy order: row 1 = `division - eventName`, row 2 = `eventDate`

### ScoresheetView.vue
Scoresheet ledger page. Served at `/event/participation/:participationId/team/:teamId/game/:gameGuid`. Key wiring:
- Reads `participationId`, `teamId`, `gameGuid` from `route.params` (new standardized route; legacy `/events/.../scoresheet` redirects in `src/router.ts`).
- Numeric `gameId` derived from the shell fetch result (`fetchScoresheetShell` → `mergeTournamentGameScoresIntoScoresheet` populates it).
- Fetches `TeamParticipation` in parallel with the scoresheet shell purely to source `isAdmin` and back-nav context. `isAdmin` stays `false` when the fetch fails (safe default).
- `isAdmin` drives:
  - `canEditScoresheet` computed → gates cell click → PlateAppearanceModal
  - "Game Lineup" buttons in sticky + hero (`v-if="hasSubmittedGameLineup && isAdmin"`)
  - "Submit Game Lineup" button inside the `ledger-lineup-required` banner (`v-if="isAdmin"`)
  - Scoresheet Upload card (`v-else-if="isAdmin"` so non-admins see nothing there)
  - `:is-admin` prop passed to `GameLineupSubmissionModal`
- `scoresheet-top-row` carries a `--solo` modifier when `!isAdmin` → CSS collapses the 2-col grid to single-col so the line-score panel stretches across the row.
- Hero card: Game Lineup button (top-right) + Team Manager card (bottom-right)
  - Uses `scoresheet-hero-status` with `justify-content: space-between`
- `ScoresheetGrid` usage — passes title via named slot `v-slot:title`
- Ledger panel: `panel--scoresheet-ledger`

### ScoresheetReviewView.vue
Served at `/event/participation/:participationId/team/:teamId/game/:gameGuid/review`.
- Reads `participationId`, `teamId`, `gameGuid` from `route.params`.
- Back-nav uses the standardized scoresheet route shape.

## Shared Layout Patterns
- `.content-grid` — main two-column layout (`2.2fr 0.9fr`)
- `.side-panel` — right column, stacked panels with `gap: 16px`
- `.hero` — full-width hero section at top of page
- `.condensed-team-header` — sticky header, hidden until scroll threshold
- `.scoresheet-top-row` — 2-col grid (line-score 1fr + upload 360px); add `--solo` modifier when upload card is absent.

## Menu positioning (lesson learned)
Always qualify dropdown positioning with dual-class specificity:
```css
.menu-panel.hero-menu-panel { top: 52px; right: 14px; }  /* (0,2,0) beats .menu-panel (0,1,0) */
```
Without this, the later-defined base `.menu-panel { top: 38px }` rule wins by source order and the dropdown overlaps the anchor button.

Sticky-header dropdowns: render as a SIBLING of the sticky section (not inside), use `position: fixed`, and align `right:` with the sticky header's `padding-right` so the menu's right edge lines up with the ellipsis button.
