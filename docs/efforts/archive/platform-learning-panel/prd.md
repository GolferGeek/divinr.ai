# Platform Learning Panel — Product Requirements Document

## 1. Overview

Divinr already has a rudimentary `/chat` experience labeled "Market Assistant", but it is too loose for the product now being defined. It is a page-level chat UI with no persistent thread model, no curated Divinr knowledge corpus, no explicit answer policy beyond prompt text, and no shell-integrated panel behavior. It also lives inside `MarketsService`, which is convenient for the current prototype but too broad for a level-one product surface that should become the primary way users ask "what does this app do?", "what should I learn next?", and "why is this signal risky?"

This effort converts that prototype into a **platform-managed Learning Panel**:

- visible from the main app shell
- backed by Divinr-managed Claude usage rather than per-user BYO keys
- grounded in approved Divinr docs and user-visible context
- explicitly disallowed from open web research
- metered through the existing LLM usage and cost stack
- architected so a later mastery-level effort can make it level-aware without replacing it

Because this effort is being taken before `mastery-levels-learning-profile`, v1 must not depend on a full mastery engine. Instead, it should consume the user signals we already have now: current route/surface, first-touch history, onboarding state, billing state, and visible market/community context. The follow-on mastery effort can later add a richer user learning profile and left-nav simplification on top of this panel foundation.

## 2. Goals & Success Criteria

### Goals

- Replace the current generic `Market Assistant` with a shell-integrated Learning Panel that is clearly framed as Divinr-grounded learning support.
- Keep the panel available to normal logged-in users without requiring a BYO Anthropic key.
- Make the backend technically incapable of performing default web research for this feature.
- Persist enough thread state to support long-running panel conversations with controlled context compaction.
- Reuse existing infrastructure where it already exists: `DefaultLayout.vue`, `/chat`, `FirstTouch`, `LegalDisclaimer`, `MarketsLlmService`, `LlmUsageLogger`, `cost-modeling-system`, and the existing credentials module only for future extension.

### Success Criteria

- Logged-in users can open a Learning Panel from the app shell on desktop and mobile.
- The panel answers questions using a curated Divinr knowledge corpus plus user-visible application context.
- The panel supports persistent per-user threads with rolling summaries or compaction so context cost stays bounded.
- Every Learning Panel LLM call lands in `prediction.llm_usage_log` with a distinct stage value usable for dashboards and billing analysis.
- Admins can isolate Learning Panel usage through the existing LLM usage surfaces without requiring a separate billing subsystem.
- The panel has no backend code path for web search, arbitrary external retrieval, or state-mutating tools.
- New first-touch coverage and browser-test coverage land with the feature.

## 3. User Stories / Use Cases

- As a new user, I can ask "What should I learn first?" and get an answer grounded in the parts of Divinr I can already see.
- As a user looking at a ticker or analysis, I can ask "Why is this signal risky?" or "How do your risk analysts determine their red and blue strategy?" and receive an explanation based on Divinr's own surfaces and docs.
- As a user comparing portfolios, I can ask "What is the difference between my portfolio and analyst portfolios?" and get an educational answer that refers to real app concepts, not generic trading advice.
- As a club or tournament participant, I can ask how those surfaces work without being pushed into unrelated product areas.
- As an admin or operator, I can see that Learning Panel usage is measurable as its own cost/usage slice.
- As a future product owner, I can later layer mastery levels onto this panel without rebuilding the core panel stack.

## 4. Technical Requirements

### 4.1 Architecture

#### Existing baseline

- The shell nav and app chrome live in [DefaultLayout.vue](/Users/golfergeek/projects/divinr.ai/divinr.ai-codex/apps/web/src/layouts/DefaultLayout.vue:1).
- The current chat route is [ChatView.vue](/Users/golfergeek/projects/divinr.ai/divinr.ai-codex/apps/web/src/views/ChatView.vue:1), mounted at `/chat` in [router/index.ts](/Users/golfergeek/projects/divinr.ai/divinr.ai-codex/apps/web/src/router/index.ts:73).
- The backend endpoint is `POST /api/chat/ask`, implemented by `MarketsController.chatAsk()` and `MarketsService.chatAsk()` in the markets module.
- LLM invocation is centralized through [MarketsLlmService](/Users/golfergeek/projects/divinr.ai/divinr.ai-codex/apps/api/src/markets/services/markets-llm.service.ts:1), and usage logging is already handled by `LlmUsageLogger`.
- First-touch coverage exists through `FirstTouchModule`, `useFirstTouch`, and `surface-content.ts`.
- Per-user encrypted provider credentials already exist in `CredentialsModule`, but that system is not the default for this effort.

