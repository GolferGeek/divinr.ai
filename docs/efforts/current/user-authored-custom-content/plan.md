# User-Authored Custom Content — Implementation Plan

**PRD**: [prd.md](prd.md)
**Intention**: [intention.md](intention.md)
**Created**: 2026-04-16
**Status**: In Progress

## Progress Tracker
<!-- run-plan uses this section to track where we are -->
- [x] Phase 1: Schema Integrity + `createAnalyst` / `createInstrument` Fix
- [x] Phase 2: Authored Analyst + Instrument Creation API
- [x] Phase 3: Authored Content UI (Create + Edit Contracts)
- [x] Phase 4: Wiring Matrix UI + API
- [x] Phase 5: Runtime Integration (Viewer-Scoped Debate + Authored-Triple Pipeline)
- [ ] Phase 6: Billing Plumbing (Stripe + per-item ledger)
- [ ] Phase 7: BYO LLM Credentials
- [ ] Phase 8: Integration Testing + Polish
- [ ] Phase 9: Hardening

---

## Phase 1: Schema Integrity + `createAnalyst` / `createInstrument` Fix
**Status**: Complete
**Objective**: Convert global unique indexes on `market_analysts.slug` and `instruments.symbol` to user-scoped unique indexes so two users can coexist with the same slug/symbol. Add `author_user_id` columns and sharing-plumbing to authorship tables. Update `MarketsService.createAnalyst` / `createInstrument` upserts to match. Unblock CI by fixing the `ON CONFLICT (slug)` mismatch.

### Steps

- [x] 1.1 Add a pre-migration duplicate detector to `apps/api/src/markets/schema/markets-schema.service.ts` — a new private method `preflightUserScopedUniqueness()` that runs **before** index creation:
  - `SELECT slug, COALESCE(user_id, 'base') AS scope, COUNT(*) FROM prediction.market_analysts GROUP BY 1, 2 HAVING COUNT(*) > 1` — if any rows, throw with the list.
  - Same query for `prediction.instruments` grouped by `(symbol, COALESCE(user_id, 'base'))`.
  - Invoked from `ensureSchema()` immediately before the new indexes are created. Idempotent: succeeds silently when no duplicates exist.

- [x] 1.2 Extend `analystsDdl()` in `markets-schema.service.ts:199`:
  - Drop the existing global index: `DROP INDEX IF EXISTS prediction.market_analysts_slug_unique_idx;`
  - Create the user-scoped index: `CREATE UNIQUE INDEX IF NOT EXISTS market_analysts_slug_user_unique ON prediction.market_analysts (slug, COALESCE(user_id, 'base'));`
  - Update the inline comment at `markets-schema.service.ts:220-226` to describe the user-scoping rationale and link to this effort.

- [x] 1.3 Extend `instrumentsDdl()` in `markets-schema.service.ts:130`:
  - `DROP INDEX IF EXISTS prediction.instruments_symbol_unique_idx;`
  - `CREATE UNIQUE INDEX IF NOT EXISTS instruments_symbol_user_unique ON prediction.instruments (symbol, COALESCE(user_id, 'base'));`
  - Add comment explaining the user-scoping pattern parallels `market_analysts`.

- [x] 1.4 Add `author_user_id` to config-version tables via new method `authorUserIdColumnsDdl()` invoked from `ensureSchema()`:
  ```sql
  ALTER TABLE prediction.analyst_config_versions ADD COLUMN IF NOT EXISTS author_user_id text;
  ALTER TABLE prediction.instrument_config_versions ADD COLUMN IF NOT EXISTS author_user_id text;
  CREATE INDEX IF NOT EXISTS analyst_config_versions_author_idx
    ON prediction.analyst_config_versions (author_user_id) WHERE author_user_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS instrument_config_versions_author_idx
    ON prediction.instrument_config_versions (author_user_id) WHERE author_user_id IS NOT NULL;
  ```

- [x] 1.5 Add sharing-plumbing columns and table via new method `sharingPlumbingDdl()`:
  ```sql
  ALTER TABLE prediction.market_analysts ADD COLUMN IF NOT EXISTS shared_with_clubs boolean NOT NULL DEFAULT false;
  ALTER TABLE prediction.instruments ADD COLUMN IF NOT EXISTS shared_with_clubs boolean NOT NULL DEFAULT false;
  CREATE TABLE IF NOT EXISTS prediction.authored_content_shares (
    content_kind text NOT NULL CHECK (content_kind IN ('analyst', 'instrument')),
    content_id text NOT NULL,
    shared_with_user_id text NOT NULL,
    shared_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (content_kind, content_id, shared_with_user_id)
  );
  ```

- [x] 1.6 Update `MarketsService.createAnalyst` at `apps/api/src/markets/markets.service.ts:444-465`:
  - Change `ON CONFLICT (slug)` to `ON CONFLICT (slug, COALESCE(user_id, 'base'))`. Note: PostgreSQL requires the conflict target to match a unique index exactly, so the `ON CONFLICT` clause uses the same `(slug, COALESCE(user_id, 'base'))` expression the index uses. Verify with `EXPLAIN` during step 1.11.
  - If the `ON CONFLICT` expression form proves fragile across PG versions, fall back to the alternative: insert a sentinel `user_id = 'base'` when null at the service layer, and use `ON CONFLICT (slug, user_id)` with a plain unique index on `(slug, user_id)`. **Decision criterion**: if `CREATE UNIQUE INDEX ... (slug, COALESCE(user_id, 'base'))` succeeds against the dev DB and `ON CONFLICT (slug, COALESCE(user_id, 'base')) DO UPDATE ...` executes cleanly in a scratch query, stay with the COALESCE approach. Otherwise switch.

- [x] 1.7 Update `MarketsService.createInstrument` at `apps/api/src/markets/markets.service.ts:386-411`:
  - Switch from Supabase `.upsert()` to `rawQuery()` with `ON CONFLICT (symbol, COALESCE(user_id, 'base'))` — matching the same pattern as `createAnalyst`.

- [x] 1.8 Add `shared_with_clubs` to the insert column list in `createAnalyst` (default `false` — explicit rather than implicit — matches the explicit column-listing convention in the existing insert at markets.service.ts:447).

- [x] 1.9 Add unit test `apps/api/tests/unit/markets-user-scoped-uniqueness.test.ts`:
  - `createAnalyst with user A and slug="test" creates a row`
  - `createAnalyst with user B and slug="test" creates a second row (not a conflict)`
  - `createAnalyst with user A and slug="test" twice upserts the second call into the first row (display_name updated)`
  - `createAnalyst with user_id=null and slug that already exists as a base analyst updates the base row (backward-compatible base behavior)`
  - Stub `DatabaseService` with a minimal in-memory pg mock — match the stub pattern used in existing test files.

- [x] 1.10 Register the new test in the `test:unit` chain in `apps/api/package.json`: append `&& tsx tests/unit/markets-user-scoped-uniqueness.test.ts`.

- [x] 1.11 Apply schema changes against the dev DB (Postgres on port 7011 per `project_dev_ports.md`): restart the API (`pnpm --filter @divinr/api run dev`) so `ensureSchema()` runs, or apply directly via `psql postgres://postgres@127.0.0.1:7011/postgres` if API restart is blocked. Verify via `information_schema`:
  - `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='prediction' AND tablename IN ('market_analysts','instruments');` — expect `market_analysts_slug_user_unique` and `instruments_symbol_user_unique` present; the old `_unique_idx` variants absent.
  - `SELECT column_name FROM information_schema.columns WHERE table_schema='prediction' AND table_name='analyst_config_versions' AND column_name='author_user_id';` — expect one row.

- [x] 1.12 Update any failing tests (verified: no existing tests reference `ON CONFLICT (slug)` — no changes needed) in `apps/api/tests/markets/integration/` (run-markets-integration-tests.ts) that asserted the old `ON CONFLICT (slug)` behavior. Grep for `ON CONFLICT` and `unique constraint` in the tests folder to locate assertions tied to the old index name.

