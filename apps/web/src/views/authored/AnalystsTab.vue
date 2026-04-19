<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonButton, IonCard, IonCardHeader, IonCardContent,
  IonSpinner, IonNote, IonChip, IonLabel,
} from '@ionic/vue';
import { useAuthoredContentApi } from '../../api/authored-content';
import CreateAnalystWizard from './CreateAnalystWizard.vue';

import FirstTouchPanel from '../../components/FirstTouchPanel.vue';
const api = useAuthoredContentApi();
const router = useRouter();
const analysts = ref<any[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const showCreateModal = ref(false);

async function fetchAnalysts() {
  loading.value = true;
  error.value = null;
  try {
    analysts.value = await api.listMyAnalysts();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
  loading.value = false;
}

async function deleteAnalyst(id: string, name: string) {
  if (!confirm(`Delete analyst "${name}"? This cannot be undone.`)) return;
  try {
    await api.deleteAnalyst(id);
    analysts.value = analysts.value.filter(a => a.id !== id);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

function editContract(id: string) {
  router.push(`/analysts/${id}/contract`);
}

function onCreated() {
  showCreateModal.value = false;
  fetchAnalysts();
}

onMounted(fetchAnalysts);

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
</script>

<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px">
      <h2 style="margin: 0">Your Analysts</h2>
      <ion-button size="small" @click="showCreateModal = true">Create Analyst</ion-button>
    </div>

    <ion-spinner v-if="loading" name="crescent" />

    <ion-note v-if="error" color="danger" style="display: block; padding: 12px; margin-bottom: 8px">
      {{ error }}
    </ion-note>

    <div v-if="!loading && analysts.length === 0 && !error" style="text-align: center; padding: 40px 16px; color: #888">
      No authored analysts yet — create your first one.
    </div>

    <ion-card v-for="analyst in analysts" :key="analyst.id" style="margin-bottom: 12px">
      <ion-card-header style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-bottom: 0">
        <strong style="font-size: 1rem">{{ analyst.display_name || analyst.displayName }}</strong>
        <ion-chip color="medium" style="font-size: 0.7rem; height: 20px">
          <ion-label>{{ analyst.slug }}</ion-label>
        </ion-chip>
        <span style="flex: 1" />
        <span style="font-size: 0.75rem; opacity: 0.6">{{ fmtDate(analyst.created_at || analyst.createdAt) }}</span>
      </ion-card-header>
      <ion-card-content style="display: flex; gap: 8px; padding-top: 12px">
        <ion-button size="small" fill="outline" @click="editContract(analyst.id)">Edit Contract</ion-button>
        <ion-button size="small" fill="outline" color="danger" @click="deleteAnalyst(analyst.id, analyst.display_name || analyst.displayName)">Delete</ion-button>
      </ion-card-content>
    </ion-card>

    <CreateAnalystWizard
      :is-open="showCreateModal"
      @close="showCreateModal = false"
      @created="onCreated"
    />
  
  <FirstTouchPanel surface-key="authoring.custom-analyst.create" />
  </div>
</template>
