<script setup lang="ts">
// ManagerEmailLookup
// ------------------
// Email field + live WIF-identity lookup. As the admin types a (valid) email
// it debounces a lookup against the global WIF users table:
//   - match found    → links that user (emits the user id) and shows a chip
//                       (avatar + name + "On WIF · will be linked").
//   - no match        → clears the link, flags an invite, and shows a subtle
//                       note that the person will be emailed an invite.
//
// Storage is split across two v-models so the parent stays in control:
//   v-model:email          — the raw email string
//   v-model:linked-user-id — the matched WIF user id, or null
// plus an `update:send-invite` emit (true when a valid email had NO match).
//
// First consumer: the Register/Edit Team wizard's manager step. Built to be
// reused by other invite flows. See `src/api/identity.ts`.

import { computed, ref, watch } from 'vue'
import TeamAvatar from './TeamAvatar.vue'
import { lookupWifUserByEmail } from '../api/identity'
import type { WifUserIdentity } from '../types'

const props = withDefaults(defineProps<{
  email?: string
  linkedUserId?: string | null
  /** Show the field in an invalid state (parent-driven validation). */
  invalid?: boolean
  disabled?: boolean
  id?: string
  label?: string
}>(), {
  email: '',
  linkedUserId: null,
  invalid: false,
  disabled: false,
  id: 'manager-email',
  label: 'Email'
})

const emit = defineEmits<{
  (e: 'update:email', value: string): void
  (e: 'update:linkedUserId', value: string | null): void
  (e: 'update:sendInvite', value: boolean): void
}>()

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DEBOUNCE_MS = 400

type LookupState = 'idle' | 'searching' | 'found' | 'notfound' | 'linked'

const matched = ref<WifUserIdentity | null>(null)
const state = ref<LookupState>('idle')
// On edit hydration the parent may pass a linkedUserId without us having looked
// up — show a "linked" confirmation until the admin edits the email.
const touched = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null
// Guards against a stale in-flight lookup overwriting a newer one.
let lookupSeq = 0

const isValidEmail = computed(() => EMAIL_RE.test((props.email ?? '').trim()))

// Seed the "linked" state when opened with a pre-linked manager (edit flow).
if (props.linkedUserId && (props.email ?? '').trim()) {
  state.value = 'linked'
}

function onInput(e: Event) {
  const value = (e.target as HTMLInputElement).value
  touched.value = true
  emit('update:email', value)
}

function clearLink() {
  matched.value = null
  if (props.linkedUserId !== null) emit('update:linkedUserId', null)
}

async function runLookup(email: string) {
  const seq = ++lookupSeq
  state.value = 'searching'
  let result: WifUserIdentity | null = null
  try {
    result = await lookupWifUserByEmail(email)
  } catch {
    result = null
  }
  if (seq !== lookupSeq) return // a newer lookup superseded this one
  if (result) {
    matched.value = result
    state.value = 'found'
    emit('update:linkedUserId', result.id)
    emit('update:sendInvite', false)
  } else {
    matched.value = null
    state.value = 'notfound'
    emit('update:linkedUserId', null)
    emit('update:sendInvite', true)
  }
}

watch(
  () => props.email,
  (next) => {
    if (timer) { clearTimeout(timer); timer = null }
    // Don't re-lookup on the initial pre-linked hydration.
    if (!touched.value && state.value === 'linked') return
    lookupSeq++ // cancel any in-flight result
    const trimmed = (next ?? '').trim()
    if (!trimmed || !EMAIL_RE.test(trimmed)) {
      state.value = 'idle'
      clearLink()
      emit('update:sendInvite', false)
      return
    }
    timer = setTimeout(() => runLookup(trimmed), DEBOUNCE_MS)
  }
)
</script>

<template>
  <div class="manager-lookup">
    <div class="floating-input" :class="{ 'floating-input--invalid': invalid }">
      <input
        :id="id"
        type="email"
        class="floating-input__control"
        :class="{ 'floating-input__control--has-value': !!email }"
        :value="email"
        :disabled="disabled"
        placeholder=" "
        autocomplete="off"
        @input="onInput"
      />
      <label :for="id" class="floating-input__label">{{ label }}</label>
      <span v-if="invalid" class="floating-input__error-corner">Required</span>
      <span v-if="state === 'searching'" class="manager-lookup__spinner btn-spinner" aria-hidden="true"></span>
    </div>

    <!-- Found → linked chip -->
    <div v-if="state === 'found' && matched" class="manager-lookup__result manager-lookup__result--found">
      <TeamAvatar :name="matched.name" :image-url="matched.avatarUrl" size="sm" />
      <span class="manager-lookup__result-text">
        <strong class="manager-lookup__result-name">{{ matched.name }}</strong>
        <span class="manager-lookup__result-sub">On WIF · will be linked to this team</span>
      </span>
      <span class="manager-lookup__badge manager-lookup__badge--linked">Linked</span>
    </div>

    <!-- Pre-linked (edit hydration, untouched) -->
    <div v-else-if="state === 'linked'" class="manager-lookup__result manager-lookup__result--found">
      <span class="manager-lookup__result-text">
        <span class="manager-lookup__result-sub">Linked to an existing WIF account.</span>
      </span>
      <span class="manager-lookup__badge manager-lookup__badge--linked">Linked</span>
    </div>

    <!-- No match → invite note -->
    <p v-else-if="state === 'notfound'" class="manager-lookup__note">
      Not on WIF yet — we'll email an invite to join this team.
    </p>
  </div>
</template>

<style scoped>
.manager-lookup { display: flex; flex-direction: column; gap: 8px; }

/* The spinner sits inside the floating input on the right while searching. */
.floating-input { position: relative; }
.manager-lookup__spinner {
  position: absolute;
  top: 50%;
  right: 14px;
  margin-top: -7px;
  width: 14px;
  height: 14px;
}

.manager-lookup__result {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid var(--border-divider);
  background: var(--surface-card);
}
.manager-lookup__result--found { border-color: var(--primary); }
.manager-lookup__result-text { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; }
.manager-lookup__result-name { font-size: 14px; color: var(--text); }
.manager-lookup__result-sub { font-size: 12.5px; color: var(--secondary); }

.manager-lookup__badge {
  font-size: 11px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 999px;
  white-space: nowrap;
}
.manager-lookup__badge--linked {
  color: var(--primary);
  background: var(--primary-light-3, #eef4fd);
}

.manager-lookup__note {
  margin: 0;
  font-size: 12.5px;
  color: var(--secondary);
  padding: 2px 2px 0;
}
</style>
