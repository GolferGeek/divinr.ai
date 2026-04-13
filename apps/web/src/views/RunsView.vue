<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useRunsStore } from '../stores/runs.store';
import { useCanWrite } from '../composables/useCanWrite';
import { useInstrumentsStore } from '../stores/instruments.store';
import {
  IonButton, IonItem, IonSelect, IonSelectOption,
  IonModal, IonHeader, IonToolbar, IonTitle, IonContent, IonButtons,
  IonRadioGroup, IonRadio, IonNote, IonIcon,
} from '@ionic/vue';
import {
  addOutline, playOutline, pulseOutline, shieldCheckmarkOutline,
  trendingUpOutline, checkmarkCircle, alertCircle, timeOutline, syncOutline,
} from 'ionicons/icons';

const router = useRouter();
const { canWrite } = useCanWrite();
const runs = useRunsStore();
const instruments = useInstrumentsStore();

const dialog = ref(false);
const selectedInstrument = ref('');
const selectedType = ref<'prediction' | 'risk'>('prediction');
const statusFilter = ref('');

onMounted(async () => {
  await Promise.all([runs.fetch(), instruments.fetch()]);
});

const symbolById = computed(() => {
  const map: Record<string, string> = {};
  for (const i of instruments.items) {
    const id = i['id'] as string | undefined;
    if (id) map[id] = (i['symbol'] as string) ?? id;
  }
  return map;
});

function symbolFor(run: Record<string, unknown>): string {
  return symbolById.value[String(run['instrument_id'])] ?? '—';
}

function typeLabel(t: unknown): string {
  return t === 'risk' ? 'Risk Analysis' : 'Prediction';
}

function typeIcon(t: unknown) {
  return t === 'risk' ? shieldCheckmarkOutline : trendingUpOutline;
}

function statusLabel(s: unknown): string {
  return ({
    queued: 'Waiting',
    running: 'In Progress',
    completed: 'Done',
    failed: 'Failed',
  } as Record<string, string>)[String(s)] ?? String(s);
}

function statusIcon(s: unknown) {
  return ({
    queued: timeOutline,
    running: syncOutline,
    completed: checkmarkCircle,
    failed: alertCircle,
  } as Record<string, unknown>)[String(s)] ?? timeOutline;
}

function statusAccent(s: unknown): string {
  return ({
    queued: '#94a3b8',
    running: '#6366f1',
    completed: '#10b981',
    failed: '#ef4444',
  } as Record<string, string>)[String(s)] ?? '#94a3b8';
}

