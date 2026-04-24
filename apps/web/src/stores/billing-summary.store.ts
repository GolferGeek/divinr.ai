import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useApi } from '../composables/useApi';

export interface PredictionResult {
  predictedMonthlyCents: number;
  confidenceRange: [number, number];
  confidence: 'low' | 'medium' | 'high';
  breakdownByStage: Array<{ key: string; costCents: number }>;
  breakdownByTriple: Array<{ key: string; costCents: number }>;
  basisDays: number;
}

export interface ConfigurationOverride {
  addTriples?: Array<{ analystId: string; instrumentId: string }>;
  removeTriples?: Array<{ analystId: string; instrumentId: string }>;
  modelOverrides?: Array<{ analystId: string; provider: string; model: string }>;
}

export interface StudentAccrual {
  rawCostCents: number;
  breakdownByTriple: Array<{ analystId: string | null; instrumentId: string | null; costCents: number }>;
  daysIntoPeriod: number;
  projectedMonthlyCents: number;
  isStudent: boolean;
}

export interface MySummary {
  yearMonth: string;
  totalCallsThisMonth: number;
  totalCostCentsThisMonth: number;
  byStage: Array<{ stage: string; subStage: string | null; costCents: number; calls: number }>;
  byTriple: Array<{ analystId: string | null; instrumentId: string | null; costCents: number; calls: number }>;
  byModel: Array<{ model: string; provider: string; costCents: number; calls: number }>;
  priorMonth: {
    yearMonth: string;
    totalCallsThisMonth: number;
    totalCostCentsThisMonth: number;
  };
}

export const useBillingSummaryStore = defineStore('billing-summary', () => {
  const mySummary = ref<MySummary | null>(null);
  const prediction = ref<PredictionResult | null>(null);
  const studentAccrual = ref<StudentAccrual | null>(null);
  const loading = ref(false);

  async function fetchMySummary(yearMonth?: string) {
    const api = useApi('/api/billing');
    loading.value = true;
    try {
      const path = yearMonth ? `/my-summary?yearMonth=${encodeURIComponent(yearMonth)}` : '/my-summary';
      mySummary.value = await api.get(path) as MySummary;
    } catch { mySummary.value = null; }
    loading.value = false;
  }

  async function predictCost(userId: string, configurationOverride?: ConfigurationOverride): Promise<PredictionResult | null> {
    const api = useApi('/api/billing');
    try {
      const result = await api.post('/predict-cost', { userId, configurationOverride }) as PredictionResult;
      prediction.value = result;
      return result;
    } catch {
      prediction.value = null;
      return null;
    }
  }

  async function fetchStudentAccrual(userId: string) {
    const api = useApi('/api/billing');
    try {
      studentAccrual.value = await api.get(`/student-accrual?userId=${encodeURIComponent(userId)}`) as StudentAccrual;
    } catch { studentAccrual.value = null; }
  }

  return {
    mySummary, prediction, studentAccrual, loading,
    fetchMySummary, predictCost, fetchStudentAccrual,
  };
});
