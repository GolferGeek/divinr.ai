<script setup lang="ts">
import {
  IonCard, IonCardHeader, IonCardTitle, IonCardContent,
  IonGrid, IonRow, IonCol, IonChip,
} from '@ionic/vue';

defineProps<{
  debate: Record<string, unknown> | null;
}>();
</script>

<template>
  <ion-card v-if="debate">
    <ion-card-header>
      <ion-card-title style="display:flex;align-items:center">
        Risk Debate
        <span style="flex:1" />
        <ion-chip :color="debate['status'] === 'completed' ? 'success' : 'warning'" style="font-size:0.7rem;height:24px">
          {{ debate['status'] }}
        </ion-chip>
      </ion-card-title>
    </ion-card-header>
    <ion-card-content>
      <ion-grid>
        <ion-row>
          <ion-col size="12" size-md="4">
            <div style="font-size:0.85rem;font-weight:600;color:var(--ion-color-tertiary);margin-bottom:4px">Blue (Defense)</div>
            <p>{{ (debate['blue_assessment'] as Record<string, unknown>)?.['summary'] ?? 'N/A' }}</p>
          </ion-col>
          <ion-col size="12" size-md="4">
            <div style="font-size:0.85rem;font-weight:600;color:var(--ion-color-danger);margin-bottom:4px">Red (Challenge)</div>
            <p>{{ ((debate['red_challenges'] as Record<string, unknown>)?.['challenges'] as string[])?.join('; ') ?? 'N/A' }}</p>
          </ion-col>
          <ion-col size="12" size-md="4">
            <div style="font-size:0.85rem;font-weight:600;color:var(--ion-color-success);margin-bottom:4px">Arbiter (Synthesis)</div>
            <p>{{ (debate['arbiter_synthesis'] as Record<string, unknown>)?.['final_assessment'] ?? 'N/A' }}</p>
            <ion-chip style="margin-top:4px;font-size:0.7rem;height:20px">
              Adjustment: {{ debate['score_adjustment'] ?? 0 }}
            </ion-chip>
          </ion-col>
        </ion-row>
      </ion-grid>
    </ion-card-content>
  </ion-card>
</template>