#### Target module split

Create a new backend feature module:

- `apps/api/src/learning-panel/learning-panel.module.ts`
- `learning-panel.controller.ts`
- `learning-panel.service.ts`
- `learning-panel-schema.service.ts`
- `learning-panel-corpus.service.ts`
- `learning-panel-context.service.ts`

Import dependencies:

- `MarketsModule` for read-only market and analyst context
- `FirstTouchModule` for touched-surface history
- `OnboardingModule` for onboarding state
- `BillingModule` only if needed for read-only billing visibility/context
- `CredentialsModule` only for future optional BYO mode hooks, not for v1 request flow

Frontend additions:

- `apps/web/src/components/learning-panel/LearningPanelDrawer.vue`
- `LearningPanelThreadList.vue`
- `LearningPanelComposer.vue`
- `LearningPanelMessageList.vue`
- `LearningPanelLauncherButton.vue`
- `apps/web/src/stores/learningPanel.store.ts`
- `apps/web/src/api/learning-panel.ts`

Frontend route strategy:

- Keep `/chat` as the canonical full-page route for the experience, but rename the UI label from `Market Assistant` to `Learning Panel`.
- Add a shell-integrated drawer/panel in `DefaultLayout.vue` so the panel is available without leaving the current surface.
- Desktop: right-side drawer/panel.
- Mobile: full-height modal/sheet or route handoff to `/chat`, depending on available Ionic patterns in the repo.

#### Conversation model

The current one-shot `/chat/ask` call is insufficient. Replace it with thread-based interactions:

- create thread
- list threads
- fetch thread
- append user message
- receive assistant response with citations/grounding metadata

The backend composes each assistant response from:

1. system policy
2. retrieved Divinr corpus chunks
3. current route/surface context
4. small user-state summary derived from onboarding + first-touch state
5. rolling thread summary
6. last N raw messages

The panel must remain read-only in v1. No tool invocations that mutate app state are allowed.

#### Lightweight learning-state bridge for v1

Because the full mastery-level effort is intentionally deferred, `learning-panel-context.service.ts` must derive a minimal "what this user has likely already seen" summary from existing data:

- `prediction.user_surface_touches` via `FirstTouchService`
- onboarding completion / docent state via `OnboardingService`
- current route and mapped surface key
- optional visible entity ids from the current screen

This summary is prompt input only in v1. It is not a replacement for the later persisted mastery profile.

### 4.2 Data Model Changes

Add new tables in the `prediction` schema:

#### `prediction.learning_panel_threads`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid primary key | |
| `user_id` | text not null | owner of the thread |
| `title` | text not null | generated short title; user-editable later is out of scope |
| `origin_surface_key` | text null | initial UI surface where thread started, e.g. `predictions`, `instrument.detail` |
| `archived_at` | timestamptz null | |
| `last_message_at` | timestamptz not null default now() | |
| `created_at` | timestamptz not null default now() | |
| `updated_at` | timestamptz not null default now() | |

Indexes:

- `(user_id, last_message_at desc)`
- `(user_id, archived_at)`

#### `prediction.learning_panel_messages`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid primary key | |
| `thread_id` | uuid not null references `learning_panel_threads(id)` | |
| `role` | text not null check (`user`, `assistant`, `system_summary`) | |
| `content_markdown` | text not null | stored rendered text body |
| `surface_key` | text null | current route/surface at send time |
| `citations_json` | jsonb null | references to corpus docs / app surfaces / entities |
| `llm_usage_id` | uuid null | stamp from `prediction.llm_usage_log` |
| `prompt_tokens` | integer null | copied from response metadata when available |
| `completion_tokens` | integer null | copied from response metadata when available |
| `created_at` | timestamptz not null default now() | |

