<script setup lang="ts">
import { onMounted } from 'vue';
import {
  IonCard, IonCardHeader, IonCardTitle, IonCardContent,
  IonButton, IonChip, IonIcon,
} from '@ionic/vue';
import { alertCircleOutline, closeOutline } from 'ionicons/icons';
import { useAffinityStore } from '../stores/affinity.store';

const affinity = useAffinityStore();

onMounted(() => affinity.fetchContrarianAlerts(true));

function directionLabel(dir: string): string {
  if (dir === 'up') return 'bullish';
  if (dir === 'down') return 'bearish';
  return 'neutral';
}

function directionColor(dir: string): string {
  if (dir === 'up') return 'success';
  if (dir === 'down') return 'danger';
  return 'medium';
}

async function dismiss(alertId: string) {
  await affinity.markAlertRead(alertId);
}
</script>

<template>
  <div v-if="affinity.alerts.filter(a => !a.is_read).length > 0" class="contrarian-alerts">
    <ion-card
      v-for="alert in affinity.alerts.filter(a => !a.is_read)"
      :key="alert.id"
      class="contrarian-card"
    >
      <ion-card-header>
        <ion-card-title style="font-size:0.9rem;display:flex;align-items:center;gap:8px">
          <ion-icon :icon="alertCircleOutline" color="warning" />
          Different perspective on {{ alert.symbol }}
          <span style="flex:1" />
          <ion-button fill="clear" size="small" @click.stop="dismiss(alert.id)">
            <ion-icon :icon="closeOutline" />
          </ion-button>
        </ion-card-title>
      </ion-card-header>
      <ion-card-content>
        <p style="font-size:0.8rem;margin-bottom:8px">
          Your analysis signals
          <ion-chip :color="directionColor(alert.user_weighted_direction)" style="height:20px;font-size:0.7rem">
            {{ directionLabel(alert.user_weighted_direction) }}
          </ion-chip>
          but
          <strong>{{ (alert as Record<string, unknown>).analyst_name ?? 'an analyst' }}</strong>
          (affinity: {{ (alert.affinity_score_at_alert * 100).toFixed(0) }})
          signals
          <ion-chip :color="directionColor(alert.contrarian_direction)" style="height:20px;font-size:0.7rem">
            {{ directionLabel(alert.contrarian_direction) }} at {{ alert.contrarian_confidence }}%
          </ion-chip>
        </p>
        <p style="font-size:0.75rem;color:#999;font-style:italic">
          "{{ alert.rationale.slice(0, 200) }}{{ alert.rationale.length > 200 ? '...' : '' }}"
        </p>
        <p style="font-size:0.65rem;color:#666;margin-top:8px">
          This is a different analytical signal to consider, not a recommendation.
        </p>
      </ion-card-content>
    </ion-card>
  </div>
</template>

<style scoped>
.contrarian-alerts {
  margin-bottom: 16px;
}
.contrarian-card {
  border-left: 3px solid var(--ion-color-warning);
}
</style>
