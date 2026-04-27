# Tests — Mastery facet

## Playwright cases (spec: `apps/e2e/tests/mastery/smoke.spec.ts`)

### 1. Level 1 nav is aggressively simplified

- Reset the test user to `core_trading`.
- Open `/`.
- Assert the sidebar includes `Learning Panel`, `Trade`, `Analyses`, `Risk`, and `Portfolios`.
- Assert the sidebar does not include `Clubs` or `Your Content`.

### 2. Hidden routes fall back into the Learning Panel

- With the same Level 1 profile, visit `/clubs`.
- Assert the URL is `/chat` with query params.
- Assert the Learning Panel renders a notice that the surface is hidden.

### 3. Manual opt-up reveals Level 2 surfaces

- Open `/settings/onboarding`.
- Click `Show this` on `Competitive Participation`.
- Reload.
- Assert `Clubs` is now visible in the sidebar.
- Visit `/clubs` and assert the URL stays on `/clubs`.

## Verify command

```sh
pnpm --filter @divinr/e2e run prepare-auth
BASE_URL=http://localhost:7101 pnpm --filter @divinr/e2e exec playwright test tests/mastery/smoke.spec.ts --project=mastery
```
