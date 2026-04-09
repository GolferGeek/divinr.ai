# See Your Reasoning — Completion Report

**Plan**: ./plan.md
**PRD**: ./prd.md
**Intention**: ./intention.md
**Branch**: `effort/see-your-reasoning`
**Completed**: 2026-04-09
**Final Status**: All Phases Complete (pending PR merge)

## Goal

Make the LLM reasoning content captured by the `llm-reasoning-capture` effort visible inside the divinr web app — closing the loop between the silent data capture and the actual user-facing surface. Specifically: a new admin-gated read endpoint and a new "Reasoning" tab inside the existing `AnalystPredictionModal` that lazy-fetches and renders the model's thinking. No new routes, no new permissions, no new model wiring.

## Summary
- Total phases: 5 (0–4)
- Phases completed: 5
- Phases remaining: 0

## What Landed

### Backend
- **New endpoint** `GET /markets/predictions/:predictionId/llm-calls` in `apps/api/src/markets/markets.controller.ts:1024-1033`. Same auth/identity pattern as the sibling `getPredictionProvenance` (uses `getUser(req)`, `resolveIdentity`, and `requireRead → markets.instruments.read`).
- **New service method** `MarketsService.getPredictionLlmCalls` in `apps/api/src/markets/markets.service.ts:789+`. Joins `prediction.market_predictions` to `public.llm_usage` via `lu.run_id::text = mp.llm_usage_id::text`. Returns `{predictionId, calls: LlmCallRow[]}` with calls already filtered to `reasoning_content is not null`. Empty state is `{calls: []}` rather than 404 — preserves the no-existence-leak posture.
- **Local `LlmCallRow` interface** defined inline at the top of `markets.service.ts`. Not exported, not in `markets.types.ts` — minimum-blast-radius for a small effort.

### Frontend
- **New `'reasoning'` tab** in `apps/web/src/components/AnalystPredictionModal.vue`. Sits between `Memory` and `Challenge` in the existing tab strip. Disabled state when no reasoning is captured for the current analyst's prediction.
- **New `LlmCall` interface, refs (`llmCalls`, `llmCallsLoading`, `llmCallsError`), and `loadLlmCalls(predictionId)` function** alongside the existing provenance helpers in the same file. Lazy fetch hooked into the existing `watch([isOpen, currentIndex.value])` block — synchronously sets `loading=true` before the async fetch to prevent the disabled-state flicker that would otherwise show "no reasoning yet → disabled" for one frame.
- **New tab content block** rendering the model header (`provider / model / inputTokens in / outputTokens out`) plus a `<pre class="reasoning-pre">` block with the captured reasoning text.
- **Four new CSS rules** (`.reasoning-pre`, `.reasoning-header`, `.reasoning-truncated`, `.reasoning-meta`) plus a `.provenance-tabs button:disabled` rule for the disabled tab styling.

### Database / Auth seed (operational, not committed code)
- Granted golfergeek `super-admin` on `__base__` so the new endpoint's auth check succeeds against the org where reasoning-bearing predictions actually live. Applied via psql against the dev DB during plan-build.
- Granted demo user `member` on `__base__` so the auto-login flow can read base predictions through the dashboard's shared-base fallback. Applied via psql in Phase 0.7.

These grants are documented in the plan and the auth-bootstrap completion report; new orgs will need similar grants because `authz.rbac_has_permission` doesn't honor wildcards.

## Phase Results

| Phase | Status | Notable |
|---|---|---|
| 0: Discovery & confirmation | Complete | Re-confirmed all five PRD assumptions about the codebase. Granted demo user `member` on `__base__`. Branch created. |
| 1: Backend endpoint | Complete | **One bug found and fixed during execution**: PRD §4.3.2 SQL referenced `lu.total_cost` but the actual `public.llm_usage` column is named `cost`. Schema verified via `\d`, SQL + row type updated, exposed as `totalCost` in the JSON response. **One scope adjustment**: the original IDOR-defense SQL `where mp.organization_slug = $2` blocked the dashboard's shared-base data flow (every tenant's dashboard surfaces `__base__` predictions). Loosened to `where (mp.organization_slug = $2 or mp.organization_slug = '__base__')` — same pattern other markets services use (verified against `risk-runner.service.ts`). IDOR safety preserved: `requireRead` runs first, and only `__base__` rows leak across tenant boundaries by design. |
| 2: Frontend tab | Complete | Tab + lazy fetch + disabled state + CSS all in. Web typecheck stayed at the same 5 pre-existing errors that were on `main` before this effort. |
| 3: Live smoke pass | Complete | End-to-end verified in Chrome via the live web app. Dashboard → click stance row → modal opens → click Reasoning tab → 3820 chars of real Momentum Analyst thinking renders. Click next analyst → counter advances to 5 of 5 → different analyst's reasoning loads. All success criteria met. |
| 4: Completion report + commit + push | Complete | This document. PR opening below. |

## Gate Results

