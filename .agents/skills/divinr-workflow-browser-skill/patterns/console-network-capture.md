# Console & Network Capture

Every Divinr spec captures console errors and network failures. Happy-path specs assert neither exists. Exploratory specs dump them into the test report so the triage agent can see silent failures.

## Wiring

```ts
import { test } from '@playwright/test';

test.beforeEach(async ({ page }, testInfo) => {
  const errors: string[] = [];
  const networkFailures: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('requestfailed', (req) => {
    networkFailures.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
  });
  page.on('response', (res) => {
    if (res.status() >= 400 && !res.url().includes('favicon')) {
      networkFailures.push(`${res.request().method()} ${res.url()} → ${res.status()}`);
    }
  });

  testInfo.attach('console-errors', { body: () => errors.join('\n'), contentType: 'text/plain' });
  testInfo.attach('network-failures', { body: () => networkFailures.join('\n'), contentType: 'text/plain' });
});
```

## Happy-path assertion

```ts
test('predictions list loads cleanly', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => msg.type() === 'error' && consoleErrors.push(msg.text()));

  await page.goto('/predictions');
  // …data assertions…

  expect(consoleErrors).toEqual([]);
});
```

## What counts as a real error

- `TypeError: Cannot read properties of undefined` → always real.
- `Failed to fetch` for an app-owned URL → always real.
- Favicon 404s → ignore.
- Ionic dev warnings (`[Ionic Warning]`) → ignore.
- Chrome's `Deprecation` console messages → ignore.

Filter the ignorable ones with a predicate in the `.on('console')` handler rather than asserting the full list.
