<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonCard, IonCardContent, IonCardHeader, IonCardSubtitle, IonCardTitle,
  IonBadge, IonChip, IonCol, IonGrid, IonIcon, IonNote, IonRow,
} from '@ionic/vue';
import { arrowUpOutline, removeOutline, trendingDownOutline } from 'ionicons/icons';
import FirstTouchPanel from '../components/FirstTouchPanel.vue';
import { useInstrumentsStore } from '../stores/instruments.store';
import { usePredictionsStore } from '../stores/predictions.store';

const instruments = useInstrumentsStore();
const predictions = usePredictionsStore();
const router = useRouter();

type AnalysisRow = Record<string, unknown>;

interface AnalysisGroup {
  runId: string;
  instrumentId: string;
  symbol: string;
  name: string;
  createdAt: string;
  arbitrator: AnalysisRow | null;
  analysts: AnalysisRow[];
}

onMounted(() => {
  void Promise.all([
    instruments.fetch(),
    predictions.fetch({ role: 'all', limit: 240 }),
  ]);
});

const sortedInstruments = computed(() => [...instruments.items].sort((a, b) => {
  const aSymbol = String(a['symbol'] ?? '');
  const bSymbol = String(b['symbol'] ?? '');
  return aSymbol.localeCompare(bSymbol);
}));

const analysisGroups = computed<AnalysisGroup[]>(() => {
  const byRun = new Map<string, AnalysisGroup>();
  for (const row of predictions.items) {
    const runId = String(row['run_id'] ?? '');
    if (!runId) continue;
    const createdAt = String(row['created_at'] ?? '');
    const existing = byRun.get(runId);
    const group = existing ?? {
      runId,
      instrumentId: String(row['instrument_id'] ?? ''),
      symbol: String(row['symbol'] ?? ''),
      name: String(row['instrument_name'] ?? ''),
      createdAt,
      arbitrator: null,
      analysts: [],
    };
    if (createdAt && (!group.createdAt || new Date(createdAt) > new Date(group.createdAt))) {
      group.createdAt = createdAt;
    }
    if (String(row['role']) === 'arbitrator') {
      group.arbitrator = row;
    } else if (String(row['role']) === 'analyst') {
      group.analysts.push(row);
    }
    byRun.set(runId, group);
  }
  return [...byRun.values()]
    .filter((group) => group.arbitrator || group.analysts.length > 0)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 24);
});

function instrumentId(inst: Record<string, unknown>): string {
  return String(inst['id'] ?? inst['instrument_id'] ?? '');
}

function openInstrument(inst: Record<string, unknown>) {
  const id = instrumentId(inst);
  if (!id) return;
  router.push({ name: 'instrument-detail', params: { id } });
}

function openInstrumentId(id: string) {
  if (!id) return;
  router.push({ name: 'instrument-detail', params: { id } });
}

function currentState(inst: Record<string, unknown>): Record<string, unknown> {
  return (inst['current_state'] as Record<string, unknown> | null) ?? {};
}

function formatPrice(inst: Record<string, unknown>): string {
  const price = Number(currentState(inst)['price'] ?? currentState(inst)['last_price']);
  if (!Number.isFinite(price) || price <= 0) return '-';
  return `$${price.toFixed(2)}`;
}

