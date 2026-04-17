<script setup lang="ts">
import { onMounted } from 'vue';
import { IonCard, IonCardHeader, IonCardTitle, IonCardContent } from '@ionic/vue';
import { useBillingSummaryStore } from '../stores/billing-summary.store';

const store = useBillingSummaryStore();
onMounted(() => store.fetchMySummary());

function formatCost(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
</script>

<template>
  <div style="padding: 16px; max-width: 1200px; margin: 0 auto;">
    <h2>Billing Summary</h2>
    <p style="color: var(--ion-color-medium); font-size: 14px;">
      Estimated compute cost for the current month, broken down by stage, triple, and model. This is an estimate of LLM compute consumption — does not include base subscription or authored-item fees.
    </p>

    <div v-if="!store.mySummary" style="padding: 32px; text-align: center; color: var(--ion-color-medium);">
      Loading…
    </div>

    <div v-else>
      <div style="display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap;">
        <IonCard style="flex: 1; min-width: 220px;">
          <IonCardHeader><IonCardTitle>This month ({{ store.mySummary.yearMonth }})</IonCardTitle></IonCardHeader>
          <IonCardContent>
            <div style="font-size: 24px; font-weight: bold;">{{ formatCost(store.mySummary.totalCostCentsThisMonth) }}</div>
            <div style="color: var(--ion-color-medium); font-size: 13px;">{{ store.mySummary.totalCallsThisMonth }} LLM calls</div>
          </IonCardContent>
        </IonCard>
        <IonCard style="flex: 1; min-width: 220px;">
          <IonCardHeader><IonCardTitle>Last month ({{ store.mySummary.priorMonth.yearMonth }})</IonCardTitle></IonCardHeader>
          <IonCardContent>
            <div style="font-size: 24px; font-weight: bold;">{{ formatCost(store.mySummary.priorMonth.totalCostCentsThisMonth) }}</div>
            <div style="color: var(--ion-color-medium); font-size: 13px;">{{ store.mySummary.priorMonth.totalCallsThisMonth }} LLM calls</div>
          </IonCardContent>
        </IonCard>
      </div>

      <h3>By stage</h3>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <thead>
          <tr style="text-align: left; border-bottom: 2px solid var(--ion-color-medium);">
            <th style="padding: 8px;">Stage</th>
            <th style="padding: 8px;">Sub-stage</th>
            <th style="padding: 8px; text-align: right;">Calls</th>
            <th style="padding: 8px; text-align: right;">Cost</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in store.mySummary.byStage" :key="i" style="border-bottom: 1px solid var(--ion-color-light);">
            <td style="padding: 8px;">{{ row.stage }}</td>
            <td style="padding: 8px;">{{ row.subStage || '—' }}</td>
            <td style="padding: 8px; text-align: right;">{{ row.calls }}</td>
            <td style="padding: 8px; text-align: right;">{{ formatCost(row.costCents) }}</td>
          </tr>
          <tr v-if="store.mySummary.byStage.length === 0">
            <td colspan="4" style="padding: 16px; text-align: center; color: var(--ion-color-medium);">No usage yet this month.</td>
          </tr>
        </tbody>
      </table>

      <h3>By triple (analyst × instrument)</h3>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <thead>
          <tr style="text-align: left; border-bottom: 2px solid var(--ion-color-medium);">
            <th style="padding: 8px;">Analyst</th>
            <th style="padding: 8px;">Instrument</th>
            <th style="padding: 8px; text-align: right;">Calls</th>
            <th style="padding: 8px; text-align: right;">Cost</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in store.mySummary.byTriple" :key="i" style="border-bottom: 1px solid var(--ion-color-light);">
            <td style="padding: 8px;">{{ row.analystId || '—' }}</td>
            <td style="padding: 8px;">{{ row.instrumentId || '—' }}</td>
            <td style="padding: 8px; text-align: right;">{{ row.calls }}</td>
            <td style="padding: 8px; text-align: right;">{{ formatCost(row.costCents) }}</td>
          </tr>
          <tr v-if="store.mySummary.byTriple.length === 0">
            <td colspan="4" style="padding: 16px; text-align: center; color: var(--ion-color-medium);">No triple-attributed usage yet.</td>
          </tr>
        </tbody>
      </table>

      <h3>By model</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="text-align: left; border-bottom: 2px solid var(--ion-color-medium);">
            <th style="padding: 8px;">Model</th>
            <th style="padding: 8px;">Provider</th>
            <th style="padding: 8px; text-align: right;">Calls</th>
            <th style="padding: 8px; text-align: right;">Cost</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in store.mySummary.byModel" :key="i" style="border-bottom: 1px solid var(--ion-color-light);">
            <td style="padding: 8px;">{{ row.model }}</td>
            <td style="padding: 8px;">{{ row.provider }}</td>
            <td style="padding: 8px; text-align: right;">{{ row.calls }}</td>
            <td style="padding: 8px; text-align: right;">{{ formatCost(row.costCents) }}</td>
          </tr>
          <tr v-if="store.mySummary.byModel.length === 0">
            <td colspan="4" style="padding: 16px; text-align: center; color: var(--ion-color-medium);">No model-attributed usage yet.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
