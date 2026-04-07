<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useApi } from '../composables/useApi';
import {
  IonSegment, IonSegmentButton, IonLabel, IonIcon, IonNote,
} from '@ionic/vue';
import {
  schoolOutline, analyticsOutline, sparklesOutline, layersOutline,
  checkmarkCircle, closeCircle,
} from 'ionicons/icons';

interface ReportRow {
  id?: string;
  report_type?: string;
  report_date?: string;
  summary?: Record<string, unknown>;
  [k: string]: unknown;
}

const api = useApi();
const reports = ref<ReportRow[]>([]);
const tab = ref('evaluations');

onMounted(async () => {
  try {
    reports.value = await api.get<ReportRow[]>('/learning/reports?limit=20');
  } catch { /* ok */ }
});

const totals = computed(() => {
  let evaluated = 0, correct = 0, incorrect = 0, analystsTouched = 0;
  for (const r of reports.value) {
    const s = (r.summary ?? {}) as Record<string, unknown>;
    evaluated += Number(s['evaluated'] ?? 0);
    correct += Number(s['correct'] ?? 0);
    incorrect += Number(s['incorrect'] ?? 0);
    analystsTouched += Number(s['analystsEvaluated'] ?? 0);
  }
  const accuracy = evaluated > 0 ? Math.round((correct / evaluated) * 100) : null;
  return { evaluated, correct, incorrect, analystsTouched, accuracy };
});

function reportLabel(t: unknown): string {
  return ({
    nightly_evaluation: 'Nightly Evaluation',
    learning_cycle: 'Learning Cycle',
  } as Record<string, string>)[String(t)] ?? String(t);
}

function reportIcon(t: unknown) {
  return t === 'learning_cycle' ? schoolOutline : analyticsOutline;
}

function reportAccent(t: unknown): string {
  return t === 'learning_cycle' ? '#8b5cf6' : '#6366f1';
}

