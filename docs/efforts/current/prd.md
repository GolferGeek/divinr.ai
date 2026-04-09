# See Your Reasoning — Product Requirements Document

## 1. Overview

Make the LLM reasoning content captured by the `llm-reasoning-capture` effort visible inside the divinr web app. Today, every analyst-row LLM call writes 1.5–3 KB of model thinking to `public.llm_usage.reasoning_content`, and `prediction.market_predictions.llm_usage_id` already FK-links each analyst/arbitrator row back to its originating call. The data is being captured at ~96% rate with 100% trace coverage on the markets analysis path — but the only way to read it today is via `psql`.

This effort closes the loop: a new admin-gated read endpoint `GET /markets/predictions/:predictionId/llm-calls` joins `market_predictions → llm_usage` and returns the captured reasoning, and a new **"Reasoning" tab** inside the existing `AnalystPredictionModal.vue` lazy-fetches that endpoint and renders the text in a `<pre>`-style block. No new routes, no new permission rows, no new model wiring — just a controller method, a service method, and a tab.

The scope is intentionally narrow: this is "make captured reasoning visible at all," not "design a beautiful diagnostic experience." The bigger calibration drilldown / post-mortem dashboards are explicitly downstream of this effort and need a small viewer to exist before they can be designed sensibly.

## 2. Goals & Success Criteria

### Goals
- Make captured reasoning content readable from the web app without dropping to `psql`.
- Validate that gemma4:e4b's reasoning content (and any future reasoning model's content) is actually useful when rendered, before committing to bigger UX investments.
- Establish the read-path patterns for future reasoning-driven features (calibration drilldown, challenge prompt enrichment) so they can copy this effort's controller / service / store approach.

