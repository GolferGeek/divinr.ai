<script setup lang="ts">
import { computed } from 'vue';
import {
  IonCard, IonCardContent, IonCardHeader, IonCardTitle,
  IonItem, IonLabel, IonToggle, IonButton, IonList, IonNote,
} from '@ionic/vue';
import { useFirstTouchStore } from '../stores/firstTouch.store';
import { useAuthStore } from '../stores/auth.store';
import FirstTouchPanel from '../components/FirstTouchPanel.vue';

const firstTouch = useFirstTouchStore();
const auth = useAuthStore();

const showFirstTouch = computed<boolean>({
  get: () => !firstTouch.muted,
  set: (val: boolean) => {
    void firstTouch.setMute(!val);
  },
});

interface SectionReset {
  label: string;
  prefix: string;
  hint: string;
  adminOnly?: boolean;
}

const sections: SectionReset[] = [
  { label: 'Dashboard', prefix: 'dashboard', hint: 'Your home page and its widgets.' },
  { label: 'Analyses', prefix: 'prediction', hint: 'The analysis list and analysis detail pages.' },
  { label: 'Research', prefix: 'instrument', hint: 'Ticker pages, debate panels, contracts.' },
  { label: 'Analysts', prefix: 'analyst', hint: 'Analyst directory, performance, contracts.' },
  { label: 'Portfolios', prefix: 'portfolio', hint: 'Your portfolios and position rows.' },
  { label: 'Performance', prefix: 'performance', hint: 'Leaderboard, equity curves, calibration.' },
  { label: 'Clubs', prefix: 'club', hint: 'Club browser, detail, members, analytics.' },
  { label: 'Tournaments', prefix: 'tournament', hint: 'Tournament list, detail, my positions.' },
  { label: 'Messages', prefix: 'message', hint: 'Channels, DMs, threads.' },
  { label: 'Authoring', prefix: 'authoring', hint: 'Creating custom analysts, instruments, contracts.' },
  { label: 'Settings', prefix: 'settings', hint: 'Settings pages (including this one).' },
  { label: 'Billing', prefix: 'billing', hint: 'Billing summary and usage.' },
  { label: 'Admin', prefix: 'admin', hint: 'Admin-only surfaces (runs, evaluations, cost, attribution).', adminOnly: true },
];

const visibleSections = computed(() => sections.filter(s => !s.adminOnly || auth.isAdmin));

async function resetSection(prefix: string): Promise<void> {
  await firstTouch.resetByPrefix(prefix);
}

async function resetAll(): Promise<void> {
  await firstTouch.resetAll();
}
</script>

<template>
  <div class="onboarding-settings">
    <h1>Onboarding</h1>
    <p class="intro">
      Divinr pops a short intro the first time you land on a new page. Nothing is
      required — you can turn the whole thing off, replay a section, or start fresh.
    </p>

    <ion-card>
      <ion-card-header>
        <ion-card-title>First-touch walkthroughs</ion-card-title>
      </ion-card-header>
      <ion-card-content>
        <ion-item lines="none">
          <ion-label>
            <h3>Show first-touch walkthroughs</h3>
            <p>
              We'll pop a short intro the first time you land on a new page. Turn
              off if you'd rather poke around on your own.
            </p>
          </ion-label>
          <ion-toggle v-model="showFirstTouch" slot="end" />
        </ion-item>
      </ion-card-content>
    </ion-card>

    <ion-card>
      <ion-card-header>
        <ion-card-title>Replay a section</ion-card-title>
      </ion-card-header>
      <ion-card-content>
        <ion-note>
          Show the intro again for a specific area the next time you visit.
        </ion-note>
        <ion-list class="section-list">
          <ion-item
            v-for="s in visibleSections"
            :key="s.prefix"
            lines="full"
          >
            <ion-label>
              <h3>{{ s.label }}</h3>
              <p>{{ s.hint }}</p>
            </ion-label>
            <ion-button
              slot="end"
              fill="outline"
              size="small"
              @click="resetSection(s.prefix)"
            >
              Show me again
            </ion-button>
          </ion-item>
        </ion-list>
      </ion-card-content>
    </ion-card>

    <ion-card>
      <ion-card-header>
        <ion-card-title>Start over</ion-card-title>
      </ion-card-header>
      <ion-card-content>
        <p>
          Show every intro again, across every page. Handy when Divinr adds new
          surfaces or if you're bringing a friend along.
        </p>
        <ion-button color="primary" @click="resetAll">
          Show me everything again
        </ion-button>
      </ion-card-content>
    </ion-card>

  <FirstTouchPanel surface-key="settings.onboarding" />
  </div>
</template>

<style scoped>
.onboarding-settings {
  padding: 0 8px 32px;
  max-width: 760px;
}

.intro {
  margin: 0 0 24px;
  color: var(--ion-color-medium);
  font-size: 0.95rem;
  line-height: 1.5;
}

ion-card {
  margin: 0 0 20px;
}

.section-list ion-item {
  --padding-start: 0;
}
</style>
