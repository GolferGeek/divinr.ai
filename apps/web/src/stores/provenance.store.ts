import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useApi } from '../composables/useApi';

export interface ProvenanceData {
  prediction: {
    id: string;
    direction: string;
    confidence: number;
    rationale: string;
    key_factors: unknown;
    risks: unknown;
    created_at: string;
  };
  analyst: { id: string; slug: string; display_name: string; persona_prompt: string };
  articles: Array<{ id: string; title: string; url: string; relevance_score: number; rationale: string; published_at: string }>;
  riskAssessment: { score: number; confidence: number; reasoning: string; evidence: unknown[] } | null;
  sourceData: Record<string, { name: string; dataTypes: string[]; charCount: number }>;
  memory: {
    patterns: Array<{ pattern: string; confidence: number; instruments?: string[] }>;
    corrections: Array<{ correction: string }>;
    instrumentNotes: Array<{ note: string }>;
    calibration: { predictions_made?: number; correct?: number };
  };
}

export const useProvenanceStore = defineStore('provenance', () => {
  const data = ref<ProvenanceData | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchProvenance(predictionId: string) {
    const api = useApi();
    loading.value = true;
    error.value = null;
    try {
      data.value = await api.get<ProvenanceData>(`/predictions/${predictionId}/provenance`);
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      data.value = null;
    } finally {
      loading.value = false;
    }
  }

  function clear() {
    data.value = null;
    error.value = null;
  }

  return { data, loading, error, fetchProvenance, clear };
});