### Success Criteria
1. **Endpoint reachable.** `GET /markets/predictions/:predictionId/llm-calls` returns 200 + JSON when called with a valid bearer token by a user with `markets.instruments.read` on the prediction's organization.
2. **Auth enforced.** Same call without a token returns 401. With a token but no permission on the org, returns 403.
3. **Empty state graceful.** A prediction whose `market_predictions.llm_usage_id` is `null`, OR whose joined `llm_usage.reasoning_content` is `null`, returns `200 {predictionId, calls: []}` — not 404, not 500.
4. **Live data visible.** Opening `AnalystPredictionModal` for an analyst stance whose backing prediction has captured reasoning, then clicking the new "Reasoning" tab, renders the actual reasoning text from `llm_usage.reasoning_content` (≥500 chars sample expected from gemma4:e4b on a real markets prompt).
5. **Disabled empty state in UI.** When the same modal is opened for an analyst stance with no captured reasoning, the "Reasoning" tab is visible but **disabled** (greyed-out), with a tooltip or inline message explaining "this analyst's call did not produce reasoning content." (The intention's "What Good Looks Like" framing originally said "only visible when there is reasoning to show," but the user's later Decisions answer "if null then disabled" supersedes that — the tab is always rendered so users learn the affordance exists, but it's clickable only when reasoning is present. Confirmed against the user's parallel Orchestrator AI work where many existing agents don't use reasoning-capable models — null is a normal state, not an error.)
6. **No leaderboard regression.** Existing dashboard / predictions / instruments endpoint payloads are byte-identical. No new data is fetched until the user clicks the new tab.
7. **Per-analyst navigation works.** After the user clicks prev or next inside the modal to change analysts, the next response from `GET /predictions/:predictionId/llm-calls` returns `predictionId === analyst.prediction_id` for the now-current analyst (i.e. the lazy fetch refires on `currentIndex` change, same pattern as the existing `provenance.fetchProvenance` watcher).
8. **Gates green.** `pnpm -w run lint`, `pnpm -w run typecheck`, `pnpm --filter @divinr/api run test:unit`, `pnpm -w run ci:markets` all pass. Web typecheck stays at the same 5 pre-existing errors that were on `main` before this effort.

## 3. User Stories / Use Cases

- **As the founder spot-checking model output**, I open the dashboard, click an analyst stance on a prediction card, click the new Reasoning tab, and see the model's actual chain of thought without needing to write a SQL query. I can do this for 20 predictions in 5 minutes instead of 5 minutes per prediction.
- **As a calibration analyst (admin)**, I look at a prediction whose direction was wrong and I want to know whether the model hallucinated a fact, misweighed a real signal, or correctly identified a bearish setup that just didn't pan out. The Reasoning tab gives me the raw thinking content so I can read it and form a hypothesis. (Full calibration drilldown is a follow-on effort; this effort just makes the data visible enough to design that effort.)
- **As a future-me building the post-mortem dashboard**, I need to know what real reasoning content looks like — its length, its structure, its quality — before I design a UI around it. This effort renders enough of it that I can answer those questions without psql.
- **As an end user with no markets-write access**, I should NOT be able to read reasoning content for other organizations' predictions. The endpoint enforces RBAC the same way the rest of the markets surface does.

## 4. Technical Requirements

### 4.1 Architecture

```
AnalystPredictionModal.vue (existing)
  │  user clicks new "Reasoning" tab
  │  watch([isOpen, currentIndex]) triggers
  ▼
useApi().get(`/predictions/${predictionId}/llm-calls`)  (new fetch)
  │  Authorization: Bearer <jwt> from tenant.store
  ▼
markets.controller.ts: @Get('predictions/:predictionId/llm-calls')  (new)
  │  getUser(req) + resolveIdentity → requireRead → service method
  ▼
markets.service.ts: getPredictionLlmCalls(orgSlug, userId, predictionId)  (new)
  │  raw SQL: market_predictions → llm_usage via llm_usage_id
  ▼
returns {predictionId, calls: [{model, provider, reasoning, tokens, ...}]}
```

**Why a new tab in the existing modal instead of a new prediction-detail route** ⚠️ **deviation from intention's Decisions section — flag for user review**:

The intention's Decisions section answered: *"create one if one doesn't exist"* about a `/predictions/:id` detail route. During PRD discovery I confirmed no such route exists in `apps/web/src/router/index.ts` — so the literal answer would have me build one. **Instead I'm proposing to reuse the existing `AnalystPredictionModal.vue` with a new tab.** Reasons:

1. The modal already provides the inline-near-the-prediction experience the intention's "What Good Looks Like" section calls for.
2. The modal already has a tabbed UI (`analysis | evidence | risk | memory | challenge`) with a per-analyst lazy-fetch pattern (`provenance.fetchProvenance(prediction_id)` watched on `[isOpen, currentIndex]`). Adding a new tab is a strict subset of the work to create a route + view + data-loading.
3. The user's framing was *"maybe show reasoning as an accordion or second modal?"* — a tab in the existing modal is closer to the intent than either of those literal answers (it's neither a route nor a separate modal, but it IS inline near the prediction display).
4. Keeping the new surface inside the existing modal means everything (including the prev/next analyst navigation) inherits the existing patterns instead of inventing new ones.

**If the user prefers the literal answer** (build the `/predictions/:id` route + a `PredictionDetailView.vue` with the reasoning rendered there), this is a 1–2 hour widening of the effort and should be raised during PRD verify before plan-build. The phasing in §8 stays the same; only Phase 2 changes from "add tab to existing modal" to "add new route + view."

**Predictor / risk-assessment extension considered and rejected**: the intention's "What Good Looks Like" says "Same surface for `market_predictors` on the predictors view and `analyst_risk_assessments` on the risk view, *if* it's cheap to extend the same pattern." The modal-tab approach doesn't translate cleanly to predictor or risk-assessment rows because (a) those views render flat lists, not modals, and (b) each row has 1:1 LLM-call ownership rather than the multi-call shape predictions might grow into. Extending would require building a different inline pattern (probably an expander row) for each view. That's substantially more than "cheap." Both surfaces are explicitly out of scope per §6.

### 4.2 Data Model Changes

