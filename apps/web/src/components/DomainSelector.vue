<script setup lang="ts">
import { ref } from 'vue';
import { useDomainStore } from '../stores/domain.store';
import {
  IonButton, IonPopover, IonList, IonItem, IonLabel, IonListHeader,
} from '@ionic/vue';
import { earthOutline } from 'ionicons/icons';

const domain = useDomainStore();
const popoverOpen = ref(false);
const popoverEvent = ref<Event | null>(null);

const domains = [
  { slug: 'financial', label: 'Financial Markets', universes: [
    { slug: 'stocks', label: 'Stocks' },
    { slug: 'crypto', label: 'Crypto' },
  ]},
  { slug: 'betting', label: 'Betting Markets', universes: [
    { slug: 'polymarket', label: 'Polymarket' },
    { slug: 'nfl', label: 'NFL' },
  ]},
  { slug: 'elections', label: 'Elections', universes: [
    { slug: 'us-2028-pres', label: 'US 2028' },
    { slug: 'us-2026-mid', label: 'US 2026 Mid' },
  ]},
];

function openPopover(e: Event) {
  popoverEvent.value = e;
  popoverOpen.value = true;
}

function selectDomain(domainSlug: string, universeSlug: string) {
  domain.setDomain(domainSlug, universeSlug);
  popoverOpen.value = false;
}
</script>

<template>
  <ion-button fill="clear" size="small" @click="openPopover($event)">
    <ion-icon slot="start" :icon="earthOutline" />
    {{ domain.activeUniverse }}
  </ion-button>
  <ion-popover :is-open="popoverOpen" :event="popoverEvent" @did-dismiss="popoverOpen = false">
    <ion-list>
      <template v-for="d in domains" :key="d.slug">
        <ion-list-header>{{ d.label }}</ion-list-header>
        <ion-item
          v-for="u in d.universes"
          :key="u.slug"
          button
          :color="domain.activeUniverse === u.slug ? 'primary' : undefined"
          @click="selectDomain(d.slug, u.slug)"
        >
          <ion-label>{{ u.label }}</ion-label>
        </ion-item>
      </template>
    </ion-list>
  </ion-popover>
</template>
