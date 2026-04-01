<script setup lang="ts">
import { IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonChip } from '@ionic/vue';

defineProps<{
  direction: string;
  confidence: number;
  rationale: string;
}>();

function directionColor(dir: string): string {
  if (dir === 'up') return 'success';
  if (dir === 'down') return 'danger';
  return 'medium';
}
</script>

<template>
  <ion-card color="primary">
    <ion-card-header>
      <ion-card-title style="display:flex;align-items:center">
        Final Verdict
        <span style="flex:1" />
        <ion-chip :color="directionColor(direction)" style="font-size:1rem">
          {{ direction === 'up' ? 'UP' : direction === 'down' ? 'DOWN' : 'FLAT' }}
        </ion-chip>
      </ion-card-title>
    </ion-card-header>
    <ion-card-content>
      <div style="font-size:0.75rem;margin-bottom:4px">Confidence: {{ confidence }}%</div>
      <p>{{ rationale }}</p>
    </ion-card-content>
  </ion-card>
</template>
