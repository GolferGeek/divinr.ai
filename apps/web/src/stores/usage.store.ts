import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useApi } from '../composables/useApi';

export interface UsageSummary {
  total_calls: number;
  total_tokens_in: number;
  total_tokens_out: number;
  total_cost_cents: number;
}

export interface ByUserRow extends UsageSummary {
  billed_user_id: string;
  year_month: string;
}

export interface ByStageRow extends UsageSummary {
  stage: string;
  sub_stage: string | null;
  date: string;
}

export interface ByModelRow extends UsageSummary {
  model: string;
  provider: string;
  date: string;
}

export interface BaseVsExtensionRow extends UsageSummary {
  date: string;
  is_base: boolean;
}

export interface CalibrationRow {
  model: string;
  provider: string;
  last_calibrated_at: string;
  samples_count: number;
  rolling_avg_cost_cents_per_call: number | null;
  rolling_avg_tokens_in: number;
  rolling_avg_tokens_out: number;
  rolling_avg_latency_ms: number;
  per_million_tokens_in_usd: number | null;
  per_million_tokens_out_usd: number | null;
  drift_pct: number | null;
}

export interface DriftAlert {
  id: string;
  model: string;
  provider: string;
  detected_at: string;
  previous_avg_cost_cents_per_call: number;
  new_avg_cost_cents_per_call: number;
  drift_pct: number;
  threshold_pct: number;
  samples_count: number;
  acknowledged_at: string | null;
}

export interface DefensibilityRow {
  itemKind: string;
  avgMonthlyCostCents: number;
  currentMonthlyFeeCents: number;
  marginPct: number;
  underPricedCount: number;
  overPricedCount: number;
}

export interface ExperimentSummary {
  id: string;
  created_at: string;
  created_by_user_id: string;
  name: string;
  stage: string;
  status: 'pending' | 'running' | 'complete' | 'failed';
  runs_count: number;
}

export interface ExperimentRunDetail {
  id: string;
  provider: string;
  model: string;
  started_at: string;
  completed_at: string | null;
  cost_cents: number | null;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  output_text: string | null;
  output_hash: string | null;
  error: string | null;
  usage_log_id: string | null;
}

export interface ExperimentDetail {
  experiment: ExperimentSummary & { input_payload: unknown; models: Array<{ provider: string; model: string }>; notes: string | null };
  runs: ExperimentRunDetail[];
}

