<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useRoute } from 'vue-router';
import { useRunsStore } from '../stores/runs.store';
import { useApi } from '../composables/useApi';
import AnalystOutcomeCard from '../components/AnalystOutcomeCard.vue';
import ArbitratorSection from '../components/ArbitratorSection.vue';
import RunStatusChip from '../components/RunStatusChip.vue';
import DebateSummary from '../components/DebateSummary.vue';
import {
  IonButton, IonCard, IonCardHeader, IonCardTitle, IonCardContent,
  IonGrid, IonRow, IonCol, IonChip, IonProgressBar,
  IonAccordionGroup, IonAccordion, IonItem, IonLabel,
} from '@ionic/vue';
import { arrowBackOutline, codeSlashOutline } from 'ionicons/icons';

const route = useRoute();
const runs = useRunsStore();
const api = useApi();
const loading = ref(true);
const artifacts = ref<Record<string, unknown>[]>([]);
const showArtifacts = ref(false);

onMounted(async () => {
  const runId = route.params.id as string;
  await runs.getDetail(runId);
  try {
    artifacts.value = await api.get<Record<string, unknown>[]>(`/runs/${runId}/artifacts`);
  } catch { /* artifacts optional */ }
  loading.value = false;
});

const run = computed(() => runs.current);
const analystOutcomes = computed(() =>
  (run.value?.['analystOutcomes'] as Record<string, unknown>[]) ?? [],
);
const arbitratorOutcome = computed(() =>
  run.value?.['arbitratorOutcome'] as Record<string, unknown> | null,
);
const riskDetails = computed(() =>
  run.value?.['riskDetails'] as Record<string, unknown> | null,
);
const debate = computed(() =>
  (riskDetails.value?.['debate'] as Record<string, unknown>) ?? null,
);
const dimensionAssessments = computed(() =>
  (riskDetails.value?.['dimensionAssessments'] as Record<string, unknown>[]) ?? [],
);
const compositeScore = computed(() =>
  riskDetails.value?.['compositeScore'] as Record<string, unknown> | null,
);
</script>

