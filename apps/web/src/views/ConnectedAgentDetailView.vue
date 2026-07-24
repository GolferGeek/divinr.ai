<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  IonButton,
  IonChip,
  IonInput,
  IonSpinner,
} from '@ionic/vue';
import FirstTouchPanel from '../components/FirstTouchPanel.vue';
import LegalDisclaimer from '../components/LegalDisclaimer.vue';
import {
  useConnectedAgents,
  type ConnectedAgentDetail,
} from '../composables/useConnectedAgents';

const route = useRoute();
const router = useRouter();
const api = useConnectedAgents();
const agent = ref<ConnectedAgentDetail | null>(null);
const installationConfirmation = ref('');
const grantConfirmations = ref<Record<string, string>>({});
const reason = ref('Owner requested revocation');
const failure = ref('');
const notice = ref('');
const installationId = computed(() => String(route.params.installationId ?? ''));

async function load() {
  failure.value = '';
  try {
    agent.value = await api.detail(installationId.value);
  } catch {
    failure.value = 'This connected agent is unavailable.';
  }
}

async function revokeGrant(grantId: string) {
  if (grantConfirmations.value[grantId] !== 'REVOKE GRANT') return;
  try {
    await api.revokeGrant(installationId.value, grantId, reason.value);
    notice.value = 'The grant was revoked.';
    await load();
  } catch {
    failure.value = 'The grant could not be revoked.';
  }
}

async function revokeAgent() {
  if (installationConfirmation.value !== 'REVOKE AGENT') return;
  try {
    await api.revokeInstallation(installationId.value, reason.value);
    notice.value = 'The connected agent and all active grants were revoked.';
    installationConfirmation.value = '';
    await load();
  } catch {
    failure.value = 'The connected agent could not be revoked.';
  }
}

onMounted(load);
</script>

