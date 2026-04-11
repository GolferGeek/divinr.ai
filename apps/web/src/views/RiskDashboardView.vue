<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useApi } from '../composables/useApi';
import { useRiskStore } from '../stores/risk.store';
import CompositeScoreGauge from '../components/CompositeScoreGauge.vue';
import RiskDimensionChart from '../components/RiskDimensionChart.vue';
import DebateSummary from '../components/DebateSummary.vue';
import {
  IonCard, IonCardHeader, IonCardTitle, IonCardSubtitle, IonCardContent,
  IonGrid, IonRow, IonCol, IonChip, IonNote, IonButton, IonIcon,
  IonSpinner,
} from '@ionic/vue';
import { arrowBackOutline, refreshOutline, chatbubblesOutline } from 'ionicons/icons';

const risk = useRiskStore();
const api = useApi();

const summaries = ref<Record<string, unknown>[]>([]);
const selectedInstrument = ref<Record<string, unknown> | null>(null);
const instrumentRisk = ref<Record<string, unknown> | null>(null);
const runRiskDetails = ref<Record<string, unknown> | null>(null);
const loading = ref(false);
const rerunning = ref(false);
const debateRerunning = ref(false);

onMounted(async () => {
  await Promise.all([risk.fetchDimensions(), fetchSummaries()]);
});

async function fetchSummaries() {
  summaries.value = await api.get<Record<string, unknown>[]>('/risk-assessments');
}

async function selectInstrument(summary: Record<string, unknown>) {
  selectedInstrument.value = summary;
  loading.value = true;
  try {
    const instrumentId = String(summary['instrument_id']);
    const runId = String(summary['run_id'] || '');

    instrumentRisk.value = await risk.getCompositeScore(instrumentId);

    if (runId) {
      runRiskDetails.value = await risk.getRunRiskDetails(runId);
    } else {
      runRiskDetails.value = null;
    }
  } catch {
    instrumentRisk.value = null;
    runRiskDetails.value = null;
  }
  loading.value = false;
}

function goBack() {
  selectedInstrument.value = null;
  instrumentRisk.value = null;
  runRiskDetails.value = null;
}

async function rerunRisk() {
  if (!selectedInstrument.value) return;
  rerunning.value = true;
  try {
    const instrumentId = String(selectedInstrument.value['instrument_id']);
    await api.post('/instruments/' + instrumentId + '/rerun-risk', {});
    // Refresh the data
    await fetchSummaries();
    // Re-select to reload detail
    const updated = summaries.value.find(s => s['instrument_id'] === instrumentId);
    if (updated) {
      selectedInstrument.value = updated;
      await selectInstrument(updated);
    }
  } catch (e) {
    console.error('Rerun risk failed:', e);
  }
  rerunning.value = false;
}

async function rerunDebate() {
  if (!selectedInstrument.value) return;
  const runId = String(selectedInstrument.value['run_id'] || '');
  if (!runId) return;
  debateRerunning.value = true;
  try {
    await api.post('/runs/' + runId + '/rerun-debate', {});
    // Refresh detail
    await selectInstrument(selectedInstrument.value!);
    await fetchSummaries();
  } catch (e) {
    console.error('Rerun debate failed:', e);
  }
  debateRerunning.value = false;
}

const currentComposite = computed(() => instrumentRisk.value?.['current'] as Record<string, unknown> | null);
const trend = computed(() => (instrumentRisk.value?.['trend'] as Record<string, unknown>[]) ?? []);
const dimensionAssessments = computed(() => (runRiskDetails.value?.['dimensionAssessments'] as Record<string, unknown>[]) ?? []);
const debate = computed(() => runRiskDetails.value?.['debate'] as Record<string, unknown> | null);

function verdictColor(verdict: string): string {
  if (verdict === 'low') return 'success';
  if (verdict === 'high') return 'danger';
  return 'warning';
}
</script>

