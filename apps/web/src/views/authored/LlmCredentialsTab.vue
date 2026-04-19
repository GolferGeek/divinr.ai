<script setup lang="ts">
import { ref, onMounted } from 'vue';
import {
  IonSpinner, IonNote, IonButton, IonCard, IonCardHeader, IonCardContent,
  IonItem, IonLabel, IonInput, IonSelect, IonSelectOption, IonList,
} from '@ionic/vue';
import { useCredentialsApi } from '../../api/authored-content';

import FirstTouchPanel from '../../components/FirstTouchPanel.vue';
interface Credential {
  id: string;
  provider: string;
  label: string;
  lastUsedAt: string | null;
}

const api = useCredentialsApi();
const credentials = ref<Credential[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const saving = ref(false);

// Form state
const newProvider = ref('openrouter');
const newLabel = ref('');
const newSecret = ref('');

async function fetchCredentials() {
  loading.value = true;
  error.value = null;
  try {
    credentials.value = (await api.listCredentials()) ?? [];
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
  loading.value = false;
}

async function addCredential() {
  if (!newLabel.value || !newSecret.value) return;
  saving.value = true;
  error.value = null;
  try {
    await api.addCredential({
      provider: newProvider.value,
      label: newLabel.value,
      secret: newSecret.value,
    });
    newLabel.value = '';
    newSecret.value = '';
    await fetchCredentials();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
  saving.value = false;
}

async function revokeCredential(id: string) {
  if (!confirm('Revoke this API key? Analysts using it will fall back to the Divinr platform LLM.')) return;
  error.value = null;
  try {
    await api.revokeCredential(id);
    await fetchCredentials();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

function providerLabel(provider: string): string {
  switch (provider) {
    case 'anthropic': return 'Anthropic';
    case 'openai': return 'OpenAI';
    case 'openrouter': return 'OpenRouter';
    default: return provider;
  }
}

onMounted(fetchCredentials);
</script>

<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px">
      <h2 style="margin: 0">API Keys</h2>
    </div>

    <ion-note color="warning" style="display: block; padding: 12px; margin-bottom: 16px; border-radius: 8px; background: rgba(255, 193, 7, 0.1)">
      Your API keys are encrypted at rest with AES-256-GCM. They are only decrypted in memory when an analyst run needs them. Divinr never logs or exposes your keys.
    </ion-note>

    <ion-spinner v-if="loading" name="crescent" />

    <ion-note v-if="error" color="danger" style="display: block; padding: 12px; margin-bottom: 8px">
      {{ error }}
    </ion-note>

    <!-- Existing credentials -->
    <ion-list v-if="!loading && credentials.length > 0" style="margin-bottom: 24px">
      <ion-item v-for="cred in credentials" :key="cred.id">
        <ion-label>
          <h3>{{ cred.label }}</h3>
          <p>{{ providerLabel(cred.provider) }} <span v-if="cred.lastUsedAt"> &middot; Last used {{ new Date(cred.lastUsedAt).toLocaleDateString() }}</span></p>
        </ion-label>
        <ion-button slot="end" fill="outline" color="danger" size="small" @click="revokeCredential(cred.id)">
          Revoke
        </ion-button>
      </ion-item>
    </ion-list>

    <div v-if="!loading && credentials.length === 0" style="text-align: center; padding: 24px 16px; color: #888; margin-bottom: 16px">
      No API keys stored yet. Add one below to use your own LLM provider.
    </div>

    <!-- Add form -->
    <ion-card style="max-width: 520px">
      <ion-card-header>
        <strong>Add API Key</strong>
      </ion-card-header>
      <ion-card-content>
        <ion-item>
          <ion-select v-model="newProvider" label="Provider" label-placement="stacked" interface="popover">
            <ion-select-option value="anthropic">Anthropic</ion-select-option>
            <ion-select-option value="openai">OpenAI</ion-select-option>
            <ion-select-option value="openrouter">OpenRouter</ion-select-option>
          </ion-select>
        </ion-item>
        <ion-item>
          <ion-input v-model="newLabel" label="Label" label-placement="stacked" placeholder="e.g. My OpenRouter Key" />
        </ion-item>
        <ion-item>
          <ion-input v-model="newSecret" label="API Key" label-placement="stacked" type="password" placeholder="sk-..." />
        </ion-item>
        <ion-button
          expand="block"
          :disabled="saving || !newLabel || !newSecret"
          style="margin-top: 16px"
          @click="addCredential"
        >
          {{ saving ? 'Saving...' : 'Add Key' }}
        </ion-button>
      </ion-card-content>
    </ion-card>
  
  <FirstTouchPanel surface-key="authoring.byo-llm" />
  </div>
</template>
