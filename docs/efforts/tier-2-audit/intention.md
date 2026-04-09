# Tier 2 Audit + Approval Loop — Intention

## What This Effort Is

Build the "mostly AI, some human in the loop" audit system that spot-checks predictions against analyst contracts, surfaces discrepancies with a hypothesis for why the model drifted, and presents them to the user for judgment. The user's accept/reject decisions feed an append-only log that future efforts will use to train the selection policy.

Concretely: a background loop picks a resolved prediction, loads the analyst's structured contract (from `analyst_config_versions.context_markdown`, shipped in `analyst-contracts`), reads the prediction's input data and output reasoning, asks a local LLM "does this output honor this contract on this input?", and if it finds a discrepancy, writes a structured finding to a queue. An admin inbox view shows the queue. The user reads each finding (contract excerpt, input excerpt, output excerpt, discrepancy statement, hypothesis for why the model drifted) and presses one of three buttons: **you're right** / **you're wrong** / **interesting but no action**. Each response is appended to a feedback log.

This is the missing **Tier 2** in the designed-but-half-built tier system on `analyst_config_versions.source`. Tier 1 (autonomous micro-adjustments) is built and running. Tier 2 (human-in-the-loop audit + approval) is this effort. Tier 3 (strategic overhauls) is future.

## Why It Matters For Divinr

The calibration drilldown shows *what* went wrong. The contracts define *what the analyst was supposed to do*. But today no part of the system connects those two: nobody reads the contracts against the actual outputs and says "here is the specific place where the output violated the contract, and here is why I think it happened." That connection is the core diagnostic loop — and it's the thing that makes the contracts useful rather than decorative.

Without this loop:
- Contracts sit in the database unread. No consumer exists.
- The user has to manually read calibration rows, pull up the contract, and do the comparison in their head. That's what the calibration drilldown enables, but it's entirely human-driven and doesn't scale past "look at 5 rows on a good day."
- The Tier 1 learning engine keeps appending suffixes based on aggregate numeric patterns, blind to whether those patterns are caused by contract violations or by legitimate market noise. There's no richer signal feeding back.

With this loop:
- The system does the reading-and-comparing automatically, at whatever rate the local model can handle (background, no latency budget, every idle minute).
- The user only sees the interesting cases — the ones where the AI thinks something is off. Instead of scanning 37 rows hoping to notice a pattern, the user reads 3–5 curated findings and makes a judgment call on each.
- Every judgment call is a training signal. Even without the automated meta-loop (Tier 2 v2, a future effort), the append-only log is readable by a human who wants to tune the audit prompt or adjust the selection policy by hand.
- Approved discrepancies become the input for Tier 2 proposals — prompt adjustments that route through the existing `learning_proposals` table and the existing paper-mode infrastructure from Tier 1. The *application* of approved proposals to paper mode is in scope for this effort. The *automated meta-loop* that learns from the accept/reject pattern is not.

## Why Now

- `analyst-contracts` just shipped. Every base analyst has a structured contract with `## General`, `## Role: <name>`, and `## Adaptations` sections. The canonical reader methods (`getActiveContextForAnalyst`, `getContextForConfigVersion`) exist. The carry-forward is wired. The contracts are ready to be consumed.
- The `learning_proposals` table already exists with a `tier` column. Tier 1 writes `tier=1` rows. This effort writes `tier=2` rows. No new table needed for proposals.
- The `learning_reports` table already exists. The audit cycle can write its summary there.
- The existing paper-mode infrastructure (`paper_config_version_id`, `checkPaperModePromotions`) can be reused for Tier 2 proposals if we follow the same activation pattern.
- `prediction_horizon_evaluations.config_version_id` is now populated (since analyst-contracts bootstrapped config versions). New predictions record which contract was active. The audit can tie a prediction to its exact contract version.
- The user explicitly described this as the thing they want: "the AI says 'see, I see this thing, what do you think?'"

## What Good Looks Like

