<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useApi } from '../composables/useApi';
import { useCanWrite } from '../composables/useCanWrite';
import { useOnboardingStore } from '../stores/onboarding.store';
import PredictorScoringPanel from '../components/PredictorScoringPanel.vue';
import InstrumentAnalystPanel from '../components/InstrumentAnalystPanel.vue';
import {
  IonButton, IonCard, IonCardHeader, IonCardTitle, IonCardContent,
  IonSegment, IonSegmentButton, IonLabel, IonNote,
} from '@ionic/vue';
import { arrowBackOutline } from 'ionicons/icons';

const route = useRoute();
const api = useApi();
const { canWrite } = useCanWrite();
const onboarding = useOnboardingStore();
const instrument = ref<Record<string, unknown> | null>(null);
const analysts = ref<Record<string, unknown>[]>([]);
const compositeScore = ref<Record<string, unknown> | null>(null);
const riskAssessments = ref<Record<string, unknown>[]>([]);
const predictions = ref<Record<string, unknown>[]>([]);
const tab = ref('analysts');

const arbitratorPrediction = computed(
  () => predictions.value.find(p => p['role'] === 'arbitrator') ?? null,
);

function fmtConfidence(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  // API returns integer percentages (e.g. 78 for 78%), not decimals
  return n > 1 ? `${Math.round(n)}%` : `${Math.round(n * 100)}%`;
}

onMounted(async () => {
  const id = route.params.id as string;
  // Notify onboarding that the user opened an instrument detail page.
  // No-op unless the current tour step is waiting on this action.
  onboarding.notifyAction('opened-instrument-detail').catch(() => { /* non-fatal */ });
  try {
    const all = await api.get<Record<string, unknown>[]>('/instruments');
    instrument.value = all.find(i => i['id'] === id) ?? null;
    analysts.value = await api.get<Record<string, unknown>[]>(`/instruments/${id}/analysts`);
    compositeScore.value = await api.get<Record<string, unknown>>(`/instruments/${id}/composite-score`);
    riskAssessments.value = await api.get<Record<string, unknown>[]>(`/risk-assessments?instrumentId=${id}&role=all`);
    predictions.value = await api.get<Record<string, unknown>[]>(`/predictions?instrumentId=${id}&role=all`);
  } catch { /* instrument may not exist */ }
});
</script>

<template>
  <div>
    <ion-button fill="clear" router-link="/instruments" style="margin-bottom:8px">
      <ion-icon slot="start" :icon="arrowBackOutline" />
      Back
    </ion-button>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap">
      <h1 style="margin:0">{{ instrument?.['symbol'] ?? 'Loading...' }}</h1>
      <span style="flex:1" />
      <ion-button
        v-if="canWrite && instrument"
        size="small" fill="outline" color="primary"
        :router-link="`/instruments/${String(instrument['id'])}/contract`"
      >
        Edit Contract
      </ion-button>
    </div>
    <p style="margin-bottom:16px;opacity:0.7">{{ instrument?.['name'] }}</p>

    <ion-segment v-model="tab" style="margin-bottom:16px" data-tour="instrument-tabs">
      <ion-segment-button value="analysts"><ion-label>Analysts</ion-label></ion-segment-button>
      <ion-segment-button value="predictors"><ion-label>AI Scoring</ion-label></ion-segment-button>
    </ion-segment>

    <!-- Analysts Tab -->
    <div v-if="tab === 'analysts'">
      <!-- Arbitrator synthesis (composite signal + composite risk) -->
      <ion-card v-if="arbitratorPrediction || compositeScore?.['current']" color="light" style="margin-bottom:16px" data-tour="arbitrator-synthesis">
        <ion-card-header>
          <ion-card-title>Arbitrator Synthesis</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <div v-if="arbitratorPrediction" style="margin-bottom:8px">
            <strong>Signal:</strong>
            {{ arbitratorPrediction['predicted_direction'] }}
            · {{ fmtConfidence(arbitratorPrediction['confidence']) }}
          </div>
          <div v-if="compositeScore?.['current']">
            <strong>Composite Risk:</strong>
            {{ (compositeScore['current'] as Record<string, unknown>)?.['overall_score'] ?? 'N/A' }}/100
          </div>
        </ion-card-content>
      </ion-card>

      <div data-tour="analyst-panel">
        <InstrumentAnalystPanel
          v-for="a in analysts"
          :key="String(a['id'])"
          :analyst="a"
          :predictions="predictions"
          :risks="riskAssessments"
        />
      </div>
      <ion-note v-if="analysts.length === 0" color="primary" style="display:block;padding:16px">
        No analysts available for this instrument.
      </ion-note>
    </div>

    <!-- AI Scoring Tab -->
    <div v-if="tab === 'predictors'">
      <PredictorScoringPanel v-if="instrument" :instrument-id="String(instrument['id'])" />
    </div>
  </div>
</template>
