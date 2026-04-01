import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useApi } from '../composables/useApi';

export const useRiskStore = defineStore('risk', () => {
  const dimensions = ref<Record<string, unknown>[]>([]);
  const assessments = ref<Record<string, unknown>[]>([]);
  const loading = ref(false);

  async function fetchDimensions() {
    const api = useApi();
    dimensions.value = await api.get<Record<string, unknown>[]>('/risk-dimensions');
  }

  async function fetchAssessments(opts?: { role?: string }) {
    const api = useApi();
    loading.value = true;
    try {
      const qs = opts?.role ? `?role=${opts.role}` : '';
      assessments.value = await api.get<Record<string, unknown>[]>(`/risk-assessments${qs}`);
    } finally {
      loading.value = false;
    }
  }

  async function getCompositeScore(instrumentId: string) {
    const api = useApi();
    return api.get<Record<string, unknown>>(`/instruments/${instrumentId}/composite-score`);
  }

  async function getRunRiskDetails(runId: string) {
    const api = useApi();
    return api.get<Record<string, unknown>>(`/runs/${runId}/risk-details`);
  }

  return { dimensions, assessments, loading, fetchDimensions, fetchAssessments, getCompositeScore, getRunRiskDetails };
});
