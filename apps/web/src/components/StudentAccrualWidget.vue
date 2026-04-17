<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { IonCard, IonCardContent } from '@ionic/vue';
import { useBillingSummaryStore } from '../stores/billing-summary.store';
import { useAuthStore } from '../stores/auth.store';

const store = useBillingSummaryStore();
const auth = useAuthStore();

onMounted(async () => {
  if (auth.userId) await store.fetchStudentAccrual(auth.userId);
});

const visible = computed(() => store.studentAccrual?.isStudent === true);

function formatCost(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
</script>

<template>
  <IonCard v-if="visible && store.studentAccrual" style="border-left: 4px solid var(--ion-color-tertiary);">
    <IonCardContent style="padding: 12px 16px;">
      <div style="font-weight: 600; margin-bottom: 4px;">Student account — this month so far</div>
      <div style="font-size: 22px; font-weight: bold;">{{ formatCost(store.studentAccrual.withFloorCents) }}</div>
      <div style="color: var(--ion-color-medium); font-size: 13px;">
        Across {{ store.studentAccrual.breakdownByTriple.length }} triple(s) over {{ store.studentAccrual.daysIntoPeriod }} day(s).
        Projected monthly: ~{{ formatCost(store.studentAccrual.projectedMonthlyCents) }}.
        <span v-if="store.studentAccrual.withFloorCents > store.studentAccrual.rawCostCents">
          (Floor applied — raw {{ formatCost(store.studentAccrual.rawCostCents) }}.)
        </span>
      </div>
    </IonCardContent>
  </IonCard>
</template>
