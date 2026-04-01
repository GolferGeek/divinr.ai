import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

export const useTenantStore = defineStore('tenant', () => {
  const orgSlug = ref(localStorage.getItem('divinr_org') || '');
  const userId = ref(localStorage.getItem('divinr_user') || '');
  const token = ref(localStorage.getItem('divinr_token') || '');

  watch(orgSlug, (v) => localStorage.setItem('divinr_org', v));
  watch(userId, (v) => localStorage.setItem('divinr_user', v));
  watch(token, (v) => localStorage.setItem('divinr_token', v));

  function setTenant(org: string, user: string, jwt?: string) {
    orgSlug.value = org;
    userId.value = user;
    if (jwt) token.value = jwt;
  }

  function clear() {
    orgSlug.value = '';
    userId.value = '';
    token.value = '';
    localStorage.removeItem('divinr_org');
    localStorage.removeItem('divinr_user');
    localStorage.removeItem('divinr_token');
  }

  const isConfigured = () => orgSlug.value.length > 0 && userId.value.length > 0;

  return { orgSlug, userId, token, setTenant, clear, isConfigured };
});
