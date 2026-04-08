import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useTenantStore = defineStore('tenant', () => {
  const orgSlug = ref(localStorage.getItem('divinr_org') || '');
  const userId = ref(localStorage.getItem('divinr_user') || '');
  const token = ref(localStorage.getItem('divinr_token') || '');

  // Persist directly inside the mutators rather than via reactive watchers.
  // Watchers only fire on value changes, which means a re-login that lands
  // the same orgSlug/userId never triggers a localStorage write — and any
  // out-of-band localStorage.clear() (e.g. devtools, sign-out from another
  // tab) leaves the Pinia refs stale, so the next setTenant() with matching
  // values silently no-ops on the persistence layer.
  function setTenant(org: string, user: string, jwt?: string) {
    orgSlug.value = org;
    userId.value = user;
    localStorage.setItem('divinr_org', org);
    localStorage.setItem('divinr_user', user);
    if (jwt) {
      token.value = jwt;
      localStorage.setItem('divinr_token', jwt);
    }
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
