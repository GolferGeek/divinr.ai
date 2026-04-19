<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { useUsageStore } from '../stores/usage.store';
import { useAttributionStore } from '../stores/attribution.store';

import FirstTouchPanel from '../components/FirstTouchPanel.vue';
const store = useUsageStore();
const attribution = useAttributionStore();

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

onMounted(async () => {
  await store.fetchDefensibility();
  try {
    await attribution.fetchPerAuthor({ yearMonth: currentYearMonth(), limit: 1000 });
  } catch { /* attribution extension is optional */ }
});

const totalPaperPnlCents = computed(() =>
  attribution.perAuthor.reduce((s, r) => s + Number(r.total_pnl_cents ?? 0), 0),
);
const hasAttribution = computed(() => attribution.perAuthor.length > 0);

function valuePerComputeDollar(costCents: number): string {
  if (!hasAttribution.value) return '—';
  if (!costCents || costCents <= 0) return '—';
  const ratio = totalPaperPnlCents.value / costCents;
  return ratio.toFixed(2);
}

function formatCost(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function rowStyle(under: number, over: number): string {
  if (under > 0) return 'background-color: rgba(255, 100, 100, 0.08);';
  if (over > 0) return 'background-color: rgba(100, 200, 100, 0.08);';
  return '';
}

function formatKind(k: string): string {
  return k.split('_').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
}
</script>

<template>
  <div style="padding: 16px; max-width: 1200px; margin: 0 auto;">
    <h2>Pricing Defensibility</h2>
    <p style="color: var(--ion-color-medium); font-size: 14px;">
      Estimated margin per authored-item kind. Costs are derived from the LLM usage log; fees come from active <code>billing.authored_items</code>
      (or env-var defaults when no items exist). Adjust pricing by editing the env vars
      <code>ANALYST_AUTHORSHIP_USD</code>, <code>INSTRUMENT_AUTHORSHIP_USD</code>, <code>CONTRACT_OVERRIDE_USD</code>, <code>BYO_PLATFORM_FEE_USD</code>.
    </p>

    <p v-if="hasAttribution" style="color: var(--ion-color-medium); font-size: 12px; font-style: italic;">
      "Value / Compute $" is an estimate: aggregate paper P&amp;L across all authored items this month divided by each kind's compute cost. Paper P&amp;L, no cash.
    </p>

    <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
      <thead>
        <tr style="text-align: left; border-bottom: 2px solid var(--ion-color-medium);">
          <th style="padding: 8px;">Item kind</th>
          <th style="padding: 8px; text-align: right;">Avg monthly cost</th>
          <th style="padding: 8px; text-align: right;">Current monthly fee</th>
          <th style="padding: 8px; text-align: right;">Margin %</th>
          <th style="padding: 8px; text-align: right;">Value / Compute $</th>
          <th style="padding: 8px; text-align: right;">Under-priced</th>
          <th style="padding: 8px; text-align: right;">Over-priced</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in store.defensibility"
          :key="row.itemKind"
          :style="rowStyle(row.underPricedCount, row.overPricedCount) + 'border-bottom: 1px solid var(--ion-color-light);'"
        >
          <td style="padding: 8px;">{{ formatKind(row.itemKind) }}</td>
          <td style="padding: 8px; text-align: right;">{{ formatCost(row.avgMonthlyCostCents) }}</td>
          <td style="padding: 8px; text-align: right;">{{ formatCost(row.currentMonthlyFeeCents) }}</td>
          <td style="padding: 8px; text-align: right;">{{ row.marginPct.toFixed(1) }}%</td>
          <td style="padding: 8px; text-align: right;">{{ valuePerComputeDollar(row.avgMonthlyCostCents) }}</td>
          <td style="padding: 8px; text-align: right;">{{ row.underPricedCount }}</td>
          <td style="padding: 8px; text-align: right;">{{ row.overPricedCount }}</td>
        </tr>
        <tr v-if="store.defensibility.length === 0">
          <td colspan="7" style="padding: 16px; text-align: center; color: var(--ion-color-medium);">No defensibility data yet.</td>
        </tr>
      </tbody>
    </table>
  
  <FirstTouchPanel surface-key="admin.cost-modeling.defensibility" />
  </div>
</template>
