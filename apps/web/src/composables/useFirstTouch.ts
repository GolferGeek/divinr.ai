import { computed, onMounted, ref, watch } from 'vue';
import { surfaceContent } from '../onboarding/surface-content';
import { useFirstTouchStore } from '../stores/firstTouch.store';

/**
 * useFirstTouch — fires the first-touch panel exactly once for a given surface
 * per user. Safe to call from any view/component that renders a trackable UI
 * surface. If `surfaceContent[surfaceKey]` is missing, logs a warning and
 * fails soft (no panel, no crash).
 */
export function useFirstTouch(surfaceKey: string) {
  const store = useFirstTouchStore();
  const visible = ref(false);

  function evaluate(): void {
    if (!store.loaded) return;
    if (store.muted) return;
    if (store.isTouched(surfaceKey)) return;
    const content = surfaceContent[surfaceKey];
    if (!content) {
      console.warn(`[useFirstTouch] no content for surface "${surfaceKey}"`);
      return;
    }
    visible.value = true;
    void store.markTouched(surfaceKey);
  }

  onMounted(() => {
    evaluate();
    // The store may still be loading at mount (fetch kicks off in DefaultLayout).
    // Re-evaluate once it flips to loaded.
    const stop = watch(
      () => store.loaded,
      (isLoaded) => {
        if (isLoaded) {
          evaluate();
          stop();
        }
      },
    );
  });

  function dismiss(): void {
    visible.value = false;
  }

  async function muteAll(): Promise<void> {
    visible.value = false;
    await store.setMute(true);
  }

  return {
    visible,
    content: computed(() => surfaceContent[surfaceKey] ?? null),
    dismiss,
    muteAll,
  };
}