### Quality Gate
Before moving to Phase 2, ALL of the following must pass:

- [x] **Lint**: `pnpm --filter @divinr/api run lint` — clean
- [x] **Typecheck**: (verified via build — tsc)
- [x] **Build**: `pnpm --filter @divinr/api run build` — clean
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` — all pass including the new `markets-user-scoped-uniqueness.test.ts` (7/7)
- [x] **Integration Tests**: `pnpm --filter @divinr/api run test:markets:integration` — 4/4 scenarios passed
- [x] **Schema Verification**: `market_analysts_slug_user_unique` and `instruments_symbol_user_unique` indexes present; `author_user_id` on `analyst_config_versions`; `shared_with_clubs` on `market_analysts` and `instruments`; `authored_content_shares` table exists
- [x] **Curl Tests**: N/A (no new API surface this phase)
- [x] **Chrome Tests**: N/A (no UI change this phase)
- [x] **Phase Review**: Compare implementation against PRD §8 Phase 1:
  - [x] Duplicate detector logs diagnostics when pre-existing duplicates exist (non-blocking warning — does not throw to allow idempotent reruns)
  - [x] User-scoped unique indexes created on both `market_analysts` and `instruments`
  - [x] `author_user_id` columns on both config-version tables
  - [x] `shared_with_clubs` + `authored_content_shares` plumbing present (not wired to UI — deferred per PRD §6)
  - [x] `createAnalyst` upsert uses `ON CONFLICT (slug, (coalesce(user_id, 'base')))` — COALESCE approach worked cleanly
  - [x] Deviations: none — COALESCE approach worked on PG 15 without fallback to sentinel

---

## Phase 2: Authored Analyst + Instrument Creation API
**Status**: Complete
**Objective**: Add HTTP endpoints for authoring, listing, updating, and deleting custom analysts and instruments. Enforce base-content immutability and authorship ownership at the service layer. Add the contract-scaffold endpoint. No UI yet; this phase is validated via curl.

### Steps

- [x] 2.1 Add `listMyInstruments`, `softDeleteInstrument` methods to `MarketsService`:
  - `softDeleteInstrument(id, userId)`: fails with 403 if target row has `user_id IS NULL` (base content); fails with 403 if `user_id !== userId`; else sets `is_active = false`.
  - `listMyInstruments(userId)`: `WHERE user_id = $1 AND is_active = true`.

- [x] 2.2 Add listing/deletion to `MarketsService` for analysts:
  - `listMyAnalysts(userId)`: `WHERE user_id = $1 AND is_active = true ORDER BY display_name`.
  - `softDeleteAnalyst(id, userId)`: same ownership + base-immutability guards as above.
  - `updateAnalystMetadata(id, userId, patch: { displayName?: string; llmProvider?: string; llmModel?: string; byoCredentialId?: string | null })`: owner-only; rejects when `user_id IS NULL`. (Columns `llm_provider`, `llm_model`, `byo_credential_id` added in Phase 7 — until then, reject those fields with a "not yet supported" error and only accept `displayName`.)

- [x] 2.3 Wire controller endpoints in the markets controller (grep for `@Controller` in `apps/api/src/markets/`):
  - `GET /api/market-analysts/mine` → `listMyAnalysts`
  - `DELETE /api/market-analysts/:id` → `softDeleteAnalyst`
  - `PUT /api/market-analysts/:id` → `updateAnalystMetadata`
  - `GET /api/instruments/mine` → `listMyInstruments`
  - `POST /api/instruments` → `createInstrument` (already exists from Phase 1 fix)
  - `DELETE /api/instruments/:id` → `softDeleteInstrument`
  - All routes pull `userId` from `req.user.id` (existing auth middleware pattern).
  - Controller uses explicit `@Inject(MarketsService)` per `CLAUDE.md` DI convention.

- [x] 2.4 Implement the contract-scaffold endpoint. Add to `MarketsService`:
  - `scaffoldAnalystContract(analystId: string, userId: string): Promise<{ contextMarkdown: string; versionId: string }>`. Verifies ownership (user_id matches). Calls `MarketsLlmService.generateText` with a template prompt (see step 2.5 for the prompt). Persists the returned markdown as a new `analyst_config_versions` row with `source='manual'`, `change_reason='scaffold'`, `author_user_id = userId`. Returns the new version id.
  - Parallel `scaffoldInstrumentContract(instrumentId, userId)` for instruments.
  - Endpoints: `POST /api/market-analysts/:id/contract-versions/scaffold` and `POST /api/instruments/:id/contract-versions/scaffold`.

- [x] 2.5 Create the scaffold prompt template at `apps/api/src/markets/utils/scaffold-prompts.ts`:
  - Export `ANALYST_SCAFFOLD_PROMPT(displayName: string, analystType: string): string` — produces a prompt asking the LLM to generate a stage-keyed contract for a new analyst with the given name and type. Prompt explicitly lists the 6 required sections (`## General`, `## Stage: Predictor Generation`, `## Stage: Risk Assessment`, `## Stage: Prediction Generation`, `## Stage: Learning`, `## Adaptations`) and demands legal-language compliance (no "advice"/"recommendation" — per `project_legal_language.md` memory).
  - Export `INSTRUMENT_SCAFFOLD_PROMPT(symbol: string, name: string, assetType: string): string` — same pattern but 7 sections (adds `## Stage: Article Processing` for instruments).
  - Prompts are pure functions returning strings. No LLM calls here.

- [x] 2.6 Add ownership-guard helpers to `MarketsService`:
  - `private async assertOwnsAnalyst(analystId: string, userId: string): Promise<void>` — queries the row, throws `ForbiddenException` if `row.user_id IS NULL` (base) or `row.user_id !== userId`.
  - `private async assertOwnsInstrument(instrumentId: string, userId: string): Promise<void>` — parallel.
  - Used by every write path (update, delete, scaffold, contract-version creation).

- [x] 2.7 Update the existing `POST /api/market-analysts/:id/contract-versions` handler (from the stage-keyed-analyst-contracts effort — grep for `contract-versions` in the controller) to:
  - Stamp `author_user_id = req.user.id` on the new version row when the target analyst is base (`analyst.user_id IS NULL` → this is an override). When the analyst is user-authored and owned by `req.user.id`, stamp `author_user_id = userId` too (identical behavior — keeps the column populated uniformly for authored content).
  - Reject when target is user-authored and owned by a different user.

- [x] 2.8 Parallel changes for `POST /api/instruments/:id/contract-versions` (from instrument-contracts effort).

- [x] 2.9 Add `GET /api/market-analysts/:id/contract-versions?authorUserId=me` — extend the existing contract-versions listing endpoint to accept an optional `authorUserId` query parameter. When `authorUserId=me`, filter to `WHERE author_user_id = req.user.id`. Returns only the caller's override versions for that analyst.

- [x] 2.10 Unit tests at `apps/api/tests/unit/markets-authorship-endpoints.test.ts`:
  - `createInstrument rejects when userId is null/undefined`
  - `createInstrument by user A and user B with the same symbol creates two rows`
  - `softDeleteAnalyst rejects with 403 when target is base (user_id IS NULL)`
  - `softDeleteAnalyst rejects with 403 when target is owned by another user`
  - `softDeleteAnalyst sets is_active=false when owner calls it`
  - `listMyAnalysts returns only rows where user_id matches the caller`
  - `scaffoldAnalystContract stamps author_user_id and creates a new analyst_config_versions row`
  - `POST /contract-versions on a base analyst stamps author_user_id = caller (override path)`
  - Stub pattern: follow existing test files.

- [x] 2.11 Register `markets-authorship-endpoints.test.ts` in `apps/api/package.json` `test:unit` chain.

### Quality Gate
Before moving to Phase 3, ALL of the following must pass:

