<script setup lang="ts">
import { onMounted, computed, watch } from 'vue';
import {
  IonSegment, IonSegmentButton, IonLabel, IonButton, IonIcon,
  IonSpinner, IonCard, IonCardHeader, IonCardTitle, IonCardContent,
  IonBadge,
} from '@ionic/vue';
import { refreshOutline, warningOutline } from 'ionicons/icons';
import { useCoordinationStore } from '../stores/coordination.store';
import type { CorrelationRow } from '../stores/coordination.store';

const store = useCoordinationStore();

onMounted(() => { store.fetchAll(); });

watch(() => store.selectedPeriod, (p) => { store.fetchAll(p); });

const hasData = computed(() =>
  store.correlations.length > 0 || store.coverage.length > 0 || store.contributions.length > 0,
);

// Build correlation matrix: unique analyst names × unique analyst names
const matrixAnalysts = computed(() => {
  const names = new Set<string>();
  for (const c of store.correlations) {
    names.add(c.analyst_a_name || c.analyst_a_id);
    names.add(c.analyst_b_name || c.analyst_b_id);
  }
  return [...names].sort();
});

function findCorrelation(a: string, b: string): CorrelationRow | undefined {
  return store.correlations.find(c =>
    (nameOf(c, 'a') === a && nameOf(c, 'b') === b) ||
    (nameOf(c, 'a') === b && nameOf(c, 'b') === a),
  );
}

function nameOf(c: CorrelationRow, side: 'a' | 'b'): string {
  return side === 'a' ? (c.analyst_a_name || c.analyst_a_id) : (c.analyst_b_name || c.analyst_b_id);
}

function cellColor(rate: number | undefined, flag: string | null | undefined): string {
  if (!rate && rate !== 0) return '#1e1e2e';
  if (flag === 'redundant') return '#7f1d1d';
  if (flag === 'adversarial') return '#7f1d1d';
  if (rate > 0.60) return '#854d0e';
  if (rate >= 0.40) return '#14532d';
  return '#1e1e2e';
}

function pct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

function marginalClass(n: number): string {
  return n < 0 ? 'negative' : n > 0 ? 'positive' : '';
}
</script>

