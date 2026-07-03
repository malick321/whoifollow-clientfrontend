<script setup lang="ts">
// ChatLockSetupModal
// ------------------
// Enable / change / disable the chat PIN lock, and set the auto-lock timeout.
// PIN-only (WebCrypto hash via the chatLock store). Opened from the
// conversation list's lock button.

import { computed, ref, watch } from 'vue'
import SlideModal from '../SlideModal.vue'
import { useChatLockStore } from '../../stores/chatLock'
import { pushToast } from '../../toast-center'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

const lock = useChatLockStore()
const enabled = computed(() => lock.enabled)

// Enable flow
const newPin = ref('')
const confirmPin = ref('')
// Change / disable flow
const currentPin = ref('')
const changeNewPin = ref('')
const changeConfirm = ref('')
const autoLock = ref(lock.autoLockMinutes)
const busy = ref(false)
const error = ref<string | null>(null)

const AUTO_LOCK_OPTIONS = [
  { value: 0, label: 'Only when I reload' },
  { value: 1, label: 'After 1 minute' },
  { value: 5, label: 'After 5 minutes' },
  { value: 15, label: 'After 15 minutes' },
  { value: 30, label: 'After 30 minutes' }
]

function digits(v: string): string {
  return v.replace(/\D/g, '').slice(0, 8)
}

function reset() {
  newPin.value = ''
  confirmPin.value = ''
  currentPin.value = ''
  changeNewPin.value = ''
  changeConfirm.value = ''
  autoLock.value = lock.autoLockMinutes
  error.value = null
  busy.value = false
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) reset()
  }
)

function close() {
  emit('update:modelValue', false)
}

async function enableLock() {
  error.value = null
  const p = digits(newPin.value)
  if (p.length < 4) {
    error.value = 'PIN must be at least 4 digits.'
    return
  }
  if (p !== digits(confirmPin.value)) {
    error.value = 'PINs do not match.'
    return
  }
  busy.value = true
  try {
    const ok = await lock.enable(p, autoLock.value)
    if (!ok) {
      error.value = 'Could not enable chat lock. Please try again.'
      return
    }
    pushToast({ tone: 'success', title: 'Chat lock on', message: 'Your chats are now protected with a PIN.' })
    close()
  } finally {
    busy.value = false
  }
}

async function changePin() {
  error.value = null
  const np = digits(changeNewPin.value)
  if (np.length < 4) {
    error.value = 'New PIN must be at least 4 digits.'
    return
  }
  if (np !== digits(changeConfirm.value)) {
    error.value = 'New PINs do not match.'
    return
  }
  busy.value = true
  try {
    const ok = await lock.changePin(digits(currentPin.value), np)
    if (!ok) {
      error.value = 'Current PIN is incorrect.'
      return
    }
    pushToast({ tone: 'success', title: 'PIN updated', message: 'Your chat lock PIN was changed.' })
    close()
  } finally {
    busy.value = false
  }
}

async function turnOff() {
  error.value = null
  busy.value = true
  try {
    const ok = await lock.disable(digits(currentPin.value))
    if (!ok) {
      error.value = 'Current PIN is incorrect.'
      return
    }
    pushToast({ tone: 'warning', title: 'Chat lock off', message: 'PIN protection has been removed.' })
    close()
  } finally {
    busy.value = false
  }
}

async function saveAutoLock() {
  await lock.updateAutoLock(autoLock.value)
  pushToast({ tone: 'success', title: 'Saved', message: 'Auto-lock timing updated.' })
}
</script>

