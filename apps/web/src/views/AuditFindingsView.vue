<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useApi } from '../composables/useApi';
import { useCanWrite } from '../composables/useCanWrite';
import {
  IonCard, IonCardHeader, IonCardTitle, IonCardContent,
  IonChip, IonButton, IonNote, IonProgressBar, IonTextarea,
} from '@ionic/vue';

interface Finding {
  id: string;
  analystId: string;
  analystName: string;
  analystSlug: string;
  predictionId: string;
  symbol: string;
  predictedDirection: string;
  actualDirection: string;
  wasCorrect: boolean;
  confidence: number | null;
  changePercent: number | null;
  predictionDate: string;
  evaluationDate: string;
  contractExcerpt: string;
  outputExcerpt: string;
  discrepancy: string;
  hypothesis: string;
  severity: 'low' | 'medium' | 'high';
  status: string;
  createdAt: string;
}

interface AuditPolicy {
  policyText: string;
  reviewedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  notedCount: number;
  confidenceLevel: string;
  generatedAt: string;
}

const api = useApi();
const { canWrite } = useCanWrite();
const findings = ref<Finding[]>([]);
const policy = ref<AuditPolicy | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const reviewingId = ref<string | null>(null);
const disagreeTextMap = ref<Record<string, string>>({});
const showDisagreeInput = ref<string | null>(null);
const policyExpanded = ref(false);

