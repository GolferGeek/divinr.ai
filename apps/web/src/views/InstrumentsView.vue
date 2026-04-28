<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useInstrumentsStore } from '../stores/instruments.store';
import { useDomainStore } from '../stores/domain.store';
import { useAuthStore } from '../stores/auth.store';
import {
  IonGrid, IonRow, IonCol, IonCard, IonCardHeader, IonCardTitle, IonCardSubtitle,
  IonCardContent, IonButton, IonChip, IonModal, IonItem, IonInput, IonLabel,
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons,
} from '@ionic/vue';
import { addOutline } from 'ionicons/icons';
import FirstTouchPanel from '../components/FirstTouchPanel.vue';

const store = useInstrumentsStore();
const domain = useDomainStore();
const auth = useAuthStore();
const router = useRouter();
const dialog = ref(false);
const newSymbol = ref('');
const newName = ref('');

onMounted(() => store.fetch());

async function handleCreate() {
  if (!newSymbol.value) return;
  await store.create(newSymbol.value, newName.value || undefined);
  dialog.value = false;
  newSymbol.value = '';
  newName.value = '';
}

function getFieldValue(inst: Record<string, unknown>, key: string): unknown {
  const state = (inst['current_state'] as Record<string, unknown>) ?? {};
  if (key === 'price') return state['price'] ?? '-';
  if (key === 'change_pct') return state['changePercent'] ?? '-';
  if (key === 'prediction_direction') return state['prediction_direction'] || '-';
  if (key === 'confidence') return state['prediction_confidence'] || '-';
  return inst[key] ?? '-';
}

function formatField(value: unknown, type: string): string {
  if (value === null || value === undefined || value === '-') return '-';
  if (type === 'number') return `$${Number(value).toFixed(2)}`;
  if (type === 'percentage') return `${Number(value).toFixed(1)}%`;
  return String(value);
}
</script>

<template>
  <div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <h1 style="margin:0">Research</h1>
      <ion-button v-if="auth.canAuthorContent" color="primary" @click="dialog = true">
        <ion-icon slot="start" :icon="addOutline" />
        Add Instrument
      </ion-button>
    </div>

    <ion-grid>
      <ion-row>
        <ion-col v-for="inst in store.items" :key="String(inst['id'])" size="12" size-sm="6" size-md="4" size-lg="3">
          <ion-card button @click="router.push(`/instruments/${inst['id']}`)">
            <ion-card-header>
              <ion-card-title>{{ inst['symbol'] }}</ion-card-title>
              <ion-card-subtitle>{{ inst['name'] }}</ion-card-subtitle>
            </ion-card-header>
            <ion-card-content>
              <div v-for="field in domain.instrumentCardFields" :key="field.key" style="display:flex;justify-content:space-between">
                <span style="font-size:0.75rem;opacity:0.6">{{ field.label }}</span>
                <span>
                  <ion-chip v-if="field.type === 'badge'" color="tertiary" style="font-size:0.7rem;height:20px">
                    {{ getFieldValue(inst, field.key) }}
                  </ion-chip>
                  <template v-else>{{ formatField(getFieldValue(inst, field.key), field.type) }}</template>
                </span>
              </div>
            </ion-card-content>
          </ion-card>
        </ion-col>
      </ion-row>
    </ion-grid>

    <ion-modal :is-open="dialog" @did-dismiss="dialog = false">
      <ion-header>
        <ion-toolbar>
          <ion-title>New Instrument</ion-title>
          <ion-buttons slot="end">
            <ion-button @click="dialog = false">Cancel</ion-button>
          </ion-buttons>
        </ion-toolbar>
      </ion-header>
      <ion-content class="ion-padding">
        <ion-item>
          <ion-input v-model="newSymbol" label="Symbol" placeholder="AAPL" label-placement="stacked" />
        </ion-item>
        <ion-item>
          <ion-input v-model="newName" label="Name (optional)" placeholder="Apple Inc." label-placement="stacked" />
        </ion-item>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
          <ion-button fill="clear" @click="dialog = false">Cancel</ion-button>
          <ion-button color="primary" @click="handleCreate" :disabled="!newSymbol">Create</ion-button>
        </div>
      </ion-content>
    </ion-modal>

  <FirstTouchPanel surface-key="instruments" />
  </div>
</template>
