# User-Authored Custom Content — Product Requirements Document

## 1. Overview

Basic users ($50/mo) today receive the full base layer: every base analyst × every base instrument, with universal fanout. A distinct segment of users wants to author their *own* analytical universe — a China-hawk AAPL contract, a new "Aggressive Growth" analyst, a brand-new instrument not in the base universe, explicit analyst↔instrument wiring instead of all-by-all. The triple model `(user_id, analyst_id, instrument_id)` and stage-keyed contracts already anticipate this; the schema has `user_id` columns on `prediction.market_analysts` and `prediction.instruments`. What's missing is (a) the schema integrity for multi-user same-slug authorship, (b) the authoring surface (API + UI), (c) runtime participant filtering so authored triples flow through Stages 1–4 for the author only, (d) per-item billing, and (e) optional BYO LLM credentials. This effort delivers those pieces while leaving the base layer behavior byte-identical for users who don't opt in.

## 2. Goals & Success Criteria

### Goals
1. A user can author a new analyst, a new instrument, and a contract override (analyst or instrument) through the web UI.
2. Authored content is schema-isolated: two users can author "aapl" analysts or "QQQ" instruments without collision; base content is immutable.
3. Authored triples flow through the existing 5-stage pipeline (Article Processing → Predictor Generation → Risk Assessment [including Risk Debate] → Prediction Generation → Learning) with no special-case code paths. The author — and only the author — sees their authored analysts in per-instrument risk debates.
4. Per-item authorship is billed monthly at `INSTRUMENT_AUTHORSHIP_USD` / `ANALYST_AUTHORSHIP_USD` (configurable via env, defaults $20/$60). Billing preview reflects live changes in the authoring UI.
5. A user can optionally attach their own LLM provider credential; their authored analyst routes inference through that credential and their provider bills them directly. A `BYO_PLATFORM_FEE_USD` is charged on top of Basic.
6. Basic users who never author see zero change in behavior, bill, or UI surface (beyond a discoverable "Your Authored Content" entry).
7. The `MarketsService.createAnalyst` upsert (`apps/api/src/markets/markets.service.ts`, method `createAnalyst`) no longer collides across users — CI integration tests pass.

### Success Criteria (measurable)
- `markets-integration-test-infra` suite green; specifically the `createAnalyst` path no longer errors on `ON CONFLICT` when two users author the same slug.
- A seeded test user can POST `/api/market-analysts` with `{ slug: "aapl", ... }` while the base "aapl" analyst also exists; both records coexist with distinct `id`s and `(user_id, slug)` uniqueness enforced.
- Stage 1 relevance runs once per (article × instrument variant) — verified by counting `article_relevance` rows against `(base instruments + custom instruments authored by active users)`.
- Risk debate for a custom AAPL instrument includes exactly the authored analysts the owner wired; for base AAPL, a non-authoring viewer sees only base analysts, while an authoring viewer sees base + their own authored analysts.
- A user adds a custom instrument; billing ledger shows `+$20/mo` line item; removing it produces `-$20/mo`; Stripe subscription item quantity updates accordingly.
- A user attaches an Anthropic API key, toggles one authored analyst to `provider = 'byo_anthropic'`, triggers Stage 4 on a test instrument; `markets-llm.service.ts` routes through the stored credential; Divinr usage ledger records `$0` LLM cost for that run, and `$BYO_PLATFORM_FEE_USD` appears on next invoice.

## 3. User Stories / Use Cases

**US-1 — The custom-lens user.** "I want my AAPL analysis to weight China supply-chain risk heavier than base does. I author a custom instrument contract for AAPL that overrides `## Stage: Article Processing` and `## Stage: Risk Assessment`, wire my existing analysts to it, pay $20/mo. My AAPL view is now different from base; I see both on the instrument detail page."

**US-2 — The new-analyst quant.** "I want an 'Aggressive Growth' analyst with a different risk appetite. I author a new analyst from scratch via a guided scaffold (LLM seeds a draft stage-keyed contract, I edit it), wire it to 6 existing base instruments, pay $60/mo. My analyst now runs Stages 2–5 for those 6 instruments, visible only to me in the debate."

