# Expectations — Billing facet

## Pass conditions

### Smoke — any authenticated view

- Route resolves without redirect to `/login` (storage-state authenticated).
- `GET /billing/status` responds 200 within 10 s and contains the keys `status`, `is_read_only`, `days_until_purge`, `trial_ends_at`, `expired_at`, `purge_scheduled_at`.
- The DOM reflects the lifecycle branch consistently:
  - **Branch A — trial:** `[data-testid="trial-countdown"]` is visible; `[data-testid="read-only-banner"]` is absent.
  - **Branch B — active/past_due/dormant/null:** both banners are absent; no billing chrome in the DOM.
  - **Branch C — read-only:** `[data-testid="read-only-banner"]` is visible; the "Add a card" CTA is present; `[data-testid="trial-countdown"]` is absent.

Any branch is a valid pass. The spec must not require a specific lifecycle state — the testing-team user's state varies across runs.

### Vocabulary

After removing `.legal-disclaimer`, `[data-testid="legal-disclaimer"]`, `[surface-key]`, and `[data-surface-key]` nodes, the remaining user-visible text must NOT contain (case-insensitive):

- `\bprediction(s|ed|or)?\b`
- `\brecommendation\b`
- `\badvice\b`

### Disclaimer routing

On Branch C, the banner MUST contain a `.legal-disclaimer` (or `[data-testid="legal-disclaimer"]`) node. No other inline disclaimer copy is acceptable — new copy goes through `<LegalDisclaimer>` variants (see `apps/web/src/onboarding/disclaimers.ts`).

## Fail conditions

- Redirect to `/login` — auth state stale; re-run `scripts/prepare-auth-state.ts`.
- `GET /billing/status` returns 5xx or does not return within 10 s.
- Branch A without a visible chip, or Branch C without a visible banner.
- Both banners visible at the same time (mutually exclusive — trial + read-only is a bug).
- On Branch C: banner missing the `<LegalDisclaimer>` node, or missing the `Add a card` button.
- Forbidden vocabulary found in non-disclaimer copy.
- Any 5xx on `divinr.ai` / `127.0.0.1:7100` / `127.0.0.1:7101` during the smoke run.

## Branch determination

The fastest way to determine the expected branch is the API response itself, which the spec may fetch in parallel with the page load:

```ts
const resp = await page.request.get('/api/billing/status');
const j = await resp.json();
if (j.is_read_only) expect('branch').toBe('C');
else if (j.status === 'trial') expect('branch').toBe('A');
else expect('branch').toBe('B');
```

Use this to gate the branch-specific assertions rather than sniffing the DOM twice.

## Known non-issues

- The chip color (`primary | warning | danger`) depends on days remaining and is not asserted in smoke — varies by test-data freshness.
- The purge-date copy in the banner body depends on `purge_scheduled_at`; assert the title only (`Your trial has ended.`).
- The "Add a card" click is not exercised in smoke (navigates to the authoring facet); Chrome-MCP only.
- The store's 5-minute auto-refresh is not exercised in smoke (would require a 5-minute wait or a clock mock).
