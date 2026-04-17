<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useEnablementStore } from '../stores/enablement.store';
import { IonChip } from '@ionic/vue';

const props = defineProps<{ instrumentId: string }>();
const route = useRoute();
const router = useRouter();
const enablement = useEnablementStore();

onMounted(() => {
  if (enablement.enabledTriples.length === 0) {
    enablement.fetchEnabledTriples();
  }
});

const variants = computed(() =>
  enablement.enabledTriples.filter((t) => t.instrumentId === props.instrumentId),
);

const showSwitcher = computed(() => variants.value.length > 1);

function isActive(analystId: string, authorUserId: string | null): boolean {
  return route.query.analystId === analystId &&
    (route.query.authorUserId ?? '') === (authorUserId ?? '');
}

function switchTo(analystId: string, authorUserId: string | null) {
  router.push({
    path: route.path,
    query: {
      analystId,
      authorUserId: authorUserId ?? '',
    },
  });
}

function label(t: { analystName: string; isAuthoredAnalyst: boolean; isAuthoredInstrument: boolean }): string {
  const tag = t.isAuthoredAnalyst || t.isAuthoredInstrument ? '(yours)' : '(base)';
  return `${t.analystName} ${tag}`;
}
</script>

<template>
  <div v-if="showSwitcher" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">
    <IonChip
      v-for="v in variants"
      :key="v.id"
      :color="isActive(v.analystId, v.authorUserId) ? 'primary' : 'medium'"
      :outline="!isActive(v.analystId, v.authorUserId)"
      style="cursor:pointer;font-size:0.78rem;height:26px"
      @click="switchTo(v.analystId, v.authorUserId)"
    >{{ label(v) }}</IonChip>
  </div>
</template>
