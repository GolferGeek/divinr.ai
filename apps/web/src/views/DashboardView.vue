<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonGrid, IonRow, IonCol,
  IonChip, IonNote, IonButton, IonIcon,
} from '@ionic/vue';
import { arrowUpOutline, arrowDownOutline, removeOutline, cartOutline, trendingDownOutline } from 'ionicons/icons';
import { useApi } from '../composables/useApi';
import { useInstrumentsStore } from '../stores/instruments.store';
import { useDomainStore } from '../stores/domain.store';
import AnalystPredictionModal from '../components/AnalystPredictionModal.vue';

interface AnalystStance {
  analyst_id: string;
  analyst_name: string;
  analyst_slug: string;
  direction: string;
  confidence: number;
  rationale: string;
  key_factors: unknown;
  risks: unknown;
}

interface DashboardPrediction {
  instrument_id: string;
  symbol: string;
  name: string;
  run_id: string;
  created_at: string;
  arbitrator: { direction: string; confidence: number; rationale: string } | null;
  analysts: AnalystStance[];
}

const instruments = useInstrumentsStore();
const domain = useDomainStore();
const router = useRouter();
const { get } = useApi();

const predictions = ref<DashboardPrediction[]>([]);
const loading = ref(true);

// Modal state
const modalOpen = ref(false);
const modalSymbol = ref('');
const modalName = ref('');
const modalAnalysts = ref<AnalystStance[]>([]);
const modalInitialIndex = ref(0);

function openAnalystModal(pred: DashboardPrediction, analystIndex: number) {
  modalSymbol.value = pred.symbol;
  modalName.value = pred.name;
  modalAnalysts.value = pred.analysts;
  modalInitialIndex.value = analystIndex;
  modalOpen.value = true;
}

onMounted(async () => {
  await instruments.fetch().catch(() => {});
  try {
    predictions.value = await get<DashboardPrediction[]>('/predictions/dashboard');
  } catch { /* empty */ }
  loading.value = false;
});

function directionColor(dir: string): string {
  if (dir === 'up') return 'success';
  if (dir === 'down') return 'danger';
  return 'medium';
}

function directionIcon(dir: string) {
  if (dir === 'up') return arrowUpOutline;
  if (dir === 'down') return trendingDownOutline;
  return removeOutline;
}

function directionLabel(dir: string): string {
  if (dir === 'up') return 'Bullish';
  if (dir === 'down') return 'Bearish';
  return 'Neutral';
}

