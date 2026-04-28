<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useApi } from '../composables/useApi';
import { useCanWrite } from '../composables/useCanWrite';
import { useOnboardingStore } from '../stores/onboarding.store';
import { useMasteryStore } from '../stores/mastery.store';
import { useAuthStore } from '../stores/auth.store';
import { usePortfolioStore, type TradeDestination } from '../stores/portfolio.store';
import PredictorScoringPanel from '../components/PredictorScoringPanel.vue';
import InstrumentAnalystPanel from '../components/InstrumentAnalystPanel.vue';
import TripleVariantSwitcher from '../components/TripleVariantSwitcher.vue';
import DebateSummary from '../components/DebateSummary.vue';
import AnalystPredictionModal from '../components/AnalystPredictionModal.vue';
import {
  IonButton, IonCard, IonCardHeader, IonCardTitle, IonCardContent,
  IonSegment, IonSegmentButton, IonLabel, IonNote, useIonRouter,
  IonModal, IonSpinner, IonChip, IonIcon,
} from '@ionic/vue';
import { arrowBackOutline, refreshOutline } from 'ionicons/icons';

import FirstTouchPanel from '../components/FirstTouchPanel.vue';
const route = useRoute();
const api = useApi();
const { canWrite } = useCanWrite();
const auth = useAuthStore();
const portfolioStore = usePortfolioStore();
const mastery = useMasteryStore();
const onboarding = useOnboardingStore();
const ionRouter = useIonRouter();
const instrument = ref<Record<string, unknown> | null>(null);
const analysts = ref<Record<string, unknown>[]>([]);
const compositeScore = ref<Record<string, unknown> | null>(null);
const riskRunDetails = ref<Record<string, unknown> | null>(null);
const riskAssessments = ref<Record<string, unknown>[]>([]);
const predictions = ref<Record<string, unknown>[]>([]);
const tab = ref('analysts');
const riskGenerating = ref(false);
const riskGenerateError = ref('');
const riskProgressOpen = ref(false);
const riskStageIndex = ref(0);
const tradeDestinations = ref<TradeDestination[]>([]);
const tradeDestinationsLoading = ref(false);
const tradeModalOpen = ref(false);
const tradeModalDirection = ref<'long' | 'short' | null>(null);
let riskStageTimer: number | null = null;

const riskStages = [
  { title: 'Queueing run', tone: 'medium' },
  { title: 'Analysts reviewing instrument', tone: 'primary' },
  { title: 'Blue agent building the case', tone: 'primary' },
  { title: 'Red agent challenging the case', tone: 'danger' },
  { title: 'Arbiter synthesizing result', tone: 'success' },
  { title: 'Saving risk results', tone: 'success' },
];

const tripleAnalystId = computed(() => (route.query.analystId as string) || undefined);
const tripleAuthorUserId = computed(() => {
  const v = route.query.authorUserId;
  return v === '' || v === undefined || v === null ? undefined : (v as string);
});
const isTripleFiltered = computed(() => !!tripleAnalystId.value);
const canEditContract = computed(() => canWrite && auth.canAuthorContent && mastery.canViewLevel('builder'));

function goBack() {
  if (window.history.length > 1) {
    ionRouter.back();
    return;
  }
  ionRouter.navigate('/predictions', 'back', 'replace');
}

