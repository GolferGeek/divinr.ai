<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { IonCard, IonCardContent, IonNote } from '@ionic/vue';
import { useTournamentStore } from '../stores/tournament.store';

import FirstTouchPanel from '../components/FirstTouchPanel.vue';
const store = useTournamentStore();
const router = useRouter();

interface HistoryEntry {
  tournament_id: string;
  tournament_name: string;
  tournament_type?: string;
  final_rank: number | null;
  return_pct: number;
  starts_at?: string;
  ends_at?: string;
}

const history = ref<HistoryEntry[]>([]);

onMounted(async () => {
  try {
    history.value = await store.fetchHistory() as HistoryEntry[];
  } catch { /* silent */ }
});
</script>

<template>
  <div class="history-page">
    <h1>Tournament History</h1>
    <p class="disclaimer">
      Divinr is an AI analysis game. Virtual portfolios use simulated trades for educational and entertainment purposes. Not investment advice.
    </p>

    <div v-if="history.length === 0" class="empty">No past tournaments yet.</div>

    <IonCard v-for="h in history" :key="h.tournament_id" class="history-card"
      @click="router.push(`/tournaments/${h.tournament_id}/results`)">
      <IonCardContent>
        <div class="history-row">
          <strong>{{ h.tournament_name }}</strong>
          <span v-if="h.final_rank" class="rank">#{{ h.final_rank }}</span>
          <span :class="h.return_pct >= 0 ? 'positive' : 'negative'">{{ h.return_pct }}%</span>
          <IonNote v-if="h.ends_at">{{ new Date(h.ends_at).toLocaleDateString() }}</IonNote>
        </div>
      </IonCardContent>
    </IonCard>
  
  <FirstTouchPanel surface-key="tournament.history" />
  </div>
</template>

<style scoped>
.history-page { padding: 1rem; max-width: 700px; }
.disclaimer { font-size: 0.75rem; color: var(--ion-color-medium); font-style: italic; margin-bottom: 1rem; }
.empty { text-align: center; padding: 2rem; color: var(--ion-color-medium); }
.history-card { cursor: pointer; margin-bottom: 0.5rem; }
.history-row { display: flex; align-items: center; gap: 1rem; }
.rank { font-weight: 700; color: var(--ion-color-primary); }
.positive { color: var(--ion-color-success); font-weight: 600; }
.negative { color: var(--ion-color-danger); font-weight: 600; }
</style>
