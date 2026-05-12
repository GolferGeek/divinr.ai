import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useApi } from '../composables/useApi';

export type DashboardPriorityMode = 'balanced' | 'portfolio_first' | 'tournaments_first';

export interface AnalysisPreferences {
  followed_analyst_ids: string[];
  watched_instrument_ids: string[];
  muted_instrument_ids: string[];
  priority_mode: DashboardPriorityMode;
}

const DEFAULT_PREFERENCES: AnalysisPreferences = {
  followed_analyst_ids: [],
  watched_instrument_ids: [],
  muted_instrument_ids: [],
  priority_mode: 'balanced',
};

export const useAnalysisPreferencesStore = defineStore('analysisPreferences', () => {
  const preferences = ref<AnalysisPreferences>({ ...DEFAULT_PREFERENCES });
  const loading = ref(false);
  const saving = ref(false);
  const error = ref<string | null>(null);

  async function fetch() {
    const api = useApi();
    loading.value = true;
    error.value = null;
    try {
      preferences.value = await api.get<AnalysisPreferences>('/preferences/analysis');
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function save(next: AnalysisPreferences) {
    const api = useApi();
    saving.value = true;
    error.value = null;
    try {
      preferences.value = await api.put<AnalysisPreferences>('/preferences/analysis', next);
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      saving.value = false;
    }
  }

  return { preferences, loading, saving, error, fetch, save };
});