**US-3 — The uncovered-instrument user.** "I want coverage of $TSLY (the Tesla covered-call ETF), not in Divinr's base universe. I author a new instrument, pick sources from the existing source catalog, wire 3 authored analysts to it, pay $20/mo. Stage 1 runs relevance on all ingested articles against $TSLY for me only; downstream stages fire for the 3 authored triples."

**US-4 — The BYO-key power user.** "I have Anthropic credits; I don't want to use Divinr's Gemma. I attach my Anthropic key, flag two authored analysts to use `claude-opus-4-6`, pay Basic + `$BYO_PLATFORM_FEE_USD`. Anthropic bills me directly for inference; Divinr's compute ledger records $0 LLM cost for those runs."

**US-5 — The base-only user (no change).** "I pay $50/mo Basic, never author anything, never see a change. The 'Your Authored Content' settings section exists but is empty; no billing delta; no UI clutter on the instrument detail or debate pages."

**US-6 — The collision author.** "The base analyst slug 'macro' exists. I want my own 'macro' analyst. The system creates a separate record with my `user_id`; base 'macro' is untouched; my bill reflects one custom analyst."

## 4. Technical Requirements

### 4.1 Architecture

No new services. Existing services extended:

- **`MarketsService`** (`apps/api/src/markets/markets.service.ts`, method `createAnalyst`) — `createAnalyst` / `createInstrument` upsert key changes from `(slug)` / `(symbol)` to `(user_id, slug)` / `(user_id, symbol)`. New endpoints for listing and deleting a user's authored content.
- **`MarketsSchemaService`** (`apps/api/src/markets/schema/markets-schema.service.ts`) — add `author_user_id` columns on `analyst_config_versions` and `instrument_config_versions`; replace global unique indexes with user-scoped ones. Billing tables land in a separate `billing` schema (see §4.2).
- **`MarketsLlmService`** (`apps/api/src/markets/services/markets-llm.service.ts`) — accept per-analyst credential + model override, route through BYO credential when set.
- **`RiskDebateService`** (`apps/api/src/markets/services/risk-debate.service.ts`) — participant-set resolution uses `viewer_user_id` to add the viewer's authored analysts (via `viewer_instrument_analyst_assignments` + authored-analyst lookups).
- **New `BillingService`** (new module, `apps/api/src/billing/`) — Stripe subscription management, per-item line items, trial lifecycle, BYO platform fee.
- **New `CredentialsService`** (new module, `apps/api/src/credentials/`) — encrypted storage of user LLM provider keys (AES-256-GCM at rest, `CREDENTIAL_ENCRYPTION_KEY` env).

Runtime principle: pipeline code does not branch on `author_user_id`. Queries that produce the "active triple set" for a cycle filter by `user_id IS NULL OR author has active subscription`; downstream code processes every returned triple identically.

### 4.2 Data Model Changes

**Uniqueness + authorship columns** (migration in `MarketsSchemaService`):

```sql
-- Drop legacy global unique indexes
drop index if exists prediction.market_analysts_slug_unique_idx;
drop index if exists prediction.instruments_symbol_unique_idx;

-- User-scoped uniqueness (base content uses sentinel 'base' for the null-coalesce)
create unique index market_analysts_slug_user_unique
  on prediction.market_analysts (slug, coalesce(user_id, 'base'));
create unique index instruments_symbol_user_unique
  on prediction.instruments (symbol, coalesce(user_id, 'base'));

-- author_user_id on config-version tables (NULL = base, NOT NULL = user-authored)
alter table prediction.analyst_config_versions
  add column if not exists author_user_id text;
alter table prediction.instrument_config_versions
  add column if not exists author_user_id text;
create index if not exists analyst_config_versions_author_idx
  on prediction.analyst_config_versions (author_user_id) where author_user_id is not null;
create index if not exists instrument_config_versions_author_idx
  on prediction.instrument_config_versions (author_user_id) where author_user_id is not null;

-- Sharing plumbing (UI deferred per master-intention §5.4)
alter table prediction.market_analysts
  add column if not exists shared_with_clubs boolean not null default false;
alter table prediction.instruments
  add column if not exists shared_with_clubs boolean not null default false;
-- shared_with_users: a join table, not a column
create table if not exists prediction.authored_content_shares (
  content_kind text not null check (content_kind in ('analyst', 'instrument')),
  content_id text not null,
  shared_with_user_id text not null,
  shared_at timestamptz not null default now(),
  primary key (content_kind, content_id, shared_with_user_id)
);
```

