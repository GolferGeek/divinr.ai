<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useApi } from '../composables/useApi';
import { useRiskStore } from '../stores/risk.store';
import { useInstrumentsStore } from '../stores/instruments.store';
import CompositeScoreGauge from '../components/CompositeScoreGauge.vue';
import RiskDimensionChart from '../components/RiskDimensionChart.vue';
import DebateSummary from '../components/DebateSummary.vue';
import {
  IonCard, IonCardHeader, IonCardTitle, IonCardSubtitle, IonCardContent,
  IonGrid, IonRow, IonCol, IonItem, IonSelect, IonSelectOption,
  IonChip, IonProgressBar, IonList, IonLabel, IonNote,
} from '@ionic/vue';

const risk = useRiskStore();
const instruments = useInstrumentsStore();
const selectedInstrument = ref('');
const instrumentRisk = ref<Record<string, unknown> | null>(null);
const loading = ref(false);

onMounted(async () => {
  await Promise.all([risk.fetchDimensions(), risk.fetchAssessments(), instruments.fetch()]);
});

async function loadInstrumentRisk() {
  if (!selectedInstrument.value) return;
  loading.value = true;
  try {
    instrumentRisk.value = await risk.getCompositeScore(selectedInstrument.value);
  } catch { instrumentRisk.value = null; }
  loading.value = false;
}

const currentComposite = () => instrumentRisk.value?.['current'] as Record<string, unknown> | null;
const trend = () => (instrumentRisk.value?.['trend'] as Record<string, unknown>[]) ?? [];
</script>

<template>
  <div>
    <h1 style="margin-bottom:16px">Risk Dashboard</h1>

    <!-- Instrument selector -->
    <ion-item lines="none" style="max-width:300px;margin-bottom:16px">
      <ion-select
        v-model="selectedInstrument"
        label="Select Instrument"
        label-placement="stacked"
        interface="popover"
        @ion-change="loadInstrumentRisk"
      >
        <ion-select-option v-for="i in instruments.items" :key="String(i['id'])" :value="String(i['id'])">
          {{ String(i['symbol']) }}
        </ion-select-option>
      </ion-select>
    </ion-item>

    <!-- Instrument-specific risk -->
    <template v-if="currentComposite()">
      <ion-grid>
        <ion-row>
          <ion-col size="12" size-md="4">
            <CompositeScoreGauge
              :score="Number(currentComposite()?.['overall_score'])"
              :confidence="Number(currentComposite()?.['confidence'])"
              :debate-adjustment="Number(currentComposite()?.['debate_adjustment'] || 0)"
            />
          </ion-col>
          <ion-col size="12" size-md="8">
            <ion-card>
              <ion-card-header><ion-card-title>Score Trend</ion-card-title></ion-card-header>
              <ion-card-content>
                <div v-for="(t, i) in trend()" :key="i" style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                  <span style="font-size:0.75rem;opacity:0.5;width:120px">{{ new Date(String(t['created_at'])).toLocaleDateString() }}</span>
                  <div style="flex:1;position:relative;height:16px;border-radius:8px;overflow:hidden;background:var(--ion-color-light)">
                    <div
                      :style="{
                        width: Number(t['overall_score']) + '%',
                        height: '100%',
                        borderRadius: '8px',
                        background: Number(t['overall_score']) > 66 ? 'var(--ion-color-danger)' : Number(t['overall_score']) > 33 ? 'var(--ion-color-warning)' : 'var(--ion-color-success)',
                      }"
                    />
                    <span style="position:absolute;top:0;left:50%;transform:translateX(-50%);font-size:0.75rem;line-height:16px">{{ t['overall_score'] }}</span>
                  </div>
                </div>
                <ion-note v-if="trend().length === 0" color="primary" style="display:block;padding:8px">No trend data.</ion-note>
              </ion-card-content>
            </ion-card>
          </ion-col>
        </ion-row>
      </ion-grid>
    </template>

    <!-- Risk Dimensions -->
    <h2 style="margin-top:16px;margin-bottom:8px">Risk Dimensions</h2>
    <ion-grid>
      <ion-row>
        <ion-col v-for="d in risk.dimensions" :key="String(d['id'])" size="12" size-sm="6" size-md="3">
          <ion-card>
            <ion-card-header>
              <ion-card-title style="font-size:1rem">{{ d['name'] }}</ion-card-title>
              <ion-card-subtitle>Weight: {{ Number(d['weight']).toFixed(2) }}</ion-card-subtitle>
            </ion-card-header>
            <ion-card-content>{{ d['description'] || d['slug'] }}</ion-card-content>
          </ion-card>
        </ion-col>
      </ion-row>
    </ion-grid>

    <!-- Recent Assessments -->
    <h2 style="margin-top:16px;margin-bottom:8px">Recent Risk Assessments</h2>
    <ion-list>
      <ion-item v-for="r in risk.assessments.slice(0, 20)" :key="String(r['id'])">
        <ion-label>
          <h2 style="font-weight:bold">{{ r['risk_score'] }}</h2>
          <p>
            <ion-chip :color="r['verdict'] === 'low' ? 'success' : r['verdict'] === 'high' ? 'danger' : 'warning'" style="font-size:0.7rem;height:20px">
              {{ r['verdict'] }}
            </ion-chip>
            <ion-chip style="font-size:0.7rem;height:20px">{{ r['role'] || 'composite' }}</ion-chip>
          </p>
          <p style="font-size:0.75rem;opacity:0.5">Instrument: {{ String(r['instrument_id']).slice(0, 12) }}</p>
          <p style="font-size:0.75rem">{{ new Date(String(r['created_at'])).toLocaleString() }}</p>
        </ion-label>
      </ion-item>
    </ion-list>
  </div>
</template>