function fmtDate(v: unknown): string {
  if (!v) return '';
  try {
    return new Date(String(v)).toLocaleDateString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch { return String(v); }
}

interface Stat { label: string; value: string | number; tone?: 'good' | 'bad' | 'neutral' }

function summaryStats(r: ReportRow): Stat[] {
  const s = (r.summary ?? {}) as Record<string, unknown>;
  if (r.report_type === 'learning_cycle') {
    return [
      { label: 'Analysts evaluated', value: Number(s['analystsEvaluated'] ?? 0) },
      { label: 'Proposals created', value: Number(s['proposalsCreated'] ?? 0) },
      { label: 'Passed', value: Number(s['proposalsPassed'] ?? 0), tone: 'good' },
      { label: 'Failed', value: Number(s['proposalsFailed'] ?? 0), tone: 'bad' },
      { label: 'Paper mode activated', value: Number(s['paperModeActivated'] ?? 0) },
      { label: 'Promoted', value: Number(s['paperModePromoted'] ?? 0), tone: 'good' },
      { label: 'Demoted', value: Number(s['paperModeDemoted'] ?? 0), tone: 'bad' },
    ];
  }
  // nightly_evaluation
  return [
    { label: 'Evaluated', value: Number(s['evaluated'] ?? 0) },
    { label: 'Correct', value: Number(s['correct'] ?? 0), tone: 'good' },
    { label: 'Incorrect', value: Number(s['incorrect'] ?? 0), tone: 'bad' },
    { label: 'Skipped (not yet due)', value: Number(s['skipped'] ?? 0) },
    { label: 'Errors', value: Number(s['errors'] ?? 0), tone: 'bad' },
    { label: 'Profiles updated', value: Number(s['profilesUpdated'] ?? 0) },
    { label: 'Canonical candidates', value: Number(s['canonicalCandidates'] ?? 0) },
  ];
}

interface HorizonScenario {
  d1: 'good' | 'bad';
  d3: 'good' | 'bad';
  d5: 'good' | 'bad';
  title: string;
  desc: string;
}

const horizonScenarios: HorizonScenario[] = [
  {
    d1: 'good', d3: 'good', d5: 'good',
    title: 'Strong Call',
    desc: 'Right at every horizon. Reinforce the analyst\'s approach.',
  },
  {
    d1: 'bad', d3: 'good', d5: 'good',
    title: 'Right Thesis, Early Timing',
    desc: 'Wrong at 1 day but right after. Adjust horizon or lower short-term confidence.',
  },
  {
    d1: 'good', d3: 'bad', d5: 'bad',
    title: 'Caught Move, Missed Reversal',
    desc: 'Hit the short-term direction but missed the turn. Over-indexing on momentum.',
  },
  {
    d1: 'bad', d3: 'bad', d5: 'bad',
    title: 'Real Miss',
    desc: 'Wrong at every horizon. Flagged as a canonical day candidate for learning.',
  },
];
</script>

<template>
  <div class="evals-view">
    <!-- Header -->
    <header class="page-header">
      <div class="page-header__title">
        <div class="page-header__icon">
          <ion-icon :icon="sparklesOutline" />
        </div>
        <div>
          <h1>Evaluations &amp; Performance</h1>
          <p>
            How well past predictions actually played out, and what the platform learned from them.
            Nightly evaluations score predictions against real prices; learning cycles use those
            results to update analyst profiles.
          </p>
        </div>
      </div>
    </header>

    <!-- Stat tiles -->
    <div class="stat-row">
      <div class="stat-tile">
        <span class="stat-tile__num">{{ totals.evaluated }}</span>
        <span class="stat-tile__label">Predictions Evaluated</span>
      </div>
      <div class="stat-tile stat-tile--good">
        <span class="stat-tile__num">{{ totals.correct }}</span>
        <span class="stat-tile__label">Correct</span>
      </div>
      <div class="stat-tile stat-tile--bad">
        <span class="stat-tile__num">{{ totals.incorrect }}</span>
        <span class="stat-tile__label">Incorrect</span>
      </div>
      <div class="stat-tile stat-tile--accent">
        <span class="stat-tile__num">{{ totals.accuracy === null ? '—' : totals.accuracy + '%' }}</span>
        <span class="stat-tile__label">Accuracy</span>
      </div>
      <div class="stat-tile">
        <span class="stat-tile__num">{{ totals.analystsTouched }}</span>
        <span class="stat-tile__label">Analyst Updates</span>
      </div>
    </div>

    <ion-segment v-model="tab" style="margin-bottom:16px;max-width:480px">
      <ion-segment-button value="evaluations">
        <ion-label>Recent Reports</ion-label>
      </ion-segment-button>
      <ion-segment-button value="horizons">
        <ion-label>How Horizons Work</ion-label>
      </ion-segment-button>
    </ion-segment>

    <!-- Reports tab -->
    <div v-if="tab === 'evaluations'">
      <ion-note v-if="reports.length === 0" color="medium" style="display:block;padding:32px;text-align:center">
        No evaluation reports yet. The nightly evaluator will produce reports as predictions mature.
      </ion-note>

      <div class="report-grid">
        <article
          v-for="r in reports"
          :key="String(r['id'])"
          class="report-card"
          :style="{ '--accent': reportAccent(r['report_type']) }"
        >
          <header class="report-card__head">
            <div class="report-card__icon">
              <ion-icon :icon="reportIcon(r['report_type'])" />
            </div>
            <div>
              <div class="report-card__type">{{ reportLabel(r['report_type']) }}</div>
              <div class="report-card__date">{{ fmtDate(r['report_date']) }}</div>
            </div>
          </header>
          <div class="report-card__stats">
            <div
              v-for="stat in summaryStats(r)"
              :key="stat.label"
              class="stat-pill"
              :class="{
                'stat-pill--good': stat.tone === 'good' && Number(stat.value) > 0,
                'stat-pill--bad': stat.tone === 'bad' && Number(stat.value) > 0,
              }"
            >
              <span class="stat-pill__val">{{ stat.value }}</span>
              <span class="stat-pill__label">{{ stat.label }}</span>
            </div>
          </div>
        </article>
      </div>
    </div>

    <!-- Horizons tab -->
    <div v-if="tab === 'horizons'" class="horizons">
      <div class="horizons__intro">
        <ion-icon :icon="layersOutline" />
        <p>
          Every prediction is checked at <strong>1-day</strong>, <strong>3-day</strong>, and
          <strong>5-day</strong> horizons. Combining results across horizons reveals whether the
          thesis was right and whether the timing was off — not just a binary correct/wrong.
        </p>
      </div>
      <div class="scenario-grid">
        <article v-for="s in horizonScenarios" :key="s.title" class="scenario">
          <div class="scenario__horizons">
            <div class="horizon" :class="`horizon--${s.d1}`">
              <ion-icon :icon="s.d1 === 'good' ? checkmarkCircle : closeCircle" />
              <span>1d</span>
            </div>
            <div class="horizon" :class="`horizon--${s.d3}`">
              <ion-icon :icon="s.d3 === 'good' ? checkmarkCircle : closeCircle" />
              <span>3d</span>
            </div>
            <div class="horizon" :class="`horizon--${s.d5}`">
              <ion-icon :icon="s.d5 === 'good' ? checkmarkCircle : closeCircle" />
              <span>5d</span>
            </div>
          </div>
          <div class="scenario__title">{{ s.title }}</div>
          <p class="scenario__desc">{{ s.desc }}</p>
        </article>
      </div>
    </div>
  </div>
