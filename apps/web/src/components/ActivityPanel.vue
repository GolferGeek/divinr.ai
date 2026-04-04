<script setup lang="ts">
import { watch, nextTick, ref } from 'vue';
import { IonIcon } from '@ionic/vue';
import { closeOutline, trashOutline, pulseOutline } from 'ionicons/icons';
import { useActivityStore, type ActivityEvent } from '../stores/activity.store';

const activity = useActivityStore();
const scrollContainer = ref<HTMLElement | null>(null);

// Auto-scroll to bottom when new events arrive
watch(
  () => activity.recentEvents.length,
  async () => {
    await nextTick();
    if (scrollContainer.value) {
      scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight;
    }
  },
);

function eventColor(event: ActivityEvent): string {
  const type = event.hook_event_type || '';
  if (type.includes('error') || type.includes('fail')) return '#e53935';
  if (type.startsWith('pipeline.crawler')) return '#43a047';
  if (type.startsWith('pipeline.predictor')) return '#1e88e5';
  if (type.startsWith('pipeline.prediction')) return '#8e24aa';
  if (type.startsWith('pipeline.outcome')) return '#f57c00';
  if (type.includes('risk')) return '#ff5722';
  if (type.includes('analyst')) return '#00897b';
  return '#757575';
}

function eventLabel(event: ActivityEvent): string {
  const type = event.hook_event_type || '';
  if (type.startsWith('pipeline.crawler')) return 'crawler';
  if (type.startsWith('pipeline.predictor')) return 'predictor';
  if (type.startsWith('pipeline.prediction')) return 'prediction';
  if (type.startsWith('pipeline.outcome')) return 'outcome';
  if (type.includes('risk')) return 'risk';
  if (type.includes('analyst')) return 'analyst';
  // Strip common prefixes for display
  const short = type.replace(/^(pipeline\.|markets\.orchestration\.|agent\.)/, '');
  return short || 'event';
}

function eventSummary(event: ActivityEvent): string {
  if (event.message) return event.message;
  const data = event.data || {};
  const parts: string[] = [];
  if (data.instrument) parts.push(String(data.instrument));
  if (data.symbol) parts.push(String(data.symbol));
  if (data.analyst) parts.push(String(data.analyst));
  if (data.direction) parts.push(String(data.direction));
  if (data.status) parts.push(String(data.status));
  return parts.join(' | ') || JSON.stringify(data).slice(0, 120);
}

function eventTime(event: ActivityEvent): string {
  const ts = event.timestamp || event.created_at;
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString();
}
</script>

<template>
  <Transition name="slide">
    <div v-if="activity.panelOpen" class="activity-panel">
      <div class="panel-header">
        <div class="panel-title">
          <ion-icon :icon="pulseOutline" />
          <span>Live Activity</span>
          <span class="status-dot" :class="{ connected: activity.connected }" />
        </div>
        <div class="panel-actions">
          <button class="icon-btn" title="Clear" @click="activity.clear()">
            <ion-icon :icon="trashOutline" />
          </button>
          <button class="icon-btn" title="Close" @click="activity.toggle()">
            <ion-icon :icon="closeOutline" />
          </button>
        </div>
      </div>
      <div ref="scrollContainer" class="panel-body">
        <div v-if="activity.recentEvents.length === 0" class="empty-state">
          Waiting for events...
        </div>
        <div
          v-for="(event, i) in activity.recentEvents"
          :key="i"
          class="event-row"
        >
          <span class="event-time">{{ eventTime(event) }}</span>
          <span
            class="event-badge"
            :style="{ backgroundColor: eventColor(event) }"
          >
            {{ eventLabel(event) }}
          </span>
          <span class="event-summary">{{ eventSummary(event) }}</span>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.activity-panel {
  position: fixed;
  right: 0;
  top: 0;
  bottom: 0;
  width: 420px;
  max-width: 100vw;
  background: #1a1a2e;
  color: #e0e0e0;
  display: flex;
  flex-direction: column;
  z-index: 9999;
  box-shadow: -4px 0 20px rgba(0, 0, 0, 0.3);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #16213e;
  border-bottom: 1px solid #0f3460;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 0.95rem;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #e53935;
}

.status-dot.connected {
  background: #43a047;
}

.panel-actions {
  display: flex;
  gap: 4px;
}

.icon-btn {
  background: none;
  border: none;
  color: #aaa;
  cursor: pointer;
  padding: 4px;
  font-size: 1.2rem;
  display: flex;
  align-items: center;
}

.icon-btn:hover {
  color: #fff;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 0.78rem;
  line-height: 1.6;
}

.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: #666;
  font-style: italic;
}

.event-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 3px 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.event-row:hover {
  background: rgba(255, 255, 255, 0.04);
}

.event-time {
  color: #666;
  white-space: nowrap;
  min-width: 70px;
}

.event-badge {
  color: #fff;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 0.7rem;
  white-space: nowrap;
  font-weight: 500;
}

.event-summary {
  color: #ccc;
  word-break: break-word;
}

.slide-enter-active,
.slide-leave-active {
  transition: transform 0.25s ease;
}

.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
}
</style>
