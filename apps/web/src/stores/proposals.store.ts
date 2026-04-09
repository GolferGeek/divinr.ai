import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useApi } from '../composables/useApi';

export interface Proposal {
  id: string;
  tier: number;
  analyst_id: string;
  analyst_name: string;
  proposal_type: string;
  description: string;
  rationale: string;
  status: string;
  evidence_summary: {
    acceptedFindingsCount: number;
    topPatterns: Array<{ pattern: string; count: number }>;
    calibrationDelta: number;
    overrideFrequency: number;
  } | null;
  proposed_context_markdown: string | null;
  current_context_markdown: string | null;
  canonical_test_results: {
    passed: boolean;
    netScore: number;
    improvementCount: number;
    regressionCount: number;
    severityRegressionCount: number;
    reason: string;
  } | null;
  net_score: number | null;
  has_severity_regression: boolean | null;
  proposed_at: string;
  reviewed_at: string | null;
  applied_at: string | null;
}

export const useProposalsStore = defineStore('proposals', () => {
  const proposals = ref<Proposal[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchProposals(status?: string) {
    const api = useApi();
    loading.value = true;
    error.value = null;
    try {
      const statusParam = status ? `&status=${status}` : '';
      proposals.value = await api.get<Proposal[]>(`/learning/proposals?tier=3${statusParam}`);
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      loading.value = false;
    }
  }

  async function fetchProposalDetail(id: string): Promise<Proposal | null> {
    const api = useApi();
    try {
      return await api.get<Proposal>(`/learning/proposals/${id}`);
    } catch {
      return null;
    }
  }

  async function approveProposal(id: string): Promise<void> {
    const api = useApi();
    await api.post(`/learning/proposals/${id}/approve`);
    await fetchProposals();
  }

  async function rejectProposal(id: string, note?: string): Promise<void> {
    const api = useApi();
    await api.post(`/learning/proposals/${id}/reject`, note ? { reason: note } : {});
    await fetchProposals();
  }

  return {
    proposals,
    loading,
    error,
    fetchProposals,
    fetchProposalDetail,
    approveProposal,
    rejectProposal,
  };
});
