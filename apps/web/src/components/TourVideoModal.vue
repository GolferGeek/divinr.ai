<script setup lang="ts">
import { IonModal, IonIcon } from '@ionic/vue';
import { closeOutline } from 'ionicons/icons';
import { computed } from 'vue';
import { toEmbedUrl } from '../onboarding/types';

const props = defineProps<{
  isOpen: boolean;
  url: string | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const embedUrl = computed(() => (props.url ? toEmbedUrl(props.url) : null));

function close() {
  emit('close');
}
</script>

<template>
  <ion-modal
    :is-open="isOpen"
    class="tour-video-modal"
    @did-dismiss="close"
  >
    <div class="video-modal-shell">
      <button class="close-btn" aria-label="Close video" @click="close">
        <ion-icon :icon="closeOutline" />
      </button>
      <div class="video-frame">
        <iframe
          v-if="embedUrl"
          :src="embedUrl"
          title="Onboarding tour video"
          frameborder="0"
          webkitallowfullscreen
          mozallowfullscreen
          allowfullscreen
          allow="autoplay; fullscreen; picture-in-picture"
        />
      </div>
    </div>
  </ion-modal>
</template>

<style scoped>
.tour-video-modal {
  --width: min(880px, 92vw);
  --height: auto;
  --max-height: 90vh;
  --border-radius: 12px;
}

.video-modal-shell {
  position: relative;
  background: #000;
  border-radius: 12px;
  overflow: hidden;
}

.close-btn {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.4rem;
  z-index: 2;
  transition: background 0.15s;
}
.close-btn:hover {
  background: rgba(0, 0, 0, 0.85);
}

/* Responsive 16:9 frame */
.video-frame {
  position: relative;
  width: 100%;
  padding-top: 56.25%; /* 9/16 */
  background: #000;
}

.video-frame iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
}

@media (max-width: 600px) {
  .tour-video-modal {
    --width: 100vw;
    --max-height: 100vh;
    --border-radius: 0;
  }
  .video-modal-shell {
    border-radius: 0;
  }
}
</style>
