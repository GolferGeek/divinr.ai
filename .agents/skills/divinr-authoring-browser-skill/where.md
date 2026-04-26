# Where — Authoring locators

## Hub page (`/settings/authored-content`)

Page heading:

```ts
page.getByRole('heading', { name: /^your content$/i, level: 1 })
```

Tab bar (Ionic segment buttons by `value`):

```ts
const analystsTab    = page.locator('ion-segment-button[value="analysts"]');
const instrumentsTab = page.locator('ion-segment-button[value="instruments"]');
const wiringTab      = page.locator('ion-segment-button[value="wiring"]');
const apikeysTab     = page.locator('ion-segment-button[value="apikeys"]');
const billingTab     = page.locator('ion-segment-button[value="billing"]');
```

Active tab content root: the sibling `<div>` that follows the segment, i.e. the page body — assertions can use either the per-card locators below or the empty-state `<div>` selectors directly.

## Analysts tab

Sub-heading + create button:

```ts
page.getByRole('heading', { name: /^your analysts$/i, level: 2 })
page.getByRole('button', { name: /^create analyst$/i })
```

Authored-item cards / empty state:

```ts
const analystCards = page.locator('ion-card'); // scoped under the analysts tab content
const analystEmpty = page.getByText(/no authored analysts yet — create your first one\.?/i);
```

Per-card actions:

```ts
page.getByRole('button', { name: /^edit contract$/i }).first()
page.getByRole('button', { name: /^delete$/i }).first()
```

## Instruments tab

```ts
page.getByRole('heading', { name: /^your instruments$/i, level: 2 })
page.getByRole('button', { name: /^create instrument$/i })
const instrumentEmpty = page.getByText(/no authored instruments yet — create your first one\.?/i);
```

## Wiring tab

```ts
page.locator('ion-segment-button[value="wiring"]').click();
// Renders a matrix; row/col counts scale with authored items.
const wiringMatrix = page.locator('table, .wiring-matrix');
```

## API Keys tab

```ts
page.locator('ion-segment-button[value="apikeys"]').click();
// LlmCredentialsTab renders form rows for known providers (OpenAI / Anthropic / etc.).
```

## Billing tab

```ts
page.locator('ion-segment-button[value="billing"]').click();
page.getByRole('heading', { name: /^billing$/i, level: 2 })
page.getByText(/monthly estimate/i)
```

## Contract editor sub-routes

- Analyst contract: `page.goto('/analysts/<uuid>/contract')` -> `ContractEditorView.vue`.
- Instrument contract: `page.goto('/instruments/<uuid>/contract')` -> `InstrumentContractEditorView.vue`.

## Curriculum authoring sub-routes

- Create:  `/clubs/<uuid>/curricula/create` -> `CurriculumCreateView.vue`
- Detail:  `/clubs/<uuid>/curricula/<uuid>` -> `CurriculumDetailView.vue`
- Dashboard: `/clubs/<uuid>/curricula/<uuid>/dashboard` -> `CurriculumDashboardView.vue`

## Tier-gate fallback (if applicable)

If the route is gated and redirects to an upgrade CTA, accept either heading:

```ts
const yourContent = page.getByRole('heading', { name: /^your content$/i, level: 1 });
const upgradeCta  = page.getByRole('heading', { name: /upgrade|subscribe|paid plan|unlock/i });
await expect(yourContent.or(upgradeCta)).toBeVisible({ timeout: 10_000 });
```
