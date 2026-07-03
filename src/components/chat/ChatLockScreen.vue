<script setup lang="ts">
// ChatLockScreen
// --------------
// PIN-entry overlay used to unlock the whole chat surface OR a single locked
// conversation. `verify` is supplied by the parent (calls the chatLock store);
// on success we emit `unlocked`.

import { nextTick, onMounted, ref } from 'vue'

const props = defineProps<{
  title: string
  subtitle?: string
  verify: (pin: string) => Promise<boolean>
}>()

const emit = defineEmits<{ (e: 'unlocked'): void }>()

const pin = ref('')
const error = ref<string | null>(null)
const busy = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)

function onInput() {
  error.value = null
  pin.value = pin.value.replace(/\D/g, '').slice(0, 8)
}

async function submit() {
  if (busy.value || pin.value.length < 4) {
    if (pin.value.length < 4) error.value = 'Enter your PIN (at least 4 digits).'
    return
  }
  busy.value = true
  try {
    const ok = await props.verify(pin.value)
    if (ok) {
      emit('unlocked')
    } else {
      error.value = 'Incorrect PIN. Try again.'
      pin.value = ''
      void nextTick(() => inputRef.value?.focus())
    }
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  void nextTick(() => inputRef.value?.focus())
})
</script>

<template>
  <div class="lock-screen">
    <div class="lock-screen__card">
      <span class="lock-screen__icon" aria-hidden="true">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      </span>
      <h2 class="lock-screen__title">{{ title }}</h2>
      <p v-if="subtitle" class="lock-screen__subtitle">{{ subtitle }}</p>

      <input
        ref="inputRef"
        v-model="pin"
        type="password"
        inputmode="numeric"
        autocomplete="off"
        class="lock-screen__input"
        :class="{ 'lock-screen__input--error': error }"
        placeholder="••••"
        aria-label="Enter PIN"
        @input="onInput"
        @keyup.enter="submit"
      />
      <p v-if="error" class="lock-screen__error">{{ error }}</p>

      <button type="button" class="primary-button lock-screen__btn" :disabled="busy" @click="submit">
        {{ busy ? 'Checking…' : 'Unlock' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.lock-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 24px;
  background: var(--surface-card, #fff);
}
.lock-screen__card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  max-width: 320px;
  width: 100%;
}
.lock-screen__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 62px;
  height: 62px;
  border-radius: 50%;
  background: var(--primary-light-3, #eef4fd);
  color: var(--primary, #2d8cf0);
  margin-bottom: 14px;
}
.lock-screen__title {
  margin: 0;
  color: var(--text, #2e3137);
  font-size: 1.15rem;
  font-weight: 500;
}
.lock-screen__subtitle {
  margin: 6px 0 0;
  color: var(--text-light, #787f8d);
  font-size: 0.88rem;
}
.lock-screen__input {
  width: 100%;
  margin-top: 20px;
  padding: 12px 14px;
  border: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
  border-radius: var(--radius-md, 10px);
  background: var(--surface-pill, rgba(248, 250, 253, 0.94));
  color: var(--text, #2e3137);
  font-family: var(--font-body);
  font-size: 1.4rem;
  letter-spacing: 0.4em;
  text-align: center;
  outline: none;
}
.lock-screen__input:focus {
  border-color: var(--primary, #2d8cf0);
}
.lock-screen__input--error {
  border-color: #c1413a;
}
.lock-screen__error {
  margin: 10px 0 0;
  color: #c1413a;
  font-size: 0.82rem;
}
.lock-screen__btn {
  width: 100%;
  margin-top: 16px;
  justify-content: center;
}
</style>
