import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useApi } from '../composables/useApi';

export const useInstrumentsStore = defineStore('instruments', () => {
  const items = ref<Record<string, unknown>[]>([]);
  const loading = ref(false);

  async function fetchInstruments() {
    const api = useApi();
    loading.value = true;
    try {
      items.value = await api.get<Record<string, unknown>[]>('/instruments');
    } finally {
      loading.value = false;
    }
  }

  async function create(symbol: string, name?: string) {
    const api = useApi();
    const result = await api.post('/instruments', { symbol, name: name || symbol });
    await fetchInstruments();
    return result;
  }

  return { items, loading, fetch: fetchInstruments, fetchInstruments, create };
});
