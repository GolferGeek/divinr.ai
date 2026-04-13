<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useRunsStore } from '../stores/runs.store';
import { useInstrumentsStore } from '../stores/instruments.store';
import { useApi } from '../composables/useApi';
import AnalystOutcomeCard from '../components/AnalystOutcomeCard.vue';
import ArbitratorSection from '../components/ArbitratorSection.vue';
import DebateSummary from '../components/DebateSummary.vue';
import {
  IonButton, IonGrid, IonRow, IonCol, IonProgressBar,
  IonAccordionGroup, IonAccordion, IonItem, IonLabel, IonIcon,
} from '@ionic/vue';
import {
  arrowBackOutline, codeSlashOutline, checkmarkCircle, alertCircle,
  timeOutline, syncOutline, shieldCheckmarkOutline, trendingUpOutline,
} from 'ionicons/icons';

const route = useRoute();
const router = useRouter();
const runs = useRunsStore();
const instruments = useInstrumentsStore();
const api = useApi();
const loading = ref(true);
const artifacts = ref<Record<string, unknown>[]>([]);
const showArtifacts = ref(false);

onMounted(async () => {
  const runId = route.params.id as string;
  await Promise.all([runs.getDetail(runId), instruments.fetch()]);
  try {
    artifacts.value = await api.get<Record<string, unknown>[]>(`/runs/${runId}/artifacts`);
  } catch { /* artifacts optional */ }
  loading.value = false;
});

const run = computed(() => runs.current);
const isRisk = computed(() => run.value?.['run_type'] === 'risk');
const runTypeLabel = computed(() => isRisk.value ? 'Risk Analysis' : 'Prediction');

const symbol = computed(() => {
  const id = String(run.value?.['instrument_id'] ?? '');
  return instruments.items.find(i => i['id'] === id)?.['symbol'] ?? id.slice(0, 8);
});

const instrumentName = computed(() => {
  const id = String(run.value?.['instrument_id'] ?? '');
  return instruments.items.find(i => i['id'] === id)?.['name'] ?? '';
});

const status = computed(() => String(run.value?.['status'] ?? ''));

function statusIcon(s: string) {
  return ({
    queued: timeOutline,
    running: syncOutline,
    completed: checkmarkCircle,
    failed: alertCircle,
  } as Record<string, unknown>)[s] ?? timeOutline;
}

function statusAccent(s: string): string {
  return ({
    queued: '#94a3b8',
    running: '#6366f1',
    completed: '#10b981',
    failed: '#ef4444',
  } as Record<string, string>)[s] ?? '#94a3b8';
}

function statusLabel(s: string): string {
  return ({
    queued: 'Waiting',
    running: 'In Progress',
    completed: 'Done',
    failed: 'Failed',
  } as Record<string, string>)[s] ?? s;
}

const analystOutcomes = computed(() =>
  (run.value?.['analystOutcomes'] as Record<string, unknown>[]) ?? [],
);
const arbitratorOutcome = computed(() =>
  run.value?.['arbitratorOutcome'] as Record<string, unknown> | null,
);
const riskDetails = computed(() =>
  run.value?.['riskDetails'] as Record<string, unknown> | null,
);
const debate = computed(() =>
  (riskDetails.value?.['debate'] as Record<string, unknown>) ?? null,
);
const dimensionAssessments = computed(() =>
  (riskDetails.value?.['dimensionAssessments'] as Record<string, unknown>[]) ?? [],
);
const compositeScore = computed(() =>
  riskDetails.value?.['compositeScore'] as Record<string, unknown> | null,
);

function fmtTime(v: unknown): string {
  if (!v) return '';
  return new Date(String(v)).toLocaleString();
}
</script>

