<script setup lang="ts">
import { IonCard, IonCardContent, IonChip, IonProgressBar } from '@ionic/vue';

const props = defineProps<{
  score: number;
  confidence?: number;
  debateAdjustment?: number;
  preDebateScore?: number;
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
    <ion-card-content style="text-align:center;padding:24px">
      <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:1px;opacity:0.5;margin-bottom:8px">Composite Risk Score</div>
      <div :style="{ fontSize: '4rem', fontWeight: 'bold', lineHeight: '1', color: `var(--ion-color-${scoreColor(props.score)})` }">
        {{ props.score }}
      </div>
      <div style="font-size:0.75rem;opacity:0.4;margin-bottom:12px">/100</div>
      <ion-progress-bar
        :value="props.score / 100"
        :color="scoreColor(props.score)"
        style="margin:12px 0;height:8px;border-radius:4px"
      />
      <ion-chip :color="scoreColor(props.score)" style="font-size:0.85rem;margin-bottom:12px">
        {{ verdictLabel(props.score) }}
      </ion-chip>
      <div v-if="props.confidence" style="font-size:0.8rem;opacity:0.6;margin-bottom:4px">
        Confidence: {{ (props.confidence * 100).toFixed(0) }}%
      </div>
      <div v-if="props.debateAdjustment" style="margin-top:8px;padding:8px;border-radius:8px;background:var(--ion-color-light)">
        <div style="font-size:0.75rem;opacity:0.5">Debate Impact</div>
        <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:4px">
          <span style="font-size:0.85rem;opacity:0.6">{{ props.preDebateScore ?? (props.score - props.debateAdjustment) }}</span>
          <span style="opacity:0.3">→</span>
          <span style="font-size:0.85rem;font-weight:bold">{{ props.score }}</span>
          <ion-chip
            :color="props.debateAdjustment > 0 ? 'danger' : 'success'"
            style="font-size:0.7rem;height:20px"
          >
            {{ props.debateAdjustment > 0 ? '+' : '' }}{{ props.debateAdjustment }}
          </ion-chip>
        </div>
      </div>
    </ion-card-content>
  </ion-card>
</template>
