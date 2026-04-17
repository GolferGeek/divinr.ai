<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonModal, IonHeader, IonToolbar, IonTitle, IonButtons,
  IonButton, IonContent, IonInput, IonTextarea, IonNote, IonSpinner,
} from '@ionic/vue';
import { useAuthoredContentApi } from '../../api/authored-content';

const props = defineProps<{ isOpen: boolean }>();
const emit = defineEmits<{ close: []; created: [] }>();

const api = useAuthoredContentApi();
const router = useRouter();

const slug = ref('');
const displayName = ref('');
const personaPrompt = ref('');
const error = ref<string | null>(null);
const creating = ref(false);
const scaffolding = ref(false);

async function submit() {
  if (!slug.value.trim() || !displayName.value.trim() || !personaPrompt.value.trim()) {
    error.value = 'All fields are required.';
    return;
  }

  error.value = null;
  creating.value = true;

  try {
    const analyst = await api.createAnalyst({
      slug: slug.value.trim(),
      displayName: displayName.value.trim(),
      personaPrompt: personaPrompt.value.trim(),
    });

    scaffolding.value = true;

    try {
      await api.scaffoldAnalystContract(analyst.id);
    } catch {
      // Scaffold failure is non-fatal — user can still edit the contract
    }

    scaffolding.value = false;
    creating.value = false;
    resetForm();
    emit('created');
    router.push(`/analysts/${analyst.id}/contract`);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    creating.value = false;
    scaffolding.value = false;
  }
}

function resetForm() {
  slug.value = '';
  displayName.value = '';
  personaPrompt.value = '';
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
        <ion-title>Create Analyst</ion-title>
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
          Generating your analyst's contract — this takes 30-60 seconds on local models.
        </p>
      </div>

      <template v-else>
        <div style="margin-bottom: 16px">
          <label style="font-size: 0.85rem; font-weight: 600; display: block; margin-bottom: 4px">Slug</label>
          <ion-input
            v-model="slug"
            placeholder="e.g. contrarian-tech"
            :disabled="creating"
            style="border: 1px solid var(--ion-color-step-200); border-radius: 6px; padding: 0 8px"
          />
          <span style="font-size: 0.75rem; color: #888">Unique identifier, lowercase with hyphens</span>
        </div>

        <div style="margin-bottom: 16px">
          <label style="font-size: 0.85rem; font-weight: 600; display: block; margin-bottom: 4px">Display Name</label>
          <ion-input
            v-model="displayName"
            placeholder="e.g. Contrarian Tech Analyst"
            :disabled="creating"
            style="border: 1px solid var(--ion-color-step-200); border-radius: 6px; padding: 0 8px"
          />
        </div>

        <div style="margin-bottom: 16px">
          <label style="font-size: 0.85rem; font-weight: 600; display: block; margin-bottom: 4px">Persona Prompt</label>
          <ion-textarea
            v-model="personaPrompt"
            placeholder="Describe the analyst's personality, expertise, and analysis style..."
            :disabled="creating"
            :rows="6"
            style="border: 1px solid var(--ion-color-step-200); border-radius: 6px; padding: 8px"
          />
        </div>

        <ion-button expand="block" :disabled="creating" @click="submit">
          <ion-spinner v-if="creating" name="crescent" style="margin-right: 8px" />
          {{ creating ? 'Creating...' : 'Create Analyst' }}
        </ion-button>

        <p style="font-size: 0.75rem; color: #888; text-align: center; margin-top: 12px">
          Your authored analyst will process articles on the next pipeline cycle.
        </p>
      </template>
    </ion-content>
  </ion-modal>
</template>