**Per-analyst model + credential selection** (new columns):

```sql
alter table prediction.market_analysts
  add column if not exists llm_provider text,     -- 'divinr' (default) | 'byo_anthropic' | 'byo_openai' | 'byo_openrouter'
  add column if not exists llm_model text,        -- e.g. 'gemma2:9b', 'claude-opus-4-6', 'gpt-4o'
  add column if not exists byo_credential_id text; -- FK to user_credentials.id when llm_provider starts with 'byo_'
```

**Relationship wiring** (`prediction.market_instrument_analyst_assignments` already exists — reuse with `assigned_by = user_id` for authored wiring; also use existing `viewer_instrument_analyst_assignments` for viewer-scoped debate participation. Add a partial unique constraint guarding that an *authored* analyst is wired only by its author):

```sql
-- Enforce: an authored analyst can only be wired to instruments by its owner
-- (implementation via check constraint that joins are validated in service layer)
```

**Billing tables** (new):

```sql
create schema if not exists billing;

create table if not exists billing.subscriptions (
  user_id text primary key,
  stripe_customer_id text unique not null,
  stripe_subscription_id text unique,
  status text not null check (status in ('trial', 'active', 'past_due', 'canceled', 'dormant')),
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists billing.authored_items (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  item_kind text not null check (item_kind in ('custom_analyst', 'custom_instrument', 'analyst_contract_override', 'instrument_contract_override', 'byo_platform_fee')),
  item_id text,                            -- points at market_analysts.id / instruments.id / analyst_config_versions.id / null for platform fee
  monthly_usd_cents integer not null,
  stripe_subscription_item_id text,
  status text not null check (status in ('active', 'canceled')),
  activated_at timestamptz not null default now(),
  canceled_at timestamptz
);
create index on billing.authored_items (user_id, status);
create index on billing.authored_items (item_kind, item_id);

create table if not exists billing.invoice_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  stripe_invoice_id text,
  period_start timestamptz not null,
  period_end timestamptz not null,
  line_items jsonb not null,               -- [{ kind, item_id, amount_cents, description }]
  total_cents integer not null,
  status text not null,                    -- 'draft' | 'open' | 'paid' | 'void'
  created_at timestamptz not null default now()
);
```

**User credentials** (new):

```sql
create schema if not exists credentials;

create table if not exists credentials.user_llm_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  provider text not null check (provider in ('anthropic', 'openai', 'openrouter')),
  label text not null,                     -- human-facing, e.g. "Personal Anthropic"
  encrypted_secret bytea not null,         -- AES-256-GCM ciphertext
  encryption_iv bytea not null,
  encryption_tag bytea not null,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index on credentials.user_llm_credentials (user_id) where revoked_at is null;
```

### 4.3 API Changes

All endpoints require authenticated `user_id`. All writes check `requireWrite(user_id)` (existing pattern).

**Authored analysts:**
- `POST /api/market-analysts` — create authored analyst. Body: `{ slug, displayName, personaPrompt, llmProvider?, llmModel?, byoCredentialId? }`. Returns created analyst. Billing hook adds `$ANALYST_AUTHORSHIP_USD` line item.
- `GET /api/market-analysts/mine` — list analysts where `user_id = current_user`.
- `DELETE /api/market-analysts/:id` — soft-delete (set `is_active = false`), cancels billing line item. Only owner. Fails if `user_id IS NULL` (base).
- `PUT /api/market-analysts/:id` — metadata updates (display name, model, credential). Only owner.

