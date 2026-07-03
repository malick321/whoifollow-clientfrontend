---
status: Approved
owner: shared
last_updated: 2026-05-08
---

# Development Strategy — Dual Codebase

## TL;DR

The team operates two Vue codebases:

- **Prototype** — Vue 2.7 + Vite + TypeScript. **Source of truth.** Every feature, requirement, use case, API contract, and test case is specified here first.
- **Production** — Vue 2.7 + vue-cli-service + JavaScript + Bootstrap-Vue. **Customer deploy target.** Mirrors the prototype's behavior; downported feature-by-feature.

When a feature is final in the prototype, a paired **downport PR** translates it for production. The downport is a hard requirement, not a nice-to-have. Over time the prototype becomes the migration target the production project replaces wholesale.

The two sides talk via the API contracts in [`docs/api/`](../api/). That's the only shared contract.

## Why this strategy exists

The production codebase has accumulated a long tail of legacy and redundant dependencies (see [`production-tech-debt-audit.md`](./production-tech-debt-audit.md)). Modernizing it in-place would halt feature delivery for months. Building net-new features in a clean prototype lets us:

- Ship features now with modern DX (Vite HMR, TypeScript safety).
- Pay tech-debt incrementally — each downport is also an opportunity to drop a redundant lib.
- Specify use cases and test cases against a single canonical implementation everyone references.
- Eventually replace production wholesale instead of doing a years-long incremental rewrite.

If we drop the downport requirement, the prototype turns into a parallel universe nobody ships. That's the failure mode this strategy exists to prevent.

## Source-of-truth structure

```
src/                    Canonical Vue + TS + Vite implementation
docs/                   API contracts, conventions, this strategy doc, audit
docs/use-cases/         (future) one md per feature, product-readable
docs/test-cases/        (future) acceptance test scripts QA runs pre-release
dist/legacy/            Downported mirror — what production copies in
```

The whole team — engineering, product, design, QA — references the prototype. Production engineers read it when building the downport. Designers reference live components, not screenshots. QA references the use-case docs and runs against either side.

## The downport mechanics

### Layout convention

Every feature finalized in the prototype gets a mirror under `dist/legacy/`:

```
src/views/AssociationUsersView.vue              (Vue 2.7 + TS + raw HTML)
dist/legacy/views/AssociationUsersView.vue      (Vue 2.7 + JS + Bootstrap-Vue)

src/api/associationUsers.ts                     (mock layer, TS)
dist/legacy/api/associationUsers.js             (axios, JS, hits real /v2/...)
```

Files map 1:1 by relative path so diffs between the two stay meaningful. The `dist/legacy/` tree is checked into git, so PR review covers both sides simultaneously.

The production team's integration step is a copy: paste `dist/legacy/<feature>/` files into their `src/` at the matching paths.

### Per-file downport checklist

Run this checklist on every file translated from `src/` → `dist/legacy/`:

| Concern | Modern (this repo) | Legacy (production) |
|---|---|---|
| Script lang | `<script setup lang="ts">` | `<script>` with `export default { setup() { ... } }` |
| TS types | Inline + `src/types.ts` | Stripped; preserve as JSDoc `@param` / `@returns` where the type adds clarity |
| Build-only imports | `import { x } from 'foo?raw'`, `import.meta.hot` | Removed or replaced (vue-cli supports neither natively) |
| Composition API | Native (Vue 2.7 has it built in; future Vue 3 has it native too) | `@vue/composition-api` plugin (production-installed) |
| State | local refs / future Pinia | Vuex 3 module if cross-component |
| HTTP | Mock layer in `src/api/*.ts` | `axios` calls hitting the same `/v2/...` URLs |
| UI primitives | Custom HTML + `src/styles.css` | Bootstrap-Vue components where they have a 1:1 equivalent (`b-modal`, `b-form-input`, `b-button`, `b-badge`, `b-form-select`, `b-form-checkbox`); fall back to raw HTML where Bootstrap-Vue lacks the right shape |
| Date library | `Intl.DateTimeFormat` / native `Date` | `moment` + `moment-timezone` (production-installed; the audit plans the eventual migration) |
| Form validation | None / inline | `vuelidate` 0.7 (production-installed; do NOT introduce `@vuelidate/core` v2-alpha) |
| Teleport / portals | Vue 3 native `<Teleport>` (when prototype migrates) — today: native portal-less | `<portal-vue>` (production-installed) |
| Async components | `defineAsyncComponent(() => import(...))` (Vue 3) | `() => import(...)` lazy syntax (Vue 2.7) |

