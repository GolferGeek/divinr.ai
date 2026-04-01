<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useRunsStore } from '../stores/runs.store';
import { useInstrumentsStore } from '../stores/instruments.store';
import {
  IonButton, IonCard, IonCardHeader, IonCardTitle, IonCardContent,
  IonChip, IonList, IonItem, IonLabel, IonSelect, IonSelectOption,
  IonModal, IonHeader, IonToolbar, IonTitle, IonContent, IonButtons,
  IonRadioGroup, IonRadio,
} from '@ionic/vue';
import { addOutline, playOutline } from 'ionicons/icons';

const router = useRouter();
const runs = useRunsStore();
const instruments = useInstrumentsStore();

const dialog = ref(false);
const selectedInstrument = ref('');
const selectedType = ref<'prediction' | 'risk'>('prediction');
const statusFilter = ref('');

onMounted(async () => {
  await Promise.all([runs.fetch(), instruments.fetch()]);
});

async function handleEnqueue() {
  if (!selectedInstrument.value) return;
  await runs.enqueue(selectedInstrument.value, selectedType.value);
  await runs.fetch();
  dialog.value = false;
}

async function handleProcessNext() {
  await runs.processNext();
  await runs.fetch();
}

function filterRuns() {
  runs.fetch(statusFilter.value || undefined);
}
</script>

<template>
  <div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h1>Runs</h1>
      <div style="display:flex;gap:8px">
        <ion-button color="medium" @click="handleProcessNext">
          <ion-icon slot="start" :icon="playOutline" />
          Process Next
        </ion-button>
        <ion-button color="primary" @click="dialog = true">
          <ion-icon slot="start" :icon="addOutline" />
          Enqueue Run
        </ion-button>
      </div>
    </div>

    <ion-item lines="none" style="max-width:200px;margin-bottom:16px">
      <ion-select v-model="statusFilter" label="Filter by status" label-placement="stacked" interface="popover" @ion-change="filterRuns">
        <ion-select-option value="">All</ion-select-option>
        <ion-select-option value="queued">Queued</ion-select-option>
        <ion-select-option value="running">Running</ion-select-option>
        <ion-select-option value="completed">Completed</ion-select-option>
        <ion-select-option value="failed">Failed</ion-select-option>
      </ion-select>
    </ion-item>

    <ion-list>
      <ion-item v-for="run in runs.items" :key="String(run['id'])">
        <ion-label>
          <h3 style="font-size:0.75rem;opacity:0.6">{{ String(run['id']).slice(0, 8) }}...</h3>
          <p>
            <ion-chip :color="run['run_type'] === 'risk' ? 'warning' : 'primary'" style="font-size:0.7rem;height:20px">
              {{ run['run_type'] }}
            </ion-chip>
            <ion-chip
              :color="run['status'] === 'completed' ? 'success' : run['status'] === 'failed' ? 'danger' : run['status'] === 'running' ? 'tertiary' : 'medium'"
              style="font-size:0.7rem;height:20px"
            >{{ run['status'] }}</ion-chip>
          </p>
          <p style="font-size:0.75rem;opacity:0.6">Instrument: {{ String(run['instrument_id']).slice(0, 12) }}...</p>
          <p style="font-size:0.75rem">{{ new Date(String(run['created_at'])).toLocaleString() }}</p>
        </ion-label>
        <ion-button slot="end" fill="clear" size="small" @click="router.push(`/runs/${run['id']}`)">Detail</ion-button>
      </ion-item>
    </ion-list>

    <ion-modal :is-open="dialog" @did-dismiss="dialog = false">
      <ion-header>
        <ion-toolbar>
          <ion-title>Enqueue Run</ion-title>
          <ion-buttons slot="end">
            <ion-button @click="dialog = false">Cancel</ion-button>
          </ion-buttons>
        </ion-toolbar>
      </ion-header>
      <ion-content class="ion-padding">
        <ion-item>
          <ion-select v-model="selectedInstrument" label="Instrument" label-placement="stacked" interface="popover">
            <ion-select-option v-for="i in instruments.items" :key="String(i['id'])" :value="String(i['id'])">
              {{ String(i['symbol']) }}
            </ion-select-option>
          </ion-select>
        </ion-item>
        <ion-radio-group v-model="selectedType">
          <ion-item>
            <ion-radio value="prediction">Prediction</ion-radio>
          </ion-item>
          <ion-item>
            <ion-radio value="risk">Risk</ion-radio>
          </ion-item>
        </ion-radio-group>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
          <ion-button fill="clear" @click="dialog = false">Cancel</ion-button>
          <ion-button color="primary" @click="handleEnqueue" :disabled="!selectedInstrument">Enqueue</ion-button>
        </div>
      </ion-content>
    </ion-modal>
  </div>
</template>
