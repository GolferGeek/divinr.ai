<script setup lang="ts">
import { IonModal, IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonButton, IonIcon, IonNote } from '@ionic/vue';
import { closeOutline } from 'ionicons/icons';
import type { Tournament } from '../stores/tournament.store';

defineProps<{
  isOpen: boolean;
  tournaments: Tournament[];
}>();

const emit = defineEmits<{
  select: [tournamentId: string];
  dismiss: [];
}>();

function typeLabel(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
</script>

<template>
  <ion-modal :is-open="isOpen" @didDismiss="emit('dismiss')">
    <ion-header>
      <ion-toolbar>
        <ion-title>Pick a tournament</ion-title>
        <ion-buttons slot="end">
          <ion-button fill="clear" @click="emit('dismiss')">
            <ion-icon :icon="closeOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <ion-note v-if="tournaments.length === 0">No active tournaments available.</ion-note>
      <div v-else class="picker-list">
        <button
          v-for="t in tournaments"
          :key="t.id"
          class="picker-row"
          type="button"
          @click="emit('select', t.id)"
        >
          <div class="picker-row-title">{{ t.name }}</div>
          <div class="picker-row-meta">
            <span>{{ typeLabel(t.tournament_type) }}</span>
            <span>Virtual Balance: ${{ Number(t.starting_balance).toLocaleString() }}</span>
          </div>
        </button>
      </div>
    </ion-content>
  </ion-modal>
</template>

<style scoped>
.picker-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.picker-row {
  width: 100%;
  text-align: left;
  background: var(--ion-color-light);
  color: var(--ion-text-color);
  border: 1px solid var(--ion-color-step-200, #e0e0e0);
  border-radius: 8px;
  padding: 12px 16px;
  cursor: pointer;
  transition: background 0.15s;
}
.picker-row:hover, .picker-row:focus-visible {
  background: var(--ion-color-step-150, #ededed);
  outline: 2px solid var(--ion-color-primary);
}
.picker-row-title {
  font-weight: 600;
  margin-bottom: 4px;
}
.picker-row-meta {
  display: flex;
  gap: 12px;
  font-size: 0.8rem;
  color: var(--ion-color-medium);
}
</style>
