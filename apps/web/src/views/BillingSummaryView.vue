<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { IonButton, IonCard, IonCardHeader, IonCardTitle, IonCardContent, toastController } from '@ionic/vue';
import { useBillingSummaryStore } from '../stores/billing-summary.store';
import { useBillingStatusStore } from '../stores/billing-status.store';
import { useStripeRedirect } from '../composables/useStripeRedirect';
import { useApi } from '../composables/useApi';

import FirstTouchPanel from '../components/FirstTouchPanel.vue';
const store = useBillingSummaryStore();
const billing = useBillingStatusStore();
const { redirectToCheckout, redirectToPortal } = useStripeRedirect();
const redirecting = ref(false);

interface UpcomingInvoice {
  amountDue: number;
  currency: string;
  dueDate: string | null;
  lineItems: Array<{ description: string; amountCents: number; priceId: string | null }>;
}
const upcomingInvoice = ref<UpcomingInvoice | null>(null);

async function fetchUpcomingInvoice(): Promise<void> {
  try {
    const api = useApi('/api/billing');
    const preview = await api.get<{ upcomingInvoice: UpcomingInvoice | null }>('/preview');
    upcomingInvoice.value = preview.upcomingInvoice;
  } catch {
    upcomingInvoice.value = null;
  }
}

onMounted(() => {
  void store.fetchMySummary();
  if (!billing.loaded) void billing.fetch();
  void fetchUpcomingInvoice();
});

function formatCost(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const showAddCardCta = computed(() => !billing.hasCardOnFile);
const showManageCta = computed(() => billing.hasCardOnFile);

async function onAddCard() {
  await runRedirect(() => redirectToCheckout(window.location.href));
}

async function onManage() {
  await runRedirect(() => redirectToPortal(window.location.href));
}

async function runRedirect(call: () => Promise<{ ok: true; url: string } | { ok: false; error: { message: string } }>) {
  if (redirecting.value) return;
  redirecting.value = true;
  try {
    const result = await call();
    if (result.ok) {
      window.location.href = result.url;
      return;
    }
    const toast = await toastController.create({
      message: result.error.message,
      duration: 4000,
      color: 'warning',
      position: 'top',
    });
    await toast.present();
  } finally {
    redirecting.value = false;
  }
}
</script>

<template>
  <div style="padding: 16px; max-width: 1200px; margin: 0 auto;">
    <h2>Billing Summary</h2>
    <p style="color: var(--ion-color-medium); font-size: 14px;">
      Estimated compute cost for the current month, broken down by stage, triple, and model. This is an estimate of LLM compute consumption — does not include base subscription or authored-item fees.
    </p>

    <div
      v-if="billing.loaded"
      class="billing-actions"
      data-testid="billing-summary-actions"
    >
      <ion-button
        v-if="showAddCardCta"
        color="primary"
        :disabled="redirecting"
        data-testid="billing-summary-add-card"
        @click="onAddCard"
      >
        Add a card
      </ion-button>
      <ion-button
        v-if="showManageCta"
        color="primary"
        fill="outline"
        :disabled="redirecting"
        data-testid="billing-summary-manage"
        @click="onManage"
      >
        Manage Billing
      </ion-button>
    </div>

    <div
      v-if="upcomingInvoice"
      class="upcoming-invoice"
      data-testid="upcoming-invoice"
    >
      <h3>Upcoming invoice</h3>
      <p style="font-size: 13px; color: var(--ion-color-medium); margin: 0 0 8px;">
        Live preview from Stripe of what you'll be charged on the next billing cycle.
        <span v-if="upcomingInvoice.dueDate"> Due {{ new Date(upcomingInvoice.dueDate).toLocaleDateString() }}.</span>
      </p>
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="text-align: left; border-bottom: 2px solid var(--ion-color-medium);">
            <th style="padding: 8px;">Description</th>
            <th style="padding: 8px; text-align: right;">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(line, i) in upcomingInvoice.lineItems"
            :key="i"
            style="border-bottom: 1px solid var(--ion-color-light);"
            :data-testid="`upcoming-invoice-line-${i}`"
          >
            <td style="padding: 8px;">{{ line.description || '—' }}</td>
            <td
              style="padding: 8px; text-align: right;"
              :style="{ color: line.amountCents < 0 ? 'var(--ion-color-success)' : undefined }"
            >
              {{ formatCost(line.amountCents) }}
            </td>
          </tr>
          <tr style="border-top: 2px solid var(--ion-color-medium); font-weight: bold;">
            <td style="padding: 8px;">Total due</td>
            <td style="padding: 8px; text-align: right;" data-testid="upcoming-invoice-total">
              {{ formatCost(upcomingInvoice.amountDue) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

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
  
  <FirstTouchPanel surface-key="billing.summary" />
  </div>
</template>

<style scoped>
.billing-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin: 16px 0 24px;
}

.upcoming-invoice {
  margin: 0 0 32px;
  padding: 16px;
  background: var(--ion-color-light, #f5f5f5);
  border-radius: 8px;
}
</style>
