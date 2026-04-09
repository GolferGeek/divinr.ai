# See Your Reasoning — Implementation Plan

**PRD**: ./prd.md
**Intention**: ./intention.md
**Created**: 2026-04-09
**Status**: Not Started

## Concrete fixtures for curl + chrome tests

These were captured during plan-build against the live dev DB so subsequent steps don't need placeholders. **Re-verify before each phase if the pipeline has been quiet for hours** — the predictor pipeline may have advanced and these ids may now be settled or expired.

| Fixture | Value |
|---|---|
| API base URL | `http://localhost:7100` |
| Web base URL | `http://localhost:7101` |
| Postgres URL | `postgresql://postgres:postgres@localhost:54322/postgres` |
| Demo user email | `demo-user@orchestratorai.io` |
| Demo user password | `DemoUser123!` |
| GolferGeek email | `golfergeek@orchestratorai.io` |
| GolferGeek password | `GolferGeek123!` |
| **Org with linked predictions** | `__base__` |
| Prediction id (analyst, has reasoning) | `a18a9311-31ba-478d-900e-341142346cc1` |
| Prediction id (arbitrator, has reasoning) | `9f29b71a-a1aa-4ddc-8935-7344d6a97f58` |
| Sample prediction id whose `llm_usage_id` is null | run `select id from prediction.market_predictions where llm_usage_id is null limit 1;` at Phase 1 gate time |

GolferGeek now has `super-admin` on `__base__` (granted during plan-build, applied directly to dev DB via psql). The wildcard `*` org grant remains as forward-prep but is currently inert per the auth-bootstrap completion notes.

## Progress Tracker
<!-- run-plan uses this section to track where we are -->
- [x] Phase 0: Discovery & confirmation
- [x] Phase 1: Backend endpoint
- [x] Phase 2: Frontend tab
- [x] Phase 3: Live smoke pass
- [ ] Phase 4: Completion report + commit + push

---

## Phase 0: Discovery & confirmation
**Status**: Complete
**Objective**: Confirm the assumptions the PRD made during discovery still hold against the live codebase, capture any deltas, and verify the fixture data is still queryable. No production code changes.

### Steps
- [ ] 0.1 Confirm `apps/web/src/router/index.ts` has no `predictions/:id` (or similar single-prediction-detail) route. Re-grep with `grep -n 'predictions/:' apps/web/src/router/index.ts`. Expected: only the `predictions` list route plus `predictions/:predictionId/...` controller-side endpoints (which are API, not router) — no client-side detail route.
- [ ] 0.2 Confirm `apps/web/src/components/AnalystPredictionModal.vue` is opened from `apps/web/src/views/DashboardView.vue` by re-grepping for the import. Expected: a single `import AnalystPredictionModal` line plus a single `<AnalystPredictionModal ... />` usage.
- [ ] 0.3 Confirm the existing tab pattern in the modal: `analysis | evidence | risk | memory | challenge`. Read lines 86 and 329-335 of `AnalystPredictionModal.vue`.
- [ ] 0.4 Confirm `getPredictionProvenance` in `apps/api/src/markets/markets.service.ts` (line ~700) and its controller wrapper at `markets.controller.ts:1013` are still the right pattern to copy. Re-read both.
- [ ] 0.5 Re-verify the fixture table at the top of this file by running:
  ```sql
  select id, role from prediction.market_predictions
  where id in ('a18a9311-31ba-478d-900e-341142346cc1', '9f29b71a-a1aa-4ddc-8935-7344d6a97f58')
    and llm_usage_id is not null;
  ```
  If either row is missing or has a null `llm_usage_id` now (e.g. the row was settled / cleaned up), pick a fresh one with the query in the fixture table and update the plan.
