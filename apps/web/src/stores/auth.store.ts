import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useAuthStore = defineStore('auth', () => {
  const userId = ref(localStorage.getItem('divinr_user') || '');
  const token = ref(localStorage.getItem('divinr_token') || '');
  const role = ref(localStorage.getItem('divinr_role') || '');
  const email = ref(localStorage.getItem('divinr_email') || '');
  const name = ref(localStorage.getItem('divinr_display_name') || '');

  const isBetaReader = computed(() => role.value === 'beta_reader');
  const displayName = computed(() => {
    if (name.value) return name.value;
    if (email.value) return email.value.split('@')[0];
    if (userId.value.length > 12) return userId.value.slice(0, 8) + '...';
    return userId.value;
  });

  function setAuth(user: string, jwt?: string, userRole?: string, userEmail?: string, userDisplayName?: string) {
    userId.value = user;
    localStorage.setItem('divinr_user', user);
    if (userEmail) {
      email.value = userEmail;
      localStorage.setItem('divinr_email', userEmail);
    }
    if (userDisplayName) {
      name.value = userDisplayName;
      localStorage.setItem('divinr_display_name', userDisplayName);
    }
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
    localStorage.removeItem('divinr_email');
    localStorage.removeItem('divinr_display_name');
    localStorage.removeItem('divinr_org');
    localStorage.removeItem('divinr_org_role');
  }

  const isConfigured = () => userId.value.length > 0;

  return { userId, token, role, email, isBetaReader, displayName, setAuth, clear, isConfigured };
});
