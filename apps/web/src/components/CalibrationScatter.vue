<script setup lang="ts">
// Effort: calibration-drilldown. Confidence-vs-accuracy scatter plot.
// Bins predictions into 5 confidence buckets (50–60, 60–70, 70–80, 80–90,
// 90–100), plots one point per non-empty bin at (midpoint, accuracy), and
// draws a y=x reference line via chartjs-plugin-annotation. Confidence in the
// dev data is stored as 0..100 (not 0..1) — see plan deviations log.
import { computed } from 'vue';
import { Scatter } from 'vue-chartjs';
import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  type ChartOptions,
  type ChartData,
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import FirstTouchPanel from './FirstTouchPanel.vue';

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend, annotationPlugin);

interface ResolvedPrediction {
  wasCorrect: boolean;
  confidence: number | null;
}

const props = defineProps<{ predictions: ResolvedPrediction[] }>();

const BINS = [
  { lo: 50, hi: 60 },
  { lo: 60, hi: 70 },
  { lo: 70, hi: 80 },
  { lo: 80, hi: 90 },
  { lo: 90, hi: 100 },
];

const points = computed(() => {
  const result: Array<{ x: number; y: number; n: number }> = [];
  for (const bin of BINS) {
    const inBin = props.predictions.filter(
      (p) => p.confidence !== null && p.confidence >= bin.lo && p.confidence < (bin.hi === 100 ? 101 : bin.hi),
    );
    if (inBin.length === 0) continue;
    const correct = inBin.filter((p) => p.wasCorrect).length;
    result.push({ x: (bin.lo + bin.hi) / 2 / 100, y: correct / inBin.length, n: inBin.length });
  }
  return result;
});

const chartData = computed<ChartData<'scatter'>>(() => ({
  datasets: [
    {
      label: 'Confidence bin',
      data: points.value.map((p) => ({ x: p.x, y: p.y })),
      backgroundColor: '#60a5fa',
      borderColor: '#60a5fa',
      pointRadius: points.value.map((p) => (p.n < 2 ? 4 : 8)),
      pointHoverRadius: 10,
    },
  ],
}));

const chartOptions = computed<ChartOptions<'scatter'>>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    x: { type: 'linear', min: 0.5, max: 1.0, title: { display: true, text: 'Confidence' } },
    y: { type: 'linear', min: 0.5, max: 1.0, title: { display: true, text: 'Accuracy' } },
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (ctx) => {
          const p = points.value[ctx.dataIndex];
          if (!p) return '';
          return `conf ${(p.x * 100).toFixed(0)}% · acc ${(p.y * 100).toFixed(0)}% · n=${p.n}`;
        },
      },
    },
    annotation: {
      annotations: {
        ideal: {
          type: 'line',
          xMin: 0.5,
          xMax: 1.0,
          yMin: 0.5,
          yMax: 1.0,
          borderColor: 'rgba(255,255,255,0.3)',
          borderWidth: 1,
          borderDash: [4, 4],
          label: { display: false },
        },
      },
    },
  },
}));
</script>

<template>
  <div style="height:280px">
    <Scatter :data="chartData" :options="chartOptions" />
  <FirstTouchPanel surface-key="analyst.calibration-drilldown" />
  </div>
</template>
