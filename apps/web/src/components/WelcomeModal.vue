<script setup lang="ts">
import { IonModal, IonButton } from '@ionic/vue';
import { computed } from 'vue';
import { useOnboardingStore } from '../stores/onboarding.store';

const onboarding = useOnboardingStore();

const isOpen = computed(() => onboarding.showWelcomeModal);

async function startTour() {
  await onboarding.start();
}

async function skipTour() {
  await onboarding.skip();
}
</script>

<template>
  <ion-modal :is-open="isOpen" :backdrop-dismiss="false" class="welcome-modal">
    <div class="welcome-content">
      <h1>Welcome to Divinr</h1>
      <p class="tagline">AI market analysis that shows its work.</p>
      <p class="pitch">
        Divinr has a lot going on — five AI analysts, risk debates, portfolios, clubs, tournaments.
        Want a 10-minute tour to show you what's where?
      </p>
      <div class="actions">
        <ion-button expand="block" color="primary" @click="startTour">
          Start the tour
        </ion-button>
        <button class="skip-link" @click="skipTour">
          Skip — I'll figure it out
        </button>
      </div>
    </div>
  </ion-modal>
</template>

<style scoped>
.welcome-modal {
  --height: auto;
  --width: min(480px, 90vw);
  --border-radius: 16px;
}
.welcome-content {
  padding: 32px 28px;
  text-align: center;
}
.welcome-content h1 {
  margin: 0 0 8px;
  font-size: 1.75rem;
  font-weight: 700;
}
.tagline {
  margin: 0 0 20px;
  color: var(--ion-color-medium);
  font-size: 1rem;
}
.pitch {
  margin: 0 0 28px;
  line-height: 1.5;
  color: var(--ion-text-color);
}
.actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.skip-link {
  background: none;
  border: none;
  color: var(--ion-color-medium);
  font-size: 0.9rem;
  cursor: pointer;
  padding: 8px;
}
.skip-link:hover {
  color: var(--ion-color-medium-shade);
  text-decoration: underline;
}
</style>
