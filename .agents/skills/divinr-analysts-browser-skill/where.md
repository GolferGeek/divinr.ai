# Where — Analysts locators

All locators verified against `apps/web/src/views/AnalystsView.vue`,
`AnalystPerformanceView.vue`, and `ContractEditorView.vue`. Prefer
role-based queries; fall back to DOM selectors for Ionic / inline-styled
nodes that don't expose a useful role.

## `/analysts` — grid view

### Page heading

```ts
page.getByRole('heading', { name: /^analysts$/i, level: 1 })
```

The view renders a literal `<h1 style="margin:0">Analysts</h1>` — use the
case-insensitive `^analysts$` anchor so the regex doesn't accidentally
match copy like "Analyst Performance" elsewhere on a misrouted page.

### Cards / rows

Each analyst is an `IonCard` inside an `IonCol` inside the grid:

```ts
const cards = page.locator('ion-grid ion-card');
await expect(cards.first()).toBeVisible({ timeout: 10_000 });
```

### Empty state

There is no dedicated empty-state component yet. When the store is empty
the grid simply has zero `<ion-card>` children. Treat
"zero cards AND no first-touch panel visible" as a finding rather than
silently passing.

### First-touch panel

```ts
page.locator('[surface-key="analysts"], [data-surface-key="analysts"]')
```

### Create-analyst CTA (admin/owner only)

```ts
page.getByRole('button', { name: /create analyst/i })
```

### Contract / Performance buttons inside a card

```ts
const card = cards.first();
card.getByRole('button', { name: /^contract$/i });
card.getByRole('button', { name: /^performance$/i });
```

(Both render as `<ion-button>` wrapped in `<router-link>`.)

### Enable toggle (admin/owner only)

```ts
card.locator('ion-toggle');
```

## `/analysts/:id/performance`

### Heading

```ts
page.getByRole('heading', { name: /-- performance$/i, level: 1 })
```

(The view renders `{display_name} -- Performance` literally.)

### Aggregate tiles

```ts
page.getByText(/^accuracy$/i);
page.getByText(/^avg confidence$/i);
page.getByText(/^calibration score$/i);
page.getByText(/^sample size$/i);
```

### Per-instrument table

```ts
page.locator('table thead th', { hasText: /symbol/i });
page.locator('table tbody tr');
```

### Resolved-analyses list rows

```ts
page.locator('ion-card-content > div > div').filter({ hasText: /correct|wrong/i });
```

### LLM reasoning expansion

Click a row, then:

```ts
page.locator('pre.reasoning-pre');                  // captured reasoning text
page.locator('.reasoning-header');                  // provider / model / tier line
```

## `/analysts/:id/contract`

### Heading

```ts
page.getByRole('heading', { name: /— contract$/i, level: 1 })
// Note: literal em-dash in the template ('{name} — Contract').
```

### Mode buttons (canWrite only)

```ts
page.getByRole('button', { name: /^edit$/i });
page.getByRole('button', { name: /^diff$/i });
page.getByRole('button', { name: /^rollback$|rolling back/i });
```

### Version history rows

```ts
page.locator('h2', { hasText: /version history/i });
page.locator('ion-chip', { hasText: /manual|tier1_auto|tier2_approved|tier3_strategic/i });
```

### Edit-mode textarea

```ts
page.locator('textarea');                           // markdown editor
page.locator('input[placeholder*="Change reason"]'); // reason input
```

### Validation error block (after save)

```ts
page.getByText(/contract validation failed/i);
page.getByText(/missing:|forbidden phrases:|unexpected sections/i);
```

## API contract locators (for `page.on('response')`)

```ts
page.on('response', (resp) => {
  if (/\/api\/analysts(\?|$)/.test(resp.url()))             { /* list */ }
  if (/\/api\/analysts\/[\w-]+\/calibration$/.test(resp.url())) { /* perf */ }
  if (/\/api\/analysts\/[\w-]+\/contract$/.test(resp.url())) { /* contract */ }
  if (/\/api\/analysts\/[\w-]+\/rollback$/.test(resp.url())) { /* rollback */ }
});
```
