/**
 * Composable for checking write access in templates.
 * Effort: beta-user-share-path.
 */
import { computed } from 'vue';
import { useTenantStore } from '../stores/tenant.store';

export function useCanWrite() {
  const tenant = useTenantStore();
  const canWrite = computed(() => !tenant.isBetaReader);
  const isBetaReader = computed(() => tenant.isBetaReader);
  return { canWrite, isBetaReader };
}
