<script setup lang="ts">
import { useRouter } from 'vue-router';
import {
  IonPage, IonSplitPane, IonMenu, IonHeader, IonToolbar, IonTitle,
  IonContent, IonList, IonItem, IonIcon, IonLabel, IonMenuButton,
  IonButtons, IonRouterOutlet, IonChip, IonButton,
} from '@ionic/vue';
import {
  gridOutline, statsChartOutline, peopleOutline, playOutline,
  analyticsOutline, shieldOutline, briefcaseOutline, newspaperOutline,
  ribbonOutline, bulbOutline, logOutOutline, earthOutline,
} from 'ionicons/icons';
import { useTenantStore } from '../stores/tenant.store';
import { useDomainStore } from '../stores/domain.store';

const tenant = useTenantStore();
const domain = useDomainStore();
const router = useRouter();

const navItems = [
  { title: 'Dashboard', icon: gridOutline, to: '/' },
  { title: 'Instruments', icon: statsChartOutline, to: '/instruments' },
  { title: 'Analysts', icon: peopleOutline, to: '/analysts' },
  { title: 'Runs', icon: playOutline, to: '/runs' },
  { title: 'Predictions', icon: analyticsOutline, to: '/predictions' },
  { title: 'Risk', icon: shieldOutline, to: '/risk' },
  { title: 'Portfolio', icon: briefcaseOutline, to: '/portfolio' },
  { title: 'Sources', icon: newspaperOutline, to: '/sources' },
  { title: 'Evaluations', icon: ribbonOutline, to: '/evaluations' },
  { title: 'Learning', icon: bulbOutline, to: '/learning' },
];

function logout() {
  tenant.clear();
  router.push('/login');
}

function orgLabel(): string {
  const orgs: Record<string, string> = {
    'alpha-capital': 'Alpha Capital',
    'steadfast-advisors': 'Steadfast Advisors',
    'apex-quant': 'Apex Quant',
  };
  return orgs[tenant.orgSlug] ?? tenant.orgSlug;
}
</script>

<template>
  <ion-split-pane content-id="main-content" when="md">
    <ion-menu content-id="main-content" type="overlay">
      <ion-header>
        <ion-toolbar color="primary">
          <ion-title>Divinr AI</ion-title>
        </ion-toolbar>
      </ion-header>
      <ion-content>
        <ion-list lines="none">
          <ion-item
            v-for="item in navItems"
            :key="item.to"
            :router-link="item.to"
            router-direction="root"
            :detail="false"
            button
          >
            <ion-icon slot="start" :icon="item.icon" />
            <ion-label>{{ item.title }}</ion-label>
          </ion-item>
        </ion-list>
      </ion-content>
    </ion-menu>

    <ion-page id="main-content">
      <ion-header>
        <ion-toolbar>
          <ion-buttons slot="start">
            <ion-menu-button />
          </ion-buttons>
          <ion-title>Divinr AI</ion-title>
          <ion-buttons slot="end">
            <ion-chip color="medium" outline>
              <ion-icon :icon="earthOutline" />
              <ion-label>{{ domain.activeUniverse }}</ion-label>
            </ion-chip>
            <ion-chip color="primary" outline>
              <ion-label>{{ orgLabel() }}</ion-label>
            </ion-chip>
            <ion-chip color="medium">
              <ion-label>{{ tenant.userId }}</ion-label>
            </ion-chip>
            <ion-button fill="clear" @click="logout">
              <ion-icon :icon="logOutOutline" />
            </ion-button>
          </ion-buttons>
        </ion-toolbar>
      </ion-header>
      <ion-content class="ion-padding">
        <ion-router-outlet />
      </ion-content>
    </ion-page>
  </ion-split-pane>
</template>
