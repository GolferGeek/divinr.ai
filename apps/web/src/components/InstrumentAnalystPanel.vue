<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonButton, IonNote,
} from '@ionic/vue';

const props = defineProps<{
  analyst: Record<string, unknown>;
  predictions: Record<string, unknown>[];
  risks: Record<string, unknown>[];
}>();

const showHistory = ref(false);

const analystId = computed(() => String(props.analyst['id'] ?? ''));

const myPredictions = computed(() =>
  props.predictions.filter(p => String(p['analyst_id'] ?? '') === analystId.value),
);
const myRisks = computed(() =>
  props.risks.filter(r => String(r['analyst_id'] ?? '') === analystId.value),
);

const latestPrediction = computed(() => myPredictions.value[0] ?? null);
const latestRisk = computed(() => myRisks.value[0] ?? null);

function fmtDate(v: unknown): string {
  if (!v) return '';
  try { return new Date(String(v)).toLocaleString(); } catch { return String(v); }
}

function fmtConfidence(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : '—';
}
</script>

<template>
  <ion-card style="margin-bottom:12px">
    <ion-card-header>
      <ion-card-title>{{ analyst['display_name'] }}</ion-card-title>
      <div style="opacity:0.7;font-size:0.85rem">
        {{ analyst['analyst_type'] }} · weight {{ analyst['default_weight'] }}
      </div>
    </ion-card-header>
    <ion-card-content>
      <!-- Latest Prediction -->
      <div style="margin-bottom:12px">
        <div style="font-weight:600;margin-bottom:4px">Latest Signal</div>
        <div v-if="latestPrediction">
          <strong>{{ latestPrediction['predicted_direction'] }}</strong>
          · {{ fmtConfidence(latestPrediction['confidence']) }}
          · horizon {{ latestPrediction['horizon_minutes'] }}m
          <div style="opacity:0.7;font-size:0.8rem">{{ fmtDate(latestPrediction['created_at']) }}</div>
          <div style="margin-top:4px">{{ latestPrediction['rationale'] }}</div>
        </div>
        <ion-note v-else color="medium">No predictions yet.</ion-note>
      </div>

      <!-- Latest Risk -->
      <div style="margin-bottom:12px">
        <div style="font-weight:600;margin-bottom:4px">Latest Risk View</div>
        <div v-if="latestRisk">
          <strong>{{ latestRisk['verdict'] }}</strong>
          · {{ latestRisk['risk_score'] }}/100
          <div style="opacity:0.7;font-size:0.8rem">{{ fmtDate(latestRisk['created_at']) }}</div>
          <div style="margin-top:4px">{{ latestRisk['rationale'] }}</div>
        </div>
        <ion-note v-else color="medium">No risk assessment yet.</ion-note>
      </div>

      <!-- History toggle -->
      <ion-button
        v-if="myPredictions.length > 1 || myRisks.length > 1"
        size="small"
        fill="clear"
        @click="showHistory = !showHistory"
      >
        {{ showHistory ? 'Hide history' : 'View history' }}
      </ion-button>

      <div v-if="showHistory" style="margin-top:8px;border-top:1px solid #eee;padding-top:8px">
        <div v-if="myPredictions.length > 1" style="margin-bottom:8px">
          <div style="font-weight:600;font-size:0.85rem;margin-bottom:4px">Prediction History</div>
          <div
            v-for="p in myPredictions.slice(1)"
            :key="String(p['id'])"
            style="font-size:0.8rem;opacity:0.8;margin-bottom:4px"
          >
            {{ fmtDate(p['created_at']) }} · {{ p['predicted_direction'] }} · {{ fmtConfidence(p['confidence']) }}
          </div>
        </div>
        <div v-if="myRisks.length > 1">
          <div style="font-weight:600;font-size:0.85rem;margin-bottom:4px">Risk History</div>
          <div
            v-for="r in myRisks.slice(1)"
            :key="String(r['id'])"
            style="font-size:0.8rem;opacity:0.8;margin-bottom:4px"
          >
            {{ fmtDate(r['created_at']) }} · {{ r['verdict'] }} · {{ r['risk_score'] }}/100
          </div>
        </div>
      </div>
    </ion-card-content>
  </ion-card>
</template>
