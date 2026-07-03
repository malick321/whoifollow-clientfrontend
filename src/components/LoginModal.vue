<script setup lang="ts">
import { ref, watch } from 'vue'
import { loginWithEmailPassword } from '../api/auth'
import { ACTIVE_API_ENV } from '../api/config'
import { authEmail, setAuthSession } from '../auth-session'
import { closeLoginModal, useLoginModalState } from '../login-modal-center'
import { pushToast } from '../toast-center'

// Global login modal. Open/close is driven by login-modal-center so any view
// can pop it open without prop-drilling. Behavior extracted verbatim from the
// original inline modal in App.vue — same API call, same toast, same markup
// classes (`modal-backdrop`, `auth-modal`, ...).

const isOpen = useLoginModalState()

const loginEmail = ref(authEmail.value)
const loginPassword = ref('')
const loginError = ref('')
const loginLoading = ref(false)

watch(isOpen, (open) => {
  if (open) {
    // Reset form each time the modal opens so stale errors/passwords don't
    // linger between sessions.
    loginEmail.value = authEmail.value
    loginPassword.value = ''
    loginError.value = ''
  } else {
    loginLoading.value = false
    loginPassword.value = ''
  }
})

function close() {
  closeLoginModal()
}

async function submitLogin() {
  loginError.value = ''
  loginLoading.value = true

  try {
    const response = await loginWithEmailPassword(loginEmail.value.trim(), loginPassword.value)
    setAuthSession({
      email: loginEmail.value.trim(),
      deviceToken: response.deviceToken
    })
    pushToast({
      tone: 'success',
      title: 'Login successful',
      message: `Authenticated against ${ACTIVE_API_ENV} and ready for WIF API requests.`
    })
    close()
  } catch (error) {
    loginError.value = error instanceof Error ? error.message : 'Unable to login right now.'
    pushToast({
      tone: 'warning',
      title: 'Login failed',
      message: loginError.value
    })
  } finally {
    loginLoading.value = false
  }
}
</script>

<template>
  <div v-if="isOpen" class="modal-backdrop" @click.self="close">
    <section class="modal-card auth-modal">
      <header class="modal-card__header auth-modal__header">
        <div class="auth-modal__titleblock">
          <p class="eyebrow">WIF Login</p>
          <h2>Connect to {{ ACTIVE_API_ENV }}</h2>
        </div>
        <button
          class="ellipsis-button ellipsis-button--close"
          type="button"
          aria-label="Close login modal"
          @click="close"
        >
          x
        </button>
      </header>

      <div class="auth-modal__body">
        <label class="auth-modal__field">
          <span>Email</span>
          <input v-model="loginEmail" type="email" placeholder="Enter your WIF email" />
        </label>

        <label class="auth-modal__field">
          <span>Password</span>
          <input
            v-model="loginPassword"
            type="password"
            placeholder="Enter your password"
            @keyup.enter="submitLogin"
          />
        </label>

        <p class="auth-modal__helper">Staging domain: `whoifollow.tech`</p>
        <p v-if="loginError" class="auth-modal__error">{{ loginError }}</p>
      </div>

      <footer class="auth-modal__footer">
        <button class="secondary-button" type="button" @click="close">Cancel</button>
        <button
          class="primary-button"
          type="button"
          :disabled="loginLoading"
          @click="submitLogin"
        >
          {{ loginLoading ? 'Signing in...' : 'Login' }}
        </button>
      </footer>
    </section>
  </div>
</template>
