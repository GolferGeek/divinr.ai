# Tests — Learning Panel facet

## Playwright cases (spec: `apps/e2e/tests/learning-panel/smoke.spec.ts`)

### 1. Loads the route and sends a grounded message

- Preconditions: authenticated storage state.
- Steps:
  1. `page.goto('/chat')`
  2. Wait for `Learning Panel` heading.
  3. Fill the composer with a clubs/tournaments question.
  4. Click `Send`.
  5. Wait for `Grounded in`.
- `expect()` calls:
  - heading visible
  - `Grounded in` visible
  - body contains `Clubs` or `Tournaments`

### 2. Refresh preserves the latest thread

- After the first assistant reply, reload the page.
- Assert the question text is still present after reload.

### 3. No 5xx responses on the happy path

- Attach `page.on('response', ...)` before `goto`.
- Capture only `localhost:7100` / `localhost:7101` responses with status `>= 500`.
- Expect the list to remain empty.

## Verify command

```sh
pnpm --filter @divinr/e2e run prepare-auth
BASE_URL=http://localhost:7101 pnpm --filter @divinr/e2e exec playwright test --project=learning-panel
```

## Chrome-MCP exploratory walkthrough

1. Open `/chat`
2. Confirm the route heading is `Learning Panel`
3. Ask `What does Divinr ship today for clubs and tournaments?`
4. Confirm a `Grounded in` citation list renders
5. Refresh and confirm the latest prompt is still visible
