<script setup lang="ts">
import { computed, ref } from 'vue';
import { IonCard, IonCardContent, IonButton, IonIcon } from '@ionic/vue';
import { closeOutline, trendingUpOutline } from 'ionicons/icons';
import type { GraduationCandidate } from '../stores/attribution.store';

const props = defineProps<{ items: GraduationCandidate[] }>();

const bannerEnabled = computed(
  () => import.meta.env.VITE_ATTRIBUTION_TOP_DECILE_BANNER_ENABLED !== 'false',
);
const dismissed = ref(false);

const visible = computed(
  () => bannerEnabled.value && !dismissed.value && props.items.length > 0,
);

function labelFor(item: GraduationCandidate): string {
  if (item.itemKind === 'unlinked') {
    return item.analystId
      ? `analyst ${item.analystId.slice(0, 8)} / ${item.instrumentId.slice(0, 8)}`
      : `instrument ${item.instrumentId.slice(0, 8)}`;
  }
  if (item.itemId) {
    return `${item.itemKind.replace(/_/g, ' ')} ${item.itemId.slice(0, 8)}`;
  }
  return item.itemKind.replace(/_/g, ' ');
}
</script>

<template>
  <IonCard v-if="visible" style="border-left: 4px solid var(--ion-color-success, #2dd36f);">
    <IonCardContent style="padding: 12px 16px;">
      <div style="display: flex; align-items: flex-start; gap: 12px;">
        <IonIcon :icon="trendingUpOutline" style="font-size: 24px; color: var(--ion-color-success, #2dd36f); margin-top: 2px;" />
        <div style="flex: 1;">
          <div style="font-weight: 600; margin-bottom: 4px;">Top-decile content this month</div>
          <div style="font-size: 14px; color: var(--ion-color-medium);">
            <template v-if="items.length === 1">
              Your <em>{{ labelFor(items[0]) }}</em> is in the top decile this month — graduation flow coming soon.
            </template>
            <template v-else>
              {{ items.length }} of your items are in the top decile this month — graduation flow coming soon.
            </template>
          </div>
          <div style="margin-top: 6px; font-size: 12px; color: var(--ion-color-medium); opacity: 0.8;">
            Based on paper P&amp;L and calibration — no cash earnings. Estimate only.
          </div>
        </div>
        <IonButton fill="clear" size="small" aria-label="Dismiss banner" @click="dismissed = true">
          <IonIcon slot="icon-only" :icon="closeOutline" />
        </IonButton>
      </div>
    </IonCardContent>
  </IonCard>
</template>
