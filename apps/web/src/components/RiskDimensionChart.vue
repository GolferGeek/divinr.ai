<script setup lang="ts">
import { IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonProgressBar, IonNote } from '@ionic/vue';

defineProps<{
  assessments: Record<string, unknown>[];
}>();

function scoreColor(score: number): string {
  if (score <= 33) return 'success';
  if (score <= 66) return 'warning';
  return 'danger';
}
</script>

<template>
  <ion-card>
    <ion-card-header><ion-card-title>Risk Dimensions</ion-card-title></ion-card-header>
    <ion-card-content>
      <div v-for="a in assessments" :key="String(a['id'])" style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <span>{{ a['dimension_name'] || a['dimension_slug'] }}</span>
          <span style="font-weight:bold">{{ a['score'] }}/100</span>
        </div>
        <div style="position:relative">
          <ion-progress-bar
            :value="Number(a['score']) / 100"
            :color="scoreColor(Number(a['score']))"
            style="height:20px"
          />
          <span style="position:absolute;top:0;left:50%;transform:translateX(-50%);font-size:0.75rem;line-height:20px">
            {{ Number(a['confidence']).toFixed(0) }}% conf
          </span>
        </div>
        <p style="font-size:0.75rem;opacity:0.5;margin-top:4px">{{ String(a['reasoning']).slice(0, 150) }}</p>
      </div>
      <ion-note v-if="assessments.length === 0" color="primary" style="display:block;padding:8px">
        No dimension assessments available.
      </ion-note>
    </ion-card-content>
  </ion-card>
</template>
