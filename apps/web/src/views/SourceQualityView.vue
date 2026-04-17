<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { IonSpinner, IonInput, IonButton } from '@ionic/vue';
import { useAttributionStore, type PerSourceRow } from '../stores/attribution.store';

const store = useAttributionStore();

const yearMonth = ref(currentYearMonth());
const fetching = ref(false);

type SortKey =
  | 'source_key'
  | 'predictions_contributed'
  | 'total_pnl_cents'
  | 'avg_pnl_per_prediction_cents'
  | 'avg_calibration_score';

const sortKey = ref<SortKey>('total_pnl_cents');
const sortDir = ref<'asc' | 'desc'>('desc');

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function load() {
  fetching.value = true;
  try {
    await store.fetchPerSource({ yearMonth: yearMonth.value || undefined, limit: 500 });
  } finally {
    fetching.value = false;
  }
}

function toggleSort(key: SortKey) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortKey.value = key;
    sortDir.value = key === 'source_key' ? 'asc' : 'desc';
  }
}

const sorted = computed<PerSourceRow[]>(() => {
  const rows = [...store.perSource];
  const dir = sortDir.value === 'asc' ? 1 : -1;
  const k = sortKey.value;
  rows.sort((a, b) => {
    const av = a[k];
    const bv = b[k];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
  return rows;
});

function sortIndicator(k: SortKey): string {
  if (sortKey.value !== k) return '';
  return sortDir.value === 'asc' ? ' ▲' : ' ▼';
}

function formatCents(cents: number | null | undefined): string {
  if (cents == null) return '—';
  const v = Number(cents);
  if (!Number.isFinite(v)) return '—';
  const prefix = v >= 0 ? '+' : '−';
  return `${prefix}$${(Math.abs(v) / 100).toFixed(2)}`;
}

function formatScore(score: number | null | undefined): string {
  if (score == null) return '—';
  const v = Number(score);
  if (!Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(3);
}

onMounted(() => load());
</script>

<template>
  <div style="padding: 16px; max-width: 1400px; margin: 0 auto;">
    <h2>Source Quality</h2>
    <p style="color: var(--ion-color-medium); font-size: 14px;">
      Paper P&amp;L per source-key across predictions. Estimate only, no cash. Sort any column.
    </p>

    <div style="display: flex; gap: 12px; align-items: flex-end; margin-bottom: 16px;">
      <div>
        <div style="font-size: 12px; color: var(--ion-color-medium); margin-bottom: 2px;">Year-Month</div>
        <IonInput v-model="yearMonth" placeholder="2026-04" style="width: 120px; border: 1px solid var(--ion-color-light); --padding-start: 8px;" />
      </div>
      <IonButton size="small" fill="outline" @click="load">Apply</IonButton>
    </div>

    <div v-if="fetching" style="text-align: center; padding: 24px;">
      <IonSpinner name="dots" />
    </div>

    <table v-else style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr style="text-align: left; border-bottom: 2px solid var(--ion-color-medium);">
          <th style="padding: 8px; cursor: pointer;" @click="toggleSort('source_key')">Source key{{ sortIndicator('source_key') }}</th>
          <th style="padding: 8px; text-align: right; cursor: pointer;" @click="toggleSort('predictions_contributed')">Predictions{{ sortIndicator('predictions_contributed') }}</th>
          <th style="padding: 8px; text-align: right; cursor: pointer;" @click="toggleSort('total_pnl_cents')">Paper P&amp;L{{ sortIndicator('total_pnl_cents') }}</th>
          <th style="padding: 8px; text-align: right; cursor: pointer;" @click="toggleSort('avg_pnl_per_prediction_cents')">Avg P&amp;L / prediction{{ sortIndicator('avg_pnl_per_prediction_cents') }}</th>
          <th style="padding: 8px; text-align: right; cursor: pointer;" @click="toggleSort('avg_calibration_score')">Calibration score{{ sortIndicator('avg_calibration_score') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in sorted" :key="`${row.year_month}-${row.source_key}`" style="border-bottom: 1px solid var(--ion-color-light);">
          <td style="padding: 8px;">{{ row.source_key }}</td>
          <td style="padding: 8px; text-align: right;">{{ row.predictions_contributed }}</td>
          <td style="padding: 8px; text-align: right;">{{ formatCents(row.total_pnl_cents) }}</td>
          <td style="padding: 8px; text-align: right;">{{ formatCents(row.avg_pnl_per_prediction_cents) }}</td>
          <td style="padding: 8px; text-align: right;">{{ formatScore(row.avg_calibration_score) }}</td>
        </tr>
        <tr v-if="sorted.length === 0">
          <td colspan="5" style="padding: 16px; text-align: center; color: var(--ion-color-medium);">No source data yet.</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
