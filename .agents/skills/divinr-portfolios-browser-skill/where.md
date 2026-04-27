# Where — Portfolios locators

## Page (`/portfolios`)

Heading:

```ts
page.getByRole('heading', { name: /^portfolios$/i, level: 1 })
```

Segment tab bar (Ionic `ion-segment` exposes ARIA `role="tab"` per button):

```ts
const mineTab     = page.getByRole('tab', { name: /^my portfolio$/i });
const analystsTab = page.getByRole('tab', { name: /^analyst portfolios$/i });
const triplesTab  = page.getByRole('tab', { name: /^my triples$/i });
```

Fallback (raw segment-button elements with `value` attribute):

```ts
page.locator('ion-segment-button[value="mine"]')
page.locator('ion-segment-button[value="analysts"]')
page.locator('ion-segment-button[value="triples"]')
```

Search input:

```ts
page.getByTestId('portfolio-search')
```

Kind chips:

```ts
page.getByTestId('kind-chip-user')
page.getByTestId('kind-chip-analyst')
page.getByTestId('kind-chip-arbitrator')
page.getByTestId('kind-chip-day_trader')
```

Sort select (the second `<select>` on the page after the kind chips):

```ts
page.locator('select').first()
```

## Portfolio rows

Row container:

```ts
const rows = page.locator('.portfolio-row');
```

Group headers (text comes from `GROUP_LABELS`):

```ts
page.getByText(/^my portfolio$/i).first()
page.getByText(/^analysts$/i).first()
page.getByText(/^day traders$/i).first()
```

Expanded-row positions list inside `.portfolio-row` (Ionic `ion-list` → `ion-item`):

```ts
const positions = page.locator('.portfolio-row ion-list ion-item');
```

Per-position "Sell" button (mine tab, user kind, open status, canWrite):

```ts
page.getByRole('button', { name: /^sell$/i })
```

## Empty-state markers

Whole-page empty (no rows match filter):

```ts
page.getByText(/^no portfolios yet\.?$/i)
```

Positions empty inside an expanded row:

```ts
page.getByText(/no positions in last 30 days/i)
```

Queued trades empty (mine tab, expanded user row):

```ts
page.getByText(/no queued trades\. trades execute at 5 PM ET settlement/i)
```

Triples tab empty:

```ts
page.getByText(/no triples enabled yet/i)
```

## Smoke "list-or-empty" composite

The smoke uses an OR between any portfolio row and the whole-page empty note:

```ts
const rowOrEmpty = page
  .locator('.portfolio-row')
  .first()
  .or(page.getByText(/^no portfolios yet\.?$/i));
await expect(rowOrEmpty).toBeVisible({ timeout: 10_000 });
```
