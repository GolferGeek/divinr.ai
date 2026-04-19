import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useAuthStore } from './auth.store';

function getBaseUrl(): string {
  if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).electronAPI) {
    const stored = localStorage.getItem('divinr_api_url');
    return stored ? `${stored}/curricula` : 'http://localhost:6100/curricula';
  }
  return '/api/curricula';
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

export interface Curriculum {
  id: string;
  club_id: string;
  name: string;
  description: string | null;
  week_count: number;
  status: 'draft' | 'active' | 'archived';
  template_source: string | null;
  created_by: string;
  created_at: string;
  enrolled_count?: number;
  modules?: CurriculumModule[];
}

export interface CurriculumModule {
  id: string;
  curriculum_id: string;
  week_number: number;
  theme: string;
  instruments: Array<{ symbol: string; instrument_id?: string }>;
  challenge_id: string | null;
  poll_id: string | null;
  journal_prompt: string | null;
  tournament_id: string | null;
  created_at: string;
}

export interface CurriculumEnrollment {
  id: string;
  curriculum_id: string;
  user_id: string;
  current_week: number;
  completion_pct: number;
  enrolled_at: string;
}

export interface CurriculumModuleProgress {
  id: string;
  enrollment_id: string;
  module_id: string;
  challenge_completed: boolean;
  poll_completed: boolean;
  journal_completed: boolean;
  tournament_completed: boolean;
  score: number | null;
  completed_at: string | null;
  week_number?: number;
  theme?: string;
}

export interface CurriculumTemplate {
  slug: string;
  name: string;
  description: string;
  week_count: number;
}

export const useCurriculumStore = defineStore('curriculum', () => {
  const curricula = ref<Curriculum[]>([]);
  const activeCurriculum = ref<Curriculum | null>(null);
  const templates = ref<CurriculumTemplate[]>([]);
  const enrollment = ref<CurriculumEnrollment | null>(null);
  const moduleProgress = ref<CurriculumModuleProgress[]>([]);
  const dashboard = ref<{
    curriculum: Curriculum;
    students: Array<{
      user_id: string;
      display_name: string | null;
      enrollment: CurriculumEnrollment;
      module_progress: CurriculumModuleProgress[];
    }>;
  } | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchCurricula(clubId: string) {
    loading.value = true;
    error.value = null;
    try { curricula.value = await request<Curriculum[]>(`?club_id=${clubId}`); }
    catch (e) { error.value = e instanceof Error ? e.message : String(e); }
    finally { loading.value = false; }
  }

  async function fetchCurriculum(id: string) {
    loading.value = true;
    error.value = null;
    try { activeCurriculum.value = await request<Curriculum>(`/${id}`); }
    catch (e) { error.value = e instanceof Error ? e.message : String(e); }
    finally { loading.value = false; }
  }

  async function createCurriculum(input: { club_id: string; name: string; description?: string; week_count: number }) {
    const result = await request<Curriculum>('', { method: 'POST', body: JSON.stringify(input) });
    curricula.value.unshift(result);
    return result;
  }

  async function updateCurriculum(id: string, input: { name?: string; description?: string; status?: string }) {
    const result = await request<Curriculum>(`/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
    activeCurriculum.value = { ...activeCurriculum.value, ...result } as Curriculum;
    return result;
  }

  async function deleteCurriculum(id: string) {
    await request(`/${id}`, { method: 'DELETE' });
    curricula.value = curricula.value.filter(c => c.id !== id);
  }

  async function updateModule(curriculumId: string, weekNumber: number, input: Record<string, unknown>) {
    const result = await request<CurriculumModule>(`/${curriculumId}/modules/${weekNumber}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
    if (activeCurriculum.value?.modules) {
      const idx = activeCurriculum.value.modules.findIndex(m => m.week_number === weekNumber);
      if (idx >= 0) activeCurriculum.value.modules[idx] = result;
    }
    return result;
  }

  async function fetchTemplates() {
    loading.value = true;
    try { templates.value = await request<CurriculumTemplate[]>('/templates'); }
    catch (e) { error.value = e instanceof Error ? e.message : String(e); }
    finally { loading.value = false; }
  }

  async function createFromTemplate(clubId: string, templateSlug: string) {
    const result = await request<Curriculum>('/from-template', {
      method: 'POST',
      body: JSON.stringify({ club_id: clubId, template_slug: templateSlug }),
    });
    curricula.value.unshift(result);
    return result;
  }

  async function enroll(id: string) {
    const result = await request<CurriculumEnrollment>(`/${id}/enroll`, { method: 'POST' });
    enrollment.value = result;
    return result;
  }

  async function fetchProgress(id: string) {
    loading.value = true;
    try {
      const result = await request<{ enrollment: CurriculumEnrollment; module_progress: CurriculumModuleProgress[] }>(`/${id}/progress`);
      enrollment.value = result.enrollment;
      moduleProgress.value = result.module_progress;
      return result;
    } catch {
      enrollment.value = null;
      moduleProgress.value = [];
    } finally {
      loading.value = false;
    }
  }

  async function completeActivity(id: string, weekNumber: number, activity: string) {
    const result = await request<CurriculumModuleProgress>(`/${id}/modules/${weekNumber}/complete-activity`, {
      method: 'POST',
      body: JSON.stringify({ activity }),
    });
    const idx = moduleProgress.value.findIndex(p => p.module_id === result.module_id);
    if (idx >= 0) moduleProgress.value[idx] = result;
    else moduleProgress.value.push(result);
    return result;
  }

  async function fetchDashboard(id: string) {
    loading.value = true;
    error.value = null;
    try {
      dashboard.value = await request(`/${id}/dashboard`);
    } catch (e) { error.value = e instanceof Error ? e.message : String(e); }
    finally { loading.value = false; }
  }

  async function fetchStudentDetail(id: string, userId: string) {
    return request(`/${id}/dashboard/${userId}`);
  }

  return {
    curricula, activeCurriculum, templates, enrollment, moduleProgress, dashboard, loading, error,
    fetchCurricula, fetchCurriculum, createCurriculum, updateCurriculum, deleteCurriculum,
    updateModule, fetchTemplates, createFromTemplate,
    enroll, fetchProgress, completeActivity,
    fetchDashboard, fetchStudentDetail,
  };
});
