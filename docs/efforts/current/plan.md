# Markets Integration Test Infrastructure — Implementation Plan

**PRD**: ./prd.md
**Intention**: ./intention.md
**Created**: 2026-04-08
**Status**: Not Started

## Progress Tracker
- [x] Phase 1: DataSourceService DI refactor (non-behavioral)
- [x] Phase 2: Stub adapter scaffolding with capture mode
- [x] Phase 3: Initial fixture capture (one-time real-API run)

### Phase 3 notes
- 28 fixtures captured (4 symbols × 7 providers). 18/28 returned non-empty data; 10 returned empty due to free-tier 403s on FMP, twelve-data, finnhub price-targets, and FRED T10Y2Y. Empty fixtures are still real-shape responses and represent the production behavior of those endpoints under our current credentials.
- The Phase 2 placeholder `aapl__snapshot.json` files were removed from every provider dir (their dataTypes shape doesn't match what the runner will request). The shape test was updated to use real-shape dataTypes per provider.
- Total fixture footprint: 144 KB (well under the 200 KB ceiling).
- No leaked credentials detected via grep scan for `api_?key|apikey|token|secret|password`.
- Decision logged: scenarios use four distinct symbols (AAPL/TSLA/NVDA/MSFT) instead of one symbol with branch-by-config, because the LLM stub is keyed by `(instrumentSymbol, analystId)` per the locked PRD decision and using one symbol would force ugly per-scenario keying hacks.
- [x] Phase 4: Stub LLM service + hand-curated response set

### Phase 4 notes
- StubLlmService implements LLMServiceProvider with only generateResponse functional; every other method throws so future drift is loud.
- Keying: extracts symbol from `Assess SYMBOL (...)` in user prompt and analyst name from `You are NAME.` in system prompt. Arbitrator detected from `^You are the chief arbitrator .* for SYMBOL.`. Per the locked PRD decision the key is conceptually `(symbol, analyst)`; PRD said `analystId` but the prompts only contain `display_name`, which is functionally equivalent within the test scope.
- 16 canned responses + 4 arbitrator responses (4 symbols × 4 entries each). MSFT|Macro Strategist = `__THROW__` to force the partial-failure code path.
- Seed config in Phase 5 must use display names: `Macro Strategist`, `Technical Analyst`, `Sentiment Analyst`. Cross-referenced in this phase by writing the response keys to match.
- [ ] Phase 5: Integration test runner (the actual end-to-end gate)
- [ ] Phase 6: CI integration (new `markets-integration` job)
- [ ] Phase 7: Documentation and manual test plan update

### Phase 1 notes
- Discovered codebase uses explicit `@Inject(ClassName)` on every constructor param (not type-based DI). Reason: tsx/esbuild does not emit `design:paramtypes` reflect metadata that NestJS would otherwise need. All seven adapter params in `DataSourceService` were updated to use explicit `@Inject(ClassName)`.
- All 7 adapters now annotated with `@Injectable()` and registered in `MarketsModule`. No other code paths construct adapters with `new`.

---

## Phase 1: DataSourceService DI refactor (non-behavioral)
**Status**: Not Started
**Objective**: Make the seven external adapters injectable via NestJS DI without changing any production behavior, so later phases can swap them with stubs via `.overrideProvider()`.

### Steps
- [ ] 1.1 Read `apps/api/src/markets/services/data-source.service.ts` end-to-end and inventory exactly how each of the seven adapters (`PolygonAdapter`, `FmpAdapter`, `TwelveDataAdapter`, `FinnhubAdapter`, `FredAdapter`, `SecEdgarAdapter`, `RedditAdapter`) is currently constructed inline. Note any constructor args (HTTP clients, env config, rate limiters) so the providers can be wired identically.
- [ ] 1.2 Add the seven adapter classes as `@Injectable()` providers in `apps/api/src/markets/markets.module.ts` (extending the existing `providers: [...]` list around `markets.module.ts:38–70`). Match the construction args identically — same env-var reads, same rate-limit settings, same HTTP client.
- [ ] 1.3 Refactor `DataSourceService`'s constructor to accept the seven adapters via DI instead of constructing them inline. Replace the inline construction sites with references to the injected instances. Adapter ordering and identity must be unchanged.
- [ ] 1.4 If any adapter currently reads from `process.env` inside its constructor, leave that behavior alone — DI just controls *who creates the instance*, not the env-var reads. Confirm no adapter is registered twice.
- [ ] 1.5 Search for any other call sites that construct adapters directly (`grep -rn "new PolygonAdapter\|new FmpAdapter\|new TwelveDataAdapter\|new FinnhubAdapter\|new FredAdapter\|new SecEdgarAdapter\|new RedditAdapter" apps/api/src`) and either route them through DI or document why they stay inline.

### Quality Gate
- [ ] **Lint**: `pnpm --filter @divinr/api lint`
- [ ] **Build**: `pnpm --filter @divinr/api build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api test:unit`
- [ ] **Smoke Tests**: `pnpm --filter @divinr/api test:markets:smoke` (cases 1–7 must remain green; this is the contract that the DI refactor was non-behavioral)
- [ ] **E2E Tests**: n/a
- [ ] **Curl Tests**: n/a (no HTTP surface changed)
- [ ] **Chrome Tests**: n/a (no UI changed)
- [ ] **Phase Review**:
  - [ ] All seven adapters are listed in `markets.module.ts` providers and injected into `DataSourceService` constructor.
  - [ ] No production code path constructs an adapter with `new` outside of NestJS DI (or any exception is justified in the diff).
  - [ ] Smoke cases 1–7 still green, proving identical wiring/rate-limiting behavior.
  - [ ] No file outside `apps/api/src/markets/services/data-source.service.ts` and `apps/api/src/markets/markets.module.ts` was modified, except for trivial import shuffles.

---

## Phase 2: Stub adapter scaffolding with capture mode
**Status**: Not Started
**Objective**: Create one stub class per adapter satisfying `DataSourceAdapter`, with replay-mode and capture-mode behavior built in from the start. No fixtures committed yet beyond temporary samples.

### Steps
- [ ] 2.1 Create directory `apps/api/tests/markets/integration/stubs/`.
- [ ] 2.2 Create `apps/api/tests/markets/integration/stubs/stub-adapter-base.ts`. This base class implements `DataSourceAdapter` and accepts `(provider: string, fixturesDir: string, realAdapterFactory: () => DataSourceAdapter)` in its constructor. It has one mode field decided at construction time: `process.env.MARKETS_FIXTURE_CAPTURE === 'true'` selects capture mode, otherwise replay. It implements `fetchData(params)` as: in replay mode, read JSON from `${fixturesDir}/${scenarioKeyFromParams(params)}.json` and return the parsed `DataSourceResult` (throw a clear error pointing at Phase 3's capture command if the file is missing); in capture mode, instantiate the real adapter via the factory, call its `fetchData(params)`, write the result to the fixture file, and return it.
- [ ] 2.3 Define a single deterministic `scenarioKeyFromParams(params)` function in the base file that takes a `DataSourceFetchParams` and returns a stable filename string. The mapping must be 1:1 — same params produce the same key. Document the algorithm in a comment.
- [ ] 2.4 Add a one-time module-load banner: `if (process.env.MARKETS_FIXTURE_CAPTURE === 'true') console.warn('⚠️  MARKETS_FIXTURE_CAPTURE=true — stub adapters will hit real APIs and overwrite fixture files');`. The banner fires once per process.
- [ ] 2.5 Create one stub class per adapter in `apps/api/tests/markets/integration/stubs/`:
  - `stub-polygon.adapter.ts`
  - `stub-fmp.adapter.ts`
  - `stub-twelve-data.adapter.ts`
  - `stub-finnhub.adapter.ts`
  - `stub-fred.adapter.ts`
  - `stub-sec-edgar.adapter.ts`
  - `stub-reddit.adapter.ts`
  Each extends `StubAdapterBase` and supplies `id`, `name`, `provider`, `tier`, and `rateLimitPerMinute` matching its real counterpart, plus a `realAdapterFactory` closure that constructs the real adapter only if invoked (so capture mode works without forcing real construction in replay mode).
- [ ] 2.6 Create `apps/api/tests/fixtures/markets/[provider]/` directories for all seven providers (commit a single placeholder `.gitkeep` per dir). Add a 1-scenario sample fixture for each provider just enough to prove file loading works in step 2.7. These sample fixtures are temporary and Phase 3 will overwrite them.
- [ ] 2.7 Create `apps/api/tests/unit/stub-adapter-shape.test.ts`. The test instantiates each of the seven stub classes in replay mode against the temporary sample fixtures, calls `fetchData()` with a known param shape that maps to the sample scenario key, and asserts the returned object matches the `DataSourceResult` shape (`data: string`, `metadata: object`). Use the existing `tsx + node:assert` pattern from sibling tests in `apps/api/tests/unit/`.
- [ ] 2.8 Wire `apps/api/tests/unit/stub-adapter-shape.test.ts` into the existing `pnpm --filter @divinr/api test:unit` script (it should be picked up automatically if the script globs `tests/unit/*.test.ts`; verify and fix if not).

### Quality Gate
- [ ] **Lint**: `pnpm --filter @divinr/api lint`
- [ ] **Build**: `pnpm --filter @divinr/api build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api test:unit` (must include the new `stub-adapter-shape.test.ts`)
- [ ] **Smoke Tests**: `pnpm --filter @divinr/api test:markets:smoke` (still green)
- [ ] **E2E Tests**: n/a
- [ ] **Curl Tests**: n/a
- [ ] **Chrome Tests**: n/a
- [ ] **Phase Review**:
  - [ ] Seven stub adapter files exist in `apps/api/tests/markets/integration/stubs/` and each compiles.
  - [ ] `StubAdapterBase` cleanly implements both replay and capture modes via the `MARKETS_FIXTURE_CAPTURE` env flag.
  - [ ] Banner fires when the env flag is set; does not fire when it isn't.
  - [ ] `stub-adapter-shape.test.ts` exists, is picked up by `test:unit`, and passes.
  - [ ] No fixture file is read by any code path other than the stub adapters.
  - [ ] No production code in `apps/api/src/` was modified in this phase.

---

## Phase 3: Initial fixture capture (one-time real-API run)
**Status**: Not Started
**Objective**: Populate `apps/api/tests/fixtures/markets/[provider]/` with real-shape JSON captured from live APIs for the four scenarios (bullish, bearish, split, partial-failure), overwriting the temporary samples from Phase 2.

### Steps
- [ ] 3.1 Verify the engineer running this phase has a local `.env` containing real credentials for at least: `POLYGON_API_KEY`, `FMP_API_KEY`, `TWELVE_DATA_API_KEY`, `FINNHUB_API_KEY`, `FRED_API_KEY`. SecEdgar and Reddit use unauthenticated endpoints — confirm no credential is required for those. If any real credential is missing, stop and surface the gap to the user before proceeding.
- [ ] 3.2 Create a tiny temporary capture entry-point at `apps/api/tests/markets/integration/capture-fixtures.ts`. It instantiates each stub adapter in capture mode and calls `fetchData()` for the four scenarios (bullish, bearish, split, partial-failure) against a stable instrument (`AAPL` for the equity-shaped providers, an appropriate symbol for the others — document the chosen symbols in the script). The script is idempotent: re-running it overwrites fixtures, never appends. This script is *temporary* and will be replaced by the real runner in Phase 5; it exists in this phase only to drive the initial capture.
- [ ] 3.3 Add a temporary `pnpm --filter @divinr/api test:markets:capture` script in `apps/api/package.json` that runs `MARKETS_FIXTURE_CAPTURE=true tsx tests/markets/integration/capture-fixtures.ts`. This script will be removed at the end of Phase 5.
- [ ] 3.4 Run `pnpm --filter @divinr/api test:markets:capture` once. Verify the capture banner printed. Verify each provider directory now contains the four scenario JSON files. Inspect each file by hand and sanitize anything that shouldn't be in git (API keys leaked into responses, PII, opaque session tokens). Confirm response shapes look like real provider output, not error envelopes.
- [ ] 3.5 Delete the temporary `.gitkeep` files in the provider directories now that real fixtures exist.
- [ ] 3.6 Commit the captured fixtures with a clear message naming each provider and scenario.

### Quality Gate
- [ ] **Lint**: `pnpm --filter @divinr/api lint`
- [ ] **Build**: `pnpm --filter @divinr/api build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api test:unit` (the stub-adapter-shape test should still pass against the now-real fixtures)
- [ ] **Smoke Tests**: `pnpm --filter @divinr/api test:markets:smoke` (still green)
- [ ] **E2E Tests**: n/a
- [ ] **Curl Tests**: n/a
- [ ] **Chrome Tests**: n/a
- [ ] **Phase Review**:
  - [ ] Every directory under `apps/api/tests/fixtures/markets/[provider]/` contains exactly the four scenario JSON files (bullish, bearish, split, partial-failure) for `AAPL` (or the documented per-provider symbol).
  - [ ] No leaked credentials, PII, or session tokens in the fixture files (visual review by the engineer).
  - [ ] Total fixture size under 200 KB (sanity check from PRD §4.5).
  - [ ] `pnpm --filter @divinr/api test:unit` is green against the now-real fixtures.
  - [ ] PR description includes a screenshot or paste of the fixtures diff and an explicit engineer sign-off line.

---

## Phase 4: Stub LLM service + hand-curated response set
**Status**: Not Started
**Objective**: Provide a deterministic stub for the `LLM_SERVICE` token used by `MarketsLlmService`, keyed by `(instrumentSymbol, analystId)`, covering the four scenarios from Phase 3.

### Steps
- [ ] 4.1 Open `apps/api/src/markets/services/markets-llm.service.ts` and confirm the exact interface that the `LLM_SERVICE` token from `@orchestratorai/planes/llm` is expected to satisfy. Note the method name(s), argument shapes, and return shape that `MarketsLlmService.generateText()` calls into.
- [ ] 4.2 Create `apps/api/tests/markets/integration/stubs/stub-llm-service.ts`. The class implements the interface from step 4.1. It loads a hand-curated JSON file at `apps/api/tests/fixtures/markets/llm/responses.json` once at construction. Its `generateResponse()` (or whatever the real method is named) extracts the instrument symbol and analyst id from the prompt context and looks up `responses[symbol][analystId]`. If found, returns the canned response. If not found, throws a clear error: `Stub LLM has no response for (symbol=X, analystId=Y) — add it to responses.json`.
- [ ] 4.3 Hand-curate `apps/api/tests/fixtures/markets/llm/responses.json` with at least four entries keyed by `(AAPL, $analystId)`. The four entries collectively force: a bullish-consensus arbitrator path, a bearish-consensus path, a split-arbitration path, and one entry that returns an explicit error or exception so the runner exercises `prediction-runner.service.ts`'s partial-failure handling. The exact analyst ids used must match the seed analyst configuration the Phase 5 runner will create (cross-reference via Phase 5 step 5.4 — write the seed config first if needed).
- [ ] 4.4 Create `apps/api/tests/unit/stub-llm-shape.test.ts`. The test instantiates the stub, asserts that the four canned keys return the expected response shapes, and asserts that an unknown key throws the expected error. Same `tsx + node:assert` pattern as Phase 2's shape test.

### Quality Gate
- [ ] **Lint**: `pnpm --filter @divinr/api lint`
- [ ] **Build**: `pnpm --filter @divinr/api build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api test:unit` (must include `stub-llm-shape.test.ts`)
- [ ] **Smoke Tests**: `pnpm --filter @divinr/api test:markets:smoke` (still green)
- [ ] **E2E Tests**: n/a
- [ ] **Curl Tests**: n/a
- [ ] **Chrome Tests**: n/a
- [ ] **Phase Review**:
  - [ ] `stub-llm-service.ts` implements the same interface as `LLM_SERVICE` from `@orchestratorai/planes/llm`.
  - [ ] `responses.json` contains exactly the four scenario entries; analyst ids match the seed config that Phase 5 will use.
  - [ ] `stub-llm-shape.test.ts` covers all four canned responses plus the unknown-key error path.
  - [ ] No production code in `apps/api/src/` was modified.

---

## Phase 5: Integration test runner (the actual end-to-end gate)
**Status**: Not Started
**Objective**: Drive `PredictionRunnerService.executePredictionRun()` end-to-end against the stub adapters and stub LLM via a NestJS `TestingModule`, asserting on persisted artifacts. Rename the existing live `:integration` script to `:live` in the same commit.

### Steps
- [ ] 5.1 Create `apps/api/tests/markets/integration/db-fixtures.ts`. Export `seedScenario(scenarioName)` and `cleanupScenario(scenarioName)` helpers. Each scenario is scoped to a unique `org_slug` like `integration-test-bullish`, `integration-test-bearish`, etc. Seed the minimum viable rows: organization, instrument (AAPL), enabled analysts (matching the analyst ids in `responses.json` from Phase 4), and any context-provider configuration `executePredictionRun()` needs to start. Cleanup uses selective `DELETE WHERE org_slug = $1` mirroring the pattern in `apps/api/tests/markets/compliance-harness.ts`.
- [ ] 5.2 Create `apps/api/tests/markets/integration/run-markets-integration-tests.ts`. This is the main runner. It:
  - Bootstraps a NestJS `TestingModule` from `AppModule` with seven `.overrideProvider(XxxAdapter).useClass(StubXxxAdapter)` calls plus `.overrideProvider(LLM_SERVICE).useValue(new StubLlmService())`.
  - For each of the four scenarios, calls `seedScenario`, retrieves `PredictionRunnerService` from the testing module, calls `executePredictionRun()`, asserts on the result + persisted rows in `prediction.*` tables, then calls `cleanupScenario`.
  - Uses the same `tsx` + `node:assert` pattern as `run-markets-smoke-tests.ts`. Borrow its case-runner harness if useful.
  - Tracks per-scenario duration and prints a summary line at the end. Fails the process with non-zero exit if any assertion fails.
- [ ] 5.3 Define the per-scenario assertions:
  - **Bullish consensus**: arbitrator's final outcome is bullish; all per-analyst predictions are present in `prediction.*`; `TradeRecommendationService.generateForRun()` produced a recommendation row.
  - **Bearish consensus**: same but bearish verdict.
  - **Split arbitration**: per-analyst predictions disagree; arbitrator picks the documented tie-breaker; recommendation row reflects the lower-confidence verdict.
  - **Partial failure**: one analyst's LLM call throws; the runner records the failure but persists the surviving analysts' predictions and produces an arbitrator outcome; the result's partial-failure marker is set.
- [ ] 5.4 The seed analyst configuration in `db-fixtures.ts` must match the analyst ids used in `apps/api/tests/fixtures/markets/llm/responses.json` from Phase 4. If they're out of sync, the stub LLM throws unknown-key errors. Verify cross-consistency before considering this step done.
- [ ] 5.5 In `apps/api/package.json`, rename the existing `test:markets:integration` script to `test:markets:live`. Add a new `test:markets:integration` script that runs `tsx tests/markets/integration/run-markets-integration-tests.ts`.
- [ ] 5.6 Delete the temporary `test:markets:capture` script and `apps/api/tests/markets/integration/capture-fixtures.ts` from Phase 3 — capture mode now lives inside the main runner (re-run with `MARKETS_FIXTURE_CAPTURE=true pnpm --filter @divinr/api test:markets:integration` if a refresh is needed). Verify no other script references the deleted entry-point.
- [ ] 5.7 Run `pnpm --filter @divinr/api test:markets:integration` 10 times in a row locally. All 10 must pass with identical output. If any flake, diagnose root cause before considering the phase done — flakes do not get retried into "passing."

### Quality Gate
- [ ] **Lint**: `pnpm --filter @divinr/api lint`
- [ ] **Build**: `pnpm --filter @divinr/api build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api test:unit`
- [ ] **Smoke Tests**: `pnpm --filter @divinr/api test:markets:smoke` (still green)
- [ ] **Integration Tests**: `pnpm --filter @divinr/api test:markets:integration` (new — must exit 0 in <60s, run 10x with no flake)
- [ ] **Live Path Sanity**: Confirm `pnpm --filter @divinr/api test:markets:live` is callable (do not run it; just confirm the script exists and points at `run-markets-smoke-tests.ts` with `MARKETS_INTEGRATION_TESTS=true`)
- [ ] **E2E Tests**: n/a
- [ ] **Curl Tests**: n/a
- [ ] **Chrome Tests**: n/a
- [ ] **Phase Review**:
  - [ ] `pnpm test:markets:integration` runs the new stub-driven runner, not the old live path.
  - [ ] All four scenarios assert correctly: bullish, bearish, split, partial-failure.
  - [ ] Runner completes in <60 seconds locally.
  - [ ] 10 consecutive runs produce identical output.
  - [ ] `pnpm test:markets:live` exists and corresponds to the old live-API path.
  - [ ] Temporary capture entry-point and `test:markets:capture` script are removed.
  - [ ] No production code in `apps/api/src/` was modified except whatever minimal hook (if any) the runner needs to seed analyst rows.

---

## Phase 6: CI integration (new `markets-integration` job)
**Status**: Not Started
**Objective**: Add a new CI job to `.github/workflows/markets-ci.yml` that runs the integration suite against a Postgres service container, in parallel with the existing `markets-gates` job.

### Steps
- [ ] 6.1 Read `.github/workflows/markets-ci.yml` and inventory the existing `markets-gates` job's steps: checkout, pnpm setup, build, test commands. The new job should mirror checkout/setup but diverge after that.
- [ ] 6.2 Add a new job `markets-integration` to the same workflow. Configuration:
  - Runs on: `push` and `pull_request` to `main` and `master` (mirror `markets-gates`).
  - Runs on: `ubuntu-latest`.
  - Service container: `postgres:16` with env `POSTGRES_USER=postgres`, `POSTGRES_PASSWORD=postgres`, `POSTGRES_DB=postgres`, port mapping `54322:5432`, health check that waits until Postgres is accepting connections.
  - Job-level timeout: 5 minutes (PRD risk mitigation).
  - Steps: checkout → setup pnpm (matching the existing job's version) → install dependencies → build → run `pnpm --filter @divinr/api run test:markets:integration`.
- [ ] 6.3 The new job runs in parallel with `markets-gates`, not in series — they must not be linked via `needs:`. Verify `markets-gates` is unchanged.
- [ ] 6.4 Push to a feature branch and observe the workflow run on GitHub. Both jobs must show green. The integration job must show:
  - Total wall-clock under 90s (PRD §2 success criterion).
  - The runner step itself under 60s (separable from cold-start time).
  - No external network calls in the step output (the stub adapters never reach real APIs).
- [ ] 6.5 If wall-clock exceeds 90s, profile and reduce. Likely culprits: Postgres health-check polling interval, pnpm install caching, redundant build steps.

### Quality Gate
- [ ] **Lint**: `pnpm --filter @divinr/api lint`
- [ ] **Build**: `pnpm --filter @divinr/api build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api test:unit`
- [ ] **Smoke Tests**: `pnpm --filter @divinr/api test:markets:smoke`
- [ ] **Integration Tests (local)**: `pnpm --filter @divinr/api test:markets:integration`
- [ ] **CI Verification**: Push to a branch and verify both `markets-gates` and `markets-integration` jobs show green on GitHub. Capture the wall-clock numbers.
- [ ] **E2E Tests**: n/a
- [ ] **Curl Tests**: n/a
- [ ] **Chrome Tests**: n/a
- [ ] **Phase Review**:
  - [ ] `.github/workflows/markets-ci.yml` has both `markets-gates` and `markets-integration` jobs.
  - [ ] Jobs run in parallel (no `needs:` between them).
  - [ ] `markets-gates` job definition is unchanged from before this effort.
  - [ ] Integration job uses a `postgres:16` service container on port 54322.
  - [ ] Real CI run shows runner <60s, total job <90s.

---

## Phase 7: Documentation and manual test plan update
**Status**: Not Started
**Objective**: Document the new test paths so the next engineer can find and use them, and confirm the effort meets every PRD success criterion.

### Steps
- [ ] 7.1 Create `apps/api/tests/markets/integration/README.md` documenting:
  - The purpose of the integration suite vs the smoke vs the live path.
  - The fixture layout under `apps/api/tests/fixtures/markets/`.
  - The four scenarios (bullish, bearish, split, partial-failure) and what each is meant to exercise.
  - The deterministic key scheme for stub adapters (`scenarioKeyFromParams`) and for the stub LLM (`(instrumentSymbol, analystId)`).
  - The capture command: `MARKETS_FIXTURE_CAPTURE=true pnpm --filter @divinr/api test:markets:integration`.
  - The rule that fixture changes need a real-capture diff in the PR description (no hand-edits).
- [ ] 7.2 Update `testing/ui/manual-test-plan.md` with a new top-level §X.X "Markets test paths" section enumerating: `pnpm test:markets:smoke`, `pnpm test:markets:integration`, `pnpm test:markets:live`, when to use each, and what each covers/doesn't cover.
- [ ] 7.3 Re-run the entire PRD §2 success-criteria checklist by hand: under 60s local? CI runner under 60s? CI total under 90s? Identical output across 10 runs? All four scenario branches forced? `markets-gates` unchanged and green? `test:markets:live` still callable? Document any criterion that doesn't pass and stop.

### Quality Gate
- [ ] **Lint**: `pnpm -r lint`
- [ ] **Build**: `pnpm -r build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api test:unit`
- [ ] **Smoke Tests**: `pnpm --filter @divinr/api test:markets:smoke`
- [ ] **Integration Tests**: `pnpm --filter @divinr/api test:markets:integration` (final 10x run, identical output)
- [ ] **E2E Tests**: n/a
- [ ] **Curl Tests**: n/a
- [ ] **Chrome Tests**: n/a
- [ ] **Phase Review**:
  - [ ] `apps/api/tests/markets/integration/README.md` exists and covers all six bullets in step 7.1.
  - [ ] `testing/ui/manual-test-plan.md` has a "Markets test paths" section.
  - [ ] Every PRD §2 success criterion is checked off by hand.
  - [ ] All seven phases of this plan are marked complete in the progress tracker above.