### The Audit Loop (Backend)
- A service method (or a schedulable NestJS command) runs the audit cycle. Each cycle:
  1. **Selects a target**: one resolved prediction, weighted toward wrong predictions, that hasn't been audited recently. Selection is random/round-robin with the weighting, not exhaustive.
  2. **Loads context**: the prediction's rationale + confidence + predicted direction, the actual outcome from `prediction_horizon_evaluations`, and the analyst's structured contract (via `getContextForConfigVersion` using the prediction's `config_version_id`).
  3. **Calls the local LLM** (`gemma4:26b` for quality) with a constrained prompt: "Here is the analyst's contract (the role section specifically). Here is the input data the analyst saw. Here is what the analyst produced. Is there a discrepancy between the contract and the output? If yes: state the discrepancy in one sentence, quote the specific part of the contract that was violated, quote the specific part of the output that violates it, and propose a one-sentence hypothesis for why the model drifted. If no discrepancy: respond with 'consistent' and stop."
  4. **If a discrepancy is found**: writes a finding row to a new `audit_findings` table (or reuses `learning_proposals` with `tier=2` — PRD discovery determines which). The finding includes: the prediction_id, the config_version_id, the analyst_id, the contract excerpt, the input excerpt, the output excerpt, the discrepancy statement, the hypothesis, a severity tag (the LLM picks from low/medium/high), and a status of `pending_review`.
  5. **If no discrepancy**: logs the check silently (maybe a counter in `learning_reports`) and moves on.
- The audit cycle can run N times per invocation (configurable, default maybe 5 predictions per cycle). It is not a long-running daemon — it runs, does N checks, writes results, exits. A cron or the existing scheduler invokes it periodically.

### The Admin Inbox (Frontend)
- A new admin view at `/admin/findings` (or similar — PRD picks the route).
- Shows a list of pending findings, most recent first.
- Each finding card renders:
  - Analyst name + slug
  - Prediction summary: symbol, predicted direction → actual direction, was_correct, Δ%, date
  - **Contract excerpt**: the specific section of the contract the LLM flagged
  - **Output excerpt**: the specific part of the prediction's rationale the LLM flagged
  - **Discrepancy**: one-sentence statement
  - **Hypothesis**: one-sentence explanation for why the model drifted
  - Severity tag (low/medium/high)
- Three action buttons per finding:
  - **Agree** (you're right) — marks as `accepted`, appends to feedback log
  - **Disagree** (you're wrong) — marks as `rejected`, appends to feedback log, optional textarea for why
  - **Note** (interesting but no action) — marks as `noted`, appends to feedback log
- After acting, the finding disappears from the pending list (or moves to a "reviewed" section).
- Simple empty state: "No pending findings. The audit loop will surface discrepancies as it runs."

### The Feedback Log
- Every accept/reject/note action writes an append-only row to an `audit_feedback` table (or a column on the findings table — PRD picks). Columns: finding_id, action (accepted/rejected/noted), response_text (nullable, for "why" on reject), responded_at, responded_by.
- This log is the input for the future Automated Meta-Loop effort. It is *not* consumed by any automated process in this effort. It sits there and accumulates.

### Proposal Application (stretch goal, only if the above is clean)
- When a finding is accepted, the system optionally generates a Tier 2 proposal: a suggested prompt adjustment that addresses the discrepancy. The proposal follows the same flow as Tier 1: written to `learning_proposals` with `tier=2`, `source='tier2_approved'`, includes a `proposed_change` JSONB.
- **This is stretch scope.** If the audit loop + inbox + feedback log ship clean without it, defer proposal generation to a follow-on. The core value of this effort is the *noticing* and the *human judgment*, not the *acting*. Acting is downstream.

## What "Done" Looks Like

- The audit loop runs, finds at least one discrepancy in the dev dataset, and writes it to the findings queue.
- The admin inbox renders the finding with all the fields described above.
- The user can accept/reject/note the finding and the action persists.
- The feedback log has at least one row.
- All existing gates pass.

Proposal application (stretch) is done if: an accepted finding triggers a Tier 2 proposal row in `learning_proposals`. It is acceptable for this to not ship in v1.

## Out Of Scope

- **Multiple audit types.** v1 has exactly one: contract-vs-output discrepancy on a resolved prediction. Future audit types (cross-instrument bias, risk-debate analysis, etc.) are follow-on efforts.
- **Automated meta-loop.** The system does NOT read the accept/reject log and auto-adjust the selection policy or audit prompt. That's the "Tier 2 v2" effort on the roadmap. In v1, the log accumulates and a human can read it manually.
- **Batch operations on findings.** No "dismiss all low-severity" button. No filtering. The dumb inbox is deliberate — let real volume inform the v2 UX.
- **Editing contracts from the inbox.** The contract editor is a separate future effort. Findings link to contracts but don't offer inline editing.
- **Diff viewer for contract versions.** Future effort (Contract Editor UI on the roadmap).
- **Day trader auditing.** Day traders don't have contracts yet (separate effort).
- **Notifications / email alerts.** No push when new findings arrive. The user checks the inbox when they want to.
- **Tier 3 proposals.** Tier 3 slot exists in the schema. Nothing to do with this effort.
- **Changing Tier 1's behavior.** Tier 1 keeps running as-is. This effort adds a parallel system, not a replacement.

## Where It Fits In The Roadmap

**Immediately after** `analyst-contracts`. That effort produced the contracts. This effort is the first consumer of them.

**Before** Tier 1 Structured Writes (which needs audit data to validate that structured writes are better than suffix appends) and Automated Meta-Loop (which needs real accept/reject data).

**In parallel with** Day Trader Contracts (no dependency either way).

## Decisions (settled before PRD-build)

- **One audit type, one target per check.** No batching of multiple predictions into one LLM call. Each check is self-contained: one prediction, one contract, one LLM call, one finding-or-not.

- **Selection: random weighted toward wrong predictions.** The weighting is simple: wrong predictions are 3× more likely to be selected than correct ones. No per-instrument or per-analyst balancing in v1. The selection also skips predictions that have been audited in the last 7 days (prevents re-auditing the same small pool repeatedly).

- **Local model: `gemma4:26b`.** The user specified this for complex tasks. The audit prompt requires reliable instruction-following and structured output. `gemma4:e4b` would be cheaper but can't reliably follow constraints (as proven during contract generation).

- **Finding storage: PRD decides** between a new `audit_findings` table or reusing `learning_proposals` with `tier=2`. The decision depends on whether the fields overlap enough. `learning_proposals` has `proposal_type`, `description`, `rationale`, `proposed_change`, `canonical_test_results`, `net_score`, `has_severity_regression`, `status`. Some of those map naturally (description → discrepancy, rationale → hypothesis). Others don't (there's no canonical test for a finding, no proposed_change until the stretch goal). PRD discovery reads the `learning_proposals` schema and decides.

- **Inbox route: PRD picks.** Probably `/admin/findings` or a tab on an existing admin view. PRD checks what admin routes exist.

- **The audit loop is a service method, not a daemon.** Invoked by a scheduler or a manual trigger. Runs N checks (configurable), writes results, exits. No long-running process.

- **Feedback log is append-only by convention, not by DB constraint.** The `analyst-contracts` effort decided against append-only enforcement on `analyst_config_versions` because the existing learning engine does UPDATEs. The same reasoning applies here: the feedback log is morally append-only (the application only INSERTs) but the DB allows UPDATE/DELETE for operational flexibility (fixing a misclick, cleaning up test data).

## Open Questions To Settle When This Effort Starts

- **`audit_findings` vs `learning_proposals`:** PRD discovery reads the `learning_proposals` schema and decides whether findings should be a new table or tier-2 rows in the existing one.
- **Audit prompt exact shape:** the prompt needs to be crafted carefully to avoid the slop problem (generic "something looks off" findings). PRD pins the exact prompt template.
- **What "input data the analyst saw" means concretely:** the analyst's prediction was based on articles, price bars, and other analysts' signals. How much of that context goes into the audit prompt? PRD discovers what's available and picks a reasonable subset.
- **Admin route structure:** is there an existing `/admin` route? Does the web app have an admin layout? PRD checks.
- **Scheduler integration:** how does the audit cycle get triggered? Is there an existing cron/scheduler in the API? PRD discovers.

## Dependencies

- `analyst-contracts` is merged. ✅ (commit `1d9748e`)
- `analyst_config_versions.context_markdown` is populated for 7 base analysts ✅
- `getActiveContextForAnalyst` and `getContextForConfigVersion` exist ✅
- `learning_proposals` table exists (used by Tier 1) ✅
- `learning_reports` table exists ✅
- `gemma4:26b` is available via Ollama at localhost:11434 ✅
- 37 resolved predictions exist with `config_version_id` populated on recent ones ✅
- The existing paper-mode infrastructure works ✅
