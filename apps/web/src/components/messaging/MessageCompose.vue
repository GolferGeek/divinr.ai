<script setup lang="ts">
import { ref } from 'vue';
import { IonButton, IonIcon } from '@ionic/vue';
import { sendOutline, attachOutline, closeCircleOutline } from 'ionicons/icons';
import AttachmentPicker from './AttachmentPicker.vue';

const emit = defineEmits<{
  send: [body: string, opts?: { attached_entity_type?: string; attached_entity_id?: string }];
}>();

const body = ref('');
const showPicker = ref(false);
const attachedType = ref<string | null>(null);
const attachedId = ref<string | null>(null);
const attachedLabel = ref<string | null>(null);

function handleSend() {
  const text = body.value.trim();
  if (!text) return;
  const opts = attachedType.value && attachedId.value
    ? { attached_entity_type: attachedType.value, attached_entity_id: attachedId.value }
    : undefined;
  emit('send', text, opts);
  body.value = '';
  clearAttachment();
}

function handleKeydown(e: any) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
}

function handleAttachSelect(type: string, id: string, label: string) {
  attachedType.value = type;
  attachedId.value = id;
  attachedLabel.value = label;
  showPicker.value = false;
}

function clearAttachment() {
  attachedType.value = null;
  attachedId.value = null;
  attachedLabel.value = null;
}
</script>

<template>
  <div class="compose-bar">
    <div v-if="attachedLabel" class="attachment-preview">
      <span class="attachment-chip">
        {{ attachedType }}: {{ attachedLabel }}
        <ion-icon :icon="closeCircleOutline" class="remove-attach" @click="clearAttachment" />
      </span>
    </div>
    <div class="compose-row">
      <ion-button fill="clear" class="attach-btn" @click="showPicker = true">
        <ion-icon :icon="attachOutline" />
      </ion-button>
      <textarea
        v-model="body"
        class="compose-input"
        placeholder="Type a message..."
        rows="1"
        @keydown="handleKeydown"
      />
      <ion-button fill="clear" class="send-btn" :disabled="!body.trim()" @click="handleSend">
        <ion-icon :icon="sendOutline" />
      </ion-button>
    </div>
    <AttachmentPicker
      v-if="showPicker"
      @select="handleAttachSelect"
      @close="showPicker = false"
    />
  </div>
</template>

<style scoped>
.compose-bar {
  border-top: 1px solid #e0e0e0;
  background: #fff;
}

.compose-row {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  padding: 8px 16px;
}

.compose-input {
  flex: 1;
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 0.95rem;
  resize: none;
  outline: none;
  font-family: inherit;
  min-height: 40px;
  max-height: 120px;
}

.compose-input:focus {
  border-color: var(--ion-color-primary, #3880ff);
}

.send-btn, .attach-btn {
  min-width: 44px;
  min-height: 44px;
}

.attachment-preview {
  padding: 6px 16px 0;
}

.attachment-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: #e8f0fe;
  color: var(--ion-color-primary, #3880ff);
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 0.8rem;
}

.remove-attach {
  cursor: pointer;
  font-size: 0.9rem;
}
</style>
