<script setup lang="ts">
import { onMounted, ref, watch, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonIcon, IonButton } from '@ionic/vue';
import {
  chatbubblesOutline, personOutline, peopleOutline,
  megaphoneOutline, trophyOutline, arrowBackOutline,
  chatbubbleOutline, pinOutline,
} from 'ionicons/icons';
import { useMessagingStore, type Channel, type Message } from '../stores/messaging.store';
import MessageCompose from '../components/messaging/MessageCompose.vue';
import MessageThread from '../components/messaging/MessageThread.vue';
import EntityAttachmentCard from '../components/messaging/EntityAttachmentCard.vue';

const store = useMessagingStore();
const route = useRoute();
const router = useRouter();
const mobileShowThread = ref(false);
const threadParent = ref<Message | null>(null);
const showEmojiPicker = ref<string | null>(null);
const pinnedMessages = ref<Message[]>([]);
const showPinned = ref(false);

const commonEmojis = ['👍', '👎', '❤️', '😂', '🎉', '🔥', '👀', '💯'];

const groupedChannels = computed(() => {
  const groups: Record<string, Channel[]> = { dm: [], club: [], tournament: [], system: [] };
  for (const ch of store.channels) {
    if (groups[ch.scope]) groups[ch.scope].push(ch);
  }
  return groups;
});

const scopeLabels: Record<string, string> = {
  dm: 'Direct Messages',
  club: 'Clubs',
  tournament: 'Tournaments',
  system: 'System',
};

const scopeIcons: Record<string, string> = {
  dm: personOutline,
  club: peopleOutline,
  tournament: trophyOutline,
  system: megaphoneOutline,
};

function channelDisplayName(ch: Channel): string {
  if (ch.name) return ch.name;
  if (ch.scope === 'dm') return 'Direct Message';
  return ch.scope;
}

async function selectChannel(channelId: string) {
  store.activeChannelId = channelId;
  threadParent.value = null;
  await store.fetchMessages(channelId);
  store.markRead(channelId);
  mobileShowThread.value = true;
  pinnedMessages.value = await store.fetchPinnedMessages(channelId);
  router.replace(`/messages/${channelId}`);
}

function goBackToList() {
  mobileShowThread.value = false;
  store.activeChannelId = null;
  router.replace('/messages');
}

async function handleSend(body: string, opts?: { attached_entity_type?: string; attached_entity_id?: string }) {
  if (!store.activeChannelId) return;
  await store.sendMessage(store.activeChannelId, body, opts);
}

function openThread(msg: Message) {
  threadParent.value = msg;
}

function closeThread() {
  threadParent.value = null;
}

async function handleReaction(messageId: string, emoji: string) {
  await store.addReaction(messageId, emoji);
  showEmojiPicker.value = null;
  if (store.activeChannelId) store.fetchMessages(store.activeChannelId);
}

