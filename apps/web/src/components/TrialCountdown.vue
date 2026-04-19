<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { IonChip, IonIcon, IonLabel } from '@ionic/vue';
import { hourglassOutline } from 'ionicons/icons';
import { useBillingStatusStore } from '../stores/billing-status.store';
import { useFirstTouch } from '../composables/useFirstTouch';
import FirstTouchPanel from './FirstTouchPanel.vue';

const billing = useBillingStatusStore();
useFirstTouch('billing.trial-countdown');

onMounted(() => {
  if (!billing.loaded) void billing.fetch();
});

const label = computed(() => {
  const days = billing.daysUntilTrialEnd;
  if (days === null) return '';
  if (days === 0) return 'Trial ends today';
  if (days === 1) return '1 day left';
  return `${days} days left`;
});

const chipColor = computed(() => {
  const days = billing.daysUntilTrialEnd;
  if (days === null) return 'medium';
  if (days <= 3) return 'danger';
  if (days <= 7) return 'warning';
  return 'primary';
});
</script>

<template>
  <ion-chip
    v-if="billing.isTrial && billing.daysUntilTrialEnd !== null"
    :color="chipColor"
    outline
    class="trial-countdown"
    data-testid="trial-countdown"
    :aria-label="`Free trial: ${label}`"
  >
    <ion-icon :icon="hourglassOutline" />
    <ion-label>{{ label }}</ion-label>
    <FirstTouchPanel surface-key="billing.trial-countdown" />
  </ion-chip>
</template>

<style scoped>
.trial-countdown {
  font-size: 0.8rem;
}
</style>
