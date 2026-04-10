import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useApi } from '../composables/useApi';

export interface AppNotification {
  id: string;
  user_id: string;
  event_type: string;
  urgency: 'immediate' | 'actionable' | 'informational';
  title: string;
  summary: string | null;
  link_to: string;
  is_read: boolean;
  created_at: string;
}

export const useNotificationStore = defineStore('notification', () => {
  const notifications = ref<AppNotification[]>([]);
  const unreadCount = ref(0);
  const loading = ref(false);

  async function fetchNotifications(unreadOnly = false) {
    const api = useApi();
    loading.value = true;
    try {
      const query = unreadOnly ? '?unread_only=true' : '';
      const result = await api.get<{ notifications: AppNotification[] }>(`/notifications${query}`);
      notifications.value = result.notifications;
    } catch {
      // Non-critical — silently fail
    } finally {
      loading.value = false;
    }
  }

  async function fetchUnreadCount() {
    const api = useApi();
    try {
      const result = await api.get<{ count: number }>('/notifications/unread-count');
      unreadCount.value = result.count;
    } catch {
      // Non-critical
    }
  }

  async function markRead(id: string) {
    const api = useApi();
    await api.patch(`/notifications/${id}/read`);
    const n = notifications.value.find(n => n.id === id);
    if (n && !n.is_read) {
      n.is_read = true;
      unreadCount.value = Math.max(0, unreadCount.value - 1);
    }
  }

  async function markAllRead() {
    const api = useApi();
    await api.patch('/notifications/read-all');
    for (const n of notifications.value) n.is_read = true;
    unreadCount.value = 0;
  }

  return {
    notifications,
    unreadCount,
    loading,
    fetchNotifications,
    fetchUnreadCount,
    markRead,
    markAllRead,
  };
});
