<script setup lang="ts">
// NewGameTimeLayout
// -----------------
// Shell for the public "New Game Time" surface. Built AS the colleague's
// `.association-users` app-shell grid (fixed sidebar col + centered main col)
// so it inherits his exact typography (incl. the portal-wide "no bold, cap at
// font-weight 500" rule), his sidebar visuals, and his `max-width: 1024px;
// margin: 0 auto` main column — i.e. content centered with right-side space.
//
// The left rail reuses his `.association-users__sidebar` / `__nav` /
// `__nav-item` / `__nav-icon` classes verbatim (no invented UI). Each tab is
// a child route whose root is `.association-users__main` (lands in grid
// column 2). Replaces the legacy `LeftMenuSide.vue` + `$root` event bus.
//
// Only "Events › Discover" is built; other sub-tabs show a "Soon" marker
// (not links) so there are no dead routes — add each as a real child route +
// drop its `soon` flag as it's built.

import { computed } from 'vue'
import { useRoute } from 'vue-router'

interface SubTab {
  label: string
  routeName?: string
  soon?: boolean
}
interface Section {
  key: string
  label: string
  icon: 'calendar' | 'teams' | 'association'
  defaultRouteName: string
  subs: SubTab[]
}

const route = useRoute()

const SECTIONS: Section[] = [
  {
    key: 'events',
    label: 'Events',
    icon: 'calendar',
    defaultRouteName: 'newgametime-discover-events',
    subs: [
      { label: 'Discover', routeName: 'newgametime-discover-events' },
      { label: 'My Events', routeName: 'newgametime-my-events' },
      { label: 'Following', routeName: 'newgametime-following-events' }
    ]
  },
  {
    key: 'teams',
    label: 'Teams',
    icon: 'teams',
    defaultRouteName: 'newgametime-discover-teams',
    subs: [
      { label: 'Discover', routeName: 'newgametime-discover-teams' },
      { label: 'My Teams', routeName: 'newgametime-my-teams' },
      { label: 'Following', routeName: 'newgametime-following-teams' }
    ]
  },
  {
    key: 'associations',
    label: 'Associations',
    icon: 'association',
    defaultRouteName: 'newgametime-discover-associations',
    subs: [
      { label: 'Discover', routeName: 'newgametime-discover-associations' },
      { label: 'Following', routeName: 'newgametime-following-associations' }
    ]
  }
]

const activeSectionKey = computed(() => {
  const name = String(route.name ?? '')
  if (name.includes('teams')) return 'teams'
  if (name.includes('associations')) return 'associations'
  if (name.includes('events')) return 'events'
  return ''
})
</script>

<template>
  <div class="ngt-shell">
    <aside class="ngt-rail">
      <div class="ngt-rail-title">New Game Time</div>
      <nav class="ngt-nav" aria-label="New Game Time sections">
        <!-- For You — the personalized landing feed (top of the rail). -->
        <router-link
          v-slot="{ navigate, href, isActive }"
          :to="{ name: 'newgametime-for-you' }"
          custom
        >
          <a
            :href="href"
            class="association-users__nav-item ngt-foryou-item"
            :class="isActive ? 'association-users__nav-item--active' : 'association-users__nav-item--inactive'"
            @click="navigate"
          >
            <span class="association-users__nav-icon ngt-icon--foryou" aria-hidden="true"></span>
            <span>For You</span>
          </a>
        </router-link>
        <template v-for="section in SECTIONS" :key="section.key">
          <!-- Section header doubles as a mobile-friendly entry point. -->
          <router-link
            v-slot="{ navigate, href }"
            :to="{ name: section.defaultRouteName }"
            custom
          >
            <a
              :href="href"
              class="association-users__nav-item ngt-section-head"
              :class="activeSectionKey === section.key ? 'association-users__nav-item--active' : 'association-users__nav-item--inactive'"
              @click="navigate"
            >
              <span
                class="association-users__nav-icon"
                :class="`ngt-icon--${section.icon}`"
                aria-hidden="true"
              ></span>
              <span>{{ section.label }}</span>
            </a>
          </router-link>
          <template v-for="sub in section.subs" :key="sub.label">
            <router-link
              v-if="sub.routeName"
              v-slot="{ navigate, href, isActive }"
              :to="{ name: sub.routeName }"
              custom
            >
              <a
                :href="href"
                class="association-users__nav-item ngt-subitem"
                :class="[
                  isActive ? 'association-users__nav-item--active' : 'association-users__nav-item--inactive',
                  activeSectionKey === section.key ? 'ngt-subitem--current-section' : 'ngt-subitem--other-section'
                ]"
                @click="navigate"
              >
                <span>{{ sub.label }}</span>
              </a>
            </router-link>
            <span
              v-else
              class="association-users__nav-item association-users__nav-item--inactive ngt-subitem ngt-subitem--soon"
              aria-disabled="true"
            >
              <span>{{ sub.label }}</span>
              <span class="ngt-soon">Soon</span>
            </span>
          </template>
        </template>
      </nav>
    </aside>

    <div class="ngt-main">
      <router-view />
    </div>
  </div>
</template>

