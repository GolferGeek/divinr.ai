import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useApi } from '../composables/useApi';

export const useAnalystsStore = defineStore('analysts', () => {
  const items = ref<Record<string, unknown>[]>([]);
  const loading = ref(false);

  async function fetch() {
    const api = useApi();
    loading.value = true;
    try {
      items.value = await api.get<Record<string, unknown>[]>('/analysts');
    } finally {
      loading.value = false;
    }
  }

  async function create(slug: string, displayName: string, personaPrompt: string) {
    const api = useApi();
    return api.post('/analysts', { slug, displayName, personaPrompt });
  }

  async function update(analystId: string, changes: Record<string, unknown>) {
    const api = useApi();
    return api.put(`/analysts/${analystId}`, changes);
  }

  async function assign(instrumentId: string, analystId: string) {
    const api = useApi();
    return api.post('/analysts/assign', { instrumentId, analystId });
  }

  return { items, loading, fetch, create, update, assign };
});
