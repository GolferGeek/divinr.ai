# Wait For Data Render

Divinr's surfaces almost always poll a server-side aggregation. The two failure modes that matter are (a) the surface never renders and (b) the surface renders a *shell* (skeleton, empty card, blank chart) with no data. Generic `page.waitForLoadState('networkidle')` masks (b) — the network goes idle after the aggregation returns `[]`. These patterns probe for actual rendered data.

## Tables

```ts
await expect(
  page.locator('table tbody tr').first(),
).toBeVisible({ timeout: 10000 });
```

Prefer `.first()` over `.count()` so Playwright can retry on the locator rather than assert on a snapshot. For tables that may legitimately be empty (e.g., a fresh user), assert the union:

```ts
const hasRow = page.locator('table tbody tr').first();
const emptyState = page.locator('[data-testid="empty-state"]');
await expect.poll(async () => (await hasRow.count()) > 0 || (await emptyState.count()) > 0).toBeTruthy();
```

## Cards / grids

For Ionic card grids (common in Divinr):

```ts
await expect(page.locator('ion-card').first()).toBeVisible({ timeout: 10000 });
```

Then assert a specific text node inside the card to prove data populated — not just the card chrome.

## Charts

Charts on Divinr render as inline SVG (equity curves, calibration, leaderboard ranks). Assert the SVG has non-zero data elements:

```ts
await expect(page.locator('svg path[stroke]').first()).toBeVisible({ timeout: 10000 });
```

For chart libraries that use `<line>` (bar charts) or canvas (heatmaps), adapt the selector. An empty chart container is a real bug worth catching.

## Skeletons

Divinr uses `<ion-skeleton-text>` during load. Wait for skeleton to disappear *before* asserting data:

```ts
await expect(page.locator('ion-skeleton-text').first()).not.toBeVisible({ timeout: 15000 });
```

## Not-yet-loaded vs. empty-state

A skeleton still showing = not yet loaded. An `[data-testid="empty-state"]` visible = loaded but no data. A blank container with neither = the bug you're looking for.
