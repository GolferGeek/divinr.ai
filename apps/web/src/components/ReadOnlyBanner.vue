<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { IonButton, IonIcon, toastController } from '@ionic/vue';
import { lockClosedOutline } from 'ionicons/icons';
import { useBillingStatusStore } from '../stores/billing-status.store';
import { useFirstTouch } from '../composables/useFirstTouch';
import { useStripeRedirect } from '../composables/useStripeRedirect';
import FirstTouchPanel from './FirstTouchPanel.vue';
import LegalDisclaimer from './LegalDisclaimer.vue';

const billing = useBillingStatusStore();
useFirstTouch('billing.read-only-banner');
const { redirectToCheckout } = useStripeRedirect();
const redirecting = ref(false);

const purgeDateText = computed(() => {
  if (!billing.purgeScheduledAt) return '';
  return new Date(billing.purgeScheduledAt).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
});

const daysRemaining = computed(() => billing.daysUntilPurge ?? null);

onMounted(() => {
  if (!billing.loaded) void billing.fetch();
});

async function addCard(): Promise<void> {
  if (redirecting.value) return;
  redirecting.value = true;
  try {
    const result = await redirectToCheckout(window.location.href);
    if (result.ok) {
      window.location.href = result.url;
      return;
    }
    const toast = await toastController.create({
      message: result.error.message,
      duration: 4000,
      color: 'warning',
      position: 'top',
    });
    await toast.present();
  } finally {
    redirecting.value = false;
  }
}
</script>

<template>
  <div
    v-if="billing.isReadOnly"
    class="read-only-banner"
    data-testid="read-only-banner"
    role="alert"
    aria-label="Subscription expired — account read-only"
  >
    <div class="banner-body">
      <div class="banner-title-row">
        <ion-icon :icon="lockClosedOutline" class="banner-icon" />
        <span class="banner-title">Your trial has ended.</span>
      </div>
      <p class="banner-copy">
        Add a card to continue accessing your data. Your account remains read-only
        <span v-if="purgeDateText">until <strong>{{ purgeDateText }}</strong></span>
        <span v-if="daysRemaining !== null"> ({{ daysRemaining }} days remaining).</span>
      </p>
      <div class="disclaimer-row">
        <LegalDisclaimer variant="short" />
      </div>
    </div>
    <ion-button size="default" color="primary" @click="addCard" class="cta">
      Add a card
    </ion-button>
    <FirstTouchPanel surface-key="billing.read-only-banner" />
  </div>
</template>

<style scoped>
.read-only-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  margin-bottom: 16px;
  border-radius: 10px;
  background: linear-gradient(90deg, rgba(235, 68, 90, 0.12) 0%, rgba(235, 68, 90, 0.04) 100%);
  border: 1px solid rgba(235, 68, 90, 0.35);
}

.banner-body {
  flex: 1;
  min-width: 0;
}

.banner-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.banner-icon {
  font-size: 1.1rem;
  color: var(--ion-color-danger, #eb445a);
}

.banner-title {
  font-weight: 700;
  font-size: 1rem;
}

.banner-copy {
  margin: 0;
  font-size: 0.9rem;
  color: var(--ion-color-medium, #666);
  line-height: 1.4;
}

.disclaimer-row {
  margin-top: 6px;
  font-size: 0.75rem;
  opacity: 0.65;
}

.cta {
  flex-shrink: 0;
  --padding-start: 18px;
  --padding-end: 18px;
  font-weight: 600;
}

@media (max-width: 600px) {
  .read-only-banner {
    flex-direction: column;
    align-items: stretch;
  }
  .cta {
    width: 100%;
  }
}
</style>
