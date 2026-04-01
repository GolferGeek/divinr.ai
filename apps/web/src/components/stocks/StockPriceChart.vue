<script setup lang="ts">
import { IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonIcon } from '@ionic/vue';
import { trendingUpOutline } from 'ionicons/icons';

defineProps<{
  symbol: string;
  price?: number;
  changePct?: number;
}>();
</script>

<template>
  <ion-card>
    <ion-card-header><ion-card-title>{{ symbol }} Price Chart</ion-card-title></ion-card-header>
    <ion-card-content style="text-align:center;padding:32px">
      <ion-icon :icon="trendingUpOutline" color="primary" style="font-size:64px;margin-bottom:8px" />
      <div v-if="price" style="font-size:1.5rem;font-weight:bold">${{ price.toFixed(2) }}</div>
      <div v-if="changePct" :style="{ color: changePct >= 0 ? 'var(--ion-color-success)' : 'var(--ion-color-danger)', fontSize: '1.1rem', fontWeight: 'bold' }">
        {{ changePct >= 0 ? '+' : '' }}{{ changePct.toFixed(1) }}%
      </div>
      <p style="opacity:0.5;margin-top:8px">Chart visualization -- requires market data API integration</p>
    </ion-card-content>
  </ion-card>
</template>
