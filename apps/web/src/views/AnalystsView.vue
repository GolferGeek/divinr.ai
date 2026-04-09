<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useAnalystsStore } from '../stores/analysts.store';
import { useCanWrite } from '../composables/useCanWrite';
import {
  IonGrid, IonRow, IonCol, IonCard, IonCardHeader, IonCardTitle, IonCardSubtitle,
  IonCardContent, IonButton, IonChip, IonModal, IonItem, IonInput, IonTextarea,
  IonToggle, IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonLabel,
} from '@ionic/vue';
import { addOutline } from 'ionicons/icons';

const store = useAnalystsStore();
const { canWrite } = useCanWrite();
const dialog = ref(false);
const form = ref({ slug: '', displayName: '', personaPrompt: '' });

onMounted(() => store.fetch());

async function handleCreate() {
  if (!form.value.slug || !form.value.displayName || !form.value.personaPrompt) return;
  await store.create(form.value.slug, form.value.displayName, form.value.personaPrompt);
  await store.fetch();
  dialog.value = false;
  form.value = { slug: '', displayName: '', personaPrompt: '' };
}
</script>

<template>
  <div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h1>Analysts</h1>
      <ion-button v-if="canWrite" color="primary" @click="dialog = true">
        <ion-icon slot="start" :icon="addOutline" />
        Create Analyst
      </ion-button>
    </div>

    <ion-grid>
      <ion-row>
        <ion-col v-for="a in store.items" :key="String(a['id'])" size="12" size-sm="6" size-md="4">
          <ion-card>
            <ion-card-header>
              <ion-card-title style="display:flex;align-items:center">
                {{ a['display_name'] }}
                <span style="flex:1" />
                <ion-chip v-if="a['is_system_default']" color="secondary" style="font-size:0.7rem;height:20px">Default</ion-chip>
                <ion-chip v-if="!a['is_enabled']" color="danger" style="font-size:0.7rem;height:20px;margin-left:4px">Disabled</ion-chip>
              </ion-card-title>
              <ion-card-subtitle>
                {{ a['analyst_type'] }} | Weight: {{ a['default_weight'] }} | {{ a['workflow_scope'] }}
              </ion-card-subtitle>
            </ion-card-header>
            <ion-card-content>
              <p>{{ String(a['persona_prompt']).slice(0, 200) }}...</p>
            </ion-card-content>
            <div v-if="canWrite" style="padding:0 16px 16px">
              <ion-item lines="none">
                <ion-toggle
                  :checked="Boolean(a['is_enabled'])"
                  :color="a['is_enabled'] ? 'success' : 'danger'"
                  @ion-change="async (e: any) => { await store.update(String(a['id']), { isEnabled: e.detail.checked }); await store.fetch(); }"
                >
                  {{ a['is_enabled'] ? 'Enabled' : 'Disabled' }}
                </ion-toggle>
              </ion-item>
            </div>
          </ion-card>
        </ion-col>
      </ion-row>
    </ion-grid>

    <ion-modal :is-open="dialog" @did-dismiss="dialog = false">
      <ion-header>
        <ion-toolbar>
          <ion-title>Create Custom Analyst</ion-title>
          <ion-buttons slot="end">
            <ion-button @click="dialog = false">Cancel</ion-button>
          </ion-buttons>
        </ion-toolbar>
      </ion-header>
      <ion-content class="ion-padding">
        <ion-item>
          <ion-input v-model="form.slug" label="Slug" placeholder="esg-emily" label-placement="stacked" />
        </ion-item>
        <ion-item>
          <ion-input v-model="form.displayName" label="Display Name" placeholder="ESG Emily" label-placement="stacked" />
        </ion-item>
        <ion-item>
          <ion-textarea v-model="form.personaPrompt" label="Persona Prompt" :rows="4" label-placement="stacked"
            placeholder="You are ESG Emily, focused on environmental, social, and governance factors..." />
        </ion-item>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
          <ion-button fill="clear" @click="dialog = false">Cancel</ion-button>
          <ion-button color="primary" @click="handleCreate"
            :disabled="!form.slug || !form.displayName || !form.personaPrompt">Create</ion-button>
        </div>
      </ion-content>
    </ion-modal>
  </div>
</template>
