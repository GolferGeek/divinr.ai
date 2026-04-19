<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonChip } from '@ionic/vue';
import { useClubStore } from '../stores/club.store';

import FirstTouchPanel from '../components/FirstTouchPanel.vue';
const store = useClubStore();
const route = useRoute();

interface CompClub {
  id: string; name: string; ranking_position: number; ranking_score: number;
  badges: Array<{ badge: string }>; member_count: number;
  avg_return_pct: number; club_win_rate: number; tournament_count: number;
}

const clubA = ref<CompClub | null>(null);
const clubB = ref<CompClub | null>(null);
const error = ref('');

onMounted(async () => {
  const a = route.query.a as string;
  const b = route.query.b as string;
  if (!a) { error.value = 'Select a club to compare. Use ?a=clubId&b=clubId'; return; }
  if (!b) { error.value = 'Select a second club. Add &b=clubId to the URL'; return; }
  try {
    const result = await store.fetchComparison(a, b) as { club_a: CompClub; club_b: CompClub };
    clubA.value = result.club_a;
    clubB.value = result.club_b;
  } catch (e: unknown) { error.value = e instanceof Error ? e.message : String(e); }
});

function winner(valA: number, valB: number, higherIsBetter = true): 'a' | 'b' | 'tie' {
  if (valA === valB) return 'tie';
  return (higherIsBetter ? valA > valB : valA < valB) ? 'a' : 'b';
}
</script>

<template>
  <div class="compare-page">
    <h1>Club Comparison</h1>
    <div v-if="error" class="error">{{ error }}</div>
    <div v-else-if="clubA && clubB" class="comparison-grid">
      <div class="col-header">Metric</div>
      <div class="col-header club-name">{{ clubA.name }}</div>
      <div class="col-header club-name">{{ clubB.name }}</div>

      <div class="metric">Ranking</div>
      <div :class="{ highlight: winner(clubA.ranking_position, clubB.ranking_position, false) === 'a' }">#{{ clubA.ranking_position }}</div>
      <div :class="{ highlight: winner(clubA.ranking_position, clubB.ranking_position, false) === 'b' }">#{{ clubB.ranking_position }}</div>

      <div class="metric">Score</div>
      <div :class="{ highlight: winner(clubA.ranking_score, clubB.ranking_score) === 'a' }">{{ clubA.ranking_score.toFixed(1) }}</div>
      <div :class="{ highlight: winner(clubA.ranking_score, clubB.ranking_score) === 'b' }">{{ clubB.ranking_score.toFixed(1) }}</div>

      <div class="metric">Avg Return</div>
      <div :class="{ highlight: winner(clubA.avg_return_pct, clubB.avg_return_pct) === 'a' }">{{ clubA.avg_return_pct }}%</div>
      <div :class="{ highlight: winner(clubA.avg_return_pct, clubB.avg_return_pct) === 'b' }">{{ clubB.avg_return_pct }}%</div>

      <div class="metric">Win Rate</div>
      <div :class="{ highlight: winner(clubA.club_win_rate, clubB.club_win_rate) === 'a' }">{{ clubA.club_win_rate }}%</div>
      <div :class="{ highlight: winner(clubA.club_win_rate, clubB.club_win_rate) === 'b' }">{{ clubB.club_win_rate }}%</div>

      <div class="metric">Members</div>
      <div :class="{ highlight: winner(clubA.member_count, clubB.member_count) === 'a' }">{{ clubA.member_count }}</div>
      <div :class="{ highlight: winner(clubA.member_count, clubB.member_count) === 'b' }">{{ clubB.member_count }}</div>

      <div class="metric">Tournaments</div>
      <div :class="{ highlight: winner(clubA.tournament_count, clubB.tournament_count) === 'a' }">{{ clubA.tournament_count }}</div>
      <div :class="{ highlight: winner(clubA.tournament_count, clubB.tournament_count) === 'b' }">{{ clubB.tournament_count }}</div>
    </div>
    <div v-else class="loading">Loading comparison...</div>
  
  <FirstTouchPanel surface-key="club.compare" />
  </div>
</template>

<style scoped>
.compare-page { padding: 1rem; max-width: 700px; }
.comparison-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0; }
.col-header { font-weight: 700; padding: 0.75rem; border-bottom: 2px solid var(--ion-color-dark); }
.club-name { text-align: center; }
.metric { padding: 0.6rem; font-weight: 600; border-bottom: 1px solid var(--ion-color-light-shade); }
.comparison-grid > div:not(.col-header):not(.metric) { padding: 0.6rem; text-align: center; border-bottom: 1px solid var(--ion-color-light-shade); }
.highlight { font-weight: 700; color: var(--ion-color-success); }
.error { color: var(--ion-color-danger); padding: 1rem; }
.loading { text-align: center; padding: 2rem; color: var(--ion-color-medium); }
</style>
