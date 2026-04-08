import { ref } from 'vue';
import { useTenantStore } from '../stores/tenant.store';

/**
 * Base URL for API calls.
 * - Web (dev): relative '/api/markets' (Vite proxy handles routing)
 * - Web (prod): relative '/api/markets' (Nginx proxy handles routing)
 * - Electron: configurable base URL from localStorage or window.electronAPI
 */
function getBaseUrl(): string {
  // Electron environment: use configured API URL
  if (typeof window !== 'undefined' && (window as Record<string, unknown>).electronAPI) {
    const stored = localStorage.getItem('divinr_api_url');
    return stored ? `${stored}/markets` : 'http://localhost:6100/markets';
  }
  return '/api/markets';
}

const BASE_URL = getBaseUrl();

export function useApi() {
  const loading = ref(false);
  const error = ref<string | null>(null);

  function getHeaders(): Record<string, string> {
    const tenant = useTenantStore();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (tenant.token) {
      headers['Authorization'] = `Bearer ${tenant.token}`;
    }
    // x-user-id is no longer sent — it was a dev bypass header that only worked
    // when MARKETS_DEV_AUTH_BYPASS=true. Real auth uses the bearer token above.
    if (tenant.orgSlug) {
      headers['x-org-slug'] = tenant.orgSlug;
    }
    return headers;
  }

  function appendOrg(url: string): string {
    const tenant = useTenantStore();
    if (!tenant.orgSlug) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}organizationSlug=${encodeURIComponent(tenant.orgSlug)}`;
  }

  async function get<T = unknown>(path: string): Promise<T> {
    loading.value = true;
    error.value = null;
    try {
      const res = await fetch(appendOrg(`${BASE_URL}${path}`), { headers: getHeaders() });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${res.status}: ${body}`);
      }
      return await res.json() as T;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function post<T = unknown>(path: string, body?: unknown): Promise<T> {
    loading.value = true;
    error.value = null;
    const tenant = useTenantStore();
    const payload = body && typeof body === 'object'
      ? { organizationSlug: tenant.orgSlug, ...body as Record<string, unknown> }
      : body;
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }
      return await res.json() as T;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function put<T = unknown>(path: string, body?: unknown): Promise<T> {
    loading.value = true;
    error.value = null;
    const tenant = useTenantStore();
    const payload = body && typeof body === 'object'
      ? { organizationSlug: tenant.orgSlug, ...body as Record<string, unknown> }
      : body;
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }
      return await res.json() as T;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  return { get, post, put, loading, error };
}
