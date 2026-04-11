<script setup lang="ts">
import { onMounted, computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonSegment, IonSegmentButton, IonLabel, IonIcon, IonCard,
  IonCardHeader, IonCardTitle, IonCardContent, IonSpinner, IonBadge,
} from '@ionic/vue';
import {
  trendingUpOutline, trendingDownOutline, removeOutline,
  walletOutline, cashOutline, statsChartOutline, layersOutline,
  warningOutline, arrowUpOutline, arrowDownOutline,
} from 'ionicons/icons';
import { Line } from 'vue-chartjs';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
  type ChartData,
  type ChartOptions,
} from 'chart.js';
import { usePerformanceStore } from '../stores/performance.store';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

const store = usePerformanceStore();
const router = useRouter();

onMounted(() => { store.fetchDashboard(); });

watch(() => store.selectedDays, (d) => { store.fetchDashboard(d); });

const daysMap: Record<string, number> = { '1W': 7, '1M': 30, '3M': 90, 'All': 365 };
const selectedLabel = computed(() => {
  for (const [label, days] of Object.entries(daysMap)) {
    if (days === store.selectedDays) return label;
  }
  return '1M';
});

function onRangeChange(ev: CustomEvent) {
  const label = ev.detail.value as string;
  store.selectedDays = daysMap[label] ?? 30;
}

const metrics = computed(() => store.dashboard?.metrics ?? null);
const hasPortfolio = computed(() => store.dashboard?.has_portfolio ?? false);
const sparseData = computed(() => (store.dashboard?.equity_curve.length ?? 0) < 10);

// Chart data: normalize benchmark to same starting point as equity
const chartData = computed<ChartData<'line'>>(() => {
  const eq = store.dashboard?.equity_curve ?? [];
  const bm = store.dashboard?.benchmark ?? [];

  const labels = eq.map(p => {
    const d = new Date(p.date);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  });

  const equityData = eq.map(p => p.balance);

  // Normalize benchmark: scale SPY to start at same value as portfolio
  let benchmarkData: (number | null)[] = [];
  if (bm.length > 0 && eq.length > 0) {
    const eqStart = eq[0].balance;
    const bmStart = bm[0].close;
    const bmMap = new Map(bm.map(b => [b.date, b.close]));
    benchmarkData = eq.map(p => {
      const bmClose = bmMap.get(p.date);
      return bmClose != null ? (bmClose / bmStart) * eqStart : null;
    });
  }

  return {
    labels,
    datasets: [
      {
        label: 'Portfolio',
        data: equityData,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.08)',
        fill: true,
        tension: 0.3,
        pointRadius: eq.length > 60 ? 0 : 3,
      },
      ...(benchmarkData.length > 0 ? [{
        label: 'SPY Benchmark',
        data: benchmarkData,
        borderColor: '#6b7280',
        borderDash: [5, 5],
        fill: false,
        tension: 0.3,
        pointRadius: 0,
      }] : []),
    ],
  };
});

const chartOptions = computed<ChartOptions<'line'>>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { display: true, position: 'top', labels: { color: '#a1a1aa' } },
    tooltip: {
      callbacks: {
        label(ctx) {
          const val = ctx.parsed.y;
          return `${ctx.dataset.label}: $${val.toLocaleString(undefined, { minimumFractionDigits: 0 })}`;
        },
      },
    },
  },
  scales: {
    x: { ticks: { color: '#71717a', maxTicksLimit: 10 }, grid: { color: 'rgba(255,255,255,0.05)' } },
    y: {
      ticks: {
        color: '#71717a',
        callback(v) { return '$' + Number(v).toLocaleString(); },
      },
      grid: { color: 'rgba(255,255,255,0.05)' },
    },
  },
}));

