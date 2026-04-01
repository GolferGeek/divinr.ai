<script setup lang="ts">
import { onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useDomainStore } from '../stores/domain.store';
import { useInstrumentsStore } from '../stores/instruments.store';
import { useTenantStore } from '../stores/tenant.store';
import {
  IonGrid, IonRow, IonCol, IonCard, IonCardHeader, IonCardTitle, IonCardSubtitle,
  IonCardContent, IonChip, IonNote,
} from '@ionic/vue';

const route = useRoute();
const domain = useDomainStore();
const instruments = useInstrumentsStore();
const tenant = useTenantStore();

function sync() {
  const d = route.params.domain as string;
  if (d && d !== domain.activeDomain) {
    domain.setDomain(d);
  }
}

onMounted(async () => {
  sync();
  if (tenant.isConfigured()) await instruments.fetch();
});

watch(() => route.params.domain, sync);
</script>

<template>
  <div>
    <h1 style="margin-bottom:4px">{{ domain.dashboardLayout?.title ?? domain.activeDomain }}</h1>
    <p style="opacity:0.5;font-size:0.85rem;margin-bottom:16px">Universe: {{ domain.activeUniverse }}</p>

    <template v-if="domain.dashboardLayout">
      <ion-grid>
        <ion-row>
          <ion-col v-for="section in domain.dashboardLayout.sections" :key="section.id" size="12" size-md="6">
            <ion-card>
              <ion-card-header>
                <ion-card-title>{{ section.title }}</ion-card-title>
                <ion-card-subtitle>{{ section.type }}</ion-card-subtitle>
              </ion-card-header>
              <ion-card-content>
                <template v-if="section.id === 'instruments'">
                  <ion-chip v-for="inst in instruments.items" :key="String(inst['id'])" style="margin:4px">
                    {{ inst['symbol'] }}
                  </ion-chip>
                </template>
                <template v-else>
                  <p style="opacity:0.5">Visualization placeholder for {{ section.type }} widget</p>
                </template>
              </ion-card-content>
            </ion-card>
          </ion-col>
        </ion-row>
      </ion-grid>
    </template>

    <ion-card v-if="domain.visualizationTypes.length > 0" color="primary" style="margin-top:16px">
      <ion-card-content>
        Available visualizations for this domain:
        <ion-chip v-for="viz in domain.visualizationTypes" :key="viz.id" style="margin:4px;font-size:0.7rem;height:24px">{{ viz.label }}</ion-chip>
      </ion-card-content>
    </ion-card>
  </div>
</template>
