# Automated Meta-Loop — Intention

## What This Effort Is

Add the third loop to the Tier 2 audit system: a background job that reads the accumulated accept/reject/note feedback from the audit inbox, identifies patterns in what the user cares about, produces a **selection policy**, and feeds that policy back into the audit cycle so it gets smarter over time.

Currently the audit picks predictions randomly (weighted toward wrong ones) and checks every discrepancy it finds with equal importance. The meta-loop makes it selective: surface more of the patterns the user consistently accepts, skip the patterns the user consistently rejects.

## The Three Loops

```
Loop 1 (shipped): Audit checks predictions against contracts → writes findings
Loop 2 (shipped): User reviews findings → writes accept/reject/note to feedback
Loop 3 (this effort): System reads feedback → updates selection policy → Loop 1 uses it
```

## Why It Matters

Without the meta-loop, the audit inbox is a firehose. Every discrepancy the LLM notices gets surfaced with equal weight. After a few days, the user sees the same kinds of low-value findings over and over — "the analyst didn't cite enough macro data" when the user doesn't care about that pattern — and stops checking the inbox. The meta-loop is what makes the inbox worth checking: it converges on the user's actual interests.

The meta-loop also closes the learning system's feedback circuit. Right now the user's judgment (accept/reject) is recorded but never consumed. It's a log that nobody reads. After this effort, the system reads it and acts on it.

## What Good Looks Like

- A background job runs periodically (daily, or after N reviews accumulate — whichever comes first).
- It reads all reviewed findings (accepted, rejected, noted) and groups them by patterns: discrepancy type keywords, analyst, severity, whether the prediction was correct or wrong.
- It calls a local LLM (`gemma4:26b`) with the feedback data and a prompt: "Given these user responses, what kinds of audit findings should be prioritized and what should be skipped?"
- The LLM produces a **selection policy** — a short natural-language document (maybe 200-500 words) with prioritize/skip guidance.
- The policy is stored in a new row in `prediction.learning_reports` (type `'audit_policy'`) or a small dedicated table.
- The audit service reads the current policy at the start of each cycle and **prepends it to the audit prompt** as additional context: "The user has indicated they care about X and don't care about Y. Prioritize accordingly."
- If there aren't enough reviewed findings yet (< 5), the meta-loop skips and logs "not enough feedback data yet."
- The policy is human-readable and visible somewhere (an endpoint or the admin view) so the user can see what the system learned about their preferences.

## What "Not Enough Data" Looks Like

With 0-4 reviewed findings, the meta-loop produces no policy. The audit runs with its default behavior (no selection bias). This is correct — you can't learn preferences from 2 data points.

With 5-15 reviewed findings, the meta-loop produces a **tentative** policy. The prompt acknowledges the small sample size and the policy is conservative (e.g., "slightly prioritize X" rather than "always surface X, never surface Y").

With 15+ reviewed findings, the meta-loop produces a **confident** policy with stronger prioritization and skip rules.

The thresholds (5 and 15) are configurable via env vars.

## Out Of Scope

- **Auto-approving or auto-rejecting findings.** The meta-loop changes what the audit *looks for*, not what happens to findings after they're created. The user still reviews every finding manually.
- **Changing analyst contracts or behavior.** The policy affects the audit prompt, not the analyst prompts.
- **A UI for editing the policy.** The policy is generated, not hand-written. The user can see it (read-only) but editing it directly would fight the learning loop.
- **Multiple audit types.** Still one type (contract-vs-output discrepancy). The meta-loop tunes the selection *within* that type, not across types.
- **Real-time policy updates.** The policy updates on a schedule (daily or after N reviews), not instantly after every review.

## Decisions

- **Policy storage:** a new row in `learning_reports` with `report_type = 'audit_policy'`. Reuses the existing table (which already has `report_type`, `report_date`, `summary` JSONB). The `summary` field holds `{ policy_text: string, reviewed_count: number, accepted_count: number, rejected_count: number, noted_count: number, generated_at: string }`. No new table needed.
- **Policy consumption:** the audit service reads the latest `audit_policy` report at the start of `runAuditCycle` and, if one exists, prepends its `policy_text` to the audit prompt as a "selection guidance" preamble.
- **Trigger:** a new method `updateAuditPolicy()` on the audit service, invoked by a `@Cron` (daily at 01:00, after the nightly evaluation) and also manually via `POST /admin/run-audit-policy-update`.
- **LLM model:** `gemma4:26b` (same as the audit itself — consistent quality).
- **Minimum threshold:** 5 reviewed findings before generating a policy. Configurable via `AUDIT_POLICY_MIN_REVIEWS`.

## Dependencies

- `tier-2-audit` is merged ✅
- `audit_findings` table exists with `status`, `review_text`, `reviewed_at`, `reviewed_by` columns ✅
- `learning_reports` table exists with `report_type` check constraint — need to verify it allows `'audit_policy'` (may need to add to the constraint) ✅
- `gemma4:26b` available ✅