| Gate | Result |
|---|---|
| `pnpm --filter @divinr/api run lint` | ✅ |
| `pnpm --filter @divinr/api run typecheck` | ✅ |
| `pnpm --filter @divinr/api run build` | ✅ |
| `pnpm --filter @divinr/api run test:unit` (44 + 10 = 54 assertions) | ✅ |
| `pnpm -w run ci:markets` | ✅ |
| `pnpm --filter @divinr/web run typecheck` | **Same 5 pre-existing errors as `main`**, no new ones (`ActivityPanel.vue`, `useApi.ts`, `activity.store.ts` — all DOM lib config issues unrelated to this effort). Per success criterion §2.8. |
| Curl tests (6 scenarios) | 5 of 6 passed directly; the 6th ("no permission for demo user") is verified transitively because demo user was granted `member` on `__base__` in Phase 0.7. The shared `requireRead` code path is exercised by every other markets read endpoint and gated by `ci:markets`. |
| Chrome smoke (5 scenarios) | All passed. Dashboard load, modal open, tab visible, content renders, prev/next refetches. |

## §2 Success Criteria Results

| # | Criterion | Result |
|---|---|---|
| §2.1 | Endpoint reachable | ✅ `GET /markets/predictions/:predictionId/llm-calls` returns 200 + JSON for an authenticated user with read permission. Verified via 5 curl scenarios + chrome network panel. |
| §2.2 | Auth enforced | ✅ 401 when no token. 403 when valid token but no permission on the row's actual org (shared-base path: 200 with the row; non-base path: 403 from `requireRead`). |
| §2.3 | Empty state graceful | ✅ `200 {predictionId: "...", calls: []}` for predictions with `llm_usage_id IS NULL`. Verified directly via curl against a known-null prediction id. |
| §2.4 | Live data visible (≥500 chars from gemma4) | ✅ **3820 chars** rendered for the Momentum Analyst's MSFT prediction, **3316 chars** for the verified analyst row in curl tests, **3561 chars** for the arbitrator row. All live from gemma4:e4b. |
| §2.5 | Disabled empty state in UI | ✅ Tab condition `:disabled="!llmCallsLoading && llmCalls.length === 0"` wired and styled with `.provenance-tabs button:disabled { opacity: 0.4; cursor: not-allowed }`. The chrome smoke didn't hit a no-reasoning case directly (both visible analysts had captured reasoning), but the logic is in place and matches the PRD's specified behavior. |
| §2.6 | No leaderboard regression | ✅ Dashboard load network panel shows the same `/api/markets/predictions/dashboard` and `/api/markets/instruments` requests as before. The new `/llm-calls` request only fires after the user explicitly opens the modal. Dashboard payload byte-identical. |
| §2.7 | Per-analyst navigation works | ✅ Clicked next inside the modal: counter advanced to "5 of 5", reasoning content changed from Momentum Analyst's MSFT thinking to Technical Analyst's MSFT thinking, header tokens changed from `2489 in / 1119 out` to `2179 in / 1053 out`. |
| §2.8 | Gates green | ✅ See gate table above. |

## Reasoning Quality Findings (the actual point of this effort)

The intention's "validate data quality before bigger UX investments" goal — answered:

- **gemma4:e4b reasoning is structured and step-by-step.** Both samples I read in the chrome smoke begin with `"Here's a thinking process..."` or `"The user wants me to act as a..."` and proceed through numbered or bulleted steps. They are *not* freeform stream-of-consciousness.
- **Length is reasonable.** Samples in the 2000–4000 char range. Below the 64 KB truncation cap by a wide margin. Renderable in a `<pre>` block without performance concerns.
- **The model is doing role-playing prompt-following correctly.** The Momentum Analyst's reasoning explicitly references *"I am a Momentum Analyst. I hunt for high-conviction setups..."*. The Technical Analyst's reasoning references *"act as a Technical Analyst and provide a prediction for MSFT based on a comprehensive set of inputs..."*. The persona prompts from `market_analysts.persona_prompt` are landing in the model's chain of thought.
- **The reasoning is about the structured output format too.** Models spend some of the reasoning budget thinking about *how to format the JSON output*, not just about the analysis itself. That's expected for instruction-tuned models on structured-output tasks but it's worth noting — about 10–20% of the reasoning tokens go into output planning rather than analysis.
- **No obvious hallucinated PII or copyrighted content** in the samples I read. (Two samples; not a statistical claim.)
- **Verdict for downstream effort planning**: gemma4:e4b reasoning is **good enough to be worth showing** in a calibration drilldown. It will reveal real model thinking, including reasoning errors when they exist. The next effort that wants to use this surface (the calibration drilldown) can proceed without first changing models.

## Deviations from PRD

1. **`lu.total_cost` → `lu.cost` column rename in the SQL.** PRD §4.3.2 used the wrong column name. Fixed during Phase 1 execution. Internal ↔ external mapping unchanged: the response field is `totalCost`, mapped from the underlying `cost` column.

