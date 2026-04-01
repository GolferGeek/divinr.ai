<script setup lang="ts">
import { useDomainStore } from '../../stores/domain.store';
import { IonCard, IonCardHeader, IonCardTitle, IonCardSubtitle, IonCardContent } from '@ionic/vue';

const props = defineProps<{
  instrument: Record<string, unknown>;
}>();

const domain = useDomainStore();

function getState(key: string): unknown {
  const state = props.instrument['current_state'] as Record<string, unknown> | undefined;
  return state?.[key] ?? null;
}

function formatPrice(val: unknown): string {
  if (typeof val !== 'number') return '-';
  return `$${val.toFixed(2)}`;
}

function formatPct(val: unknown): string {
  if (typeof val !== 'number') return '-';
  const sign = val >= 0 ? '+' : '';
  return `${sign}${val.toFixed(1)}%`;
}

function pctColor(val: unknown): string {
  if (typeof val !== 'number') return '';
  return val >= 0 ? 'color:var(--ion-color-success)' : 'color:var(--ion-color-danger)';
}
</script>

<template>
  <ion-card button>
    <ion-card-header>
      <ion-card-title>{{ instrument['symbol'] }}</ion-card-title>
      <ion-card-subtitle>{{ instrument['name'] }}</ion-card-subtitle>
    </ion-card-header>
    <ion-card-content>
      <div style="display:flex;justify-content:space-between">
        <span style="font-size:1.25rem;font-weight:bold">{{ formatPrice(getState('price')) }}</span>
        <span :style="pctColor(getState('change_pct'))" style="font-size:1.1rem;font-weight:bold">{{ formatPct(getState('change_pct')) }}</span>
      </div>
      <div v-for="field in domain.instrumentCardFields.filter(f => f.key !== 'symbol' && f.key !== 'price' && f.key !== 'change_pct')" :key="field.key" style="display:flex;justify-content:space-between;margin-top:4px">
        <span style="font-size:0.75rem;opacity:0.5">{{ field.label }}</span>
        <span>{{ getState(field.key) ?? instrument[field.key] ?? '-' }}</span>
      </div>
    </ion-card-content>
  </ion-card>
</template>
