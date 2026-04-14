<script setup lang="ts">
import { IonIcon } from '@ionic/vue';
import {
  closeOutline,
  chevronForwardOutline,
  pauseOutline,
} from 'ionicons/icons';
import { computed } from 'vue';
import { tourContent } from '../onboarding/tour-content';
import { useOnboardingStore } from '../stores/onboarding.store';

const onboarding = useOnboardingStore();

const step = computed(() => tourContent[onboarding.currentStep]);

// Render a minimal subset of markdown (paragraphs + **bold** + *italic* + `code`).
// Copy is authored and checked into tour-content.ts — not user input — so v-html is safe.
function renderBody(md: string): string {
  const escaped = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const inlined = escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return inlined
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

async function next() {
  await onboarding.completeStep(onboarding.currentStep);
}

async function skipTour() {
  if (window.confirm('Skip the tour and unlock everything?')) {
    await onboarding.skip();
  }
}

function pause() {
  onboarding.closeDocent();
}
</script>

<template>
  <aside
    v-if="onboarding.active && onboarding.docentVisible && onboarding.currentStep !== 'done'"
    class="docent-panel"
    aria-label="Onboarding tour"
  >
    <div class="docent-header">
      <span class="step-badge">Step {{ onboarding.progress.done }} of {{ onboarding.progress.total }}</span>
      <button class="icon-btn" aria-label="Pause tour" @click="pause">
        <ion-icon :icon="pauseOutline" />
      </button>
    </div>
    <div class="progress-bar">
      <div
        class="progress-fill"
        :style="{ width: (onboarding.progress.done / onboarding.progress.total * 100) + '%' }"
      />
    </div>
    <div class="docent-body">
      <h3>{{ step.title }}</h3>
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div class="body-content" v-html="renderBody(step.body)" />
      <p v-if="step.cta" class="cta-note">👉 {{ step.cta.label }}</p>
    </div>
    <div v-if="onboarding.lockedFlash" class="locked-flash">
      {{ onboarding.lockedFlash }}
    </div>
    <div class="docent-footer">
      <button class="skip-link" @click="skipTour">Skip tour</button>
      <button
        v-if="step.completion.kind === 'got_it'"
        class="next-btn"
        @click="next"
      >
        Next
        <ion-icon :icon="chevronForwardOutline" />
      </button>
      <button
        v-else
        class="next-btn waiting"
        disabled
        :title="step.cta?.label ?? 'Complete the action to continue'"
      >
        {{ step.cta?.label ?? 'Complete action to continue' }}
      </button>
    </div>
  </aside>
</template>

<style scoped>
.docent-panel {
  position: fixed;
  right: 16px;
  top: 72px;
  bottom: 16px;
  width: 360px;
  max-width: calc(100vw - 32px);
  background: var(--ion-background-color, #fff);
  border: 1px solid var(--ion-color-light-shade, #e5e7eb);
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  z-index: 1000;
  overflow: hidden;
}

.docent-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px 8px;
}

.step-badge {
  font-size: 0.78rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ion-color-medium);
}

.icon-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--ion-color-medium);
  padding: 4px;
  display: flex;
  align-items: center;
  font-size: 1.2rem;
}
.icon-btn:hover { color: var(--ion-color-medium-shade); }

.progress-bar {
  height: 3px;
  background: var(--ion-color-light, #f1f5f9);
  margin: 0 18px 12px;
  border-radius: 2px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: var(--ion-color-primary);
  transition: width 0.3s ease;
}

.docent-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px 18px 12px;
}
.docent-body h3 {
  margin: 0 0 10px;
  font-size: 1.15rem;
  font-weight: 700;
}
.body-content :deep(p) {
  margin: 0 0 12px;
  line-height: 1.5;
  color: var(--ion-text-color);
}
.cta-note {
  margin-top: 16px;
  padding: 12px;
  background: var(--ion-color-primary-tint, #dbeafe);
  border-radius: 8px;
  font-size: 0.92rem;
  color: var(--ion-color-primary-shade, #1e40af);
}

.locked-flash {
  margin: 0 18px 8px;
  padding: 10px 14px;
  background: var(--ion-color-warning-tint, #fef3c7);
  color: var(--ion-color-warning-shade, #92400e);
  border-radius: 8px;
  font-size: 0.88rem;
}

.docent-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 18px 16px;
  border-top: 1px solid var(--ion-color-light-shade, #e5e7eb);
}
.skip-link {
  background: none;
  border: none;
  color: var(--ion-color-medium);
  font-size: 0.85rem;
  cursor: pointer;
  padding: 6px 4px;
}
.skip-link:hover { color: var(--ion-color-medium-shade); text-decoration: underline; }
.next-btn {
  background: var(--ion-color-primary);
  color: var(--ion-color-primary-contrast, #fff);
  border: none;
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.next-btn:hover:not(.waiting) {
  background: var(--ion-color-primary-shade);
}
.next-btn.waiting {
  background: var(--ion-color-light, #f1f5f9);
  color: var(--ion-color-medium);
  cursor: not-allowed;
  font-size: 0.85rem;
  font-weight: 500;
}

@media (max-width: 900px) {
  .docent-panel {
    right: 0;
    left: 0;
    top: auto;
    bottom: 0;
    width: 100%;
    max-width: 100%;
    max-height: 55vh;
    border-radius: 16px 16px 0 0;
  }
}
</style>
