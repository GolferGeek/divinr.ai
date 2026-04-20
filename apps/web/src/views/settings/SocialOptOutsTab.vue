<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  IonSpinner,
  IonNote,
  IonItem,
  IonLabel,
  IonToggle,
  IonList,
} from '@ionic/vue';
import { useApi } from '../../composables/useApi';
import { useAuthStore } from '../../stores/auth.store';
import FirstTouchPanel from '../../components/FirstTouchPanel.vue';
import LegalDisclaimer from '../../components/LegalDisclaimer.vue';

interface SocialOptOuts {
  social_visible_in_member_lists: boolean;
  social_messaging_enabled: boolean;
  social_tournament_participation: boolean;
  social_leaderboard_visible: boolean;
  social_notifications_enabled: boolean;
}

type OptOutFlag = keyof SocialOptOuts;

interface FlagDescriptor {
  key: OptOutFlag;
  title: string;
  body: string;
  note?: string;
}

const FLAGS: FlagDescriptor[] = [
  {
    key: 'social_visible_in_member_lists',
    title: 'Appear in club member lists',
    body: 'Other members of clubs you belong to can see your name in the member roster.',
  },
  {
    key: 'social_messaging_enabled',
    title: 'Appear in messaging search',
    body: 'Other members can find you when searching for someone to start a direct message with.',
  },
  {
    key: 'social_tournament_participation',
    title: 'Appear in tournament rosters',
    body: 'Your name appears alongside other entrants on tournament pages you join from now on.',
    note: 'Takes effect for tournaments you join after changing this setting. Tournaments you have already entered will still show you until they end.',
  },
  {
    key: 'social_leaderboard_visible',
    title: 'Appear on leaderboards',
    body: 'Your name and rank appear on tournament leaderboards, club post-mortems, and best-trade highlights.',
  },
  {
    key: 'social_notifications_enabled',
    title: 'Receive social notifications',
    body: 'Broadcasts from the platform (market events, club activity) arrive in your notification bell.',
  },
];

const auth = useAuthStore();
const api = useApi('/api/users');
const optOuts = ref<SocialOptOuts | null>(null);
const loading = ref(true);
const saving = ref<OptOutFlag | null>(null);
const error = ref<string | null>(null);

async function fetchOptOuts(): Promise<void> {
  if (!auth.userId) {
    error.value = 'Not signed in';
    loading.value = false;
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    optOuts.value = await api.get<SocialOptOuts>(`/${auth.userId}/social-opt-outs`);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
  loading.value = false;
}

async function toggle(flag: OptOutFlag, next: boolean): Promise<void> {
  if (!auth.userId || !optOuts.value) return;
  const previous = optOuts.value[flag];
  optOuts.value[flag] = next;
  saving.value = flag;
  error.value = null;
  try {
    optOuts.value = await api.patch<SocialOptOuts>(
      `/${auth.userId}/social-opt-outs`,
      { [flag]: next },
    );
  } catch (err) {
    optOuts.value[flag] = previous;
    error.value = err instanceof Error ? err.message : String(err);
  }
  saving.value = null;
}

onMounted(fetchOptOuts);
</script>

<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px">
      <h2 style="margin: 0">Visibility & social</h2>
    </div>

    <ion-note color="medium" style="display: block; padding: 12px; margin-bottom: 16px; border-radius: 8px; background: rgba(128, 128, 128, 0.08)">
      Turn any of these off to keep your activity on Divinr private. Base platform features still work — only the social surfaces change.
    </ion-note>

    <ion-spinner v-if="loading" name="crescent" />

    <ion-note v-if="error" color="danger" style="display: block; padding: 12px; margin-bottom: 8px">
      {{ error }}
    </ion-note>

    <ion-list v-if="!loading && optOuts" style="margin-bottom: 24px">
      <ion-item v-for="flag in FLAGS" :key="flag.key">
        <ion-label class="ion-text-wrap">
          <h3>{{ flag.title }}</h3>
          <p>{{ flag.body }}</p>
          <p v-if="flag.note" style="font-style: italic; color: var(--ion-color-medium)">
            {{ flag.note }}
          </p>
        </ion-label>
        <ion-toggle
          slot="end"
          :checked="optOuts[flag.key]"
          :disabled="saving === flag.key"
          :data-testid="`social-opt-out-${flag.key}`"
          @ion-change="(event: CustomEvent) => toggle(flag.key, (event.detail as { checked: boolean }).checked)"
        />
      </ion-item>
    </ion-list>

    <LegalDisclaimer variant="short" />

    <FirstTouchPanel surface-key="settings.social-opt-outs" />
  </div>
</template>