**None.** The schema already contains everything needed:
- `prediction.market_predictions.llm_usage_id uuid` (added by `llm-reasoning-capture`)
- `public.llm_usage.reasoning_content text` (added by `llm-reasoning-capture`)
- `public.llm_usage.reasoning_tokens integer` (nullable; gemma4:e4b doesn't populate it)
- `public.llm_usage.reasoning_truncated boolean default false`

The join is `market_predictions.llm_usage_id::text = llm_usage.run_id::text` because one column is `uuid` and the other is `text`. (Verified during the manual smoke pass after the llm-reasoning-capture merge.)

No migrations. No new tables. No new columns.

### 4.3 API Changes

#### 4.3.1 New endpoint: `GET /markets/predictions/:predictionId/llm-calls`

**Location**: `apps/api/src/markets/markets.controller.ts`, sibling to the existing `getPredictionProvenance` at line 1013.

**Signature**:
```ts
@Get('predictions/:predictionId/llm-calls')
async getPredictionLlmCalls(
  @Req() req: { user?: AuthenticatedUser },
  @Param('predictionId') predictionId: string,
  @Query('organizationSlug') orgSlug: string,
) {
  const user = this.getUser(req);
  const identity = this.resolveIdentity(user, { query: orgSlug });
  return this.markets.getPredictionLlmCalls(
    identity.organizationSlug,
    identity.userId,
    predictionId,
  );
}
```

**Auth**: same pattern as `getPredictionProvenance` — `getUser(req)` throws on missing identity, `resolveIdentity` enforces org slug consistency, `markets.requireRead(userId, orgSlug)` checks the existing `markets.instruments.read` permission.

**Response shape**:
```json
{
  "predictionId": "abc-123-...",
  "calls": [
    {
      "runId": "uuid-of-llm_usage-row",
      "provider": "ollama_local",
      "model": "gemma4:e4b",
      "tier": "local",
      "inputTokens": 412,
      "outputTokens": 287,
      "reasoningTokens": null,
      "totalCost": 0,
      "reasoningContent": "Thinking Process:\n\n1. Identify Role: Technical Analyst...",
      "reasoningTruncated": false,
      "createdAt": "2026-04-08T23:31:42.123Z"
    }
  ]
}
```

**Empty state**: when `market_predictions.llm_usage_id` is null OR the joined `llm_usage` row has `reasoning_content = null`, returns `{predictionId, calls: []}` — never an error, never a 404.

**Plural endpoint name + array response shape** is deliberately forward-compatible. Today each `market_predictions` row corresponds to exactly one LLM call (1:1 join), so `calls.length` is 0 or 1. If a future code path links multiple LLM calls to one prediction (e.g., a multi-pass refinement), the same endpoint shape supports it without a breaking change.

#### 4.3.2 New service method: `MarketsService.getPredictionLlmCalls`

**Location**: `apps/api/src/markets/markets.service.ts`, sibling to `getPredictionProvenance` at line 700.

**Signature**:
```ts
async getPredictionLlmCalls(
  organizationSlug: string,
  userId: string,
  predictionId: string,
): Promise<{predictionId: string; calls: LlmCallRow[]}>
```

**Implementation** (raw SQL, matches the existing `db.rawQuery` pattern in this file):
```sql
select
  lu.run_id,
  lu.provider,
  lu.model,
  lu.tier,
  lu.input_tokens,
  lu.output_tokens,
  lu.reasoning_tokens,
  lu.total_cost,
  lu.reasoning_content,
  lu.reasoning_truncated,
  lu.created_at
from prediction.market_predictions mp
join public.llm_usage lu on lu.run_id::text = mp.llm_usage_id::text
where mp.id = $1
  and mp.organization_slug = $2
  and lu.reasoning_content is not null
order by lu.created_at desc
```

The `lu.reasoning_content is not null` filter is what produces the empty-state behavior. The `mp.organization_slug = $2` constraint is the second-line defense against an authenticated user requesting a prediction id that belongs to another org (first line is `requireRead`).

**Service calls** (in order):
1. `await this.schema.ensureSchema()` — same first-line as the other read methods.
2. `await this.requireRead(userId, organizationSlug)` — RBAC check.
3. Raw query above with `[predictionId, organizationSlug]`.
4. Map rows → camelCase response shape.
5. Return `{predictionId, calls: mappedRows}`.

**Errors**: if `requireRead` throws `ForbiddenException`, propagate. If the SQL errors, propagate. If the prediction id doesn't exist, return `{predictionId, calls: []}` — same shape as no-reasoning-yet, by design (we don't want to leak existence information to non-org users).

