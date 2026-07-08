<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { createOpinionPost, type OpinionPost } from '../../api/opinions'
import AppIcon from '../AppIcon.vue'
import TeamAvatar from '../TeamAvatar.vue'
import { pushToast } from '../../toast-center'

const props = withDefaults(defineProps<{
  currentUserName?: string
  currentUserAvatarUrl?: string | null
  canPostAsSpecialist?: boolean
}>(), {
  currentUserName: 'there',
  currentUserAvatarUrl: null,
  canPostAsSpecialist: false
})

const emit = defineEmits<{
  (event: 'created', post: OpinionPost): void
}>()

interface PreviewImage {
  id: string
  name: string
  url: string
}

const content = ref('')
const files = ref<File[]>([])
const previews = ref<PreviewImage[]>([])
const submitting = ref(false)
const focused = ref(false)
const postAsSpecialist = ref(false)
const textareaRef = ref<HTMLTextAreaElement | null>(null)

const canSubmit = computed(() => content.value.trim() !== '' || files.value.length > 0)
// The composer "opens" once the user engages (focus, typed text, or
// attached an image) — collapsed it reads as a single inviting prompt.
const expanded = computed(() => focused.value || canSubmit.value)

watch(
  () => props.canPostAsSpecialist,
  (canPost) => {
    if (!canPost) postAsSpecialist.value = false
  }
)

function revokePreviews() {
  previews.value.forEach((preview) => URL.revokeObjectURL(preview.url))
}

function setFiles(nextFiles: File[]) {
  revokePreviews()
  files.value = nextFiles
  previews.value = nextFiles.map((file, index) => ({
    id: `${file.name}-${file.lastModified}-${index}`,
    name: file.name,
    url: URL.createObjectURL(file)
  }))
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const selected = Array.from(input.files ?? [])
  if (!selected.length) return
  setFiles([...files.value, ...selected].slice(0, 6))
  input.value = ''
}

function removeImage(index: number) {
  setFiles(files.value.filter((_, itemIndex) => itemIndex !== index))
}

function autoGrow() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 260)}px`
}

async function submit() {
  if (!canSubmit.value || submitting.value) return

  submitting.value = true
  try {
    const post = await createOpinionPost({
      content: content.value.trim(),
      images: files.value,
      isSpecialist: postAsSpecialist.value
    })
    content.value = ''
    setFiles([])
    postAsSpecialist.value = false
    focused.value = false
    if (textareaRef.value) textareaRef.value.style.height = 'auto'
    emit('created', post)
    pushToast({ tone: 'success', title: 'Post shared' })
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not share post',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    submitting.value = false
  }
}

onBeforeUnmount(revokePreviews)
</script>

<template>
  <form class="opinion-composer" :class="{ 'opinion-composer--expanded': expanded }" @submit.prevent="submit">
    <div class="opinion-composer__row">
      <TeamAvatar :name="currentUserName" :image-url="currentUserAvatarUrl ?? undefined" size="attendee" />
      <textarea
        ref="textareaRef"
        v-model="content"
        class="opinion-composer__input"
        :placeholder="`What's on your mind, ${currentUserName}?`"
        rows="1"
        :disabled="submitting"
        @focus="focused = true"
        @blur="focused = false"
        @input="autoGrow"
      ></textarea>
    </div>

    <div v-if="previews.length" class="opinion-composer__previews">
      <div v-for="(preview, index) in previews" :key="preview.id" class="opinion-composer__preview">
        <img :src="preview.url" :alt="preview.name" />
        <button type="button" aria-label="Remove image" @click="removeImage(index)">
          <AppIcon name="close" :size="14" />
        </button>
      </div>
    </div>

    <Transition name="opinion-composer-fade">
      <div v-show="expanded" class="opinion-composer__actions">
        <div class="opinion-composer__tools">
          <label
            v-if="canPostAsSpecialist"
            class="opinion-composer__specialist"
            :class="{ 'is-disabled': submitting, 'is-selected': postAsSpecialist }"
          >
            <input v-model="postAsSpecialist" type="checkbox" :disabled="submitting" />
            <span>Specialist</span>
          </label>
          <label class="opinion-composer__attach" :class="{ 'is-disabled': submitting }">
            <span class="opinion-composer__attach-mark"><AppIcon name="document" :size="17" /></span>
            <span>Photo</span>
            <input type="file" accept="image/*" multiple :disabled="submitting" @change="onFileChange" />
          </label>
        </div>
        <button type="submit" class="opinion-composer__submit" :disabled="!canSubmit || submitting">
          <span v-if="submitting" class="opinion-composer__spinner" aria-hidden="true"></span>
          {{ submitting ? 'Posting' : 'Post' }}
        </button>
      </div>
    </Transition>
  </form>
