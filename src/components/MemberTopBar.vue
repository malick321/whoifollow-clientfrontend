<script setup lang="ts">
// MemberTopBar
// ------------
// Global member navigation, mirroring the LEGACY shell pattern (enhanced):
//   • top HEADER: WIF mark + "Search Who I Follow" + primary menus
//     (Chats · Game Time · Calendar · Shop) + right cluster (Association ·
//     Go Pro · theme toggle · cart · notifications · account)
//   • slim left ICON RAIL: My Life · Tasks · Opinions (legacy left menu)
//
// Nav icons are the ACTUAL legacy assets (src/assets/nav/*, copied from the
// legacy customer frontend). Header is sticky/normal-flow; the rail is fixed
// (App.vue pads content 60px left). Real pages only — legacy right-cluster
// buttons with no page yet (Association, Go Pro, Notifications) fire a
// "coming soon" toast for visual parity without dead clicks.

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import TeamAvatar from './TeamAvatar.vue'
import {
  authEmail,
  authUserAvatarUrl,
  authUserName,
  clearAuthSession,
  isAuthenticated,
  setChatIdentity
} from '../auth-session'
import { fetchCurrentUser } from '../api/me'
import { openLoginModal } from '../login-modal-center'
import { openInviteModal } from '../invite-modal-center'
import { useShopCartStore } from '../stores/shopCart'
import { pushToast } from '../toast-center'
import { themeMode, toggleTheme } from '../theme'
import wifIconUrl from '../assets/wif-icon-only.svg'
// Legacy nav icons (fetched from the legacy customer frontend).
import myLifeIcon from '../assets/nav/book.svg'
import tasksIcon from '../assets/nav/document-text.svg'
import opinionsIcon from '../assets/nav/firstline.svg'
import chatsIcon from '../assets/nav/chats.png'
import gameTimeIcon from '../assets/nav/gametime.png'
import calendarIcon from '../assets/nav/calendar.svg'
import shopIcon from '../assets/nav/shop.png'
import associationIcon from '../assets/nav/association.svg'
import notificationIcon from '../assets/nav/notification.svg'

interface NavItem {
  label: string
  to: string
  icon: string
  /** Extra path prefixes that also mark this item active. */
  match?: string[]
}

// Top-bar primary menus — the legacy header centre set.
const TOP_MENUS: NavItem[] = [
  { label: 'Chats', to: '/chat', icon: chatsIcon },
  {
    label: 'Game Time',
    to: '/events',
    icon: gameTimeIcon,
    match: ['/events', '/my/events', '/teams', '/my/teams', '/associations', '/for-you']
  },
  { label: 'Calendar', to: '/calendar', icon: calendarIcon },
  { label: 'Shop', to: '/shop', icon: shopIcon }
]

// Left rail — the legacy left menu (real pages only for now).
const RAIL_ITEMS: NavItem[] = [
  { label: 'My Life', to: '/lifebook', icon: myLifeIcon },
  { label: 'Tasks', to: '/tasks', icon: tasksIcon },
  { label: 'Opinions', to: '/opinions', icon: opinionsIcon }
]

const route = useRoute()
const router = useRouter()
const cart = useShopCartStore()

function isActive(item: NavItem): boolean {
  const p = route.path
  if (p === item.to || p.startsWith(item.to + '/')) return true
  return (item.match ?? []).some((m) => p === m || p.startsWith(m + '/'))
}

function comingSoon(what: string) {
  pushToast({ tone: 'warning', title: what, message: `${what} is coming soon.` })
}

// Account menu.
const menuOpen = ref(false)
const menuRef = ref<HTMLElement | null>(null)

function nameFromEmail(email: string): string {
  const local = email.split('@')[0]?.trim() ?? ''
  if (!local) return ''
  return local
    .replace(/[._-]+/g, ' ')
    .replace(/\b[a-z]/g, (char) => char.toUpperCase())
}

const avatarName = computed(() => {
  return authUserName.value || nameFromEmail(authEmail.value) || 'WIF User'
})
const avatarUrl = computed(() => authUserAvatarUrl.value || undefined)

async function refreshIdentity() {
  if (!isAuthenticated.value) return
  try {
    const me = await fetchCurrentUser()
    if (me?.userChatId) setChatIdentity(me.userChatId, me.name, me.avatarUrl)
  } catch {
    // Best-effort identity refresh; route guards handle auth failures.
  }
}

function refreshCart(force = false) {
  if (force || !cart.loaded) void cart.load()
}

