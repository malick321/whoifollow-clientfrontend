# CLAUDE.md — Project Root

> **⚠️ THIS IS THE WORKING FORK (`whoifollow-newfrontend`).**
> It is a copy of `whoifollow-matchgenifrontend`, which remains the **read-only canonical
> reference/spec**. We build here and merge back into his repo later.
>
> **In-flight features (migrating from the legacy Vue 2 frontend):**
> 1. New Game Time  2. Calendar  3. Chat (socket.io, not Firebase)
>
> Rules unchanged from the reference repo below — especially: never invent UI, reuse existing
> components/styles, follow the `docs/api/` contracts, mirror file paths 1:1 for clean merge-back.
> See the workspace root `../CLAUDE.md` for the cross-repo picture.

## Project Overview
Team participation and scoresheet web app built with Vue 3 + Vite. Displays team event participation, game schedules, division standings, and a full scoresheet ledger with plate appearance editing.

## Tech Stack
- **Vue 3.4** with `<script setup>` SFCs (Composition API)
- **Vite 6** dev server (default port 5173) + `@vitejs/plugin-vue` 5
- **vue-tsc 2** for type-checking (`npm run type-check` / `vue-tsc --noEmit`)
- **Vue Router 4** for navigation
- **Pinia 2** for state management
- **TypeScript 5.4**
- Global styles in `src/styles.css` — no CSS framework, all custom

### Scoped-CSS note (Vue 3 SFC)
A child component's **root node** is affected by **both** the parent's scoped CSS and the child's own scoped CSS. So a wrapper class passed from a parent (e.g. `<MatchGeniParkPicker class="umpire-board__park-picker" />`) still styles the child's root. Shared components (like `MatchGeniParkPicker`) therefore leave width/responsive layout to the consuming screen's class and only own their internal styling.

## Key Files
| File | Purpose |
|------|---------|
| `src/views/ParticipationV2.vue` | Main team participation page (active route) |
| `src/views/TeamParticipationView.vue` | Legacy participation view (same data, kept in sync) |
| `src/views/ScoresheetView.vue` | Scoresheet ledger + plate appearance editor |
| `src/components/scoring-lib/ScoresheetGrid.vue` | Reusable scoresheet table with inning pager |
| `src/components/SummaryCard.vue` | Stat summary card used in participation summary grid |
| `src/styles.css` | All global CSS — single file, organized by component |
| `src/types.ts` | Shared TypeScript interfaces (`TeamParticipation`, `GameSummary`, etc.) |
| `src/api/adapters/participation.ts` | Maps raw API response to `TeamParticipation` type |
| `src/api/participationPage.ts` | API call entry points for participation data |

## Data Model — TeamParticipation
Key fields (defined in `src/types.ts`):
- `eventName` — tournament/event name (e.g. "Southwest Championship of Pakistan")
- `eventDate` — formatted date range string with timezone (e.g. "Tue, Apr 7, 2026 to Sun, Apr 12, 2026 (UTC-05:00) Eastern Time")
- `division` — division name (e.g. "Men's 40 Major+")
- `teamName`, `manager`, `games`, `lineup`, `divisionOverview`, `eventOverview`

## CRITICAL RULES — Never Do Without Explicit Permission
- **NEVER delete `main` or `staging`** (or any explicitly-designated reference branch), local or remote. A **merged** `feature/*` / `chore/*` / `fix/*` branch MAY be deleted once its PR merges — the commits live on in `staging` + the PR's merge commit, and GitHub's "Restore branch" recovers it if ever needed. **Never delete an unmerged branch** without explicit instruction (verify with `git branch -r --merged origin/staging`, cross-checked against merged PRs for squash-merges).
- **NEVER delete any file, folder, or data** of any kind without the user explicitly asking.
- **NEVER run destructive git commands** (branch -d, push --force, reset --hard, clean, etc.) without explicit instruction.
- **NEVER delete anything (code, files, data) without explicit permission.**
- **NEVER invent a NEW UI style/pattern.** The design system is FINALIZED — controls, buttons, badges, pills, tabs, toggles, cards, tooltips, modals, etc. already exist. ALWAYS reuse the existing finalized component/class. If a screen needs a pattern that doesn't exist yet, STOP and ask which existing style to use — do not create one.
- When in doubt, ask first.

## Branching Strategy
```
feature/xxx  →  staging  →  main
   (dev)        (QA/test)   (prod)
```
- **main** — production only, never commit directly
- **staging** — finalized features awaiting QA sign-off
- **feature/*** — one short-lived branch per area / coherent unit of work, branched off `staging`. **Deleted on merge** (GitHub auto-delete-on-merge enabled). Don't open a long-lived branch.
- After a feature PR merges to `staging`, rebase any *other* in-flight branches: `git fetch origin staging && git rebase origin/staging`
- **Fix QA issues forward**: a bug found in an `rc.N` build is fixed on a fresh branch off the latest `staging` (the merged code lives there), not by reviving the original feature branch. RCs are immutable tags = snapshots of `staging`.

## Active Branches
- `feature/scoresheet-ledger-fixes` — **merged** to staging (PR #8): scoresheet ledger + avatar CDN URLs + lineup modal overhaul
- `feature/role-gating-route-standardization` — **active**: admin-only edit controls + standardized scoresheet URL shape

## Session continuity notes
Role-based edit gating and route standardization in progress. Key decisions captured:
- Admin flag comes from `/v2/tournaments/team-participation/` → `TeamParticipation.isAdmin` (already adapted at `src/api/adapters/participation.ts:323`).
- Non-admins on participation: see everything as read-only, no 3-dot ellipsis on hero, admin 3-dot on each game card (gated with `v-if="participation.isAdmin"`).
- Non-admins on scoresheet (Game Details page): see the ledger fully, "Game Lineup" button hidden, Scoresheet Upload card hidden (with `.scoresheet-top-row--solo` collapsing the 2-column grid).
- Scoresheet route is now `/event/participation/:participationId/team/:teamId/game/:gameGuid` (legacy `/events/.../scoresheet` redirects via `src/router.ts`).
- `ScoresheetView.vue` fetches participation alongside scoresheet shell purely to source `isAdmin` + back-nav context.
- Menu positioning specificity trick: `.menu-panel.FOO-menu-panel { ... }` beats the base `.menu-panel { top: 38px }` rule regardless of source order.
- Sticky-header menu for participation is rendered as a sibling of `.condensed-team-header` (position: fixed, `top: 88px` in auth shell / `top: 176px` in unauth) because the sticky section uses `overflow: hidden` for its open/close animation and would clip a nested dropdown.

## Dev Server
```bash
npm run dev   # starts on port 5173 (fallback to 5174, 5175)
```
Keep the terminal open — Vite serves HMR. If changes don't reflect, clear cache: `rm -rf node_modules/.vite` then restart.

## CSS Conventions
- All styles in `src/styles.css` — find by class name with Grep
- Responsive breakpoints (mobile-first overrides):
  - `≤1280px` — tablet
  - `≤1080px` — compact
  - `≤840px` — narrow
  - `≤720px` — mobile
  - `≤520px` — small mobile
- Media queries must come **after** the base rule they override (same specificity = last wins)
- Use `min-width: 0` on grid/flex children to prevent overflow expansion
- Scoped styles live inside each `.vue` file's `<style>` block

## GitHub CLI
Installed at `C:/Program Files/GitHub CLI/gh`. Always use full path:
```bash
"/c/Program Files/GitHub CLI/gh" pr create --base staging ...
```
Authenticated with fine-grained PAT scoped to `A2-HL/whoifollow-matchgenifrontend` repo only.
