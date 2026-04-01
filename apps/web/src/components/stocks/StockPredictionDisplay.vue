<script setup lang="ts">
import { useDomainStore } from '../../stores/domain.store';
import { IonChip, IonProgressBar, IonIcon } from '@ionic/vue';
import { arrowUpOutline, arrowDownOutline, arrowForwardOutline } from 'ionicons/icons';

defineProps<{
  direction: string;
  confidence: number;
  horizon?: number;
}>();

const domain = useDomainStore();
const format = domain.predictionDisplayFormat;

function directionIcon(dir: string): string {
  if (dir === 'up') return arrowUpOutline;
  if (dir === 'down') return arrowDownOutline;
  return arrowForwardOutline;
}

function directionColor(dir: string): string {
  if (dir === 'up') return 'success';
  if (dir === 'down') return 'danger';
  return 'medium';
}
</script>

<template>
  <div style="display:flex;align-items:center;gap:8px">
    <!-- Direction: arrow or badge based on plane config -->
    <template v-if="format?.directionFormat === 'arrow'">
      <ion-icon :icon="directionIcon(direction)" :color="directionColor(direction)" style="font-size:24px" />
    </template>
    <template v-else>
      <ion-chip :color="directionColor(direction)" style="font-size:0.7rem;height:24px">{{ direction }}</ion-chip>
    </template>

    <!-- Confidence: bar or percentage based on plane config -->
    <template v-if="format?.confidenceFormat === 'bar'">
      <ion-progress-bar :value="confidence / 100" :color="directionColor(direction)" style="max-width:100px" />
      <span style="font-size:0.75rem">{{ confidence }}%</span>
    </template>
    <template v-else>
      <span>{{ confidence }}%</span>
    </template>

    <!-- Horizon -->
    <span v-if="horizon" style="font-size:0.75rem;opacity:0.5">{{ horizon }}min</span>
  </div>
</template>
