<script setup lang="ts">
import { ref } from 'vue';
import { IonSegment, IonSegmentButton, IonLabel } from '@ionic/vue';
import AnalystsTab from './authored/AnalystsTab.vue';
import InstrumentsTab from './authored/InstrumentsTab.vue';

const activeTab = ref<'analysts' | 'instruments'>('analysts');
</script>

<template>
  <div>
    <h1 style="margin: 0 0 16px 0">Your Content</h1>

    <ion-segment :value="activeTab" @ionChange="activeTab = ($event.detail.value as 'analysts' | 'instruments')">
      <ion-segment-button value="analysts">
        <ion-label>Analysts</ion-label>
      </ion-segment-button>
      <ion-segment-button value="instruments">
        <ion-label>Instruments</ion-label>
      </ion-segment-button>
    </ion-segment>

    <div style="margin-top: 16px">
      <AnalystsTab v-if="activeTab === 'analysts'" />
      <InstrumentsTab v-else />
    </div>
  </div>
</template>
