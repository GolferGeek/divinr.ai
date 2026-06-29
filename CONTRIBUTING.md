# Contributing

Divinr.ai is not currently organized as a broad community project, but thoughtful issues, review notes, and collaboration inquiries are welcome.

If you are interested in contributing, please contact the maintainer before starting substantial work. This keeps product, legal, and data-boundary decisions aligned before code changes are made.

## Useful First Steps

1. Read [README.md](README.md) for the product and local setup overview.
2. Read [AGENTS.md](AGENTS.md) for repository-specific engineering conventions.
3. Review [docs/features.md](docs/features.md) before changing product behavior or user-facing copy.
4. Review [docs/technical-overview.md](docs/technical-overview.md) for architecture context.

## Local Checks

Run the narrowest relevant check while developing, then run broader gates before proposing a change:

```bash
pnpm -w run lint
pnpm -w run typecheck
pnpm -w run build
pnpm -w run test
```

For market-pipeline work:

```bash
pnpm -w run ci:compliance
pnpm -w run ci:markets
pnpm -w run verify:markets
```

For browser-facing work:

```bash
pnpm -w run e2e
```

## Engineering Conventions

- API constructors use explicit `@Inject(...)` on every parameter.
- Request handlers must not mutate schema. Schema work belongs in migrations and explicit bootstrap paths.
- New user-facing surfaces need first-touch onboarding content and Playwright/deep-skill coverage.
- User-visible copy should use "analysis" or "signal", not "prediction", "advice", or "recommendation".
- Disclaimers route through `apps/web/src/components/LegalDisclaimer.vue`.
- Optional integrations should degrade cleanly when credentials are absent.

## Pull Request Expectations

If a formal contribution path is opened, changes should include:

- A concise explanation of the product or technical intent.
- The commands used to verify the change.
- Screenshots or browser notes for visible UI changes.
- Documentation updates when behavior, setup, or reviewer expectations change.

Small documentation fixes are the easiest place to start. Larger feature work should be discussed first.