#### 4.3.3 No changes to other endpoints

`getPredictionProvenance`, `getDashboard`, `listInstruments`, etc. are untouched. Their response payloads stay byte-identical (success criterion §2.6).

### 4.4 Frontend Changes

#### 4.4.1 New tab in `AnalystPredictionModal.vue`

**Location**: `apps/web/src/components/AnalystPredictionModal.vue`, alongside the existing tab buttons at line 329-335.

**New tab type**: extend the existing `activeTab` ref union:
```ts
const activeTab = ref<'analysis' | 'evidence' | 'risk' | 'memory' | 'challenge' | 'reasoning'>('analysis');
```

**New tab button**: insert between `memory` and `challenge` (logical reading order: see what the model thought, then read challenges from other analysts). Disabled state when no reasoning available:
```vue
<button
  :class="{ active: activeTab === 'reasoning' }"
  :disabled="!hasReasoning"
  :title="hasReasoning ? '' : 'This analyst call did not produce reasoning content'"
  @click="activeTab = 'reasoning'"
>
  Reasoning
</button>
```

**New computed**: `hasReasoning` reads from a new local ref populated by the lazy fetch. Initially `false` until the fetch completes; flips to `true` when calls.length > 0.

**New lazy-fetch logic**: extend the existing `watch(() => [props.isOpen, currentIndex.value], ...)` block at line 91. Add a sibling fetch alongside `provenance.fetchProvenance`:
```ts
watch(() => [props.isOpen, currentIndex.value], async ([open]) => {
  if (open && analyst.value?.prediction_id) {
    provenance.fetchProvenance(analyst.value.prediction_id);
    await loadLlmCalls(analyst.value.prediction_id);  // NEW
  }
  activeTab.value = 'analysis';
  // ... existing reset logic
});
```

**`loadLlmCalls` function**:
```ts
const llmCalls = ref<LlmCall[]>([]);
const llmCallsLoading = ref(false);
const llmCallsError = ref<string | null>(null);
const hasReasoning = computed(() => llmCalls.value.length > 0);

async function loadLlmCalls(predictionId: string) {
  llmCalls.value = [];
  llmCallsLoading.value = true;
  llmCallsError.value = null;
  try {
    const res = await api.get<{predictionId: string; calls: LlmCall[]}>(
      `/predictions/${predictionId}/llm-calls`
    );
    llmCalls.value = res.calls;
  } catch (err) {
    llmCallsError.value = err instanceof Error ? err.message : String(err);
  } finally {
    llmCallsLoading.value = false;
  }
}
```

The `LlmCall` interface is local to the file (no shared types package needed for this scope).

**New tab content** (rendered when `activeTab === 'reasoning'`):
```vue
<div v-if="activeTab === 'reasoning'">
  <div v-if="llmCallsLoading" class="section"><ion-note>Loading reasoning...</ion-note></div>
  <div v-else-if="llmCallsError" class="section"><ion-note color="danger">{{ llmCallsError }}</ion-note></div>
  <div v-else-if="llmCalls.length === 0" class="section">
    <ion-note>No reasoning content captured for this call.</ion-note>
  </div>
  <div v-else class="section" v-for="call in llmCalls" :key="call.runId">
    <div class="reasoning-header">
      <strong>{{ call.provider }}</strong> / <code>{{ call.model }}</code>
      <span v-if="call.reasoningTruncated" class="reasoning-truncated">(truncated at 64 KB)</span>
      <span class="reasoning-meta">{{ call.inputTokens }} in / {{ call.outputTokens }} out</span>
    </div>
    <pre class="reasoning-pre">{{ call.reasoningContent }}</pre>
  </div>
</div>
```

