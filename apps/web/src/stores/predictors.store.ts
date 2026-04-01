import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useApi } from '../composables/useApi';

export const usePredictorsStore = defineStore('predictors', () => {
  const items = ref<Record<string, unknown>[]>([]);
  const loading = ref(false);

  async function fetch(instrumentId: string, status?: string) {
    const api = useApi();
    loading.value = true;
    try {
      const qs = status ? `&status=${status}` : '';
      items.value = await api.get<Record<string, unknown>[]>(`/predictors?instrumentId=${instrumentId}${qs}`);
    } finally {
      loading.value = false;
    }
  }

  async function score(instrumentId: string, articleId: string) {
    const api = useApi();
    return api.post<Record<string, unknown>>('/predictors/score', { instrumentId, articleId });
  }

  async function scoreBatch(instrumentId: string, articleIds: string[]) {
    const api = useApi();
    return api.post<Record<string, unknown>>('/predictors/score-batch', { instrumentId, articleIds });
  }

  return { items, loading, fetch, score, scoreBatch };
});
