<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { IonButton, IonIcon, IonNote, IonSpinner } from '@ionic/vue';
import { addOutline, closeOutline, listOutline, thumbsDownOutline, thumbsUpOutline } from 'ionicons/icons';
import FirstTouchPanel from './FirstTouchPanel.vue';
import {
  useLearningPanelApi,
  type LearningPanelMasterySummary,
  type LearningPanelThread,
  type LearningPanelUsageStatus,
} from '../api/learning-panel';

interface Citation {
  source: string;
  title: string;
  content: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  citations: Citation[];
  feedback: {
    messageId: string;
    feedback: 'helpful' | 'unhelpful';
    note: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
}

interface ThreadSummary {
  id: string;
  title: string;
  originSurfaceKey: string | null;
  lastMessageAt: string;
  preview: string;
}

const props = withDefaults(defineProps<{
  surfaceKey?: string;
  showFirstTouch?: boolean;
  embedded?: boolean;
  showClose?: boolean;
  hiddenPath?: string;
  requiredLevel?: string;
}>(), {
  surfaceKey: 'chat',
  showFirstTouch: true,
  embedded: false,
  showClose: false,
  hiddenPath: '',
  requiredLevel: '',
});

const emit = defineEmits<{ close: [] }>();

const api = useLearningPanelApi();
const messages = ref<ChatMessage[]>([]);
const input = ref('');
const loading = ref(false);
const bootstrapping = ref(false);
const chatContainer = ref<HTMLElement | null>(null);
const threadId = ref<string | null>(null);
const starterPrompts = ref<string[]>([]);
const threadSummaries = ref<ThreadSummary[]>([]);
const threadListOpen = ref(false);
const usage = ref<LearningPanelUsageStatus | null>(null);
const mastery = ref<LearningPanelMasterySummary | null>(null);
const feedbackSubmitting = ref<Record<string, boolean>>({});
const feedbackError = ref<string | null>(null);
const sendError = ref<string | null>(null);

const contextLabels: Record<string, string> = {
  chat: 'the app overall',
  dashboard: 'the dashboard',
  predictions: 'analyses and signals',
  portfolios: 'portfolio comparison',
  'risk-dashboard': 'risk framing',
  clubs: 'clubs',
  'club.detail': 'club activity',
  tournaments: 'tournaments',
  messages: 'messages',
  analysts: 'analysts',
  performance: 'performance',
  instruments: 'instrument research',
  'authored.overview': 'your authored content',
};

const contextLabel = computed(() => contextLabels[props.surfaceKey] ?? 'this part of Divinr');
const hasMessages = computed(() => messages.value.length > 0);
const hiddenRouteNotice = computed(() => {
  if (!props.hiddenPath || !props.requiredLevel) return null;
  return `That surface is hidden at your current level. Ask what changes at ${formatLevelLabel(props.requiredLevel)} to unlock ${props.hiddenPath}.`;
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderInlineMarkdown(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function renderMarkdownPreview(value: string): string {
  const lines = value.split('\n');
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let tableRows: string[][] = [];

  function flushParagraph() {
    if (!paragraph.length) return;
    blocks.push(`<p>${paragraph.map((line) => renderInlineMarkdown(line)).join('<br/>')}</p>`);
    paragraph = [];
  }

  function flushList() {
    if (!listItems.length) return;
    blocks.push(`<ul>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</ul>`);
    listItems = [];
  }

  function isTableDivider(cells: string[]): boolean {
    return cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
  }

  function flushTable() {
    if (!tableRows.length) return;
    if (tableRows.length < 2) {
      blocks.push(`<p>${tableRows.flat().map((cell) => renderInlineMarkdown(cell)).join(' | ')}</p>`);
      tableRows = [];
      return;
    }
    const [header, divider, ...body] = tableRows;
    if (!isTableDivider(divider)) {
      blocks.push(`<p>${tableRows.map((row) => row.map((cell) => renderInlineMarkdown(cell)).join(' | ')).join('<br/>')}</p>`);
      tableRows = [];
      return;
    }
    blocks.push([
      '<table><thead><tr>',
      header.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`).join(''),
      '</tr></thead><tbody>',
      body.map((row) => `<tr>${row.map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`).join('')}</tr>`).join(''),
      '</tbody></table>',
    ].join(''));
    tableRows = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      flushTable();
      continue;
    }

    if (/^(\*\s*){3,}$/.test(trimmed) || /^-{3,}$/.test(trimmed)) {
      flushParagraph();
      flushList();
      flushTable();
      blocks.push('<hr/>');
      continue;
    }

    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      flushParagraph();
      flushList();
      tableRows.push(trimmed.slice(1, -1).split('|').map((cell) => cell.trim()));
      continue;
    }

    flushTable();

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = Math.min(headingMatch[1].length + 2, 6);
      blocks.push(`<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph();
      listItems.push(bulletMatch[1]);
      continue;
    }

    const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      flushParagraph();
      listItems.push(orderedMatch[1]);
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  flushTable();
  return blocks.join('');
}

function formatLevelLabel(level: string | null | undefined): string {
  if (!level) return '';
  return level
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function hydrateThread(thread: LearningPanelThread) {
  threadId.value = thread.id;
  messages.value = thread.messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: new Date(message.createdAt),
    citations: message.citations ?? [],
    feedback: message.feedback ?? null,
  }));
  upsertThreadSummary(thread);
}

function usageLabel(currentUsage: LearningPanelUsageStatus | null): string | null {
  if (!currentUsage) return null;
  if (currentUsage.blocked) {
    return `Monthly panel limit reached (${currentUsage.totalCalls}/${currentUsage.callLimit} turns).`;
  }
  if (currentUsage.warning) {
    return `Approaching monthly panel limit (${currentUsage.totalCalls}/${currentUsage.callLimit} turns).`;
  }
  return null;
}

function upsertThreadSummary(thread: LearningPanelThread) {
  const lastMessage = thread.messages[thread.messages.length - 1];
  const summary: ThreadSummary = {
    id: thread.id,
    title: thread.title,
    originSurfaceKey: thread.originSurfaceKey,
    lastMessageAt: lastMessage?.createdAt ?? thread.updatedAt,
    preview: lastMessage?.content ?? '',
  };
  const next = threadSummaries.value.filter((item) => item.id !== thread.id);
  threadSummaries.value = [summary, ...next].sort((a, b) =>
    new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
  );
}

function startNewThread() {
  threadId.value = null;
  messages.value = [];
  input.value = '';
}

async function loadBootstrap() {
  bootstrapping.value = true;
  try {
    const bootstrap = await api.getBootstrap(props.surfaceKey);
    starterPrompts.value = bootstrap.starterPrompts;
    threadSummaries.value = bootstrap.threads;
    usage.value = bootstrap.usage;
    mastery.value = bootstrap.mastery;
    if (!threadId.value && !hasMessages.value && bootstrap.threads[0]) {
      const result = await api.getThread(bootstrap.threads[0].id);
      hydrateThread(result.thread);
      await scrollToBottom();
    }
  } catch {
    starterPrompts.value = [];
    threadSummaries.value = [];
    mastery.value = null;
  } finally {
    bootstrapping.value = false;
  }
}

async function openThread(selectedThreadId: string) {
  if (loading.value || threadId.value === selectedThreadId) return;
  loading.value = true;
  try {
    const result = await api.getThread(selectedThreadId);
    hydrateThread(result.thread);
    threadListOpen.value = false;
  } finally {
    loading.value = false;
    await scrollToBottom();
  }
}

async function sendMessage(prompt?: string) {
  const text = (prompt ?? input.value).trim();
  if (!text || loading.value) return;
  if (usage.value?.blocked) return;

  if (!prompt) input.value = '';
  loading.value = true;
  sendError.value = null;
  await scrollToBottom();

  try {
    if (!threadId.value) {
      const result = await api.createThread({
        originSurfaceKey: props.surfaceKey,
        initialMessage: text,
      });
      hydrateThread(result.thread);
      usage.value = result.usage;
    } else {
      const result = await api.appendMessage(threadId.value, {
        message: text,
        surfaceKey: props.surfaceKey,
      });
      hydrateThread(result.thread);
      usage.value = result.usage;
    }
    threadListOpen.value = false;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('learning_panel_limit_reached')) {
      sendError.value = 'Monthly Learning Panel limit reached. Ask an admin if you need more capacity.';
      if (threadId.value) {
        void loadBootstrap();
      }
    } else {
      messages.value.push({
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: 'Sorry, I had trouble processing that. Please try again.',
        timestamp: new Date(),
        citations: [],
        feedback: null,
      });
    }
  } finally {
    loading.value = false;
    await scrollToBottom();
  }
}

async function submitFeedback(messageId: string, feedback: 'helpful' | 'unhelpful') {
  if (feedbackSubmitting.value[messageId]) return;
  feedbackSubmitting.value = { ...feedbackSubmitting.value, [messageId]: true };
  feedbackError.value = null;
  try {
    const result = await api.submitFeedback(messageId, { feedback });
    messages.value = messages.value.map((message) => (
      message.id === messageId
        ? { ...message, feedback: result.feedback }
        : message
    ));
  } catch {
    feedbackError.value = 'Could not save feedback.';
  } finally {
    feedbackSubmitting.value = { ...feedbackSubmitting.value, [messageId]: false };
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

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    void sendMessage();
  }
}

watch(() => props.surfaceKey, () => {
  if (!threadId.value && !hasMessages.value) {
    void loadBootstrap();
  }
});

onMounted(() => {
  void loadBootstrap();
});
</script>

<template>
  <div class="learning-panel-surface" :class="{ embedded: embedded }">
    <div class="surface-frame">
      <aside class="thread-list" :class="{ 'thread-list-open': threadListOpen }">
        <div class="thread-list-head">
          <div>
            <div class="thread-list-eyebrow">Learning Panel</div>
            <div class="thread-list-title">Threads</div>
          </div>
          <IonButton size="small" fill="outline" @click="startNewThread">
            <IonIcon slot="start" :icon="addOutline" />
            New
          </IonButton>
        </div>

        <div class="thread-list-body">
          <button
            v-for="thread in threadSummaries"
            :key="thread.id"
            class="thread-item"
            :class="{ active: thread.id === threadId }"
            @click="openThread(thread.id)"
          >
            <div class="thread-item-row">
              <span class="thread-item-title">{{ thread.title || 'Conversation' }}</span>
              <span class="thread-item-date">{{ formatUpdatedAt(thread.lastMessageAt) }}</span>
            </div>
            <div class="thread-item-preview">{{ thread.preview.replace(/\s+/g, ' ').trim() || 'No messages yet' }}</div>
          </button>

          <div v-if="!threadSummaries.length && !bootstrapping" class="thread-list-empty">
            No saved threads yet.
          </div>
        </div>
      </aside>

      <section class="conversation-shell">
        <div class="chat-header">
          <div class="chat-header-copy">
            <div class="chat-header-topline">
              <IonButton fill="clear" size="small" class="thread-toggle" @click="threadListOpen = !threadListOpen">
                <IonIcon slot="icon-only" :icon="listOutline" />
              </IonButton>
              <h2>Learning Panel</h2>
            </div>
            <IonNote>Ask about {{ contextLabel }}, risk, portfolios, clubs, tournaments, or what to learn next</IonNote>
            <IonNote v-if="hiddenRouteNotice" color="warning">{{ hiddenRouteNotice }}</IonNote>
            <IonNote v-if="mastery">
              Level: {{ formatLevelLabel(mastery.currentLevel) }}
              <template v-if="mastery.nextLevel">. Next: {{ formatLevelLabel(mastery.nextLevel) }}</template>
            </IonNote>
            <IonNote v-if="usageLabel(usage)" :color="usage?.blocked ? 'danger' : 'warning'">{{ usageLabel(usage) }}</IonNote>
          </div>
          <IonButton
            v-if="showClose"
            fill="clear"
            size="small"
            class="close-btn"
            aria-label="Close Learning Panel"
            @click="emit('close')"
          >
            <IonIcon slot="icon-only" :icon="closeOutline" />
          </IonButton>
        </div>

        <div ref="chatContainer" class="chat-messages">
          <div v-if="bootstrapping && !hasMessages" class="chat-empty loading-state">
            <IonSpinner name="dots" />
          </div>

          <div v-else-if="!hasMessages" class="chat-empty">
            <p class="chat-empty-title">Welcome to the Learning Panel</p>
            <p class="chat-empty-body">This panel is grounded in Divinr itself. Start with one of these prompts.</p>
            <ul v-if="mastery?.nextSuggestedSteps?.length" class="mastery-next-steps">
              <li v-for="step in mastery.nextSuggestedSteps" :key="step">{{ step }}</li>
            </ul>
            <div class="suggestions">
              <button
                v-for="prompt in starterPrompts"
                :key="prompt"
                class="suggestion-chip"
                @click="sendMessage(prompt)"
              >{{ prompt }}</button>
            </div>
          </div>

          <div v-for="message in messages" :key="message.id" :class="['chat-message', message.role]">
            <div class="message-bubble">
              <div
                class="message-content"
                :class="{ 'markdown-content': message.role === 'assistant' }"
              >
                <template v-if="message.role === 'assistant'">
                  <!-- eslint-disable-next-line vue/no-v-html -->
                  <div v-html="renderMarkdownPreview(message.content)" />
                </template>
                <template v-else>
                  {{ message.content }}
                </template>
              </div>
              <div v-if="message.role === 'assistant' && message.citations.length > 0" class="message-citations">
                <div class="message-citations-label">Grounded in</div>
                <ul>
                  <li v-for="citation in message.citations" :key="`${citation.source}-${citation.title}`">
                    {{ citation.title }}
                  </li>
                </ul>
              </div>
              <div class="message-time">{{ formatTime(message.timestamp) }}</div>
              <div v-if="message.role === 'assistant'" class="message-feedback">
                <IonButton
                  size="small"
                  fill="clear"
                  :color="message.feedback?.feedback === 'helpful' ? 'success' : 'medium'"
                  :disabled="feedbackSubmitting[message.id]"
                  @click="submitFeedback(message.id, 'helpful')"
                >
                  <IonIcon slot="icon-only" :icon="thumbsUpOutline" />
                </IonButton>
                <IonButton
                  size="small"
                  fill="clear"
                  :color="message.feedback?.feedback === 'unhelpful' ? 'danger' : 'medium'"
                  :disabled="feedbackSubmitting[message.id]"
                  @click="submitFeedback(message.id, 'unhelpful')"
                >
                  <IonIcon slot="icon-only" :icon="thumbsDownOutline" />
                </IonButton>
              </div>
            </div>
          </div>

          <div v-if="loading" class="chat-message assistant">
            <div class="message-bubble">
              <div class="message-content typing">Analyzing...</div>
            </div>
          </div>
        </div>

        <div class="chat-input-area">
          <div v-if="sendError || feedbackError" class="chat-error">
            {{ sendError || feedbackError }}
          </div>
          <textarea
            v-model="input"
            placeholder="Ask about your instruments, analysts, or market signals..."
            rows="1"
            :disabled="loading || usage?.blocked"
            @keydown="handleKeydown"
          />
          <IonButton :disabled="!input.trim() || loading || usage?.blocked" @click="sendMessage()">
            Send
          </IonButton>
        </div>
      </section>
    </div>

    <FirstTouchPanel v-if="showFirstTouch" surface-key="chat" />
  </div>
</template>

<style scoped>
.learning-panel-surface {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.surface-frame {
  display: grid;
  grid-template-columns: minmax(220px, 240px) minmax(0, 1fr);
  gap: 0;
  min-height: 0;
  flex: 1;
  border: 1px solid var(--ion-color-step-150, #e8e8e8);
  border-radius: 12px;
  overflow: hidden;
  background: var(--ion-background-color, #fff);
}

.embedded .surface-frame {
  height: 100%;
  border: none;
  border-radius: 0;
}

.thread-list {
  background: var(--ion-color-step-50, #fafafa);
  border-right: 1px solid var(--ion-color-step-150, #ececec);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.thread-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--ion-color-step-150, #ececec);
}

.thread-list-eyebrow {
  font-size: 0.7rem;
  text-transform: uppercase;
  color: var(--ion-color-medium);
  font-weight: 700;
}

.thread-list-title {
  font-size: 0.95rem;
  font-weight: 600;
}

.thread-list-body {
  padding: 8px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.thread-item {
  text-align: left;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 8px;
  padding: 10px 12px;
  cursor: pointer;
  color: var(--ion-text-color);
}

.thread-item:hover {
  background: var(--ion-color-primary-tint, rgba(56, 128, 255, 0.08));
}

.thread-item.active {
  background: rgba(56, 128, 255, 0.12);
  border-color: rgba(56, 128, 255, 0.18);
}

.thread-item-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.thread-item-title {
  font-size: 0.86rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.thread-item-date {
  font-size: 0.72rem;
  color: var(--ion-color-medium);
  flex-shrink: 0;
}

.thread-item-preview {
  margin-top: 4px;
  font-size: 0.78rem;
  line-height: 1.35;
  color: var(--ion-color-medium);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.thread-list-empty {
  padding: 16px;
  text-align: center;
  color: var(--ion-color-medium);
  font-size: 0.82rem;
}

.conversation-shell {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.chat-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px 12px;
  border-bottom: 1px solid var(--ion-color-step-150, #eee);
}

.chat-header-copy {
  min-width: 0;
}

.chat-header-topline {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.chat-header h2 {
  margin: 0;
  font-size: 1.1rem;
}

.thread-toggle {
  display: none;
  margin-inline-start: -8px;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}

.chat-empty {
  text-align: center;
  padding: 48px 20px;
  color: var(--ion-color-medium);
}

.chat-empty-title {
  margin: 0 0 8px;
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--ion-text-color);
}

.chat-empty-body {
  margin: 0;
}

.mastery-next-steps {
  margin: 14px auto 0;
  padding-left: 18px;
  max-width: 520px;
  text-align: left;
  color: var(--ion-text-color);
}

.mastery-next-steps li + li {
  margin-top: 8px;
}

.loading-state {
  display: grid;
  place-items: center;
}

.suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin-top: 14px;
}

.suggestion-chip {
  padding: 8px 16px;
  border: 1px solid var(--ion-color-step-200, #ddd);
  border-radius: 999px;
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
  max-width: 76%;
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

.message-content.markdown-content {
  white-space: normal;
}

.message-content.markdown-content :deep(p),
.message-content.markdown-content :deep(ul),
.message-content.markdown-content :deep(h3),
.message-content.markdown-content :deep(h4),
.message-content.markdown-content :deep(h5) {
  margin: 0 0 10px;
}

.message-content.markdown-content :deep(ul) {
  padding-left: 18px;
}

.message-content.markdown-content :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9em;
  background: rgba(15, 23, 42, 0.08);
  border-radius: 4px;
  padding: 1px 4px;
}

.message-content.markdown-content :deep(hr) {
  border: none;
  border-top: 1px solid rgba(15, 23, 42, 0.12);
  margin: 12px 0;
}

.message-content.markdown-content :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 10px;
  font-size: 0.9rem;
}

.message-content.markdown-content :deep(th),
.message-content.markdown-content :deep(td) {
  border: 1px solid rgba(15, 23, 42, 0.12);
  padding: 6px 8px;
  text-align: left;
  vertical-align: top;
}

.message-content.markdown-content :deep(th) {
  background: rgba(15, 23, 42, 0.05);
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

.message-feedback {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-top: 6px;
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
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: flex-end;
  padding: 12px 18px 16px;
  border-top: 1px solid var(--ion-color-step-150, #eee);
}

.chat-error {
  grid-column: 1 / -1;
  color: var(--ion-color-danger);
  font-size: 0.8rem;
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

@media (max-width: 959px) {
  .surface-frame {
    grid-template-columns: minmax(0, 1fr);
  }

  .thread-list {
    display: none;
    border-right: none;
    border-bottom: 1px solid var(--ion-color-step-150, #ececec);
    max-height: 220px;
  }

  .thread-list.thread-list-open {
    display: flex;
  }

  .thread-toggle {
    display: inline-flex;
  }

  .message-bubble {
    max-width: 86%;
  }
}
</style>
