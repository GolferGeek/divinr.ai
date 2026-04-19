import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useAuthStore } from './auth.store';

function getBaseUrl(): string {
  if (typeof window !== 'undefined' && (window as Record<string, unknown>).electronAPI) {
    const stored = localStorage.getItem('divinr_api_url');
    return stored ? `${stored}/clubs` : 'http://localhost:7100/clubs';
  }
  return '/api/clubs';
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
  if (!res.ok) { const text = await res.text(); throw new Error(`${res.status}: ${text}`); }
  if (res.status === 204) return undefined as T;
  return await res.json() as T;
}

// Mirror: keep apps/api/src/clubs/club.types.ts `Club` in sync with this shape.
export interface Club {
  id: string; name: string; description: string | null; invite_code: string;
  is_public: boolean; channel_id: string | null; created_at: string;
  member_count?: number; my_role?: string; tournament_count?: number;
  unread_count?: number;
}

export interface ClubMember {
  id: string; club_id: string; user_id: string; role: string;
  joined_at: string; display_name?: string;
}

export const useClubStore = defineStore('club', () => {
  const myClubs = ref<Club[]>([]);
  const publicClubs = ref<Club[]>([]);
  const activeClub = ref<Club | null>(null);
  const members = ref<ClubMember[]>([]);
  const analysts = ref<Array<{ analyst_id: string; slug: string; display_name: string }>>([]);
  const challenges = ref<unknown[]>([]);
  const polls = ref<unknown[]>([]);
  const journals = ref<unknown[]>([]);
  const analytics = ref<unknown | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchMyClubs() {
    loading.value = true;
    try { myClubs.value = await request<Club[]>(''); } catch (e) { error.value = e instanceof Error ? e.message : String(e); }
    finally { loading.value = false; }
  }

  async function fetchPublicClubs() {
    try { publicClubs.value = await request<Club[]>('/discover'); } catch (e) { error.value = e instanceof Error ? e.message : String(e); }
  }

  async function fetchClub(id: string) {
    loading.value = true;
    try { activeClub.value = await request<Club>(`/${id}`); } catch (e) { error.value = e instanceof Error ? e.message : String(e); }
    finally { loading.value = false; }
  }

  async function createClub(input: { name: string; description?: string; is_public?: boolean }) {
    const result = await request<Club>('', { method: 'POST', body: JSON.stringify(input) });
    myClubs.value.unshift(result);
    return result;
  }

  async function updateClub(id: string, input: { name?: string; description?: string; is_public?: boolean }) {
    return request<Club>(`/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
  }

  async function deleteClub(id: string) {
    await request(`/${id}`, { method: 'DELETE' });
    myClubs.value = myClubs.value.filter(c => c.id !== id);
  }

  async function joinClub(id: string, code: string) {
    return request(`/${id}/join`, { method: 'POST', body: JSON.stringify({ code }) });
  }

  async function leaveClub(id: string) {
    await request(`/${id}/leave`, { method: 'POST' });
  }

  async function fetchMembers(id: string) {
    members.value = await request<ClubMember[]>(`/${id}/members`);
  }

  async function promoteMember(id: string, userId: string) {
    await request(`/${id}/members/${userId}/promote`, { method: 'POST' });
  }

  async function demoteMember(id: string, userId: string) {
    await request(`/${id}/members/${userId}/demote`, { method: 'POST' });
  }

  async function removeMember(id: string, userId: string) {
    await request(`/${id}/members/${userId}`, { method: 'DELETE' });
  }

  async function createInvite(id: string, input?: { email?: string; username?: string }) {
    return request(`/${id}/invites`, { method: 'POST', body: JSON.stringify(input ?? {}) });
  }

  async function fetchInviteDetails(token: string) {
    return request<{ club: Club; invite: unknown; member_count: number }>(`/invite/${token}`);
  }

  async function acceptInvite(token: string) {
    return request(`/invite/${token}/accept`, { method: 'POST' });
  }

  async function createClubAnalyst(id: string, input: { slug: string; display_name: string; persona_prompt: string }) {
    return request(`/${id}/analysts`, { method: 'POST', body: JSON.stringify(input) });
  }

  async function fetchAnalysts(id: string) {
    analysts.value = await request(`/${id}/analysts`);
  }

  async function fetchChallenges(id: string) { challenges.value = await request(`/${id}/challenges`); }
  async function createChallenge(id: string, input: { instrument_id: string; symbol: string; prompt?: string }) {
    return request(`/${id}/challenges`, { method: 'POST', body: JSON.stringify(input) });
  }
  async function respondToChallenge(id: string, challengeId: string, input: { direction: string; thesis: string }) {
    return request(`/${id}/challenges/${challengeId}/respond`, { method: 'POST', body: JSON.stringify(input) });
  }
  async function revealChallenge(id: string, challengeId: string) {
    return request(`/${id}/challenges/${challengeId}/reveal`, { method: 'POST' });
  }

  async function fetchPolls(id: string) { polls.value = await request(`/${id}/polls`); }
  async function createPoll(id: string, input: { instrument_id: string; symbol: string }) {
    return request(`/${id}/polls`, { method: 'POST', body: JSON.stringify(input) });
  }
  async function vote(id: string, pollId: string, direction: string) {
    return request(`/${id}/polls/${pollId}/vote`, { method: 'POST', body: JSON.stringify({ direction }) });
  }
  async function revealPoll(id: string, pollId: string) {
    return request(`/${id}/polls/${pollId}/reveal`, { method: 'POST' });
  }

  async function fetchJournals(id: string) { journals.value = await request(`/${id}/journals`); }
  async function addJournal(id: string, input: { entry: string; symbol?: string }) {
    return request(`/${id}/journals`, { method: 'POST', body: JSON.stringify(input) });
  }

  async function markActivitiesViewed(clubId: string) {
    try { await request(`/${clubId}/activities/viewed`, { method: 'POST' }); }
    catch { /* swallow per store convention; local zeroing below is non-fatal */ }
    const card = myClubs.value.find(c => c.id === clubId);
    if (card) card.unread_count = 0;
    if (activeClub.value?.id === clubId) activeClub.value.unread_count = 0;
  }

  async function fetchAnalytics(id: string) { analytics.value = await request(`/${id}/analytics`); }
  async function fetchPostMortem(id: string, tournamentId: string) {
    return request(`/${id}/analytics/post-mortem/${tournamentId}`);
  }

  // Rankings
  const leaderboard = ref<unknown[]>([]);
  async function fetchLeaderboard(sortBy?: string, limit?: number, offset?: number) {
    const params = new URLSearchParams();
    if (sortBy) params.set('sort_by', sortBy);
    if (limit) params.set('limit', String(limit));
    if (offset) params.set('offset', String(offset));
    const query = params.toString() ? `?${params.toString()}` : '';
    leaderboard.value = await request(`/rankings/leaderboard${query}`);
  }
  async function fetchComparison(clubA: string, clubB: string) {
    return request(`/rankings/compare?club_a=${clubA}&club_b=${clubB}`);
  }
  async function fetchRankingHistory(clubId: string) {
    return request(`/rankings/${clubId}/history`);
  }

  return {
    myClubs, publicClubs, activeClub, members, analysts, challenges, polls, journals, analytics, loading, error, leaderboard,
    fetchMyClubs, fetchPublicClubs, fetchClub, createClub, updateClub, deleteClub,
    joinClub, leaveClub, fetchMembers, promoteMember, demoteMember, removeMember,
    createInvite, fetchInviteDetails, acceptInvite,
    createClubAnalyst, fetchAnalysts,
    fetchChallenges, createChallenge, respondToChallenge, revealChallenge,
    fetchPolls, createPoll, vote, revealPoll,
    fetchJournals, addJournal,
    markActivitiesViewed,
    fetchAnalytics, fetchPostMortem,
    fetchLeaderboard, fetchComparison, fetchRankingHistory,
  };
});
