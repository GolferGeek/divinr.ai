<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage, IonContent, IonCard, IonCardHeader, IonCardTitle, IonCardSubtitle,
  IonCardContent, IonList, IonItem, IonLabel, IonRadioGroup, IonRadio,
  IonInput, IonButton, IonIcon, IonNote, IonText,
} from '@ionic/vue';
import { analyticsOutline } from 'ionicons/icons';
import { useTenantStore } from '../stores/tenant.store';

const tenant = useTenantStore();
const router = useRouter();

const selectedOrg = ref(tenant.orgSlug || '');
const userId = ref(tenant.userId || '');
const error = ref('');

const demoOrgs = [
  { slug: 'alpha-capital', label: 'Alpha Capital', desc: 'Aggressive growth — momentum-focused' },
  { slug: 'steadfast-advisors', label: 'Steadfast Advisors', desc: 'Conservative value — risk-averse' },
  { slug: 'apex-quant', label: 'Apex Quant', desc: 'Quantitative/technical — data-driven' },
];

function login() {
  if (!selectedOrg.value) { error.value = 'Select an organization'; return; }
  if (!userId.value.trim()) { error.value = 'Enter a user ID'; return; }
  tenant.setTenant(selectedOrg.value, userId.value.trim());
  router.push('/');
}
</script>

<template>
  <ion-page>
    <ion-content class="ion-padding" :fullscreen="true">
      <div style="display:flex; justify-content:center; align-items:center; min-height:100vh">
        <ion-card style="max-width:450px; width:100%">
          <ion-card-header class="ion-text-center">
            <ion-icon :icon="analyticsOutline" size="large" color="primary" />
            <ion-card-title>Divinr AI</ion-card-title>
            <ion-card-subtitle>Market Intelligence Platform</ion-card-subtitle>
          </ion-card-header>

          <ion-card-content>
            <ion-text v-if="error" color="danger"><p>{{ error }}</p></ion-text>

            <h3>Select Organization</h3>
            <ion-radio-group v-model="selectedOrg">
              <ion-list lines="none">
                <ion-item v-for="org in demoOrgs" :key="org.slug">
                  <ion-radio slot="start" :value="org.slug" />
                  <ion-label>
                    <h2>{{ org.label }}</h2>
                    <ion-note>{{ org.desc }}</ion-note>
                  </ion-label>
                </ion-item>
              </ion-list>
            </ion-radio-group>

            <ion-item class="ion-margin-top">
              <ion-input
                v-model="userId"
                label="User ID"
                label-placement="floating"
                placeholder="admin@alpha-capital.demo"
                @keyup.enter="login"
              />
            </ion-item>

            <ion-button expand="block" class="ion-margin-top" :disabled="!selectedOrg || !userId.trim()" @click="login">
              Sign In
            </ion-button>
          </ion-card-content>
        </ion-card>
      </div>
    </ion-content>
  </ion-page>
</template>
