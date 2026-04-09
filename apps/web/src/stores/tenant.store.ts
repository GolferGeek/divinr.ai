import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useTenantStore = defineStore('tenant', () => {
  const orgSlug = ref(localStorage.getItem('divinr_org') || '');
  const userId = ref(localStorage.getItem('divinr_user') || '');
  const token = ref(localStorage.getItem('divinr_token') || '');
  const orgRole = ref(localStorage.getItem('divinr_org_role') || '');

  const isBetaReader = computed(() => orgRole.value === 'beta_reader');

  function setTenant(org: string, user: string, jwt?: string, role?: string) {
    orgSlug.value = org;
    userId.value = user;
    localStorage.setItem('divinr_org', org);
    localStorage.setItem('divinr_user', user);
    if (jwt) {
      token.value = jwt;
      localStorage.setItem('divinr_token', jwt);
    }
    if (role !== undefined) {
      orgRole.value = role;
      localStorage.setItem('divinr_org_role', role);
    }
  }

  function clear() {
    orgSlug.value = '';
    userId.value = '';
    token.value = '';
    orgRole.value = '';
    localStorage.removeItem('divinr_org');
    localStorage.removeItem('divinr_user');
    localStorage.removeItem('divinr_token');
    localStorage.removeItem('divinr_org_role');
  }

  const isConfigured = () => orgSlug.value.length > 0 && userId.value.length > 0;

  return { orgSlug, userId, token, orgRole, isBetaReader, setTenant, clear, isConfigured };
});