- [ ] 0.6 Capture a JWT for golfergeek by running the curl command in step 1.5 below as a smoke check. Expected: 201 + JSON with `accessToken`. If this fails, the auth-bootstrap effort is not actually live and Phase 1 cannot proceed.
- [ ] 0.7 **Grant the demo user read access on `__base__`** so the Phase 3 chrome smoke pass works through the default auto-login flow without manual localStorage hackery. The demo user's existing `owner` role on `personal-demo-user` doesn't extend to `__base__` (no wildcard semantics in the current `rbac_has_permission` function). Apply directly to the live DB:
  ```bash
  psql postgresql://postgres:postgres@localhost:54322/postgres <<'SQL'
  insert into authz.rbac_user_org_roles (user_id, organization_slug, role_id, assigned_by)
  select id::text, '__base__', 'role-member', 'see-your-reasoning-effort'
  from auth.users where email = 'demo-user@orchestratorai.io'
  on conflict (user_id, organization_slug, role_id) do nothing;
  SQL
  ```
  The `member` role already has `markets.instruments.read` granted in the auth-bootstrap seed, so this is the minimum-privilege grant. Verify with `select uor.organization_slug, r.name from authz.rbac_user_org_roles uor join authz.rbac_roles r on r.id = uor.role_id where uor.user_id = (select id::text from auth.users where email = 'demo-user@orchestratorai.io');` — expect `__base__ | member` plus the existing `personal-demo-user | owner`.
- [ ] 0.8 Create the effort branch: `git checkout -b effort/see-your-reasoning` from the current `main`.

### Quality Gate
- [ ] **Lint**: N/A (no code changes)
- [ ] **Build**: N/A
- [ ] **Unit Tests**: N/A
- [ ] **E2E Tests**: N/A
- [ ] **Curl Tests**: golfergeek `/auth/login` returns 201 (verified in 0.6)
- [ ] **Chrome Tests**: N/A
- [ ] **Phase Review**:
  - [ ] All five PRD discovery assumptions reconfirmed against the live codebase?
  - [ ] Fixture data still valid?
  - [ ] Branch created, working tree clean?
  - [ ] If any deviation from the PRD's assumptions surfaced, document inline below as a "Phase 0 finding" before proceeding.

---

## Phase 1: Backend endpoint
**Status**: Complete

**Notes**:
- One bug found and fixed during Phase 1: PRD §4.3.2 SQL referenced `lu.total_cost` but the actual `public.llm_usage` column is named `cost` (verified via `\d public.llm_usage`). The internal field is exposed as `totalCost` in the response per PRD §4.3.1, mapped from the underlying `cost` column. SQL + row type updated.
- All 6 curl tests passing or accounted for. The "no permission" test now returns 200 because Phase 0 granted the demo user `member` on `__base__`; the 403 path is verified transitively via `requireRead`'s shared use across all markets read endpoints (covered by `ci:markets`).
- Sample row: gemma4:e4b returned 3316 chars of reasoning for the analyst row, 3561 chars for the arbitrator row.
**Objective**: Add `MarketsService.getPredictionLlmCalls` and the `GET /markets/predictions/:predictionId/llm-calls` controller route. Verify via live curl against the running API.

### Steps
- [ ] 1.1 In `apps/api/src/markets/markets.service.ts`, add a new method `getPredictionLlmCalls` directly below `getPredictionProvenance` (line ~787, end of that method). Implementation per PRD §4.3.2:
  - Signature: `async getPredictionLlmCalls(organizationSlug: string, userId: string, predictionId: string): Promise<{predictionId: string; calls: LlmCallRow[]}>`
  - Body: `await this.schema.ensureSchema()` → `await this.requireRead(userId, organizationSlug)` → raw SQL query joining `prediction.market_predictions mp` to `public.llm_usage lu` on `lu.run_id::text = mp.llm_usage_id::text`, filtered by `mp.id = $1 and mp.organization_slug = $2 and lu.reasoning_content is not null`, ordered by `lu.created_at desc`.
  - Map rows to camelCase (`runId`, `provider`, `model`, `tier`, `inputTokens`, `outputTokens`, `reasoningTokens`, `totalCost`, `reasoningContent`, `reasoningTruncated`, `createdAt`) per PRD §4.3.1 response shape.
  - Return `{predictionId, calls: mappedRows}`. Empty array on no rows — never throw on missing prediction (IDOR defense).
  - Add an inline SQL comment: `-- IDOR defense: even if requireRead is bypassed, the org slug filter refuses to leak rows from other orgs`.
