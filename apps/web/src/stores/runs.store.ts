import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useApi } from '../composables/useApi';

export const useRunsStore = defineStore('runs', () => {
  const items = ref<Record<string, unknown>[]>([]);
  const current = ref<Record<string, unknown> | null>(null);
  const loading = ref(false);

  async function fetch(status?: string) {
    const api = useApi();
    loading.value = true;
    try {
      const path = status ? `/runs?status=${status}` : '/runs';
      items.value = await api.get<Record<string, unknown>[]>(path);
    } finally {
      loading.value = false;
    }
  }

  async function getDetail(runId: string) {
    const api = useApi();
    current.value = await api.get<Record<string, unknown>>(`/runs/${runId}?detail=true`);
    return current.value;
  }

  async function enqueue(instrumentId: string, runType: 'risk' | 'prediction') {
    const api = useApi();
    return api.post('/runs', { instrumentId, runType });
  }

  async function processNext() {
    const api = useApi();
    return api.post('/runs/process-next');
  }

  return { items, current, loading, fetch, getDetail, enqueue, processNext };
});