**Styling**: the existing modal already has a `.section` class. New CSS additions are minimal:
- `.reasoning-pre` — `white-space: pre-wrap`, `font-family: monospace`, `font-size: 0.8rem`, `max-height: 60vh`, `overflow: auto`, padded background, border-radius. This is the only "design" decision in the effort. Goal is *readable*, not pretty.
- `.reasoning-header` — flex row, bottom margin.
- `.reasoning-truncated` — small warning color.
- `.reasoning-meta` — opacity 0.6, smaller font.

#### 4.4.2 No new routes, no new views, no router changes

`apps/web/src/router/index.ts` is untouched. The existing modal-based interaction pattern absorbs the entire new surface.

#### 4.4.3 No changes to `tenant.store.ts`, `useApi.ts`, or `bootstrap-auth.ts`

The existing `useApi.get(path)` carries the `Authorization: Bearer <token>` header from the tenant store, which already works post-`auth-bootstrap`. The new endpoint piggybacks on that machinery.

### 4.5 Infrastructure Requirements

**None.**
- No new env vars.
- No new database migrations.
- No new build/dev tooling.
- No new package dependencies.
- No restart of any sidecar (Postgres, Vite, Ollama).
- The API will need to be restarted once after the new controller/service code is built — same as every other API code change. Standard.

## 5. Non-Functional Requirements

- **Performance**: the new endpoint executes a single indexed join (`market_predictions.id` is PK + `llm_usage` is keyed by `run_id`). Expected latency p50 < 20 ms, p99 < 100 ms on the dev DB. The endpoint is opt-in (only fired when the user clicks the new tab), so it has zero impact on the dashboard load path.
- **Security**: identical to all other markets read endpoints. JWT validation via `AuthMiddleware`, RBAC via `requireRead → markets.instruments.read`. The `WHERE mp.organization_slug = $2` clause in the SQL prevents IDOR (insecure direct object reference) attacks where a user with read access on org A guesses a prediction id belonging to org B — even if they bypass `requireRead` somehow, the SQL won't return the row.
- **Privacy**: reasoning content can contain hallucinated PII or model uncertainty that's awkward to expose to end users. This effort restricts visibility to authenticated users with `markets.instruments.read` on the owning org — same audience that already sees raw prediction rationales and trade data. The reasoning capture effort flagged sanitization as a separate follow-up; this effort does not regress on that posture.
- **Scalability**: the join is per-prediction, not per-leaderboard. No N+1 risk. The expected response size is one row of ≤64 KB plus a small JSON envelope, so payloads stay under 100 KB even on long reasoning chains.
- **Compatibility**: strictly additive. New endpoint, new tab, no changes to existing endpoints or views. The five pre-existing `apps/web` typecheck errors on `main` (`HTMLElement` / `window` undefined in `ActivityPanel.vue`, `useApi.ts`, `activity.store.ts`) are unrelated to this effort and remain unchanged.
- **DI compliance**: no new constructor parameters in services, but if any are added during implementation they must use explicit `@Inject(ClassName)` per `CLAUDE.md`.

## 6. Out of Scope

- **A real "analyst post-mortem" page or calibration drilldown.** That's a separate downstream effort. This effort is "make the captured reasoning visible at all in the simplest possible way."
- **Per-row reasoning views on `/predictors`, `/risk` views.** The intention said "if cheap to extend, otherwise follow-on." The cheap approach turned out to be a tab in the existing prediction modal, which doesn't translate cleanly to predictor or risk-assessment rows. Those surfaces get follow-on efforts.
- **Risk debate per-turn reasoning rendering.** The arbiter's `llm_usage_id` is already on the `risk_debates` row, but visualizing the three-way blue/red/arbiter debate is a bigger interaction-design problem. Out of scope.
- **Token streaming of reasoning.** Same as in the reasoning-capture effort: buffered only.
- **Reasoning content sanitization.** The endpoint returns whatever's in `llm_usage.reasoning_content`. PII/copyright sanitization is a separate effort with its own legal review.
- **Per-call cost rollups, $/prediction calculations.** `llm_usage` has `total_cost` but the UI just displays it as a number; no aggregation or analytics in this effort.
- **Editing, exporting, sharing, deep-linking to a reasoning view.** All reasonable follow-ons. None required for "make it visible at all."
- **Search inside reasoning text.** Out of scope.
- **Updating the Challenge SSE stream to include reasoning in challenger prompts.** Separate effort (also flagged in the reasoning-capture completion report).
- **Backfilling reasoning content for legacy `market_predictions` rows.** Pre-effort rows have `llm_usage_id = null` and stay that way. The disabled-tab empty state handles them.
- **A new `markets.reasoning.read` permission.** Reusing `markets.instruments.read` for now. Documented as a follow-on if reasoning content turns out to need sharper gating.
- **Unit/integration tests for the new tab UI.** The web app has zero existing component test infrastructure (no Vitest, no @testing-library, no Cypress for components — only `vue-tsc --noEmit`). Adding a test framework just for one new tab is over-scope. The new tab is verified by the manual smoke pass (open modal, click tab, see reasoning).