### Tooling

- **TS-strip helper** (`scripts/downport-strip-types.js`, future) — runs `@babel/plugin-transform-typescript` over a `.ts` file or `<script lang="ts">` block. Handles ~90% of the strip; remaining 10% (e.g. `as const` casts, complex generics) needs manual review.
- **HTTP adapter** (`dist/legacy/api/_http.js`) — thin `axios` wrapper that mirrors the mock-layer return shape (`Promise<LaravelPaginator<T>>`, error envelope on rejection). Each downported `api/*.js` imports from `_http.js` instead of the mock.
- **No build step for `dist/legacy/`** — these files are vanilla source the production project consumes as-is. They never run inside this prototype.

### Per-feature downport PR template

When marking a feature "final" in the prototype:

1. Branch off `staging` in this repo: `downport/<feature-name>`.
2. Create the `dist/legacy/<feature-name>/` subtree by walking the modern tree and producing one downported file per source.
3. Run the manual checklist on each file.
4. Smoke-test by pasting `dist/legacy/<feature>/` into a local checkout of the production repo and verifying the page renders + hits the API correctly.
5. Open the downport PR with title `chore: downport <feature-name> for production` and a body listing the modern PR it tracks plus a per-file checklist.
6. Backend team and frontend prototype team both review.
7. Production engineers cherry-pick / copy from `dist/legacy/` into the production repo's `src/` once the downport PR merges.

### Bug-fix flow

Bugs found in either codebase land **first in the prototype** (since it's the source of truth), then get re-translated for production via the same downport process. This avoids divergent fixes.

The exception: customer-impacting hotfixes for production may patch production directly under time pressure — but a tracking issue is opened immediately to bring the same fix into the prototype, and the prototype version becomes canonical going forward.

## Future migration: Prototype → Vue 3

The prototype is currently held at Vue 2.7 to match production's framework. Once the dual-codebase strategy is validated (first downport landed end-to-end), the prototype itself migrates to Vue 3 + latest tooling. After that point the downport's translation table grows by a row or two, but the prototype gets:

- Native `<script setup>` (no Vue 2.7 quirks)
- `<Teleport>` (drops `portal-vue` from the prototype)
- Fragments / multi-root templates (drops the wrapping `<div>` we use today)
- Better TypeScript inference
- A maintained Vue runtime (Vue 2.7 hit end-of-maintenance Dec 2023)

Target stack post-migration:

- Vue 3.5+
- Vite 6+
- vue-router 4
- Pinia 2 (when cross-component state appears)
- `@vueuse/core` for common composition hooks
- Vitest + @vue/test-utils 2

Effort: ~1–2 weeks for one engineer. Performed as a dedicated PR series, not piggybacked on a feature.

## Production modernization track

Runs in parallel with feature work, low priority, sequenced per [`production-tech-debt-audit.md`](./production-tech-debt-audit.md). The audit has its own 6–12 month roadmap that ends with production being modern enough to be retired in favor of the prototype.

The downport-as-cleanup-opportunity rule means the production deps tree gets healthier passively as features port over (each downport drops one redundant cropper / multiselect / validator / etc.). The audit captures the rest — the items that need their own dedicated PR.

## When this strategy ends

Once the prototype's feature surface covers everything customers use today, we cut over: production's repo is replaced with the prototype's. The downport stops being needed. The prototype becomes the production codebase.

That cutover is a separate planning exercise — out of scope until we're ~80% feature-parity. For now, every feature ships in both forms.
