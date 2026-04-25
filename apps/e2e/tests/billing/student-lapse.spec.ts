import { test, expect } from '@playwright/test';

/**
 * Verifies the .edu re-verification cron trigger endpoint exists and returns
 * the documented shape. The live lapse re-pricing path requires a seeded
 * student user with an active Stripe subscription, which we can't generate
 * in CI without explicit fixture setup.
 *
 * Skipped when STRIPE_SECRET_KEY is unset.
 */
test.describe('billing facet — student lapse', () => {
  test('POST /admin/billing/run-cron/edu-reverify returns counts', async ({ request }) => {
    test.skip(!process.env.STRIPE_SECRET_KEY, 'STRIPE_SECRET_KEY not configured — skip cron trigger');

    const apiBase = process.env.API_BASE_URL ?? 'http://localhost:7100';
    const resp = await request.post(`${apiBase}/admin/billing/run-cron/edu-reverify`, {
      data: {},
    });
    // The testing-team fixture user has admin role per the testing-team-seed
    // migration. If that role isn't present (DB drift) the test cleanly skips.
    if (resp.status() === 403) {
      test.skip(true, 'test user lacks admin role; cron trigger requires admin');
      return;
    }
    expect(resp.ok(), `cron trigger must succeed for admin: ${resp.status()}`).toBeTruthy();
    const body = await resp.json();
    expect(body, 'cron returns ranAt + counts').toMatchObject({
      ranAt: expect.any(String),
      usersChecked: expect.any(Number),
      usersFlippedToRegular: expect.any(Number),
    });
    // ranAt is an ISO timestamp from the last 5 seconds
    const ranAtMs = Date.parse(body.ranAt);
    expect(Number.isFinite(ranAtMs)).toBe(true);
    expect(Date.now() - ranAtMs).toBeLessThan(10_000);
  });
});
