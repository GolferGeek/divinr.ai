import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useApi } from '../composables/useApi';

export interface PerTripleRow {
  triple_key_author: string;
  author_user_id: string | null;
  analyst_id: string;
  instrument_id: string;
  year_month: string;
  outcomes_count: number;
  hits_count: number;
  hit_rate: number | null;
  total_pnl_cents: number;
  avg_calibration_score: number | null;
  avg_confidence: number | null;
}

export interface PerAnalystRow extends Omit<PerTripleRow, 'instrument_id'> {}

export interface PerInstrumentRow {
  instrument_id: string;
  year_month: string;
  outcomes_count: number;
  hits_count: number;
  hit_rate: number | null;
  total_pnl_cents: number;
  avg_calibration_score: number | null;
  avg_confidence: number | null;
}

export interface PerSourceRow {
  source_key: string;
  year_month: string;
  predictions_contributed: number;
  total_pnl_cents: number;
  avg_pnl_per_prediction_cents: number | null;
  avg_calibration_score: number | null;
}

export interface PerAuthorRow {
  author_user_id: string;
  year_month: string;
  outcomes_count: number;
  hits_count: number;
  hit_rate: number | null;
  total_pnl_cents: number;
  avg_calibration_score: number | null;
  distinct_items_count: number;
}

export type GraduationWindow = '7d' | '30d' | '90d';

export interface GraduationCandidate {
  authorUserId: string;
  analystId: string | null;
  instrumentId: string;
  itemKind: string;
  itemId: string | null;
  predictionCount: number;
  hitsCount: number;
  pnlCents: number;
  avgCalibrationScore: number | null;
  score: number;
  window: GraduationWindow;
}

export type SliceDimension = 'triple' | 'analyst' | 'instrument' | 'source' | 'author';

export interface SliceRow {
  outcomes_count: number;
  hits_count: number;
  total_pnl_cents: number;
  avg_calibration_score: number | null;
  [dim: string]: unknown;
}

export interface AttributionFilters {
  yearMonth?: string;
  from?: string;
  to?: string;
  authorUserId?: string;
  analystId?: string;
  instrumentId?: string;
  sourceKey?: string;
  limit?: number;
  offset?: number;
}

function toQueryString(filters: AttributionFilters): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

export const useAttributionStore = defineStore('attribution', () => {
  const perTriple = ref<PerTripleRow[]>([]);
  const perAnalyst = ref<PerAnalystRow[]>([]);
  const perInstrument = ref<PerInstrumentRow[]>([]);
  const perSource = ref<PerSourceRow[]>([]);
  const perAuthor = ref<PerAuthorRow[]>([]);
  const graduationCandidates = ref<GraduationCandidate[]>([]);
  const slice = ref<{ rows: SliceRow[]; truncated: boolean }>({ rows: [], truncated: false });
  const loading = ref(false);

  async function fetchPerTriple(filters: AttributionFilters = {}) {
    const api = useApi('/api/admin');
    try {
      const res = await api.get(`/attribution/per-triple${toQueryString(filters)}`) as { rows: PerTripleRow[] };
      perTriple.value = res.rows ?? [];
    } catch { perTriple.value = []; }
  }

  async function fetchPerAnalyst(filters: AttributionFilters = {}) {
    const api = useApi('/api/admin');
    try {
      const res = await api.get(`/attribution/per-analyst${toQueryString(filters)}`) as { rows: PerAnalystRow[] };
      perAnalyst.value = res.rows ?? [];
    } catch { perAnalyst.value = []; }
  }

  async function fetchPerInstrument(filters: AttributionFilters = {}) {
    const api = useApi('/api/admin');
    try {
      const res = await api.get(`/attribution/per-instrument${toQueryString(filters)}`) as { rows: PerInstrumentRow[] };
      perInstrument.value = res.rows ?? [];
    } catch { perInstrument.value = []; }
  }

  async function fetchPerSource(filters: AttributionFilters = {}) {
    const api = useApi('/api/admin');
    try {
      const res = await api.get(`/attribution/per-source${toQueryString(filters)}`) as { rows: PerSourceRow[] };
      perSource.value = res.rows ?? [];
    } catch { perSource.value = []; }
  }

  async function fetchPerAuthor(filters: AttributionFilters = {}) {
    const api = useApi('/api/admin');
    try {
      const res = await api.get(`/attribution/per-author${toQueryString(filters)}`) as { rows: PerAuthorRow[] };
      perAuthor.value = res.rows ?? [];
    } catch { perAuthor.value = []; }
  }

  async function fetchGraduationCandidates(
    window: GraduationWindow = '30d',
    top = 50,
    minPredictions?: number,
  ) {
    const api = useApi('/api/admin');
    const params: Record<string, string> = { window, top: String(top) };
    if (minPredictions != null) params.minPredictions = String(minPredictions);
    const qs = '?' + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    try {
      const res = await api.get(`/attribution/graduation-candidates${qs}`) as { candidates: GraduationCandidate[] };
      graduationCandidates.value = res.candidates ?? [];
    } catch { graduationCandidates.value = []; }
  }

  async function fetchSlice(
    dimX: SliceDimension,
    dimY: SliceDimension,
    filters: AttributionFilters = {},
  ) {
    const api = useApi('/api/admin');
    const extra = toQueryString(filters);
    const sep = extra ? '&' : '?';
    try {
      const res = await api.get(`/attribution/slice?dimX=${dimX}&dimY=${dimY}${sep}${extra.slice(1)}`) as {
        rows: SliceRow[];
        truncated: boolean;
      };
      slice.value = { rows: res.rows ?? [], truncated: !!res.truncated };
    } catch { slice.value = { rows: [], truncated: false }; }
  }

  async function refreshViews(): Promise<{ refreshed: number; failed: string[] }> {
    const api = useApi('/api/admin');
    return await api.post('/attribution/refresh-views', {}) as { refreshed: number; failed: string[] };
  }

  return {
    perTriple, perAnalyst, perInstrument, perSource, perAuthor,
    graduationCandidates, slice, loading,
    fetchPerTriple, fetchPerAnalyst, fetchPerInstrument, fetchPerSource, fetchPerAuthor,
    fetchGraduationCandidates, fetchSlice, refreshViews,
  };
});