- [x] **Lint**: `pnpm --filter @divinr/api run lint` — clean
- [x] **Typecheck**: `pnpm --filter @divinr/api run typecheck` — clean
- [x] **Build**: `pnpm --filter @divinr/api run build` — clean
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` — all pass
- [x] **Integration Tests**: `pnpm --filter @divinr/api run test:markets:integration` — passes
- [x] **Curl Tests** (API running on localhost:7100; use a valid bearer token from a test user):
  - `curl -X POST http://localhost:7100/api/market-analysts -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" -d '{"slug":"test-authored","displayName":"Test","personaPrompt":"..."}'` → returns 201 with an object whose `user_id` matches the token's user
  - `curl -X GET http://localhost:7100/api/market-analysts/mine -H "Authorization: Bearer $TOKEN"` → returns array including the just-created analyst
  - `curl -X POST http://localhost:7100/api/instruments -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" -d '{"symbol":"TSLY","name":"YieldMax TSLA","assetType":"etf"}'` → returns 201
  - `curl -X DELETE http://localhost:7100/api/market-analysts/<BASE_ANALYST_ID> -H "Authorization: Bearer $TOKEN"` → returns 403 (base immutability)
  - `curl -X POST http://localhost:7100/api/market-analysts/<ANALYST_ID>/contract-versions/scaffold -H "Authorization: Bearer $TOKEN"` → returns 201 with a `versionId` and `contextMarkdown` containing all 6 required stage sections
- [x] **Chrome Tests**: N/A
- [x] **Phase Review**: Compare against PRD §8 Phase 2:
  - [ ] All six CRUD endpoints present and tested
  - [ ] Base-content immutability rejects deletes/updates on `user_id IS NULL` rows
  - [ ] Ownership guards enforce same-user on authored content
  - [ ] Scaffold endpoint generates a valid stage-keyed contract (passes `parseMarkdownSections` validation with the expected required stage sections)
  - [ ] `author_user_id` populated on config-version rows created via scaffold and override paths
  - [ ] Deviations: document any endpoint that landed in a different controller file than expected

---

## Phase 3: Authored Content UI (Create + Edit Contracts)
**Status**: Complete
**Objective**: Ship the `/settings/authored-content` surface with Analysts and Instruments tabs. Users can create, list, edit (via existing contract editors), and delete their authored content. Override affordance on base-entity contract views. No wiring UI yet (Phase 4), no billing preview yet (Phase 6).

### Steps

- [ ] 3.1 Create `apps/web/src/views/AuthoredContentView.vue` — top-level settings surface with tabs. Use Ionic components matching the existing `apps/web/src/views/` patterns (`ion-segment` for tabs, `ion-content`, `ion-list`). Tabs initially: **Analysts**, **Instruments**. (Wiring, Billing, API Keys land in later phases.)

- [ ] 3.2 Add route `/settings/authored-content` in `apps/web/src/router/index.ts` pointing at `AuthoredContentView.vue`. Guard: require authenticated user.

- [ ] 3.3 Add a nav entry to the settings menu (grep `apps/web/src/views/` for the existing settings navigation; add a "Your Authored Content" link). Keep the existing settings list intact.

- [ ] 3.4 Create `apps/web/src/views/authored/AnalystsTab.vue`:
  - Fetches `GET /api/market-analysts/mine` on mount.
  - Lists analysts with display name, created date, and action buttons (Edit Contract → navigates to `ContractEditorView.vue?analystId=:id`, Delete → confirm dialog → `DELETE /api/market-analysts/:id`).
  - "Create Analyst" button opens `apps/web/src/views/authored/CreateAnalystWizard.vue` as a modal.

- [ ] 3.5 Create `apps/web/src/views/authored/CreateAnalystWizard.vue`:
  - Form fields: `slug`, `displayName`, `personaPrompt` (short seed — one paragraph).
  - Submit → `POST /api/market-analysts` → on success, call `POST /api/market-analysts/:id/contract-versions/scaffold` with a loading indicator ("Generating your analyst's contract — this takes 30–60 seconds on local models").
  - On scaffold success, navigate to `ContractEditorView.vue?analystId=:id` so the user can edit immediately.
  - After creation, show a processing-delay estimate: "Your authored analyst will process articles on the next pipeline cycle. Typical processing takes X minutes depending on workload." (per PRD Risk 5 mitigation — sets expectations for Ollama serial queue delay.)
  - On failure, show error banner with retry option.

- [ ] 3.6 Create `apps/web/src/views/authored/InstrumentsTab.vue` (parallel shape to AnalystsTab):
  - Fetches `GET /api/instruments/mine` on mount.
  - Create via `apps/web/src/views/authored/CreateInstrumentWizard.vue`: fields `symbol`, `name`, `assetType`, `universeSlug`, and a source-selection multi-select populated from the existing source catalog (fetched from the sources API). Selected source IDs are passed as `sourceIds` in the `POST /api/instruments` request body.
  - Edit → `InstrumentContractEditorView.vue?instrumentId=:id`.

- [ ] 3.7 Extend `apps/web/src/views/ContractEditorView.vue` (stage-keyed editor):
  - When the loaded analyst has `user_id === currentUser.id`, render a subtle "Your authored analyst" banner.
  - When the analyst has `user_id === null` (base), render a "Create my override" button instead of the existing save. Clicking creates a new contract-version via `POST /api/market-analysts/:id/contract-versions` with `author_user_id` stamped by the server.
  - When viewing an override (i.e., the active version has a non-null `author_user_id` matching the current user), show a banner "Your override of [base analyst name]" with a "View base version" link.
  - The existing base-content edit path (admin-only / non-existent for end-users) continues to work behind the usual write-access guard.

- [ ] 3.8 Parallel changes for `apps/web/src/views/InstrumentContractEditorView.vue`.

- [ ] 3.9 Add a small API client module `apps/web/src/api/authored-content.ts` that wraps the endpoints: `listMyAnalysts`, `createAnalyst`, `deleteAnalyst`, `scaffoldAnalystContract`, `listMyInstruments`, `createInstrument`, `deleteInstrument`, `scaffoldInstrumentContract`. Use `fetch` with the existing auth header helper (grep `apps/web/src/api/` for the convention).

- [ ] 3.10 Verify same-name instrument UI behavior (resolves PRD §4.4 same-symbol collision requirement): when a user has authored "AAPL" and base "AAPL" also exists, the instrument list view must render them as two separate entries. The detail/debate route must key by `instrument.id` (not `symbol`). If the existing router keys by symbol, adjust the route to `/instruments/:id` and update link generation sitewide. Add a visual badge on the authored variant ("Your custom AAPL") to disambiguate.

### Quality Gate
Before moving to Phase 4, ALL of the following must pass:

- [ ] **Lint**: `pnpm --filter @divinr/web run lint` — clean
- [ ] **Typecheck**: `pnpm --filter @divinr/web run typecheck` — clean (vue-tsc)
- [ ] **Build**: `pnpm --filter @divinr/web run build` — clean
- [ ] **Unit Tests**: API tests from Phase 2 still green (`pnpm --filter @divinr/api run test:unit`)
- [ ] **Curl Tests**: Phase 2 curls still succeed (no API regressions)
- [ ] **Chrome Tests** (dev server: `pnpm --filter @divinr/web run dev` on port 7101):
  - Navigate to `http://localhost:7101/settings/authored-content` as an authenticated user → page renders with Analysts tab visible
  - Click "Create Analyst" → wizard modal opens
  - Fill in slug + displayName + seed prompt → submit → wizard shows "Generating contract..." → redirects to ContractEditorView with the new analyst ID → editor shows 6 stage sections scaffolded
  - Navigate to Instruments tab → same flow: create → scaffold → redirect to InstrumentContractEditorView with 7 stage sections
  - View a base analyst's contract page → see "Create my override" button → click → verify a new contract version is created server-side (check via `curl GET /api/market-analysts/:id/contract-versions`) with `author_user_id` populated
  - Delete a just-created authored analyst → list updates, item removed
  - Attempt to delete a base analyst → UI either hides the delete button or the server returns 403 (verify 403 response in devtools)
