import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { useApi } from '../composables/useApi';

export type BillingLifecycleStatus = 'trial' | 'active' | 'past_due' | 'canceled' | 'dormant' | null;

export interface BillingStatus {
  status: BillingLifecycleStatus;
  trial_ends_at: string | null;
  expired_at: string | null;
  purge_scheduled_at: string | null;
  is_read_only: boolean;
  days_until_purge: number | null;
  has_card_on_file: boolean;
  is_student: boolean;
}

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Lifecycle status for the app shell — drives TrialCountdown and ReadOnlyBanner.
 * Fetches on login / mount, then polls every 5 minutes while the app is open.
 */
export const useBillingStatusStore = defineStore('billing-status', () => {
  const status = ref<BillingLifecycleStatus>(null);
  const trialEndsAt = ref<string | null>(null);
  const expiredAt = ref<string | null>(null);
  const purgeScheduledAt = ref<string | null>(null);
  const isReadOnly = ref(false);
  const daysUntilPurge = ref<number | null>(null);
  const hasCardOnFile = ref(false);
  const isStudent = ref(false);
  const loaded = ref(false);
  const loading = ref(false);
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

  const isTrial = computed(() => status.value === 'trial');
  const isPastDue = computed(() => status.value === 'past_due');
  // Surfaced by TrialCountdown to choose the "Add a card to continue" variant
  // when a user is in trial but hasn't yet attached a payment method.
  const needsCardSetup = computed(() => isTrial.value && !hasCardOnFile.value);
  // Phase 4 gate: students must have a card BEFORE authoring (lazy subscription
  // creation needs a payment method to attach). Regular trial users author
  // freely; the trial accumulator handles them at first-card time.
  const studentNeedsCardForAuthoring = computed(() => isStudent.value && !hasCardOnFile.value);
  const daysUntilTrialEnd = computed<number | null>(() => {
    if (!trialEndsAt.value) return null;
    const diffMs = new Date(trialEndsAt.value).getTime() - Date.now();
    return Math.max(0, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
  });

  async function fetch(): Promise<void> {
    const api = useApi('/api/billing');
    loading.value = true;
    try {
      const data = await api.get<BillingStatus>('/status');
      status.value = data.status ?? null;
      trialEndsAt.value = data.trial_ends_at;
      expiredAt.value = data.expired_at;
      purgeScheduledAt.value = data.purge_scheduled_at;
      isReadOnly.value = !!data.is_read_only;
      daysUntilPurge.value = data.days_until_purge;
      hasCardOnFile.value = !!data.has_card_on_file;
      isStudent.value = !!data.is_student;
      loaded.value = true;
    } catch {
      // Non-fatal — if the endpoint is unreachable (no auth yet, API down),
      // we leave banners hidden. Polling will retry.
      loaded.value = true;
    } finally {
      loading.value = false;
    }
  }

  function startAutoRefresh(): void {
    if (refreshTimer) return;
    refreshTimer = setInterval(() => { void fetch(); }, REFRESH_INTERVAL_MS);
  }

  function stopAutoRefresh(): void {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  function clear(): void {
    status.value = null;
    trialEndsAt.value = null;
    expiredAt.value = null;
    purgeScheduledAt.value = null;
    isReadOnly.value = false;
    daysUntilPurge.value = null;
    hasCardOnFile.value = false;
    isStudent.value = false;
    loaded.value = false;
    stopAutoRefresh();
  }

  return {
    status, trialEndsAt, expiredAt, purgeScheduledAt, isReadOnly, daysUntilPurge,
    hasCardOnFile, isStudent,
    loaded, loading,
    isTrial, isPastDue, needsCardSetup, studentNeedsCardForAuthoring, daysUntilTrialEnd,
    fetch, startAutoRefresh, stopAutoRefresh, clear,
  };
});
