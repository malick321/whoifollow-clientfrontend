# CLAUDE.md — src/components/scoring-lib

## ScoresheetGrid.vue
Reusable scoresheet table component used in `ScoresheetView.vue`.

### Key Props
- `canEdit` — enables/disables editing interactions
- `inningWindowSize` — number of innings visible at once (1 = narrow mode)
- `showInningPager` — shows Previous/Innings X–Y of N/Next controls

### Slots
- `title` (named) — heading rendered in the grid header row next to the inning pager
  ```html
  <ScoresheetGrid>
    <template v-slot:title>
      <h2 class="scoresheet-ledger-title">Scoresheet Ledger</h2>
    </template>
  </ScoresheetGrid>
  ```

### Narrow Mode
When `inningWindowSize === 1`, the root div gets class `scoresheet-grid-root--narrow`.
This JS-driven class (not a media query) hides stat columns, unsticks player/inning headers,
and enables table-layout:fixed so the inning column always fits on screen.

**Why JS class instead of media query:** viewport width (`@media`) and element width
(`ResizeObserver`) diverge when panel padding shrinks the element below 600px on a wider
viewport. The JS class keeps CSS and JS in sync.

### Inning Pager
Lives entirely inside ScoresheetGrid — state is internal. Parent does NOT control pager position.
- `.scoresheet-grid-header` — flex row: title slot (left) + pager (right)
- At `≤599px`: header stacks to column, pager goes full-width with `justify-content: space-between`

### Stat Columns
- Values: center-aligned via `.sheet-td-stat { text-align: center }`
- Headers: center-aligned via `.sheet-th-stat { text-align: center }`
- Empty/zero values display `'-'` (handled in `playerStat` computed)

### Emits
- `open-appearance` — fired when user clicks a player row to open plate appearance editor
