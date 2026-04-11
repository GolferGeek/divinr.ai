<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useFearGreedStore, type FearGreedAlert } from '../stores/fear-greed.store';
import {
  IonCard, IonCardHeader, IonCardTitle, IonCardContent,
  IonChip, IonButton, IonNote,
} from '@ionic/vue';

const store = useFearGreedStore();
const router = useRouter();

onMounted(() => store.fetchAlerts());

function reactionColor(reaction: string): string {
  return reaction === 'fear_trigger' ? 'danger' : 'success';
}

function reactionLabel(reaction: string): string {
  return reaction === 'fear_trigger' ? 'FEAR' : 'GREED';
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function confidencePercent(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

async function handleClick(alert: FearGreedAlert) {
  if (!alert.is_read) await store.markRead(alert.id);
  router.push(`/instruments/${alert.instrument_id}`);
}

async function markAllRead() {
  await store.markAllRead();
}
</script>

<template>
  <div class="fear-greed-page">
    <div class="fear-greed-header">
      <h2>Fear/Greed Alerts</h2>
      <ion-button
        v-if="store.alerts.length > 0 && store.unreadCount > 0"
        fill="outline"
        size="small"
        @click="markAllRead"
      >
        Mark all as read
      </ion-button>
    </div>

    <div v-if="store.loading" class="empty-state">Loading...</div>

    <div v-else-if="store.alerts.length === 0" class="empty-state">
      <p>No fear/greed alerts yet.</p>
      <p class="empty-sub">When the Sentiment Analyst detects crowd fear selling or greed buying signals, alerts will appear here.</p>
    </div>

    <div v-else class="alert-list">
      <ion-card
        v-for="alert in store.alerts"
        :key="alert.id"
        class="alert-card"
        :class="{ unread: !alert.is_read }"
        button
        @click="handleClick(alert)"
      >
        <ion-card-header>
          <div class="alert-meta">
            <ion-chip :color="reactionColor(alert.crowd_reaction)" outline class="reaction-chip">
              {{ reactionLabel(alert.crowd_reaction) }}
            </ion-chip>
            <ion-chip color="medium" outline class="symbol-chip">
              {{ alert.symbol }}
            </ion-chip>
            <span class="confidence">{{ confidencePercent(alert.crowd_reaction_confidence) }} confidence</span>
            <ion-note>{{ relativeTime(alert.created_at) }}</ion-note>
          </div>
          <ion-card-title class="alert-title">
            {{ reactionLabel(alert.crowd_reaction) }} signal: {{ alert.symbol }}
            <span v-if="alert.estimated_reaction_window_minutes" class="window-label">
               — act within ~{{ alert.estimated_reaction_window_minutes }} min
            </span>
          </ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <div v-if="alert.trade_action" class="trade-rec">
            <span class="trade-label">Sentiment Analyst signals:</span>
            <ion-chip :color="alert.trade_action === 'sell' ? 'danger' : alert.trade_action === 'buy' ? 'success' : 'medium'" class="action-chip">
              {{ alert.trade_action.toUpperCase() }}
            </ion-chip>
            <span v-if="alert.entry_price" class="trade-detail">
              Entry: ${{ alert.entry_price.toFixed(2) }}
            </span>
            <span v-if="alert.stop_loss" class="trade-detail">
              Stop: ${{ alert.stop_loss.toFixed(2) }}
            </span>
            <span v-if="alert.take_profit" class="trade-detail">
              Target: ${{ alert.take_profit.toFixed(2) }}
            </span>
          </div>
          <div v-else class="trade-rec pending">
            Analysis pending
          </div>
        </ion-card-content>
      </ion-card>
    </div>
  </div>
</template>

<style scoped>
.fear-greed-page {
  max-width: 700px;
  margin: 0 auto;
}

.fear-greed-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  flex-wrap: wrap;
  gap: 8px;
}

.fear-greed-header h2 {
  margin: 0;
}

.alert-card {
  cursor: pointer;
  transition: opacity 0.2s;
}

.alert-card.unread {
  border-left: 3px solid var(--ion-color-warning);
}

.alert-card:not(.unread) {
  opacity: 0.7;
}

.alert-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
  flex-wrap: wrap;
}

.reaction-chip, .symbol-chip {
  font-size: 0.7rem;
  height: 22px;
}

.confidence {
  font-size: 0.8rem;
  color: var(--ion-color-medium);
}

.alert-title {
  font-size: 1rem;
}

.window-label {
  font-size: 0.85rem;
  color: var(--ion-color-warning);
  font-weight: 400;
}

.trade-rec {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.trade-label {
  font-size: 0.85rem;
  color: var(--ion-color-medium);
}

.action-chip {
  font-size: 0.75rem;
  height: 24px;
  font-weight: 700;
}

.trade-detail {
  font-size: 0.85rem;
  font-family: monospace;
}

.trade-rec.pending {
  font-style: italic;
  color: var(--ion-color-medium);
}

.empty-state {
  text-align: center;
  padding: 3rem 1rem;
  color: var(--ion-color-medium);
}

.empty-sub {
  font-size: 0.85rem;
  margin-top: 0.5rem;
}
</style>
