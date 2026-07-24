<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonInput,
  IonPage,
  IonSpinner,
} from '@ionic/vue';
import FirstTouchPanel from '../components/FirstTouchPanel.vue';
import LegalDisclaimer from '../components/LegalDisclaimer.vue';
import {
  useConnectedAgents,
  type DeviceReview,
} from '../composables/useConnectedAgents';
import { useAuthStore } from '../stores/auth.store';
import { useFirstTouchStore } from '../stores/firstTouch.store';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const firstTouch = useFirstTouchStore();
const connectedAgents = useConnectedAgents();
const userCode = ref(typeof route.query.user_code === 'string' ? route.query.user_code : '');
const review = ref<DeviceReview | null>(null);
const confirmation = ref('');
const notice = ref('');
const failure = ref('');

const expiresLabel = computed(() => review.value
  ? new Date(review.value.expiresAt).toLocaleString()
  : '');

function signIn() {
  void router.push({
    name: 'login',
    query: { redirect: route.fullPath },
  });
}

async function loadReview() {
  failure.value = '';
  notice.value = '';
  review.value = null;
  if (!auth.isConfigured()) return;
  if (!userCode.value.trim()) {
    failure.value = 'Enter the code shown by Apple Assistant.';
    return;
  }
  try {
    review.value = await connectedAgents.reviewDevice(userCode.value);
    await router.replace({
      path: '/connect/device',
      query: { user_code: userCode.value.toUpperCase() },
    });
  } catch {
    failure.value = 'This connection request is unavailable, expired, or already used.';
  }
}

async function approve() {
  if (!review.value || confirmation.value !== 'APPROVE') return;
  try {
    await connectedAgents.approveDevice(userCode.value, review.value);
    notice.value = 'Apple Assistant is approved. Credential delivery will begin when the sender-constrained credential phase is enabled.';
    review.value = null;
    confirmation.value = '';
  } catch {
    failure.value = 'The connection could not be approved. Reload the request and verify every detail.';
  }
}

async function deny() {
  if (!review.value || confirmation.value !== 'DENY') return;
  try {
    await connectedAgents.denyDevice(userCode.value, review.value);
    notice.value = 'The connection request was denied.';
    review.value = null;
    confirmation.value = '';
  } catch {
    failure.value = 'The connection request could not be denied.';
  }
}

onMounted(async () => {
  if (auth.isConfigured()) {
    await firstTouch.fetch().catch(() => undefined);
    if (userCode.value) await loadReview();
  }
});
</script>

