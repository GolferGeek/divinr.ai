/**
 * Composable for checking write access in templates.
 * Effort: beta-user-share-path.
 */
import { computed } from 'vue';
import { useAuthStore } from '../stores/auth.store';

export function useCanWrite() {
  const auth = useAuthStore();
  const canWrite = computed(() => !auth.isBetaReader);
  const isBetaReader = computed(() => auth.isBetaReader);
  return { canWrite, isBetaReader };
}
