# Markets Integration Test Infrastructure — Product Requirements Document

## 1. Overview

Build a deterministic, fast end-to-end test suite that exercises the real `PredictionRunnerService` pipeline against stubbed external dependencies. Replace the current `pnpm test:markets:integration` (which today just re-runs the smoke script with `MARKETS_INTEGRATION_TESTS=true` against live third-party APIs and takes minutes per instrument) with a stub-driven path that finishes in under 60 seconds and can run as a pre-merge gate in `markets-ci.yml`.

The goal is to close the current coverage gap between "the controllers wire correctly" (existing smoke + HTTP gates) and "a real prediction run end-to-end produces the right artifacts" (today only verified manually against live APIs).

> **Pipeline scope correction.** The intention listed `OutcomeTrackingService` and `EodSettlementService` as part of the pipeline under test. They are not — neither is invoked from `PredictionRunnerService.executePredictionRun()`. This PRD treats them as out of scope (see §6). The same correction makes the intention's open question about waiting on a `daily_pnl_snapshot` cron tick moot: that snapshot is owned by EOD settlement, which this suite never reaches.

## 2. Goals & Success Criteria

**Goals:**
- A new integration test runner that drives `PredictionRunnerService.executePredictionRun()` end-to-end against stub adapters and a stub LLM provider, asserting on the real persisted artifacts the run produces.
- All seven external data adapters (Polygon, FMP, TwelveData, Finnhub, FRED, SecEdgar, Reddit) are swappable via NestJS DI without modifying production behavior.
- The LLM call layer (`MarketsLlmService` → `LLM_SERVICE` token from `@orchestratorai/planes/llm`) is swappable via DI with a deterministic stub keyed by `(instrumentSymbol, analystId)`.
- Adapter fixtures are seeded from a single real capture run, not hand-written. A `MARKETS_FIXTURE_CAPTURE=true` flag re-records them on demand.
- The new suite runs as a job in `.github/workflows/markets-ci.yml` alongside (not replacing) `markets-gates`.

