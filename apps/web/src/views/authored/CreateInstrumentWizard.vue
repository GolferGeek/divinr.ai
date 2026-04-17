<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonModal, IonHeader, IonToolbar, IonTitle, IonButtons,
  IonButton, IonContent, IonInput, IonSelect, IonSelectOption,
  IonNote, IonSpinner,
} from '@ionic/vue';
import { useAuthoredContentApi } from '../../api/authored-content';

const props = defineProps<{ isOpen: boolean }>();
const emit = defineEmits<{ close: []; created: [] }>();

const api = useAuthoredContentApi();
const router = useRouter();

const symbol = ref('');
const name = ref('');
const assetType = ref<string>('stock');
const error = ref<string | null>(null);
const creating = ref(false);
const scaffolding = ref(false);

const assetTypes = [
  { value: 'stock', label: 'Stock' },
  { value: 'etf', label: 'ETF' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'forex', label: 'Forex' },
];

async function submit() {
  if (!symbol.value.trim() || !name.value.trim()) {
    error.value = 'Symbol and name are required.';
    return;
  }

  error.value = null;
  creating.value = true;

  try {
    const instrument = await api.createInstrument({
      symbol: symbol.value.trim().toUpperCase(),
      name: name.value.trim(),
      assetType: assetType.value,
    });

    scaffolding.value = true;

    try {
      await api.scaffoldInstrumentContract(instrument.id);
    } catch {
      // Scaffold failure is non-fatal
    }

    scaffolding.value = false;
    creating.value = false;
    resetForm();
    emit('created');
    router.push(`/instruments/${instrument.id}/contract`);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    creating.value = false;
    scaffolding.value = false;
  }
}

function resetForm() {
  symbol.value = '';
  name.value = '';
  assetType.value = 'stock';
  error.value = null;
}

function close() {
  resetForm();
  emit('close');
}
</script>

<template>
  <ion-modal :is-open="isOpen" @didDismiss="close">
    <ion-header>
      <ion-toolbar>
        <ion-title>Create Instrument</ion-title>
        <ion-buttons slot="end">
          <ion-button @click="close" :disabled="creating">Close</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <ion-note v-if="error" color="danger" style="display: block; padding: 12px; margin-bottom: 12px">
        {{ error }}
        <ion-button v-if="!creating" size="small" fill="clear" @click="submit">Retry</ion-button>
      </ion-note>

      <div v-if="scaffolding" style="text-align: center; padding: 40px 16px">
        <ion-spinner name="crescent" />
        <p style="margin-top: 12px; color: #666">
          Generating instrument contract — this takes 30-60 seconds on local models.
        </p>
      </div>

      <template v-else>
        <div style="margin-bottom: 16px">
          <label style="font-size: 0.85rem; font-weight: 600; display: block; margin-bottom: 4px">Symbol</label>
          <ion-input
            v-model="symbol"
            placeholder="e.g. AAPL"
            :disabled="creating"
            style="border: 1px solid var(--ion-color-step-200); border-radius: 6px; padding: 0 8px"
          />
        </div>

        <div style="margin-bottom: 16px">
          <label style="font-size: 0.85rem; font-weight: 600; display: block; margin-bottom: 4px">Name</label>
          <ion-input
            v-model="name"
            placeholder="e.g. Apple Inc."
            :disabled="creating"
            style="border: 1px solid var(--ion-color-step-200); border-radius: 6px; padding: 0 8px"
          />
        </div>

        <div style="margin-bottom: 16px">
          <label style="font-size: 0.85rem; font-weight: 600; display: block; margin-bottom: 4px">Asset Type</label>
          <ion-select
            v-model="assetType"
            :disabled="creating"
            interface="popover"
            style="border: 1px solid var(--ion-color-step-200); border-radius: 6px; padding: 0 8px"
          >
            <ion-select-option v-for="t in assetTypes" :key="t.value" :value="t.value">
              {{ t.label }}
            </ion-select-option>
          </ion-select>
        </div>

        <ion-button expand="block" :disabled="creating" @click="submit">
          <ion-spinner v-if="creating" name="crescent" style="margin-right: 8px" />
          {{ creating ? 'Creating...' : 'Create Instrument' }}
        </ion-button>

        <p style="font-size: 0.75rem; color: #888; text-align: center; margin-top: 12px">
          Your authored instrument will be tracked on the next pipeline cycle.
        </p>
      </template>
    </ion-content>
  </ion-modal>
</template>
