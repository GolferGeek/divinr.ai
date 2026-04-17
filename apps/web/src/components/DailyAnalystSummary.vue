<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonChip, IonNote } from '@ionic/vue';
import { useApi } from '../composables/useApi';

interface AnalystSummary {
  analystId: string;
  analystName: string;
  analystSlug: string;
  instrumentsCovered: number;
  predictionsToday: number;
  avgConfidence: number;
  dominantDirection: string;
  symbols: string[];
  latestRiskReasoning: string | null;
}

interface DailySummaryResponse {
  date: string;
  marketsOpen: boolean;
  analysts: AnalystSummary[];
}

const router = useRouter();
const { get } = useApi();
const summary = ref<DailySummaryResponse | null>(null);
const loading = ref(true);

onMounted(async () => {
  try {
    summary.value = await get<DailySummaryResponse>('/reports/daily-analyst-summary');
  } catch { /* empty */ }
  loading.value = false;
});

function directionColor(dir: string): string {
  if (dir === 'up') return 'success';
  if (dir === 'down') return 'danger';
  return 'medium';
}

function directionLabel(dir: string): string {
  if (dir === 'up') return 'Bullish';
  if (dir === 'down') return 'Bearish';
  return 'Neutral';
}
</script>

<template>
  <IonCard v-if="!loading && summary && summary.analysts.some(a => a.predictionsToday > 0)">
    <IonCardHeader>
      <IonCardTitle style="font-size:1.1rem">
        {{ summary.marketsOpen ? "Today's Activity" : "Today's Market Recap" }}
      </IonCardTitle>
      <IonNote>{{ summary.date }} {{ summary.marketsOpen ? '(markets open)' : '(markets closed)' }}</IonNote>
    </IonCardHeader>
    <IonCardContent>
      <div class="analyst-summary-grid">
        <div
          v-for="a in summary.analysts.filter(x => x.predictionsToday > 0)"
          :key="a.analystId"
          class="analyst-summary-card"
          @click="router.push(`/analysts/${a.analystSlug}`)"
        >
          <div class="summary-header">
            <strong>{{ a.analystName }}</strong>
            <IonChip :color="directionColor(a.dominantDirection)" style="height:20px;font-size:0.7rem">
              {{ directionLabel(a.dominantDirection) }}
            </IonChip>
          </div>
          <div class="summary-stats">
            <span>{{ a.predictionsToday }} predictions</span>
            <span>{{ a.instrumentsCovered }} instruments</span>
            <span>{{ a.avgConfidence }}% avg confidence</span>
          </div>
          <div v-if="a.symbols.length > 0" class="summary-symbols">
            {{ a.symbols.slice(0, 6).join(', ') }}{{ a.symbols.length > 6 ? ` +${a.symbols.length - 6} more` : '' }}
          </div>
          <div v-if="a.latestRiskReasoning" class="summary-reasoning">
            {{ a.latestRiskReasoning.slice(0, 150) }}{{ a.latestRiskReasoning.length > 150 ? '...' : '' }}
          </div>
        </div>
      </div>
    </IonCardContent>
  </IonCard>
</template>

<style scoped>
.analyst-summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.analyst-summary-card {
  padding: 12px;
  border: 1px solid var(--ion-color-step-150, #eee);
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s, transform 0.15s;
}

.analyst-summary-card:hover {
  background: var(--ion-color-step-50, #fafafa);
  transform: translateY(-1px);
}

.summary-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.summary-stats {
  display: flex;
  gap: 12px;
  font-size: 0.78rem;
  opacity: 0.7;
  margin-bottom: 4px;
}

.summary-symbols {
  font-size: 0.75rem;
  color: var(--ion-color-primary);
  margin-bottom: 6px;
}

.summary-reasoning {
  font-size: 0.8rem;
  color: #666;
  line-height: 1.4;
  border-top: 1px solid #eee;
  padding-top: 6px;
  margin-top: 4px;
}
</style>
