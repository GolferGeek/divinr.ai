-- Effort: llm-reasoning-capture
-- Date: 2026-04-08
--
-- Adds reasoning capture columns to public.llm_usage. The table itself is not
-- managed by a tracked migration in this repo; this file is record-keeping
-- only. Apply to each environment via psql before deploying the corresponding
-- code change.
--
-- All columns nullable / additive. Safe to re-run.

alter table public.llm_usage add column if not exists reasoning_content text;
alter table public.llm_usage add column if not exists reasoning_tokens integer;
alter table public.llm_usage add column if not exists reasoning_truncated boolean default false;
