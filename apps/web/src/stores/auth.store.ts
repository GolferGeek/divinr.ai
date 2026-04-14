import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useAuthStore = defineStore('auth', () => {
  const userId = ref(localStorage.getItem('divinr_user') || '');
  const token = ref(localStorage.getItem('divinr_token') || '');
  const refreshToken = ref(localStorage.getItem('divinr_refresh_token') || '');
  const role = ref(localStorage.getItem('divinr_role') || '');
  const email = ref(localStorage.getItem('divinr_email') || '');
  const name = ref(localStorage.getItem('divinr_display_name') || '');

  let refreshPromise: Promise<boolean> | null = null;

  const isBetaReader = computed(() => role.value === 'beta_reader');
  const isAdmin = computed(() => ['super-admin', 'owner'].includes(role.value));
  const isSuperAdmin = computed(() => role.value === 'super-admin');
  const displayName = computed(() => {
    if (name.value) return name.value;
    if (email.value) return email.value.split('@')[0];
    if (userId.value.length > 12) return userId.value.slice(0, 8) + '...';
    return userId.value;
  });

  function setAuth(user: string, jwt?: string, userRole?: string, userEmail?: string, userDisplayName?: string, refresh?: string) {
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
    if (refresh) {
      refreshToken.value = refresh;
      localStorage.setItem('divinr_refresh_token', refresh);
    }
    if (userRole !== undefined) {
      role.value = userRole;
      localStorage.setItem('divinr_role', userRole);
    }
    // Clean up stale org-scoped keys from pre-migration sessions
    localStorage.removeItem('divinr_org');
    localStorage.removeItem('divinr_org_role');
  }

  /** Attempt to refresh the access token. Returns true on success. */
  async function tryRefresh(): Promise<boolean> {
    if (!refreshToken.value) return false;
    // Deduplicate concurrent refresh attempts
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      try {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: refreshToken.value }),
        });
        if (!res.ok) {
          clear();
          return false;
        }
        const data = (await res.json()) as { accessToken?: string; refreshToken?: string };
        if (data.accessToken) {
          token.value = data.accessToken;
          localStorage.setItem('divinr_token', data.accessToken);
        }
        if (data.refreshToken) {
          refreshToken.value = data.refreshToken;
          localStorage.setItem('divinr_refresh_token', data.refreshToken);
        }
        return true;
      } catch {
        return false;
      } finally {
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  }

  function clear() {
    userId.value = '';
    token.value = '';
    refreshToken.value = '';
    role.value = '';
    localStorage.removeItem('divinr_user');
    localStorage.removeItem('divinr_token');
    localStorage.removeItem('divinr_refresh_token');
    localStorage.removeItem('divinr_role');
    localStorage.removeItem('divinr_email');
    localStorage.removeItem('divinr_display_name');
    localStorage.removeItem('divinr_org');
    localStorage.removeItem('divinr_org_role');
  }

  const isConfigured = () => userId.value.length > 0;

  return { userId, token, refreshToken, role, email, isBetaReader, isAdmin, isSuperAdmin, displayName, setAuth, tryRefresh, clear, isConfigured };
});
