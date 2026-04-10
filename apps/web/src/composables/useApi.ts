import { ref } from 'vue';
import { useAuthStore } from '../stores/auth.store';

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
    const auth = useAuthStore();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth.token) {
      headers['Authorization'] = `Bearer ${auth.token}`;
    }
    return headers;
  }

  async function get<T = unknown>(path: string): Promise<T> {
    loading.value = true;
    error.value = null;
    try {
      const res = await fetch(`${BASE_URL}${path}`, { headers: getHeaders() });
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
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(body),
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
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(body),
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
