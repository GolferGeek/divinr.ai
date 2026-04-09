<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useApi } from '../composables/useApi';
import {
  IonButton, IonCard, IonCardHeader, IonCardTitle, IonCardSubtitle, IonCardContent,
  IonItem, IonSelect, IonSelectOption, IonChip, IonNote,
} from '@ionic/vue';
import { refreshOutline } from 'ionicons/icons';

const api = useApi();
const proposals = ref<Record<string, unknown>[]>([]);
const reports = ref<Record<string, unknown>[]>([]);
const statusFilter = ref('');

onMounted(() => loadData());

async function loadData() {
  try {
    const path = statusFilter.value ? `/learning/proposals?status=${statusFilter.value}` : '/learning/proposals';
    proposals.value = await api.get<Record<string, unknown>[]>(path);
    reports.value = await api.get<Record<string, unknown>[]>('/learning/reports?limit=5');
  } catch (err) {
    console.error('Failed to load learning data', err);
  }
}

async function approve(id: string) {
  await api.post(`/learning/proposals/${id}/approve`);
  await loadData();
}

async function reject(id: string) {
  await api.post(`/learning/proposals/${id}/reject`, { reason: 'Manually rejected' });
  await loadData();
}

async function triggerEvaluation() {
  await api.post('/admin/run-nightly-evaluation');
  await loadData();
}

async function triggerLearning() {
  await api.post('/admin/run-learning-cycle');
  await loadData();
}

function statusColor(status: unknown): string {
  if (status === 'passed' || status === 'approved') return 'success';
  if (status === 'failed' || status === 'rejected') return 'danger';
  if (status === 'applied') return 'primary';
  return 'medium';
}
</script>

<template>
  <div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h1>Learning Dashboard</h1>
      <div style="display:flex;gap:8px">
        <ion-button color="medium" size="small" @click="triggerEvaluation">
          <ion-icon slot="start" :icon="refreshOutline" />
          Run Evaluation
        </ion-button>
        <ion-button color="primary" size="small" @click="triggerLearning">
          Run Learning Cycle
        </ion-button>
      </div>
    </div>

    <ion-card v-if="reports.length > 0" style="margin-bottom:16px">
      <ion-card-header><ion-card-title>Latest Report</ion-card-title></ion-card-header>
      <ion-card-content>
        <pre style="font-size:0.75rem">{{ JSON.stringify(reports[0]?.['summary'], null, 2) }}</pre>
      </ion-card-content>
    </ion-card>

    <h2 style="margin-bottom:8px">Learning Proposals</h2>
    <ion-item lines="none" style="max-width:200px;margin-bottom:8px">
      <ion-select v-model="statusFilter" label="Status" label-placement="stacked" interface="popover" @ion-change="loadData">
        <ion-select-option value="">All</ion-select-option>
        <ion-select-option value="proposed">Proposed</ion-select-option>
        <ion-select-option value="passed">Passed</ion-select-option>
        <ion-select-option value="failed">Failed</ion-select-option>
        <ion-select-option value="approved">Approved</ion-select-option>
        <ion-select-option value="applied">Applied</ion-select-option>
      </ion-select>
    </ion-item>

    <ion-card v-for="p in proposals" :key="String(p['id'])" style="margin-bottom:8px">
      <ion-card-header>
        <ion-card-title style="display:flex;align-items:center">
          {{ p['proposal_type'] }}
          <span style="flex:1" />
          <ion-chip :color="statusColor(p['status'])" style="font-size:0.7rem;height:24px">{{ p['status'] }}</ion-chip>
        </ion-card-title>
        <ion-card-subtitle>{{ p['analyst_name'] || 'System' }} | Tier {{ p['tier'] }} | Net score: {{ p['net_score'] ?? 'N/A' }}</ion-card-subtitle>
      </ion-card-header>
      <ion-card-content>
        <p>{{ p['description'] }}</p>
        <p style="font-size:0.75rem;opacity:0.5">{{ p['rationale'] }}</p>
      </ion-card-content>
      <div v-if="p['status'] === 'passed' || p['status'] === 'proposed'" style="display:flex;justify-content:flex-end;gap:8px;padding:0 16px 16px">
        <ion-button fill="clear" size="small" color="danger" @click="reject(String(p['id']))">Reject</ion-button>
        <ion-button fill="clear" size="small" color="success" @click="approve(String(p['id']))">Approve</ion-button>
      </div>
    </ion-card>

    <ion-note v-if="proposals.length === 0" color="primary" style="display:block;padding:16px">
      No learning proposals yet. Run a learning cycle to generate proposals.
    </ion-note>
  </div>
</template>
