import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useApi } from '../composables/useApi';

export interface PerformanceMetrics {
  portfolio_value: number;
  today_change: number;
  today_change_pct: number;
  active_positions: number;
  total_realized_pnl: number;
  total_unrealized_pnl: number;
  win_rate: number | null;
  avg_gain: number | null;
  avg_loss: number | null;
}

export interface EquityCurvePoint {
  date: string;
  balance: number;
  daily_pnl: number;
}

export interface BenchmarkPoint {
  date: string;
  close: number;
}

export interface AnalystEntry {
  analyst_id: string;
  name: string;
  accuracy_rate: number | null;
  calibration_score: number | null;
  sample_size: number;
  accuracy_7d: number | null;
  accuracy_30d: number | null;
  trend: 'improving' | 'declining' | 'stable';
}

export interface PerformanceDashboard {
  has_portfolio: boolean;
  metrics: PerformanceMetrics | null;
  equity_curve: EquityCurvePoint[];
  benchmark: BenchmarkPoint[];
  analysts: AnalystEntry[];
  next_evaluation_at: string | null;
}

export const usePerformanceStore = defineStore('performance', () => {
  const dashboard = ref<PerformanceDashboard | null>(null);
  const loading = ref(false);
  const selectedDays = ref(30);

  async function fetchDashboard(days?: number) {
    const api = useApi();
    const d = days ?? selectedDays.value;
    loading.value = true;
    try {
      dashboard.value = await api.get<PerformanceDashboard>(`/performance?days=${d}`);
    } finally {
      loading.value = false;
    }
  }

  return { dashboard, loading, selectedDays, fetchDashboard };
});
