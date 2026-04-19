# Where — Performance locators

## Dashboard (`/performance`)

Heading (note: rendered as `<h2>`, not `<h1>`):

```ts
page.getByRole('heading', { name: /^performance$/i, level: 2 })
```

Page root:

```ts
const root = page.locator('.performance-page');
```

Loading spinner (transient):

```ts
const loading = page.locator('.performance-page .loading-state');
```

Three terminal branches (one of these must resolve):

```ts
const emptyState  = page.locator('.performance-page .empty-state');     // no portfolio
const noData      = page.locator('.performance-page .no-data').first(); // empty equity curve
const chartCanvas = page.locator('.performance-page .chart-container canvas'); // populated
```

Range segment buttons:

```ts
const range1W  = page.locator('ion-segment-button[value="1W"]');
const range1M  = page.locator('ion-segment-button[value="1M"]');
const range3M  = page.locator('ion-segment-button[value="3M"]');
const rangeAll = page.locator('ion-segment-button[value="All"]');
```

Metric cards (in order):

```ts
const metricCards = page.locator('.performance-page .metric-card');
// 0: Portfolio Value, 1: Realized PnL, 2: Win Rate, 3: Active Positions
```

PnL bar:

```ts
const pnlBar = page.locator('.performance-page .pnl-bar');
```

Analyst leaderboard rows:

```ts
const leaderboardRows = page.locator('.performance-page .leaderboard-row');
```

## Analyst detail (`/analysts/:id/performance`)

Heading:

```ts
page.getByRole('heading', { level: 2 }) // analyst displayName
```

Calibration scatter (lazy-loaded):

```ts
const scatter = page.locator('svg').first(); // CalibrationScatter renders inline SVG
```

## Attribution mine (`/attribution/mine`)

```ts
page.getByRole('heading', { name: /^my attribution$/i, level: 2 });
const sparkline = page.locator('svg polyline'); // sparklinePoints()
```

## Attribution admin (`/attribution/admin`)

```ts
const tabs = ['triple', 'analyst', 'instrument', 'source', 'author']
  .map(v => page.locator(`ion-segment-button[value="${v}"]`));
```
