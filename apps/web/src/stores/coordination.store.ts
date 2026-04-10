import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useApi } from '../composables/useApi';

export interface CorrelationRow {
  analyst_a_id: string;
  analyst_b_id: string;
  analyst_a_name: string;
  analyst_b_name: string;
  agreement_rate: number;
  sample_size: number;
  flag: string | null;
  period: string;
  instrument_id: string | null;
}

export interface CoverageRow {
  instrument_id: string;
  instrument_symbol: string;
  best_analyst_id: string | null;
  best_analyst_name: string | null;
  best_accuracy: number | null;
  analyst_count: number;
  avg_accuracy: number;
  is_gap: boolean;
  period: string;
}

export interface ContributionRow {
  analyst_id: string;
  analyst_name: string;
  composite_accuracy_with: number;
  composite_accuracy_without: number;
  marginal_contribution: number;
  prediction_count: number;
  period: string;
}

export const useCoordinationStore = defineStore('coordination', () => {
  const correlations = ref<CorrelationRow[]>([]);
  const coverage = ref<CoverageRow[]>([]);
  const contributions = ref<ContributionRow[]>([]);
  const loading = ref(false);
  const computing = ref(false);
  const selectedPeriod = ref('30d');

  async function fetchCorrelations(period: string, instrumentId?: string, flagOnly?: boolean) {
    const api = useApi();
    let path = `/coordination/correlations?period=${period}`;
    if (instrumentId) path += `&instrument_id=${instrumentId}`;
    if (flagOnly) path += '&flagOnly=true';
    correlations.value = await api.get<CorrelationRow[]>(path);
  }

  async function fetchCoverage(period: string, gapsOnly?: boolean) {
    const api = useApi();
    let path = `/coordination/coverage?period=${period}`;
    if (gapsOnly) path += '&gapsOnly=true';
    coverage.value = await api.get<CoverageRow[]>(path);
  }

  async function fetchContributions(period: string, instrumentId?: string) {
    const api = useApi();
    let path = `/coordination/contributions?period=${period}`;
    if (instrumentId) path += `&instrument_id=${instrumentId}`;
    contributions.value = await api.get<ContributionRow[]>(path);
  }

  async function fetchAll(period?: string) {
    const p = period || selectedPeriod.value;
    loading.value = true;
    try {
      await Promise.all([
        fetchCorrelations(p),
        fetchCoverage(p),
        fetchContributions(p),
      ]);
    } finally {
      loading.value = false;
    }
  }

  async function triggerCompute() {
    const api = useApi();
    computing.value = true;
    try {
      await api.post('/coordination/compute');
      await fetchAll();
    } finally {
      computing.value = false;
    }
  }

  return {
    correlations, coverage, contributions,
    loading, computing, selectedPeriod,
    fetchCorrelations, fetchCoverage, fetchContributions,
    fetchAll, triggerCompute,
  };
});