function fmtDollar(n: number | null | undefined): string {
  if (n == null) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : n > 0 ? '+' : '';
  return `${sign}$${abs.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function changeColor(n: number | null | undefined): string {
  if (n == null || n === 0) return 'var(--ion-color-medium)';
  return n > 0 ? '#22c55e' : '#ef4444';
}

function navigateToAnalyst(analystId: string) {
  router.push(`/analysts/${analystId}/performance`);
}

function nextEvalLabel(): string {
  const dt = store.dashboard?.next_evaluation_at;
  if (!dt) return '—';
  const d = new Date(dt);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
}
</script>

<template>
  <div class="performance-page">
    <h2>Performance</h2>

    <div v-if="store.loading && !store.dashboard" class="loading-state">
      <ion-spinner name="crescent" />
      <p>Loading performance data...</p>
    </div>

    <div v-else-if="store.dashboard && !hasPortfolio" class="empty-state">
      <ion-icon :icon="warningOutline" style="font-size: 48px; color: var(--ion-color-warning);" />
      <p>Portfolio will be created when you queue your first trade.</p>
    </div>

    <template v-else-if="store.dashboard">
      <!-- Metrics Cards -->
      <div class="metrics-grid">
        <ion-card class="metric-card">
          <ion-card-content>
            <div class="metric-label"><ion-icon :icon="walletOutline" /> Portfolio Value</div>
            <div class="metric-value">${{ (metrics?.portfolio_value ?? 0).toLocaleString() }}</div>
            <div class="metric-change" :style="{ color: changeColor(metrics?.today_change) }">
              {{ fmtDollar(metrics?.today_change) }} ({{ fmtPct(metrics?.today_change_pct) }}) today
            </div>
          </ion-card-content>
        </ion-card>

        <ion-card class="metric-card">
          <ion-card-content>
            <div class="metric-label"><ion-icon :icon="cashOutline" /> Realized PnL</div>
            <div class="metric-value" :style="{ color: changeColor(metrics?.total_realized_pnl) }">
              {{ fmtDollar(metrics?.total_realized_pnl) }}
            </div>
            <div class="metric-sub">Cumulative</div>
          </ion-card-content>
        </ion-card>

        <ion-card class="metric-card">
          <ion-card-content>
            <div class="metric-label"><ion-icon :icon="statsChartOutline" /> Win Rate</div>
            <div class="metric-value">{{ metrics?.win_rate != null ? metrics.win_rate + '%' : '—' }}</div>
            <div class="metric-sub">of closed positions</div>
          </ion-card-content>
        </ion-card>

        <ion-card class="metric-card">
          <ion-card-content>
            <div class="metric-label"><ion-icon :icon="layersOutline" /> Active Positions</div>
            <div class="metric-value">{{ metrics?.active_positions ?? 0 }}</div>
            <div class="metric-sub">Next eval: {{ nextEvalLabel() }}</div>
          </ion-card-content>
        </ion-card>
      </div>

      <!-- Equity Curve -->
      <ion-card>
        <ion-card-header>
          <div class="chart-header">
            <ion-card-title>Equity Curve</ion-card-title>
            <ion-segment :value="selectedLabel" @ionChange="onRangeChange">
              <ion-segment-button value="1W"><ion-label>1W</ion-label></ion-segment-button>
              <ion-segment-button value="1M"><ion-label>1M</ion-label></ion-segment-button>
              <ion-segment-button value="3M"><ion-label>3M</ion-label></ion-segment-button>
              <ion-segment-button value="All"><ion-label>All</ion-label></ion-segment-button>
            </ion-segment>
          </div>
        </ion-card-header>
        <ion-card-content>
          <div v-if="(store.dashboard?.equity_curve.length ?? 0) === 0" class="no-data">
            No equity data yet. Data will appear after the first trading day.
          </div>
          <template v-else>
            <div class="chart-container">
              <Line :data="chartData" :options="chartOptions" />
            </div>
            <p v-if="sparseData" class="sparse-note">
              Collecting data — full metrics available after 10 trading days.
            </p>
            <p v-if="(store.dashboard?.benchmark.length ?? 0) === 0" class="sparse-note">
              Benchmark data collecting — SPY overlay will appear when available.
            </p>
          </template>
        </ion-card-content>
      </ion-card>

      <!-- PnL Summary -->
      <div class="pnl-bar">
        <div class="pnl-stat">
          <span class="pnl-label">Realized PnL</span>
          <span class="pnl-value" :style="{ color: changeColor(metrics?.total_realized_pnl) }">
            {{ fmtDollar(metrics?.total_realized_pnl) }}
          </span>
        </div>
        <div class="pnl-stat">
          <span class="pnl-label">Unrealized PnL</span>
          <span class="pnl-value" :style="{ color: changeColor(metrics?.total_unrealized_pnl) }">
            {{ fmtDollar(metrics?.total_unrealized_pnl) }}
          </span>
        </div>
        <div class="pnl-stat">
          <span class="pnl-label">Avg Gain</span>
          <span class="pnl-value positive">{{ fmtDollar(metrics?.avg_gain) }}</span>
        </div>
        <div class="pnl-stat">
          <span class="pnl-label">Avg Loss</span>
          <span class="pnl-value negative">{{ fmtDollar(metrics?.avg_loss) }}</span>
        </div>
      </div>

      <!-- Analyst Leaderboard -->
      <ion-card>
        <ion-card-header>
          <ion-card-title>Analyst Leaderboard</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <div v-if="(store.dashboard?.analysts.length ?? 0) === 0" class="no-data">
            Analyst performance data collecting.
          </div>
          <div v-else class="table-scroll">
            <table class="leaderboard-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Analyst</th>
                  <th>Accuracy</th>
                  <th>Calibration</th>
                  <th>Samples</th>
                  <th>Trend</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(a, idx) in store.dashboard?.analysts" :key="a.analyst_id"
                    class="leaderboard-row" @click="navigateToAnalyst(a.analyst_id)">
                  <td>{{ idx + 1 }}</td>
                  <td>{{ a.name }}</td>
                  <td>{{ a.accuracy_rate != null ? (a.accuracy_rate * 100).toFixed(1) + '%' : '—' }}</td>
                  <td :title="a.calibration_score == null ? 'Needs 20+ predictions' : undefined">
                    {{ a.calibration_score != null ? a.calibration_score.toFixed(3) : '—' }}
                  </td>
                  <td>{{ a.sample_size }}</td>
                  <td>
                    <ion-icon v-if="a.trend === 'improving'" :icon="arrowUpOutline" style="color: #22c55e;" />
                    <ion-icon v-else-if="a.trend === 'declining'" :icon="arrowDownOutline" style="color: #ef4444;" />
                    <ion-icon v-else :icon="removeOutline" style="color: #71717a;" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </ion-card-content>
      </ion-card>
    </template>
  </div>
</template>

<style scoped>
.performance-page {
  padding: 16px;
  max-width: 1200px;
  margin: 0 auto;
}

.performance-page h2 {
  margin: 0 0 16px;
  font-size: 1.4rem;
}

.loading-state, .empty-state {
  text-align: center;
  padding: 48px 16px;
}

.empty-state p {
  margin: 12px 0;
  color: var(--ion-color-medium);
}

/* Metrics Grid */
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.metric-card {
  margin: 0;
}

.metric-card ion-card-content {
  padding: 16px;
}

.metric-label {
  font-size: 12px;
  text-transform: uppercase;
  color: var(--ion-color-medium);
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.metric-label ion-icon {
  font-size: 14px;
}

.metric-value {
  font-size: 1.6rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

.metric-change {
  font-size: 13px;
  margin-top: 4px;
  font-variant-numeric: tabular-nums;
}

.metric-sub {
  font-size: 12px;
  color: var(--ion-color-medium);
  margin-top: 4px;
}

/* Chart */
.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.chart-header ion-segment {
  width: 220px;
}

.chart-container {
  position: relative;
  min-height: 300px;
  width: 100%;
}

.no-data {
  text-align: center;
  padding: 48px 16px;
  color: var(--ion-color-medium);
}

.sparse-note {
  font-size: 12px;
  color: var(--ion-color-medium);
  text-align: center;
  margin-top: 8px;
}

/* PnL Bar */
.pnl-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  padding: 16px;
  margin-bottom: 16px;
  background: rgba(255,255,255,0.03);
  border-radius: 8px;
}

.pnl-stat {
  flex: 1;
  min-width: 140px;
  text-align: center;
}

.pnl-label {
  display: block;
  font-size: 11px;
  text-transform: uppercase;
  color: var(--ion-color-medium);
  margin-bottom: 4px;
}

.pnl-value {
  font-size: 1.1rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.pnl-value.positive { color: #22c55e; }
.pnl-value.negative { color: #ef4444; }

/* Leaderboard Table */
.table-scroll {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.leaderboard-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.leaderboard-table th {
  text-align: left;
  padding: 8px 12px;
  font-weight: 600;
  border-bottom: 1px solid rgba(255,255,255,0.12);
  font-size: 11px;
  text-transform: uppercase;
  color: var(--ion-color-medium);
  white-space: nowrap;
}

.leaderboard-table td {
  padding: 10px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  font-variant-numeric: tabular-nums;
}

.leaderboard-row {
  cursor: pointer;
  transition: background 0.15s;
}

.leaderboard-row:hover {
  background: rgba(255,255,255,0.04);
}
</style>
