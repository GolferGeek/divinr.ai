<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useApi } from '../composables/useApi';
import {
  IonButton, IonCard, IonCardHeader, IonCardTitle, IonCardContent,
  IonGrid, IonRow, IonCol, IonChip, IonNote,
  IonAccordionGroup, IonAccordion, IonItem, IonLabel,
} from '@ionic/vue';
import { arrowBackOutline } from 'ionicons/icons';

import FirstTouchPanel from '../components/FirstTouchPanel.vue';
const route = useRoute();
const api = useApi();
const day = ref<Record<string, unknown> | null>(null);
const loading = ref(true);

onMounted(async () => {
  // Would need a GET endpoint for individual canonical day
  // For now, show what we have
  loading.value = false;
});

function formatSnapshot(data: unknown): string {
  if (!data) return 'No data';
  return JSON.stringify(data, null, 2);
}
</script>

<template>
  <div>
    <ion-button fill="clear" router-link="/learning" style="margin-bottom:8px">
      <ion-icon slot="start" :icon="arrowBackOutline" />
      Back
    </ion-button>
    <h1 style="margin-bottom:16px">Canonical Test Day</h1>

    <ion-note color="primary" style="display:block;padding:16px;margin-bottom:16px">
      Canonical test days are frozen snapshots of past failures. They serve as the regression test suite
      for the learning system -- any proposed analyst change must prove it doesn't break these scenarios.
    </ion-note>

    <template v-if="day">
      <ion-grid>
        <ion-row>
          <ion-col size="12" size-md="6">
            <ion-card>
              <ion-card-header><ion-card-title>Failure Classification</ion-card-title></ion-card-header>
              <ion-card-content>{{ day['failure_classification'] }}</ion-card-content>
            </ion-card>
          </ion-col>
          <ion-col size="12" size-md="3">
            <ion-card>
              <ion-card-header><ion-card-title>Date</ion-card-title></ion-card-header>
              <ion-card-content style="font-size:1.25rem">{{ day['canonical_date'] }}</ion-card-content>
            </ion-card>
          </ion-col>
          <ion-col size="12" size-md="3">
            <ion-card>
              <ion-card-header><ion-card-title>Scope</ion-card-title></ion-card-header>
              <ion-card-content>
                <ion-chip>{{ day['test_scope'] }}</ion-chip>
                <ion-chip :color="day['is_active'] ? 'success' : 'medium'" style="margin-left:4px">
                  {{ day['is_active'] ? 'Active' : 'Retired' }}
                </ion-chip>
              </ion-card-content>
            </ion-card>
          </ion-col>
        </ion-row>
      </ion-grid>

      <ion-accordion-group style="margin-top:16px">
        <ion-accordion value="original">
          <ion-item slot="header"><ion-label>Original Prediction</ion-label></ion-item>
          <div slot="content" class="ion-padding">
            <pre style="font-size:0.75rem;max-height:300px;overflow:auto">{{ formatSnapshot(day['original_prediction']) }}</pre>
          </div>
        </ion-accordion>
        <ion-accordion value="actual">
          <ion-item slot="header"><ion-label>Actual Outcome</ion-label></ion-item>
          <div slot="content" class="ion-padding">
            <pre style="font-size:0.75rem;max-height:300px;overflow:auto">{{ formatSnapshot(day['actual_outcome']) }}</pre>
          </div>
        </ion-accordion>
        <ion-accordion value="risk">
          <ion-item slot="header"><ion-label>Risk Analysis Snapshot</ion-label></ion-item>
          <div slot="content" class="ion-padding">
            <pre style="font-size:0.75rem;max-height:300px;overflow:auto">{{ formatSnapshot(day['risk_analysis_snapshot']) }}</pre>
          </div>
        </ion-accordion>
        <ion-accordion value="articles">
          <ion-item slot="header"><ion-label>Articles Snapshot</ion-label></ion-item>
          <div slot="content" class="ion-padding">
            <pre style="font-size:0.75rem;max-height:300px;overflow:auto">{{ formatSnapshot(day['articles_snapshot']) }}</pre>
          </div>
        </ion-accordion>
        <ion-accordion value="analyst">
          <ion-item slot="header"><ion-label>Analyst Config Snapshot</ion-label></ion-item>
          <div slot="content" class="ion-padding">
            <pre style="font-size:0.75rem;max-height:300px;overflow:auto">{{ formatSnapshot(day['analyst_config_snapshot']) }}</pre>
          </div>
        </ion-accordion>
      
  </ion-accordion-group>
    </template>

    <ion-note v-else color="primary" style="display:block;padding:16px">
      Select a canonical test day from the Learning Dashboard to view its frozen snapshot.
    </ion-note>
  <FirstTouchPanel surface-key="admin.canonical-day" />
  </div>
</template>
