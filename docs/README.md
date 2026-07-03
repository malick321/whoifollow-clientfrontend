# Docs Hub

Canonical home for every WhoIFollow `/v2` API contract and supporting reference. Frontend reads these to build, backend reads them to implement, and both sides update them when an API changes.

## Layout

```
docs/
├── README.md         this index
├── api/              every API contract + shared API conventions
│   ├── conventions.md
│   ├── api-schema-alignment-notes.md
│   ├── final-api-contracts.md
│   ├── association-users-api-contract.md
│   ├── team-participation-api-contract.md
│   ├── scoresheet-api-contract.md
│   └── game-lineup-submission-api-contract.md
└── system/           internal strategy + tooling docs (not yet shipped upstream)
```

## How to read these docs

- **On github.com** — open this folder in any browser. Markdown renders natively; every link in this index resolves.
- **In VS Code** — `git pull`, open any `.md` file, press `Ctrl+Shift+V` to toggle the rendered preview side-by-side. Internal links work.
- **No public hosting**. The repo is private; contracts are visible only to repo members.

## PR workflow

Contract changes are tracked in git like any other change:

1. Branch off `staging`, edit the contract, open a PR titled `docs: …` so reviewers know it's not code.
2. A reviewer from the *opposite* side (frontend if you're backend, and vice versa) signs off — this is the cheapest place to catch a contract drift.
3. Bump the file's `last_updated` frontmatter date and `status` if it changed (`Draft` → `Approved` → `Live`).
4. Merge.

Tiny fixes (typos, link rot) can use github.com's "Edit this file" pencil button — one-click PR, no terminal needed.

## Status legend

| Status | Meaning |
|---|---|
| `Draft` | Still being designed; shape may change. Don't implement yet. |
| `Approved` | Frontend + backend signed off on the shape. Safe to implement. |
| `Live` | Deployed to production; client code targets these endpoints. |
| `Deprecated` | Kept for reference; do not use for new work. |

## Reference

| Document | Purpose |
|---|---|
| [api/conventions.md](./api/conventions.md) | Shared rules every contract relies on — response envelope, pagination shape, auth header, error codes, permission-key encoding. **Read this first.** |
| [api/api-schema-alignment-notes.md](./api/api-schema-alignment-notes.md) | Notes on how API field names align with database column names + frontend types. |
| [api/final-api-contracts.md](./api/final-api-contracts.md) | Historical / cross-cutting contract notes. |

## Association

| Contract | Status | Last updated |
|---|---|---|
| [Users, Permissions & Invites](./api/association-users-api-contract.md) | Approved | 2026-05-08 |
| [Teams & Lifecycle](./api/association-teams-api-contract.md) | Draft | 2026-06-20 |
| Settings & Stripe Connect | Planned | — |
| Profile (cover / logo) | Planned | — |
| Registration, Fees & Payments | Planned | — |

## Events

| Contract | Status | Last updated |
|---|---|---|
| [Team Participation](./api/team-participation-api-contract.md) | Live | — |
| [Scoresheet Ledger](./api/scoresheet-api-contract.md) | Live | — |
| [Game Lineup Submission](./api/game-lineup-submission-api-contract.md) | Live | — |
| Divisions | Planned | — |
| Parks (venues) | Planned | — |
| Officials roster | Planned | — |
| [Participation Stations (check-in / attendance)](./api/matchgeni-participation-stations-api-contract.md) | Future (design only) | 2026-06-20 |

> "Planned" rows are placeholders for contracts coming soon. Replace with a real link + date when the file lands.

---

## Adding a new contract

1. Pick a filename: `api/<area>-<entity>-api-contract.md` (e.g. `api/association-teams-api-contract.md`).
2. Copy the structure from [`api/association-users-api-contract.md`](./api/association-users-api-contract.md) — frontmatter, Context, Storage decisions, Underlying tables, numbered endpoints, summary table, Out of scope.
3. Reference [`api/conventions.md`](./api/conventions.md) for shared rules instead of pasting them.
4. Add a row to the appropriate category table above. Status starts as `Draft`.
5. Open the PR; tag reviewers from both sides.

That's it. No infrastructure, no build step, no separate doc tool — just markdown that grows with the codebase.