## 7. Dependencies & Risks

### Dependencies
- ✅ `llm-reasoning-capture` merged and producing rows. Verified live: 22/23 calls (96%) have non-null `reasoning_content`, 26/26 `market_predictors` rows have populated `llm_usage_id`.
- ✅ `auth-bootstrap` merged. The new endpoint needs real JWT validation + RBAC, both of which work post-bootstrap. `markets.instruments.read` permission is granted to `super-admin`, `owner`, and `member` roles in the seed.
- ✅ `gemma4:e4b` actively producing reasoning content for the markets pipeline. Verified live during the merge smoke pass.
- The web app's existing modal pattern continues to be the prediction-detail surface. **No concurrent refactor** of `AnalystPredictionModal.vue`, `DashboardView.vue`, or `markets.controller.ts` should land during this effort.

### Risks & Mitigations

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | The `llm_usage_id::text = run_id::text` join cast is fragile if the type of either column changes. | Low | The join is enforced inside the new service method only, not exposed in the endpoint contract. If types are unified later, the SQL is one-line to fix. Documented in code comment. |
| 2 | Reasoning content can be up to 64 KB per row. Rendering a `<pre>` block of that size on every tab click could feel sluggish. | Low | `max-height: 60vh; overflow: auto` on `.reasoning-pre`. Modern browsers handle 64 KB of text in a `<pre>` trivially. If it ever becomes a problem, a simple "show more" truncation is the fix — not in scope. |
| 3 | The new tab's lazy fetch fires for every prev/next navigation in the modal, which could feel chatty if a user clicks through 5 analysts quickly. | Low | The fetch is fast (single indexed join) and the result is small (≤100 KB). Same chattiness already exists for `provenance.fetchProvenance`. If it becomes a problem, add a simple per-prediction-id cache in the component — out of scope for this effort. |
| 4 | The `WHERE mp.organization_slug = $2` constraint is critical for IDOR prevention. A typo or future refactor could drop it. | Medium | Documented in the SQL with a comment (`-- IDOR defense: even if requireRead is bypassed, the SQL refuses to leak rows from other orgs`). Phase 0 includes a manual curl test against the wrong org — must return `{calls: []}`, not the actual content. |
| 5 | The disabled tab state requires reasoning state to be known at modal-open time, but the fetch is async. There's a brief window where the tab is rendered as enabled before the first fetch resolves and may flip to disabled if no reasoning exists. | Low | Initial state of `hasReasoning` is `false`, so the tab starts disabled and flips to enabled only when reasoning lands. Worst case is a brief disabled flash — acceptable. Documented in the tab implementation. |
| 6 | If gemma4:e4b's reasoning turns out to be useless / verbose / hallucinated, the success criterion (4) is met (data is visible) but the value criterion (validating reasoning quality before bigger UX work) reveals the model is unfit. | High value, low risk to the effort | This is exactly the value criterion. The effort's goal is to surface the reasoning so we can find this out. If it's bad, we either swap models or invest in prompt engineering — both are downstream of this effort. |
| 7 | The `llm_usage` table is a cross-cutting Orchestrator-derived table. If the upstream Orchestrator AI repo refactors the column shape, this effort's read query breaks. | Low | The SQL only references columns that have been stable in `llm_usage` since the beginning of divinr.ai. The reasoning_* columns were added by the divinr-side llm-reasoning-capture effort, so they won't disappear unilaterally. |