Indexes:

- `(thread_id, created_at)`
- `(llm_usage_id)` partial where non-null

#### `prediction.learning_panel_thread_state`

| Column | Type | Notes |
|---|---|---|
| `thread_id` | uuid primary key references `learning_panel_threads(id)` | |
| `summary_markdown` | text not null default '' | rolling compacted summary |
| `summary_version` | integer not null default 1 | |
| `message_count` | integer not null default 0 | |
| `last_compacted_message_id` | uuid null | |
| `updated_at` | timestamptz not null default now() | |

Purpose:

- keep the raw thread from growing unbounded
- avoid re-sending all prior turns
- allow compaction without deleting user-visible messages

#### `prediction.learning_panel_feedback`

Optional but included in v1 because the effort is explicitly intended as a learning surface for you, interns, and beta users:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid primary key | |
| `thread_id` | uuid not null | |
| `message_id` | uuid not null | assistant message being scored |
| `user_id` | text not null | |
| `feedback` | text not null check (`helpful`, `unhelpful`) | |
| `note` | text null | short freeform |
| `created_at` | timestamptz not null default now() | |

This supports product iteration without requiring full conversation analytics first.

#### No new provider-secret table

Do not create a separate secret store for the default Learning Panel. Platform-managed provider credentials remain environment/secret-manager driven. The existing `credentials.user_llm_credentials` table remains available for future BYO mode only.

### 4.3 API Changes

Add a dedicated controller under `/api/learning-panel`.

#### `GET /api/learning-panel/bootstrap`

Returns:

- whether the panel is enabled
- starter prompts
- thread list summary
- current route-compatible suggestions
- policy flags such as `webResearchEnabled=false`

#### `GET /api/learning-panel/threads`

Returns current user's thread list:

- `id`
- `title`
- `originSurfaceKey`
- `lastMessageAt`
- `preview`

#### `POST /api/learning-panel/threads`

Body:

```json
{
  "originSurfaceKey": "predictions",
  "initialMessage": "What should I learn first?"
}
```

Behavior:

- creates the thread
- appends first user message
- produces assistant reply
- returns the hydrated thread payload

#### `GET /api/learning-panel/threads/:threadId`

Returns:

- thread metadata
- ordered messages
- summary metadata

#### `POST /api/learning-panel/threads/:threadId/messages`

Body:

```json
{
  "message": "Why is this signal risky?",
  "surfaceKey": "instrument.detail",
  "instrumentId": "uuid-optional"
}
```

Behavior:

- validates ownership
- records user message
- builds read-only Divinr context
- performs corpus retrieval
- applies compaction if thresholds reached
- invokes LLM
- stores assistant message with citations and `llm_usage_id`

#### `POST /api/learning-panel/messages/:messageId/feedback`

Body:

```json
{
  "feedback": "helpful",
  "note": "Good explanation of analyst portfolios"
}
```

#### Route transition / compatibility

- Keep `POST /api/chat/ask` temporarily as a compatibility shim during implementation.
- The new Learning Panel endpoints must be readable by normal authenticated users even when the user is read-only from a billing perspective. The current `MarketsController.chatAsk()` calls `requireWriteAccess(user)`; that guard must not remain on the new panel path.
- Once the new thread-based panel ships, `MarketsService.chatAsk()` should either delegate to the new service or be deprecated from the nav-facing UI path.
- PRD requirement: there must be only one user-facing assistant concept after the effort ships.

### 4.4 Frontend Changes

#### Shell integration

Modify `DefaultLayout.vue`:

- rename nav item `Market Assistant` → `Learning Panel`
- add a launcher button that opens the drawer without route navigation on desktop
- keep a route to `/chat` for full-screen/mobile/fallback use
- ensure the panel does not conflict with activity panel, onboarding docent, first-touch overlays, trial chip, or read-only banner

#### Full-page experience

Refactor `ChatView.vue` into a thread-aware Learning Panel view:

