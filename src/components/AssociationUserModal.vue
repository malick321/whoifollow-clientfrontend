<script setup lang="ts">
// AssociationUserModal
// --------------------
// Add / Edit user form for the Association Users portal. Rendered
// inside SlideModal so the experience is the right-side drawer pattern
// described in the spec.
//
// Modes:
//   - **Edit** (existing user) — `initial` is populated. Name + email
//     fields are read-only (the user's identity is fixed); only role
//     / permissions are editable.
//   - **Invite** (new user) — `initial` is null. Name + email fields
//     are editable. On submit, calls inviteAssociationUser instead of
//     updateAssociationUser.
//
// Validation:
//   - Invite mode requires a non-empty name and a valid-looking email.
//   - Either mode allows submitting with all permissions off + Full
//     Control off (creates a "Member" with no permissions — they exist
//     in the directory but can't do anything until granted).
//
// Permissions UX:
//   - Full Control toggle at the top — when on, the per-permission
//     toggles below are visually disabled and an amber banner explains
//     "this user has full control of the association." Per-permission
//     selections are PRESERVED so toggling Full Control off later
//     restores them (no accidental data loss).
//   - The 6 permission toggles render as a 2-column grid using the
//     existing ToggleSwitch component.

import { computed, ref, watch } from 'vue'
import SlideModal from './SlideModal.vue'
import StatusBadge from './StatusBadge.vue'
import TeamAvatar from './TeamAvatar.vue'
import ToggleSwitch from './ToggleSwitch.vue'
import {
  ASSOCIATION_PERMISSIONS,
  deriveAssociationRoleLabel
} from '../constants/associationPermissions'
import {
  inviteAssociationUser,
  updateAssociationUser
} from '../api/associationUsers'
import { pushToast } from '../toast-center'
import type {
  AssociationPermissionKey,
  AssociationUser,
  AssociationUserStatus,
  SaveAssociationUserPayload
} from '../types'

const props = withDefaults(defineProps<{
  modelValue: boolean
  associationId: string
  /** Display name of the association — rendered as a small uppercase
   *  eyebrow above the modal title in invite mode so the admin always
   *  sees which association they're inviting into. */
  associationName?: string
  /** Existing user to edit. Pass `null` (or omit) for the Invite flow. */
  initial?: AssociationUser | null
}>(), {
  associationName: '',
  initial: null
})

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'saved', user: AssociationUser): void
  /** Fired in edit mode when the admin clicks "Remove User". The
   *  modal closes itself; the view is responsible for confirming and
   *  performing the removal (so the existing inline confirm-remove
   *  strip on the row stays the source of truth). */
  (event: 'remove', user: AssociationUser): void
}>()

// Editable form state. `permissions` is a Set for fast toggle / has
// checks; we serialize back to an array on save.
const name = ref('')
const email = ref('')
const status = ref<AssociationUserStatus>('active')
const fullControl = ref(false)
const permissions = ref<Set<AssociationPermissionKey>>(new Set())
const saving = ref(false)
const submitAttempted = ref(false)

const isEdit = computed(() => Boolean(props.initial))

const title = computed(() =>
  isEdit.value ? 'Edit User' : 'Invite User to Association'
)

// Subtitle now carries the association name — the eyebrow row above
// the title is suppressed so the header is a single title + subtitle
// block. Matches the EventOfficialAccessModal treatment.
const subtitle = computed(() => props.associationName)

/** Hydrate the form whenever the modal opens or the `initial` prop
 *  changes. Resets validation state so a previous submit attempt
 *  doesn't carry over to a new open. */
function hydrate(initial: AssociationUser | null) {
  if (initial) {
    name.value = initial.name
    email.value = initial.email
    status.value = initial.status
    fullControl.value = initial.fullControl
    permissions.value = new Set(initial.permissions)
  } else {
    name.value = ''
    email.value = ''
    status.value = 'active'
    fullControl.value = false
    permissions.value = new Set()
  }
  submitAttempted.value = false
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) hydrate(props.initial ?? null)
  }
)

watch(
  () => props.initial,
  (next) => {
    if (props.modelValue) hydrate(next ?? null)
  }
)