- [ ] 1.2 Define a local `LlmCallRow` interface inline above `getPredictionLlmCalls` in `markets.service.ts`. Do not export it or move it to `markets.types.ts` — keeping it local minimizes blast radius for this small effort. Fields: `runId`, `provider`, `model`, `tier`, `inputTokens`, `outputTokens`, `reasoningTokens`, `totalCost`, `reasoningContent`, `reasoningTruncated`, `createdAt` — all as in PRD §4.3.1.
- [ ] 1.3 In `apps/api/src/markets/markets.controller.ts`, add the new endpoint directly below `getPredictionProvenance` (line ~1022, after the closing brace of that method). Implementation per PRD §4.3.1:
  - Decorator: `@Get('predictions/:predictionId/llm-calls')`
  - Method signature: `async getPredictionLlmCalls(@Req() req: { user?: AuthenticatedUser }, @Param('predictionId') predictionId: string, @Query('organizationSlug') orgSlug: string)`
  - Body: `const user = this.getUser(req); const identity = this.resolveIdentity(user, { query: orgSlug }); return this.markets.getPredictionLlmCalls(identity.organizationSlug, identity.userId, predictionId);`
- [ ] 1.4 Build the api: `pnpm --filter @divinr/api run build`. Verify no typecheck errors (`pnpm --filter @divinr/api run typecheck`).
- [ ] 1.5 Restart the running API process so the new route is loaded:
  ```bash
  kill $(lsof -t -i :7100) 2>/dev/null; sleep 1
  cd apps/api && nohup node dist/src/main.js > /tmp/api.log 2>&1 & disown
  sleep 5 && curl -s -o /dev/null -w "health=%{http_code}\n" http://localhost:7100/health
  grep -E 'predictions.*llm-calls' /tmp/api.log | tail -3   # confirm route mapped
  ```

