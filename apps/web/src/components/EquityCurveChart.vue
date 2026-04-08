<script setup lang="ts">
import { computed, ref } from 'vue';
import type { SnapshotHistoryPoint, BenchmarkPoint } from '../stores/portfolio.store';

const props = withDefaults(
  defineProps<{
    history: SnapshotHistoryPoint[];
    benchmark?: BenchmarkPoint[];
    width?: number;
    height?: number;
  }>(),
  { width: 720, height: 220 },
);

const showSpy = ref(true);

const startingEquity = computed(() => {
  const h = props.history;
  return h.length > 0 ? h[0].equity : 0;
});

// Normalize SPY to the actor's starting balance for visual comparison.
const normalizedSpy = computed(() => {
  const series = props.benchmark ?? [];
  if (series.length === 0 || startingEquity.value === 0) return [];
  const base = series[0].spy_close;
  if (!base) return [];
  return series.map((p) => ({ date: p.date, value: (p.spy_close / base) * startingEquity.value }));
});

const bounds = computed(() => {
  const eq = props.history.map((p) => p.equity);
  const spy = showSpy.value ? normalizedSpy.value.map((p) => p.value) : [];
  const all = [...eq, ...spy].filter((n) => Number.isFinite(n));
  if (all.length === 0) return { min: 0, max: 1 };
  const min = Math.min(...all);
  const max = Math.max(...all);
  if (min === max) return { min: min - 1, max: max + 1 };
  const pad = (max - min) * 0.05;
  return { min: min - pad, max: max + pad };
});

function buildPath(values: number[]): string {
  if (values.length < 2) return '';
  const w = props.width;
  const h = props.height;
  const { min, max } = bounds.value;
  const range = max - min || 1;
  const stepX = w / (values.length - 1);
  return values
    .map((v, i) => {
      const x = i * stepX;
      const y = h - ((v - min) / range) * h;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

const equityPath = computed(() => buildPath(props.history.map((p) => p.equity)));
const spyPath = computed(() =>
  showSpy.value ? buildPath(normalizedSpy.value.map((p) => p.value)) : '',
);

const equityColor = computed(() => {
  const h = props.history;
  if (h.length < 2) return 'var(--ion-color-medium)';
  return h[h.length - 1].equity >= h[0].equity
    ? 'var(--ion-color-success)'
    : 'var(--ion-color-danger)';
});
</script>

<template>
  <div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <strong style="font-size:0.9rem">Equity curve</strong>
      <label v-if="(benchmark?.length ?? 0) > 0" style="font-size:0.75rem;cursor:pointer">
        <input type="checkbox" v-model="showSpy" data-testid="spy-overlay-toggle" />
        SPY overlay
      </label>
    </div>
    <svg
      v-if="history.length >= 2"
      :width="width"
      :height="height"
      :viewBox="`0 0 ${width} ${height}`"
      style="display:block;max-width:100%;height:auto;border:1px solid var(--ion-color-step-100)"
    >
      <path :d="equityPath" :stroke="equityColor" stroke-width="2" fill="none" />
      <path
        v-if="showSpy && spyPath"
        :d="spyPath"
        stroke="var(--ion-color-medium)"
        stroke-width="1.5"
        stroke-dasharray="4 3"
        fill="none"
      />
    </svg>
    <div v-else style="opacity:0.6;font-size:0.8rem">Not enough snapshot history.</div>
  </div>
</template>
