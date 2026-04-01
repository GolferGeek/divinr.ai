<script setup lang="ts">
import {
  IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonChip, IonProgressBar,
} from '@ionic/vue';

defineProps<{
  name: string;
  direction: string;
  confidence: number;
  rationale: string;
  weight?: number;
}>();

function directionColor(dir: string): string {
  if (dir === 'up') return 'success';
  if (dir === 'down') return 'danger';
  return 'medium';
}
</script>

<template>
  <ion-card>
    <ion-card-header>
      <ion-card-title style="display:flex;align-items:center">
        {{ name }}
        <ion-chip v-if="weight" outline style="font-size:0.7rem;height:20px;margin-left:8px">w:{{ weight.toFixed(1) }}</ion-chip>
        <span style="flex:1" />
        <ion-chip :color="directionColor(direction)" style="font-size:0.8rem">
          {{ direction === 'up' ? 'UP' : direction === 'down' ? 'DOWN' : 'FLAT' }}
        </ion-chip>
      </ion-card-title>
    </ion-card-header>
    <ion-card-content>
      <ion-progress-bar :value="confidence / 100" color="primary" style="margin-bottom:8px" />
      <div style="font-size:0.75rem;margin-bottom:4px">Confidence: {{ confidence }}%</div>
      <p>{{ rationale.slice(0, 300) }}</p>
    </ion-card-content>
  </ion-card>
</template>