<template>
  <div class="coordination-page">
    <div class="page-header">
      <h2>Analyst Coordination</h2>
      <div class="controls">
        <ion-segment :value="store.selectedPeriod" @ionChange="store.selectedPeriod = ($event.detail.value as string) ?? '30d'">
          <ion-segment-button value="30d"><ion-label>30d</ion-label></ion-segment-button>
          <ion-segment-button value="90d"><ion-label>90d</ion-label></ion-segment-button>
          <ion-segment-button value="all"><ion-label>All</ion-label></ion-segment-button>
        </ion-segment>
        <ion-button size="small" fill="outline" :disabled="store.computing" @click="store.triggerCompute()">
          <ion-spinner v-if="store.computing" name="crescent" style="width: 16px; height: 16px; margin-right: 4px;" />
          <ion-icon v-else :icon="refreshOutline" slot="start" />
          {{ store.computing ? 'Computing...' : 'Refresh' }}
        </ion-button>
      </div>
    </div>

    <div v-if="store.loading && !hasData" class="loading-state">
      <ion-spinner name="crescent" />
      <p>Loading coordination data...</p>
    </div>

    <div v-else-if="!hasData && !store.loading" class="empty-state">
      <ion-icon :icon="warningOutline" style="font-size: 48px; color: var(--ion-color-warning);" />
      <p>No coordination data yet. Click "Compute Now" to run the initial analysis.</p>
      <ion-button @click="store.triggerCompute()" :disabled="store.computing">
        <ion-spinner v-if="store.computing" name="crescent" style="width: 16px; height: 16px; margin-right: 4px;" />
        {{ store.computing ? 'Computing...' : 'Compute Now' }}
      </ion-button>
    </div>

    <template v-else>
      <!-- Correlation Matrix -->
      <ion-card>
        <ion-card-header>
          <ion-card-title>Correlation Matrix</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <div v-if="store.correlations.length === 0" class="no-data">No correlation data for this period.</div>
          <div v-else class="matrix-scroll">
            <table class="correlation-matrix">
              <thead>
                <tr>
                  <th></th>
                  <th v-for="name in matrixAnalysts" :key="name" class="rotated-header">
                    <span>{{ name }}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="rowName in matrixAnalysts" :key="rowName">
                  <td class="row-label">{{ rowName }}</td>
                  <td v-for="colName in matrixAnalysts" :key="colName"
                      :style="{ backgroundColor: rowName === colName ? '#2d2d3d' : cellColor(findCorrelation(rowName, colName)?.agreement_rate, findCorrelation(rowName, colName)?.flag) }"
                      class="matrix-cell"
                      :title="rowName === colName ? '—' : `${rowName} × ${colName}: ${pct(findCorrelation(rowName, colName)?.agreement_rate)} (n=${findCorrelation(rowName, colName)?.sample_size ?? 0})`">
                    <template v-if="rowName === colName">—</template>
                    <template v-else-if="findCorrelation(rowName, colName)">
                      {{ pct(findCorrelation(rowName, colName)?.agreement_rate) }}
                      <ion-badge v-if="findCorrelation(rowName, colName)?.flag" color="danger" style="font-size: 9px; margin-left: 2px;">
                        {{ findCorrelation(rowName, colName)?.flag === 'redundant' ? 'R' : 'A' }}
                      </ion-badge>
                    </template>
                    <template v-else>—</template>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="legend">
            <span class="legend-item"><span class="swatch" style="background: #14532d;"></span> Moderate (40-60%)</span>
            <span class="legend-item"><span class="swatch" style="background: #854d0e;"></span> High (60-90%)</span>
            <span class="legend-item"><span class="swatch" style="background: #7f1d1d;"></span> Flagged (>90% or <20%)</span>
          </div>
        </ion-card-content>
      </ion-card>

      <!-- Coverage Gaps -->
      <ion-card>
        <ion-card-header>
          <ion-card-title>Coverage Gaps</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <div v-if="store.coverage.length === 0" class="no-data">No coverage data for this period.</div>
          <table v-else class="data-table">
            <thead>
              <tr>
                <th>Instrument</th>
                <th>Analysts</th>
                <th>Avg Accuracy</th>
                <th>Best Analyst</th>
                <th>Best Accuracy</th>
                <th>Gap</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in store.coverage" :key="row.instrument_id"
                  :class="{ 'gap-row': row.is_gap }">
                <td>{{ row.instrument_symbol || row.instrument_id }}</td>
                <td>{{ row.analyst_count }}</td>
                <td>{{ pct(row.avg_accuracy) }}</td>
                <td>{{ row.best_analyst_name || '—' }}</td>
                <td>{{ pct(row.best_accuracy) }}</td>
                <td>
                  <ion-icon v-if="row.is_gap" :icon="warningOutline" color="warning" />
                </td>
              </tr>
            </tbody>
          </table>
        </ion-card-content>
      </ion-card>

      <!-- Contribution Scores -->
      <ion-card>
        <ion-card-header>
          <ion-card-title>Contribution Scores</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <div v-if="store.contributions.length === 0" class="no-data">No contribution data for this period.</div>
          <table v-else class="data-table">
            <thead>
              <tr>
                <th>Analyst</th>
                <th>With</th>
                <th>Without</th>
                <th>Marginal</th>
                <th>Predictions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in store.contributions" :key="row.analyst_id">
                <td>{{ row.analyst_name || row.analyst_id }}</td>
                <td>{{ pct(row.composite_accuracy_with) }}</td>
                <td>{{ pct(row.composite_accuracy_without) }}</td>
                <td :class="marginalClass(row.marginal_contribution)">
                  {{ row.marginal_contribution > 0 ? '+' : '' }}{{ pct(row.marginal_contribution) }}
                </td>
                <td>{{ row.prediction_count }}</td>
              </tr>
            </tbody>
          </table>
        </ion-card-content>
      </ion-card>
    </template>
  </div>
</template>

<style scoped>
.coordination-page {
  padding: 16px;
  max-width: 1200px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 12px;
}

.page-header h2 {
  margin: 0;
  font-size: 1.4rem;
}

.controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

.controls ion-segment {
  width: 200px;
}

.loading-state, .empty-state {
  text-align: center;
  padding: 48px 16px;
}

.empty-state p {
  margin: 12px 0 16px;
  color: var(--ion-color-medium);
}

.no-data {
  text-align: center;
  padding: 24px;
  color: var(--ion-color-medium);
}

/* Correlation matrix */
.matrix-scroll {
  overflow-x: auto;
}

.correlation-matrix {
  border-collapse: collapse;
  font-size: 12px;
  min-width: 100%;
}

.correlation-matrix th, .correlation-matrix td {
  padding: 6px 8px;
  text-align: center;
  border: 1px solid rgba(255,255,255,0.08);
}

.rotated-header span {
  display: inline-block;
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
}

.row-label {
  text-align: left !important;
  font-weight: 500;
  white-space: nowrap;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.matrix-cell {
  min-width: 70px;
  font-variant-numeric: tabular-nums;
  cursor: default;
}

.legend {
  display: flex;
  gap: 16px;
  margin-top: 12px;
  font-size: 12px;
  color: var(--ion-color-medium);
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.swatch {
  display: inline-block;
  width: 14px;
  height: 14px;
  border-radius: 3px;
  border: 1px solid rgba(255,255,255,0.15);
}

/* Data tables */
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.data-table th {
  text-align: left;
  padding: 8px 12px;
  font-weight: 600;
  border-bottom: 1px solid rgba(255,255,255,0.12);
  font-size: 12px;
  text-transform: uppercase;
  color: var(--ion-color-medium);
}

.data-table td {
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  font-variant-numeric: tabular-nums;
}

.gap-row {
  background-color: rgba(234, 179, 8, 0.08);
}

.negative {
  color: #ef4444;
  font-weight: 600;
}

.positive {
  color: #22c55e;
  font-weight: 600;
}
</style>