<template>
  <div class="run-detail">
    <ion-button fill="clear" class="back-link" @click="router.push('/runs')">
      <ion-icon slot="start" :icon="arrowBackOutline" />
      Pipeline Activity
    </ion-button>

    <ion-progress-bar v-if="loading" type="indeterminate" color="primary" />

    <template v-if="run && !loading">
      <!-- Hero -->
      <header
        class="hero"
        :style="{ '--accent': statusAccent(status) }"
      >
        <div class="hero__icon">
          <ion-icon :icon="isRisk ? shieldCheckmarkOutline : trendingUpOutline" />
        </div>
        <div class="hero__body">
          <div class="hero__eyebrow">{{ runTypeLabel }}</div>
          <h1>{{ symbol }}</h1>
          <div v-if="instrumentName" class="hero__sub">{{ instrumentName }}</div>
        </div>
        <div class="hero__status">
          <ion-icon :icon="statusIcon(status)" />
          <span>{{ statusLabel(status) }}</span>
        </div>
      </header>

      <p class="lead">
        <template v-if="isRisk">
          Each enabled analyst scored this instrument across multiple risk dimensions, then
          debated their findings. The arbitrator combined everything into a single risk score.
        </template>
        <template v-else>
          Each enabled analyst made an independent buy/sell/hold call. The arbitrator
          synthesized them into a single signal weighted by analyst confidence and track record.
        </template>
      </p>

      <!-- Metadata strip -->
      <div class="meta-strip">
        <div class="meta-item">
          <span class="meta-item__label">Triggered by</span>
          <span class="meta-item__value">{{ run['requested_by'] }}</span>
        </div>
        <div class="meta-item">
          <span class="meta-item__label">Started</span>
          <span class="meta-item__value">{{ fmtTime(run['created_at']) }}</span>
        </div>
        <div v-if="run['completed_at']" class="meta-item">
          <span class="meta-item__label">Finished</span>
          <span class="meta-item__value">{{ fmtTime(run['completed_at']) }}</span>
        </div>
        <div class="meta-spacer" />
        <ion-button fill="clear" size="small" @click="showArtifacts = !showArtifacts">
          <ion-icon slot="start" :icon="codeSlashOutline" />
          {{ showArtifacts ? 'Hide' : 'Show' }} Raw LLM Calls ({{ artifacts.length }})
        </ion-button>
      </div>

      <!-- Failure -->
      <div v-if="status === 'failed'" class="error-card">
        <div class="error-card__icon">
          <ion-icon :icon="alertCircle" />
        </div>
        <div>
          <div class="error-card__title">This run failed</div>
          <div class="error-card__msg">{{ run['last_error'] || 'No error message recorded.' }}</div>
        </div>
      </div>

      <!-- Analyst Outcomes -->
      <section v-if="analystOutcomes.length > 0" class="section">
        <header class="section__header">
          <h2>Each Analyst's Take</h2>
          <span class="section__count">{{ analystOutcomes.length }}</span>
        </header>
        <p class="section__desc">
          Independent calls from each specialist before the arbitrator combined them.
        </p>
        <ion-grid class="ion-no-padding">
          <ion-row>
            <ion-col v-for="(outcome, i) in analystOutcomes" :key="i" size="12" size-md="4">
              <AnalystOutcomeCard
                :name="String(outcome['analyst_name'] || 'Analyst ' + (i + 1))"
                :direction="String(outcome['predicted_direction'])"
                :confidence="Number(outcome['confidence'])"
                :rationale="String(outcome['rationale'] || '')"
                :weight="Number(outcome['analyst_weight'] || outcome['default_weight'] || 1)"
              />
            </ion-col>
          </ion-row>
        </ion-grid>
      </section>

      <!-- Arbitrator -->
      <section v-if="arbitratorOutcome" class="section">
        <header class="section__header">
          <h2>Arbitrator's Combined Signal</h2>
        </header>
        <p class="section__desc">
          The final synthesized call after weighing each analyst's confidence and track record.
        </p>
        <ArbitratorSection
          :direction="String(arbitratorOutcome['predicted_direction'])"
          :confidence="Number(arbitratorOutcome['confidence'])"
          :rationale="String(arbitratorOutcome['rationale'] || '')"
        />
      </section>

      <!-- Risk Details -->
      <template v-if="riskDetails">
        <section class="section">
          <header class="section__header">
            <h2>Risk Breakdown</h2>
          </header>
          <p class="section__desc">
            Higher score = more risk. Each dimension was scored independently, then a Bull/Bear
            debate adjusted the final number up or down.
          </p>

          <!-- Composite Score -->
          <div v-if="compositeScore" class="composite">
            <div class="composite__score">
              <div class="composite__num">{{ compositeScore['overall_score'] }}</div>
              <div class="composite__denom">/ 100</div>
              <div class="composite__caption">Overall Risk</div>
            </div>
            <div class="composite__details">
              <div>
                <span class="composite__label">Confidence</span>
                <span class="composite__val">{{ Number(compositeScore['confidence']).toFixed(2) }}</span>
              </div>
              <div>
                <span class="composite__label">Debate adjustment</span>
                <span class="composite__val">
                  {{ Number(compositeScore['debate_adjustment'] || 0) > 0 ? '+' : '' }}{{ compositeScore['debate_adjustment'] || 0 }}
                </span>
              </div>
              <div v-if="compositeScore['pre_debate_score']">
                <span class="composite__label">Score before debate</span>
                <span class="composite__val">{{ compositeScore['pre_debate_score'] }}</span>
              </div>
            </div>
          </div>

          <!-- Dimensions -->
          <div v-if="dimensionAssessments.length > 0" class="dim-grid">
            <div v-for="da in dimensionAssessments" :key="String(da['id'])" class="dim-card">
              <div class="dim-card__name">{{ da['dimension_name'] || da['dimension_slug'] }}</div>
              <div class="dim-card__score">{{ da['score'] }}<span>/100</span></div>
              <ion-progress-bar
                :value="Number(da['score']) / 100"
                :color="Number(da['score']) > 66 ? 'danger' : Number(da['score']) > 33 ? 'warning' : 'success'"
              />
              <div class="dim-card__conf">Confidence {{ Number(da['confidence']).toFixed(2) }}</div>
              <p class="dim-card__reason">{{ String(da['reasoning']).slice(0, 200) }}</p>
            </div>
          </div>
        </section>

        <!-- Debate -->
        <section class="section">
          <header class="section__header">
            <h2>Bull vs. Bear Debate</h2>
          </header>
          <p class="section__desc">
            Two analysts argued opposite sides; the arbitrator decided which had the stronger case.
          </p>
          <DebateSummary :debate="debate" />
        </section>
      </template>

      <!-- Artifacts -->
      <section v-if="showArtifacts && artifacts.length > 0" class="section">
        <header class="section__header">
          <h2>Raw LLM Calls</h2>
          <span class="section__count">{{ artifacts.length }}</span>
        </header>
        <p class="section__desc">
          The exact prompts sent to and responses received from each model. Useful for debugging.
        </p>
        <ion-accordion-group>
          <ion-accordion v-for="art in artifacts" :key="String(art['id'])" :value="String(art['id'])">
            <ion-item slot="header">
              <ion-label>
                <strong>{{ art['role'] || 'analyst' }}</strong>
                — {{ art['model_provider'] }}/{{ art['model_name'] }}
                <p style="font-size:0.75rem;opacity:0.5">{{ new Date(String(art['created_at'])).toLocaleTimeString() }}</p>
              </ion-label>
            </ion-item>
            <div slot="content" class="ion-padding">
              <div style="margin-bottom:8px">
                <div class="artifact__label">Prompt sent</div>
                <pre class="artifact__pre">{{ art['prompt'] }}</pre>
              </div>
              <div>
                <div class="artifact__label">Model response</div>
                <pre class="artifact__pre">{{ art['output_text'] }}</pre>
              </div>
            </div>
          </ion-accordion>
        </ion-accordion-group>
      </section>
    </template>
  </div>