## 8. Phasing

Each phase is independently mergeable with its own quality gate.

### Phase 0 — Discovery & confirmation (no production code)
- Confirm there is no `/predictions/:id` route in `apps/web/src/router/index.ts`. (Verified during PRD discovery — there is none.)
- Confirm `AnalystPredictionModal.vue` is the right inline surface and is opened from `DashboardView.vue:317`. (Verified.)
- Confirm `getPredictionProvenance` at `markets.service.ts:700` is the right pattern to copy for the new service method. (Verified.)
- Identify a known prediction id with non-null `llm_usage_id` in the live dev DB so Phase 3 has a concrete curl target.
- Output: short notes appended to `notes-phase-0.md` in the effort dir, or inline in the plan if minimal. No code changes.

### Phase 1 — Backend endpoint
- Add `MarketsService.getPredictionLlmCalls` per §4.3.2.
- Add `markets.controller.ts` route per §4.3.1.
- Verify via curl with a real bearer token from the live API:
  - **Happy path**: 200 + non-empty `calls` array on a known reasoning-bearing prediction id.
  - **Empty state**: 200 + `calls: []` on a prediction id with `llm_usage_id = null`.
  - **Auth missing**: 401 with no token.
  - **Auth wrong org**: 200 + `calls: []` for a prediction id belonging to a different org (IDOR defense).
  - **Auth wrong perm**: 403 if a user without `markets.instruments.read` is reachable (skip if no such user is easy to construct; the IDOR test above plus the existing `requireRead` test infra is sufficient coverage).
- **Quality gate**: lint, typecheck, build, `pnpm --filter @divinr/api run test:unit`, `pnpm -w run ci:markets`. All curl scenarios pass.

### Phase 2 — Frontend tab
- Add the `'reasoning'` literal to the `activeTab` union in `AnalystPredictionModal.vue`.
- Add the new tab button between `memory` and `challenge`, with `:disabled="!hasReasoning"`.
- Add `llmCalls`, `llmCallsLoading`, `llmCallsError`, `hasReasoning` refs/computed, and `loadLlmCalls(predictionId)` function.
- Extend the existing `watch([isOpen, currentIndex])` to call `loadLlmCalls`.
- Add the tab content `<div v-if="activeTab === 'reasoning'">` block per §4.4.1.
- Add the four new CSS rules.
- **Quality gate**: lint, typecheck, build, web typecheck (must stay at 5 pre-existing errors — no new ones).

### Phase 3 — Live smoke pass
- Restart the API to load the new controller.
- Open `http://localhost:7101/` in the browser, navigate to the dashboard, click an analyst stance on a prediction card.
- Click the new "Reasoning" tab. Expected: real reasoning content from gemma4:e4b renders in a monospace pre-block.
- Click prev/next analyst. Expected: tab content updates to the new analyst's reasoning, or shows the disabled state if the new analyst has no reasoning.
- Use a non-admin user (or an org the user has no membership in) and confirm the request returns `{calls: []}` rather than leaking content.
- Document findings in the completion report. If the reasoning content is useful, note it. If it's bad / hallucinated / verbose, note that too — that's the point of this effort.
- **Quality gate**: manual smoke pass green; `pnpm -w run ci:markets` re-run one final time.

### Phase 4 — Completion report + commit + push
- Write `docs/efforts/current/completion-report.md` per the format used by the prior two efforts.
- Document each §2 success criterion's actual result (live numbers from the smoke pass).
- Note any of the §7 risks that materialized.
- Note follow-up work that's now unblocked (calibration drilldown, predictor/risk reasoning views, sanitization, the long-term `/predictions/:id` route if it ever becomes necessary).
- Commit + push as a single small effort branch (`effort/see-your-reasoning`). Open a PR.
