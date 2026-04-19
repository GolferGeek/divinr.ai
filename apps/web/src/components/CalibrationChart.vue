<script setup lang="ts">
import { computed } from 'vue';
import type { CalibrationBucket } from '../stores/portfolio.store';
import LegalDisclaimer from './LegalDisclaimer.vue';

const props = withDefaults(
  defineProps<{ buckets: CalibrationBucket[]; width?: number; height?: number }>(),
  { width: 480, height: 200 },
);

const layout = computed(() => {
  const w = props.width;
  const h = props.height;
  const padTop = 16;
  const padBottom = 28;
  const padLeft = 32;
  const padRight = 8;
  const innerW = w - padLeft - padRight;
  const innerH = h - padTop - padBottom;
  const groupW = innerW / Math.max(props.buckets.length, 1);
  const barW = groupW / 2 - 4;
  return { w, h, padTop, padBottom, padLeft, padRight, innerW, innerH, groupW, barW };
});

function barY(pct: number): number {
  // pct is 0..100 (predicted_avg already in % space; realized_rate in 0..1)
  const v = Math.max(0, Math.min(100, pct));
  const { padTop, innerH } = layout.value;
  return padTop + innerH - (v / 100) * innerH;
}

function barH(pct: number): number {
  const v = Math.max(0, Math.min(100, pct));
  const { innerH } = layout.value;
  return (v / 100) * innerH;
}
</script>

<template>
  <div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <strong style="font-size:0.9rem">Calibration (projected vs realized)</strong>
      <span style="font-size:0.7rem;opacity:0.7">
        <span style="display:inline-block;width:10px;height:10px;background:var(--ion-color-primary);margin-right:4px"></span>projected
        <span style="display:inline-block;width:10px;height:10px;background:var(--ion-color-success);margin:0 4px 0 10px"></span>realized
      </span>
    </div>
    <svg
      :width="layout.w"
      :height="layout.h"
      :viewBox="`0 0 ${layout.w} ${layout.h}`"
      style="display:block;max-width:100%;height:auto;border:1px solid var(--ion-color-step-100)"
    >
      <!-- y-axis 0/50/100 ticks -->
      <line :x1="layout.padLeft" :y1="barY(0)" :x2="layout.w - layout.padRight" :y2="barY(0)" stroke="var(--ion-color-step-150)" />
      <line :x1="layout.padLeft" :y1="barY(50)" :x2="layout.w - layout.padRight" :y2="barY(50)" stroke="var(--ion-color-step-100)" stroke-dasharray="2 2" />
      <text :x="6" :y="barY(0) + 4" font-size="9" fill="var(--ion-color-medium)">0%</text>
      <text :x="6" :y="barY(50) + 4" font-size="9" fill="var(--ion-color-medium)">50%</text>
      <text :x="6" :y="barY(100) + 8" font-size="9" fill="var(--ion-color-medium)">100%</text>

      <g v-for="(b, i) in buckets" :key="i">
        <rect
          :x="layout.padLeft + i * layout.groupW + 2"
          :y="barY(b.predicted_avg)"
          :width="layout.barW"
          :height="barH(b.predicted_avg)"
          fill="var(--ion-color-primary)"
        />
        <rect
          :x="layout.padLeft + i * layout.groupW + 2 + layout.barW + 4"
          :y="barY(b.realized_rate * 100)"
          :width="layout.barW"
          :height="barH(b.realized_rate * 100)"
          fill="var(--ion-color-success)"
        />
        <text
          :x="layout.padLeft + i * layout.groupW + layout.groupW / 2"
          :y="layout.h - layout.padBottom + 14"
          font-size="9"
          text-anchor="middle"
          fill="var(--ion-color-medium)"
        >{{ b.bucket_min }}–{{ b.bucket_max === 101 ? 100 : b.bucket_max }}%</text>
        <text
          :x="layout.padLeft + i * layout.groupW + layout.groupW / 2"
          :y="layout.h - layout.padBottom + 24"
          font-size="8"
          text-anchor="middle"
          fill="var(--ion-color-medium)"
        >n={{ b.count }}</text>
      </g>
    </svg>
    <div style="font-size:0.7rem;opacity:0.6;margin:4px 0 0 0">
      Conviction-bucketed analysis signal accuracy.
      <LegalDisclaimer variant="short" />
    </div>
  </div>
</template>
