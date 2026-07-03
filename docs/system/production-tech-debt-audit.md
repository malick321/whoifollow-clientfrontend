---
status: Approved
owner: shared
last_updated: 2026-05-08
---

# Production Tech-Debt Audit

Inventory of dependencies and toolchain choices in the production project (`whoifollow-matchgenifrontend`) that need attention. Each item carries a severity, a recommended replacement, and a rough effort estimate. The "Sequencing" section at the end proposes a 6–12 month order to address them — low-priority backlog work, run alongside feature delivery.

This audit is the menu of cleanups that downports can opportunistically apply (per [`development-strategy.md`](./development-strategy.md)) plus a list of items that need dedicated PRs.

## How to use this doc

- Each item has a `Status` column. Default `Open`. Bump to `In Progress` when a PR opens, `Done` when merged. Update via the same PR that closes it (one-line edit, easy review).
- Severity legend: **Critical** → fix this quarter; **High** → abandonware / no upgrade path; **Medium** → outdated but functional; **Low** → flagged but not actionable today.

## Critical

Security exposure or end-of-life risk. Schedule for the current quarter.

| Item | Why it matters | Recommended action | Effort | Status |
|---|---|---|---|---|
| Node 14.21.3 | EOL April 2023; CVEs accumulating; many transitive deps will start dropping support; CI / Volta config needs bump | Bump Volta pin to Node 20 LTS (`volta pin node@20`); rerun build + lint + tests; bump CI runner image | ~1 day | Open |
| `axios` 0.19 | Multiple CVEs since 2020 (CVE-2020-28168, CVE-2021-3749, CVE-2023-45857, others) | Upgrade to `axios` 1.x — minor breaking changes in error handling and interceptor signatures; smoke-test all API call sites | ~1–2 days | Open |
| `aws-sdk` v2 | AWS deprecated v2 — entered maintenance mode September 2024, full deprecation announced for late 2025 | Migrate to `@aws-sdk/client-*` v3 modular SDKs. Scope per-service: only the services the app actually uses (S3 most likely, possibly SES, SNS). Modular = smaller bundles | ~3–5 days | Open |

## High

Abandonware or no clear upgrade path. Plan, don't execute today; freeze new usage.

| Item | Why it matters | Recommended action | Effort | Status |
|---|---|---|---|---|
| `bootstrap-vue` 2.22 | Last release April 2022; project effectively dead; no Vue 3 path | Plan: BootstrapVueNext is the eventual successor (Vue 3 only). Don't migrate today. **Freeze new BV usage in net-new code** — downport features use BV components only when needed for visual parity, prefer raw HTML for fresh chrome | Migration: 1+ month (couples to Vue 3) | Open |
| `vue-cli-service` 4.5 | Vue team officially deprecated in favor of Vite (since 2022); maintenance only | Migrate to Vite + `@vitejs/plugin-vue2` (works for Vue 2.7). Big DX win: HMR is night-and-day faster | ~1–2 weeks build-config rewrite | Open |
| `jquery` 3.6 + `jquery-ui` 1.13 | Legacy DOM lib; security surface; ~150 KB gzipped weight; competes with Vue's reactivity model | Audit each `$()` call; replace with native DOM / Vue refs / composition. **Remove from new code immediately** — downports never introduce jQuery | Per call-site; ~2–4 weeks for full removal | Open |

## Medium — redundant duplicates (pick one)

The production project has multiple libraries doing the same job. Pick one per group and remove the rest. Each removal is a small dedicated PR.

| Group | Currently installed | Recommended pick | Reason | Status |
|---|---|---|---|---|
| **Croppers** | `vue-cropperjs`, `vue-cropper`, `vue-advanced-cropper`, `vue-jcrop`, `vuejs-clipper` | `vue-advanced-cropper` | Most actively maintained; richest API; matches what the prototype's `ImageEditorModal` uses | Open |
| **Multiselect** | `vue-multiselect`, `vue-select`, `v-select2-component`, `vue-select2` | `vue-multiselect` | Most popular; long maintenance history; matches Bootstrap-Vue's idioms | Open |
| **Validation** | `vuelidate` 0.7 + `@vuelidate/core` 2-alpha | `vuelidate` 0.7 | Already widely used; v2-alpha is unstable. Revisit when v2 reaches stable | Open |
| **Firebase** | `@firebase/database` + `firebase` 9 | `firebase` 9 (modular SDK) | The standalone `@firebase/database` is a transitive that's now also a direct dep — drop the direct | Open |
| **Google Maps** | `vue2-google-maps`, `google-maps-api-loader`, `vue-google-autocomplete` | `vue2-google-maps` (kept) + native `google.maps.places` | Drop the loader — `vue2-google-maps` includes its own loader | Open |
| **PDF** | `vue-html2pdf` + `jspdf` | `jspdf` (assess) | Audit which PDF flows use which lib; consolidate. `vue-html2pdf` may be redundant | Open |

