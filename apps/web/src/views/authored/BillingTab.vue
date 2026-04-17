<script setup lang="ts">
import { ref, onMounted } from 'vue';
import {
  IonSpinner, IonNote, IonButton, IonCard, IonCardHeader, IonCardContent,
} from '@ionic/vue';
import { useBillingApi } from '../../api/authored-content';
import BillingPreview from '../../components/BillingPreview.vue';

interface AuthoredItem {
  kind: string;
  itemId: string | null;
  monthlyUsd: number;
  status: string;
}

interface BillingPreviewData {
  basicMonthlyUsd: number;
  authoredItems: AuthoredItem[];
  byoPlatformFeeUsd: number;
  totalMonthlyUsd: number;
}

const billingApi = useBillingApi();
const preview = ref<BillingPreviewData | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

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

function kindLabel(kind: string): string {
  switch (kind) {
    case 'custom_analyst': return 'Authored Analyst';
    case 'custom_instrument': return 'Authored Instrument';
    case 'analyst_contract_override': return 'Analyst Contract Override';
    case 'instrument_contract_override': return 'Instrument Contract Override';
    case 'byo_platform_fee': return 'BYO Platform Fee';
    default: return kind;
  }
}

onMounted(fetchPreview);
</script>

<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px">
      <h2 style="margin: 0">Billing</h2>
    </div>

    <ion-spinner v-if="loading" name="crescent" />

    <ion-note v-if="error" color="danger" style="display: block; padding: 12px; margin-bottom: 8px">
      {{ error }}
    </ion-note>

    <div v-if="!loading && preview" style="max-width: 520px">
      <ion-card>
        <ion-card-header>
          <strong>Monthly Estimate</strong>
        </ion-card-header>
        <ion-card-content>
          <table style="width: 100%; border-collapse: collapse; font-size: 0.95rem">
            <tbody>
              <tr style="border-bottom: 1px solid var(--ion-color-light, #e0e0e0)">
                <td style="padding: 8px 0">Base Subscription</td>
                <td style="text-align: right; padding: 8px 0">{{ formatUsd(preview.basicMonthlyUsd) }}/mo</td>
              </tr>
              <tr
                v-for="(item, idx) in preview.authoredItems"
                :key="idx"
                style="border-bottom: 1px solid var(--ion-color-light, #e0e0e0)"
              >
                <td style="padding: 8px 0">
                  <BillingPreview :kind="item.kind" />
                </td>
                <td style="text-align: right; padding: 8px 0">
                  +{{ formatUsd(item.monthlyUsd) }}/mo
                </td>
              </tr>
              <tr v-if="preview.byoPlatformFeeUsd > 0" style="border-bottom: 1px solid var(--ion-color-light, #e0e0e0)">
                <td style="padding: 8px 0">BYO Platform Fee</td>
                <td style="text-align: right; padding: 8px 0">+{{ formatUsd(preview.byoPlatformFeeUsd) }}/mo</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td style="padding: 12px 0; font-weight: bold">Total</td>
                <td style="text-align: right; padding: 12px 0; font-weight: bold">{{ formatUsd(preview.totalMonthlyUsd) }}/mo</td>
              </tr>
            </tfoot>
          </table>
        </ion-card-content>
      </ion-card>

      <div v-if="preview.authoredItems.length === 0" style="text-align: center; padding: 24px 16px; color: #888">
        No authored content yet. Create analysts or instruments to see billing line items.
      </div>

      <ion-button expand="block" fill="outline" disabled style="margin-top: 16px">
        Manage Card (Stripe not configured)
      </ion-button>
    </div>
  </div>
</template>
