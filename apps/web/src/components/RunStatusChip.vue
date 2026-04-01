<script setup lang="ts">
import { IonChip } from '@ionic/vue';

defineProps<{ status: string }>();

function statusColor(status: string): string {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'running') return 'tertiary';
  return 'medium';
}
</script>

<template>
  <ion-chip :color="statusColor(status)" style="font-size:0.7rem;height:24px">{{ status }}</ion-chip>
</template>