function relTime(iso: unknown): string {
  if (!iso) return '';
  const then = new Date(String(iso)).getTime();
  const diff = Date.now() - then;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const counts = computed(() => {
  const c = { all: runs.items.length, queued: 0, running: 0, completed: 0, failed: 0 };
  for (const r of runs.items) {
    const s = String(r['status']) as keyof typeof c;
    if (s in c) (c as Record<string, number>)[s]++;
  }
  return c;
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
  <div class="runs-view">
    <!-- Header -->
    <header class="page-header">
      <div class="page-header__title">
        <div class="page-header__icon">
          <ion-icon :icon="pulseOutline" />
        </div>
        <div>
          <h1>Pipeline Activity</h1>
          <p>
            Every analysis the platform has run for an instrument. Predictions generate
            buy/sell/hold signals; risk analyses score how dangerous a setup is.
          </p>
        </div>
      </div>
      <div v-if="canWrite" class="page-header__actions">
        <ion-button color="medium" fill="outline" @click="handleProcessNext">
          <ion-icon slot="start" :icon="playOutline" />
          Run Next
        </ion-button>
        <ion-button color="primary" @click="dialog = true">
          <ion-icon slot="start" :icon="addOutline" />
          Queue Analysis
        </ion-button>
      </div>
    </header>

    <!-- Stat tiles -->
    <div class="stat-row">
      <button
        class="stat-tile"
        :class="{ 'stat-tile--active': statusFilter === '' }"
        @click="statusFilter = ''; filterRuns()"
      >
        <span class="stat-tile__num">{{ counts.all }}</span>
        <span class="stat-tile__label">Total</span>
      </button>
      <button
        class="stat-tile stat-tile--queued"
        :class="{ 'stat-tile--active': statusFilter === 'queued' }"
        @click="statusFilter = 'queued'; filterRuns()"
      >
        <span class="stat-tile__num">{{ counts.queued }}</span>
        <span class="stat-tile__label">Waiting</span>
      </button>
      <button
        class="stat-tile stat-tile--running"
        :class="{ 'stat-tile--active': statusFilter === 'running' }"
        @click="statusFilter = 'running'; filterRuns()"
      >
        <span class="stat-tile__num">{{ counts.running }}</span>
        <span class="stat-tile__label">In Progress</span>
      </button>
      <button
        class="stat-tile stat-tile--completed"
        :class="{ 'stat-tile--active': statusFilter === 'completed' }"
        @click="statusFilter = 'completed'; filterRuns()"
      >
        <span class="stat-tile__num">{{ counts.completed }}</span>
        <span class="stat-tile__label">Done</span>
      </button>
      <button
        class="stat-tile stat-tile--failed"
        :class="{ 'stat-tile--active': statusFilter === 'failed' }"
        @click="statusFilter = 'failed'; filterRuns()"
      >
        <span class="stat-tile__num">{{ counts.failed }}</span>
        <span class="stat-tile__label">Failed</span>
      </button>
    </div>

    <ion-note v-if="runs.items.length === 0" color="medium" style="display:block;padding:32px;text-align:center">
      No pipeline activity yet. Click <strong>Queue Analysis</strong> above to start one.
    </ion-note>

    <!-- Run table -->
    <div class="run-table-wrap">
      <table class="run-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Type</th>
            <th>Status</th>
            <th>Started</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="run in runs.items"
            :key="String(run['id'])"
            class="run-row"
            @click="router.push(`/runs/${run['id']}`)"
          >
            <td class="run-row__symbol">{{ symbolFor(run) }}</td>
            <td>
              <span class="run-row__type">
                <ion-icon :icon="typeIcon(run['run_type'])" />
                {{ typeLabel(run['run_type']) }}
              </span>
            </td>
            <td>
              <span class="run-row__status" :style="{ '--accent': statusAccent(run['status']) }">
                <ion-icon :icon="statusIcon(run['status'])" />
                {{ statusLabel(run['status']) }}
              </span>
            </td>
            <td class="run-row__time">{{ relTime(run['created_at']) }}</td>
            <td class="run-row__error">
              <span v-if="run['status'] === 'failed' && run['last_error']">
                {{ String(run['last_error']).slice(0, 100) }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Queue Modal -->
    <ion-modal :is-open="dialog" @did-dismiss="dialog = false">
      <ion-header>
        <ion-toolbar>
          <ion-title>Queue New Analysis</ion-title>
          <ion-buttons slot="end">
            <ion-button @click="dialog = false">Cancel</ion-button>
          </ion-buttons>
        </ion-toolbar>
      </ion-header>
      <ion-content class="ion-padding">
        <p style="opacity:0.7;margin-top:0">
          Pick an instrument and what kind of analysis to run. It will be added to the
          queue and processed by the next available worker.
        </p>
        <ion-item>
          <ion-select
            v-model="selectedInstrument"
            label="Instrument"
            label-placement="stacked"
            interface="popover"
          >
            <ion-select-option
              v-for="i in instruments.items"
              :key="String(i['id'])"
              :value="String(i['id'])"
            >
              {{ String(i['symbol']) }}
            </ion-select-option>
          </ion-select>
        </ion-item>
        <ion-radio-group v-model="selectedType">
          <ion-item>
            <ion-radio value="prediction">Prediction (buy/sell/hold signal)</ion-radio>
          </ion-item>
          <ion-item>
            <ion-radio value="risk">Risk Analysis (how dangerous this setup is)</ion-radio>
          </ion-item>
        </ion-radio-group>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
          <ion-button fill="clear" @click="dialog = false">Cancel</ion-button>
          <ion-button color="primary" @click="handleEnqueue" :disabled="!selectedInstrument">
            Add to Queue
          </ion-button>
        </div>
      </ion-content>
    </ion-modal>
  </div>
</template>

<style scoped>
.runs-view {
  padding: 4px 0;
}

/* Header */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}
.page-header__title {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  flex: 1;
  min-width: 280px;
}
.page-header__icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 1.5rem;
  flex-shrink: 0;
}
.page-header h1 {
  margin: 0 0 4px;
  font-size: 1.75rem;
  font-weight: 700;
}
.page-header p {
  margin: 0;
  opacity: 0.65;
  font-size: 0.9rem;
  max-width: 600px;
  line-height: 1.45;
}
.page-header__actions {
  display: flex;
  gap: 8px;
}

/* Stat tiles */
.stat-row {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}
.stat-tile {
  background: var(--ion-card-background, #fff);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 12px;
  padding: 16px;
  text-align: left;
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font: inherit;
  color: inherit;
}
.stat-tile:hover {
  transform: translateY(-1px);
  border-color: rgba(148, 163, 184, 0.4);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
}
.stat-tile--active {
  border-color: #6366f1;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.06), rgba(139, 92, 246, 0.04));
}
.stat-tile__num {
  font-size: 1.75rem;
  font-weight: 700;
  line-height: 1;
}
.stat-tile__label {
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.6;
  font-weight: 600;
}
.stat-tile--queued .stat-tile__num { color: #64748b; }
.stat-tile--running .stat-tile__num { color: #6366f1; }
.stat-tile--completed .stat-tile__num { color: #10b981; }
.stat-tile--failed .stat-tile__num { color: #ef4444; }

/* Run table */
.run-table-wrap {
  overflow-x: auto;
}
.run-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}
.run-table th {
  text-align: left;
  padding: 10px 12px;
  font-size: 0.78rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.6;
  border-bottom: 2px solid rgba(148, 163, 184, 0.2);
  white-space: nowrap;
}
.run-table td {
  padding: 10px 12px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
  vertical-align: middle;
}
.run-row {
  cursor: pointer;
  transition: background 0.1s ease;
}
.run-row:hover {
  background: rgba(99, 102, 241, 0.04);
}
.run-row__symbol {
  font-weight: 700;
  font-size: 1rem;
}
.run-row__type {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  opacity: 0.75;
}
.run-row__type ion-icon {
  font-size: 1rem;
}
.run-row__status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  white-space: nowrap;
}
.run-row__status ion-icon {
  font-size: 0.85rem;
}
.run-row__time {
  font-size: 0.8rem;
  opacity: 0.5;
  white-space: nowrap;
}
.run-row__error {
  font-size: 0.75rem;
  color: #b91c1c;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 720px) {
  .stat-row {
    grid-template-columns: repeat(3, 1fr);
  }
  .page-header__actions {
    width: 100%;
  }
}

@media (max-width: 414px) {
  .stat-row {
    grid-template-columns: repeat(2, 1fr);
  }
  .stat-tile {
    padding: 12px;
  }
  .stat-tile__num {
    font-size: 1.3rem;
  }
  .page-header h1 {
    font-size: 1.3rem;
  }
  .page-header p {
    font-size: 0.8rem;
  }
  .page-header__actions {
    flex-wrap: wrap;
  }
}
</style>