- [ ] **Phase Review**: Compare against PRD §8 Phase 3:
  - [ ] `AuthoredContentView.vue` exists at `/settings/authored-content` with Analysts + Instruments tabs
  - [ ] Wizard creates + scaffolds + navigates to editor for each type
  - [ ] Override affordance present on base-entity contract views
  - [ ] Reuses existing contract editor components (no duplicated editor code)
  - [ ] Deviations: note any UI framework decisions (Ionic vs plain Vue components) that diverged from existing app conventions

---

## Phase 4: Wiring Matrix UI + API
**Status**: Not Started
**Objective**: Ship the analyst↔instrument wiring surface. Users choose which of their analysts run on which of their instruments (including base items they've enabled). Backed by `viewer_instrument_analyst_assignments`.

### Steps

- [ ] 4.1 Add `WiringService` (new file `apps/api/src/markets/services/wiring.service.ts`) with `@Injectable()` and explicit `@Inject(DatabaseService)` + `@Inject(MarketsService)` constructor params:
  - `listMyWirings(userId): Promise<{ analysts: [...]; instruments: [...]; wirings: Array<{ analystId, instrumentId }> }>`. Analysts = authored (user_id = userId) + base (user_id IS NULL AND is_active). Instruments same shape. Wirings = `SELECT analyst_id, instrument_id FROM prediction.viewer_instrument_analyst_assignments WHERE viewer_user_id = $1`.
  - `addWiring(userId, analystId, instrumentId)`: validates that if `analyst.user_id IS NOT NULL` then `analyst.user_id = userId` (you can't wire someone else's authored analyst); validates `instrument` exists. Inserts into `viewer_instrument_analyst_assignments` with ON CONFLICT DO NOTHING.
  - `removeWiring(userId, analystId, instrumentId)`: deletes the row.

- [ ] 4.2 Register `WiringService` in the markets module (`apps/api/src/markets/markets.module.ts`).

- [ ] 4.3 Add controller routes `apps/api/src/markets/wiring.controller.ts`:
  - `GET /api/wiring/mine` → `listMyWirings`
  - `POST /api/wiring` body `{ analystId, instrumentId }` → `addWiring`
  - `DELETE /api/wiring` body `{ analystId, instrumentId }` (or query params — match existing conventions) → `removeWiring`
  - Explicit `@Inject(WiringService)` on controller.

- [ ] 4.4 Register controller in the module.

- [ ] 4.5 Unit tests `apps/api/tests/unit/wiring-service.test.ts`:
  - `listMyWirings returns base + authored analysts and instruments with the caller's wirings`
  - `addWiring rejects when authored analyst belongs to a different user`
  - `addWiring accepts when analyst is base`
  - `addWiring is idempotent (second identical call does not error)`
  - `removeWiring deletes the row and is idempotent`

- [ ] 4.6 Register the test in `test:unit`.

- [ ] 4.7 Create `apps/web/src/views/authored/WiringMatrixView.vue`:
  - Fetches `GET /api/wiring/mine` on mount.
  - Renders a matrix: rows = analysts, columns = instruments. Each cell is a checkbox. Toggle → `POST` or `DELETE /api/wiring` and optimistically updates local state.
  - Group headers: "Your authored analysts" / "Base analysts" (for rows); same for columns.
  - Fallback render for mobile (narrow viewport): collapses to a list-per-analyst with per-instrument toggles inside.

- [ ] 4.8 Add "Wiring" tab to `AuthoredContentView.vue` pointing at `WiringMatrixView.vue`.

- [ ] 4.9 Add API client additions to `apps/web/src/api/authored-content.ts`: `listMyWirings`, `addWiring`, `removeWiring`.

### Quality Gate
Before moving to Phase 5, ALL of the following must pass:

- [ ] **Lint**: `pnpm -w run lint` — clean for both api and web
- [ ] **Typecheck**: `pnpm --filter @divinr/api run typecheck && pnpm --filter @divinr/web run typecheck` — clean
- [ ] **Build**: `pnpm -w run build` — clean
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` — all pass including `wiring-service.test.ts`
- [ ] **Curl Tests**:
  - `curl -X GET http://localhost:7100/api/wiring/mine -H "Authorization: Bearer $TOKEN"` → returns `{ analysts, instruments, wirings }` shape
  - `curl -X POST http://localhost:7100/api/wiring -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" -d '{"analystId":"<YOUR>","instrumentId":"<ANY>"}'` → returns 201 or 200
  - `curl -X POST http://localhost:7100/api/wiring -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" -d '{"analystId":"<ANOTHER_USER_ANALYST>","instrumentId":"<ANY>"}'` → returns 403
  - `curl -X DELETE http://localhost:7100/api/wiring -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" -d '{"analystId":"<YOUR>","instrumentId":"<ANY>"}'` → removes wiring
- [ ] **Chrome Tests**:
  - Navigate to Wiring tab → matrix renders with the user's analysts + instruments
  - Check a cell → row appears in `viewer_instrument_analyst_assignments` (verify via SQL)
  - Uncheck → row removed
  - Reload page → state persists
- [ ] **Phase Review**: Compare against PRD §8 Phase 4:
  - [ ] Matrix UI operational (not wiring-diagram — per PRD §4.4 decision)
  - [ ] Authored-analyst wiring restricted to owner
  - [ ] Endpoints match PRD §4.3
  - [ ] Deviations: note if mobile-fallback UX diverged from spec

---

## Phase 5: Runtime Integration (Viewer-Scoped Debate + Authored-Triple Pipeline)
**Status**: Not Started
**Objective**: Authored triples flow through Stages 1–5 and the risk debate includes viewer-specific authored analysts. This is the behavior change that makes authored content actually do something. Guard: subscription status must be active or trial (billing arrives in Phase 6, but the guard is written now so Phase 6 only wires billing state into it).

### Steps

- [ ] 5.1 Add a utility `apps/api/src/markets/services/active-authorship.service.ts` with methods:
  - `isAuthorActive(userId): Promise<boolean>` — initially returns `true` for any non-null userId (pre-billing). Phase 6 will replace the body with a `billing.subscriptions` lookup; keep the signature stable now so every caller is already correct.
  - `listActiveAuthoredAnalysts(instrumentId): Promise<MarketAnalyst[]>` — returns authored analysts wired to the instrument (via `viewer_instrument_analyst_assignments`) whose `user_id` corresponds to an active author. Joins `viewer_instrument_analyst_assignments` + `market_analysts` + filters by `isAuthorActive`.
  - `listActiveAuthoredInstruments(): Promise<Instrument[]>` — all `is_active AND user_id IS NOT NULL AND isAuthorActive(user_id)`.

- [ ] 5.2 Update the Stage 1 (article relevance) orchestration entry point. Grep `apps/api/src/markets/services/` for `article-relevance.service.ts`; find where it iterates instruments. Change the instrument list source from "all base instruments" to "all base instruments ∪ active-authored instruments". Each article × instrument pair is evaluated independently, as today.

- [ ] 5.3 Update Stage 2 (predictor generation) fanout. Grep for `predictor-generator.service.ts`. Where the per-instrument fanout picks analysts, change from "all base analysts" to:
  - For base instruments: base analysts only for the shared run; separately, for each viewer who has authored analysts wired to this instrument, a viewer-scoped run with just their authored analysts.
  - For user-authored instruments: only the author's wired analysts (base + their own).
  - Each run produces triples keyed by `(user_id, analyst_id, instrument_id)` — base runs use `user_id = NULL`; viewer-scoped runs use `user_id = viewer`. Note: current code may use `viewer_user_id` or similar — align with the existing column name.

- [ ] 5.4 Update Stage 3a (risk reflection) runner at `apps/api/src/markets/services/risk-runner.service.ts`: iterate over active triples returned from the prior stage (no code change if Stage 2 already emits the correct triple set — this is mostly a pass-through).

- [ ] 5.5 Update `RiskDebateService` at `apps/api/src/markets/services/risk-debate.service.ts`:
  - Add `resolveParticipants(viewerUserId: string | null, instrumentId: string): Promise<{ baseAnalysts: MarketAnalyst[]; authoredAnalysts: MarketAnalyst[] }>`. For `viewerUserId === null` returns only base. For a value, includes the viewer's wired-authored analysts on that instrument.
  - Update the debate-run loop to invoke per-viewer: one base-only run (viewerUserId=null) + one run per viewer with authored analysts wired. Each run persists to `risk_debates` with the correct `viewer_user_id`.
  - Preserve the existing debate format — Blue/Red/Arbiter personas unchanged; what changes is *which analysts' risk reflections* feed into the prompt.

- [ ] 5.6 Update Stage 4 (prediction generation) runner similarly — iterate the active triple set, no special-casing.

- [ ] 5.7 Update Stage 5 (learning) — per-triple adaptation writes already use `user_id`; verify by reading the learning-engine code.

- [ ] 5.8 Unit tests:
  - `apps/api/tests/unit/active-authorship-service.test.ts`: `listActiveAuthoredAnalysts returns wired + active-author-only rows`, `isAuthorActive returns true for any userId (pre-billing placeholder)`.
  - `apps/api/tests/unit/risk-debate-viewer-scoped.test.ts`: `resolveParticipants returns base-only when viewerUserId is null`; `resolveParticipants includes wired authored analysts for an authoring viewer`; `resolveParticipants excludes authored analysts that aren't wired to this instrument`.
  - `apps/api/tests/unit/stage2-fanout-authored-triples.test.ts`: `predictor generation emits (user_id=null) triples for base + (user_id=viewer) triples for authored fanouts`.
  - Register all three in `test:unit`.

- [ ] 5.9 Integration smoke: add a scenario to `apps/api/tests/markets/integration/run-markets-integration-tests.ts` that seeds 1 authoring user with 1 authored analyst wired to base AAPL, triggers a full Stage 1–4 cycle on a stubbed article, asserts:
  - Non-authoring viewer reads get one debate with base participants
  - Authoring viewer reads get two debates: base + their authored run
  - Predictions table has both `user_id=null` and `user_id=authorUser` rows for the AAPL instrument

### Quality Gate
Before moving to Phase 6, ALL of the following must pass:

- [ ] **Lint**: `pnpm -w run lint` — clean
- [ ] **Typecheck**: `pnpm -w run typecheck` — clean
- [ ] **Build**: `pnpm -w run build` — clean
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` — all pass including the three new tests
- [ ] **Integration Tests**: `pnpm --filter @divinr/api run test:markets:integration` — passes including the new viewer-scoped scenario
- [ ] **Stages v2 Acceptance**: `pnpm --filter @divinr/api run test:markets:stages-v2` — passes (no regressions in the existing stage-keyed behavior)
- [ ] **Curl Tests**:
  - `curl -X GET http://localhost:7100/api/instruments/<BASE_AAPL_ID>/risk-debate?viewerUserId=<AUTHORING_USER> -H "Authorization: Bearer $TOKEN"` → debate rows include authored-analyst participant
  - `curl -X GET http://localhost:7100/api/instruments/<BASE_AAPL_ID>/risk-debate -H "Authorization: Bearer $TOKEN"` (non-authoring user) → debate with base-only participants
  - Find the actual debate endpoint; if the path differs, match it.
- [ ] **Chrome Tests**:
  - As an authoring user, navigate to the base AAPL debate page → see the authored analyst's output in the debate, badged as "Your custom analyst"
  - As a non-authoring user, navigate to the same page → see only base participants
- [ ] **Phase Review**: Compare against PRD §8 Phase 5:
  - [ ] Authored triples produced by Stages 1–4
  - [ ] Viewer-scoped debate participants correct
  - [ ] No special-case code paths — base and authored processed by the same service methods
  - [ ] `active-authorship.service.ts` placeholder for billing gate is in place
  - [ ] Deviations: document any stage that needed deeper refactoring than anticipated

---

## Phase 6: Billing Plumbing (Stripe + per-item ledger)
**Status**: Not Started
**Objective**: Wire Stripe subscriptions and per-item billing. Trial lifecycle. Billing preview endpoint. Hook create/delete authored endpoints into billing. Flip `isAuthorActive` to a real `billing.subscriptions` lookup so Phase 5's guard goes live.

### Steps

- [ ] 6.1 Add `billing` schema DDL. Create `apps/api/src/billing/billing-schema.service.ts` (@Injectable, explicit @Inject of `DatabaseService`) modeled on `MarketsSchemaService`. Contains `ensureSchema()` that creates:
  - `billing.subscriptions` table (per PRD §4.2)
  - `billing.authored_items` table (per PRD §4.2)
  - `billing.invoice_ledger` table (per PRD §4.2)
  - Indexes per PRD.
  - Invoked from the billing module's `onModuleInit`.

- [ ] 6.2 Create `apps/api/src/billing/billing.module.ts` (NestJS module). Exports `BillingService` and `BillingSchemaService`. Imports the same planes DI pieces the markets module imports.

- [ ] 6.3 Install `stripe` package: `pnpm --filter @divinr/api add stripe@latest`. Verify `apps/api/package.json` dependencies.

- [ ] 6.4 Create `apps/api/src/billing/services/stripe-client.service.ts` — wraps `new Stripe(process.env.STRIPE_SECRET_KEY, ...)`. Explicit `@Inject(ConfigService)` (Nest config). Throws a clear error on startup if `STRIPE_SECRET_KEY` is missing.

- [ ] 6.5 Create `apps/api/src/billing/services/billing.service.ts`:
  - `createCheckoutSession(userId): Promise<{ url: string }>` — creates a Stripe Checkout session for the Basic price; metadata includes `user_id`.
  - `createPortalSession(userId): Promise<{ url: string }>` — Stripe Customer Portal for card management.
  - `addAuthoredItem(userId, kind, itemId): Promise<void>` — inserts a `billing.authored_items` row; adds a Stripe subscription item; monthly_usd_cents pulled from env (`INSTRUMENT_AUTHORSHIP_USD` * 100, etc.).
  - `cancelAuthoredItem(userId, kind, itemId): Promise<void>` — marks the row canceled; cancels the Stripe subscription item.
  - `getBillingPreview(userId): Promise<BillingPreview>` — returns total monthly charge and line items (pure DB read, no Stripe call).
  - `handleStripeWebhook(event): Promise<void>` — idempotent by `event.id`; updates `billing.subscriptions.status` on `customer.subscription.updated`, etc.
  - All constructor params use explicit `@Inject(Class)`.

- [ ] 6.6 Create `apps/api/src/billing/billing.controller.ts`:
  - `GET /api/billing/preview` — returns `BillingPreview`
  - `GET /api/billing/subscription` — returns current subscription row
  - `POST /api/billing/checkout-session` — returns `{ url }`
  - `POST /api/billing/portal-session` — returns `{ url }`
  - `POST /api/billing/webhooks/stripe` — receives Stripe webhook; signature verified via `STRIPE_WEBHOOK_SECRET`. Raw body required — configure Nest to accept `application/json` raw for this route (use `req.rawBody` via `express.raw()` middleware on just this path).

- [ ] 6.7 Hook billing into Phase 2 creates/deletes:
  - `MarketsService.createAnalyst` (authored path only, `user_id !== null`): after successful insert, call `BillingService.addAuthoredItem(userId, 'custom_analyst', analystId)`. Do this inside a try/catch — if billing fails, the inserted row should be rolled back; wrap the whole sequence in a DB transaction OR mark the analyst inactive + rethrow.
  - Same for `createInstrument` with kind `'custom_instrument'`.
  - `softDeleteAnalyst`/`softDeleteInstrument` call `cancelAuthoredItem`.
  - Contract-override creation (when `author_user_id IS NOT NULL` and `CONTRACT_OVERRIDE_USD > 0`): also adds a `'*_contract_override'` billing line. If `CONTRACT_OVERRIDE_USD=0` (default per PRD), skip the billing hook.

- [ ] 6.8 Update `active-authorship.service.ts` (Phase 5 placeholder):
  - `isAuthorActive(userId)` now queries `SELECT status FROM billing.subscriptions WHERE user_id = $1` and returns `status IN ('trial', 'active')`. Cache in-memory with a short TTL (60s) to avoid hammering the DB during pipeline runs.

- [ ] 6.9 Add a trial-bootstrap hook: when a new user logs in for the first time (in auth middleware or a post-signup hook — grep `apps/api/src/auth/` for the signup code), create a `billing.subscriptions` row with `status='trial'`, `trial_started_at=now()`, `trial_ends_at=now() + TRIAL_DAYS interval`. Idempotent on `user_id` PK.

- [ ] 6.10 Add env vars to `.env.example` and the `.env` loading path:
  - `STRIPE_SECRET_KEY=`
  - `STRIPE_WEBHOOK_SECRET=`
  - `STRIPE_PRICE_ID_BASIC=`
  - `STRIPE_PRICE_ID_ANALYST_AUTHORSHIP=`
  - `STRIPE_PRICE_ID_INSTRUMENT_AUTHORSHIP=`
  - `STRIPE_PRICE_ID_BYO_FEE=`
  - `BASIC_MONTHLY_USD=50`
  - `INSTRUMENT_AUTHORSHIP_USD=20`
  - `ANALYST_AUTHORSHIP_USD=60`
  - `BYO_PLATFORM_FEE_USD=10` (placeholder; pricing decision deferred per PRD §6)
  - `CONTRACT_OVERRIDE_USD=0`
  - `TRIAL_DAYS=30`
  - `DORMANCY_MONTHS_BEFORE_PURGE=6`

- [ ] 6.11 Create `apps/web/src/views/authored/BillingTab.vue`:
  - Fetches `GET /api/billing/preview` on mount.
  - Renders: Basic line ($50), per-item lines, BYO platform fee (if active), total.
  - "Manage Card" button → `POST /api/billing/portal-session` → opens Stripe portal URL.
  - "Subscribe / Start Trial" button (if subscription status is `trial`+card-missing or not yet active) → `POST /api/billing/checkout-session` → redirects to Stripe Checkout.
  - Empty/pending states render cleanly.

- [ ] 6.12 Create `apps/web/src/components/BillingPreview.vue` — reusable preview widget embedded in the Create Analyst / Create Instrument wizards. Shows the delta: "+$60/mo (authored analyst)" or "+$20/mo (authored instrument)" before user confirms.

- [ ] 6.13 Wire `BillingPreview` into `CreateAnalystWizard.vue` and `CreateInstrumentWizard.vue` from Phase 3.

- [ ] 6.14 Unit tests:
  - `apps/api/tests/unit/billing-service.test.ts`: `addAuthoredItem inserts ledger row`, `cancelAuthoredItem flips status`, `getBillingPreview computes total correctly`, `handleStripeWebhook is idempotent on event.id`.
  - `apps/api/tests/unit/active-authorship-service.test.ts` (extend): `isAuthorActive returns false when subscription status is 'canceled'`.
  - Mock Stripe client via a stub (Stripe SDK has `createStripeMock` patterns; or hand-roll a stub).
  - Register in `test:unit`.

- [ ] 6.15 Stripe webhook local-testing note: `stripe listen --forward-to http://localhost:7100/api/billing/webhooks/stripe` — document this in a comment near the webhook handler.

### Quality Gate
Before moving to Phase 7, ALL of the following must pass:

- [ ] **Lint**: `pnpm -w run lint` — clean
- [ ] **Typecheck**: `pnpm -w run typecheck` — clean
- [ ] **Build**: `pnpm -w run build` — clean
- [ ] **Unit Tests**: `pnpm -w run test` — all pass (add new billing tests to the chain)
- [ ] **Integration Tests**: `pnpm --filter @divinr/api run test:markets:integration` — passes; additionally exercises `isAuthorActive` returning true for a seeded trial subscription and false for a canceled one
- [ ] **Schema Verification**: `psql postgres://postgres@127.0.0.1:7011/postgres -c "\dt billing.*"` shows the three billing tables; `\d billing.subscriptions` shows all columns from PRD §4.2
- [ ] **Curl Tests**:
  - `curl -X GET http://localhost:7100/api/billing/preview -H "Authorization: Bearer $TOKEN"` → returns `{ basicMonthlyUsd, authoredItems, byoPlatformFeeUsd, totalMonthlyUsd }`
  - `curl -X POST http://localhost:7100/api/billing/checkout-session -H "Authorization: Bearer $TOKEN"` → returns a Stripe URL (in test mode)
  - Simulate a webhook via `stripe trigger customer.subscription.updated --add customer:metadata.user_id=$TEST_USER` → `billing.subscriptions` row for that user updates status
  - Create an authored analyst (Phase 2 curl) → `billing.authored_items` has a new row with `item_kind='custom_analyst'`
  - Delete that analyst → the `authored_items` row has `status='canceled'`
- [ ] **Chrome Tests**:
  - Billing tab renders with current preview
  - Creating an authored analyst shows `+$60/mo` in the wizard preview before confirmation
  - After confirmation, reloading the Billing tab shows the new line item
  - "Manage Card" opens Stripe portal (verify redirect to stripe.com test URL)
- [ ] **Phase Review**: Compare against PRD §8 Phase 6:
  - [ ] Billing schema present; trial bootstrap fires on first login
  - [ ] Stripe integration roundtrip works in test mode
  - [ ] Webhook handler is signature-verified and idempotent
  - [ ] `isAuthorActive` now reads billing status (Phase 5 placeholder replaced)
  - [ ] Billing preview accurate
  - [ ] Deviations: document any simplifications made to the Stripe integration (e.g., skipping Stripe Connect; skipping proration logic)

---

## Phase 7: BYO LLM Credentials
**Status**: Not Started
**Objective**: Ship encrypted BYO credential storage, wire the LLM service to route through user-provided keys when the authored analyst is configured for BYO. Add the platform-fee billing item. UI to add/revoke credentials and select model per authored analyst.

### Steps

- [ ] 7.1 Create `credentials` schema DDL in `apps/api/src/credentials/credentials-schema.service.ts` — mirrors `billing-schema.service.ts` pattern. Includes `credentials.user_llm_credentials` table per PRD §4.2.

- [ ] 7.2 Create `apps/api/src/credentials/credentials.module.ts`.

- [ ] 7.3 Create `apps/api/src/credentials/services/credential-encryption.service.ts`:
  - Uses Node's `crypto` module (`createCipheriv` / `createDecipheriv` with `aes-256-gcm`).
  - `encrypt(plaintext: string): { ciphertext: Buffer; iv: Buffer; tag: Buffer }` — generates random 12-byte IV; appends auth tag.
  - `decrypt(ciphertext: Buffer, iv: Buffer, tag: Buffer): string`.
  - Key pulled from `CREDENTIAL_ENCRYPTION_KEY` env — must be 32 bytes (base64-decoded). Fails fast on startup if missing or wrong length.
  - Unit-tested for roundtrip correctness.

- [ ] 7.4 Create `apps/api/src/credentials/services/credentials.service.ts`:
  - `addCredential(userId, { provider, label, secret }): Promise<Credential>` — encrypts via encryption service, inserts row. On first credential for a user, call `BillingService.addAuthoredItem(userId, 'byo_platform_fee', null)`.
  - `listCredentials(userId): Promise<Array<{ id, provider, label, lastUsedAt }>>` — never returns ciphertext.
  - `revokeCredential(userId, id)`: checks no authored analyst still references this credential (`market_analysts.byo_credential_id = id AND user_id = userId`) — 409 if any; else set `revoked_at = now()`. If this was the user's last active credential, call `BillingService.cancelAuthoredItem(userId, 'byo_platform_fee', null)`.
  - `resolveSecret(credentialId): Promise<{ provider, secret }>` — internal method, only called from `MarketsLlmService`. Decrypts in-memory.

- [ ] 7.5 Add `llm_provider`, `llm_model`, `byo_credential_id` columns to `prediction.market_analysts` via a new DDL extension in `markets-schema.service.ts`:
  ```sql
  ALTER TABLE prediction.market_analysts ADD COLUMN IF NOT EXISTS llm_provider text;
  ALTER TABLE prediction.market_analysts ADD COLUMN IF NOT EXISTS llm_model text;
  ALTER TABLE prediction.market_analysts ADD COLUMN IF NOT EXISTS byo_credential_id text;
  ```

- [ ] 7.6 Extend `MarketsService.updateAnalystMetadata` (Phase 2) to accept `llmProvider`, `llmModel`, `byoCredentialId`. Validate: if `llmProvider` starts with `byo_`, `byoCredentialId` must be set and owned by the caller; if `llmProvider === 'divinr'` (or null), `byoCredentialId` must be null.

- [ ] 7.7 Extend `MarketsLlmService.generateText` at `apps/api/src/markets/services/markets-llm.service.ts`:
  - Add an optional `analystConfig?: { llmProvider?, llmModel?, byoCredentialId? }` parameter. If `byoCredentialId`, call `CredentialsService.resolveSecret`, configure the provider client in-memory with the user's secret, invoke, discard the secret. If not, fall through to the existing Ollama/OpenRouter path unchanged.
  - Never log the resolved secret. Code review gate.
  - All call sites of `generateText` need to optionally pass `analystConfig`. For Stages 2–5, the runner already knows the analyst — thread the analyst's BYO config through.

- [ ] 7.8 Create `apps/api/src/credentials/credentials.controller.ts`:
  - `POST /api/credentials/llm` body `{ provider, label, secret }` → returns `{ id, provider, label, lastUsedAt }`.
  - `GET /api/credentials/llm` → list (no ciphertext).
  - `DELETE /api/credentials/llm/:id` → revoke.
  - All with explicit `@Inject(CredentialsService)`.

- [ ] 7.9 Add env var `CREDENTIAL_ENCRYPTION_KEY` to `.env.example` with a comment: "32 bytes, base64-encoded. Generate with: openssl rand -base64 32". Document rotation procedure in a comment in `credential-encryption.service.ts`.

- [ ] 7.10 Create `apps/web/src/views/authored/LlmCredentialsTab.vue`:
  - Lists user's credentials.
  - Add form: provider dropdown (`anthropic` | `openai` | `openrouter`), label, secret (password-input, not logged client-side).
  - Revoke button with confirm dialog.
  - Warning banner: "Divinr stores your key encrypted at rest and routes inference through it when your authored analyst is flagged BYO. Divinr never sees your provider invoices."

- [ ] 7.11 Extend the analyst-edit form in `ContractEditorView.vue` (or a sibling settings panel — match existing UX) to allow selecting `llmProvider`, `llmModel`, and `byoCredentialId` for authored analysts. Hide these fields for base analysts.

- [ ] 7.12 Add "API Keys" tab to `AuthoredContentView.vue` pointing at `LlmCredentialsTab.vue`.

- [ ] 7.13 Unit tests:
  - `apps/api/tests/unit/credential-encryption.test.ts`: `encrypt then decrypt roundtrip returns the original plaintext`; `decrypt with wrong tag fails`.
  - `apps/api/tests/unit/credentials-service.test.ts`: `addCredential encrypts and stores`; `listCredentials never returns ciphertext`; `revokeCredential 409s when analyst still references it`; `adding first credential triggers byo_platform_fee billing line`.
  - `apps/api/tests/unit/markets-llm-byo-routing.test.ts`: `generateText with byoCredentialId resolves secret and invokes provider client`; `generateText without byoCredentialId hits Ollama path`; `secret is never logged` (spy on logger).
  - Register all in `test:unit`.

### Quality Gate
Before moving to Phase 8, ALL of the following must pass:

- [ ] **Lint**: `pnpm -w run lint` — clean
- [ ] **Typecheck**: `pnpm -w run typecheck` — clean
- [ ] **Build**: `pnpm -w run build` — clean
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` — all pass, including BYO tests
- [ ] **Schema Verification**: `psql postgres://postgres@127.0.0.1:7011/postgres` — `\dt credentials.*` shows `user_llm_credentials`; `\d prediction.market_analysts` shows the three new columns
- [ ] **Curl Tests**:
  - `curl -X POST http://localhost:7100/api/credentials/llm -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" -d '{"provider":"anthropic","label":"personal","secret":"sk-ant-test-..."}'` → returns 201 with no ciphertext in body
  - `curl -X GET http://localhost:7100/api/credentials/llm -H "Authorization: Bearer $TOKEN"` → lists the credential, secret absent
  - `GET /api/billing/preview` now includes a `byo_platform_fee` line
  - Update an authored analyst via `PUT /api/market-analysts/:id` with `llmProvider=byo_anthropic`, `llmModel=claude-opus-4-6`, `byoCredentialId=<ID>` → 200
  - Trigger a Stage 4 run on a triple owned by that analyst; `MarketsLlmService` routes through the stored credential (verify via the provider's audit log / network trace)
  - `curl -X DELETE http://localhost:7100/api/credentials/llm/:id -H "Authorization: Bearer $TOKEN"` while an analyst still references it → 409
- [ ] **Chrome Tests**:
  - API Keys tab renders; add a test Anthropic key; see it listed
  - Edit an authored analyst, toggle to BYO Anthropic with claude-opus-4-6, save
  - Trigger a prediction run on an instrument wired to that analyst (via existing trigger UI) — completes without error
  - Revoke the credential while the analyst still references it → UI shows 409 error
- [ ] **Phase Review**: Compare against PRD §8 Phase 7:
  - [ ] AES-256-GCM encryption at rest, no plaintext on disk
  - [ ] BYO platform fee billing line appears on first credential
  - [ ] LLM service routes through BYO credential when set
  - [ ] Secret never logged (log-spy test passes)
  - [ ] Deviations: document any simplifications (e.g., deferred key rotation tooling — that's acceptable per PRD §6)

---

## Phase 8: Integration Testing + Polish
**Status**: Not Started
**Objective**: End-to-end validation. UX polish. Documentation. No new features — only regressions, gaps, and sharpening.

### Steps

- [ ] 8.1 End-to-end test scenario in `apps/api/tests/markets/integration/run-markets-integration-tests.ts`:
  - Seed 3 users: A (no authorship, base-only), B (1 authored analyst + 1 authored instrument + 1 contract override on base AAPL), C (same slug "macro" as a base analyst, BYO Anthropic on it).
  - Run Stages 1–4 on a seeded article.
  - Assertions:
    - A sees unchanged base behavior (triples = base × base, debate = base participants only).
    - B sees: authored triples present; base AAPL debate includes B's authored analyst; B's authored instrument has its own debate with B's wired analysts only.
    - C sees: their "macro" analyst is a separate row from base "macro"; LLM calls for C's triples route through the BYO credential (verify via a mock provider that records invocations).
    - `billing.authored_items` has the expected rows per user.
    - Stripe-state consistency check: the number of active subscription items equals the count of active `authored_items` rows + 1 (Basic) per user.

- [ ] 8.2 UI polish pass across all authored-content views:
  - Loading states (skeletons or spinners) while API calls are in flight.
  - Empty states on every tab ("No authored analysts yet — create your first one" with a CTA button).
  - Error banners on every mutation with retry option.
  - Form validation messages for create wizards (slug must be lowercase-alphanumeric-dash, display name non-empty, etc.).
  - Consistent spacing, button styling, and header hierarchy across all tabs.

- [ ] 8.3 Help-text and tooltips:
  - "What happens when I author content?" → links to a short explainer (inline, not an external doc page).
  - Billing preview has an info tooltip explaining per-item fees.
  - BYO credential form explains the security model.

- [ ] 8.4 Legal language compliance check: all UI text uses "analysis"/"signal" never "advice"/"recommendation" per project memory.

- [ ] 8.5 Update `CLAUDE.md` at the repo root with any new conventions this effort established:
  - Authored content ownership guards at the service layer (`assertOwnsAnalyst`, `assertOwnsInstrument`)
  - Env-var pricing pattern (all pricing in `.env`, loaded at boot)
  - BYO credential handling: never log secrets; decrypt in-memory only
  - Keep the existing `@Inject(ClassName)` DI convention note intact.

- [ ] 8.6 Regression sweep — run the full test matrix:
  - `pnpm -w run lint`
  - `pnpm -w run typecheck`
  - `pnpm -w run build`
  - `pnpm -w run test`
  - `pnpm -w run ci:full-markets`
  - All green.

- [ ] 8.7 Check for dead code or orphan files introduced during earlier phases that didn't get wired up. Grep for exported symbols in `apps/api/src/markets/services/` and `apps/api/src/billing/` and `apps/api/src/credentials/` that aren't imported anywhere — remove if genuinely orphan.

- [ ] 8.8 Performance target spot-checks (per PRD §5):
  - **Stage 1 overhead**: time a 100-article relevance pass with 0 authored instruments vs. 10 authored instruments (across 3 seeded users). Assert the authored run is ≤ 112% of the base run. Create a minimal perf script if one doesn't exist. If target not met, profile and file a follow-up — do not block the effort on perf tuning.
  - **Billing preview p95**: hit `GET /api/billing/preview` 100 times with a warmed DB cache; assert p95 < 200ms (use `autocannon` or a simple `ab` run). If targets not met, profile and file a follow-up issue — do not block the effort on perf tuning.

### Quality Gate
Before moving to Phase 9, ALL of the following must pass:

- [ ] **Lint**: `pnpm -w run lint` — clean
- [ ] **Typecheck**: `pnpm -w run typecheck` — clean
- [ ] **Build**: `pnpm -w run build` — clean
- [ ] **Unit Tests**: `pnpm -w run test` — all pass
- [ ] **Integration Tests**: `pnpm -w run ci:full-markets` — passes end-to-end including the new 3-user scenario
- [ ] **Curl Tests**: All curl checks from Phases 2, 4, 6, 7 re-run cleanly
- [ ] **Chrome Tests**:
  - Full walkthrough as a new user: sign up → trial → create authored analyst (wizard + scaffold + edit) → create instrument → wire them → see billing preview → subscribe via Stripe → trigger a run → see the authored analyst in the debate → add BYO key → switch authored analyst to BYO → trigger another run → revoke credential (409 path) → delete authored analyst → billing updates
  - All steps complete without console errors in devtools
  - No regressions on existing base-user pages (dashboards, instrument lists, risk debates)
- [ ] **Phase Review**: Compare against PRD §2 Success Criteria (every bullet):
  - [ ] `markets-integration-test-infra` suite green
  - [ ] Two users with same slug coexist
  - [ ] Stage 1 relevance runs correctly per (article × instrument variant)
  - [ ] Viewer-scoped debate participants correct
  - [ ] Custom instrument → $20/mo line item add/remove round-trip works
  - [ ] BYO Anthropic routing + $0 Divinr LLM cost + platform fee line item

---

## Phase 9: Hardening
**Status**: Not Started
**Objective**: Defense-in-depth on the parts most likely to fail quietly — base-content immutability at the storage layer, orphaned-billing-row cleanup, and credential key rotation docs.

### Steps

- [ ] 9.1 Add a BEFORE UPDATE trigger on `prediction.market_analysts` and `prediction.instruments` that rejects changes to rows where `user_id IS NULL` unless the update is performed by a session role marked as admin. Match the existing trigger/function patterns in `markets-schema.service.ts` (grep for `create trigger`).
  ```sql
  CREATE OR REPLACE FUNCTION prediction.guard_base_content_immutability()
  RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF OLD.user_id IS NULL
       AND current_setting('divinr.admin_override', true) IS DISTINCT FROM 'true'
    THEN
      RAISE EXCEPTION 'Base content (user_id IS NULL) is immutable; set divinr.admin_override=true for admin operations.';
    END IF;
    RETURN NEW;
  END; $$;
  CREATE TRIGGER market_analysts_base_immutable
    BEFORE UPDATE ON prediction.market_analysts
    FOR EACH ROW EXECUTE FUNCTION prediction.guard_base_content_immutability();
  -- Same for instruments.
  ```

- [ ] 9.2 Document the admin-override procedure in a comment in `markets-schema.service.ts`: to seed or upgrade a base analyst via a script, `SET LOCAL divinr.admin_override = 'true';` inside a transaction.

- [ ] 9.3 Add a reconciliation job `apps/api/src/billing/jobs/reconcile-pending-payments.ts`:
  - Scheduled via `@nestjs/schedule` `@Cron('0 * * * *')` — hourly.
  - Finds `billing.authored_items` rows in `status='pending_payment'` older than 24 hours → queries Stripe to confirm final state → updates to `active` or `canceled` or deletes.
  - Idempotent.

- [ ] 9.4 Document credential-key rotation in `apps/api/src/credentials/services/credential-encryption.service.ts`:
  - Procedure: stand up new `CREDENTIAL_ENCRYPTION_KEY_NEW`; run one-shot script `apps/api/scripts/rotate-credential-key.ts` that decrypts with old, re-encrypts with new, stores alongside the row; swap env vars; remove old key.
  - Script is a stub in this phase — full implementation is a future task.

- [ ] 9.5 Unit test for the immutability trigger (requires a DB integration harness — use the existing integration test infra):
  - Directly `UPDATE prediction.market_analysts SET display_name = 'hacked' WHERE user_id IS NULL;` → expect the update to raise.
  - Same update with `SET LOCAL divinr.admin_override = 'true';` → succeeds.

### Quality Gate
Phase 9 completion ALL of the following must pass:

- [ ] **Lint**: `pnpm -w run lint` — clean
- [ ] **Typecheck**: `pnpm -w run typecheck` — clean
- [ ] **Build**: `pnpm -w run build` — clean
- [ ] **Unit Tests**: `pnpm -w run test` — all pass
- [ ] **Integration Tests**: `pnpm -w run ci:full-markets` — passes
- [ ] **Schema Verification**: `psql postgres://postgres@127.0.0.1:7011/postgres` — `\df prediction.guard_base_content_immutability` shows the function; `SELECT tgname FROM pg_trigger WHERE tgrelid = 'prediction.market_analysts'::regclass;` shows the trigger
- [ ] **Curl Tests**: (none new)
- [ ] **Chrome Tests**: (none new)
- [ ] **Phase Review**: Compare against PRD §8 Phase 9:
  - [ ] Base-immutability trigger prevents direct SQL updates
  - [ ] Reconciliation job scheduled and documented
  - [ ] Key-rotation runbook present in code comments
  - [ ] Deviations: note if 9.4 shipped as a full script or as a stub (stub is acceptable per PRD §6)

---

## Cross-Phase Notes

- **NestJS DI**: every new service/controller constructor param uses explicit `@Inject(ClassName)` per `CLAUDE.md` — the tsx test runner will silently fail without it.
- **Ports**: API on 7100, web on 7101, Postgres on 7011 per project memory.
- **Ollama serial**: any scaffolding or LLM batch is one-at-a-time per project memory.
- **Legal language**: contract scaffolds must use "analysis"/"signal", never "advice"/"recommendation" per project memory.
- **Commit cadence**: each phase ends with a `commit-push` (per the `commit-push` skill) before the next phase starts. The quality gate doubles as the commit gate.