// Validation — invite mode only requires a syntactically valid email.
// Name is derived from the email's local part on submit since the
// invitee fills in their real name when they accept the invitation.
const emailInvalid = computed(() => {
  if (!submitAttempted.value || isEdit.value) return false
  const value = email.value.trim()
  if (!value) return true
  // Loose check — backend will do the real validation when it lands.
  return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
})

const isFormValid = computed(() => {
  if (isEdit.value) return true
  const value = email.value.trim()
  if (!value) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
})

/** Build a placeholder display name from the email local-part (e.g.
 *  "jane.doe@example.com" → "Jane Doe"). Used until the invitee
 *  accepts the invite and sets their real name. */
function deriveNameFromEmail(value: string): string {
  const local = value.split('@')[0] ?? value
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || value
}

const previewRoleLabel = computed(() =>
  deriveAssociationRoleLabel(fullControl.value, [...permissions.value])
)

function togglePermission(key: AssociationPermissionKey, value: boolean) {
  // Full Control disables individual toggles — guard so a stray click
  // can't mutate the underlying selection while disabled.
  if (fullControl.value) return
  const next = new Set(permissions.value)
  if (value) next.add(key)
  else next.delete(key)
  permissions.value = next
}

function close() {
  if (saving.value) return
  emit('update:modelValue', false)
}

function requestRemove() {
  if (saving.value || !props.initial) return
  // Don't close the modal here — the view shows a confirmation popup
  // on top, and the edit modal should only dismiss after the admin
  // actually confirms the deletion. If they cancel, this modal stays
  // open with their unsaved permission edits intact.
  emit('remove', props.initial)
}

async function save() {
  submitAttempted.value = true
  if (!isFormValid.value) return
  saving.value = true
  try {
    const trimmedEmail = email.value.trim()
    const payload: SaveAssociationUserPayload = {
      id: props.initial?.id,
      // In invite mode we don't collect a name — synthesize a sensible
      // placeholder from the email so the row has something to show
      // until the invitee accepts and fills out their profile.
      name: isEdit.value ? name.value.trim() : deriveNameFromEmail(trimmedEmail),
      email: trimmedEmail,
      // Only forward status from the edit flow — invite always begins
      // active in the mock layer (the real backend will set "pending"
      // until the invitee accepts).
      ...(isEdit.value ? { status: status.value } : {}),
      fullControl: fullControl.value,
      permissions: [...permissions.value]
    }
    const result = isEdit.value
      ? await updateAssociationUser(props.associationId, payload)
      : await inviteAssociationUser(props.associationId, payload)
    emit('saved', result)
    emit('update:modelValue', false)
    // Toast is only shown on the invite flow — silent updates feel
    // less noisy when an admin is rapidly tweaking permissions across
    // multiple users in a row.
    if (!isEdit.value) {
      pushToast({
        tone: 'success',
        title: 'Invitation sent',
        message: `${result.name} has been invited to the association.`
      })
    }
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not save',
      message: error instanceof Error ? error.message : 'Something went wrong while saving the user.'
    })
  } finally {
    saving.value = false
  }
}

const submitLabel = computed(() => {
  if (saving.value) return isEdit.value ? 'Saving…' : 'Sending…'
  if (isEdit.value) return 'Save Changes'
  return 'Send Invitation'
})
</script>