const arbitratorPrediction = computed(
  () => predictions.value.find(p => p['role'] === 'arbitrator') ?? null,
);
const analystModalRows = computed(() => predictions.value.map(row => ({
  prediction_id: String(row['id'] ?? row['prediction_id'] ?? ''),
  analyst_id: String(row['analyst_id'] ?? row['role'] ?? ''),
  analyst_name: String(row['analyst_name'] ?? row['display_name'] ?? row['role'] ?? 'Analyst'),
  analyst_slug: String(row['analyst_slug'] ?? row['role'] ?? ''),
  direction: String(row['predicted_direction'] ?? row['direction'] ?? 'flat'),
  confidence: Number(row['confidence'] ?? 0),
  rationale: String(row['rationale'] ?? ''),
  key_factors: row['key_factors'] ?? [],
  risks: row['risks'] ?? [],
})).filter(row => row.prediction_id && row.direction !== ''));
const tradeInitialIndex = computed(() => {
  const arbitratorId = String(arbitratorPrediction.value?.['id'] ?? arbitratorPrediction.value?.['prediction_id'] ?? '');
  const index = analystModalRows.value.findIndex(row => row.prediction_id === arbitratorId);
  return index >= 0 ? index : 0;
});
const canOpenTradeTicket = computed(() => !!instrument.value && analystModalRows.value.length > 0);
const currentCompositeRisk = computed(
  () => (compositeScore.value?.['current'] as Record<string, unknown> | null) ?? null,
);
const riskTrend = computed(
  () => (compositeScore.value?.['trend'] as Record<string, unknown>[] | undefined) ?? [],
);
const latestMarketRisk = computed(
  () => riskAssessments.value.find(r => r['role'] === 'composite') ?? riskAssessments.value[0] ?? null,
);
const latestCompositeRisk = computed(() => {
  if (latestMarketRisk.value) return latestMarketRisk.value;
  const current = currentCompositeRisk.value;
  if (!current) return null;
  const score = current['overall_score'];
  const n = Number(score);
  return {
    ...current,
    risk_score: score,
    verdict: Number.isFinite(n) ? (n <= 33 ? 'low' : n <= 66 ? 'medium' : 'high') : '',
    rationale: `Composite risk score: ${Number.isFinite(n) ? Math.round(n) : '-'} / 100`,
  };
});
const riskDetailRows = computed(
  () => (riskRunDetails.value?.['dimensionAssessments'] as Record<string, unknown>[] | undefined) ?? [],
);
const riskDebate = computed(
  () => (riskRunDetails.value?.['debate'] as Record<string, unknown> | null) ?? null,
);

function fmtConfidence(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n > 1 ? `${Math.round(n)}%` : `${Math.round(n * 100)}%`;
}

function currentState(): Record<string, unknown> {
  return (instrument.value?.['current_state'] as Record<string, unknown> | null) ?? {};
}

function fmtPrice(): string {
  const price = Number(currentState()['price'] ?? currentState()['last_price']);
  return Number.isFinite(price) && price > 0 ? `$${price.toFixed(2)}` : '-';
}

