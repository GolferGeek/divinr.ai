-- Demo mode switch baseline.
--
-- This is data state, not schema: the UI still shows the full catalog, while
-- cron/pipeline jobs process only rows whose switches are active/enabled.

BEGIN;

SET LOCAL divinr.admin_override = 'true';

UPDATE prediction.instruments
SET is_active = (upper(symbol) IN ('AAPL', 'NVDA'))
WHERE user_id IS NULL;

UPDATE prediction.market_analysts
SET is_enabled = (lower(slug) IN ('fundamentals-analyst', 'sentiment-analyst'))
WHERE user_id IS NULL;

COMMIT;

INSERT INTO prediction.tenant_source_entitlements (
  source_id,
  is_enabled,
  override_notes,
  created_by,
  updated_at
)
SELECT
  id,
  lower(source_key) IN ('reuters', 'yahoo_finance') AS is_enabled,
  'Demo mode source switch state',
  'demo-mode-migration',
  now()
FROM prediction.source_catalog
ON CONFLICT (source_id) DO UPDATE SET
  is_enabled = EXCLUDED.is_enabled,
  override_notes = EXCLUDED.override_notes,
  created_by = EXCLUDED.created_by,
  updated_at = EXCLUDED.updated_at;
