<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonChip } from '@ionic/vue';
import { useTournamentStore } from '../stores/tournament.store';
import LegalDisclaimer from '../components/LegalDisclaimer.vue';

const store = useTournamentStore();
const route = useRoute();
const id = route.params.id as string;
const results = ref<Record<string, unknown> | null>(null);
const error = ref('');

onMounted(async () => {
  try {
    results.value = await store.fetchResults(id) as Record<string, unknown>;
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : String(e);
  }
});

function standings(): Array<{ rank: number; display_name: string | null; return_pct: number; total_pnl: number; final_rank: number }> {
  return (results.value?.standings as Array<Record<string, unknown>> ?? []).map(s => ({
    rank: Number(s.rank),
    display_name: s.display_name as string | null,
    return_pct: Number(s.return_pct),
    total_pnl: Number(s.total_pnl),
    final_rank: Number(s.final_rank),
  }));
}
</script>

<template>
  <div class="results-page">
    <h1>Game Results</h1>
    <LegalDisclaimer variant="tournament" />

    <div v-if="error" class="error">{{ error }}</div>

    <div v-else-if="results">
      <!-- Winner Highlight -->
      <IonCard v-if="standings().length > 0" class="winner-card">
        <IonCardHeader>
          <IonCardTitle>Winner: {{ standings()[0].display_name || 'Player' }}</IonCardTitle>
        </IonCardHeader>
        <IonCardContent>
          <IonChip color="success">{{ standings()[0].return_pct }}% return</IonChip>
          <IonChip>${{ standings()[0].total_pnl.toLocaleString() }} PnL</IonChip>
        </IonCardContent>
      </IonCard>

      <!-- Full Standings -->
      <table class="standings-table">
        <thead><tr><th>Rank</th><th>Player</th><th>Return %</th><th>PnL</th></tr></thead>
        <tbody>
          <tr v-for="s in standings()" :key="s.rank" :class="{ 'top-3': s.rank <= 3 }">
            <td>{{ s.final_rank }}</td>
            <td>{{ s.display_name || 'Player' }}</td>
            <td :class="s.return_pct >= 0 ? 'positive' : 'negative'">{{ s.return_pct }}%</td>
            <td :class="s.total_pnl >= 0 ? 'positive' : 'negative'">${{ s.total_pnl.toLocaleString() }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else class="loading">Loading results...</div>
  </div>
</template>

<style scoped>
.results-page { padding: 1rem; max-width: 700px; }
.disclaimer { font-size: 0.75rem; color: var(--ion-color-medium); font-style: italic; margin-bottom: 1rem; }
.winner-card { border-left: 4px solid var(--ion-color-success); }
.standings-table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
.standings-table th, .standings-table td { padding: 0.5rem; text-align: left; border-bottom: 1px solid var(--ion-color-light-shade); }
.top-3 { font-weight: 600; }
.positive { color: var(--ion-color-success); }
.negative { color: var(--ion-color-danger); }
.error { color: var(--ion-color-danger); padding: 1rem; }
.loading { text-align: center; padding: 2rem; color: var(--ion-color-medium); }
</style>
