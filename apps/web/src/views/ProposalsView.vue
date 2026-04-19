<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useProposalsStore, type Proposal } from '../stores/proposals.store';
import { useCanWrite } from '../composables/useCanWrite';
import {
  IonCard, IonCardHeader, IonCardTitle, IonCardContent,
  IonChip, IonButton, IonNote, IonProgressBar, IonTextarea,
  IonSegment, IonSegmentButton, IonLabel,
} from '@ionic/vue';

import FirstTouchPanel from '../components/FirstTouchPanel.vue';
const store = useProposalsStore();
const { canWrite } = useCanWrite();
const activeTab = ref<string>('pending');
const expandedRationale = ref<Set<string>>(new Set());
const expandedDiff = ref<Set<string>>(new Set());
const rejectingId = ref<string | null>(null);
const rejectNoteMap = ref<Record<string, string>>({});
const actionInProgress = ref<string | null>(null);

const statusMap: Record<string, string> = {
  pending: 'proposed,passed',
  approved: 'approved,applied',
  rejected: 'rejected',
};

onMounted(() => loadProposals());

async function loadProposals() {
  const statuses = statusMap[activeTab.value] ?? 'proposed,passed';
  await store.fetchProposals(statuses);
}

function onTabChange(val: string | number | undefined) {
  if (typeof val === 'string') {
    activeTab.value = val;
    loadProposals();
  }
}

function toggleRationale(id: string) {
  if (expandedRationale.value.has(id)) expandedRationale.value.delete(id);
  else expandedRationale.value.add(id);
}

function toggleDiff(id: string) {
  if (expandedDiff.value.has(id)) expandedDiff.value.delete(id);
  else expandedDiff.value.add(id);
}

async function approve(id: string) {
  actionInProgress.value = id;
  try {
    await store.approveProposal(id);
  } finally {
    actionInProgress.value = null;
  }
}

function startReject(id: string) {
  rejectingId.value = id;
}

