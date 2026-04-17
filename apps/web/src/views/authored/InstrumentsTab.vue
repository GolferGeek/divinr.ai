<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonButton, IonCard, IonCardHeader, IonCardContent,
  IonSpinner, IonNote, IonChip, IonLabel,
} from '@ionic/vue';
import { useAuthoredContentApi } from '../../api/authored-content';
import CreateInstrumentWizard from './CreateInstrumentWizard.vue';

const api = useAuthoredContentApi();
const router = useRouter();
const instruments = ref<any[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const showCreateModal = ref(false);

async function fetchInstruments() {
  loading.value = true;
  error.value = null;
  try {
    instruments.value = await api.listMyInstruments();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
  loading.value = false;
}

async function deleteInstrument(id: string, name: string) {
  if (!confirm(`Delete instrument "${name}"? This cannot be undone.`)) return;
  try {
    await api.deleteInstrument(id);
    instruments.value = instruments.value.filter(i => i.id !== id);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

function editContract(id: string) {
  router.push(`/instruments/${id}/contract`);
}

function onCreated() {
  showCreateModal.value = false;
  fetchInstruments();
}

onMounted(fetchInstruments);

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
</script>

<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px">
      <h2 style="margin: 0">Your Instruments</h2>
      <ion-button size="small" @click="showCreateModal = true">Create Instrument</ion-button>
    </div>

    <ion-spinner v-if="loading" name="crescent" />

    <ion-note v-if="error" color="danger" style="display: block; padding: 12px; margin-bottom: 8px">
      {{ error }}
    </ion-note>

    <div v-if="!loading && instruments.length === 0 && !error" style="text-align: center; padding: 40px 16px; color: #888">
      No authored instruments yet — create your first one.
    </div>

    <ion-card v-for="instrument in instruments" :key="instrument.id" style="margin-bottom: 12px">
      <ion-card-header style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-bottom: 0">
        <strong style="font-size: 1rem">{{ instrument.name }}</strong>
        <ion-chip color="medium" style="font-size: 0.7rem; height: 20px">
          <ion-label>{{ instrument.symbol }}</ion-label>
        </ion-chip>
        <ion-chip v-if="instrument.asset_type || instrument.assetType" color="tertiary" style="font-size: 0.7rem; height: 20px">
          <ion-label>{{ instrument.asset_type || instrument.assetType }}</ion-label>
        </ion-chip>
        <span style="flex: 1" />
        <span style="font-size: 0.75rem; opacity: 0.6">{{ fmtDate(instrument.created_at || instrument.createdAt) }}</span>
      </ion-card-header>
      <ion-card-content style="display: flex; gap: 8px; padding-top: 12px">
        <ion-button size="small" fill="outline" @click="editContract(instrument.id)">Edit Contract</ion-button>
        <ion-button size="small" fill="outline" color="danger" @click="deleteInstrument(instrument.id, instrument.name)">Delete</ion-button>
      </ion-card-content>
    </ion-card>

    <CreateInstrumentWizard
      :is-open="showCreateModal"
      @close="showCreateModal = false"
      @created="onCreated"
    />
  </div>
</template>
