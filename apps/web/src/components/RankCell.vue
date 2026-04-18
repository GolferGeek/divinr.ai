<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  rank: number;
  delta: number | null;
}>();

const deltaClass = computed<'up' | 'down' | 'flat' | 'blank'>(() => {
  if (props.delta === null || props.delta === undefined) return 'blank';
  if (props.delta > 0) return 'up';
  if (props.delta < 0) return 'down';
  return 'flat';
});

const deltaLabel = computed<string>(() => {
  if (props.delta === null || props.delta === undefined) return '';
  if (props.delta === 0) return '—';
  // Truncate magnitude above 99 so the sticky rank column can't blow its width budget (PRD §7 Risk 6).
  const mag = Math.abs(props.delta);
  const shown = mag > 99 ? '99+' : String(mag);
  return props.delta > 0 ? `↑${shown}` : `↓${shown}`;
});
</script>

<template>
  <span class="rank-cell">
    <span class="rank-num">{{ rank }}</span>
    <span
      v-if="delta !== null && delta !== undefined"
      class="rank-delta"
      :class="deltaClass"
    >{{ deltaLabel }}</span>
  </span>
</template>

<style scoped>
.rank-cell {
  display: inline-flex;
  align-items: baseline;
  gap: 0.25rem;
  font-variant-numeric: tabular-nums;
}
.rank-num {
  font-weight: 700;
}
.rank-delta {
  font-size: 0.85em;
  font-variant-numeric: tabular-nums;
}
.rank-delta.up {
  color: var(--ion-color-success);
}
.rank-delta.down {
  color: var(--ion-color-danger);
}
.rank-delta.flat {
  color: var(--ion-color-medium);
}
</style>
