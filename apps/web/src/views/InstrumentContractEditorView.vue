<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useRoute } from 'vue-router';
import { useApi } from '../composables/useApi';
import { useCanWrite } from '../composables/useCanWrite';
import {
  IonButton, IonChip, IonNote, IonProgressBar, IonInput,
} from '@ionic/vue';

import FirstTouchPanel from '../components/FirstTouchPanel.vue';
interface ContractVersion {
  id: string;
  versionNumber: number;
  source: string;
  changeReason: string | null;
  createdBy: string | null;
  createdAt: string;
  isActive: boolean;
  contextMarkdown: string | null;
}

interface ContractData {
  instrumentId: string;
  symbol: string;
  name: string;
  assetType: string;
  requiredSections: string[] | null;
  activeVersionId: string | null;
  contract: {
    markdown: string;
    sections: { general: string; roles: Record<string, string>; stages: Record<string, string>; adaptations: string };
  } | null;
  versions: ContractVersion[];
}

interface ValidationResult {
  valid: boolean;
  missingSections: string[];
  forbiddenPhrases: string[];
  extraSections: string[];
}

interface ValidationError extends ValidationResult {
  message: string;
}

const route = useRoute();
const api = useApi();
const { canWrite } = useCanWrite();
const data = ref<ContractData | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const historyExpanded = ref(true);
const previewVersionId = ref<string | null>(null);

const editing = ref(false);
const editMarkdown = ref('');
const editChangeReason = ref('');
const saving = ref(false);
const validationError = ref<ValidationError | null>(null);
const liveValidation = ref<ValidationResult | null>(null);
let validateTimer: ReturnType<typeof setTimeout> | null = null;

const diffMode = ref(false);
const diffLeftId = ref<string | null>(null);
const diffRightId = ref<string | null>(null);

const rollingBack = ref(false);

