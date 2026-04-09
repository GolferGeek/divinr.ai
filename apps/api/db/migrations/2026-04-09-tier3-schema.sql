-- Tier 3 Strategic Overhauls: add columns to learning_proposals for evidence and contract diffs
ALTER TABLE prediction.learning_proposals
  ADD COLUMN IF NOT EXISTS evidence_summary jsonb,
  ADD COLUMN IF NOT EXISTS proposed_context_markdown text,
  ADD COLUMN IF NOT EXISTS current_context_markdown text;
