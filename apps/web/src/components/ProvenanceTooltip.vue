<script setup lang="ts">
import { computed, ref } from 'vue';
import { IonPopover, IonContent } from '@ionic/vue';

const props = defineProps<{ position: Record<string, unknown> }>();

const open = ref(false);
const triggerId = computed(() => `prov-${String(props.position.id ?? Math.random().toString(36).slice(2))}`);

const status = computed(() => String(props.position.status ?? 'open'));
const reason = computed(() => String(props.position.trigger_reason ?? props.position.close_reason ?? 'unknown'));
const closeReason = computed(() => String(props.position.close_reason ?? ''));
const conviction = computed(() => props.position.trigger_conviction ?? props.position.conviction);
const predictionId = computed(() => props.position.trigger_prediction_id ?? props.position.prediction_id);
const entry = computed(() => Number(props.position.entry_price ?? 0));
const exit = computed(() => Number(props.position.exit_price ?? 0));
const direction = computed(() => String(props.position.direction ?? 'long'));

const pctMove = computed(() => {
  if (!entry.value || !exit.value) return null;
  const raw = ((exit.value - entry.value) / entry.value) * 100;
  return direction.value === 'long' ? raw : -raw;
});
</script>

<template>
  <span :id="triggerId" style="cursor:help;text-decoration:underline dotted" @click="open = true">
    {{ reason }}
  </span>
  <ion-popover :is-open="open" :trigger="triggerId" @did-dismiss="open = false">
    <ion-content class="ion-padding" style="font-size:0.85rem;min-width:220px">
      <div v-if="status === 'open'">
        <div><strong>Open reason:</strong> {{ reason }}</div>
        <div v-if="conviction != null"><strong>Conviction:</strong> {{ conviction }}</div>
        <div v-if="predictionId">
          <strong>Analysis:</strong>
          <a :href="`/predictions/${predictionId}`">{{ predictionId }}</a>
        </div>
        <div><strong>Entry:</strong> ${{ entry.toFixed(2) }}</div>
      </div>
      <div v-else>
        <div><strong>Close reason:</strong> {{ closeReason || reason }}</div>
        <div><strong>Entry:</strong> ${{ entry.toFixed(2) }}</div>
        <div v-if="exit"><strong>Exit:</strong> ${{ exit.toFixed(2) }}</div>
        <div v-if="pctMove != null">
          <strong>Move:</strong>
          <span :style="{ color: pctMove >= 0 ? 'var(--ion-color-success)' : 'var(--ion-color-danger)' }">
            {{ pctMove >= 0 ? '+' : '' }}{{ pctMove.toFixed(2) }}%
          </span>
        </div>
      </div>
    </ion-content>
  </ion-popover>
</template>
