/**
 * Boot-time auto-login for the divinr web app.
 *
 * If no token exists in tenant.store, calls POST /api/auth/login with the
 * VITE_DEFAULT_USER_EMAIL / VITE_DEFAULT_USER_PASSWORD credentials and stores
 * the resulting Supabase access token + user id + a default org slug in the
 * tenant store.
 *
 * This is a dev-convenience auto-login. Once a real login UI exists, this
 * helper can be deleted or gated behind an env flag.
 */
import { useTenantStore } from '../stores/tenant.store';

interface LoginResponse {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresIn?: number;
}

interface MeResponse {
  id: string;
  email?: string;
  role?: string;
  orgRole?: string | null;
}

const API_BASE = '/api';

export async function bootstrapAuth(): Promise<void> {
  const tenant = useTenantStore();

  // If we already have a token, skip auto-login.
  if (tenant.token) {
    return;
  }

  const email = import.meta.env.VITE_DEFAULT_USER_EMAIL as string | undefined;
  const password = import.meta.env.VITE_DEFAULT_USER_PASSWORD as string | undefined;
  const defaultOrg = import.meta.env.VITE_DEFAULT_ORG_SLUG as string | undefined;

  if (!email || !password) {
    // No auto-login configured — leave the tenant store empty. The user will
    // see auth failures from the API until they manually configure a token.
    console.warn('[bootstrap-auth] VITE_DEFAULT_USER_EMAIL/PASSWORD not set; auto-login skipped.');
    return;
  }

  try {
    const loginRes = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!loginRes.ok) {
      const text = await loginRes.text();
      console.error(`[bootstrap-auth] Login failed (${loginRes.status}): ${text}`);
      return;
    }
    const login = (await loginRes.json()) as LoginResponse;

    const org = defaultOrg ?? `personal-${email.split('@')[0]}`;
    // Fetch the principal so we know the user id and org role without parsing the JWT.
    const meRes = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${login.accessToken}`, 'x-org-slug': org },
    });
    if (!meRes.ok) {
      const text = await meRes.text();
      console.error(`[bootstrap-auth] /auth/me failed (${meRes.status}): ${text}`);
      return;
    }
    const me = (await meRes.json()) as MeResponse;

    tenant.setTenant(org, me.id, login.accessToken, me.orgRole ?? undefined);
    console.info(`[bootstrap-auth] Logged in as ${me.email ?? me.id} (orgRole: ${me.orgRole ?? 'none'})`);
  } catch (err) {
    console.error('[bootstrap-auth] Auto-login error:', err);
  }
}
