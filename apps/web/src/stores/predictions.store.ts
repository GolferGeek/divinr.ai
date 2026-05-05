import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useApi } from '../composables/useApi';

export const usePredictionsStore = defineStore('predictions', () => {
  const items = ref<Record<string, unknown>[]>([]);
  const loading = ref(false);

  async function fetch(opts?: { role?: string; runId?: string; instrumentId?: string; limit?: number }) {
    const api = useApi();
    loading.value = true;
    try {
      const params = new URLSearchParams();
      if (opts?.role) params.set('role', opts.role);
      if (opts?.runId) params.set('runId', opts.runId);
      if (opts?.instrumentId) params.set('instrumentId', opts.instrumentId);
      if (opts?.limit) params.set('limit', String(opts.limit));
      const qs = params.toString();
      items.value = await api.get<Record<string, unknown>[]>(`/predictions${qs ? `?${qs}` : ''}`);
    } finally {
      loading.value = false;
    }
  }

  return { items, loading, fetch };
});
