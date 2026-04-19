import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useAuthStore } from './auth.store';

function getBaseUrl(clubId: string): string {
  if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).electronAPI) {
    const stored = localStorage.getItem('divinr_api_url');
    return stored ? `${stored}/clubs/${clubId}/mentoring` : `http://localhost:6100/clubs/${clubId}/mentoring`;
  }
  return `/api/clubs/${clubId}/mentoring`;
}

async function request<T = unknown>(clubId: string, path: string, init?: RequestInit): Promise<T> {
  const auth = useAuthStore();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;
  const url = `${getBaseUrl(clubId)}${path}`;
  let res = await fetch(url, { ...init, headers: { ...headers, ...init?.headers } });
  if (res.status === 401) {
    const refreshed = await auth.tryRefresh();
    if (refreshed) {
      if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;
      res = await fetch(url, { ...init, headers: { ...headers, ...init?.headers } });
    }
  }
  if (!res.ok) { const text = await res.text(); throw new Error(`${res.status}: ${text}`); }
  if (res.status === 204) return undefined as T;
  return await res.json() as T;
}

export interface MentoringStatus {
  is_mentor: boolean;
  is_mentee: boolean;
  mentor_info: unknown | null;
  mentees: Array<{ mentee_user_id: string; display_name: string | null; dm_channel_id: string | null }>;
  my_mentor: { mentor_user_id: string; mentor_display_name: string | null; dm_channel_id: string | null } | null;
  pending_application: unknown | null;
  pending_request: unknown | null;
}

export interface MentorApplication {
  id: string;
  user_id: string;
  display_name: string | null;
  tournament_count: number;
  win_rate: number | null;
  avg_return_pct: number | null;
  applied_at: string;
}

export interface MenteeRequestItem {
  id: string;
  user_id: string;
  display_name: string | null;
  requested_at: string;
}

export interface LeaderboardMentor {
  mentor_id: string;
  user_id: string;
  display_name: string | null;
  mentee_count: number;
  avg_rating: number | null;
  tournament_count: number | null;
  win_rate: number | null;
}

export const useMentorStore = defineStore('mentor', () => {
  const status = ref<MentoringStatus | null>(null);
  const eligibility = ref<{ eligible: boolean; tournament_count: number; win_rate: number | null; reasons: string[] } | null>(null);
  const applications = ref<MentorApplication[]>([]);
  const requests = ref<MenteeRequestItem[]>([]);
  const leaderboard = ref<LeaderboardMentor[]>([]);
  const dashboard = ref<{ mentees: unknown[] } | null>(null);
  const myMentor = ref<{ mentor: unknown } | null>(null);
  const pendingFeedback = ref<Array<{ pairing_id: string; mentor_display_name: string | null; current_quarter: string }>>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchStatus(clubId: string) {
    loading.value = true;
    error.value = null;
    try { status.value = await request<MentoringStatus>(clubId, '/status'); }
    catch (e) { error.value = e instanceof Error ? e.message : String(e); }
    finally { loading.value = false; }
  }

  async function checkEligibility(clubId: string) {
    try { eligibility.value = await request(clubId, '/eligibility'); }
    catch (e) { error.value = e instanceof Error ? e.message : String(e); }
  }

  async function applyToMentor(clubId: string) {
    const result = await request(clubId, '/apply', { method: 'POST' });
    await fetchStatus(clubId);
    return result;
  }

  async function requestMentor(clubId: string) {
    const result = await request(clubId, '/request', { method: 'POST' });
    await fetchStatus(clubId);
    return result;
  }

  async function fetchApplications(clubId: string) {
    try { applications.value = await request<MentorApplication[]>(clubId, '/applications'); }
    catch (e) { error.value = e instanceof Error ? e.message : String(e); }
  }

  async function approveApplication(clubId: string, mentorId: string) {
    await request(clubId, `/applications/${mentorId}/approve`, { method: 'POST' });
    await fetchApplications(clubId);
  }

  async function rejectApplication(clubId: string, mentorId: string) {
    await request(clubId, `/applications/${mentorId}/reject`, { method: 'POST' });
    await fetchApplications(clubId);
  }

  async function fetchRequests(clubId: string) {
    try { requests.value = await request<MenteeRequestItem[]>(clubId, '/requests'); }
    catch (e) { error.value = e instanceof Error ? e.message : String(e); }
  }

  async function pairMentor(clubId: string, mentorId: string, menteeUserId: string) {
    const result = await request(clubId, '/pair', {
      method: 'POST',
      body: JSON.stringify({ mentor_id: mentorId, mentee_user_id: menteeUserId }),
    });
    await fetchRequests(clubId);
    return result;
  }

  async function endPairing(clubId: string, pairingId: string) {
    await request(clubId, `/pairings/${pairingId}/end`, { method: 'POST' });
    await fetchStatus(clubId);
  }

  async function fetchDashboard(clubId: string) {
    loading.value = true;
    try { dashboard.value = await request(clubId, '/mentor-dashboard'); }
    catch (e) { error.value = e instanceof Error ? e.message : String(e); }
    finally { loading.value = false; }
  }

  async function fetchMyMentor(clubId: string) {
    loading.value = true;
    try { myMentor.value = await request(clubId, '/my-mentor'); }
    catch (e) { error.value = e instanceof Error ? e.message : String(e); }
    finally { loading.value = false; }
  }

  async function fetchLeaderboard(clubId: string) {
    try { leaderboard.value = await request<LeaderboardMentor[]>(clubId, '/leaderboard'); }
    catch (e) { error.value = e instanceof Error ? e.message : String(e); }
  }

  async function fetchPendingFeedback(clubId: string) {
    try { pendingFeedback.value = await request(clubId, '/feedback/pending'); }
    catch (e) { error.value = e instanceof Error ? e.message : String(e); }
  }

  async function submitFeedback(clubId: string, pairingId: string, rating: number, comment?: string) {
    const result = await request(clubId, '/feedback', {
      method: 'POST',
      body: JSON.stringify({ pairing_id: pairingId, rating, comment }),
    });
    await fetchPendingFeedback(clubId);
    return result;
  }

  return {
    status, eligibility, applications, requests, leaderboard, dashboard, myMentor, pendingFeedback, loading, error,
    fetchStatus, checkEligibility, applyToMentor, requestMentor,
    fetchApplications, approveApplication, rejectApplication,
    fetchRequests, pairMentor, endPairing,
    fetchDashboard, fetchMyMentor, fetchLeaderboard,
    fetchPendingFeedback, submitFeedback,
  };
});
