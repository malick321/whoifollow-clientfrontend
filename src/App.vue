<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { authEmail, clearAuthSession, isAuthenticated } from './auth-session'
import LoginModal from './components/LoginModal.vue'
import InviteFriendModal from './components/InviteFriendModal.vue'
import ThemeToggle from './components/ThemeToggle.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import MemberTopBar from './components/MemberTopBar.vue'
import TeamAvatar from './components/TeamAvatar.vue'
import { openLoginModal } from './login-modal-center'
import { themeMode, toggleTheme } from './theme'
import { pushToast, removeToast, useToasts } from './toast-center'
import wifIconUrl from './assets/wif-icon-only.svg'

// The app shell renders a minimal top header on association portal
// routes only — WIF icon on the left, a single user-initials avatar
// dropdown on the right. Team-participation routes stay headerless
// because they render inside the whoifollow.tech iframe (parent app
// supplies its own chrome there).

const toasts = useToasts()
const route = useRoute()

/** Topbar visibility — show on association portal routes only.
 *  Excludes the handoff page since that's the auth gate, not a
 *  portal page proper (would briefly flash during auth redirect).
 *  Also excludes all matchgeni routes — `MatchGeniHeader` renders
 *  its own dark-navy header that hosts the theme toggle + user
 *  avatar on its right side, so showing the app-level topbar
 *  above it would double-stack two headers and crowd the page. */
const showTopbar = computed(() => {
  const path = route.path
  if (!path.includes('/portal/')) return false
  if (path.endsWith('/portal/handoff')) return false
  if (path.includes('/matchgeni')) return false
  return true
})

/** Member surfaces that get the global member nav bar (Chats · Game Time ·
 *  Calendar · Shop + My Life · Tasks · Opinions). Real pages only. Excludes the
 *  association portal (its own topbar), the public shared Life Book, and any
 *  association/matchgeni route. */
const MEMBER_PREFIXES = [
  '/events', '/my/events', '/teams', '/my/teams', '/team', '/associations', '/for-you',
  '/chat', '/calendar', '/tasks', '/shop', '/opinions', '/lifebook',
  '/players', '/my/stats'
]
const showMemberShell = computed(() => {
  const path = route.path
  if (showTopbar.value) return false
  if (path.startsWith('/lifebook/shared')) return false
  if (path.includes('/portal/') || path.includes('/matchgeni') || path.includes('/association/')) {
    return false
  }
  return MEMBER_PREFIXES.some((m) => path === m || path.startsWith(m + '/'))
})

/** Display name passed to TeamAvatar for the initial + color hash.
 *  TeamAvatar pulls the FIRST alpha character so the deterministic
 *  palette stays stable for a given user across sessions. We use
 *  the local-part of the email (before the @) so "awais.chughtai@…"
 *  resolves to "A" with a hashed color, matching how user avatars
 *  render everywhere else in the portal. */
const avatarName = computed(() => {
  const source = authEmail.value || 'WIF User'
  return source.split('@')[0] || source
})

// User-menu dropdown — opens on click, closes on outside click /
// ESC. Email + Logout are the only menu items.
const userMenuOpen = ref(false)
const userMenuRef = ref<HTMLElement | null>(null)

function toggleUserMenu() {
  userMenuOpen.value = !userMenuOpen.value
}
function closeUserMenu() {
  userMenuOpen.value = false
}
function onLoginClick() {
  closeUserMenu()
  openLoginModal()
}
function logout() {
  closeUserMenu()
  clearAuthSession()
  pushToast({
    tone: 'warning',
    title: 'Logged out',
    message: 'Your session has been cleared from this browser.'
  })
}

function onDocClick(event: MouseEvent) {
  if (!userMenuOpen.value) return
  const target = event.target as Node | null
  if (userMenuRef.value && target && !userMenuRef.value.contains(target)) {
    userMenuOpen.value = false
  }
}
function onEsc(event: KeyboardEvent) {
  if (event.key === 'Escape') userMenuOpen.value = false
}

onMounted(() => {
  document.addEventListener('mousedown', onDocClick)
  document.addEventListener('keydown', onEsc)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocClick)
  document.removeEventListener('keydown', onEsc)
})
</script>

