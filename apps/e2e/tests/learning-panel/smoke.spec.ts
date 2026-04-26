import { test, expect } from '@playwright/test';
import { dismissWelcomeModal } from '../../fixtures/onboarding';

test.describe('learning-panel facet — smoke', () => {
  test('loads, responds with grounding, and survives refresh', async ({ page }) => {
    const serverErrors: string[] = [];
    page.on('response', (resp) => {
      const u = resp.url();
      if (resp.status() >= 500 && /localhost:(7100|7101)|127\.0\.0\.1:(7100|7101)/.test(u)) {
        serverErrors.push(`${resp.status()} ${u}`);
      }
    });

    const prompt = 'What does Divinr ship today for clubs and tournaments?';
    const apiBase = process.env.E2E_API_BASE ?? 'http://127.0.0.1:7100';
    const email = process.env.E2E_LOGIN_EMAIL ?? 'demo-user@orchestratorai.io';
    const password = process.env.E2E_LOGIN_PASSWORD ?? 'DemoUser123!';

    const loginRes = await page.request.post(`${apiBase}/auth/login`, {
      data: { email, password },
    });
    expect(loginRes.ok()).toBeTruthy();
    const login = await loginRes.json();

    const meRes = await page.request.get(`${apiBase}/auth/me`, {
      headers: { Authorization: `Bearer ${login.accessToken}` },
    });
    expect(meRes.ok()).toBeTruthy();
    const me = await meRes.json();

    await page.addInitScript(({ auth, me }) => {
      localStorage.setItem('divinr_user', me.id ?? '');
      localStorage.setItem('divinr_token', auth.accessToken);
      localStorage.setItem('divinr_refresh_token', auth.refreshToken ?? '');
      localStorage.setItem('divinr_role', me.globalRole ?? me.role ?? 'member');
      localStorage.setItem('divinr_email', me.email ?? '');
      localStorage.setItem('divinr_display_name', me.displayName ?? me.email ?? '');
    }, { auth: login, me });

    await page.goto('/chat');
    await dismissWelcomeModal(page);

    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: /learning panel/i, level: 2 })).toBeVisible({
      timeout: 15_000,
    });

    const input = page.locator('textarea').first();
    await expect(input).toBeVisible();
    await input.fill(prompt);
    await page.getByRole('button', { name: /send/i }).click();

    await expect(page.getByText('Grounded in')).toBeVisible({ timeout: 30_000 });
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toContain(prompt);
    expect(bodyText).toMatch(/Clubs|Tournaments/);

    await page.reload();
    await expect(page.getByRole('heading', { name: /learning panel/i, level: 2 })).toBeVisible({
      timeout: 15_000,
    });
    await expect.poll(async () => {
      const text = await page.locator('body').innerText();
      return text.includes(prompt);
    }, { timeout: 30_000 }).toBeTruthy();

    const nonDisclaimerText = await page.evaluate(() => {
      const clone = document.body.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('.legal-disclaimer, [data-testid="legal-disclaimer"]').forEach((n) => n.remove());
      return (clone.innerText || '').trim();
    });
    expect(nonDisclaimerText).not.toMatch(/\brecommendation\b/i);
    expect(nonDisclaimerText).not.toMatch(/\badvice\b/i);

    expect(serverErrors, `unexpected 5xx: ${serverErrors.join('\n')}`).toEqual([]);
  });
});