<template>
  <SlideModal
    :model-value="modelValue"
    :title="title"
    :subtitle="subtitle"
    @update:modelValue="emit('update:modelValue', $event)"
  >
    <!-- Section 1 — Identity (editable on Invite, read-only on Edit).
         No section heading: the modal title already establishes that
         this section is about the user. -->
    <section class="association-user-modal__section">
      <template v-if="isEdit && initial">
        <!-- Read-only identity card when editing — uses the same
             TeamAvatar + StatusBadge components used in the users list
             so the modal's identity matches the row the admin just
             clicked. Name + email come from the existing record and
             aren't user-editable here. -->
        <div class="association-user-modal__identity-card">
          <TeamAvatar :name="initial.name" :image-url="initial.avatarUrl" size="md" />
          <div class="association-user-modal__identity-copy">
            <strong>{{ initial.name }}</strong>
            <span>{{ initial.email }}</span>
          </div>
          <!-- Active / Inactive toggle — pinned to the right of the
               identity card. Flipping it off marks the user inactive
               (they keep their permissions, but lose access until
               re-activated). -->
          <div class="association-user-modal__identity-status">
            <span class="association-user-modal__identity-status-label">
              {{ status === 'active' ? 'Active' : 'Inactive' }}
            </span>
            <ToggleSwitch
              :model-value="status === 'active'"
              :aria-label="status === 'active' ? 'Active' : 'Inactive'"
              @update:modelValue="status = $event ? 'active' : 'inactive'"
            />
          </div>
        </div>
      </template>
      <template v-else>
        <!-- Floating-label input — label sits inside the field as a
             placeholder until the user focuses or types, then shrinks
             and floats up to notch the top border (Material outlined
             input pattern). -->
        <div class="association-user-modal__field">
          <!-- Validation error is rendered ABOVE the field, anchored
               to the right edge — keeps the error visually attached
               to the input while the help text below stays untouched. -->
          <span
            v-if="emailInvalid"
            class="association-user-modal__error association-user-modal__error--above"
          >Enter a valid email address.</span>
          <div
            class="floating-input"
            :class="{ 'floating-input--invalid': emailInvalid }"
          >
            <input
              id="invite-user-email"
              v-model="email"
              type="email"
              class="floating-input__control"
              placeholder=" "
              autocomplete="email"
            />
            <label for="invite-user-email" class="floating-input__label">Email</label>
          </div>
          <span class="association-user-modal__field-help">
            We'll email an invitation with a link to accept the privileges below.
          </span>
        </div>
      </template>
    </section>

    <!-- Section 2 — Permissions. Full Control sits at the top right
         of the section header; per-permission toggles render as a
         2-column grid below. The amber banner appears whenever Full
         Control is on, explaining that the per-permission toggles are
         overridden. -->
    <section class="association-user-modal__section">
      <header class="association-user-modal__section-head">
        <h3 class="association-user-modal__section-title">Permissions</h3>
        <div class="association-user-modal__full-control">
          <span class="association-user-modal__full-control-label">Full Control</span>
          <ToggleSwitch
            :model-value="fullControl"
            aria-label="Full Control"
            @update:modelValue="fullControl = $event"
          />
        </div>
      </header>

      <!-- Full Control warning — migrated to the shared
           `.app-banner app-banner--warning` utility (defined in
           `src/styles.css`) so this modal, the Event Official
           Access modal, and any future "this toggle implies
           everything else" callout all read identically. The
           `__text` child carries the body copy; no title is set
           here because the original copy was a single sentence. -->
      <div v-if="fullControl" class="app-banner app-banner--warning">
        <div class="app-banner__text">
          <span class="app-banner__sub">
            This user has full control of the association — every permission below is granted.
            Toggle Full Control off to fine-tune individual permissions.
          </span>
        </div>
      </div>

      <div class="association-user-modal__permissions-grid">
        <label
          v-for="permission in ASSOCIATION_PERMISSIONS"
          :key="permission.key"
          class="association-user-modal__permission"
          :class="{ 'association-user-modal__permission--disabled': fullControl }"
        >
          <!-- Label + description stack on the left, toggle vertically
               centered on the right across both lines. -->
          <span class="association-user-modal__permission-copy">
            <span class="association-user-modal__permission-label">{{ permission.label }}</span>
            <span class="association-user-modal__permission-description">{{ permission.description }}</span>
          </span>
          <ToggleSwitch
            :model-value="fullControl ? true : permissions.has(permission.key)"
            :disabled="fullControl"
            :aria-label="permission.label"
            @update:modelValue="togglePermission(permission.key, $event)"
          />
        </label>
      </div>
    </section>

    <template #footer>
      <!-- Edit mode gets a destructive "Remove User" button anchored
           to the LEFT of the footer (via margin-right: auto on the
           class). It hands off to the view's inline confirm strip so
           the actual delete confirmation stays consistent with the
           row's ellipsis-menu Remove flow. -->
      <button
        v-if="isEdit"
        class="danger-light-button association-user-modal__remove-btn"
        type="button"
        :disabled="saving"
        @click="requestRemove"
      >
        Remove User
      </button>
      <button class="secondary-button" type="button" :disabled="saving" @click="close">
        Cancel
      </button>
      <button
        class="primary-button"
        type="button"
        :disabled="saving || (submitAttempted && !isFormValid)"
        @click="save"
      >
        <span v-if="saving" class="btn-spinner" aria-hidden="true"></span>
        {{ submitLabel }}
      </button>
    </template>
  </SlideModal>
</template>