export const useUsageStore = defineStore('usage', () => {
  const summary = ref<UsageSummary>({ total_calls: 0, total_tokens_in: 0, total_tokens_out: 0, total_cost_cents: 0 });
  const byUser = ref<ByUserRow[]>([]);
  const byStage = ref<ByStageRow[]>([]);
  const byModel = ref<ByModelRow[]>([]);
  const baseVsExtension = ref<BaseVsExtensionRow[]>([]);
  const myUsage = ref<UsageSummary>({ total_calls: 0, total_tokens_in: 0, total_tokens_out: 0, total_cost_cents: 0 });
  const calibration = ref<CalibrationRow[]>([]);
  const driftAlerts = ref<DriftAlert[]>([]);
  const defensibility = ref<DefensibilityRow[]>([]);
  const experiments = ref<ExperimentSummary[]>([]);
  const experimentDetail = ref<ExperimentDetail | null>(null);
  const loading = ref(false);

  async function fetchSummary(startDate: string, endDate: string) {
    const api = useApi();
    loading.value = true;
    try {
      const data = await api.get(`/usage/summary?startDate=${startDate}&endDate=${endDate}`) as UsageSummary;
      summary.value = data;
    } catch { /* admin endpoint may fail for non-admin */ }
    loading.value = false;
  }

  async function fetchByUser(startDate: string, endDate: string) {
    const api = useApi();
    try {
      byUser.value = await api.get(`/usage/by-user?startDate=${startDate}&endDate=${endDate}`) as ByUserRow[];
    } catch { byUser.value = []; }
  }

  async function fetchByStage(startDate: string, endDate: string) {
    const api = useApi();
    try {
      byStage.value = await api.get(`/usage/by-stage?startDate=${startDate}&endDate=${endDate}`) as ByStageRow[];
    } catch { byStage.value = []; }
  }

  async function fetchByModel(startDate: string, endDate: string) {
    const api = useApi();
    try {
      byModel.value = await api.get(`/usage/by-model?startDate=${startDate}&endDate=${endDate}`) as ByModelRow[];
    } catch { byModel.value = []; }
  }

  async function fetchBaseVsExtension(startDate: string, endDate: string) {
    const api = useApi();
    try {
      baseVsExtension.value = await api.get(`/usage/base-vs-extension?startDate=${startDate}&endDate=${endDate}`) as BaseVsExtensionRow[];
    } catch { baseVsExtension.value = []; }
  }

  async function fetchMyUsage() {
    const api = useApi();
    try {
      myUsage.value = await api.get('/usage/my-usage') as UsageSummary;
    } catch { myUsage.value = { total_calls: 0, total_tokens_in: 0, total_tokens_out: 0, total_cost_cents: 0 }; }
  }

  async function fetchAll(startDate: string, endDate: string) {
    loading.value = true;
    await Promise.all([
      fetchSummary(startDate, endDate),
      fetchByUser(startDate, endDate),
      fetchByStage(startDate, endDate),
      fetchByModel(startDate, endDate),
      fetchBaseVsExtension(startDate, endDate),
    ]);
    loading.value = false;
  }

  // ─── Cost Modeling admin actions (effort: cost-modeling-system) ────────────

  async function fetchCalibration() {
    const api = useApi('/api/admin');
    try {
      calibration.value = await api.get('/cost/calibration') as CalibrationRow[];
    } catch { calibration.value = []; }
  }

  async function refreshCalibration(): Promise<{ refreshedModels: number; alertsRaised: number; skippedModels: number }> {
    const api = useApi('/api/admin');
    const res = await api.post('/cost/calibration/refresh', {}) as { refreshedModels: number; alertsRaised: number; skippedModels: number };
    await fetchCalibration();
    await fetchDriftAlerts();
    return res;
  }

  async function fetchDriftAlerts() {
    const api = useApi('/api/admin');
    try {
      driftAlerts.value = await api.get('/cost/drift-alerts') as DriftAlert[];
    } catch { driftAlerts.value = []; }
  }

  async function acknowledgeDriftAlert(id: string) {
    const api = useApi('/api/admin');
    await api.post(`/cost/drift-alerts/${id}/acknowledge`, {});
    await fetchDriftAlerts();
  }

  async function fetchDefensibility() {
    const api = useApi('/api/admin');
    try {
      defensibility.value = await api.get('/cost/defensibility') as DefensibilityRow[];
    } catch { defensibility.value = []; }
  }

  async function createExperiment(payload: {
    name: string;
    stage: string;
    inputPayload: { systemPrompt: string; userPrompt: string };
    models: Array<{ provider: string; model: string }>;
  }): Promise<{ experimentId: string; status: string }> {
    const api = useApi('/api/admin');
    return await api.post('/cost/experiments', payload) as { experimentId: string; status: string };
  }

  async function fetchExperiments() {
    const api = useApi('/api/admin');
    try {
      experiments.value = await api.get('/cost/experiments') as ExperimentSummary[];
    } catch { experiments.value = []; }
  }

  async function fetchExperimentDetail(id: string) {
    const api = useApi('/api/admin');
    try {
      experimentDetail.value = await api.get(`/cost/experiments/${id}`) as ExperimentDetail;
    } catch { experimentDetail.value = null; }
  }

  return {
    summary, byUser, byStage, byModel, baseVsExtension, myUsage, loading,
    calibration, driftAlerts, defensibility, experiments, experimentDetail,
    fetchSummary, fetchByUser, fetchByStage, fetchByModel, fetchBaseVsExtension, fetchMyUsage, fetchAll,
    fetchCalibration, refreshCalibration, fetchDriftAlerts, acknowledgeDriftAlert,
    fetchDefensibility, createExperiment, fetchExperiments, fetchExperimentDetail,
  };
});
