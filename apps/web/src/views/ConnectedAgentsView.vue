<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonChip,
  IonSpinner,
} from '@ionic/vue';
import FirstTouchPanel from '../components/FirstTouchPanel.vue';
import LegalDisclaimer from '../components/LegalDisclaimer.vue';
import {
  useConnectedAgents,
  type ConnectedAgent,
} from '../composables/useConnectedAgents';

const router = useRouter();
const api = useConnectedAgents();
const agents = ref<ConnectedAgent[]>([]);
const failure = ref('');

async function load() {
  failure.value = '';
  try {
    agents.value = await api.list();
  } catch {
    failure.value = 'Connected agents could not be loaded.';
  }
}

function openAgent(installationId: string) {
  void router.push({
    name: 'connected-agent-detail',
    params: { installationId },
  });
}

onMounted(load);
</script>

<template>
  <main class="connected-agents" data-testid="connected-agents-list">
    <header>
      <p class="eyebrow">Security settings</p>
      <h1>Connected Agents</h1>
      <p>Inspect every personal-agent installation that can request Divinr work for your account.</p>
    </header>

    <div v-if="api.loading.value" class="loading" role="status">
      <ion-spinner name="crescent" /> Loading connected agents
    </div>
    <p v-if="failure" class="error" role="alert">{{ failure }}</p>

    <section v-if="!api.loading.value && agents.length === 0" class="empty">
      <h2>No connected agents</h2>
      <p>Start a connection from Apple Assistant, then review its device code here.</p>
      <ion-button router-link="/connect/device">Enter a device code</ion-button>
    </section>

    <section class="agent-grid" aria-label="Connected agent installations">
      <ion-card
        v-for="agent in agents"
        :key="agent.installationId"
        class="agent-card"
        :data-testid="`connected-agent-${agent.installationId}`"
      >
        <ion-card-header>
          <div class="title-row">
            <ion-card-title>{{ agent.displayName }}</ion-card-title>
            <ion-chip :color="agent.status === 'active' ? 'success' : 'medium'">
              {{ agent.status }}
            </ion-chip>
          </div>
        </ion-card-header>
        <ion-card-content>
          <p class="mono">{{ agent.installationId }}</p>
          <p>{{ agent.approvedScopes.length }} approved scopes · {{ agent.grants.length }} grant records</p>
          <p>Last use: {{ agent.lastUsedAt ? new Date(agent.lastUsedAt).toLocaleString() : 'Never' }}</p>
          <ion-button
            fill="outline"
            :aria-label="`Inspect ${agent.displayName}`"
            @click="openAgent(agent.installationId)"
          >
            Inspect
          </ion-button>
        </ion-card-content>
      </ion-card>
    </section>

    <LegalDisclaimer variant="short" />
    <FirstTouchPanel surface-key="settings.connected-agents" />
  </main>
</template>

<style scoped>
.connected-agents { width: min(1050px, 100%); margin: 0 auto; padding-bottom: 48px; }
header { max-width: 720px; margin-bottom: 20px; }
h1 { margin: 4px 0 8px; font-size: clamp(2rem, 4vw, 3rem); }
.eyebrow { color: var(--ion-color-primary); font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
.agent-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; }
.agent-card { margin: 0; }
.title-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
.loading, .empty, .error { padding: 20px; border-radius: 12px; }
.empty { border: 1px dashed var(--ion-color-medium); }
.error { color: var(--ion-color-danger); background: rgba(var(--ion-color-danger-rgb), .08); }
</style>
