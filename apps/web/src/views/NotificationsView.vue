<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useNotificationStore, type AppNotification } from '../stores/notification.store';
import {
  IonCard, IonCardHeader, IonCardTitle, IonCardContent,
  IonChip, IonButton, IonNote,
} from '@ionic/vue';

const store = useNotificationStore();
const router = useRouter();

onMounted(() => store.fetchNotifications());

function urgencyColor(urgency: string): string {
  switch (urgency) {
    case 'immediate': return 'danger';
    case 'actionable': return 'warning';
    case 'informational': return 'primary';
    default: return 'medium';
  }
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

async function handleClick(n: AppNotification) {
  if (!n.is_read) await store.markRead(n.id);
  router.push(n.link_to);
}

async function markAllRead() {
  await store.markAllRead();
}
</script>

<template>
  <div class="notifications-page">
    <div class="notifications-header">
      <h2>Notifications</h2>
      <ion-button
        v-if="store.notifications.length > 0 && store.unreadCount > 0"
        fill="outline"
        size="small"
        @click="markAllRead"
      >
        Mark all as read
      </ion-button>
    </div>

    <div v-if="store.loading" class="empty-state">Loading...</div>

    <div v-else-if="store.notifications.length === 0" class="empty-state">
      <p>No notifications yet.</p>
      <p class="empty-sub">Events like stop-loss triggers, trade recommendations, and evaluation results will appear here.</p>
    </div>

    <div v-else class="notification-list">
      <ion-card
        v-for="n in store.notifications"
        :key="n.id"
        class="notification-card"
        :class="{ unread: !n.is_read }"
        button
        @click="handleClick(n)"
      >
        <ion-card-header>
          <div class="notification-meta">
            <ion-chip :color="urgencyColor(n.urgency)" outline class="urgency-chip">
              {{ n.urgency }}
            </ion-chip>
            <ion-note>{{ relativeTime(n.created_at) }}</ion-note>
          </div>
          <ion-card-title class="notification-title">{{ n.title }}</ion-card-title>
        </ion-card-header>
        <ion-card-content v-if="n.summary">
          {{ n.summary }}
        </ion-card-content>
      </ion-card>
    </div>
  </div>
</template>

<style scoped>
.notifications-page {
  max-width: 700px;
  margin: 0 auto;
}

.notifications-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.notifications-header h2 {
  margin: 0;
}

.notification-card {
  cursor: pointer;
  transition: opacity 0.2s;
}

.notification-card.unread {
  border-left: 3px solid var(--ion-color-primary);
}

.notification-card:not(.unread) {
  opacity: 0.7;
}

.notification-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.urgency-chip {
  font-size: 0.7rem;
  height: 22px;
}

.notification-title {
  font-size: 1rem;
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
