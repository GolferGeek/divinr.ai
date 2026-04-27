import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { useMasteryApi, type MasteryProfile } from '../api/mastery';
import {
  masteryLevelRank,
  type MasteryLevel,
  MASTERY_LEVEL_ORDER,
} from '../mastery/mastery-config';
import { useAuthStore } from './auth.store';

const DEFAULT_LEVEL: MasteryLevel = 'core_trading';

export const useMasteryStore = defineStore('mastery', () => {
  const api = useMasteryApi();
  const auth = useAuthStore();

  const profile = ref<MasteryProfile | null>(null);
  const loading = ref(false);
  const loaded = ref(false);

  const currentLevel = computed<MasteryLevel>(() => profile.value?.currentLevel ?? DEFAULT_LEVEL);
  const preferredLevel = computed<MasteryLevel | null>(() => profile.value?.preferredLevel ?? null);

  // Preserve operator visibility for real admin roles even if their stored
  // learning profile has not been advanced yet.
  const effectiveLevel = computed<MasteryLevel>(() => (
    auth.isAdmin ? 'operator' : currentLevel.value
  ));

  const nextLevel = computed<MasteryLevel | null>(() => {
    const idx = MASTERY_LEVEL_ORDER.indexOf(currentLevel.value);
    if (idx < 0 || idx >= MASTERY_LEVEL_ORDER.length - 1) return null;
    return MASTERY_LEVEL_ORDER[idx + 1];
  });

  function canViewLevel(minLevel: MasteryLevel, alwaysVisible = false): boolean {
    if (alwaysVisible) return true;
    return masteryLevelRank(effectiveLevel.value) >= masteryLevelRank(minLevel);
  }

  async function fetch(): Promise<void> {
    loading.value = true;
    try {
      profile.value = await api.getProfile();
      loaded.value = true;
    } finally {
      loading.value = false;
    }
  }

  async function updatePreferredLevel(nextPreferredLevel: MasteryLevel | null): Promise<void> {
    if (nextPreferredLevel !== null && !MASTERY_LEVEL_ORDER.includes(nextPreferredLevel)) {
      throw new Error(`Invalid mastery level: ${nextPreferredLevel}`);
    }
    profile.value = await api.updateProfile({ preferredLevel: nextPreferredLevel });
    loaded.value = true;
  }

  function clear(): void {
    profile.value = null;
    loading.value = false;
    loaded.value = false;
  }

  return {
    profile,
    loading,
    loaded,
    currentLevel,
    preferredLevel,
    effectiveLevel,
    nextLevel,
    canViewLevel,
    fetch,
    updatePreferredLevel,
    clear,
  };
});