<style scoped>
/* Self-contained layout (NOT the portal's fixed `.association-users` grid,
   which would collide with the global member header + left rail). Normal-flow
   two-column grid that lives inside the already-offset member content; the
   section rail is sticky beneath the 56px global header. */
.ngt-shell {
  display: grid;
  grid-template-columns: 232px minmax(0, 1fr);
  align-items: start;
  min-height: calc(100vh - 56px);
  background: var(--surface-btn-solid, var(--surface-page));
  font-family: var(--font-body);
}
.ngt-rail {
  position: sticky;
  top: 56px;
  align-self: start;
  height: calc(100vh - 56px);
  overflow-y: auto;
  padding: 16px 8px;
  background: var(--surface-card);
  border-right: 1px solid var(--border-divider);
}
.ngt-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 8px;
}
.ngt-main {
  min-width: 0;
}
@media (max-width: 880px) {
  .ngt-shell {
    grid-template-columns: 1fr;
  }
  .ngt-rail {
    position: static;
    height: auto;
    overflow: visible;
  }
}

@media (max-width: 720px) {
  .ngt-shell {
    min-height: calc(100vh - var(--member-topbar-height, 56px) - var(--member-bottom-nav-height, 64px));
  }

  .ngt-rail {
    position: sticky;
    top: var(--member-topbar-height, 56px);
    z-index: 8;
    padding: 8px 10px;
    border-right: 0;
    border-bottom: 1px solid var(--border-divider);
    background: var(--surface-card);
  }

  .ngt-rail-title {
    display: none;
  }

  .ngt-nav {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 0;
    overflow: visible;
    padding-bottom: 2px;
  }

  .ngt-nav .association-users__nav-item {
    flex: 0 0 auto;
    min-height: 38px;
    height: 38px;
    padding: 0 12px;
    border: 1px solid var(--border-divider);
    border-radius: 999px;
    background: var(--surface-btn-solid, var(--surface-card));
    white-space: nowrap;
  }

  .ngt-foryou-item,
  .ngt-section-head {
    order: 1;
  }

  .ngt-subitem {
    order: 2;
    height: 38px;
    padding-left: 12px;
  }

  .ngt-subitem--other-section {
    display: none;
  }

  .ngt-subitem--current-section {
    flex: 1 1 auto;
    min-width: max-content;
  }

  :global(.app-shell--member .ngt-cards),
  :global(.app-shell--member .ngt-acards),
  :global(.app-shell--member .ngt-sec__grid),
  :global(.app-shell--member .ngt-foryou__skel-grid) {
    grid-template-columns: minmax(0, 1fr) !important;
  }

  :global(.app-shell--member .association-events__row.association-users__row),
  :global(.app-shell--member .association-teams__row.association-users__row) {
    grid-template-columns: minmax(0, 1fr) !important;
    gap: 12px;
  }

  :global(.app-shell--member .association-events__row-middle) {
    align-items: flex-start;
    width: 100%;
  }

  :global(.app-shell--member .association-events__row-info) {
    align-items: flex-start;
  }

  :global(.app-shell--member .association-events__row-link) {
    text-align: left;
  }

  :global(.app-shell--member .association-events__follow-btn) {
    width: 100%;
    justify-content: center;
    margin-top: 0;
  }
}

@media (max-width: 420px) {
  .ngt-nav .association-users__nav-item {
    padding: 0 10px;
    font-size: 0.8rem;
  }
}

/* Rail title — sits above the nav (where his portal shows the association
   brand block). Weight 500 to respect the no-bold rule. */
.ngt-rail-title {
  font-size: 0.95rem;
  font-weight: 500;
  color: var(--text);
  padding: 4px 14px 0;
}

/* Section header reuses `.association-users__nav-item` and opens that
   section's discover page, which is especially important on mobile. */
.ngt-section-head { cursor: pointer; }

/* Sub-tabs: indented under their section, a touch smaller/shorter than the
   section row so the hierarchy reads. Active/inactive tint comes from the
   global `--active` / `--inactive` modifiers. */
.ngt-subitem { padding-left: 44px; height: 44px; font-size: 0.88rem; }
.ngt-subitem--soon { cursor: default; opacity: 0.55; }
.ngt-subitem--soon:hover { background: none; }
.ngt-soon {
  margin-left: auto;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--text-light);
  background: var(--surface-pill);
  border-radius: 999px;
  padding: 2px 7px;
}

/* Section icons — reuse the global `.association-users__nav-icon` base (mask
   sizing + `--secondary` tint); only set the mask image. */
.ngt-foryou-item { margin-bottom: 8px; }
.ngt-icon--foryou { -webkit-mask-image: url('../assets/dashboard.svg'); mask-image: url('../assets/dashboard.svg'); }
.ngt-icon--calendar { -webkit-mask-image: url('../assets/calendar.svg'); mask-image: url('../assets/calendar.svg'); }
.ngt-icon--teams { -webkit-mask-image: url('../assets/teams.svg'); mask-image: url('../assets/teams.svg'); }
.ngt-icon--association { -webkit-mask-image: url('../assets/association.svg'); mask-image: url('../assets/association.svg'); }

@media (max-width: 720px) {
  .ngt-subitem {
    height: 38px;
    padding-left: 12px;
  }

  .ngt-subitem--other-section {
    display: none;
  }
}
</style>
