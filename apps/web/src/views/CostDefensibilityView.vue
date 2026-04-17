<script setup lang="ts">
import { onMounted } from 'vue';
import { useUsageStore } from '../stores/usage.store';

const store = useUsageStore();
onMounted(() => store.fetchDefensibility());

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

    <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
      <thead>
        <tr style="text-align: left; border-bottom: 2px solid var(--ion-color-medium);">
          <th style="padding: 8px;">Item kind</th>
          <th style="padding: 8px; text-align: right;">Avg monthly cost</th>
          <th style="padding: 8px; text-align: right;">Current monthly fee</th>
          <th style="padding: 8px; text-align: right;">Margin %</th>
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
          <td style="padding: 8px; text-align: right;">{{ row.underPricedCount }}</td>
          <td style="padding: 8px; text-align: right;">{{ row.overPricedCount }}</td>
        </tr>
        <tr v-if="store.defensibility.length === 0">
          <td colspan="6" style="padding: 16px; text-align: center; color: var(--ion-color-medium);">No defensibility data yet.</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
