import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { useApi } from '../composables/useApi';

interface FirstTouchStatePayload {
  muted: boolean;
  touched: string[];
}

/**
 * Per-user first-touch walkthrough state.
 *
 * Hydrated once at app boot from GET /api/first-touch/state. All mutations
 * apply optimistically and POST; on failure the local state is rolled back
 * and logged (first-touch is UX sugar — we never want it to block the app).
 */
export const useFirstTouchStore = defineStore('firstTouch', () => {
  const api = useApi('/api/first-touch');

  const muted = ref(false);
  const touched = ref<Set<string>>(new Set());
  const loaded = ref(false);

  const touchedArray = computed(() => Array.from(touched.value));

  function isTouched(key: string): boolean {
    return touched.value.has(key);
  }

  async function fetchState(): Promise<void> {
    try {
      const payload = await api.get<FirstTouchStatePayload>('/state');
      muted.value = !!payload.muted;
      touched.value = new Set(payload.touched ?? []);
      loaded.value = true;
    } catch (err) {
      // Stay loaded=false; panels will silently not fire. No toast.
      console.warn('[firstTouch] fetch failed', err);
    }
  }

  async function markTouched(key: string): Promise<void> {
    if (touched.value.has(key)) return;
    touched.value.add(key);
    try {
      await api.post('/touched', { surface_key: key });
    } catch (err) {
      touched.value.delete(key);
      console.warn(`[firstTouch] markTouched(${key}) failed`, err);
    }
  }

  async function setMute(nextMuted: boolean): Promise<void> {
    const prev = muted.value;
    muted.value = nextMuted;
    try {
      await api.post('/mute', { muted: nextMuted });
    } catch (err) {
      muted.value = prev;
      console.warn(`[firstTouch] setMute(${nextMuted}) failed`, err);
    }
  }

  async function resetAll(): Promise<void> {
    const prev = touched.value;
    touched.value = new Set();
    try {
      await api.post('/reset', { scope: 'all' });
    } catch (err) {
      touched.value = prev;
      console.warn('[firstTouch] resetAll failed', err);
    }
  }

  async function resetByPrefix(prefix: string): Promise<void> {
    const prev = new Set(touched.value);
    for (const key of Array.from(touched.value)) {
      if (key.startsWith(prefix)) touched.value.delete(key);
    }
    try {
      await api.post('/reset', { scope: 'prefix', prefix });
    } catch (err) {
      touched.value = prev;
      console.warn(`[firstTouch] resetByPrefix(${prefix}) failed`, err);
    }
  }

  function clear(): void {
    muted.value = false;
    touched.value = new Set();
    loaded.value = false;
  }

  return {
    muted,
    touched,
    touchedArray,
    loaded,
    isTouched,
    fetch: fetchState,
    markTouched,
    setMute,
    resetAll,
    resetByPrefix,
    clear,
  };
});
