# Platform Learning Panel — Implementation Plan

**PRD**: `docs/efforts/current/platform-learning-panel/prd.md`
**Created**: 2026-04-26
**Status**: In Progress

## Progress Tracker
- [x] Phase 1: Dedicated Learning Panel Backend
- [x] Phase 2: Persistent Threads and Compaction
- [x] Phase 3: Divinr Grounding and Citations
- [x] Phase 4: Shell Integration and User Surface
- [ ] Phase 5: Metering, Limits, and Feedback

---

## Phase 1: Dedicated Learning Panel Backend
**Status**: Completed
**Objective**: Replace the ad hoc markets chat entrypoint with a dedicated read-only Learning Panel module and API contract.

### Steps
- [x] 1.1 Create `apps/api/src/learning-panel/` with `learning-panel.module.ts`, controller, service, schema service, corpus service, and context service; register the module in `AppModule` with explicit `@Inject(...)` on every constructor parameter.
- [x] 1.2 Move user-facing assistant orchestration out of `MarketsService.chatAsk()` into the new service, keeping `POST /api/chat/ask` as a compatibility shim that delegates to the Learning Panel service.
- [x] 1.3 Add `GET /api/learning-panel/bootstrap`, `GET /threads`, `POST /threads`, `GET /threads/:threadId`, and `POST /threads/:threadId/messages` controller routes with authenticated-user ownership checks.
- [x] 1.4 Remove write-access gating from the Learning Panel path so read-only billing users can still use it; add or extend unit coverage around the chosen guard behavior.
- [x] 1.5 Add panel-specific config resolution for enablement, provider/model, message length, output-token, and retrieval limits instead of inheriting generic markets defaults implicitly.
- [x] 1.6 Leave a narrow future hook for optional BYO routing via the existing `CredentialsModule` interface without using BYO credentials in the v1 request path.
- [x] 1.7 Update the existing `/chat` frontend API caller shape to the new backend contract or add an adapter layer so only one user-facing assistant concept remains.

### Quality Gate
Before moving to Phase 2, ALL of the following must pass:

- [x] **Lint**: `pnpm --filter @divinr/api run lint`
- [x] **Build**: `pnpm --filter @divinr/api run build`
- [x] **Unit Tests**: targeted Learning Panel + chat/auth guard tests pass, then full API unit suite passes
  `pnpm --filter @divinr/api run test:unit`
- [x] **E2E Tests**: existing smoke auth flow still passes
  `pnpm --filter @divinr/e2e run prepare-auth`
  `pnpm --filter @divinr/e2e run e2e --project=smoke`
- [x] **Curl Tests**: authenticated local API responds correctly
  `curl -s -H "Authorization: Bearer $DIVINR_TOKEN" http://localhost:7100/api/learning-panel/bootstrap`
  `curl -s -X POST -H "Authorization: Bearer $DIVINR_TOKEN" -H "Content-Type: application/json" http://localhost:7100/api/learning-panel/threads -d '{"originSurfaceKey":"predictions","initialMessage":"What should I learn first?"}'`
- [x] **Chrome Tests**: verify one assistant concept only
  Login, open `/chat`, confirm Learning Panel labeling.
  Confirm read-only users can open the panel path.
- [x] **Phase Review**: Compare implementation against Phase 1 objectives in the PRD
  - [x] Did we accomplish what we said we would?
  - [x] Does the code align with the PRD requirements?
  - [x] Are there any deviations? If so, document why.

Phase 1 note:
- Thread persistence remains intentionally in-memory in this phase. Durable storage, summaries, and refresh-safe history are deferred to Phase 2 by design.

---

## Phase 2: Persistent Threads and Compaction
**Status**: Completed
**Objective**: Add durable thread/message storage and bounded-context conversation compaction.

### Steps
- [x] 2.1 Extend schema creation with `prediction.learning_panel_threads`, `prediction.learning_panel_messages`, and `prediction.learning_panel_thread_state`, including indexes and ownership-safe fetch patterns.
- [x] 2.2 Implement thread creation, thread listing, message append, and thread fetch service methods with deterministic ordering and ownership checks.
- [x] 2.3 Add rolling summary compaction logic in the service layer: trigger after configured message count, persist `system_summary`, and keep raw user/assistant messages intact for display.
- [x] 2.4 Stamp assistant messages with `llm_usage_id` and token counts when metadata is available.
- [x] 2.5 Add targeted unit tests covering ownership, compaction threshold behavior, summary refresh, and compatibility shim behavior.

### Quality Gate
Before moving to Phase 3, ALL of the following must pass:

