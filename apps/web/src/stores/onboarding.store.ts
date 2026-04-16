import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { useApi } from '../composables/useApi';
import { navLocks, tourContent, matchNavRoot } from '../onboarding/tour-content';
import {
  defaultOnboardingState,
  type OnboardingState,
  type StepId,
} from '../onboarding/types';

/**
 * Onboarding tour store.
 *
 * State is DB-backed (authz.user_preferences). Every mutation round-trips via the
 * API so tour progress is durable across devices / logout / refresh.
 *
 * Local-only UI state (docentVisible, pulseTargets, lockedFlash) does NOT persist.
 */
export const useOnboardingStore = defineStore('onboarding', () => {
  const api = useApi('/api/onboarding');

  const state = ref<OnboardingState | null>(null);
  const loading = ref(false);
  const docentVisible = ref(true);
  const pulseTargets = ref<string[]>([]);
  const lockedFlash = ref<string | null>(null);
  let flashTimer: ReturnType<typeof setTimeout> | null = null;

  const active = computed(() => {
    const s = state.value;
    if (!s) return false;
    if (s.skipped) return false;
    if (s.completed_at) return false;
    return s.started_at !== null;
  });

  const currentStep = computed<StepId>(() => state.value?.current_step ?? 'welcome');
  const currentStepPath = computed(() => tourContent[currentStep.value].routePath);
  const progress = computed(() => {
    const s = state.value;
    return {
      done: s ? s.steps_completed.length : 0,
      total: 12,
    };
  });

  // Shown only before the user has either started or skipped the tour.
  const showWelcomeModal = computed(() => {
    const s = state.value;
    if (!s) return false;
    if (s.skipped) return false;
    if (s.completed_at) return false;
    return s.started_at === null;
  });

  // Shown when we've reached the 'done' step via natural completion (not skip).
  const showCompletionModal = computed(() => {
    const s = state.value;
    if (!s) return false;
    if (s.skipped) return false;
    if (s.completed_at) return false;
    return s.current_step === 'done';
  });

  function isUnlocked(navPath: string, isAdmin = false): boolean {
    const root = matchNavRoot(navPath);
    const rule = navLocks[root];
    if (!rule) return true; // unregistered paths default to unlocked
    if (rule === 'always') return true;
    if (rule === 'admin-only') return isAdmin; // only admins see these; not tour-gated
    // rule is a StepId
    if (!state.value) return false;
    if (state.value.skipped) return true;
    if (state.value.completed_at) return true;
    return state.value.steps_completed.includes(rule);
  }

  async function fetch(): Promise<void> {
    loading.value = true;
    try {
      state.value = await api.get<OnboardingState>('/state');
      syncPulseTargets();
    } finally {
      loading.value = false;
    }
  }

  async function start(): Promise<void> {
    state.value = await api.patch<OnboardingState>('/state', { action: 'start' });
    docentVisible.value = true;
    syncPulseTargets();
  }

  async function completeStep(step: StepId): Promise<void> {
    state.value = await api.patch<OnboardingState>('/state', {
      action: 'complete_step',
      step,
    });
    syncPulseTargets();
  }

  async function setStep(step: StepId): Promise<void> {
    state.value = await api.patch<OnboardingState>('/state', {
      action: 'set_current_step',
      step,
    });
    syncPulseTargets();
  }

  async function skip(): Promise<void> {
    state.value = await api.patch<OnboardingState>('/state', { action: 'skip' });
    docentVisible.value = false;
    pulseTargets.value = [];
  }

  async function restart(): Promise<void> {
    state.value = await api.patch<OnboardingState>('/state', { action: 'restart' });
    docentVisible.value = true;
    syncPulseTargets();
  }

  async function markSeen(): Promise<void> {
    state.value = await api.patch<OnboardingState>('/state', { action: 'mark_seen' });
  }

  async function resetForUser(userId: string): Promise<OnboardingState> {
    return api.post<OnboardingState>(`/reset/${encodeURIComponent(userId)}`);
  }

  /**
   * Views call this on user actions (e.g., opening an instrument detail page).
   * No-op unless the current step is action-gated on that actionKey, in which
   * case we advance the tour.
   */
  async function notifyAction(actionKey: string): Promise<void> {
    const s = state.value;
    if (!s || !active.value) return;
    const step = tourContent[s.current_step];
    if (step.completion.kind !== 'action') return;
    if (step.completion.actionKey !== actionKey) return;
    await completeStep(s.current_step);
  }

  function flashLocked(message: string, ms = 3000): void {
    lockedFlash.value = message;
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      lockedFlash.value = null;
      flashTimer = null;
    }, ms);
  }

  function openDocent(): void {
    docentVisible.value = true;
  }

  function closeDocent(): void {
    docentVisible.value = false;
  }

  function syncPulseTargets(): void {
    if (!state.value || !active.value) {
      pulseTargets.value = [];
      return;
    }
    const step = tourContent[state.value.current_step];
    pulseTargets.value = step.pulseSelectors ?? [];
  }

  function clear(): void {
    state.value = null;
    pulseTargets.value = [];
    lockedFlash.value = null;
    docentVisible.value = true;
    if (flashTimer) {
      clearTimeout(flashTimer);
      flashTimer = null;
    }
  }

  return {
    // refs / state
    state,
    loading,
    docentVisible,
    pulseTargets,
    lockedFlash,
    // computeds
    active,
    currentStep,
    currentStepPath,
    progress,
    showWelcomeModal,
    showCompletionModal,
    // getters
    isUnlocked,
    // actions
    fetch,
    start,
    completeStep,
    setStep,
    skip,
    restart,
    markSeen,
    resetForUser,
    notifyAction,
    flashLocked,
    openDocent,
    closeDocent,
    clear,
    // exposed for testing / defaults
    defaultState: defaultOnboardingState,
  };
});