</template>

<style scoped>
.run-detail {
  padding: 4px 0 32px;
}

.back-link {
  margin-bottom: 8px;
  --color: #6366f1;
}

/* Hero */
.hero {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 24px;
  border-radius: 16px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 8%, transparent), color-mix(in srgb, var(--accent) 2%, transparent));
  border: 1px solid color-mix(in srgb, var(--accent) 18%, transparent);
  margin-bottom: 16px;
}
.hero__icon {
  width: 64px;
  height: 64px;
  border-radius: 16px;
  background: var(--accent);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.9rem;
  flex-shrink: 0;
  box-shadow: 0 8px 20px color-mix(in srgb, var(--accent) 30%, transparent);
}
.hero__body {
  flex: 1;
  min-width: 0;
}
.hero__eyebrow {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 600;
  color: var(--accent);
  margin-bottom: 2px;
}
.hero h1 {
  margin: 0;
  font-size: 2rem;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.hero__sub {
  margin-top: 4px;
  opacity: 0.65;
  font-size: 0.95rem;
}
.hero__status {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--accent);
  color: white;
  padding: 8px 14px;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.lead {
  opacity: 0.7;
  margin: 0 4px 16px;
  max-width: 720px;
  line-height: 1.5;
}

/* Meta strip */
.meta-strip {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 12px 16px;
  background: var(--ion-card-background, #fff);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}
.meta-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.meta-item__label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.55;
  font-weight: 600;
}
.meta-item__value {
  font-size: 0.85rem;
  font-weight: 500;
}
.meta-spacer { flex: 1; }

/* Error */
.error-card {
  display: flex;
  gap: 14px;
  padding: 16px 18px;
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.08), rgba(239, 68, 68, 0.03));
  border: 1px solid rgba(239, 68, 68, 0.25);
  border-radius: 12px;
  margin-bottom: 20px;
}
.error-card__icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: #ef4444;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
  flex-shrink: 0;
}
.error-card__title {
  font-weight: 600;
  color: #b91c1c;
  margin-bottom: 4px;
}
.error-card__msg {
  font-size: 0.85rem;
  color: #7f1d1d;
  line-height: 1.5;
}

