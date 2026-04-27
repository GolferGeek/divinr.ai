# Where — Instruments locators

## List page (`/instruments`)

Page heading:

```ts
page.getByRole('heading', { name: /^research$/i, level: 1 })
```

Add Instrument button:

```ts
page.getByRole('button', { name: /add instrument/i })
```

Cards (the InstrumentsView wraps each `IonCol > IonCard`):

```ts
const cards = page.locator('ion-card');
// Scope tighter if needed by anchoring to the heading container:
const root = page.locator('h1', { hasText: /^Research$/ }).locator('..');
const scopedCards = root.locator('ion-card');
```

Empty state:

The current `InstrumentsView.vue` does **not** render an explicit empty-state element when `store.items` is `[]`. The `IonGrid` simply renders no `<ion-card>`. The smoke check should treat "heading present" as the floor and `cards.first().or(addButton)` as the lower bound for "page rendered."

Add modal:

```ts
const modal = page.locator('ion-modal');
const symbolInput = modal.getByLabel(/^symbol$/i);
const nameInput = modal.getByLabel(/^name/i);
const submit = modal.getByRole('button', { name: /^create$/i });
```

## Detail page (`/instruments/:id`)

Header:

```ts
// symbol becomes the <h1>
page.getByRole('heading', { level: 1 })
```

Tab bar (Ionic segment with two values):

```ts
const analystsTab = page.locator('ion-segment-button[value="analysts"]');
// The second tab's `value` is still `predictors` for backwards compatibility,
// but its label now reads "Article Relevance" (renamed from "AI Scoring" in
// the 2026-04-22 Ethan-feedback effort).
const predictorsTab = page.locator('ion-segment-button[value="predictors"]');
```

Article Relevance panel (rendered when `predictors` tab is active):

```ts
page.locator('[data-test="article-relevance-list"]');
page.locator('[data-test="article-relevance-row"]');
// Empty state fallback:
page.getByText(/No articles scored yet for this ticker/i);
```

Arbitrator synthesis card:

```ts
page.locator('[data-tour="arbitrator-synthesis"]')
```

Analyst panels container + per-analyst card:

```ts
page.locator('[data-tour="analyst-panel"]')
page.locator('[data-tour="analyst-panel"] ion-card')
```

Edit contract button (canWrite only):

```ts
page.getByRole('button', { name: /edit contract/i })
```

Triple variant switcher:

```ts
// Mounted only when `instrument` is loaded; selector depends on the component template.
// Probe via the surrounding region instead of inner controls:
page.locator('h1').first().locator('..')
```

## Vocabulary scoping (list page)

The list page does not embed LLM-authored rationale; the labels come from
`@divinr/prediction-planes` (`Symbol`, `Price`, `Change`, `Direction`, `Confidence`).
For the smoke vocabulary check, clone only the heading container and the cards
container, drop disclaimer/onboarding panels, and assert against that subset:

```ts
const text = await page.evaluate(() => {
  const root =
    document.querySelector('h1')?.parentElement?.parentElement
    ?? document.body;
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(
    '.legal-disclaimer, [data-testid="legal-disclaimer"], [surface-key], [data-surface-key]',
  ).forEach((n) => n.remove());
  return (clone.innerText || '').trim();
});
```

## Detail page vocabulary — DO NOT auto-assert

LLM-authored rationale strings render unscoped inside `[data-tour="analyst-panel"]`. Vocabulary leakage there is a real product bug, but it is not deterministic against fixture data — leave that assertion to manual review and a follow-up finding (see `completeness.md`).
