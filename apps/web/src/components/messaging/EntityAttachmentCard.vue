<script setup lang="ts">
import { useRouter } from 'vue-router';
import { IonIcon } from '@ionic/vue';
import {
  trendingUpOutline, trendingDownOutline, removeOutline,
  statsChartOutline, personOutline, briefcaseOutline, trophyOutline,
} from 'ionicons/icons';

const props = defineProps<{
  entityType: string;
  entityId: string;
  attachment?: Record<string, unknown>;
}>();

const router = useRouter();

function navigate() {
  switch (props.entityType) {
    case 'instrument':
      router.push(`/instruments/${props.entityId}`);
      break;
    case 'analyst':
      router.push(`/analysts/${props.entityId}/performance`);
      break;
    case 'prediction':
      router.push('/predictions');
      break;
    case 'position':
      router.push('/portfolios');
      break;
    case 'tournament':
      break; // No route yet
  }
}

function directionIcon(dir: string) {
  if (dir === 'up') return trendingUpOutline;
  if (dir === 'down') return trendingDownOutline;
  return removeOutline;
}

function typeIcon(type: string) {
  switch (type) {
    case 'instrument': return statsChartOutline;
    case 'analyst': return personOutline;
    case 'position': return briefcaseOutline;
    case 'tournament': return trophyOutline;
    default: return statsChartOutline;
  }
}
</script>

<template>
  <div class="attachment-card" @click="navigate">
    <div class="attachment-icon">
      <ion-icon :icon="typeIcon(entityType)" />
    </div>
    <div class="attachment-body">
      <template v-if="entityType === 'instrument' && attachment">
        <span class="attachment-title">{{ attachment.symbol }} — {{ attachment.name }}</span>
        <span class="attachment-meta">{{ attachment.asset_type }}</span>
      </template>
      <template v-else-if="entityType === 'prediction' && attachment">
        <span class="attachment-title">
          <ion-icon :icon="directionIcon(attachment.predicted_direction as string)" />
          {{ attachment.predicted_direction }} ({{ attachment.confidence }}%)
        </span>
        <span class="attachment-meta">{{ attachment.horizon_minutes }}min horizon</span>
      </template>
      <template v-else-if="entityType === 'analyst' && attachment">
        <span class="attachment-title">{{ attachment.display_name }}</span>
        <span class="attachment-meta">{{ attachment.analyst_type }} · {{ attachment.workflow_scope }}</span>
      </template>
      <template v-else-if="entityType === 'position' && attachment">
        <span class="attachment-title">{{ attachment.symbol }} · {{ attachment.direction }}</span>
        <span class="attachment-meta">Entry ${{ attachment.entry_price }} · PnL ${{ attachment.unrealized_pnl }}</span>
      </template>
      <template v-else-if="entityType === 'tournament' && attachment">
        <span class="attachment-title">{{ attachment.name }}</span>
        <span class="attachment-meta">Tournament</span>
      </template>
      <template v-else>
        <span class="attachment-title">{{ entityType }}: {{ entityId.slice(0, 8) }}...</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.attachment-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 8px;
  cursor: pointer;
  margin-top: 6px;
  transition: border-color 0.15s;
}

.attachment-card:hover {
  border-color: var(--ion-color-primary, #3880ff);
}

.attachment-icon {
  font-size: 1.2rem;
  color: var(--ion-color-primary, #3880ff);
}

.attachment-body {
  display: flex;
  flex-direction: column;
}

.attachment-title {
  font-size: 0.85rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 4px;
}

.attachment-meta {
  font-size: 0.75rem;
  color: #888;
}
</style>