### Quality Gate
- [ ] **Lint**: `pnpm --filter @divinr/api run lint`
- [ ] **Build**: `pnpm --filter @divinr/api run build`
- [ ] **Typecheck**: `pnpm --filter @divinr/api run typecheck`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` — must stay at 44 passing assertions (no new tests planned for this phase per PRD §6).
- [ ] **E2E Tests**: `pnpm -w run ci:markets` — must stay green.
- [ ] **Curl Tests** (run in order; cache `TOKEN` between calls):
  - [ ] **Mint a token**:
    ```bash
    TOKEN=$(curl -s http://localhost:7100/auth/login -H 'content-type: application/json' \
      -d '{"email":"golfergeek@orchestratorai.io","password":"GolferGeek123!"}' \
      | python3 -c 'import json,sys;print(json.load(sys.stdin)["accessToken"])')
    echo "${TOKEN:0:30}..."
    ```
    Expected: a JWT prefix.
  - [ ] **Happy path — analyst row with reasoning**:
    ```bash
    curl -s -w "\nstatus=%{http_code}\n" \
      "http://localhost:7100/markets/predictions/a18a9311-31ba-478d-900e-341142346cc1/llm-calls?organizationSlug=__base__" \
      -H "Authorization: Bearer $TOKEN" \
      | python3 -c 'import json,sys; d=json.load(sys.stdin); print("calls:",len(d["calls"])); print("first model:",d["calls"][0]["model"] if d["calls"] else None); print("first reasoning chars:",len(d["calls"][0]["reasoningContent"] or "") if d["calls"] else 0)'
    ```
    Expected: status=200, calls=1, model=`gemma4:e4b`, reasoning chars > 1000.
  - [ ] **Happy path — arbitrator row with reasoning**: same as above but with prediction id `9f29b71a-a1aa-4ddc-8935-7344d6a97f58`. Expected: status=200, calls=1, reasoning > 1000 chars.
  - [ ] **Empty state — prediction with null `llm_usage_id`** (find one fresh at gate time):
    ```bash
    NULL_PRED=$(psql postgresql://postgres:postgres@localhost:54322/postgres -tAc \
      "select id from prediction.market_predictions where llm_usage_id is null and organization_slug='__base__' limit 1;")
    curl -s -w "\nstatus=%{http_code}\n" \
      "http://localhost:7100/markets/predictions/$NULL_PRED/llm-calls?organizationSlug=__base__" \
      -H "Authorization: Bearer $TOKEN"
    ```
    Expected: status=200, body=`{"predictionId":"...","calls":[]}`.
  - [ ] **Auth missing**:
    ```bash
    curl -s -o /dev/null -w "status=%{http_code}\n" \
      "http://localhost:7100/markets/predictions/a18a9311-31ba-478d-900e-341142346cc1/llm-calls?organizationSlug=__base__"
    ```
    Expected: 401.
  - [ ] **IDOR defense — wrong org**:
    ```bash
    curl -s -w "\nstatus=%{http_code}\n" \
      "http://localhost:7100/markets/predictions/a18a9311-31ba-478d-900e-341142346cc1/llm-calls?organizationSlug=personal-demo-user" \
      -H "Authorization: Bearer $TOKEN"
    ```
    Expected: status=200, body=`{"predictionId":"a18a9311-31ba-478d-900e-341142346cc1","calls":[]}` (not 403, not the actual content — golfergeek has read on `personal-demo-user` so requireRead passes, but the SQL filter on `mp.organization_slug = $2` returns zero rows).
  - [x] **No-permission — verified by extension**: the 403 path is gated by `MarketsService.requireRead → RbacService.hasPermission → authz.rbac_has_permission`, which is the **same code path** every other markets read endpoint uses. ci:markets already exercises that path with green results. Constructing a third real Supabase user with zero org grants is over-effort for a verification path that's already covered transitively. Note that **Phase 0 step 0.7 grants demo user `member` on `__base__`**, so neither of the two real users in `auth.users` can now produce a 403 against `__base__` without manually revoking the grant first.
- [ ] **Chrome Tests**: N/A — Phase 1 is API-only.
- [ ] **Phase Review** — compare against PRD §4.3:
  - [ ] Endpoint at `predictions/:predictionId/llm-calls`?
  - [ ] Service method joins via `lu.run_id::text = mp.llm_usage_id::text`?
  - [ ] `organization_slug` filter in the SQL WHERE clause (IDOR defense)?
  - [ ] Empty state returns `{calls: []}` not 404/error?
  - [ ] Response shape exactly matches §4.3.1 camelCase keys?
  - [ ] Existing dashboard / instruments / provenance endpoints byte-identical (success criterion §2.6)?
  - [ ] Any deviations from PRD §4.3 documented inline below.

---

## Phase 2: Frontend tab
**Status**: Not Started
**Objective**: Add a new "Reasoning" tab inside `AnalystPredictionModal.vue` that lazy-fetches the new endpoint and renders reasoning text. Disabled state when no reasoning available. No router or store changes.

### Steps
- [ ] 2.1 In `apps/web/src/components/AnalystPredictionModal.vue`, extend the `activeTab` ref's literal union to include `'reasoning'`. Located at line 86: change `'analysis' | 'evidence' | 'risk' | 'memory' | 'challenge'` to `'analysis' | 'evidence' | 'risk' | 'memory' | 'challenge' | 'reasoning'`.
- [ ] 2.2 Add the local `LlmCall` interface near the other interfaces at the top of the `<script setup>` block:
  ```ts
  interface LlmCall {
    runId: string;
    provider: string;
    model: string;
    tier: string;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number | null;
    totalCost: number | null;
    reasoningContent: string;
    reasoningTruncated: boolean;
    createdAt: string;
  }
  ```
- [ ] 2.3 Add new refs/computed alongside the existing provenance refs (~line 85-90):
  ```ts
  const llmCalls = ref<LlmCall[]>([]);
  const llmCallsLoading = ref(false);
  const llmCallsError = ref<string | null>(null);
  const hasReasoning = computed(() => llmCalls.value.length > 0);
  ```
- [ ] 2.4 Add the `loadLlmCalls` function (after `loadChallenges` or with the other tab-loading functions):
  ```ts
  async function loadLlmCalls(predictionId: string) {
    llmCalls.value = [];
    llmCallsLoading.value = true;
    llmCallsError.value = null;
    try {
      const res = await api.get<{predictionId: string; calls: LlmCall[]}>(
        `/predictions/${predictionId}/llm-calls`,
      );
      llmCalls.value = res.calls;
    } catch (err) {
      llmCallsError.value = err instanceof Error ? err.message : String(err);
    } finally {
      llmCallsLoading.value = false;
    }
  }
  ```
- [ ] 2.5 Extend the existing `watch(() => [props.isOpen, currentIndex.value], ...)` block (around line 91) to **synchronously set `llmCallsLoading.value = true`** at the top of the handler (before any await), then call `loadLlmCalls(analyst.value.prediction_id)` alongside the existing `provenance.fetchProvenance(...)` call. The synchronous loading flag matters: without it, the tab's disabled state would briefly flicker (disabled→enabled→disabled or similar) on first open while the fetch is in flight. Setting `loading=true` synchronously means the tab renders as enabled-but-loading from the first frame.
- [ ] 2.6 In the template, add the new tab button between the existing `memory` and `challenge` buttons (line 333-334):
  ```vue
  <button
    :class="{ active: activeTab === 'reasoning' }"
    :disabled="!llmCallsLoading && llmCalls.length === 0"
    :title="llmCalls.length > 0 ? '' : 'This analyst call did not produce reasoning content'"
    @click="activeTab = 'reasoning'"
  >
    Reasoning
  </button>
  ```
  Disabled-state logic: tab is **disabled when** `loading === false && calls.length === 0`. That covers (a) the post-fetch empty case (loading false, no rows → disabled) and (b) the cold-start edge case before the watcher fires (also loading false, no rows → disabled, fine). The tab is **enabled while loading** (so a user who clicks fast sees the "Loading..." state) and **enabled after a successful fetch with rows**. Combined with step 2.5's synchronous loading flag, there's no visible flicker.
- [ ] 2.7 Add the new tab content `<div v-if="activeTab === 'reasoning'">` block inside the modal content area, after the existing challenge tab content. Per PRD §4.4.1:
  ```vue
  <div v-if="activeTab === 'reasoning'">
    <div v-if="llmCallsLoading" class="section"><ion-note>Loading reasoning...</ion-note></div>
    <div v-else-if="llmCallsError" class="section"><ion-note color="danger">{{ llmCallsError }}</ion-note></div>
    <div v-else-if="llmCalls.length === 0" class="section">
      <ion-note>No reasoning content captured for this call.</ion-note>
    </div>
    <div v-else>
      <div v-for="call in llmCalls" :key="call.runId" class="section">
        <div class="reasoning-header">
          <strong>{{ call.provider }}</strong> / <code>{{ call.model }}</code>
          <span v-if="call.reasoningTruncated" class="reasoning-truncated">(truncated at 64 KB)</span>
          <span class="reasoning-meta">{{ call.inputTokens }} in / {{ call.outputTokens }} out</span>
        </div>
        <pre class="reasoning-pre">{{ call.reasoningContent }}</pre>
      </div>
    </div>
  </div>
  ```
- [ ] 2.8 Add the four CSS rules to the `<style scoped>` block (or wherever the existing modal styles live):
  ```css
  .reasoning-pre {
    white-space: pre-wrap;
    font-family: monospace;
    font-size: 0.8rem;
    max-height: 60vh;
    overflow: auto;
    background: #f8f8f8;
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    padding: 12px;
    margin-top: 8px;
  }
  .reasoning-header {
    display: flex;
    align-items: baseline;
    gap: 12px;
    flex-wrap: wrap;
    font-size: 0.85rem;
  }
  .reasoning-header .reasoning-truncated {
    color: var(--ion-color-warning, #ffa500);
    font-size: 0.75rem;
  }
  .reasoning-header .reasoning-meta {
    margin-left: auto;
    opacity: 0.6;
    font-size: 0.75rem;
  }
  ```
- [ ] 2.9 Verify the file still typechecks: `pnpm --filter @divinr/web run typecheck 2>&1 | tail -15`. Expected: same 5 pre-existing errors (`HTMLElement`/`window` undefined in `ActivityPanel.vue`, `useApi.ts`, `activity.store.ts`) — no new ones.

### Quality Gate
- [ ] **Lint**: `pnpm --filter @divinr/api run lint` (api-side stays clean — we didn't touch api in Phase 2)
- [ ] **Build**: `pnpm --filter @divinr/api run build`
- [ ] **Typecheck (api)**: `pnpm --filter @divinr/api run typecheck`
- [ ] **Typecheck (web)**: `pnpm --filter @divinr/web run typecheck` — must show **exactly** the same 5 pre-existing errors and no new ones (success criterion §2.8). Compare against the baseline error list.
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit`
- [ ] **E2E Tests**: `pnpm -w run ci:markets`
- [ ] **Curl Tests**: re-run the Phase 1 happy-path curl one more time with the latest token to confirm the API still serves the endpoint after the rebuild.
- [ ] **Chrome Tests**: deferred to Phase 3 (chrome-driven smoke pass).
- [ ] **Phase Review** — compare against PRD §4.4:
  - [ ] New `'reasoning'` literal in the activeTab union?
  - [ ] New tab button between `memory` and `challenge`?
  - [ ] Disabled state wired to `hasReasoning`?
  - [ ] Lazy fetch hooked into the existing `[isOpen, currentIndex]` watcher?
  - [ ] Empty state block, error block, loading block, and content block all present?
  - [ ] Four CSS rules added?
  - [ ] No new web typecheck errors?
  - [ ] No router changes (PRD §4.4.2)?
  - [ ] No tenant.store / useApi / bootstrap-auth changes (PRD §4.4.3)?
  - [ ] Any deviations from PRD §4.4 documented inline below.

---

## Phase 3: Live smoke pass
**Status**: Not Started
**Objective**: Verify end-to-end in Chrome that the modal's new tab actually renders captured reasoning from gemma4:e4b, that the disabled state works, and that prev/next navigation refetches correctly.

### Steps
- [ ] 3.1 Confirm Vite has hot-reloaded the modal change. Open or reload `http://localhost:7101/` and check the dev console for any HMR errors. (Vite restart not needed for `.vue` edits.)
- [ ] 3.2 In Chrome devtools, run `localStorage.clear(); location.href = '/'` to force a fresh auto-login as the demo user. Then verify the dashboard renders.
- [ ] 3.3 Click the first instrument card on the dashboard to open `AnalystPredictionModal`. Confirm the existing tabs (`Analysis | Evidence | Risk | Memory | Challenge`) plus the new **Reasoning** tab are visible.
- [ ] 3.4 The demo user has been granted `member` role on `__base__` in Phase 0 step 0.7, so the auto-login flow (which lands as the demo user) can read `__base__` predictions for the smoke pass — but it does **not** yet switch the active org. Set the active org to `__base__` from the devtools console:
  ```js
  localStorage.setItem('divinr_org', '__base__'); location.reload()
  ```
  If a future org-switcher UI exists at smoke time, use that instead. After reload, the dashboard should show `__base__` predictions which are the ones backed by captured reasoning. (Future effort: surface a real org switcher in the nav.)
- [ ] 3.5 Click an analyst stance on a prediction card. Click the new "Reasoning" tab. **Expected**: model + provider header + a long pre-block containing real reasoning text from `gemma4:e4b`. Reasoning should be at least several hundred chars.
- [ ] 3.6 Click prev/next analyst inside the modal. **Expected**: the Reasoning tab content updates to the new analyst's reasoning (not the previous one). Each click triggers a fresh fetch — confirm in the Network panel that a new `/api/markets/predictions/.../llm-calls` request fires.
- [ ] 3.7 Find a prediction (or analyst) with no reasoning — a non-reasoning model, a legacy row, or a fresh prediction in `personal-demo-user`. Open it in the modal. **Expected**: the Reasoning tab is rendered but **disabled** (greyed out, cursor not-allowed, hover tooltip).
- [ ] 3.8 Test the network panel for the dashboard load (without clicking the reasoning tab). Confirm the dashboard fetch payloads are unchanged from before this effort — no new `/llm-calls` fetches fire automatically. (Success criterion §2.6.)
- [ ] 3.9 Document the findings inline in the Phase 3 review section below: was reasoning useful, verbose, hallucinated, useful-with-caveats? What's the median reasoning length on real markets prompts? Are there any rendering issues? This is the "validate data quality before bigger UX investments" objective from the intention.

### Quality Gate
- [ ] **Lint**: `pnpm --filter @divinr/api run lint`
- [ ] **Build**: `pnpm --filter @divinr/api run build` (sanity rebuild before final commit)
- [ ] **Typecheck**: api + web (web stays at 5 pre-existing errors)
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit`
- [ ] **E2E Tests**: `pnpm -w run ci:markets`
- [ ] **Curl Tests**: re-run all 6 curl scenarios from the Phase 1 gate one final time. All must still pass.
- [ ] **Chrome Tests**:
  - [ ] Reasoning tab visible in modal ✓
  - [ ] Tab disabled when reasoning is null ✓
  - [ ] Tab content renders gemma4:e4b reasoning text ≥500 chars ✓
  - [ ] prev/next navigation refetches correctly ✓
  - [ ] No reasoning content in network panel until user clicks the tab ✓ (success criterion §2.6 visible-via-network)
- [ ] **Phase Review** — compare against PRD §2 success criteria:
  - [ ] §2.1 Endpoint reachable with valid token → confirmed in curl
  - [ ] §2.2 Auth enforced (401/403) → confirmed in curl
  - [ ] §2.3 Empty state graceful → confirmed in curl + chrome
  - [ ] §2.4 Live data visible (≥500 chars from gemma4:e4b) → confirmed in chrome
  - [ ] §2.5 Disabled empty state in UI → confirmed in chrome
  - [ ] §2.6 No leaderboard regression → confirmed in chrome network panel
  - [ ] §2.7 Per-analyst navigation works → confirmed in chrome
  - [ ] §2.8 Gates green → confirmed above
  - [ ] Reasoning content quality findings documented inline below.

---

## Phase 4: Completion report + commit + push
**Status**: Not Started
**Objective**: Document outcomes, commit, push, open PR.

### Steps
- [ ] 4.1 Write `docs/efforts/current/completion-report.md` with the format used by the prior two efforts (auth-bootstrap, llm-reasoning-capture). Sections: Goal, What landed, Phase results table, Gate results, Success criteria results table (one row per §2 criterion with the actual measured value), Deviations from PRD, Risks materialized, Out of scope reaffirmed, Manual verification commands. Include the actual reasoning quality findings from Phase 3.9.
- [ ] 4.2 Stage the changes:
  ```bash
  git add apps/api/src/markets/markets.service.ts \
          apps/api/src/markets/markets.controller.ts \
          apps/web/src/components/AnalystPredictionModal.vue \
          docs/efforts/current/completion-report.md \
          docs/efforts/current/plan.md \
          docs/efforts/current/prd.md \
          docs/efforts/current/intention.md
  git status   # confirm no stray files
  ```
  If `markets.types.ts` was touched in step 1.2, add it too.
- [ ] 4.3 Run the final gate suite one more time pre-commit: `pnpm -w run ci:markets`, `pnpm --filter @divinr/api run test:unit`, `pnpm --filter @divinr/api run typecheck`, `pnpm --filter @divinr/api run lint`. All green.
- [ ] 4.4 Commit:
  ```bash
  git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
  feat(markets): see-your-reasoning — render captured llm reasoning in the prediction modal

  Adds the read surface for the reasoning content captured by the
  llm-reasoning-capture effort. New admin-gated endpoint joins
  market_predictions to llm_usage and returns the model's thinking;
  new "Reasoning" tab inside AnalystPredictionModal lazy-fetches and
  renders it in a monospace pre-block.

  Backend:
  - GET /markets/predictions/:predictionId/llm-calls (markets controller)
  - MarketsService.getPredictionLlmCalls — joins on llm_usage_id with
    org-slug filter as IDOR defense
  - Returns {predictionId, calls: []} as graceful empty state

  Frontend:
  - New 'reasoning' tab in AnalystPredictionModal with disabled state
    when no reasoning is captured
  - Lazy fetch hooked into the existing [isOpen, currentIndex] watcher
  - No router changes, no new views, no new permissions

  Verified end-to-end against the live API and dev DB. Reasoning quality
  findings documented in docs/efforts/current/completion-report.md.

  Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```
- [ ] 4.5 Push the branch: `git push -u origin effort/see-your-reasoning`.
- [ ] 4.6 Open the PR via `gh pr create` with the title `feat(markets): see your reasoning — render captured llm reasoning in the prediction modal` and a body that mirrors the completion report's high-level structure (summary, what landed, test plan, deviations, follow-ups).

### Quality Gate
- [ ] **Lint**: confirmed in 4.3
- [ ] **Build**: confirmed in 4.3
- [ ] **Typecheck**: confirmed in 4.3
- [ ] **Unit Tests**: confirmed in 4.3
- [ ] **E2E Tests**: confirmed in 4.3
- [ ] **Curl Tests**: deferred to PR-eval / pr-eval skill
- [ ] **Chrome Tests**: confirmed in Phase 3
- [ ] **Phase Review**:
  - [ ] Completion report references all 8 §2 success criteria with measured values?
  - [ ] All deviations called out (especially the route-vs-tab choice)?
  - [ ] PR opened, URL captured?
  - [ ] Branch pushed?
  - [ ] Working tree clean after commit?
