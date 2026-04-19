<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonButton, IonInput, IonTextarea, IonSpinner } from '@ionic/vue';
import { useUsageStore } from '../stores/usage.store';

import FirstTouchPanel from '../components/FirstTouchPanel.vue';
const route = useRoute();
const router = useRouter();
const store = useUsageStore();

const detailId = computed(() => (route.params.id as string | undefined) ?? null);

const showForm = ref(false);
const formName = ref('');
const formStage = ref('article_processing');
const formSystemPrompt = ref('');
const formUserPrompt = ref('');
const formSelectedModels = ref<Array<{ provider: string; model: string }>>([]);
const submitting = ref(false);
const submitError = ref<string | null>(null);

const stages = [
  'article_processing', 'predictor_generation', 'risk_assessment', 'risk_debate',
  'prediction_generation', 'learning', 'audit', 'context_provider', 'experiment',
];

let pollHandle: ReturnType<typeof setInterval> | null = null;

onMounted(async () => {
  await store.fetchExperiments();
  await store.fetchCalibration(); // populate the model multi-select
  if (detailId.value) await loadDetail(detailId.value);
});

watch(detailId, async (id) => { if (id) await loadDetail(id); });

onUnmounted(() => stopPolling());

function stopPolling() {
  if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
}

async function loadDetail(id: string) {
  await store.fetchExperimentDetail(id);
  const status = store.experimentDetail?.experiment.status;
  if (status === 'pending' || status === 'running') {
    stopPolling();
    pollHandle = setInterval(async () => {
      await store.fetchExperimentDetail(id);
      const s = store.experimentDetail?.experiment.status;
      if (s !== 'pending' && s !== 'running') stopPolling();
    }, 3000);
  }
}

function toggleModel(model: string, provider: string) {
  const idx = formSelectedModels.value.findIndex((m) => m.provider === provider && m.model === model);
  if (idx >= 0) formSelectedModels.value.splice(idx, 1);
  else formSelectedModels.value.push({ provider, model });
}

function isSelected(model: string, provider: string): boolean {
  return formSelectedModels.value.some((m) => m.provider === provider && m.model === model);
}

async function submit() {
  submitError.value = null;
  if (formSelectedModels.value.length < 2) { submitError.value = 'Select at least 2 models'; return; }
  if (!formName.value.trim()) { submitError.value = 'Name required'; return; }
  if (!formSystemPrompt.value.trim() || !formUserPrompt.value.trim()) { submitError.value = 'Both prompts required'; return; }
  submitting.value = true;
  try {
    const result = await store.createExperiment({
      name: formName.value.trim(),
      stage: formStage.value,
      inputPayload: { systemPrompt: formSystemPrompt.value, userPrompt: formUserPrompt.value },
      models: formSelectedModels.value,
    });
    showForm.value = false;
    formName.value = '';
    formSystemPrompt.value = '';
    formUserPrompt.value = '';
    formSelectedModels.value = [];
    await store.fetchExperiments();
    router.push(`/admin/cost/experiments/${result.experimentId}`);
  } catch (err) {
    submitError.value = err instanceof Error ? err.message : 'Failed to create experiment';
  } finally {
    submitting.value = false;
  }
}