<template>
  <div
    class="app-shell"
    :class="{
      'app-shell--authenticated': isAuthenticated,
      'app-shell--has-topbar': showTopbar
    }"
  >
    <!-- Minimal top header for the association portal — WIF icon on
         the left, user-initials dropdown on the right. -->
    <header v-if="showTopbar" class="topbar topbar--minimal">
      <a href="/" class="topbar__brand-mark" aria-label="Who I Follow">
        <img :src="wifIconUrl" alt="" class="topbar__brand-img" />
      </a>

      <div class="topbar__actions">
        <!-- Theme toggle — icon shows the CURRENT mode (sun = light,
             moon = dark); click toggles to the other. Standard
             header pattern: state-visible single-button switch.
             aria-label / title reflect the destination state so
             screen readers + tooltip read like "Switch to dark mode". -->
        <button
          type="button"
          class="topbar-theme-toggle"
          :class="{ 'topbar-theme-toggle--dark': themeMode === 'dark' }"
          :aria-label="`Switch to ${themeMode === 'dark' ? 'light' : 'dark'} mode`"
          :title="`Switch to ${themeMode === 'dark' ? 'light' : 'dark'} mode`"
          @click="toggleTheme"
        >
          <!-- Bright sun (currently light mode — click to go dark). -->
          <svg
            v-if="themeMode !== 'dark'"
            class="topbar-theme-toggle__icon"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="4.2" fill="currentColor" />
            <g stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="12" y1="1.8" x2="12" y2="4.8" />
              <line x1="12" y1="19.2" x2="12" y2="22.2" />
              <line x1="1.8" y1="12" x2="4.8" y2="12" />
              <line x1="19.2" y1="12" x2="22.2" y2="12" />
              <line x1="4.0" y1="4.0" x2="6.2" y2="6.2" />
              <line x1="17.8" y1="17.8" x2="20.0" y2="20.0" />
              <line x1="4.0" y1="20.0" x2="6.2" y2="17.8" />
              <line x1="17.8" y1="6.2" x2="20.0" y2="4.0" />
            </g>
          </svg>
          <!-- Moon (currently dark mode — click to go light). -->
          <svg
            v-else
            class="topbar-theme-toggle__icon"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
              fill="currentColor"
            />
          </svg>
        </button>

        <div
          ref="userMenuRef"
          class="topbar-user"
          :class="{ 'topbar-user--open': userMenuOpen }"
        >
          <button
            type="button"
            class="topbar-user__trigger"
            :aria-haspopup="'menu'"
            :aria-expanded="userMenuOpen ? 'true' : 'false'"
            :aria-label="isAuthenticated ? `Account menu for ${authEmail}` : 'Open account menu'"
            @click="toggleUserMenu"
          >
            <TeamAvatar :name="avatarName" size="md" />
          </button>

          <div
            v-if="userMenuOpen"
            class="topbar-user__menu"
            role="menu"
          >
            <template v-if="isAuthenticated">
              <div class="topbar-user__email" :title="authEmail">{{ authEmail }}</div>
              <button
                type="button"
                class="topbar-user__menu-item"
                role="menuitem"
                @click="logout"
              >Logout</button>
            </template>
            <template v-else>
              <button
                type="button"
                class="topbar-user__menu-item"
                role="menuitem"
                @click="onLoginClick"
              >Login</button>
            </template>
          </div>
        </div>
      </div>
    </header>

    <!-- Global member navigation (Chats · Game Time · Calendar · Shop +
         My Life · Tasks · Opinions). Sticky, normal-flow — sits above the
         content on member surfaces only. -->
    <MemberTopBar v-if="showMemberShell" />

    <div class="workspace-shell" :class="{ 'workspace-shell--member': showMemberShell }">
      <section class="workspace-content">
        <router-view />
      </section>
    </div>

    <LoginModal />

    <!-- Global "Invite Friend to join Who I Follow" slide-over. -->
    <InviteFriendModal />

    <!-- App-wide confirmation dialog (replaces native window.confirm). -->
    <ConfirmDialog />

    <!-- App-wide light/dark switch (floating pill) for the member surfaces
         (game-time, chat, calendar, tasks, login). The portal topbar has its
         own theme button, and Life Book mounts its own toggle in-view, so skip
         both here to avoid a double control. -->
    <ThemeToggle v-if="!showTopbar && !showMemberShell && !route.path.startsWith('/lifebook')" />

    <div class="toast-stack" aria-live="polite" aria-atomic="true">
      <transition-group name="toast-slide">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          class="toast-card"
          :data-tone="toast.tone"
        >
          <div class="toast-card__copy">
            <strong>{{ toast.title }}</strong>
            <span v-if="toast.message">{{ toast.message }}</span>
          </div>
          <button
            class="toast-card__dismiss"
            type="button"
            :aria-label="`Dismiss ${toast.title}`"
            @click="removeToast(toast.id)"
          >
            x
          </button>
        </div>
      </transition-group>
    </div>
  </div>
</template>

<style scoped>
/* Offset the content for the fixed member left rail (60px). The rail + header
   are rendered by MemberTopBar; this just keeps page content clear of the rail. */
.workspace-shell--member {
  min-height: calc(100vh - 56px);
  padding-left: 60px;
  background: var(--body-bg);
  color: var(--text);
}
</style>