**Authored instruments:**
- `POST /api/instruments` — create authored instrument. Body: `{ symbol, name, assetType, universeSlug, sourceIds? }`. Returns created instrument. Billing hook adds `$INSTRUMENT_AUTHORSHIP_USD` line item.
- `GET /api/instruments/mine` — list authored instruments.
- `DELETE /api/instruments/:id` — owner-only soft-delete; base instruments (`user_id IS NULL`) reject.

**Contract authoring / overrides:**
- `POST /api/market-analysts/:id/contract-versions` — create a new contract version. When `analyst.user_id IS NULL` (base analyst), the version is stamped with `author_user_id = current_user` (override); when `analyst.user_id = current_user`, the version is owned by the analyst's author. Body: `{ contextMarkdown, changeReason }`. Validation: stage-keyed section check (existing `parseContractMarkdown`).
- `POST /api/instruments/:id/contract-versions` — parallel shape for instrument contract overrides.
- `GET /api/market-analysts/:id/contract-versions?authorUserId=me` — list user's overrides.
- Existing PUT/rollback endpoints from `stage-keyed-analyst-contracts` and `instrument-contracts` efforts continue to work for base and authored entities alike.

**Analyst-instrument wiring:**
- `GET /api/wiring/mine` — returns `{ analysts: [...], instruments: [...], wirings: [{ analystId, instrumentId }] }` for the current user's authored + enabled-base content.
- `POST /api/wiring` — `{ analystId, instrumentId }`. Writes to `viewer_instrument_analyst_assignments`. Validates: if `analyst.user_id IS NOT NULL` then `analyst.user_id = current_user`; base analysts can be wired freely.
- `DELETE /api/wiring` — removes a wiring.

**Billing:**
- `GET /api/billing/preview` — live calculation: `{ basicMonthlyUsd, authoredItems: [...], byoPlatformFeeUsd, totalMonthlyUsd }`.
- `GET /api/billing/subscription` — current subscription state.
- `POST /api/billing/checkout-session` — creates Stripe Checkout session for trial→paid conversion.
- `POST /api/billing/portal-session` — Stripe Customer Portal for card management.
- `POST /api/billing/webhooks/stripe` — Stripe webhook receiver; signature verification via `STRIPE_WEBHOOK_SECRET`.

**Credentials:**
- `POST /api/credentials/llm` — `{ provider, label, secret }`. Encrypts, stores, returns `{ id, provider, label, lastUsedAt }`. Activates BYO platform fee on first credential.
- `GET /api/credentials/llm` — list (never returns ciphertext).
- `DELETE /api/credentials/llm/:id` — revoke. If last credential and any authored analyst still references it, returns 409 with details.
- Rotation is via `DELETE` + `POST` (no in-place update).

### 4.4 Frontend Changes

All under `apps/web/src/` following existing Vue 3 + Vite conventions.

- **New settings section: `views/AuthoredContentView.vue`** (routed at `/settings/authored-content`). Tabbed UI: Analysts | Instruments | Wiring | Billing | API Keys.
  - **Analysts tab**: list of user's authored analysts; "Create Analyst" button opens a wizard (name → scaffold via `POST /api/market-analysts/:id/contract-versions/scaffold` → land in existing `ContractEditorView.vue` for edit). **Scaffold shape (resolves intention Open Question 2)**: v1 ships the *generic template* approach — the scaffold endpoint calls `MarketsLlmService.generateText` with a single template prompt that seeds all 6 required stage sections (`## General`, `## Stage: Predictor Generation`, `## Stage: Risk Assessment`, `## Stage: Prediction Generation`, `## Stage: Learning`, `## Adaptations`) plus placeholder guidance pulled from the analyst's chosen display name. The user then edits. A guided-interview flow (multi-turn Q&A to infer preferences) is deferred — tracked as a follow-up note in the effort log, not implemented in v1.
  - **Instruments tab**: same shape; "Create Instrument" → scaffold → `InstrumentContractEditorView.vue` for edit.
  - **Wiring tab**: `views/WiringMatrixView.vue` — a matrix with the user's authored + enabled-base analysts as rows and their authored + enabled-base instruments as columns; checkboxes toggle `POST`/`DELETE /api/wiring`. Decision per §7 of intention: matrix chosen over wiring-diagram for v1 (simpler to ship, familiar UX).
  - **Billing tab**: live preview component showing base + per-item charges + BYO fee = total. Card management via Stripe Customer Portal link.
  - **API Keys tab**: `views/authored/LlmCredentialsTab.vue` — list, add, revoke. Add form warns that secret is stored encrypted and Divinr never bills through the user's provider.

