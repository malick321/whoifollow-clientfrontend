# CLAUDE.md — Feature Contexts

## feature/scoresheet-plate-appearance (merged → staging)
Scoresheet UI improvements across `ScoresheetView.vue`, `ScoresheetGrid.vue`, `styles.css`.

**Changes shipped:**
- Sticky team name column in linescore (responsive) — `left: -16px` accounts for card's 16px padding; `margin-right: -10px` covers grid gap
- Manage Lineup button moved to hero card (top-right, `justify-content: space-between`) and sticky header
- Inning pager moved inside ScoresheetGrid as internal state; title passed via named slot
- Pager stacks below title at ≤599px with full-width `space-between` layout
- Started + Time Limit cards stay side-by-side on mobile (removed `grid-template-columns: 1fr` override)
- Stat column headers + values center-aligned
- Empty stat values show `'-'`
- Manager label → "Team Manager"
- Condensed sticky header: Team Manager info left, Manage Lineup button right, button height 36px fixed

---

## feature/team-participation-division-overview (merged → staging, PR #3 open)
Division overview card fixes + hero copy reorder + v2 API migration in `ParticipationV2.vue`.

**Changes shipped:**
- Division overview card contained within grid (`.side-panel .panel { overflow: hidden; min-width: 0 }`)
- Team name ellipsis in division standings (`.division-standings__copy { overflow: hidden }`)
- Removed horizontal scrollbar from division standings (dropped `overflow-x: auto` + `min-width: 420px`; tightened columns to 28px + gap 6px)
- Summary grid 2 columns on mobile (≤720px) with Statistics card spanning full width via `nth-child(odd)` selector
- Hero copy: row 1 = `division - eventName`, row 2 = `eventDate` (fixed in both `ParticipationV2.vue` and `TeamParticipationView.vue`)
- Condensed sticky header subline: `division - eventName - eventDate`
- v2 participation endpoint: `/v2/tournaments/team-participation/:id`, URL simplified to `/event/participation/:teamParticipationId`
- All team_id/event_id/tournament_id/tournament_guid derived from API response
- `tournamentGames` adapter updated: team name/avatar from `game_scores[].team`, `filtered_team_side` drives H/V logic, `lineup_submitted` and `player_stats_available` mapped to badges
- `getTournamentGames` sends `team_id` to scope server-side
- Game card badges: "Lineup submitted/pending", "Scoresheet available/not started"

---

## feature/team-event-lineup (active)
Bug fixes and enhancements for the team event lineup feature.