async function handleTogglePin(messageId: string) {
  await store.togglePin(messageId);
  if (store.activeChannelId) {
    pinnedMessages.value = await store.fetchPinnedMessages(store.activeChannelId);
    store.fetchMessages(store.activeChannelId);
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

onMounted(async () => {
  await store.fetchChannels();
  const channelId = route.params.channelId as string;
  if (channelId) {
    selectChannel(channelId);
  }
});

watch(() => route.params.channelId, (id) => {
  if (id && id !== store.activeChannelId) {
    selectChannel(id as string);
  }
});
</script>

<template>
  <div class="messages-container">
    <!-- Channel List -->
    <div class="channel-list" :class="{ 'mobile-hidden': mobileShowThread }">
      <div class="channel-list-header">
        <h2>Messages</h2>
      </div>

      <div v-if="store.loading" class="empty-state">Loading...</div>
      <div v-else-if="store.channels.length === 0" class="empty-state">
        <ion-icon :icon="chatbubblesOutline" class="empty-icon" />
        <p>No conversations yet</p>
      </div>
      <div v-else class="channel-groups">
        <template v-for="scope in ['dm', 'club', 'tournament', 'system']" :key="scope">
          <div v-if="groupedChannels[scope]?.length" class="channel-group">
            <div class="group-header">
              <ion-icon :icon="scopeIcons[scope]" />
              <span>{{ scopeLabels[scope] }}</span>
            </div>
            <div
              v-for="ch in groupedChannels[scope]"
              :key="ch.id"
              class="channel-row"
              :class="{ active: ch.id === store.activeChannelId }"
              @click="selectChannel(ch.id)"
            >
              <div class="channel-info">
                <span class="channel-name">{{ channelDisplayName(ch) }}</span>
                <span v-if="ch.last_message_body" class="channel-preview">{{ ch.last_message_body }}</span>
              </div>
              <div class="channel-meta">
                <span v-if="ch.last_message_at" class="channel-time">{{ formatTime(ch.last_message_at) }}</span>
                <span v-if="ch.unread_count > 0" class="unread-badge">{{ ch.unread_count }}</span>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- Message Thread -->
    <div class="message-thread" :class="{ 'mobile-visible': mobileShowThread }">
      <div v-if="!store.activeChannelId" class="empty-state thread-empty">
        <ion-icon :icon="chatbubblesOutline" class="empty-icon" />
        <p>Select a conversation</p>
      </div>
      <template v-else>
        <div class="thread-header">
          <ion-button fill="clear" class="back-btn" @click="goBackToList">
            <ion-icon :icon="arrowBackOutline" />
          </ion-button>
          <span class="thread-title">
            {{ channelDisplayName(store.channels.find(c => c.id === store.activeChannelId)!) }}
          </span>
        </div>
        <!-- Pinned messages section -->
        <div v-if="pinnedMessages.length > 0 && showPinned" class="pinned-section">
          <div class="pinned-header" @click="showPinned = !showPinned">
            <ion-icon :icon="pinOutline" /> {{ pinnedMessages.length }} pinned
          </div>
          <div v-for="pm in pinnedMessages" :key="pm.id" class="pinned-msg">
            <span class="message-sender">{{ pm.sender_id.slice(0, 8) }}</span>: {{ pm.body }}
          </div>
        </div>
        <div v-else-if="pinnedMessages.length > 0" class="pinned-header pinned-collapsed" @click="showPinned = true">
          <ion-icon :icon="pinOutline" /> {{ pinnedMessages.length }} pinned message{{ pinnedMessages.length > 1 ? 's' : '' }}
        </div>

        <div class="thread-messages">
          <div
            v-for="msg in [...store.activeMessages].reverse()"
            :key="msg.id"
            class="message-bubble"
          >
            <div class="message-header">
              <span class="message-sender">{{ msg.sender_id.slice(0, 8) }}</span>
              <span class="message-time">{{ formatTime(msg.created_at) }}</span>
            </div>
            <div class="message-body">{{ msg.body }}</div>
            <EntityAttachmentCard
              v-if="msg.attached_entity_type && msg.attached_entity_id"
              :entity-type="msg.attached_entity_type"
              :entity-id="msg.attached_entity_id"
            />
            <div class="message-actions">
              <button v-if="msg.reply_count" class="action-btn reply-count" @click="openThread(msg)">
                <ion-icon :icon="chatbubbleOutline" /> {{ msg.reply_count }}
              </button>
              <button v-else class="action-btn" @click="openThread(msg)">
                <ion-icon :icon="chatbubbleOutline" />
              </button>
              <button class="action-btn" @click="showEmojiPicker = showEmojiPicker === msg.id ? null : msg.id">
                😀
              </button>
              <button class="action-btn" @click="handleTogglePin(msg.id)">
                <ion-icon :icon="pinOutline" />
              </button>
            </div>
            <!-- Emoji picker -->
            <div v-if="showEmojiPicker === msg.id" class="emoji-grid">
              <button
                v-for="e in commonEmojis"
                :key="e"
                class="emoji-btn"
                @click="handleReaction(msg.id, e)"
              >{{ e }}</button>
            </div>
          </div>
        </div>

        <MessageCompose @send="handleSend" />
        <MessageThread
          v-if="threadParent && store.activeChannelId"
          :channel-id="store.activeChannelId"
          :parent-message="threadParent"
          @close="closeThread"
        />
      </template>
    </div>
  </div>
</template>

<style scoped>
.messages-container {
  display: flex;
  height: calc(100vh - 120px);
  max-width: 1200px;
  margin: 0 auto;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}

.channel-list {
  width: 320px;
  min-width: 280px;
  border-right: 1px solid #e0e0e0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.channel-list-header {
  padding: 16px;
  border-bottom: 1px solid #e0e0e0;
}

.channel-list-header h2 {
  margin: 0;
  font-size: 1.1rem;
}

.channel-groups {
  flex: 1;
  overflow-y: auto;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px 4px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  color: #888;
}

.channel-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  cursor: pointer;
  transition: background 0.15s;
}

.channel-row:hover { background: #f5f5f5; }
.channel-row.active { background: #e8f0fe; }

.channel-info {
  flex: 1;
  min-width: 0;
}

.channel-name {
  display: block;
  font-weight: 500;
  font-size: 0.9rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.channel-preview {
  display: block;
  font-size: 0.8rem;
  color: #888;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}

.channel-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  margin-left: 8px;
}

.channel-time {
  font-size: 0.7rem;
  color: #aaa;
}

.unread-badge {
  background: var(--ion-color-primary, #3880ff);
  color: #fff;
  font-size: 0.65rem;
  font-weight: 700;
  min-width: 18px;
  height: 18px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 5px;
}

.message-thread {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.thread-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid #e0e0e0;
  font-weight: 600;
}

.back-btn {
  display: none;
}

.thread-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.message-bubble {
  max-width: 80%;
  padding: 10px 14px;
  background: #f0f0f0;
  border-radius: 12px;
}

.message-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
}

.message-sender {
  font-weight: 600;
  font-size: 0.8rem;
  color: var(--ion-color-primary, #3880ff);
}

.message-time {
  font-size: 0.7rem;
  color: #aaa;
}

.message-body {
  font-size: 0.9rem;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
}

.message-actions {
  display: flex;
  gap: 4px;
  margin-top: 6px;
  opacity: 0;
  transition: opacity 0.15s;
}

.message-bubble:hover .message-actions {
  opacity: 1;
}

.action-btn {
  background: none;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 0.75rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 3px;
  color: #666;
}

.action-btn:hover {
  background: #eee;
}

.action-btn.reply-count {
  color: var(--ion-color-primary, #3880ff);
  border-color: var(--ion-color-primary, #3880ff);
}

.emoji-grid {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 6px;
  padding: 6px;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 8px;
}

.emoji-btn {
  background: none;
  border: none;
  font-size: 1.2rem;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
}

.emoji-btn:hover {
  background: #f0f0f0;
}

.pinned-section {
  padding: 8px 16px;
  background: #fffbe6;
  border-bottom: 1px solid #e0e0e0;
}

.pinned-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  font-weight: 600;
  color: #b8860b;
  cursor: pointer;
  padding: 6px 16px;
}

.pinned-collapsed {
  border-bottom: 1px solid #e0e0e0;
  background: #fffbe6;
}

.pinned-msg {
  font-size: 0.8rem;
  padding: 4px 0;
  color: #555;
}

.thread-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.empty-state {
  text-align: center;
  padding: 3rem 1rem;
  color: #888;
}

.empty-icon {
  font-size: 3rem;
  margin-bottom: 8px;
  opacity: 0.3;
}

@media (max-width: 768px) {
  .messages-container {
    height: calc(100vh - 100px);
    border: none;
    border-radius: 0;
  }

  .channel-list {
    width: 100%;
    min-width: 100%;
  }

  .channel-list.mobile-hidden {
    display: none;
  }

  .message-thread {
    display: none;
  }

  .message-thread.mobile-visible {
    display: flex;
  }

  .back-btn {
    display: block;
  }
}
</style>
