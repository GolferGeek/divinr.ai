<script setup lang="ts">
import { onMounted } from 'vue';
import {
  IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonGrid, IonRow, IonCol,
  IonList, IonItem, IonLabel, IonChip, IonNote,
} from '@ionic/vue';
import { useInstrumentsStore } from '../stores/instruments.store';
import { useRunsStore } from '../stores/runs.store';
import { useDomainStore } from '../stores/domain.store';

const instruments = useInstrumentsStore();
const runs = useRunsStore();
const domain = useDomainStore();

onMounted(async () => {
  await Promise.all([instruments.fetch(), runs.fetch()]).catch(() => {});
});
</script>

<template>
  <div>
    <h1>{{ domain.dashboardLayout?.title ?? 'Dashboard' }}</h1>
    <ion-note>{{ domain.activeDomain }} / {{ domain.activeUniverse }}</ion-note>

    <ion-grid v-if="domain.dashboardLayout">
      <ion-row>
        <ion-col v-for="section in domain.dashboardLayout.sections" :key="section.id" size="12" size-md="6" size-lg="3">
          <ion-card>
            <ion-card-header>
              <ion-card-title>{{ section.title }}</ion-card-title>
            </ion-card-header>
            <ion-card-content class="ion-text-center">
              <template v-if="section.id === 'instruments'">
                <div style="font-size:2rem;font-weight:bold">{{ instruments.items.length }}</div>
                <ion-note>Tracked Instruments</ion-note>
              </template>
              <template v-else-if="section.id === 'predictions'">
                <div style="font-size:2rem;font-weight:bold">{{ runs.items.filter(r => r['run_type'] === 'prediction' && r['status'] === 'completed').length }}</div>
                <ion-note>Completed Predictions</ion-note>
              </template>
              <template v-else-if="section.id === 'risk'">
                <div style="font-size:2rem;font-weight:bold">{{ runs.items.filter(r => r['run_type'] === 'risk' && r['status'] === 'completed').length }}</div>
                <ion-note>Risk Assessments</ion-note>
              </template>
              <template v-else>
                <div style="font-size:2rem;font-weight:bold">{{ runs.items.filter(r => r['status'] === 'queued').length }}</div>
                <ion-note>Queued Runs</ion-note>
              </template>
            </ion-card-content>
          </ion-card>
        </ion-col>
      </ion-row>
    </ion-grid>

    <ion-card>
      <ion-card-header>
        <ion-card-title>Recent Runs</ion-card-title>
      </ion-card-header>
      <ion-card-content>
        <ion-list>
          <ion-item v-for="run in runs.items.slice(0, 10)" :key="String(run['id'])">
            <ion-chip slot="start" :color="run['run_type'] === 'risk' ? 'warning' : 'primary'">
              {{ run['run_type'] }}
            </ion-chip>
            <ion-label>
              <ion-chip :color="run['status'] === 'completed' ? 'success' : run['status'] === 'failed' ? 'danger' : 'medium'" outline>
                {{ run['status'] }}
              </ion-chip>
            </ion-label>
            <ion-note slot="end">{{ new Date(String(run['created_at'])).toLocaleString() }}</ion-note>
          </ion-item>
          <ion-item v-if="runs.items.length === 0">
            <ion-label color="medium">No runs yet</ion-label>
          </ion-item>
        </ion-list>
      </ion-card-content>
    </ion-card>
  </div>
</template>
