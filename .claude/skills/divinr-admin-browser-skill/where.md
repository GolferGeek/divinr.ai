# Where — Admin locators

All locators verified against the current admin views. Admin views render most
headings as `<h2>` (not h1) inside an unwrapped `<div style="padding: 16px">`
shell — prefer text matching when a role-based query feels brittle.

## Page heading (per route)

| Route                                       | Heading element                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------ |
| `/admin/cost/calibration`                   | `page.getByRole('heading', { name: /cost calibration/i, level: 2 })`           |
| `/admin/cost/defensibility`                 | `page.getByRole('heading', { name: /pricing defensibility/i, level: 2 })`      |
| `/admin/cost/experiments`                   | `page.getByRole('heading', { name: /cost experiments/i, level: 2 })`           |
| `/admin/attribution`                        | `page.getByRole('heading', { name: /attribution/i, level: 2 })`                |
| `/admin/attribution/sources`                | `page.getByRole('heading', { name: /source quality/i, level: 2 })`             |
| `/admin/attribution/graduation-candidates`  | `page.getByRole('heading', { name: /graduation candidates/i, level: 2 })`      |
| `/usage`                                    | `page.getByRole('heading', { name: /llm usage dashboard/i, level: 2 })`        |
| `/findings`                                 | `page.getByRole('heading', { name: /audit findings/i, level: 1 })`             |
| `/proposals`                                | `page.getByRole('heading', { name: /strategic proposals/i, level: 1 })`        |

## Calibration content / containers

```ts
// Main calibration table. There is no role="table" / aria-label, so use a tag selector.
const calibrationTable = page.locator('table').nth(0);

// Drift alert card (only present if there are unacknowledged alerts).
const driftCard = page.locator('ion-card', { hasText: /drift alerts/i });

// Refresh button.
const refreshBtn = page.locator('ion-button', { hasText: /refresh now|refreshing/i });

// Empty-state row (when calibration is empty).
const emptyRow = page.locator('td', { hasText: /no calibrated models yet/i });
```

A robust "page rendered" assertion that handles both populated and empty states:

```ts
const heading = page.getByRole('heading', { name: /cost calibration/i });
await expect(heading).toBeVisible({ timeout: 10_000 });

const container = page.locator('table').or(page.locator('td', { hasText: /no calibrated models yet/i }));
await expect(container.first()).toBeVisible({ timeout: 10_000 });
```

## Cost Defensibility / Cost Experiments

Both views follow the same `<h2>` + table shell pattern. The Defensibility
view uses a `IonSegment` for tier filters; Experiments uses a list of cards
plus a creation button (admin-only).

```ts
const defensibilityTier = page.locator('ion-segment-button', { hasText: /free|pro|elite/i });
const newExperimentBtn = page.locator('ion-button', { hasText: /new experiment|create experiment/i });
```

## Attribution admin / Source quality / Graduation candidates

```ts
// Attribution admin overview is a card grid; assert any card is visible.
const attributionCard = page.locator('ion-card');

// Source quality is a sortable table with column headers.
const sourceQualityHeader = page.getByRole('columnheader', { name: /cite[- ]rate|lift|freshness/i });

// Graduation candidates is a list of cards with an Approve / Reject action pair.
const graduateBtn = page.locator('ion-button', { hasText: /graduate|approve/i });
```

## Operator dashboards (linked from the Admin sidebar)

```ts
// LLM Usage dashboard: top metrics row + per-model chart.
const usageMetric = page.locator('[data-testid="usage-metric"], ion-card, .metric-card').first();

// Audit Findings: hand-rolled table or list with severity chips.
const findingsTable = page.locator('table').or(page.locator('ion-list'));

// Strategic Proposals: hand-rolled table or list of proposal cards.
const proposalsTable = page.locator('table').or(page.locator('ion-list'));
```

## Detecting the admin-role-gate fallback

If the testing-team session does not actually carry an admin role, the view
shell still renders (router has no admin guard) but every API call backing the
view will return 401/403 and the page will be empty. Detect via:

```ts
const apiErrors: string[] = [];
page.on('response', (resp) => {
  if (/\/(admin|usage|findings|proposals|audits)/.test(new URL(resp.url()).pathname)) {
    if (resp.status() === 401 || resp.status() === 403) apiErrors.push(`${resp.status()} ${resp.url()}`);
  }
});
```

If `apiErrors` is non-empty after `networkidle`, file a finding with the
dedup hash `sha1("divinr:apps/e2e/tests/admin/smoke.spec.ts:admin-role-gate") | head -c 8`
(see `completeness.md`).

## FirstTouchPanel

```ts
page.locator('[surface-key="admin.cost-modeling.calibration"], [data-surface-key="admin.cost-modeling.calibration"]')
```