</template>

<style scoped>
.evals-view {
  padding: 4px 0;
}

/* Header */
.page-header {
  margin-bottom: 24px;
}
.page-header__title {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}
.page-header__icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 1.5rem;
  flex-shrink: 0;
}
.page-header h1 {
  margin: 0 0 4px;
  font-size: 1.75rem;
  font-weight: 700;
}
.page-header p {
  margin: 0;
  opacity: 0.65;
  font-size: 0.9rem;
  max-width: 720px;
  line-height: 1.5;
}

/* Stat tiles */
.stat-row {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}
.stat-tile {
  background: var(--ion-card-background, #fff);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.stat-tile__num {
  font-size: 1.75rem;
  font-weight: 700;
  line-height: 1;
}
.stat-tile__label {
  font-size: 0.74rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.6;
  font-weight: 600;
}
.stat-tile--good .stat-tile__num { color: #10b981; }
.stat-tile--bad .stat-tile__num { color: #ef4444; }
.stat-tile--accent .stat-tile__num {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

/* Report cards */
.report-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 14px;
}
.report-card {
  background: var(--ion-card-background, #fff);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-left: 4px solid var(--accent);
  border-radius: 12px;
  padding: 16px;
  transition: all 0.15s ease;
}
.report-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.05);
}
.report-card__head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}
.report-card__icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
}
.report-card__type {
  font-weight: 600;
  font-size: 0.95rem;
}
.report-card__date {
  font-size: 0.78rem;
  opacity: 0.6;
}
.report-card__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.stat-pill {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 8px 12px;
  background: rgba(148, 163, 184, 0.08);
  border-radius: 8px;
  min-width: 0;
}
.stat-pill__val {
  font-size: 1rem;
  font-weight: 700;
  line-height: 1.1;
}
.stat-pill__label {
  font-size: 0.68rem;
  opacity: 0.6;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-weight: 600;
  white-space: nowrap;
}
.stat-pill--good {
  background: rgba(16, 185, 129, 0.1);
}
.stat-pill--good .stat-pill__val { color: #10b981; }
.stat-pill--bad {
  background: rgba(239, 68, 68, 0.1);
}
.stat-pill--bad .stat-pill__val { color: #ef4444; }

/* Horizons */
.horizons__intro {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding: 16px 18px;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.06), rgba(139, 92, 246, 0.04));
  border: 1px solid rgba(99, 102, 241, 0.18);
  border-radius: 12px;
  margin-bottom: 16px;
}
.horizons__intro ion-icon {
  font-size: 1.5rem;
  color: #6366f1;
  flex-shrink: 0;
  margin-top: 2px;
}
.horizons__intro p {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.55;
  opacity: 0.85;
}

.scenario-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}
.scenario {
  background: var(--ion-card-background, #fff);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 12px;
  padding: 18px;
}
.scenario__horizons {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.horizon {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 700;
}
.horizon ion-icon { font-size: 0.95rem; }
.horizon--good {
  background: rgba(16, 185, 129, 0.12);
  color: #10b981;
}
.horizon--bad {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}
.scenario__title {
  font-weight: 700;
  font-size: 1rem;
  margin-bottom: 4px;
}
.scenario__desc {
  margin: 0;
  font-size: 0.85rem;
  opacity: 0.7;
  line-height: 1.5;
}

@media (max-width: 720px) {
  .stat-row {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
