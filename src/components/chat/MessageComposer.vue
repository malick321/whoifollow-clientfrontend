<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from '../AppIcon.vue'
import { useChatStore } from '../../stores/chat'
import type { ChatMessage } from '../../api/chat'
import { formatFileSize, isAudioFile, isImageFile, isVideoFile } from './chat-format'
import { prepareChatUploadFiles, type PreparedChatFile } from '../../lib/chat-media'
import { pushToast } from '../../toast-center'

const props = defineProps<{
  conversationId: string
  recipientName?: string
  replyTo?: ChatMessage | null
}>()

const emit = defineEmits<{
  (e: 'cancel-reply'): void
  (e: 'sent'): void
}>()

const store = useChatStore()

type PendingFileKind = 'image' | 'video' | 'audio' | 'file'

interface PendingFile {
  id: string
  file: File
  thumbnailFile: File | null
  name: string
  type: string
  size: number
  previewUrl: string
  thumbnailPreviewUrl: string | null
  kind: PendingFileKind
}

const text = ref('')
const textarea = ref<HTMLTextAreaElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const pendingFiles = ref<PendingFile[]>([])
const sending = ref(false)
const preparingFiles = ref(false)

const placeholder = computed(() =>
  props.recipientName ? `Type your message for ${props.recipientName}` : 'Type your message'
)
const canSend = computed(() => text.value.trim().length > 0 || pendingFiles.value.length > 0)

// ── Typing emit (debounced start, idle stop) ─────────────────────────────
let typingActive = false
let idleTimer: ReturnType<typeof setTimeout> | null = null

function signalTyping() {
  if (!typingActive) {
    typingActive = true
    store.setTyping(props.conversationId, true)
  }
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(stopTyping, 2500)
}

function stopTyping() {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  if (typingActive) {
    typingActive = false
    store.setTyping(props.conversationId, false)
  }
}

function autoGrow() {
  const el = textarea.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 140)}px`
}

watch(text, () => {
  void nextTick(autoGrow)
})

// Reset typing + draft when switching conversations.
watch(
  () => props.conversationId,
  () => {
    stopTyping()
    text.value = ''
    clearPendingFiles()
  }
)

function onInput() {
  if (text.value.trim()) signalTyping()
  else stopTyping()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    void send()
  }
}

async function send() {
  const content = text.value.trim()
  if (sending.value || preparingFiles.value || (!content && !pendingFiles.value.length)) return

  sending.value = true
  try {
    if (pendingFiles.value.length) {
      const files = [...pendingFiles.value]
      const payload = files.map((f) => ({
        file: f.file,
        thumbnailFile: f.thumbnailFile,
        name: f.name,
        type: f.type || 'application/octet-stream',
        size: f.size
      }))
      store.sendFiles(props.conversationId, payload, content, props.replyTo)
      clearPendingFiles()
    } else {
      store.sendMessage(props.conversationId, content, props.replyTo)
    }
    text.value = ''
    stopTyping()
    emit('sent')
    void nextTick(autoGrow)
  } catch (error) {
    console.error('[chat] Failed to prepare attachment upload', error)
  } finally {
    sending.value = false
  }
}

function pickFiles() {
  if (sending.value || preparingFiles.value) return
  fileInput.value?.click()
}

function pendingFileKind(file: File): PendingFileKind {
  if (isImageFile(file.type, file.name)) return 'image'
  if (isVideoFile(file.type, file.name)) return 'video'
  if (isAudioFile(file.type, file.name)) return 'audio'
  return 'file'
}

function pendingFileId(file: File, index: number): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${index}-${file.name}-${file.size}`
}

function addPendingFiles(files: PreparedChatFile[]) {
  const next = files.map((item, index) => {
    const file = item.file
    return {
      id: pendingFileId(file, index),
      file,
      thumbnailFile: item.thumbnail,
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      previewUrl: URL.createObjectURL(file),
      thumbnailPreviewUrl: item.thumbnail ? URL.createObjectURL(item.thumbnail) : null,
      kind: pendingFileKind(file)
    }
  })
  pendingFiles.value = [...pendingFiles.value, ...next]
}

function revokePreview(url: string) {
  URL.revokeObjectURL(url)
}

function clearPendingFiles() {
  pendingFiles.value.forEach((file) => {
    revokePreview(file.previewUrl)
    if (file.thumbnailPreviewUrl) revokePreview(file.thumbnailPreviewUrl)
  })
  pendingFiles.value = []
}

