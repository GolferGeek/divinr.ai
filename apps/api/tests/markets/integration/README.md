# Markets Integration Test Suite

End-to-end tests for the markets prediction pipeline that run against a real
Postgres but stub all external HTTP — both the seven data-source adapters and
the LLM service. Local runtime: ~1s for all four scenarios. CI runtime: ~825ms.

## How this differs from the other markets test paths

| Path | Command | What it does |
|---|---|---|
| **smoke** | `pnpm --filter @divinr/api test:markets:smoke` | First 7 cases of `run-markets-smoke-tests.ts`. Wires the full Nest app, exercises RBAC, status transitions, and external-crawler ingest. No LLM, no upstream HTTP, no full prediction pipeline. |
| **integration** | `pnpm --filter @divinr/api test:markets:integration` | This suite. Drives `PredictionRunnerService.executePredictionRun()` end-to-end against stub adapters and `StubLlmService` for four scenarios. |
| **live** | `pnpm --filter @divinr/api test:markets:live` | The legacy `MARKETS_INTEGRATION_TESTS=true` path through `run-markets-smoke-tests.ts`. Hits real Polygon/FMP/TwelveData/etc. plus a real LLM provider. Slow (minutes) and expensive. Not run in CI. |

## Layout

```
apps/api/tests/markets/integration/
├── README.md                           ← you are here
├── db-fixtures.ts                      ← seedScenario / cleanupScenario
├── run-markets-integration-tests.ts    ← the runner
└── stubs/
    ├── stub-adapter-base.ts            ← replay + capture mode
    ├── stub-{polygon,fmp,...}.adapter.ts
    └── stub-llm-service.ts             ← canned LLM responses

apps/api/tests/fixtures/markets/
├── llm/responses.json                  ← keyed by "{symbol}|{analyst_display_name}"
├── polygon/{aapl,tsla,nvda,msft}__snapshot.json
├── fmp/...                             ← real-shape captures
└── ...
```

## Scenarios

| Scenario | Symbol | What it exercises |
|---|---|---|
| `bullish` | AAPL | All three analysts return UP, arbitrator returns UP with high confidence. |
| `bearish` | TSLA | All three analysts return DOWN, arbitrator returns DOWN. |
| `split` | NVDA | Analysts disagree (up/down/flat). Arbitrator returns FLAT. |
| `partial-failure` | MSFT | Macro Strategist's LLM throws (`__THROW__`); the runner records the failure and the surviving two analysts produce an arbitrator outcome. |

## Deterministic key schemes

Two stubs, two key schemes — both fully deterministic so re-runs produce
byte-identical output.

**Stub adapters** (`scenarioKeyFromParams` in `stub-adapter-base.ts`):

```
{symbol_lower}__{sorted_dataTypes_joined_with_underscore}
```

For example, `{symbol: 'AAPL', dataTypes: ['rsi', 'macd']}` → `aapl__macd_rsi`.
The lookup is `apps/api/tests/fixtures/markets/{provider}/{key}.json`. Missing
fixture → loud error pointing at the capture command.

**Stub LLM** (`stub-llm-service.ts`):

```
{symbol}|{analyst_display_name}      ← per-analyst calls
{symbol}|_arbitrator                  ← arbitrator synthesis call
```

Symbol is extracted from the user prompt (`Assess SYMBOL (...)`), analyst name
from the system prompt (`You are NAME.`). The arbitrator system prompt is
detected by its leading `You are the chief arbitrator ... for SYMBOL.` line.

The display names that the seed config uses — Macro Strategist, Technical
Analyst, Sentiment Analyst — must stay in lockstep with the keys in
`responses.json`.

## Refreshing fixtures

```
MARKETS_FIXTURE_CAPTURE=true pnpm --filter @divinr/api test:markets:integration
```

In capture mode, every stub adapter calls its real upstream and overwrites the
fixture file. Capture mode short-circuits before assertions and **does not**
install the stub LLM service (so capture works with whatever LLM provider
your `.env` is pointing at).

Requirements: real credentials in `.env` for `POLYGON_API_KEY`, `FMP_API_KEY`,
`TWELVE_DATA_API_KEY`, `FINNHUB_API_KEY`, `FRED_API_KEY`. SecEdgar and Reddit
use unauthenticated endpoints.

After capturing, the PR description **must include the fixtures diff** so
reviewers can confirm the new shapes. Hand-editing fixture JSON is forbidden:
fixtures are a contract with the upstream provider, and edits will silently
mask drift the next time the captures run.

## Per-scenario isolation

Each scenario gets its own `org_slug` (`integration-test-bullish`, etc.) so
cleanup is a single `delete where organization_slug = $1` per markets table.
There is no cross-scenario state leakage to debug.
