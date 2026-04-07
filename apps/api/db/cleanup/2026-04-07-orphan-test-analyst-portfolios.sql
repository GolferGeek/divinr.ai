-- Cleanup: remove orphan analyst_portfolios rows that have no matching market_analysts entry.
-- These are leftover test/seed rows (19 distinct analyst_ids → 43 portfolio rows across fork_types)
-- with no display_name, no strategy_name, and 2-3 fork duplicates each.
-- They were polluting the Phase 5 master-detail leaderboard with raw UUIDs and triplicate rows.
-- One-shot — run once against dev DB.

begin;

with orphans as (
  select ap.id
  from prediction.analyst_portfolios ap
  left join prediction.market_analysts ma on ma.id = ap.analyst_id
  where ma.id is null
)
delete from prediction.analyst_positions where portfolio_id in (select id from orphans);

with orphans as (
  select ap.id
  from prediction.analyst_portfolios ap
  left join prediction.market_analysts ma on ma.id = ap.analyst_id
  where ma.id is null
)
delete from prediction.daily_pnl_snapshot where portfolio_id in (select id from orphans);

with orphans as (
  select ap.id
  from prediction.analyst_portfolios ap
  left join prediction.market_analysts ma on ma.id = ap.analyst_id
  where ma.id is null
)
delete from prediction.bailout_ledger where portfolio_id in (select id from orphans);

delete from prediction.analyst_portfolios ap
where not exists (select 1 from prediction.market_analysts ma where ma.id = ap.analyst_id);

commit;
