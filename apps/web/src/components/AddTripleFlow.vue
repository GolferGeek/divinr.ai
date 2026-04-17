<script setup lang="ts">
import { ref, computed } from 'vue';
import { useEnablementStore, type AvailableTriple } from '../stores/enablement.store';
import { IonButton, IonChip, IonNote } from '@ionic/vue';

const enablement = useEnablementStore();
const step = ref<'closed' | 'pick-instrument' | 'pick-triples'>('closed');
const search = ref('');
const selectedInstrumentId = ref<string | null>(null);
const toggled = ref<Set<string>>(new Set());

function tripleKey(t: AvailableTriple): string {
  return `${t.analystId}::${t.instrumentId}::${t.authorUserId ?? 'base'}`;
}

async function openFlow() {
  step.value = 'pick-instrument';
  search.value = '';
  await enablement.fetchAvailableTriples();
}

function closeFlow() {
  step.value = 'closed';
  search.value = '';
  selectedInstrumentId.value = null;
  toggled.value = new Set();
}

interface InstrumentOption {
  instrumentId: string;
  instrumentSymbol: string;
  instrumentName: string;
  isAuthoredInstrument: boolean;
  authorUserId: string | null;
  allEnabled: boolean;
}

const instrumentOptions = computed<InstrumentOption[]>(() => {
  const map = new Map<string, InstrumentOption & { total: number; enabledCount: number }>();
  for (const t of enablement.availableTriples) {
    const key = `${t.instrumentId}::${t.authorUserId ?? 'base'}`;
    if (!map.has(key)) {
      map.set(key, {
        instrumentId: t.instrumentId,
        instrumentSymbol: t.instrumentSymbol,
        instrumentName: t.instrumentName,
        isAuthoredInstrument: t.isAuthoredInstrument,
        authorUserId: t.authorUserId,
        allEnabled: false,
        total: 0,
        enabledCount: 0,
      });
    }
    const entry = map.get(key)!;
    entry.total++;
    if (t.isEnabled) entry.enabledCount++;
  }
  const options = Array.from(map.values()).map((o) => ({
    ...o,
    allEnabled: o.total > 0 && o.enabledCount === o.total,
  }));

  const q = search.value.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => o.instrumentSymbol.toLowerCase().includes(q) || o.instrumentName.toLowerCase().includes(q))
    : options;

  const yours = filtered.filter((o) => o.isAuthoredInstrument);
  const base = filtered.filter((o) => !o.isAuthoredInstrument);
  return [...yours, ...base];
});

function hasSymbolCollision(sym: string): boolean {
  return instrumentOptions.value.filter((o) => o.instrumentSymbol === sym).length > 1;
}

function instrumentSubLabel(opt: InstrumentOption): string {
  if (!hasSymbolCollision(opt.instrumentSymbol)) return '';
  if (opt.isAuthoredInstrument) return opt.instrumentName;
  return 'Base contract';
}

function selectInstrument(opt: InstrumentOption) {
  selectedInstrumentId.value = opt.instrumentId;
  step.value = 'pick-triples';
  toggled.value = new Set();
  enablement.fetchAvailableTriples(opt.instrumentId);
}

const triplesForInstrument = computed<AvailableTriple[]>(() => {
  if (!selectedInstrumentId.value) return [];
  return enablement.availableTriples.filter(
    (t) => t.instrumentId === selectedInstrumentId.value,
  );
});

function isToggled(t: AvailableTriple): boolean {
  return t.isEnabled || toggled.value.has(tripleKey(t));
}

function toggle(t: AvailableTriple) {
  if (t.isEnabled) return;
  const key = tripleKey(t);
  if (toggled.value.has(key)) toggled.value.delete(key);
  else toggled.value.add(key);
}

const hasNewSelections = computed(() => toggled.value.size > 0);

