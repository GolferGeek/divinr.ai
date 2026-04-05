import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useApi } from '../composables/useApi';

export const useSourcesStore = defineStore('sources', () => {
  const items = ref<Record<string, unknown>[]>([]);
  const dataAdapters = ref<Record<string, unknown>[]>([]);
  const articles = ref<Record<string, unknown>[]>([]);
  const selectedSourceId = ref<string | null>(null);
  const loading = ref(false);

  async function fetch() {
    const api = useApi();
    loading.value = true;
    try {
      items.value = await api.get<Record<string, unknown>[]>('/sources');
    } finally {
      loading.value = false;
    }
  }

  async function fetchDataAdapters() {
    const api = useApi();
    try {
      dataAdapters.value = await api.get<Record<string, unknown>[]>('/sources/data-adapters');
    } catch {
      dataAdapters.value = [];
    }
  }

  async function fetchArticles(sourceId: string) {
    const api = useApi();
    selectedSourceId.value = sourceId;
    try {
      articles.value = await api.get<Record<string, unknown>[]>(`/sources/${sourceId}/articles?limit=20`);
    } catch {
      articles.value = [];
    }
  }

  async function toggleEntitlement(sourceId: string, isEnabled: boolean) {
    const api = useApi();
    return api.post('/sources/entitlements', { sourceId, isEnabled });
  }

  return { items, dataAdapters, articles, selectedSourceId, loading, fetch, fetchDataAdapters, fetchArticles, toggleEntitlement };
});
