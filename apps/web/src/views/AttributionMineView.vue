<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { IonSpinner } from '@ionic/vue';
import { useMyAttribution } from '../composables/useMyAttribution';
import GraduationSuggestionBanner from '../components/GraduationSuggestionBanner.vue';

import FirstTouchPanel from '../components/FirstTouchPanel.vue';
import LegalDisclaimer from '../components/LegalDisclaimer.vue';
const { summary, loading, error, fetchMySummary } = useMyAttribution();

onMounted(() => fetchMySummary());

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

const topDecileItems = computed(() => summary.value?.topDecileItems ?? []);
const byItem = computed(() => summary.value?.byItem ?? []);
const history = computed(() => summary.value?.history ?? []);

// simple sparkline: plot calibration scores across months
function sparklinePoints(values: Array<number | null>): string {
  const nums = values.map((v) => (v == null ? null : Number(v)));
  const defined = nums.filter((v): v is number => v != null && Number.isFinite(v));
  if (defined.length === 0) return '';
  const min = Math.min(...defined, -1);
  const max = Math.max(...defined, 1);
  const range = max - min || 1;
  const width = 120;
  const height = 28;
  const step = nums.length > 1 ? width / (nums.length - 1) : 0;
  return nums
    .map((v, i) => {
      if (v == null || !Number.isFinite(v)) return null;
      const x = i * step;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter(Boolean)
    .join(' ');
}

const calibrationSparkline = computed(() =>
  sparklinePoints([...history.value].reverse().map((r) => r.avg_calibration_score)),
);

const pnlSparkline = computed(() =>
  sparklinePoints([...history.value].reverse().map((r) => Number(r.total_pnl_cents ?? 0))),
);
</script>

<template>
  <div style="padding: 16px; max-width: 1200px; margin: 0 auto;">
    <h2 style="margin-bottom: 4px;">My Attribution</h2>
    <div style="color: var(--ion-color-medium); font-size: 13px; margin-bottom: 16px;">
      P&amp;L (paper, no cash). Estimates only.
      <LegalDisclaimer variant="short" />
    </div>

    <GraduationSuggestionBanner :items="topDecileItems" />

    <div v-if="loading && !summary" style="text-align: center; padding: 32px;">
      <IonSpinner name="dots" />
    </div>
    <div v-else-if="error" style="padding: 16px; color: var(--ion-color-danger);">
      Could not load attribution summary. {{ error }}
    </div>
    <template v-else>
      <section style="margin-top: 24px;">
        <h3 style="margin-bottom: 8px;">This month</h3>
        <div v-if="summary?.currentMonth" style="display: flex; gap: 24px; flex-wrap: wrap; font-size: 14px;">
          <div>
            <div style="color: var(--ion-color-medium); font-size: 12px;">Paper P&amp;L</div>
            <div style="font-size: 20px; font-weight: 600;">{{ formatCents(summary.currentMonth.total_pnl_cents) }}</div>
          </div>
          <div>
            <div style="color: var(--ion-color-medium); font-size: 12px;">Calibration score</div>
            <div style="font-size: 20px; font-weight: 600;">{{ formatScore(summary.currentMonth.avg_calibration_score) }}</div>
          </div>
          <div>
            <div style="color: var(--ion-color-medium); font-size: 12px;">Hit rate</div>
            <div style="font-size: 20px; font-weight: 600;">{{ formatPct(summary.currentMonth.hit_rate) }}</div>
          </div>
          <div>
            <div style="color: var(--ion-color-medium); font-size: 12px;">Outcomes</div>
            <div style="font-size: 20px; font-weight: 600;">{{ summary.currentMonth.outcomes_count }}</div>
          </div>
          <div>
            <div style="color: var(--ion-color-medium); font-size: 12px;">Items</div>
            <div style="font-size: 20px; font-weight: 600;">{{ summary.currentMonth.distinct_items_count }}</div>
          </div>
        </div>
        <div v-else style="color: var(--ion-color-medium); font-style: italic;">
          No outcomes recorded this month yet.
        </div>
      </section>

      <section style="margin-top: 32px;">
        <h3 style="margin-bottom: 8px;">Per-item this month</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="text-align: left; border-bottom: 2px solid var(--ion-color-medium);">
              <th style="padding: 8px;">Analyst</th>
              <th style="padding: 8px;">Instrument</th>
              <th style="padding: 8px; text-align: right;">Outcomes</th>
              <th style="padding: 8px; text-align: right;">Hit rate</th>
              <th style="padding: 8px; text-align: right;">Paper P&amp;L</th>
              <th style="padding: 8px; text-align: right;">Calibration score</th>
              <th style="padding: 8px;"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in byItem"
              :key="`${row.analyst_id}-${row.instrument_id}`"
              style="border-bottom: 1px solid var(--ion-color-light);"
            >
              <td style="padding: 8px; font-family: monospace; font-size: 12px;">{{ row.analyst_id.slice(0, 12) }}</td>
              <td style="padding: 8px; font-family: monospace; font-size: 12px;">{{ row.instrument_id.slice(0, 12) }}</td>
              <td style="padding: 8px; text-align: right;">{{ row.outcomes_count }}</td>
              <td style="padding: 8px; text-align: right;">{{ formatPct(row.hit_rate) }}</td>
              <td style="padding: 8px; text-align: right;">{{ formatCents(row.total_pnl_cents) }}</td>
              <td style="padding: 8px; text-align: right;">{{ formatScore(row.avg_calibration_score) }}</td>
              <td style="padding: 8px;">
                <router-link
                  :to="`/attribution/instrument/${row.instrument_id}`"
                  style="color: var(--ion-color-primary); font-size: 13px;"
                >
                  Details →
                </router-link>
              </td>
            </tr>
            <tr v-if="byItem.length === 0">
              <td colspan="7" style="padding: 16px; text-align: center; color: var(--ion-color-medium);">
                No per-item attribution yet this month.
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section v-if="history.length > 0" style="margin-top: 32px;">
        <h3 style="margin-bottom: 8px;">Trailing 3-month history</h3>
        <div style="display: flex; gap: 40px; flex-wrap: wrap;">
          <div>
            <div style="color: var(--ion-color-medium); font-size: 12px; margin-bottom: 4px;">Calibration score</div>
            <svg width="120" height="28" style="background: var(--ion-color-light-tint, #f5f5f5);">
              <polyline
                :points="calibrationSparkline"
                fill="none"
                stroke="var(--ion-color-primary, #3880ff)"
                stroke-width="1.5"
              />
            </svg>
          </div>
          <div>
            <div style="color: var(--ion-color-medium); font-size: 12px; margin-bottom: 4px;">Paper P&amp;L</div>
            <svg width="120" height="28" style="background: var(--ion-color-light-tint, #f5f5f5);">
              <polyline
                :points="pnlSparkline"
                fill="none"
                stroke="var(--ion-color-success, #2dd36f)"
                stroke-width="1.5"
              />
            </svg>
          </div>
        </div>
        <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
          <thead>
            <tr style="text-align: left; border-bottom: 2px solid var(--ion-color-medium);">
              <th style="padding: 8px;">Month</th>
              <th style="padding: 8px; text-align: right;">Outcomes</th>
              <th style="padding: 8px; text-align: right;">Hit rate</th>
              <th style="padding: 8px; text-align: right;">Paper P&amp;L</th>
              <th style="padding: 8px; text-align: right;">Calibration score</th>
              <th style="padding: 8px; text-align: right;">Distinct items</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in history" :key="row.year_month" style="border-bottom: 1px solid var(--ion-color-light);">
              <td style="padding: 8px;">{{ row.year_month }}</td>
              <td style="padding: 8px; text-align: right;">{{ row.outcomes_count }}</td>
              <td style="padding: 8px; text-align: right;">{{ formatPct(row.hit_rate) }}</td>
              <td style="padding: 8px; text-align: right;">{{ formatCents(row.total_pnl_cents) }}</td>
              <td style="padding: 8px; text-align: right;">{{ formatScore(row.avg_calibration_score) }}</td>
              <td style="padding: 8px; text-align: right;">{{ row.distinct_items_count }}</td>
            </tr>
          </tbody>
        </table>
      
  </section>
    </template>
  <FirstTouchPanel surface-key="authored.attribution.mine" />
  </div>
</template>
