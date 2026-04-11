<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { IonButton, IonIcon } from '@ionic/vue';
import { closeOutline } from 'ionicons/icons';
import { useMessagingStore, type Message } from '../../stores/messaging.store';
import MessageCompose from './MessageCompose.vue';

const props = defineProps<{
  channelId: string;
  parentMessage: Message;
}>();

const emit = defineEmits<{
  close: [];
}>();

const store = useMessagingStore();
const replies = ref<Message[]>([]);

async function loadReplies() {
  replies.value = await store.fetchThread(props.channelId, props.parentMessage.id);
}

async function sendReply(body: string) {
  await store.sendMessage(props.channelId, body, { parent_message_id: props.parentMessage.id });
  await loadReplies();
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

onMounted(loadReplies);

// Reload replies when new messages arrive for this channel via SSE
watch(() => store.messagesByChannel[props.channelId]?.length, () => {
  loadReplies();
});
</script>

<template>
  <div class="thread-panel">
    <div class="thread-header">
      <span class="thread-title">Thread</span>
      <ion-button fill="clear" size="small" @click="emit('close')">
        <ion-icon :icon="closeOutline" />
      </ion-button>
    </div>
    <div class="thread-parent">
      <div class="message-sender">{{ parentMessage.sender_id.slice(0, 8) }}</div>
      <div class="message-body">{{ parentMessage.body }}</div>
    </div>
    <div class="thread-replies">
      <div v-for="reply in replies" :key="reply.id" class="reply-bubble">
        <div class="reply-header">
          <span class="message-sender">{{ reply.sender_id.slice(0, 8) }}</span>
          <span class="message-time">{{ formatTime(reply.created_at) }}</span>
        </div>
        <div class="message-body">{{ reply.body }}</div>
      </div>
    </div>
    <MessageCompose @send="sendReply" />
  </div>
</template>

<style scoped>
.thread-panel {
  display: flex;
  flex-direction: column;
  border-left: 1px solid #e0e0e0;
  width: 350px;
  max-width: 100%;
  background: #fafafa;
}

.thread-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid #e0e0e0;
  font-weight: 600;
  font-size: 0.9rem;
}

.thread-parent {
  padding: 12px;
  background: #f0f0f0;
  border-bottom: 1px solid #e0e0e0;
}

.thread-replies {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.reply-bubble {
  padding: 8px 10px;
  background: #fff;
  border-radius: 8px;
  border: 1px solid #eee;
}

.reply-header {
  display: flex;
  gap: 8px;
  align-items: baseline;
  margin-bottom: 2px;
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
  font-size: 0.85rem;
  line-height: 1.4;
  white-space: pre-wrap;
}

@media (max-width: 768px) {
  .thread-panel {
    width: 100%;
    border-left: none;
  }
}
</style>
