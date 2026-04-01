<script setup lang="ts">
import { IonCard, IonCardContent, IonChip, IonProgressBar } from '@ionic/vue';

const props = defineProps<{
  score: number;
  confidence?: number;
  debateAdjustment?: number;
}>();

function scoreColor(score: number): string {
  if (score <= 33) return 'success';
  if (score <= 66) return 'warning';
  return 'danger';
}

function verdictLabel(score: number): string {
  if (score <= 33) return 'LOW RISK';
  if (score <= 66) return 'MEDIUM RISK';
  return 'HIGH RISK';
}
</script>

<template>
  <ion-card>
    <ion-card-content style="text-align:center">
      <div :style="{ fontSize: '3rem', fontWeight: 'bold', color: `var(--ion-color-${scoreColor(props.score)})` }">{{ props.score }}</div>
      <div style="font-size:0.75rem;opacity:0.5">/100</div>
      <ion-progress-bar
        :value="props.score / 100"
        :color="scoreColor(props.score)"
        style="margin:12px 0"
      />
      <ion-chip :color="scoreColor(props.score)" style="font-size:0.8rem">{{ verdictLabel(props.score) }}</ion-chip>
      <div v-if="props.confidence" style="font-size:0.75rem;opacity:0.5;margin-top:8px">
        Confidence: {{ (props.confidence * 100).toFixed(0) }}%
      </div>
      <div v-if="props.debateAdjustment" style="font-size:0.75rem;margin-top:4px">
        Debate adjustment: <span :style="{ color: props.debateAdjustment > 0 ? 'var(--ion-color-danger)' : 'var(--ion-color-success)' }">
          {{ props.debateAdjustment > 0 ? '+' : '' }}{{ props.debateAdjustment }}
        </span>
      </div>
    </ion-card-content>
  </ion-card>
</template>