Each "pick one" PR: ~1–3 days depending on call-site count.

## Medium — outdated but functional

Not breaking anything today, but worth scheduling.

| Item | Current | Suggested | Notes | Status |
|---|---|---|---|---|
| `moment` + `moment-timezone` | 2.30 + 0.5.37 | `dayjs` (smaller, similar API) | Moment is in maintenance mode — official recommendation is migration. ~150 KB savings. Big surface area; staged rollout PR-by-PR | Open |
| `eslint` | 6.7 | 9.x | Many rule renames; depends on plugin upgrades. Bump after Vite migration to consolidate config rewrite | Open |
| `prettier` | 1.19 | 3.x | Style changes minor; one-shot reformat PR after the bump | Open |
| `sass` | 1.58 | latest | Trivial bump; verify no `@import` deprecation warnings | Open |
| `core-js` | 3.25 | 3.x latest | Trivial bump; track polyfill correctness | Open |

## Low — flagged but not actionable today

Listed for transparency; revisit when surrounding work unblocks them.

| Item | Why flagged | Status |
|---|---|---|
| `vue` 2.7.14 + `@vue/composition-api` 1.7 | Vue 2.7 ships composition API natively; the plugin is redundant. Drop after verifying no plugin-specific hooks are used in legacy code | Open |
| `vuex` 3.6 | Will need replacement (Pinia) when Vue 3 lands. Not urgent | Open |
| `socket.io-client` 4.8 | Current; flagged only because the package.json line `"[socket.io](http://socket.io)-client"` looks hand-edited / malformed — sanity check the entry name | Open |
| `bootstrap` 4.6 | EOL January 2023 — but the BootstrapVue dependency pins it; can't bump without Vue 3 migration | Open |
| `vue-full-calendar` 2.8 + `@fullcalendar/vue` 5.11 + `@fullcalendar/vue3` 5.11 | Three calendar adapters installed for Vue 2 + Vue 3. Verify all three are actually used; drop unused | Open |
| `vue-html2pdf`, `page-flip`, `vue-jcrop`, `emojionearea`, `favico.js-slevomat`, `mutationobserver-shim` | Long-tail dependencies that look like they might serve specific past features. Audit usage; remove dead | Open |
| `volta` Node pin | Node version is locked via Volta — confirm Volta is the team's chosen tool (vs `nvm` / `fnm` / `mise`); document in README | Open |

## Suggested 6–12 month sequencing

Each step is ~1–3 PRs. Run as low-priority background work alongside feature delivery.

```
Month 1     ├── Node 14 → 20 (Volta pin + CI runners)
            ├── axios 0.19 → 1.x
            ├── Drop redundant croppers (pick one)
            └── Drop redundant multiselects (pick one)

Month 2-3   ├── Vite migration (replaces vue-cli-service)
            ├── ESLint 9 + Prettier 3 reformat
            └── Drop redundant validators / Firebase / Google Maps loader

Month 4-5   ├── AWS SDK v2 → v3 (per-service)
            └── Drop dead long-tail deps (audit + delete)

Month 6-7   └── Moment → Day.js migration (call-site by call-site)

Month 8-9   └── jQuery removal pass (component by component)

Month 10-12 └── Plan Vue 3 migration (BootstrapVueNext, Pinia, drop @vue/composition-api).
                NOT executed in this window — schedule as a dedicated quarter.
```

## When does this audit close?

Closure isn't "every row marked `Done`." It's "production is healthy enough that the strategic question shifts from cleanup to migration."

Practically: when we hit the Month 10–12 step (Vue 3 migration planning), the production project's modern foundation is in place and the prototype can start replacing it wholesale — at which point this audit's job is done.