function formatCost(cents: number | null): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(4)}`;
}
</script>

<template>
  <div style="padding: 16px; max-width: 1200px; margin: 0 auto;">
    <!-- Detail view -->
    <div v-if="detailId">
      <IonButton fill="clear" @click="router.push('/admin/cost/experiments')">← Back to list</IonButton>
      <h2 v-if="store.experimentDetail">{{ store.experimentDetail.experiment.name }}</h2>
      <p v-if="store.experimentDetail" style="color: var(--ion-color-medium);">
        Status: {{ store.experimentDetail.experiment.status }} · Stage: {{ store.experimentDetail.experiment.stage }}
      </p>

      <table v-if="store.experimentDetail" style="width: 100%; border-collapse: collapse; margin-top: 16px;">
        <thead>
          <tr style="text-align: left; border-bottom: 2px solid var(--ion-color-medium);">
            <th style="padding: 8px;">Model</th>
            <th style="padding: 8px;">Provider</th>
            <th style="padding: 8px; text-align: right;">Cost</th>
            <th style="padding: 8px; text-align: right;">Latency</th>
            <th style="padding: 8px; text-align: right;">Tokens</th>
            <th style="padding: 8px;">Status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="run in store.experimentDetail.runs" :key="run.id" style="border-bottom: 1px solid var(--ion-color-light);">
            <td style="padding: 8px;">{{ run.model }}</td>
            <td style="padding: 8px;">{{ run.provider }}</td>
            <td style="padding: 8px; text-align: right;">{{ formatCost(run.cost_cents) }}</td>
            <td style="padding: 8px; text-align: right;">{{ run.latency_ms }}ms</td>
            <td style="padding: 8px; text-align: right;">{{ run.tokens_in + run.tokens_out }}</td>
            <td style="padding: 8px;">
              <span v-if="run.error" style="color: var(--ion-color-danger);">Error</span>
              <span v-else-if="run.completed_at" style="color: var(--ion-color-success);">Done</span>
              <IonSpinner v-else name="dots" style="width: 16px; height: 16px;" />
            </td>
          </tr>
        </tbody>
      </table>

      <div v-if="store.experimentDetail" style="margin-top: 24px;">
        <h3>Output (human review)</h3>
        <p style="color: var(--ion-color-medium); font-size: 13px;">
          Side-by-side outputs are kept for reviewer comparison only. This is not analysis advice.
        </p>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px;">
          <div v-for="run in store.experimentDetail.runs" :key="`o-${run.id}`" style="border: 1px solid var(--ion-color-light); padding: 12px; border-radius: 4px;">
            <div style="font-weight: bold; margin-bottom: 8px;">{{ run.provider }} / {{ run.model }}</div>
            <pre v-if="run.output_text" style="white-space: pre-wrap; font-size: 12px; max-height: 320px; overflow: auto; background: var(--ion-color-step-50); padding: 8px;">{{ run.output_text }}</pre>
            <div v-else-if="run.error" style="color: var(--ion-color-danger); font-size: 12px;">Error: {{ run.error }}</div>
            <div v-else style="color: var(--ion-color-medium); font-size: 12px;">Awaiting output…</div>
          </div>
        </div>
      </div>
    </div>

    <!-- List view -->
    <div v-else>
      <h2>Cost Experiments</h2>
      <p style="color: var(--ion-color-medium); font-size: 14px;">
        Run the same prompt through multiple models to compare cost and output. Models execute serially (Ollama serial constraint).
      </p>

      <IonButton @click="showForm = !showForm" style="margin-bottom: 16px;">
        {{ showForm ? 'Cancel' : 'New Experiment' }}
      </IonButton>

      <div v-if="showForm" style="border: 1px solid var(--ion-color-light); padding: 16px; border-radius: 4px; margin-bottom: 16px;">
        <div style="margin-bottom: 12px;">
          <label>Name</label>
          <IonInput v-model="formName" placeholder="e.g. Stage 3b model comparison" />
        </div>
        <div style="margin-bottom: 12px;">
          <label>Stage</label>
          <select v-model="formStage" style="display: block; padding: 6px; min-width: 240px;">
            <option v-for="s in stages" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
        <div style="margin-bottom: 12px;">
          <label>System prompt</label>
          <IonTextarea v-model="formSystemPrompt" :rows="3" />
        </div>
        <div style="margin-bottom: 12px;">
          <label>User prompt</label>
          <IonTextarea v-model="formUserPrompt" :rows="6" />
        </div>
        <div style="margin-bottom: 12px;">
          <label>Models (select ≥2)</label>
          <div v-if="store.calibration.length === 0" style="color: var(--ion-color-medium); font-size: 13px;">
            No calibrated models found. Run a calibration refresh first to populate the model list.
          </div>
          <div v-else style="display: flex; flex-wrap: wrap; gap: 8px;">
            <button
              v-for="row in store.calibration"
              :key="`${row.provider}:${row.model}`"
              type="button"
              :style="`padding: 6px 12px; border: 1px solid ${isSelected(row.model, row.provider) ? 'var(--ion-color-primary)' : 'var(--ion-color-light)'}; background: ${isSelected(row.model, row.provider) ? 'var(--ion-color-primary-tint)' : 'transparent'}; cursor: pointer; border-radius: 4px;`"
              @click="toggleModel(row.model, row.provider)"
            >
              {{ row.provider }} / {{ row.model }}
            </button>
          </div>
        </div>
        <div v-if="submitError" style="color: var(--ion-color-danger); margin-bottom: 8px;">{{ submitError }}</div>
        <IonButton :disabled="submitting" @click="submit">
          {{ submitting ? 'Creating…' : 'Create experiment' }}
        </IonButton>
      </div>

      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="text-align: left; border-bottom: 2px solid var(--ion-color-medium);">
            <th style="padding: 8px;">Name</th>
            <th style="padding: 8px;">Stage</th>
            <th style="padding: 8px;">Status</th>
            <th style="padding: 8px; text-align: right;">Runs</th>
            <th style="padding: 8px;">Created</th>
            <th style="padding: 8px;"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="exp in store.experiments" :key="exp.id" style="border-bottom: 1px solid var(--ion-color-light);">
            <td style="padding: 8px;">{{ exp.name }}</td>
            <td style="padding: 8px;">{{ exp.stage }}</td>
            <td style="padding: 8px;">{{ exp.status }}</td>
            <td style="padding: 8px; text-align: right;">{{ exp.runs_count }}</td>
            <td style="padding: 8px; font-size: 12px; color: var(--ion-color-medium);">{{ exp.created_at }}</td>
            <td style="padding: 8px;">
              <IonButton size="small" fill="outline" @click="router.push(`/admin/cost/experiments/${exp.id}`)">View</IonButton>
            </td>
          </tr>
          <tr v-if="store.experiments.length === 0">
            <td colspan="6" style="padding: 16px; text-align: center; color: var(--ion-color-medium);">No experiments yet.</td>
          </tr>
        </tbody>
      </table>
    </div>
  
  <FirstTouchPanel surface-key="admin.cost-modeling.experiments" />
  </div>
</template>