- **Contract override affordance** on existing `ContractEditorView.vue` and `InstrumentContractEditorView.vue`: when viewing a base entity, a "Create my override" button creates a new version with `author_user_id = current_user`. When viewing an override, a banner identifies it as "Your override of [base name]".

- **Risk debate page** (`views/InstrumentDebateView.vue`, existing): participant list reflects the authenticated viewer's scope — base participants always, plus the viewer's wired authored analysts on that instrument. A small badge ("Your custom analyst") distinguishes authored participants.
- **Same-name instrument collision (resolves intention Open Question 3)**: when a user authors an instrument with the same symbol as a base instrument (e.g., both "AAPL" exist — one with `user_id IS NULL`, one with `user_id = current_user`), the UI shows them as **separate rows** in the instrument list and **separate detail pages** (`/instruments/:id` routes by instrument id, not symbol). Each has its own debate driven by its own triple set. This is consistent with the triple model: two different instrument_ids → two different sets of triples → two independent risk views. No unified "combined AAPL view" in v1.

- **Billing preview widget**: reusable component `components/BillingPreview.vue` embedded in authoring wizards — shows "+$60/mo (authored analyst)" live before confirming creation.

### 4.5 Infrastructure Requirements

- **Stripe** account + webhook endpoint configured. Test mode for dev; live mode for prod. Webhook secret in `STRIPE_WEBHOOK_SECRET`.
- **Pricing env vars**: `BASIC_MONTHLY_USD=50`, `INSTRUMENT_AUTHORSHIP_USD=20`, `ANALYST_AUTHORSHIP_USD=60`, `BYO_PLATFORM_FEE_USD=10` (placeholder $10 — adjustable via env without migration; final pricing deferred), `CONTRACT_OVERRIDE_USD=0` (default free; pricing decision deferred — see §7). Also `TRIAL_DAYS=30`, `DORMANCY_MONTHS_BEFORE_PURGE=6`.
- **`CREDENTIAL_ENCRYPTION_KEY`**: 32-byte key, loaded from env; document rotation procedure (decrypt-with-old + re-encrypt-with-new batch job — not shipped v1, but key must be externally managed).
- **Supabase migrations**: new `billing` and `credentials` schemas; RLS policies disabled (server-side access only).
- **Ports**: no change; API on 7100, web on 7101.
- **No new external LLM provider dependencies** — BYO credentials route through existing provider clients in `markets-llm.service.ts`.

## 5. Non-Functional Requirements

### Performance
- Authored-triple expansion must not regress base-only throughput. Measure: Stage 1 wall-clock on a 100-article batch with 0 authored instruments vs. 10 authored instruments (across 3 test users) — ≤ 12% overhead at 10 authored. Ollama serial constraint (per project memory) means authored fanout is sequential; budget accordingly.
- Billing preview endpoint p95 < 200ms (pure DB aggregation, no Stripe call).
- Contract-scaffold LLM pass may take 30–60s on local Gemma; UI shows a progress indicator, does not block other authoring.

### Security
- BYO credentials encrypted at rest (AES-256-GCM). Ciphertext never leaves server to client. Decryption only in LLM invocation path, in-memory.
- `CREDENTIAL_ENCRYPTION_KEY` injected via env, not committed. Document rotation.
- Stripe webhook signature verification mandatory.
- Authored content ownership enforced at every write endpoint: `analyst.user_id !== null && analyst.user_id !== req.user.id` → 403.
- Base content (`user_id IS NULL`) is globally read-only: every update/delete endpoint rejects with 403 when target has `user_id IS NULL`.