/* Sections */
.section {
  margin-top: 28px;
}
.section__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.section__header h2 {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 700;
}
.section__count {
  background: rgba(99, 102, 241, 0.12);
  color: #6366f1;
  font-size: 0.75rem;
  font-weight: 700;
  padding: 2px 10px;
  border-radius: 999px;
}
.section__desc {
  opacity: 0.65;
  font-size: 0.85rem;
  margin: 0 0 12px;
  line-height: 1.5;
}

/* Composite */
.composite {
  display: flex;
  align-items: center;
  gap: 32px;
  padding: 24px;
  background: var(--ion-card-background, #fff);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 14px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.composite__score {
  text-align: center;
  position: relative;
}
.composite__num {
  font-size: 3.5rem;
  font-weight: 800;
  line-height: 1;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.composite__denom {
  font-size: 0.85rem;
  opacity: 0.5;
  margin-top: 2px;
}
.composite__caption {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.6;
  font-weight: 600;
  margin-top: 6px;
}
.composite__details {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 0.85rem;
}
.composite__details > div {
  display: flex;
  gap: 8px;
}
.composite__label {
  opacity: 0.55;
}
.composite__val {
  font-weight: 600;
}

/* Dimensions */
.dim-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
}
.dim-card {
  background: var(--ion-card-background, #fff);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 12px;
  padding: 16px;
}
.dim-card__name {
  font-weight: 600;
  font-size: 0.9rem;
  margin-bottom: 8px;
}
.dim-card__score {
  font-size: 2rem;
  font-weight: 800;
  text-align: center;
  margin-bottom: 8px;
}
.dim-card__score span {
  font-size: 0.85rem;
  opacity: 0.45;
  font-weight: 500;
}
.dim-card__conf {
  font-size: 0.7rem;
  opacity: 0.55;
  margin-top: 8px;
}
.dim-card__reason {
  margin: 4px 0 0;
  font-size: 0.8rem;
  line-height: 1.45;
  opacity: 0.8;
}

/* Artifacts */
.artifact__label {
  font-size: 0.78rem;
  font-weight: 600;
  opacity: 0.6;
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.artifact__pre {
  font-size: 0.75rem;
  padding: 10px;
  background: rgba(148, 163, 184, 0.08);
  border-radius: 8px;
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
}

@media (max-width: 640px) {
  .hero {
    flex-direction: column;
    align-items: flex-start;
    text-align: left;
  }
  .composite {
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
  }
}
</style>
