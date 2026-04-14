# Effort: Test — Three-Tier Learning Loop

## Covers
- `automated-meta-loop` — System learns from user feedback (accept/reject)
- `tier-1-structured-writes` — Learning engine writes structured adaptations into context_markdown
- `tier-2-audit` — Contract-vs-output audit with gemma4, admin inbox at /findings, accept/reject/note
- `tier3-strategic-overhauls` — Evidence aggregation, LLM contract rewrites, canonical test validation, admin /proposals page

## Testing Scope
- Tier 1: Verify adaptations appear in analyst context after evaluation cycles
- Tier 2: /findings page shows audit findings, accept/reject/note actions work
- Tier 3: /proposals page shows strategic contract rewrite proposals, approve/reject
- Learning progression: Tier 1 is autonomous, Tier 2 requires admin review, Tier 3 requires approval
- Canonical test validation: proposed changes tested against canonical scenarios before applying

## Marketing Angle
The system doesn't just predict — it learns. Three tiers of self-improvement: autonomous micro-adjustments, audited corrections, and strategic overhauls. Every change is reviewed.

## Chrome Testing
- Navigate to /findings — verify audit findings display
- Accept/reject/note a finding — verify state changes
- Navigate to /proposals — verify Tier 3 proposals display
- Approve/reject a proposal — verify state changes
- Verify learning adaptations appear in analyst contract context

## Out of Scope
- The actual LLM quality of adaptations (subjective)