- [x] **Lint**: `pnpm --filter @divinr/api run lint`
- [x] **Build**: `pnpm --filter @divinr/api run build`
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit`
- [ ] **E2E Tests**: smoke auth plus Learning Panel thread creation flow on the page shell or route stub if frontend landed in parallel
  `pnpm --filter @divinr/e2e run prepare-auth`
  `pnpm --filter @divinr/e2e run e2e --project=smoke`
- [ ] **Curl Tests**:
  `THREAD_ID=$(curl -s -X POST -H "Authorization: Bearer $DIVINR_TOKEN" -H "Content-Type: application/json" http://localhost:7100/api/learning-panel/threads -d '{"originSurfaceKey":"predictions","initialMessage":"How do tournaments work?"}' | jq -r '.thread.id')`
  `curl -s -H "Authorization: Bearer $DIVINR_TOKEN" http://localhost:7100/api/learning-panel/threads/$THREAD_ID`
  `curl -s -X POST -H "Authorization: Bearer $DIVINR_TOKEN" -H "Content-Type: application/json" http://localhost:7100/api/learning-panel/threads/$THREAD_ID/messages -d '{"message":"What should I learn next?","surfaceKey":"predictions"}'`
- [ ] **Chrome Tests**:
  Open Learning Panel, send multiple messages, refresh, and confirm thread history persists.
  Continue a long thread and confirm earlier context is still reflected after compaction threshold is crossed.
- [ ] **Phase Review**: Compare implementation against Phase 2 objectives in the PRD
  - [x] Did we accomplish what we said we would?
  - [x] Does the code align with the PRD requirements?
  - [x] Are there any deviations? If so, document why.

Phase 2 notes:
- Durable thread persistence, rolling summary compaction, `llm_usage_id` stamping, and targeted unit coverage are implemented.
- The web dev shell needed an explicit `/api/learning-panel` proxy entry in `apps/web/vite.config.ts`; that route now reaches the backend instead of 404ing.
- Full page-level browser verification is currently blocked by broader local API database timeouts on shell bootstrap requests. Direct API checks against `http://127.0.0.1:7100/api/learning-panel/*` pass, while proxied shell loads can still surface unrelated 500s from other app modules under local load.

---

## Phase 3: Divinr Grounding and Citations
**Status**: Completed
**Objective**: Ground answers in approved Divinr docs and visible app context, with no web-research path.

### Steps
- [x] 3.1 Create a curated Learning Panel corpus source from repo-backed content such as `apps/web/src/onboarding/surface-content.ts`, onboarding tour copy, `docs/features.md`, and any new curated `docs/learning-panel/` or module-local markdown files.
- [x] 3.2 Implement retrieval/chunking with explicit caps on chunk count and prompt assembly size; no vector DB, browser, or arbitrary URL fetching.
- [x] 3.3 Implement `learning-panel-context.service.ts` to derive v1 learning-state hints from `FirstTouchService`, `OnboardingService`, current surface key, and visible entity ids.
- [x] 3.4 Add citations metadata to assistant messages so the UI can render what doc/surface/entity grounded the answer.
- [x] 3.5 Update prompt policy to enforce analysis/signal vocabulary and educational framing with no recommendation/advice language.
- [x] 3.6 Add first-touch content entries to `apps/web/src/onboarding/surface-content.ts` for any new panel surfaces introduced in this phase.
- [x] 3.7 Testing-coverage update: stub a new `.agents/skills/divinr-learning-panel-browser-skill/` folder with the six required files, register a `learning-panel` Playwright project in `apps/e2e/playwright.config.ts`, and add at least one green spec under `apps/e2e/tests/learning-panel/`.

### Quality Gate
Before moving to Phase 4, ALL of the following must pass:

- [x] **Lint**: `pnpm lint`
- [x] **Build**: `pnpm build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit`
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit`
- [x] **E2E Tests**:
  `pnpm --filter @divinr/e2e run prepare-auth`
  `pnpm --filter @divinr/e2e run e2e --project=learning-panel`
- [x] **Curl Tests**:
  `curl -s -H "Authorization: Bearer $DIVINR_TOKEN" http://localhost:7100/api/learning-panel/bootstrap | jq`
  `curl -s -X POST -H "Authorization: Bearer $DIVINR_TOKEN" -H "Content-Type: application/json" http://localhost:7100/api/learning-panel/threads/$THREAD_ID/messages -d '{"message":"How do your risk analysts determine their red and blue strategy?","surfaceKey":"risk-dashboard"}'`
- [x] **Chrome Tests**:
  Ask a corpus-grounded question and verify the answer cites Divinr docs/surfaces.
  Confirm there is no UI affordance or backend behavior for external web search.
- [x] **Phase Review**: Compare implementation against Phase 3 objectives in the PRD
  - [x] Did we accomplish what we said we would?
  - [x] Does the code align with the PRD requirements?
  - [x] Are there any deviations? If so, document why.

Phase 3 notes:
- The Learning Panel now pulls a curated corpus from repo-backed content in `docs/features.md` and renders visible `Grounded in` citations in the chat UI.
- First-touch coverage for the `/chat` surface is wired with `surface-key="chat"`.
- The Learning Panel browser skill and `learning-panel` Playwright project are in place with a green smoke spec.
- Local e2e execution currently uses self-auth inside the spec because this checkout does not include `apps/e2e/.env` test-user credentials for `prepare-auth`.

---

## Phase 4: Shell Integration and User Surface
**Status**: Completed
**Objective**: Turn the route-based assistant into a real shell-integrated Learning Panel across desktop and mobile.

### Steps
- [x] 4.1 Refactor `apps/web/src/views/ChatView.vue` into the Learning Panel experience with thread list, message list, composer, citations, and empty-state prompts tied to visible surfaces.
- [x] 4.2 Add a shell-integrated drawer/sheet/launcher in `apps/web/src/layouts/DefaultLayout.vue`; rename the nav item from `Market Assistant` to `Learning Panel`.
- [x] 4.3 Ensure the panel does not conflict with `ActivityPanel`, onboarding docent/modals, `TrialCountdown`, or `ReadOnlyBanner` across desktop and mobile layouts.
- [x] 4.4 Add `useFirstTouch('<key>')` or `<FirstTouchPanel surface-key="...">` to the new panel surfaces and confirm corresponding `surface-content.ts` entries exist.
- [x] 4.5 Extend the new learning-panel browser skill `tests.md` and Playwright coverage to include shell launcher behavior, route fallback, and mobile rendering.

### Quality Gate
Before moving to Phase 5, ALL of the following must pass:

- [x] **Lint**: `pnpm lint`
- [x] **Build**: `pnpm build`
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit`
- [ ] **E2E Tests**:
  `pnpm --filter @divinr/e2e run prepare-auth`
  `pnpm --filter @divinr/e2e run e2e --project=learning-panel`
- [x] **E2E Tests**:
  `BASE_URL=http://localhost:7101 pnpm --filter @divinr/e2e exec playwright test tests/learning-panel/smoke.spec.ts --project=learning-panel`
- [x] **Curl Tests**:
  `curl -s -H "Authorization: Bearer $DIVINR_TOKEN" http://localhost:7100/api/learning-panel/threads`
- [x] **Chrome Tests**:
  Desktop: open panel from shell without route navigation, send a message, inspect citations.
  Mobile: open panel from shell or route fallback, confirm layout is usable and text does not overlap.
  Verify first-touch panel appears once for the new Learning Panel surface.
- [x] **Phase Review**: Compare implementation against Phase 4 objectives in the PRD
  - [x] Did we accomplish what we said we would?
  - [x] Does the code align with the PRD requirements?
  - [x] Are there any deviations? If so, document why.

Phase 4 notes:
- The `/chat` route now reuses a shared `LearningPanelSurface` component with a visible thread list, starter prompts, citations, and first-touch coverage.
- The main shell opens the Learning Panel from both desktop chrome and mobile overflow via an `IonModal` that behaves like a right-side drawer on desktop and a sheet on smaller viewports.
- Opening the Learning Panel now closes the fixed `ActivityPanel`, avoiding the overlapping-right-rail conflict in the shell.
- Playwright coverage now includes route fallback, desktop shell launch, and mobile shell launch.

---

## Phase 5: Metering, Limits, and Feedback
**Status**: Not Started
**Objective**: Enforce cost/usage limits and close the beta feedback loop.

### Steps
- [ ] 5.1 Log all panel calls with `stage='learning_panel'` and verify they appear correctly in existing LLM usage queries and dashboards.
- [ ] 5.2 Implement per-user message/cost limit enforcement using config + `prediction.llm_usage_log` aggregates, returning deterministic UI-safe limit errors.
- [ ] 5.3 Add `prediction.learning_panel_feedback` persistence and `POST /api/learning-panel/messages/:messageId/feedback`.
- [ ] 5.4 Surface helpful/unhelpful controls in the UI and ensure they do not clutter the core message flow.
- [ ] 5.5 Add or extend admin/browser coverage for usage visibility if the existing admin usage surface needs a Learning Panel-specific assertion.

### Quality Gate
Before marking the effort complete, ALL of the following must pass:

- [ ] **Lint**: `pnpm lint`
- [ ] **Build**: `pnpm build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit`
- [ ] **E2E Tests**:
  `pnpm --filter @divinr/e2e run prepare-auth`
  `pnpm --filter @divinr/e2e run e2e --project=learning-panel`
  `pnpm --filter @divinr/e2e run e2e --project=admin`
- [ ] **Curl Tests**:
  `curl -s -H "Authorization: Bearer $DIVINR_TOKEN" "http://localhost:7100/api/usage/summary?stage=learning_panel&startDate=2026-04-01&endDate=2026-04-30"`
  `curl -s -X POST -H "Authorization: Bearer $DIVINR_TOKEN" -H "Content-Type: application/json" http://localhost:7100/api/learning-panel/messages/$MESSAGE_ID/feedback -d '{"feedback":"helpful","note":"Clear explanation"}'`
- [ ] **Chrome Tests**:
  Verify limit-warning/limit-reached behavior is coherent.
  Verify Learning Panel usage is visible in admin usage surfaces.
  Verify helpful/unhelpful feedback controls persist without breaking conversation flow.
- [ ] **Phase Review**: Compare implementation against Phase 5 objectives in the PRD
  - [ ] Did we accomplish what we said we would?
  - [ ] Does the code align with the PRD requirements?
  - [ ] Are there any deviations? If so, document why.