function shortName(name: string): string {
  // "Technical Tina — Technical Analyst" → "Technical Tina"
  const dashIdx = name.indexOf('—');
  return dashIdx > 0 ? name.slice(0, dashIdx).trim() : name;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
</script>

<template>
  <div>
    <h1>{{ domain.dashboardLayout?.title ?? 'Dashboard' }}</h1>
    <ion-note>{{ domain.activeDomain }} / {{ domain.activeUniverse }}</ion-note>

    <!-- Summary Stats -->
    <ion-grid>
      <ion-row>
        <ion-col size="6" size-md="3">
          <ion-card>
            <ion-card-content class="ion-text-center">
              <div class="stat-value">{{ instruments.items.length }}</div>
              <ion-note>Instruments</ion-note>
            </ion-card-content>
          </ion-card>
        </ion-col>
        <ion-col size="6" size-md="3">
          <ion-card>
            <ion-card-content class="ion-text-center">
              <div class="stat-value">{{ predictions.length }}</div>
              <ion-note>Active Predictions</ion-note>
            </ion-card-content>
          </ion-card>
        </ion-col>
        <ion-col size="6" size-md="3">
          <ion-card>
            <ion-card-content class="ion-text-center">
              <div class="stat-value">{{ predictions.filter(p => p.analysts.length > 0).length }}</div>
              <ion-note>Multi-Analyst</ion-note>
            </ion-card-content>
          </ion-card>
        </ion-col>
        <ion-col size="6" size-md="3">
          <ion-card>
            <ion-card-content class="ion-text-center">
              <div class="stat-value">{{ predictions.reduce((sum, p) => sum + p.analysts.length, 0) }}</div>
              <ion-note>Analyst Stances</ion-note>
            </ion-card-content>
          </ion-card>
        </ion-col>
      </ion-row>
    </ion-grid>

    <!-- Prediction Cards -->
    <h2 style="margin-top:24px">Latest Predictions</h2>

    <div v-if="loading" style="text-align:center;padding:40px;color:#999">Loading predictions...</div>
    <div v-else-if="predictions.length === 0" style="text-align:center;padding:40px;color:#999">
      No predictions yet. The pipeline will generate them as articles are scored.
    </div>

    <ion-grid v-else>
      <ion-row>
        <ion-col v-for="pred in predictions" :key="pred.instrument_id" size="12" size-md="6" size-lg="4">
          <ion-card class="prediction-card" button @click="router.push(`/instruments/${pred.instrument_id}`)">
            <ion-card-header>
              <div class="prediction-header">
                <div>
                  <ion-card-title>{{ pred.symbol }}</ion-card-title>
                  <ion-note>{{ pred.name }}</ion-note>
                </div>
                <div v-if="pred.arbitrator" class="consensus-badge" :class="pred.arbitrator.direction">
                  <ion-icon :icon="directionIcon(pred.arbitrator.direction)" />
                  <span>{{ directionLabel(pred.arbitrator.direction) }}</span>
                  <span class="confidence">{{ pred.arbitrator.confidence }}%</span>
                </div>
                <div v-else-if="pred.analysts.length > 0" class="consensus-badge" :class="pred.analysts[0].direction">
                  <ion-icon :icon="directionIcon(pred.analysts[0].direction)" />
                  <span>{{ directionLabel(pred.analysts[0].direction) }}</span>
                  <span class="confidence">{{ pred.analysts[0].confidence }}%</span>
                </div>
              </div>
            </ion-card-header>

            <ion-card-content>
              <!-- Analyst Stances -->
              <div v-if="pred.analysts.length > 0" class="analyst-stances">
                <div
                  v-for="(a, aIdx) in pred.analysts.filter(x => x.direction !== 'flat')"
                  :key="a.analyst_id"
                  class="stance-row clickable"
                  @click.stop="openAnalystModal(pred, pred.analysts.indexOf(a))"
                >
                  <span class="stance-name">{{ shortName(a.analyst_name) }}</span>
                  <ion-chip
                    :color="directionColor(a.direction)"
                    style="height:22px;font-size:0.75rem"
                  >
                    <ion-icon :icon="directionIcon(a.direction)" style="font-size:0.7rem" />
                    {{ a.direction }} {{ a.confidence }}%
                  </ion-chip>
                </div>
                <div v-if="pred.analysts.filter(x => x.direction !== 'flat').length === 0" style="color:#999;font-size:0.8rem">
                  All analysts neutral
                </div>
              </div>
              <div v-else style="color:#999;font-size:0.85rem;padding:8px 0">
                Single analyst prediction
              </div>

              <!-- Rationale preview -->
              <div v-if="pred.arbitrator?.rationale" class="rationale-preview">
                {{ pred.arbitrator.rationale.slice(0, 120) }}{{ pred.arbitrator.rationale.length > 120 ? '...' : '' }}
              </div>

              <!-- Time and Actions -->
              <div class="card-footer">
                <ion-note>{{ timeAgo(pred.created_at) }}</ion-note>
                <div class="action-buttons">
                  <ion-button size="small" color="success" fill="outline">
                    <ion-icon slot="start" :icon="cartOutline" />
                    Buy
                  </ion-button>
                  <ion-button size="small" color="danger" fill="outline">
                    <ion-icon slot="start" :icon="trendingDownOutline" />
                    Sell
                  </ion-button>
                </div>
              </div>
            </ion-card-content>
          </ion-card>
        </ion-col>
      </ion-row>
    </ion-grid>

    <AnalystPredictionModal
      :is-open="modalOpen"
      :symbol="modalSymbol"
      :name="modalName"
      :analysts="modalAnalysts"
      :initial-index="modalInitialIndex"
      @close="modalOpen = false"
    />
  </div>
</template>

<style scoped>
.stat-value {
  font-size: 2rem;
  font-weight: bold;
}

.prediction-card {
  transition: transform 0.15s;
}

.prediction-card:hover {
  transform: translateY(-2px);
}

.prediction-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.consensus-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 0.85rem;
}

.consensus-badge.up {
  background: rgba(46, 125, 50, 0.12);
  color: #2e7d32;
}

.consensus-badge.down {
  background: rgba(211, 47, 47, 0.12);
  color: #d32f2f;
}

.consensus-badge.flat {
  background: rgba(117, 117, 117, 0.12);
  color: #757575;
}

.confidence {
  font-size: 0.75rem;
  opacity: 0.8;
}

.analyst-stances {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 8px 0;
}

.stance-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stance-row.clickable {
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  transition: background 0.15s;
}

.stance-row.clickable:hover {
  background: #f0f4ff;
}

.stance-name {
  font-size: 0.8rem;
  color: #666;
  font-weight: 500;
}

.rationale-preview {
  font-size: 0.8rem;
  color: #888;
  margin: 8px 0;
  line-height: 1.4;
  border-top: 1px solid #eee;
  padding-top: 8px;
}

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #eee;
}

.action-buttons {
  display: flex;
  gap: 4px;
}
</style>