function formatChange(inst: Record<string, unknown>): string {
  const change = Number(currentState(inst)['changePercent']);
  if (!Number.isFinite(change)) return '-';
  return `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
}

function directionColor(direction: unknown): string {
  const value = String(direction);
  if (value === 'up') return 'success';
  if (value === 'down') return 'danger';
  return 'medium';
}

function directionIcon(direction: unknown) {
  const value = String(direction);
  if (value === 'up') return arrowUpOutline;
  if (value === 'down') return trendingDownOutline;
  return removeOutline;
}

function directionLabel(direction: unknown): string {
  const value = String(direction);
  if (value === 'up') return 'Bullish';
  if (value === 'down') return 'Bearish';
  return 'Neutral';
}

function confidence(row: AnalysisRow | null): string {
  if (!row) return '-';
  const value = Number(row['confidence']);
  return Number.isFinite(value) ? `${Math.round(value)}%` : '-';
}

function timeAgo(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
</script>

<template>
  <div>
    <h1 style="margin-bottom:16px">Analyses</h1>

    <section style="margin-bottom:24px">
      <h2 style="font-size:1.1rem;margin:0 0 12px">Latest Analyst Signals</h2>
      <div v-if="predictions.loading" style="padding:24px;color:#777">Loading analyses...</div>
      <div v-else-if="analysisGroups.length === 0" style="padding:24px;color:#777">
        No analyst signals are available yet.
      </div>
      <ion-grid v-else>
        <ion-row>
          <ion-col
            v-for="group in analysisGroups"
            :key="group.runId"
            size="12"
            size-md="6"
            size-lg="4"
          >
            <ion-card button @click="openInstrumentId(group.instrumentId)">
              <ion-card-header>
                <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
                  <div>
                    <ion-card-title>{{ group.symbol }}</ion-card-title>
                    <ion-card-subtitle>{{ group.name }}</ion-card-subtitle>
                  </div>
                  <ion-badge v-if="group.arbitrator" :color="directionColor(group.arbitrator['predicted_direction'])">
                    {{ directionLabel(group.arbitrator['predicted_direction']) }} {{ confidence(group.arbitrator) }}
                  </ion-badge>
                </div>
              </ion-card-header>
              <ion-card-content>
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
                  <ion-chip
                    v-for="analyst in group.analysts.slice(0, 5)"
                    :key="String(analyst['id'])"
                    :color="directionColor(analyst['predicted_direction'])"
                    style="margin:0"
                  >
                    <ion-icon :icon="directionIcon(analyst['predicted_direction'])" />
                    <span>{{ analyst['analyst_name'] || 'Analyst' }}</span>
                    <span>{{ confidence(analyst) }}</span>
                  </ion-chip>
                </div>
                <p style="margin:0 0 10px;color:#555;line-height:1.4">
                  {{ String(group.arbitrator?.['rationale'] || group.analysts[0]?.['rationale'] || '').slice(0, 180) }}
                </p>
                <ion-note>{{ timeAgo(group.createdAt) }} · {{ group.analysts.length }} analyst stances</ion-note>
              </ion-card-content>
            </ion-card>
          </ion-col>
        </ion-row>
      </ion-grid>
    </section>

    <h2 style="font-size:1.1rem;margin:0 0 12px">Research Universe</h2>
    <ion-grid>
      <ion-row>
        <ion-col
          v-for="inst in sortedInstruments"
          :key="String(inst['id'])"
          size="12"
          size-sm="6"
          size-md="4"
          size-lg="3"
        >
          <ion-card button :disabled="!instrumentId(inst)" @click="openInstrument(inst)">
            <ion-card-header>
              <ion-card-title>{{ inst['symbol'] }}</ion-card-title>
              <ion-card-subtitle>{{ inst['name'] }}</ion-card-subtitle>
            </ion-card-header>
            <ion-card-content>
              <div style="display:flex;justify-content:space-between">
                <span style="font-size:0.75rem;opacity:0.6">Price</span>
                <span>{{ formatPrice(inst) }}</span>
              </div>
              <div style="display:flex;justify-content:space-between">
                <span style="font-size:0.75rem;opacity:0.6">Change</span>
                <span>{{ formatChange(inst) }}</span>
              </div>
              <div style="display:flex;justify-content:space-between">
                <span style="font-size:0.75rem;opacity:0.6">Type</span>
                <span>{{ inst['asset_type'] || 'stock' }}</span>
              </div>
            </ion-card-content>
          </ion-card>
        </ion-col>
      </ion-row>
    </ion-grid>

    <FirstTouchPanel surface-key="predictions" />
  </div>
</template>
