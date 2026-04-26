<script setup lang="ts">
import { ref, nextTick, onMounted } from 'vue';
import { IonButton, IonNote } from '@ionic/vue';
import { useLearningPanelApi } from '../api/learning-panel';
import FirstTouchPanel from '../components/FirstTouchPanel.vue';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  citations: Array<{ source: string; title: string; content: string }>;
}

const api = useLearningPanelApi();
const messages = ref<ChatMessage[]>([]);
const input = ref('');
const loading = ref(false);
const chatContainer = ref<HTMLElement | null>(null);
const threadId = ref<string | null>(null);
const starterPrompts = ref<string[]>([]);

function hydrateThread(thread: {
  id: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    createdAt: string;
    citations: Array<{ source: string; title: string; content: string }>;
  }>;
}) {
  threadId.value = thread.id;
  messages.value = thread.messages.map((message) => ({
    role: message.role,
    content: message.content,
    timestamp: new Date(message.createdAt),
    citations: message.citations ?? [],
  }));
}

async function loadBootstrap() {
  try {
    const bootstrap = await api.getBootstrap('chat');
    starterPrompts.value = bootstrap.starterPrompts;
    const latestThread = bootstrap.threads[0];
    if (latestThread) {
      const result = await api.getThread(latestThread.id);
      hydrateThread(result.thread);
      await scrollToBottom();
    }
  } catch {
    starterPrompts.value = [];
  }
}

async function sendMessage() {
  const text = input.value.trim();
  if (!text || loading.value) return;

  messages.value.push({ role: 'user', content: text, timestamp: new Date(), citations: [] });
  input.value = '';
  loading.value = true;
  await scrollToBottom();

  try {
    if (!threadId.value) {
      const result = await api.createThread({
        originSurfaceKey: 'chat',
        initialMessage: text,
      });
      hydrateThread(result.thread);
    } else {
      const result = await api.appendMessage(threadId.value, {
        message: text,
        surfaceKey: 'chat',
      });
      hydrateThread(result.thread);
    }
  } catch (err) {
    messages.value.push({
      role: 'assistant',
      content: 'Sorry, I had trouble processing that. Please try again.',
      timestamp: new Date(),
      citations: [],
    });
  } finally {
    loading.value = false;
    await scrollToBottom();
  }
}

async function scrollToBottom() {
  await nextTick();
  if (chatContainer.value) {
    chatContainer.value.scrollTop = chatContainer.value.scrollHeight;
  }
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

onMounted(loadBootstrap);
</script>

<template>
  <div class="chat-container">
    <div class="chat-header">
      <h2>Learning Panel</h2>
      <IonNote>Ask about analyses, risk, portfolios, clubs, tournaments, or what to learn next</IonNote>
    </div>

    <div ref="chatContainer" class="chat-messages">
      <div v-if="messages.length === 0" class="chat-empty">
        <p style="font-size:1.1rem;font-weight:600;margin-bottom:8px">Welcome to the Learning Panel</p>
        <p style="opacity:0.7">Try asking:</p>
        <div class="suggestions">
          <button
            v-for="prompt in starterPrompts"
            :key="prompt"
            class="suggestion-chip"
            @click="input = prompt; sendMessage()"
          >{{ prompt }}</button>
        </div>
      </div>

      <div v-for="(msg, i) in messages" :key="i" :class="['chat-message', msg.role]">
        <div class="message-bubble">
          <div class="message-content">{{ msg.content }}</div>
          <div v-if="msg.role === 'assistant' && msg.citations.length > 0" class="message-citations">
            <div class="message-citations-label">Grounded in</div>
            <ul>
              <li v-for="citation in msg.citations" :key="`${citation.source}-${citation.title}`">
                {{ citation.title }}
              </li>
            </ul>
          </div>
          <div class="message-time">{{ formatTime(msg.timestamp) }}</div>
        </div>
      </div>

      <div v-if="loading" class="chat-message assistant">
        <div class="message-bubble">
          <div class="message-content typing">Analyzing...</div>
        </div>
      </div>
    </div>

    <div class="chat-input-area">
      <textarea
        v-model="input"
        placeholder="Ask about your instruments, analysts, or market signals..."
        rows="1"
        :disabled="loading"
        @keydown="handleKeydown"
      />
      <IonButton :disabled="!input.trim() || loading" @click="sendMessage">
        Send
      </IonButton>
    </div>

    <FirstTouchPanel surface-key="chat" />
  </div>
</template>

<style scoped>
.chat-container {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 120px);
  max-width: 800px;
  margin: 0 auto;
}

.chat-header {
  padding: 16px 0 12px;
  border-bottom: 1px solid var(--ion-color-step-150, #eee);
}

.chat-header h2 {
  margin: 0 0 4px;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.chat-empty {
  text-align: center;
  padding: 40px 20px;
  color: var(--ion-color-medium);
}

.suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin-top: 12px;
}

.suggestion-chip {
  padding: 8px 16px;
  border: 1px solid var(--ion-color-step-200, #ddd);
  border-radius: 20px;
  background: transparent;
  cursor: pointer;
  font-size: 0.85rem;
  color: var(--ion-color-primary);
  transition: background 0.15s;
}

.suggestion-chip:hover {
  background: var(--ion-color-primary-tint, rgba(56, 128, 255, 0.08));
}

.chat-message {
  display: flex;
}

.chat-message.user {
  justify-content: flex-end;
}

.chat-message.assistant {
  justify-content: flex-start;
}

.message-bubble {
  max-width: 75%;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 0.9rem;
  line-height: 1.5;
}

.chat-message.user .message-bubble {
  background: var(--ion-color-primary);
  color: white;
  border-bottom-right-radius: 4px;
}

.chat-message.assistant .message-bubble {
  background: var(--ion-color-step-100, #f0f0f0);
  color: var(--ion-text-color);
  border-bottom-left-radius: 4px;
}

.message-content {
  white-space: pre-wrap;
  word-break: break-word;
}

.message-content.typing {
  opacity: 0.6;
  font-style: italic;
}

.message-time {
  font-size: 0.65rem;
  opacity: 0.5;
  margin-top: 4px;
}

.message-citations {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.14);
  font-size: 0.72rem;
}

.chat-message.assistant .message-citations {
  border-top-color: var(--ion-color-step-250, #d8d8d8);
}

.message-citations-label {
  opacity: 0.7;
  margin-bottom: 4px;
  font-weight: 600;
}

.message-citations ul {
  margin: 0;
  padding-left: 16px;
}

.chat-input-area {
  display: flex;
  gap: 8px;
  align-items: flex-end;
  padding: 12px 0;
  border-top: 1px solid var(--ion-color-step-150, #eee);
}

.chat-input-area textarea {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid var(--ion-color-step-200, #ddd);
  border-radius: 12px;
  font-size: 0.9rem;
  resize: none;
  font-family: inherit;
  line-height: 1.5;
  min-height: 42px;
  max-height: 120px;
  background: var(--ion-background-color, white);
  color: var(--ion-text-color);
}

.chat-input-area textarea:focus {
  outline: none;
  border-color: var(--ion-color-primary);
}

@media (max-width: 768px) {
  .chat-container {
    height: calc(100vh - 80px);
  }

  .message-bubble {
    max-width: 85%;
  }
}
</style>