<template>
  <SlideModal
    :model-value="modelValue"
    title="Chat Lock"
    subtitle="Protect your chats with a PIN. Asked when you open chats and for any locked conversation."
    @update:model-value="emit('update:modelValue', $event)"
  >
    <!-- ENABLE (no lock yet) -->
    <section v-if="!enabled" class="lock-setup">
      <div class="floating-input">
        <input id="lock-new" v-model="newPin" type="password" inputmode="numeric" maxlength="8"
               class="floating-input__control" placeholder=" " @input="newPin = digits(newPin)" />
        <label for="lock-new" class="floating-input__label">New PIN (4–8 digits)</label>
      </div>
      <div class="floating-input">
        <input id="lock-confirm" v-model="confirmPin" type="password" inputmode="numeric" maxlength="8"
               class="floating-input__control" placeholder=" " @input="confirmPin = digits(confirmPin)" />
        <label for="lock-confirm" class="floating-input__label">Confirm PIN</label>
      </div>

      <label class="lock-setup__field-label" for="lock-auto">Auto-lock</label>
      <div class="floating-input">
        <select id="lock-auto" v-model.number="autoLock" class="floating-input__control floating-input__control--select">
          <option v-for="o in AUTO_LOCK_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <label for="lock-auto" class="floating-input__label floating-input__label--floated">Lock automatically</label>
      </div>

      <p v-if="error" class="lock-setup__error">{{ error }}</p>
    </section>

    <!-- MANAGE (lock on) -->
    <section v-else class="lock-setup">
      <div class="app-banner app-banner--primary">
        <div class="app-banner__text">
          <strong class="app-banner__title">Chat lock is on</strong>
          <span class="app-banner__sub">You'll be asked for your PIN when opening chats and any locked conversation.</span>
        </div>
      </div>

      <h3 class="lock-setup__head">Auto-lock</h3>
      <div class="lock-setup__row">
        <div class="floating-input lock-setup__grow">
          <select id="lock-auto2" v-model.number="autoLock" class="floating-input__control floating-input__control--select">
            <option v-for="o in AUTO_LOCK_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
          <label for="lock-auto2" class="floating-input__label floating-input__label--floated">Lock automatically</label>
        </div>
        <button type="button" class="secondary-button" @click="saveAutoLock">Save</button>
      </div>

      <h3 class="lock-setup__head">Change PIN</h3>
      <div class="floating-input">
        <input id="lock-cur" v-model="currentPin" type="password" inputmode="numeric" maxlength="8"
               class="floating-input__control" placeholder=" " @input="currentPin = digits(currentPin)" />
        <label for="lock-cur" class="floating-input__label">Current PIN</label>
      </div>
      <div class="floating-input">
        <input id="lock-cn" v-model="changeNewPin" type="password" inputmode="numeric" maxlength="8"
               class="floating-input__control" placeholder=" " @input="changeNewPin = digits(changeNewPin)" />
        <label for="lock-cn" class="floating-input__label">New PIN</label>
      </div>
      <div class="floating-input">
        <input id="lock-cc" v-model="changeConfirm" type="password" inputmode="numeric" maxlength="8"
               class="floating-input__control" placeholder=" " @input="changeConfirm = digits(changeConfirm)" />
        <label for="lock-cc" class="floating-input__label">Confirm new PIN</label>
      </div>

      <p v-if="error" class="lock-setup__error">{{ error }}</p>

      <div class="lock-setup__manage-actions">
        <button type="button" class="secondary-button" :disabled="busy" @click="changePin">Change PIN</button>
        <button type="button" class="danger-light-button" :disabled="busy" @click="turnOff">Turn off lock</button>
      </div>
    </section>

    <template #footer>
      <button type="button" class="secondary-button" @click="close">Close</button>
      <button v-if="!enabled" type="button" class="primary-button" :disabled="busy" @click="enableLock">
        {{ busy ? 'Enabling…' : 'Turn on lock' }}
      </button>
    </template>
  </SlideModal>
</template>

<style scoped>
.lock-setup {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.lock-setup__head {
  margin: 4px 0 -4px;
  color: var(--text, #2e3137);
  font-size: 0.95rem;
  font-weight: 500;
}
.lock-setup__field-label {
  color: var(--secondary, #2f5f98);
  font-size: 0.82rem;
  font-weight: 500;
  margin-bottom: -8px;
}
.lock-setup__row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.lock-setup__grow {
  flex: 1 1 auto;
}
.lock-setup__manage-actions {
  display: flex;
  gap: 10px;
}
.lock-setup__manage-actions .secondary-button,
.lock-setup__manage-actions .danger-light-button {
  flex: 1 1 0;
  justify-content: center;
}
.lock-setup__error {
  margin: 0;
  color: #c1413a;
  font-size: 0.82rem;
}
</style>
