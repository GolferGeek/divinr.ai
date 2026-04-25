import { test, expect } from '@playwright/test';

/**
 * Verifies the Phase 5 webhook-health rollup endpoint and view render.
 * Skipped when STRIPE_SECRET_KEY is unset (the endpoint still works
 * — it just always returns empty days — but there's nothing to assert).
 */
test.describe('admin facet — webhook health', () => {
  test('GET /admin/billing/webhook-health returns days array', async ({ request }) => {
    test.skip(!process.env.STRIPE_SECRET_KEY, 'STRIPE_SECRET_KEY not configured');

    const apiBase = process.env.API_BASE_URL ?? 'http://localhost:7100';
    const resp = await request.get(`${apiBase}/admin/billing/webhook-health`);
    if (resp.status() === 403) {
      test.skip(true, 'test user lacks admin role; webhook-health requires admin');
      return;
    }
    expect(resp.ok(), `webhook-health must succeed: ${resp.status()}`).toBeTruthy();
    const body = await resp.json();
    expect(body, 'response has days array').toMatchObject({
      days: expect.any(Array),
    });
    for (const day of body.days as Array<{ day: string; processed: number; failed: number; pending: number }>) {
      expect(typeof day.day, 'day is YYYY-MM-DD string').toBe('string');
      expect(typeof day.processed).toBe('number');
      expect(typeof day.failed).toBe('number');
      expect(typeof day.pending).toBe('number');
    }
  });

  test('GET /admin/billing/webhook-health view renders', async ({ page }) => {
    test.skip(!process.env.STRIPE_SECRET_KEY, 'STRIPE_SECRET_KEY not configured');
    await page.goto('/admin/billing/webhook-health');
    if (await page.locator('text=/access required|forbidden|admin/i').count() > 0 && await page.locator('h2').count() === 0) {
      test.skip(true, 'test user lacks admin role; view rendering unavailable');
      return;
    }
    await expect(page.getByRole('heading', { name: /webhook health/i })).toBeVisible({ timeout: 10_000 });
  });
});