### Scalability
- Content-keyed cost model (per project memory) holds: adding a user without authorship does not increase compute. Adding an authored instrument adds `articles/day × 1` Stage 1 evaluations; adding an authored analyst adds `relevant_articles/day × wired_instruments` Stage 2–4 evaluations. These scale with authorship count, not user count.
- Billing ledger writes are idempotent (Stripe event ID as uniqueness key).

### Compatibility
- Existing base-only users: zero schema-level change to their reads (new columns are nullable / defaulted). All existing endpoints continue to return base content unchanged.
- Migration is additive: no data movement, no dropped non-legacy indexes beyond the two user-scoping replacements.
- NestJS DI convention (per `CLAUDE.md`): every constructor parameter in new services uses explicit `@Inject(ClassName)`.

## 6. Out of Scope

- **Club-authored content.** All authorship is individual; clubs are social-only (master-intention §2.3).
- **Sharing UI.** Plumbing columns (`shared_with_clubs`, `authored_content_shares`) added now; UI deferred until real demand (master-intention §5.4).
- **Custom source ingestion (BYO RSS/API).** Users select from the existing source catalog only. Separate future effort.
- **Custom-to-base graduation mechanic.** Separate effort: `custom-to-base-graduation`.
- **Compute cost tracking / attribution for authored content.** Separate effort: `cost-modeling-system`. This effort only tracks *fixed* per-item fees, not variable compute.
- **Performance & P&L attribution dashboards.** Separate effort: `performance-attribution`.
- **Student (.edu) cost-pass-through pricing.** Separate future effort; out of v1.
- **Dormancy → purge lifecycle.** Stripe subscription `canceled` status handled, but automated 6-month read-only → purge job deferred.
- **Pricing for contract overrides.** Shipping at `CONTRACT_OVERRIDE_USD=0` (free). The pricing decision (intention §Per-Item Pricing) is flagged as TBD and deferred; schema supports charging later without migration.
- **Model-choice UI per analyst beyond provider toggle.** v1 ships with provider + single model field; a richer "model per stage" UI is deferred.

## 7. Dependencies & Risks

### Dependencies
- **`stage-keyed-analyst-contracts`** (complete, 2026-04-16): stage-section parser and contract-fragment loader. Authoring UI reuses `parseContractMarkdown`; runtime reuses `buildStagePromptFragment`.
- **`instrument-contracts`** (complete, 2026-04-16): parallel `instrument_config_versions` shape and `InstrumentContractEditorView.vue`.
- **`user-scoped-platform`** (complete, 2026-04-10): `user_id` columns on `market_analysts` and `instruments`; auth middleware populates `req.user.id`.
- **`triple-model-reasoning-continuity`**: referenced in intention but is a **future** effort (lives under `docs/efforts/` without a completion-report as of 2026-04-16). The schema pieces this effort actually needs (triple-keyed predictors, risk assessments, predictions) are already in place from prior efforts (`user-scoped-platform` + `stage-keyed-analyst-contracts` + `instrument-contracts`). **No hard blocker** — Phase 1 verifies this during migration review; if a gap is found, it's promoted into this effort's scope.
- **`slot-based-enablement-ui`**: authored triples auto-populate the user's slot pool. If this effort is parallel / downstream, Phase 5 ships a minimal "authored triples are always enabled" shortcut and the full slot-pool integration happens when that effort lands.
- **External**: Stripe account with webhook endpoint; `.env` populated with `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_BASIC`, `STRIPE_PRICE_ID_ANALYST_AUTHORSHIP`, `STRIPE_PRICE_ID_INSTRUMENT_AUTHORSHIP`, `STRIPE_PRICE_ID_BYO_FEE`.

### Risks & Mitigations

