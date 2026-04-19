<script setup lang="ts">
import { IonIcon } from '@ionic/vue';
import { closeOutline, eyeOffOutline } from 'ionicons/icons';
import { useFirstTouch } from '../composables/useFirstTouch';

const props = defineProps<{ surfaceKey: string }>();

const { visible, content, dismiss, muteAll } = useFirstTouch(props.surfaceKey);
</script>

<template>
  <aside
    v-if="visible && content"
    class="first-touch-panel"
    role="note"
    :aria-label="`${content.title} — first-time introduction`"
  >
    <button class="close-btn" aria-label="Dismiss" @click="dismiss">
      <ion-icon :icon="closeOutline" />
    </button>
    <h3>{{ content.title }}</h3>
    <p class="body">{{ content.body }}</p>
    <div v-if="content.cta" class="cta-row">
      <router-link :to="content.cta.to" class="cta-link" @click="dismiss">
        {{ content.cta.label }}
      </router-link>
    </div>
    <div class="footer">
      <button class="got-it" @click="dismiss">Got it</button>
      <button class="mute-all" @click="muteAll">
        <ion-icon :icon="eyeOffOutline" />
        Don't show me these anymore
      </button>
    </div>
  </aside>
</template>

<style scoped>
.first-touch-panel {
  position: fixed;
  right: 20px;
  bottom: 20px;
  width: 340px;
  max-width: calc(100vw - 32px);
  background: var(--ion-background-color, #fff);
  border: 1px solid var(--ion-color-light-shade, #e5e7eb);
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
  padding: 18px 18px 14px;
  z-index: 900;
  pointer-events: auto;
}

.close-btn {
  position: absolute;
  top: 10px;
  right: 10px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--ion-color-medium);
  font-size: 1.2rem;
  padding: 4px;
  display: flex;
  align-items: center;
}
.close-btn:hover { color: var(--ion-color-medium-shade); }

h3 {
  margin: 0 0 10px;
  padding-right: 22px;
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--ion-text-color);
}

.body {
  margin: 0 0 12px;
  line-height: 1.5;
  color: var(--ion-text-color);
  font-size: 0.94rem;
}

.cta-row {
  margin: 0 0 14px;
}
.cta-link {
  display: inline-block;
  padding: 8px 14px;
  background: var(--ion-color-primary, #3b82f6);
  color: var(--ion-color-primary-contrast, #fff);
  border-radius: 6px;
  font-size: 0.9rem;
  font-weight: 600;
  text-decoration: none;
}
.cta-link:hover {
  background: var(--ion-color-primary-shade, #2563eb);
}

.footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--ion-color-light-shade, #e5e7eb);
}

.got-it {
  background: var(--ion-color-primary);
  color: var(--ion-color-primary-contrast, #fff);
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
}
.got-it:hover { background: var(--ion-color-primary-shade); }

.mute-all {
  background: none;
  border: none;
  color: var(--ion-color-medium);
  font-size: 0.82rem;
  cursor: pointer;
  padding: 6px 4px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.mute-all:hover { color: var(--ion-color-medium-shade); text-decoration: underline; }
.mute-all ion-icon { font-size: 1rem; }

@media (max-width: 900px) {
  .first-touch-panel {
    right: 12px;
    left: 12px;
    bottom: 12px;
    width: auto;
  }
}
</style>