function removePendingFile(id: string) {
  const file = pendingFiles.value.find((item) => item.id === id)
  if (file) {
    revokePreview(file.previewUrl)
    if (file.thumbnailPreviewUrl) revokePreview(file.thumbnailPreviewUrl)
  }
  pendingFiles.value = pendingFiles.value.filter((item) => item.id !== id)
}

async function onFilesPicked(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files ? Array.from(input.files) : []
  if (!files.length) return

  preparingFiles.value = true
  try {
    const existingBytes = pendingFiles.value.reduce((sum, file) => sum + file.size, 0)
    const prepared = await prepareChatUploadFiles(files, pendingFiles.value.length, existingBytes)
    if (prepared.accepted.length) {
      addPendingFiles(prepared.accepted)
    }
    if (prepared.rejected.length) {
      pushToast({
        tone: 'warning',
        title: prepared.rejected.length === 1 ? 'File not added' : `${prepared.rejected.length} files not added`,
        message: prepared.rejected[0]?.reason
      })
    }
    if (prepared.optimizedCount) {
      pushToast({
        tone: 'success',
        title: prepared.optimizedCount === 1 ? 'Image optimized' : 'Images optimized',
        message: 'Compressed before upload.'
      })
    }
  } catch (error) {
    console.error('[chat] Failed to prepare attachments', error)
    pushToast({
      tone: 'warning',
      title: 'Could not prepare files',
      message: 'Please try again.'
    })
  } finally {
    preparingFiles.value = false
    input.value = ''
    void nextTick(() => textarea.value?.focus())
  }
}

onBeforeUnmount(() => {
  stopTyping()
  clearPendingFiles()
})
</script>

<template>
  <div class="composer">
    <div v-if="replyTo" class="composer__reply">
      <div class="composer__reply-body">
        <span class="composer__reply-name">Replying to {{ replyTo.senderName }}</span>
        <span class="composer__reply-preview">
          {{ replyTo.content || (replyTo.hasFile ? 'Attachment' : '') }}
        </span>
      </div>
      <button
        type="button"
        class="composer__reply-cancel"
        aria-label="Cancel reply"
        @click="emit('cancel-reply')"
      >
        <AppIcon name="close" :size="16" />
      </button>
    </div>

    <div v-if="pendingFiles.length" class="composer__attachments" aria-label="Selected attachments">
      <article
        v-for="file in pendingFiles"
        :key="file.id"
        class="composer__attachment"
        :class="`composer__attachment--${file.kind}`"
      >
        <div class="composer__attachment-preview">
          <img v-if="file.kind === 'image'" :src="file.previewUrl" :alt="file.name" />
          <video
            v-else-if="file.kind === 'video'"
            :src="file.previewUrl"
            muted
            playsinline
            preload="metadata"
          />
          <audio
            v-else-if="file.kind === 'audio'"
            class="composer__attachment-audio"
            :src="file.previewUrl"
            controls
            preload="metadata"
          />
          <AppIcon v-else name="document" :size="22" />
        </div>
        <span class="composer__attachment-meta">
          <span class="composer__attachment-name">{{ file.name }}</span>
          <span v-if="file.size" class="composer__attachment-size">{{ formatFileSize(file.size) }}</span>
        </span>
        <button
          type="button"
          class="composer__attachment-remove"
          :aria-label="`Remove ${file.name}`"
          :disabled="sending"
          @click="removePendingFile(file.id)"
        >
          <AppIcon name="close" :size="14" />
        </button>
      </article>
    </div>

    <div class="composer__bar">
      <button
        type="button"
        class="composer__attach"
        aria-label="Attach files"
        title="Attach files"
        :disabled="sending || preparingFiles"
        @click="pickFiles"
      >
        <AppIcon name="folder" :size="22" />
      </button>
      <input
        ref="fileInput"
        type="file"
        multiple
        class="composer__file-input"
        :disabled="sending || preparingFiles"
        @change="onFilesPicked"
      />

      <textarea
        ref="textarea"
        v-model="text"
        class="composer__input"
        :placeholder="placeholder"
        rows="1"
        @input="onInput"
        @keydown="onKeydown"
        @blur="stopTyping"
      />

      <button
        type="button"
        class="composer__send"
        :disabled="sending || preparingFiles || !canSend"
        aria-label="Send message"
        title="Send"
        @click="send"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 12 20 4l-4 16-4-7-8-1z" fill="currentColor" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.composer {
  flex: 0 0 auto;
  border-top: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
  background: var(--surface-card, #fff);
  padding: 10px 14px;
}