1. **Risk**: Existing data has duplicate `slug`s across users that will violate the new `(slug, coalesce(user_id, 'base'))` unique index.
   **Mitigation**: Phase 1 migration runs a dry-run `SELECT slug, coalesce(user_id, 'base'), count(*) FROM prediction.market_analysts GROUP BY 1,2 HAVING count(*) > 1` first and aborts with diagnostics if any duplicates exist; manual reconciliation step before index creation.

2. **Risk**: Stripe webhook delivery is eventually-consistent; a user may pay but the DB lags. The authored-item creation flow must be transactional.
   **Mitigation**: Creation flow is "reserve local row in `billing.authored_items` with status `pending_payment` → create Stripe subscription item → webhook flips to `active`". If Stripe fails, row is garbage-collected after 24h. If webhook never arrives, a reconciliation job reads Stripe directly.

3. **Risk**: BYO credential exposure — a misconfiguration could log decrypted secrets.
   **Mitigation**: Decrypted secret exists only inside `MarketsLlmService.executeWithCredential()`. Add ESLint rule forbidding `console.log`/`logger.*` of variables named `*secret*` / `*apiKey*`. Code review gate.

4. **Risk**: Risk debate participant filtering performance. Every debate invocation may now need to JOIN against the viewer's authored analysts.
   **Mitigation**: Index `viewer_instrument_analyst_assignments (viewer_user_id, instrument_id)` already exists (schema line 275–276). Query is O(1) per instrument lookup.

5. **Risk**: Ollama serial-inference constraint (per project memory). Authored content inflates Stage 2–4 work; serial queue grows unboundedly if authored count scales fast.
   **Mitigation**: Authored-triple stages run in the same per-instrument queue as base triples. Authored-content onboarding flow shows "typical processing delay for your current workload" so users have expectations.

6. **Risk**: `markets-integration-test-infra` tests that assert `ON CONFLICT (slug)` behavior break when index changes.
   **Mitigation**: Phase 1 includes test updates. Validate by running `npm test` in `apps/api` at end of Phase 1.

7. **Risk**: Base-content immutability enforced only at service layer; a rogue direct DB write could still modify base rows.
   **Mitigation**: Add a BEFORE UPDATE trigger on `market_analysts` / `instruments` that rejects changes when `user_id IS NULL` unless executed by a service role. Defer to Phase 9 (hardening) if not ready at Phase 1.

## 8. Phasing

Each phase is a validation checkpoint. Commit-push and PR-evaluate between phases. Phases run sequentially — no parallelization, since each builds on the prior.

### Phase 1 — Schema Integrity + `createAnalyst` Fix (unblocks CI)
- Migration: drop global unique indexes; create user-scoped `(slug, coalesce(user_id, 'base'))` and `(symbol, coalesce(user_id, 'base'))`; add `author_user_id` columns on `analyst_config_versions` and `instrument_config_versions`; add `shared_with_clubs` plumbing; add `authored_content_shares` table; pre-migration dry-run duplicate detector.
- Update `MarketsService.createAnalyst` (markets.service.ts:444–465) from `ON CONFLICT (slug)` → `ON CONFLICT (user_id, slug)`; same for `createInstrument`.
- Update affected tests in `markets-integration-test-infra`.
- **Validation**: `markets-integration-test-infra` green; manual repro (two test users, same slug) creates two rows.

### Phase 2 — Authored Analyst + Instrument Creation API
- `POST/GET/PUT/DELETE /api/market-analysts` extensions for authored content (scoped listing, ownership guards).
- `POST/GET/DELETE /api/instruments` parallel shape.
- Base-content immutability guards: reject writes when target `user_id IS NULL`.
- Scaffold endpoint: `POST /api/market-analysts/:id/contract-versions/scaffold` seeds a template stage-keyed contract via `MarketsLlmService.generateText`.
- **Validation**: curl-level end-to-end creation of a custom analyst and custom instrument; base-content-write returns 403.