</template>

<style scoped>
.opinion-composer {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--border-divider);
  border-radius: 14px;
  background: var(--surface-card);
  box-shadow: var(--shadow-soft);
  transition: box-shadow 180ms ease, border-color 180ms ease;
}

.opinion-composer--expanded {
  border-color: var(--border-accent);
  box-shadow: var(--shadow);
}

.opinion-composer__row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 12px;
  align-items: center;
}

.opinion-composer--expanded .opinion-composer__row {
  align-items: start;
}

.opinion-composer__input {
  min-width: 0;
  width: 100%;
  min-height: 44px;
  resize: none;
  overflow: hidden;
  border: 1px solid var(--border-divider);
  border-radius: 22px;
  background: var(--surface-raised);
  color: var(--text);
  font-family: var(--font-body);
  font-size: 0.94rem;
  font-weight: 400;
  line-height: 1.5;
  padding: 11px 16px;
  transition: border-color 160ms ease, background 160ms ease, border-radius 160ms ease;
}

.opinion-composer--expanded .opinion-composer__input {
  border-radius: 14px;
  background: var(--surface-opaque);
}

.opinion-composer__input::placeholder {
  color: var(--text-light);
}

.opinion-composer__input:focus {
  border-color: var(--border-accent-hover);
  outline: none;
}

.opinion-composer__previews {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 8px;
  padding-left: 52px;
}

.opinion-composer__preview {
  position: relative;
  overflow: hidden;
  aspect-ratio: 1;
  border: 1px solid var(--border-divider);
  border-radius: 12px;
  background: var(--surface-raised);
}

.opinion-composer__preview img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.opinion-composer__preview button {
  position: absolute;
  top: 6px;
  right: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 999px;
  background: rgba(15, 20, 25, 0.62);
  color: #fff;
  cursor: pointer;
  transition: background 140ms ease;
}

.opinion-composer__preview button:hover {
  background: rgba(15, 20, 25, 0.82);
}

.opinion-composer__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-left: 52px;
}

.opinion-composer__tools {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.opinion-composer__specialist {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 38px;
  padding: 0 12px;
  border-radius: 999px;
  color: var(--secondary);
  background: var(--surface-pill);
  font-size: 0.88rem;
  font-weight: 500;
  cursor: pointer;
}

.opinion-composer__specialist input {
  width: 15px;
  height: 15px;
  accent-color: var(--primary);
}

.opinion-composer__specialist.is-selected {
  color: var(--primary);
  background: var(--primary-light-3);
}

.opinion-composer__attach {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 0 14px 0 8px;
  border-radius: 999px;
  color: var(--secondary);
  cursor: pointer;
  font-size: 0.88rem;
  font-weight: 500;
  transition: background 140ms ease, color 140ms ease;
}

.opinion-composer__attach-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 999px;
  background: var(--surface-pill);
  color: var(--primary);
  transition: background 140ms ease;
}

.opinion-composer__attach:hover {
  background: var(--surface-pill);
  color: var(--primary);
}

.opinion-composer__attach:hover .opinion-composer__attach-mark {
  background: var(--primary-light-3);
}

.opinion-composer__attach.is-disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.opinion-composer__specialist.is-disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.opinion-composer__attach input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.opinion-composer__submit {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 96px;
  min-height: 38px;
  padding: 0 20px;
  border: 0;
  border-radius: 999px;
  background: var(--primary);
  color: #fff;
  font-family: var(--font-body);
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: filter 140ms ease, opacity 140ms ease, box-shadow 140ms ease, transform 140ms ease;
}

.opinion-composer__submit:hover:not(:disabled) {
  filter: brightness(1.04);
}

.opinion-composer__submit:active:not(:disabled) {
  transform: translateY(1px);
}

.opinion-composer__submit:disabled {
  cursor: not-allowed;
  opacity: 0.5;
  box-shadow: none;
}

.opinion-composer__spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.45);
  border-top-color: #fff;
  border-radius: 999px;
  animation: opinion-composer-spin 0.7s linear infinite;
}

.opinion-composer-fade-enter-active,
.opinion-composer-fade-leave-active {
  transition: opacity 160ms ease;
}

.opinion-composer-fade-enter-from,
.opinion-composer-fade-leave-to {
  opacity: 0;
}

@keyframes opinion-composer-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 560px) {
  .opinion-composer__previews,
  .opinion-composer__actions {
    padding-left: 0;
  }
}
</style>
