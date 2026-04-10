import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useApi } from '../composables/useApi';

interface AffinityEntry {
  id: string;
  user_id: string;
  analyst_id: string;
  affinity_score: number;
  signal_count: number;
  buy_agreement: number;
  skip_disagreement: number;
  challenge_accept: number;
  challenge_reject: number;
  browse_signals: number;
  last_signal_at: string | null;
  display_name: string;
  slug: string;
}

interface ContrarianAlert {
  id: string;
  analyst_id: string;
  prediction_id: string;
  instrument_id: string;
  symbol: string;
  user_weighted_direction: string;
  contrarian_direction: string;
  contrarian_confidence: number;
  affinity_score_at_alert: number;
  rationale: string;
  is_read: boolean;
  created_at: string;
  analyst_name?: string;
  analyst_slug?: string;
}

export const useAffinityStore = defineStore('affinity', () => {
  const affinities = ref<AffinityEntry[]>([]);
  const alerts = ref<ContrarianAlert[]>([]);
  const loading = ref(false);

  const affinityMap = computed(() => {
    const map = new Map<string, AffinityEntry>();
    for (const a of affinities.value) {
      map.set(a.analyst_id, a);
    }
    return map;
  });

  const unreadAlertCount = computed(() =>
    alerts.value.filter(a => !a.is_read).length,
  );

  const hasAffinityData = computed(() =>
    affinities.value.some(a => a.signal_count >= 5),
  );

  async function fetchAffinityProfile() {
    const api = useApi();
    loading.value = true;
    try {
      const result = await api.get<{ affinities: AffinityEntry[] }>('/affinity');
      affinities.value = result.affinities;
    } finally {
      loading.value = false;
    }
  }

  async function fetchContrarianAlerts(unreadOnly = false) {
    const api = useApi();
    try {
      const query = unreadOnly ? '?unread_only=true' : '';
      const result = await api.get<{ alerts: ContrarianAlert[] }>(`/affinity/alerts${query}`);
      alerts.value = result.alerts;
    } catch {
      // Silently fail — alerts are non-critical
    }
  }

  async function markAlertRead(alertId: string) {
    const api = useApi();
    await api.patch(`/affinity/alerts/${alertId}/read`);
    const alert = alerts.value.find(a => a.id === alertId);
    if (alert) alert.is_read = true;
  }

  async function recordBrowseSignal(analystId: string) {
    const api = useApi();
    try {
      await api.post('/affinity/signals/browse', { analyst_id: analystId });
    } catch {
      // Silently fail — browse signals are non-critical
    }
  }

  /** Sort analysts by affinity score (highest first). Falls back to default order. */
  function sortByAffinity<T extends { analyst_id?: string; id?: string }>(analysts: T[]): T[] {
    if (!hasAffinityData.value) return analysts;
    return [...analysts].sort((a, b) => {
      const idA = a.analyst_id ?? (a.id as string) ?? '';
      const idB = b.analyst_id ?? (b.id as string) ?? '';
      const scoreA = affinityMap.value.get(idA)?.affinity_score ?? 0.5;
      const scoreB = affinityMap.value.get(idB)?.affinity_score ?? 0.5;
      return scoreB - scoreA;
    });
  }

  return {
    affinities,
    alerts,
    loading,
    affinityMap,
    unreadAlertCount,
    hasAffinityData,
    fetchAffinityProfile,
    fetchContrarianAlerts,
    markAlertRead,
    recordBrowseSignal,
    sortByAffinity,
  };
});
