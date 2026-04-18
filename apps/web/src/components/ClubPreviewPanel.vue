<script setup lang="ts">
import { IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonButton, IonNote } from '@ionic/vue';
import { pluralize } from '../utils/format';

defineProps<{
  club: {
    id: string;
    name: string;
    description: string | null;
    is_public: boolean;
    member_count?: number;
    tournament_count?: number;
  };
}>();
</script>

<template>
  <IonCard class="preview-card">
    <IonCardHeader>
      <IonCardTitle>{{ club.name }}</IonCardTitle>
    </IonCardHeader>
    <IonCardContent>
      <p v-if="club.description" class="preview-desc">{{ club.description }}</p>
      <p v-else class="preview-desc muted">No description yet.</p>
      <div class="preview-stats">
        <IonNote>{{ pluralize(club.member_count ?? 0, 'member') }} · {{ pluralize(club.tournament_count ?? 0, 'tournament') }}</IonNote>
      </div>
      <p class="preview-note">
        You're not a member yet. Ask a current member for an invite link or enter a club code to join.
      </p>
      <div class="preview-actions">
        <IonButton size="small" fill="outline" disabled>Enter Code to Join</IonButton>
      </div>
    </IonCardContent>
  </IonCard>
</template>

<style scoped>
.preview-card { margin-top: 1rem; }
.preview-desc { margin: 0 0 0.75rem 0; color: var(--ion-color-dark); }
.preview-desc.muted { color: var(--ion-color-medium); font-style: italic; }
.preview-stats { margin-bottom: 0.75rem; }
.preview-note { font-size: 0.9rem; color: var(--ion-color-medium); margin: 0.5rem 0 0.75rem 0; }
.preview-actions { display: flex; gap: 0.5rem; }
</style>
