<script setup lang="ts">
import { onMounted, watch, computed } from 'vue';
import { useRoute } from 'vue-router';
import { IonSpinner } from '@ionic/vue';
import { useMyAttribution } from '../composables/useMyAttribution';

import FirstTouchPanel from '../components/FirstTouchPanel.vue';
const route = useRoute();
const { instrument, loading, error, fetchInstrument } = useMyAttribution();

const instrumentId = computed(() => String(route.params.id));

onMounted(() => {
  if (instrumentId.value) fetchInstrument(instrumentId.value);
});

watch(() => route.params.id, (id) => {
  if (id) fetchInstrument(String(id));
});

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

function ownedStyle(owned: boolean | undefined): string {
  return owned ? 'background-color: rgba(56, 128, 255, 0.08);' : '';
}
</script>

<template>
  <div style="padding: 16px; max-width: 1200px; margin: 0 auto;">
    <h2 style="margin-bottom: 4px;">Instrument attribution</h2>
    <div style="color: var(--ion-color-medium); font-size: 13px; margin-bottom: 16px;">
      Instrument ID: <code>{{ instrumentId }}</code> · Paper P&amp;L, estimate only.
    </div>

    <div v-if="loading && !instrument" style="text-align: center; padding: 32px;">
      <IonSpinner name="dots" />
    </div>
    <div v-else-if="error" style="padding: 16px; color: var(--ion-color-danger);">
      Could not load instrument attribution. {{ error }}
    </div>
    <template v-else-if="instrument">
      <section style="margin-top: 16px;">
        <h3 style="margin-bottom: 8px;">Base (system analysts)</h3>
        <div v-if="instrument.base" style="display: flex; gap: 24px; flex-wrap: wrap; font-size: 14px;">
          <div>
            <div style="color: var(--ion-color-medium); font-size: 12px;">Outcomes</div>
            <div style="font-size: 18px; font-weight: 600;">{{ instrument.base.totalOutcomes }}</div>
          </div>
          <div>
            <div style="color: var(--ion-color-medium); font-size: 12px;">Paper P&amp;L</div>
            <div style="font-size: 18px; font-weight: 600;">{{ formatCents(instrument.base.totalPnlCents) }}</div>
          </div>
          <div>
            <div style="color: var(--ion-color-medium); font-size: 12px;">Calibration (top row)</div>
            <div style="font-size: 18px; font-weight: 600;">{{ formatScore(instrument.base.avg_calibration_score) }}</div>
          </div>
        </div>
        <div v-else style="color: var(--ion-color-medium); font-style: italic;">
          No base-analyst outcomes this month.
        </div>
      </section>

      <section style="margin-top: 32px;">
        <h3 style="margin-bottom: 8px;">Per-author this month</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="text-align: left; border-bottom: 2px solid var(--ion-color-medium);">
              <th style="padding: 8px;">Author</th>
              <th style="padding: 8px;">Analyst</th>
              <th style="padding: 8px; text-align: right;">Outcomes</th>
              <th style="padding: 8px; text-align: right;">Hit rate</th>
              <th style="padding: 8px; text-align: right;">Paper P&amp;L</th>
              <th style="padding: 8px; text-align: right;">Calibration score</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in instrument.byAuthor"
              :key="`${row.author_user_id}-${row.analyst_id}`"
              :style="ownedStyle(row.userOwned) + 'border-bottom: 1px solid var(--ion-color-light);'"
            >
              <td style="padding: 8px; font-family: monospace; font-size: 12px;">
                {{ row.author_user_id ? row.author_user_id.slice(0, 12) : '—' }}
                <span v-if="row.userOwned" style="color: var(--ion-color-primary); font-weight: 600; margin-left: 6px;">(you)</span>
              </td>
              <td style="padding: 8px; font-family: monospace; font-size: 12px;">{{ row.analyst_id.slice(0, 12) }}</td>
              <td style="padding: 8px; text-align: right;">{{ row.outcomes_count }}</td>
              <td style="padding: 8px; text-align: right;">{{ formatPct(row.hit_rate) }}</td>
              <td style="padding: 8px; text-align: right;">{{ formatCents(row.total_pnl_cents) }}</td>
              <td style="padding: 8px; text-align: right;">{{ formatScore(row.avg_calibration_score) }}</td>
            </tr>
            <tr v-if="instrument.byAuthor.length === 0">
              <td colspan="6" style="padding: 16px; text-align: center; color: var(--ion-color-medium);">
                No per-author outcomes this month.
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section style="margin-top: 32px;">
        <h3 style="margin-bottom: 8px;">Top triples (all-time view)</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="text-align: left; border-bottom: 2px solid var(--ion-color-medium);">
              <th style="padding: 8px;">Month</th>
              <th style="padding: 8px;">Author</th>
              <th style="padding: 8px;">Analyst</th>
              <th style="padding: 8px; text-align: right;">Outcomes</th>
              <th style="padding: 8px; text-align: right;">Paper P&amp;L</th>
              <th style="padding: 8px; text-align: right;">Calibration score</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in instrument.topTriples"
              :key="`${row.year_month}-${row.author_user_id ?? 'base'}-${row.analyst_id}`"
              :style="ownedStyle(row.userOwned) + 'border-bottom: 1px solid var(--ion-color-light);'"
            >
              <td style="padding: 8px;">{{ row.year_month }}</td>
              <td style="padding: 8px; font-family: monospace; font-size: 12px;">
                {{ row.author_user_id ? row.author_user_id.slice(0, 12) : 'base' }}
              </td>
              <td style="padding: 8px; font-family: monospace; font-size: 12px;">{{ row.analyst_id.slice(0, 12) }}</td>
              <td style="padding: 8px; text-align: right;">{{ row.outcomes_count }}</td>
              <td style="padding: 8px; text-align: right;">{{ formatCents(row.total_pnl_cents) }}</td>
              <td style="padding: 8px; text-align: right;">{{ formatScore(row.avg_calibration_score) }}</td>
            </tr>
            <tr v-if="instrument.topTriples.length === 0">
              <td colspan="6" style="padding: 16px; text-align: center; color: var(--ion-color-medium);">
                No outcomes recorded for this instrument yet.
              </td>
            </tr>
          </tbody>
        </table>
      
  </section>
    </template>
  <FirstTouchPanel surface-key="instrument.attribution" />
  </div>
</template>