- thread switcher/history
- empty-state prompts tied to the current route or selected entity
- citations/rendered references to Divinr docs and surfaces
- disclaimers where needed through `<LegalDisclaimer>`
- no user-visible `prediction`, `advice`, or `recommendation` language

#### App context hooks

The store should pass lightweight visible context into requests:

- current route name / mapped surface key
- selected instrument or analyst id when the current view already has it
- current tournament or club id if in that surface

Do not scrape hidden DOM or send private client state that the user cannot already see.

#### First-touch and onboarding

Add first-touch content entries:

- `learning-panel`
- `learning-panel.thread`
- optionally `learning-panel.citations` if a distinct UI surface exists

Wire either `useFirstTouch('learning-panel')` or `<FirstTouchPanel surface-key="learning-panel" />` into the new panel surface.

Because this is a new user-visible surface, the effort must also extend deep testing coverage, per repo convention. The likely path is a new learning/browser skill and at least one Playwright spec under `apps/e2e/tests/`.

### 4.5 Infrastructure Requirements

#### LLM provider usage

Use the existing `MarketsLlmService` and `LlmUsageLogger` for v1 rather than inventing a second LLM execution path. Required adjustments:

- support `stage: 'learning_panel'` in `LlmUsageContext`
- allow setting provider/model defaults appropriate for the panel
- ensure `includeMetadata` usage remains available for token accounting

#### Retrieval corpus

V1 should avoid external vector infrastructure. Build a curated corpus service from repo/application artifacts already under source control or returned by existing APIs:

- `apps/web/src/onboarding/surface-content.ts`
- onboarding/tour content
- `docs/features.md`
- curated markdown files under a new `docs/learning-panel/` or `apps/api/src/learning-panel/corpus/` directory
- selected static explanations of analyst/risk/tournament/club mechanics

Retrieval in v1 can be lexical/heuristic chunk matching with explicit chunk limits. Vector search is out of scope.

#### Config/env

Add explicit config knobs:

- `LEARNING_PANEL_ENABLED`
- `LEARNING_PANEL_MAX_INPUT_CHARS`
- `LEARNING_PANEL_MAX_OUTPUT_TOKENS`
- `LEARNING_PANEL_MAX_RETRIEVED_CHUNKS`
- `LEARNING_PANEL_COMPACTION_TRIGGER_MESSAGES`
- `LEARNING_PANEL_MONTHLY_MESSAGE_LIMIT`
- `LEARNING_PANEL_MONTHLY_COST_CENTS_LIMIT`
- `LEARNING_PANEL_MODEL_PROVIDER`
- `LEARNING_PANEL_MODEL_NAME`

Defaults should point to an inexpensive platform-managed commercial model. In this repo's current config shape, Anthropic support exists at the provider layer, but `MarketsLlmService` currently defaults to `openrouter` for commercial fallback and does not yet carry a panel-specific model selection. The effort should make panel model selection explicit rather than relying on pipeline defaults.

## 5. Non-Functional Requirements

### Performance

- `GET /bootstrap` and `GET /threads` should return in under 300ms for warm DB/cache paths.
- `POST /threads/:id/messages` should begin streaming or return a completed response within normal LLM latency expectations; non-streaming v1 is acceptable if total p95 remains under 8 seconds for normal prompts.
- Retrieval assembly must enforce strict chunk limits so prompt assembly is predictable.

### Security

- No web search integration, browser tool, or arbitrary URL fetch exists in the Learning Panel backend path.
- Only read-only context is exposed to the panel.
- User thread ownership is enforced on every thread/message read-write route.
- Existing platform secrets remain server-side only.
- If/when citations reference internal entities, they must only reference entities the current user can already access.

### Cost control

- Every assistant response records `llm_usage_id`.
- Monthly limits are enforceable per user using `prediction.llm_usage_log` stage filtering and/or thread/message counts.
- Compaction keeps prompt size bounded.
- Prompt assembly must not include entire large documents when only a few chunks are relevant.

### Compatibility

- Desktop and mobile shell behavior must both be supported.
- Existing `/chat` deep links should not break.
- Existing `/usage` and cost dashboards should continue to function without schema rewrites, because they already aggregate by free-text stage.

