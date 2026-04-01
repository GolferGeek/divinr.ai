<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useTenantStore } from '../stores/tenant.store';
import { IonChip, IonButton } from '@ionic/vue';
import { logOutOutline, personOutline, businessOutline } from 'ionicons/icons';

const tenant = useTenantStore();
const router = useRouter();

const demoOrgs = [
  { slug: 'alpha-capital', label: 'Alpha Capital' },
  { slug: 'steadfast-advisors', label: 'Steadfast Advisors' },
  { slug: 'apex-quant', label: 'Apex Quant' },
];

function currentOrgLabel(): string {
  const org = demoOrgs.find(o => o.slug === tenant.orgSlug);
  return org?.label ?? tenant.orgSlug ?? 'Not set';
}

function logout() {
  tenant.clear();
  router.push('/login');
}
</script>

<template>
  <div style="display:flex;align-items:center;gap:8px">
    <ion-chip color="primary" outline>
      <ion-icon :icon="businessOutline" />
      {{ currentOrgLabel() }}
    </ion-chip>
    <ion-chip>
      <ion-icon :icon="personOutline" />
      {{ tenant.userId || 'Anonymous' }}
    </ion-chip>
    <ion-button fill="clear" size="small" @click="logout">
      <ion-icon slot="icon-only" :icon="logOutOutline" />
    </ion-button>
  </div>
</template>