function toggleMenu() {
  menuOpen.value = !menuOpen.value
}
function logout() {
  menuOpen.value = false
  clearAuthSession()
  pushToast({ tone: 'warning', title: 'Logged out', message: 'Your session has been cleared from this browser.' })
  if (!(route.meta as { public?: boolean }).public) {
    void router.replace({ name: 'login', query: { redirect: route.fullPath } })
  }
}
function onLogin() {
  menuOpen.value = false
  openLoginModal()
}
function onDocClick(e: MouseEvent) {
  if (!menuOpen.value) return
  const t = e.target as Node | null
  if (menuRef.value && t && !menuRef.value.contains(t)) menuOpen.value = false
}
onMounted(() => {
  document.addEventListener('mousedown', onDocClick)
  void refreshIdentity()
  refreshCart()
})
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick))

watch(isAuthenticated, (authenticated) => {
  if (authenticated) void refreshIdentity()
  refreshCart(true)
})
</script>

<template>
  <header class="member-topbar">
    <div class="member-topbar__inner">
      <!-- Brand + search -->
      <div class="member-topbar__lead">
        <router-link to="/events" class="member-topbar__brand" aria-label="Who I Follow">
          <img :src="wifIconUrl" alt="" class="member-topbar__brand-img" />
        </router-link>
        <label class="member-topbar__search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            type="search"
            class="member-topbar__search-input"
            placeholder="Search Who I Follow"
            aria-label="Search Who I Follow"
          />
        </label>
      </div>

      <!-- Primary menus (legacy header centre) -->
      <nav class="member-topbar__nav" aria-label="Primary">
        <router-link
          v-for="item in TOP_MENUS"
          :key="item.to"
          :to="item.to"
          class="member-topbar__item"
          :class="{ 'member-topbar__item--active': isActive(item) }"
        >
          <img :src="item.icon" alt="" class="nav-ico member-topbar__item-ico" />
          <span class="member-topbar__item-label">{{ item.label }}</span>
        </router-link>
      </nav>

      <!-- Right cluster (legacy: Association · Go Pro · theme · cart · bell · account) -->
      <div class="member-topbar__actions">
        <button type="button" class="member-topbar__assoc" @click="comingSoon('Association switching')">
          <img :src="associationIcon" alt="" class="nav-ico" />
          <span class="member-topbar__assoc-label">Association</span>
        </button>
        <button type="button" class="member-topbar__invite" aria-label="Invite a friend" @click="openInviteModal()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" />
          </svg>
          <span class="member-topbar__invite-label">Invite</span>
        </button>
        <button type="button" class="member-topbar__gopro" @click="router.push('/go-pro')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M5 16L3 5l5.5 4L12 4l3.5 5L21 5l-2 11H5zm0 2h14v2H5v-2z" />
          </svg>
          <span>Go Pro</span>
        </button>

        <!-- Dark / light toggle (moved to the top-right) -->
        <button
          type="button"
          class="member-topbar__icon-btn"
          :aria-label="`Switch to ${themeMode === 'dark' ? 'light' : 'dark'} mode`"
          :title="`Switch to ${themeMode === 'dark' ? 'light' : 'dark'} mode`"
          @click="toggleTheme"
        >
          <svg v-if="themeMode !== 'dark'" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="4.2" fill="currentColor" />
            <g stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="12" y1="1.8" x2="12" y2="4.8" /><line x1="12" y1="19.2" x2="12" y2="22.2" />
              <line x1="1.8" y1="12" x2="4.8" y2="12" /><line x1="19.2" y1="12" x2="22.2" y2="12" />
              <line x1="4.0" y1="4.0" x2="6.2" y2="6.2" /><line x1="17.8" y1="17.8" x2="20.0" y2="20.0" />
              <line x1="4.0" y1="20.0" x2="6.2" y2="17.8" /><line x1="17.8" y1="6.2" x2="20.0" y2="4.0" />
            </g>
          </svg>
          <svg v-else width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="currentColor" />
          </svg>
        </button>

        <router-link to="/shop" class="member-topbar__icon-btn" aria-label="Cart">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
            <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
          </svg>
          <span v-if="cart.distinctItemCount > 0" class="member-topbar__badge">{{ cart.distinctItemCount }}</span>
        </router-link>
        <button type="button" class="member-topbar__icon-btn" aria-label="Notifications" @click="comingSoon('Notifications')">
          <img :src="notificationIcon" alt="" class="nav-ico" />
        </button>
        <div ref="menuRef" class="member-topbar__account">
          <button
            type="button"
            class="member-topbar__avatar-btn"
            :aria-expanded="menuOpen ? 'true' : 'false'"
            @click="toggleMenu"
          >
            <TeamAvatar :name="avatarName" :image-url="avatarUrl" size="sm" />
          </button>
          <div v-if="menuOpen" class="member-topbar__menu" role="menu">
            <template v-if="isAuthenticated">
              <div class="member-topbar__menu-email" :title="authEmail">{{ authEmail }}</div>
              <button type="button" class="member-topbar__menu-item" role="menuitem" @click="logout">Logout</button>
            </template>
            <button v-else type="button" class="member-topbar__menu-item" role="menuitem" @click="onLogin">Login</button>
          </div>
        </div>
      </div>
    </div>
  </header>

  <!-- Slim left icon rail (legacy left menu) -->
  <aside class="member-rail" aria-label="Sections">
    <router-link
      v-for="item in RAIL_ITEMS"
      :key="item.to"
      :to="item.to"
      class="member-rail__item"
      :class="{ 'member-rail__item--active': isActive(item) }"
      :title="item.label"
    >
      <img :src="item.icon" alt="" class="nav-ico member-rail__ico" />
      <span class="member-rail__label">{{ item.label }}</span>
    </router-link>

    <!-- My Stats — Player Passport (inline SVG, no legacy asset) -->
    <router-link
      to="/my/stats"
      class="member-rail__item"
      :class="{ 'member-rail__item--active': $route.path.startsWith('/my/stats') || $route.path.startsWith('/players') }"
      title="My Stats"
    >
      <svg class="member-rail__ico" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 3v18h18" /><rect x="7" y="11" width="3" height="6" /><rect x="12" y="7" width="3" height="10" /><rect x="17" y="13" width="3" height="4" />
      </svg>
      <span class="member-rail__label">My Stats</span>
    </router-link>
  </aside>