**Success criteria (binary, measurable):**
- `pnpm test:markets:integration` exits 0 in **under 60 seconds** locally against a warm Postgres at `127.0.0.1:54322`.
- The same command runs as a CI job in `markets-ci.yml`. **Runner execution time itself must be under 60 seconds** in CI (matching the intention). **Total CI job wall-clock under 90 seconds** including the Postgres service container cold start, which on GitHub-hosted runners typically adds 10-20 seconds to job startup. The 30-second ceiling on cold start is the only deliberate relaxation of the intention's "under 60 seconds in CI" target, and it is unavoidable without pre-baking Postgres into the runner image.
- Identical input → identical output across at least 10 consecutive runs (no flakes, no time-of-day leakage, no rate-limit dependencies).
- The suite covers at least one full happy-path run through `executePredictionRun()` with multiple analysts, the arbitrator synthesis step, and a downstream `TradeRecommendationService.generateForRun()` call, asserting on persisted analyst predictions and the arbitrator's final outcome.
- The suite includes scenarios that force at least three branches of arbitrator behavior (bullish consensus, bearish consensus, split arbitration) plus one partial-failure scenario (one analyst LLM call returns an error so the runner's partial-failure path is exercised).
- Existing `markets-gates` CI job (smoke + HTTP + unit tests) is unchanged and still green.
- `pnpm test:markets:smoke` still runs cases 1-7. The current `pnpm test:markets:integration` (live-API path) is preserved under a renamed script (`pnpm test:markets:live`) so it remains available for fixture re-capture and ad-hoc live verification.

## 3. User Stories / Use Cases

**As a developer shipping a change to `PredictionRunnerService` or any analyst service**, I can run `pnpm test:markets:integration` locally before pushing and know within a minute whether I broke the prediction pipeline end-to-end. Today I either skip this check (and discover the regression in production) or burn six minutes per instrument hitting real APIs.

**As a reviewer of a PR that touches the markets domain**, I can trust the `markets-ci` gate to catch end-to-end regressions, not just controller-wiring regressions. Today the gate explicitly admits it doesn't exercise the prediction pipeline.

**As a future engineer adding a new analyst, a new adapter, or a new arbitrator strategy**, I have a fixtures directory I can extend by running `MARKETS_FIXTURE_CAPTURE=true pnpm test:markets:integration` against real APIs once, reviewing the JSON diff, and committing it. I do not have to hand-write fake JSON or maintain nock-style HTTP intercepts.

**As an engineer debugging a flaky live-API scenario**, I can fall back to `pnpm test:markets:live` to re-run the exact same scenarios against real APIs when I need to confirm a fixture has gone stale.

## 4. Technical Requirements

### 4.1 Architecture

The pipeline under test is `PredictionRunnerService.executePredictionRun()` (`apps/api/src/markets/services/prediction-runner.service.ts:61–192`), which fans out to:
- `ContextProviderService` (loads context providers)
- `DataSourceService` (calls the seven external adapters)
- `MarketsLlmService.generateText()` (per-analyst LLM call, backed by the `LLM_SERVICE` token from `@orchestratorai/planes/llm`)
- In-service arbitrator synthesis (`prediction-runner.service.ts:311–412`)
- `TradeRecommendationService.generateForRun()`
- `ConvictionTraderService.evaluateAnalyst()` / `evaluateArbitrator()`

The architecture must be changed in exactly one place to enable stubbing: `DataSourceService` currently constructs its seven adapters inline. They must instead be registered as NestJS providers in `MarketsModule` and injected into `DataSourceService`. This is a non-behavioral refactor: production code keeps the same adapter instances, but tests can now `.overrideProvider(PolygonAdapter).useClass(StubPolygonAdapter)` via a `TestingModule`.

The `MarketsLlmService → LLM_SERVICE` path is already injectable via the `LLM_SERVICE` token from `@orchestratorai/planes/llm`, so no production refactor is needed there — only an `.overrideProvider(LLM_SERVICE).useValue(stubLlmService)` in the test bootstrap.

### 4.2 Data Model Changes

**None.** Postgres stays real (Supabase local on port 54322 — the project's standard local DB port). The integration test bootstraps the same schema the smoke tests already create, seeds a minimum viable instrument + analyst configuration, runs the pipeline, and asserts on rows in `prediction.*` tables.

A small test-only helper module (`apps/api/tests/markets/integration/db-fixtures.ts`) will own seed and cleanup helpers (selective DELETE by org slug, mirroring the pattern in `compliance-harness.ts`). No truncation, no transactions — same convention the existing smoke tests already use.

### 4.3 API Changes

**None.** This effort does not add, modify, or remove any HTTP endpoint, DTO, controller, or service public method. Every change is internal: a DI refactor of `DataSourceService`, new stub classes in `apps/api/tests/markets/integration/stubs/`, a new test runner script, a new CI job, and a fixtures directory.

### 4.4 Frontend Changes

**None.** This is a backend test infrastructure effort. The web app is untouched.

### 4.5 Infrastructure Requirements

- **Local**: requires Postgres reachable at `127.0.0.1:54322`. This is the project's standard local DB port, already used by the smoke and compliance tests today.
- **CI**: the new `markets-integration` job in `.github/workflows/markets-ci.yml` will use a `postgres:16` service container exposing port 54322 with `postgres/postgres` credentials, matching the connection string the existing tests already expect (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`). The job depends on the same checkout/setup steps as `markets-gates`. It is a **new** job added alongside `markets-gates`, not a replacement, and runs in parallel.
- **Fixtures storage**: `apps/api/tests/fixtures/markets/[provider]/` — a new directory of small JSON files (one per provider per scenario). Estimated total size at launch: under 200 KB. Committed to git, not gitignored.

## 5. Non-Functional Requirements

- **Performance**: full suite under 60s locally and as in-CI runner execution time. Total CI job wall-clock under 90s including Postgres service container cold start. No individual scenario over 15s.
- **Determinism**: same input → same output across 10 consecutive runs. Time, randomness, and rate-limit-driven branches must be either frozen or stubbed. The LLM stub returns canned JSON keyed deterministically by `(instrumentSymbol, analystId)`; stub adapters return fixture JSON keyed by `(symbol, scenario)`.
- **Isolation**: the suite must not pollute shared state. Each scenario seeds and cleans up under a dedicated `org_slug` (e.g. `integration-test-{scenario}`) and deletes its rows on teardown.
- **No external network calls** in the default path. Network calls must only be possible when `MARKETS_FIXTURE_CAPTURE=true` is explicitly set, and that path must be guarded by an early check that prints a banner so it's never silently active.
- **Compatibility with existing test runner**: tests use the same `tsx` + node `assert` pattern as `run-markets-smoke-tests.ts` and the `apps/api/tests/unit/*.test.ts` files. **Do not introduce jest, vitest, or any other framework** — the project's test convention is plain `tsx` runners.
- **No regression** in the existing `markets-gates` CI job. The new job is additive.

## 6. Out of Scope

- Property-based or fuzz testing of the pipeline (separate effort if ever needed).
- Replacing the existing smoke + HTTP cases (`run-markets-smoke-tests.ts` cases 1–7 stay; `run-markets-http-tests.ts` stays).
- Stubbing Postgres. Postgres stays real.
- Performance benchmarks (separate effort).
- `OutcomeTrackingService`, `EodSettlementService`, the day-trader runner, the stop-loss watcher — none of these are called from `executePredictionRun()` and none get integration coverage in this effort.
- The `daily_pnl_snapshot` cron tick — owned by EOD settlement, which this suite never reaches; the intention's open question about how to handle it is moot under this scope.
- Any change to production behavior in `DataSourceService` other than the constructor signature change required for DI.
- Frontend test coverage of any kind.
- A new test framework. Stay on `tsx` + `assert`.
- Capture-mode for the LLM stub. The LLM stub is hand-curated from a single sanitized real run that the engineer pastes in once. This intentionally answers the intention's open question in favor of hand-curation: only four canned responses are needed (bullish, bearish, split, error), they need exact-match keying that is easier to author than to capture-and-sanitize, and the cost of one capture run isn't worth the added complexity in the stub.

## 7. Dependencies & Risks

**Dependencies:**
- Postgres at `127.0.0.1:54322` locally and via service container in CI. Already a project convention.
- The seven adapter classes and `DataSourceAdapter` interface (`apps/api/src/markets/adapters/data-source-adapter.ts`) staying API-stable through this effort. No concurrent refactor of the adapter interface.
- `MarketsModule` provider registration list (`apps/api/src/markets/markets.module.ts:38–70`) — this PRD will add seven new providers there.
- `LLM_SERVICE` token from `@orchestratorai/planes/llm` remaining the injection point for the LLM client. (If that package changes its export shape during this effort, the LLM stub override will need a corresponding tweak.)
- A real-credentials `.env` available to the engineer running the one-time fixture capture in Phase 3. Without it, Phase 3 cannot complete and Phases 5+ are blocked.

**Risks & mitigations:**
- **Risk**: the DI refactor of `DataSourceService` accidentally changes adapter ordering or rate-limiting behavior in production. **Mitigation**: the existing smoke-test cases 1–7 cover wiring and rate-limit behavior. Verify they still pass after the refactor before moving to Phase 2.
- **Risk**: hand-curated LLM stub responses don't exercise interesting branches of the arbitrator synthesis logic, giving false confidence. **Mitigation**: §2 success criteria require at least four scenarios — bullish consensus, bearish consensus, split arbitration, partial-failure — so the arbitrator's branch logic and the runner's partial-failure path are both forced.
- **Risk**: CI Postgres service container adds 20+ seconds of cold-start to every gate run. **Mitigation**: the new job runs in parallel with `markets-gates`, not in series, so wall-clock for the overall PR gate doesn't grow. The 90s ceiling explicitly accounts for this.
- **Risk**: fixture rot. Real APIs change schemas; captured fixtures go stale silently. **Mitigation**: capture mode is one-command. A future cron-driven monthly capture run can be added cheaply, but is not in scope for this effort. Document the capture command in the README written in Phase 7.
- **Risk**: name collision. `pnpm test:markets:integration` already exists today as the live-API path. **Mitigation**: Phase 5 renames the live-API script to `test:markets:live` in the same commit that introduces the new stub-driven runner under the original `:integration` name. Document the rename in the PR description so anyone with muscle memory updates accordingly.
- **Risk**: the one-time fixture capture in Phase 3 happens to land on a day a provider is rate-limited or has a schema hiccup, producing a bad baseline. **Mitigation**: capture is re-runnable; if the diff looks wrong, re-run before committing. Phase 3's verification gate requires the engineer to actually inspect the captured JSON before considering the phase complete.

## 8. Phasing

Each phase produces an independently verifiable green gate. No phase is "done" until its gate is green and the production smoke tests still pass. Phase ordering deliberately puts capture mode and the initial real capture *before* the integration runner, so the runner's first execution always reads real-shape fixtures, never hand-written ones.

### Phase 1 — DataSourceService DI refactor (non-behavioral)
Register the seven adapters as NestJS providers in `MarketsModule`. Refactor `DataSourceService` to receive them via constructor injection instead of constructing them inline. Production behavior identical. Smoke tests 1–7 still green.
**Verification gate**: `pnpm --filter @divinr/api test:unit` + `pnpm --filter @divinr/api test:markets:smoke` both pass.

### Phase 2 — Stub adapter scaffolding with capture mode built in from day one
Create `apps/api/tests/markets/integration/stubs/` with one stub class per adapter (`StubPolygonAdapter`, `StubFmpAdapter`, etc.), each implementing `DataSourceAdapter`. Each stub has two modes selected at construction time:
- **Replay mode (default)**: reads canned JSON from `apps/api/tests/fixtures/markets/[provider]/[scenario].json`. If the file is missing, throws a clear error pointing the engineer at Phase 3's capture command.
- **Capture mode (`MARKETS_FIXTURE_CAPTURE=true`)**: instantiates the real adapter on demand with real env-var credentials, calls its `fetchData()`, writes the response to the fixture file, and returns it. A banner prints at runner startup so the mode is impossible to leave on silently.

No fixtures committed yet. No integration test runner yet. A small unit test in `apps/api/tests/unit/stub-adapter-shape.test.ts` instantiates each stub class in replay mode against a tiny pre-committed sample fixture for one scenario per provider, just to prove the file-loading and shape are right. These pre-committed sample fixtures are *temporary* — Phase 3 overwrites them with real captures.
**Verification gate**: new unit test passes; existing smoke tests still green.

### Phase 3 — Initial fixture capture (one-time real-API run)
Run `MARKETS_FIXTURE_CAPTURE=true pnpm test:markets:integration` (the script will exist as a stub command at this point — it just runs the stub adapters in capture mode against a hand-defined scenario list, no full pipeline yet). The engineer reviews each generated JSON file, sanitizes anything that shouldn't be in git (API keys leaked into responses, PII, opaque tokens), confirms the response shapes look like real provider output, and commits the result. The temporary sample fixtures from Phase 2 are overwritten in this phase.
**Verification gate**: every provider in `apps/api/tests/fixtures/markets/[provider]/` has at least the four scenarios required by §2 (bullish, bearish, split, partial-failure) populated from real captures. Engineer signs off on the diff in the PR description.

### Phase 4 — Stub LLM service + hand-curated response set
Create `apps/api/tests/markets/integration/stubs/stub-llm-service.ts` implementing the `LLMServiceProvider` interface that `MarketsLlmService` consumes via the `LLM_SERVICE` token. Responses keyed by `(instrumentSymbol, analystId)` from a hand-curated `apps/api/tests/fixtures/markets/llm/responses.json`. Cover at least four keyed responses matching the four scenarios from Phase 3: bullish, bearish, split, and a deliberate error case. A small unit test instantiates the stub and asserts the four keys return the expected shapes (and that the error case throws as expected).
**Verification gate**: new unit test passes; everything else still green.

### Phase 5 — Integration test runner (the actual end-to-end gate)
Create `apps/api/tests/markets/integration/run-markets-integration-tests.ts`. The runner:
- Bootstraps a NestJS `TestingModule` from `AppModule` with `.overrideProvider()` calls swapping each adapter and `LLM_SERVICE` for stubs (in replay mode).
- Seeds a minimal instrument + analyst configuration into Postgres under a test-only org slug.
- Calls `PredictionRunnerService.executePredictionRun()` for the four scenarios (bullish, bearish, split, partial-failure).
- Asserts on rows persisted under `prediction.*`: per-analyst predictions present, arbitrator synthesis row present and matches expected verdict, trade recommendation generated where applicable, partial-failure scenario records the failure correctly.
- Cleans up by org slug at end of each scenario.
- Adds `pnpm test:markets:integration` script wired to this runner. Renames the existing live-API `test:markets:integration` to `test:markets:live` in the same commit.
**Verification gate**: `pnpm test:markets:integration` exits 0 in under 60s locally. All four scenarios assert as expected. Existing smoke + HTTP gates still green. `pnpm test:markets:live` is still callable and (when run with credentials) still works.

### Phase 6 — CI integration (new `markets-integration` job)
Add a new job to `.github/workflows/markets-ci.yml` that:
- Runs in parallel with the existing `markets-gates` job.
- Uses a `postgres:16` service container exposing 54322 with `postgres/postgres` credentials.
- Runs the same checkout + pnpm setup steps as `markets-gates`.
- Runs `pnpm --filter @divinr/api run test:markets:integration`.
- Has a 5-minute wall-clock timeout as a safety net (real budget is 90s).
**Verification gate**: a PR pushed to a branch shows two CI jobs both green. The new job's logs show under 60s for the integration runner step itself and under 90s for the total job wall-clock.

### Phase 7 — Documentation and manual test plan update
Update `testing/ui/manual-test-plan.md` with a new section pointing engineers at `pnpm test:markets:integration` and `pnpm test:markets:live` and explaining when to use each. Add `apps/api/tests/markets/integration/README.md` documenting the capture command, the fixture layout, the scenario list, the deterministic key scheme, and the rule that fixture changes need a real-capture diff in the PR.
**Verification gate**: README and manual-test-plan updates committed; `pnpm -r lint` and `pnpm -r build` clean.
