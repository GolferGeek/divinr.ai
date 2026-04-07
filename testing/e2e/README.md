# End-to-End Tests

**Stub.** Current integration / end-to-end tests live at:

- `apps/api/tests/markets/run-markets-smoke-tests.ts` — markets smoke suite
- `apps/api/tests/markets/run-markets-http-tests.ts` — HTTP-level markets tests
- `apps/api/tests/compliance/*.ts` — compliance integration suite (currently blocked by an environmental data prerequisite — needs ≥3 seeded users in `authz.users`)

Run via `pnpm ci:markets` (root) or the underlying `apps/api` scripts.

Consolidation into this directory is deferred for the same reasons listed in `testing/unit/README.md`.
