import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useApi } from '../composables/useApi';

export const useSourcesStore = defineStore('sources', () => {
  const items = ref<Record<string, unknown>[]>([]);
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

  async function toggleEntitlement(sourceId: string, isEnabled: boolean) {
    const api = useApi();
    return api.post('/sources/entitlements', { sourceId, isEnabled });
  }

  return { items, loading, fetch, toggleEntitlement };
});
