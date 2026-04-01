<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useApi } from '../composables/useApi';
import {
  IonSegment, IonSegmentButton, IonLabel, IonList, IonItem,
  IonChip, IonCard, IonCardHeader, IonCardTitle, IonCardContent,
} from '@ionic/vue';

const api = useApi();
const reports = ref<Record<string, unknown>[]>([]);
const evaluations = ref<Record<string, unknown>[]>([]);
const tab = ref('evaluations');

onMounted(async () => {
  try {
    reports.value = await api.get<Record<string, unknown>[]>('/learning/reports?limit=20');
  } catch { /* ok */ }
});

// Load horizon evaluations from a run's predictions
async function loadEvaluationsForRun(runId: string) {
  // This would need a dedicated endpoint — for now show reports
}

function formatSummary(summary: unknown): string {
  if (!summary) return 'No data';
  const s = summary as Record<string, unknown>;
  const parts: string[] = [];
  if (s['evaluated']) parts.push(`Evaluated: ${s['evaluated']}`);
  if (s['correct']) parts.push(`Correct: ${s['correct']}`);
  if (s['incorrect']) parts.push(`Incorrect: ${s['incorrect']}`);
  if (s['canonicalCandidates']) parts.push(`Canonical candidates: ${s['canonicalCandidates']}`);
  if (s['profilesUpdated']) parts.push(`Profiles updated: ${s['profilesUpdated']}`);
  return parts.join(' | ') || JSON.stringify(summary).slice(0, 200);
}
</script>

<template>
  <div>
    <h1 style="margin-bottom:16px">Evaluations &amp; Performance</h1>

    <ion-segment :value="tab" @ion-change="tab = String($event.detail.value)" style="margin-bottom:16px">
      <ion-segment-button value="evaluations"><ion-label>Evaluation Reports</ion-label></ion-segment-button>
      <ion-segment-button value="horizons"><ion-label>Multi-Horizon View</ion-label></ion-segment-button>
    </ion-segment>

    <!-- Evaluation Reports -->
    <div v-if="tab === 'evaluations'">
      <ion-list>
        <ion-item v-for="r in reports" :key="String(r['id'])">
          <ion-label>
            <h3>
              <ion-chip :color="r['report_type'] === 'nightly_evaluation' ? 'primary' : 'secondary'" style="font-size:0.7rem;height:20px">
                {{ r['report_type'] }}
              </ion-chip>
              {{ r['report_date'] }}
            </h3>
            <p>{{ formatSummary(r['summary']) }}</p>
          </ion-label>
        </ion-item>
        <ion-item v-if="reports.length === 0">
          <ion-label style="text-align:center;opacity:0.5;padding:16px">
            No evaluation reports yet. Run the nightly evaluation to generate reports.
          </ion-label>
        </ion-item>
      </ion-list>
    </div>

    <!-- Multi-Horizon View -->
    <div v-if="tab === 'horizons'">
      <ion-card>
        <ion-card-header><ion-card-title>Multi-Horizon Evaluation</ion-card-title></ion-card-header>
        <ion-card-content>
          <p style="margin-bottom:16px">
            Each prediction is evaluated at 1-day, 3-day, and 5-day horizons.
            A prediction that's wrong at 1 day but right at 3 days means the thesis was correct but the timing was early.
          </p>
          <ion-list>
            <ion-item>
              <ion-label>
                <h3>
                  <ion-chip color="success" style="font-size:0.7rem;height:20px">1d</ion-chip>
                  <ion-chip color="success" style="font-size:0.7rem;height:20px">3d</ion-chip>
                  <ion-chip color="success" style="font-size:0.7rem;height:20px">5d</ion-chip>
                </h3>
                <p>Strong call -- Reinforce approach</p>
              </ion-label>
            </ion-item>
            <ion-item>
              <ion-label>
                <h3>
                  <ion-chip color="danger" style="font-size:0.7rem;height:20px">1d</ion-chip>
                  <ion-chip color="success" style="font-size:0.7rem;height:20px">3d</ion-chip>
                  <ion-chip color="success" style="font-size:0.7rem;height:20px">5d</ion-chip>
                </h3>
                <p>Thesis correct, timing early -- Adjust horizon / reduce short-term confidence</p>
              </ion-label>
            </ion-item>
            <ion-item>
              <ion-label>
                <h3>
                  <ion-chip color="success" style="font-size:0.7rem;height:20px">1d</ion-chip>
                  <ion-chip color="danger" style="font-size:0.7rem;height:20px">3d</ion-chip>
                  <ion-chip color="danger" style="font-size:0.7rem;height:20px">5d</ion-chip>
                </h3>
                <p>Caught short-term move, missed reversal -- Over-indexing on momentum</p>
              </ion-label>
            </ion-item>
            <ion-item>
              <ion-label>
                <h3>
                  <ion-chip color="danger" style="font-size:0.7rem;height:20px">1d</ion-chip>
                  <ion-chip color="danger" style="font-size:0.7rem;height:20px">3d</ion-chip>
                  <ion-chip color="danger" style="font-size:0.7rem;height:20px">5d</ion-chip>
                </h3>
                <p>Real miss -- Canonical day candidate</p>
              </ion-label>
            </ion-item>
          </ion-list>
        </ion-card-content>
      </ion-card>
    </div>
  </div>
</template>
