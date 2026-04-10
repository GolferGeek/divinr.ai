import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useApi } from '../composables/useApi';

export interface FearGreedAlert {
  id: string;
  user_id: string;
  predictor_id: string;
  instrument_id: string;
  symbol: string;
  crowd_reaction: 'fear_trigger' | 'greed_trigger';
  crowd_reaction_confidence: number;
  estimated_reaction_window_minutes: number | null;
  trade_action: string | null;
  entry_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  notification_id: string | null;
  is_read: boolean;
  created_at: string;
}

export const useFearGreedStore = defineStore('fearGreed', () => {
  const alerts = ref<FearGreedAlert[]>([]);
  const unreadCount = ref(0);
  const loading = ref(false);

  async function fetchAlerts(unreadOnly = false) {
    const api = useApi();
    loading.value = true;
    try {
      const query = unreadOnly ? '?unread_only=true' : '';
      const result = await api.get<{ alerts: FearGreedAlert[] }>(`/fear-greed-alerts${query}`);
      alerts.value = result.alerts;
    } catch {
      // Non-critical — silently fail
    } finally {
      loading.value = false;
    }
  }

  async function fetchUnreadCount() {
    const api = useApi();
    try {
      const result = await api.get<{ count: number }>('/fear-greed-alerts/unread-count');
      unreadCount.value = result.count;
    } catch {
      // Non-critical
    }
  }

  async function markRead(id: string) {
    const api = useApi();
    await api.patch(`/fear-greed-alerts/${id}/read`);
    const a = alerts.value.find(a => a.id === id);
    if (a && !a.is_read) {
      a.is_read = true;
      unreadCount.value = Math.max(0, unreadCount.value - 1);
    }
  }

  async function markAllRead() {
    const api = useApi();
    await api.patch('/fear-greed-alerts/read-all');
    for (const a of alerts.value) a.is_read = true;
    unreadCount.value = 0;
  }

  return {
    alerts,
    unreadCount,
    loading,
    fetchAlerts,
    fetchUnreadCount,
    markRead,
    markAllRead,
  };
});