async function saveSelections() {
  const toEnable = triplesForInstrument.value.filter(
    (t) => !t.isEnabled && toggled.value.has(tripleKey(t)),
  );
  for (const t of toEnable) {
    await enablement.enableTriple(t.analystId, t.instrumentId, t.authorUserId ?? undefined);
  }
  closeFlow();
  await enablement.fetchEnabledTriples();
}
</script>

<template>
  <div>
    <IonButton
      v-if="step === 'closed'"
      fill="outline"
      color="primary"
      @click="openFlow"
    >+ Add to Portfolio</IonButton>

    <!-- Step 1: Pick Instrument -->
    <div v-if="step === 'pick-instrument'" style="border:1px solid var(--ion-color-step-200);border-radius:8px;padding:16px;margin-top:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <span style="font-weight:600;font-size:0.92rem">Select Instrument</span>
        <IonButton size="small" fill="clear" color="medium" @click="closeFlow">Cancel</IonButton>
      </div>
      <input
        v-model="search"
        type="text"
        placeholder="Search instruments..."
        style="width:100%;padding:8px 12px;border:1px solid var(--ion-color-step-200);border-radius:4px;font-size:0.85rem;margin-bottom:12px;background:var(--ion-background-color);color:inherit"
      />
      <div v-if="instrumentOptions.length === 0" style="opacity:0.6;padding:8px">No instruments found.</div>
      <div
        v-for="opt in instrumentOptions"
        :key="`${opt.instrumentId}::${opt.authorUserId ?? 'base'}`"
        style="padding:8px 12px;cursor:pointer;border-radius:4px;display:flex;align-items:center;gap:8px"
        :style="opt.allEnabled ? 'opacity:0.4' : ''"
        class="instrument-option"
        @click="selectInstrument(opt)"
      >
        <div>
          <span style="font-weight:600;font-size:0.9rem">{{ opt.instrumentSymbol }}</span>
          <span v-if="opt.isAuthoredInstrument" style="font-size:0.72rem;opacity:0.6;margin-left:4px">(yours)</span>
          <span v-if="instrumentSubLabel(opt)" style="display:block;font-size:0.75rem;opacity:0.55">{{ instrumentSubLabel(opt) }}</span>
        </div>
        <IonChip v-if="opt.allEnabled" color="medium" style="font-size:0.65rem;height:18px;margin-left:auto">all enabled</IonChip>
      </div>
    </div>

    <!-- Step 2: Pick Triples for Instrument -->
    <div v-if="step === 'pick-triples'" style="border:1px solid var(--ion-color-step-200);border-radius:8px;padding:16px;margin-top:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <span style="font-weight:600;font-size:0.92rem">Select Analysts</span>
        <IonButton size="small" fill="clear" color="medium" @click="step = 'pick-instrument'">Back</IonButton>
      </div>
      <div v-if="triplesForInstrument.length === 0" style="opacity:0.6;padding:8px">No analysts available for this instrument.</div>
      <div
        v-for="t in triplesForInstrument"
        :key="tripleKey(t)"
        style="padding:8px 12px;cursor:pointer;border-radius:4px;display:flex;align-items:center;gap:8px"
        :style="t.isEnabled ? 'opacity:0.5' : ''"
        @click="toggle(t)"
      >
        <input
          type="checkbox"
          :checked="isToggled(t)"
          :disabled="t.isEnabled"
          style="pointer-events:none"
        />
        <span style="font-size:0.88rem">{{ t.analystName }}</span>
        <span style="font-size:0.72rem;opacity:0.5">{{ t.isAuthoredAnalyst ? '(yours)' : '(base)' }}</span>
        <IonChip v-if="t.isEnabled" color="medium" style="font-size:0.65rem;height:18px;margin-left:auto">enabled</IonChip>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <IonButton
          :disabled="!hasNewSelections"
          color="primary"
          size="small"
          @click="saveSelections"
        >Save</IonButton>
        <IonButton fill="clear" color="medium" size="small" @click="step = 'pick-instrument'">Cancel</IonButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.instrument-option:hover {
  background: var(--ion-color-step-50);
}
</style>
