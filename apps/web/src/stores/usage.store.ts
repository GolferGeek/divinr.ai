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

export const useUsageStore = defineStore('usage', () => {
  const summary = ref<UsageSummary>({ total_calls: 0, total_tokens_in: 0, total_tokens_out: 0, total_cost_cents: 0 });
  const byUser = ref<ByUserRow[]>([]);
  const byStage = ref<ByStageRow[]>([]);
  const byModel = ref<ByModelRow[]>([]);
  const baseVsExtension = ref<BaseVsExtensionRow[]>([]);
  const myUsage = ref<UsageSummary>({ total_calls: 0, total_tokens_in: 0, total_tokens_out: 0, total_cost_cents: 0 });
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

  return {
    summary, byUser, byStage, byModel, baseVsExtension, myUsage, loading,
    fetchSummary, fetchByUser, fetchByStage, fetchByModel, fetchBaseVsExtension, fetchMyUsage, fetchAll,
  };
});