<template>
  <main class="agent-detail" data-testid="connected-agent-detail">
    <ion-button fill="clear" @click="router.push('/settings/connected-agents')">
      ← Connected Agents
    </ion-button>
    <div v-if="api.loading.value && !agent" class="loading" role="status">
      <ion-spinner name="crescent" /> Loading agent
    </div>
    <p v-if="failure" class="message error" role="alert">{{ failure }}</p>
    <p v-if="notice" class="message success" role="status">{{ notice }}</p>

    <template v-if="agent">
      <header>
        <div>
          <p class="eyebrow">Connected agent</p>
          <h1>{{ agent.displayName }}</h1>
        </div>
        <ion-chip :color="agent.status === 'active' ? 'success' : 'medium'">
          {{ agent.status }}
        </ion-chip>
      </header>

      <section class="summary" aria-label="Installation summary">
        <dl>
          <div><dt>Installation ID</dt><dd>{{ agent.installationId }}</dd></div>
          <div><dt>DPoP thumbprint</dt><dd class="mono">{{ agent.dpopJkt }}</dd></div>
          <div><dt>Created</dt><dd>{{ new Date(agent.createdAt).toLocaleString() }}</dd></div>
          <div><dt>Last use</dt><dd>{{ agent.lastUsedAt ? new Date(agent.lastUsedAt).toLocaleString() : 'Never' }}</dd></div>
        </dl>
      </section>

      <section>
        <h2>Grants and scopes</h2>
        <article
          v-for="grant in agent.grants"
          :key="grant.grantId"
          class="record-card"
          :data-testid="`connected-agent-grant-${grant.grantId}`"
        >
          <div class="record-heading">
            <strong>{{ grant.grantId }}</strong>
            <ion-chip :color="grant.status === 'active' ? 'success' : 'medium'">
              {{ grant.status }}
            </ion-chip>
          </div>
          <ul><li v-for="scope in grant.scopes" :key="scope"><code>{{ scope }}</code></li></ul>
          <p>Valid until {{ new Date(grant.validUntil).toLocaleString() }}</p>
          <p v-if="grant.openAuthorityRef">Authority: <code>{{ grant.openAuthorityRef }}</code></p>
          <div v-if="grant.status === 'active'" class="revoke-row">
            <ion-input
              v-model="grantConfirmations[grant.grantId]"
              :data-testid="`grant-revoke-confirmation-${grant.grantId}`"
              label="Type REVOKE GRANT"
              label-placement="stacked"
              autocomplete="off"
            />
            <ion-button
              color="danger"
              fill="outline"
              :data-testid="`grant-revoke-${grant.grantId}`"
              :disabled="grantConfirmations[grant.grantId] !== 'REVOKE GRANT'"
              @click="revokeGrant(grant.grantId)"
            >
              Revoke grant
            </ion-button>
          </div>
        </article>
      </section>

      <section>
        <h2>Safe audit history</h2>
        <p v-if="agent.audit.length === 0">No audit entries yet.</p>
        <ol class="timeline">
          <li v-for="event in agent.audit" :key="event.eventId">
            <strong>{{ event.action }}</strong>
            <span>{{ event.outcome }} · {{ new Date(event.occurredAt).toLocaleString() }}</span>
            <small v-if="event.reason">{{ event.reason }}</small>
          </li>
        </ol>
      </section>

      <section>
        <h2>Receipt references</h2>
        <p v-if="agent.receipts.length === 0">No payment or service receipt references yet.</p>
        <ul>
          <li v-for="receipt in agent.receipts" :key="receipt.receiptId">
            {{ receipt.receiptType }} · {{ receipt.verificationState }} ·
            <code>{{ receipt.signedReceiptRef ?? receipt.receiptId }}</code>
          </li>
        </ul>
      </section>

      <section v-if="agent.status === 'active'" class="danger-zone">
        <h2>Revoke this agent</h2>
        <p>This immediately revokes every active grant and sender-constrained credential family.</p>
        <ion-input
          v-model="reason"
          data-testid="agent-revoke-reason"
          label="Reason"
          label-placement="stacked"
        />
        <ion-input
          v-model="installationConfirmation"
          data-testid="agent-revoke-confirmation"
          label="Type REVOKE AGENT"
          label-placement="stacked"
          autocomplete="off"
        />
        <ion-button
          color="danger"
          data-testid="agent-revoke"
          :disabled="installationConfirmation !== 'REVOKE AGENT'"
          @click="revokeAgent"
        >
          Revoke connected agent
        </ion-button>
      </section>
    </template>

    <LegalDisclaimer variant="short" />
    <FirstTouchPanel surface-key="settings.connected-agent-detail" />
  </main>
</template>

<style scoped>
.agent-detail { width: min(980px, 100%); margin: 0 auto; padding-bottom: 48px; }
header { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
h1 { margin: 4px 0 14px; font-size: clamp(2rem, 4vw, 3rem); }
.eyebrow { color: var(--ion-color-primary); font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
section { margin: 18px 0; }
.summary, .record-card, .danger-zone { border: 1px solid var(--ion-color-light-shade); border-radius: 14px; padding: 20px; }
dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
dt { font-size: .8rem; color: var(--ion-color-medium); text-transform: uppercase; }
dd { margin: 4px 0 0; overflow-wrap: anywhere; }
.mono, code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
.record-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; overflow-wrap: anywhere; }
.revoke-row { display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: end; }
.timeline { display: grid; gap: 10px; padding-left: 20px; }
.timeline li { display: grid; gap: 3px; }
.timeline span, .timeline small { color: var(--ion-color-medium); }
.danger-zone { border-color: var(--ion-color-danger); }
.message { border-radius: 8px; padding: 12px; }
.error { color: var(--ion-color-danger); background: rgba(var(--ion-color-danger-rgb), .08); }
.success { color: var(--ion-color-success-shade); background: rgba(var(--ion-color-success-rgb), .08); }
@media (max-width: 700px) {
  dl { grid-template-columns: 1fr; }
  .revoke-row { grid-template-columns: 1fr; }
}
</style>
