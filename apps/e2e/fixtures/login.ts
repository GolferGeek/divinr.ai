import type { Page } from '@playwright/test';

export interface LoginResult {
  url: string;
}

export async function loginAs(page: Page, email: string, password: string): Promise<LoginResult> {
  await page.goto('/login');

  if (!page.url().includes('/login')) {
    return { url: page.url() };
  }

  const emailInput = page.locator('input[type="email"], input[autocomplete="email"]').first();
  const passwordInput = page.locator('input[type="password"], input[autocomplete="current-password"]').first();

  await emailInput.waitFor({ state: 'visible', timeout: 15000 });
  await emailInput.fill(email);
  await passwordInput.fill(password);

  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }),
    page.getByRole('button', { name: /sign in/i }).click(),
  ]);

  return { url: page.url() };
}
