<script setup lang="ts">
import { onMounted, ref, computed, defineAsyncComponent } from 'vue';

const CalibrationScatter = defineAsyncComponent(() => import('../components/CalibrationScatter.vue'));
import { useRoute } from 'vue-router';
import { useApi } from '../composables/useApi';
import {
  IonButton, IonCard, IonCardHeader, IonCardTitle, IonCardContent,
  IonGrid, IonRow, IonCol, IonChip, IonProgressBar, IonNote, IonIcon,
} from '@ionic/vue';
import { arrowBackOutline } from 'ionicons/icons';

// Effort: calibration-drilldown. Response shape mirrors
// markets.service.ts::AnalystCalibrationPayload — keep these in sync.
interface CalibrationResponse {
  analyst: {
    id: string;
    displayName: string;
    personaPrompt: string;
    analystType: string | null;
  };
  metrics: {
    period: '30d';
    horizonWindow: 3;
    aggregate: {
      accuracyRate: number | null;
      avgConfidence: number | null;
      calibrationScore: number | null;
      sampleSize: number;
    };
    perInstrument: Array<{
      instrumentId: string;
      symbol: string;
      accuracyRate: number | null;
      avgConfidence: number | null;
      calibrationScore: number | null;
      sampleSize: number;
      systematicBiases: Record<string, unknown>;
    }>;
  };
  resolvedPredictions: Array<ResolvedPrediction>;
}

interface ResolvedPrediction {
  predictionId: string;
  evaluationId: string;
  instrumentId: string;
  symbol: string;
  predictedDirection: string;
  actualDirection: string | null;
  wasCorrect: boolean;
  confidence: number | null;
  predictionDate: string;
  evaluationDate: string;
  actualOutcome: {
    changePercent: number;
    priceAtPrediction: number;
    priceAtHorizon: number;
  } | null;
  rationale: string | null;
  hasReasoning: boolean;
}

interface ReasoningCall {
  runId: string;
  provider: string;
  model: string;
  tier: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
  reasoningContent: string;
  reasoningTruncated: boolean;
  createdAt: string;
}
interface ReasoningPayload {
  predictionId: string;
  calls: ReasoningCall[];
}

const route = useRoute();
const api = useApi();
const analyst = ref<Record<string, unknown> | null>(null);
const loading = ref(true);
const calibration = ref<CalibrationResponse | null>(null);
const calibrationError = ref<string | null>(null);
const expandedId = ref<string | null>(null);
const reasoningCache = ref(new Map<string, ReasoningPayload>());
const reasoningLoading = ref(new Set<string>());
const reasoningErrors = ref(new Map<string, string>());

async function toggleRow(predictionId: string, hasReasoning: boolean) {
  if (expandedId.value === predictionId) {
    expandedId.value = null;
    return;
  }
  expandedId.value = predictionId;
  if (!hasReasoning || reasoningCache.value.has(predictionId) || reasoningLoading.value.has(predictionId)) return;
  reasoningLoading.value.add(predictionId);
  reasoningErrors.value.delete(predictionId);
  try {
    const payload = await api.get<ReasoningPayload>(`/predictions/${predictionId}/llm-calls`);
    reasoningCache.value.set(predictionId, payload);
  } catch (err) {
    reasoningErrors.value.set(predictionId, err instanceof Error ? err.message : String(err));
  } finally {
    reasoningLoading.value.delete(predictionId);
  }
}

onMounted(async () => {
  const id = route.params.id as string;
  try {
    const analysts = await api.get<Record<string, unknown>[]>('/analysts');
    analyst.value = analysts.find(a => a['id'] === id) ?? null;
  } catch { /* ok */ }
  try {
    calibration.value = await api.get<CalibrationResponse>(`/analysts/${id}/calibration`);
  } catch (err) {
    calibrationError.value = err instanceof Error ? err.message : String(err);
  }
  loading.value = false;
});

function fmtPct(n: number | null, opts: { fromZeroOne?: boolean } = {}): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  // Confidence is stored as 0..100 in dev data; accuracy/calibration are 0..1.
  const pct = opts.fromZeroOne ? n * 100 : n;
  return `${pct.toFixed(1)}%`;
}

function fmtNum(n: number | null, digits = 3): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toFixed(digits);
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function biasCount(b: Record<string, unknown>): number {
  return Object.keys(b ?? {}).filter((k) => (b as Record<string, unknown>)[k] !== null && (b as Record<string, unknown>)[k] !== undefined).length;
}

