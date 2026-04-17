import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useEnablementApi, type EnabledTriple, type AvailableTriple } from '../api/enablement';

export type { EnabledTriple, AvailableTriple };

export const useEnablementStore = defineStore('enablement', () => {
  const api = useEnablementApi();
  const enabledTriples = ref<EnabledTriple[]>([]);
  const availableTriples = ref<AvailableTriple[]>([]);
  const loading = ref(false);

  const enabledCount = computed(() => enabledTriples.value.length);

  const groupedByInstrument = computed(() => {
    const groups: Record<string, { instrumentId: string; instrumentSymbol: string; instrumentName: string; isAuthoredInstrument: boolean; triples: EnabledTriple[] }> = {};
    for (const t of enabledTriples.value) {
      const key = `${t.instrumentId}::${t.authorUserId ?? 'base'}`;
      if (!groups[key]) {
        groups[key] = {
          instrumentId: t.instrumentId,
          instrumentSymbol: t.instrumentSymbol,
          instrumentName: t.instrumentName,
          isAuthoredInstrument: t.isAuthoredInstrument,
          triples: [],
        };
      }
      groups[key].triples.push(t);
    }
    return Object.values(groups).sort((a, b) => a.instrumentSymbol.localeCompare(b.instrumentSymbol));
  });

  async function fetchEnabledTriples() {
    loading.value = true;
    try {
      enabledTriples.value = await api.fetchEnabledTriples();
    } finally {
      loading.value = false;
    }
  }

  async function fetchAvailableTriples(instrumentId?: string) {
    loading.value = true;
    try {
      availableTriples.value = await api.fetchAvailableTriples(instrumentId);
    } finally {
      loading.value = false;
    }
  }

  async function enableTriple(analystId: string, instrumentId: string, authorUserId?: string) {
    const optimistic: EnabledTriple = {
      id: `temp-${Date.now()}`,
      authorUserId: authorUserId ?? null,
      analystId,
      analystName: '',
      analystSlug: '',
      isAuthoredAnalyst: !!authorUserId,
      instrumentId,
      instrumentSymbol: '',
      instrumentName: '',
      isAuthoredInstrument: false,
      enabledAt: new Date().toISOString(),
    };
    enabledTriples.value.push(optimistic);
    try {
      const real = await api.enableTriple(analystId, instrumentId, authorUserId);
      const idx = enabledTriples.value.indexOf(optimistic);
      if (idx >= 0) enabledTriples.value.splice(idx, 1, real);
    } catch {
      const idx = enabledTriples.value.indexOf(optimistic);
      if (idx >= 0) enabledTriples.value.splice(idx, 1);
      throw new Error('Failed to enable triple');
    }
  }

  async function disableTriple(analystId: string, instrumentId: string, authorUserId?: string) {
    const idx = enabledTriples.value.findIndex(
      (t) => t.analystId === analystId && t.instrumentId === instrumentId &&
        (t.authorUserId ?? null) === (authorUserId ?? null),
    );
    const removed = idx >= 0 ? enabledTriples.value.splice(idx, 1)[0] : null;
    try {
      await api.disableTriple(analystId, instrumentId, authorUserId);
    } catch {
      if (removed && idx >= 0) enabledTriples.value.splice(idx, 0, removed);
      throw new Error('Failed to disable triple');
    }
  }

  return {
    enabledTriples,
    availableTriples,
    loading,
    enabledCount,
    groupedByInstrument,
    fetchEnabledTriples,
    fetchAvailableTriples,
    enableTriple,
    disableTriple,
  };
});
