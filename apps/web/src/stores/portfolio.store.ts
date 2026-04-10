import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useApi } from '../composables/useApi';

export interface PortfolioSummary {
  kind: 'user' | 'analyst' | 'arbitrator' | 'day_trader';
  id: string;
  name: string;
  current_balance: number;
  realized_pnl: number;
  unrealized_pnl: number;
  win_rate: number | null;
  total_return_pct: number;
  total_bailouts: number;
  open_position_count: number;
  sharpe_30d: number | null;
  max_drawdown_30d: number | null;
  longest_win_streak: number;
  calibration_score: number | null;
  analyst_id: string | null;
}

export interface SnapshotHistoryPoint {
  date: string;
  equity: number;
  realized: number;
  unrealized: number;
  bailout_flag: boolean;
}

export interface BenchmarkPoint {
  date: string;
  spy_close: number;
}

export interface CalibrationBucket {
  bucket_min: number;
  bucket_max: number;
  predicted_avg: number;
  realized_rate: number;
  count: number;
}

export interface PortfolioDetail {
  portfolio: Record<string, unknown>;
  positions: Array<Record<string, unknown>>;
  snapshots: Array<Record<string, unknown>>;
  snapshot_history?: SnapshotHistoryPoint[];
  benchmark_series?: BenchmarkPoint[];
  calibration_buckets?: CalibrationBucket[] | null;
}

export const usePortfolioStore = defineStore('portfolio', () => {
  const myPortfolio = ref<Record<string, unknown> | null>(null);
  const myPositions = ref<Record<string, unknown>[]>([]);
  const myQueue = ref<Record<string, unknown>[]>([]);
  const analystPortfolios = ref<Record<string, unknown>[]>([]);
  const leaderboard = ref<Record<string, unknown>[]>([]);
  const allPortfolios = ref<PortfolioSummary[]>([]);
  const portfolioDetails = ref<Record<string, PortfolioDetail>>({});
  const loading = ref(false);

  async function fetchMyPortfolio() {
    const api = useApi();
    myPortfolio.value = await api.get<Record<string, unknown>>('/portfolios/me');
  }

  async function fetchMyPositions(status?: string) {
    const api = useApi();
    const qs = status ? `?status=${status}` : '';
    myPositions.value = await api.get<Record<string, unknown>[]>(`/portfolios/me/positions${qs}`);
  }

  async function fetchMyQueue() {
    const api = useApi();
    myQueue.value = await api.get<Record<string, unknown>[]>('/portfolios/me/queue');
  }

  async function fetchLeaderboard() {
    const api = useApi();
    leaderboard.value = await api.get<Record<string, unknown>[]>('/portfolios/leaderboard');
  }

  async function fetchAnalystPortfolios() {
    const api = useApi();
    analystPortfolios.value = await api.get<Record<string, unknown>[]>('/portfolios/analysts');
  }

  async function queueTrade(input: {
    predictionId: string; instrumentId: string; symbol: string;
    direction: 'long' | 'short'; quantity: number;
  }) {
    const api = useApi();
    return api.post('/portfolios/me/queue-trade', input);
  }

  async function cancelTrade(tradeId: string) {
    const api = useApi();
    return api.post(`/portfolios/me/queue-trade/${tradeId}/cancel`);
  }

  async function fetchAllPortfolios() {
    const api = useApi();
    allPortfolios.value = await api.get<PortfolioSummary[]>('/portfolios');
  }

  function detailKey(kind: string, id: string): string {
    return `${kind}:${id}`;
  }

  async function executeTrade(input: {
    predictionId: string;
    instrumentId: string;
    direction: 'long' | 'short';
    quantity: number;
  }) {
    const api = useApi();
    const result = await api.post<Record<string, unknown>>('/portfolios/me/execute-trade', input);
    // Refresh user-side caches so the new position is visible immediately.
    await Promise.all([
      fetchMyPortfolio().catch(() => {}),
      fetchMyPositions('open').catch(() => {}),
    ]);
    // Invalidate any cached user detail row so re-expand re-fetches.
    const userKey = Object.keys(portfolioDetails.value).find(k => k.startsWith('user:'));
    if (userKey) {
      const next = { ...portfolioDetails.value };
      delete next[userKey];
      portfolioDetails.value = next;
    }
    return result;
  }

  async function closePositionAction(positionId: string) {
    const api = useApi();
    const result = await api.post<Record<string, unknown>>(`/portfolios/me/positions/${positionId}/close`);
    await Promise.all([
      fetchMyPortfolio().catch(() => {}),
      fetchMyPositions('open').catch(() => {}),
    ]);
    const userKey = Object.keys(portfolioDetails.value).find(k => k.startsWith('user:'));
    if (userKey) {
      const next = { ...portfolioDetails.value };
      delete next[userKey];
      portfolioDetails.value = next;
    }
    return result;
  }

  async function fetchPortfolioDetail(kind: string, id: string) {
    const api = useApi();
    // arbitrator + day_trader rows live in analyst_portfolios; the API only
    // accepts kind ∈ {user, analyst}.
    const apiKind = kind === 'user' ? 'user' : 'analyst';
    const detail = await api.get<PortfolioDetail>(`/portfolios/${apiKind}/${id}`);
    portfolioDetails.value = { ...portfolioDetails.value, [detailKey(kind, id)]: detail };
    return detail;
  }

  return {
    myPortfolio, myPositions, myQueue,
    analystPortfolios, leaderboard, loading,
    allPortfolios, portfolioDetails,
    fetchMyPortfolio, fetchMyPositions, fetchMyQueue,
    fetchLeaderboard, fetchAnalystPortfolios,
    fetchAllPortfolios, fetchPortfolioDetail,
    queueTrade, cancelTrade,
    executeTrade, closePositionAction,
  };
});
