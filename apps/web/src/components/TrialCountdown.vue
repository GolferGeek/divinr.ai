<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { IonChip, IonIcon, IonLabel, toastController } from '@ionic/vue';
import { hourglassOutline, alertCircleOutline, cardOutline } from 'ionicons/icons';
import { useBillingStatusStore } from '../stores/billing-status.store';
import { useFirstTouch } from '../composables/useFirstTouch';
import { useStripeRedirect } from '../composables/useStripeRedirect';
import FirstTouchPanel from './FirstTouchPanel.vue';

const billing = useBillingStatusStore();
useFirstTouch('billing.trial-countdown');
const { redirectToCheckout } = useStripeRedirect();
const redirecting = ref(false);

onMounted(() => {
  if (!billing.loaded) void billing.fetch();
});

// Variant precedence (status > days): past_due beats trial countdown beats
// setup_needed beats default. So a past_due user with 2 days left on the
// trial sees the past_due chip, not the days-remaining chip.
type Variant = 'past-due' | 'setup-needed' | 'trial-countdown' | 'hidden';
const variant = computed<Variant>(() => {
  if (billing.isPastDue) return 'past-due';
  if (!billing.isTrial) return 'hidden';
  if (billing.daysUntilTrialEnd === null) return 'hidden';
  if (billing.needsCardSetup) return 'setup-needed';
  return 'trial-countdown';
});

const trialLabel = computed(() => {
  const days = billing.daysUntilTrialEnd;
  if (days === null) return '';
  if (days === 0) return 'Trial ends today';
  if (days === 1) return '1 day left';
  return `${days} days left`;
});

const trialChipColor = computed(() => {
  const days = billing.daysUntilTrialEnd;
  if (days === null) return 'medium';
  if (days <= 3) return 'danger';
  if (days <= 7) return 'warning';
  return 'primary';
});

async function onAddCardClick() {
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
  <ion-chip
    v-if="variant === 'past-due'"
    color="warning"
    outline
    class="trial-countdown"
    data-testid="trial-countdown-past-due"
    button
    aria-label="Payment failed — Stripe will retry"
    @click="onAddCardClick"
  >
    <ion-icon :icon="alertCircleOutline" />
    <ion-label>Payment failed — retrying</ion-label>
    <FirstTouchPanel surface-key="billing.trial-countdown" />
  </ion-chip>
  <ion-chip
    v-else-if="variant === 'setup-needed'"
    color="primary"
    outline
    class="trial-countdown"
    data-testid="trial-countdown-setup-needed"
    button
    aria-label="Add a card to continue after trial"
    @click="onAddCardClick"
  >
    <ion-icon :icon="cardOutline" />
    <ion-label>Add a card</ion-label>
    <FirstTouchPanel surface-key="billing.trial-countdown" />
  </ion-chip>
  <ion-chip
    v-else-if="variant === 'trial-countdown'"
    :color="trialChipColor"
    outline
    class="trial-countdown"
    data-testid="trial-countdown"
    :aria-label="`Free trial: ${trialLabel}`"
  >
    <ion-icon :icon="hourglassOutline" />
    <ion-label>{{ trialLabel }}</ion-label>
    <FirstTouchPanel surface-key="billing.trial-countdown" />
  </ion-chip>
</template>

<style scoped>
.trial-countdown {
  font-size: 0.8rem;
}
</style>
