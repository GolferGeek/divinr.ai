<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useApi } from '../composables/useApi';
import PredictorScoringPanel from '../components/PredictorScoringPanel.vue';
import {
  IonButton, IonCard, IonCardHeader, IonCardTitle, IonCardContent,
  IonSegment, IonSegmentButton, IonLabel, IonNote,
} from '@ionic/vue';
import { arrowBackOutline } from 'ionicons/icons';

const route = useRoute();
const api = useApi();
const instrument = ref<Record<string, unknown> | null>(null);
const analysts = ref<Record<string, unknown>[]>([]);
const compositeScore = ref<Record<string, unknown> | null>(null);
const tab = ref('analysts');

onMounted(async () => {
  const id = route.params.id as string;
  try {
    const all = await api.get<Record<string, unknown>[]>('/instruments');
    instrument.value = all.find(i => i['id'] === id) ?? null;
    analysts.value = await api.get<Record<string, unknown>[]>(`/instruments/${id}/analysts`);
    const cs = await api.get<Record<string, unknown>>(`/instruments/${id}/composite-score`);
    compositeScore.value = cs;
  } catch { /* instrument may not exist */ }
});
</script>

<template>
  <div>
    <ion-button fill="clear" router-link="/instruments" style="margin-bottom:8px">
      <ion-icon slot="start" :icon="arrowBackOutline" />
      Back
    </ion-button>
    <h1 style="margin-bottom:16px">{{ instrument?.['symbol'] ?? 'Loading...' }}</h1>
    <p style="margin-bottom:16px;opacity:0.7">{{ instrument?.['name'] }}</p>

    <ion-segment :value="tab" @ion-change="tab = String($event.detail.value)" style="margin-bottom:16px">
      <ion-segment-button value="analysts"><ion-label>Analysts</ion-label></ion-segment-button>
      <ion-segment-button value="risk"><ion-label>Risk</ion-label></ion-segment-button>
      <ion-segment-button value="predictions"><ion-label>Predictions</ion-label></ion-segment-button>
      <ion-segment-button value="predictors"><ion-label>AI Scoring</ion-label></ion-segment-button>
    </ion-segment>

    <!-- Analysts Tab -->
    <div v-if="tab === 'analysts'">
      <ion-card v-for="a in analysts" :key="String(a['id'])" style="margin-bottom:8px">
        <ion-card-header>
          <ion-card-title>{{ a['display_name'] }}</ion-card-title>
          <ion-card-subtitle>Weight: {{ a['default_weight'] }} | {{ a['analyst_type'] }}</ion-card-subtitle>
        </ion-card-header>
        <ion-card-content>{{ String(a['persona_prompt']).slice(0, 200) }}...</ion-card-content>
      </ion-card>
      <ion-note v-if="analysts.length === 0" color="primary" style="display:block;padding:16px">
        No analysts assigned to this instrument.
      </ion-note>
    </div>

    <!-- Risk Tab -->
    <div v-if="tab === 'risk'">
      <ion-card v-if="compositeScore?.['current']">
        <ion-card-header>
          <ion-card-title>Composite Risk Score</ion-card-title>
        </ion-card-header>
        <ion-card-content style="text-align:center">
          <div style="font-size:2.5rem;font-weight:bold">
            {{ (compositeScore['current'] as Record<string, unknown>)?.['overall_score'] ?? 'N/A' }}<span style="font-size:1rem">/100</span>
          </div>
        </ion-card-content>
      </ion-card>
      <ion-note v-else color="primary" style="display:block;padding:16px">
        No risk assessment data yet. Enqueue a risk run.
      </ion-note>
    </div>

    <!-- Predictions Tab -->
    <div v-if="tab === 'predictions'">
      <ion-note color="primary" style="display:block;padding:16px">
        Prediction detail view -- see Run Detail for per-analyst breakdown.
      </ion-note>
    </div>

    <!-- AI Scoring Tab -->
    <div v-if="tab === 'predictors'">
      <PredictorScoringPanel v-if="instrument" :instrument-id="String(instrument['id'])" />
    </div>
  </div>
</template>
