# Completeness — Billing facet

## What the smoke covers

- `/` loads without redirect to `/login` (storage-state authenticated).
- `GET /api/billing/status` responds 200 with the lifecycle shape.
- `TrialCountdown` visibility matches `status === 'trial' && !is_read_only`.
- `ReadOnlyBanner` visibility matches `is_read_only`.
- On branch C: banner has `role="alert"`, the "Your trial has ended." title, an "Add a card" CTA, and a `<LegalDisclaimer>` node.
- Vocabulary check outside `<LegalDisclaimer>` and first-touch `[surface-key]` nodes.
- No 5xx from `divinr.ai` / `127.0.0.1:7100` / `127.0.0.1:7101`.

## Known gaps (not yet automated)

1. **Chip color escalation** — primary / warning / danger based on days remaining. Skipped in smoke because it depends on test-data freshness.
2. **Purge-date copy in the banner body** — the spec asserts the title only, not the "until <date>" line.
3. **"Add a card" click-through** — does not exercise the `/settings/authored-content` navigation; cross-facet with `divinr-authoring-browser-skill`.
4. **Store polling** — the 5-minute `setInterval` auto-refresh is not exercised (would need a clock mock).
5. **Cron-driven transition** — `BillingLifecycleCron.trialExpiryTick()` is covered by `tests/unit/billing-service.test.ts`, not by Playwright.
6. **Read-only guard enforcement** — covered by `tests/unit/read-only-guard.test.ts`; Playwright does not exercise POST/PATCH under a read-only account because it would need a fixture user stuck in that state.
7. **LegalDisclaimer variant** — the banner uses `variant="short"` but the smoke asserts only that a disclaimer node exists. Upgrading the assertion to check variant text would require a data attribute on the component.

## Human demo script (manual)

1. Log in as testing-team; land on the dashboard.
2. **Branch A (trial):** verify an `ion-chip` with the hourglass icon sits in the header slot, copy reads "N days left" / "1 day left" / "Trial ends today".
3. Navigate to `/instruments`, `/portfolios`, `/clubs` — confirm the chip persists across views.
4. Click the chip (or hover the first-touch panel) — verify the "Your free trial" panel opens with the seeded copy.
5. **Branch C (read-only):** have a backend operator flip the user to `canceled` + `is_read_only=true` via a direct DB update, then refresh.
6. Confirm the red banner appears at the top of the dashboard, with the lock icon, "Your trial has ended." title, the short disclaimer line, and an "Add a card" CTA.
7. Navigate to another route; confirm the banner renders on every view.
8. Click "Add a card"; confirm navigation to `/settings/authored-content`.
9. Log out; reload `/login`; confirm the store clears and the banners never flash.

## Promotion criteria

To promote a gap into the smoke spec, we need either:

- (a) an idempotent fixture user that sits in a known lifecycle state across runs, or
- (b) an admin route for Playwright-only lifecycle overrides (gated on the testing-team scope).

Both are out of scope for the initial smoke; lifecycle deterministic testing belongs to the backend unit suite where we can freeze the clock.
