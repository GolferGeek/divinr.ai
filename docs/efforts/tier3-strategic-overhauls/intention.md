# Effort: Tier 3 Strategic Overhauls

## Problem

Tiers 1 and 2 handle micro-adjustments and contract-vs-output auditing, but neither can propose **structural changes** to an analyst: rewriting a contract section, changing the analyst's fundamental approach, or flagging that an analyst is no longer providing value. These decisions require aggregating evidence across many audit findings, performance trends, and calibration data — then synthesizing a proposal that a human reviews before it takes effect.

Today that synthesis happens entirely in the admin's head. There's no system that says "this analyst has had 12 accepted findings about ignoring sector-rotation rules and its calibration has degraded 15% over 30 days — here's a proposed contract rewrite."

## Intention

Build Tier 3: a system that periodically analyzes accumulated Tier 2 feedback and performance data, generates strategic proposals for analyst redesigns, runs them through canonical tests, and presents them to the admin for approval. On approval, the proposal becomes a new config version with `source='tier3_strategic'`.

## Scope

- **Evidence aggregation**: Gather accepted audit findings grouped by analyst and pattern, performance profile trends, calibration degradation signals, and arbitrator override frequency.
- **Proposal generation**: Use the local LLM (gemma4:26b) to synthesize evidence into a concrete contract change: a rewritten `context_markdown` with specific sections modified and a rationale explaining what changed and why.
- **Canonical testing**: Run the proposed contract through the existing `CanonicalTestRunnerService` to verify it doesn't regress on known test days.
- **Review queue**: Present proposals in a new `/proposals` admin page (or extend the existing `/findings` inbox) with the proposed diff, rationale, canonical test results, and approve/reject buttons.
- **Apply on approval**: Create a new `analyst_config_versions` row with `source='tier3_strategic'`, `parent_version_id` linked, and activate it. On rejection, mark the proposal and move on.
- **Scheduling**: Run the Tier 3 analysis on a weekly cron (configurable). Only generate proposals when sufficient evidence has accumulated (minimum accepted findings threshold).
- **Learning proposals table**: Write proposals to the existing `learning_proposals` table with `tier=3`.

## Success Criteria

- The system generates strategic proposals based on accumulated Tier 2 evidence.
- Proposals include a concrete contract diff, a human-readable rationale, and canonical test results.
- Admin can review, approve, or reject proposals from the UI.
- Approved proposals create a new config version with `source='tier3_strategic'`.
- Rejected proposals are recorded but do not affect the analyst.
- The system only proposes when sufficient evidence exists (no noise on sparse data).
- No proposals are auto-applied — every Tier 3 change requires human approval.

## Out of Scope

- Creating or deleting analysts (Tier 3 modifies existing analysts only).
- Changing the risk debate system or dimension weights.
- Multi-analyst coordination (e.g., "these two analysts are too similar" — future).
- Automated rollback of Tier 3 changes (admin can use the existing contract editor rollback).