<template>
  <ion-page>
    <ion-content :fullscreen="true" class="ion-padding">
      <main class="device-connect" data-testid="device-connection-view">
        <header>
          <p class="eyebrow">Connected agent security</p>
          <h1>Connect Apple Assistant</h1>
          <p>
            Review the exact installation, key, scopes, and demo spending authority.
            No model text can approve this connection.
          </p>
        </header>

        <ion-card v-if="!auth.isConfigured()">
          <ion-card-header>
            <ion-card-title>Sign in to review this request</ion-card-title>
          </ion-card-header>
          <ion-card-content>
            <p>The device code will remain in the return link.</p>
            <ion-button data-testid="device-sign-in" @click="signIn">Sign in</ion-button>
          </ion-card-content>
        </ion-card>

        <ion-card v-else>
          <ion-card-header>
            <ion-card-title>Device code</ion-card-title>
          </ion-card-header>
          <ion-card-content>
            <ion-input
              v-model="userCode"
              data-testid="device-user-code"
              label="Apple Assistant code"
              label-placement="stacked"
              placeholder="ABCD-EFGH"
              autocomplete="one-time-code"
            />
            <ion-button
              data-testid="device-review"
              :disabled="connectedAgents.loading.value"
              @click="loadReview"
            >
              <ion-spinner v-if="connectedAgents.loading.value" name="crescent" />
              <span v-else>Review request</span>
            </ion-button>
          </ion-card-content>
        </ion-card>

        <p v-if="failure" class="message error" role="alert">{{ failure }}</p>
        <p v-if="notice" class="message success" role="status">{{ notice }}</p>

        <section v-if="review" class="review-grid" aria-label="Connection details">
          <article class="detail-card">
            <h2>Installation</h2>
            <dl>
              <div><dt>Name</dt><dd>{{ review.installationName }}</dd></div>
              <div><dt>Installation ID</dt><dd>{{ review.installationId }}</dd></div>
              <div><dt>DPoP key thumbprint</dt><dd class="mono">{{ review.dpopJkt }}</dd></div>
              <div><dt>Expires</dt><dd>{{ expiresLabel }}</dd></div>
            </dl>
          </article>

          <article class="detail-card">
            <h2>Requested access</h2>
            <ul>
              <li v-for="scope in review.scopes" :key="scope"><code>{{ scope }}</code></li>
            </ul>
            <p class="resource">Resource: <code>{{ review.resources[0] }}</code></p>
          </article>

          <article class="detail-card authority">
            <h2>Demo payment authority</h2>
            <p><strong>Valueless Bitcoin regtest only.</strong> No real money is used.</p>
            <ul>
              <li>Catalog items: {{ review.authority.productPriceMinorUnits.minimum }}–{{ review.authority.productPriceMinorUnits.maximum }}¢ each</li>
              <li>{{ review.authority.maximumSuccessfulCalls }} successful calls maximum</li>
              <li>{{ review.authority.maximumCumulativePriceMinorUnits }}¢ cumulative maximum</li>
              <li>{{ review.authority.authorityWindowSeconds / 60 }}-minute authority window</li>
            </ul>
          </article>

          <article class="detail-card action-card">
            <h2>Owner action</h2>
            <p>Type <strong>APPROVE</strong> or <strong>DENY</strong>. The typed value controls which action is available.</p>
            <ion-input
              v-model="confirmation"
              data-testid="device-confirmation"
              label="Typed confirmation"
              label-placement="stacked"
              autocomplete="off"
            />
            <div class="actions">
              <ion-button
                data-testid="device-approve"
                :disabled="confirmation !== 'APPROVE' || connectedAgents.loading.value"
                @click="approve"
              >
                Approve connection
              </ion-button>
              <ion-button
                data-testid="device-deny"
                color="danger"
                fill="outline"
                :disabled="confirmation !== 'DENY' || connectedAgents.loading.value"
                @click="deny"
              >
                Deny request
              </ion-button>
            </div>
          </article>
        </section>

        <LegalDisclaimer variant="short" />
      </main>
      <FirstTouchPanel v-if="auth.isConfigured()" surface-key="settings.agent-device-connection" />
    </ion-content>
  </ion-page>
</template>

<style scoped>
.device-connect { width: min(980px, 100%); margin: 0 auto; padding: 30px 0 60px; }
header { max-width: 720px; margin-bottom: 20px; }
h1 { margin: 4px 0 10px; font-size: clamp(2rem, 5vw, 3.2rem); }
.eyebrow { color: var(--ion-color-primary); font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
.review-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin: 20px 0; }
.detail-card { border: 1px solid var(--ion-color-light-shade); border-radius: 14px; padding: 20px; background: var(--ion-card-background, #fff); }
.detail-card h2 { margin-top: 0; }
dl div { margin-bottom: 12px; }
dt { font-size: .8rem; color: var(--ion-color-medium); text-transform: uppercase; }
dd { margin: 3px 0 0; overflow-wrap: anywhere; }
.mono, code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
.authority { border-color: var(--ion-color-warning); }
.action-card { grid-column: 1 / -1; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
.message { border-radius: 8px; padding: 12px; }
.error { color: var(--ion-color-danger); background: rgba(var(--ion-color-danger-rgb), .08); }
.success { color: var(--ion-color-success-shade); background: rgba(var(--ion-color-success-rgb), .08); }
@media (max-width: 700px) {
  .review-grid { grid-template-columns: 1fr; }
  .action-card { grid-column: auto; }
}
</style>