async function submitReject(id: string) {
  actionInProgress.value = id;
  try {
    await store.rejectProposal(id, rejectNoteMap.value[id] || undefined);
    rejectingId.value = null;
  } finally {
    actionInProgress.value = null;
  }
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtPct(val: number): string {
  return val.toFixed(1) + '%';
}

const diffLines = computed(() => {
  const result: Record<string, Array<{ type: 'same' | 'added' | 'removed'; text: string }>> = {};
  for (const p of store.proposals) {
    if (!p.current_context_markdown || !p.proposed_context_markdown) continue;
    const oldLines = p.current_context_markdown.split('\n');
    const newLines = p.proposed_context_markdown.split('\n');
    const lines: Array<{ type: 'same' | 'added' | 'removed'; text: string }> = [];
    const maxLen = Math.max(oldLines.length, newLines.length);
    // Simple line-by-line diff
    for (let i = 0; i < maxLen; i++) {
      const oldLine = oldLines[i];
      const newLine = newLines[i];
      if (oldLine === newLine) {
        lines.push({ type: 'same', text: oldLine ?? '' });
      } else {
        if (oldLine !== undefined) lines.push({ type: 'removed', text: oldLine });
        if (newLine !== undefined) lines.push({ type: 'added', text: newLine });
      }
    }
    result[p.id] = lines;
  }
  return result;
});
</script>

<template>
  <div>
    <h1 style="margin-bottom:8px">Strategic Proposals</h1>
    <p style="opacity:0.5;font-size:0.85rem;margin-bottom:16px">
      Tier 3 contract rewrite proposals based on accumulated audit evidence
    </p>

    <ion-segment :value="activeTab" @ion-change="onTabChange($event.detail.value)" style="margin-bottom:16px">
      <ion-segment-button value="pending"><ion-label>Pending</ion-label></ion-segment-button>
      <ion-segment-button value="approved"><ion-label>Approved</ion-label></ion-segment-button>
      <ion-segment-button value="rejected"><ion-label>Rejected</ion-label></ion-segment-button>
    </ion-segment>

    <ion-progress-bar v-if="store.loading" type="indeterminate" />

    <ion-note v-if="store.error" color="danger" style="display:block;padding:12px;margin-bottom:8px">
      {{ store.error }}
    </ion-note>

    <ion-note v-if="!store.loading && store.proposals.length === 0 && !store.error" color="primary" style="display:block;padding:16px">
      No {{ activeTab }} proposals. The Tier 3 overhaul cycle runs weekly.
    </ion-note>

    <ion-card v-for="p in store.proposals" :key="p.id" style="margin-bottom:16px">
      <ion-card-header>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <ion-card-title style="font-size:1rem">{{ p.analyst_name || p.analyst_id }}</ion-card-title>
          <ion-chip
            :color="p.canonical_test_results?.passed ? 'success' : 'danger'"
            style="height:22px;font-size:0.7rem"
          >
            {{ p.canonical_test_results?.passed ? 'PASS' : 'FAIL' }}
            (net {{ p.net_score ?? 0 }})
          </ion-chip>
          <ion-chip color="medium" style="height:22px;font-size:0.7rem">{{ p.status }}</ion-chip>
          <span style="opacity:0.5;margin-left:auto;font-size:0.75rem">{{ fmtDate(p.proposed_at) }}</span>
        </div>
      </ion-card-header>

      <ion-card-content>
        <!-- Evidence Summary -->
        <div v-if="p.evidence_summary" style="margin-bottom:12px">
          <div style="font-size:0.8rem;font-weight:600;margin-bottom:6px">Evidence</div>
          <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:0.85rem">
            <span>{{ p.evidence_summary.acceptedFindingsCount }} accepted findings</span>
            <span>{{ fmtPct(p.evidence_summary.calibrationDelta) }} calibration degradation</span>
            <span>{{ fmtPct(p.evidence_summary.overrideFrequency * 100) }} override rate</span>
          </div>
          <div v-if="p.evidence_summary.topPatterns.length > 0" style="margin-top:6px;font-size:0.82rem">
            <span style="opacity:0.6">Top patterns: </span>
            <span v-for="(pat, i) in p.evidence_summary.topPatterns" :key="i">
              {{ pat.pattern }} ({{ pat.count }}){{ i < p.evidence_summary.topPatterns.length - 1 ? ', ' : '' }}
            </span>
          </div>
        </div>

        <!-- Canonical Test Results -->
        <div v-if="p.canonical_test_results" style="margin-bottom:12px;font-size:0.85rem">
          <div style="font-size:0.8rem;font-weight:600;margin-bottom:4px">Canonical Tests</div>
          <span style="margin-right:12px">Improvements: {{ p.canonical_test_results.improvementCount }}</span>
          <span style="margin-right:12px">Regressions: {{ p.canonical_test_results.regressionCount }}</span>
          <span v-if="p.canonical_test_results.severityRegressionCount > 0" style="color:#f87171">
            Severity regressions: {{ p.canonical_test_results.severityRegressionCount }}
          </span>
        </div>

        <!-- Rationale (collapsible) -->
        <div style="margin-bottom:12px">
          <div
            style="font-size:0.8rem;font-weight:600;margin-bottom:4px;cursor:pointer;user-select:none"
            @click="toggleRationale(p.id)"
          >
            Rationale {{ expandedRationale.has(p.id) ? '[-]' : '[+]' }}
          </div>
          <div v-if="expandedRationale.has(p.id)" style="font-size:0.82rem;line-height:1.6;white-space:pre-wrap;padding:8px 12px;background:rgba(255,255,255,0.03);border-radius:6px">
            {{ p.rationale }}
          </div>
        </div>

        <!-- Contract Diff (collapsible) -->
        <div v-if="p.current_context_markdown && p.proposed_context_markdown" style="margin-bottom:12px">
          <div
            style="font-size:0.8rem;font-weight:600;margin-bottom:4px;cursor:pointer;user-select:none"
            @click="toggleDiff(p.id)"
          >
            Contract Diff {{ expandedDiff.has(p.id) ? '[-]' : '[+]' }}
          </div>
          <div v-if="expandedDiff.has(p.id) && diffLines[p.id]" style="font-size:0.8rem;line-height:1.5;font-family:monospace;overflow-x:auto;max-height:400px;overflow-y:auto;padding:8px;background:rgba(0,0,0,0.2);border-radius:6px">
            <div
              v-for="(line, idx) in diffLines[p.id]"
              :key="idx"
              :style="{
                background: line.type === 'added' ? 'rgba(74,222,128,0.15)' : line.type === 'removed' ? 'rgba(248,113,113,0.15)' : 'transparent',
                color: line.type === 'added' ? '#4ade80' : line.type === 'removed' ? '#f87171' : 'inherit',
                padding: '0 4px',
              }"
            >
              <span style="opacity:0.4;margin-right:8px">{{ line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ' }}</span>{{ line.text }}
            </div>
          </div>
        </div>

        <!-- Reject note textarea -->
        <div v-if="rejectingId === p.id" style="margin-bottom:10px">
          <ion-textarea
            v-model="rejectNoteMap[p.id]"
            placeholder="Reason for rejection (optional)"
            :rows="2"
            style="font-size:0.85rem;border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:4px 8px"
          />
        </div>

        <!-- Action buttons -->
        <div v-if="canWrite && activeTab === 'pending'" style="display:flex;gap:8px;flex-wrap:wrap">
          <ion-button
            color="success" size="small" fill="outline"
            :disabled="actionInProgress === p.id"
            @click="approve(p.id)"
          >Approve</ion-button>
          <ion-button
            v-if="rejectingId !== p.id"
            color="danger" size="small" fill="outline"
            :disabled="actionInProgress === p.id"
            @click="startReject(p.id)"
          >Reject</ion-button>
          <ion-button
            v-if="rejectingId === p.id"
            color="danger" size="small" fill="solid"
            :disabled="actionInProgress === p.id"
            @click="submitReject(p.id)"
          >Submit Rejection</ion-button>
          <ion-button
            v-if="rejectingId === p.id"
            color="medium" size="small" fill="clear"
            @click="rejectingId = null"
          >Cancel</ion-button>
        </div>
      </ion-card-content>
    </ion-card>
  
  <FirstTouchPanel surface-key="admin.proposals" />
  </div>
</template>