function currentPriceNumber(): number | null {
  const price = Number(currentState()['price'] ?? currentState()['last_price']);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function fmtChange(): string {
  const change = Number(currentState()['changePercent']);
  if (!Number.isFinite(change)) return '-';
  return `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
}

function fmtRiskScore(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '-';
  return `${Math.round(n)}/100`;
}

function fmtDate(v: unknown): string {
  if (!v) return '';
  return new Date(String(v)).toLocaleString();
}

function fmtCurrency(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function fmtQty(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

const myPortfolioDestination = computed(
  () => tradeDestinations.value.find(row => row.destinationType === 'user') ?? null,
);
const tournamentDestinations = computed(
  () => tradeDestinations.value.filter(row => row.destinationType === 'tournament'),
);

async function loadTradeDestinations() {
  if (!instrument.value) return;
  tradeDestinationsLoading.value = true;
  try {
    const response = await portfolioStore.fetchTradeDestinations({
      instrumentId: String(instrument.value['id']),
      symbol: String(instrument.value['symbol'] ?? ''),
    });
    tradeDestinations.value = response.destinations;
  } catch {
    tradeDestinations.value = [];
  } finally {
    tradeDestinationsLoading.value = false;
  }
}

function openTradeModal(direction?: 'long' | 'short') {
  if (!canOpenTradeTicket.value) return;
  tradeModalDirection.value = direction ?? null;
  tradeModalOpen.value = true;
}

function preferredTradeDirection(): 'long' | 'short' | undefined {
  const direction = String(arbitratorPrediction.value?.['predicted_direction'] ?? '').toLowerCase();
  if (['down', 'short', 'bearish'].includes(direction)) return 'short';
  if (['up', 'long', 'bullish'].includes(direction)) return 'long';
  return undefined;
}

function verdictColor(v: unknown): string {
  const verdict = String(v ?? '').toLowerCase();
  if (verdict === 'low') return 'success';
  if (verdict === 'high') return 'danger';
  if (verdict === 'medium') return 'warning';
  return 'medium';
}

function rowScore(row: Record<string, unknown>): unknown {
  return row['score'] ?? row['risk_score'] ?? row['overall_score'];
}

function rowReasoning(row: Record<string, unknown>): string {
  return String(row['reasoning'] ?? row['rationale'] ?? '');
}

function rowTitle(row: Record<string, unknown>): string {
  return String(row['dimension_name'] ?? row['analyst_name'] ?? row['role'] ?? 'Risk view');
}

function stopRiskStageTimer() {
  if (riskStageTimer) {
    window.clearInterval(riskStageTimer);
    riskStageTimer = null;
  }
}

function startRiskProgress() {
  stopRiskStageTimer();
  riskProgressOpen.value = true;
  riskStageIndex.value = 0;
  riskStageTimer = window.setInterval(() => {
    if (riskStageIndex.value < riskStages.length - 2) {
      riskStageIndex.value += 1;
    }
  }, 9000);
}

function buildTripleQs(base: string): string {
  if (!tripleAnalystId.value) return base;
  const sep = base.includes('?') ? '&' : '?';
  let qs = `${base}${sep}analystId=${tripleAnalystId.value}`;
  if (tripleAuthorUserId.value !== undefined) {
    qs += `&authorUserId=${tripleAuthorUserId.value}`;
  } else {
    qs += `&authorUserId=`;
  }
  return qs;
}

async function loadData() {
  const id = route.params.id as string;
  try {
    const all = await api.get<Record<string, unknown>[]>('/instruments');
    instrument.value = all.find(i => i['id'] === id) ?? null;

    const analystQs = tripleAnalystId.value ? `?analystId=${tripleAnalystId.value}` : '';
    analysts.value = await api.get<Record<string, unknown>[]>(`/instruments/${id}/analysts${analystQs}`);
    compositeScore.value = await api.get<Record<string, unknown>>(`/instruments/${id}/composite-score`);
    const runId = String(((compositeScore.value?.['current'] as Record<string, unknown> | undefined)?.['run_id']) ?? '');
    riskRunDetails.value = runId
      ? await api.get<Record<string, unknown>>(`/runs/${runId}/risk-details`)
      : null;
    riskAssessments.value = await api.get<Record<string, unknown>[]>(
      buildTripleQs(`/risk-assessments?instrumentId=${id}&role=all`),
    );
    predictions.value = await api.get<Record<string, unknown>[]>(
      buildTripleQs(`/predictions?instrumentId=${id}&role=all`),
    );
    await loadTradeDestinations();
  } catch { /* instrument may not exist */ }
}

async function generateRisk() {
  if (!instrument.value || riskGenerating.value) return;
  riskGenerating.value = true;
  riskGenerateError.value = '';
  startRiskProgress();
  try {
    await api.post(`/instruments/${String(instrument.value['id'])}/rerun-risk`, {});
    riskStageIndex.value = riskStages.length - 1;
    await loadData();
    tab.value = 'risk';
    window.setTimeout(() => {
      if (!riskGenerating.value) riskProgressOpen.value = false;
    }, 900);
  } catch (err) {
    riskGenerateError.value = err instanceof Error ? err.message : String(err);
  } finally {
    stopRiskStageTimer();
    riskGenerating.value = false;
  }
}

onMounted(() => {
  onboarding.notifyAction('opened-instrument-detail').catch(() => {});
  loadData();
});

watch(() => route.query, () => {
  if (route.params.id) loadData();
});

onBeforeUnmount(() => {
  stopRiskStageTimer();
});
</script>

<template>
  <div>
    <ion-button fill="clear" style="margin-bottom:8px" @click="goBack">
      <ion-icon slot="start" :icon="arrowBackOutline" />
      Back
    </ion-button>
    <TripleVariantSwitcher v-if="instrument" :instrument-id="String(instrument['id'])" />

    <ion-card v-if="instrument" class="instrument-hero">
      <ion-card-content>
        <div class="instrument-hero__main">
          <div>
            <h1>{{ instrument['symbol'] }}</h1>
            <p>{{ instrument['name'] }}</p>
          </div>
          <div class="instrument-hero__actions">
            <ion-button
              size="small"
              color="success"
              :disabled="!canOpenTradeTicket"
              @click="openTradeModal(preferredTradeDirection())"
            >
              Trade
            </ion-button>
            <ion-button
              v-if="canWrite"
              size="small"
              fill="outline"
              :disabled="riskGenerating"
              @click="generateRisk"
            >
              <ion-icon slot="start" :icon="refreshOutline" />
              {{ riskGenerating ? 'Generating...' : 'Generate Risk Analysis' }}
            </ion-button>
            <ion-button
              v-if="canEditContract"
              size="small" fill="outline" color="primary"
              :router-link="`/instruments/${String(instrument['id'])}/contract`"
            >
              Edit Contract
            </ion-button>
          </div>
        </div>
        <div class="instrument-metrics">
          <div>
            <span>Price</span>
            <strong>{{ fmtPrice() }}</strong>
          </div>
          <div>
            <span>My Holding</span>
            <strong>{{ tradeDestinationsLoading ? '...' : fmtQty(myPortfolioDestination?.netQty ?? 0) }}</strong>
          </div>
          <div>
            <span>My Cash</span>
            <strong>{{ tradeDestinationsLoading ? '...' : fmtCurrency(myPortfolioDestination?.currentBalance ?? 0) }}</strong>
          </div>
          <div>
            <span>Tournaments</span>
            <strong>{{ tournamentDestinations.length }}</strong>
          </div>
          <div>
            <span>Change</span>
            <strong>{{ fmtChange() }}</strong>
          </div>
          <div>
            <span>Composite Risk</span>
            <strong>{{ fmtRiskScore(latestCompositeRisk?.['risk_score'] ?? (compositeScore?.['current'] as Record<string, unknown> | undefined)?.['overall_score']) }}</strong>
          </div>
          <div>
            <span>Analysts</span>
            <strong>{{ analysts.length }}</strong>
          </div>
        </div>
        <div v-if="tournamentDestinations.length > 0" class="tournament-holdings">
          <div
            v-for="destination in tournamentDestinations"
            :key="destination.id"
            class="tournament-holdings__row"
          >
            <span>{{ destination.name }}</span>
            <strong>{{ fmtQty(destination.netQty) }} sh</strong>
            <small>{{ fmtCurrency(destination.currentBalance) }} cash</small>
          </div>
        </div>
        <ion-note v-if="riskGenerateError" color="danger">{{ riskGenerateError }}</ion-note>
      </ion-card-content>
    </ion-card>

    <ion-segment
      :value="tab"
      style="margin-bottom:16px"
      data-tour="instrument-tabs"
      @ionChange="tab = (($event.detail.value as string) ?? 'analysts')"
    >
      <ion-segment-button value="analysts"><ion-label>Analysts</ion-label></ion-segment-button>
      <ion-segment-button value="risk"><ion-label>Risk</ion-label></ion-segment-button>
      <ion-segment-button value="predictors"><ion-label>Article Relevance</ion-label></ion-segment-button>
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
          :instrument-symbol="String(instrument?.['symbol'] ?? '')"
        />
      </div>
      <ion-note v-if="analysts.length === 0" color="primary" style="display:block;padding:16px">
        No analysts available for this instrument.
      </ion-note>
    </div>

    <!-- Risk Tab -->
    <div v-if="tab === 'risk'">
      <ion-card v-if="latestCompositeRisk" color="light" style="margin-bottom:16px">
        <ion-card-header>
          <ion-card-title>Risk Overview</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <div class="risk-overview">
            <div>
              <span>Score</span>
              <strong>{{ fmtRiskScore(latestCompositeRisk['risk_score']) }}</strong>
            </div>
            <div>
              <span>Verdict</span>
              <strong>
                <ion-chip :color="verdictColor(latestCompositeRisk['verdict'])">
                  {{ latestCompositeRisk['verdict'] || '-' }}
                </ion-chip>
              </strong>
            </div>
            <div>
              <span>Updated</span>
              <strong>{{ fmtDate(latestCompositeRisk['created_at']) }}</strong>
            </div>
          </div>
          <p style="margin-top:12px">{{ latestCompositeRisk['rationale'] }}</p>
        </ion-card-content>
      </ion-card>

      <ion-button
        v-if="canWrite"
        size="small"
        fill="outline"
        :disabled="riskGenerating"
        style="margin-bottom:12px"
        @click="generateRisk"
      >
        <ion-icon slot="start" :icon="refreshOutline" />
        {{ riskGenerating ? 'Generating...' : 'Generate Risk Analysis' }}
      </ion-button>

      <DebateSummary v-if="riskDebate" :debate="riskDebate" />

      <ion-card v-if="currentCompositeRisk" style="margin-bottom:16px">
        <ion-card-header>
          <ion-card-title>Composite Score</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <div class="risk-overview">
            <div>
              <span>Pre-debate</span>
              <strong>{{ fmtRiskScore(currentCompositeRisk['pre_debate_score']) }}</strong>
            </div>
            <div>
              <span>Adjustment</span>
              <strong>{{ Number(currentCompositeRisk['debate_adjustment'] ?? 0) > 0 ? '+' : '' }}{{ currentCompositeRisk['debate_adjustment'] ?? 0 }}</strong>
            </div>
            <div>
              <span>Final</span>
              <strong>{{ fmtRiskScore(currentCompositeRisk['overall_score']) }}</strong>
            </div>
            <div>
              <span>Confidence</span>
              <strong>{{ fmtConfidence(currentCompositeRisk['confidence']) }}</strong>
            </div>
          </div>
        </ion-card-content>
      </ion-card>

      <h2 class="section-heading">Analyst Risk Views</h2>
      <div v-for="risk in riskDetailRows" :key="String(risk['id'])" class="risk-row">
        <div>
          <strong>{{ rowTitle(risk) }}</strong>
          <span>{{ fmtRiskScore(rowScore(risk)) }}</span>
        </div>
        <p>{{ rowReasoning(risk) }}</p>
      </div>

      <ion-note v-if="riskDetailRows.length === 0 && riskAssessments.length === 0" color="primary" style="display:block;padding:16px">
        No risk analysis has been generated for this instrument yet.
      </ion-note>

      <template v-if="riskDetailRows.length === 0 && riskAssessments.length > 0">
        <div v-for="risk in riskAssessments" :key="String(risk['id'])" class="risk-row">
          <div>
            <strong>{{ risk['role'] || 'risk' }}</strong>
            <span>{{ fmtRiskScore(risk['risk_score']) }}</span>
          </div>
          <p>{{ risk['rationale'] }}</p>
        </div>
      </template>

      <h2 v-if="riskTrend.length > 0" class="section-heading">Risk History</h2>
      <div v-if="riskTrend.length > 0" class="risk-history">
        <div v-for="risk in riskTrend" :key="String(risk['created_at'])" class="risk-history__row">
          <span>{{ fmtDate(risk['created_at']) }}</span>
          <strong>{{ fmtRiskScore(risk['overall_score']) }}</strong>
          <small>{{ Number(risk['debate_adjustment'] ?? 0) > 0 ? '+' : '' }}{{ risk['debate_adjustment'] ?? 0 }}</small>
        </div>
      </div>
    </div>

    <!-- Article Relevance Tab -->
    <div v-if="tab === 'predictors'">
      <PredictorScoringPanel v-if="instrument" :instrument-id="String(instrument['id'])" />
    </div>
  
  <FirstTouchPanel surface-key="instrument.detail" />

  <AnalystPredictionModal
    v-if="instrument"
    :is-open="tradeModalOpen"
    :symbol="String(instrument['symbol'] ?? '')"
    :name="String(instrument['name'] ?? '')"
    :analysts="analystModalRows"
    :initial-index="tradeInitialIndex"
    mode="trade"
    :instrument-id="String(instrument['id'] ?? '')"
    :current-price="currentPriceNumber()"
    :asset-type="String(instrument['asset_type'] ?? 'stock')"
    :preferred-direction="tradeModalDirection"
    @close="tradeModalOpen = false"
  />

  <ion-modal :is-open="riskProgressOpen" class="risk-progress-modal" @did-dismiss="riskProgressOpen = false">
    <div class="risk-progress">
      <ion-spinner name="crescent" />
      <h2>Generating Risk Analysis</h2>
      <p>{{ instrument?.['symbol'] }} risk run is in progress.</p>
      <div class="risk-stage-list">
        <div
          v-for="(stage, index) in riskStages"
          :key="stage.title"
          class="risk-stage"
          :class="{ active: index === riskStageIndex, complete: index < riskStageIndex }"
        >
          <ion-chip :color="index < riskStageIndex ? 'success' : index === riskStageIndex ? stage.tone : 'medium'">
            {{ index < riskStageIndex ? 'Done' : index === riskStageIndex ? 'Running' : 'Queued' }}
          </ion-chip>
          <span>{{ stage.title }}</span>
        </div>
      </div>
      <ion-note color="medium">This can take a few minutes while the analyst, blue, red, and arbiter passes complete.</ion-note>
    </div>
  </ion-modal>
  </div>
</template>

<style scoped>
.instrument-hero {
  margin-bottom: 16px;
}

.instrument-hero__main {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.instrument-hero h1 {
  margin: 0;
  font-size: 2rem;
}

.instrument-hero p {
  margin: 4px 0 0;
  color: var(--ion-color-medium);
}

.instrument-hero__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.instrument-metrics,
.risk-overview {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 12px;
  margin-top: 16px;
}

.instrument-metrics div,
.risk-overview div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.instrument-metrics span,
.risk-overview span {
  color: var(--ion-color-medium);
  font-size: 0.78rem;
}

.instrument-metrics strong,
.risk-overview strong {
  font-size: 1rem;
}

.tournament-holdings {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
  margin-top: 12px;
}

.tournament-holdings__row {
  display: grid;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--ion-color-light-shade, #ddd);
  border-radius: 8px;
}

.tournament-holdings__row span,
.tournament-holdings__row small {
  color: var(--ion-color-medium);
}

.tournament-holdings__row span {
  font-size: 0.8rem;
}

.risk-row {
  border: 1px solid var(--ion-color-step-150, #e8e8e8);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 10px;
}

.risk-row div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.risk-row p {
  margin: 8px 0 0;
  color: var(--ion-color-medium);
}

.section-heading {
  margin: 18px 0 10px;
  color: var(--ion-color-dark);
  font-size: 1rem;
  font-weight: 700;
}

.risk-history {
  border: 1px solid var(--ion-color-step-150, #e8e8e8);
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 16px;
}

.risk-history__row {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) 90px 90px;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid var(--ion-color-step-100, #f0f0f0);
}

.risk-history__row:last-child {
  border-bottom: 0;
}

.risk-history__row span,
.risk-history__row small {
  color: var(--ion-color-medium);
}

.risk-progress-modal {
  --width: min(560px, calc(100vw - 32px));
  --height: auto;
  --border-radius: 8px;
}

.risk-progress {
  padding: 24px;
  background: var(--ion-background-color, #fff);
}

.risk-progress ion-spinner {
  display: block;
  width: 32px;
  height: 32px;
  margin-bottom: 14px;
}

.risk-progress h2 {
  margin: 0;
  font-size: 1.25rem;
}

.risk-progress p {
  margin: 6px 0 18px;
  color: var(--ion-color-medium);
}

.risk-stage-list {
  display: grid;
  gap: 10px;
  margin-bottom: 16px;
}

.risk-stage {
  display: grid;
  grid-template-columns: 92px 1fr;
  gap: 10px;
  align-items: center;
  padding: 10px;
  border: 1px solid var(--ion-color-step-150, #e8e8e8);
  border-radius: 8px;
  opacity: 0.62;
}

.risk-stage.active,
.risk-stage.complete {
  opacity: 1;
}

.risk-stage.active {
  border-color: var(--ion-color-primary);
  background: rgba(var(--ion-color-primary-rgb, 56, 128, 255), 0.08);
}

.risk-stage span {
  font-weight: 600;
}

@media (max-width: 640px) {
  .risk-history__row {
    grid-template-columns: 1fr;
    gap: 4px;
  }

  .risk-stage {
    grid-template-columns: 1fr;
  }
}
</style>
