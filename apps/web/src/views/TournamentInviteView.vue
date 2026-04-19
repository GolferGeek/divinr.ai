<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonButton, IonChip, IonNote } from '@ionic/vue';
import { useTournamentStore, type Tournament } from '../stores/tournament.store';

import FirstTouchPanel from '../components/FirstTouchPanel.vue';
const store = useTournamentStore();
const route = useRoute();
const router = useRouter();
const token = route.params.token as string;
const tournament = ref<Tournament | null>(null);
const entrantCount = ref(0);
const error = ref('');
const joined = ref(false);

onMounted(async () => {
  try {
    const details = await store.fetchInviteDetails(token);
    tournament.value = details.tournament;
    entrantCount.value = details.entrant_count;
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : String(e);
  }
});

async function join() {
  try {
    await store.acceptInvite(token);
    joined.value = true;
    if (tournament.value) {
      router.push(`/tournaments/${tournament.value.id}`);
    }
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

function typeLabel(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
</script>

<template>
  <div class="invite-page">
    <h1>Tournament Invitation</h1>
    <p class="disclaimer">
      Divinr is an AI analysis game. Virtual portfolios use simulated trades for educational and entertainment purposes. Not investment advice.
    </p>

    <div v-if="error" class="error">{{ error }}</div>

    <IonCard v-else-if="tournament">
      <IonCardHeader>
        <IonCardTitle>{{ tournament.name }}</IonCardTitle>
        <div class="meta">
          <IonChip :color="tournament.status === 'active' ? 'success' : 'warning'">{{ tournament.status }}</IonChip>
          <IonChip color="tertiary">{{ typeLabel(tournament.tournament_type) }}</IonChip>
        </div>
      </IonCardHeader>
      <IonCardContent>
        <p v-if="tournament.description">{{ tournament.description }}</p>
        <div class="details">
          <IonNote>Virtual Balance: ${{ Number(tournament.starting_balance).toLocaleString() }}</IonNote>
          <IonNote>{{ entrantCount }} player{{ entrantCount !== 1 ? 's' : '' }} entered</IonNote>
          <IonNote>{{ new Date(tournament.starts_at).toLocaleDateString() }} - {{ new Date(tournament.ends_at).toLocaleDateString() }}</IonNote>
        </div>
        <IonButton v-if="!joined" expand="block" @click="join" class="join-btn">
          Join Game
        </IonButton>
        <p v-else class="joined">You've joined! Redirecting...</p>
      </IonCardContent>
    </IonCard>

    <div v-else class="loading">Loading invitation...</div>
  
  <FirstTouchPanel surface-key="tournament.invite-landing" />
  </div>
</template>

<style scoped>
.invite-page { padding: 1rem; max-width: 500px; margin: 0 auto; }
.disclaimer { font-size: 0.75rem; color: var(--ion-color-medium); font-style: italic; margin-bottom: 1rem; }
.meta { display: flex; gap: 0.25rem; margin-top: 0.5rem; }
.details { display: flex; flex-direction: column; gap: 0.25rem; margin: 1rem 0; }
.join-btn { margin-top: 1rem; }
.joined { color: var(--ion-color-success); text-align: center; font-weight: 600; }
.error { color: var(--ion-color-danger); padding: 1rem; }
.loading { text-align: center; padding: 2rem; color: var(--ion-color-medium); }
</style>