.composer__reply {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding: 6px 10px;
  border-left: 3px solid var(--primary, #2d8cf0);
  border-radius: 4px;
  background: var(--surface-pill, rgba(248, 250, 253, 0.94));
}

.composer__reply-body {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.composer__reply-name {
  color: var(--secondary, #2f5f98);
  font-size: 0.74rem;
  font-weight: 500;
}

.composer__reply-preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-light, #787f8d);
  font-size: 0.78rem;
  font-weight: 400;
}

.composer__reply-cancel {
  display: inline-flex;
  border: none;
  background: transparent;
  color: var(--text-light, #787f8d);
  cursor: pointer;
}

.composer__attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.composer__attachment {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  max-width: 260px;
  padding: 6px 30px 6px 6px;
  border: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
  border-radius: 8px;
  background: var(--surface-pill, rgba(248, 250, 253, 0.94));
}

.composer__attachment--audio {
  flex-direction: column;
  align-items: stretch;
  max-width: 320px;
  padding: 8px 30px 8px 8px;
}

.composer__attachment-preview {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 52px;
  height: 52px;
  overflow: hidden;
  border-radius: 7px;
  background: rgba(0, 0, 0, 0.04);
  color: var(--secondary, #2f5f98);
}

html.dark-mode .composer__attachment-preview {
  background: rgba(255, 255, 255, 0.05);
}

.composer__attachment-preview img,
.composer__attachment-preview video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.composer__attachment--audio .composer__attachment-preview {
  order: 2;
  width: 100%;
  height: 38px;
  justify-content: flex-start;
  background: transparent;
}

.composer__attachment-audio {
  width: 100%;
  max-width: 100%;
}

.composer__attachment-meta {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  flex-direction: column;
}

.composer__attachment--audio .composer__attachment-meta {
  order: 1;
}

.composer__attachment-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text, #2e3137);
  font-size: 0.78rem;
  font-weight: 500;
}

.composer__attachment-size {
  color: var(--text-light, #787f8d);
  font-size: 0.7rem;
  font-weight: 400;
}

.composer__attachment-remove {
  position: absolute;
  top: 5px;
  right: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: var(--surface-opaque, rgba(255, 255, 255, 0.98));
  color: var(--text-light, #787f8d);
  box-shadow: var(--shadow-soft, 0 6px 16px rgba(36, 60, 91, 0.05));
  cursor: pointer;
}

.composer__attachment-remove:disabled {
  opacity: 0.5;
  cursor: default;
}

.composer__bar {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.composer__attach,
.composer__send {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  background: transparent;
}

.composer__attach {
  color: var(--secondary, #2f5f98);
}

.composer__attach:hover {
  background: var(--surface-pill, rgba(248, 250, 253, 0.94));
}

.composer__attach:disabled {
  opacity: 0.5;
  cursor: default;
}

.composer__file-input {
  display: none;
}

.composer__input {
  flex: 1 1 auto;
  min-width: 0;
  resize: none;
  max-height: 140px;
  padding: 10px 14px;
  border: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
  border-radius: 18px;
  background: var(--surface-pill, rgba(248, 250, 253, 0.94));
  color: var(--text, #2e3137);
  font-family: var(--font-body);
  font-size: 0.9rem;
  font-weight: 400;
  line-height: 1.4;
  outline: none;
}

.composer__input::placeholder {
  color: var(--text-light, #787f8d);
}

.composer__input:focus {
  border-color: var(--border-accent-hover, rgba(45, 140, 240, 0.45));
}

.composer__send {
  color: #fff;
  background: var(--primary);
}

.composer__send:disabled {
  opacity: 0.5;
  cursor: default;
}

@media (max-width: 520px) {
  .composer {
    padding: 8px 8px 9px;
  }

  .composer__bar {
    gap: 6px;
  }

  .composer__attach,
  .composer__send {
    width: 36px;
    height: 36px;
  }

  .composer__input {
    min-height: 36px;
    padding: 8px 12px;
    font-size: 0.82rem;
    line-height: 1.35;
    border-radius: 16px;
  }

  .composer__attachment,
  .composer__attachment--audio {
    max-width: 100%;
  }
}
</style>
