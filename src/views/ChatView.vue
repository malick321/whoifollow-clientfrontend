<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import ConversationList from '../components/chat/ConversationList.vue'
import MessageThread from '../components/chat/MessageThread.vue'
import ChatInfoPanel from '../components/chat/ChatInfoPanel.vue'
import AddTeamModal from '../components/chat/AddTeamModal.vue'
import StartChatModal from '../components/chat/StartChatModal.vue'
import ChatLockScreen from '../components/chat/ChatLockScreen.vue'
import AppIcon from '../components/AppIcon.vue'
import { useChatStore } from '../stores/chat'
import { useChatLockStore } from '../stores/chatLock'
import type { ChatConversation } from '../api/chat'

const store = useChatStore()
const lock = useChatLockStore()
const route = useRoute()
const { activeConversationId } = storeToRefs(store)

// Details panel is open by default (per design); it only actually renders once
// a conversation is active (see the `v-if="activeId && showInfo"` gate below).
const showInfo = ref(true)
const addTeamOpen = ref(false)
const startChatOpen = ref(false)

const activeId = computed(() => activeConversationId.value)

// The active conversation is behind a per-conversation lock (unlock it inline).
const activeConvLocked = computed(() => !!activeId.value && lock.isConversationLocked(activeId.value))
async function unlockActiveConv(pin: string): Promise<boolean> {
  return activeId.value ? lock.unlockConversation(activeId.value, pin) : false
}

// Auto-lock: re-lock when the tab has been hidden past the idle threshold.
function onVisibility() {
  if (document.visibilityState === 'hidden') {
    lock.touch()
  } else {
    lock.maybeAutoLock()
  }
}

async function openConversationFromQuery() {
  const id = String(route.query.conversationId ?? '')
  if (!id) return
  if (!store.conversations.length) await store.loadConversations()
  await store.openConversation(id)
}

onMounted(() => {
  store.connect()
  void store.loadConversations().then(openConversationFromQuery)
  void lock.load()
  document.addEventListener('visibilitychange', onVisibility)
})

watch(
  () => route.query.conversationId,
  () => { void openConversationFromQuery() }
)

onBeforeUnmount(() => {
  store.disconnect()
  document.removeEventListener('visibilitychange', onVisibility)
})

function backToList() {
  if (activeConversationId.value) store.closeConversation(activeConversationId.value)
}

function addTeam() {
  addTeamOpen.value = true
}

function startChat() {
  startChatOpen.value = true
}

async function onTeamCreated(conversation: ChatConversation | null) {
  if (conversation) {
    store.upsertConversation(conversation)
    await store.openConversation(conversation.id)
  }
  void store.loadConversations()
}
</script>

<template>
  <!-- App-level lock: the whole chat surface is gated behind the PIN. -->
  <div v-if="lock.isAppLocked" class="chat-view chat-view--locked">
    <ChatLockScreen
      title="Your chats are locked"
      subtitle="Enter your PIN to open your conversations."
      :verify="lock.unlockApp"
    />
  </div>

  <div v-else class="chat-view" :class="{ 'chat-view--thread': activeId, 'chat-view--info': showInfo }">
    <div class="chat-view__list">
      <ConversationList @add-team="addTeam" @start-chat="startChat" />
    </div>

    <div class="chat-view__thread">
      <!-- Per-conversation lock gate. -->
      <ChatLockScreen
        v-if="activeId && activeConvLocked"
        title="This chat is locked"
        subtitle="Enter your PIN to open this conversation."
        :verify="unlockActiveConv"
      />
      <MessageThread
        v-else-if="activeId"
        :key="activeId"
        :conversation-id="activeId"
        @back="backToList"
        @toggle-info="showInfo = !showInfo"
      />
      <div v-else class="chat-view__placeholder">
        <span class="chat-view__placeholder-icon">
          <AppIcon name="message" :size="40" />
        </span>
        <p class="chat-view__placeholder-title">Your messages</p>
        <p class="chat-view__placeholder-sub">Select a conversation to start chatting.</p>
      </div>
    </div>

    <div v-if="activeId && showInfo && !activeConvLocked" class="chat-view__info">
      <ChatInfoPanel :conversation-id="activeId" @close="showInfo = false" />
    </div>

    <AddTeamModal v-model="addTeamOpen" @created="onTeamCreated" />
    <StartChatModal v-model="startChatOpen" />
  </div>
</template>

<style scoped>
.chat-view {
  display: grid;
  grid-template-columns: 340px minmax(0, 1fr);
  /* Explicit viewport height so the 3-pane always fills the screen regardless
     of ancestor height — keeps the composer pinned to the bottom (no page
     scroll, no "message field below the fold"). `dvh` handles mobile chrome. */
  height: calc(100vh - 56px);
  height: calc(100dvh - 56px);
  min-height: 0;
  overflow: hidden;
  background: var(--body-bg, #f5f7fb);
}

.chat-view--info {
  grid-template-columns: 340px minmax(0, 1fr) 320px;
}

/* App-lock overlay fills the whole chat area (no grid columns). */
.chat-view--locked {
  display: block;
}

.chat-view__list,
.chat-view__thread,
.chat-view__info {
  min-width: 0;
  min-height: 0;
  height: 100%;
}

.chat-view__placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 100%;
  font-family: var(--font-body);
  background: var(--surface-card, #fff);
}

.chat-view__placeholder-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 76px;
  height: 76px;
  margin-bottom: 10px;
  border-radius: 50%;
  background: var(--surface-pill, rgba(248, 250, 253, 0.94));
  color: var(--secondary, #2f5f98);
}

.chat-view__placeholder-title {
  margin: 0;
  color: var(--text, #2e3137);
  font-size: 1.05rem;
  font-weight: 500;
}

.chat-view__placeholder-sub {
  margin: 0;
  color: var(--text-light, #787f8d);
  font-size: 0.9rem;
  font-weight: 400;
}

/* ── Responsive: collapse to list ↔ thread navigation ─────────────────── */
@media (max-width: 1080px) {
  .chat-view--info {
    /* Drop the right info pane to an overlay rather than a third column. */
    grid-template-columns: 340px minmax(0, 1fr);
  }

  .chat-view__info {
    position: fixed;
    top: 56px;
    right: 0;
    bottom: 0;
    width: min(320px, 86vw);
    z-index: 40;
    box-shadow: var(--shadow, 0 10px 24px rgba(36, 60, 91, 0.08));
  }
}

@media (max-width: 840px) {
  .chat-view,
  .chat-view--info {
    grid-template-columns: 1fr;
  }

  /* Narrow: show the list by default; once a conversation is open, swap
     to the thread (the thread header carries a Back button). */
  .chat-view__thread {
    display: none;
  }

  .chat-view--thread .chat-view__list {
    display: none;
  }

  .chat-view--thread .chat-view__thread {
    display: block;
  }
}
</style>
