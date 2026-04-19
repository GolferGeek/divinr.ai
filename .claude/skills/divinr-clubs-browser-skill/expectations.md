# Expectations — Clubs facet

## Pass conditions

### List page (`/clubs`)

- Route resolves without redirect to `/login` (storage-state authenticated).
- `<h1>Clubs</h1>` is visible within 10s.
- Either at least one `.clubs-page ion-card` is visible **or** the `.empty` state is visible. Both-missing is a failure.
- `My Clubs` / `Discover` segment is present.
- `Rankings` header button is always present; `Create Club` is conditional on `canWrite`.
- No HTTP 5xx responses from `divinr.ai` / `127.0.0.1:7100` / `127.0.0.1:7101` during the page lifecycle.

### Vocabulary (outside disclaimers)

After removing `.legal-disclaimer`, `[data-testid="legal-disclaimer"]`, `[surface-key]`, and `[data-surface-key]` nodes, the remaining user-visible text must not contain (case-insensitive):

- `\bprediction(s|ed|or)?\b`
- `\brecommendation\b`
- `\badvice\b`

Disclaimers are intentionally exempt — CLAUDE.md requires every variant to state "not a prediction model" and "not investment advice."

### Detail page (`/clubs/:id`) — not asserted by smoke; documented for deeper tests

- `<h1>{club name}</h1>` visible within 10s.
- Legal disclaimer (`club` variant) is present in both member and non-member branches.
- Member view: all six tab buttons render — `members`, `analysts`, `activities`, `analytics`, `curriculum`, `mentoring`.
- Non-member view: `ClubPreviewPanel` renders instead of the tab bar.
- `?tab=<value>` deep-link sets the active tab when the value is in `VALID_TABS`.

## Fail conditions

- List page redirects to `/login` → auth state stale; re-run `pnpm --filter @divinr/e2e exec tsx scripts/prepare-auth-state.ts`.
- `<h1>Clubs</h1>` not visible within 10s → API outage or router change.
- Neither cards nor empty state visible → render failure.
- Any 5xx on `divinr.ai` / `127.0.0.1:7100` / `127.0.0.1:7101`.
- Forbidden vocabulary found in non-disclaimer copy that is not already documented in `completeness.md`.

## Known non-issues

- `My Clubs` may be empty if the testing-team user hasn't joined any clubs — assert cards-or-empty, not row count.
- `Discover` may be empty in a fresh environment — same assertion shape.
- Sprint chips are conditional on tournament data — never assert their presence.
- `Create Club` button is hidden for non-write roles — never assert presence in a generic smoke.
- The `tournaments` value is in `VALID_TABS` for legacy deep-links but is not rendered as a segment button in the current template.
