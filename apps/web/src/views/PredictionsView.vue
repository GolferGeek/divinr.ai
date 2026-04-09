<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useApi } from '../composables/useApi';
import {
  IonItem, IonSelect, IonSelectOption, IonList, IonLabel, IonChip,
} from '@ionic/vue';

const api = useApi();
const predictions = ref<Record<string, unknown>[]>([]);
const roleFilter = ref('all');

onMounted(() => loadPredictions());

async function loadPredictions() {
  try {
    predictions.value = await api.get<Record<string, unknown>[]>(`/predictions?role=${roleFilter.value}`);
  } catch (err) {
    console.error('Failed to load predictions', err);
  }
}
</script>

<template>
  <div>
    <h1 style="margin-bottom:16px">Predictions</h1>
    <ion-item lines="none" style="max-width:200px;margin-bottom:16px">
      <ion-select v-model="roleFilter" label="Role" label-placement="stacked" interface="popover" @ion-change="loadPredictions">
        <ion-select-option value="all">All</ion-select-option>
        <ion-select-option value="analyst">Analysts Only</ion-select-option>
        <ion-select-option value="arbitrator">Arbitrator Only</ion-select-option>
      </ion-select>
    </ion-item>

    <ion-list>
      <ion-item v-for="p in predictions" :key="String(p['id'])">
        <ion-label>
          <h3>
            <ion-chip :color="p['predicted_direction'] === 'up' ? 'success' : p['predicted_direction'] === 'down' ? 'danger' : 'medium'" style="font-size:0.7rem;height:20px">
              {{ p['predicted_direction'] }}
            </ion-chip>
            <ion-chip style="font-size:0.7rem;height:20px">{{ p['role'] || 'analyst' }}</ion-chip>
          </h3>
          <p>Confidence: {{ p['confidence'] }}% | {{ p['analyst_name'] || '-' }}</p>
          <p style="font-size:0.75rem">{{ new Date(String(p['created_at'])).toLocaleString() }}</p>
        </ion-label>
      </ion-item>
    </ion-list>
  </div>
</template>
