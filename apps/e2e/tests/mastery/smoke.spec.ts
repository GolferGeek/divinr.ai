import { expect, test } from '@playwright/test';
import { dismissWelcomeModal } from '../../fixtures/onboarding';

async function authenticate(page: Parameters<typeof test>[0]['page']) {
  const apiBase = process.env.E2E_API_BASE ?? 'http://127.0.0.1:7100';
  const email = process.env.E2E_LOGIN_EMAIL ?? 'demo-user@orchestratorai.io';
  const password = process.env.E2E_LOGIN_PASSWORD ?? 'DemoUser123!';

  const loginRes = await page.request.post(`${apiBase}/auth/login`, {
    data: { email, password },
  });
  expect(loginRes.ok()).toBeTruthy();
  const auth = await loginRes.json();

  const meRes = await page.request.get(`${apiBase}/auth/me`, {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
  });
  expect(meRes.ok()).toBeTruthy();
  const me = await meRes.json();

  await page.request.post(`${apiBase}/api/mastery/profile`, {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    data: { preferredLevel: 'core_trading' },
  });

  await page.addInitScript(({ login, me }) => {
    localStorage.setItem('divinr_user', me.id ?? '');
    localStorage.setItem('divinr_token', login.accessToken);
    localStorage.setItem('divinr_refresh_token', login.refreshToken ?? '');
    localStorage.setItem('divinr_role', me.globalRole ?? me.role ?? 'member');
    localStorage.setItem('divinr_email', me.email ?? '');
    localStorage.setItem('divinr_display_name', me.displayName ?? me.email ?? '');
  }, { login: auth, me });
}

test.describe('mastery facet — smoke', () => {
  test('level 1 hides advanced nav, falls back from clubs, and can opt up to level 2', async ({ page }) => {
    await authenticate(page);

    await page.goto('/');
    await dismissWelcomeModal(page);

    const sidebar = page.locator('.sidebar');
    await expect(sidebar.getByText('Learning Panel')).toBeVisible();
    await expect(sidebar.getByText('Trade')).toBeVisible();
    await expect(sidebar.getByText('Analyses')).toBeVisible();
    await expect(sidebar.getByText('Risk')).toBeVisible();
    await expect(sidebar.getByText('Portfolios')).toBeVisible();
    await expect(sidebar.getByText('Clubs')).toHaveCount(0);
    await expect(sidebar.getByText('Your Content')).toHaveCount(0);

    await page.goto('/clubs');
    await expect(page).toHaveURL(/\/chat\?/);
    await expect(page.getByText(/that surface is hidden at your current level/i)).toBeVisible();

    await page.goto('/settings/onboarding');
    await expect(page.getByRole('heading', { name: /onboarding/i, level: 1 })).toBeVisible();
    await page
      .locator('ion-item')
      .filter({ hasText: 'Competitive Participation' })
      .getByRole('button', { name: /show this|current/i })
      .click();

    await page.reload();
    await expect(sidebar.getByText('Clubs')).toBeVisible();

    await page.goto('/clubs');
    await expect(page).toHaveURL(/\/clubs$/);
  });
});
