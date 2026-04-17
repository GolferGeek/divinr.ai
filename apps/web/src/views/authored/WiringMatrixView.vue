<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { IonChip, IonSpinner } from '@ionic/vue';
import { useAuthoredContentApi } from '../../api/authored-content';

interface Analyst {
  id: string;
  slug: string;
  display_name: string;
  user_id: string | null;
}

interface Instrument {
  id: string;
  symbol: string;
  name: string;
  user_id: string | null;
}

interface Wiring {
  analystId: string;
  instrumentId: string;
}

const api = useAuthoredContentApi();
const loading = ref(true);
const analysts = ref<Analyst[]>([]);
const instruments = ref<Instrument[]>([]);
const wiringSet = ref<Set<string>>(new Set());

function wiringKey(analystId: string, instrumentId: string): string {
  return `${analystId}::${instrumentId}`;
}

function isWired(analystId: string, instrumentId: string): boolean {
  return wiringSet.value.has(wiringKey(analystId, instrumentId));
}

const sortedAnalysts = computed(() => {
  const yours = analysts.value.filter((a) => a.user_id !== null);
  const base = analysts.value.filter((a) => a.user_id === null);
  return [...yours, ...base];
});

const sortedInstruments = computed(() => {
  const yours = instruments.value.filter((i) => i.user_id !== null);
  const base = instruments.value.filter((i) => i.user_id === null);
  return [...yours, ...base];
});

async function loadData() {
  loading.value = true;
  try {
    const result = await api.listMyWirings();
    analysts.value = result.analysts;
    instruments.value = result.instruments;
    wiringSet.value = new Set(
      result.wirings.map((w: Wiring) => wiringKey(w.analystId, w.instrumentId)),
    );
  } finally {
    loading.value = false;
  }
}

async function toggleWiring(analystId: string, instrumentId: string) {
  const key = wiringKey(analystId, instrumentId);
  const wasWired = wiringSet.value.has(key);

  // Optimistic update
  if (wasWired) {
    wiringSet.value.delete(key);
    // Force reactivity
    wiringSet.value = new Set(wiringSet.value);
  } else {
    wiringSet.value.add(key);
    wiringSet.value = new Set(wiringSet.value);
  }

  try {
    if (wasWired) {
      await api.removeWiring(analystId, instrumentId);
    } else {
      await api.addWiring(analystId, instrumentId);
    }
  } catch {
    // Revert on failure
    if (wasWired) {
      wiringSet.value.add(key);
    } else {
      wiringSet.value.delete(key);
    }
    wiringSet.value = new Set(wiringSet.value);
  }
}

onMounted(loadData);
</script>

<template>
  <div>
    <p style="color: var(--ion-color-medium); margin-bottom: 12px; font-size: 0.85rem">
      Assign which analysts cover which instruments. Check a cell to wire an analyst to an instrument.
    </p>

    <div v-if="loading" style="text-align: center; padding: 32px">
      <ion-spinner name="crescent" />
    </div>

    <div v-else-if="sortedAnalysts.length === 0 || sortedInstruments.length === 0" style="padding: 16px; color: var(--ion-color-medium)">
      No analysts or instruments available. Create some first in the Analysts and Instruments tabs.
    </div>

    <div v-else style="overflow-x: auto">
      <table style="border-collapse: collapse; width: 100%">
        <thead>
          <tr>
            <th style="padding: 4px 8px; text-align: left; font-size: 0.8rem; position: sticky; left: 0; background: var(--ion-background-color, #fff); z-index: 1">
              Analyst / Instrument
            </th>
            <th
              v-for="inst in sortedInstruments"
              :key="inst.id"
              style="writing-mode: vertical-rl; padding: 4px; font-size: 0.75rem; white-space: nowrap"
            >
              {{ inst.symbol }}
              <ion-chip v-if="inst.user_id" color="primary" style="font-size: 0.55rem; height: 14px; margin: 2px 0 0 0; --padding-start: 4px; --padding-end: 4px">yours</ion-chip>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="analyst in sortedAnalysts" :key="analyst.id" style="border-top: 1px solid var(--ion-color-light, #eee)">
            <td style="padding: 4px 8px; font-size: 0.8rem; white-space: nowrap; position: sticky; left: 0; background: var(--ion-background-color, #fff); z-index: 1">
              {{ analyst.display_name }}
              <ion-chip v-if="analyst.user_id" color="primary" style="font-size: 0.55rem; height: 14px; margin-left: 4px; --padding-start: 4px; --padding-end: 4px">yours</ion-chip>
            </td>
            <td
              v-for="inst in sortedInstruments"
              :key="inst.id"
              style="text-align: center; padding: 4px"
            >
              <input
                type="checkbox"
                :checked="isWired(analyst.id, inst.id)"
                @change="toggleWiring(analyst.id, inst.id)"
                style="cursor: pointer"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
