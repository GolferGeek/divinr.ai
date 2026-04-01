import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useApi } from '../composables/useApi';

export const usePortfolioStore = defineStore('portfolio', () => {
  const myPortfolio = ref<Record<string, unknown> | null>(null);
  const myPositions = ref<Record<string, unknown>[]>([]);
  const myQueue = ref<Record<string, unknown>[]>([]);
  const analystPortfolios = ref<Record<string, unknown>[]>([]);
  const leaderboard = ref<Record<string, unknown>[]>([]);
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

  return {
    myPortfolio, myPositions, myQueue,
    analystPortfolios, leaderboard, loading,
    fetchMyPortfolio, fetchMyPositions, fetchMyQueue,
    fetchLeaderboard, fetchAnalystPortfolios,
    queueTrade, cancelTrade,
  };
});
