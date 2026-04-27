<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  IonCard, IonCardContent, IonCardHeader, IonCardTitle,
  IonItem, IonLabel, IonToggle, IonButton, IonList, IonNote,
} from '@ionic/vue';
import { useFirstTouchStore } from '../stores/firstTouch.store';
import { useAuthStore } from '../stores/auth.store';
import { useMasteryStore } from '../stores/mastery.store';
import type { MasteryLevel } from '../mastery/mastery-config';
import FirstTouchPanel from '../components/FirstTouchPanel.vue';

const firstTouch = useFirstTouchStore();
const auth = useAuthStore();
const mastery = useMasteryStore();
const savingLevel = ref<MasteryLevel | null>(null);

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

function formatLevelLabel(level: string): string {
  return level
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

const levelOptions = computed(() => {
  const options: Array<{ level: MasteryLevel; label: string; body: string }> = [
    {
      level: 'core_trading',
      label: 'Core Trading',
      body: 'Keep the shell focused on analyses, risk, trading, portfolios, and the Learning Panel.',
    },
    {
      level: 'competitive_participation',
      label: 'Competitive Participation',
      body: 'Add clubs and tournament participation surfaces.',
    },
    {
      level: 'community_creation',
      label: 'Community Creation',
      body: 'Reveal club and tournament creation plus messaging workflows.',
    },
    {
      level: 'builder',
      label: 'Builder',
      body: 'Reveal research, analysts, and authored-content surfaces.',
    },
  ];
  if (auth.isAdmin) {
    options.push({
      level: 'operator',
      label: 'Operator',
      body: 'Keep the full operator shell visible, including coordination and system surfaces.',
    });
  }
  return options;
});

function isCurrentLevel(level: MasteryLevel): boolean {
  return mastery.currentLevel === level;
}

async function chooseLevel(level: MasteryLevel): Promise<void> {
  if (isCurrentLevel(level)) return;
  savingLevel.value = level;
  try {
    await mastery.updatePreferredLevel(level);
  } finally {
    savingLevel.value = null;
  }
}

onMounted(() => {
  if (!mastery.loaded && !mastery.loading) {
    void mastery.fetch().catch(() => {});
  }
});

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
        <ion-card-title>App complexity</ion-card-title>
      </ion-card-header>
      <ion-card-content>
        <p>
          Choose how much of Divinr you want visible in the shell. This changes
          what is shown in the left navigation; it does not change real permissions.
        </p>
        <ion-note v-if="mastery.nextLevel">
          Suggested next level: {{ formatLevelLabel(mastery.nextLevel) }}
        </ion-note>
        <ion-list class="section-list">
          <ion-item
            v-for="option in levelOptions"
            :key="option.level"
            lines="full"
          >
            <ion-label>
              <h3>{{ option.label }}</h3>
              <p>{{ option.body }}</p>
            </ion-label>
            <ion-button
              slot="end"
              :fill="isCurrentLevel(option.level) ? 'solid' : 'outline'"
              size="small"
              :disabled="savingLevel !== null"
              @click="chooseLevel(option.level)"
            >
              {{ isCurrentLevel(option.level) ? 'Current' : (savingLevel === option.level ? 'Saving…' : 'Show this') }}
            </ion-button>
          </ion-item>
        </ion-list>
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