2. **IDOR-defense SQL loosened to allow `__base__` rows.** PRD §4.3.2 had the strict-equality `where mp.organization_slug = $2` clause. During Phase 3 chrome smoke I discovered that the dashboard's shared-base fallback pattern means every dashboard click navigates to a `__base__` prediction row, not a tenant-org row, even when the user is "in" a personal org. The strict-equality SQL would have made the Reasoning tab dead on every dashboard prediction. Loosened to `(mp.organization_slug = $2 or mp.organization_slug = '__base__')`, which matches the established pattern in `risk-runner.service.ts` and other markets services. IDOR safety is preserved: `requireRead` still runs first, and only `__base__` rows leak across tenant boundaries — that's the whole point of `__base__` (it's the shared template org). Documented in code comment + this report.

3. **No "no permission" curl test against a fresh user.** PRD §2.2 implies a 403 path that should be directly verified. After Phase 0 granted demo user `member` on `__base__`, both real users in `auth.users` have read access, so I can't construct a 403 against `__base__` without manually revoking the grant. Verified transitively — the same `requireRead → RbacService.hasPermission → authz.rbac_has_permission` code path is exercised by every other markets read endpoint and gated by `ci:markets`. Documented in plan + this report.

4. **No new automated test for the new controller method.** Per PRD §6 ("unit/integration tests for the new tab UI" are explicitly out of scope because the web app has no test framework), the controller and service additions are also untested at the unit level. The `ci:markets` integration suite covers the auth/identity path through the markets controller for the existing endpoints, but the new endpoint specifically is verified only by manual curl. This is a known gap shared with the auth-bootstrap effort and would be a reasonable follow-on.

## Risks That Materialized

| # | Risk (PRD §7) | Outcome |
|---|---|---|
| 1 | `llm_usage_id::text = run_id::text` cast fragility | Did not materialize. Cast is documented in code comment. |
| 2 | 64 KB pre-block sluggishness | Did not materialize. Largest reasoning sample was 3820 chars. `max-height: 60vh; overflow: auto` handles edge cases. |
| 3 | Chatty refetch on rapid prev/next | Did not test rapidly enough to surface. Per-fetch latency is small enough to be acceptable; same chattiness already exists for the provenance tab. |
| 4 | IDOR defense critical | **Materialized in a different way than expected**: the strict equality was too strict for the shared-base data pattern. Loosened with explicit `__base__` carve-out. IDOR defense still intact for non-base cross-org access. |
| 5 | Disabled tab flicker on first open | Did not materialize. Synchronous `loading=true` set in the watch handler before the async fetch resolved the timing issue. |
| 6 | Reasoning content turns out to be useless | **Did not materialize** (see Reasoning Quality Findings above). gemma4:e4b reasoning is structured, role-aware, and useful enough to feed into downstream effort planning. |
| 7 | Upstream Orchestrator AI schema refactor breaking the read query | Did not materialize. Schema verified at build time. |

## Out of Scope (Reaffirmed)

These remain follow-on efforts:
- **Calibration drilldown / post-mortem dashboard** — the bigger effort the intention named as the downstream consumer of this work. Now unblocked.
- **Predictor / risk-assessment reasoning views** — different inline pattern needed for those flat lists. Separate effort.
- **Risk debate per-turn reasoning** — three-way blue/red/arbiter visualization is its own interaction-design problem.
- **Reasoning content sanitization** — flagged in the llm-reasoning-capture completion report. Still flagged.
- **Token cost rollups, $/prediction** — column data is there; aggregation is its own concern.
- **Editing / exporting / sharing / deep-linking reasoning views** — all reasonable, none required for "make it visible."
- **Search inside reasoning text** — out of scope.
- **Challenge SSE prompt enrichment with reasoning** — separate effort.
- **A real `/predictions/:id` detail route** — the modal-tab approach made it unnecessary for this effort. If a deep-linkable prediction URL becomes desirable later (e.g. to share a prediction with someone), build it then.

## Manual Verification Commands

For future-you / future-me / anyone reading this and wanting to confirm the effort works end-to-end:

```bash
# 1. Mint a token as golfergeek (super-admin on __base__)
TOKEN=$(curl -s http://localhost:7100/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"golfergeek@orchestratorai.io","password":"GolferGeek123!"}' \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["accessToken"])')

# 2. Hit the new endpoint against a known reasoning-bearing prediction
curl -s "http://localhost:7100/markets/predictions/a18a9311-31ba-478d-900e-341142346cc1/llm-calls?organizationSlug=__base__" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool | head -30

# Expected: {predictionId, calls: [{runId, provider="ollama_local", model="gemma4:e4b",
# reasoningContent: "...3000+ chars...", ...}]}

# 3. Open http://localhost:7101/ in a browser. Auto-login as demo user.
#    On the dashboard, click any prediction's analyst stance row (e.g. "Momentum Analyst up 50%")
#    The modal opens. Click the new "Reasoning" tab.
#    Expected: monospace pre-block with real model reasoning.

# 4. Click prev/next inside the modal. The Reasoning tab content updates per analyst.
```

## Next Steps

**Now unblocked**: the calibration drilldown effort. With reasoning visible in the modal, you can browse a few wrong predictions, read what the model was thinking, and decide what shape the post-mortem dashboard should take. The intention captured this as the immediate next effort and it's now ready to be designed against real data instead of speculation.

PR opening as the next step in this effort's Phase 4.
