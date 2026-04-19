<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import {
  IonSegment, IonSegmentButton, IonLabel, IonSpinner,
  IonCard, IonCardHeader, IonCardTitle, IonCardContent,
} from '@ionic/vue';
import { useUsageStore } from '../stores/usage.store';

import FirstTouchPanel from '../components/FirstTouchPanel.vue';
const store = useUsageStore();

const now = new Date();
const startDate = ref(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`);
const endDate = ref(now.toISOString().slice(0, 10));
const activeTab = ref('stage');

onMounted(() => { store.fetchAll(startDate.value, endDate.value); });

watch([startDate, endDate], ([s, e]) => { store.fetchAll(s, e); });

function formatCost(cents: number): string {
  if (!cents) return '$0.00';
  return `$${(cents / 100).toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
</script>

<template>
  <div style="padding: 16px; max-width: 1200px; margin: 0 auto;">
    <h2 style="margin-bottom: 8px;">LLM Usage Dashboard</h2>

    <div style="display: flex; gap: 12px; margin-bottom: 16px; align-items: center;">
      <label>
        From: <input type="date" v-model="startDate" style="padding: 4px;" />
      </label>
      <label>
        To: <input type="date" v-model="endDate" style="padding: 4px;" />
      </label>
      <IonSpinner v-if="store.loading" name="crescent" style="width: 20px; height: 20px;" />
    </div>

    <div style="display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap;">
      <IonCard style="flex: 1; min-width: 180px;">
        <IonCardHeader><IonCardTitle>Total Calls</IonCardTitle></IonCardHeader>
        <IonCardContent style="font-size: 24px; font-weight: bold;">
          {{ store.summary.total_calls.toLocaleString() }}
        </IonCardContent>
      </IonCard>
      <IonCard style="flex: 1; min-width: 180px;">
        <IonCardHeader><IonCardTitle>Total Tokens</IonCardTitle></IonCardHeader>
        <IonCardContent style="font-size: 24px; font-weight: bold;">
          {{ formatTokens(store.summary.total_tokens_in + store.summary.total_tokens_out) }}
        </IonCardContent>
      </IonCard>
      <IonCard style="flex: 1; min-width: 180px;">
        <IonCardHeader><IonCardTitle>Total Cost</IonCardTitle></IonCardHeader>
        <IonCardContent style="font-size: 24px; font-weight: bold;">
          {{ formatCost(store.summary.total_cost_cents) }}
        </IonCardContent>
      </IonCard>
    </div>

    <IonSegment :value="activeTab" @ionChange="(e: any) => activeTab = String(e.detail.value)">
      <IonSegmentButton value="stage"><IonLabel>By Stage</IonLabel></IonSegmentButton>
      <IonSegmentButton value="model"><IonLabel>By Model</IonLabel></IonSegmentButton>
      <IonSegmentButton value="user"><IonLabel>By User</IonLabel></IonSegmentButton>
      <IonSegmentButton value="base"><IonLabel>Base vs Extension</IonLabel></IonSegmentButton>
    </IonSegment>

    <div style="margin-top: 16px;">
      <!-- By Stage -->
      <table v-if="activeTab === 'stage'" style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="text-align: left; border-bottom: 2px solid var(--ion-color-medium);">
            <th style="padding: 8px;">Stage</th>
            <th style="padding: 8px;">Sub-stage</th>
            <th style="padding: 8px;">Date</th>
            <th style="padding: 8px; text-align: right;">Calls</th>
            <th style="padding: 8px; text-align: right;">Tokens</th>
            <th style="padding: 8px; text-align: right;">Cost</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in store.byStage" :key="i" style="border-bottom: 1px solid var(--ion-color-light);">
            <td style="padding: 8px;">{{ row.stage }}</td>
            <td style="padding: 8px;">{{ row.sub_stage || '-' }}</td>
            <td style="padding: 8px;">{{ row.date }}</td>
            <td style="padding: 8px; text-align: right;">{{ row.total_calls }}</td>
            <td style="padding: 8px; text-align: right;">{{ formatTokens(row.total_tokens_in + row.total_tokens_out) }}</td>
            <td style="padding: 8px; text-align: right;">{{ formatCost(row.total_cost_cents) }}</td>
          </tr>
          <tr v-if="store.byStage.length === 0">
            <td colspan="6" style="padding: 16px; text-align: center; color: var(--ion-color-medium);">No data for this period</td>
          </tr>
        </tbody>
      </table>

      <!-- By Model -->
      <table v-if="activeTab === 'model'" style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="text-align: left; border-bottom: 2px solid var(--ion-color-medium);">
            <th style="padding: 8px;">Model</th>
            <th style="padding: 8px;">Provider</th>
            <th style="padding: 8px;">Date</th>
            <th style="padding: 8px; text-align: right;">Calls</th>
            <th style="padding: 8px; text-align: right;">Tokens</th>
            <th style="padding: 8px; text-align: right;">Cost</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in store.byModel" :key="i" style="border-bottom: 1px solid var(--ion-color-light);">
            <td style="padding: 8px;">{{ row.model }}</td>
            <td style="padding: 8px;">{{ row.provider }}</td>
            <td style="padding: 8px;">{{ row.date }}</td>
            <td style="padding: 8px; text-align: right;">{{ row.total_calls }}</td>
            <td style="padding: 8px; text-align: right;">{{ formatTokens(row.total_tokens_in + row.total_tokens_out) }}</td>
            <td style="padding: 8px; text-align: right;">{{ formatCost(row.total_cost_cents) }}</td>
          </tr>
          <tr v-if="store.byModel.length === 0">
            <td colspan="6" style="padding: 16px; text-align: center; color: var(--ion-color-medium);">No data for this period</td>
          </tr>
        </tbody>
      </table>

      <!-- By User -->
      <table v-if="activeTab === 'user'" style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="text-align: left; border-bottom: 2px solid var(--ion-color-medium);">
            <th style="padding: 8px;">User ID</th>
            <th style="padding: 8px;">Month</th>
            <th style="padding: 8px; text-align: right;">Calls</th>
            <th style="padding: 8px; text-align: right;">Tokens</th>
            <th style="padding: 8px; text-align: right;">Cost</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in store.byUser" :key="i" style="border-bottom: 1px solid var(--ion-color-light);">
            <td style="padding: 8px;">{{ row.billed_user_id || '(Divinr)' }}</td>
            <td style="padding: 8px;">{{ row.year_month }}</td>
            <td style="padding: 8px; text-align: right;">{{ row.total_calls }}</td>
            <td style="padding: 8px; text-align: right;">{{ formatTokens(row.total_tokens_in + row.total_tokens_out) }}</td>
            <td style="padding: 8px; text-align: right;">{{ formatCost(row.total_cost_cents) }}</td>
          </tr>
          <tr v-if="store.byUser.length === 0">
            <td colspan="5" style="padding: 16px; text-align: center; color: var(--ion-color-medium);">No data for this period</td>
          </tr>
        </tbody>
      </table>

      <!-- Base vs Extension -->
      <table v-if="activeTab === 'base'" style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="text-align: left; border-bottom: 2px solid var(--ion-color-medium);">
            <th style="padding: 8px;">Date</th>
            <th style="padding: 8px;">Type</th>
            <th style="padding: 8px; text-align: right;">Calls</th>
            <th style="padding: 8px; text-align: right;">Tokens</th>
            <th style="padding: 8px; text-align: right;">Cost</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in store.baseVsExtension" :key="i" style="border-bottom: 1px solid var(--ion-color-light);">
            <td style="padding: 8px;">{{ row.date }}</td>
            <td style="padding: 8px;">{{ row.is_base ? 'Base' : 'Extension' }}</td>
            <td style="padding: 8px; text-align: right;">{{ row.total_calls }}</td>
            <td style="padding: 8px; text-align: right;">{{ formatTokens(row.total_tokens_in + row.total_tokens_out) }}</td>
            <td style="padding: 8px; text-align: right;">{{ formatCost(row.total_cost_cents) }}</td>
          </tr>
          <tr v-if="store.baseVsExtension.length === 0">
            <td colspan="5" style="padding: 16px; text-align: center; color: var(--ion-color-medium);">No data for this period</td>
          </tr>
        </tbody>
      </table>
    </div>
  
  <FirstTouchPanel surface-key="admin.llm-usage" />
  </div>
</template>
