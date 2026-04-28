<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonCard, IonCardContent, IonCardHeader, IonCardSubtitle, IonCardTitle,
  IonCol, IonGrid, IonRow,
} from '@ionic/vue';
import FirstTouchPanel from '../components/FirstTouchPanel.vue';
import { useInstrumentsStore } from '../stores/instruments.store';

const instruments = useInstrumentsStore();
const router = useRouter();

onMounted(() => instruments.fetch());

const sortedInstruments = computed(() => [...instruments.items].sort((a, b) => {
  const aSymbol = String(a['symbol'] ?? '');
  const bSymbol = String(b['symbol'] ?? '');
  return aSymbol.localeCompare(bSymbol);
}));

function instrumentId(inst: Record<string, unknown>): string {
  return String(inst['id'] ?? inst['instrument_id'] ?? '');
}

function openInstrument(inst: Record<string, unknown>) {
  const id = instrumentId(inst);
  if (!id) return;
  router.push({ name: 'instrument-detail', params: { id } });
}

function currentState(inst: Record<string, unknown>): Record<string, unknown> {
  return (inst['current_state'] as Record<string, unknown> | null) ?? {};
}

function formatPrice(inst: Record<string, unknown>): string {
  const price = Number(currentState(inst)['price'] ?? currentState(inst)['last_price']);
  if (!Number.isFinite(price) || price <= 0) return '-';
  return `$${price.toFixed(2)}`;
}

function formatChange(inst: Record<string, unknown>): string {
  const change = Number(currentState(inst)['changePercent']);
  if (!Number.isFinite(change)) return '-';
  return `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
}
</script>

<template>
  <div>
    <h1 style="margin-bottom:16px">Analyses</h1>

    <ion-grid>
      <ion-row>
        <ion-col
          v-for="inst in sortedInstruments"
          :key="String(inst['id'])"
          size="12"
          size-sm="6"
          size-md="4"
          size-lg="3"
        >
          <ion-card button :disabled="!instrumentId(inst)" @click="openInstrument(inst)">
            <ion-card-header>
              <ion-card-title>{{ inst['symbol'] }}</ion-card-title>
              <ion-card-subtitle>{{ inst['name'] }}</ion-card-subtitle>
            </ion-card-header>
            <ion-card-content>
              <div style="display:flex;justify-content:space-between">
                <span style="font-size:0.75rem;opacity:0.6">Price</span>
                <span>{{ formatPrice(inst) }}</span>
              </div>
              <div style="display:flex;justify-content:space-between">
                <span style="font-size:0.75rem;opacity:0.6">Change</span>
                <span>{{ formatChange(inst) }}</span>
              </div>
              <div style="display:flex;justify-content:space-between">
                <span style="font-size:0.75rem;opacity:0.6">Type</span>
                <span>{{ inst['asset_type'] || 'stock' }}</span>
              </div>
            </ion-card-content>
          </ion-card>
        </ion-col>
      </ion-row>
    </ion-grid>

    <FirstTouchPanel surface-key="predictions" />
  </div>
</template>
