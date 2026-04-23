<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import {
  IonSpinner, IonNote, IonButton, IonCard, IonCardHeader, IonCardContent, IonIcon,
} from '@ionic/vue';
import { chevronDown, chevronForward } from 'ionicons/icons';
import { useBillingApi } from '../../api/authored-content';
import { useFirstTouch } from '../../composables/useFirstTouch';

interface AuthoredItem { kind: string; itemId: string | null; monthlyUsd: number; status: string }
interface AuthoredAnalyst { id: string | null; displayName: string; monthlyUsd: number }
interface AuthoredInstrument { id: string | null; displayName: string; monthlyUsd: number }

interface BillingPreviewData {
  basicMonthlyUsd: number;
  authoredItems: AuthoredItem[];
  authoredAnalysts: AuthoredAnalyst[];
  authoredInstruments: AuthoredInstrument[];
  byoPlatformFeeUsd: number;
  totalMonthlyUsd: number;
}

const billingApi = useBillingApi();
const preview = ref<BillingPreviewData | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

const analystsExpanded = ref(false);
const instrumentsExpanded = ref(false);

useFirstTouch('billing.bill-overview');

async function fetchPreview() {
  loading.value = true;
  error.value = null;
  try {
    preview.value = await billingApi.getBillingPreview();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
  loading.value = false;
}

function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

const analystsRollup = computed(() => {
  const items = preview.value?.authoredAnalysts ?? [];
  return { count: items.length, total: items.reduce((s, r) => s + r.monthlyUsd, 0) };
});

const instrumentsRollup = computed(() => {
  const items = preview.value?.authoredInstruments ?? [];
  return { count: items.length, total: items.reduce((s, r) => s + r.monthlyUsd, 0) };
});

onMounted(fetchPreview);
</script>

<template>
  <div data-testid="billing-tab">
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px">
      <h2 style="margin: 0">Billing</h2>
    </div>

    <ion-spinner v-if="loading" name="crescent" />

    <ion-note v-if="error" color="danger" style="display: block; padding: 12px; margin-bottom: 8px">
      {{ error }}
    </ion-note>

    <div v-if="!loading && preview" style="max-width: 560px" data-testid="billing-preview">
      <ion-card>
        <ion-card-header>
          <strong>Monthly Estimate</strong>
        </ion-card-header>
        <ion-card-content>
          <table style="width: 100%; border-collapse: collapse; font-size: 0.95rem">
            <tbody>
              <tr data-testid="bill-basic" style="border-bottom: 1px solid var(--ion-color-light, #e0e0e0)">
                <td style="padding: 10px 0">Divinr Basic</td>
                <td style="text-align: right; padding: 10px 0">{{ formatUsd(preview.basicMonthlyUsd) }}/mo</td>
              </tr>

              <tr
                v-if="analystsRollup.count > 0"
                data-testid="bill-analysts-rollup"
                style="border-bottom: 1px solid var(--ion-color-light, #e0e0e0); cursor: pointer"
                @click="analystsExpanded = !analystsExpanded"
              >
                <td style="padding: 10px 0; display: flex; align-items: center; gap: 6px">
                  <ion-icon :icon="analystsExpanded ? chevronDown : chevronForward" style="font-size: 0.9rem" />
                  <span>Authored Analysts ($60 × {{ analystsRollup.count }})</span>
                </td>
                <td style="text-align: right; padding: 10px 0">+{{ formatUsd(analystsRollup.total) }}/mo</td>
              </tr>
              <template v-if="analystsExpanded">
                <tr
                  v-for="a in preview.authoredAnalysts"
                  :key="a.id ?? a.displayName"
                  data-testid="bill-analyst-row"
                  style="border-bottom: 1px solid var(--ion-color-light, #f0f0f4)"
                >
                  <td style="padding: 6px 0 6px 22px; color: #555">{{ a.displayName }}</td>
                  <td style="text-align: right; padding: 6px 0; color: #555">+{{ formatUsd(a.monthlyUsd) }}/mo</td>
                </tr>
              </template>

              <tr
                v-if="instrumentsRollup.count > 0"
                data-testid="bill-instruments-rollup"
                style="border-bottom: 1px solid var(--ion-color-light, #e0e0e0); cursor: pointer"
                @click="instrumentsExpanded = !instrumentsExpanded"
              >
                <td style="padding: 10px 0; display: flex; align-items: center; gap: 6px">
                  <ion-icon :icon="instrumentsExpanded ? chevronDown : chevronForward" style="font-size: 0.9rem" />
                  <span>Authored Instruments ($20 × {{ instrumentsRollup.count }})</span>
                </td>
                <td style="text-align: right; padding: 10px 0">+{{ formatUsd(instrumentsRollup.total) }}/mo</td>
              </tr>
              <template v-if="instrumentsExpanded">
                <tr
                  v-for="i in preview.authoredInstruments"
                  :key="i.id ?? i.displayName"
                  data-testid="bill-instrument-row"
                  style="border-bottom: 1px solid var(--ion-color-light, #f0f0f4)"
                >
                  <td style="padding: 6px 0 6px 22px; color: #555">{{ i.displayName }}</td>
                  <td style="text-align: right; padding: 6px 0; color: #555">+{{ formatUsd(i.monthlyUsd) }}/mo</td>
                </tr>
              </template>

              <tr
                v-if="preview.byoPlatformFeeUsd > 0"
                data-testid="bill-byo-fee"
                style="border-bottom: 1px solid var(--ion-color-light, #e0e0e0)"
              >
                <td style="padding: 10px 0">BYO API Key Platform Fee</td>
                <td style="text-align: right; padding: 10px 0">+{{ formatUsd(preview.byoPlatformFeeUsd) }}/mo</td>
              </tr>
            </tbody>
            <tfoot>
              <tr data-testid="bill-total">
                <td style="padding: 14px 0; font-weight: bold">Monthly Total</td>
                <td style="text-align: right; padding: 14px 0; font-weight: bold">
                  {{ formatUsd(preview.totalMonthlyUsd) }}/mo
                </td>
              </tr>
            </tfoot>
          </table>
        </ion-card-content>
      </ion-card>

      <div
        v-if="preview.authoredAnalysts.length === 0 && preview.authoredInstruments.length === 0 && preview.byoPlatformFeeUsd === 0"
        style="text-align: center; padding: 20px 16px; color: #888"
      >
        No authored content yet — your bill is just the $50 Basic plan.
      </div>

      <ion-button expand="block" fill="outline" disabled style="margin-top: 16px">
        Manage Card (Stripe not configured)
      </ion-button>
    </div>
  </div>
</template>