### Phase 3 — Authored Content UI (Create + Edit Contracts)
- `views/AuthoredContentView.vue` with Analysts and Instruments tabs.
- "Create Analyst" / "Create Instrument" wizards (name → scaffold → contract edit).
- Reuse `ContractEditorView.vue` and `InstrumentContractEditorView.vue` for editing.
- "Create my override" affordance on base-entity contract views.
- **Validation**: end-to-end in browser: create analyst from scratch, edit its stage sections, save; create instrument, edit contract, save; create override of base analyst contract.

### Phase 4 — Wiring Matrix UI + API
- `GET/POST/DELETE /api/wiring` endpoints.
- `views/WiringMatrixView.vue` — checkbox matrix of user's analysts × user's instruments (including enabled-base items).
- Validation that authored analysts can only be wired by their owner.
- **Validation**: user wires 3 analysts × 4 instruments, reload page, wirings persist; another user's wirings invisible.

### Phase 5 — Runtime Integration: Viewer-Scoped Debate + Authored-Triple Pipeline
- `RiskDebateService.resolveParticipants(viewerUserId, instrumentId)` joins base participants + `viewer_instrument_analyst_assignments` rows for that viewer.
- Stage 1–4 orchestration iterates over the union of base triples + active-author authored triples. "Active-author" = `billing.subscriptions.status in ('trial','active')` for that user_id.
- Soft-deleted or subscription-canceled authored content skipped.
- **Validation**: seed a user with 1 authored analyst wired to base AAPL; trigger Stage 1–4 cycle; assert: non-authoring viewer sees 1 debate (base participants); authoring viewer sees 1 additional debate run with their authored analyst; predictions table has rows keyed by the authored triple.

### Phase 6 — Billing Plumbing (Stripe subscription + per-item ledger)
- `billing` schema migration.
- `BillingService` module with Stripe integration.
- `POST /api/billing/checkout-session` and `/portal-session`.
- Webhook handler with signature verification and idempotent event processing.
- Billing hooks wired into Phase 2 create/delete endpoints: creating an authored analyst adds a subscription item, deleting cancels it.
- `GET /api/billing/preview` + `BillingPreview.vue` component embedded in wizards.
- Trial lifecycle: new user → 30-day trial → auto-convert with card on file → `canceled` → dormant.
- **Validation**: test-mode Stripe checkout flow; create authored analyst → verify Stripe subscription item exists with correct quantity; delete → verify cancellation; webhook replays are idempotent.

### Phase 7 — BYO LLM Credentials
- `credentials` schema migration.
- `CredentialsService` with AES-256-GCM encryption helpers.
- `POST/GET/DELETE /api/credentials/llm` endpoints.
- `views/authored/LlmCredentialsTab.vue` under Authored Content settings.
- `MarketsLlmService` extended to route through BYO credential when `analyst.llm_provider` starts with `byo_`. Decryption in-memory-only.
- BYO platform fee billing item added on first credential, removed on last credential revocation.
- Model-choice selector on authored analyst metadata.
- **Validation**: add Anthropic test key; toggle authored analyst to `byo_anthropic` + `claude-opus-4-6`; trigger Stage 4 run; confirm inference routes through the test key (via provider-side audit log) and Divinr's LLM usage ledger records $0 for that run; confirm `BYO_PLATFORM_FEE_USD` line item on next invoice.

### Phase 8 — Integration Testing + Polish
- End-to-end test: base user (unchanged), authoring user (1 analyst + 1 instrument + 1 override + BYO key), collision user (same slug as base).
- Billing preview accuracy across all combinations.
- UI polish: loading states, empty states, error messaging, Stripe redirect flows.
- Docs update: `CLAUDE.md` section on authoring conventions (if any emerge); user-facing help text.
- **Validation**: full manual UX walkthrough; `pr-eval` passes; no regressions in base-user flows.

### Phase 9 — Hardening (optional, if time permits within effort)
- DB trigger enforcing base-content immutability at storage layer.
- Credential-key rotation runbook.
- Reconciliation job for orphaned `pending_payment` billing rows.
- **Validation**: direct SQL update on `market_analysts` where `user_id IS NULL` is rejected by trigger.