onMounted(async () => {
  try {
    const [findingsData, policyData] = await Promise.all([
      api.get<{ findings: Finding[] }>('/audit/findings'),
      api.get<{ policy: AuditPolicy | null }>('/audit/policy'),
    ]);
    findings.value = findingsData.findings;
    policy.value = policyData.policy;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
  loading.value = false;
});

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function severityColor(s: string): string {
  if (s === 'high') return 'danger';
  if (s === 'medium') return 'warning';
  return 'primary';
}

async function review(findingId: string, action: string, reviewText?: string) {
  reviewingId.value = findingId;
  try {
    await api.post('/audit/findings/' + findingId + '/review', { action, reviewText });
    findings.value = findings.value.filter(f => f.id !== findingId);
    showDisagreeInput.value = null;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
  reviewingId.value = null;
}

function startDisagree(findingId: string) {
  showDisagreeInput.value = findingId;
}

function submitDisagree(findingId: string) {
  review(findingId, 'rejected', disagreeTextMap.value[findingId] || undefined);
}
</script>

<template>
  <div>
    <h1 style="margin-bottom:8px">Audit Findings</h1>
    <p style="opacity:0.5;font-size:0.85rem;margin-bottom:16px">
      Contract-vs-output discrepancies spotted by the Tier 2 audit loop
    </p>

    <ion-progress-bar v-if="loading" type="indeterminate" />

    <ion-note v-if="error" color="danger" style="display:block;padding:12px;margin-bottom:8px">
      {{ error }}
    </ion-note>

    <!-- Selection Policy (meta-loop) -->
    <ion-card v-if="policy" style="margin-bottom:16px;cursor:pointer" @click="policyExpanded = !policyExpanded">
      <ion-card-header>
        <div style="display:flex;align-items:center;gap:8px">
          <ion-card-title style="font-size:0.95rem">Audit Selection Policy</ion-card-title>
          <ion-chip :color="policy.confidenceLevel === 'confident' ? 'success' : 'warning'" style="height:20px;font-size:0.65rem">
            {{ policy.confidenceLevel }}
          </ion-chip>
          <span style="opacity:0.5;font-size:0.75rem;margin-left:auto">{{ policy.reviewedCount }} reviews ({{ policy.acceptedCount }}✓ {{ policy.rejectedCount }}✗ {{ policy.notedCount }}~)</span>
        </div>
      </ion-card-header>
      <ion-card-content v-if="policyExpanded">
        <p style="font-size:0.85rem;line-height:1.6;white-space:pre-wrap">{{ policy.policyText }}</p>
      </ion-card-content>
    </ion-card>

    <ion-note v-if="!loading && findings.length === 0 && !error" color="primary" style="display:block;padding:16px">
      No pending findings. The audit loop will surface discrepancies as it runs.
    </ion-note>

    <ion-card v-for="f in findings" :key="f.id" style="margin-bottom:16px">
      <ion-card-header>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <ion-card-title style="font-size:1rem">
            <router-link
              :to="{ name: 'analyst-contract', params: { id: f.analystId } }"
              style="text-decoration:underline;color:var(--ion-color-primary)"
              @click.stop
            >{{ f.analystName }}</router-link>
          </ion-card-title>
          <ion-chip :color="severityColor(f.severity)" style="height:22px;font-size:0.7rem">
            {{ f.severity }}
          </ion-chip>
        </div>
      </ion-card-header>
      <ion-card-content>
        <!-- Prediction summary -->
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:0.85rem;margin-bottom:12px">
          <span style="font-weight:600">{{ f.symbol }}</span>
          <span>{{ f.predictedDirection }} → {{ f.actualDirection }}</span>
          <ion-chip :color="f.wasCorrect ? 'success' : 'danger'" style="height:20px;font-size:0.65rem">
            {{ f.wasCorrect ? 'correct' : 'wrong' }}
          </ion-chip>
          <span v-if="f.confidence !== null" style="opacity:0.7">conf {{ f.confidence }}%</span>
          <span v-if="f.changePercent !== null" :style="{ color: f.changePercent >= 0 ? '#4ade80' : '#f87171' }">
            Δ {{ Number(f.changePercent).toFixed(2) }}%
          </span>
          <span style="opacity:0.5;margin-left:auto;font-size:0.75rem">
            {{ fmtDate(f.predictionDate) }} → {{ fmtDate(f.evaluationDate) }}
          </span>
        </div>

        <!-- Contract excerpt -->
        <div style="margin-bottom:10px">
          <div style="font-size:0.8rem;font-weight:600;margin-bottom:4px">Contract says:</div>
          <blockquote style="margin:0;padding:8px 12px;border-left:3px solid var(--ion-color-primary);background:rgba(255,255,255,0.03);font-size:0.82rem;line-height:1.5">
            {{ f.contractExcerpt }}
          </blockquote>
        </div>

        <!-- Output excerpt -->
        <div style="margin-bottom:10px">
          <div style="font-size:0.8rem;font-weight:600;margin-bottom:4px">Analyst said:</div>
          <blockquote style="margin:0;padding:8px 12px;border-left:3px solid var(--ion-color-warning);background:rgba(255,255,255,0.03);font-size:0.82rem;line-height:1.5">
            {{ f.outputExcerpt }}
          </blockquote>
        </div>

        <!-- Discrepancy + Hypothesis -->
        <div style="margin-bottom:12px">
          <div style="font-size:0.85rem;font-weight:700;margin-bottom:4px">{{ f.discrepancy }}</div>
          <div style="font-size:0.82rem;font-style:italic;opacity:0.8">{{ f.hypothesis }}</div>
        </div>

        <!-- Disagree textarea (shown on click) -->
        <div v-if="showDisagreeInput === f.id" style="margin-bottom:10px">
          <ion-textarea
            v-model="disagreeTextMap[f.id]"
            placeholder="Why do you disagree? (optional)"
            :rows="2"
            style="font-size:0.85rem;border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:4px 8px"
          />
        </div>

        <!-- Action buttons -->
        <div v-if="canWrite" style="display:flex;gap:8px;flex-wrap:wrap">
          <ion-button
            color="success" size="small" fill="outline"
            :disabled="reviewingId === f.id"
            @click="review(f.id, 'accepted')"
          >Agree</ion-button>
          <ion-button
            v-if="showDisagreeInput !== f.id"
            color="danger" size="small" fill="outline"
            :disabled="reviewingId === f.id"
            @click="startDisagree(f.id)"
          >Disagree</ion-button>
          <ion-button
            v-else
            color="danger" size="small"
            :disabled="reviewingId === f.id"
            @click="submitDisagree(f.id)"
          >Submit Disagree</ion-button>
          <ion-button
            color="medium" size="small" fill="outline"
            :disabled="reviewingId === f.id"
            @click="review(f.id, 'noted')"
          >Note</ion-button>
        </div>
      </ion-card-content>
    </ion-card>
  </div>
</template>
