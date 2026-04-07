-- Phase 8.4 — historical row cleanup.
--
-- Background: prior to 2026-04-07 a stale CONVICTION_TRADE_THRESHOLD=60
-- env override allowed analyst positions to open at conviction < 70. The
-- threshold has since been corrected; rows already written stay in place
-- but are annotated so leaderboard/dashboards can filter them out if
-- desired. Idempotent: running twice is a no-op (notes is overwritten
-- with the same string).
--
-- Run once against the dev DB:
--   psql "$DATABASE_URL" -f apps/api/db/cleanup/2026-04-07-stale-threshold-rows.sql

update prediction.analyst_positions
   set notes = 'historical: written under stale CONVICTION_TRADE_THRESHOLD=60 env override, 2026-04-07'
 where trigger_reason in ('signal_cross','eod_sweep')
   and trigger_conviction < 70
   and opened_at < '2026-04-07 17:30:00+00'
   and (notes is null or notes <> 'historical: written under stale CONVICTION_TRADE_THRESHOLD=60 env override, 2026-04-07');
