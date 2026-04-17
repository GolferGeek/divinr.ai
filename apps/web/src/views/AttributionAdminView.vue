<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import {
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonButton,
  IonSpinner,
  IonInput,
} from '@ionic/vue';
import { useAttributionStore, type AttributionFilters } from '../stores/attribution.store';

const store = useAttributionStore();

const activeTab = ref<'triple' | 'analyst' | 'instrument' | 'source' | 'author'>('triple');

const filters = ref<AttributionFilters>({
  yearMonth: currentYearMonth(),
  authorUserId: '',
  analystId: '',
  instrumentId: '',
  sourceKey: '',
});

const fetching = ref(false);
const refreshing = ref(false);
const refreshResult = ref<{ refreshed: number; failed: string[] } | null>(null);

function currentYearMonth(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function cleanFilters(): AttributionFilters {
  const f = filters.value;
  const out: AttributionFilters = { limit: 100 };
  if (f.yearMonth) out.yearMonth = f.yearMonth;
  if (f.authorUserId) out.authorUserId = f.authorUserId;
  if (f.analystId) out.analystId = f.analystId;
  if (f.instrumentId) out.instrumentId = f.instrumentId;
  if (f.sourceKey) out.sourceKey = f.sourceKey;
  return out;
}

async function fetchActive() {
  fetching.value = true;
  const f = cleanFilters();
  try {
    if (activeTab.value === 'triple') await store.fetchPerTriple(f);
    else if (activeTab.value === 'analyst') await store.fetchPerAnalyst(f);
    else if (activeTab.value === 'instrument') await store.fetchPerInstrument(f);
    else if (activeTab.value === 'source') await store.fetchPerSource(f);
    else if (activeTab.value === 'author') await store.fetchPerAuthor(f);
  } finally {
    fetching.value = false;
  }
}

async function refresh() {
  refreshing.value = true;
  refreshResult.value = null;
  try {
    refreshResult.value = await store.refreshViews();
    await fetchActive();
  } catch {
    refreshResult.value = { refreshed: 0, failed: ['refresh failed'] };
  } finally {
    refreshing.value = false;
  }
}

onMounted(() => fetchActive());
watch(activeTab, () => fetchActive());

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

function formatPct(rate: number | null | undefined): string {
  if (rate == null) return '—';
  return `${(Number(rate) * 100).toFixed(1)}%`;
}
</script>

<template>
  <div style="padding: 16px; max-width: 1400px; margin: 0 auto;">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
      <h2 style="margin: 0;">Attribution</h2>
      <IonButton size="small" :disabled="refreshing" @click="refresh">
        <IonSpinner v-if="refreshing" name="dots" style="width: 14px; height: 14px; margin-right: 6px;" />
        Refresh views
      </IonButton>
    </div>
    <p style="color: var(--ion-color-medium); font-size: 13px;">
      Paper P&amp;L (no cash), estimate only. Materialized views refresh nightly at 00:30; use "Refresh views" for on-demand.
    </p>
    <div v-if="refreshResult" style="font-size: 13px; margin: 8px 0;">
      Refreshed {{ refreshResult.refreshed }} view(s)<span v-if="refreshResult.failed.length"> · failed: {{ refreshResult.failed.join(', ') }}</span>.
    </div>

    <IonSegment
      :value="activeTab"
      style="margin-bottom: 16px;"
      @ionChange="(e: any) => activeTab = String(e.detail.value) as typeof activeTab"
    >
      <IonSegmentButton value="triple"><IonLabel>Per Triple</IonLabel></IonSegmentButton>
      <IonSegmentButton value="analyst"><IonLabel>Per Analyst</IonLabel></IonSegmentButton>
      <IonSegmentButton value="instrument"><IonLabel>Per Instrument</IonLabel></IonSegmentButton>
      <IonSegmentButton value="source"><IonLabel>Per Source</IonLabel></IonSegmentButton>
      <IonSegmentButton value="author"><IonLabel>Per Author</IonLabel></IonSegmentButton>
    </IonSegment>

    <div style="display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end; margin-bottom: 16px;">
      <div>
        <div style="font-size: 12px; color: var(--ion-color-medium); margin-bottom: 2px;">Year-Month (YYYY-MM)</div>
        <IonInput v-model="filters.yearMonth" placeholder="2026-04" style="width: 120px; border: 1px solid var(--ion-color-light); --padding-start: 8px;" />
      </div>
      <div>
        <div style="font-size: 12px; color: var(--ion-color-medium); margin-bottom: 2px;">Author user ID</div>
        <IonInput v-model="filters.authorUserId" placeholder="any" style="width: 180px; border: 1px solid var(--ion-color-light); --padding-start: 8px;" />
      </div>
      <div>
        <div style="font-size: 12px; color: var(--ion-color-medium); margin-bottom: 2px;">Analyst ID</div>
        <IonInput v-model="filters.analystId" placeholder="any" style="width: 180px; border: 1px solid var(--ion-color-light); --padding-start: 8px;" />
      </div>
      <div>
        <div style="font-size: 12px; color: var(--ion-color-medium); margin-bottom: 2px;">Instrument ID</div>
        <IonInput v-model="filters.instrumentId" placeholder="any" style="width: 180px; border: 1px solid var(--ion-color-light); --padding-start: 8px;" />
      </div>
      <div v-if="activeTab === 'source'">
        <div style="font-size: 12px; color: var(--ion-color-medium); margin-bottom: 2px;">Source key</div>
        <IonInput v-model="filters.sourceKey" placeholder="any" style="width: 160px; border: 1px solid var(--ion-color-light); --padding-start: 8px;" />
      </div>
      <IonButton size="small" fill="outline" @click="fetchActive">Apply filters</IonButton>
    </div>

    <div v-if="fetching" style="text-align: center; padding: 24px;">
      <IonSpinner name="dots" />
    </div>

    <table v-else-if="activeTab === 'triple'" style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr style="text-align: left; border-bottom: 2px solid var(--ion-color-medium);">
          <th style="padding: 8px;">Month</th>
          <th style="padding: 8px;">Author</th>
          <th style="padding: 8px;">Analyst</th>
          <th style="padding: 8px;">Instrument</th>
          <th style="padding: 8px; text-align: right;">Outcomes</th>
          <th style="padding: 8px; text-align: right;">Hit rate</th>
          <th style="padding: 8px; text-align: right;">Paper P&amp;L</th>
          <th style="padding: 8px; text-align: right;">Calibration score</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in store.perTriple"
          :key="`${row.year_month}-${row.author_user_id ?? 'base'}-${row.analyst_id}-${row.instrument_id}`"
          style="border-bottom: 1px solid var(--ion-color-light);"
        >
          <td style="padding: 8px;">{{ row.year_month }}</td>
          <td style="padding: 8px; font-family: monospace; font-size: 12px;">{{ row.author_user_id ? row.author_user_id.slice(0,12) : 'base' }}</td>
          <td style="padding: 8px; font-family: monospace; font-size: 12px;">{{ row.analyst_id.slice(0,12) }}</td>
          <td style="padding: 8px; font-family: monospace; font-size: 12px;">{{ row.instrument_id.slice(0,12) }}</td>
          <td style="padding: 8px; text-align: right;">{{ row.outcomes_count }}</td>
          <td style="padding: 8px; text-align: right;">{{ formatPct(row.hit_rate) }}</td>
          <td style="padding: 8px; text-align: right;">{{ formatCents(row.total_pnl_cents) }}</td>
          <td style="padding: 8px; text-align: right;">{{ formatScore(row.avg_calibration_score) }}</td>
        </tr>
        <tr v-if="store.perTriple.length === 0">
          <td colspan="8" style="padding: 16px; text-align: center; color: var(--ion-color-medium);">No rows for the current filters.</td>
        </tr>
      </tbody>
    </table>

    <table v-else-if="activeTab === 'analyst'" style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr style="text-align: left; border-bottom: 2px solid var(--ion-color-medium);">
          <th style="padding: 8px;">Month</th>
          <th style="padding: 8px;">Author</th>
          <th style="padding: 8px;">Analyst</th>
          <th style="padding: 8px; text-align: right;">Outcomes</th>
          <th style="padding: 8px; text-align: right;">Hit rate</th>
          <th style="padding: 8px; text-align: right;">Paper P&amp;L</th>
          <th style="padding: 8px; text-align: right;">Calibration score</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in store.perAnalyst"
          :key="`${row.year_month}-${row.author_user_id ?? 'base'}-${row.analyst_id}`"
          style="border-bottom: 1px solid var(--ion-color-light);"
        >
          <td style="padding: 8px;">{{ row.year_month }}</td>
          <td style="padding: 8px; font-family: monospace; font-size: 12px;">{{ row.author_user_id ? row.author_user_id.slice(0,12) : 'base' }}</td>
          <td style="padding: 8px; font-family: monospace; font-size: 12px;">{{ row.analyst_id.slice(0,12) }}</td>
          <td style="padding: 8px; text-align: right;">{{ row.outcomes_count }}</td>
          <td style="padding: 8px; text-align: right;">{{ formatPct(row.hit_rate) }}</td>
          <td style="padding: 8px; text-align: right;">{{ formatCents(row.total_pnl_cents) }}</td>
          <td style="padding: 8px; text-align: right;">{{ formatScore(row.avg_calibration_score) }}</td>
        </tr>
        <tr v-if="store.perAnalyst.length === 0">
          <td colspan="7" style="padding: 16px; text-align: center; color: var(--ion-color-medium);">No rows for the current filters.</td>
        </tr>
      </tbody>
    </table>

    <table v-else-if="activeTab === 'instrument'" style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr style="text-align: left; border-bottom: 2px solid var(--ion-color-medium);">
          <th style="padding: 8px;">Month</th>
          <th style="padding: 8px;">Instrument</th>
          <th style="padding: 8px; text-align: right;">Outcomes</th>
          <th style="padding: 8px; text-align: right;">Hit rate</th>
          <th style="padding: 8px; text-align: right;">Paper P&amp;L</th>
          <th style="padding: 8px; text-align: right;">Calibration score</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in store.perInstrument" :key="`${row.year_month}-${row.instrument_id}`" style="border-bottom: 1px solid var(--ion-color-light);">
          <td style="padding: 8px;">{{ row.year_month }}</td>
          <td style="padding: 8px; font-family: monospace; font-size: 12px;">{{ row.instrument_id.slice(0,12) }}</td>
          <td style="padding: 8px; text-align: right;">{{ row.outcomes_count }}</td>
          <td style="padding: 8px; text-align: right;">{{ formatPct(row.hit_rate) }}</td>
          <td style="padding: 8px; text-align: right;">{{ formatCents(row.total_pnl_cents) }}</td>
          <td style="padding: 8px; text-align: right;">{{ formatScore(row.avg_calibration_score) }}</td>
        </tr>
        <tr v-if="store.perInstrument.length === 0">
          <td colspan="6" style="padding: 16px; text-align: center; color: var(--ion-color-medium);">No rows for the current filters.</td>
        </tr>
      </tbody>
    </table>

    <table v-else-if="activeTab === 'source'" style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr style="text-align: left; border-bottom: 2px solid var(--ion-color-medium);">
          <th style="padding: 8px;">Month</th>
          <th style="padding: 8px;">Source key</th>
          <th style="padding: 8px; text-align: right;">Predictions contributed</th>
          <th style="padding: 8px; text-align: right;">Paper P&amp;L</th>
          <th style="padding: 8px; text-align: right;">Avg paper P&amp;L / prediction</th>
          <th style="padding: 8px; text-align: right;">Calibration score</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in store.perSource" :key="`${row.year_month}-${row.source_key}`" style="border-bottom: 1px solid var(--ion-color-light);">
          <td style="padding: 8px;">{{ row.year_month }}</td>
          <td style="padding: 8px;">{{ row.source_key }}</td>
          <td style="padding: 8px; text-align: right;">{{ row.predictions_contributed }}</td>
          <td style="padding: 8px; text-align: right;">{{ formatCents(row.total_pnl_cents) }}</td>
          <td style="padding: 8px; text-align: right;">{{ formatCents(row.avg_pnl_per_prediction_cents) }}</td>
          <td style="padding: 8px; text-align: right;">{{ formatScore(row.avg_calibration_score) }}</td>
        </tr>
        <tr v-if="store.perSource.length === 0">
          <td colspan="6" style="padding: 16px; text-align: center; color: var(--ion-color-medium);">No rows for the current filters.</td>
        </tr>
      </tbody>
    </table>

    <table v-else style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr style="text-align: left; border-bottom: 2px solid var(--ion-color-medium);">
          <th style="padding: 8px;">Month</th>
          <th style="padding: 8px;">Author</th>
          <th style="padding: 8px; text-align: right;">Outcomes</th>
          <th style="padding: 8px; text-align: right;">Hit rate</th>
          <th style="padding: 8px; text-align: right;">Paper P&amp;L</th>
          <th style="padding: 8px; text-align: right;">Calibration score</th>
          <th style="padding: 8px; text-align: right;">Distinct items</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in store.perAuthor" :key="`${row.year_month}-${row.author_user_id}`" style="border-bottom: 1px solid var(--ion-color-light);">
          <td style="padding: 8px;">{{ row.year_month }}</td>
          <td style="padding: 8px; font-family: monospace; font-size: 12px;">{{ row.author_user_id.slice(0,12) }}</td>
          <td style="padding: 8px; text-align: right;">{{ row.outcomes_count }}</td>
          <td style="padding: 8px; text-align: right;">{{ formatPct(row.hit_rate) }}</td>
          <td style="padding: 8px; text-align: right;">{{ formatCents(row.total_pnl_cents) }}</td>
          <td style="padding: 8px; text-align: right;">{{ formatScore(row.avg_calibration_score) }}</td>
          <td style="padding: 8px; text-align: right;">{{ row.distinct_items_count }}</td>
        </tr>
        <tr v-if="store.perAuthor.length === 0">
          <td colspan="7" style="padding: 16px; text-align: center; color: var(--ion-color-medium);">No rows for the current filters.</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
