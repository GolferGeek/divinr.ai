<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { IonSpinner, IonSelect, IonSelectOption, IonInput, IonButton } from '@ionic/vue';
import { useAttributionStore, type GraduationWindow } from '../stores/attribution.store';

import FirstTouchPanel from '../components/FirstTouchPanel.vue';
const store = useAttributionStore();

const windowVal = ref<GraduationWindow>('30d');
const top = ref<number>(50);
const minPredictions = ref<number>(20);
const fetching = ref(false);

async function load() {
  fetching.value = true;
  try {
    await store.fetchGraduationCandidates(windowVal.value, top.value, minPredictions.value);
  } finally {
    fetching.value = false;
  }
}

onMounted(() => load());

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

function hitRate(hits: number, total: number): string {
  if (!total) return '—';
  return `${((hits / total) * 100).toFixed(1)}%`;
}
</script>

<template>
  <div style="padding: 16px; max-width: 1400px; margin: 0 auto;">
    <h2>Graduation Candidates</h2>
    <p style="color: var(--ion-color-medium); font-size: 14px;">
      Top user-authored items by trailing-window paper P&amp;L. Feed for the future graduation effort.
      Estimate only — no cash earnings.
    </p>

    <div style="display: flex; gap: 16px; align-items: flex-end; margin-bottom: 16px;">
      <div>
        <div style="font-size: 12px; color: var(--ion-color-medium); margin-bottom: 2px;">Window</div>
        <IonSelect
          :value="windowVal"
          interface="popover"
          style="min-width: 120px; border: 1px solid var(--ion-color-light);"
          @ionChange="(e: any) => windowVal = (e.detail.value as GraduationWindow)"
        >
          <IonSelectOption value="7d">7 days</IonSelectOption>
          <IonSelectOption value="30d">30 days</IonSelectOption>
          <IonSelectOption value="90d">90 days</IonSelectOption>
        </IonSelect>
      </div>
      <div>
        <div style="font-size: 12px; color: var(--ion-color-medium); margin-bottom: 2px;">Top N</div>
        <IonInput
          type="number"
          :value="top"
          style="width: 90px; border: 1px solid var(--ion-color-light); --padding-start: 8px;"
          @ionInput="(e: any) => top = Number(e.detail.value) || 50"
        />
      </div>
      <div>
        <div style="font-size: 12px; color: var(--ion-color-medium); margin-bottom: 2px;">Min analyses</div>
        <IonInput
          type="number"
          :value="minPredictions"
          style="width: 90px; border: 1px solid var(--ion-color-light); --padding-start: 8px;"
          @ionInput="(e: any) => minPredictions = Number(e.detail.value) || 20"
        />
      </div>
      <IonButton size="small" fill="outline" @click="load">Apply</IonButton>
    </div>

    <div v-if="fetching" style="text-align: center; padding: 24px;">
      <IonSpinner name="dots" />
    </div>

    <table v-else style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr style="text-align: left; border-bottom: 2px solid var(--ion-color-medium);">
          <th style="padding: 8px;">Rank</th>
          <th style="padding: 8px;">Author</th>
          <th style="padding: 8px;">Item kind</th>
          <th style="padding: 8px;">Item ID</th>
          <th style="padding: 8px;">Analyst</th>
          <th style="padding: 8px;">Instrument</th>
          <th style="padding: 8px; text-align: right;">Analyses</th>
          <th style="padding: 8px; text-align: right;">Hit rate</th>
          <th style="padding: 8px; text-align: right;">Paper P&amp;L</th>
          <th style="padding: 8px; text-align: right;">Calibration score</th>
          <th style="padding: 8px; text-align: right;">Score</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(c, i) in store.graduationCandidates"
          :key="`${c.authorUserId}-${c.analystId ?? ''}-${c.instrumentId}`"
          style="border-bottom: 1px solid var(--ion-color-light);"
        >
          <td style="padding: 8px;">{{ i + 1 }}</td>
          <td style="padding: 8px; font-family: monospace; font-size: 12px;">{{ c.authorUserId.slice(0, 12) }}</td>
          <td style="padding: 8px;">{{ c.itemKind }}</td>
          <td style="padding: 8px; font-family: monospace; font-size: 12px;">{{ c.itemId ? c.itemId.slice(0, 12) : '—' }}</td>
          <td style="padding: 8px; font-family: monospace; font-size: 12px;">{{ c.analystId ? c.analystId.slice(0, 12) : '—' }}</td>
          <td style="padding: 8px; font-family: monospace; font-size: 12px;">{{ c.instrumentId.slice(0, 12) }}</td>
          <td style="padding: 8px; text-align: right;">{{ c.predictionCount }}</td>
          <td style="padding: 8px; text-align: right;">{{ hitRate(c.hitsCount, c.predictionCount) }}</td>
          <td style="padding: 8px; text-align: right;">{{ formatCents(c.pnlCents) }}</td>
          <td style="padding: 8px; text-align: right;">{{ formatScore(c.avgCalibrationScore) }}</td>
          <td style="padding: 8px; text-align: right;">{{ formatScore(c.score) }}</td>
        </tr>
        <tr v-if="store.graduationCandidates.length === 0">
          <td colspan="11" style="padding: 16px; text-align: center; color: var(--ion-color-medium);">
            No candidates meet the minimum-analyses threshold for this window.
          </td>
        </tr>
      </tbody>
    </table>
  
  <FirstTouchPanel surface-key="admin.graduation-candidates" />
  </div>
</template>
