# Canonical Divinr Assertions

The invariants every Divinr smoke spec checks. Deep skills extend this list with facet-specific assertions; no deep skill may drop one.

## 1. No 0.00 where a number is expected

Divinr displays equity, P&L, win rates, and conviction scores throughout. A literal "0.00" or "$0.00" on a populated user's dashboard usually indicates a failed aggregation, not a true zero. Assert that displayed numbers are non-zero OR that the empty-state component is shown instead.

```ts
const equity = page.locator('[data-testid="total-equity"]');
await expect(equity).not.toHaveText(/^\$?0\.00$/);
```

Exception: legitimate zeros (e.g., "0 positions" on a fresh portfolio) go through explicit empty-state components, not numeric fields.

## 2. No empty chart containers

Every chart surface renders SVG paths/lines/areas or a canvas with non-transparent pixels. An empty SVG (no `<path>`, no `<line>`, no `<circle>`) is a real failure.

```ts
const chart = page.locator('[data-testid="equity-curve"] svg');
await expect(chart.locator('path').first()).toBeVisible();
```

## 3. No unhandled console errors on the happy path

See `patterns/console-network-capture.md`. The filter list there is the authoritative ignorable-errors list.

## 4. No 4xx/5xx on the happy path

The testing-team user should never see 4xx/5xx responses when walking known-good flows. Capture `page.on('response')` and fail the test if any status ≥ 400 appears for a domain matching `divinr.ai` or `api.divinr.ai` (excluding favicon/asset 404s).

## 5. Every user-visible count or total renders a non-zero value OR an explicit empty-state component

Counts of predictions, tournaments entered, club members, analyst followers, etc., must show either a real count or a "no X yet" component. A blank `<span></span>` where a count should render is the same silent-failure pattern as §1 and should be asserted the same way.

## 6. Trade-CTA targets exist and resolve

Any "Trade this" / "Enter tournament" / "Submit prediction" CTA must navigate to a route that resolves (not 404) within 3s. The PRD §4.1 trade-CTA pattern is tier-1 — a dead CTA is a P0-adjacent finding.

## 7. `<LegalDisclaimer>` renders on every legally-required surface

Per the root `CLAUDE.md` vocabulary rules, user-visible disclaimer copy routes through `<LegalDisclaimer>`. Every spec that loads a prediction/signal/tournament surface should assert the disclaimer element exists somewhere on the page:

```ts
await expect(page.locator('[data-testid="legal-disclaimer"], .legal-disclaimer')).toBeVisible();
```

Missing disclaimer on a trade-CTA, tournament entry, or analyst signal surface is a compliance-adjacent finding and auto-escalates to P1 in triage.
