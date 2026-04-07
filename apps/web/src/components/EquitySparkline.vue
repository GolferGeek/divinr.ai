<script setup lang="ts">
import { computed } from 'vue';

interface Snapshot {
  snapshot_date?: string;
  ending_balance?: number | string;
  current_balance?: number | string;
  realized_pnl?: number | string;
  unrealized_pnl?: number | string;
  [k: string]: unknown;
}

const props = withDefaults(
  defineProps<{ snapshots: Snapshot[]; width?: number; height?: number }>(),
  { width: 80, height: 24 },
);

function pickValue(s: Snapshot): number {
  // Prefer ending_balance; fall back to current_balance; final fallback realized+unrealized
  const v = s.ending_balance ?? s.current_balance;
  if (v != null) return Number(v);
  const r = Number(s.realized_pnl ?? 0);
  const u = Number(s.unrealized_pnl ?? 0);
  return r + u;
}

const points = computed(() => props.snapshots.map(pickValue).filter((n) => Number.isFinite(n)));

const path = computed(() => {
  const pts = points.value;
  if (pts.length < 2) return '';
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const range = max - min || 1;
  const w = props.width;
  const h = props.height;
  const stepX = w / (pts.length - 1);
  return pts
    .map((v, i) => {
      const x = i * stepX;
      const y = h - ((v - min) / range) * h;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
});

const trendColor = computed(() => {
  const pts = points.value;
  if (pts.length < 2) return 'var(--ion-color-medium)';
  return pts[pts.length - 1] >= pts[0] ? 'var(--ion-color-success)' : 'var(--ion-color-danger)';
});
</script>

<template>
  <svg
    v-if="points.length >= 2"
    :width="width"
    :height="height"
    :viewBox="`0 0 ${width} ${height}`"
    style="display:inline-block;vertical-align:middle"
  >
    <path :d="path" :stroke="trendColor" stroke-width="1.5" fill="none" />
  </svg>
  <span v-else style="display:inline-block;opacity:0.4;font-size:0.7rem">—</span>
</template>