const sortedPredictions = computed<ResolvedPrediction[]>(() => calibration.value?.resolvedPredictions ?? []);
</script>

<template>
  <div>
    <ion-button fill="clear" router-link="/analysts" style="margin-bottom:8px">
      <ion-icon slot="start" :icon="arrowBackOutline" />
      Back
    </ion-button>

    <ion-progress-bar v-if="loading" type="indeterminate" />

    <template v-if="analyst && !loading">
      <h1 style="margin-bottom:4px">{{ analyst['display_name'] }} -- Performance</h1>
      <p style="opacity:0.5;margin-bottom:16px;font-size:0.85rem">{{ analyst['analyst_type'] }} | Weight: {{ analyst['default_weight'] }} | {{ analyst['workflow_scope'] }}</p>

      <ion-grid>
        <ion-row>
          <!-- Persona -->
          <ion-col size="12" size-md="6">
            <ion-card>
              <ion-card-header><ion-card-title>Persona</ion-card-title></ion-card-header>
              <ion-card-content>
                <p>{{ analyst['persona_prompt'] }}</p>
              </ion-card-content>
            </ion-card>
          </ion-col>

          <!-- Status -->
          <ion-col size="12" size-md="3">
            <ion-card>
              <ion-card-header><ion-card-title>Status</ion-card-title></ion-card-header>
              <ion-card-content style="text-align:center">
                <ion-chip :color="analyst['is_enabled'] ? 'success' : 'danger'" style="font-size:1rem">
                  {{ analyst['is_enabled'] ? 'ENABLED' : 'DISABLED' }}
                </ion-chip>
                <div style="font-size:0.75rem;margin-top:8px;opacity:0.6">
                  {{ analyst['is_system_default'] ? 'System Default' : 'Custom' }}
                </div>
                <div style="font-size:0.75rem;opacity:0.6">
                  Learning: {{ analyst['learning_enabled'] ? 'On' : 'Off' }}
                </div>
              </ion-card-content>
            </ion-card>
          </ion-col>

          <!-- Tier Instructions -->
          <ion-col size="12" size-md="3">
            <ion-card>
              <ion-card-header><ion-card-title>Tier Instructions</ion-card-title></ion-card-header>
              <ion-card-content>
                <template v-if="analyst['tier_instructions'] && Object.keys(analyst['tier_instructions'] as object).length > 0">
                  <div v-for="(instruction, tier) in (analyst['tier_instructions'] as Record<string, string>)" :key="tier" style="margin-bottom:8px">
                    <ion-chip style="font-size:0.7rem;height:20px;margin-bottom:4px">{{ tier }}</ion-chip>
                    <p style="font-size:0.75rem;opacity:0.6">{{ String(instruction).slice(0, 100) }}...</p>
                  </div>
                </template>
                <p v-else style="font-size:0.75rem;opacity:0.5">No tier instructions configured.</p>
              </ion-card-content>
            </ion-card>
          </ion-col>
        </ion-row>
      </ion-grid>

      <!-- ─── Calibration (effort: calibration-drilldown) ─── -->
      <h2 style="margin-top:16px;margin-bottom:4px">Calibration</h2>
      <p style="opacity:0.5;margin:0 0 8px 0;font-size:0.8rem">30d window · 3-day horizon</p>

      <ion-note v-if="calibrationError" color="danger" style="display:block;padding:12px;margin-bottom:8px">
        Failed to load calibration: {{ calibrationError }}
      </ion-note>

      <template v-if="calibration">
        <!-- Headline aggregate cards -->
        <ion-grid>
          <ion-row>
            <ion-col size="6" size-md="3">
              <ion-card>
                <ion-card-header><ion-card-title style="font-size:0.85rem">Accuracy</ion-card-title></ion-card-header>
                <ion-card-content style="text-align:center;font-size:1.8rem">
                  {{ fmtPct(calibration.metrics.aggregate.accuracyRate, { fromZeroOne: true }) }}
                </ion-card-content>
              </ion-card>
            </ion-col>
            <ion-col size="6" size-md="3">
              <ion-card>
                <ion-card-header><ion-card-title style="font-size:0.85rem">Avg Confidence</ion-card-title></ion-card-header>
                <ion-card-content style="text-align:center;font-size:1.8rem">
                  {{ fmtPct(calibration.metrics.aggregate.avgConfidence) }}
                </ion-card-content>
              </ion-card>
            </ion-col>
            <ion-col size="6" size-md="3">
              <ion-card>
                <ion-card-header><ion-card-title style="font-size:0.85rem">Calibration Score</ion-card-title></ion-card-header>
                <ion-card-content style="text-align:center;font-size:1.8rem">
                  {{ fmtNum(calibration.metrics.aggregate.calibrationScore) }}
                </ion-card-content>
              </ion-card>
            </ion-col>
            <ion-col size="6" size-md="3">
              <ion-card>
                <ion-card-header><ion-card-title style="font-size:0.85rem">Sample Size</ion-card-title></ion-card-header>
                <ion-card-content style="text-align:center;font-size:1.8rem">
                  {{ calibration.metrics.aggregate.sampleSize }}
                </ion-card-content>
              </ion-card>
            </ion-col>
          </ion-row>
        </ion-grid>

        <!-- Per-instrument breakdown -->
        <ion-card v-if="calibration.metrics.perInstrument.length > 0" style="margin-top:8px">
          <ion-card-header><ion-card-title style="font-size:0.95rem">Per-Instrument Breakdown</ion-card-title></ion-card-header>
          <ion-card-content>
            <table style="width:100%;border-collapse:collapse;font-size:0.85rem">
              <thead>
                <tr style="text-align:left;border-bottom:1px solid rgba(255,255,255,0.1)">
                  <th style="padding:6px 4px">Symbol</th>
                  <th style="padding:6px 4px;text-align:right">Samples</th>
                  <th style="padding:6px 4px;text-align:right">Accuracy</th>
                  <th style="padding:6px 4px;text-align:right">Avg Conf</th>
                  <th style="padding:6px 4px;text-align:right">Calibration</th>
                  <th style="padding:6px 4px;text-align:right">Biases</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in calibration.metrics.perInstrument" :key="row.instrumentId" style="border-bottom:1px solid rgba(255,255,255,0.05)">
                  <td style="padding:6px 4px;font-weight:600">{{ row.symbol }}</td>
                  <td style="padding:6px 4px;text-align:right">{{ row.sampleSize }}</td>
                  <td style="padding:6px 4px;text-align:right">{{ fmtPct(row.accuracyRate, { fromZeroOne: true }) }}</td>
                  <td style="padding:6px 4px;text-align:right">{{ fmtPct(row.avgConfidence) }}</td>
                  <td style="padding:6px 4px;text-align:right">{{ fmtNum(row.calibrationScore) }}</td>
                  <td style="padding:6px 4px;text-align:right" :title="JSON.stringify(row.systematicBiases, null, 2)">
                    {{ biasCount(row.systematicBiases) || '—' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </ion-card-content>
        </ion-card>

        <!-- Confidence vs Accuracy scatter (effort: calibration-drilldown) -->
        <ion-card v-if="sortedPredictions.length > 0" style="margin-top:8px">
          <ion-card-header><ion-card-title style="font-size:0.95rem">Confidence vs Accuracy</ion-card-title></ion-card-header>
          <ion-card-content>
            <CalibrationScatter :predictions="sortedPredictions" />
          </ion-card-content>
        </ion-card>

        <!-- Resolved predictions list -->
        <h3 style="margin-top:16px;margin-bottom:4px;font-size:1rem">Resolved Predictions <span style="opacity:0.5;font-weight:normal">(wrong first)</span></h3>

        <ion-note v-if="sortedPredictions.length === 0" color="primary" style="display:block;padding:16px">
          No resolved predictions yet — the nightly evaluation will populate this view once predictions reach their horizon.
        </ion-note>

        <ion-card v-else>
          <ion-card-content style="padding:0">
            <div v-for="row in sortedPredictions" :key="row.evaluationId">
              <div style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.06);cursor:pointer"
                   @click="toggleRow(row.predictionId, row.hasReasoning)">
                <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:0.85rem">
                  <span style="font-weight:600;min-width:48px">{{ row.symbol }}</span>
                  <span>{{ row.predictedDirection }} → {{ row.actualDirection ?? '—' }}</span>
                  <ion-chip :color="row.wasCorrect ? 'success' : 'danger'" style="height:22px;font-size:0.7rem">
                    {{ row.wasCorrect ? 'correct' : 'wrong' }}
                  </ion-chip>
                  <span style="opacity:0.7">conf {{ fmtPct(row.confidence) }}</span>
                  <span v-if="row.actualOutcome" :style="{ color: row.actualOutcome.changePercent >= 0 ? '#4ade80' : '#f87171' }">
                    Δ {{ row.actualOutcome.changePercent.toFixed(2) }}%
                  </span>
                  <span style="opacity:0.5;margin-left:auto;font-size:0.75rem">
                    {{ fmtDate(row.predictionDate) }} → {{ fmtDate(row.evaluationDate) }}
                  </span>
                </div>
              </div>

              <!-- Inline expansion panel (effort: calibration-drilldown) -->
              <div v-if="expandedId === row.predictionId"
                   style="padding:14px 18px;background:rgba(255,255,255,0.03);border-bottom:1px solid rgba(255,255,255,0.06)">
                <div style="font-size:0.85rem;margin-bottom:8px">
                  <strong>Predicted:</strong> {{ row.predictedDirection }} —
                  <strong>Actual:</strong> {{ row.actualDirection ?? '—' }}
                  <span v-if="row.actualOutcome">
                    ({{ row.actualOutcome.changePercent >= 0 ? '+' : '' }}{{ row.actualOutcome.changePercent.toFixed(2) }}%)
                  </span>
                </div>
                <div v-if="row.actualOutcome" style="font-size:0.8rem;opacity:0.75;margin-bottom:8px;font-family:monospace">
                  ${{ row.actualOutcome.priceAtPrediction.toFixed(2) }} → ${{ row.actualOutcome.priceAtHorizon.toFixed(2) }}
                  ({{ fmtDate(row.predictionDate) }} → {{ fmtDate(row.evaluationDate) }})
                </div>
                <div style="font-size:0.8rem;margin-bottom:8px">
                  <strong>Confidence at prediction:</strong> {{ fmtPct(row.confidence) }}
                </div>
                <div v-if="row.rationale" style="margin-bottom:8px">
                  <div style="font-size:0.8rem;font-weight:600;margin-bottom:4px">Rationale</div>
                  <p style="font-size:0.82rem;line-height:1.5;margin:0">{{ row.rationale }}</p>
                </div>

                <!-- LLM reasoning (lazy) -->
                <div style="margin-top:10px">
                  <div style="font-size:0.8rem;font-weight:600;margin-bottom:4px">Captured LLM Reasoning</div>
                  <ion-note v-if="!row.hasReasoning">No captured reasoning for this prediction.</ion-note>
                  <ion-note v-else-if="reasoningLoading.has(row.predictionId)">Loading reasoning…</ion-note>
                  <ion-note v-else-if="reasoningErrors.has(row.predictionId)" color="danger">
                    Failed to load reasoning: {{ reasoningErrors.get(row.predictionId) }}
                  </ion-note>
                  <template v-else-if="reasoningCache.get(row.predictionId)">
                    <div v-for="call in reasoningCache.get(row.predictionId)!.calls" :key="call.runId">
                      <div class="reasoning-header">
                        <span>{{ call.provider }} · {{ call.model }} · {{ call.tier }}</span>
                        <span v-if="call.reasoningTruncated" class="reasoning-truncated">(truncated at 64 KB)</span>
                        <span class="reasoning-meta">{{ call.inputTokens }} in / {{ call.outputTokens }} out</span>
                      </div>
                      <pre class="reasoning-pre">{{ call.reasoningContent }}</pre>
                    </div>
                    <ion-note v-if="reasoningCache.get(row.predictionId)!.calls.length === 0">
                      No reasoning content captured for this call.
                    </ion-note>
                  </template>
                </div>
              </div>
            </div>
          </ion-card-content>
        </ion-card>
      </template>
    </template>
  </div>
</template>

<style scoped>
/* Reasoning block — mirrors AnalystPredictionModal.vue (effort: see-your-reasoning) */
.reasoning-pre {
  white-space: pre-wrap;
  font-family: monospace;
  font-size: 0.8rem;
  max-height: 60vh;
  overflow: auto;
  background: #f8f8f8;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  padding: 12px;
  margin-top: 8px;
  color: #222;
}
.reasoning-header {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 0.85rem;
}
.reasoning-header .reasoning-truncated {
  color: var(--ion-color-warning, #ffa500);
  font-size: 0.75rem;
}
.reasoning-header .reasoning-meta {
  margin-left: auto;
  opacity: 0.6;
  font-size: 0.75rem;
}
</style>
