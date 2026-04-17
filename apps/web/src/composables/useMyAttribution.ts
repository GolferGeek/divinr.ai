import { ref } from 'vue';
import { useApi } from './useApi';
import type {
  PerTripleRow,
  PerAuthorRow,
  GraduationCandidate,
} from '../stores/attribution.store';

export interface MySummaryResponse {
  currentMonth: (PerAuthorRow & { total_pnl_cents: number; avg_calibration_score: number | null }) | null;
  byItem: PerTripleRow[];
  history: PerAuthorRow[];
  topDecileItems: GraduationCandidate[];
}

export interface InstrumentTripleRow extends PerTripleRow {
  userOwned?: boolean;
}

export interface InstrumentSummaryResponse {
  base: (PerTripleRow & { totalOutcomes: number; totalPnlCents: number }) | null;
  byAuthor: InstrumentTripleRow[];
  topTriples: InstrumentTripleRow[];
}

export function useMyAttribution() {
  const summary = ref<MySummaryResponse | null>(null);
  const instrument = ref<InstrumentSummaryResponse | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchMySummary() {
    const api = useApi('/api/attribution');
    loading.value = true;
    error.value = null;
    try {
      summary.value = await api.get('/my-summary') as MySummaryResponse;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      summary.value = null;
    } finally {
      loading.value = false;
    }
  }

  async function fetchInstrument(id: string) {
    const api = useApi('/api/attribution');
    loading.value = true;
    error.value = null;
    try {
      instrument.value = await api.get(`/instrument/${encodeURIComponent(id)}`) as InstrumentSummaryResponse;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      instrument.value = null;
    } finally {
      loading.value = false;
    }
  }

  return { summary, instrument, loading, error, fetchMySummary, fetchInstrument };
}
