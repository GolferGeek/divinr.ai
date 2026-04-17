<script setup lang="ts">
import { ref } from 'vue';
import { IonSegment, IonSegmentButton, IonLabel } from '@ionic/vue';
import AnalystsTab from './authored/AnalystsTab.vue';
import InstrumentsTab from './authored/InstrumentsTab.vue';
import WiringMatrixView from './authored/WiringMatrixView.vue';
import BillingTab from './authored/BillingTab.vue';

const activeTab = ref<'analysts' | 'instruments' | 'wiring' | 'billing'>('analysts');
</script>

<template>
  <div>
    <h1 style="margin: 0 0 16px 0">Your Content</h1>

    <ion-segment :value="activeTab" @ionChange="activeTab = ($event.detail.value as 'analysts' | 'instruments' | 'wiring' | 'billing')">
      <ion-segment-button value="analysts">
        <ion-label>Analysts</ion-label>
      </ion-segment-button>
      <ion-segment-button value="instruments">
        <ion-label>Instruments</ion-label>
      </ion-segment-button>
      <ion-segment-button value="wiring">
        <ion-label>Wiring</ion-label>
      </ion-segment-button>
      <ion-segment-button value="billing">
        <ion-label>Billing</ion-label>
      </ion-segment-button>
    </ion-segment>

    <div style="margin-top: 16px">
      <AnalystsTab v-if="activeTab === 'analysts'" />
      <InstrumentsTab v-else-if="activeTab === 'instruments'" />
      <WiringMatrixView v-else-if="activeTab === 'wiring'" />
      <BillingTab v-else />
    </div>
  </div>
</template>
