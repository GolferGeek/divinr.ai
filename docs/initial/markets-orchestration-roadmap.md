# Markets orchestration roadmap

## 1) Purpose

This document is the implementation roadmap for **markets** prediction and risk workflows in Divinr: multi-analyst outcomes per run, an **arbitrator** step after per-analyst outputs, and **LLM-assisted article-to-instrument predictor scoring**—while keeping tenant **source entitlements**, **Orchestrator crawler reuse** (`crawler.sources` / `crawler.articles` → Divinr articles), and **OSS-first LLM** defaults (Ollama/local; commercial only when explicitly allowed).

It complements:

- `high-level-PRD.md` — product framing
- `phase-1-prd.md` — phase-scoped requirements (naming here avoids milestone labels in runtime code; domain naming stays **markets**)

Related implementation areas today: `apps/api/src/markets/` (service, controller, types), compliance/RBAC, external sync env flags documented in the repo root `README.md`.

---

## 2) Outcomes (definition of done)

| # | Outcome | Notes |
|---|---------|--------|
| 1 | **Multi-analyst predictions** | A single prediction **run** can produce **one persisted outcome per assigned analyst** (persona), not only a single primary analyst. |
| 2 | **Arbitrator** | After all analyst outputs for that run, a **final** combined outcome (direction, confidence, rationale; optional dissent/summary) is produced and stored with clear lineage. |
| 3 | **LLM-assisted predictors** | Articles can be **scored for relevance** to an instrument via the same LLM routing as markets execution; results upsert into **predictors**; **manual** predictor upsert remains supported as override. |
| 4 | **Risk-before-prediction** | Prediction prompts continue to **inject latest risk context** and **active predictors** where applicable (already partially implemented; must remain coherent with multi-step runs). |

---

## 3) Phase A — Schema and invariants

**Goal:** Stable tables and constraints so orchestration and APIs do not need another breaking migration immediately after ship.

**Decisions to lock:**

- **Per-analyst rows:** Prefer **multiple rows per `run_id`** keyed by `(run_id, analyst_id)` on prediction outcomes, or a dedicated `market_prediction_analyst_outcomes` table—**pick one** and document the choice here when implemented.
- **Arbitrator row:** Either a distinct row (e.g. `analyst_id` null + role discriminator) or a small `market_prediction_arbitrations` (or equivalent) table—**one pattern** for list APIs and UI.
- **Assignments:** Use `market_instrument_analyst_assignments`; define which analysts run (e.g. all active assignments, ordered deterministically).
- **Legacy data:** Migration/backfill for existing single-row predictions and nullable `analyst_id`.

**Exit criteria:** Migrations apply cleanly; uniqueness constraints prevent duplicate analyst rows per run; arbitrator row is unambiguous.

---

## 4) Phase B — Orchestration (multi-step pipeline in one run)

**Goal:** For `run_type === 'prediction'`, execution becomes a **pipeline** inside the same queued run:

1. Load **latest risk** for instrument + **active predictors** (shared context).
2. For **each** assigned analyst (fixed order):
   - Build prompt: persona + shared context + instrument.
   - Invoke LLM (or deterministic stub when LLM disabled).
   - Persist **per-analyst** outcome and optional **per-analyst artifact** (clear `analyst_id` / step metadata).
3. **Arbitrator step:** Input = structured representation of analyst outputs + shared context; output = **one** final outcome; persist with lineage.
4. Emit observability events suitable for step boundaries (e.g. under `markets.orchestration.*`).

**Exit criteria:** One completed prediction run yields **N analyst outcomes + 1 arbitrator outcome**; failures are per-run and observable.

---

## 5) Phase C — LLM-assisted predictor scoring

**Goal:** Automate **article → relevance** for an instrument without removing manual control.

**Behavior:**

- Inputs: `instrument_id`, candidate articles (from entitled sources / recent sync), caps for batch size and tokens.
- Scoring prompt: instrument identity, optional sector/metadata, article title/summary (and bounded body if allowed).
- Output: relevance **0–1**, short rationale, optional dismiss/dimissal flag mapped to predictor `status`.
- **Entitlements:** Only use articles the tenant is entitled to (`tenant_source_entitlements` + catalog rules).
- **Persistence:** Upsert `market_predictors`; optional audit column for `source` (e.g. `llm` vs `manual`) if not already implied.

**API shape (illustrative):** e.g. `POST /markets/instruments/:instrumentId/predictors/score` or `POST /markets/predictors/materialize` with body `{ articleIds?: string[], limit?: number }`—exact paths to match controller conventions.

**Exit criteria:** Scoring respects entitlements; manual `POST /markets/predictors` still works; tests cover deny paths.

---

## 6) Phase D — API and clients

**Goal:** Consumers can fetch **grouped** results without ambiguity.

- List/detail endpoints return **analyst breakdown + arbitrator** (flat list with `role` or grouped JSON—choose one contract and version if breaking).
- Deprecate or document legacy “single outcome per run” assumptions.
- Web app (when in scope): run detail UI with per-analyst cards and a final arbitrator section.

**Exit criteria:** Contract documented; integration tests updated.

---

## 7) Phase E — Testing and CI

**Goal:** Regression safety for multi-tenant and multi-step behavior.

- **Smoke:** Prediction run with **≥2 analysts** + arbitrator assertions (row counts, key prompt fragments or structured fields).
- **HTTP:** Authenticated routes for new endpoints.
- **Harness:** Compliance seed with multiple analysts on one instrument; cross-tenant denial tests.

**Exit criteria:** Existing `ci:markets` (or successor) stays green; new cases added for this roadmap.

---

## 8) Dependency order

```text
Phase A (schema) ──► Phase B (orchestration)
        │
        └──────────► Phase C (predictor scoring)

Phase B + Phase C ──► Phase D (API/clients)
        │
        └──────────► Phase E (tests/CI) [continuous, hard gate before release]
```

Phase C can proceed in parallel with Phase B once Phase A’s predictor-related invariants are clear.

---

## 9) Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Cost / latency (N analysts + arbitrator + scoring) | Caps per run; truncate article text; reuse Ollama settings that avoid empty completions (e.g. `think: false` where applicable). |
| Duplicate rows on retry | Idempotent upserts; unique `(run_id, analyst_id)` (or equivalent). |
| Entitlement leaks | Centralize article access checks in one helper used by list, sync, and scoring. |
| Contract churn | Version API or document breaking changes in this file’s revision note. |

---

## 10) Environment and policy (reminder)

- Prefer **`MARKETS_ENABLE_LLM`** for LLM-backed paths; document any legacy alias in `README.md` only.
- **`MARKETS_ALLOW_COMMERCIAL_FALLBACK`** and OSS model env vars remain the commercial/OSS boundary.

---

## 11) Revision history

| Date | Change |
|------|--------|
| 2026-03-31 | Initial roadmap authored (multi-analyst, arbitrator, LLM predictors, phases A–E). |
