<script setup lang="ts">
// LoginView — standalone email/password login.
// ---------------------------------------------
// Used when the app runs on its own (local dev / standalone). In the embedded
// product the parent site hands the bearer token over via the handoff flow
// (HandoffView) — this page is the standalone equivalent: it hits the legacy
// `POST /api/login`, stores the returned Passport token via setAuthSession()
// (so getAuthHeaders() sends it on every subsequent /v2 call), then redirects
// back to wherever the user was headed (default: New Game Time → For You).

import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { buildLegacyApiUrl } from '../api/config'
import { setAuthSession } from '../auth-session'

const route = useRoute()
const router = useRouter()

const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

function redirectTarget(): string {
  const r = route.query.redirect
  return typeof r === 'string' && r.startsWith('/') ? r : ''
}

async function onSubmit() {
  if (loading.value) return
  error.value = ''
  if (!email.value.trim() || !password.value) {
    error.value = 'Enter your email and password.'
    return
  }
  loading.value = true
  try {
    const res = await fetch(buildLegacyApiUrl('/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email: email.value.trim(), password: password.value })
    })
    const json = await res.json().catch(() => null)
    const token = json?.data?.token as string | undefined

    if (!token) {
      // Legacy envelope surfaces a human message on failure (404 + message).
      error.value =
        (typeof json?.message === 'string' && json.message) ||
        'Login failed. Check your email and password.'
      return
    }

    // Capture the chat identity from the login response so the chat socket
    // handshake (userChatId = users.chat_id + display name) has what it needs.
    const chatIdRaw = json?.data?.user?.chat_id
    const userChatId = chatIdRaw != null ? String(chatIdRaw) : undefined
    const userName =
      typeof json?.data?.user?.name === 'string' ? json.data.user.name : undefined

    setAuthSession({ email: email.value.trim(), deviceToken: token, userChatId, userName })
    const target = redirectTarget()
    if (target) router.replace(target)
    else router.replace({ name: 'newgametime-for-you' })
  } catch {
    error.value = 'Could not reach the server. Please try again.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="login-screen">
    <form class="login-card" @submit.prevent="onSubmit">
      <h1 class="login-card__title">Sign in</h1>
      <p class="login-card__subtitle">Sign in to your WhoIFollow account to continue.</p>

      <label class="login-field">
        <span class="login-field__label">Email</span>
        <input
          v-model="email"
          type="email"
          autocomplete="username"
          class="login-field__input"
          placeholder="you@example.com"
          :disabled="loading"
        />
      </label>

      <label class="login-field">
        <span class="login-field__label">Password</span>
        <input
          v-model="password"
          type="password"
          autocomplete="current-password"
          class="login-field__input"
          placeholder="••••••••"
          :disabled="loading"
        />
      </label>

      <p v-if="error" class="login-card__error">{{ error }}</p>

      <button type="submit" class="primary-button login-card__submit" :disabled="loading">
        {{ loading ? 'Signing in…' : 'Sign in' }}
      </button>
    </form>
  </main>
</template>

<style scoped>
.login-screen {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--surface-btn-solid, #f4f7fb);
  font-family: var(--font-body);
}
.login-card {
  width: 100%;
  max-width: 380px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 32px 28px;
  background: var(--white, #fff);
  border: 1px solid var(--border-divider);
  border-radius: 12px;
  box-shadow: 0 12px 28px rgba(36, 60, 91, 0.08);
}
html.dark-mode .login-card { background: var(--surface-card); }
.login-card__title { font-size: 1.3rem; font-weight: 500; color: var(--text); }
.login-card__subtitle { font-size: 0.9rem; color: var(--text-light); margin-bottom: 6px; }
.login-field { display: flex; flex-direction: column; gap: 6px; }
.login-field__label { font-size: 0.82rem; font-weight: 500; color: var(--text); }
.login-field__input {
  height: 42px;
  padding: 0 12px;
  border: 1px solid var(--border-divider);
  border-radius: 6px;
  background: var(--surface-btn-solid, #fff);
  color: var(--text);
  font: inherit;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.login-field__input:focus {
  outline: 0;
  border-color: var(--primary, #2d8cf0);
  box-shadow: 0 0 0 3px rgba(45, 140, 240, 0.12);
}
.login-card__error {
  font-size: 0.85rem;
  color: var(--danger, #d9534f);
  background: rgba(217, 83, 79, 0.08);
  border-radius: 6px;
  padding: 8px 10px;
}
.login-card__submit { height: 42px; margin-top: 4px; }
</style>