async function fetchContract() {
  const id = route.params.id as string;
  try {
    data.value = await api.get<ContractData>(`/instruments/${id}/contract`);
    error.value = null;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
  loading.value = false;
}

onMounted(fetchContract);

const displayMarkdown = computed(() => {
  if (!data.value) return null;
  if (previewVersionId.value) {
    const v = data.value.versions.find(v => v.id === previewVersionId.value);
    return v?.contextMarkdown ?? null;
  }
  return data.value.contract?.markdown ?? null;
});

const previewedVersion = computed(() => {
  if (!data.value || !previewVersionId.value) return null;
  return data.value.versions.find(v => v.id === previewVersionId.value) ?? null;
});

function parseMarkdownSections(md: string): Array<{ heading: string; body: string }> {
  const parts = md.split(/^## /m);
  const sections: Array<{ heading: string; body: string }> = [];
  for (const part of parts) {
    const newlineIdx = part.indexOf('\n');
    if (newlineIdx === -1) continue;
    const heading = part.slice(0, newlineIdx).trim();
    const body = part.slice(newlineIdx + 1).trim();
    if (heading) sections.push({ heading, body });
  }
  return sections;
}

function sourceColor(source: string): string {
  switch (source) {
    case 'manual': return 'primary';
    case 'tier1_auto': return 'tertiary';
    case 'tier2_approved': return 'success';
    case 'tier3_strategic': return 'warning';
    default: return 'medium';
  }
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function previewVersion(versionId: string) {
  previewVersionId.value = versionId;
}

function backToActive() {
  previewVersionId.value = null;
}

function startEdit() {
  editMarkdown.value = data.value?.contract?.markdown ?? '';
  editChangeReason.value = '';
  editing.value = true;
  previewVersionId.value = null;
  diffMode.value = false;
  liveValidation.value = null;
}

function cancelEdit() {
  editing.value = false;
  validationError.value = null;
  liveValidation.value = null;
}

function scheduleValidate() {
  if (validateTimer) clearTimeout(validateTimer);
  validateTimer = setTimeout(runValidate, 500);
}

async function runValidate() {
  if (!data.value || !editMarkdown.value) {
    liveValidation.value = null;
    return;
  }
  try {
    const id = route.params.id as string;
    liveValidation.value = await api.post<ValidationResult>(
      `/instruments/${id}/contract/validate`,
      { markdown: editMarkdown.value },
    );
  } catch {
    liveValidation.value = null;
  }
}

const saveDisabled = computed(() => {
  if (saving.value) return true;
  if (!liveValidation.value) return false;
  return !liveValidation.value.valid;
});

async function saveEdit() {
  if (!data.value) return;
  saving.value = true;
  validationError.value = null;
  try {
    const id = route.params.id as string;
    data.value = await api.put<ContractData>(`/instruments/${id}/contract`, {
      markdown: editMarkdown.value,
      changeReason: editChangeReason.value || undefined,
    });
    editing.value = false;
    liveValidation.value = null;
    error.value = null;
  } catch (err) {
    const maybeStructured = (err as { body?: unknown; response?: { data?: unknown } } | null);
    const payload = maybeStructured?.body ?? maybeStructured?.response?.data;
    if (payload && typeof payload === 'object' && 'missingSections' in payload) {
      validationError.value = payload as ValidationError;
    } else {
      error.value = err instanceof Error ? err.message : String(err);
    }
  }
  saving.value = false;
}

async function makeActive() {
  if (!data.value || !previewedVersion.value) return;
  const md = previewedVersion.value.contextMarkdown;
  if (!md) return;
  rollingBack.value = true;
  try {
    const id = route.params.id as string;
    data.value = await api.put<ContractData>(`/instruments/${id}/contract`, {
      markdown: md,
      changeReason: `rollback to v${previewedVersion.value.versionNumber}`,
    });
    previewVersionId.value = null;
    error.value = null;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
  rollingBack.value = false;
}

function enterDiffMode() {
  diffMode.value = true;
  editing.value = false;
  previewVersionId.value = null;
  if (data.value && data.value.versions.length >= 2) {
    diffLeftId.value = data.value.versions[1].id;
    diffRightId.value = data.value.versions[0].id;
  }
}

function exitDiffMode() {
  diffMode.value = false;
  diffLeftId.value = null;
  diffRightId.value = null;
}

interface DiffLine { type: 'same' | 'added' | 'removed'; text: string }

const diffLines = computed<{ left: DiffLine[]; right: DiffLine[] }>(() => {
  if (!data.value || !diffLeftId.value || !diffRightId.value) return { left: [], right: [] };
  const leftVersion = data.value.versions.find(v => v.id === diffLeftId.value);
  const rightVersion = data.value.versions.find(v => v.id === diffRightId.value);
  const leftLines = (leftVersion?.contextMarkdown ?? '').split('\n');
  const rightLines = (rightVersion?.contextMarkdown ?? '').split('\n');

  const left: DiffLine[] = [];
  const right: DiffLine[] = [];

  let li = 0;
  let ri = 0;
  while (li < leftLines.length || ri < rightLines.length) {
    if (li < leftLines.length && ri < rightLines.length && leftLines[li] === rightLines[ri]) {
      left.push({ type: 'same', text: leftLines[li] });
      right.push({ type: 'same', text: rightLines[ri] });
      li++;
      ri++;
    } else if (ri < rightLines.length && (li >= leftLines.length || !leftLines.slice(li).includes(rightLines[ri]))) {
      left.push({ type: 'same', text: '' });
      right.push({ type: 'added', text: rightLines[ri] });
      ri++;
    } else if (li < leftLines.length && (ri >= rightLines.length || !rightLines.slice(ri).includes(leftLines[li]))) {
      left.push({ type: 'removed', text: leftLines[li] });
      right.push({ type: 'same', text: '' });
      li++;
    } else {
      left.push({ type: 'removed', text: leftLines[li] });
      right.push({ type: 'added', text: rightLines[ri] });
      li++;
      ri++;
    }
  }
  return { left, right };
});
</script>

<template>
  <div>
    <ion-progress-bar v-if="loading" type="indeterminate" />

    <ion-note v-if="error" color="danger" style="display:block;padding:12px;margin-bottom:8px">
      {{ error }}
    </ion-note>

    <template v-if="data">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap">
        <router-link to="/instruments" style="text-decoration:none;color:var(--ion-color-primary);font-size:0.85rem">&larr; Instruments</router-link>
        <h1 style="margin:0">{{ data.symbol }} — Contract</h1>
        <ion-chip color="tertiary" style="font-size:0.7rem;height:22px">{{ data.assetType }}</ion-chip>
        <span style="font-size:0.85rem;opacity:0.7">{{ data.name }}</span>
        <span style="flex:1" />
        <template v-if="canWrite && !editing && !diffMode">
          <ion-button size="small" fill="outline" color="primary" @click="startEdit">Edit</ion-button>
          <ion-button size="small" fill="outline" color="secondary" @click="enterDiffMode">Diff</ion-button>
          <ion-button
            v-if="previewedVersion && !previewedVersion.isActive"
            size="small" fill="outline" color="warning"
            :disabled="rollingBack"
            @click="makeActive"
          >
            {{ rollingBack ? 'Restoring...' : `Make v${previewedVersion.versionNumber} active` }}
          
  </ion-button>
        </template>
      </div>

      <div v-if="data.requiredSections && data.requiredSections.length > 0 && editing" style="background:var(--ion-color-step-50);padding:8px 12px;border-radius:6px;margin-bottom:12px;font-size:0.8rem">
        <strong>Required sections (instrument):</strong>
        General, {{ data.requiredSections.join(', ') }}, Adaptations.
      </div>

      <div v-if="validationError" style="background:var(--ion-color-danger-tint);color:var(--ion-color-danger-contrast);padding:10px 12px;border-radius:6px;margin-bottom:12px;font-size:0.85rem">
        <strong>Contract validation failed.</strong>
        <div v-if="validationError.missingSections.length > 0" style="margin-top:4px">
          Missing: {{ validationError.missingSections.join(', ') }}
        </div>
        <div v-if="validationError.forbiddenPhrases.length > 0" style="margin-top:4px">
          Forbidden phrases: {{ validationError.forbiddenPhrases.join(', ') }}
        </div>
        <div v-if="validationError.extraSections.length > 0" style="margin-top:4px">
          Unexpected sections: {{ validationError.extraSections.join(', ') }}
        </div>
      </div>

      <div v-if="editing && liveValidation && !liveValidation.valid" style="background:var(--ion-color-warning-tint);color:var(--ion-color-warning-contrast);padding:8px 12px;border-radius:6px;margin-bottom:12px;font-size:0.85rem">
        <strong>Preflight:</strong>
        <span v-if="liveValidation.missingSections.length > 0">Missing: {{ liveValidation.missingSections.join(', ') }}.</span>
        <span v-if="liveValidation.forbiddenPhrases.length > 0">Forbidden: {{ liveValidation.forbiddenPhrases.join(', ') }}.</span>
        <span v-if="liveValidation.extraSections.length > 0">Unexpected: {{ liveValidation.extraSections.join(', ') }}.</span>
      </div>

      <div v-if="previewVersionId && !editing && !diffMode" style="background:var(--ion-color-warning-tint);color:var(--ion-color-warning-contrast);padding:8px 12px;border-radius:6px;margin-bottom:12px;display:flex;align-items:center;gap:8px">
        <span>Viewing version {{ previewedVersion?.versionNumber }}</span>
        <ion-button size="small" fill="solid" color="primary" @click="backToActive">Back to active</ion-button>
      </div>

      <div v-if="editing" style="margin-bottom:16px">
        <textarea
          v-model="editMarkdown"
          style="width:100%;min-height:400px;font-family:monospace;font-size:0.85rem;padding:12px;border:1px solid var(--ion-color-step-200);border-radius:8px;background:var(--ion-background-color);color:var(--ion-text-color);resize:vertical"
          @input="scheduleValidate"
          @blur="runValidate"
        />
        <div style="display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap">
          <ion-input
            v-model="editChangeReason"
            placeholder="Change reason (optional)"
            style="flex:1;min-width:200px;border:1px solid var(--ion-color-step-200);border-radius:4px;padding:4px 8px;font-size:0.85rem"
          />
          <ion-button size="small" color="primary" :disabled="saveDisabled" @click="saveEdit">
            {{ saving ? 'Saving...' : 'Save' }}
          </ion-button>
          <ion-button size="small" fill="outline" color="medium" @click="cancelEdit">Cancel</ion-button>
        </div>
      </div>

      <div v-else-if="diffMode" style="margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">
          <select v-model="diffLeftId" style="padding:4px 8px;border-radius:4px;font-size:0.85rem">
            <option v-for="v in data.versions" :key="v.id" :value="v.id">
              v{{ v.versionNumber }} ({{ v.source }})
            </option>
          </select>
          <span>vs</span>
          <select v-model="diffRightId" style="padding:4px 8px;border-radius:4px;font-size:0.85rem">
            <option v-for="v in data.versions" :key="v.id" :value="v.id">
              v{{ v.versionNumber }} ({{ v.source }})
            </option>
          </select>
          <ion-button size="small" fill="outline" color="medium" @click="exitDiffMode">Exit Diff</ion-button>
        </div>
        <div v-if="diffLeftId && diffRightId" style="display:flex;gap:2px;overflow-x:auto">
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:0.8rem;padding:4px 8px;background:var(--ion-color-step-50)">
              v{{ data.versions.find(v => v.id === diffLeftId)?.versionNumber }}
            </div>
            <div
              v-for="(line, i) in diffLines.left" :key="i"
              :style="{
                padding: '1px 8px',
                fontSize: '0.8rem',
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                background: line.type === 'removed' ? 'rgba(248,113,113,0.15)' : 'transparent',
                minHeight: '1.4em',
              }"
            >{{ line.text }}</div>
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:0.8rem;padding:4px 8px;background:var(--ion-color-step-50)">
              v{{ data.versions.find(v => v.id === diffRightId)?.versionNumber }}
            </div>
            <div
              v-for="(line, i) in diffLines.right" :key="i"
              :style="{
                padding: '1px 8px',
                fontSize: '0.8rem',
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                background: line.type === 'added' ? 'rgba(74,222,128,0.15)' : 'transparent',
                minHeight: '1.4em',
              }"
            >{{ line.text }}</div>
          </div>
        </div>
      </div>

      <template v-else>
        <div v-if="displayMarkdown" style="border:1px solid var(--ion-color-step-150);border-radius:8px;padding:16px;margin-bottom:16px">
          <div v-for="section in parseMarkdownSections(displayMarkdown)" :key="section.heading" style="margin-bottom:16px">
            <h2 style="font-size:1.1rem;margin:0 0 8px 0;border-bottom:1px solid var(--ion-color-step-100);padding-bottom:4px">{{ section.heading }}</h2>
            <pre style="white-space:pre-wrap;font-family:inherit;font-size:0.85rem;line-height:1.6;margin:0">{{ section.body }}</pre>
          </div>
        </div>
        <ion-note v-else color="primary" style="display:block;padding:12px;margin-bottom:16px">
          No contract markdown for this instrument.
        </ion-note>
      </template>

      <div style="margin-bottom:16px">
        <h2
          style="font-size:1rem;cursor:pointer;user-select:none;margin:0 0 8px 0"
          @click="historyExpanded = !historyExpanded"
        >
          Version History ({{ data.versions.length }}) {{ historyExpanded ? '&#9662;' : '&#9656;' }}
        </h2>
        <div v-if="historyExpanded">
          <div
            v-for="v in data.versions" :key="v.id"
            style="display:flex;align-items:center;gap:8px;padding:8px;border-bottom:1px solid var(--ion-color-step-100);cursor:pointer"
            :style="v.isActive ? 'background:var(--ion-color-step-50)' : ''"
            @click="previewVersion(v.id)"
          >
            <span style="font-weight:600;min-width:24px">v{{ v.versionNumber }}</span>
            <ion-chip :color="sourceColor(v.source)" style="font-size:0.65rem;height:20px">{{ v.source }}</ion-chip>
            <span v-if="v.isActive" style="font-size:0.7rem;font-weight:600;color:var(--ion-color-success)">ACTIVE</span>
            <span style="font-size:0.8rem;flex:1">{{ v.changeReason || '—' }}</span>
            <span style="font-size:0.75rem;opacity:0.6">{{ fmtDate(v.createdAt) }}</span>
            <span v-if="v.createdBy" style="font-size:0.75rem;opacity:0.5">{{ v.createdBy }}</span>
          </div>
          <ion-note v-if="data.versions.length === 0" color="primary" style="display:block;padding:8px">
            No config versions found.
          </ion-note>
        </div>
      <FirstTouchPanel surface-key="authoring.custom-instrument.editor" />
  </div>
    </template>
  </div>
</template>