## 6. Out of Scope

- Full mastery-level / left-nav simplification system
- Automatic capability unlocking by familiarity level
- Builder actions that create analysts, instruments, clubs, tournaments, or trades
- Open web research, live market-news lookup, or arbitrary external search
- BYO key as the default panel model
- Vector database / semantic search infrastructure
- Streaming transport if it materially delays delivery; acceptable only if it fits cleanly into the current stack

## 7. Dependencies & Risks

### Dependencies

- Existing shell/nav in `DefaultLayout.vue`
- Existing `/chat` route and markets chat plumbing
- `FirstTouchModule` and onboarding data for route/surface education
- `MarketsLlmService` and `LlmUsageLogger`
- `llm-usage-logging` and `cost-modeling-system`
- Existing UI vocabulary rules and `<LegalDisclaimer>` variants

### Risks

| Risk | Impact | Mitigation |
|---|---|---|
| The current `MarketsService.chatAsk()` is too generic and may tempt incremental patching instead of a proper panel service | Architecture drift and policy gaps | Move ownership into a dedicated `learning-panel` module; leave only a compatibility shim in markets |
| Learning Panel shipped first could hard-code assumptions that conflict with future mastery levels | Rework during the mastery effort | Keep level-awareness in v1 limited to visible surface context and onboarding/first-touch signals; define explicit extension points instead of a fake full level system |
| A shell-side panel can clash with Activity, onboarding docent, and mobile nav behavior | UI instability in the main app shell | Implement desktop drawer + mobile route/sheet behavior deliberately; verify with browser tests across both sizes |
| Prompt size and cost could drift upward as more docs/context are added | Margin erosion | Hard limits on retrieved chunks, stored summaries, message length, output tokens, and monthly usage |
| Users may interpret responses as trading advice | Product/compliance confusion | Enforce copy policy in system prompt, UI labeling, and disclaimer treatment; no recommendation/advice language |
| Existing BYO credentials feature may confuse product messaging | Two competing assistant models | PRD explicitly states BYO credentials remain future-only for this panel; default panel is platform-managed |

## 8. Phasing

### Phase 1: Reframe the Existing Assistant

Meaningful increment:

- Rename `Market Assistant` to `Learning Panel`
- Introduce dedicated backend module and frontend API/store
- Keep `/chat` functioning but route requests through the new service layer
- Define system policy and ban external research by implementation, not prompt only

Validation:

- `/chat` still works
- nav label and copy updated
- calls log with `stage='learning_panel'`

### Phase 2: Threads, Persistence, and Compaction

Meaningful increment:

- Add thread/message/state tables
- Thread list, create, fetch, append message APIs
- Rolling summary compaction path

Validation:

- conversations survive refresh
- long threads stop growing prompt size linearly
- assistant replies retain recent context after compaction

### Phase 3: Divinr Grounding and Citations

Meaningful increment:

- Curated corpus service
- surface-aware prompt assembly
- citations metadata returned and rendered
- current visible entity context injection

Validation:

- answers cite Divinr surfaces/docs
- no web-search code path exists
- panel is materially better than the current generic assistant

### Phase 4: Shell Integration and UX Hardening

Meaningful increment:

- drawer/sheet integration in `DefaultLayout.vue`
- mobile/desktop behavior
- first-touch coverage
- disclaimer/policy polish

Validation:

- panel usable without leaving the current screen
- shell does not conflict with activity panel or onboarding overlays
- first-touch coverage checker passes

### Phase 5: Metering, Limits, and Feedback Loop

Meaningful increment:

- usage-limit enforcement
- admin visibility through existing usage dashboards
- helpful/unhelpful feedback capture

Validation:

- admins can isolate Learning Panel usage
- monthly limit behavior is deterministic
- beta feedback rows are persisted for iteration

---

This effort intentionally ships the Learning Panel before the broader mastery-level effort. The panel therefore becomes the educational spine first, while the later mastery effort will simplify the left nav and formalize progression around a panel that already exists and already knows how to teach the user what they are seeing.
