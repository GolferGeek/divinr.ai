<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useApi } from '../composables/useApi';
import {
  IonButton, IonCard, IonCardHeader, IonCardTitle, IonCardContent,
  IonGrid, IonRow, IonCol, IonChip, IonProgressBar, IonNote,
} from '@ionic/vue';
import { arrowBackOutline } from 'ionicons/icons';

const route = useRoute();
const api = useApi();
const analyst = ref<Record<string, unknown> | null>(null);
const loading = ref(true);

// Performance data would come from analyst_performance_profiles table
// For now, we show what data is available from the analyst record

onMounted(async () => {
  const id = route.params.id as string;
  try {
    const analysts = await api.get<Record<string, unknown>[]>('/analysts');
    analyst.value = analysts.find(a => a['id'] === id) ?? null;
  } catch { /* ok */ }
  loading.value = false;
});
</script>

<template>
  <div>
    <ion-button fill="clear" router-link="/analysts" style="margin-bottom:8px">
      <ion-icon slot="start" :icon="arrowBackOutline" />
      Back
    </ion-button>

    <ion-progress-bar v-if="loading" type="indeterminate" />

    <template v-if="analyst && !loading">
      <h1 style="margin-bottom:4px">{{ analyst['display_name'] }} -- Performance</h1>
      <p style="opacity:0.5;margin-bottom:16px;font-size:0.85rem">{{ analyst['analyst_type'] }} | Weight: {{ analyst['default_weight'] }} | {{ analyst['workflow_scope'] }}</p>

      <ion-grid>
        <ion-row>
          <!-- Persona -->
          <ion-col size="12" size-md="6">
            <ion-card>
              <ion-card-header><ion-card-title>Persona</ion-card-title></ion-card-header>
              <ion-card-content>
                <p>{{ analyst['persona_prompt'] }}</p>
              </ion-card-content>
            </ion-card>
          </ion-col>

          <!-- Status -->
          <ion-col size="12" size-md="3">
            <ion-card>
              <ion-card-header><ion-card-title>Status</ion-card-title></ion-card-header>
              <ion-card-content style="text-align:center">
                <ion-chip :color="analyst['is_enabled'] ? 'success' : 'danger'" style="font-size:1rem">
                  {{ analyst['is_enabled'] ? 'ENABLED' : 'DISABLED' }}
                </ion-chip>
                <div style="font-size:0.75rem;margin-top:8px;opacity:0.6">
                  {{ analyst['is_system_default'] ? 'System Default' : 'Custom' }}
                </div>
                <div style="font-size:0.75rem;opacity:0.6">
                  Learning: {{ analyst['learning_enabled'] ? 'On' : 'Off' }}
                </div>
              </ion-card-content>
            </ion-card>
          </ion-col>

          <!-- Tier Instructions -->
          <ion-col size="12" size-md="3">
            <ion-card>
              <ion-card-header><ion-card-title>Tier Instructions</ion-card-title></ion-card-header>
              <ion-card-content>
                <template v-if="analyst['tier_instructions'] && Object.keys(analyst['tier_instructions'] as object).length > 0">
                  <div v-for="(instruction, tier) in (analyst['tier_instructions'] as Record<string, string>)" :key="tier" style="margin-bottom:8px">
                    <ion-chip style="font-size:0.7rem;height:20px;margin-bottom:4px">{{ tier }}</ion-chip>
                    <p style="font-size:0.75rem;opacity:0.6">{{ String(instruction).slice(0, 100) }}...</p>
                  </div>
                </template>
                <p v-else style="font-size:0.75rem;opacity:0.5">No tier instructions configured.</p>
              </ion-card-content>
            </ion-card>
          </ion-col>
        </ion-row>
      </ion-grid>

      <!-- Performance Metrics Placeholder -->
      <h2 style="margin-top:16px;margin-bottom:8px">Performance Metrics</h2>
      <ion-note color="primary" style="display:block;padding:16px">
        Performance metrics (accuracy by horizon, confidence calibration, systematic biases) will populate
        once the nightly evaluation has run and produced analyst_performance_profiles data.
      </ion-note>

      <!-- Placeholder for accuracy chart -->
      <ion-grid style="margin-top:8px">
        <ion-row>
          <ion-col size="12" size-md="4">
            <ion-card>
              <ion-card-header><ion-card-title>1-Day Accuracy</ion-card-title></ion-card-header>
              <ion-card-content style="text-align:center;font-size:2.5rem;opacity:0.4">&mdash;</ion-card-content>
            </ion-card>
          </ion-col>
          <ion-col size="12" size-md="4">
            <ion-card>
              <ion-card-header><ion-card-title>3-Day Accuracy</ion-card-title></ion-card-header>
              <ion-card-content style="text-align:center;font-size:2.5rem;opacity:0.4">&mdash;</ion-card-content>
            </ion-card>
          </ion-col>
          <ion-col size="12" size-md="4">
            <ion-card>
              <ion-card-header><ion-card-title>5-Day Accuracy</ion-card-title></ion-card-header>
              <ion-card-content style="text-align:center;font-size:2.5rem;opacity:0.4">&mdash;</ion-card-content>
            </ion-card>
          </ion-col>
        </ion-row>
      </ion-grid>
    </template>
  </div>
</template>