<template>
  <div>
    <ion-button fill="clear" router-link="/runs" style="margin-bottom:8px">
      <ion-icon slot="start" :icon="arrowBackOutline" />
      Back
    </ion-button>

    <ion-progress-bar v-if="loading" type="indeterminate" color="primary" />

    <template v-if="run && !loading">
      <!-- Header -->
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
        <h1>Run Detail</h1>
        <ion-chip :color="run['run_type'] === 'risk' ? 'warning' : 'primary'" style="font-size:0.7rem;height:24px">{{ run['run_type'] }}</ion-chip>
        <RunStatusChip :status="String(run['status'])" />
        <span style="flex:1" />
        <ion-button fill="clear" size="small" @click="showArtifacts = !showArtifacts">
          <ion-icon slot="start" :icon="codeSlashOutline" />
          {{ showArtifacts ? 'Hide' : 'Show' }} Artifacts ({{ artifacts.length }})
        </ion-button>
      </div>

      <!-- Run metadata -->
      <ion-card style="margin-bottom:16px">
        <ion-card-content style="display:flex;gap:24px;flex-wrap:wrap">
          <div><span style="font-size:0.75rem;opacity:0.5">Instrument:</span> {{ String(run['instrument_id']).slice(0, 16) }}</div>
          <div><span style="font-size:0.75rem;opacity:0.5">Requested by:</span> {{ run['requested_by'] }}</div>
          <div><span style="font-size:0.75rem;opacity:0.5">Created:</span> {{ new Date(String(run['created_at'])).toLocaleString() }}</div>
          <div v-if="run['completed_at']"><span style="font-size:0.75rem;opacity:0.5">Completed:</span> {{ new Date(String(run['completed_at'])).toLocaleString() }}</div>
        </ion-card-content>
      </ion-card>

      <!-- Analyst Outcomes -->
      <h2 style="margin-bottom:8px">Analyst Outcomes ({{ analystOutcomes.length }})</h2>
      <ion-grid>
        <ion-row>
          <ion-col v-for="(outcome, i) in analystOutcomes" :key="i" size="12" size-md="4">
            <AnalystOutcomeCard
              :name="String(outcome['analyst_name'] || 'Analyst ' + (i + 1))"
              :direction="String(outcome['predicted_direction'])"
              :confidence="Number(outcome['confidence'])"
              :rationale="String(outcome['rationale'] || '')"
              :weight="Number(outcome['analyst_weight'] || outcome['default_weight'] || 1)"
            />
          </ion-col>
        </ion-row>
      </ion-grid>

      <!-- Arbitrator -->
      <template v-if="arbitratorOutcome">
        <h2 style="margin-top:16px;margin-bottom:8px">Arbitrator Verdict</h2>
        <ArbitratorSection
          :direction="String(arbitratorOutcome['predicted_direction'])"
          :confidence="Number(arbitratorOutcome['confidence'])"
          :rationale="String(arbitratorOutcome['rationale'] || '')"
        />
      </template>

      <!-- Risk Details (for risk runs) -->
      <template v-if="riskDetails">
        <h2 style="margin-top:16px;margin-bottom:8px">Risk Analysis</h2>

        <!-- Composite Score -->
        <ion-card v-if="compositeScore" style="margin-bottom:16px">
          <ion-card-content style="display:flex;align-items:center;gap:16px">
            <div style="text-align:center">
              <div style="font-size:3rem;font-weight:bold">{{ compositeScore['overall_score'] }}</div>
              <div style="font-size:0.75rem;opacity:0.5">/100</div>
            </div>
            <div style="width:1px;height:60px;background:var(--ion-color-medium);opacity:0.3" />
            <div>
              <div style="font-size:0.75rem;opacity:0.5">Confidence: {{ Number(compositeScore['confidence']).toFixed(2) }}</div>
              <div style="font-size:0.75rem;opacity:0.5">Debate adjustment: {{ compositeScore['debate_adjustment'] || 0 }}</div>
              <div v-if="compositeScore['pre_debate_score']" style="font-size:0.75rem;opacity:0.5">
                Pre-debate: {{ compositeScore['pre_debate_score'] }}
              </div>
            </div>
          </ion-card-content>
        </ion-card>

        <!-- Dimension Assessments -->
        <ion-grid v-if="dimensionAssessments.length > 0">
          <ion-row>
            <ion-col v-for="da in dimensionAssessments" :key="String(da['id'])" size="12" size-sm="6" size-md="3">
              <ion-card>
                <ion-card-header>
                  <ion-card-title style="font-size:1rem">{{ da['dimension_name'] || da['dimension_slug'] }}</ion-card-title>
                </ion-card-header>
                <ion-card-content>
                  <div style="font-size:1.5rem;font-weight:bold;text-align:center;margin-bottom:8px">{{ da['score'] }}<span style="font-size:0.75rem">/100</span></div>
                  <ion-progress-bar
                    :value="Number(da['score']) / 100"
                    :color="Number(da['score']) > 66 ? 'danger' : Number(da['score']) > 33 ? 'warning' : 'success'"
                    style="margin-bottom:8px"
                  />
                  <div style="font-size:0.75rem;opacity:0.5">Confidence: {{ Number(da['confidence']).toFixed(2) }}</div>
                  <p style="margin-top:4px">{{ String(da['reasoning']).slice(0, 200) }}</p>
                </ion-card-content>
              </ion-card>
            </ion-col>
          </ion-row>
        </ion-grid>

        <!-- Debate -->
        <div style="margin-top:16px">
          <DebateSummary :debate="debate" />
        </div>
      </template>

      <!-- Artifacts (collapsible) -->
      <div v-if="showArtifacts && artifacts.length > 0" style="margin-top:16px">
        <h2 style="margin-bottom:8px">LLM Artifacts</h2>
        <ion-accordion-group>
          <ion-accordion v-for="art in artifacts" :key="String(art['id'])" :value="String(art['id'])">
            <ion-item slot="header">
              <ion-chip style="font-size:0.7rem;height:20px;margin-right:8px">{{ art['role'] || 'analyst' }}</ion-chip>
              <ion-label>
                {{ art['model_provider'] }}/{{ art['model_name'] }}
                <p style="font-size:0.75rem;opacity:0.5">{{ new Date(String(art['created_at'])).toLocaleTimeString() }}</p>
              </ion-label>
            </ion-item>
            <div slot="content" class="ion-padding">
              <div style="margin-bottom:8px">
                <div style="font-size:0.85rem;opacity:0.5;margin-bottom:4px">Prompt:</div>
                <pre style="font-size:0.75rem;padding:8px;background:var(--ion-color-light);max-height:200px;overflow:auto;white-space:pre-wrap">{{ art['prompt'] }}</pre>
              </div>
              <div>
                <div style="font-size:0.85rem;opacity:0.5;margin-bottom:4px">Output:</div>
                <pre style="font-size:0.75rem;padding:8px;background:var(--ion-color-light);max-height:200px;overflow:auto;white-space:pre-wrap">{{ art['output_text'] }}</pre>
              </div>
            </div>
          </ion-accordion>
        </ion-accordion-group>
      </div>
    </template>
  </div>
</template>
