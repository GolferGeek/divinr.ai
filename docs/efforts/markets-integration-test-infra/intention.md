# Markets Integration Test Infrastructure — Intention

## What this effort is

Make `pnpm test:markets:integration` (currently a script that exists but doesn't actually run end-to-end) into a real, deterministic, fast test suite that exercises the full prediction pipeline against stubbed external dependencies — Polygon, FMP, TwelveData, Finnhub, FRED, SecEdgar, Reddit, and the LLM provider.

## Why now

Filed during the `effort/portfolio-foundation-resume` Phase 9 work. The markets gate (`pnpm ci:markets`) currently runs 7 smoke + 2 HTTP cases — adequate for catching obvious DI / RBAC / observability regressions, but it does **not** exercise the actual prediction-generation pipeline. Cases 8+ in `run-markets-smoke-tests.ts` are gated behind `MARKETS_INTEGRATION_TESTS=true` because each pipeline run hits real third-party APIs and takes ~6 minutes per instrument. That's:
- Too slow for any pre-merge gate
- Non-deterministic (rate limits, API outages, schema drift)
- Costs money on every CI run
- Pollutes shared rate-limit budgets used by the actual product

So today we have a coverage gap between "the controllers wire correctly" (gate green) and "a real prediction run end-to-end produces the right artifacts" (currently only verified manually, ad-hoc).

## What good looks like

- `pnpm test:markets:integration` exits 0 in under 60 seconds locally and in CI
- The full prediction pipeline (`PredictionRunnerService.run` → fan-out across analysts → arbitrator synthesis → trade recommendation → outcome tracking → EOD settlement) runs against stub adapters that return canned, deterministic responses
- Stubs are seeded from real captured fixtures (one fresh capture per provider, not hand-written) so the shape is real but the values are frozen
- The same suite that runs locally runs in `markets-ci` GitHub Actions workflow as a new job, in addition to (not replacing) the existing smoke + HTTP cases
- Deterministic: same input → same output every run

## Locked decisions (open for revision when this effort starts)

- **Stub strategy: provider-level boundary, not HTTP-level mocks.** Each external client (`PolygonAdapter`, `FmpAdapter`, etc.) gets a `StubXxxAdapter` that satisfies the same interface and reads canned JSON from `apps/api/tests/fixtures/markets/[provider]/`. Faster and less brittle than nock-style HTTP interception.
- **LLM stub returns deterministic JSON** keyed by the prompt's instrument symbol + analyst id, so swapping LLM providers later doesn't break fixtures.
- **Capture-mode flag**: a `MARKETS_FIXTURE_CAPTURE=true` env var lets a developer re-record fixtures from real APIs in a one-off run, writing fresh JSON into the fixtures dir. Reviewer checks the diff like any other code change.

## Out of scope

- Property-based or fuzz testing of the pipeline
- Replacing the existing smoke/HTTP cases (those stay)
- Performance benchmarks (separate effort)
- Stubbing the database — Postgres stays real (Supabase local)

## Estimated size

1–2 days of focused work for one engineer. Most of the time goes into capturing realistic fixtures for 8 providers and tuning the LLM stub to return responses that exercise interesting branches of `PredictionGeneratorService` / `RiskDebateService` / `TradeRecommendationService`.

## Open questions

- Do we want the capture mode to live in the same script or a separate `tests/fixtures/capture.ts` entry point?
- For the LLM stub, do we hand-write canned responses or capture from a real run and then sanitize?
- Should the integration suite block on a slow `daily_pnl_snapshot` cron tick, or fast-forward time via Postgres `set timezone` tricks?

## Origin

Filed 2026-04-07 from `effort/portfolio-foundation-resume` plan.md §9 "Out-of-scope follow-ups" and PR #5 completion-report.md.
