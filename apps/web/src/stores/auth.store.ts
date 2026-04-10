import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useAuthStore = defineStore('auth', () => {
  const userId = ref(localStorage.getItem('divinr_user') || '');
  const token = ref(localStorage.getItem('divinr_token') || '');
  const role = ref(localStorage.getItem('divinr_role') || '');

  const isBetaReader = computed(() => role.value === 'beta_reader');

  function setAuth(user: string, jwt?: string, userRole?: string) {
    userId.value = user;
    localStorage.setItem('divinr_user', user);
    if (jwt) {
      token.value = jwt;
      localStorage.setItem('divinr_token', jwt);
    }
    if (userRole !== undefined) {
      role.value = userRole;
      localStorage.setItem('divinr_role', userRole);
    }
    // Clean up stale org-scoped keys from pre-migration sessions
    localStorage.removeItem('divinr_org');
    localStorage.removeItem('divinr_org_role');
  }

  function clear() {
    userId.value = '';
    token.value = '';
    role.value = '';
    localStorage.removeItem('divinr_user');
    localStorage.removeItem('divinr_token');
    localStorage.removeItem('divinr_role');
    localStorage.removeItem('divinr_org');
    localStorage.removeItem('divinr_org_role');
  }

  const isConfigured = () => userId.value.length > 0;

  return { userId, token, role, isBetaReader, setAuth, clear, isConfigured };
});
