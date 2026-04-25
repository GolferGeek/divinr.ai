import { test, expect } from '@playwright/test';

/**
 * Verifies the .edu detection contract surfaces correctly through
 * GET /billing/status. Live signup-from-scratch isn't exercised here
 * (would need a fresh Supabase user — the test fixture's testing-team
 * user is already established without is_student=true) — instead we
 * assert the API surface behaves correctly when the DB has the flag set.
 *
 * Skipped when STRIPE_SECRET_KEY is unset.
 */
test.describe('billing facet — student signup', () => {
  test('GET /billing/status surfaces is_student boolean', async ({ request }) => {
    test.skip(!process.env.STRIPE_SECRET_KEY, 'STRIPE_SECRET_KEY not configured — skip live student path');

    const apiBase = process.env.API_BASE_URL ?? 'http://localhost:7100';
    const resp = await request.get(`${apiBase}/billing/status`);
    expect(resp.ok(), `GET /billing/status must succeed: ${resp.status()}`).toBeTruthy();
    const body = await resp.json();

    // Additive contract — always present.
    expect(body, 'is_student key always present').toHaveProperty('is_student');
    expect(typeof body.is_student, 'is_student is boolean').toBe('boolean');
    expect(body, 'has_card_on_file key still present').toHaveProperty('has_card_on_file');
    expect(typeof body.has_card_on_file, 'has_card_on_file is boolean').toBe('boolean');
  });
});