<template>
  <div>
    <!-- Detail View -->
    <template v-if="selectedInstrument">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap">
        <ion-button fill="clear" size="small" @click="goBack">
          <ion-icon :icon="arrowBackOutline" slot="start" />
          Back
        </ion-button>
        <h1 style="margin:0;font-size:clamp(1rem, 4vw, 1.5rem)">
          {{ selectedInstrument['symbol'] }} — {{ selectedInstrument['name'] }}
        </h1>
        <ion-chip :color="verdictColor(String(selectedInstrument['verdict']))">
          {{ String(selectedInstrument['verdict']).toUpperCase() }} RISK
        </ion-chip>
        <span style="flex:1;min-width:0" />
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <ion-button size="small" fill="outline" color="warning" @click="rerunDebate" :disabled="debateRerunning || rerunning">
            <ion-icon :icon="chatbubblesOutline" slot="start" />
            {{ debateRerunning ? 'Re-running...' : 'Re-run Debate' }}
          </ion-button>
          <ion-button size="small" fill="outline" color="danger" @click="rerunRisk" :disabled="rerunning || debateRerunning">
            <ion-icon :icon="refreshOutline" slot="start" />
            {{ rerunning ? 'Re-running...' : 'Re-run Risk' }}
          </ion-button>
        </div>
      </div>

      <ion-spinner v-if="loading" />

      <template v-if="!loading && currentComposite">
        <ion-grid>
          <ion-row>
            <ion-col size="12" size-md="4">
              <CompositeScoreGauge
                :score="Number(currentComposite['overall_score'])"
                :confidence="Number(currentComposite['confidence'])"
                :debate-adjustment="Number(currentComposite['debate_adjustment'] || 0)"
                :pre-debate-score="Number(currentComposite['pre_debate_score'] || 0)"
              />
            </ion-col>
            <ion-col size="12" size-md="8">
              <ion-card>
                <ion-card-header><ion-card-title>Score Trend</ion-card-title></ion-card-header>
                <ion-card-content>
                  <div v-for="(t, i) in trend" :key="i" style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
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
                  <ion-note v-if="trend.length === 0" color="primary" style="display:block;padding:8px">No trend data yet — scores will accumulate over time.</ion-note>
                </ion-card-content>
              </ion-card>
            </ion-col>
          </ion-row>
        </ion-grid>

        <!-- Dimension Assessments -->
        <h2 style="margin-top:16px;margin-bottom:8px">Dimension Analysis</h2>
        <template v-if="dimensionAssessments.length > 0">
          <RiskDimensionChart :assessments="dimensionAssessments" />
        </template>
        <template v-else>
          <ion-grid>
            <ion-row>
              <ion-col v-for="d in risk.dimensions" :key="String(d['id'])" size="12" size-sm="6">
                <ion-card>
                  <ion-card-header>
                    <ion-card-title style="font-size:1rem">{{ d['name'] }}</ion-card-title>
                    <ion-card-subtitle>Weight: {{ Number(d['weight']).toFixed(2) }}</ion-card-subtitle>
                  </ion-card-header>
                  <ion-card-content>{{ d['description'] }}</ion-card-content>
                </ion-card>
              </ion-col>
            </ion-row>
          </ion-grid>
        </template>

        <!-- Debate Summary -->
        <template v-if="debate">
          <h2 style="margin-top:16px;margin-bottom:8px">Risk Debate</h2>
          <DebateSummary :debate="debate" />
        </template>
      </template>
    </template>

    <!-- Summary List View -->
    <template v-else>
      <h1 style="margin-bottom:16px">Risk Dashboard</h1>

      <!-- Risk Dimensions Overview -->
      <h2 style="margin-bottom:8px">Risk Dimensions</h2>
      <ion-grid>
        <ion-row>
          <ion-col v-for="d in risk.dimensions" :key="String(d['id'])" size="6" size-md="3">
            <ion-card>
              <ion-card-header>
                <ion-card-title style="font-size:1rem">{{ d['name'] }}</ion-card-title>
                <ion-card-subtitle>Weight: {{ Number(d['weight']).toFixed(2) }}</ion-card-subtitle>
              </ion-card-header>
              <ion-card-content style="font-size:0.85rem">{{ d['description'] }}</ion-card-content>
            </ion-card>
          </ion-col>
        </ion-row>
      </ion-grid>

      <!-- Instrument Risk Cards -->
      <h2 style="margin-top:16px;margin-bottom:8px">Instrument Risk Scores</h2>
      <ion-note v-if="summaries.length === 0" style="display:block;padding:16px">No risk assessments yet. Run the risk pipeline to generate scores.</ion-note>
      <ion-grid>
        <ion-row>
          <ion-col v-for="s in summaries" :key="String(s['instrument_id'])" size="12" size-sm="6" size-md="4">
            <ion-card button @click="selectInstrument(s)" style="cursor:pointer">
              <ion-card-header>
                <ion-card-title>{{ s['symbol'] }}</ion-card-title>
                <ion-card-subtitle>{{ s['name'] }}</ion-card-subtitle>
              </ion-card-header>
              <ion-card-content>
                <div style="display:flex;align-items:center;justify-content:space-between">
                  <div>
                    <div style="font-size:2rem;font-weight:bold">{{ s['risk_score'] }}</div>
                    <div style="font-size:0.75rem;opacity:0.6">Confidence: {{ (Number(s['confidence']) * 100).toFixed(0) }}%</div>
                  </div>
                  <ion-chip :color="verdictColor(String(s['verdict']))">
                    {{ String(s['verdict']).toUpperCase() }}
                  </ion-chip>
                </div>
                <div style="margin-top:8px;height:8px;border-radius:4px;overflow:hidden;background:var(--ion-color-light)">
                  <div :style="{
                    width: Number(s['risk_score']) + '%',
                    height: '100%',
                    borderRadius: '4px',
                    background: Number(s['risk_score']) > 66 ? 'var(--ion-color-danger)' : Number(s['risk_score']) > 33 ? 'var(--ion-color-warning)' : 'var(--ion-color-success)',
                  }" />
                </div>
              </ion-card-content>
            </ion-card>
          </ion-col>
        </ion-row>
      </ion-grid>
    </template>
  </div>
</template>
