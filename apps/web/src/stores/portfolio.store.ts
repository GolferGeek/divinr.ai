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
}

export interface PortfolioDetail {
  portfolio: Record<string, unknown>;
  positions: Array<Record<string, unknown>>;
  snapshots: Array<Record<string, unknown>>;
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

  const api = useApi();

  async function fetchMyPortfolio() {
    myPortfolio.value = await api.get<Record<string, unknown>>('/portfolios/me');
  }

  async function fetchMyPositions(status?: string) {
    const qs = status ? `?status=${status}` : '';
    myPositions.value = await api.get<Record<string, unknown>[]>(`/portfolios/me/positions${qs}`);
  }

  async function fetchMyQueue() {
    myQueue.value = await api.get<Record<string, unknown>[]>('/portfolios/me/queue');
  }

  async function fetchLeaderboard() {
    leaderboard.value = await api.get<Record<string, unknown>[]>('/portfolios/leaderboard');
  }

  async function fetchAnalystPortfolios() {
    analystPortfolios.value = await api.get<Record<string, unknown>[]>('/portfolios/analysts');
  }

  async function queueTrade(input: {
    predictionId: string; instrumentId: string; symbol: string;
    direction: 'long' | 'short'; quantity: number;
  }) {
    return api.post('/portfolios/me/queue-trade', input);
  }

  async function cancelTrade(tradeId: string) {
    return api.post(`/portfolios/me/queue-trade/${tradeId}/cancel`);
  }

  async function fetchAllPortfolios() {
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
    const result = await api.post<Record<string, unknown>>('/portfolios/me/execute-trade', {
      ...input,
      organizationSlug: localStorage.getItem('divinr_org') || '',
    });
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
    const result = await api.post<Record<string, unknown>>(`/portfolios/me/positions/${positionId}/close`, {
      organizationSlug: localStorage.getItem('divinr_org') || '',
    });
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