</template>

<style scoped>
/* Legacy nav icons are monochrome assets designed for a light bg. Keep them
   as-is in light mode; lighten to near-white in dark mode so they stay
   visible on the dark header/rail. */
.nav-ico {
  width: 20px;
  height: 20px;
  object-fit: contain;
  display: block;
}
:global(html.dark-mode .nav-ico) {
  filter: brightness(0) invert(1);
  opacity: 0.82;
}

/* ── Header bar ─────────────────────────────────────────────────── */
.member-topbar {
  position: sticky;
  top: 0;
  z-index: 200;
  height: 56px;
  background: var(--surface-card, #fff);
  border-bottom: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
  box-shadow: var(--shadow-soft, 0 6px 16px rgba(36, 60, 91, 0.05));
}
.member-topbar__inner {
  display: flex;
  align-items: center;
  gap: 18px;
  height: 100%;
  max-width: 1500px;
  margin: 0 auto;
  padding: 0 16px;
}

.member-topbar__lead {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 0 1 340px;
  min-width: 0;
}
.member-topbar__brand-img {
  width: 30px;
  height: 30px;
  display: block;
}
.member-topbar__search {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  background: var(--surface-pill, rgba(248, 250, 253, 0.94));
  border: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
  border-radius: 999px;
  padding: 0 14px;
  color: var(--text-light, #787f8d);
}
.member-topbar__search-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  font-family: var(--font-body);
  font-size: 0.86rem;
  color: var(--text, #2e3137);
  padding: 8px 0;
}
.member-topbar__search-input:focus {
  outline: none;
}

.member-topbar__nav {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 auto;
  justify-content: center;
}
.member-topbar__item {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 6px 14px;
  border-radius: var(--radius-md, 8px);
  color: var(--text-light, #787f8d);
  text-decoration: none;
  font-family: var(--font-body);
  font-size: 0.72rem;
  font-weight: 500;
  white-space: nowrap;
  transition: background-color 0.12s ease, color 0.12s ease;
}
.member-topbar__item:hover {
  background: var(--surface-pill, rgba(248, 250, 253, 0.94));
  color: var(--text, #2e3137);
}
.member-topbar__item--active {
  color: var(--primary, #2d8cf0);
}
.member-topbar__item-ico {
  width: 22px;
  height: 22px;
}

.member-topbar__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}
.member-topbar__assoc {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
  border-radius: 999px;
  background: var(--surface-card, #fff);
  color: var(--secondary, #2f5f98);
  font-family: var(--font-body);
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
}
.member-topbar__assoc .nav-ico {
  width: 16px;
  height: 16px;
}
.member-topbar__assoc:hover {
  border-color: var(--primary, #2d8cf0);
}
.member-topbar__invite {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
  border-radius: 999px;
  background: var(--surface-card, #fff);
  color: var(--secondary, #2f5f98);
  font-family: var(--font-body);
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
}
.member-topbar__invite:hover {
  border-color: var(--primary, #2d8cf0);
}
.member-topbar__gopro {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 16px;
  border: none;
  border-radius: 999px;
  background: var(--primary);
  color: #fff;
  font-family: var(--font-body);
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
}
.member-topbar__gopro:hover {
  filter: brightness(1.04);
}
.member-topbar__icon-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--secondary, #2f5f98);
  text-decoration: none;
  cursor: pointer;
}
.member-topbar__icon-btn:hover {
  background: var(--surface-pill, rgba(248, 250, 253, 0.94));
}
.member-topbar__icon-btn .nav-ico {
  width: 20px;
  height: 20px;
}
.member-topbar__badge {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.62rem;
  font-weight: 600;
  color: var(--white, #fff);
  background: var(--primary, #2d8cf0);
  border-radius: 999px;
}
.member-topbar__account {
  position: relative;
}
.member-topbar__avatar-btn {
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
  display: inline-flex;
}
.member-topbar__menu {
  position: absolute;
  top: 46px;
  right: 0;
  min-width: 200px;
  padding: 6px;
  border-radius: 10px;
  background: var(--surface-opaque, rgba(255, 255, 255, 0.98));
  border: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
  box-shadow: var(--shadow, 0 10px 24px rgba(36, 60, 91, 0.08));
  z-index: 210;
}
.member-topbar__menu-email {
  padding: 8px 10px;
  font-size: 0.78rem;
  color: var(--text-light, #787f8d);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-bottom: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
}
.member-topbar__menu-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 9px 10px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text, #2e3137);
  font-family: var(--font-body);
  font-size: 0.86rem;
  cursor: pointer;
}
.member-topbar__menu-item:hover {
  background: var(--surface-pill, rgba(248, 250, 253, 0.94));
}

/* ── Slim left rail (legacy left menu) ──────────────────────────── */
.member-rail {
  position: fixed;
  top: 56px;
  left: 0;
  bottom: 0;
  z-index: 190;
  width: 60px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 0;
  background: var(--surface-card, #fff);
  border-right: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
}
.member-rail__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  width: 52px;
  padding: 7px 0 5px;
  border-radius: var(--radius-md, 8px);
  color: var(--text-light, #787f8d);
  text-decoration: none;
  font-family: var(--font-body);
  font-size: 0.6rem;
  font-weight: 500;
  text-align: center;
  transition: background-color 0.12s ease, color 0.12s ease;
}
.member-rail__item:hover {
  background: var(--surface-pill, rgba(248, 250, 253, 0.94));
  color: var(--text, #2e3137);
}
.member-rail__item--active {
  color: var(--primary, #2d8cf0);
  background: var(--primary-light-3, #eef4fd);
}
.member-rail__ico {
  width: 22px;
  height: 22px;
}
.member-rail__label {
  line-height: 1.1;
}

/* Narrow screens: hide the longer text labels to save room; the rail stays
   (it's the only home for My Life / Tasks / Opinions). */
@media (max-width: 880px) {
  .member-topbar__item-label,
  .member-topbar__assoc-label,
  .member-topbar__invite-label {
    display: none;
  }
}

@media (max-width: 720px) {
  .member-topbar {
    height: var(--member-topbar-height, 52px);
  }

  .member-topbar__inner {
    gap: 6px;
    max-width: none;
    padding: 0 8px;
  }

  .member-topbar__lead {
    flex: 0 0 auto;
    gap: 0;
  }

  .member-topbar__brand-img {
    width: 24px;
    height: 24px;
  }

  .member-topbar__search {
    display: none;
  }

  .member-topbar__nav {
    justify-content: flex-start;
    gap: 2px;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .member-topbar__nav::-webkit-scrollbar {
    display: none;
  }

  .member-topbar__item {
    min-width: 42px;
    padding: 5px 7px;
  }

  .member-topbar__item-ico {
    width: 21px;
    height: 21px;
  }

  .member-topbar__actions {
    gap: 2px;
  }

  .member-topbar__assoc,
  .member-topbar__invite {
    width: 34px;
    height: 34px;
    padding: 0;
    justify-content: center;
    border-color: transparent;
    background: transparent;
  }

  .member-topbar__gopro {
    display: none;
  }

  .member-topbar__icon-btn {
    width: 34px;
    height: 34px;
  }

  .member-topbar__icon-btn[aria-label='Notifications'] {
    display: none;
  }

  .member-topbar__menu {
    position: fixed;
    top: calc(var(--member-topbar-height, 52px) + 6px);
    right: 8px;
    max-width: calc(100vw - 16px);
  }

  .member-rail {
    top: auto;
    left: 0;
    right: 0;
    bottom: 0;
    width: auto;
    height: var(--member-bottom-nav-height, 62px);
    flex-direction: row;
    justify-content: space-around;
    gap: 2px;
    padding: 5px 8px max(5px, env(safe-area-inset-bottom));
    border-right: none;
    border-top: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
    box-shadow: 0 -10px 24px rgba(15, 23, 42, 0.08);
  }

  .member-rail__item {
    flex: 1 1 0;
    width: auto;
    max-width: 92px;
    min-width: 0;
    padding: 5px 2px 4px;
  }

  .member-rail__ico {
    width: 20px;
    height: 20px;
  }

  .member-rail__label {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

@media (max-width: 420px) {
  .member-topbar__assoc {
    display: none;
  }

  .member-topbar__item {
    min-width: 38px;
    padding-inline: 5px;
  }
}
</style>
