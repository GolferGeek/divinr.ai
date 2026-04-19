import { ref } from 'vue';
import { useAuthStore } from '../stores/auth.store';

/**
 * Base URL for API calls.
 * @param basePath – path segment appended after the host, e.g. '/api/markets'.
 *   Defaults to '/api/markets' for backward compatibility.
 * - Web (dev): relative basePath (Vite proxy handles routing)
 * - Web (prod): relative basePath (Nginx proxy handles routing)
 * - Electron: configurable base URL from localStorage or window.electronAPI
 */
function getBaseUrl(basePath: string): string {
  // Electron environment: use configured API URL
  if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).electronAPI) {
    const stored = localStorage.getItem('divinr_api_url');
    // Strip leading '/api' from basePath to get the service segment (e.g. '/markets')
    const servicePath = basePath.replace(/^\/api/, '');
    return stored ? `${stored}${servicePath}` : `http://localhost:7100${servicePath}`;
  }
  return basePath;
}

export function useApi(basePath: string = '/api/markets') {
  const BASE_URL = getBaseUrl(basePath);
  const loading = ref(false);
  const error = ref<string | null>(null);

  function getHeaders(): Record<string, string> {
    const auth = useAuthStore();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth.token) {
      headers['Authorization'] = `Bearer ${auth.token}`;
    }
    return headers;
  }

  /**
   * Core fetch wrapper with auto-refresh on 401.
   * If a request gets a 401, attempts to refresh the token and retry once.
   */
  async function request<T = unknown>(path: string, init?: RequestInit): Promise<T> {
    loading.value = true;
    error.value = null;
    try {
      let res = await fetch(`${BASE_URL}${path}`, { ...init, headers: { ...getHeaders(), ...init?.headers } });

      // On 401, try refreshing the token and retry once
      if (res.status === 401) {
        const auth = useAuthStore();
        const refreshed = await auth.tryRefresh();
        if (refreshed) {
          res = await fetch(`${BASE_URL}${path}`, { ...init, headers: { ...getHeaders(), ...init?.headers } });
        }
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }
      if (res.status === 204) return undefined as T;
      return await res.json() as T;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function get<T = unknown>(path: string): Promise<T> {
    return request<T>(path);
  }

  async function post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, { method: 'POST', body: JSON.stringify(body) });
  }

  async function put<T = unknown>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
  }

  async function patch<T = unknown>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async function del<T = unknown>(path: string): Promise<T> {
    return request<T>(path, { method: 'DELETE' });
  }

  return { get, post, put, patch, delete: del, loading, error };
}
