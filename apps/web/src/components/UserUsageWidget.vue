<script setup lang="ts">
import { onMounted } from 'vue';
import { IonCard, IonCardContent, IonSpinner } from '@ionic/vue';
import { useUsageStore } from '../stores/usage.store';
import { useBillingSummaryStore } from '../stores/billing-summary.store';
import { useAuthStore } from '../stores/auth.store';

const store = useUsageStore();
const billingStore = useBillingSummaryStore();
const auth = useAuthStore();

onMounted(async () => {
  await store.fetchMyUsage();
  if (auth.userId) await billingStore.predictCost(auth.userId);
});

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
  <IonCard>
    <IonCardContent style="padding: 12px 16px;">
      <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
        <span style="font-weight: 600; color: var(--ion-color-medium);">This month:</span>
        <IonSpinner v-if="store.loading" name="dots" style="width: 16px; height: 16px;" />
        <template v-else>
          <span>{{ store.myUsage.total_calls }} calls</span>
          <span>{{ formatTokens(store.myUsage.total_tokens_in + store.myUsage.total_tokens_out) }} tokens</span>
          <span>~{{ formatCost(store.myUsage.total_cost_cents) }}</span>
        </template>
        <span style="margin-left: auto;">
          <router-link to="/billing/summary" style="font-size: 13px; color: var(--ion-color-primary);">Full breakdown →</router-link>
        </span>
      </div>
      <div v-if="billingStore.prediction" style="margin-top: 8px; font-size: 13px; color: var(--ion-color-medium);">
        Projected next month: ~{{ formatCost(billingStore.prediction.predictedMonthlyCents) }}
        ({{ billingStore.prediction.confidence }} confidence)
      </div>
    </IonCardContent>
  </IonCard>
</template>
