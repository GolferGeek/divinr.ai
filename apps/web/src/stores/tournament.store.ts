import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useAuthStore } from './auth.store';

function getBaseUrl(): string {
  if (typeof window !== 'undefined' && (window as Record<string, unknown>).electronAPI) {
    const stored = localStorage.getItem('divinr_api_url');
    return stored ? `${stored}/tournaments` : 'http://localhost:6100/tournaments';
  }
  return '/api/tournaments';
}

const BASE_URL = getBaseUrl();

async function request<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const auth = useAuthStore();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;

  let res = await fetch(`${BASE_URL}${path}`, { ...init, headers: { ...headers, ...init?.headers } });
  if (res.status === 401) {
    const refreshed = await auth.tryRefresh();
    if (refreshed) {
      if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;
      res = await fetch(`${BASE_URL}${path}`, { ...init, headers: { ...headers, ...init?.headers } });
    }
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return await res.json() as T;
}

export interface Tournament {
  id: string;
  name: string;
  description: string | null;
  scope: 'system' | 'club' | 'invitation';
  tournament_type: 'weekly_sprint' | 'sector_challenge' | 'analyst_draft';
  status: 'upcoming' | 'active' | 'completed' | 'archived';
  created_by: string;
  starting_balance: number;
  allowed_instruments: string[] | null;
  starts_at: string;
  ends_at: string;
  channel_id: string | null;
  created_at: string;
}

export interface TournamentEntry {
  id: string;
  tournament_id: string;
  user_id: string;
  portfolio_id: string;
  final_rank: number | null;
  joined_at: string;
  tournament_name?: string;
  tournament_status?: string;
  tournament_type?: string;
}

export interface LeaderboardEntry {
  rank: number;
  user_id: string;
  display_name: string | null;
  return_pct: number;
  total_pnl: number;
  win_rate: number;
  sharpe_ratio: number | null;
}

export interface TournamentPosition {
  id: string;
  symbol: string;
  direction: 'long' | 'short';
  quantity: number;
  entry_price: number | null;
  current_price: number | null;
  unrealized_pnl: number;
  realized_pnl: number;
  status: 'open' | 'closed';
}

export const useTournamentStore = defineStore('tournament', () => {
  const tournaments = ref<Tournament[]>([]);
  const activeTournament = ref<Tournament | null>(null);
  const leaderboard = ref<LeaderboardEntry[]>([]);
  const myEntries = ref<TournamentEntry[]>([]);
  const positions = ref<TournamentPosition[]>([]);
  const loading = ref(false);

  async function fetchTournaments(filters?: { scope?: string; status?: string; tournament_type?: string }) {
    loading.value = true;
    try {
      const params = new URLSearchParams();
      if (filters?.scope) params.set('scope', filters.scope);
      if (filters?.status) params.set('status', filters.status);
      if (filters?.tournament_type) params.set('tournament_type', filters.tournament_type);
      const query = params.toString() ? `?${params.toString()}` : '';
      tournaments.value = await request<Tournament[]>(query);
    } catch { /* silent */ } finally { loading.value = false; }
  }

  async function fetchTournament(id: string) {
    loading.value = true;
    try {
      activeTournament.value = await request<Tournament>(`/${id}`);
    } catch { /* silent */ } finally { loading.value = false; }
  }

  async function createTournament(input: Partial<Tournament>) {
    const result = await request<Tournament>('', { method: 'POST', body: JSON.stringify(input) });
    tournaments.value.unshift(result);
    return result;
  }

  async function enterTournament(id: string) {
    return request<TournamentEntry>(`/${id}/enter`, { method: 'POST' });
  }

  async function queueTrade(id: string, input: { symbol: string; direction: string; quantity: number }) {
    return request(`/${id}/queue-trade`, { method: 'POST', body: JSON.stringify(input) });
  }

  async function closePosition(id: string, positionId: string) {
    return request(`/${id}/positions/${positionId}/close`, { method: 'POST' });
  }

  async function fetchLeaderboard(id: string) {
    leaderboard.value = await request<LeaderboardEntry[]>(`/${id}/leaderboard`);
  }

  async function fetchResults(id: string) {
    return request(`/${id}/results`);
  }

  async function fetchMyEntries() {
    try {
      myEntries.value = await request<TournamentEntry[]>('/me');
    } catch { /* silent */ }
  }

  async function fetchPositions(id: string, status?: string) {
    const query = status ? `?status=${status}` : '';
    positions.value = await request<TournamentPosition[]>(`/${id}/positions${query}`);
  }

  async function createInvite(id: string, input?: { username?: string; email?: string }) {
    return request(`/${id}/invites`, { method: 'POST', body: JSON.stringify(input ?? {}) });
  }

  async function acceptInvite(token: string) {
    return request<TournamentEntry>(`/invite/${token}/accept`, { method: 'POST' });
  }

  async function fetchInviteDetails(token: string) {
    return request<{ tournament: Tournament; invite: unknown; entrant_count: number }>(`/invite/${token}`);
  }

  async function fetchHistory() {
    return request<Array<{ tournament_id: string; tournament_name: string; final_rank: number | null; return_pct: number }>>('/history');
  }

  return {
    tournaments, activeTournament, leaderboard, myEntries, positions, loading,
    fetchTournaments, fetchTournament, createTournament, enterTournament,
    queueTrade, closePosition, fetchLeaderboard, fetchResults, fetchMyEntries,
    fetchPositions, createInvite, acceptInvite, fetchInviteDetails, fetchHistory,
  };
});
