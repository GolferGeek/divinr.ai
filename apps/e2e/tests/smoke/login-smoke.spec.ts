import { test, expect } from '@playwright/test';

test.describe('login smoke', () => {
  test('authenticated user lands off /login on home', async ({ page }) => {
    const serverErrors: string[] = [];
    page.on('response', (resp) => {
      const u = resp.url();
      if (resp.status() >= 500 && /divinr\.ai|127\.0\.0\.1:(7100|7101)/.test(u)) {
        serverErrors.push(`${resp.status()} ${u}`);
      }
    });

    await page.goto('/');
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: /financial markets/i })).toBeVisible();
    expect(serverErrors, `unexpected 5xx on home: ${serverErrors.join('\n')}`).toEqual([]);
  });
});
