<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { IonButton, IonSpinner, IonCard, IonCardHeader, IonCardTitle, IonCardContent } from '@ionic/vue';
import { useUsageStore } from '../stores/usage.store';

import FirstTouchPanel from '../components/FirstTouchPanel.vue';
const store = useUsageStore();
const refreshing = ref(false);
const refreshResult = ref<{ refreshedModels: number; alertsRaised: number; skippedModels: number } | null>(null);

onMounted(async () => {
  await store.fetchCalibration();
  await store.fetchDriftAlerts();
});

async function refresh() {
  refreshing.value = true;
  try { refreshResult.value = await store.refreshCalibration(); }
  catch { refreshResult.value = null; }
  refreshing.value = false;
}

async function acknowledge(id: string) {
  await store.acknowledgeDriftAlert(id);
}

function formatCost(cents: number | null): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(4)}`;
}

function formatPct(pct: number | null): string {
  if (pct == null) return '—';
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}
</script>

<template>
  <div style="padding: 16px; max-width: 1200px; margin: 0 auto;">
    <h2>Cost Calibration</h2>
    <p style="color: var(--ion-color-medium); font-size: 14px;">
      Per-model rolling cost averages from the LLM usage log. Estimates only — actual provider invoices remain authoritative.
    </p>

    <div style="display: flex; gap: 12px; margin-bottom: 16px; align-items: center;">
      <IonButton :disabled="refreshing" @click="refresh">
        {{ refreshing ? 'Refreshing…' : 'Refresh now' }}
      </IonButton>
      <IonSpinner v-if="refreshing" name="crescent" style="width: 20px; height: 20px;" />
      <span v-if="refreshResult && !refreshing" style="color: var(--ion-color-medium);">
        Refreshed {{ refreshResult.refreshedModels }} model(s), raised {{ refreshResult.alertsRaised }} alert(s), skipped {{ refreshResult.skippedModels }}.
      </span>
    </div>

    <IonCard v-if="store.driftAlerts.length > 0" style="border-left: 4px solid var(--ion-color-warning);">
      <IonCardHeader><IonCardTitle>Drift alerts ({{ store.driftAlerts.length }})</IonCardTitle></IonCardHeader>
      <IonCardContent>
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr>
              <th style="text-align: left; padding: 4px;">Model</th>
              <th style="text-align: left; padding: 4px;">Provider</th>
              <th style="text-align: right; padding: 4px;">Drift</th>
              <th style="text-align: right; padding: 4px;">Samples</th>
              <th style="text-align: left; padding: 4px;">Detected</th>
              <th style="text-align: left; padding: 4px;"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="alert in store.driftAlerts" :key="alert.id" style="border-top: 1px solid var(--ion-color-light);">
              <td style="padding: 4px;">{{ alert.model }}</td>
              <td style="padding: 4px;">{{ alert.provider }}</td>
              <td style="padding: 4px; text-align: right;">{{ formatPct(alert.drift_pct) }}</td>
              <td style="padding: 4px; text-align: right;">{{ alert.samples_count }}</td>
              <td style="padding: 4px; font-size: 12px; color: var(--ion-color-medium);">{{ alert.detected_at }}</td>
              <td style="padding: 4px;">
                <IonButton v-if="!alert.acknowledged_at" size="small" fill="outline" @click="acknowledge(alert.id)">Acknowledge</IonButton>
                <span v-else style="color: var(--ion-color-success); font-size: 12px;">Acked</span>
              </td>
            </tr>
          </tbody>
        </table>
      </IonCardContent>
    </IonCard>

    <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
      <thead>
        <tr style="text-align: left; border-bottom: 2px solid var(--ion-color-medium);">
          <th style="padding: 8px;">Model</th>
          <th style="padding: 8px;">Provider</th>
          <th style="padding: 8px; text-align: right;">Samples</th>
          <th style="padding: 8px; text-align: right;">Avg cost / call</th>
          <th style="padding: 8px; text-align: right;">$/M in</th>
          <th style="padding: 8px; text-align: right;">$/M out</th>
          <th style="padding: 8px; text-align: right;">Drift</th>
          <th style="padding: 8px;">Last calibrated</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in store.calibration" :key="`${row.model}:${row.provider}`" style="border-bottom: 1px solid var(--ion-color-light);">
          <td style="padding: 8px;">
            {{ row.model }}
            <span v-if="row.samples_count < 50" style="font-size: 11px; color: var(--ion-color-warning); margin-left: 6px;">Insufficient samples</span>
          </td>
          <td style="padding: 8px;">{{ row.provider }}</td>
          <td style="padding: 8px; text-align: right;">{{ row.samples_count.toLocaleString() }}</td>
          <td style="padding: 8px; text-align: right;">{{ formatCost(row.rolling_avg_cost_cents_per_call) }}</td>
          <td style="padding: 8px; text-align: right;">{{ row.per_million_tokens_in_usd != null ? `$${row.per_million_tokens_in_usd.toFixed(2)}` : '—' }}</td>
          <td style="padding: 8px; text-align: right;">{{ row.per_million_tokens_out_usd != null ? `$${row.per_million_tokens_out_usd.toFixed(2)}` : '—' }}</td>
          <td style="padding: 8px; text-align: right;">{{ formatPct(row.drift_pct) }}</td>
          <td style="padding: 8px; font-size: 12px; color: var(--ion-color-medium);">{{ row.last_calibrated_at }}</td>
        </tr>
        <tr v-if="store.calibration.length === 0">
          <td colspan="8" style="padding: 16px; text-align: center; color: var(--ion-color-medium);">No calibrated models yet — click Refresh to compute averages.</td>
        </tr>
      </tbody>
    </table>
  
  <FirstTouchPanel surface-key="admin.cost-modeling.calibration" />
  </div>
</template>
