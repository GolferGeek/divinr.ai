<script setup lang="ts">
import { IonModal, IonButton } from '@ionic/vue';
import { computed } from 'vue';
import { useOnboardingStore } from '../stores/onboarding.store';

const onboarding = useOnboardingStore();

const isOpen = computed(() => onboarding.showCompletionModal);

async function finish() {
  // Completing the 'done' step sets completed_at and dismisses the modal.
  await onboarding.completeStep('done');
}
</script>

<template>
  <ion-modal :is-open="isOpen" :backdrop-dismiss="false" class="completion-modal">
    <div class="completion-content">
      <div class="confetti-burst" aria-hidden="true">
        <span v-for="i in 20" :key="i" :class="'confetti c' + i" />
      </div>
      <h1>You're ready</h1>
      <p class="tagline">
        The whole platform is now unlocked. Explore freely.
      </p>
      <p class="note">
        Want to run the tour again? It's in your profile menu under "Retake onboarding tour."
      </p>
      <ion-button expand="block" color="primary" @click="finish">
        Explore Divinr →
      </ion-button>
    </div>
  </ion-modal>
</template>

<style scoped>
.completion-modal {
  --height: auto;
  --width: min(480px, 90vw);
  --border-radius: 16px;
}
.completion-content {
  padding: 48px 28px 28px;
  text-align: center;
  position: relative;
  overflow: hidden;
}
.completion-content h1 {
  margin: 0 0 10px;
  font-size: 2rem;
  font-weight: 700;
}
.tagline {
  margin: 0 0 18px;
  font-size: 1.05rem;
  color: var(--ion-text-color);
}
.note {
  margin: 0 0 28px;
  font-size: 0.9rem;
  color: var(--ion-color-medium);
  line-height: 1.5;
}

.confetti-burst {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.confetti {
  position: absolute;
  top: -20px;
  width: 8px;
  height: 14px;
  border-radius: 2px;
  opacity: 0;
  animation: confetti-fall 2.5s ease-out forwards;
}
.confetti.c1  { left: 10%; background: #f59e0b; animation-delay: 0.05s; }
.confetti.c2  { left: 18%; background: #ef4444; animation-delay: 0.20s; }
.confetti.c3  { left: 26%; background: #10b981; animation-delay: 0.10s; }
.confetti.c4  { left: 34%; background: #3b82f6; animation-delay: 0.25s; }
.confetti.c5  { left: 42%; background: #a855f7; animation-delay: 0.15s; }
.confetti.c6  { left: 50%; background: #f59e0b; animation-delay: 0.30s; }
.confetti.c7  { left: 58%; background: #ef4444; animation-delay: 0.00s; }
.confetti.c8  { left: 66%; background: #10b981; animation-delay: 0.35s; }
.confetti.c9  { left: 74%; background: #3b82f6; animation-delay: 0.08s; }
.confetti.c10 { left: 82%; background: #a855f7; animation-delay: 0.22s; }
.confetti.c11 { left: 14%; background: #ef4444; animation-delay: 0.40s; }
.confetti.c12 { left: 22%; background: #3b82f6; animation-delay: 0.12s; }
.confetti.c13 { left: 30%; background: #a855f7; animation-delay: 0.28s; }
.confetti.c14 { left: 38%; background: #10b981; animation-delay: 0.18s; }
.confetti.c15 { left: 46%; background: #f59e0b; animation-delay: 0.45s; }
.confetti.c16 { left: 54%; background: #3b82f6; animation-delay: 0.32s; }
.confetti.c17 { left: 62%; background: #ef4444; animation-delay: 0.06s; }
.confetti.c18 { left: 70%; background: #f59e0b; animation-delay: 0.38s; }
.confetti.c19 { left: 78%; background: #10b981; animation-delay: 0.14s; }
.confetti.c20 { left: 86%; background: #a855f7; animation-delay: 0.26s; }

@keyframes confetti-fall {
  0%   { transform: translateY(-20px) rotate(0deg); opacity: 1; }
  100% { transform: translateY(280px) rotate(420deg); opacity: 0; }
}
</style>
