# Tests — Learning Panel facet

## Playwright cases (spec: `apps/e2e/tests/learning-panel/smoke.spec.ts`)

### 1. Route fallback loads and sends a grounded message

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

### 3. Shell launcher opens the panel without route navigation

- Preconditions: authenticated storage state on a non-chat route such as `/predictions`.
- Steps:
  1. Click the header button with accessible name `Open Learning Panel`.
  2. Wait for the `Learning Panel` heading.
  3. Confirm the URL stays on the original route.
  4. Send a message and wait for `Grounded in`.

### 4. Mobile chrome menu opens the panel

- Preconditions: mobile viewport.
- Steps:
  1. `page.goto('/predictions')`
  2. Open the `Open notifications menu` overflow control.
  3. Tap `Learning Panel`.
  4. Confirm the heading and composer are visible.

### 5. No 5xx responses on Learning Panel endpoints

- Attach `page.on('response', ...)` before `goto`.
- Capture only `/api/learning-panel/*` and `/api/chat/ask` responses with status `>= 500`.
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
6. Visit `/predictions`, open the header launcher, and confirm the URL does not change
7. Repeat on a narrow/mobile viewport via the overflow menu
