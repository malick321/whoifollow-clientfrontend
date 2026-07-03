<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import AppIcon from '../AppIcon.vue'
import { useChatStore } from '../../stores/chat'
import type { ChatMessage } from '../../api/chat'

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

const text = ref('')
const textarea = ref<HTMLTextAreaElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const placeholder = computed(() =>
  props.recipientName ? `Type your message for ${props.recipientName}` : 'Type your message'
)

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
  }
)

function onInput() {
  if (text.value.trim()) signalTyping()
  else stopTyping()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}

function send() {
  const content = text.value.trim()
  if (!content) return
  store.sendMessage(props.conversationId, content, props.replyTo)
  text.value = ''
  stopTyping()
  emit('sent')
  void nextTick(autoGrow)
}

function pickFiles() {
  fileInput.value?.click()
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      // Strip the `data:<mime>;base64,` prefix — the gateway expects raw base64.
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

async function onFilesPicked(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files ? Array.from(input.files) : []
  if (!files.length) return

  const payload = await Promise.all(
    files.map(async (f) => ({
      base64: await readFileAsBase64(f),
      name: f.name,
      type: f.type || 'application/octet-stream',
      size: f.size
    }))
  )

  store.sendFiles(props.conversationId, payload, text.value.trim(), props.replyTo)
  text.value = ''
  stopTyping()
  emit('sent')
  input.value = ''
}
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

    <div class="composer__bar">
      <button
        type="button"
        class="composer__attach"
        aria-label="Attach files"
        title="Attach files"
        @click="pickFiles"
      >
        <AppIcon name="folder" :size="22" />
      </button>
      <input
        ref="fileInput"
        type="file"
        multiple
        class="composer__file-input"
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
        :disabled="!text.trim()"
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
</style>
